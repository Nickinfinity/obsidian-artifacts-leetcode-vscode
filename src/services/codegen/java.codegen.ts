import { SOLUTION_MARKER } from '../../types/constants.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { jsonToLiteral, mapType } from '../leetcode-codegen.service.js';
import { functionNameFor } from '../leetcode-parser.service.js';
import type { ProgramConfig } from '../program-config.helpers.js';
import { LEET_OUT_ENV_VAR } from '../test-envs/program/out-channel.js';

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

/**
 * Java `program`-type wrapper: same typed signature as {@link javaBoilerplate},
 * but `main` reads its case from the declared channel (never a `Scanner` when
 * the channel is `argv`/`flags`) and writes the graded answer to `$LEET_OUT`
 * instead of stdout — see `out-channel.ts` and
 * `ARTIFACT_LEETCODE_FILE_FORMAT.md` §2.5.1.
 *
 * A separate emit path from {@link javaBoilerplate}, not a modification of
 * it — the `call`-type golden snapshots must stay byte-identical.
 *
 * @param p      - Parsed LeetCode artifact (function name, params, returns).
 * @param config - Parsed `program:` block (channel + optional flags).
 * @returns Java source containing exactly one `<<SOLUTION>>` marker.
 *
 * @example
 * javaProgramBoilerplate(parsed, { channel: 'argv' });
 * // → 'import java.io.IOException;\n…class Main {\n\tpublic static int[] twoSum(…'
 */
export function javaProgramBoilerplate(p: ParsedLeetCode, config: ProgramConfig): string {
	const fn     = functionNameFor(p, 'java');
	const ret    = mapType(p.returns, 'java');
	const params = p.params.map(pa => `${mapType(pa.type, 'java')} ${pa.name}`).join(', ');
	return [
		'import java.io.IOException;',
		'import java.nio.file.Files;',
		'import java.nio.file.Paths;',
		'import java.util.*;',
		'',
		'class Main {',
		`\tpublic static ${ret} ${fn}(${params}) {`,
		`\t\t${SOLUTION_MARKER}`,
		'\t}',
		'',
		'\tpublic static void main(String[] args) throws IOException {',
		...javaChannelReads(p, config),
		`\t\tFiles.write(Paths.get(System.getenv("${LEET_OUT_ENV_VAR}")), "null".getBytes());`,
		'\t}',
		'}',
		'',
	].join('\n');
}

/**
 * Per-param read placeholders for the declared channel — a `Scanner` is
 * constructed only for `stdin`; `argv`/`flags` name their source in a comment
 * instead, exactly as {@link javaBoilerplate}'s stdin reads are comments too.
 */
function javaChannelReads(p: ParsedLeetCode, config: ProgramConfig): string[] {
	if (config.channel === 'stdin') {
		return [
			'\t\tScanner sc = new Scanner(System.in);',
			...p.params.map(pa => `\t\t// read ${pa.name} from sc`),
		];
	}
	if (config.channel === 'flags') {
		return p.params.map((pa, i) => {
			const flag = config.flags?.[i] ?? `--${pa.name}`;
			return `\t\t// read ${flag} from args`;
		});
	}
	return p.params.map((pa, i) => `\t\t// read ${pa.name} from args[${i}]`);
}
