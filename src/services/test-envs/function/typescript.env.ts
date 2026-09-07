import { LEET_SENTINEL } from '../../../types/constants.js';
import { escapeRe } from '../../../utils/regex.helpers.js';
import { jsonToLiteral } from '../../leetcode-codegen.service.js';
import { functionNameFor } from '../../leetcode-parser.service.js';
import type { EnvContext, TestEnv } from '../env.types.js';
import { makeFunctionEnv } from './make-function-env.js';

/** Node version, per major line, that ships `stripTypeScriptTypes` stable and unflagged. */
const MIN_MINOR: Record<'22' | '23', number> = { '22': 18, '23': 10 };

/**
 * Whether `version` supports the stable, unflagged
 * `node:module.stripTypeScriptTypes` this env relies on.
 *
 * Node shipped it unflagged on the 22.x line starting at 22.18 and on the 23.x
 * line starting at 23.10; every 24+ release carries it. A pure predicate over
 * a version string (rather than reading `process.version` directly) so the
 * threshold is testable without touching the real process.
 *
 * @param version - A `node --version`-shaped string, with or without the `v`.
 * @returns True when that Node can strip TypeScript types unflagged.
 *
 * @example
 * nodeSupportsStripTypes('v22.18.0'); // → true
 * nodeSupportsStripTypes('v22.10.0'); // → false
 */
export function nodeSupportsStripTypes(version: string): boolean {
	const m = /^v?(\d+)\.(\d+)/.exec(version);
	if (!m) { return false; }
	const major = Number(m[1]);
	const minor = Number(m[2]);
	if (major > 23) { return true; }
	if (major === 23) { return minor >= MIN_MINOR['23']; }
	if (major === 22) { return minor >= MIN_MINOR['22']; }
	return false;
}

/** Gate the env on the running Node's version — see `nodeSupportsStripTypes`. */
function detect(): Promise<boolean> {
	return Promise.resolve(nodeSupportsStripTypes(process.version));
}

/**
 * `function × typescript` — the JavaScript env plus one call.
 *
 * The solver's code is written **verbatim** as `sol.ts`; the generated
 * `runner.js` reads it, strips its types with Node's own
 * `node:module.stripTypeScriptTypes` (which blanks types with spaces rather
 * than transpiling, so line/column offsets survive — a runtime error still
 * points at the solver's real `.ts` line), then evaluates the result in a
 * `vm` sandbox exactly as the JavaScript env does: same sandbox shape, same
 * function-pull, same per-case try/catch and sentinel emit. No compiler, no
 * install, no compile step on the default path; no type checking either —
 * grading is behavioural, and the solver already gets live type errors from
 * tsserver because the temp file has a real `.ts` extension.
 *
 * Non-erasable syntax (`enum`, `namespace`, parameter properties) throws a
 * `SyntaxError` straight out of `stripTypeScriptTypes` with a message that is
 * already honest (e.g. `"TypeScript enum is not supported in strip-only
 * mode"`); anything that strips but still can't execute (a decorator Node's
 * runtime doesn't run yet) throws out of `vm.runInContext` instead. Both are
 * caught around the same load step and reported as every case's error — the
 * same shape `parseSentinelLines` already gives an undefined function — rather
 * than letting the child process crash and surfacing a raw stack trace.
 * `validate` therefore stays identical to the JavaScript env's name check: a
 * hand-rolled regex over `enum`/`namespace`/decorators would only risk
 * rejecting syntax Node's own stripper actually accepts.
 */
export const typescriptFunctionEnv: TestEnv = {
	...makeFunctionEnv({
		language: 'typescript',
		candidateFile: 'sol.ts',
		runnerFile: 'runner.js',
		run: 'node runner.js',
		candidateContent: ctx => `${ctx.code}\n`,
		buildRunner: runnerSource,

		/** Reject a candidate that never mentions the expected function name — identical to the JS env's rule. */
		validate(ctx: EnvContext): string | null {
			const fn = functionNameFor(ctx.parsed, ctx.langId);
			if (!new RegExp(String.raw`\b${escapeRe(fn)}\b`).test(ctx.code)) {
				return `TypeScript setup must define \`${fn}\` (as a function, const, or export).`;
			}
			return null;
		},
	}),
	// Consumed by leetcode-run.handlers.ts's generic "Missing test dependency
	// for …" toast when `detect()` fails below — this env's dependency isn't a
	// package but a Node version floor, so this one entry carries that sentence.
	requires: ['TypeScript exercises need Node 22.18 or newer'],
	detect,
};

/**
 * Build the generated `runner.js` — strips `sol.ts`'s types, evaluates it in a
 * `vm` context, and drives the suite.
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
		"const { stripTypeScriptTypes } = require('node:module');",
		'',
		"const __tsSrc = fs.readFileSync(path.join(__dirname, 'sol.ts'), 'utf8');",
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
		'let __fn;',
		'let __loadErr = null;',
		'try {',
		'  const __src = stripTypeScriptTypes(__tsSrc);',
		'  const __sandbox = { module: { exports: {} }, exports: {}, console, require, process };',
		'  __sandbox.global = __sandbox;',
		'  vm.createContext(__sandbox);',
		"  vm.runInContext(__src, __sandbox, { filename: 'sol.ts' });",
		`  __fn = __sandbox[${JSON.stringify(fn)}]`,
		`    || __sandbox.module.exports[${JSON.stringify(fn)}]`,
		"    || (typeof __sandbox.module.exports === 'function' ? __sandbox.module.exports : undefined);",
		'} catch (__e) {',
		'  __loadErr = __e && __e.message ? __e.message : String(__e);',
		'}',
		'',
		'if (__loadErr !== null) {',
		'  for (let __i = 0; __i < __cases.length; __i++) { __emit({ index: __i, error: __loadErr, ms: 0 }); }',
		"} else if (typeof __fn !== 'function') {",
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
