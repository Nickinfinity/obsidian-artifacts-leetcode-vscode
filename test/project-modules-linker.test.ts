import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { linkModules } from '../src/services/test-envs/project/modules.linker.js';

/**
 * Per-run `node_modules` linker — a real directory of symlinks into the shared cache.
 *
 * A `build` check spawns with `cwd = runDir`, which has no ancestor
 * `node_modules` of its own — the shared lib cache lives elsewhere. This
 * suite pins the shape that fixes resolution without turning the run
 * directory into a way to mutate the shared cache: `node_modules` itself, and
 * every scope-like entry one level down, must be a **real** directory; only
 * the packages inside are links.
 */
suite('project modules linker', () => {

	let cacheDir: string;
	let runDir: string;

	setup(() => {
		cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leet-cache-'));
		runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leet-run-'));
		buildFakeCache(cacheDir);
	});

	teardown(() => {
		fs.rmSync(cacheDir, { recursive: true, force: true });
		fs.rmSync(runDir, { recursive: true, force: true });
	});

	/**
	 * A minimal installer-shaped cache: a plain package, a scoped package, a
	 * `.bin` entry, and a top-level dot-**file** — every cold install writes one
	 * (`pnpm add` leaves `.modules.yaml`, npm left `.package-lock.json`), and it
	 * must be linked like any other entry, not treated as a scope (which would
	 * `readdir` a file and throw ENOTDIR).
	 */
	function buildFakeCache(dir: string): void {
		const modules = path.join(dir, 'node_modules');
		writePackage(path.join(modules, 'react'), 'react');
		writePackage(path.join(modules, '@types', 'react'), '@types/react');
		fs.mkdirSync(path.join(modules, '.bin'), { recursive: true });
		fs.writeFileSync(path.join(modules, '.bin', 'tool'), '#!/bin/sh\necho tool\n');
		fs.writeFileSync(path.join(modules, '.package-lock.json'), '{}');
	}

	function writePackage(dir: string, name: string): void {
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
		fs.writeFileSync(path.join(dir, 'index.js'), `module.exports = ${JSON.stringify(name)};`);
	}

	/** Recursive snapshot of relative paths under `dir`, for a before/after diff. */
	function snapshot(dir: string): string[] {
		const out: string[] = [];
		const walk = (rel: string): void => {
			for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
				const relPath = path.join(rel, entry.name);
				out.push(relPath);
				if (entry.isDirectory()) { walk(relPath); }
			}
		};
		walk('.');
		return out.sort();
	}

	// ── Resolution — the first failing assertion ──────────────────────────────

	test('react resolves to the CACHE copy via a tool spawned in runDir', async () => {
		await linkModules(runDir, cacheDir);
		const resolved = require.resolve('react', { paths: [runDir] });
		assert.strictEqual(resolved, fs.realpathSync(path.join(cacheDir, 'node_modules', 'react', 'index.js')));
	});

	test('node_modules itself is a REAL directory, not one symlink to the cache', async () => {
		await linkModules(runDir, cacheDir);
		assert.strictEqual(fs.lstatSync(path.join(runDir, 'node_modules')).isSymbolicLink(), false);
	});

	test('a scoped package resolves, and @types stays a real directory', async () => {
		await linkModules(runDir, cacheDir);
		const resolved = require.resolve('@types/react', { paths: [runDir] });
		assert.strictEqual(resolved, fs.realpathSync(path.join(cacheDir, 'node_modules', '@types', 'react', 'index.js')));

		const scopeStat = fs.lstatSync(path.join(runDir, 'node_modules', '@types'));
		assert.strictEqual(scopeStat.isSymbolicLink(), false);
		assert.ok(scopeStat.isDirectory());
	});

	test('.bin holds a link, but .bin itself is a real directory', async () => {
		await linkModules(runDir, cacheDir);

		const binStat = fs.lstatSync(path.join(runDir, 'node_modules', '.bin'));
		assert.strictEqual(binStat.isSymbolicLink(), false);
		assert.ok(binStat.isDirectory());
		assert.strictEqual(fs.lstatSync(path.join(runDir, 'node_modules', '.bin', 'tool')).isSymbolicLink(), true);
	});

	test('a top-level dot-FILE (.package-lock.json) is linked, never read as a scope', async () => {
		await linkModules(runDir, cacheDir);

		const linked = fs.lstatSync(path.join(runDir, 'node_modules', '.package-lock.json'));
		assert.strictEqual(linked.isSymbolicLink(), true);
	});

	// ── Idempotence and failure ────────────────────────────────────────────────

	test('linking twice throws nothing and changes nothing', async () => {
		await linkModules(runDir, cacheDir);
		const before = snapshot(runDir);

		await assert.doesNotReject(linkModules(runDir, cacheDir));
		assert.deepStrictEqual(snapshot(runDir), before);
	});

	test('a missing cache directory throws — the runner renders it', async () => {
		await assert.rejects(linkModules(runDir, path.join(cacheDir, 'does-not-exist')));
	});

	// ── The shape itself (Done-when) ───────────────────────────────────────────

	test('a build tool writing under runDir/node_modules never touches the shared cache', async () => {
		await linkModules(runDir, cacheDir);
		const before = snapshot(cacheDir);

		fs.mkdirSync(path.join(runDir, 'node_modules', '.vite'), { recursive: true });
		fs.writeFileSync(path.join(runDir, 'node_modules', '.vite', 'x'), 'build-tool-write');

		assert.deepStrictEqual(snapshot(cacheDir), before, 'the cache tree must stay byte-identical');
	});

	// ── A pnpm cache: every top-level entry is a symlink ──────────────────────

	/**
	 * pnpm's `node_modules/<pkg>` is a **symlink** into `.pnpm/`, so
	 * `Dirent.isDirectory()` answers `false` for every package — the link type
	 * has to come from a *following* stat instead. A POSIX no-op today, but the
	 * type argument exists for Windows, where linking a directory as a file is
	 * simply wrong.
	 */
	suite('against a pnpm-shaped cache', () => {

		/** A cache whose packages are symlinks into a `.pnpm` store. */
		function buildPnpmCache(dir: string): void {
			const modules = path.join(dir, 'node_modules');
			const store = path.join(modules, '.pnpm', 'react@19.0.0', 'node_modules', 'react');
			fs.mkdirSync(store, { recursive: true });
			fs.writeFileSync(path.join(store, 'index.js'), 'module.exports = {};');
			fs.symlinkSync(store, path.join(modules, 'react'), 'dir');

			const binDir = path.join(modules, '.bin');
			fs.mkdirSync(binDir, { recursive: true });
			fs.writeFileSync(path.join(binDir, 'tool'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
		}

		let pnpmCache: string;

		setup(() => {
			pnpmCache = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpmcache-'));
			buildPnpmCache(pnpmCache);
		});

		teardown(() => { fs.rmSync(pnpmCache, { recursive: true, force: true }); });

		test('a symlinked package is linked as a directory, not as a file', async () => {
			await linkModules(runDir, pnpmCache);

			const linked = path.join(runDir, 'node_modules', 'react');
			assert.ok(fs.lstatSync(linked).isSymbolicLink(), 'the entry itself is still a link');
			assert.ok(fs.statSync(linked).isDirectory(), 'and it must resolve to a directory');
		});

		test('a link to a link still reaches the package contents', async () => {
			await linkModules(runDir, pnpmCache);

			assert.strictEqual(
				fs.readFileSync(path.join(runDir, 'node_modules', 'react', 'index.js'), 'utf-8'),
				'module.exports = {};',
			);
		});

		test('.bin is still walked child by child, into a real directory', async () => {
			await linkModules(runDir, pnpmCache);

			const binDir = path.join(runDir, 'node_modules', '.bin');
			assert.ok(fs.lstatSync(binDir).isDirectory() && !fs.lstatSync(binDir).isSymbolicLink());
			assert.ok(fs.existsSync(path.join(binDir, 'tool')));
		});

		test('re-running is idempotent against a symlink farm too', async () => {
			await linkModules(runDir, pnpmCache);
			await assert.doesNotReject(linkModules(runDir, pnpmCache));
		});

		/**
		 * A cache entry pointing outside the cache is still linked **by name**
		 * only — the target is never followed into a write, and no link target
		 * is ever built from artifact content.
		 */
		test('a dangling cache entry does not throw the whole link', async () => {
			fs.symlinkSync(
				path.join(pnpmCache, 'node_modules', '.pnpm', 'gone'),
				path.join(pnpmCache, 'node_modules', 'ghost'),
				'dir',
			);

			await assert.doesNotReject(linkModules(runDir, pnpmCache));
			assert.ok(fs.existsSync(path.join(runDir, 'node_modules', 'react')));
		});
	});

	test('destroying runDir leaves every cached package on disk', async () => {
		await linkModules(runDir, cacheDir);
		fs.rmSync(runDir, { recursive: true, force: true });

		assert.ok(fs.existsSync(path.join(cacheDir, 'node_modules', 'react', 'index.js')));
		assert.ok(fs.existsSync(path.join(cacheDir, 'node_modules', '@types', 'react', 'index.js')));
		assert.ok(fs.existsSync(path.join(cacheDir, 'node_modules', '.bin', 'tool')));
	});
});
