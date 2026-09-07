import { SOLUTION_MARKER } from '../../types/constants.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { jsonToLiteral, mapType } from '../leetcode-codegen.service.js';
import { functionNameFor } from '../leetcode-parser.service.js';
import type { ProgramConfig } from '../program-config.helpers.js';
import { LEET_OUT_ENV_VAR } from '../test-envs/program/out-channel.js';

/**
 * Rust wrapper: bare `fn` + a `std::io::stdin().read_line` stub + a
 * `mapType`-derived typed signature.
 *
 * Layer 1 of the codegen stack — the runnable starting point a solver gets when
 * the artifact declares no `# Setup` block. Same shape as Java's: the per-param
 * stdin reads are placeholder comments, not a real parser — at run time the
 * env's own driver supplies arguments as literals (see `buildExecutable`), so
 * this wrapper only needs to compile, never to actually parse stdin.
 *
 * @param p - Parsed LeetCode artifact (function name, params, returns).
 * @returns Rust source containing exactly one `<<SOLUTION>>` marker.
 *
 * @example
 * rustBoilerplate(parsed); // → 'fn twoSum(nums: Vec<i32>, target: i32) -> Vec<i32> {\n\t<<SOLUTION>>\n}\n…'
 */
export function rustBoilerplate(p: ParsedLeetCode): string {
	const fn      = functionNameFor(p, 'rust');
	const ret     = mapType(p.returns, 'rust');
	const params  = p.params.map(pa => `${pa.name}: ${mapType(pa.type, 'rust')}`).join(', ');
	const readers = p.params.map(pa => `\t// read ${pa.name} from stdin`).join('\n');
	return [
		`fn ${fn}(${params}) -> ${ret} {`,
		`\t${SOLUTION_MARKER}`,
		'}',
		'',
		'fn main() {',
		'\tlet mut input = String::new();',
		'\tstd::io::stdin().read_line(&mut input).unwrap();',
		readers,
		'\tprint!("");',
		'}',
		'',
	].join('\n');
}

/**
 * Rust `assert_eq!` harness with a `fn main() { … }` wrapper, one call per
 * parsed test case — the wrapper is required because Rust cannot execute a
 * bare statement outside a function body.
 *
 * @param p - Parsed LeetCode artifact (tests + signature).
 * @returns Rust source invoking the candidate once per case.
 *
 * @example
 * rustHarness(parsed); // → 'fn main() {\n\tassert_eq!(twoSum(vec![2, 7], 9), vec![0, 1]);\n}\n'
 */
export function rustHarness(p: ParsedLeetCode): string {
	const lines = p.tests.map(t => {
		const args = p.params.map(pa => jsonToLiteral(t.input[pa.name], 'rust')).join(', ');
		const exp  = jsonToLiteral(t.expected, 'rust');
		return `\tassert_eq!(${p.functionName}(${args}), ${exp});`;
	});
	return [
		'fn main() {',
		...(lines.length === 0 ? ['\t// no test cases'] : lines),
		'}',
		'',
	].join('\n');
}

/**
 * Rust `program`-type wrapper: same `mapType`-typed `fn` signature as
 * {@link rustBoilerplate}, but `main` reads its case from the declared
 * channel (never calling `read_line` when the channel is `argv`/`flags`) and
 * writes the graded answer to `$LEET_OUT` instead of stdout — see
 * `out-channel.ts` and `ARTIFACT_LEETCODE_FILE_FORMAT.md` §2.5.1.
 *
 * Rust has no serde (`CLAUDE.md`); the write here is the fixed JSON literal
 * `"null"`, a byte string, never a `LeetJson`-serialised runtime value — this
 * Layer-1 stub does not invoke the candidate, matching every other language's
 * program stub at this task's scope.
 *
 * A separate emit path from {@link rustBoilerplate}, not a modification of
 * it — the `call`-type golden snapshots must stay byte-identical.
 *
 * @param p      - Parsed LeetCode artifact (function name, params, returns).
 * @param config - Parsed `program:` block (channel + optional flags).
 * @returns Rust source containing exactly one `<<SOLUTION>>` marker.
 *
 * @example
 * rustProgramBoilerplate(parsed, { channel: 'argv' });
 * // → 'fn twoSum(nums: Vec<i32>, target: i32) -> Vec<i32> {\n\t<<SOLUTION>>\n}\n…'
 */
export function rustProgramBoilerplate(p: ParsedLeetCode, config: ProgramConfig): string {
	const fn     = functionNameFor(p, 'rust');
	const ret    = mapType(p.returns, 'rust');
	const params = p.params.map(pa => `${pa.name}: ${mapType(pa.type, 'rust')}`).join(', ');
	return [
		`fn ${fn}(${params}) -> ${ret} {`,
		`\t${SOLUTION_MARKER}`,
		'}',
		'',
		'fn main() {',
		...rustChannelReads(p, config),
		`\tstd::fs::write(std::env::var("${LEET_OUT_ENV_VAR}").unwrap(), "null").unwrap();`,
		'}',
		'',
	].join('\n');
}

/** Per-param read placeholders for the declared channel — `read_line` is called only for `stdin`. */
function rustChannelReads(p: ParsedLeetCode, config: ProgramConfig): string[] {
	if (config.channel === 'stdin') {
		return [
			'\tlet mut input = String::new();',
			'\tstd::io::stdin().read_line(&mut input).unwrap();',
			...p.params.map(pa => `\t// read ${pa.name} from stdin`),
		];
	}
	if (config.channel === 'flags') {
		return p.params.map((pa, i) => {
			const flag = config.flags?.[i] ?? `--${pa.name}`;
			return `\t// read ${flag} from std::env::args()`;
		});
	}
	return p.params.map((pa, i) => `\t// read ${pa.name} from std::env::args().nth(${i + 1})`);
}
