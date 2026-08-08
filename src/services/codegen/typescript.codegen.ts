import { SOLUTION_MARKER } from '../../types/constants.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { jsonToLiteral, mapType } from '../leetcode-codegen.service.js';
import { functionNameFor } from '../leetcode-parser.service.js';
import type { ProgramConfig } from '../program-config.helpers.js';
import { LEET_OUT_ENV_VAR } from '../test-envs/program/out-channel.js';

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

/**
 * TypeScript `program`-type wrapper: same `mapType`-typed `function`
 * signature as {@link tsBoilerplate}, but reads its case from the declared
 * channel (never wiring up `readline`/`process.stdin` when the channel is
 * `argv`/`flags`) and writes the graded answer to `$LEET_OUT` instead of
 * stdout — see `out-channel.ts` and `ARTIFACT_LEETCODE_FILE_FORMAT.md`
 * §2.5.1.
 *
 * A separate emit path from {@link tsBoilerplate}, not a modification of it
 * — the `call`-type golden snapshots must stay byte-identical.
 *
 * @param p      - Parsed LeetCode artifact (function name, params, returns).
 * @param config - Parsed `program:` block (channel + optional flags).
 * @returns TypeScript source containing exactly one `<<SOLUTION>>` marker.
 *
 * @example
 * tsProgramBoilerplate(parsed, { channel: 'argv' });
 * // → "function twoSum(nums: number[], target: number): number[] {\n\t<<SOLUTION>>\n}\n…"
 */
export function tsProgramBoilerplate(p: ParsedLeetCode, config: ProgramConfig): string {
	const fn       = functionNameFor(p, 'typescript');
	const ret      = mapType(p.returns, 'typescript');
	const paramSig = p.params.map(pa => `${pa.name}: ${mapType(pa.type, 'typescript')}`).join(', ');
	const write    = `require('fs').writeFileSync(process.env.${LEET_OUT_ENV_VAR}, 'null');`;

	if (config.channel === 'stdin') {
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
			`\t${write}`,
			'});',
			'',
		].join('\n');
	}

	return [
		`function ${fn}(${paramSig}): ${ret} {`,
		`\t${SOLUTION_MARKER}`,
		'}',
		'',
		...tsChannelReads(p, config),
		write,
		'',
	].join('\n');
}

/** Per-param read placeholders for the `argv`/`flags` channels — never emitted for `stdin`, which reads via `readline` instead. */
function tsChannelReads(p: ParsedLeetCode, config: ProgramConfig): string[] {
	if (config.channel === 'flags') {
		return p.params.map((pa, i) => {
			const flag = config.flags?.[i] ?? `--${pa.name}`;
			return `// read ${flag} from process.argv`;
		});
	}
	return p.params.map((pa, i) => `// read ${pa.name} from process.argv[${i + 2}]`);
}
