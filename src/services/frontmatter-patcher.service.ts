import { CANONICAL_FRONTMATTER_ORDER } from './leetcode-config-blocks.helpers.js';

// ── patchFrontmatterField ─────────────────────────────────────────────────────

/**
 * A column-0 `key:` line — the same grammar `leetcode-config-blocks.helpers.ts`
 * and `frontmatter-order.helpers.ts` scan raw frontmatter text with.
 */
const TOP_LEVEL_KEY_RE = /^(\w+):/;

/**
 * Wraps a YAML scalar value in quotes when the bare form would be ambiguous.
 *
 * - Value containing `"` → single-quoted  (`'…'`)
 * - Value containing `:` → double-quoted (`"…"`)
 * - All other values     → returned as-is
 *
 * @param value - Raw scalar value to encode.
 * @returns The value, quoted only when necessary.
 *
 * @example
 * yamlQuote('plain text')      // → 'plain text'
 * yamlQuote('a: b')            // → '"a: b"'
 */
function yamlQuote(value: string): string {
	if (value.includes('"')) { return `'${value}'`; }
	if (value.includes(':')) { return `"${value}"`; }
	return value;
}

/**
 * Canonical position of `key` in `CANONICAL_FRONTMATTER_ORDER`, or `-1` for
 * anything else — a custom field, or a stray body-set key.
 *
 * A plain array scan, not a keyed lookup: safe against a hostile `key` like
 * `__proto__`, which simply never equals any tuple entry, rather than
 * resolving through a prototype chain the way an object keyed by the same
 * string would.
 *
 * @param key - A frontmatter key, straight off untrusted `.md` text.
 * @returns Its index in `CANONICAL_FRONTMATTER_ORDER`, or `-1`.
 */
function canonicalIndex(key: string): number {
	return (CANONICAL_FRONTMATTER_ORDER as readonly string[]).indexOf(key);
}

/**
 * Offset in `fmBody` of the first top-level key line that outranks
 * `targetIndex` in canonical order — i.e. where a field at that index belongs
 * when it is absent.
 *
 * Robust to missing neighbours and unknown keys by construction: a key
 * without a canonical index (`-1`) can never be `> targetIndex`, so it is
 * skipped as an anchor without special-casing, and stays exactly where it is
 * — only the scan passes over it.
 *
 * @param fmBody - Raw frontmatter body (no `---` fences).
 * @param targetIndex - `canonicalIndex(field)` for the field being inserted.
 * @returns The offset to insert before, or `fmBody.length` (append) when no
 *   present key outranks it, or when `targetIndex` itself is `-1`.
 *
 * @example
 * canonicalInsertionOffset('title: X\nalgorithm: a\n', 4); // → 9 (before 'algorithm')
 */
function canonicalInsertionOffset(fmBody: string, targetIndex: number): number {
	if (targetIndex === -1) { return fmBody.length; }
	let offset = 0;
	for (const line of fmBody.split('\n')) {
		const match = TOP_LEVEL_KEY_RE.exec(line);
		if (match && canonicalIndex(match[1]) > targetIndex) { return offset; }
		offset += line.length + 1;
	}
	return fmBody.length;
}

/** Appends `line` to `fmBody`, adding a separating `\n` only when needed. */
function appendLine(fmBody: string, line: string): string {
	if (fmBody === '') { return line + '\n'; }
	return (fmBody.endsWith('\n') ? fmBody : fmBody + '\n') + line + '\n';
}

/**
 * Updates or inserts a single YAML frontmatter field in a `.md` artifact file.
 *
 * The frontmatter block is the content between the opening `---` and the
 * first closing `---` (either may use `\r\n`). If the file has no
 * frontmatter the content is returned unchanged. Values containing `:` are
 * double-quoted; values containing `"` are single-quoted.
 *
 * **Present → replaced in place**, every occurrence (a duplicate key is
 * hostile input `applyScalar` reads last-wins; replacing only the first
 * would patch a line the parser never looks at again, and the write would be
 * silently invisible). **Absent → inserted at its canonical index** — read
 * from `CANONICAL_FRONTMATTER_ORDER`, the one authority `orderViolation`
 * (`frontmatter-order.helpers.ts`) also reads — never appended after `tags`,
 * which is what put an order violation into every clean-Submit artifact that
 * had no `status:` to begin with.
 *
 * @param content - Raw `.md` file content string.
 * @param field   - YAML key to update (e.g. `'status'`).
 * @param value   - New value for the key.
 * @returns The patched content string (unchanged if there is no frontmatter).
 *
 * @example
 * patchFrontmatterField('---\nstatus: unsolved\n---\nbody', 'status', 'solved')
 * // → '---\nstatus: solved\n---\nbody'
 * @example
 * patchFrontmatterField('---\ntitle: X\ndifficulty: easy\nalgorithm: a\n---\n', 'status', 'solved')
 * // → '---\ntitle: X\ndifficulty: easy\nstatus: solved\nalgorithm: a\n---\n'
 */
export function patchFrontmatterField(content: string, field: string, value: string): string {
	const openMatch = /^---\r?\n/.exec(content);
	if (!openMatch) { return content; }

	const rest       = content.slice(openMatch[0].length);
	const closeMatch = /^---$/m.exec(rest);
	if (!closeMatch) { return content; }

	const fmBody    = rest.slice(0, closeMatch.index);
	const afterFm   = rest.slice(closeMatch.index);
	const formatted = field + ': ' + yamlQuote(value);
	const fieldRe   = new RegExp('^' + field + ':.*$', 'gm');

	let newFmBody: string;
	if (fieldRe.test(fmBody)) {
		newFmBody = fmBody.replace(fieldRe, formatted);
	} else {
		const at = canonicalInsertionOffset(fmBody, canonicalIndex(field));
		newFmBody = at >= fmBody.length
			? appendLine(fmBody, formatted)
			: fmBody.slice(0, at) + formatted + '\n' + fmBody.slice(at);
	}

	return '---\n' + newFmBody + afterFm;
}
