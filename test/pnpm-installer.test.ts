import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureLibEnv, libEnvDir } from '../src/services/libs/lib-cache.service.js';
import { pnpmInstaller } from '../src/services/libs/pnpm.installer.js';
import { packageNameOf } from '../src/services/libs/lib-spec.helpers.js';

/**
 * The npm arm of the library cache: pnpm's argv, and the warm probe that
 * decides whether an install can be skipped.
 *
 * Two properties are load-bearing and both are asserted without touching the
 * network: the grammar gate runs **before** any subprocess exists, and the
 * command is built as an **argv array** — never a string a shell could reparse.
 *
 * Everything cache-shaped goes through `ensureLibEnv` with the real
 * `pnpmInstaller` injected, because that is the only path production uses;
 * `installLibs` and `libCacheDir` were retired when the cache service took
 * over the key, the warm probe and the install budget.
 */
suite('pnpm installer', () => {

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
	 * effects of a real `pnpm add` that the warm probe depends on.
	 *
	 * The specs are recovered from the argv rather than passed in, so a call
	 * site reads as one `ensureLibEnv` call and cannot drift from it. A spec is
	 * any argument that is neither the subcommand, nor the target directory,
	 * nor a flag — and the grammar guarantees no spec starts with `-`, so this
	 * stays correct as the flag set changes.
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

	/** Resolve through the real npm installer, with the network stubbed out. */
	async function install(libs: string[], run: ReturnType<typeof spy>['run']) {
		return ensureLibEnv('npm', libs, { run, installers: { npm: pnpmInstaller } });
	}

	suite('warm cache requires the declared packages on disk', () => {

		test('a warm cache short-circuits the install', async () => {
			const runner = spy();
			await install(['react@^19.0.0'], runner.run);
			await install(['react@^19.0.0'], runner.run);

			assert.strictEqual(runner.calls.length, 1, 'the second resolve must skip the install');
		});

		test('a marker with no node_modules is not warm — the install runs again', async () => {
			const runner = spy();
			const dir = libEnvDir('npm', ['react@^19.0.0']);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, '.leet-installed'), 'npm', 'utf-8');

			const result = await install(['react@^19.0.0'], runner.run);

			assert.strictEqual(result.ok, true);
			assert.strictEqual(runner.calls.length, 1);
		});

		/**
		 * The real bug this closes: macOS prunes `/var/folders` by age, so a
		 * swept cache kept its marker over an emptied tree and every later run
		 * skipped the install forever.
		 */
		test('a swept cache — marker, empty node_modules — reinstalls', async () => {
			const runner = spy();
			await install(['react@^19.0.0'], runner.run);

			const dir = libEnvDir('npm', ['react@^19.0.0']);
			fs.rmSync(path.join(dir, 'node_modules'), { recursive: true });
			fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });

			await install(['react@^19.0.0'], runner.run);
			assert.strictEqual(runner.calls.length, 2);
		});

		test('a partly swept cache — one package gone — reinstalls', async () => {
			const runner = spy();
			const libs = ['react@^19.0.0', 'jsdom@^26.0.0'];
			await install(libs, runner.run);

			fs.rmSync(path.join(libEnvDir('npm', libs), 'node_modules', 'jsdom'), { recursive: true });

			await install(libs, runner.run);
			assert.strictEqual(runner.calls.length, 2, 'one missing package must reinstall the set');
		});

		test('a scoped package is looked for under its scope directory', async () => {
			const runner = spy();
			const libs = ['@types/node@^20.0.0'];
			await install(libs, runner.run);

			assert.ok(fs.existsSync(path.join(libEnvDir('npm', libs), 'node_modules', '@types', 'node')));

			await install(libs, runner.run);
			assert.strictEqual(runner.calls.length, 1, 'a scoped package on disk is warm');
		});

		test('warmPaths names one path per declared package', () => {
			assert.deepStrictEqual(
				pnpmInstaller.warmPaths([
					{ ecosystem: 'npm', name: 'react', range: '^19.0.0' },
					{ ecosystem: 'npm', name: '@types/node' },
				]),
				[path.join('node_modules', 'react'), path.join('node_modules', '@types/node')],
			);
		});
	});

	suite('grammar gate', () => {

		test('a flag-shaped lib name spawns nothing at all', async () => {
			const runner = spy();
			const result = await install(['react@^19.0.0', '--target=/etc'], runner.run);

			assert.strictEqual(result.ok, false);
			assert.deepStrictEqual(runner.calls, []);
		});

		test('a traversal-shaped lib name spawns nothing at all', async () => {
			const runner = spy();
			const result = await install(['../../etc/passwd'], runner.run);

			assert.strictEqual(result.ok, false);
			assert.deepStrictEqual(runner.calls, []);
		});

		test('the rejected names are reported, not swallowed', async () => {
			const result = await install(['--target=/etc'], spy().run);
			assert.ok(!result.ok);
			assert.match(result.reason, /--target=\/etc/);
		});

		/**
		 * pnpm accepts each of these and every one resolves from a location the
		 * artifact chose, which is exactly what a name-shape allowlist cannot
		 * bound. They must die at validation, before a subprocess exists.
		 */
		for (const spec of ['file:../../etc', 'link:/', 'git+ssh://x/y', 'workspace:*']) {
			test(`the protocol spec '${spec}' spawns nothing at all`, async () => {
				const runner = spy();
				const result = await install([spec], runner.run);

				assert.strictEqual(result.ok, false);
				assert.deepStrictEqual(runner.calls, []);
			});
		}

		test('one hostile entry refuses the whole set — no partial install', async () => {
			const runner = spy();
			const result = await install(['react@^19.0.0', 'file:../../etc'], runner.run);

			assert.strictEqual(result.ok, false);
			assert.deepStrictEqual(runner.calls, []);
		});
	});

	suite('install command', () => {

		test('runs pnpm, never npm — the package manager this project uses', async () => {
			const runner = spy();
			await install(['react@^19.0.0'], runner.run);

			assert.strictEqual(runner.calls[0].file, 'pnpm');
			assert.strictEqual(runner.calls[0].args[0], 'add');
		});

		test('lets an ignored build script pass, so a usable install is not reported failed', async () => {
			// pnpm 10+ refuses dependencies' install scripts, and pnpm 11 exits
			// non-zero over it — without this flag every esbuild install reads
			// as `install failed`.
			const runner = spy();
			await install(['esbuild@^0.25.0'], runner.run);

			assert.ok(
				runner.calls[0].args.includes('--config.strict-dep-builds=false'),
				runner.calls[0].args.join(' '),
			);
		});

		test('is an argv array, with every lib as its own element', async () => {
			const runner = spy();
			await install(['react@^19.0.0', 'vite@^7.0.0'], runner.run);

			assert.strictEqual(runner.calls.length, 1);
			const { args } = runner.calls[0];
			assert.ok(args.includes('react@^19.0.0'), args.join(' '));
			assert.ok(args.includes('vite@^7.0.0'), args.join(' '));
			assert.ok(args.every(a => typeof a === 'string'));
		});

		test('renders each spec from validated fields, not the raw string', async () => {
			const runner = spy();
			await install(['@types/node@^20'], runner.run);
			assert.ok(runner.calls[0].args.includes('@types/node@^20'), runner.calls[0].args.join(' '));
		});

		test('installs into a directory belonging to that set’s cache key', async () => {
			const runner = spy();
			await install(['react@^19.0.0'], runner.run);

			const key = libEnvDir('npm', ['react@^19.0.0']);
			const target = runner.calls[0].args[runner.calls[0].args.indexOf('--dir') + 1];
			assert.ok(target.startsWith(key), `${target} is not under ${key}`);
		});

		/**
		 * `pnpm add --dir` writes its own `package.json` and lockfile. Authoring
		 * one here would put artifact-derived names inside a JSON file a
		 * toolchain then obeys, for no gain — so the absence of that write is
		 * the assertion.
		 */
		test('authors no manifest of its own — pnpm writes one', async () => {
			const runner = spy();
			await install(['react@^19.0.0'], runner.run);

			assert.strictEqual(
				fs.existsSync(path.join(libEnvDir('npm', ['react@^19.0.0']), 'package.json')), false,
				'the installer must not write a package.json — pnpm add --dir writes its own',
			);
		});

		test('an empty lib list needs no install at all', async () => {
			const runner = spy();
			const result = await install([], runner.run);

			assert.strictEqual(result.ok, true);
			assert.deepStrictEqual(runner.calls, []);
		});
	});
});
