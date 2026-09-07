import { CANONICAL_FRONTMATTER_ORDER, TOP_LEVEL_KEY_RE } from './leetcode-config-blocks.helpers.js';
import { escapeRe } from '../utils/regex.helpers.js';

// ── patchFrontmatterField ─────────────────────────────────────────────────────

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
function appendLine(fmBody: string, line: string, eol: string): string {
	if (fmBody === '') { return line + eol; }
	return (fmBody.endsWith('\n') ? fmBody : fmBody + eol) + line + eol;
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
	// `escapeRe` because this is an exported service taking any `string`: an
	// unescaped `field` makes the pattern match keys it does not name —
	// `'status.'` matched and destroyed a `statusX:` line.
	// `[^\r\n]*`, not `.*$`: `.` matches `\r`, so an `m`-flagged `.*$` swallows
	// the carriage return and the replacement puts back a bare `\n`, turning
	// the patched line into the only LF line in a CRLF file.
	const fieldRe   = new RegExp('^' + escapeRe(field) + String.raw`:[^\r\n]*`, 'm');
	// The file's own newline, not an assumed `\n`. A CRLF artifact previously
	// round-tripped untouched because nothing matched; now that both paths
	// write, an assumed LF leaves the rewritten line as the only LF line in a
	// CRLF file. `artifact-migrator.helpers.ts` already promises a CRLF file
	// round-trips unchanged — this is the half that has to keep that promise.
	const eol = openMatch[0].endsWith('\r\n') ? '\r\n' : '\n';

	let newFmBody: string;
	if (fieldRe.test(fmBody)) {
		newFmBody = fmBody.replace(new RegExp(fieldRe.source, 'gm'), formatted);
	} else {
		const at = canonicalInsertionOffset(fmBody, canonicalIndex(field));
		newFmBody = at >= fmBody.length
			? appendLine(fmBody, formatted, eol)
			: fmBody.slice(0, at) + formatted + eol + fmBody.slice(at);
	}

	return openMatch[0] + newFmBody + afterFm;
}
