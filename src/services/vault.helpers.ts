import { LEETCODE_DIR } from '../types/constants.js';

/**
 * Resolves the vault-relative directory exercises live in.
 *
 * The single authority for "where do exercises live" — `refreshVaultContext`
 * and the exercise picker both resolve through the thin `getExercisesSubdir`
 * wrapper over this pure function, so `'LeetCode'` is never re-hardcoded at a
 * call site. `''` is the domain value for "vault root, no subfolder".
 *
 * @param useVaultRoot - The stored `useVaultRoot` preference.
 * @returns `''` when exercises live at the vault root, else `LEETCODE_DIR`.
 *
 * @example
 * exercisesSubdir(false); // → 'LeetCode'
 * exercisesSubdir(true);  // → ''
 */
export function exercisesSubdir(useVaultRoot: boolean): string {
	return useVaultRoot ? '' : LEETCODE_DIR;
}
