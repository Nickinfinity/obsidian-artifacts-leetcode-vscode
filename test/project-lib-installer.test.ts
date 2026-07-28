import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { installLibs, libCacheDir } from '../src/services/test-envs/project/lib-installer.js';

/**
 * Per-run library installer (eval-fixes TB.4).
 *
 * Two properties are load-bearing and both are asserted without touching the
 * network: the allowlist gate runs **before** any subprocess exists, and the
 * command is built as an **argv array** — never a string a shell could reparse.
 * The installer takes an injected runner so these can be observed directly.
 */
suite('project lib installer', () => {

	// Redirect the shared cache at a throwaway dir: these tests must never write
	// into a developer's real one, and a warm marker left behind would make a
	// later test see a cache hit it did not create.
	let cacheRoot: string;
	const previous = process.env.OBSIDIAN_LEETCODE_LIBCACHE;

	setup(() => {
		cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'libcache-'));
		process.env.OBSIDIAN_LEETCODE_LIBCACHE = cacheRoot;
	});

	teardown(() => {
		if (previous === undefined) { delete process.env.OBSIDIAN_LEETCODE_LIBCACHE; }
		else { process.env.OBSIDIAN_LEETCODE_LIBCACHE = previous; }
		fs.rmSync(cacheRoot, { recursive: true, force: true });
	});

	/** Records what would have been spawned, and never spawns it. */
	function spy(): { calls: { file: string; args: string[] }[]; run: (file: string, args: string[]) => Promise<void> } {
		const calls: { file: string; args: string[] }[] = [];
		return {
			calls,
			run: async (file, args) => { calls.push({ file, args }); },
		};
	}

	// ── Cache directory: pure, vscode-free, stable ────────────────────────────

	suite('libCacheDir', () => {

		test('resolves under the OS temp dir — no vscode context involved', () => {
			delete process.env.OBSIDIAN_LEETCODE_LIBCACHE;
			assert.ok(libCacheDir(['react@^19.0.0']).startsWith(os.tmpdir()), libCacheDir(['react@^19.0.0']));
		});

		test('a warm cache short-circuits the install', async () => {
			const runner = spy();
			await installLibs(['react@^19.0.0'], { run: runner.run });
			await installLibs(['react@^19.0.0'], { run: runner.run });
			assert.strictEqual(runner.calls.length, 1, 'second call should have hit the warm cache');
		});

		test('is stable across calls for the same set', () => {
			assert.strictEqual(libCacheDir(['react@^19.0.0', 'vite@^7']), libCacheDir(['react@^19.0.0', 'vite@^7']));
		});

		test('ignores declaration order — the same set is the same cache', () => {
			assert.strictEqual(libCacheDir(['a@1', 'b@2']), libCacheDir(['b@2', 'a@1']));
		});

		test('a different version is a different cache', () => {
			assert.notStrictEqual(libCacheDir(['react@^19.0.0']), libCacheDir(['react@^18.0.0']));
		});

		test('a different set is a different cache', () => {
			assert.notStrictEqual(libCacheDir(['react@^19.0.0']), libCacheDir(['react@^19.0.0', 'vite@^7']));
		});

		test('never sits inside the repository', () => {
			const repoRoot = path.join(__dirname, '..', '..');
			assert.ok(!libCacheDir(['react@^19.0.0']).startsWith(repoRoot));
		});
	});

	// ── Allowlist gate: before any subprocess ─────────────────────────────────

	suite('allowlist gate', () => {

		test('a flag-shaped lib name spawns nothing at all', async () => {
			const runner = spy();
			const result = await installLibs(['react@^19.0.0', '--target=/etc'], { run: runner.run });

			assert.strictEqual(result.ok, false);
			assert.deepStrictEqual(runner.calls, []);
		});

		test('a traversal-shaped lib name spawns nothing at all', async () => {
			const runner = spy();
			const result = await installLibs(['../../etc/passwd'], { run: runner.run });

			assert.strictEqual(result.ok, false);
			assert.deepStrictEqual(runner.calls, []);
		});

		test('the rejected names are reported, not swallowed', async () => {
			const result = await installLibs(['--target=/etc'], { run: spy().run });
			assert.ok(!result.ok && result.reason.includes('--target=/etc'), JSON.stringify(result));
		});

		test('the cache is not an allowlist bypass — a bad name fails even for a warm key', async () => {
			const runner = spy();
			await installLibs(['react@^19.0.0'], { run: runner.run });
			const result = await installLibs(['react@^19.0.0', '--target=/etc'], { run: runner.run });
			assert.strictEqual(result.ok, false);
		});
	});

	// ── Command shape ─────────────────────────────────────────────────────────

	suite('install command', () => {

		test('is an argv array, with every lib as its own element', async () => {
			const runner = spy();
			await installLibs(['react@^19.0.0', 'vite@^7.0.0'], { run: runner.run });

			assert.strictEqual(runner.calls.length, 1);
			const { args } = runner.calls[0];
			assert.ok(args.includes('react@^19.0.0'), args.join(' '));
			assert.ok(args.includes('vite@^7.0.0'), args.join(' '));
			assert.ok(args.every(a => typeof a === 'string'));
		});

		test('installs into the cache dir for that set', async () => {
			const runner = spy();
			await installLibs(['react@^19.0.0'], { run: runner.run });
			assert.ok(runner.calls[0].args.includes(libCacheDir(['react@^19.0.0'])), runner.calls[0].args.join(' '));
		});

		test('an empty lib list needs no install at all', async () => {
			const runner = spy();
			const result = await installLibs([], { run: runner.run });

			assert.strictEqual(result.ok, true);
			assert.deepStrictEqual(runner.calls, []);
		});
	});
});
