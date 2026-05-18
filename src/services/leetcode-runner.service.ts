import { exec, type ExecException } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
	LangRunner,
	ParsedLeetCode,
	TestCase,
	TestResult,
} from '../types/leetcode.types.js';

/** Hard cap on a single test-case run before the child is killed. */
const TIMEOUT_MS = 5_000;

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
 * @param cmd - Shell command line.
 * @param timeoutMs - Optional kill timeout in milliseconds.
 * @returns Promise resolving to captured stdio.
 *
 * @example
 * await execAsync('echo hi');
 */
function execAsync(cmd: string, timeoutMs?: number): Promise<ExecResult> {
	return new Promise<ExecResult>((resolve, reject) => {
		exec(cmd, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
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
 * Probe whether the language toolchain backing `runner` is installed.
 *
 * Runs `runner.detectCmd` and returns true on exit 0, false on any failure.
 *
 * @param runner - Language runner config to probe.
 * @returns True if the runtime is callable, false otherwise.
 *
 * @example
 * await detectRuntime(jsRunner); // → true on machines with `node` on PATH.
 */
export async function detectRuntime(runner: LangRunner): Promise<boolean> {
	try {
		await execAsync(runner.detectCmd);
		return true;
	} catch {
		return false;
	}
}

/**
 * Build a self-contained source file that runs the candidate solution against
 * a single test case and prints the JSON-serialised result to stdout.
 *
 * The boilerplate variant emitted by `generateBoilerplate` reads inputs from
 * stdin, which is hard to wire up generically here; we instead generate a
 * direct call with hard-coded literal arguments so stdout cleanly reports the
 * function's return value.
 *
 * @param code     - User solution body (the contents of the candidate function).
 * @param testCase - One test case providing inputs and the expected value.
 * @param runner   - Language runner — its `id` selects the source template.
 * @param parsed   - Parsed artifact for function name and parameter order.
 * @returns Complete source text ready to write to disk and execute.
 *
 * @example
 * buildSingleTestSource('return a + b;', { input:{a:1,b:2}, expected:3 }, jsRunner, parsed);
 */
function buildSingleTestSource(
	code: string, testCase: TestCase, runner: LangRunner, parsed: ParsedLeetCode,
): string {
	const args = parsed.params.map(p => JSON.stringify(testCase.input[p.name])).join(', ');
	const params = parsed.params.map(p => p.name).join(', ');

	if (runner.id === 'python') {
		const indented = code.split('\n').map(l => `    ${l}`).join('\n');
		return [
			`def ${parsed.functionName}(${params}):`,
			indented,
			'',
			'import json, sys',
			'try:',
			`    __r = ${parsed.functionName}(${args})`,
			'    sys.stdout.write(json.dumps(__r))',
			'except Exception as e:',
			'    sys.stderr.write(str(e))',
			'    sys.exit(1)',
			'',
		].join('\n');
	}

	// Default to a JS-like template — covers the built-in jsRunner and any
	// runner that mimics it for test purposes.
	return [
		`function ${parsed.functionName}(${params}) {`,
		`  ${code}`,
		'}',
		'',
		'try {',
		`  const __r = ${parsed.functionName}(${args});`,
		'  process.stdout.write(JSON.stringify(__r));',
		'} catch (e) {',
		'  process.stderr.write(String(e && e.message ? e.message : e));',
		'  process.exit(1);',
		'}',
		'',
	].join('\n');
}

/** Build a baseline `TestResult` skeleton tied to a specific test case + index. */
function baseResult(index: number, testCase: TestCase): TestResult {
	return {
		index,
		passed:   false,
		input:    testCase.input,
		expected: testCase.expected,
		actual:   '',
		duration: 0,
	};
}

/** Try to compile a temp file; returns `null` on success, the failure message otherwise. */
async function tryCompile(runner: LangRunner, filePath: string): Promise<string | null> {
	if (!runner.compile) { return null; }
	try {
		await execAsync(runner.compile(filePath));
		return null;
	} catch (e) {
		const err = e as ExecErr;
		const detail = (err.stderr ?? err.message ?? String(err)).trim();
		return `compilation error: ${detail || 'unknown failure'}`;
	}
}

/**
 * Run a single test case against a candidate solution using `runner`.
 *
 * Writes a self-contained source file in a fresh temp directory, optionally
 * compiles it (`runner.compile`), then executes via `runner.run` and compares
 * the trimmed stdout against `JSON.stringify(testCase.expected)`. Timeouts and
 * non-zero exit codes produce a populated `error` field on the result.
 *
 * @param code     - User solution body.
 * @param testCase - Test case to execute.
 * @param runner   - Language runner config.
 * @param parsed   - Parsed artifact (function name, params).
 * @returns Populated `TestResult` — its `passed` flag is authoritative.
 *
 * @example
 * await runSingleTest('return a + b;', { input:{a:1,b:2}, expected:3 }, jsRunner, parsed);
 */
export async function runSingleTest(
	code: string, testCase: TestCase, runner: LangRunner, parsed: ParsedLeetCode,
): Promise<TestResult> {
	const result = baseResult(0, testCase);
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leet-'));
	const fileName = runner.fileName ?? `sol${runner.fileExtension}`;
	const filePath = path.join(tmpDir, fileName);
	const source   = buildSingleTestSource(code, testCase, runner, parsed);

	const t0 = Date.now();
	try {
		await fs.writeFile(filePath, source, 'utf-8');

		const compileErr = await tryCompile(runner, filePath);
		if (compileErr !== null) {
			result.error    = compileErr;
			result.duration = Date.now() - t0;
			return result;
		}

		try {
			const { stdout } = await execAsync(runner.run(filePath), TIMEOUT_MS);
			result.actual   = stdout.trim();
			result.duration = Date.now() - t0;
			result.passed   = result.actual === JSON.stringify(testCase.expected);
		} catch (e) {
			const err = e as ExecErr;
			result.duration = Date.now() - t0;
			if (err.killed || err.signal === 'SIGTERM') {
				result.error = 'timeout';
			} else {
				result.error = (err.stderr || err.message || String(err)).trim();
			}
		}
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* ignore cleanup errors */ });
	}
	return result;
}

/**
 * Run every test case in `tests` against the candidate solution.
 *
 * Each case is executed via `runSingleTest`. An individual failure does NOT
 * stop the run — the user sees per-case results. A compilation failure on the
 * first case short-circuits the remaining cases (each gets the same
 * `compilation error: …` payload) since recompiling cannot fix the broken
 * source without user intervention.
 *
 * @param code   - User solution body.
 * @param tests  - Test cases to execute in order.
 * @param runner - Language runner config.
 * @param parsed - Parsed artifact.
 * @returns One `TestResult` per case, in the input order.
 *
 * @example
 * await runAllTests('return a + b;', tests, jsRunner, parsed);
 */
export async function runAllTests(
	code: string, tests: TestCase[], runner: LangRunner, parsed: ParsedLeetCode,
): Promise<TestResult[]> {
	const results: TestResult[] = [];
	for (let i = 0; i < tests.length; i++) {
		const r = await runSingleTest(code, tests[i], runner, parsed);
		r.index = i;
		results.push(r);

		// Compile errors mean every remaining case will fail with the same
		// payload — copy the error onto stub results so the UI shows them
		// without re-running the same broken source.
		const isCompileErr = r.error?.toLowerCase().includes('compil');
		if (isCompileErr) {
			for (let j = i + 1; j < tests.length; j++) {
				const stub = baseResult(j, tests[j]);
				stub.error = r.error;
				results.push(stub);
			}
			break;
		}
	}
	return results;
}
