import type { ParsedLeetCode } from '../types/leetcode.types.js';

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

/** Languages that mapType knows how to translate to. */
const SUPPORTED_LANGS = new Set(['java', 'python', 'javascript', 'rust']);

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
	if (!SUPPORTED_LANGS.has(language)) { return genericType; }

	// Array — strip the trailing `[]` and recurse on the element type.
	if (genericType.endsWith('[]')) {
		const inner = mapType(genericType.slice(0, -2), language);
		return wrapArray(inner, language);
	}

	// `map<K, V>` — recurse on K and V, then wrap with language container.
	const mapM = MAP_RE.exec(genericType);
	if (mapM) {
		let k = mapType(mapM[1].trim(), language);
		let v = mapType(mapM[2].trim(), language);
		if (language === 'java') {
			k = JAVA_BOX[k] ?? k;
			v = JAVA_BOX[v] ?? v;
		}
		return wrapMap(k, v, language);
	}

	// Primitive lookup.
	const prim = PRIMITIVES[genericType];
	if (prim?.[language]) { return prim[language]; }

	// Passthrough for unknown generics (custom types, `void`, etc.).
	return genericType;
}

/**
 * Wraps `inner` in the language's native array syntax.
 *
 * @param inner    - Already-mapped element type.
 * @param language - Target language id.
 * @returns Array-typed expression for the language.
 *
 * @example
 * wrapArray('int', 'rust'); // → 'Vec<int>'
 */
function wrapArray(inner: string, language: string): string {
	if (language === 'python') { return `List[${inner}]`; }
	if (language === 'rust')   { return `Vec<${inner}>`; }
	return `${inner}[]`;
}

/**
 * Wraps `k` / `v` in the language's native map/dictionary syntax.
 *
 * @param k        - Already-mapped key type.
 * @param v        - Already-mapped value type.
 * @param language - Target language id.
 * @returns Map-typed expression for the language.
 *
 * @example
 * wrapMap('String', 'Integer', 'java'); // → 'Map<String, Integer>'
 */
function wrapMap(k: string, v: string, language: string): string {
	if (language === 'java')       { return `Map<${k}, ${v}>`; }
	if (language === 'python')     { return `Dict[${k}, ${v}]`; }
	if (language === 'javascript') { return `Record<${k}, ${v}>`; }
	if (language === 'rust')       { return `HashMap<${k}, ${v}>`; }
	return `${k}, ${v}`;
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
	if (language === 'java')       { return javaBoilerplate(parsed); }
	if (language === 'python')     { return pythonBoilerplate(parsed); }
	if (language === 'javascript') { return jsBoilerplate(parsed); }
	return '';
}

/** Java wrapper: imports + `class Main` + signature + Scanner stdin + System.out.print. */
function javaBoilerplate(p: ParsedLeetCode): string {
	const ret    = mapType(p.returns, 'java');
	const params = p.params.map(pa => `${mapType(pa.type, 'java')} ${pa.name}`).join(', ');
	const readers = p.params.map(pa => `\t\t// read ${pa.name} from sc`).join('\n');
	return [
		'import java.util.*;',
		'',
		'class Main {',
		`\tpublic static ${ret} ${p.functionName}(${params}) {`,
		'\t\t<<SOLUTION>>',
		'\t}',
		'',
		'\tpublic static void main(String[] args) {',
		'\t\tScanner sc = new Scanner(System.in);',
		readers,
		'\t\tSystem.out.print("");',
		'\t}',
		'}',
		'',
	].join('\n');
}

/** Python wrapper: `def` + `if __name__ == "__main__":` + `input()`. */
function pythonBoilerplate(p: ParsedLeetCode): string {
	const params = p.params.map(pa => pa.name).join(', ');
	const reads  = p.params.map(pa => `\t${pa.name} = input()`).join('\n');
	return [
		`def ${p.functionName}(${params}):`,
		'\t<<SOLUTION>>',
		'',
		'if __name__ == "__main__":',
		reads || '\tpass',
		`\tprint(${p.functionName}(${params}))`,
		'',
	].join('\n');
}

/** JavaScript wrapper: `function` + `readline` + `process.stdin`. */
function jsBoilerplate(p: ParsedLeetCode): string {
	const params = p.params.map(pa => pa.name).join(', ');
	return [
		"const readline = require('readline');",
		"const rl = readline.createInterface({ input: process.stdin });",
		'',
		`function ${p.functionName}(${params}) {`,
		'\t<<SOLUTION>>',
		'}',
		'',
		'const lines = [];',
		"rl.on('line', (l) => lines.push(l));",
		"rl.on('close', () => {",
		`\tconst result = ${p.functionName}(${params});`,
		'\tprocess.stdout.write(String(result));',
		'});',
		'',
	].join('\n');
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
	if (language === 'java')       { return javaHarness(parsed); }
	if (language === 'python')     { return pythonHarness(parsed); }
	if (language === 'javascript') { return jsHarness(parsed); }
	return '';
}

/** Java assert harness with a `class Main { public static void main … }` wrapper. */
function javaHarness(p: ParsedLeetCode): string {
	const calls = p.tests.map(t => {
		const args = p.params.map(pa => jsonToLiteral(t.input[pa.name], 'java')).join(', ');
		return `\t\t${p.functionName}(${args});`;
	});
	return [
		'class Main {',
		'\tpublic static void main(String[] args) {',
		...calls,
		'\t}',
		'}',
		'',
	].join('\n');
}

/** Python `assert fn(args) == expected` harness, one assert per case. */
function pythonHarness(p: ParsedLeetCode): string {
	const lines = p.tests.map(t => {
		const args = p.params.map(pa => jsonToLiteral(t.input[pa.name], 'python')).join(', ');
		const exp  = jsonToLiteral(t.expected, 'python');
		return `assert ${p.functionName}(${args}) == ${exp}`;
	});
	return lines.length === 0 ? '# no test cases\n' : `${lines.join('\n')}\n`;
}

/** JS `assert.deepStrictEqual(fn(args), expected)` harness, one per case. */
function jsHarness(p: ParsedLeetCode): string {
	const head = "const assert = require('assert');";
	const lines = p.tests.map(t => {
		const args = p.params.map(pa => jsonToLiteral(t.input[pa.name], 'javascript')).join(', ');
		const exp  = jsonToLiteral(t.expected, 'javascript');
		return `assert.deepStrictEqual(${p.functionName}(${args}), ${exp});`;
	});
	return [head, ...lines, ''].join('\n');
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
		const allInt = arr.every(e => typeof e === 'number' && Number.isInteger(e));
		if (allInt) { return `new int[]{${items}}`; }
		const allStr = arr.every(e => typeof e === 'string');
		if (allStr) { return `new String[]{${items}}`; }
		return `new Object[]{${items}}`;
	}
	return `[${items}]`;
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
	const MARKER = '<<SOLUTION>>';
	const idx = boilerplate.indexOf(MARKER);
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

	return boilerplate.slice(0, idx) + indented + boilerplate.slice(idx + MARKER.length);
}
