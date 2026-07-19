/**
 * Parse `text` as JSON, returning `null` instead of throwing on malformed input.
 *
 * The single guarded-`JSON.parse` used everywhere untrusted text is decoded: the
 * `## Tests` fence, the `<!-- meta: … -->` / `<!-- attempt: … -->` comments, and
 * a test program's sentinel result lines (where a line truncated by a
 * timeout-kill must be skipped, not fatal). Callers narrow the `unknown` result
 * themselves — this only owns "don't throw".
 *
 * @typeParam T - Expected shape; the caller is responsible for validating it.
 * @param text - Candidate JSON string.
 * @returns The parsed value, or `null` when `text` is not valid JSON.
 *
 * @example
 * safeJsonParse<{ index: number }>('{"index":0}'); // → { index: 0 }
 * safeJsonParse('{ truncated');                     // → null
 */
export function safeJsonParse<T = unknown>(text: string): T | null {
	try {
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}
