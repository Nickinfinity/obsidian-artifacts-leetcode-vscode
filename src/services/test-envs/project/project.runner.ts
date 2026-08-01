import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
	FileSpec,
	FunctionCheck,
	ParsedLeetCode,
	ProjectCheck,
	ProjectCheckOutcome,
} from '../../../types/leetcode.types.js';
import { canonicalJson } from '../../../utils/canonical-json.js';
import { resolveLangId } from '../../language-map.service.js';
import { ecosystemFor } from '../../libs/lib-ecosystem.js';
import { runSuite } from '../../leetcode-runner.service.js';
import { testEnvFor } from '../env.registry.js';
import { runBuildCheck } from './build.check.js';
import { renderLibsFor, runRenderCheck } from './checks.js';
import { resolveContained, writeProjectFiles } from './files.writer.js';
import { installLibs, type InstallOptions } from '../../libs/pnpm.installer.js';
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
 * @param options - `withSolutions` grades the reference tree instead of the starter.
 * @returns One outcome per declared check, in declaration order.
 *
 * @example
 * await runProjectChecks(parsed, { withSolutions: true }); // → [{ name: 'alternates', passed: true }]
 */
export async function runProjectChecks(
	parsed: ParsedLeetCode, options: { withSolutions?: boolean; publicOnly?: boolean } = {},
): Promise<ProjectCheckOutcome[]> {
	const checks = parsed.checks ?? [];
	if (checks.length === 0) { return []; }

	const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leet-project-'));
	try {
		const tree = options.withSolutions
			? overlaySolutions(parsed.files ?? [], parsed.solutionFiles ?? [])
			: parsed.files ?? [];
		await writeProjectFiles(runDir, tree);

		return await gradeProjectDir(parsed, runDir, options);
	} catch (e) {
		// A failure to materialise the tree (a traversal path, an unwritable
		// location) is not one check's problem — it fails all of them.
		const reason = e instanceof Error ? e.message : String(e);
		return checks.map(c => ({ name: c.name, passed: false, detail: reason }));
	} finally {
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
 *                  which must never reach the network or a developer's real cache.
 * @returns One outcome per declared check, in declaration order.
 *
 * @example
 * await gradeProjectDir(parsed, session.projectDir.fsPath, { publicOnly: true });
 */
export async function gradeProjectDir(
	parsed: ParsedLeetCode, runDir: string,
	options: { publicOnly?: boolean; installRun?: NonNullable<InstallOptions['run']> } = {},
): Promise<ProjectCheckOutcome[]> {
	const checks = parsed.checks ?? [];
	if (checks.length === 0) { return []; }

	const libs = installSetFor(parsed, checks);
	let cacheDir: string | undefined;
	if (libs.length > 0) {
		const installed = await installLibs(libs, options.installRun ? { run: options.installRun } : {});
		if (!installed.ok) {
			return checks.map(c => ({ name: c.name, passed: false, detail: installed.reason }));
		}
		await linkModules(runDir, installed.dir);
		cacheDir = installed.dir;
	}

	const outcomes: ProjectCheckOutcome[] = [];
	for (const check of checks) {
		const graded = options.publicOnly ? publicCasesOf(check) : check;
		outcomes.push(await runOneCheck(graded, parsed, runDir, cacheDir));
	}
	return outcomes;
}

/**
 * The set of libraries this grading run needs, installed once under one cache
 * key (§B.1).
 *
 * `runLibs(parsed)` unless the artifact declares a `dom-assert` / `css-assert`
 * check, in which case the set is widened to `renderLibsFor` — the harness
 * toolchain plus React, so the render driver and this install resolve from
 * the very same cache.
 *
 * @param parsed - The artifact, for `libs:`.
 * @param checks - Its declared checks, to detect a render kind.
 * @returns Specs to install; `[]` when the run needs nothing.
 *
 * @example
 * installSetFor(parsed, [{ kind: 'build', … }]); // → runLibs(parsed), unwidened
 */
function installSetFor(parsed: ParsedLeetCode, checks: ProjectCheck[]): string[] {
	const libs = runLibs(parsed);
	const needsRender = checks.some(c => c.kind === 'dom-assert' || c.kind === 'css-assert');
	return needsRender ? renderLibsFor(libs) : libs;
}

/**
 * Union of every `libs:` entry the installer can actually serve, deduped.
 *
 * Not restricted to the *render-capable* languages — a `build`-check project
 * declaring `libs.typescript` must install its own libraries, and scoping this
 * to the render set was the bug that made a render check install a superset
 * under a second cache key. But it **is** restricted to the languages the npm
 * registry serves ({@link ecosystemFor} `=== 'npm'`), because `installLibs`
 * shells out to pnpm and there is no second installer yet: unioning
 * `libs.python: [requests]` in would install the unrelated npm package of that
 * name rather than the PyPI one, and the name-shape allowlist cannot tell them
 * apart. The parser warns about the skipped language at authoring time, so
 * nothing is silent.
 *
 * Order does not matter: `libCacheDir` sorts before hashing.
 *
 * @param parsed - The artifact, for `libs:`.
 * @returns Deduped npm-installable specs; `[]` when none are declared.
 *
 * @example
 * runLibs({ libs: { typescript: ['react@^19.0.0'], python: ['requests@^2.0.0'] } });
 * // → ['react@^19.0.0']   — python is npm's to serve, so it is skipped
 */
function runLibs(parsed: ParsedLeetCode): string[] {
	const libs = parsed.libs ?? {};
	const servable = Object.entries(libs)
		.filter(([language]) => ecosystemFor(language) === 'npm')
		.flatMap(([, specs]) => specs);
	return [...new Set(servable)];
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
 * @param check   - The check to run.
 * @param parsed  - The artifact, for `params` / `returns` / `libs`.
 * @param runDir  - Run directory holding the materialised tree and its linked `node_modules`.
 * @param cacheDir - Resolved install cache for this run, when one was installed.
 * @returns The check's verdict.
 */
async function runOneCheck(
	check: ProjectCheck, parsed: ParsedLeetCode, runDir: string, cacheDir?: string,
): Promise<ProjectCheckOutcome> {
	switch (check.kind) {
		case 'build':
			return runBuildCheck(check, runDir);
		case 'dom-assert':
		case 'css-assert':
			return runRenderCheck(check, runDir, undefined, cacheDir);
		case 'function':
			return runFunctionCheck(check, parsed, runDir);
	}
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
 * Grade a `function` check by running the declared export through the existing
 * `function` environment for its language.
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
	const env = testEnvFor('function', langId);
	if (!env) {
		return { name: check.name, passed: false, detail: `no function environment for '${langId}'` };
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
