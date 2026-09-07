/**
 * Byte-offset bounds of a Markdown section's body — the heading match itself is
 * excluded, so `[headingEnd, bodyEnd)` is exactly the content under the heading.
 */
export interface SectionBounds {
	/** Index right after the heading line — where the section body starts. */
	headingEnd: number;
	/** Index where the body ends — the next boundary heading, or end of text. */
	bodyEnd: number;
}

/**
 * Locate a Markdown section's body bounds: the region from just after its
 * heading to the next heading that matches `boundaryRe` (or end of text).
 *
 * The single source of truth for section slicing, shared by the reader
 * (`leetcode-sections.helpers` slices `[headingEnd, bodyEnd)` out) and the
 * writer (`attempts-writer` splices around the same indices). Which headings
 * *terminate* a section is the caller's choice: `/^# /m` for a top-level (`#`)
 * section whose `##` children stay inside, `/^#{1,2} /m` for a `##` section.
 *
 * A boundary-shaped line **inside a fenced block is not a heading** and does not
 * terminate the section: a column-zero `#` is a comment in Python, shell, YAML
 * and Dockerfile, and a real heading only in a Markdown fence. Matching it
 * truncated the section silently — a `# Solutions` whose Python fence opened
 * with a comment parsed to *zero* solutions, dropping every other language with
 * it.
 *
 * @param text       - Text to search (post-frontmatter body, or the whole file).
 * @param headingRe  - Regex matching the section's own heading line.
 * @param boundaryRe - Regex matching a heading that ends the section. Must not
 *   carry the `g` flag — it is tested per line, and `lastIndex` would persist.
 * @returns The bounds, or `null` when `headingRe` does not match.
 *
 * @example
 * sectionBounds('# Setup\n## Java\n…\n# Solutions', /^# Setup\s*$/m, /^# /m);
 * // → { headingEnd: 7, bodyEnd: 16 }
 */
export function sectionBounds(text: string, headingRe: RegExp, boundaryRe: RegExp): SectionBounds | null {
	const match = headingRe.exec(text);
	if (!match) { return null; }
	const headingEnd = match.index + match[0].length;
	return { headingEnd, bodyEnd: boundaryOutsideFence(text, headingEnd, boundaryRe) };
}

/**
 * Offset of the first `boundaryRe` line at or after `from` that is **not** inside
 * a ``` fence; `text.length` when there is none.
 *
 * Fence tracking is a plain toggle on a line opening with ```, matching every
 * other fence regex in the parser — a `~~~` block is not a code block to this
 * format, so its content is Markdown here too, consistently. An unterminated
 * fence therefore runs to end of text rather than resuming boundary matching
 * inside it: malformed input degrades to a documented default.
 *
 * Exported for `extractDescription`, whose "prose before the first heading"
 * slice needs exactly this fence-aware boundary search and must not carry a
 * second fence walk of its own — v2 puts YAML config in the body, so a column-0
 * `#` before the first heading is now reachable as a *comment* rather than a
 * heading.
 *
 * @param text       - Full text being sliced.
 * @param from       - Offset just past the section's own heading.
 * @param boundaryRe - Heading regex that ends the section, tested per line.
 * @returns Byte offset where the section body ends.
 *
 * @example
 * boundaryOutsideFence('# S\n```py\n# c\n```\n# T', 3, /^# /m); // → 17
 */
export function boundaryOutsideFence(text: string, from: number, boundaryRe: RegExp): number {
	let offset = from;
	let fenced = false;
	for (const line of text.slice(from).split('\n')) {
		if (line.startsWith('```')) {
			fenced = !fenced;
		} else if (!fenced && boundaryRe.test(line)) {
			return offset;
		}
		// `split` removed the '\n' that separated this line from the next.
		offset += line.length + 1;
	}
	return text.length;
}
