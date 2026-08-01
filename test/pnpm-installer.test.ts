import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { packageNameOf } from '../src/services/libs/lib-spec.helpers.js';
import { installLibs, libCacheDir } from '../src/services/libs/pnpm.installer.js';

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

	/**
	 * Records what would have been spawned, and never spawns it — but does
	 * create `node_modules` **and a directory per installed package**, the side
	 * effects of a real `pnpm add` that `isWarm` depends on.
	 *
	 * The specs are recovered from the argv rather than passed in, so a call
	 * site reads as one `installLibs` call and cannot drift from it. A spec is
	 * any argument that is neither the subcommand, nor the target directory,
	 * nor a flag — and the allowlist guarantees no spec starts with `-`, so
	 * this stays correct as the flag set changes.
	 */
	function spy(): { calls: { file: string; args: string[] }[]; run: (file: string, args: string[], cwd: string) => Promise<void> } {
		const calls: { file: string; args: string[] }[] = [];
		return {
			calls,
			run: async (file, args, cwd) => {
				calls.push({ file, args });
				fs.mkdirSync(path.join(cwd, 'node_modules'), { recursive: true });
				const specs = args.filter(a => !a.startsWith('-') && a !== 'add' && a !== cwd);
				for (const spec of specs) {
					fs.mkdirSync(path.join(cwd, 'node_modules', packageNameOf(spec)), { recursive: true });
				}
			},
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

	// ── Warm requires the packages, not just the marker ───────────────────────

	suite('warm cache requires the declared packages on disk', () => {

		test('a marker with no node_modules is not warm — the install runs again', async () => {
			const libs = ['left-pad@1.0.0'];
			const dir = libCacheDir(libs);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, '.leet-installed'), libs.join('\n'), 'utf-8');

			const runner = spy();
			const result = await installLibs(libs, { run: runner.run });

			assert.strictEqual(runner.calls.length, 1, 'a marker-only cache must not read as warm');
			assert.strictEqual(result.ok, true);
		});

		test('marker plus every package is warm — the install is skipped', async () => {
			const libs = ['left-pad@2.0.0'];
			const dir = libCacheDir(libs);
			fs.mkdirSync(path.join(dir, 'node_modules', 'left-pad'), { recursive: true });
			fs.writeFileSync(path.join(dir, '.leet-installed'), libs.join('\n'), 'utf-8');

			const runner = spy();
			const result = await installLibs(libs, { run: runner.run });

			assert.strictEqual(runner.calls.length, 0, 'a genuinely complete cache must skip the install');
			assert.strictEqual(result.ok, true);
		});

		test('a swept cache — marker, empty node_modules — reinstalls', async () => {
			// The real defect: macOS prunes /var/folders by age, leaving the
			// marker and an emptied node_modules. Reading that as warm skipped
			// the install forever, and five vault artifacts failed with
			// `Cannot find module 'jsdom'`.
			const libs = ['jsdom@^26.0.0'];
			const dir = libCacheDir(libs);
			fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
			fs.writeFileSync(path.join(dir, '.leet-installed'), libs.join('\n'), 'utf-8');

			const runner = spy();
			const result = await installLibs(libs, { run: runner.run });

			assert.strictEqual(runner.calls.length, 1, 'an emptied cache must not read as warm');
			assert.strictEqual(result.ok, true);
			assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'jsdom')), 'the reinstall must repair the entry');
		});

		test('a partly swept cache — one package gone — reinstalls', async () => {
			// The other real shape: 86 modules present, jsdom missing.
			const libs = ['react@^19.0.0', 'jsdom@^26.0.0'];
			const dir = libCacheDir(libs);
			fs.mkdirSync(path.join(dir, 'node_modules', 'react'), { recursive: true });
			fs.writeFileSync(path.join(dir, '.leet-installed'), libs.join('\n'), 'utf-8');

			const runner = spy();
			await installLibs(libs, { run: runner.run });

			assert.strictEqual(runner.calls.length, 1, 'one missing declared package must defeat the warm marker');
		});

		test('a scoped package is looked for under its scope directory', async () => {
			// `@types/node@^20` must resolve to node_modules/@types/node, never
			// to a top-level `@types/node@^20` that no install ever writes.
			const libs = ['@types/node@^20.0.0'];
			const dir = libCacheDir(libs);
			fs.mkdirSync(path.join(dir, 'node_modules', '@types', 'node'), { recursive: true });
			fs.writeFileSync(path.join(dir, '.leet-installed'), libs.join('\n'), 'utf-8');

			const runner = spy();
			await installLibs(libs, { run: runner.run });

			assert.strictEqual(runner.calls.length, 0, 'a scoped package present on disk must read as warm');
		});

		test('node_modules with no marker is not warm — a Ctrl-C-killed install runs again', async () => {
			// Mirror of the marker-only poisoned entry: npm writes node_modules
			// before this module writes the marker, so a kill mid-install leaves
			// exactly this shape on disk.
			const libs = ['left-pad@3.0.0'];
			const dir = libCacheDir(libs);
			fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });

			const runner = spy();
			const result = await installLibs(libs, { run: runner.run });

			assert.strictEqual(runner.calls.length, 1, 'node_modules alone (no marker) must not read as warm');
			assert.strictEqual(result.ok, true);
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
			// Seed THIS exact set's own cache dir as genuinely warm (marker +
			// node_modules) — a different set (e.g. just ['react@^19.0.0'])
			// warms a different key and never exercises the warm path here at all.
			const libs = ['react@^19.0.0', '--target=/etc'];
			const dir = libCacheDir(libs);
			fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
			fs.writeFileSync(path.join(dir, '.leet-installed'), libs.join('\n'), 'utf-8');

			const runner = spy();
			const result = await installLibs(libs, { run: runner.run });

			assert.strictEqual(result.ok, false, 'a warm cache must not skip the allowlist');
			assert.deepStrictEqual(runner.calls, []);
		});
	});

	// ── Command shape ─────────────────────────────────────────────────────────

	suite('install command', () => {

		test('runs pnpm, never npm — the package manager this project uses', async () => {
			const runner = spy();
			await installLibs(['react@^19.0.0'], { run: runner.run });

			assert.strictEqual(runner.calls[0].file, 'pnpm');
			assert.strictEqual(runner.calls[0].args[0], 'add');
		});

		test('lets an ignored build script pass, so a usable install is not reported failed', async () => {
			// pnpm 10+ refuses dependencies' install scripts, and pnpm 11 exits
			// non-zero over it — without this flag every esbuild install reads
			// as `install failed`.
			const runner = spy();
			await installLibs(['esbuild@^0.25.0'], { run: runner.run });

			assert.ok(
				runner.calls[0].args.includes('--config.strict-dep-builds=false'),
				runner.calls[0].args.join(' '),
			);
		});

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

		/**
		 * `pnpm add --dir` writes its own `package.json` and lockfile. Authoring
		 * one here would put artifact-derived names inside a JSON file a
		 * toolchain then obeys, for no gain — so the absence of that write is
		 * the assertion.
		 */
		test('authors no manifest of its own — pnpm writes one', async () => {
			const runner = spy();
			const dir = libCacheDir(['react@^19.0.0']);
			await installLibs(['react@^19.0.0'], { run: runner.run });

			assert.ok(runner.calls[0].args.includes('--dir'), runner.calls[0].args.join(' '));
			assert.strictEqual(
				fs.existsSync(path.join(dir, 'package.json')), false,
				'the installer must not write a package.json — pnpm add --dir writes its own',
			);
		});
	});

	suite('protocol specs — fetch-from-anywhere is refused', () => {

		/**
		 * pnpm accepts each of these and every one resolves from a location the
		 * artifact chose, which is exactly what a name-shape allowlist cannot
		 * bound. They must die at validation, before a subprocess exists.
		 */
		const hostile = ['file:../../etc', 'link:/', 'git+ssh://x/y', 'workspace:*'];

		for (const spec of hostile) {
			test(`'${spec}' spawns nothing at all`, async () => {
				const runner = spy();
				const result = await installLibs([spec], { run: runner.run });

				assert.strictEqual(result.ok, false);
				assert.deepStrictEqual(runner.calls, []);
			});
		}

		test('one hostile entry refuses the whole set — no partial install', async () => {
			const runner = spy();
			const result = await installLibs(['react@^19.0.0', 'file:../../etc'], { run: runner.run });

			assert.strictEqual(result.ok, false);
			assert.deepStrictEqual(runner.calls, []);
		});
	});
});
