import * as assert from 'node:assert';
import { migrateExerciseAxes } from '../src/services/exercise-axes-migrator.helpers.js';

/**
 * T1.13 — the v2 → two-axis migration, as a pure transform.
 *
 * This runs over 75 real artifacts in the user's vault, so the properties that
 * matter are as much about what it *leaves alone* as what it rewrites: unknown
 * frontmatter keys, line endings, prose, `## Files`, and every `kind:` value.
 *
 * Inline fixtures only — a test that walked a vault directory would pass or
 * fail depending on whose checkout ran it.
 */
suite('migrate-exercise-axes', () => {

	const V2_FUNCTION = [
		'---',
		'type: leetcode',
		'title: Two Sum',
		'difficulty: easy',
		'status: unsolved',
		'---',
		'',
		'Find two numbers.',
		'',
		'```yaml leetcode',
		'function: twoSum',
		'test:',
		'  type: function',
		'  timeoutMs: 5000',
		'```',
	].join('\n');

	const V2_PROJECT = [
		'---',
		'type: leetcode',
		'title: Widget',
		'difficulty: medium',
		'---',
		'',
		'A tree.',
		'',
		'```yaml leetcode',
		'test:',
		'  type: project',
		'  timeoutMs: 10000',
		'  checks:',
		'    - name: app builds',
		'      kind: build',
		'      argv: ["npx", "tsc", "--noEmit"]',
		'```',
	].join('\n');

	// ── frontmatter ───────────────────────────────────────────────────────────

	test('renames the discriminator and inserts the derived leetcode type second', () => {
		const out = migrateExerciseAxes(V2_FUNCTION);
		const fm = out.split('---')[1].trim().split('\n');
		assert.strictEqual(fm[0], 'artifactType: leetcode');
		assert.strictEqual(fm[1], 'leetcodeType: function');
	});

	test('derives package from a body test.type of project', () => {
		assert.ok(migrateExerciseAxes(V2_PROJECT).includes('leetcodeType: package'));
	});

	test('derives stack from a body test.type of service', () => {
		const md = V2_PROJECT.replace('  type: project', '  type: service');
		assert.ok(migrateExerciseAxes(md).includes('leetcodeType: stack'));
	});

	test('puts the retained keys in canonical order', () => {
		const md = ['---', 'title: X', 'tags: [a]', 'type: leetcode', 'difficulty: easy', '---', '', 'B.'].join('\n');
		const fm = migrateExerciseAxes(md).split('---')[1].trim().split('\n');
		assert.deepStrictEqual(fm.map(l => l.split(':')[0]),
			['artifactType', 'leetcodeType', 'title', 'difficulty', 'tags']);
	});

	test('an absent canonical key is not invented — 12 vault artifacts have no status:', () => {
		const out = migrateExerciseAxes(V2_PROJECT);
		assert.ok(!out.includes('status:'), out);
	});

	test('an unknown frontmatter key keeps its own slot', () => {
		const md = ['---', 'title: X', 'source: https://example.com', 'type: leetcode', '---', '', 'B.'].join('\n');
		const fm = migrateExerciseAxes(md).split('---')[1].trim().split('\n');
		// The custom key holds slot 1; the canonical keys fill the slots around it.
		assert.strictEqual(fm[1], 'source: https://example.com');
		assert.deepStrictEqual(fm.map(l => l.split(':')[0]),
			['artifactType', 'source', 'leetcodeType', 'title']);
	});

	// ── body (D14) ────────────────────────────────────────────────────────────

	test('drops the legacy type: line from a check-graded test: block, keeping timeoutMs', () => {
		const out = migrateExerciseAxes(V2_PROJECT);
		assert.ok(!out.includes('  type: project'), out);
		assert.ok(out.includes('  timeoutMs: 10000'), out);
		assert.ok(out.includes('  checks:'), out);
	});

	test('keeps the type: line of a test: block that declares no checks:', () => {
		assert.ok(migrateExerciseAxes(V2_FUNCTION).includes('  type: function'));
	});

	test('renames a services: block to packages:', () => {
		const md = V2_PROJECT.replace('test:', 'services:\n  - name: api\ntest:');
		const out = migrateExerciseAxes(md);
		assert.ok(out.includes('packages:'), out);
		assert.ok(!out.includes('services:'), out);
	});

	test('never touches a kind: value — `call` has no environment until wave 3.D', () => {
		const md = V2_PROJECT.replace('kind: build', 'kind: function');
		assert.ok(migrateExerciseAxes(md).includes('kind: function'));
	});

	// ── what it must leave alone ──────────────────────────────────────────────

	test('preserves CRLF line endings — a previous migration corrupted a vault file', () => {
		const crlf = V2_PROJECT.replace(/\n/g, '\r\n');
		const out = migrateExerciseAxes(crlf);
		assert.ok(out.includes('\r\n'), 'CRLF was normalised away');
		assert.ok(!/[^\r]\n/.test(out), 'a bare LF appeared in a CRLF document');
	});

	test('leaves prose and fenced content untouched', () => {
		const md = V2_FUNCTION + '\n\n## Files\n\n```typescript path=a.ts\nconst type = 1;\n```\n';
		const out = migrateExerciseAxes(md);
		assert.ok(out.includes('const type = 1;'), out);
		assert.ok(out.includes('Find two numbers.'), out);
	});

	test('a document with no frontmatter is returned unchanged', () => {
		const plain = '# Just a note\n\nNothing to migrate.\n';
		assert.strictEqual(migrateExerciseAxes(plain), plain);
	});

	// ── idempotency ───────────────────────────────────────────────────────────

	test('is idempotent — a second pass is byte-identical', () => {
		for (const fixture of [V2_FUNCTION, V2_PROJECT]) {
			const once = migrateExerciseAxes(fixture);
			assert.strictEqual(migrateExerciseAxes(once), once);
		}
	});
});
