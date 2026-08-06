import * as assert from 'node:assert';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';
import { projectGradeRefusal } from '../src/commands/leetcode-run.helpers.js';

/**
 * T1.16 — the `vscode`-free half of the run handlers' directory-grading
 * dispatch.
 *
 * The dispatch itself moved from `test.type === 'project'` to
 * `isMultiFile(parsed.leetcodeType)`, because the wave-1.E migration deletes
 * the `type:` line the old comparison read (D14) — after it, every migrated
 * artifact's `test.type` is the *default*, and the comparison is false on the
 * very files the migration just wrote.
 *
 * That swap alone re-opens **S3**, and this suite is what pins it shut.
 * `isMultiFile` is true for `package` **and** `stack`, so the guard has to
 * refuse on something other than the shape. A first attempt at this task
 * consulted `refusalFor` alone and shipped **inert** — past the `isMultiFile`
 * gate it resolves an env for anything, so it refused nothing a caller could
 * reach, while gating green. The `http` case below is the assertion that
 * attempt would have failed.
 */
suite('run handlers — directory-grading refusal', () => {

	const FILES_SECTION = [
		'## Files',
		'',
		'```typescript path=src/api.ts role=editable',
		'export const GET = () => null;',
		'```',
	].join('\n');

	/** Builds a check-graded artifact declaring exactly `kinds`. */
	function artifact(kinds: readonly string[], filesSection = FILES_SECTION): string {
		const checks = kinds.flatMap((kind, i) => [
			`    - name: check ${i}`,
			`      kind: ${kind}`,
			'      file: src/api.ts',
			...(kind === 'build' ? ['      argv: ["npx", "tsc", "--noEmit"]'] : []),
		]);
		return ['---', 'type: leetcode', 'title: P', '---', '', 'Body.', '',
			'```yaml leetcode', 'test:', '  type: project', '  checks:', ...checks,
			'```', '', filesSection].join('\n');
	}

	test('a package declaring only implemented kinds may be graded', () => {
		const md = artifact(['build']);
		assert.strictEqual(projectGradeRefusal(md, parseLeetCode(md)), null);
	});

	/**
	 * **The regression pin.** An earlier shape of this guard also asked the
	 * registry whether `(leetcodeType × 'project' × language)` was served, and
	 * callers with no live session supplied `files[0].language` — the fence
	 * language of the *first file in the tree*. `## Files` is heterogeneous by
	 * design, so that is routinely `json`/`css`/`html`, and the guard
	 * hard-refused real artifacts: the vault's `build-check-smoke.md`, whose
	 * first file is `tsconfig.json`, failed with *"package artifacts cannot run
	 * 'project' in json"*.
	 *
	 * Every other test here hands the guard a hand-picked language, so none of
	 * them could see it. This one feeds it what a caller actually derives.
	 */
	test('SEC: a tree whose first file is a non-runnable fence language still grades', () => {
		const configFirst = [
			'## Files',
			'',
			'```json path=tsconfig.json role=readonly',
			'{ "compilerOptions": {} }',
			'```',
			'',
			'```typescript path=src/api.ts role=editable',
			'export const GET = () => null;',
			'```',
		].join('\n');
		const md = artifact(['build'], configFirst);
		const parsed = parseLeetCode(md);
		assert.strictEqual(parsed.files?.[0]?.language, 'json', 'fixture must lead with a non-runnable fence');
		assert.strictEqual(projectGradeRefusal(md, parsed), null);
	});

	/**
	 * **The pin.** A `build` check that parses fine sits beside an `http` check
	 * that was dropped as unimplemented. Grading the survivor alone reports the
	 * exercise solved while the half it is actually about never ran — so the
	 * refusal is artifact-wide, and it names the kind.
	 */
	test('SEC: an artifact declaring a kind nothing implements is refused as a whole, by name', () => {
		const md = artifact(['build', 'http']);
		const refusal = projectGradeRefusal(md, parseLeetCode(md));
		assert.ok(refusal !== null, 'expected a refusal, got null — the S3 guard is inert');
		assert.ok(refusal.includes('http'), refusal);
	});

	test('SEC: the refusal survives the check being dropped from `checks`', () => {
		const md = artifact(['build', 'http']);
		const parsed = parseLeetCode(md);
		// `checks` holds only the survivor, which is precisely why the guard may
		// not be built from it.
		assert.deepStrictEqual(parsed.checks?.map(c => c.kind), ['build']);
		assert.ok(projectGradeRefusal(md, parsed) !== null);
	});

	/**
	 * `leetcodeType` is optional on `ParsedLeetCode` (carried condition C1), so
	 * the absent case is reachable by type. It is answered explicitly rather
	 * than defaulted — `?? 'function'` would silently measure a tree against a
	 * buffer's rules.
	 */
	test('a parsed artifact with no leetcode type is refused, never defaulted', () => {
		const md = artifact(['build']);
		const parsed = { ...parseLeetCode(md), leetcodeType: undefined };
		assert.ok(projectGradeRefusal(md, parsed) !== null);
	});
});
