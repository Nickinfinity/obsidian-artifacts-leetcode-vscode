import { LEET_SENTINEL } from '../../../types/constants.js';
import { escapeRe } from '../../../utils/regex.helpers.js';
import { jsonToLiteral } from '../../leetcode-codegen.service.js';
import { functionNameFor } from '../../leetcode-parser.service.js';
import type { EnvContext } from '../env.types.js';
import { makeFunctionEnv } from './make-function-env.js';

/** `import java.util.*;` / `import static java.lang.Math.max;` — line-level detection. */
const IMPORT_RE = /^\s*import\s[\w.* ]+;\s*$/;
/** `package com.example;` */
const PACKAGE_RE = /^\s*package\s[\w. ]+;\s*$/;
/** A top-level type declaration — what the solver must NOT wrap their method in. */
const TYPE_DECL_RE = /^\s*(?:public\s+|final\s+|abstract\s+|sealed\s+)*(?:class|interface|enum|record)\s+\w/m;
/** `static void main(String[] …)` in any spacing. */
const MAIN_RE = /\bstatic\s+void\s+main\s*\(/;

/**
 * `function × java` — the candidate is its own compilation unit.
 *
 * The solver's method is written **verbatim** into `Solution.java` (wrapped in a
 * `class Solution`, since a bare method needs a class to live in), and a
 * generated `Runner.java` calls `Solution.<fn>(...)`. `javac Solution.java
 * Runner.java` compiles both together; `java Runner` drives the suite. The
 * solver's code is never spliced into the driver, so it cannot collide with the
 * driver's own class or `main`.
 *
 * Java has no stdlib JSON, so the driver carries a generated `__json(Object)`
 * covering every shape a candidate can return — arrays of any rank (via
 * `java.lang.reflect.Array`), `List`, `Map` (keys sorted), strings, numbers,
 * booleans, `null`. Its output matches `canonicalJson` exactly: `[0,1]`, never
 * `Arrays.toString`'s `[0, 1]`. Whole-number doubles print as integers so a
 * `double`-returning solution can match an integer `expected`.
 */
export const javaFunctionEnv = makeFunctionEnv({
	language: 'java',
	candidateFile: 'Solution.java',
	runnerFile: 'Runner.java',
	compile: 'javac Solution.java Runner.java',
	run: 'java -cp . Runner',
	candidateContent: javaSolutionFile,
	buildRunner: runnerSource,

	/**
	 * Reject a candidate that cannot be a plain method member of `class Solution`.
	 *
	 * The solver is expected to write only the method. A wrapping class, a
	 * `package`, or a `main` would either collide with the driver or hide the
	 * method from it — so we say so, rather than letting `javac` emit
	 * `illegal start of type` or `class Main is already defined`.
	 */
	validate(ctx: EnvContext): string | null {
		const { code, parsed, langId } = ctx;
		const bodyOnly = stripImportsAndPackage(code).body;
		const fn = functionNameFor(parsed, langId);

		if (TYPE_DECL_RE.test(bodyOnly)) {
			return `Java setup must be a bare method, not a class. Remove the surrounding \`class …\` — the runner wraps your \`${fn}\` method in its own class.`;
		}
		if (MAIN_RE.test(bodyOnly)) {
			return `Java setup must not declare \`main(…)\`. Write only the \`${fn}\` method; the runner supplies the entry point.`;
		}
		if (!new RegExp(String.raw`\b${escapeRe(fn)}\s*\(`).test(bodyOnly)) {
			return `Java setup must define a method named \`${fn}\`.`;
		}
		return null;
	},
});

/**
 * Build `Solution.java` — the candidate's method wrapped in `class Solution`,
 * with its `import`s hoisted to file scope and any `package` dropped.
 *
 * @param ctx - Env context carrying the candidate source.
 * @returns Complete Java source for the candidate compilation unit.
 *
 * @example
 * javaSolutionFile({ code: 'static int f(){return 1;}', … });
 */
function javaSolutionFile(ctx: EnvContext): string {
	const { imports, body } = stripImportsAndPackage(ctx.code);
	return [
		...imports,
		imports.length > 0 ? '' : null,
		'class Solution {',
		body,
		'}',
		'',
	].filter(l => l !== null).join('\n');
}

/**
 * Build the generated `Runner.java` — the driver that calls into `Solution`.
 *
 * @param ctx - Parsed artifact and the suite.
 * @returns Complete Java source for `class Runner`.
 *
 * @example
 * runnerSource({ parsed, cases, … });
 */
function runnerSource(ctx: EnvContext): string {
	const { parsed, cases, langId } = ctx;
	const fn = functionNameFor(parsed, langId);
	const caseRows = cases.map(c => {
		const args = parsed.params.map(p => jsonToLiteral(c.input[p.name], 'java'));
		return `\t\t__cases.add(() -> Solution.${fn}(${args.join(', ')}));`;
	});

	return [
		'import java.util.*;',
		'import java.util.function.Supplier;',
		'',
		'class Runner {',
		...quoteHelper(),
		'',
		...jsonHelper(),
		'',
		'\tpublic static void main(String[] args) {',
		'\t\tList<Supplier<Object>> __cases = new ArrayList<>();',
		...caseRows,
		'',
		'\t\tfor (int __i = 0; __i < __cases.size(); __i++) {',
		'\t\t\tlong __t0 = System.nanoTime();',
		'\t\t\ttry {',
		'\t\t\t\tObject __r = __cases.get(__i).get();',
		'\t\t\t\tlong __ms = (System.nanoTime() - __t0) / 1000000L;',
		`\t\t\t\tSystem.out.println(${JSON.stringify(LEET_SENTINEL)} + "{\\"index\\":" + __i + ",\\"actual\\":" + __quote(__json(__r)) + ",\\"ms\\":" + __ms + "}");`,
		'\t\t\t} catch (Throwable __e) {',
		'\t\t\t\tlong __ms = (System.nanoTime() - __t0) / 1000000L;',
		'\t\t\t\tString __m = __e.getMessage() == null ? __e.toString() : __e.getMessage();',
		`\t\t\t\tSystem.out.println(${JSON.stringify(LEET_SENTINEL)} + "{\\"index\\":" + __i + ",\\"error\\":" + __quote(__m) + ",\\"ms\\":" + __ms + "}");`,
		'\t\t\t}',
		'\t\t\tSystem.out.flush();',
		'\t\t}',
		'\t}',
		'}',
		'',
	].join('\n');
}

/**
 * Split a candidate's `import` / `package` preamble from its body.
 *
 * The candidate is wrapped in `class Solution`, where an `import` would be
 * `illegal start of type` — imports must sit at file scope, above the type. A
 * `package` declaration is dropped: the file compiles flat into a temp dir and
 * runs as `java -cp . Runner`, so a package would misplace the class.
 *
 * @param code - Candidate source, possibly with a preamble.
 * @returns Hoisted import lines (trimmed) and the body with preamble removed.
 *
 * @example
 * stripImportsAndPackage('import java.util.*;\n\nstatic int f(){return 1;}');
 * // → { imports: ['import java.util.*;'], body: 'static int f(){return 1;}' }
 */
export function stripImportsAndPackage(code: string): { imports: string[]; body: string } {
	const imports: string[] = [];
	const bodyLines: string[] = [];

	for (const line of code.split('\n')) {
		if (IMPORT_RE.test(line))       { imports.push(line.trim()); }
		else if (PACKAGE_RE.test(line)) { continue; }
		else                            { bodyLines.push(line); }
	}
	while (bodyLines.length > 0 && bodyLines[0].trim() === '') { bodyLines.shift(); }
	return { imports, body: bodyLines.join('\n') };
}

/**
 * Source lines for `__quote(String)` — wrap a string as a JSON string literal.
 *
 * @returns Java source lines, tab-indented for a class body.
 *
 * @example
 * quoteHelper()[0]; // → '\tstatic String __quote(String s) {'
 */
function quoteHelper(): string[] {
	return [
		'\tstatic String __quote(String s) {',
		String.raw`		String r = s.replace("\\", "\\\\").replace("\"", "\\\"");`,
		String.raw`		r = r.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");`,
		String.raw`		return "\"" + r + "\"";`,
		'\t}',
	];
}

/**
 * Source lines for `__json(Object)` — the canonical serialiser.
 *
 * Arrays go through `java.lang.reflect.Array`, which handles every element type
 * and every rank without a cascade of `instanceof int[]` branches.
 *
 * @returns Java source lines, tab-indented for a class body.
 *
 * @example
 * jsonHelper()[0]; // → '\tstatic String __json(Object o) {'
 */
function jsonHelper(): string[] {
	return [
		'\tstatic String __json(Object o) {',
		'\t\tif (o == null) { return "null"; }',
		'\t\tif (o instanceof String) { return __quote((String) o); }',
		'\t\tif (o instanceof Character) { return __quote(o.toString()); }',
		'\t\tif (o instanceof Boolean) { return o.toString(); }',
		'\t\tif (o instanceof Double || o instanceof Float) {',
		'\t\t\tdouble d = ((Number) o).doubleValue();',
		'\t\t\tif (!Double.isInfinite(d) && !Double.isNaN(d) && d == Math.rint(d)) { return String.valueOf((long) d); }',
		'\t\t\treturn String.valueOf(d);',
		'\t\t}',
		'\t\tif (o instanceof Number) { return o.toString(); }',
		'\t\tif (o.getClass().isArray()) {',
		'\t\t\tStringBuilder sb = new StringBuilder("[");',
		'\t\t\tint n = java.lang.reflect.Array.getLength(o);',
		'\t\t\tfor (int i = 0; i < n; i++) {',
		"\t\t\t\tif (i > 0) { sb.append(','); }",
		'\t\t\t\tsb.append(__json(java.lang.reflect.Array.get(o, i)));',
		'\t\t\t}',
		"\t\t\treturn sb.append(']').toString();",
		'\t\t}',
		'\t\tif (o instanceof Map) {',
		'\t\t\tMap<?, ?> m = (Map<?, ?>) o;',
		'\t\t\tList<Object> ks = new ArrayList<>(m.keySet());',
		'\t\t\tks.sort((a, b) -> String.valueOf(a).compareTo(String.valueOf(b)));',
		'\t\t\tStringBuilder sb = new StringBuilder("{");',
		'\t\t\tfor (int i = 0; i < ks.size(); i++) {',
		"\t\t\t\tif (i > 0) { sb.append(','); }",
		"\t\t\t\tsb.append(__quote(String.valueOf(ks.get(i)))).append(':').append(__json(m.get(ks.get(i))));",
		'\t\t\t}',
		"\t\t\treturn sb.append('}').toString();",
		'\t\t}',
		'\t\tif (o instanceof Iterable) {',
		'\t\t\tStringBuilder sb = new StringBuilder("[");',
		'\t\t\tboolean first = true;',
		'\t\t\tfor (Object e : (Iterable<?>) o) {',
		"\t\t\t\tif (!first) { sb.append(','); }",
		'\t\t\t\tfirst = false;',
		'\t\t\t\tsb.append(__json(e));',
		'\t\t\t}',
		"\t\t\treturn sb.append(']').toString();",
		'\t\t}',
		'\t\treturn __quote(String.valueOf(o));',
		'\t}',
	];
}
