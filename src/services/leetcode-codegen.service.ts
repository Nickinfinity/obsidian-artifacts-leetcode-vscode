import { SOLUTION_MARKER } from '../types/constants.js';
import { isLangId, type LangId } from '../types/languages.js';
import type { ParsedLeetCode } from '../types/leetcode.types.js';
import { javaBoilerplate, javaHarness } from './codegen/java.codegen.js';
import { jsBoilerplate, jsHarness } from './codegen/javascript.codegen.js';
import { pythonBoilerplate, pythonHarness } from './codegen/python.codegen.js';

/** Primitive → language-native lookup. */
const PRIMITIVES: Record<string, Record<string, string>> = {
	int:    { java: 'int',     python: 'int',   javascript: 'number',  rust: 'i32'    },
	float:  { java: 'double',  python: 'float', javascript: 'number',  rust: 'f64'    },
	string: { java: 'String',  python: 'str',   javascript: 'string',  rust: 'String' },
	bool:   { java: 'boolean', python: 'bool',  javascript: 'boolean', rust: 'bool'   },
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
 * `generateBoilerplate` / `generateTestHarness` emit for a language.
 */
interface LangCodegen {
	/** Runnable stdin/stdout wrapper carrying a `<<SOLUTION>>` marker. */
	boilerplate(parsed: ParsedLeetCode): string;
	/** Assert-based test harness for the parsed cases. */
	harness(parsed: ParsedLeetCode): string;
}

const LANG_CODEGEN: Record<LangId, LangCodegen> = {
	java:       { boilerplate: javaBoilerplate,   harness: javaHarness },
	python:     { boilerplate: pythonBoilerplate, harness: pythonHarness },
	javascript: { boilerplate: jsBoilerplate,     harness: jsHarness },
};

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
export function jsonToLiteral(value: unknown, language: string): string {
	if (value === null) { return language === 'python' ? 'None' : 'null'; }
	if (typeof value === 'boolean') { return boolLiteral(value, language); }
	if (typeof value === 'number')  { return String(value); }
	if (typeof value === 'string')  { return JSON.stringify(value); }
	if (Array.isArray(value))       { return arrayLiteral(value, language); }
	if (typeof value === 'object')  { return objectLiteral(value as Record<string, unknown>, language); }
	if (value === undefined)        { return language === 'python' ? 'None' : 'undefined'; }
	return JSON.stringify(value);
}

/** Boolean → `true`/`false` for most languages, `True`/`False` for Python. */
function boolLiteral(value: boolean, language: string): string {
	if (language === 'python') { return value ? 'True' : 'False'; }
	return String(value);
}

/** Format an array as a language-specific list literal. */
function arrayLiteral(arr: unknown[], language: string): string {
	const items = arr.map(x => jsonToLiteral(x, language)).join(', ');
	if (language === 'java') {
		return `new ${javaElementType(arr)}[]{${items}}`;
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
 * A heterogeneous or empty array degrades to `Object`, which compiles wherever
 * an `Object[]` is accepted and fails loudly where it is not — the honest
 * outcome for a test case whose shape the type system cannot recover.
 *
 * @param arr - Array whose element type is needed.
 * @returns Java type name, e.g. `'int'`, `'String'`, `'int[]'`.
 *
 * @example
 * javaElementType([1, 2]);       // → 'int'
 * javaElementType([[1], [2]]);   // → 'int[]'
 */
function javaElementType(arr: unknown[]): string {
	if (arr.length === 0) { return 'Object'; }
	if (arr.every(e => typeof e === 'number' && Number.isInteger(e))) { return 'int'; }
	if (arr.every(e => typeof e === 'number'))  { return 'double'; }
	if (arr.every(e => typeof e === 'string'))  { return 'String'; }
	if (arr.every(e => typeof e === 'boolean')) { return 'boolean'; }
	if (arr.every(e => Array.isArray(e))) {
		return `${javaElementType(arr[0] as unknown[])}[]`;
	}
	return 'Object';
}

/** Format an object as a language-specific dict/object literal. */
function objectLiteral(obj: Record<string, unknown>, language: string): string {
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
