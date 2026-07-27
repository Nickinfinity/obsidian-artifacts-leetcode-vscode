import * as assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Spawn tests for the committed arbitrary-candidate grader
 * (`scripts/grade-candidate.mjs`, eval-fixes TA.1 / gap G3).
 *
 * The CLI is the security boundary: it takes a candidate **path** from argv
 * (operator input) and grades that file's contents through the real `runSuite`.
 * These tests therefore drive it as a process — exit code is the contract —
 * rather than importing a function, which would not exercise the argv layer.
 */
suite('grade-candidate CLI', () => {

	const repoRoot = path.join(__dirname, '..', '..');
	const cli = path.join(repoRoot, 'scripts', 'grade-candidate.mjs');

	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-cli-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	/** Write `content` into the run's temp dir and return its absolute path. */
	function write(name: string, content: string): string {
		const file = path.join(tmpDir, name);
		fs.writeFileSync(file, content, 'utf-8');
		return file;
	}

	/** A minimal `function`-type artifact: `sum(a, b)`, 2 public + 1 hidden final case. */
	function buildMd(testType = 'function'): string {
		const tests = [
			{ input: { a: 1, b: 2 }, expected: 3 },
			{ input: { a: 5, b: 7 }, expected: 12 },
		];
		const finalTests = [{ input: { a: 2, b: 2 }, expected: 4 }];
		return [
			'---',
			'type: leetcode',
			'title: Sum',
			'difficulty: easy',
			'function: sum',
			'params:',
			'  - name: a',
			'    type: int',
			'  - name: b',
			'    type: int',
			'returns: int',
			'test:',
			`  type: ${testType}`,
			'---',
			'',
			'Add two integers.',
			'',
			'## Tests',
			'```json',
			JSON.stringify(tests, null, 2),
			'```',
			'',
			'## Final Tests',
			'```json',
			JSON.stringify(finalTests, null, 2),
			'```',
			'',
		].join('\n');
	}

	/** Run the CLI with `args` and return its exit status plus merged output. */
	function grade(...args: string[]): { status: number | null; out: string } {
		const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf-8' });
		return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
	}

	test('a correct candidate grades solved (exit 0) against public + hidden final', () => {
		const md = write('sum.md', buildMd());
		const candidate = write('sol.js', 'function sum(a, b) { return a + b; }');

		const { status, out } = grade(md, 'javascript', candidate);

		assert.strictEqual(status, 0, out);
		assert.ok(/VERDICT/.test(out), out);
	});

	test('a wrong candidate grades not-solved (exit 1)', () => {
		const md = write('sum.md', buildMd());
		const candidate = write('bad.js', 'function sum(a, b) { return a - b; }');

		const { status, out } = grade(md, 'javascript', candidate);

		assert.strictEqual(status, 1, out);
	});

	test('a candidate that passes the public cases but fails a hidden final is not-solved', () => {
		const md = write('sum.md', buildMd());
		// Hardcodes the two visible cases; the hidden `2 + 2` case exposes it.
		const candidate = write('cheat.js', 'function sum(a, b) { return a === 1 ? 3 : 12; }');

		const { status } = grade(md, 'javascript', candidate);

		assert.strictEqual(status, 1);
	});

	test('missing arguments are bad input (exit 2)', () => {
		const md = write('sum.md', buildMd());
		assert.strictEqual(grade(md, 'javascript').status, 2);
	});

	test('a candidate path that does not exist is bad input (exit 2)', () => {
		const md = write('sum.md', buildMd());
		const { status, out } = grade(md, 'javascript', path.join(tmpDir, 'nope.js'));
		assert.strictEqual(status, 2, out);
	});

	test('a reserved test.type has no environment (exit 3)', () => {
		const md = write('reserved.md', buildMd('class'));
		const candidate = write('sol.js', 'function sum(a, b) { return a + b; }');

		const { status, out } = grade(md, 'javascript', candidate);

		assert.strictEqual(status, 3, out);
	});

	test('an unknown language has no environment (exit 3)', () => {
		const md = write('sum.md', buildMd());
		const candidate = write('sol.js', 'function sum(a, b) { return a + b; }');

		assert.strictEqual(grade(md, 'cobol', candidate).status, 3);
	});
});
