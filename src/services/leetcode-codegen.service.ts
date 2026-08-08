import { SOLUTION_MARKER } from '../types/constants.js';
import { isLangId, type LangId } from '../types/languages.js';
import type { ParsedLeetCode } from '../types/leetcode.types.js';
import { javaBoilerplate, javaHarness, javaProgramBoilerplate } from './codegen/java.codegen.js';
import { jsBoilerplate, jsHarness, jsProgramBoilerplate } from './codegen/javascript.codegen.js';
import { pythonBoilerplate, pythonHarness, pythonProgramBoilerplate } from './codegen/python.codegen.js';
import { rustBoilerplate, rustHarness, rustProgramBoilerplate } from './codegen/rust.codegen.js';
import { tsBoilerplate, tsHarness, tsProgramBoilerplate } from './codegen/typescript.codegen.js';
import type { ProgramConfig } from './program-config.helpers.js';

/** Primitive → language-native lookup. */
const PRIMITIVES: Record<string, Record<string, string>> = {
	int:    { java: 'int',     python: 'int',   javascript: 'number',  typescript: 'number',  rust: 'i32'    },
	float:  { java: 'double',  python: 'float', javascript: 'number',  typescript: 'number',  rust: 'f64'    },
	string: { java: 'String',  python: 'str',   javascript: 'string',  typescript: 'string',  rust: 'String' },
	bool:   { java: 'boolean', python: 'bool',  javascript: 'boolean', typescript: 'boolean', rust: 'bool'   },
};

/** Java primitive → boxed type used inside generics (`Map<…>`). */
const JAVA_BOX: Record<string, string> = {
	int:     'Integer',
	boolean: 'Boolean',
	double:  'Double',
	float:   'Float',
	char:    'Character',
	long:    'Long',
};

/**
 * Native container syntax per language — the single dispatch table `mapType`
 * reads instead of a per-language `if` cascade. Presence of a key is what makes
 * a language "type-mappable"; `box` (Java only) auto-boxes primitives inside a
 * generic map. This set is deliberately broader than the runnable `LangId`s:
 * `rust` is type-mappable (for display) without being runnable.
 */
interface TypeSyntax {
	/** Wrap an already-mapped element type in the native array syntax. */
	array(inner: string): string;
	/** Wrap already-mapped key/value types in the native map syntax. */
	map(key: string, value: string): string;
	/** Primitive → boxed name for types appearing inside a generic map. */
	box?: Record<string, string>;
}

const TYPE_SYNTAX: Record<string, TypeSyntax> = {
	java:       { array: i => `${i}[]`,     map: (k, v) => `Map<${k}, ${v}>`,    box: JAVA_BOX },
	python:     { array: i => `List[${i}]`, map: (k, v) => `Dict[${k}, ${v}]` },
	javascript: { array: i => `${i}[]`,     map: (k, v) => `Record<${k}, ${v}>` },
	typescript: { array: i => `${i}[]`,     map: (k, v) => `Record<${k}, ${v}>` },
	rust:       { array: i => `Vec<${i}>`,  map: (k, v) => `HashMap<${k}, ${v}>` },
};

const MAP_RE = /^map<\s*([^,]+)\s*,\s*(.+?)\s*>$/;

/**
 * Translates a generic type expression (e.g. `int[]`, `map<string,int>`) into
 * its language-native equivalent for the target language.
 *
 * Recurses through array and map wrappers, applying the language's native
 * container syntax at each level. Unknown generic types pass through unchanged;
 * unknown languages return the generic expression as-is. For Java, primitive
 * types appearing inside a generic map (`Map<…>`) are auto-boxed
 * (`int` → `Integer`).
 *
 * @param genericType - Generic type expression from the artifact frontmatter.
 * @param language    - Target language id (e.g. `'java'`, `'python'`).
 * @returns Native type expression for the given language.
 *
 * @example
 * mapType('int[]', 'python');         // → 'List[int]'
 * mapType('map<string,int>', 'java'); // → 'Map<String, Integer>'
 */
export function mapType(genericType: string, language: string): string {
	const syntax = TYPE_SYNTAX[language];
	if (!syntax) { return genericType; }

	// Array — strip the trailing `[]` and recurse on the element type.
	if (genericType.endsWith('[]')) {
		return syntax.array(mapType(genericType.slice(0, -2), language));
	}

	// `map<K, V>` — recurse on K and V, box (Java only), then wrap.
	const mapM = MAP_RE.exec(genericType);
	if (mapM) {
		let k = mapType(mapM[1].trim(), language);
		let v = mapType(mapM[2].trim(), language);
		if (syntax.box) {
			k = syntax.box[k] ?? k;
			v = syntax.box[v] ?? v;
		}
		return syntax.map(k, v);
	}

	// Primitive lookup.
	const prim = PRIMITIVES[genericType];
	if (prim?.[language]) { return prim[language]; }

	// Passthrough for unknown generics (custom types, `void`, etc.).
	return genericType;
}

/**
 * Generates the runnable wrapper (imports, main, stdin reader) around a user's
 * candidate solution for the given language.
 *
 * Stub — throws until implemented.
 *
 * @param parsed   - Parsed LeetCode artifact (function, params, returns).
 * @param language - Target language id.
 * @returns Boilerplate source containing a `<<SOLUTION>>` marker.
 *
 * @example
 * generateBoilerplate(parsed, 'java');
 */
export function generateBoilerplate(parsed: ParsedLeetCode, language: string): string {
	return isLangId(language) ? LANG_CODEGEN[language].boilerplate(parsed) : '';
}

/**
 * Generates a per-language assert-based test harness from the parsed test
 * cases.
 *
 * Stub — throws until implemented.
 *
 * @param parsed   - Parsed LeetCode artifact (tests + signature).
 * @param language - Target language id.
 * @returns Harness source ready to be appended to the candidate solution.
 *
 * @example
 * generateTestHarness(parsed, 'python');
 */
export function generateTestHarness(parsed: ParsedLeetCode, language: string): string {
	return isLangId(language) ? LANG_CODEGEN[language].harness(parsed) : '';
}

/**
 * Per-runnable-language code generators, keyed by `LangId`. Adding a runnable
 * language is one entry here (plus a `TYPE_SYNTAX` row) rather than a new branch
 * in every `if (lang === …)` cascade. Presence in this map is exactly what makes
 * `generateBoilerplate` / `generateTestHarness` / `generateProgramBoilerplate`
 * emit for a language.
 */
interface LangCodegen {
	/** Runnable stdin/stdout wrapper carrying a `<<SOLUTION>>` marker. */
	boilerplate(parsed: ParsedLeetCode): string;
	/** Assert-based test harness for the parsed cases. */
	harness(parsed: ParsedLeetCode): string;
	/** `program`-type wrapper: reads the declared channel, writes `$LEET_OUT`. */
	programBoilerplate(parsed: ParsedLeetCode, config: ProgramConfig): string;
}

const LANG_CODEGEN: Record<LangId, LangCodegen> = {
	java:       { boilerplate: javaBoilerplate,   harness: javaHarness,   programBoilerplate: javaProgramBoilerplate },
	python:     { boilerplate: pythonBoilerplate, harness: pythonHarness, programBoilerplate: pythonProgramBoilerplate },
	javascript: { boilerplate: jsBoilerplate,     harness: jsHarness,     programBoilerplate: jsProgramBoilerplate },
	rust:       { boilerplate: rustBoilerplate,   harness: rustHarness,   programBoilerplate: rustProgramBoilerplate },
	typescript: { boilerplate: tsBoilerplate,     harness: tsHarness,     programBoilerplate: tsProgramBoilerplate },
};

/**
 * Generates the `program`-type Layer-1 starter: same signature shape as
 * {@link generateBoilerplate}, but the emitted `main` reads its case from the
 * channel declared in `config` (never a fixed stdin reader when the channel
 * is `argv`/`flags`) and writes the graded answer to `$LEET_OUT`
 * (`out-channel.ts`) instead of stdout — the defining trait of the `program`
 * test type over `call`.
 *
 * @param parsed   - Parsed LeetCode artifact (function name, params, returns).
 * @param language - Target language id.
 * @param config   - Parsed `program:` block (channel + optional flags).
 * @returns Program-shaped boilerplate containing exactly one `<<SOLUTION>>`
 *   marker, or `''` for a language with no registered codegen.
 *
 * @example
 * generateProgramBoilerplate(parsed, 'java', { channel: 'argv' });
 */
export function generateProgramBoilerplate(parsed: ParsedLeetCode, language: string, config: ProgramConfig): string {
	return isLangId(language) ? LANG_CODEGEN[language].programBoilerplate(parsed, config) : '';
}

/**
 * Converts a JSON value into a language-specific source-code literal.
 *
 * Stub — throws until implemented.
 *
 * @param value    - Any JSON-compatible value.
 * @param language - Target language id.
 * @returns Source-level literal for the value.
 *
 * @example
 * jsonToLiteral([1, 2, 3], 'java');
 */
export function jsonToLiteral(value: unknown, language: string, declaredType?: string): string {
	if (value === null) { return language === 'python' || language === 'rust' ? 'None' : 'null'; }
	if (typeof value === 'boolean') { return boolLiteral(value, language); }
	if (typeof value === 'number')  { return String(value); }
	if (typeof value === 'string')  { return stringLiteral(value, language); }
	if (Array.isArray(value))       { return arrayLiteral(value, language, declaredType); }
	if (typeof value === 'object')  { return objectLiteral(value as Record<string, unknown>, language); }
	if (value === undefined)        { return language === 'python' || language === 'rust' ? 'None' : 'undefined'; }
	return JSON.stringify(value);
}

/** Boolean → `true`/`false` for most languages, `True`/`False` for Python. */
function boolLiteral(value: boolean, language: string): string {
	if (language === 'python') { return value ? 'True' : 'False'; }
	return String(value);
}

/**
 * String → a quoted literal, `String::from("…")` for Rust.
 *
 * A `&str`-typed param still fails — at compile time, not at `validate` —
 * because `String::from(…)` always yields an owned `String`; the compiler
 * error names the mismatch clearly enough to skip a dedicated check here.
 */
function stringLiteral(value: string, language: string): string {
	if (language === 'rust') { return `String::from("${rustEscape(value)}")`; }
	return JSON.stringify(value);
}

/** Single-character escapes `rustc` requires literally — not derivable from JSON's. */
const RUST_CHAR_ESCAPES: Record<string, string> = {
	'\\': String.raw`\\`,
	'"': String.raw`\"`,
	'\n': String.raw`\n`,
	'\r': String.raw`\r`,
	'\t': String.raw`\t`,
	'\0': String.raw`\0`,
};

/** Prefix for Rust's `\u{…}` code-point escape — pulled out so the interpolated build below stays a single, non-nested template. */
const RUST_UNICODE_ESCAPE_PREFIX = String.raw`\u{`;

/**
 * Escape a raw string into the body of a Rust `"…"` literal, one character
 * at a time.
 *
 * Never chain a regex over `JSON.stringify`'s output to get here: JSON
 * escapes `\b`/`\f` the way Rust doesn't recognise them, but the bigger trap
 * is `a\b` (a literal backslash followed by the letter b) — its JSON form
 * `"a\\b"` ends in a `\b` substring that *looks* like the backspace escape
 * and isn't, so a `.replace(/\\b/g, …)` would silently corrupt it. Building
 * from the source string's actual characters sidesteps that entirely.
 *
 * @param value - Raw string to escape.
 * @returns Rust literal body, unquoted.
 *
 * @example
 * rustEscape('a\tb'); // → 'a\\tb'
 */
function rustEscape(value: string): string {
	let out = '';
	for (const ch of value) {
		const known = RUST_CHAR_ESCAPES[ch];
		if (known !== undefined) {
			out += known;
			continue;
		}
		const code = ch.codePointAt(0) ?? 0;
		out += code < 0x20 || code === 0x7f ? `${RUST_UNICODE_ESCAPE_PREFIX}${code.toString(16)}}` : ch;
	}
	return out;
}

/** Format an array as a language-specific list literal. */
function arrayLiteral(arr: unknown[], language: string, declaredType?: string): string {
	const items = arr.map(x => jsonToLiteral(x, language)).join(', ');
	if (language === 'java') {
		return `new ${javaElementType(arr, declaredType)}[]{${items}}`;
	}
	if (language === 'rust') {
		// ponytail: `vec![]` can't type-infer standalone for an empty array;
		// upgrade would thread the declared param type through — touches
		// five languages, not now.
		return `vec![${items}]`;
	}
	return `[${items}]`;
}

/**
 * Infer the Java element type of an array literal from its contents.
 *
 * Recurses through nested arrays so a matrix yields `int[]` (making the whole
 * literal `new int[][]{…}`). Without this, a `[[1,2],[3,4]]` argument renders as
 * `new Object[]{…}` and fails to compile against an `int[][]` parameter.
 *
 * An **empty** array has no contents to infer from, so the artifact's declared
 * parameter type is used instead: `[]` for an `int[]` parameter must render
 * `new int[]{}`, because `new Object[]{}` does not convert to `int[]` and the
 * whole suite fails to compile. An empty-array case is ordinary — "no items"
 * is the first edge case anyone writes — so leaving it to inference made a
 * normal exercise uncompilable.
 *
 * A heterogeneous array with no declared type still degrades to `Object`, which
 * compiles wherever an `Object[]` is accepted and fails loudly where it is not.
 *
 * @param arr          - Array whose element type is needed.
 * @param declaredType - The parameter's `params:` type, when one is known.
 * @returns Java type name, e.g. `'int'`, `'String'`, `'int[]'`.
 *
 * @example
 * javaElementType([1, 2]);           // → 'int'
 * javaElementType([[1], [2]]);       // → 'int[]'
 * javaElementType([], 'int[]');      // → 'int'
 * javaElementType([], 'int[][]');    // → 'int[]'
 */
function javaElementType(arr: unknown[], declaredType?: string): string {
	if (arr.length === 0) { return declaredElementType(declaredType) ?? 'Object'; }
	if (arr.every(e => typeof e === 'number' && Number.isInteger(e))) { return 'int'; }
	if (arr.every(e => typeof e === 'number'))  { return 'double'; }
	if (arr.every(e => typeof e === 'string'))  { return 'String'; }
	if (arr.every(e => typeof e === 'boolean')) { return 'boolean'; }
	if (arr.every(e => Array.isArray(e))) {
		return `${javaElementType(arr[0] as unknown[])}[]`;
	}
	return 'Object';
}


/**
 * The Java element type of a declared array parameter, e.g. `int[]` → `int`.
 *
 * Strips one `[]` and maps what remains through `TYPE_SYNTAX`, so a nested
 * `int[][]` yields `int[]` and an unmapped name is passed through as written.
 *
 * @param declaredType - A `params:` type, or `undefined` when none is known.
 * @returns The element type, or `undefined` when the declaration is not an array.
 *
 * @example
 * declaredElementType('int[]');    // → 'int'
 * declaredElementType('string[]'); // → 'String'
 * declaredElementType('int');      // → undefined
 */
function declaredElementType(declaredType?: string): string | undefined {
	if (declaredType === undefined || !declaredType.endsWith('[]')) { return undefined; }

	// `mapType` is the one authority for artifact type → native type, and it
	// already handles nesting: `int[]` → `int[]`, `string` → `String`.
	return mapType(declaredType.slice(0, -2), 'java');
}

/** Format an object as a language-specific dict/object literal. */
function objectLiteral(obj: Record<string, unknown>, language: string): string {
	if (language === 'rust') {
		const entries = Object.entries(obj).map(([k, v]) =>
			`(${stringLiteral(k, 'rust')}, ${jsonToLiteral(v, language)})`,
		);
		return `HashMap::from([${entries.join(', ')}])`;
	}
	const pairs = Object.entries(obj).map(([k, v]) =>
		`${JSON.stringify(k)}: ${jsonToLiteral(v, language)}`,
	);
	return `{${pairs.join(', ')}}`;
}

/**
 * Injects a candidate solution into a boilerplate wrapper at the first
 * `<<SOLUTION>>` marker, preserving the marker's indentation.
 *
 * Stub — throws until implemented.
 *
 * @param boilerplate - Wrapper source containing the marker.
 * @param solution    - User-supplied solution code.
 * @returns Combined source ready to compile/run.
 *
 * @example
 * injectSolution('    <<SOLUTION>>', 'return 0;');
 */
export function injectSolution(boilerplate: string, solution: string): string {
	const idx = boilerplate.indexOf(SOLUTION_MARKER);
	if (idx === -1) { return boilerplate + solution; }

	// Capture the marker line's leading whitespace so each solution line is
	// prefixed with the same indent — the first line inherits it for free
	// because we only replace the marker token itself.
	const lineStart = boilerplate.lastIndexOf('\n', idx - 1) + 1;
	const indentM   = /^\s*/.exec(boilerplate.slice(lineStart, idx));
	const indent    = indentM ? indentM[0] : '';

	const indented = solution === ''
		? ''
		: solution.split('\n').map((l, i) => i === 0 ? l : indent + l).join('\n');

	return boilerplate.slice(0, idx) + indented + boilerplate.slice(idx + SOLUTION_MARKER.length);
}
