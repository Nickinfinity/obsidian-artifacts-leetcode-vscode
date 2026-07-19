import { SOLUTION_MARKER } from '../../types/constants.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { jsonToLiteral } from '../leetcode-codegen.service.js';
import { functionNameFor } from '../leetcode-parser.service.js';

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
