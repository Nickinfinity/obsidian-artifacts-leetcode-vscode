import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LibEcosystem, LibInstaller, ParsedLibSpec } from '../src/services/libs/lib-ecosystem.js';
import { ensureLibEnv, libEnvDir } from '../src/services/libs/lib-cache.service.js';

/**
 * Unit tests for the one cache door every install goes through.
 *
 * Nothing here reaches the network or a developer's real cache: the installer
 * map is injected, so each test observes exactly which directory an installer
 * was handed and what it was asked to install.
 */
suite('lib cache service', () => {

	let cacheRoot: string;
	const previous = process.env.OBSIDIAN_LEETCODE_LIBCACHE;

	setup(() => {
		cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'libenv-'));
		process.env.OBSIDIAN_LEETCODE_LIBCACHE = cacheRoot;
	});

	teardown(() => {
		if (previous === undefined) { delete process.env.OBSIDIAN_LEETCODE_LIBCACHE; }
		else { process.env.OBSIDIAN_LEETCODE_LIBCACHE = previous; }
		fs.rmSync(cacheRoot, { recursive: true, force: true });
	});

	/** Records every directory an install was asked to build in. */
	interface Spy {
		readonly dirs: string[];
		readonly specs: ParsedLibSpec[][];
		readonly installer: LibInstaller;
	}

	/**
	 * A stub installer that creates its declared warm paths and nothing else.
	 *
	 * @param ecosystem   - Which slot it fills.
	 * @param overrides   - Behaviour a single test needs to bend (a throw, a
	 *                      refusal, an unrelocatable product).
	 */
	function stub(
		ecosystem: LibEcosystem,
		overrides: Partial<LibInstaller> & { throws?: NodeJS.ErrnoException } = {},
	): Spy {
		const dirs: string[] = [];
		const specs: ParsedLibSpec[][] = [];
		const installer: LibInstaller = {
			ecosystem,
			relocatable: true,
			missingTool: `${ecosystem}-tool not found — install it`,
			warmPaths: () => ['product'],
			parseSpec: raw => raw.startsWith('bad')
				? { ok: false, reason: `'${raw}' refused` }
				: { ok: true, spec: { ecosystem: 'pnpm', name: raw } },
			install: async (dir, parsed) => {
				dirs.push(dir);
				specs.push([...parsed]);
				if (overrides.throws) { throw overrides.throws; }
				fs.mkdirSync(path.join(dir, 'product'), { recursive: true });
			},
			...overrides,
		};
		return { dirs, specs, installer };
	}

	/** Wire one stub into the injected map. */
	function withStub(spy: Spy) {
		return { installers: { [spy.installer.ecosystem]: spy.installer } };
	}

	suite('cache key', () => {

		/**
		 * Gap 3, the latent defect this service exists to close: the old key was
		 * the spec set alone, so a pip run could be handed an npm `node_modules`
		 * and report a green install.
		 */
		test('the ecosystem is part of the key', () => {
			assert.notStrictEqual(libEnvDir('pip', ['react']), libEnvDir('pnpm', ['react']));
			assert.notStrictEqual(libEnvDir('cargo', ['react']), libEnvDir('maven', ['react']));
		});

		test('names the ecosystem in the directory, for a readable cache', () => {
			assert.ok(path.basename(libEnvDir('pip', ['numpy'])).startsWith('pip-'));
		});

		test('declaration order does not change the key', () => {
			assert.strictEqual(
				libEnvDir('pnpm', ['react@^19.0.0', 'vite@^7.0.0']),
				libEnvDir('pnpm', ['vite@^7.0.0', 'react@^19.0.0']),
			);
		});

		test('a different version is a different key', () => {
			assert.notStrictEqual(libEnvDir('pnpm', ['react@^18']), libEnvDir('pnpm', ['react@^19']));
		});

		test('a different set is a different key', () => {
			assert.notStrictEqual(
				libEnvDir('pnpm', ['react@^19.0.0']),
				libEnvDir('pnpm', ['react@^19.0.0', 'vite@^7']),
			);
		});

		test('is stable across calls for the same set', () => {
			assert.strictEqual(
				libEnvDir('pnpm', ['react@^19.0.0', 'vite@^7']),
				libEnvDir('pnpm', ['react@^19.0.0', 'vite@^7']),
			);
		});

		test('honours the cache-root override, so tests never write a real cache', () => {
			assert.ok(libEnvDir('pip', ['numpy']).startsWith(cacheRoot));
		});

		test('resolves under the OS temp dir — no vscode context involved', () => {
			delete process.env.OBSIDIAN_LEETCODE_LIBCACHE;
			try {
				assert.ok(libEnvDir('pnpm', ['react@^19.0.0']).startsWith(os.tmpdir()));
			} finally {
				process.env.OBSIDIAN_LEETCODE_LIBCACHE = cacheRoot;
			}
		});

		test('never sits inside the repository', () => {
			delete process.env.OBSIDIAN_LEETCODE_LIBCACHE;
			try {
				const repoRoot = path.resolve(__dirname, '..', '..');
				assert.ok(!libEnvDir('pnpm', ['react@^19.0.0']).startsWith(repoRoot));
			} finally {
				process.env.OBSIDIAN_LEETCODE_LIBCACHE = cacheRoot;
			}
		});
	});

	suite('validation precedes everything', () => {

		test('a refused spec never reaches the installer', async () => {
			const spy = stub('pnpm');
			const result = await ensureLibEnv('pnpm', ['bad-one', 'react'], withStub(spy));

			assert.strictEqual(result.ok, false);
			assert.deepStrictEqual(spy.dirs, []);
		});

		test('the refusal reason names the offending spec', async () => {
			const spy = stub('pnpm');
			const result = await ensureLibEnv('pnpm', ['bad-one'], withStub(spy));

			assert.ok(!result.ok);
			assert.match(result.reason, /bad-one/);
		});

		/**
		 * A warm key short-circuits the *install*, never the allowlist —
		 * otherwise a key that happened to be warm is a way to smuggle an
		 * unvalidated spec through.
		 */
		test('a warm key is not a validation bypass', async () => {
			const spy = stub('pnpm');
			await ensureLibEnv('pnpm', ['react'], withStub(spy));

			const warm = await ensureLibEnv('pnpm', ['react'], withStub(spy));
			assert.strictEqual(warm.ok, true);
			assert.strictEqual(spy.dirs.length, 1, 'the second call must skip the install');

			const smuggled = await ensureLibEnv('pnpm', ['bad-one'], withStub(spy));
			assert.strictEqual(smuggled.ok, false);
			assert.strictEqual(spy.dirs.length, 1, 'and must still spawn nothing');
		});

		test('an unknown ecosystem has no installer and installs nothing', async () => {
			const result = await ensureLibEnv('maven', ['com.x:y:1.0'], { installers: {} });
			assert.strictEqual(result.ok, false);
		});
	});

	suite('warm probe', () => {

		test('a marker with no product reinstalls, repairing the entry', async () => {
			const spy = stub('pnpm');
			await ensureLibEnv('pnpm', ['react'], withStub(spy));

			// An OS temp sweep takes the contents and leaves the marker behind.
			fs.rmSync(path.join(libEnvDir('pnpm', ['react']), 'product'), { recursive: true });

			const again = await ensureLibEnv('pnpm', ['react'], withStub(spy));
			assert.strictEqual(again.ok, true);
			assert.strictEqual(spy.dirs.length, 2, 'a swept product must reinstall');
		});

		test('a product with no marker reinstalls — a killed install is not warm', async () => {
			const spy = stub('pnpm');
			const dir = libEnvDir('pnpm', ['react']);
			fs.mkdirSync(path.join(dir, 'product'), { recursive: true });

			const result = await ensureLibEnv('pnpm', ['react'], withStub(spy));
			assert.strictEqual(result.ok, true);
			assert.strictEqual(spy.dirs.length, 1);
		});

		test('an empty spec set installs nothing and still resolves', async () => {
			const spy = stub('pnpm');
			const result = await ensureLibEnv('pnpm', [], withStub(spy));

			assert.strictEqual(result.ok, true);
			assert.deepStrictEqual(spy.dirs, []);
		});
	});

	suite('atomic install', () => {

		test('builds in a tmp sibling, then renames into place', async () => {
			const spy = stub('pnpm');
			const final = libEnvDir('pnpm', ['react']);
			const result = await ensureLibEnv('pnpm', ['react'], withStub(spy));

			assert.deepStrictEqual(result, { ok: true, dir: final });
			assert.notStrictEqual(spy.dirs[0], final, 'the install must not build in the final dir');
			assert.ok(spy.dirs[0].startsWith(final), 'the tmp dir is a sibling of the final one');
			assert.ok(fs.existsSync(path.join(final, 'product')));
			assert.strictEqual(fs.existsSync(spy.dirs[0]), false, 'the tmp dir must not survive');
		});

		/**
		 * A venv's console scripts carry absolute shebangs, so a pip env cannot
		 * be built somewhere else and moved. It installs in place, keeping
		 * exactly the concurrency ceiling the npm installer had before.
		 */
		test('an unrelocatable product installs in the final directory', async () => {
			const spy = stub('pip', { relocatable: false });
			const final = libEnvDir('pip', ['numpy']);
			const result = await ensureLibEnv('pip', ['numpy'], withStub(spy));

			assert.deepStrictEqual(result, { ok: true, dir: final });
			assert.strictEqual(spy.dirs[0], final);
		});

		/**
		 * Two cold runs of the same set race; the loser's `rename` finds the
		 * winner's directory already there. Both wanted that directory, so the
		 * loser reports success rather than failing a run whose packages are
		 * on disk.
		 */
		/**
		 * A real lost race: the winner finishes **while our install is running**,
		 * so the top-level warm check saw nothing and the collision happens at
		 * the rename. Its directory is complete — marker and product both — which
		 * is exactly what distinguishes it from a swept one.
		 */
		test('losing the rename race is success, not a failed install', async () => {
			const final = libEnvDir('pnpm', ['react']);
			const buildDirs: string[] = [];
			const spy = stub('pnpm', {
				install: async (dir: string) => {
					buildDirs.push(dir);
					fs.mkdirSync(path.join(dir, 'product'), { recursive: true });
					// Another run completes first, marker and all.
					fs.mkdirSync(path.join(final, 'product'), { recursive: true });
					fs.writeFileSync(path.join(final, '.leet-installed'), 'pnpm', 'utf-8');
					fs.writeFileSync(path.join(final, 'squatter'), 'winner', 'utf-8');
				},
			});

			const result = await ensureLibEnv('pnpm', ['react'], withStub(spy));

			assert.deepStrictEqual(result, { ok: true, dir: final });
			assert.strictEqual(
				fs.readFileSync(path.join(final, 'squatter'), 'utf-8'), 'winner',
				"the winner's directory must survive intact",
			);
			assert.strictEqual(fs.existsSync(buildDirs[0]), false, 'the loser cleans up its tmp');
		});

		/**
		 * The other half of a rename collision, and the one that was a live
		 * defect: the directory in the way is not a winner at all, it is a
		 * **swept** entry. macOS prunes `/var/folders` by age, file by file, so
		 * the tree survives while its contents do not.
		 *
		 * Treating that as a lost race discarded the freshly built repair and
		 * kept the gutted tree — every run, forever, which is why the documented
		 * "a failed check reinstalls, repairing the entry in place" was false.
		 * Measured on this vault: 13 of 75 artifacts failed with
		 * `Cannot find module`, and no number of re-runs fixed one of them.
		 */
		test('a stale squatter is replaced by the fresh build, not mistaken for a winner', async () => {
			const spy = stub('pnpm');
			const final = libEnvDir('pnpm', ['react']);
			// Swept: the tree survives, the product and the marker do not.
			fs.mkdirSync(final, { recursive: true });
			fs.writeFileSync(path.join(final, 'stale'), 'gutted', 'utf-8');

			const result = await ensureLibEnv('pnpm', ['react'], withStub(spy));

			assert.deepStrictEqual(result, { ok: true, dir: final });
			assert.ok(
				fs.existsSync(path.join(final, 'product')),
				'the replacement must be the completed build',
			);
			assert.ok(fs.existsSync(path.join(final, '.leet-installed')), 'marker and all');
			assert.strictEqual(
				fs.existsSync(path.join(final, 'stale')), false,
				'the gutted tree must not survive the swap',
			);
		});

		test('a failed install leaves no half-built directory behind', async () => {
			const spy = stub('pnpm', { throws: new Error('boom') });
			const result = await ensureLibEnv('pnpm', ['react'], withStub(spy));

			assert.strictEqual(result.ok, false);
			assert.strictEqual(fs.existsSync(libEnvDir('pnpm', ['react'])), false);
			assert.strictEqual(fs.existsSync(spy.dirs[0]), false);
		});
	});

	suite('missing toolchain', () => {

		test('ENOENT becomes the installer’s named message, never a stack', async () => {
			const enoent: NodeJS.ErrnoException = new Error('spawn mvn ENOENT');
			enoent.code = 'ENOENT';
			const spy = stub('maven', {
				throws: enoent,
				missingTool: 'mvn not found — install Maven to run library-backed Java exercises',
			});

			const result = await ensureLibEnv('maven', ['com.x:y:1.0'], withStub(spy));

			assert.ok(!result.ok);
			assert.strictEqual(
				result.reason,
				'mvn not found — install Maven to run library-backed Java exercises',
			);
		});

		/**
		 * Before this, a failed maven resolve reported only
		 * `install failed: Command failed: mvn -q -f …` — the command and
		 * nothing about the problem. Maven writes its `[ERROR]` diagnostics to
		 * **stdout**, so reading stderr alone left the message empty for the
		 * ecosystem most likely to fail on a version that does not exist.
		 */
		test('a failure reports what the toolchain said, not just the command', async () => {
			const noisy = Object.assign(new Error('Command failed: mvn -q -f /tmp/x/pom.xml'), {
				stdout: '[ERROR] com.google.guava:guava:jar:33.3.1 was not found',
				stderr: '',
			});
			const spy = stub('maven', { throws: noisy as NodeJS.ErrnoException });

			const result = await ensureLibEnv('maven', ['com.x:y:1.0'], withStub(spy));

			assert.ok(!result.ok);
			assert.match(result.reason, /was not found/);
		});

		test('any other failure keeps its own message', async () => {
			const spy = stub('pnpm', { throws: new Error('registry returned 500') });
			const result = await ensureLibEnv('pnpm', ['react'], withStub(spy));

			assert.ok(!result.ok);
			assert.match(result.reason, /registry returned 500/);
		});
	});
});
