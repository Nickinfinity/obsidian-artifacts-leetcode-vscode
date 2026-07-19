import type { ParsedLeetCode } from '../../types/leetcode.types.js';

/**
 * TypeScript wrapper — **stub**.
 *
 * Returns `''`, the exact pre-widening fallback for a language that was not a
 * `LangId`. The real template (JavaScript's shape plus `mapType` signatures)
 * lands in T3; keeping the fallback here is what makes the registry widening
 * behaviour-preserving by construction.
 *
 * @param _p - Parsed LeetCode artifact (unused until the real template lands).
 * @returns The empty string.
 *
 * @example
 * tsBoilerplate(parsed); // → ''
 */
export function tsBoilerplate(_p: ParsedLeetCode): string {
	return '';
}

/**
 * TypeScript assert harness — **stub**. See {@link tsBoilerplate} for why this
 * returns the pre-widening fallback rather than throwing.
 *
 * @param _p - Parsed LeetCode artifact (unused until the real template lands).
 * @returns The empty string.
 *
 * @example
 * tsHarness(parsed); // → ''
 */
export function tsHarness(_p: ParsedLeetCode): string {
	return '';
}
