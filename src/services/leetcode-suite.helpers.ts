import type { ParsedLeetCode, TestCase, TestResult } from '../types/leetcode.types.js';

/**
 * The cases Run Tests executes: the visible `## Tests` list.
 *
 * @param parsed - Parsed artifact.
 * @returns The public suite, in order.
 *
 * @example
 * publicSuite(parsed).length; // → 2
 */
export function publicSuite(parsed: ParsedLeetCode): TestCase[] {
	return parsed.tests;
}

/**
 * The cases Submit grades: public followed by final.
 *
 * **The legacy fallback lives here and only here.** An artifact written before
 * `## Final Tests` existed has `finalTests: []`, and grading it must run the
 * public list exactly once — concatenating unconditionally would double every
 * case and report `4 / 4` for a two-case problem.
 *
 * @param parsed - Parsed artifact.
 * @returns Public cases, then final cases; never doubled.
 *
 * @example
 * submitSuite({ ...parsed, tests: [a, b], finalTests: [] });      // → [a, b]
 * submitSuite({ ...parsed, tests: [a, b], finalTests: [c] });     // → [a, b, c]
 */
export function submitSuite(parsed: ParsedLeetCode): TestCase[] {
	if (parsed.finalTests.length === 0) { return [...parsed.tests]; }
	return [...parsed.tests, ...parsed.finalTests];
}

/**
 * Size of the public suite — the boundary index between public and final
 * results after `submitSuite`.
 *
 * @param parsed - Parsed artifact.
 * @returns Count of visible cases.
 *
 * @example
 * publicCount(parsed); // → 2
 */
export function publicCount(parsed: ParsedLeetCode): number {
	return parsed.tests.length;
}

/**
 * Whether the artifact carries a hidden grading suite.
 *
 * Drives the panel's counts line: `2 public · 5 final` versus a plain `2 tests`.
 *
 * @param parsed - Parsed artifact.
 * @returns True when `## Final Tests` was present and non-empty.
 *
 * @example
 * hasFinalTests(parsed); // → true
 */
export function hasFinalTests(parsed: ParsedLeetCode): boolean {
	return parsed.finalTests.length > 0;
}

/**
 * Stamp each result with the suite it came from.
 *
 * The runner is deliberately suite-blind — it sees one flat array of cases — so
 * the public/final split is reapplied here, by position. Results at
 * `index >= publicCount` came from the grading suite and have their inputs
 * masked in the UI.
 *
 * @param results     - Results from `runSuite`, in submitted order.
 * @param publicCount - Number of leading cases that were public.
 * @returns The same results, each carrying a `kind`.
 *
 * @example
 * tagSuiteKinds(results, 2).map(r => r.kind); // → ['public', 'public', 'final']
 */
export function tagSuiteKinds(results: TestResult[], publicCount: number): TestResult[] {
	return results.map(r => ({
		...r,
		kind: r.index < publicCount ? 'public' as const : 'final' as const,
	}));
}
