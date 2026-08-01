import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';
import { renderLibsFor } from '../src/services/test-envs/project/checks.js';
import { libEnvDir } from '../src/services/libs/lib-cache.service.js';
import { linkModules } from '../src/services/test-envs/project/modules.linker.js';
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
			'---',
			'',
			'Double a number.',
			'',
			'```yaml leetcode',
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
			'```',
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

	// ── T4 §B.1/§B.2: one install per grading run, linked into the run dir ───

	suite('libs install + link', () => {

		/** Same `doubles` function check as `artifact()`, plus a declared `libs:` entry. */
		function artifactWithLibs(): string {
			return [
				'---',
				'type: leetcode',
				'title: Double',
				'---',
				'',
				'Double a number.',
				'',
				'```yaml leetcode',
				'params:',
				'  - name: n',
				'    type: int',
				'returns: int',
				'libs:',
				'  javascript:',
				'    - lodash@^4.17.21',
				'test:',
				'  type: project',
				'  checks:',
				'    - name: doubles',
				'      kind: function',
				'      file: src/double.js',
				'      function: double',
				'```',
				'',
				'## Tests',
				'',
				'```json check=doubles',
				'[{ "input": { "n": 1 }, "expected": 2 }]',
				'```',
				'',
				'## Files',
				'',
				'```javascript path=src/double.js role=editable',
				'export function double(n) { return n * 2; }',
				'```',
				'',
			].join('\n');
		}

		/**
		 * `artifactWithLibs()` plus a language the npm-only installer cannot serve.
		 *
		 * Derived by `replace()` on purpose: if the anchor ever drifts the block is
		 * dropped, the install set loses `python`, and the test that asserts the
		 * warning goes red — the failure points the safe direction.
		 */
		function artifactWithMultiLangLibs(): string {
			return artifactWithLibs().replace(
				'  javascript:\n    - lodash@^4.17.21',
				'  javascript:\n    - lodash@^4.17.21\n  python:\n    - requests>=2',
			);
		}

		/** A `dom-assert` check (with one real case) plus a `build` check that always exits 0. */
		function multiCheckArtifact(): string {
			return [
				'---',
				'type: leetcode',
				'title: Multi',
				'---',
				'',
				'Mounts and builds.',
				'',
				'```yaml leetcode',
				'params:',
				'  - name: n',
				'    type: int',
				'returns: int',
				'libs:',
				'  javascript:',
				'    - lodash@^4.17.21',
				'test:',
				'  type: project',
				'  checks:',
				'    - name: mounts',
				'      kind: dom-assert',
				'      file: src/App.jsx',
				'    - name: builds',
				'      kind: build',
				'      argv: ["node", "-e", "process.exit(0)"]',
				'```',
				'',
				'## Tests',
				'',
				'```json check=mounts',
				'[{ "input": { "steps": [{ "op": "count", "selector": "div" }] }, "expected": 1 }]',
				'```',
				'',
				'## Files',
				'',
				'```jsx path=src/App.jsx role=editable',
				'export default function App() { return null; }',
				'```',
				'',
			].join('\n');
		}

		/** Fake `npm install`: touches no network, just drops one resolvable package into the cache. */
		function fakeInstall(pkg: string): (file: string, args: string[], cwd: string) => Promise<void> {
			return async (_file, _args, cwd) => {
				const pkgDir = path.join(cwd, 'node_modules', pkg);
				fs.mkdirSync(pkgDir, { recursive: true });
				fs.writeFileSync(path.join(pkgDir, 'index.js'), 'module.exports = 42;\n');
			};
		}

		let cacheRoot: string;
		const previousCache = process.env.OBSIDIAN_LEETCODE_LIBCACHE;

		setup(() => {
			cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'libcache-'));
			process.env.OBSIDIAN_LEETCODE_LIBCACHE = cacheRoot;
		});

		teardown(() => {
			if (previousCache === undefined) { delete process.env.OBSIDIAN_LEETCODE_LIBCACHE; }
			else { process.env.OBSIDIAN_LEETCODE_LIBCACHE = previousCache; }
			fs.rmSync(cacheRoot, { recursive: true, force: true });
		});

		test('a project declaring libs gets a real node_modules that resolves the declared package', async () => {
			writeCandidate('export function double(n) { return n * 2; }');
			const outcomes = await gradeProjectDir(parseLeetCode(artifactWithLibs()), runDir, {
				installRun: fakeInstall('lodash'),
			});

			assert.strictEqual(outcomes[0].passed, true, outcomes[0].detail);
			const linked = path.join(runDir, 'node_modules', 'lodash');
			assert.ok(fs.lstatSync(linked).isSymbolicLink(), 'lodash should be linked into the run directory');
			assert.strictEqual(fs.readFileSync(path.join(linked, 'index.js'), 'utf-8'), 'module.exports = 42;\n');
		});

		test('a project declaring no libs creates no node_modules at all', async () => {
			writeCandidate('export function double(n) { return n * 2; }');
			await gradeProjectDir(parseLeetCode(artifact()), runDir);
			assert.strictEqual(fs.existsSync(path.join(runDir, 'node_modules')), false);
		});

		test('an install failure fails every check with its reason, rather than throwing', async () => {
			writeCandidate('export function double(n) { return n * 2; }');
			const failingRun = async (): Promise<void> => { throw new Error('network unreachable'); };
			const outcomes = await gradeProjectDir(parseLeetCode(artifactWithLibs()), runDir, { installRun: failingRun });

			assert.strictEqual(outcomes.length, 1);
			assert.strictEqual(outcomes[0].passed, false);
			assert.ok(outcomes[0].detail?.includes('network unreachable'), outcomes[0].detail);
		});

		test('one gradeProjectDir invokes the installer once, under one cache key, for a render check plus a build check', async () => {
			const calls: { cwd: string }[] = [];
			const countingRun = async (_file: string, _args: string[], cwd: string): Promise<void> => {
				calls.push({ cwd });
				fs.mkdirSync(path.join(cwd, 'node_modules'), { recursive: true });
			};

			fs.mkdirSync(path.join(runDir, 'src'), { recursive: true });
			fs.writeFileSync(path.join(runDir, 'src/App.jsx'), 'export default function App() { return null; }');

			const parsed = parseLeetCode(multiCheckArtifact());
			await gradeProjectDir(parsed, runDir, { installRun: countingRun });

			assert.strictEqual(calls.length, 1, 'the installer must run exactly once per grading run — two calls means two cache keys');
			// The install builds in `<key>.tmp-<pid>` and is renamed into place,
			// so the cwd is a sibling of the key rather than the key itself —
			// what matters is that it is *this* key's sibling and no other.
			const expectedKey = libEnvDir('pnpm', renderLibsFor(['lodash@^4.17.21']));
			assert.ok(calls[0].cwd.startsWith(expectedKey), `${calls[0].cwd} is not under ${expectedKey}`);
		});

		/**
		 * A python list must never be *npm*-installed: npm serves an unrelated
		 * package of the same name and the grammar cannot tell the two apart.
		 * It used to be skipped with a warning for want of an installer; now it
		 * resolves from pip, under its own key — but the thing that must never
		 * happen is unchanged, so it is still pinned here.
		 */
		test('a python list resolves from pip, and never joins the npm set', async () => {
			const calls: { cwd: string }[] = [];
			const countingRun = async (_file: string, _args: string[], cwd: string): Promise<void> => {
				calls.push({ cwd });
				fs.mkdirSync(path.join(cwd, 'node_modules'), { recursive: true });
				fs.mkdirSync(path.join(cwd, 'bin'), { recursive: true });
				fs.writeFileSync(path.join(cwd, 'bin', 'python3'), '', 'utf-8');
			};

			writeCandidate('export function double(n) { return n * 2; }');
			const parsed = parseLeetCode(artifactWithMultiLangLibs());
			await gradeProjectDir(parsed, runDir, { installRun: countingRun });

			const npmKey = libEnvDir('pnpm', ['lodash@^4.17.21']);
			const pipKey = libEnvDir('pip', ['requests>=2']);
			assert.ok(calls.some(c => c.cwd.startsWith(npmKey)), 'the npm set must still install');
			assert.ok(calls.some(c => c.cwd.startsWith(pipKey)), 'the python set must install from pip');
			assert.strictEqual(
				calls.some(c => c.cwd.startsWith(npmKey) && c.cwd.includes('requests')), false,
				'a python requirement must never reach the npm install set',
			);
		});

		test('the install set still spans every npm-servable language, not just the render ones', () => {
			// §B.1 rule 1's real intent: scoping the union to the render-capable
			// set was the bug that made a render check install a superset under a
			// second cache key. `javascriptreact` is display-only, but npm serves
			// its packages, so its libs must still be installed.
			const parsed = parseLeetCode(artifactWithLibs().replace(
				'  javascript:\n    - lodash@^4.17.21',
				'  javascriptreact:\n    - classnames@^2.5.1',
			));
			assert.deepStrictEqual(parsed.libs, { javascriptreact: ['classnames@^2.5.1'] });
			assert.deepStrictEqual(parsed.warnings ?? [], [], 'npm serves jsx packages — no warning is due');
		});

		test('linkModules refuses a hijacked node_modules symlink and leaves its target untouched', async () => {
			const evilTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'evil-target-'));
			fs.writeFileSync(path.join(evilTarget, 'marker.txt'), 'untouched');
			fs.symlinkSync(evilTarget, path.join(runDir, 'node_modules'));

			const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-cache-'));
			fs.mkdirSync(path.join(cacheDir, 'node_modules'), { recursive: true });

			await assert.rejects(() => linkModules(runDir, cacheDir), /symlink/);
			assert.strictEqual(fs.readFileSync(path.join(evilTarget, 'marker.txt'), 'utf-8'), 'untouched');

			fs.rmSync(evilTarget, { recursive: true, force: true });
			fs.rmSync(cacheDir, { recursive: true, force: true });
		});
	});
});
