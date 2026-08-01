import * as assert from 'node:assert';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';

/**
 * `libs:` is read for **every** test type.
 *
 * It used to be parsed only for `project` / `service`, because it lived in the
 * multi-file grammar — so a `function` artifact declaring `libs.python` parsed
 * to `undefined` with no warning at all, and the declaration vanished between
 * the author writing it and the runner looking for it.
 */
suite('libs declarations', () => {

	/** A `function` artifact carrying whatever config fence the test needs. */
	function functionArtifact(configBody: string): string {
		return [
			'---',
			'type: leetcode',
			'title: Sum',
			'difficulty: easy',
			'---',
			'',
			'Add two numbers.',
			'',
			'```yaml leetcode',
			'function: add',
			'params:',
			'  - name: a',
			'    type: int',
			'returns: int',
			configBody,
			'```',
			'',
			'## Tests',
			'',
			'```json',
			'[{ "input": { "a": 1 }, "expected": 1 }]',
			'```',
			'',
		].join('\n');
	}

	test('a function artifact keeps its declared python libs', () => {
		const parsed = parseLeetCode(functionArtifact('libs:\n  python: [numpy>=2]'));
		assert.deepStrictEqual(parsed.libs, { python: ['numpy>=2'] });
	});

	test('every ecosystem parses under its own grammar', () => {
		const parsed = parseLeetCode(functionArtifact([
			'libs:',
			'  python: [requests[socks]==2.32.3]',
			'  rust: [serde@^1+derive]',
			'  java: [com.google.guava:guava:33.3.1]',
			'  typescript: [react@^19.0.0]',
		].join('\n')));

		assert.deepStrictEqual(parsed.libs, {
			python: ['requests[socks]==2.32.3'],
			rust: ['serde@^1+derive'],
			java: ['com.google.guava:guava:33.3.1'],
			typescript: ['react@^19.0.0'],
		});
		assert.deepStrictEqual(parsed.warnings, undefined, 'a clean artifact warns about nothing');
	});

	/**
	 * A maven coordinate is not an npm name and vice versa. Validating every
	 * list against one grammar would refuse the correct spelling for three of
	 * the four registries.
	 */
	test('a spec valid elsewhere is refused under the wrong grammar', () => {
		const parsed = parseLeetCode(functionArtifact('libs:\n  python: [com.google.guava:guava:33.3.1]'));

		assert.strictEqual(parsed.libs, undefined);
		assert.ok((parsed.warnings ?? []).some(w => w.includes('guava')), JSON.stringify(parsed.warnings));
	});

	test('a refused spec is dropped and its siblings survive', () => {
		const parsed = parseLeetCode(
			functionArtifact('libs:\n  python: [numpy>=2, ../../etc/passwd, requests]'),
		);

		assert.deepStrictEqual(parsed.libs, { python: ['numpy>=2', 'requests'] });
		assert.ok((parsed.warnings ?? []).some(w => w.includes('etc/passwd')), JSON.stringify(parsed.warnings));
	});

	test('an unknown language is dropped with a warning naming it', () => {
		const parsed = parseLeetCode(functionArtifact('libs:\n  cobol: [something]'));

		assert.strictEqual(parsed.libs, undefined);
		assert.ok((parsed.warnings ?? []).some(w => w.includes('cobol')), JSON.stringify(parsed.warnings));
	});

	/**
	 * `warnings` is `undefined` for a clean `function` artifact and `[]` for a
	 * clean `project` one — a `JSON.stringify`-visible difference the golden net
	 * pins. Reaching the warning sink for the first time must not collapse it.
	 */
	test('a clean function artifact still has no warnings key at all', () => {
		const parsed = parseLeetCode(functionArtifact('libs:\n  typescript: [react@^19.0.0]'));

		assert.strictEqual(parsed.warnings, undefined);
		assert.strictEqual('warnings' in JSON.parse(JSON.stringify(parsed)), false);
	});

	/**
	 * `numpy>=2,<3` is the idiomatic pip bound, and a comma is also the inline
	 * list separator — so an unquoted one splits the spec, dropping the upper
	 * bound and installing an unbounded version while warning about something
	 * else entirely.
	 */
	test('a quoted comma stays inside one spec', () => {
		const parsed = parseLeetCode(functionArtifact('libs:\n  python: ["numpy>=2,<3", requests]'));
		assert.deepStrictEqual(parsed.libs, { python: ['numpy>=2,<3', 'requests'] });
	});

	test('the block form needs no quoting at all', () => {
		const parsed = parseLeetCode(
			functionArtifact('libs:\n  python:\n    - numpy>=2,<3\n    - requests'),
		);
		assert.deepStrictEqual(parsed.libs, { python: ['numpy>=2,<3', 'requests'] });
	});

	test('an artifact declaring no libs at all has no libs key', () => {
		const parsed = parseLeetCode(functionArtifact('practice:\n  timeLimit: 0'));
		assert.strictEqual(parsed.libs, undefined);
	});

	/** Hostile: a long list must parse without throwing and warn about the one bad entry. */
	test('500 valid specs and one traversal warn exactly once', () => {
		const many = Array.from({ length: 500 }, (_, i) => `pkg${i}`);
		const parsed = parseLeetCode(
			functionArtifact(`libs:\n  python: [${[...many, '../../etc'].join(', ')}]`),
		);

		assert.strictEqual(parsed.libs?.python.length, 500);
		assert.strictEqual((parsed.warnings ?? []).length, 1, JSON.stringify(parsed.warnings));
	});
});
