import { SOLUTION_MARKER } from '../../types/constants.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { jsonToLiteral } from '../leetcode-codegen.service.js';
import { functionNameFor } from '../leetcode-parser.service.js';

/**
 * JavaScript wrapper: `function` + `readline` + `process.stdin`.
 *
 * Layer 1 of the codegen stack — the runnable starting point a solver gets when
 * the artifact declares no `# Setup` block.
 *
 * @param p - Parsed LeetCode artifact (function name, params).
 * @returns JavaScript source containing exactly one `<<SOLUTION>>` marker.
 *
 * @example
 * jsBoilerplate(parsed); // → "const readline = require('readline');\n…"
 */
export function jsBoilerplate(p: ParsedLeetCode): string {
	const fn     = functionNameFor(p, 'javascript');
	const params = p.params.map(pa => pa.name).join(', ');
	return [
		"const readline = require('readline');",
		"const rl = readline.createInterface({ input: process.stdin });",
		'',
		`function ${fn}(${params}) {`,
		`\t${SOLUTION_MARKER}`,
		'}',
		'',
		'const lines = [];',
		"rl.on('line', (l) => lines.push(l));",
		"rl.on('close', () => {",
		`\tconst result = ${fn}(${params});`,
		'\tprocess.stdout.write(String(result));',
		'});',
		'',
	].join('\n');
}

/**
 * JavaScript `assert.deepStrictEqual(fn(args), expected)` harness, one call per
 * parsed case.
 *
 * @param p - Parsed LeetCode artifact (tests + signature).
 * @returns JavaScript source asserting every case.
 *
 * @example
 * jsHarness(parsed); // → "const assert = require('assert');\nassert.deepStrictEqual(twoSum([2, 7], 9), [0, 1]);\n"
 */
export function jsHarness(p: ParsedLeetCode): string {
	const head = "const assert = require('assert');";
	const lines = p.tests.map(t => {
		const args = p.params.map(pa => jsonToLiteral(t.input[pa.name], 'javascript')).join(', ');
		const exp  = jsonToLiteral(t.expected, 'javascript');
		return `assert.deepStrictEqual(${p.functionName}(${args}), ${exp});`;
	});
	return [head, ...lines, ''].join('\n');
}
