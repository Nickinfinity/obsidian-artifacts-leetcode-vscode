import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
	FileSpec,
	ParsedLeetCode,
	ProjectCheck,
	ProjectCheckOutcome,
	TestCase,
	TestResult,
} from '../../../types/leetcode.types.js';
import { ecosystemFor, type LibEcosystem, type RunArgv } from '../../libs/lib-ecosystem.js';
import { publicSuite, submitSuite } from '../../leetcode-suite.helpers.js';
import { isBatchEnv, testEnvFor } from '../env.registry.js';
import { entryFileFor } from '../program/make-program-env.js';
import { programLanguageOf, runProgramSuite } from '../program/program.runner.js';
import {
	createGroupRegistry, installSignalTeardown, type BootedGroupRegistry,
} from '../http/server.lifecycle.js';
import { bootStack } from '../stack/stack.runner.js';
import { renderLibsFor } from './checks.js';
import { writeProjectFiles } from './files.writer.js';
import { ensureLibEnv } from '../../libs/lib-cache.service.js';
import { linkModules } from './modules.linker.js';
import { runOneCheck } from './check.dispatcher.js';

/**
 * Grade every declared check of a `project` artifact.
 *
 * Materialises the file tree into a fresh temp directory, runs each check in it,
 * and returns one outcome per check — **solved is every check green**. The run
 * directory is always removed, including when a check throws.
 *
 * The tree is written once and shared by every check: a `build` check compiling
 * what a `dom-assert` then mounts is the point of a multi-file exercise.
 *
 * With `withSolutions`, the artifact's `# Solutions` overlays replace the
 * starter files they name. That is what lets an exercise ship a starter *and*
 * verify green: the harness grades the reference, a solver's run grades theirs.
 *
 * @param parsed  - Parsed `project` artifact.
 * @param options - `withSolutions` grades the reference tree instead of the
 *   starter; `installSignals` arms the process-wide `SIGINT`/`SIGTERM`
 *   teardown, and belongs to a **CLI** caller only (see below).
 * @returns One outcome per declared check, in declaration order.
 *
 * @example
 * await runProjectChecks(parsed, { withSolutions: true }); // → [{ name: 'alternates', passed: true }]
 */
export async function runProjectChecks(
	parsed: ParsedLeetCode,
	options: {
		withSolutions?: boolean; publicOnly?: boolean;
		registry?: BootedGroupRegistry; installSignals?: boolean;
	} = {},
): Promise<ProjectCheckOutcome[]> {
	const checks = parsed.checks ?? [];
	if (checks.length === 0) { return []; }

	// C33: a fresh registry on every path — a harness/CLI/dry-run-Submit caller
	// has no live VS Code session to register a booted `http` server on for
	// `endChallenge()` to reap, so without one only `runHttpCheck`'s (or
	// `bootStack`'s) own `finally` stands between a booted server and an
	// orphan. A caller may inject its own (a test observing it directly, or the
	// live challenge session).
	const registry = options.registry ?? createGroupRegistry();

	// **The signal handler is opt-in, and only a CLI may opt in.** Nothing
	// before survives a `Ctrl-C`/`kill` landing between a boot's `spawn` and
	// that `finally`, because Node runs neither for an unhandled
	// `SIGINT`/`SIGTERM` (measured — see `installSignalTeardown`'s doc). But
	// this function also runs **inside the VS Code extension host** (the
	// dry-run Submit path, `leetcode-run.handlers.ts`), and `SIGTERM` is
	// exactly how VS Code terminates that host on window close, reload and
	// update: an unconditional handler fired there and forced `process.exit`
	// underneath the host's own shutdown, racing `deactivate()` — which is
	// where `PracticeMode` restores the solver's **global** editor settings.
	// Losing that race leaves `noCompletion` and friends permanently applied,
	// with no live challenge left to end and nothing in the UI explaining it.
	// An extension must never force the exit of a process it does not own; a
	// short-lived CLI (`verify-exercise.mjs`, both modes) owns its own signal
	// disposition, which is what makes the same handler correct there.
	const uninstall = options.installSignals ? installSignalTeardown(registry) : undefined;

	const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leet-project-'));
	try {
		const tree = options.withSolutions
			? overlaySolutions(parsed.files ?? [], parsed.solutionFiles ?? [])
			: parsed.files ?? [];
		await writeProjectFiles(runDir, tree);

		return await gradeProjectDir(parsed, runDir, { ...options, registry });
	} catch (e) {
		// A failure to materialise the tree (a traversal path, an unwritable
		// location) is not one check's problem — it fails all of them.
		const reason = e instanceof Error ? e.message : String(e);
		return checks.map(c => ({ name: c.name, passed: false, detail: reason }));
	} finally {
		uninstall?.();
		// Idempotent backstop even on the normal path: `gradeProjectDir`'s own
		// `finally` already tore down whatever `bootStack` booted, and every
		// `http` check's own `finally` already stopped its own boot — this only
		// does anything when one of those was itself skipped by a thrown error
		// this function's `catch` above did not already attribute to a check.
		await registry.teardownAll();
		await fs.rm(runDir, { recursive: true, force: true }).catch(() => { /* ignore cleanup errors */ });
	}
}

/**
 * Grade an **existing** directory — the solver's own working tree during a live
 * challenge, or the temp copy `runProjectChecks` just materialised.
 *
 * Nothing is written here, which is the point: a live run grades the files the
 * solver is editing, in place, rather than a snapshot taken from the artifact.
 *
 * Installs the run's libraries **once**, under one cache key (§B.1): every
 * `libs:` language, widened to `renderLibsFor` only when a `dom-assert` /
 * `css-assert` check is declared, so a `build`-only exercise never pays for
 * esbuild + jsdom + React. An empty set installs and links nothing. The
 * resulting cache is linked into `runDir`'s own `node_modules` (§B.2) before
 * any check runs, and handed to the render check so it never installs its own
 * — one install, one key, one link target.
 *
 * With `publicOnly`, each check is graded against `cases.slice(0, publicCount)`
 * — the mid-challenge Run Tests loop, which must never touch the hidden suite.
 *
 * @param parsed  - Parsed `project` artifact.
 * @param runDir  - Directory holding the tree to grade.
 * @param options - `publicOnly` restricts every check to its public cases;
 *                  `installRun` injects the install subprocess for tests,
 *                  which must never reach the network or a developer's real cache;
 *                  `registry` is the live challenge session's booted-group
 *                  registry, so a server an `http` check boots is torn down by
 *                  `endChallenge()` as well as by the check's own `finally`
 *                  (S12 — the `finally` cannot cover VS Code exiting or the
 *                  panel being disposed mid-check). The harness path has no
 *                  session and passes none.
 * @returns One outcome per declared check, in declaration order.
 *
 * @example
 * await gradeProjectDir(parsed, session.projectDir.fsPath, { publicOnly: true });
 */
export async function gradeProjectDir(
	parsed: ParsedLeetCode, runDir: string,
	options: { publicOnly?: boolean; installRun?: RunArgv; registry?: BootedGroupRegistry } = {},
): Promise<ProjectCheckOutcome[]> {
	const checks = parsed.checks ?? [];
	if (checks.length === 0) { return []; }

	const dirs = new Map<LibEcosystem, string>();
	const install = options.installRun ? { run: options.installRun } : {};
	for (const [ecosystem, specs] of installSetsFor(parsed, checks)) {
		const installed = await ensureLibEnv(ecosystem, specs, install);
		if (!installed.ok) {
			return checks.map(c => ({ name: c.name, passed: false, detail: installed.reason }));
		}
		dirs.set(ecosystem, installed.dir);
	}

	// Only the npm tree is linked into the run: a `build` check's toolchain
	// resolves `node_modules` by walking up from `runDir`, and every other
	// ecosystem is reached through an environment variable instead.
	const npmDir = dirs.get('pnpm');
	if (npmDir !== undefined) { await linkModules(runDir, npmDir); }

	// T4.1: a `stack` boots its whole `packages:` list — dependsOn order,
	// exposeAs wiring, one teardown for the group — exactly once, before any
	// check runs, rather than each `http` check booting (and re-booting) its
	// own package the way a single-package `leetcodeType: package` still does
	// below in `runPackageHttpCheck`. Gated on the leetcode-type axis, not on
	// `packages.length > 0` alone, so a `package` artifact's existing,
	// already-working single-boot-per-check path is completely untouched.
	const stackBoot = parsed.leetcodeType === 'stack' && (parsed.packages?.length ?? 0) > 0
		? await bootStack(parsed.packages ?? [], runDir, { registry: options.registry, libDirs: dirs })
		: undefined;

	try {
		const outcomes: ProjectCheckOutcome[] = [];
		for (const check of checks) {
			const graded = options.publicOnly ? publicCasesOf(check) : check;
			outcomes.push(await runOneCheck(graded, parsed, runDir, dirs, options.registry, stackBoot));
		}
		return outcomes;
	} finally {
		// Every package `bootStack` did boot is also registered on
		// `options.registry` (S12) — this `finally` is the normal end-of-grading
		// path; the registry is the backstop for VS Code exiting or the panel
		// being disposed mid-check, exactly as a single `http` check's own boot
		// already relies on both.
		await stackBoot?.teardownAll();
	}
}

/**
 * The libraries this grading run needs, grouped into one install per registry.
 *
 * A FastAPI-plus-React exercise resolves a venv **and** a node environment in
 * one run, which is the case that makes the grouping worth its keys: unioning
 * them would install `libs.python: [requests]` from npm, and the name-shape
 * grammar cannot tell the two `requests` apart.
 *
 * The npm set — and **only** the npm set — is widened to `renderLibsFor` when a
 * `dom-assert` / `css-assert` check is declared, so the render driver and this
 * install resolve from the very same cache, and a `build`-only exercise never
 * pays for esbuild + jsdom + React.
 *
 * @param parsed - The artifact, for `libs:`.
 * @param checks - Its declared checks, to detect a render kind.
 * @returns Specs per ecosystem; empty when the run needs nothing installed.
 *
 * @example
 * installSetsFor(parsed, [{ kind: 'build', … }]);
 * // → Map { 'pip' => ['fastapi>=0.115'], 'pnpm' => ['react@^19.0.0'] }
 */
function installSetsFor(
	parsed: ParsedLeetCode, checks: ProjectCheck[],
): Map<LibEcosystem, string[]> {
	const sets = new Map<LibEcosystem, string[]>();
	for (const [language, specs] of Object.entries(parsed.libs ?? {})) {
		const ecosystem = ecosystemFor(language);
		// A language with no registry was already warned about at parse time.
		if (!ecosystem) { continue; }
		sets.set(ecosystem, [...new Set([...(sets.get(ecosystem) ?? []), ...specs])]);
	}

	if (checks.some(c => c.kind === 'dom-assert' || c.kind === 'css-assert')) {
		sets.set('pnpm', renderLibsFor(sets.get('pnpm') ?? []));
	}
	return sets;
}

/** The same check restricted to its public cases — the leading `publicCount` slice. */
function publicCasesOf(check: ProjectCheck): ProjectCheck {
	return { ...check, cases: check.cases.slice(0, check.publicCount) };
}

/**
 * Grade a `program`-suite artifact from its own declared tree — the harness
 * path, mirroring `runProjectChecks` for the check-graded shape.
 *
 * Materialises `## Files` into a fresh temp directory (overlaid with the
 * `path=`-carrying `# Solutions` fences when `withSolutions`), then runs the
 * suite against it. The overlay is what lets an exercise ship **unsolved** and
 * still verify green; `--starter-red` calls this with `withSolutions: false`
 * to prove the starter actually fails.
 *
 * @param parsed  - The artifact; must satisfy `isProgramSuite`.
 * @param options - `withSolutions` to overlay the reference; `publicOnly` for
 *   the public half.
 * @returns Per-case results, or a one-case failure naming why nothing ran.
 *
 * @example
 * await runProgramArtifact(parsed, { withSolutions: true });
 */
export async function runProgramArtifact(
	parsed: ParsedLeetCode, options: { withSolutions?: boolean; publicOnly?: boolean } = {},
): Promise<TestResult[]> {
	const program = parsed.program;
	const langId = programLanguageOf(parsed);
	const cases = options.publicOnly ? publicSuite(parsed) : submitSuite(parsed);
	if (!program) { return [failedSuite(cases, 'program: no `program:` block declared')]; }
	if (!langId) {
		return [failedSuite(cases, 'program: `## Files` names no runnable language')];
	}

	const env = testEnvFor('program', langId, parsed.leetcodeType);
	if (!env || isBatchEnv(env)) {
		return [failedSuite(cases, `program: no program environment for '${langId}'`)];
	}

	const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leet-program-'));
	try {
		const tree = options.withSolutions
			? overlaySolutions(parsed.files ?? [], parsed.solutionFiles ?? [])
			: parsed.files ?? [];
		await writeProjectFiles(runDir, tree);

		const entry = path.join(runDir, entryFileFor(program, langId));
		const code = await fs.readFile(entry, 'utf-8');
		return await runProgramSuite({ code, tests: cases, parsed, env, program, runDir });
	} catch (e) {
		// Failing to materialise or read the tree is not one case's problem.
		return [failedSuite(cases, e instanceof Error ? e.message : String(e))];
	} finally {
		await fs.rm(runDir, { recursive: true, force: true }).catch(() => { /* ignore cleanup errors */ });
	}
}

/** One synthetic failing result carrying why the suite never ran. */
function failedSuite(cases: TestCase[], reason: string): TestResult {
	const first = cases[0] ?? { input: {}, expected: null };
	return {
		index: 0, passed: false, input: first.input, expected: first.expected,
		actual: '', duration: 0, error: reason,
	};
}

/**
 * Replace each starter file with the `# Solutions` entry that names the same
 * path; overlays naming a path the tree does not declare are appended.
 *
 * @param files     - The `## Files` starter tree.
 * @param solutions - Reference overlays from `# Solutions`.
 * @returns The tree to grade, in the starter's declaration order.
 *
 * @example
 * overlaySolutions([{ path: 'a.jsx', content: 'todo', … }], [{ path: 'a.jsx', content: 'done', … }]);
 * // → [{ path: 'a.jsx', content: 'done', … }]
 */
function overlaySolutions(files: FileSpec[], solutions: FileSpec[]): FileSpec[] {
	if (solutions.length === 0) { return files; }

	const byPath = new Map(solutions.map(s => [s.path, s]));
	const merged = files.map(file => byPath.get(file.path) ?? file);
	const extra = solutions.filter(s => !files.some(f => f.path === s.path));
	return [...merged, ...extra];
}

