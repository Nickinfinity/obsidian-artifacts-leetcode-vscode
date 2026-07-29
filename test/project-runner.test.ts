import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';
import { gradeProjectDir, runProjectChecks } from '../src/services/test-envs/project/project.runner.js';

/**
 * Grading a project directory (the in-editor solve flow's half that is not
 * `vscode`-coupled).
 *
 * Fixtures use a **function** check throughout: it runs through the existing
 * javascript environment, so the whole suite is deterministic and offline,
 * while still exercising the per-case machinery the public/final split needs.
 * The render kinds keep their opt-in end-to-end coverage.
 */
suite('project runner', () => {

	let runDir: string;

	setup(() => {
		runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-runner-'));
	});

	teardown(() => {
		fs.rmSync(runDir, { recursive: true, force: true });
	});

	/**
	 * A project with one function check over `src/double.js`: two public cases
	 * and one hidden one, all correct for a real `double`.
	 */
	function artifact(): string {
		return [
			'---',
			'type: leetcode',
			'title: Double',
			'params:',
			'  - name: n',
			'    type: int',
			'returns: int',
			'test:',
			'  type: project',
			'  checks:',
			'    - name: doubles',
			'      kind: function',
			'      file: src/double.js',
			'      function: double',
			'---',
			'',
			'Double a number.',
			'',
			'## Tests',
			'',
			'```json check=doubles',
			'[{ "input": { "n": 1 }, "expected": 2 }, { "input": { "n": 2 }, "expected": 4 }]',
			'```',
			'',
			'## Final Tests',
			'',
			'```json check=doubles',
			'[{ "input": { "n": 10 }, "expected": 20 }]',
			'```',
			'',
			'## Files',
			'',
			'```javascript path=src/double.js role=editable',
			'export function double(n) { return 0; }',
			'```',
			'',
			'# Solutions',
			'',
			'```javascript path=src/double.js',
			'export function double(n) { return n * 2; }',
			'```',
			'',
		].join('\n');
	}

	/** Write `source` as the project's single file inside the run dir. */
	function writeCandidate(source: string): void {
		fs.mkdirSync(path.join(runDir, 'src'), { recursive: true });
		fs.writeFileSync(path.join(runDir, 'src/double.js'), source, 'utf-8');
	}

	// ── gradeProjectDir: grades what is on disk, writes nothing ──────────────

	test('grades the directory as it stands, without rewriting it', async () => {
		writeCandidate('export function double(n) { return n * 2; }');
		const outcomes = await gradeProjectDir(parseLeetCode(artifact()), runDir);

		assert.strictEqual(outcomes[0].passed, true, outcomes[0].detail);
		// The solver's file is untouched — grading a live tree must never
		// overwrite it with the artifact's starter.
		assert.strictEqual(
			fs.readFileSync(path.join(runDir, 'src/double.js'), 'utf-8'),
			'export function double(n) { return n * 2; }',
		);
	});

	test('a wrong implementation fails and names the case that broke', async () => {
		// Correct for case 0, wrong from case 1 on — so a reported index of 1 is
		// the real failing case, not just "the first case".
		writeCandidate('export function double(n) { return n === 1 ? 2 : 0; }');
		const outcomes = await gradeProjectDir(parseLeetCode(artifact()), runDir);

		assert.strictEqual(outcomes[0].passed, false);
		assert.ok(outcomes[0].detail?.includes('case 1'), outcomes[0].detail);
	});

	// ── publicOnly: the hidden suite stays hidden mid-challenge ──────────────

	suite('publicOnly (the Run Tests loop)', () => {

		/** Correct for the two public cases, wrong for the hidden `10 → 20`. */
		const CHEAT = 'export function double(n) { return n === 1 ? 2 : 4; }';

		test('a candidate that only satisfies the visible cases passes Run Tests', async () => {
			writeCandidate(CHEAT);
			const outcomes = await gradeProjectDir(parseLeetCode(artifact()), runDir, { publicOnly: true });
			assert.strictEqual(outcomes[0].passed, true, outcomes[0].detail);
		});

		test('and fails Submit, which grades the hidden cases too', async () => {
			writeCandidate(CHEAT);
			const outcomes = await gradeProjectDir(parseLeetCode(artifact()), runDir);
			assert.strictEqual(outcomes[0].passed, false);
		});

		test('a check with no public cases grades nothing rather than everything', async () => {
			// `publicCount` is 0 here, so the public slice is empty — the opposite
			// mistake (treating "no public cases" as "all cases") would leak the
			// hidden suite into the mid-challenge loop.
			const hiddenOnly = artifact()
				.replace('## Tests\n\n```json check=doubles\n[{ "input": { "n": 1 }, "expected": 2 }, { "input": { "n": 2 }, "expected": 4 }]\n```\n\n', '');
			writeCandidate('export function double(n) { return 0; }');

			const outcomes = await gradeProjectDir(parseLeetCode(hiddenOnly), runDir, { publicOnly: true });
			assert.strictEqual(outcomes[0].passed, false);
			assert.ok(/no cases/.test(outcomes[0].detail ?? ''), outcomes[0].detail);
		});
	});

	// ── runProjectChecks still materialises its own copy ─────────────────────

	test('runProjectChecks grades the starter tree by default', async () => {
		const outcomes = await runProjectChecks(parseLeetCode(artifact()));
		assert.strictEqual(outcomes[0].passed, false, 'the starter returns 0');
	});

	test('runProjectChecks with solutions grades the reference tree', async () => {
		const outcomes = await runProjectChecks(parseLeetCode(artifact()), { withSolutions: true });
		assert.strictEqual(outcomes[0].passed, true, outcomes[0].detail);
	});
});
