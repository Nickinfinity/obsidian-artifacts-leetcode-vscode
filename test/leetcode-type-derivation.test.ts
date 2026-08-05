import * as assert from 'node:assert';
import { deriveLeetcodeType, resolveLeetcodeType } from '../src/services/leetcode-type.helpers.js';
import { parseFrontmatterOnly, parseLeetCode } from '../src/services/leetcode-parser.service.js';

/**
 * Unit tests for the leetcode-type derivation table (plan §C.6):
 *
 * ```
 * leetcodeType absent  →  test.type function   →  leetcodeType function
 *                      →  test.type project    →  leetcodeType package
 *                      →  test.type service    →  leetcodeType stack
 * leetcodeType declared and unrecognised       →  falls back to derived, warns
 * ```
 *
 * Whether a *recognised* declared `leetcodeType` contradicts the declared
 * `test.type` is `verifyExercise`'s job (T1.7/T1.11), not this module's — these
 * tests only cover derivation, resolution, and the parser wiring.
 */
suite('deriveLeetcodeType', () => {

	test('an absent test.type derives the function default', () => {
		assert.strictEqual(deriveLeetcodeType(undefined), 'function');
	});

	test("legacy 'function' derives 'function'", () => {
		assert.strictEqual(deriveLeetcodeType('function'), 'function');
	});

	test("legacy 'project' derives 'package'", () => {
		assert.strictEqual(deriveLeetcodeType('project'), 'package');
	});

	test("legacy 'service' derives 'stack'", () => {
		assert.strictEqual(deriveLeetcodeType('service'), 'stack');
	});

	test('an id outside the legacy three (e.g. the new call) derives the function default', () => {
		assert.strictEqual(deriveLeetcodeType('call'), 'function');
	});

	test('SEC: a __proto__ raw test.type derives the function default, never the prototype object', () => {
		const result = deriveLeetcodeType('__proto__');
		assert.strictEqual(result, 'function');
		assert.strictEqual(typeof result, 'string');
	});

	test('SEC: a constructor raw test.type derives the function default', () => {
		assert.strictEqual(deriveLeetcodeType('constructor'), 'function');
	});

});

suite('resolveLeetcodeType', () => {

	test('a declared, recognised value wins outright — derivation never runs', () => {
		assert.deepStrictEqual(resolveLeetcodeType('package', 'call'), { leetcodeType: 'package' });
	});

	test('an absent declared value derives from the raw test.type', () => {
		assert.deepStrictEqual(resolveLeetcodeType(undefined, 'project'), { leetcodeType: 'package' });
	});

	test('both absent derives the function default', () => {
		assert.deepStrictEqual(resolveLeetcodeType(undefined, undefined), { leetcodeType: 'function' });
	});

	test('an unknown declared value falls back to the derived one and warns, naming both', () => {
		const result = resolveLeetcodeType('bogus', 'project');
		assert.strictEqual(result.leetcodeType, 'package');
		assert.ok(result.warning?.includes('bogus'), 'warning must name the rejected value');
		assert.ok(result.warning?.includes('package'), 'warning must name what it fell back to');
	});

	test('SEC: leetcodeType: __proto__ falls back safely to the function default and warns', () => {
		const result = resolveLeetcodeType('__proto__', undefined);
		assert.strictEqual(result.leetcodeType, 'function');
		assert.strictEqual(typeof result.leetcodeType, 'string');
		assert.ok(result.warning?.includes('__proto__'));
	});

	test('SEC: a 10,000-character declared value falls back safely and warns, and resolves quickly', () => {
		const huge = 'x'.repeat(10_000);
		const started = Date.now();
		const result = resolveLeetcodeType(huge, 'service');
		assert.strictEqual(result.leetcodeType, 'stack');
		assert.ok(result.warning?.includes(huge));
		assert.ok(Date.now() - started < 100, 'resolveLeetcodeType took too long on a 10,000-char value');
	});

});

suite('leetcodeType — end to end through parseLeetCode', () => {

	const FENCE = '```';

	function cfg(yaml: string): string {
		return [FENCE + 'yaml leetcode', yaml, FENCE].join('\n');
	}

	function doc(frontmatter: string[], testYaml: string): string {
		return ['---', ...frontmatter, '---', '', 'Body.', '', cfg(testYaml)].join('\n');
	}

	test('an artifact with no leetcodeType and test.type: project derives package', () => {
		const md = doc(['type: leetcode', 'title: Demo'], 'test:\n  type: project');
		assert.strictEqual(parseLeetCode(md).leetcodeType, 'package');
	});

	test('an artifact with no leetcodeType and test.type: service derives stack', () => {
		const md = doc(['type: leetcode', 'title: Demo'], 'test:\n  type: service');
		assert.strictEqual(parseLeetCode(md).leetcodeType, 'stack');
	});

	test('an artifact with no leetcodeType and no test: block derives function', () => {
		const md = ['---', 'type: leetcode', 'title: Demo', '---', '', 'Body.'].join('\n');
		assert.strictEqual(parseLeetCode(md).leetcodeType, 'function');
	});

	test('a declared, recognised leetcodeType is kept as-is, even beside an unrelated test.type', () => {
		// Whether this combination is a *contradiction* is verifyExercise's call
		// (T1.7/T1.11) — the parser only ever reports what was declared.
		const md = doc(['type: leetcode', 'leetcodeType: stack', 'title: Demo'], 'test:\n  type: function');
		assert.strictEqual(parseLeetCode(md).leetcodeType, 'stack');
	});

	test('an unknown declared leetcodeType falls back to derived and the warning reaches ParsedLeetCode.warnings', () => {
		const md = doc(['type: leetcode', 'leetcodeType: bogus', 'title: Demo'], 'test:\n  type: project');
		const parsed = parseLeetCode(md);
		assert.strictEqual(parsed.leetcodeType, 'package');
		assert.ok(parsed.warnings?.some(w => w.includes('bogus')));
	});

	test('SEC: leetcodeType: __proto__ in frontmatter never resolves to a non-string leetcode type', () => {
		const md = ['---', 'type: leetcode', 'leetcodeType: __proto__', 'title: Demo', '---', '', 'Body.'].join('\n');
		const parsed = parseLeetCode(md);
		assert.strictEqual(parsed.leetcodeType, 'function');
		assert.strictEqual(typeof parsed.leetcodeType, 'string');
		assert.ok(parsed.warnings?.some(w => w.includes('__proto__')));
	});

	test('SEC: an artifact declaring both type: and artifactType: still parses safely, deriving as usual', () => {
		const md = ['---', 'type: leetcode', 'artifactType: leetcode', 'title: Demo', '---', '', 'Body.'].join('\n');
		const parsed = parseLeetCode(md);
		assert.strictEqual(parsed.title, 'Demo');
		assert.strictEqual(parsed.leetcodeType, 'function');
	});

});

suite('parseFrontmatterOnly — leetcodeType for the picker', () => {

	test('returns the leetcode type derived from a v1-style test: block still in frontmatter', () => {
		const md = ['---', 'type: leetcode', 'title: Demo', 'test:', '  type: service', '---', '', 'Body.'].join('\n');
		assert.strictEqual(parseFrontmatterOnly(md).leetcodeType, 'stack');
	});

	test('returns a declared leetcodeType directly', () => {
		const md = ['---', 'type: leetcode', 'leetcodeType: package', 'title: Demo', '---', '', 'Body.'].join('\n');
		assert.strictEqual(parseFrontmatterOnly(md).leetcodeType, 'package');
	});

});
