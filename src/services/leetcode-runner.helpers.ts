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
