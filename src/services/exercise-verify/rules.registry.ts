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
 * `stack` reuses `verifyPackageExercise`, and that routing is the model
 * rather than a convenience: a stack is *several wired-together packages*, so
 * it is graded by declared checks and never by one candidate buffer. An
 * intermediate cut of T1.7 pointed it at `verifyFunctionExercise` to keep two
 * `test.type: 'service'` fixtures green; that bought a `stack` which could not
 * verify in any `test.type` spelling **and** one with duplicate check names,
 * failing checks and no overlay reporting `ok` — the function rules never look
 * at a file tree. Pinned by `exercise-verify-rules.test.ts`'s *held to the
 * package rules* case (`stack: no ## Files declared`).
 *
 * Consequence, deliberate and currently biting: the package rules demand a
 * file tree **and** cases bound to every check, which is why the four vault
 * `stack` artifacts fail `check '…' has no cases` under `LEET_STACK_E2E=1`
 * (ledger [[C30]]). That is the rule doing its job over artifacts that predate
 * it. T4.4 gives `stack` its own rule set by changing this one entry — it does
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
