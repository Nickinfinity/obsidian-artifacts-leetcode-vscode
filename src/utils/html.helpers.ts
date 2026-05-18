/**
 * Escapes the five HTML-significant characters so arbitrary strings can be
 * safely embedded inside webview HTML.
 *
 * @param s - Raw string to escape.
 * @returns The string with `& < > " '` replaced by their HTML entities.
 *
 * @example
 * escHtml('<VK-x> & "y"') // → '&lt;VK-x&gt; &amp; &quot;y&quot;'
 */
export function escHtml(s: string): string {
	return s.replaceAll(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
