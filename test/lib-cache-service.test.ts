import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LibEcosystem, LibInstaller, ParsedLibSpec, RunArgv } from '../src/services/libs/lib-ecosystem.js';
import { cargoInstaller } from '../src/services/libs/cargo.installer.js';
import { ensureLibEnv, libEnvDir } from '../src/services/libs/lib-cache.service.js';
import { mavenInstaller } from '../src/services/libs/maven.installer.js';

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
					// Another run completes first, marker and all. Its marker carries a
					// **count**, because `installEnv` writes one into the build dir before
					// the rename — so a genuine race winner is always countable, and that
					// is what separates it from a legacy or swept squatter.
					fs.mkdirSync(path.join(final, 'product'), { recursive: true });
					fs.writeFileSync(path.join(final, 'product', 'index.js'), '// entry', 'utf-8');
					fs.writeFileSync(path.join(final, 'squatter'), 'winner', 'utf-8');
					// Two files, and the count says two — the marker excludes itself.
					fs.writeFileSync(
						path.join(final, '.leet-installed'), JSON.stringify({ files: 2 }), 'utf-8');
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

	/**
	 * C19 — the real maven and cargo installers, driven through `ensureLibEnv`
	 * with only the subprocess seam stubbed. Everything else — the pom/manifest
	 * files, the warm-path check, the marker — runs for real against a real
	 * `mkdtemp` directory, because the whole defect is about what genuinely
	 * survives on disk; a mocked `stat` would have passed against the broken
	 * `warmPaths: () => ['jars']` / `['Cargo.lock', 'target']` just as easily.
	 */
	suite('a swept product directory reads cold (C19)', () => {

		test('an emptied jars/ directory reads cold for maven, not warm', async () => {
			let installs = 0;
			const run: RunArgv = async (_file, _args, cwd) => {
				installs++;
				const jarsDir = path.join(cwd, 'jars');
				fs.mkdirSync(jarsDir, { recursive: true });
				fs.writeFileSync(path.join(jarsDir, 'guava-33.3.1-jre.jar'), 'fake-jar-bytes');
			};
			const opts = { installers: { maven: mavenInstaller as LibInstaller }, run };
			const specs = ['com.google.guava:guava:33.3.1-jre'];

			const first = await ensureLibEnv('maven', specs, opts);
			assert.strictEqual(first.ok, true);
			assert.strictEqual(installs, 1);

			// macOS sweep: the `jars/` directory itself survives, the jar inside
			// it does not.
			if (first.ok) { fs.rmSync(path.join(first.dir, 'jars', 'guava-33.3.1-jre.jar')); }

			const second = await ensureLibEnv('maven', specs, opts);
			assert.strictEqual(second.ok, true);
			assert.strictEqual(installs, 2, 'an emptied jars/ dir must reinstall, not read warm');
		});

		test('an emptied target/release/ reads cold for cargo, not warm', async () => {
			let installs = 0;
			const run: RunArgv = async (_file, args, cwd, env) => {
				if (args[0] === 'fetch') {
					installs++;
					fs.writeFileSync(path.join(cwd, 'Cargo.lock'), 'fake-lock');
				} else if (args[0] === 'build') {
					const releaseDir = path.join(env?.CARGO_TARGET_DIR ?? '', 'release');
					fs.mkdirSync(releaseDir, { recursive: true });
					fs.writeFileSync(path.join(releaseDir, 'leet_warm'), 'fake-binary');
				}
			};
			const opts = { installers: { cargo: cargoInstaller as LibInstaller }, run };
			const specs = ['serde@^1'];

			const first = await ensureLibEnv('cargo', specs, opts);
			assert.strictEqual(first.ok, true);
			assert.strictEqual(installs, 1);

			// macOS sweep: `target/release/` survives, the binary inside it does not.
			if (first.ok) { fs.rmSync(path.join(first.dir, 'target', 'release', 'leet_warm')); }

			const second = await ensureLibEnv('cargo', specs, opts);
			assert.strictEqual(second.ok, true);
			assert.strictEqual(installs, 2, 'an emptied target/release/ must reinstall, not read warm');
		});
	});

	/**
	 * C20 — a swept *transitive* file, one `warmPaths` cannot name up front
	 * because no spec predicts it. Built against real `mkdtemp` trees: the stub
	 * installer writes real nested files, the test deletes one with a real
	 * `fs.rmSync`, and the assertion is on a real second install being spawned.
	 */
	suite('a swept transitive file reads cold, via the recorded file count (C20)', () => {

		/** A stub installer whose install writes a small real file tree. */
		function treeStub(buildTree: (dir: string) => void) {
			const dirs: string[] = [];
			const installer: LibInstaller = {
				ecosystem: 'pnpm',
				relocatable: true,
				missingTool: 'pnpm-tool not found',
				warmPaths: () => ['product'],
				parseSpec: raw => ({ ok: true, spec: { ecosystem: 'pnpm', name: raw } }),
				install: async dir => { dirs.push(dir); buildTree(dir); },
			};
			return { dirs, installers: { pnpm: installer } };
		}

		test('a file removed from inside an installed package drops the count below what was recorded', async () => {
			const spy = treeStub(dir => {
				fs.mkdirSync(path.join(dir, 'product', 'nested'), { recursive: true });
				fs.writeFileSync(path.join(dir, 'product', 'index.js'), '// entry');
				fs.writeFileSync(path.join(dir, 'product', 'nested', 'transitive.js'), '// dep');
			});

			const first = await ensureLibEnv('pnpm', ['react'], spy);
			assert.strictEqual(first.ok, true);
			assert.strictEqual(spy.dirs.length, 1);

			// The declared warm path (`product/`) still exists — only a file
			// nested inside it is gone, exactly like the real iconv-lite defect.
			if (first.ok) { fs.rmSync(path.join(first.dir, 'product', 'nested', 'transitive.js')); }

			const second = await ensureLibEnv('pnpm', ['react'], spy);
			assert.strictEqual(second.ok, true);
			assert.strictEqual(spy.dirs.length, 2, 'a dropped file count must reinstall, not read warm');
		});

		test('a marker recording no count — the pre-fix shape — reads COLD and upgrades itself once', async () => {
			const spy = treeStub(dir => {
				fs.mkdirSync(path.join(dir, 'product'), { recursive: true });
				fs.writeFileSync(path.join(dir, 'product', 'index.js'), '// entry');
			});
			await ensureLibEnv('pnpm', ['react'], spy);
			const dir = libEnvDir('pnpm', ['react']);

			// A marker from before this fix: plain ecosystem text, not JSON.
			fs.writeFileSync(path.join(dir, '.leet-installed'), 'pnpm', 'utf-8');

			const again = await ensureLibEnv('pnpm', ['react'], spy);
			assert.strictEqual(again.ok, true);
			// Reversal, and the reason is measured rather than theoretical: treating a
			// countless marker as "no opinion" left the check inert on every entry that
			// already existed — the exact entries that were already broken. One
			// reinstall per legacy entry buys a count; grandfathering buys nothing.
			assert.strictEqual(spy.dirs.length, 2, 'a legacy non-JSON marker must reinstall once, to earn a count');

			// …and exactly once: the upgraded marker now carries a count, so the next
			// resolve is warm again. Without this the reversal is a reinstall-every-run bug.
			const third = await ensureLibEnv('pnpm', ['react'], spy);
			assert.strictEqual(third.ok, true);
			assert.strictEqual(spy.dirs.length, 2, 'the upgrade happens once, not on every resolve');
		});

		test('files added after install never invalidate an otherwise-healthy entry', async () => {
			const spy = treeStub(dir => {
				fs.mkdirSync(path.join(dir, 'product'), { recursive: true });
				fs.writeFileSync(path.join(dir, 'product', 'index.js'), '// entry');
			});
			const result = await ensureLibEnv('pnpm', ['react'], spy);
			assert.strictEqual(result.ok, true);

			if (result.ok) { fs.writeFileSync(path.join(result.dir, 'product', 'extra.log'), 'noise'); }

			const again = await ensureLibEnv('pnpm', ['react'], spy);
			assert.strictEqual(again.ok, true);
			assert.strictEqual(spy.dirs.length, 1, 'strictly more files on disk must still read warm');
		});
	});
});
