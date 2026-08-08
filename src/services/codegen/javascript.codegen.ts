import { SOLUTION_MARKER } from '../../types/constants.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { jsonToLiteral } from '../leetcode-codegen.service.js';
import { functionNameFor } from '../leetcode-parser.service.js';
import type { ProgramConfig } from '../program-config.helpers.js';
import { LEET_OUT_ENV_VAR } from '../test-envs/program/out-channel.js';

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

/**
 * JavaScript `program`-type wrapper: same `function` signature as
 * {@link jsBoilerplate}, but reads its case from the declared channel (never
 * wiring up `readline`/`process.stdin` when the channel is `argv`/`flags`)
 * and writes the graded answer to `$LEET_OUT` instead of stdout — see
 * `out-channel.ts` and `ARTIFACT_LEETCODE_FILE_FORMAT.md` §2.5.1.
 *
 * A separate emit path from {@link jsBoilerplate}, not a modification of it
 * — the `call`-type golden snapshots must stay byte-identical.
 *
 * @param p      - Parsed LeetCode artifact (function name, params).
 * @param config - Parsed `program:` block (channel + optional flags).
 * @returns JavaScript source containing exactly one `<<SOLUTION>>` marker.
 *
 * @example
 * jsProgramBoilerplate(parsed, { channel: 'argv' });
 * // → "function twoSum(nums, target) {\n\t<<SOLUTION>>\n}\n…"
 */
export function jsProgramBoilerplate(p: ParsedLeetCode, config: ProgramConfig): string {
	const fn     = functionNameFor(p, 'javascript');
	const params = p.params.map(pa => pa.name).join(', ');
	const write  = `require('fs').writeFileSync(process.env.${LEET_OUT_ENV_VAR}, 'null');`;

	if (config.channel === 'stdin') {
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
			`\t${write}`,
			'});',
			'',
		].join('\n');
	}

	return [
		`function ${fn}(${params}) {`,
		`\t${SOLUTION_MARKER}`,
		'}',
		'',
		...jsChannelReads(p, config),
		write,
		'',
	].join('\n');
}

/** Per-param read placeholders for the `argv`/`flags` channels — never emitted for `stdin`, which reads via `readline` instead. */
function jsChannelReads(p: ParsedLeetCode, config: ProgramConfig): string[] {
	if (config.channel === 'flags') {
		return p.params.map((pa, i) => {
			const flag = config.flags?.[i] ?? `--${pa.name}`;
			return `// read ${flag} from process.argv`;
		});
	}
	return p.params.map((pa, i) => `// read ${pa.name} from process.argv[${i + 2}]`);
}
