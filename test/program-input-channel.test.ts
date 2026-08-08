import * as assert from 'node:assert';
import {
	serializeProgramInput,
	toArgv,
	toFlagsArgv,
	toStdin,
} from '../src/services/test-envs/program/input-channel.js';

/**
 * The three `program` input channels (T2.3): `argv`, `flags`, `stdin`.
 *
 * Case data in `input:` is untrusted `.md` text. The one rule every test here
 * protects: a value reaches a channel as an **argv array element or a stdin
 * string** — never a joined command line a shell could re-interpret. `;` and
 * `$(whoami)` fixtures below must survive as inert literal text; if a future
 * refactor ever joined argv into one string, `deepStrictEqual` against the
 * array would fail immediately.
 */
suite('program input channels', () => {

	// ── argv ──────────────────────────────────────────────────────────────

	suite('toArgv', () => {

		test('a string passes bare, a non-string goes through canonicalJson — the first failing test', () => {
			const argv = toArgv(['arr', 'name'], { arr: [1, 2], name: 'x' });
			assert.deepStrictEqual(argv, ['[1,2]', 'x']);
		});

		test('order follows params:, never the input map\'s own (insertion) key order', () => {
			// `name` is declared first in the input map but second in paramOrder.
			const argv = toArgv(['arr', 'name'], { name: 'x', arr: [1, 2] });
			assert.deepStrictEqual(argv, ['[1,2]', 'x']);
		});

		test('number, boolean and null all serialise through canonicalJson', () => {
			const argv = toArgv(['n', 'b', 'z'], { n: 42, b: true, z: null });
			assert.deepStrictEqual(argv, ['42', 'true', 'null']);
		});

		test('a value containing `;` survives as an inert literal argv element', () => {
			const argv = toArgv(['cmd'], { cmd: 'echo hi; rm -rf /' });
			assert.deepStrictEqual(argv, ['echo hi; rm -rf /']);
		});

		test('a value containing `$(whoami)` survives as an inert literal argv element', () => {
			const argv = toArgv(['cmd'], { cmd: '$(whoami)' });
			assert.deepStrictEqual(argv, ['$(whoami)']);
		});

		test('a NUL byte cannot cross the argv boundary — refused by name, not thrown as a spawn crash', () => {
			assert.throws(
				() => toArgv(['name'], { name: 'a\0b' }),
				/name.*NUL byte/,
			);
		});

		test('a newline inside a value is fine in argv — one element, untouched', () => {
			const argv = toArgv(['note'], { note: 'line1\nline2' });
			assert.deepStrictEqual(argv, ['line1\nline2']);
		});
	});

	// ── flags ─────────────────────────────────────────────────────────────

	suite('toFlagsArgv', () => {

		test('emits `--flag value` as two argv elements, paired positionally with params:', () => {
			const argv = toFlagsArgv(['nums', 'target'], ['--nums', '--target'], { nums: [1, 2], target: 3 });
			assert.deepStrictEqual(argv, ['--nums', '[1,2]', '--target', '3']);
		});

		test('a param with no declared flag name falls back to --<paramName>', () => {
			const argv = toFlagsArgv(['nums'], undefined, { nums: 5 });
			assert.deepStrictEqual(argv, ['--nums', '5']);
		});

		test('`;` and `$(whoami)` survive as inert literal argv elements, never joined', () => {
			const argv = toFlagsArgv(['cmd', 'sub'], ['--cmd', '--sub'], { cmd: 'a; b', sub: '$(whoami)' });
			assert.deepStrictEqual(argv, ['--cmd', 'a; b', '--sub', '$(whoami)']);
		});

		test('a NUL byte is refused the same way as the argv channel', () => {
			assert.throws(
				() => toFlagsArgv(['name'], ['--name'], { name: 'a\0b' }),
				/name.*NUL byte/,
			);
		});

		test('a newline inside a flag value is fine — one element, untouched', () => {
			const argv = toFlagsArgv(['note'], ['--note'], { note: 'a\nb' });
			assert.deepStrictEqual(argv, ['--note', 'a\nb']);
		});
	});

	// ── stdin ─────────────────────────────────────────────────────────────

	suite('toStdin', () => {

		test('one bare-or-JSON line per param, in params: order', () => {
			const stdin = toStdin(['arr', 'name'], { arr: [1, 2], name: 'x' });
			assert.strictEqual(stdin, '[1,2]\nx\n');
		});

		test('order follows params:, never the input map\'s own key order', () => {
			const stdin = toStdin(['arr', 'name'], { name: 'x', arr: [1, 2] });
			assert.strictEqual(stdin, '[1,2]\nx\n');
		});

		test('`;` and `$(whoami)` survive as inert literal stdin content', () => {
			const stdin = toStdin(['cmd'], { cmd: 'a; $(whoami)' });
			assert.strictEqual(stdin, 'a; $(whoami)\n');
		});

		test('a string value containing a newline would desync the line framing bare, so it is forced through canonicalJson', () => {
			const stdin = toStdin(['note', 'after'], { note: 'line1\nline2', after: 'z' });
			// Exactly two lines, not three: the embedded newline is escaped inside
			// the JSON string, not left raw to split the frame.
			const lines = stdin.split('\n');
			assert.deepStrictEqual(lines, ['"line1\\nline2"', 'z', '']);
		});

		test('a NUL byte is not refused on stdin — no argv boundary applies, it reaches the child as-is', () => {
			const stdin = toStdin(['name'], { name: 'a\0b' });
			assert.strictEqual(stdin, 'a\0b\n');
		});
	});

	// ── dispatch ──────────────────────────────────────────────────────────

	suite('serializeProgramInput', () => {

		test('argv channel dispatches to an argv array', () => {
			const result = serializeProgramInput('argv', ['name'], undefined, { name: 'x' });
			assert.deepStrictEqual(result, { argv: ['x'] });
		});

		test('flags channel dispatches to an argv array built from flag pairs', () => {
			const result = serializeProgramInput('flags', ['nums'], ['--nums'], { nums: [1, 2] });
			assert.deepStrictEqual(result, { argv: ['--nums', '[1,2]'] });
		});

		test('stdin channel dispatches to a stdin string, never an argv array', () => {
			const result = serializeProgramInput('stdin', ['name'], undefined, { name: 'x' });
			assert.deepStrictEqual(result, { stdin: 'x\n' });
		});
	});
});
