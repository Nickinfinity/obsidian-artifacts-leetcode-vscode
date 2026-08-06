import * as assert from 'node:assert';
import { isMultiFile } from '../src/types/constants.js';
import { LEETCODE_TYPES } from '../src/types/leetcode-type.js';

/**
 * `isMultiFile` after it stopped being a hand-kept set of test-type ids.
 *
 * Three unrelated concerns ask "is this artifact a file tree?" — the parser
 * (does `## Files` / `checks:` get parsed?), the challenge (does *Solve It*
 * materialise a directory or write one buffer?), and the panel (may the
 * selector offer a language the registry has no env for?). Each used to
 * answer it with its own `=== 'project'`, which is why `service` parsed a
 * file tree nothing ever opened.
 */
suite('isMultiFile — a property of the leetcode type', () => {

	test('the two tree shapes are multi-file', () => {
		assert.strictEqual(isMultiFile('package'), true);
		assert.strictEqual(isMultiFile('stack'), true);
	});

	test('a buffer exercise is not', () => {
		assert.strictEqual(isMultiFile('function'), false);
	});

	test('it agrees with the `shape` column for every declared type', () => {
		// The derivation is the point: no second list of "which types are
		// trees?" may exist beside `LEETCODE_TYPES`.
		for (const row of LEETCODE_TYPES) {
			assert.strictEqual(isMultiFile(row.id), row.shape !== 'buffer', `row ${row.id}`);
		}
	});

	test('an absent leetcode type is not treated as a tree', () => {
		// Only reachable for a hand-built fixture that never went through the
		// parser — `parseLeetCode` always resolves the field. Pinned so the
		// branch cannot quietly change sense while the field stays optional.
		assert.strictEqual(isMultiFile(undefined), false);
	});

	test('the retired test-type ids are refused loudly, not silently honoured', () => {
		// `project` / `service` were the old `MULTI_FILE_TYPES` members. They
		// are not `LeetcodeTypeId`s, so passing one is a compile error — only a
		// cast gets here, and a cast is a programming error rather than a
		// malformed artifact. `shapeOf` throws for it deliberately: answering
		// `false` would silently open a tree as a single buffer, which is the
		// exact failure the axis split exists to prevent. Parser output can
		// never reach this branch, since `resolveLeetcodeType` always returns a
		// declared id.
		assert.throws(() => isMultiFile('project' as never), /unknown leetcode type/);
		assert.throws(() => isMultiFile('service' as never), /unknown leetcode type/);
	});
});
