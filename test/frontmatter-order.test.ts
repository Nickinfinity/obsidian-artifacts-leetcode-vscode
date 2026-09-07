import * as assert from 'node:assert';
import { CANONICAL_FRONTMATTER_ORDER } from '../src/services/leetcode-config-blocks.helpers.js';
import { orderViolation } from '../src/services/frontmatter-order.helpers.js';

/**
 * Unit tests for the canonical frontmatter key order (T1.10).
 *
 * `orderViolation` governs *writing* only — the parser stays order-independent,
 * so every case here checks the pure ordering rule in isolation, never a full
 * `.md` parse.
 */
suite('CANONICAL_FRONTMATTER_ORDER', () => {

	test('is the one authority for the retained-key sequence', () => {
		assert.deepStrictEqual(CANONICAL_FRONTMATTER_ORDER, [
			'artifactType', 'leetcodeType', 'title', 'difficulty', 'status', 'algorithm', 'tags',
		]);
	});

	test('answers "at which index does an absent key belong" via indexOf — T1.12\'s need', () => {
		assert.strictEqual(CANONICAL_FRONTMATTER_ORDER.indexOf('status'), 4);
		assert.strictEqual(CANONICAL_FRONTMATTER_ORDER.indexOf('artifactType'), 0);
		assert.strictEqual(CANONICAL_FRONTMATTER_ORDER.indexOf('tags'), 6);
	});
});

suite('orderViolation', () => {

	test('reports the first violation, naming the expected earlier key', () => {
		const message = orderViolation('title: X\nartifactType: leetcode\n');
		assert.notStrictEqual(message, null);
		assert.match(message ?? '', /artifactType/);
		assert.match(message ?? '', /must come before/);
	});

	test('returns null for a fully ordered frontmatter block', () => {
		const fm = 'artifactType: leetcode\nleetcodeType: function\ntitle: Two Sum\n'
			+ 'difficulty: easy\nstatus: unsolved\nalgorithm: array\ntags: [a, b]\n';
		assert.strictEqual(orderViolation(fm), null);
	});

	test('returns null when only a strict subset is present, in canonical order', () => {
		assert.strictEqual(orderViolation('title: X\nstatus: unsolved\n'), null);
	});

	test('returns null for an empty document', () => {
		assert.strictEqual(orderViolation(''), null);
	});

	test('ignores unknown/custom keys entirely — never positioned, never a failure', () => {
		// "customField" sits between artifactType and title; if it were
		// (wrongly) positioned, it could never satisfy any canonical slot
		// and every clean artifact carrying a custom key would fail.
		const fm = 'artifactType: leetcode\ncustomField: whatever\ntitle: X\n';
		assert.strictEqual(orderViolation(fm), null);
	});

	// ── Hostile inputs ───────────────────────────────────────────────────────

	test('hostile: duplicate keys do not crash and do not self-trigger a violation', () => {
		const fm = 'artifactType: leetcode\ntitle: X\ntitle: Y\n';
		assert.strictEqual(orderViolation(fm), null);
	});

	test('hostile: duplicate keys still let a real violation surface', () => {
		const fm = 'title: X\ntitle: Y\nartifactType: leetcode\n';
		const message = orderViolation(fm);
		assert.match(message ?? '', /artifactType/);
	});

	test('hostile: a __proto__ key is ignored, not read off the prototype chain', () => {
		const fm = '__proto__: 1\nartifactType: leetcode\ntitle: X\n';
		assert.strictEqual(orderViolation(fm), null);
	});

	test('hostile: a __proto__ line does not suppress a real violation after it — pins the Map, not a plain object', () => {
		// With a plain-object lookup, `__proto__: 1` would rebind the running
		// "last index" to `Object.prototype` itself, so every later `<`
		// comparison reads false and the real 'tags' → 'title' violation below
		// it goes unreported. A `Map` has no such slot to rebind.
		const message = orderViolation('tags: x\n__proto__: 1\ntitle: Y\n');
		assert.match(message ?? '', /title/);
		assert.match(message ?? '', /must come before/);
	});

	test('hostile: a line with no colon is skipped, not thrown on', () => {
		const fm = 'not-a-key-line-at-all\nartifactType: leetcode\ntitle: X\n';
		assert.strictEqual(orderViolation(fm), null);
	});

	test('hostile: an empty document produces no violation', () => {
		assert.strictEqual(orderViolation('\n\n\n'), null);
	});

	test('hostile: CRLF line endings parse the same as LF', () => {
		const message = orderViolation('title: X\r\nartifactType: leetcode\r\n');
		assert.match(message ?? '', /artifactType/);
	});

	test('hostile: a 10,000-character key is ignored (unknown), not a hang or a crash', () => {
		const longKey = 'a'.repeat(10_000);
		const fm = `${longKey}: 1\nartifactType: leetcode\ntitle: X\n`;
		const start = Date.now();
		const message = orderViolation(fm);
		assert.strictEqual(message, null);
		assert.ok(Date.now() - start < 1000, 'must not hang on a long unknown key');
	});
});
