import { SOLUTION_MARKER } from '../../types/constants.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { jsonToLiteral } from '../leetcode-codegen.service.js';
import { functionNameFor } from '../leetcode-parser.service.js';
import type { ProgramConfig } from '../program-config.helpers.js';
import { LEET_OUT_ENV_VAR } from '../test-envs/program/out-channel.js';

/**
 * Python wrapper: `def` + `if __name__ == "__main__":` + `input()`.
 *
 * Layer 1 of the codegen stack — the runnable starting point a solver gets when
 * the artifact declares no `# Setup` block.
 *
 * @param p - Parsed LeetCode artifact (function name, params).
 * @returns Python source containing exactly one `<<SOLUTION>>` marker.
 *
 * @example
 * pythonBoilerplate(parsed); // → 'def twoSum(nums, target):\n\t<<SOLUTION>>\n…'
 */
export function pythonBoilerplate(p: ParsedLeetCode): string {
	const fn     = functionNameFor(p, 'python');
	const params = p.params.map(pa => pa.name).join(', ');
	const reads  = p.params.map(pa => `\t${pa.name} = input()`).join('\n');
	return [
		`def ${fn}(${params}):`,
		`\t${SOLUTION_MARKER}`,
		'',
		'if __name__ == "__main__":',
		reads || '\tpass',
		`\tprint(${fn}(${params}))`,
		'',
	].join('\n');
}

/**
 * Python `assert fn(args) == expected` harness, one assert per parsed case.
 *
 * @param p - Parsed LeetCode artifact (tests + signature).
 * @returns Python source asserting every case, or a comment when there are none.
 *
 * @example
 * pythonHarness(parsed); // → 'assert twoSum([2, 7], 9) == [0, 1]\n'
 */
export function pythonHarness(p: ParsedLeetCode): string {
	const lines = p.tests.map(t => {
		const args = p.params.map(pa => jsonToLiteral(t.input[pa.name], 'python')).join(', ');
		const exp  = jsonToLiteral(t.expected, 'python');
		return `assert ${p.functionName}(${args}) == ${exp}`;
	});
	return lines.length === 0 ? '# no test cases\n' : `${lines.join('\n')}\n`;
}

/**
 * Python `program`-type wrapper: same `def` signature as
 * {@link pythonBoilerplate}, but the `__main__` block reads its case from
 * the declared channel (never `input()` when the channel is `argv`/`flags`)
 * and writes the graded answer to `$LEET_OUT` instead of stdout — see
 * `out-channel.ts` and `ARTIFACT_LEETCODE_FILE_FORMAT.md` §2.5.1.
 *
 * A separate emit path from {@link pythonBoilerplate}, not a modification of
 * it — the `call`-type golden snapshots must stay byte-identical.
 *
 * @param p      - Parsed LeetCode artifact (function name, params).
 * @param config - Parsed `program:` block (channel + optional flags).
 * @returns Python source containing exactly one `<<SOLUTION>>` marker.
 *
 * @example
 * pythonProgramBoilerplate(parsed, { channel: 'argv' });
 * // → 'import os\n\ndef twoSum(nums, target):\n\t<<SOLUTION>>\n…'
 */
export function pythonProgramBoilerplate(p: ParsedLeetCode, config: ProgramConfig): string {
	const fn     = functionNameFor(p, 'python');
	const params = p.params.map(pa => pa.name).join(', ');
	return [
		'import os',
		'',
		`def ${fn}(${params}):`,
		`\t${SOLUTION_MARKER}`,
		'',
		'if __name__ == "__main__":',
		...pythonChannelReads(p, config),
		`\twith open(os.environ["${LEET_OUT_ENV_VAR}"], "w") as f:`,
		'\t\tf.write("null")',
		'',
	].join('\n');
}

/**
 * Per-param read placeholders for the declared channel — a real `input()`
 * call is emitted only for `stdin`; `argv`/`flags` name their source in a
 * comment instead, exactly as {@link pythonBoilerplate}'s reads are real
 * `input()` calls only because it always assumed stdin.
 */
function pythonChannelReads(p: ParsedLeetCode, config: ProgramConfig): string[] {
	if (config.channel === 'stdin') {
		return p.params.map(pa => `\t${pa.name} = input()`);
	}
	if (config.channel === 'flags') {
		return p.params.map((pa, i) => {
			const flag = config.flags?.[i] ?? `--${pa.name}`;
			return `\t# read ${flag} from sys.argv`;
		});
	}
	return p.params.map((pa, i) => `\t# read ${pa.name} from sys.argv[${i + 1}]`);
}
