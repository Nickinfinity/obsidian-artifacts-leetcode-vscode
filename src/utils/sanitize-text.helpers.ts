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
 * Bidirectional-control code points -- LRM/RLM, the LRE/RLE/PDF/LRO/RLO
 * embeddings and overrides, and the LRI/RLI/FSI/PDI isolates -- that can
 * reorder how text *renders* without a single C0/C1 byte involved (the
 * "Trojan Source" mechanism, CVE-2021-42574): an unterminated RLO reorders
 * the remainder of the bidi paragraph, including text the tool itself wrote
 * after the artifact's value. Its own regex, shared by both sanitizers below
 * rather than duplicated into each one's character class, so this is the
 * single authority for "what a terminal/webview/log viewer must not be
 * handed" on the bidi axis.
 *
 * Written as `\u{XXXX}` escapes, never the literal characters, so this
 * source file carries no invisible bidi text of its own to review or diff.
 * One flat character class, ranges only, no nested quantifier (S8786).
 */
const BIDI_CONTROL_CHARS_RE = /[\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;

/**
 * Bounds and neutralises an untrusted string before it is interpolated into
 * a verify-reason message.
 *
 * A verify reason built from artifact-authored text (a frontmatter scalar,
 * a declared name) is untrusted the same way the artifact itself is: today
 * the only sink is CLI stdout, but the condition this closes is explicit
 * that a reason must be safe the day it reaches a webview too. Three things
 * an artifact must not be able to smuggle through it: an ANSI escape
 * sequence (`\x1B[31m...`) that recolours or repositions a terminal (every
 * such sequence opens with the ESC byte, itself a C0 control character); a
 * bidirectional-control code point that reorders rendered text, including
 * text the tool itself appended after the artifact's value; and an
 * unbounded length that could push a megabyte of artifact text into an
 * operator's scrollback.
 *
 * **What this guarantees, precisely:** the returned string contains none of
 * the C0/C1 control bytes and none of the named bidi-control code points --
 * so the ESC byte that opens every ANSI escape sequence is gone, and so is
 * every code point in `BIDI_CONTROL_CHARS_RE`. It does **not** guarantee the
 * result is inert against every possible terminal or renderer quirk (other
 * Unicode formatting characters -- zero-width joiners, variation selectors
 * -- are out of scope for this pass); it closes the two mechanisms named
 * above, not "every way text can lie about itself."
 *
 * @param value - Untrusted text to bound and clean.
 * @param maxLen - Cap on the returned string's length, in characters.
 *   Defaults to `MAX_UNTRUSTED_TEXT_LEN`.
 * @returns `value` with every C0/C1 control character and bidi-control code
 *   point removed, then truncated to `maxLen` with a visible
 *   `...[truncated]` marker appended when it no longer fits whole -- a
 *   silently truncated value would misrepresent what the artifact actually
 *   declared.
 *
 * @example
 * sanitizeUntrustedText('\x1B[31mFAKE\x1B[0m'); // -> '[31mFAKE[0m'
 * @example
 * sanitizeUntrustedText('a'.repeat(500)).endsWith('...[truncated]'); // -> true
 */
export function sanitizeUntrustedText(value: string, maxLen: number = MAX_UNTRUSTED_TEXT_LEN): string {
	const clean = value.replace(CONTROL_CHARS_RE, '').replace(BIDI_CONTROL_CHARS_RE, '');
	return clean.length > maxLen ? `${clean.slice(0, maxLen)}...[truncated]` : clean;
}

/**
 * Cap on the length `sanitizeChildOutput` returns, in characters. Far larger
 * than `MAX_UNTRUSTED_TEXT_LEN` (20x) because its callers are multi-line
 * child-process output -- a `build` check's whole stderr, a program suite's
 * failure detail -- that a human reads to find out *why* an exercise failed.
 * The 200-char scalar cap is right for a title or a `type:` value; applied
 * here it would throw away the one line that names the actual error.
 */
export const MAX_CHILD_OUTPUT_LEN = 4000;

/**
 * The same C0/C1 sweep as `CONTROL_CHARS_RE`, minus `\t` (0x09) and `\n`
 * (0x0A) -- both semantically load-bearing in multi-line child output. `\r`
 * (0x0D) stays stripped alongside ESC (0x1B): a bare carriage return can
 * overwrite already-rendered terminal text without needing an escape
 * sequence at all, so it is a spoofing vector in its own right, not a
 * character worth preserving. One flat character class, ranges only, no
 * nested quantifier (S8786). The bidi-control sweep is a second, shared
 * regex (`BIDI_CONTROL_CHARS_RE`) applied alongside this one -- multi-line
 * child output has no more legitimate need for a bidi override than a
 * single-line scalar does, so both sanitizers strip the identical set from
 * one authority rather than each declaring its own copy.
 */
const CHILD_OUTPUT_CONTROL_CHARS_RE = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/g;

/**
 * Bounds and neutralises untrusted **child process output** before it is
 * printed or interpolated into a verify-reason message.
 *
 * `sanitizeUntrustedText` is right for a single-line artifact-authored
 * scalar (a check name, a `test.type` value) and wrong for this: a compiler
 * diagnostic or a `build` check's stderr is multi-line by nature, and
 * flattening it to 200 characters discards exactly the line a human reads to
 * find out why an exercise failed. This sibling keeps `\n` and `\t` intact,
 * strips the same ESC/C1 terminal-control range plus a bare `\r` plus the
 * same bidi-control code points `sanitizeUntrustedText` strips (an artifact's
 * own `build` argv can emit these directly into stderr; multi-line text has
 * no more legitimate need for an RLO than a single-line scalar does), and
 * uses a far more generous length cap.
 *
 * **What this guarantees** mirrors `sanitizeUntrustedText`'s guarantee,
 * minus the length: no C0/C1 control byte (bar `\n`/`\t`) and no bidi-control
 * code point survives. It is not a claim that the result is inert against
 * every possible renderer quirk -- see that function's docblock.
 *
 * **Display-only -- never insert this between a raw failure detail and
 * `classifyStarterFailure`.** `--starter-red`'s INCONCLUSIVE detection reads
 * that text verbatim (`scripts/verify-exercise.mjs`'s `details` arrays), and
 * a sanitised/truncated copy could silently reclassify a broken toolchain as
 * the candidate's own fault. Apply this only at the point a value is
 * printed or embedded in a message, strictly after classification has run.
 *
 * @param value - Untrusted, potentially multi-line child output.
 * @param maxLen - Cap on the returned string's length, in characters.
 *   Defaults to `MAX_CHILD_OUTPUT_LEN`.
 * @returns `value` with ESC/C1/CR, the rest of the C0 range, and every
 *   bidi-control code point removed (newlines and tabs preserved), then
 *   truncated to `maxLen` with a visible `...[truncated]` marker when it no
 *   longer fits whole.
 *
 * @example
 * sanitizeChildOutput('line one\n\x1B[31mline two\x1B[0m\nline three');
 * // -> 'line one\n[31mline two[0m\nline three'
 * @example
 * sanitizeChildOutput('a'.repeat(10_000)).endsWith('...[truncated]'); // -> true
 */
export function sanitizeChildOutput(value: string, maxLen: number = MAX_CHILD_OUTPUT_LEN): string {
	const clean = value.replace(CHILD_OUTPUT_CONTROL_CHARS_RE, '').replace(BIDI_CONTROL_CHARS_RE, '');
	return clean.length > maxLen ? `${clean.slice(0, maxLen)}...[truncated]` : clean;
}
