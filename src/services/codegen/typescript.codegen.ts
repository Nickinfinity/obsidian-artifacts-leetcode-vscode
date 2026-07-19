import { SOLUTION_MARKER } from '../../types/constants.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { jsonToLiteral, mapType } from '../leetcode-codegen.service.js';
import { functionNameFor } from '../leetcode-parser.service.js';

/**
 * TypeScript wrapper: JavaScript's `readline` + `process.stdin` shape, plus a
 * `mapType`-derived typed signature — the entire reason to offer TypeScript
 * over JavaScript.
 *
 * Layer 1 of the codegen stack — the runnable starting point a solver gets when
 * the artifact declares no `# Setup` block.
 *
 * @param p - Parsed LeetCode artifact (function name, params, returns).
 * @returns TypeScript source containing exactly one `<<SOLUTION>>` marker.
 *
 * @example
 * tsBoilerplate(parsed); // → "const readline = require('readline');\n…function twoSum(nums: number[], target: number): number[] {…"
 */
export function tsBoilerplate(p: ParsedLeetCode): string {
	const fn       = functionNameFor(p, 'typescript');
	const ret      = mapType(p.returns, 'typescript');
	const argNames = p.params.map(pa => pa.name).join(', ');
	const paramSig = p.params.map(pa => `${pa.name}: ${mapType(pa.type, 'typescript')}`).join(', ');
	return [
		"const readline = require('readline');",
		"const rl = readline.createInterface({ input: process.stdin });",
		'',
		`function ${fn}(${paramSig}): ${ret} {`,
		`\t${SOLUTION_MARKER}`,
		'}',
		'',
		'const lines: string[] = [];',
		"rl.on('line', (l: string) => lines.push(l));",
		"rl.on('close', () => {",
		`\tconst result = ${fn}(${argNames});`,
		'\tprocess.stdout.write(String(result));',
		'});',
		'',
	].join('\n');
}

/**
 * TypeScript `assert.deepStrictEqual(fn(args), expected)` harness, one call per
 * parsed case — same shape as JavaScript's since a call site carries no type
 * annotations, only the already-typed candidate does.
 *
 * @param p - Parsed LeetCode artifact (tests + signature).
 * @returns TypeScript source asserting every case.
 *
 * @example
 * tsHarness(parsed); // → "const assert = require('assert');\nassert.deepStrictEqual(twoSum([2, 7], 9), [0, 1]);\n"
 */
export function tsHarness(p: ParsedLeetCode): string {
	const head = "const assert = require('assert');";
	const lines = p.tests.map(t => {
		const args = p.params.map(pa => jsonToLiteral(t.input[pa.name], 'typescript')).join(', ');
		const exp  = jsonToLiteral(t.expected, 'typescript');
		return `assert.deepStrictEqual(${p.functionName}(${args}), ${exp});`;
	});
	return [head, ...lines, ''].join('\n');
}
