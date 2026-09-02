/**
 * Cap on the length `sanitizeUntrustedText` returns, in characters. 200 is
 * far beyond any legitimate single-line config scalar this repo interpolates
 * into a verify reason (a title, a `type:` value, a declared name) while
 * still bounding the worst case an artifact can push into an operator's
 * scrollback -- or, per VSX-122 C12, a future webview.
 */
export const MAX_UNTRUSTED_TEXT_LEN = 200;

/**
 * The C0 (\x00-\x1F) and C1 (\x7F-\x9F) control ranges, one character
 * class, no nested quantifier (S8786) -- a flat character-class sweep,
 * never a backtracking-prone grammar.
 */
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F-\x9F]/g;

/**
 * Bounds and neutralises an untrusted string before it is interpolated into
 * a verify-reason message.
 *
 * A verify reason built from artifact-authored text (a frontmatter scalar,
 * a declared name) is untrusted the same way the artifact itself is: today
 * the only sink is CLI stdout, but the condition this closes is explicit
 * that a reason must be safe the day it reaches a webview too. Two things
 * an artifact must not be able to smuggle through it: an ANSI escape
 * sequence (`\x1B[31m...`) that recolours or repositions a terminal --
 * every such sequence opens with the ESC byte (`\x1B`), itself a C0
 * control character, so stripping the C0/C1 ranges removes the trigger
 * byte and leaves only inert printable text behind -- and an unbounded
 * length that could push a megabyte of artifact text into an operator's
 * scrollback.
 *
 * @param value - Untrusted text to bound and clean.
 * @param maxLen - Cap on the returned string's length, in characters.
 *   Defaults to `MAX_UNTRUSTED_TEXT_LEN`.
 * @returns `value` with every C0/C1 control character removed, then
 *   truncated to `maxLen` with a visible `...[truncated]` marker appended
 *   when it no longer fits whole -- a silently truncated value would
 *   misrepresent what the artifact actually declared.
 *
 * @example
 * sanitizeUntrustedText('\x1B[31mFAKE\x1B[0m'); // -> '[31mFAKE[0m'
 * @example
 * sanitizeUntrustedText('a'.repeat(500)).endsWith('...[truncated]'); // -> true
 */
export function sanitizeUntrustedText(value: string, maxLen: number = MAX_UNTRUSTED_TEXT_LEN): string {
	const clean = value.replace(CONTROL_CHARS_RE, '');
	return clean.length > maxLen ? `${clean.slice(0, maxLen)}...[truncated]` : clean;
}
