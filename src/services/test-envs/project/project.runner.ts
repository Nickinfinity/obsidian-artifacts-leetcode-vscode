import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
	FileSpec,
	FunctionCheck,
	HttpCheck,
	ParsedLeetCode,
	ProjectCheck,
	ProjectCheckOutcome,
	TestCase,
	TestResult,
} from '../../../types/leetcode.types.js';
import { canonicalJson } from '../../../utils/canonical-json.js';
import { resolveLangId } from '../../language-map.service.js';
import { ecosystemFor, type LibEcosystem, type RunArgv } from '../../libs/lib-ecosystem.js';
import { runSuite } from '../../leetcode-runner.service.js';
import { publicSuite, submitSuite } from '../../leetcode-suite.helpers.js';
import { isBatchEnv, testEnvFor } from '../env.registry.js';
import { entryFileFor } from '../program/make-program-env.js';
import { programLanguageOf, runProgramSuite } from '../program/program.runner.js';
import { runBuildCheck } from './build.check.js';
import { runHttpCases, runHttpCheck } from '../http/http.check.js';
import {
	createGroupRegistry, installSignalTeardown, type BootedGroupRegistry,
} from '../http/server.lifecycle.js';
import { bootStack, type StackBoot } from '../stack/stack.runner.js';
import { renderLibsFor, runRenderCheck } from './checks.js';
import { resolveContained, writeProjectFiles } from './files.writer.js';
import { ensureLibEnv } from '../../libs/lib-cache.service.js';
import { linkModules } from './modules.linker.js';

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
		? await bootStack(parsed.packages ?? [], runDir, { registry: options.registry })
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
 * Dispatch one check to the machinery for its kind.
 *
 * The run directory's `node_modules` is linked once by `gradeProjectDir`
 * before any check runs — a `build` check's own toolchain (`npx tsc`, `npm run
 * build`) resolves it exactly like a real project checkout, and a render
 * check is handed the same cache dir so it never installs a second one.
 *
 * @param check     - The check to run.
 * @param parsed    - The artifact, for `params` / `returns` / `libs` / `packages`.
 * @param runDir    - Run directory holding the materialised tree and its linked `node_modules`.
 * @param dirs      - Resolved cache directory per ecosystem for this run.
 * @param registry  - The session's booted-group registry, when this run has a
 *   session; only the `http` kind boots anything.
 * @param stackBoot - The whole-group boot `gradeProjectDir` already ran for a
 *   `stack` artifact (T4.1) — present only for `leetcodeType: stack`. An
 *   `http` check dispatches against its already-known port instead of
 *   booting (and re-booting) its own instance the way a single-package
 *   `package` artifact still does.
 * @returns The check's verdict.
 */
async function runOneCheck(
	check: ProjectCheck, parsed: ParsedLeetCode, runDir: string,
	dirs: ReadonlyMap<LibEcosystem, string>, registry?: BootedGroupRegistry, stackBoot?: StackBoot,
): Promise<ProjectCheckOutcome> {
	switch (check.kind) {
		case 'build':
			return runBuildCheck(check, runDir, dirs);
		case 'dom-assert':
		case 'css-assert':
			return runRenderCheck(check, runDir, undefined, dirs.get('pnpm'));
		case 'http':
			return stackBoot
				? runStackHttpCheck(check, stackBoot, parsed.test.timeoutMs)
				: runPackageHttpCheck(check, parsed, runDir, registry);
		case 'call':
			// Nothing is threaded in: a call check runs through `runSuite`,
			// which resolves its own library environment from `parsed.libs`.
			// A second resolver here would install the same set twice.
			return runFunctionCheck(check, parsed, runDir);
	}
}

/**
 * Resolve an `http` check's `package:` name against the artifact's own
 * `packages:` list, then hand the spec to the check kind that boots it.
 *
 * The name is **artifact-authored text**, so it is looked up rather than
 * trusted: a check naming a package the artifact never declared fails by name
 * instead of booting nothing and reporting an empty, green suite.
 *
 * The per-request budget is the artifact's own `test.timeoutMs`, clamped again
 * inside `runHttpCheck` — `parseTimeoutMs` already bounds it at parse time,
 * and the second clamp is that module's contract with direct callers.
 *
 * **Libraries are not threaded into the boot, and that is a stated ceiling —
 * still true after T4.1.** A node package resolves its imports through the
 * `node_modules` `linkModules` already put in the run directory, so an
 * Express server boots; a package whose ecosystem is reached by environment
 * variable instead (a venv, a classpath) does not see them yet, and fails
 * loudly naming the missing import rather than grading green without them.
 * T4.1 (`bootStack`, `stack.runner.ts`) landed `dependsOn` ordering,
 * `exposeAs` wiring and group teardown for a `stack`'s boot — a different
 * environment seam (cross-package URLs, not `libs:` cache directories) — and
 * did not close this one. Closing it means resolving `parsed.libs` through
 * `ensureLibEnv` at this call site (or inside `bootStack`) and consuming it
 * the same way `runProgramSuite` already does (`CLASSPATH` / `VIRTUAL_ENV`),
 * which is its own task.
 *
 * @param check    - The `http` check.
 * @param parsed   - The artifact, for `packages:` and the per-case budget.
 * @param runDir   - Run directory holding the materialised tree.
 * @param registry - The session's booted-group registry, when there is a session.
 * @returns The check's verdict.
 *
 * @example
 * await runPackageHttpCheck(check, parsed, '/tmp/run', session.bootedGroups);
 */
async function runPackageHttpCheck(
	check: HttpCheck, parsed: ParsedLeetCode, runDir: string, registry?: BootedGroupRegistry,
): Promise<ProjectCheckOutcome> {
	const pkg = (parsed.packages ?? []).find(p => p.name === check.package);
	if (!pkg) {
		return {
			name: check.name, passed: false,
			detail: `http check names package '${check.package}', which this artifact does not declare`,
		};
	}
	return runHttpCheck(
		{ name: check.name, cases: check.cases }, pkg, runDir, parsed.test.timeoutMs, { registry },
	);
}

/**
 * Grade a `stack`'s `http` check against the package `bootStack` (T4.1)
 * already booted, instead of booting one — the whole reason a `stack`'s
 * packages are booted once up front rather than per check: a package that
 * both exposes a port to a dependent (`web`'s `VITE_API_URL`) and is itself
 * checked would otherwise be booted twice, on two different ports, and the
 * dependent's baked-in URL would point at the wrong one.
 *
 * A package that never booted (a failed install, a failed `bootServer`, or
 * an unresolved `dependsOn`) fails the check by name, carrying the boot
 * outcome's own reason — the exact shape `gradeProjectDir`'s lib-install
 * failure already uses (`checks.map(c => ({ …, detail: installed.reason }))`),
 * just for one check instead of every check.
 *
 * **The request loop itself is `http.check.ts`'s {@link runHttpCases}, not a
 * copy of it** — one authority for the per-case loop, the `[MIN_TEST_TIMEOUT_MS,
 * MAX_SUITE_TIMEOUT_MS]` clamp and the `MAX_HTTP_BODY_BYTES` request cap.
 * What must **not** collapse with it is the entry point: `runHttpCheck` always
 * boots its own server, so routing a stack through it would double-boot a
 * package that is both a dependency of another and separately checked, and
 * strand the `exposeAs` port just computed for it.
 *
 * @param check     - The `http` check.
 * @param stackBoot - The whole-group boot result from `bootStack`.
 * @param timeoutMs - The artifact's own `test.timeoutMs`, clamped inside
 *   {@link runHttpCases} exactly as it is for a direct `runHttpCheck` caller.
 * @returns The check's verdict.
 *
 * @example
 * await runStackHttpCheck(check, stackBoot, 5000);
 */
async function runStackHttpCheck(
	check: HttpCheck, stackBoot: StackBoot, timeoutMs: number,
): Promise<ProjectCheckOutcome> {
	const outcome = stackBoot.outcomes.get(check.package);
	if (!outcome) {
		return {
			name: check.name, passed: false,
			detail: `http check names package '${check.package}', which this artifact does not declare`,
		};
	}
	if (!outcome.ok) {
		return { name: check.name, passed: false, detail: `server never started: ${outcome.reason}` };
	}
	return runHttpCases({ name: check.name, cases: check.cases }, outcome.port, timeoutMs);
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

/**
 * Grade a `call` check by running the declared export through the existing
 * `call` environment for its language.
 *
 * There is no second execution path: the check's file becomes the candidate and
 * the artifact's own `params` / `returns` type it, which is exactly why a
 * project may declare **at most one** function check.
 *
 * @param check  - The function check.
 * @param parsed - The artifact, for `params` / `returns` / `test`.
 * @param runDir - Run directory holding the materialised tree.
 * @returns The check's verdict.
 *
 * @example
 * await runFunctionCheck(check, parsed, '/tmp/run'); // → { name: 'catalogue filter', passed: true }
 */
async function runFunctionCheck(
	check: FunctionCheck, parsed: ParsedLeetCode, runDir: string,
): Promise<ProjectCheckOutcome> {
	if (check.cases.length === 0) {
		return { name: check.name, passed: false, detail: 'function check declares no cases' };
	}

	let source: string;
	try {
		source = await fs.readFile(resolveContained(runDir, check.file), 'utf-8');
	} catch (e) {
		return { name: check.name, passed: false, detail: e instanceof Error ? e.message : String(e) };
	}

	const langId = languageOf(check.file);
	// `'function'`, never `parsed.leetcodeType`: what this resolves is an env
	// for the **one file** the check names, extracted from the tree and graded
	// exactly as a single candidate buffer. The shape asked of the registry is
	// the buffer's, not the artifact's — a `call` env serves buffers, and
	// passing `'package'` here would resolve nothing and fail every function
	// check inside a tree.
	const env = testEnvFor('call', langId, 'function');
	// `isBatchEnv` because the registry now holds per-case `program` envs too;
	// only a batch env can be handed to `runSuite`. A `call` key can only
	// resolve a batch env today, so this narrowing is a compiler-enforced
	// statement of that fact rather than a branch anyone expects to take.
	if (!env || !isBatchEnv(env)) {
		return { name: check.name, passed: false, detail: `no call environment for '${langId}'` };
	}

	// The check names its own export, which is not the artifact's `function:`.
	const asFunctionArtifact: ParsedLeetCode = { ...parsed, functionName: check.function, functions: undefined };
	const results = await runSuite(stripModuleSyntax(source), check.cases, asFunctionArtifact, env);

	const bad = results.find(r => !r.passed);
	if (!bad) { return { name: check.name, passed: true }; }

	const detail = bad.error ?? `expected ${canonicalJson(bad.expected)}, got ${bad.actual}`;
	return { name: check.name, passed: false, detail: `case ${bad.index}: ${detail}` };
}

/**
 * Strip ES module keywords so a project file runs under the function
 * environments, which evaluate a bare declaration rather than a module.
 *
 * Only the `export` keyword is removed — the declaration it fronted stays
 * exactly as written, so the solver's own code is still never rewritten in any
 * way that changes what it does.
 *
 * ponytail: keyword-level, not a real module loader. A project file that
 * *imports* another file needs a bundler pass here; add one when an exercise
 * declares a function check that spans files.
 *
 * @param source - File contents from the run directory.
 * @returns The same source with leading `export` keywords removed.
 *
 * @example
 * stripModuleSyntax('export function f() {}'); // → 'function f() {}'
 */
function stripModuleSyntax(source: string): string {
	return source.replace(/^export\s+(default\s+)?/gm, '');
}

/** Canonical language id for a file, from its extension. */
function languageOf(file: string): string {
	const ext = path.extname(file).replace('.', '');
	const langId = resolveLangId(ext);
	// `.tsx` / `.jsx` resolve to display ids with no runtime; a function check
	// grades plain module code, so fall back to the runnable pair.
	if (langId === 'typescriptreact') { return 'typescript'; }
	if (langId === 'javascriptreact') { return 'javascript'; }
	return langId;
}
