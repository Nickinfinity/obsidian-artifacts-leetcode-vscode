import { canonicalJson } from '../utils/canonical-json.js';
import type { TestCase } from '../types/leetcode.types.js';
import { checkFrontmatterRules } from './exercise-verify/frontmatter.rules.js';
import { VERIFY_RULES, type VerifyRunOptions } from './exercise-verify/rules.registry.js';
import { parseLeetCode } from './leetcode-parser.service.js';

/** `verifyExercise` succeeded — the exercise conforms and (if runnable) every declared language is green. */
export interface VerifyOk { ok: true }

/** `verifyExercise` failed — `reason` names the first rule that broke. */
export interface VerifyFail { ok: false; reason: string }

export type VerifyResult = VerifyOk | VerifyFail;

/** One case where the artifact's `expected` disagrees with an independently recomputed value. */
export interface ExpectedMismatch {
	/** Zero-based index into the compared case list */
	index: number;
	/** The case's input map, carried through for the reviewer's diff */
	input: Record<string, unknown>;
	/** `expected` as stored in the artifact */
	artifact: unknown;
	/** `expected` as recomputed independently, to cross-check the stored value */
	recomputed: unknown;
}

/**
 * Verifies a `type: leetcode` artifact conforms to the on-disk format and, for a
 * runnable `test.type`, that every language carrying both a `# Setup` and a
 * `# Solutions` entry passes its full (public + final) suite.
 *
 * This is the uniform harness: it does not judge whether the exercise's
 * algorithm is *interesting* — only that the file is well-formed and its own
 * reference solution(s) actually run green. Four checks run here
 * (`checkFrontmatterRules`, `./exercise-verify/frontmatter.rules.js`), before
 * the per-leetcode-type rules are dispatched:
 *
 * 0. Legacy frontmatter config — a D2 body-set key (`function`, `params`,
 *    `libs`, …) left in frontmatter. Runs before any type-specific rule:
 *    `parseLeetCode` silently *ignores* such a key rather than reading it, so
 *    a `package`/`stack` artifact with a stripped `libs:` would otherwise
 *    surface as a bare toolchain error (`Cannot find module 'react'`) instead
 *    of naming the real problem.
 * 1. Legacy `type:` discriminator — D11's hard cut renamed `type` to
 *    `artifactType`. A bare `type: leetcode` with no `artifactType:` is
 *    likewise ignored, not read (`parseFrontmatter` skips both spellings
 *    equally), so nothing downstream ever observes it missing — this names
 *    the rename instead of leaving the file to silently mis-verify. A
 *    near-miss warner would not catch it either (`type` → `tags` is edit
 *    distance 3), which is exactly why this is its own rule.
 * 2. Frontmatter key order — `orderViolation` (T1.10,
 *    `frontmatter-order.helpers.ts`) is the one authority on canonical
 *    key order; a violation it finds is reported here as its own named
 *    failure so a mis-ordered artifact fails with a message rather than
 *    quietly still parsing.
 * 3. The discriminator's presence and value (T1.15) — `artifactType: leetcode`
 *    must be *declared*, not merely absent-of-a-stale-spelling: neither key
 *    present, or `artifactType:` present with any other value (including
 *    empty), fails here by name. Closes the hole Rules 0-2 leave open — a
 *    migrator that strips `type:` and forgets to write `artifactType:` used
 *    to verify green.
 * 4. Leetcode-type dispatch — `parsed.leetcodeType` (the axis declared in
 *    `src/types/leetcode-type.ts`) selects a `VerifyRule` from `VERIFY_RULES`
 *    (`./exercise-verify/rules.registry.js`), a `Record<LeetcodeTypeId,
 *    VerifyRule>` compiler-checked exhaustive over every declared type.
 *    Nothing here branches on `test.type` any more — `function.rules.ts` owns
 *    the function floors (`params`/`returns`, the 6-public / 3-final case
 *    counts, the `## Examples ⊆ ## Tests` pin) and `package.rules.ts` owns the
 *    file-tree / `checks:` rules, each entirely on its own, so adding a fourth
 *    leetcode type is a new registry entry, never a fourth branch here.
 *
 * `leetcodeType` stays optional on `ParsedLeetCode` (for hand-built fixtures
 * elsewhere that never call `parseLeetCode`); `parseLeetCode` itself always
 * resolves it, so the `undefined` branch below is unreached from this
 * function's own (string-only) entry point. It is answered explicitly rather
 * than defaulted — `?? 'function'` would silently measure a `package`/`stack`
 * tree against the function floors — so a future caller that *can* reach it
 * fails loud instead of quietly wrong.
 *
 * @param md   - Full `.md` artifact content.
 * @param path - Optional file path, prefixed onto a failure's `reason` for a
 *   caller walking many files.
 * @param options - What the *calling process* is, never what the artifact is —
 *   `installSignals` is a **CLI-only** opt-in, see {@link VerifyRunOptions}.
 *   Omitted by anything running inside the VS Code extension host.
 * @returns `{ ok: true }`, or `{ ok: false, reason }` naming the first broken rule.
 *
 * @example
 * await verifyExercise(fs.readFileSync(vaultPath, 'utf-8'));
 * // → { ok: true }
 */
export async function verifyExercise(
	md: string, path?: string, options?: VerifyRunOptions,
): Promise<VerifyResult> {
	const fail = (reason: string): VerifyFail => ({ ok: false, reason: path ? `${path}: ${reason}` : reason });

	// Rules 0-3 first, before the leetcode-type dispatch — see
	// `frontmatter.rules.ts`'s header for why this is not a `VerifyRule`.
	const frontmatterReason = checkFrontmatterRules(md);
	if (frontmatterReason) { return fail(frontmatterReason); }

	const parsed = parseLeetCode(md);

	const leetcodeType = parsed.leetcodeType;
	if (leetcodeType === undefined) { return fail('parse: missing leetcode type'); }

	const reason = await VERIFY_RULES[leetcodeType](parsed, leetcodeType, options);
	return reason ? fail(reason) : { ok: true };
}

/**
 * Compares an artifact's stored `expected` values against an independently
 * recomputed list, by shared index.
 *
 * @param artifactCases - The artifact's own cases (`## Tests` + `## Final Tests`, in order).
 * @param recomputed    - Independently recomputed `expected` values, same order.
 * @returns Rows where the two disagree; `[]` when every index agrees.
 *
 * @example
 * compareExpecteds([{ input: { a: 1 }, expected: 2 }], [2]); // → []
 * compareExpecteds([{ input: { a: 1 }, expected: 2 }], [3]);
 * // → [{ index: 0, input: { a: 1 }, artifact: 2, recomputed: 3 }]
 */
export function compareExpecteds(artifactCases: TestCase[], recomputed: unknown[]): ExpectedMismatch[] {
	const mismatches: ExpectedMismatch[] = [];
	artifactCases.forEach((c, index) => {
		const theirs = recomputed[index];
		if (canonicalJson(c.expected) !== canonicalJson(theirs)) {
			mismatches.push({ index, input: c.input, artifact: c.expected, recomputed: theirs });
		}
	});
	return mismatches;
}

