import type { LeetcodeTypeId } from '../../types/leetcode-type.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { verifyFunctionExercise } from './function.rules.js';
import { verifyPackageExercise } from './package.rules.js';
import { verifyStackExercise } from './stack.rules.js';

/**
 * What the *caller's process* tells a rule about itself — never about the
 * artifact.
 *
 * `installSignals` is the whole content today: a rule that boots a real server
 * (`verifyPackageExercise` → `runProjectChecks`) may arm a process-wide
 * `SIGINT`/`SIGTERM` teardown **only** when the caller owns its own signal
 * disposition. A short-lived CLI (`verify-exercise.mjs`) does; the VS Code
 * extension host does not, and forcing an exit there races `deactivate()` —
 * see `runProjectChecks`' own comment for what that costs the solver.
 */
export interface VerifyRunOptions {
	/** Arm the CLI-only `SIGINT`/`SIGTERM` teardown for anything this rule boots. */
	readonly installSignals?: boolean;
}

/**
 * One leetcode type's full structural (and, where runnable, execution)
 * verification. Returns the first broken rule's reason, or `null` when the
 * artifact grades clean.
 *
 * A rule may ignore the `leetcodeType` and `options` arguments
 * (`verifyFunctionExercise` does — its messages never name a type and it boots
 * nothing); TypeScript's excess-parameter assignability is what lets a
 * one-argument implementation satisfy this three-argument type without a
 * wrapper.
 */
export type VerifyRule = (
	parsed: ParsedLeetCode, leetcodeType: LeetcodeTypeId, options?: VerifyRunOptions,
) => Promise<string | null>;

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
 * `stack` now points at `verifyStackExercise` (T4.4 / VSX-181), its own rule
 * set rather than a routing convenience: a stack is *several wired-together
 * packages*, so its shape must hold (more than one `packages:` entry) and its
 * cross-package wiring must resolve (an `http` check's `package:` must name
 * one) before it is graded at all. `verifyStackExercise` still *delegates* to
 * `verifyPackageExercise` once those stack-only gates pass — a stack that
 * clears its own shape is graded by the exact same file-tree / `checks:` rule
 * set a `package` is, never a second copy of it.
 *
 * Before this, `stack` pointed at `verifyPackageExercise` directly. That
 * routing was itself the fix for an earlier, worse cut of T1.7 that pointed it
 * at `verifyFunctionExercise` to keep two `test.type: 'service'` fixtures
 * green; that bought a `stack` which could not verify in any `test.type`
 * spelling **and** one with duplicate check names, failing checks and no
 * overlay reporting `ok` — the function rules never look at a file tree.
 *
 * Consequence, deliberate and still biting: the package rules demand a file
 * tree **and** cases bound to every check, which is why the four vault
 * `stack` artifacts fail `check '…' has no cases` under `LEET_STACK_E2E=1`
 * (ledger [[C30]]) — that is the rule doing its job over artifacts that
 * predate it, and `verifyStackExercise` inherits it unchanged; [[C30]] is a
 * later task's fix, not this one's. T4.4 changed **only** this one entry — it
 * did not touch this table's shape, `package.rules.ts`, or `function.rules.ts`.
 *
 * @example
 * VERIFY_RULES.package(parsed, 'package'); // → null, or the first broken rule's reason
 */
export const VERIFY_RULES: Record<LeetcodeTypeId, VerifyRule> = {
	function: verifyFunctionExercise,
	package: verifyPackageExercise,
	stack: verifyStackExercise,
};
