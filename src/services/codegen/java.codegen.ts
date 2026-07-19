import { SOLUTION_MARKER } from '../../types/constants.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { jsonToLiteral, mapType } from '../leetcode-codegen.service.js';
import { functionNameFor } from '../leetcode-parser.service.js';

/**
 * Java wrapper: imports + `class Main` + signature + Scanner stdin +
 * `System.out.print`.
 *
 * Layer 1 of the codegen stack — the runnable starting point a solver gets when
 * the artifact declares no `# Setup` block.
 *
 * @param p - Parsed LeetCode artifact (function name, params, returns).
 * @returns Java source containing exactly one `<<SOLUTION>>` marker.
 *
 * @example
 * javaBoilerplate(parsed); // → 'import java.util.*;\n\nclass Main {\n\tpublic static int[] twoSum(…'
 */
export function javaBoilerplate(p: ParsedLeetCode): string {
	const fn     = functionNameFor(p, 'java');
	const ret    = mapType(p.returns, 'java');
	const params = p.params.map(pa => `${mapType(pa.type, 'java')} ${pa.name}`).join(', ');
	const readers = p.params.map(pa => `\t\t// read ${pa.name} from sc`).join('\n');
	return [
		'import java.util.*;',
		'',
		'class Main {',
		`\tpublic static ${ret} ${fn}(${params}) {`,
		`\t\t${SOLUTION_MARKER}`,
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

/**
 * Java assert harness with a `class Main { public static void main … }` wrapper,
 * one call per parsed test case.
 *
 * @param p - Parsed LeetCode artifact (tests + signature).
 * @returns Java source invoking the candidate once per case.
 *
 * @example
 * javaHarness(parsed); // → 'class Main {\n\tpublic static void main(String[] args) {\n\t\ttwoSum(…'
 */
export function javaHarness(p: ParsedLeetCode): string {
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
