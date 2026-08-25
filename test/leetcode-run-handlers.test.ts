import * as assert from 'node:assert';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';
import { projectGradeRefusal } from '../src/commands/leetcode-run.helpers.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

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
			'      function: handler',
			// An `http` check names a package instead of a file, and is dropped
			// without one — which would make it look "unimplemented" to this
			// guard for entirely the wrong reason.
			...(kind === 'http' ? ['      package: api'] : []),
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
	 * **The pin.** A `build` check that parses fine sits beside a `class` check
	 * that was dropped as unimplemented. Grading the survivor alone reports the
	 * exercise solved while the half it is actually about never ran — so the
	 * refusal is artifact-wide, and it names the kind.
	 *
	 * The kind here was `http` until T3.5 implemented it. That is exactly the
	 * hazard this suite exists for: a pin written against *whichever id happens
	 * to be unimplemented* stops testing anything the day that id lands, and
	 * would have gone green while asserting nothing. `class` is reserved with
	 * no dispatch, and the test below proves `http` moved to the other side.
	 */
	test('SEC: an artifact declaring a kind nothing implements is refused as a whole, by name', () => {
		const md = artifact(['build', 'class']);
		const refusal = projectGradeRefusal(md, parseLeetCode(md));
		assert.ok(refusal !== null, 'expected a refusal, got null — the S3 guard is inert');
		assert.ok(refusal.includes('class'), refusal);
	});

	test('SEC: the refusal survives the check being dropped from `checks`', () => {
		const md = artifact(['build', 'class']);
		const parsed = parseLeetCode(md);
		// `checks` holds only the survivor, which is precisely why the guard may
		// not be built from it.
		assert.deepStrictEqual(parsed.checks?.map(c => c.kind), ['build']);
		assert.ok(projectGradeRefusal(md, parsed) !== null);
	});

	/**
	 * The other half of the same rule, and the one that changed meaning at
	 * T3.5: an `http` check is now dispatched by `runOneCheck`, so it must
	 * **stop** being refused. Four vault artifacts declare one; until this
	 * wave every one of them was ungradeable by name.
	 */
	test('an artifact declaring `http` is no longer refused — the kind is dispatched now', () => {
		const md = artifact(['build', 'http']);
		const parsed = parseLeetCode(md);
		assert.deepStrictEqual(parsed.checks?.map(c => c.kind), ['build', 'http']);
		assert.strictEqual(projectGradeRefusal(md, parsed), null);
	});

	/**
	 * `leetcodeType` became **required** on `ParsedLeetCode` at T3.5 (C1/C6),
	 * so this case is no longer reachable through the type system — the cast
	 * is what makes it reachable at all. The guard stays because the two CLI
	 * harnesses (`verify-exercise.mjs`, `grade-candidate.mjs`) are plain JS
	 * importing from `dist/`, where no compiler enforces the field, and
	 * because the honest answer to an absent axis is a refusal rather than
	 * `?? 'function'` — which would measure a tree against a buffer's rules.
	 */
	test('a parsed artifact with no leetcode type is refused, never defaulted', () => {
		const md = artifact(['build']);
		const parsed = { ...parseLeetCode(md), leetcodeType: undefined } as unknown as ParsedLeetCode;
		assert.ok(projectGradeRefusal(md, parsed) !== null);
	});
});
