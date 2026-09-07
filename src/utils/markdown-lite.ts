import { escHtml } from './html.helpers.js';

/**
 * The block shapes this renderer understands. Anything else is a paragraph —
 * an unsupported construct degrades to its literal text, never to markup.
 */
type BlockKind = 'p' | 'ul' | 'ol' | 'quote' | 'h';

/** One run of consecutive lines that share a block kind. */
interface Block {
	kind: BlockKind;
	/** Marker-stripped line texts, in source order. */
	lines: string[];
}

const HEADING_RE = /^#{1,6}\s+(.*)$/;
const QUOTE_RE   = /^>\s?(.*)$/;
const UL_RE      = /^[-*]\s+(.*)$/;
const OL_RE      = /^\d+\.\s+(.*)$/;

/** Split on code spans, keeping them — everything captured stays literal. */
const CODE_SPAN_RE = /(`[^`]+`)/;
const LINK_RE      = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const BOLD_RE      = /\*\*([^*]+)\*\*/g;
const ITALIC_RE    = /\*([^*]+)\*/g;

/**
 * Renders a **small, fixed** Markdown subset to HTML for the preview panel:
 * paragraphs, headings, `-`/`*` and numbered lists, blockquotes, inline code,
 * bold, italics, and `http(s)` links.
 *
 * The artifact description is untrusted input, so this is a *whitelist*
 * renderer, not a parser with an HTML passthrough: the source is escaped
 * **first** and markup is only ever added by the rules above. Raw HTML in the
 * `.md` therefore renders as visible text, and a link whose scheme is not
 * `http`/`https` (`javascript:`, `data:`, or a vault-relative path that means
 * nothing in a webview) renders as its label alone.
 *
 * @param src - Raw Markdown text.
 * @returns HTML safe to interpolate into the webview; `''` for blank input.
 *
 * @example
 * renderMarkdownLite('use `npm ci`'); // → '<p>use <code>npm ci</code></p>'
 */
export function renderMarkdownLite(src: string): string {
	return toBlocks(src.replaceAll('\r\n', '\n').split('\n')).map(renderBlock).join('');
}

/**
 * Groups lines into blocks — a blank line or a change of kind ends the current
 * one, and a heading is always alone.
 *
 * @param lines - Source lines, newline-free.
 * @returns Blocks in source order; `[]` when every line is blank.
 *
 * @example
 * toBlocks(['- a', '- b']); // → [{ kind: 'ul', lines: ['a', 'b'] }]
 */
function toBlocks(lines: string[]): Block[] {
	const blocks: Block[] = [];
	let current: Block | null = null;

	for (const line of lines) {
		if (line.trim() === '') { current = null; continue; }

		const { kind, text } = classify(line);
		if (current && current.kind === kind && kind !== 'h') {
			current.lines.push(text);
		} else {
			current = { kind, lines: [text] };
			blocks.push(current);
		}
	}

	return blocks;
}

/**
 * Reads one line's block kind and strips its marker.
 *
 * @param line - One source line.
 * @returns Its kind and the text left once the marker is removed.
 *
 * @example
 * classify('> note'); // → { kind: 'quote', text: 'note' }
 */
function classify(line: string): { kind: BlockKind; text: string } {
	const heading = HEADING_RE.exec(line);
	if (heading) { return { kind: 'h', text: heading[1] }; }

	const quote = QUOTE_RE.exec(line);
	if (quote) { return { kind: 'quote', text: quote[1] }; }

	const bullet = UL_RE.exec(line);
	if (bullet) { return { kind: 'ul', text: bullet[1] }; }

	const numbered = OL_RE.exec(line);
	if (numbered) { return { kind: 'ol', text: numbered[1] }; }

	return { kind: 'p', text: line.trim() };
}

/**
 * Renders one block. A quote recurses, so a list or paragraph inside it is
 * rendered by the same rules rather than a second, drifting implementation.
 *
 * @param block - One grouped block.
 * @returns Its HTML.
 *
 * @example
 * renderBlock({ kind: 'ul', lines: ['a'] }); // → '<ul><li>a</li></ul>'
 */
function renderBlock(block: Block): string {
	switch (block.kind) {
		case 'h':     return `<h4>${renderInline(block.lines[0])}</h4>`;
		case 'ul':    return `<ul>${listItems(block.lines)}</ul>`;
		case 'ol':    return `<ol>${listItems(block.lines)}</ol>`;
		case 'quote': return `<blockquote>${renderMarkdownLite(block.lines.join('\n'))}</blockquote>`;
		default:      return `<p>${renderInline(block.lines.join(' '))}</p>`;
	}
}

/** Wraps each stripped list line in an `<li>`. */
function listItems(lines: string[]): string {
	return lines.map(line => `<li>${renderInline(line)}</li>`).join('');
}

/**
 * Renders inline markup, leaving code spans untouched — the split keeps them
 * whole so `` `a **b**` `` cannot grow a `<strong>` inside its own literal.
 *
 * @param text - One block's text.
 * @returns HTML for that text.
 *
 * @example
 * renderInline('`a **b**`'); // → '<code>a **b**</code>'
 */
function renderInline(text: string): string {
	return text
		.split(CODE_SPAN_RE)
		.map(segment => (segment.startsWith('`') && segment.endsWith('`') && segment.length > 1
			? `<code>${escHtml(segment.slice(1, -1))}</code>`
			: renderInlineText(segment)))
		.join('');
}

/**
 * Escapes one non-code segment, then applies links, bold, and italics **in that
 * order** — escaping first is what makes every later rule safe to run.
 *
 * @param segment - Raw text with no code span in it.
 * @returns Escaped HTML with the inline rules applied.
 *
 * @example
 * renderInlineText('**loud**'); // → '<strong>loud</strong>'
 */
function renderInlineText(segment: string): string {
	return escHtml(segment)
		.replaceAll(LINK_RE, (whole, label: string, url: string) => renderLink(whole, label, url))
		.replaceAll(BOLD_RE, '<strong>$1</strong>')
		.replaceAll(ITALIC_RE, '<em>$1</em>');
}

/**
 * Renders one link, or just its label when the scheme is not `http(s)`.
 *
 * A relative path is dropped deliberately: it resolves against the webview's
 * own URI, never the vault, so an anchor would be a promise the panel cannot
 * keep. `javascript:` and `data:` are dropped because they are the attack.
 *
 * @param whole - The full matched `[label](url)`, returned when the label is empty.
 * @param label - Already-escaped link text.
 * @param url   - Already-escaped target.
 * @returns An anchor, the bare label, or the original text.
 *
 * @example
 * renderLink('[d](https://x.test)', 'd', 'https://x.test');
 * // → '<a href="https://x.test">d</a>'
 */
function renderLink(whole: string, label: string, url: string): string {
	const scheme = url.toLowerCase();
	if (scheme.startsWith('http://') || scheme.startsWith('https://')) {
		return `<a href="${url}">${label}</a>`;
	}
	return label === '' ? whole : label;
}
