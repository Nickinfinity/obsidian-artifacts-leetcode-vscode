import { LEET_SENTINEL } from '../../../types/constants.js';
import { jsonToLiteral } from '../../leetcode-codegen.service.js';
import { functionNameFor } from '../../leetcode-parser.service.js';
import type { CaseOutcome, EmittedProgram, EnvContext, TestEnv } from '../env.types.js';
import { parseSentinelLines } from '../sentinel.helpers.js';

/**
 * `function × javascript` — the candidate runs in a `vm` sandbox.
 *
 * The solver's code is written **verbatim** as `sol.js`; a generated
 * `runner.js` reads that text and evaluates it with Node's `vm` module — the
 * actual controlled-environment primitive — inside a fresh context. It then
 * pulls the function out of the context (a top-level `function`/`const`
 * declaration, or `module.exports`) and drives the suite against it.
 *
 * `vm` keeps `sol.js` byte-identical on disk and isolates its globals from the
 * runner's, while still giving the solver `console` and `require`. The
 * canonical stringifier is inlined into the runner — the sandbox needs no
 * module resolution back into this extension.
 */
export const javascriptFunctionEnv: TestEnv = {
	type: 'function',
	language: 'javascript',

	/**
	 * Reject a candidate that never mentions the expected function name.
	 *
	 * Loose by design — the definition may be a declaration, an expression, or
	 * an export, and `vm` sorts out which at run time. This only catches the
	 * gross case of the wrong name (or an empty buffer), with a clear message
	 * instead of a runtime `fn is not a function`.
	 *
	 * @param ctx - Env context carrying the candidate source and function name.
	 * @returns A user-facing message, or `null` when the candidate looks runnable.
	 *
	 * @example
	 * javascriptFunctionEnv.validate({ code: '// empty', … }); // → 'must define twoSum'
	 */
	validate(ctx: EnvContext): string | null {
		const fn = functionNameFor(ctx.parsed, ctx.langId);
		if (!new RegExp(String.raw`\b${escapeRe(fn)}\b`).test(ctx.code)) {
			return `JavaScript setup must define \`${fn}\` (as a function, const, or export).`;
		}
		return null;
	},

	/**
	 * Emit `sol.js` (verbatim candidate) and the generated `runner.js`.
	 *
	 * @param ctx - Parsed artifact, candidate source, and the suite.
	 * @returns The two files plus the run command (no compile step).
	 *
	 * @example
	 * javascriptFunctionEnv.emit({ parsed, langId: 'javascript', code, cases });
	 */
	emit(ctx: EnvContext): EmittedProgram {
		return {
			files: [
				{ name: 'sol.js', content: `${ctx.code}\n` },
				{ name: 'runner.js', content: runnerSource(ctx) },
			],
			run: 'node runner.js',
		};
	},

	/**
	 * Recover per-case outcomes from stdout.
	 *
	 * @param stdout - Raw stdout, possibly truncated by a timeout-kill.
	 * @returns One outcome per intact sentinel line.
	 *
	 * @example
	 * javascriptFunctionEnv.parse('__LEET__{"index":0,"actual":"1","ms":2}\n');
	 */
	parse(stdout: string): CaseOutcome[] {
		return parseSentinelLines(stdout);
	},
};

/**
 * Build the generated `runner.js` — evaluates `sol.js` in a `vm` context and
 * drives the suite.
 *
 * @param ctx - Parsed artifact and the suite.
 * @returns Complete JavaScript source for the runner.
 *
 * @example
 * runnerSource({ parsed, cases, … });
 */
function runnerSource(ctx: EnvContext): string {
	const { parsed, cases, langId } = ctx;
	const fn = functionNameFor(parsed, langId);
	const argRows = cases.map(c => {
		const args = parsed.params.map(p => jsonToLiteral(c.input[p.name], 'javascript'));
		return `  [${args.join(', ')}],`;
	});
	const notDefined = `${fn} is not defined`;

	return [
		"const fs = require('fs');",
		"const vm = require('vm');",
		"const path = require('path');",
		'',
		"const __src = fs.readFileSync(path.join(__dirname, 'sol.js'), 'utf8');",
		'const __sandbox = { module: { exports: {} }, exports: {}, console, require, process };',
		'__sandbox.global = __sandbox;',
		'vm.createContext(__sandbox);',
		"vm.runInContext(__src, __sandbox, { filename: 'sol.js' });",
		'',
		`const __fn = __sandbox[${JSON.stringify(fn)}]`,
		`  || __sandbox.module.exports[${JSON.stringify(fn)}]`,
		'  || (typeof __sandbox.module.exports === \'function\' ? __sandbox.module.exports : undefined);',
		'',
		'const __cases = [',
		...argRows,
		'];',
		'',
		'function __canon(v) {',
		"  if (v === null || v === undefined) { return 'null'; }",
		"  if (Array.isArray(v)) { return '[' + v.map(__canon).join(',') + ']'; }",
		"  if (typeof v === 'object') {",
		'    const keys = Object.keys(v).sort();',
		"    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + __canon(v[k]); }).join(',') + '}';",
		'  }',
		'  return JSON.stringify(v);',
		'}',
		'',
		'function __emit(obj) {',
		`  console.log(${JSON.stringify(LEET_SENTINEL)} + JSON.stringify(obj));`,
		'}',
		'',
		"if (typeof __fn !== 'function') {",
		`  for (let __i = 0; __i < __cases.length; __i++) { __emit({ index: __i, error: ${JSON.stringify(notDefined)}, ms: 0 }); }`,
		'} else {',
		'  for (let __i = 0; __i < __cases.length; __i++) {',
		'    const __t0 = Date.now();',
		'    try {',
		'      const __r = __fn.apply(null, __cases[__i]);',
		'      __emit({ index: __i, actual: __canon(__r), ms: Date.now() - __t0 });',
		'    } catch (__e) {',
		'      const __msg = __e && __e.message ? __e.message : String(__e);',
		'      __emit({ index: __i, error: __msg, ms: Date.now() - __t0 });',
		'    }',
		'  }',
		'}',
		'',
	].join('\n');
}

/** Escape a string for literal use inside a RegExp. */
function escapeRe(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
