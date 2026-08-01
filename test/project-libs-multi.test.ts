import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gradeProjectDir } from '../src/services/test-envs/project/project.runner.js';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';
import { libEnvDir } from '../src/services/libs/lib-cache.service.js';
import { libEnvVars, mergeLibEnvVars } from '../src/services/libs/lib-env.helpers.js';

/**
 * `project` grading with more than one registry in play.
 *
 * A FastAPI-plus-React exercise is the case that makes per-ecosystem installs
 * worth their keys: unioning the two would install `libs.python: [requests]`
 * from npm, which the name-shape grammar cannot tell from the PyPI one.
 */
suite('project libs — one install per ecosystem', () => {

	let cacheRoot: string;
	let runDir: string;
	const previous = process.env.OBSIDIAN_LEETCODE_LIBCACHE;

	setup(() => {
		cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'multilibs-'));
		runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multirun-'));
		process.env.OBSIDIAN_LEETCODE_LIBCACHE = cacheRoot;
	});

	teardown(() => {
		if (previous === undefined) { delete process.env.OBSIDIAN_LEETCODE_LIBCACHE; }
		else { process.env.OBSIDIAN_LEETCODE_LIBCACHE = previous; }
		fs.rmSync(cacheRoot, { recursive: true, force: true });
		fs.rmSync(runDir, { recursive: true, force: true });
	});

	/** Records installs and fakes each ecosystem's product, so warm probes pass. */
	function spy() {
		const calls: { file: string; cwd: string }[] = [];
		return {
			calls,
			run: async (file: string, args: string[], cwd: string): Promise<void> => {
				calls.push({ file, cwd });
				fs.mkdirSync(path.join(cwd, 'node_modules'), { recursive: true });
				for (const spec of args.filter(a => !a.startsWith('-') && a !== 'add' && a !== cwd)) {
					const name = spec.split('@').filter(Boolean)[0].split(/[<>=[]/)[0];
					fs.mkdirSync(path.join(cwd, 'node_modules', name), { recursive: true });
				}
				fs.mkdirSync(path.join(cwd, 'bin'), { recursive: true });
				fs.writeFileSync(path.join(cwd, 'bin', 'python3'), '', 'utf-8');
			},
		};
	}

	/** A `project` artifact declaring libs for both registries, graded by one build check. */
	function twoRegistryArtifact(): string {
		return [
			'---', 'type: leetcode', 'title: Two registries', 'difficulty: hard', '---',
			'', 'Body.', '',
			'```yaml leetcode',
			'libs:',
			'  python: ["fastapi>=0.115,<0.116"]',
			'  typescript: [react@^19.0.0]',
			'test:',
			'  type: project',
			'  timeoutMs: 10000',
			'  checks:',
			'    - name: app builds',
			'      kind: build',
			'      argv: ["node", "--version"]',
			'```',
			'',
			'## Files',
			'',
			'```typescript path=src/App.tsx role=editable',
			'export default function App() { return null; }',
			'```',
			'',
		].join('\n');
	}

	test('two registries resolve two cache directories', async () => {
		const runner = spy();
		const parsed = parseLeetCode(twoRegistryArtifact());
		await gradeProjectDir(parsed, runDir, { installRun: runner.run });

		// pip spends two calls (create the venv, then install into it), so the
		// unit being counted is the cache directory, not the subprocess.
		const roots = [...new Set(
			runner.calls.map(c => path.basename(c.cwd).replace(/\.tmp-\d+$/, '')),
		)];
		assert.deepStrictEqual(
			roots.map(r => r.split('-')[0]).sort(),
			['pip', 'pnpm'],
			`expected one pip and one pnpm environment, got ${JSON.stringify(roots)}`,
		);
	});

	test('each install lands under its own ecosystem’s key', async () => {
		const runner = spy();
		await gradeProjectDir(parseLeetCode(twoRegistryArtifact()), runDir, { installRun: runner.run });

		const expected = [
			libEnvDir('pip', ['fastapi>=0.115,<0.116']),
			libEnvDir('pnpm', ['react@^19.0.0']),
		];
		for (const key of expected) {
			assert.ok(
				runner.calls.some(c => c.cwd.startsWith(key)),
				`no install under ${key}; got ${JSON.stringify(runner.calls.map(c => c.cwd))}`,
			);
		}
	});

	/**
	 * A write through a link escapes into the shared cache, so only the npm
	 * tree — which a toolchain resolves by walking up from `runDir` — is linked.
	 */
	test('only the npm tree is linked into the run directory', async () => {
		const runner = spy();
		await gradeProjectDir(parseLeetCode(twoRegistryArtifact()), runDir, { installRun: runner.run });

		assert.ok(fs.existsSync(path.join(runDir, 'node_modules', 'react')));
		assert.strictEqual(fs.existsSync(path.join(runDir, 'node_modules', 'fastapi')), false);
	});

	test('an install failure in any ecosystem fails every check with its reason', async () => {
		const failing = async (): Promise<void> => { throw new Error('registry unreachable'); };
		const outcomes = await gradeProjectDir(
			parseLeetCode(twoRegistryArtifact()), runDir, { installRun: failing },
		);

		assert.strictEqual(outcomes.length, 1);
		assert.strictEqual(outcomes[0].passed, false);
		assert.match(outcomes[0].detail ?? '', /registry unreachable/);
	});

	test('an artifact declaring no libs installs nothing and links nothing', async () => {
		const runner = spy();
		const bare = twoRegistryArtifact()
			.replace('libs:\n', '')
			.replace('  python: ["fastapi>=0.115,<0.116"]\n', '')
			.replace('  typescript: [react@^19.0.0]\n', '');

		await gradeProjectDir(parseLeetCode(bare), runDir, { installRun: runner.run });

		assert.deepStrictEqual(runner.calls, []);
		assert.strictEqual(fs.existsSync(path.join(runDir, 'node_modules')), false);
	});

	suite('the consumption seam', () => {

		test('each ecosystem maps to its own variables', () => {
			assert.deepStrictEqual(libEnvVars('pnpm', '/c/npm'), {
				env: { NODE_PATH: path.join('/c/npm', 'node_modules') },
			});
			assert.deepStrictEqual(libEnvVars('pip', '/c/pip'), {
				env: { VIRTUAL_ENV: '/c/pip' }, pathPrepend: path.join('/c/pip', 'bin'),
			});
			assert.deepStrictEqual(libEnvVars('cargo', '/c/cargo'), {
				env: { CARGO_TARGET_DIR: path.join('/c/cargo', 'target') },
			});
		});

		/**
		 * Setting `CLASSPATH` replaces the implicit current directory, and
		 * `java Runner` would then not find the class it just compiled.
		 */
		test('the java classpath keeps a trailing current-directory entry', () => {
			const { env } = libEnvVars('maven', '/c/maven');
			assert.strictEqual(
				env.CLASSPATH,
				`${path.join('/c/maven', 'jars', '*')}${path.delimiter}.`,
			);
			assert.ok(env.CLASSPATH.endsWith(`${path.delimiter}.`));
		});

		test('merging several ecosystems joins their PATH prefixes', () => {
			const merged = mergeLibEnvVars(new Map([['pip', '/c/pip'], ['pnpm', '/c/npm']] as const));

			assert.strictEqual(merged.env.VIRTUAL_ENV, '/c/pip');
			assert.strictEqual(merged.env.NODE_PATH, path.join('/c/npm', 'node_modules'));
			assert.strictEqual(merged.pathPrepend, path.join('/c/pip', 'bin'));
		});

		test('no ecosystem needing a PATH prefix leaves none', () => {
			assert.strictEqual(mergeLibEnvVars(new Map([['pnpm', '/c/npm']])).pathPrepend, undefined);
		});
	});
});
