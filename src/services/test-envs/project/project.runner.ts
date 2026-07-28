import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
	FunctionCheck,
	ParsedLeetCode,
	ProjectCheck,
	ProjectCheckOutcome,
} from '../../../types/leetcode.types.js';
import { canonicalJson } from '../../../utils/canonical-json.js';
import { resolveLangId } from '../../language-map.service.js';
import { runSuite } from '../../leetcode-runner.service.js';
import { testEnvFor } from '../env.registry.js';
import { runBuildCheck } from './build.check.js';
import { runRenderCheck } from './checks.js';
import { resolveContained, writeProjectFiles } from './files.writer.js';

/** Languages the render checks can bundle — the ids the `project` env registers under. */
const RENDER_LANGUAGES = ['javascript', 'typescript'];

/**
 * Grade every declared check of a `project` artifact.
 *
 * Materialises the `## Files` tree into a fresh temp directory, runs each check
 * in it, and returns one outcome per check — **solved is every check green**.
 * The run directory is always removed, including when a check throws.
 *
 * The tree is written once and shared by every check: a `build` check compiling
 * what a `dom-assert` then mounts is the point of a multi-file exercise.
 *
 * @param parsed - Parsed `project` artifact.
 * @returns One outcome per declared check, in declaration order.
 *
 * @example
 * await runProjectChecks(parsed); // → [{ name: 'alternates', passed: true }]
 */
export async function runProjectChecks(parsed: ParsedLeetCode): Promise<ProjectCheckOutcome[]> {
	const checks = parsed.checks ?? [];
	if (checks.length === 0) { return []; }

	const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leet-project-'));
	try {
		await writeProjectFiles(runDir, parsed.files ?? []);

		const outcomes: ProjectCheckOutcome[] = [];
		for (const check of checks) {
			outcomes.push(await runOneCheck(check, parsed, runDir));
		}
		return outcomes;
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
 * Dispatch one check to the machinery for its kind.
 *
 * ponytail: a `build` check runs in the run directory, which has **no**
 * `node_modules` — the artifact's `libs:` install into the shared cache, and
 * only the render driver resolves from there. A build that shells out to a
 * project's own toolchain (`npx tsc`, `npm run build`) therefore fails until
 * the cache is linked into the run directory. Add that link when an exercise
 * needs a real build; the React exercises this was written for grade entirely
 * through `dom-assert`.
 */
async function runOneCheck(
	check: ProjectCheck, parsed: ParsedLeetCode, runDir: string,
): Promise<ProjectCheckOutcome> {
	switch (check.kind) {
		case 'build':
			return runBuildCheck(check, runDir);
		case 'dom-assert':
		case 'css-assert':
			return runRenderCheck(check, runDir, renderLibs(parsed));
		case 'function':
			return runFunctionCheck(check, parsed, runDir);
	}
}

/** The artifact's declared libs for the languages a render check can bundle. */
function renderLibs(parsed: ParsedLeetCode): string[] {
	const libs = parsed.libs ?? {};
	return RENDER_LANGUAGES.flatMap(language => libs[language] ?? []);
}

/**
 * Grade a `function` check by running the declared export through the existing
 * `function` environment for its language.
 *
 * There is no second execution path: the check's file becomes the candidate and
 * the artifact's own `params` / `returns` type it, which is exactly why a
 * project may declare **at most one** function check (HG-B decision 2).
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
