import * as assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Spawn tests for `scripts/grade-tree-candidate.mjs`, the multi-file sibling
 * of `grade-candidate.mjs`: grades an external candidate DIRECTORY against a
 * `package`/`stack` artifact's declared `checks:`.
 *
 * The CLI is the security boundary: it takes a candidate directory **path**
 * from argv (operator input) and overlays its real files onto the artifact's
 * starter tree before grading. These tests drive it as a process — exit code
 * and stdout are the contract — rather than importing a function, which would
 * not exercise the argv layer, and never touch a vault path or any
 * machine-local absolute path (fixtures are all inline, dirs all `mkdtemp`).
 */
suite('grade-tree-candidate CLI', () => {

	const repoRoot = path.join(__dirname, '..', '..');
	const cli = path.join(repoRoot, 'scripts', 'grade-tree-candidate.mjs');

	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-tree-cli-'));
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

	/** Materialise a candidate directory from `{ relativePath: content }` and return its root. */
	function writeCandidateDir(files: Record<string, string>): string {
		const dir = path.join(tmpDir, `candidate-${Object.keys(files).length}-${Math.random().toString(36).slice(2)}`);
		for (const [rel, content] of Object.entries(files)) {
			const full = path.join(dir, rel);
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, content, 'utf-8');
		}
		return dir;
	}

	/**
	 * A minimal `package` artifact: one `call` check over `src/sol.js`
	 * (`add(a, b)`), 2 public + 1 hidden final case. The final case's inputs
	 * (`100, 1`) never appear in a public case, so a candidate that special-cases
	 * them is unambiguously cheating on the hidden suite rather than coincidentally
	 * correct.
	 */
	function buildPackageMd(): string {
		const publicCases = [
			{ input: { a: 1, b: 2 }, expected: 3 },
			{ input: { a: 5, b: 7 }, expected: 12 },
		];
		const finalCases = [{ input: { a: 100, b: 1 }, expected: 101 }];
		return [
			'---',
			'artifactType: leetcode',
			'leetcodeType: package',
			'title: Adder',
			'---',
			'',
			'Add two integers, as a one-file package exercise.',
			'',
			'```yaml leetcode',
			'params:',
			'  - name: a',
			'    type: int',
			'  - name: b',
			'    type: int',
			'returns: int',
			'test:',
			'  checks:',
			'    - name: adder',
			'      kind: call',
			'      file: src/sol.js',
			'      function: add',
			'```',
			'',
			'## Tests',
			'',
			'```json check=adder',
			JSON.stringify(publicCases),
			'```',
			'',
			'## Final Tests',
			'',
			'```json check=adder',
			JSON.stringify(finalCases),
			'```',
			'',
			'## Files',
			'',
			'```javascript path=src/sol.js role=editable',
			'export function add(a, b) { return 0; }',
			'```',
			'',
		].join('\n');
	}

	/**
	 * A `call` check whose graded file is `role: readonly` — the shape behind
	 * the reproduced false-`solved`: 7 of 9 vault artifacts declaring
	 * `role: readonly` put that file inside the grading path (a pytest spec, a
	 * `build` check's `tsconfig.json`, `hello-stack.md`'s relay). The starter
	 * content here is already a correct `add`, so any overlay attempt — correct
	 * or not — must be refused before grading, not silently accepted or denied.
	 */
	function buildReadonlyCheckMd(): string {
		const publicCases = [{ input: { a: 1, b: 2 }, expected: 3 }];
		return [
			'---',
			'artifactType: leetcode',
			'leetcodeType: package',
			'title: Adder RO',
			'---',
			'',
			'Add two integers; the graded file is read-only starter content.',
			'',
			'```yaml leetcode',
			'test:',
			'  checks:',
			'    - name: adder',
			'      kind: call',
			'      file: src/sol.js',
			'      function: add',
			'```',
			'',
			'## Tests',
			'```json check=adder',
			JSON.stringify(publicCases),
			'```',
			'',
			'## Files',
			'```javascript path=src/sol.js role=readonly',
			'export function add(a, b) { return a + b; }',
			'```',
			'',
		].join('\n');
	}

	/**
	 * One well-formed `call` check plus one declaring a reserved `kind:`
	 * (`class`). The reserved one is dropped at parse time — `parsed.checks`
	 * holds only the survivor, so this fixture needs the `call` check to keep
	 * `checks.length > 0` and actually exercise `projectGradeRefusal`'s route,
	 * rather than tripping the earlier "no checks: at all" gate.
	 */
	function buildReservedKindMd(): string {
		return [
			'---',
			'artifactType: leetcode',
			'leetcodeType: package',
			'title: Reserved Kind',
			'---',
			'',
			'One implemented check, one kind nothing implements yet.',
			'',
			'```yaml leetcode',
			'test:',
			'  checks:',
			'    - name: adder',
			'      kind: call',
			'      file: src/sol.js',
			'      function: add',
			'    - name: stateful',
			'      kind: class',
			'```',
			'',
			'## Tests',
			'```json check=adder',
			JSON.stringify([{ input: { a: 1, b: 2 }, expected: 3 }]),
			'```',
			'',
			'## Files',
			'```javascript path=src/sol.js role=editable',
			'export function add(a, b) { return a + b; }',
			'```',
			'',
		].join('\n');
	}

	/** The same shape, but with no `checks:` declared at all — nothing to grade. */
	function buildNoChecksMd(): string {
		return [
			'---',
			'artifactType: leetcode',
			'leetcodeType: package',
			'title: Empty',
			'---',
			'',
			'Nothing to grade.',
			'',
			'## Files',
			'',
			'```javascript path=src/sol.js role=editable',
			'export function add(a, b) { return a + b; }',
			'```',
			'',
		].join('\n');
	}

	/** A plain `function` (single-buffer) artifact — not multi-file. */
	function buildFunctionMd(): string {
		return [
			'---',
			'artifactType: leetcode',
			'title: Sum',
			'---',
			'',
			'Add two integers.',
			'',
			'```yaml leetcode',
			'function: sum',
			'params:',
			'  - name: a',
			'    type: int',
			'  - name: b',
			'    type: int',
			'returns: int',
			'```',
			'',
			'## Tests',
			'```json',
			JSON.stringify([{ input: { a: 1, b: 2 }, expected: 3 }]),
			'```',
			'',
			'## Final Tests',
			'```json',
			JSON.stringify([{ input: { a: 2, b: 2 }, expected: 4 }]),
			'```',
			'',
		].join('\n');
	}

	/** Run the CLI with `args` and return its exit status plus merged output. */
	function grade(...args: string[]): { status: number | null; out: string } {
		const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf-8' });
		return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
	}

	/**
	 * A `package` whose only check is a `build` running `node` over a candidate
	 * file. `runBuildCheck` returns the child's raw stdout/stderr as the
	 * detail, so this fixture is how a toolchain diagnostic — which may quote
	 * ordinary `switch` syntax back at the operator — reaches the mask.
	 */
	function buildBuildCheckMd(): string {
		return [
			'---',
			'artifactType: leetcode',
			'leetcodeType: package',
			'title: Builder',
			'---',
			'',
			'The build must succeed.',
			'',
			'```yaml leetcode',
			'test:',
			'  checks:',
			'    - name: app builds',
			'      kind: build',
			'      argv: ["node", "build.js"]',
			'```',
			'',
			'## Files',
			'```javascript path=build.js',
			'console.log("ok");',
			'```',
			'',
		].join('\n');
	}

	test('a correct candidate tree grades solved (exit 0) against public + hidden final', () => {
		const md = write('adder.md', buildPackageMd());
		const candidate = writeCandidateDir({ 'src/sol.js': 'export function add(a, b) { return a + b; }' });

		const { status, out } = grade(md, candidate);

		assert.strictEqual(status, 0, out);
		assert.ok(/VERDICT/.test(out), out);
	});

	// ── Masking, direction 1: a PUBLIC case failure prints verbatim ────────────

	test('a candidate wrong on a public case reports that case verbatim', () => {
		const md = write('adder.md', buildPackageMd());
		const candidate = writeCandidateDir({ 'src/sol.js': 'export function add(a, b) { return a - b; }' });

		const { status, out } = grade(md, candidate);

		assert.strictEqual(status, 1, out);
		// Case 0 is `{a:1,b:2} -> 3`; `a - b` gives -1 — the real reason must be visible.
		assert.ok(out.includes('case 0: expected 3, got -1'), out);
	});

	// ── Masking, direction 2: a HIDDEN case failure prints only `hidden` ───────

	test('a candidate wrong only on the hidden final case is masked to `hidden`', () => {
		const md = write('adder.md', buildPackageMd());
		// Correct for both public cases; special-cases the final case's own
		// inputs (100, 1) to return a wrong answer — a cheat, not a coincidence.
		const candidate = writeCandidateDir({
			'src/sol.js': 'export function add(a, b) { return (a === 100 && b === 1) ? 0 : a + b; }',
		});

		const { status, out } = grade(md, candidate);

		assert.strictEqual(status, 1, out);
		assert.ok(out.includes('adder FAIL — hidden'), out);
		// The hidden case's expected value and the raw `case 2:` prefix must
		// never reach stdout — that is the whole point of the mask.
		assert.ok(!out.includes('101'), out);
		assert.ok(!/case 2:/.test(out), out);
	});

	// ── Gates ───────────────────────────────────────────────────────────────

	// ── Masking, direction 3: a `build` detail is raw child output, never a case ──

	test('a build check detail is never masked, even when its output contains `case N:`', () => {
		const md = write('builder.md', buildBuildCheckMd());
		// The child fails and quotes an offending source line back. `case 3:` is
		// ordinary `switch` syntax, not a case result — masking it would replace
		// the whole diagnostic with `hidden` and destroy the one channel a trial
		// has for telling a broken toolchain from a wrong answer.
		const candidate = writeCandidateDir({
			'build.js': 'console.error("app.js(12,7): error TS1117: case 3: duplicate label"); process.exit(1);',
		});

		const { status, out } = grade(md, candidate);

		assert.strictEqual(status, 1, out);
		assert.ok(/TS1117/.test(out), out);
		assert.ok(!/hidden/.test(out), out);
	});

	test('a non-multi-file artifact is bad input (exit 2)', () => {
		const md = write('sum.md', buildFunctionMd());
		const candidate = writeCandidateDir({ 'sol.js': 'function sum(a, b) { return a + b; }' });

		assert.strictEqual(grade(md, candidate).status, 2);
	});

	test('an artifact declaring no checks: has no environment (exit 3)', () => {
		const md = write('empty.md', buildNoChecksMd());
		const candidate = writeCandidateDir({ 'src/sol.js': 'export function add(a, b) { return a + b; }' });

		const { status, out } = grade(md, candidate);

		assert.strictEqual(status, 3, out);
	});

	test('an artifact declaring a reserved check kind is refused by projectGradeRefusal (exit 3)', () => {
		const md = write('reserved.md', buildReservedKindMd());
		const candidate = writeCandidateDir({ 'src/sol.js': 'export function add(a, b) { return a + b; }' });

		const { status, out } = grade(md, candidate);

		assert.strictEqual(status, 3, out);
		// Distinguishes this route from the "no checks:" gate above: the
		// artifact declares one, but nothing implements its kind.
		assert.ok(/class/.test(out), out);
		assert.ok(/ungradeable/.test(out), out);
	});

	test('a candidate overlaying a role: readonly graded file is refused (exit 2), never silently applied', () => {
		const md = write('readonly.md', buildReadonlyCheckMd());
		// Even a byte-identical, correct overlay must be refused — the point is
		// that a candidate can never touch this path, not that this one happens
		// to be wrong.
		const candidate = writeCandidateDir({ 'src/sol.js': 'export function add(a, b) { return a + b; }' });

		const { status, out } = grade(md, candidate);

		assert.strictEqual(status, 2, out);
		assert.ok(/src\/sol\.js/.test(out), out);
		assert.ok(/read-only/.test(out), out);
	});

	test('a candidate path resolving through a reserved node_modules segment is refused (exit 2)', () => {
		const md = write('adder.md', buildPackageMd());
		const candidate = writeCandidateDir({ 'node_modules/evil.js': 'module.exports = 1;' });

		const { status, out } = grade(md, candidate);

		assert.strictEqual(status, 2, out);
		assert.ok(/node_modules/.test(out), out);
	});

	test('missing arguments are bad input (exit 2)', () => {
		const md = write('adder.md', buildPackageMd());
		assert.strictEqual(grade(md).status, 2);
	});

	test('a missing candidate directory is bad input (exit 2)', () => {
		const md = write('adder.md', buildPackageMd());
		const { status, out } = grade(md, path.join(tmpDir, 'no-such-dir'));
		assert.strictEqual(status, 2, out);
	});

	test('a missing .md file is bad input (exit 2)', () => {
		const candidate = writeCandidateDir({ 'src/sol.js': 'export function add(a, b) { return a + b; }' });
		const { status, out } = grade(path.join(tmpDir, 'no-such.md'), candidate);
		assert.strictEqual(status, 2, out);
	});
});
