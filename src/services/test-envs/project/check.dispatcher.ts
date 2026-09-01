import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
	FunctionCheck,
	HttpCheck,
	ParsedLeetCode,
	ProjectCheck,
	ProjectCheckOutcome,
} from '../../../types/leetcode.types.js';
import { canonicalJson } from '../../../utils/canonical-json.js';
import { resolveLangId } from '../../language-map.service.js';
import type { LibEcosystem } from '../../libs/lib-ecosystem.js';
import { runSuite } from '../../leetcode-runner.service.js';
import { isBatchEnv, testEnvFor } from '../env.registry.js';
import { runBuildCheck } from './build.check.js';
import { runHttpCases, runHttpCheck } from '../http/http.check.js';
import type { BootedGroupRegistry } from '../http/server.lifecycle.js';
import type { StackBoot } from '../stack/stack.runner.js';
import { runRenderCheck } from './checks.js';
import { resolveContained } from './files.writer.js';

/**
 * Check dispatch: given an already-installed, already-linked run directory
 * (`gradeProjectDir`'s job) and one declared check, run the machinery for its
 * `kind` and return a verdict. Split out of `project.runner.ts` (T4.3 round 2,
 * VSX-180) once that file crossed the repo's ~500-line split mark — this is
 * the "grade one check" concern, `project.runner.ts` keeps "materialise a
 * tree and install/link/boot everything every check needs".
 */

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
 *   `package` artifact still does. A render check (T4.3 round 2) reads the
 *   same boot to find the one loopback port its component may fetch from.
 * @returns The check's verdict.
 */
export async function runOneCheck(
	check: ProjectCheck, parsed: ParsedLeetCode, runDir: string,
	dirs: ReadonlyMap<LibEcosystem, string>, registry?: BootedGroupRegistry, stackBoot?: StackBoot,
): Promise<ProjectCheckOutcome> {
	switch (check.kind) {
		case 'build':
			return runBuildCheck(check, runDir, dirs);
		case 'dom-assert':
		case 'css-assert': {
			const resolved = apiPortForRenderCheck(check, stackBoot);
			if (!resolved.ok) { return { name: check.name, passed: false, detail: resolved.detail }; }
			return runRenderCheck(check, runDir, undefined, dirs.get('pnpm'), resolved.port);
		}
		case 'http':
			return stackBoot
				? runStackHttpCheck(check, stackBoot, parsed.test.timeoutMs)
				: runPackageHttpCheck(check, parsed, runDir, dirs, registry);
		case 'call':
			// Nothing is threaded in: a call check runs through `runSuite`,
			// which resolves its own library environment from `parsed.libs`.
			// A second resolver here would install the same set twice.
			return runFunctionCheck(check, parsed, runDir);
	}
}

/**
 * Resolve the one loopback port a `dom-assert`/`css-assert` component may
 * fetch from (T4.3 round 2, VSX-180), or refuse the check when that is
 * ambiguous.
 *
 * **No booted package** (`stackBoot` absent — a `package` artifact, or a
 * `stack` that declares none — or a `stack` that booted nothing) →
 * `{ ok: true }` with no `port`: unchanged from before this task, the render
 * driver's `installFetch` then refuses every request by default.
 *
 * **Exactly one booted package** → `{ ok: true, port }`: the S1 worked
 * example (one backend, one frontend) and the case that must work. A failed
 * package (`ok: false` in `stackBoot.outcomes`) does not count as booted —
 * there is no port to hand the component.
 *
 * **More than one booted package** → refused by name. A render check has no
 * field naming which package its component talks to (`HttpCheck` has
 * `package:`; `DomAssertCheck`/`CssAssertCheck` do not), so guessing would
 * silently point a component at the wrong server and grade whatever came
 * back. Adding that field is a format change for the task that ships the
 * first multi-backend render artifact, not this one.
 *
 * @param check     - The render check being dispatched, for its name in the refusal.
 * @param stackBoot - `gradeProjectDir`'s whole-group boot, when this run has one.
 * @returns The port to inject, or the reason the check cannot be graded.
 *
 * @example
 * apiPortForRenderCheck(check, oneBackendStack); // → { ok: true, port: 54321 }
 * apiPortForRenderCheck(check, twoBackendStack); // → { ok: false, detail: '…' }
 */
export function apiPortForRenderCheck(
	check: { kind: 'dom-assert' | 'css-assert'; name: string }, stackBoot: StackBoot | undefined,
): { ok: true; port?: number } | { ok: false; detail: string } {
	if (!stackBoot) { return { ok: true }; }

	const booted = [...stackBoot.outcomes.values()].filter(isBootedOutcome);
	if (booted.length === 0) { return { ok: true }; }
	if (booted.length === 1) { return { ok: true, port: booted[0].port }; }

	return {
		ok: false,
		detail: `${check.kind} '${check.name}' cannot be graded — this stack boots ${booted.length} packages `
			+ 'and a render check has no way to name which one its component talks to; declaring that binding '
			+ 'is its own future task',
	};
}

/** Narrows a `StackBoot` outcome to the booted branch, so `.port` is available without a cast. */
function isBootedOutcome(outcome: { ok: boolean }): outcome is { ok: true; port: number; pid: number } {
	return outcome.ok;
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
 * **Libraries reach the boot (T4.7, VSX-227) through the same `dirs` map
 * `gradeProjectDir` already resolved before any check ran** — forwarded here
 * as `bootOpts.libDirs`, which `bootServer` consumes through `libExecEnv`
 * exactly as a `build` check's own `PATH`/env composition already did. A
 * single-package `package` with an `http` check and `libs: python: [flask]`
 * used to fail naming the missing import; it no longer does. The npm case
 * (`node_modules` via `linkModules`) and this one now share one seam.
 *
 * @param check    - The `http` check.
 * @param parsed   - The artifact, for `packages:` and the per-case budget.
 * @param runDir   - Run directory holding the materialised tree.
 * @param dirs     - Resolved library cache per ecosystem for this run.
 * @param registry - The session's booted-group registry, when there is a session.
 * @returns The check's verdict.
 *
 * @example
 * await runPackageHttpCheck(check, parsed, '/tmp/run', dirs, session.bootedGroups);
 */
async function runPackageHttpCheck(
	check: HttpCheck, parsed: ParsedLeetCode, runDir: string,
	dirs: ReadonlyMap<LibEcosystem, string>, registry?: BootedGroupRegistry,
): Promise<ProjectCheckOutcome> {
	const pkg = (parsed.packages ?? []).find(p => p.name === check.package);
	if (!pkg) {
		return {
			name: check.name, passed: false,
			detail: `http check names package '${check.package}', which this artifact does not declare`,
		};
	}
	return runHttpCheck(
		{ name: check.name, cases: check.cases }, pkg, runDir, parsed.test.timeoutMs, { registry, libDirs: dirs },
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
