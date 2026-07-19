import type { ParsedLeetCode } from '../../types/leetcode.types.js';

/**
 * Rust wrapper — **stub**.
 *
 * Returns `''`, which is exactly what `generateBoilerplate` returned for `rust`
 * before it became a `LangId`: the language is type-mappable and now registry-
 * resolvable, but its templates land in T4. Preserving the pre-widening fallback
 * by construction is what keeps the tree compiling and behaviour-identical
 * between the widening and the real implementation.
 *
 * @param _p - Parsed LeetCode artifact (unused until the real template lands).
 * @returns The empty string.
 *
 * @example
 * rustBoilerplate(parsed); // → ''
 */
export function rustBoilerplate(_p: ParsedLeetCode): string {
	return '';
}

/**
 * Rust assert harness — **stub**. See {@link rustBoilerplate} for why this
 * returns the pre-widening fallback rather than throwing.
 *
 * @param _p - Parsed LeetCode artifact (unused until the real template lands).
 * @returns The empty string.
 *
 * @example
 * rustHarness(parsed); // → ''
 */
export function rustHarness(_p: ParsedLeetCode): string {
	return '';
}
