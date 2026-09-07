import type { TestCase, TestResult } from '../types/leetcode.types.js';
import { canonicalJson } from '../utils/canonical-json.js';
import type { CaseOutcome } from './test-envs/env.types.js';

/** How the child process ended, when it did not end cleanly. */
export interface RunFailure {
	/** True when the child was killed by the suite-timeout budget. */
	timedOut: boolean;
	/** `'timeout'` on a kill, else the process's stderr / error message. */
	message: string;
}

/**
 * Join the suite's cases against whatever outcomes the program managed to print.
 *
 * A case with no outcome inherits the run failure — `timeout` when the child was
 * killed, the process's stderr otherwise. Cases that printed before a kill keep
 * their real results. Pure: no I/O, so it is unit-testable without a subprocess.
 *
 * @param tests    - The suite, in order.
 * @param outcomes - Parsed sentinel lines, possibly fewer than `tests.length`.
 * @param failure  - How the process ended, or `null` when it exited cleanly.
 * @returns One result per case.
 *
 * @example
 * collectResults(tests, [{ index: 0, actual: '1', ms: 2 }], { timedOut: true, message: 'timeout' });
 */
export function collectResults(
	tests: TestCase[], outcomes: CaseOutcome[], failure: RunFailure | null,
): TestResult[] {
	const byIndex = new Map<number, CaseOutcome>();
	for (const o of outcomes) { byIndex.set(o.index, o); }

	return tests.map((testCase, i) => {
		const outcome = byIndex.get(i);
		if (!outcome) {
			const message = failure ? failure.message : 'no output';
			return errorResult(i, testCase, message);
		}
		if (outcome.error !== undefined) {
			const result = errorResult(i, testCase, outcome.error);
			result.duration = outcome.ms;
			return result;
		}
		const actual = outcome.actual ?? '';
		return {
			index:    i,
			passed:   actual === canonicalJson(testCase.expected),
			input:    testCase.input,
			expected: testCase.expected,
			actual,
			duration: outcome.ms,
		};
	});
}

/**
 * Build a failed `TestResult` carrying `message` as its error.
 *
 * @param index    - Zero-based case index.
 * @param testCase - The case whose input/expected are echoed back.
 * @param message  - User-facing failure message.
 * @returns A failed result with an empty `actual` and zero duration.
 *
 * @example
 * errorResult(0, { input: { x: 1 }, expected: 2 }, 'timeout');
 */
export function errorResult(index: number, testCase: TestCase, message: string): TestResult {
	return {
		index,
		passed:   false,
		input:    testCase.input,
		expected: testCase.expected,
		actual:   '',
		duration: 0,
		error:    message,
	};
}

/**
 * Whether a child died because its budget ran out, rather than failing on its
 * own terms.
 *
 * `exec` reports a timeout kill as `killed` — but a child that ignores
 * `SIGTERM` and is force-killed can arrive with only the signal set, so both
 * are checked.
 *
 * @param error - The rejected `exec` error.
 * @returns `true` when the process was killed rather than exiting.
 *
 * @example
 * timedOut({ killed: true }); // → true
 */
export function timedOut(error: { killed?: boolean; signal?: NodeJS.Signals | null }): boolean {
	return Boolean(error.killed) || error.signal === 'SIGTERM';
}

/**
 * The message every case carries when the build step fails.
 *
 * A timeout is called one: killed children usually produce **no** stderr, so
 * the generic path would report `compilation error: unknown failure` and send
 * a solver hunting for a syntax mistake that is not there.
 *
 * @param error - The rejected `exec` error.
 * @returns One user-facing sentence.
 *
 * @example
 * compileFailure({ killed: true });                 // → 'compilation timed out'
 * compileFailure({ stderr: 'error: expected `;`' }); // → 'compilation error: error: expected `;`'
 */
export function compileFailure(
	error: { killed?: boolean; signal?: NodeJS.Signals | null; stderr?: string; message?: string },
): string {
	if (timedOut(error)) { return 'compilation timed out'; }
	const detail = (error.stderr ?? error.message ?? '').trim();
	return `compilation error: ${detail || 'unknown failure'}`;
}
