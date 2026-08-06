import { canonicalJson } from '../utils/canonical-json.js';
import type { TestCase } from '../types/leetcode.types.js';
import { VERIFY_RULES } from './exercise-verify/rules.registry.js';
import { legacyFrontmatterKeys, splitFrontmatter } from './leetcode-config-blocks.helpers.js';
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
 * reference solution(s) actually run green. One check runs here, before the
 * per-leetcode-type rules are dispatched:
 *
 * 0. Legacy frontmatter config — a D2 body-set key (`function`, `params`,
 *    `libs`, …) left in frontmatter. Runs before any type-specific rule:
 *    `parseLeetCode` silently *ignores* such a key rather than reading it, so
 *    a `package`/`stack` artifact with a stripped `libs:` would otherwise
 *    surface as a bare toolchain error (`Cannot find module 'react'`) instead
 *    of naming the real problem. (Room stays here for the next rule that runs
 *    this early — a sibling check beside Rule 0, not folded into it.)
 * 1. Leetcode-type dispatch — `parsed.leetcodeType` (the axis declared in
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
 * @returns `{ ok: true }`, or `{ ok: false, reason }` naming the first broken rule.
 *
 * @example
 * await verifyExercise(fs.readFileSync(vaultPath, 'utf-8'));
 * // → { ok: true }
 */
export async function verifyExercise(md: string, path?: string): Promise<VerifyResult> {
	const fail = (reason: string): VerifyFail => ({ ok: false, reason: path ? `${path}: ${reason}` : reason });

	// Rule 0 first, before the leetcode-type dispatch: a legacy key is silently
	// ignored by `parseLeetCode`, so nothing downstream ever observes it missing
	// — this is the only rule that catches it.
	const legacyReason = checkLegacyFrontmatter(md);
	if (legacyReason) { return fail(legacyReason); }

	const parsed = parseLeetCode(md);

	const leetcodeType = parsed.leetcodeType;
	if (leetcodeType === undefined) { return fail('parse: missing leetcode type'); }

	const reason = await VERIFY_RULES[leetcodeType](parsed, leetcodeType);
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

// ── Rule 0: legacy frontmatter config (D4's hard cut, enforced) ──────────────

/**
 * Rule 0 — a D2 body-set key (`function`, `functions`, `params`, `returns`,
 * `test`, `practice`, `libs`, `checks`, `services`) declared in frontmatter
 * instead of a ` ```yaml leetcode ` body fence.
 *
 * `parseLeetCode` strips these before parsing (D4 is a hard cut: ignored, not
 * read-then-warned), so nothing else here can ever observe one missing — this
 * is the only check that can fail an artifact for it. Uses `splitFrontmatter`
 * + `legacyFrontmatterKeys` directly rather than `parsed.warnings`, because a
 * free-form warning string is not a check a caller can rely on.
 *
 * @param md - Full `.md` artifact content (untrusted).
 * @returns A message naming every offending key and where it belongs, or
 *   `null` when frontmatter carries none.
 *
 * @example
 * checkLegacyFrontmatter('---\nfunction: sum\n---\nBody');
 * // → "legacy: 'function:' declared in frontmatter — move into a 'yaml leetcode' body fence"
 */
function checkLegacyFrontmatter(md: string): string | null {
	const { fmRaw } = splitFrontmatter(md);
	const keys = legacyFrontmatterKeys(fmRaw);
	if (keys.length === 0) { return null; }

	const named = keys.map(k => `'${k}:'`).join(', ');
	return `legacy: ${named} declared in frontmatter — move into a 'yaml leetcode' body fence`;
}

