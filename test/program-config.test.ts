import * as assert from 'node:assert';
import { parseProgramConfig } from '../src/services/program-config.helpers.js';

/**
 * Unit tests for the `program:` config-block grammar (T2.1).
 *
 * The block is untrusted `.md` text: a `channel` outside the fixed vocabulary,
 * an `entry` shaped like a traversal attempt, and a `__proto__` field name are
 * all fixtures here on purpose, and every one of them must degrade to a
 * documented default with a warning rather than throw or reach through a
 * prototype.
 */
suite('program config', () => {

	const warnings: string[] = [];
	const warn = (m: string): void => { warnings.push(m); };

	setup(() => { warnings.length = 0; });

	test('absent program: block parses to undefined, no warnings', () => {
		const config = parseProgramConfig(['title: X'], warn);
		assert.strictEqual(config, undefined);
		assert.deepStrictEqual(warnings, []);
	});

	// ── channel ───────────────────────────────────────────────────────────────

	test('a valid channel is read through unchanged', () => {
		const config = parseProgramConfig(['program:', '  channel: stdin'], warn);
		assert.strictEqual(config?.channel, 'stdin');
		assert.deepStrictEqual(warnings, []);
	});

	test('an unknown channel value degrades to argv and warns — the first failing test', () => {
		const config = parseProgramConfig(['program:', '  channel: bogus'], warn);
		assert.strictEqual(config?.channel, 'argv');
		assert.ok(warnings.some(w => w.includes('bogus')), warnings.join(' | '));
	});

	test('a channel value laced with shell metacharacters degrades safely and never crashes', () => {
		const config = parseProgramConfig(['program:', '  channel: argv; rm -rf / #'], warn);
		assert.strictEqual(config?.channel, 'argv');
		assert.ok(warnings.length > 0);
	});

	test('a missing channel key defaults to argv and warns', () => {
		const config = parseProgramConfig(['program:', '  entry: main.py'], warn);
		assert.strictEqual(config?.channel, 'argv');
		assert.ok(warnings.some(w => w.includes('channel')), warnings.join(' | '));
	});

	// ── entry (S8: shape-guarded, never resolved here) ──────────────────────────

	test('a plain relative entry is kept verbatim', () => {
		const config = parseProgramConfig(['program:', '  channel: argv', '  entry: src/main.py'], warn);
		assert.strictEqual(config?.entry, 'src/main.py');
	});

	test('an absolute entry is refused, not resolved, as a named parse failure', () => {
		const config = parseProgramConfig(['program:', '  entry: /etc/passwd'], warn);
		assert.strictEqual(config?.entry, undefined);
		assert.ok(warnings.some(w => w.includes('entry') && w.includes('/etc/passwd')), warnings.join(' | '));
	});

	test('entry: ../../escape is refused — a `..` segment can never become a contained path', () => {
		const config = parseProgramConfig(['program:', '  entry: ../../escape'], warn);
		assert.strictEqual(config?.entry, undefined);
		assert.ok(warnings.some(w => w.includes('..')), warnings.join(' | '));
	});

	test('a node_modules segment at any depth is refused, not just at the root', () => {
		const config = parseProgramConfig(['program:', '  entry: client/node_modules/.bin/evil'], warn);
		assert.strictEqual(config?.entry, undefined);
		assert.ok(warnings.some(w => w.includes('node_modules')), warnings.join(' | '));
	});

	test('a node_modules segment is refused case-insensitively', () => {
		const config = parseProgramConfig(['program:', '  entry: NODE_MODULES/x'], warn);
		assert.strictEqual(config?.entry, undefined);
	});

	test('a 10,000-character entry is refused in linear time, not a backtracking hang', () => {
		const hostile = `../${'a'.repeat(10_000)}`;
		const start = Date.now();
		const config = parseProgramConfig(['program:', `  entry: ${hostile}`], warn);
		assert.ok(Date.now() - start < 500, 'must resolve near-instantly, no catastrophic backtracking');
		assert.strictEqual(config?.entry, undefined);
	});

	// ── flags ─────────────────────────────────────────────────────────────────

	test('an inline flags list parses to an ordered string array', () => {
		const config = parseProgramConfig(['program:', '  flags: [--nums, --target]'], warn);
		assert.deepStrictEqual(config?.flags, ['--nums', '--target']);
	});

	test('a block-form flags list parses the same as inline', () => {
		const config = parseProgramConfig(
			['program:', '  flags:', '    - --nums', '    - --target'], warn,
		);
		assert.deepStrictEqual(config?.flags, ['--nums', '--target']);
	});

	test('no flags declared leaves the field undefined, not an empty array', () => {
		const config = parseProgramConfig(['program:', '  channel: argv'], warn);
		assert.strictEqual(config?.flags, undefined);
	});

	// ── unrecognised fields, __proto__ included ─────────────────────────────────

	test('__proto__ under program: is an unrecognised field, never a prototype write', () => {
		const config = parseProgramConfig(
			['program:', '  __proto__: pwn', '  constructor: evil', '  channel: argv'], warn,
		);
		// A `result[key] = val` refactor would rethread *this returned object's*
		// own prototype via a `__proto__:` line — asserting against the global
		// `Object.prototype` cannot tell the difference, since that write lands
		// on the fresh object, not the shared one (ledger C7). Check the object
		// actually handed back.
		assert.strictEqual(Object.getPrototypeOf(config), Object.prototype);
		assert.deepStrictEqual(Object.keys(config ?? {}).sort(), ['channel']);
		assert.strictEqual(config?.channel, 'argv');
	});

	// ── the full shape together ──────────────────────────────────────────────────

	test('a fully declared block parses every field at once', () => {
		const config = parseProgramConfig(
			[
				'program:',
				'  channel: flags',
				'  entry: src/main.py',
				'  flags: [--nums, --target]',
			],
			warn,
		);
		assert.deepStrictEqual(config, {
			channel: 'flags',
			entry: 'src/main.py',
			flags: ['--nums', '--target'],
		});
		assert.deepStrictEqual(warnings, []);
	});
});
