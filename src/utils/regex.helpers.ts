/**
 * Escape a string for literal use inside a `RegExp`.
 *
 * Pure, cross-cutting — shared by every call site that interpolates a
 * user/artifact-supplied name (a function name, a language id) into a
 * `RegExp` constructor, so a name containing a regex-special character (e.g.
 * `a.b`, `f[x]`) is matched literally instead of as a pattern.
 *
 * @param literal - Raw string to embed in a `RegExp`.
 * @returns `literal` with every regex-special character backslash-escaped.
 *
 * @example
 * new RegExp(escapeRe('a.b(c)')).test('a.b(c)'); // → true
 * new RegExp(escapeRe('a.b(c)')).test('axb(c)'); // → false
 */
export function escapeRe(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
