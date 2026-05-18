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
 * Updates or inserts a single YAML frontmatter field in a `.md` artifact file.
 *
 * The frontmatter block is the content between the opening `---` and the first
 * closing `---`. If the file has no frontmatter the content is returned
 * unchanged. Values containing `:` are double-quoted; values containing `"`
 * are single-quoted.
 *
 * @param content - Raw `.md` file content string.
 * @param field   - YAML key to update (e.g. `'status'`).
 * @param value   - New value for the key.
 * @returns The patched content string (unchanged if there is no frontmatter).
 *
 * @example
 * patchFrontmatterField('---\nstatus: unsolved\n---\nbody', 'status', 'solved')
 * // → '---\nstatus: solved\n---\nbody'
 */
export function patchFrontmatterField(content: string, field: string, value: string): string {
	if (!content.startsWith('---\n')) { return content; }

	const rest       = content.slice(4);
	const closeMatch = /^---$/m.exec(rest);
	if (!closeMatch) { return content; }

	const closeIdx = closeMatch.index;
	const fmBody   = rest.slice(0, closeIdx);
	const afterFm  = rest.slice(closeIdx);
	const formatted = field + ': ' + yamlQuote(value);
	const fieldRe   = new RegExp('^' + field + ':.*$', 'm');

	let newFmBody: string;
	if (fieldRe.test(fmBody)) {
		newFmBody = fmBody.replace(fieldRe, formatted);
	} else {
		// Append before the closing --- (fmBody always ends with \n in valid files).
		newFmBody = fmBody.endsWith('\n')
			? fmBody + formatted + '\n'
			: formatted + '\n';
	}

	return '---\n' + newFmBody + afterFm;
}
