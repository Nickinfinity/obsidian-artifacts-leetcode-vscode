import { exec, type ExecException } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { MAX_SUITE_TIMEOUT_MS } from '../types/constants.js';
import type {
	ParsedLeetCode,
	TestCase,
	TestResult,
} from '../types/leetcode.types.js';
import type { EnvContext, TestEnv } from './test-envs/env.types.js';
import { ensureLibEnv, type LibEnvResult } from './libs/lib-cache.service.js';
import { ecosystemFor, type LibEcosystem } from './libs/lib-ecosystem.js';
import { collectResults, errorResult, type RunFailure } from './leetcode-runner.helpers.js';

interface ExecResult { stdout: string; stderr: string }
class ExecErr extends Error {
	stdout?: string;
	stderr?: string;
	killed?: boolean;
	signal?: NodeJS.Signals | null;
	code?: number | string;
	constructor(src: ExecException) {
		super(src.message);
		this.name   = 'ExecErr';
		this.killed = src.killed;
		this.signal = src.signal;
		this.code   = src.code;
	}
}

/**
 * Promise wrapper around `child_process.exec`.
 *
 * Resolves with `{stdout, stderr}` on success. On any non-zero exit the
 * callback's error is rejected with `stdout` / `stderr` glued on for the caller
 * to inspect. The `killed` / `signal` fields on the error distinguish a
 * timeout-kill from a normal failure.
 *
 * @param cmd  - Shell command line.
 * @param opts - Optional working directory, kill timeout and child environment.
 *   `env` is passed through as-is: callers merge over `process.env` themselves,
 *   because `exec` **replaces** the environment rather than extending it.
 * @returns Promise resolving to captured stdio.
 *
 * @example
 * await execAsync('node runner.js', { cwd: '/tmp/leet-x', timeoutMs: 5000 });
 */
function execAsync(
	cmd: string, opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ExecResult> {
	return new Promise<ExecResult>((resolve, reject) => {
		const options = { cwd: opts.cwd, timeout: opts.timeoutMs, env: opts.env, maxBuffer: 1024 * 1024 };
		exec(cmd, options, (err, stdout, stderr) => {
			if (err) {
				const e = new ExecErr(err);
				e.stdout = stdout;
				e.stderr = stderr;
				reject(e);
				return;
			}
			resolve({ stdout, stderr });
		});
	});
}

/**
 * Probe whether a language toolchain is installed by running its detect command.
 *
 * Runs `detectCmd` and returns true on exit 0, false on any failure.
 *
 * @param detectCmd - Version probe, e.g. `'node --version'` (from `LANGUAGES`).
 * @returns True if the runtime is callable, false otherwise.
 *
 * @example
 * await detectRuntime('node --version'); // → true on machines with `node` on PATH.
 */
export async function detectRuntime(detectCmd: string): Promise<boolean> {
	try {
		await execAsync(detectCmd);
		return true;
	} catch {
		return false;
	}
}

/**
 * Wall-clock budget for a whole suite: `cases × per-case`, capped.
 *
 * @param caseCount - Number of cases in the suite.
 * @param perCaseMs - Per-case budget from `parsed.test.timeoutMs`.
 * @returns Milliseconds before the child is killed.
 *
 * @example
 * suiteTimeout(3, 5000); // → 15000
 * suiteTimeout(100, 5000); // → 60000 (capped)
 */
export function suiteTimeout(caseCount: number, perCaseMs: number): number {
	return Math.min(Math.max(caseCount, 1) * perCaseMs, MAX_SUITE_TIMEOUT_MS);
}

export interface RunSuiteOptions {
	/**
	 * Resolve a library environment. Defaults to `ensureLibEnv`; tests inject a
	 * stub so a suite never installs anything.
	 */
	resolveLibEnv?: (ecosystem: LibEcosystem, specs: readonly string[]) => Promise<LibEnvResult>;
}

/**
 * Run an entire suite in one temp directory and map its output to per-case
 * results.
 *
 * The env decides everything language-specific: it validates the candidate,
 * emits the candidate **verbatim** alongside a generated driver, and supplies
 * the compile/run commands. This function only orchestrates — make a temp dir,
 * write the files, compile, run, parse — so it never learns Java from Python.
 *
 * Failure modes, all producing a full-length result array:
 *
 * - **Library resolution** — a declared `libs:` set that cannot be installed
 *   fails every case with the installer's reason, and nothing is emitted.
 * - **Contract violation** — `env.validate` returns a message; every case
 *   carries it, and nothing is compiled or run.
 * - **Compile error** — every case carries the same `compilation error: …`.
 * - **Suite timeout** — the child is killed, but `exec` returns the stdout it
 *   already produced, so every case that printed is recovered and every case
 *   from the first missing index onward is marked `timeout`.
 * - **Crash / non-zero exit** — cases that printed are kept; the rest carry the
 *   process's stderr.
 *
 * @param code   - Candidate source, already resolved by `buildExecutable`.
 * @param tests  - The suite to run, in order.
 * @param parsed - Parsed artifact — supplies `test.timeoutMs` and the signature.
 * @param env    - Test environment that validates, emits, and parses.
 * @param options - Injectable library resolver, for tests.
 * @returns One `TestResult` per case, in the input order.
 *
 * @example
 * await runSuite(code, parsed.tests, parsed, javascriptFunctionEnv);
 */
export async function runSuite(
	code: string, tests: TestCase[], parsed: ParsedLeetCode, env: TestEnv,
	options: RunSuiteOptions = {},
): Promise<TestResult[]> {
	if (tests.length === 0) { return []; }

	const resolved = await resolveLibDir(parsed, env.language, options);
	if (!resolved.ok) { return tests.map((t, i) => errorResult(i, t, resolved.reason)); }

	const ctx: EnvContext = {
		parsed, langId: env.language, code, cases: tests,
		...(resolved.dir === undefined ? {} : { libDir: resolved.dir }),
	};

	const invalid = env.validate?.(ctx);
	if (invalid) { return tests.map((t, i) => errorResult(i, t, invalid)); }

	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leet-'));
	try {
		const program = env.emit(ctx);
		// Names come from the env, never from artifact content — a Cargo project
		// needs `src/`, so a nested basename is written into a created parent
		// rather than failing with ENOENT.
		await Promise.all(program.files.map(async f => {
			const target = path.join(tmpDir, f.name);
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, f.content, 'utf-8');
		}));

		const childEnv = childEnvironment(program.env, program.pathPrepend);
		if (program.compile) {
			const compileErr = await tryCompile(program.compile, tmpDir, childEnv);
			if (compileErr !== null) { return tests.map((t, i) => errorResult(i, t, compileErr)); }
		}

		const { stdout, failure } = await runProgram(
			program.run, tmpDir, tests.length, parsed.test.timeoutMs, childEnv,
		);
		return collectResults(tests, env.parse(stdout), failure);
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* ignore cleanup errors */ });
	}
}

// ── Internals ─────────────────────────────────────────────────────────────────

/**
 * Resolve the library environment this run needs, if it declares one.
 *
 * `runSuite` is the **only** resolver: a project's `function` check reaches
 * libraries through this same call, so there is no second seam to keep in
 * step. A language that declares nothing resolves nothing — and pays nothing.
 *
 * @param parsed  - The artifact, for `libs:`.
 * @param langId  - Language the suite is running in.
 * @param options - Injectable resolver, for tests.
 * @returns The cache directory, `undefined` when none is needed, or a refusal.
 */
async function resolveLibDir(
	parsed: ParsedLeetCode, langId: string, options: RunSuiteOptions,
): Promise<{ ok: true; dir?: string } | { ok: false; reason: string }> {
	const specs = parsed.libs?.[langId] ?? [];
	if (specs.length === 0) { return { ok: true }; }

	const ecosystem = ecosystemFor(langId);
	if (!ecosystem) { return { ok: false, reason: `no package registry serves '${langId}' libraries` }; }

	const resolve = options.resolveLibEnv ?? ensureLibEnv;
	const result = await resolve(ecosystem, specs);
	return result.ok ? { ok: true, dir: result.dir } : { ok: false, reason: result.reason };
}

/**
 * The environment the compile and run children see.
 *
 * `exec` **replaces** the child environment rather than extending it, so the
 * merge happens here — and `undefined` when nothing was asked for, which keeps
 * the no-libs path passing no `env` option at all.
 *
 * @param extra       - Variables the env emitted.
 * @param pathPrepend - Directory to put ahead of the inherited `PATH`.
 * @returns The merged environment, or `undefined` to inherit unchanged.
 *
 * @example
 * childEnvironment({ NODE_PATH: '/cache/node_modules' }, undefined);
 */
function childEnvironment(
	extra?: Record<string, string>, pathPrepend?: string,
): NodeJS.ProcessEnv | undefined {
	if (!extra && pathPrepend === undefined) { return undefined; }

	const merged: NodeJS.ProcessEnv = { ...process.env, ...extra };
	if (pathPrepend !== undefined) {
		// `?? ''` for the same reason the build check has it: an unset PATH must
		// not serialise the string "undefined" into the child's environment.
		merged.PATH = `${pathPrepend}${path.delimiter}${process.env.PATH ?? ''}`;
	}
	return merged;
}

/** Run the build command; returns `null` on success, the failure message otherwise. */
async function tryCompile(
	command: string, cwd: string, env?: NodeJS.ProcessEnv,
): Promise<string | null> {
	try {
		await execAsync(command, { cwd, env });
		return null;
	} catch (e) {
		const err = e as ExecErr;
		const detail = (err.stderr ?? err.message ?? String(err)).trim();
		return `compilation error: ${detail || 'unknown failure'}`;
	}
}

/**
 * Execute the program's run command, capturing stdout even on failure.
 *
 * @param command   - Run command, executed with `cwd` as its working directory.
 * @param cwd       - Temp directory holding the emitted files.
 * @param caseCount - Suite size, used to size the timeout.
 * @param perCaseMs - Per-case budget.
 * @param env       - Child environment, already merged over `process.env`.
 * @returns Whatever stdout was produced, plus how the process ended.
 *
 * @example
 * await runProgram('node runner.js', '/tmp/leet-x', 3, 5000);
 */
async function runProgram(
	command: string, cwd: string, caseCount: number, perCaseMs: number, env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; failure: RunFailure | null }> {
	try {
		const { stdout } = await execAsync(
			command, { cwd, env, timeoutMs: suiteTimeout(caseCount, perCaseMs) },
		);
		return { stdout, failure: null };
	} catch (e) {
		const err = e as ExecErr;
		const timedOut = Boolean(err.killed) || err.signal === 'SIGTERM';
		const message  = timedOut ? 'timeout' : (err.stderr || err.message || String(err)).trim();
		return { stdout: err.stdout ?? '', failure: { timedOut, message } };
	}
}
