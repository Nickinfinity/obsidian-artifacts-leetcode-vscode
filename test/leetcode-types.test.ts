import * as assert from 'node:assert';
import { LEETCODE_TYPES, isLeetcodeType, shapeOf } from '../src/types/leetcode-type.js';

/**
 * Unit tests for the **leetcode-type axis** — what an artifact *is* (one
 * buffer, one package, several packages), as opposed to how it is graded.
 *
 * The sibling axis (`TEST_TYPES`, "how is a case delivered and compared?")
 * is covered by `leetcode-test-config.test.ts`. Keeping them apart is the
 * point of the split: one value used to answer both questions.
 */
suite('leetcode type axis', () => {

	test('shapeOf names the artifact shape for every id', () => {
		assert.strictEqual(shapeOf('stack'), 'trees');
		assert.strictEqual(shapeOf('package'), 'tree');
		assert.strictEqual(shapeOf('function'), 'buffer');
	});

	test('the table holds exactly the three declared types', () => {
		assert.deepStrictEqual(LEETCODE_TYPES.map(row => row.id), ['function', 'package', 'stack']);
	});

	test('every row pairs its id with the shape shapeOf reports', () => {
		for (const row of LEETCODE_TYPES) {
			assert.strictEqual(shapeOf(row.id), row.shape, `row ${row.id}`);
		}
	});

	test('only `function` is a single buffer — the other two are file trees', () => {
		const trees = LEETCODE_TYPES.filter(row => row.shape !== 'buffer').map(row => row.id);
		assert.deepStrictEqual(trees, ['package', 'stack']);
	});

	test('isLeetcodeType accepts the three ids', () => {
		assert.ok(isLeetcodeType('function'));
		assert.ok(isLeetcodeType('package'));
		assert.ok(isLeetcodeType('stack'));
	});

	test('isLeetcodeType refuses the retired test-type spellings', () => {
		// `project` and `service` are derivation *inputs* (§C.6), never ids.
		assert.ok(!isLeetcodeType('project'));
		assert.ok(!isLeetcodeType('service'));
	});

	test('isLeetcodeType refuses hostile and non-string values', () => {
		// Frontmatter is untrusted: an artifact may declare anything at all.
		assert.ok(!isLeetcodeType('__proto__'));
		assert.ok(!isLeetcodeType('constructor'));
		assert.ok(!isLeetcodeType('toString'));
		assert.ok(!isLeetcodeType(''));
		assert.ok(!isLeetcodeType('FUNCTION'));
		assert.ok(!isLeetcodeType(undefined));
		assert.ok(!isLeetcodeType(null));
		assert.ok(!isLeetcodeType({ id: 'package' }));
	});

	test('every row carries a non-empty description', () => {
		for (const row of LEETCODE_TYPES) {
			assert.ok(row.description.length > 0, `row ${row.id}`);
		}
	});
});
