/**
 * Serialise a value to a canonical JSON string: object keys sorted, no
 * whitespace anywhere.
 *
 * Both sides of a test comparison are normalised through this function — the
 * extension runs it over `TestCase.expected`, and every test environment emits
 * the same shape from inside its own language. Without it, Java's
 * `Arrays.toString` (`[0, 1]`) could never equal `JSON.stringify` (`[0,1]`), and
 * two objects differing only in key order would compare unequal.
 *
 * `undefined` serialises to `null` so a function that forgets to return
 * produces a comparable value rather than the literal string `undefined`.
 *
 * @param value - Any JSON-compatible value.
 * @returns Canonical JSON text.
 *
 * @example
 * canonicalJson({ b: 1, a: [2, 3] }); // → '{"a":[2,3],"b":1}'
 * canonicalJson([0, 1]);              // → '[0,1]'
 */
export function canonicalJson(value: unknown): string {
	if (value === null || value === undefined) { return 'null'; }
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(',')}]`;
	}
	if (typeof value === 'object') {
		const entries = Object.keys(value as Record<string, unknown>)
			.sort((a, b) => a.localeCompare(b))
			.map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
		return `{${entries.join(',')}}`;
	}
	return JSON.stringify(value);
}
