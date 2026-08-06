import type { LeetcodeTypeId } from '../../types/leetcode-type.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { verifyFunctionExercise } from './function.rules.js';
import { verifyPackageExercise } from './package.rules.js';

/**
 * One leetcode type's full structural (and, where runnable, execution)
 * verification. Returns the first broken rule's reason, or `null` when the
 * artifact grades clean.
 *
 * A rule may ignore the `leetcodeType` argument (`verifyFunctionExercise`
 * does — its messages never name a type); TypeScript's excess-parameter
 * assignability is what lets a one-argument implementation satisfy this
 * two-argument type without a wrapper.
 */
export type VerifyRule = (parsed: ParsedLeetCode, leetcodeType: LeetcodeTypeId) => Promise<string | null>;

/**
 * The one authority mapping a leetcode type to the rules that verify it
 * (VSX-154 / T1.7).
 *
 * `Record<LeetcodeTypeId, VerifyRule>` is compiler-checked exhaustive over the
 * three declared types (`src/types/leetcode-type.ts`): a fourth leetcode type
 * fails the build here, at this one table, rather than falling through a
 * fourth branch nobody added to `verifyExercise`'s old
 * `if (parsed.test.type === 'project') { … }` chain — which is exactly the
 * shape this table replaces.
 *
 * `stack` intentionally reuses `verifyFunctionExercise`, not
 * `verifyPackageExercise`. No dedicated stack rule set exists yet — a real
 * stack artifact is *several* wired-together packages, which nothing in this
 * codebase grades — and `exercise-verify.test.ts`'s reserved-type suite pins
 * that a `service`-derived (`stack`) artifact verifies "well-formed" today via
 * the same reserved-relaxation path a `class`/`in-place` reserved *test* type
 * gets, with no `## Files` required. Routing `stack` to the strict `package`
 * rules would newly demand a file tree those fixtures never declare. A future
 * task can give `stack` its own rule set by changing this one entry — it does
 * not touch this table's shape, `package.rules.ts`, or `function.rules.ts`.
 *
 * @example
 * VERIFY_RULES.package(parsed, 'package'); // → null, or the first broken rule's reason
 */
export const VERIFY_RULES: Record<LeetcodeTypeId, VerifyRule> = {
	function: verifyFunctionExercise,
	package: verifyPackageExercise,
	stack: verifyPackageExercise,
};
