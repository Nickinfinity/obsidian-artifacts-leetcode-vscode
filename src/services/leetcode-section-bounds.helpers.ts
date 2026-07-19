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
 * @param text       - Text to search (post-frontmatter body, or the whole file).
 * @param headingRe  - Regex matching the section's own heading line.
 * @param boundaryRe - Regex matching a heading that ends the section.
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
	const rest = text.slice(headingEnd);
	const next = boundaryRe.exec(rest);
	const bodyEnd = next ? headingEnd + next.index : text.length;
	return { headingEnd, bodyEnd };
}
