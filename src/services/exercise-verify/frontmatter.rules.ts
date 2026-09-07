import { orderViolation } from '../frontmatter-order.helpers.js';
import { legacyFrontmatterKeys, splitFrontmatter } from '../leetcode-config-blocks.helpers.js';
import { sanitizeUntrustedText } from '../../utils/sanitize-text.helpers.js';

/**
 * The four pre-dispatch frontmatter rules `verifyExercise` runs, in order,
 * against the raw `.md` text — before `parsed.leetcodeType` ever selects a
 * `VerifyRule` from `rules.registry.ts`.
 *
 * **This is not a `VerifyRule` and is never wired into `VERIFY_RULES`.**
 * `rules.registry.ts` dispatches *after* parsing, keyed by leetcode type, one
 * rule set per type; the four rules here run first, for **every** type,
 * straight off the raw text — each catches something `parseLeetCode` would
 * otherwise silently ignore, mis-order, or accept unchecked, so a malformed
 * or unidentifiable artifact never reaches a type-specific rule set pretending
 * to be well-formed.
 *
 * Rules 0-2 moved here byte-for-byte from `exercise-verify.helpers.ts`
 * (VSX-122 / T1.15), which returns to being the dispatcher it became in T1.7
 * (VSX-154). Rule 3 is new in T1.15.
 */

/**
 * A column-0 `key:value` line. No `\s*` before the capture — `.` already
 * matches whitespace, so a separate `\s*` would overlap it and give the
 * engine two ways to consume the same run of spaces (S8786); the trailing
 * `.trim()` at each call site strips the leading space instead.
 */
const TOP_LEVEL_KEY_VALUE_RE = /^(\w+):(.*)$/;

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

// ── Rule 1: legacy `type:` discriminator (D11's hard cut, enforced) ──────────

/**
 * Rule 1 — a bare `type: leetcode` with no `artifactType:` declared alongside it.
 *
 * D11 renamed the discriminator; unlike `leetcodeType` (derived when absent),
 * a renamed key is derivable from nothing, so `parseFrontmatter` ignores both
 * spellings equally rather than reading either — nothing downstream would
 * ever notice a bare `type:` on its own. This is the only check that names it.
 *
 * Fires only when `type:`'s value is exactly `leetcode`: an ordinary vault
 * note (`type: notes`, no `artifactType:`) is not a legacy leetcode artifact
 * and this rule has nothing to say about it — Rule 3 is what now catches that
 * artifact for the separate reason that `artifactType:` is absent.
 *
 * @param md - Full `.md` artifact content (untrusted).
 * @returns A message naming the rename, or `null` when `artifactType:` is
 *   present, or `type:` is absent, or its value is not `leetcode`.
 *
 * @example
 * checkLegacyType('---\ntype: leetcode\n---\nBody');
 * // → "legacy: 'type:' is renamed to 'artifactType:' — declare 'artifactType: leetcode', not 'type: leetcode'"
 */
function checkLegacyType(md: string): string | null {
	const { fmRaw } = splitFrontmatter(md);
	let hasArtifactType = false;
	let typeIsLeetcode = false;
	for (const line of fmRaw.split(/\r?\n/)) {
		const m = TOP_LEVEL_KEY_VALUE_RE.exec(line);
		if (!m) { continue; }
		if (m[1] === 'artifactType') { hasArtifactType = true; }
		else if (m[1] === 'type' && m[2].trim() === 'leetcode') { typeIsLeetcode = true; }
	}
	if (!typeIsLeetcode || hasArtifactType) { return null; }
	return "legacy: 'type:' is renamed to 'artifactType:' — declare 'artifactType: leetcode', not 'type: leetcode'";
}

// ── Rule 2: canonical frontmatter key order (T1.10's `orderViolation`) ───────

/**
 * Rule 2 — wraps `orderViolation` (`frontmatter-order.helpers.ts`, the one
 * authority on canonical key order) as its own named `verifyExercise` failure.
 *
 * @param md - Full `.md` artifact content (untrusted).
 * @returns `orderViolation`'s message, or `null` when frontmatter is in
 *   canonical order (or carries no known key out of order).
 */
function checkFrontmatterOrder(md: string): string | null {
	const { fmRaw } = splitFrontmatter(md);
	return orderViolation(fmRaw);
}

// ── Rule 3: the discriminator's presence and value (T1.15) ───────────────────

/**
 * Rule 3 — `artifactType: leetcode` must be **present** in frontmatter and
 * **equal** `leetcode`; nothing else verifies as an exercise.
 *
 * Rules 0-2 each answer "is this key spelled/placed correctly?"; none of them
 * answer "is this actually declaring itself a leetcode artifact at all?".
 * `artifactType: recipe` and a file with neither `type:` nor `artifactType:`
 * both verified green before this rule existed — the exact failure mode of a
 * migrator (T1.13) that strips `type:` and forgets to write `artifactType:`,
 * and invisible to a vault sweep that filters candidates on that very key
 * (§J). This is the belt that makes that failure loud instead of silent.
 *
 * Reuses `TOP_LEVEL_KEY_VALUE_RE` (Rule 1's regex, not a new one) over
 * `fmRaw` only — `splitFrontmatter` already excludes the body, so an
 * `artifactType: leetcode` line sitting inside a body fence (a `## Files`
 * entry, a `# Solutions` code comment) is body content, never read here.
 * Last occurrence wins on a duplicate key, matching `applyScalar`'s own
 * last-wins semantics for scalar frontmatter keys.
 *
 * **The declared value is echoed into the reason, so it goes through
 * `sanitizeUntrustedText` first (VSX-122 C12).** This is the one rule in
 * this file that interpolates an unbounded, artifact-controlled string —
 * Rule 0 (`checkLegacyFrontmatter`) only ever echoes key *names* drawn from
 * the closed `BODY_SET_KEYS` vocabulary, and Rule 2 forwards `orderViolation`,
 * which only ever echoes key names drawn from `CANONICAL_FRONTMATTER_ORDER`;
 * neither can carry attacker-chosen bytes. `value` here is the raw scalar
 * text after `artifactType:`, unbounded and unfiltered until this call.
 *
 * @param md - Full `.md` artifact content (untrusted).
 * @returns A message naming what is missing or wrong, or `null` when
 *   `artifactType: leetcode` is declared.
 *
 * @example
 * checkArtifactType('---\ntitle: X\n---\nBody');
 * // → "discriminator: 'artifactType: leetcode' is required — none declared"
 * @example
 * checkArtifactType('---\nartifactType: recipe\n---\nBody');
 * // → "discriminator: 'artifactType' is 'recipe', expected 'leetcode'"
 */
function checkArtifactType(md: string): string | null {
	const { fmRaw } = splitFrontmatter(md);
	let value: string | null = null;
	for (const line of fmRaw.split(/\r?\n/)) {
		const m = TOP_LEVEL_KEY_VALUE_RE.exec(line);
		if (m && m[1] === 'artifactType') { value = m[2].trim(); }
	}
	if (value === null) {
		return "discriminator: 'artifactType: leetcode' is required — none declared";
	}
	if (value !== 'leetcode') {
		return `discriminator: 'artifactType' is '${sanitizeUntrustedText(value)}', expected 'leetcode'`;
	}
	return null;
}

// ── Combinator ─────────────────────────────────────────────────────────────

/**
 * Runs Rules 0-3 in order against the raw `.md` text and returns the first
 * broken rule's reason — `verifyExercise`'s single entry point into this
 * module, so it stays a thin dispatcher rather than four inline calls.
 *
 * @param md - Full `.md` artifact content (untrusted).
 * @returns The first broken rule's reason, or `null` when all four pass.
 *
 * @example
 * checkFrontmatterRules('---\ntitle: X\n---\nBody');
 * // → "discriminator: 'artifactType: leetcode' is required — none declared"
 */
export function checkFrontmatterRules(md: string): string | null {
	return checkLegacyFrontmatter(md)
		?? checkLegacyType(md)
		?? checkFrontmatterOrder(md)
		?? checkArtifactType(md);
}
