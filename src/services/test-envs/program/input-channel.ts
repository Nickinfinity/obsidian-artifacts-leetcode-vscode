import { canonicalJson } from '../../../utils/canonical-json.js';
import type { ProgramChannel } from '../../program-config.helpers.js';

/**
 * Serialise a `program`-type case's `input:` map for the three delivery
 * channels `program:` can declare (T2.1's `ProgramChannel`): `argv`,
 * `flags`, `stdin` (`ARTIFACT_LEETCODE_FILE_FORMAT.md` §2.5.1).
 *
 * `input:` values are untrusted `.md` case data. The standing rule this
 * module exists to hold: a value reaches the child as an **argv array
 * element or a stdin string** — never a joined command line. `execFile` with
 * an argv array never invokes a shell, so `;`, `$(…)`, backticks and quotes
 * stay inert *as long as they stay array elements* — this module never joins
 * one, and every exported function returns an array or a single string, not
 * a template-built command.
 *
 * **Parameter order always follows `params:`** (`paramOrder`, supplied by the
 * caller — typically `parsed.params.map(p => p.name)`), never the `input:`
 * map's own insertion order. A `Record`'s key order is whatever the artifact
 * author happened to write; reading it directly would silently shift every
 * positional argument the moment a case lists its keys out of declaration
 * order.
 */

/** One serialised case, ready for the run step — never a joined command line. */
export type SerializedProgramInput =
	| { readonly argv: readonly string[] }
	| { readonly stdin: string };

/**
 * `argv`/`flags` value rule: a string passes through **bare** (so
 * `argv[1]` in the child is `x`, not `"x"`); everything else — arrays,
 * objects, numbers, booleans, `null` — goes through {@link canonicalJson},
 * the one structured-value spelling every other test environment in this
 * repo already agrees on.
 */
function argvValue(value: unknown): string {
	return typeof value === 'string' ? value : canonicalJson(value);
}

/**
 * Refuse a value that cannot cross the argv boundary at all.
 *
 * Node's `execFile` rejects an argv element containing a NUL byte at the C
 * level. Refusing it here, by name, means a hostile case fails loudly and
 * legibly (a caller can catch this and record it as that one case's error)
 * instead of the child process spawn itself throwing an unhandled error
 * mid-suite.
 *
 * @throws {Error} when `value` contains a NUL byte.
 */
function assertNoNul(value: string, paramName: string): string {
	if (value.includes('\0')) {
		throw new Error(`program input '${paramName}' contains a NUL byte — cannot cross the argv boundary`);
	}
	return value;
}

/**
 * `argv` channel: positional arguments, ordered by `params:`.
 *
 * @param paramOrder - Parameter names in declaration order.
 * @param input - The case's `input:` map.
 * @returns One argv element per parameter, in `paramOrder`.
 * @throws {Error} on a NUL byte in any value — see {@link assertNoNul}.
 *
 * @example
 * toArgv(['arr', 'name'], { arr: [1, 2], name: 'x' }); // → ['[1,2]', 'x']
 */
export function toArgv(paramOrder: readonly string[], input: Record<string, unknown>): string[] {
	return paramOrder.map(name => assertNoNul(argvValue(input[name]), name));
}

/**
 * `flags` channel: named arguments, spelled `--flag value` — **two** argv
 * elements, never `--flag=value`.
 *
 * Chosen over the `=` form because the value already arrives as its own argv
 * element — nothing to split, no shell in the loop. `--flag value` is what a
 * solver's `argparse` / `util.parseArgs` / picocli accepts with zero extra
 * config; the `=` form instead needs the *solver's own* parser to split the
 * token, which is one more thing a value shaped like `key=value` could
 * confuse. `flagNames[i]` pairs positionally with `paramOrder[i]` — the
 * pairing `ProgramConfig.flags`' own doc comment promises — falling back to
 * `--<paramName>` for any parameter with no declared flag name.
 *
 * @param paramOrder - Parameter names in declaration order.
 * @param flagNames - `ProgramConfig.flags`; `undefined` (or short) falls back to `--<name>` per missing entry.
 * @param input - The case's `input:` map.
 * @returns `[flag, value, flag, value, …]`, in `params:` order.
 * @throws {Error} on a NUL byte in any value.
 *
 * @example
 * toFlagsArgv(['nums', 'target'], ['--nums', '--target'], { nums: [1, 2], target: 3 });
 * // → ['--nums', '[1,2]', '--target', '3']
 */
export function toFlagsArgv(
	paramOrder: readonly string[],
	flagNames: readonly string[] | undefined,
	input: Record<string, unknown>,
): string[] {
	const argv: string[] = [];
	paramOrder.forEach((name, i) => {
		const flag = flagNames?.[i] ?? `--${name}`;
		argv.push(flag, assertNoNul(argvValue(input[name]), name));
	});
	return argv;
}

/**
 * Stdin-safe value rule: bare string with **no** newline; everything else —
 * including a multi-line string — through {@link canonicalJson}. `canonicalJson`
 * never itself emits a raw newline (`JSON.stringify` escapes one as `\n`
 * inside the string), so routing a newline-bearing value through it keeps
 * the one-value-per-line framing intact.
 */
function stdinValue(value: unknown): string {
	if (typeof value === 'string' && !value.includes('\n')) { return value; }
	return canonicalJson(value);
}

/**
 * `stdin` channel: one line per parameter, in `params:` order, written as a
 * single string for the caller to pipe to the child's stdin.
 *
 * The framing is line-based (bare-or-JSON per line, same value rule as
 * argv), which is exactly what breaks if a *bare* string value contains a
 * literal newline — it would split into two lines and desync every
 * parameter after it. `stdinValue` is the guard: a newline forces
 * `canonicalJson` instead of a bare pass-through, so this function's own
 * output can never contain a raw newline except as a line separator.
 *
 * A NUL byte is **not** refused here, unlike argv — Node imposes no
 * C-string boundary on a stdin write; the byte reaches the child same as any
 * other, and reading it back is the child's problem, not a spawn hazard.
 *
 * @param paramOrder - Parameter names in declaration order.
 * @param input - The case's `input:` map.
 * @returns Newline-terminated lines, one per parameter.
 *
 * @example
 * toStdin(['arr', 'name'], { arr: [1, 2], name: 'x' }); // → '[1,2]\nx\n'
 */
export function toStdin(paramOrder: readonly string[], input: Record<string, unknown>): string {
	return paramOrder.map(name => `${stdinValue(input[name])}\n`).join('');
}

/**
 * Dispatch on `ProgramConfig.channel` — the one entry point a runner calls
 * per case, so it never has to branch on the channel itself.
 *
 * @param channel - `ProgramConfig.channel` (defaults to `'argv'` at parse time — see `program-config.helpers.ts`).
 * @param paramOrder - Parameter names in declaration order.
 * @param flagNames - `ProgramConfig.flags`; consulted only for the `flags` channel.
 * @param input - The case's `input:` map.
 * @returns An argv array (`argv`/`flags`) or a stdin string (`stdin`) — never a joined command line.
 *
 * @example
 * serializeProgramInput('stdin', ['arr'], undefined, { arr: [1, 2] }); // → { stdin: '[1,2]\n' }
 */
export function serializeProgramInput(
	channel: ProgramChannel,
	paramOrder: readonly string[],
	flagNames: readonly string[] | undefined,
	input: Record<string, unknown>,
): SerializedProgramInput {
	if (channel === 'stdin') { return { stdin: toStdin(paramOrder, input) }; }
	if (channel === 'flags') { return { argv: toFlagsArgv(paramOrder, flagNames, input) }; }
	return { argv: toArgv(paramOrder, input) };
}
