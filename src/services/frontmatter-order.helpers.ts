import { CANONICAL_FRONTMATTER_ORDER } from './leetcode-config-blocks.helpers.js';

/**
 * The pure check that enforces the canonical frontmatter key order (defined
 * in `leetcode-config-blocks.helpers.ts`, alongside `RETAINED_FM_KEYS` it is
 * derived from) on **write**.
 *
 * This governs writing only — `leetcode-parser.helpers.ts` reads frontmatter
 * order-independently today, and nothing here changes that. `verifyExercise`
 * (T1.11) reports a violation this module finds as a named failure;
 * `patchFrontmatterField` (T1.12) reads `CANONICAL_FRONTMATTER_ORDER`
 * directly to find where an absent key belongs instead of appending it after
 * `tags`. Neither needs anything from *this* file but `orderViolation` — the
 * order itself lives in exactly one place.
 */

/**
 * `CANONICAL_FRONTMATTER_ORDER`, keyed for O(1) lookup. A `Map`, not a plain
 * object — the key comes off untrusted frontmatter text, which can spell
 * `__proto__`; a `Map` has no prototype chain for that to resolve through.
 */
const CANONICAL_INDEX: ReadonlyMap<string, number> = new Map(
	CANONICAL_FRONTMATTER_ORDER.map((key, index) => [key, index]),
);

/**
 * A column-0 `key:` line. Anchored (`^`) so an indented continuation line —
 * a `tags:` block's `- foo`, a `params:` sub-key — never matches, and a
 * single `\w+` quantifier keeps a pathologically long key linear rather than
 * a backtracking hang.
 */
const TOP_LEVEL_KEY_RE = /^(\w+):/;

/**
 * Reports the first out-of-order pair of *known* frontmatter keys in `fmRaw`,
 * or `null` when every known key present already appears in canonical order.
 *
 * A key absent from `CANONICAL_FRONTMATTER_ORDER` — a custom field, or a
 * stray body-set key someone left in frontmatter — is skipped entirely: it
 * is never positioned and can never cause a violation, matching the format's
 * existing "unknown stays unread" contract. A repeated key is harmless too:
 * its canonical index equals itself, which is never *less than* the previous
 * key's index, so re-declaring a key cannot self-trigger a violation — that
 * failure mode belongs to a different check, not this one.
 *
 * @param fmRaw - Raw frontmatter body, no `---` fences (the same shape
 *   `splitFrontmatter` returns as `fmRaw`).
 * @returns A message naming the earlier-in-canonical-order key that should
 *   have appeared first, or `null`.
 *
 * @example
 * orderViolation('title: X\nartifactType: leetcode\n');
 * // → "frontmatter key 'artifactType' must come before 'title' (canonical order: artifactType, leetcodeType, title, difficulty, status, algorithm, tags)"
 * @example
 * orderViolation('artifactType: leetcode\nleetcodeType: function\ntitle: X\n'); // → null
 */
export function orderViolation(fmRaw: string): string | null {
	let lastIndex = -1;
	let lastKey = '';
	for (const line of fmRaw.split(/\r?\n/)) {
		const match = TOP_LEVEL_KEY_RE.exec(line);
		if (!match) { continue; }
		const key = match[1];
		const index = CANONICAL_INDEX.get(key);
		if (index === undefined) { continue; }
		if (index < lastIndex) {
			return `frontmatter key '${key}' must come before '${lastKey}' (canonical order: ${CANONICAL_FRONTMATTER_ORDER.join(', ')})`;
		}
		lastIndex = index;
		lastKey = key;
	}
	return null;
}
