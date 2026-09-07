import * as assert from 'node:assert';
import { emitYamlCases, parseYamlCases } from '../src/services/yaml-cases.helpers.js';

/**
 * The YAML case subset (`ARTIFACT_LEETCODE_FILE_FORMAT.md` §3.3).
 *
 * The whole point of this module is that it is **not** YAML 1.1: test data is
 * the one place where a silently re-typed value is worse than a loud parse
 * failure, because an exercise's reference solution is graded against its own
 * expecteds — a coerced expected verifies green while teaching the wrong answer.
 *
 * So the hazard list below is not decoration. Each entry is a value that real
 * YAML would change and this parser must not.
 */
suite('yaml-cases — JSON types, YAML syntax', () => {

	suite('unquoted scalars take JSON types only', () => {

		const jsonTyped: [string, unknown][] = [
			['true', true], ['false', false], ['null', null], ['~', null],
			['0', 0], ['-1', -1], ['3.5', 3.5], ['1e3', 1000], ['-0.5', -0.5],
		];
		for (const [text, want] of jsonTyped) {
			test(`'${text}' types as ${JSON.stringify(want)}`, () => {
				const parsed = parseYamlCases('- expected: ' + text) as { expected: unknown }[];
				assert.deepStrictEqual(parsed[0].expected, want);
			});
		}

		// Every one of these is a YAML 1.1 implicit type. All must stay strings.
		const stayString = [
			'yes', 'no', 'on', 'off', 'y', 'n', 'Yes', 'NO', 'True', 'FALSE', 'NULL',
			'0051', '012', '1:1', '2:30', '.inf', '.nan', '0x1F', '1.0.0',
		];
		for (const text of stayString) {
			test(`'${text}' stays a string (YAML 1.1 would re-type it)`, () => {
				const parsed = parseYamlCases('- expected: ' + text) as { expected: unknown }[];
				assert.strictEqual(parsed[0].expected, text);
			});
		}
	});

	suite('quoted scalars are never re-typed', () => {
		for (const text of ['3', 'true', 'null', '0051', 'no']) {
			test(`"${text}" stays the string '${text}'`, () => {
				const parsed = parseYamlCases('- expected: "' + text + '"') as { expected: unknown }[];
				assert.strictEqual(parsed[0].expected, text);
			});
		}
	});

	suite('structure', () => {

		test('a block mapping under input:', () => {
			assert.deepStrictEqual(
				parseYamlCases('- input:\n    arr: [1, -2, 0, 3]\n  expected: 3'),
				[{ input: { arr: [1, -2, 0, 3] }, expected: 3 }],
			);
		});

		test('several cases', () => {
			assert.deepStrictEqual(
				parseYamlCases('- input:\n    x: 1\n  expected: 2\n- input:\n    x: 3\n  expected: 4'),
				[{ input: { x: 1 }, expected: 2 }, { input: { x: 3 }, expected: 4 }],
			);
		});

		test('nested flow collections', () => {
			assert.deepStrictEqual(
				parseYamlCases('- input:\n    a: [1, [2, [3]]]\n  expected: {k: [null, true, "x"]}'),
				[{ input: { a: [1, [2, [3]]] }, expected: { k: [null, true, 'x'] } }],
			);
		});

		test('an empty document is an empty suite', () => {
			assert.deepStrictEqual(parseYamlCases(''), []);
			assert.deepStrictEqual(parseYamlCases('\n\n  \n'), []);
		});

		test('comments are stripped, but not a # inside a quoted string', () => {
			const parsed = parseYamlCases('- expected: "a # b"  # trailing') as { expected: unknown }[];
			assert.strictEqual(parsed[0].expected, 'a # b');
		});

		test('CRLF parses identically to LF', () => {
			const lf = '- input:\n    x: 1\n  expected: 2';
			assert.deepStrictEqual(parseYamlCases(lf.replace(/\n/g, '\r\n')), parseYamlCases(lf));
		});

		test('a colon with no following space is a scalar, not a mapping', () => {
			// This is what keeps `1:1` and `http://x` out of key position.
			const parsed = parseYamlCases('- expected: 1:1') as { expected: unknown }[];
			assert.strictEqual(parsed[0].expected, '1:1');
		});
	});

	suite('an unquoted comma is not a flow separator at top level', () => {
		// C34: scalarOrFlow called readFlow unconditionally, and readFlow's
		// bare-scalar branch stops at `,` — flow-collection logic firing on a
		// plain top-level scalar. Everything past the first comma silently
		// vanished with no warning.
		test('a comma-bearing number-like value stays whole, not truncated at the first comma', () => {
			const parsed = parseYamlCases('- input:\n    line: 1,2,3,4,5\n  expected: 15');
			assert.deepStrictEqual(parsed, [{ input: { line: '1,2,3,4,5' }, expected: 15 }]);
		});

		test('prose with a comma is not truncated mid-sentence', () => {
			const parsed = parseYamlCases('- input:\n    s: hello, world\n  expected: 12');
			assert.deepStrictEqual(parsed, [{ input: { s: 'hello, world' }, expected: 12 }]);
		});
	});

	suite('malformed input degrades, never throws', () => {
		for (const bad of ['- input: [1, 2', '- {unclosed: ', ': no key', '\t- tabbed']) {
			test(`${JSON.stringify(bad)} yields null or a value, without throwing`, () => {
				assert.doesNotThrow(() => parseYamlCases(bad));
			});
		}

		test('SEC: __proto__ as a key never lands on the object', () => {
			const parsed = parseYamlCases('- input:\n    __proto__: polluted\n  expected: 1');
			const one = (parsed as Record<string, unknown>[])[0];
			assert.deepStrictEqual(one.input, {});
			assert.strictEqual(({} as Record<string, unknown>).polluted, undefined);
		});

		test('SEC: __proto__ in a flow map never lands either', () => {
			const parsed = parseYamlCases('- input: {__proto__: polluted}\n');
			const one = (parsed as Record<string, unknown>[])[0];
			assert.deepStrictEqual(one.input, {});
		});

		test('SEC: a 1 MB scalar completes in well under a second', () => {
			const started = Date.now();
			parseYamlCases('- expected: ' + 'a'.repeat(1_000_000));
			assert.ok(Date.now() - started < 500, 'parseYamlCases was too slow on a 1 MB scalar');
		});
	});

	suite('emit → parse is the identity', () => {

		// The migration's correctness rests entirely on this property.
		const hazards = [
			'no', 'yes', 'on', 'off', 'true', 'false', 'null', '~', '',
			'0051', '1:1', '1.0', '6321', '.inf', 'a,b', 'k: v', '# x',
			'- dash', '[b]', '{b}', '  padded  ', 'quote"in', "apos'in", 'emoji 🎯',
		];
		for (const value of hazards) {
			test(`round-trips ${JSON.stringify(value)}`, () => {
				const source = [{ input: { s: value }, expected: value }];
				assert.deepStrictEqual(parseYamlCases(emitYamlCases(source)), source);
			});
		}

		const structures: unknown[][] = [
			[{ input: { a: [1, [2, [3]]] }, expected: { k: [null, true, 'x'] } }],
			[{ input: {}, expected: [] }],
			[{}],
			[{ input: { a: 1 } }],
			[{ input: { n: -0.5 }, expected: 1e-7 }],
			[],
		];
		for (const source of structures) {
			test(`round-trips ${JSON.stringify(source).slice(0, 44)}`, () => {
				assert.deepStrictEqual(parseYamlCases(emitYamlCases(source)), source);
			});
		}

		// Found by adversarial pass: `PLAIN_SAFE_RE` permits an inner space, which
		// made a *trailing* one look safe — and every scalar is trimmed on read,
		// so `a ` came back as `a`.
		for (const value of ['a ', ' a', 'a\t', '\ta', 'a  b', '  ']) {
			test(`round-trips whitespace-edge ${JSON.stringify(value)}`, () => {
				const source = [{ input: { s: value }, expected: value }];
				assert.deepStrictEqual(parseYamlCases(emitYamlCases(source)), source);
			});
		}

		test('a scalar with edge whitespace is emitted quoted', () => {
			assert.ok(emitYamlCases([{ expected: 'a ' }]).includes('"a "'));
		});

		test('malformed indentation refuses rather than truncating the suite', () => {
			// Silently returning the cases it *could* read would hand the runner a
			// short suite that still looks valid.
			assert.strictEqual(parseYamlCases('- expected: 1\n   - odd'), null);
			assert.strictEqual(parseYamlCases('  - expected: 1\n- expected: 2'), null);
		});

		test('pathological nesting degrades to null instead of crashing', () => {
			const deep = '- expected: ' + '['.repeat(10_000) + '1' + ']'.repeat(10_000);
			assert.doesNotThrow(() => parseYamlCases(deep));
			assert.strictEqual(parseYamlCases(deep), null);
		});

		test('an empty input map emits as flow, not a childless block header', () => {
			// `input:` with nothing under it reads back as null, silently turning
			// a no-argument case into a broken one.
			assert.ok(emitYamlCases([{ input: {}, expected: 1 }]).includes('input: {}'));
		});
	});
});
