/**
 * A deliberately small YAML subset for `## Tests` / `## Final Tests` case data,
 * plus the emitter that writes it.
 *
 * **Why a subset, and why these exact rules.** Test data is the one place in an
 * artifact where a silently wrong *value* is worse than a loud parse failure:
 * an exercise's reference solution is graded against its own expecteds, so a
 * mistyped expected makes the harness verify **green while teaching the wrong
 * answer**. Full YAML 1.1 implicit typing would do exactly that to this vault —
 * measured across its artifacts: 126 number-like strings (`"6321"`), 28
 * bool-like (`"false"`, `"yes"`), 12 octal-like (`"0051"` → 41), 8 sexagesimal
 * (`"1:1"` → 61) and 5 empty strings (→ null).
 *
 * So this parser implements **JSON's type system with YAML's syntax**:
 *
 * - a **quoted** scalar is *always* a string, never re-typed;
 * - an **unquoted** scalar is typed only by JSON's own rules — exact `true` /
 *   `false`, `null` (and `~`), and strict JSON number syntax;
 * - every YAML 1.1 legacy form is **left as a string**: `yes`/`no`/`on`/`off`,
 *   `y`/`n`, leading-zero octals, sexagesimals, `.inf`/`.nan`.
 *
 * The emitter is the other half of that contract: it quotes any string that
 * would not read back identically, so `emit → parse` is the identity on every
 * value JSON can express.
 *
 * Out of scope by design (each is a parser-complexity or ambiguity risk with no
 * use in case data): anchors and aliases, explicit tags, multiple documents,
 * block scalars (`|`, `>`), complex keys, and merge keys.
 */

/** Structural characters that force a plain scalar to be quoted on emit. */
const NEEDS_QUOTE_CHARS = /[:#,[\]{}&*!|>'"%@`]/;
/** Strict JSON number syntax — the only numeric form an unquoted scalar may take. */
const JSON_NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
/** A plain scalar safe to emit unquoted: no structural chars, no leading/trailing space. */
const PLAIN_SAFE_RE = /^[A-Za-z_][A-Za-z0-9_ .\-/()]*$/;

/**
 * Types one unquoted scalar using JSON's rules only.
 *
 * Anything that is not exactly `true`, `false`, `null`/`~`, or strict JSON
 * number syntax stays a **string**. That is the whole safety property: YAML
 * 1.1's `yes`, `off`, `0051` and `1:1` all fall through to string here.
 *
 * @param raw - The scalar text, already trimmed and known to be unquoted.
 * @returns The typed value.
 *
 * @example
 * typePlainScalar('3');     // → 3
 * typePlainScalar('0051');  // → '0051'  (not octal 41)
 * typePlainScalar('no');    // → 'no'    (not false)
 */
function typePlainScalar(raw: string): unknown {
	if (raw === 'true') { return true; }
	if (raw === 'false') { return false; }
	if (raw === 'null' || raw === '~') { return null; }
	if (JSON_NUMBER_RE.test(raw)) { return Number(raw); }
	return raw;
}

/** Reads a quoted scalar starting at `i`; returns the value and the index after the closing quote. */
function readQuoted(text: string, i: number): { value: string; next: number } | null {
	const quote = text[i];
	let out = '';
	let j = i + 1;
	while (j < text.length) {
		const ch = text[j];
		if (ch === '\\' && quote === '"' && j + 1 < text.length) {
			const esc = text[j + 1];
			if (esc === 'n') { out += '\n'; }
			else if (esc === 't') { out += '\t'; }
			else if (esc === 'r') { out += '\r'; }
			else { out += esc; }
			j += 2;
			continue;
		}
		// YAML's single-quote escape is a doubled quote.
		if (ch === "'" && quote === "'" && text[j + 1] === "'") { out += "'"; j += 2; continue; }
		if (ch === quote) { return { value: out, next: j + 1 }; }
		out += ch;
		j++;
	}
	return null;
}

/** Strips a trailing `# comment`, honouring quotes so a `#` inside a string survives. */
function stripComment(line: string): string {
	let quote: string | null = null;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quote) {
			if (ch === '\\' && quote === '"') { i++; continue; }
			if (ch === quote) { quote = null; }
			continue;
		}
		if (ch === '"' || ch === "'") { quote = ch; continue; }
		if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) { return line.slice(0, i); }
	}
	return line;
}

/** Result of parsing one flow collection or scalar. */
interface FlowRead { value: unknown; next: number }

/** Parses a flow value (`[...]`, `{...}`, or a scalar) starting at `i`. */
function readFlow(text: string, i: number): FlowRead | null {
	let k = i;
	while (k < text.length && /\s/.test(text[k])) { k++; }
	if (k >= text.length) { return null; }
	if (text[k] === '[') { return readFlowSeq(text, k); }
	if (text[k] === '{') { return readFlowMap(text, k); }
	if (text[k] === '"' || text[k] === "'") {
		const q = readQuoted(text, k);
		return q ? { value: q.value, next: q.next } : null;
	}
	let end = k;
	while (end < text.length && !',]}'.includes(text[end])) { end++; }
	const raw = text.slice(k, end).trim();
	if (raw === '') { return null; }
	return { value: typePlainScalar(raw), next: end };
}

/** Parses `[a, b, …]` starting at the `[`. */
function readFlowSeq(text: string, i: number): FlowRead | null {
	const out: unknown[] = [];
	let k = i + 1;
	for (;;) {
		while (k < text.length && /[\s,]/.test(text[k])) { k++; }
		if (k >= text.length) { return null; }
		if (text[k] === ']') { return { value: out, next: k + 1 }; }
		const item = readFlow(text, k);
		if (!item) { return null; }
		out.push(item.value);
		k = item.next;
	}
}

/** Reads a flow-map key (quoted or bare) and returns it with the index of its `:`. */
function readFlowKey(text: string, i: number): { key: string; next: number } | null {
	if (text[i] === '"' || text[i] === "'") {
		const q = readQuoted(text, i);
		return q ? { key: q.value, next: q.next } : null;
	}
	const colon = text.indexOf(':', i);
	if (colon === -1) { return null; }
	return { key: text.slice(i, colon).trim(), next: colon };
}

/** Reads one `key: value` pair of a flow map, or `null` when it is malformed. */
function readFlowPair(text: string, i: number): { key: string; value: unknown; next: number } | null {
	const keyed = readFlowKey(text, i);
	if (!keyed) { return null; }
	let k = keyed.next;
	while (k < text.length && text[k] !== ':') { k++; }
	if (k >= text.length) { return null; }
	const val = readFlow(text, k + 1);
	return val ? { key: keyed.key, value: val.value, next: val.next } : null;
}

/** Parses `{a: 1, …}` starting at the `{`. */
function readFlowMap(text: string, i: number): FlowRead | null {
	const out: Record<string, unknown> = {};
	let k = i + 1;
	for (;;) {
		while (k < text.length && /[\s,]/.test(text[k])) { k++; }
		if (k >= text.length) { return null; }
		if (text[k] === '}') { return { value: out, next: k + 1 }; }

		const pair = readFlowPair(text, k);
		if (!pair) { return null; }
		if (isSafeKey(pair.key)) { out[pair.key] = pair.value; }
		k = pair.next;
	}
}

/** Keys that would reach through an object's prototype are never assignment targets. */
function isSafeKey(key: string): boolean {
	return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/** One physical line, pre-split into indent and content. */
interface Line { indent: number; text: string }

/** Splits `raw` into non-blank, comment-stripped lines with their indent depth. */
function toLines(raw: string): Line[] {
	const out: Line[] = [];
	for (const physical of raw.split('\n')) {
		const noCr = physical.endsWith('\r') ? physical.slice(0, -1) : physical;
		// `trimEnd()` rather than `/\s+$/` — the regex backtracks on a long
		// whitespace run, and this walks artifact-controlled text.
		const text = stripComment(noCr).trimEnd();
		if (text.trim() === '') { continue; }
		out.push({ indent: /^ */.exec(text)?.[0].length ?? 0, text: text.trim() });
	}
	return out;
}

/** Parser cursor over the line array. */
interface Cursor { lines: Line[]; i: number }

/** Parses a block sequence (`- item` lines) at `indent`. */
function parseSeq(cur: Cursor, indent: number): unknown[] {
	const out: unknown[] = [];
	while (cur.i < cur.lines.length) {
		const line = cur.lines[cur.i];
		if (line.indent !== indent || !line.text.startsWith('- ') && line.text !== '-') { break; }

		const inline = line.text === '-' ? '' : line.text.slice(2).trim();
		if (inline === '') {
			cur.i++;
			out.push(parseNode(cur, indent + 1));
			continue;
		}
		// `- key: value` opens a mapping whose remaining keys sit at the
		// column the key itself starts at.
		const keyed = splitKey(inline);
		if (keyed) {
			const childIndent = indent + 2;
			cur.lines[cur.i] = { indent: childIndent, text: inline };
			out.push(parseMap(cur, childIndent));
			continue;
		}
		cur.i++;
		out.push(scalarOrFlow(inline));
	}
	return out;
}

/** Splits `key: rest`, returning null when the line is not a mapping entry. */
function splitKey(text: string): { key: string; rest: string } | null {
	if (text.startsWith('"') || text.startsWith("'")) {
		const q = readQuoted(text, 0);
		if (q && text[q.next] === ':') { return { key: q.value, rest: text.slice(q.next + 1).trim() }; }
		return null;
	}
	// `indexOf` rather than a regex: `/^([^:]+):(?:\s(.*))?$/` backtracks on a
	// long colonless line, and this runs over artifact-controlled text.
	const colon = text.indexOf(':');
	if (colon <= 0) { return null; }
	const rest = text.slice(colon + 1);
	// A key must be followed by end-of-line or whitespace — `a:b` is a scalar,
	// not a mapping, which is what keeps `1:1` and URLs out of key position.
	if (rest !== '' && !/^\s/.test(rest)) { return null; }
	return { key: text.slice(0, colon).trim(), rest: rest.trim() };
}

/** Parses a block mapping at `indent`. */
function parseMap(cur: Cursor, indent: number): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	while (cur.i < cur.lines.length) {
		const line = cur.lines[cur.i];
		if (line.indent !== indent) { break; }
		const kv = splitKey(line.text);
		if (!kv) { break; }
		cur.i++;
		const value = kv.rest === '' ? parseNode(cur, indent + 1) : scalarOrFlow(kv.rest);
		if (isSafeKey(kv.key)) { out[kv.key] = value; }
	}
	return out;
}

/** Parses whichever node begins at or beyond `minIndent`. */
function parseNode(cur: Cursor, minIndent: number): unknown {
	if (cur.i >= cur.lines.length) { return null; }
	const line = cur.lines[cur.i];
	if (line.indent < minIndent) { return null; }
	if (line.text.startsWith('- ') || line.text === '-') { return parseSeq(cur, line.indent); }
	return parseMap(cur, line.indent);
}

/** A scalar or a flow collection, as written after a `key:` or a `- `. */
function scalarOrFlow(text: string): unknown {
	const flow = readFlow(text, 0);
	return flow ? flow.value : typePlainScalar(text);
}

/**
 * Parses a ` ```yaml ` case fence into the same shape `JSON.parse` would give.
 *
 * Never throws — malformed input degrades to `null`, exactly as
 * `safeJsonParse` does, so a bad fence costs its own cases and nothing else.
 *
 * @param raw - Fence body text.
 * @returns The parsed value, or `null` when it cannot be read.
 *
 * @example
 * parseYamlCases('- input:\n    x: 1\n  expected: 2');
 * // → [{ input: { x: 1 }, expected: 2 }]
 */
export function parseYamlCases(raw: string): unknown {
	try {
		const lines = toLines(raw);
		if (lines.length === 0) { return []; }
		const cur: Cursor = { lines, i: 0 };
		const value = parseNode(cur, lines[0].indent);
		// Trailing unconsumed lines mean the shape was not understood; refusing
		// beats returning a silently truncated suite.
		return cur.i === lines.length ? value : null;
	} catch {
		return null;
	}
}

// ── emitter ──────────────────────────────────────────────────────────────────

/**
 * Renders one scalar, quoting whenever a plain form would not read back
 * identically.
 *
 * This is the emitter half of the round-trip contract: every string that could
 * be re-typed by `typePlainScalar` — or that carries a structural character —
 * comes out quoted.
 *
 * @param value - Any JSON scalar.
 * @returns YAML text for it.
 *
 * @example
 * emitScalar('0051'); // → '"0051"'
 * emitScalar(3);      // → '3'
 */
function emitScalar(value: unknown): string {
	if (value === null) { return 'null'; }
	if (typeof value === 'boolean' || typeof value === 'number') { return JSON.stringify(value); }
	// Anything that is not a string by this point cannot be rendered as a
	// scalar — `String({})` would silently emit `[object Object]`, losing data.
	if (typeof value !== 'string') { return JSON.stringify(value ?? null); }
	const s = value;
	// Leading/trailing whitespace **must** be quoted: the line reader trims every
	// scalar, so an unquoted `a ` reads back as `a`. `PLAIN_SAFE_RE` permits an
	// inner space, which makes a trailing one look safe when it is not.
	if (s !== s.trim()) { return JSON.stringify(s); }
	if (!PLAIN_SAFE_RE.test(s) || NEEDS_QUOTE_CHARS.test(s)) { return JSON.stringify(s); }
	// Plain-safe by shape, but still re-typed if it looks like a JSON literal.
	return typePlainScalar(s) === s ? s : JSON.stringify(s);
}

/** Renders a value in flow style — used for every nested collection. */
function emitFlow(value: unknown): string {
	if (Array.isArray(value)) { return '[' + value.map(emitFlow).join(', ') + ']'; }
	if (value !== null && typeof value === 'object') {
		const parts = Object.entries(value as Record<string, unknown>)
			.map(([k, v]) => emitScalar(k) + ': ' + emitFlow(v));
		return '{' + parts.join(', ') + '}';
	}
	return emitScalar(value);
}

/**
 * Renders a `TestCase[]` as the block-sequence YAML the migrator writes.
 *
 * Each case is one `- ` entry; `input`'s members become indented keys so the
 * per-parameter values line up, and everything below that is flow style — the
 * shape that stays readable without needing a block-scalar grammar.
 *
 * @param cases - The parsed cases, exactly as JSON held them.
 * @returns YAML text, no trailing newline.
 *
 * @example
 * emitYamlCases([{ input: { x: 1 }, expected: 2 }]);
 * // → '- input:\n    x: 1\n  expected: 2'
 */
export function emitYamlCases(cases: unknown[]): string {
	const out: string[] = [];
	for (const one of cases) {
		if (one === null || typeof one !== 'object' || Array.isArray(one)) {
			out.push('- ' + emitFlow(one));
			continue;
		}
		const entries = Object.entries(one as Record<string, unknown>);
		// Same trap as an empty `input:` — a `- ` with nothing under it reads
		// back as `null`, not as an empty mapping.
		if (entries.length === 0) { out.push('- {}'); continue; }
		const lines: string[] = [];
		for (const [key, value] of entries) {
			// An **empty** map must stay flow (`input: {}`): written as a block
			// header with no children it reads back as `null`, silently turning a
			// no-argument case into a broken one.
			const isInputMap = key === 'input' && value !== null
				&& typeof value === 'object' && !Array.isArray(value)
				&& Object.keys(value as Record<string, unknown>).length > 0;
			if (!isInputMap) {
				lines.push(emitScalar(key) + ': ' + emitFlow(value));
				continue;
			}
			lines.push(emitScalar(key) + ':');
			for (const [pk, pv] of Object.entries(value as Record<string, unknown>)) {
				lines.push('  ' + emitScalar(pk) + ': ' + emitFlow(pv));
			}
		}
		out.push('- ' + lines.join('\n  '));
	}
	return out.join('\n');
}
