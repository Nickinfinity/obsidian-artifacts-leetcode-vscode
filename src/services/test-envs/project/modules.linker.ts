import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Directory-name prefixes that need one more level of readdir before linking. */
function isScopeLike(name: string): boolean {
	return name.startsWith('@') || name.startsWith('.');
}

/**
 * Refuse to proceed when `runModules` already exists as a symlink.
 *
 * `fs.mkdir(path, { recursive: true })` treats an existing symlink-to-a-directory
 * as "already there" and returns without complaint — every later write would
 * then land inside the link's target rather than inside `runDir`. A path that
 * does not exist yet, or is already a real directory, is left untouched.
 *
 * @param runModules - Absolute path of `<runDir>/node_modules`.
 * @returns Nothing when safe to proceed.
 * @throws Error when `runModules` is a symlink.
 *
 * @example
 * await assertNotSymlink('/tmp/run/node_modules');
 */
async function assertNotSymlink(runModules: string): Promise<void> {
	const stat = await fs.lstat(runModules).catch(() => null);
	if (stat?.isSymbolicLink()) {
		throw new Error(
			`refusing to link '${runModules}': it already exists as a symlink, not a real directory — `
			+ 'a check\'s own subprocess may have replaced it between gradings',
		);
	}
}

/**
 * Create a symlink at `linkPath` pointing at `target`, unless one already sits there.
 *
 * Idempotent by construction — no unlink-then-relink, which would race a
 * concurrent run against the same shared cache. `type` only matters on
 * Windows; POSIX ignores it.
 *
 * @param target   - Absolute path inside the shared cache — never artifact content.
 * @param linkPath - Absolute path to create, inside the run's `node_modules`.
 * @param type     - `'junction'` for a directory target, `'file'` otherwise.
 * @returns Nothing; resolves once the link exists (new or pre-existing).
 *
 * @example
 * await linkIfAbsent('/cache/node_modules/react', '/run/node_modules/react', 'junction');
 */
async function linkIfAbsent(target: string, linkPath: string, type: 'junction' | 'file'): Promise<void> {
	const exists = await fs.lstat(linkPath).then(() => true, () => false);
	if (exists) { return; }
	// ponytail: 'junction' is the Windows-required flavour named in the plan;
	// it is a no-op on POSIX and untested here — no CI runner for it in this repo.
	await fs.symlink(target, linkPath, type);
}

/**
 * Symlink every child of a scope-like cache directory (`@scope`, `.bin`, …) one
 * level down, into a **real** directory of the same name inside the run's
 * `node_modules`.
 *
 * One symlink for the whole scope would resolve fine too, but would make the
 * scope directory itself a link into the shared cache — exactly the mistake
 * `linkModules` exists to avoid one level up. Children are linked individually
 * instead, so the scope directory stays real and absorbs later npm writes
 * (e.g. a second `@types` package) without disturbing the cache.
 *
 * @param cacheModules - Absolute path of `<cacheDir>/node_modules`.
 * @param runModules   - Absolute path of `<runDir>/node_modules`.
 * @param name         - The scope-like entry name, e.g. `'@types'` or `'.bin'`.
 * @returns Nothing; resolves once every child of `name` is linked.
 *
 * @example
 * await linkScopeChildren('/cache/node_modules', '/run/node_modules', '@types');
 */
async function linkScopeChildren(cacheModules: string, runModules: string, name: string): Promise<void> {
	const scopeDir = path.join(runModules, name);
	await fs.mkdir(scopeDir, { recursive: true });

	const children = await fs.readdir(path.join(cacheModules, name), { withFileTypes: true });
	for (const child of children) {
		await linkIfAbsent(
			path.join(cacheModules, name, child.name),
			path.join(scopeDir, child.name),
			child.isDirectory() ? 'junction' : 'file',
		);
	}
}

/**
 * Build a per-run `node_modules` of symlinks into the shared library cache —
 * pnpm's layout, applied to one exercise's run directory.
 *
 * A `build` check spawns its toolchain with `cwd = runDir`; Node/`tsc`/`vite`
 * resolve `node_modules` by walking **up** from `cwd`, and the shared cache
 * (keyed on the lib set, installed once by `installLibs`) is not an ancestor
 * of `runDir` — so without this, resolution fails even though the packages
 * are on disk. Node resolves a symlink to its realpath before walking up for
 * transitive dependencies, so `runDir/node_modules/react` still finds react's
 * own dependencies inside the cache.
 *
 * `runDir/node_modules` itself is always a **real** directory, never one
 * symlink to the cache's `node_modules` — a build tool writing
 * `node_modules/.vite` or `node_modules/.cache` must land inside `runDir`,
 * not mutate the tree every other exercise resolves from. The same reasoning
 * makes `@scope` and `.bin` real directories one level down
 * (`linkScopeChildren`) rather than single links.
 *
 * Idempotent: an entry already present is left alone rather than
 * unlinked-and-relinked, so two concurrent runs sharing a cache never race
 * each other over the same link.
 *
 * SEC: every link target is built from a `readdir` of `cacheDir` — never from
 * artifact content — so a hostile `.md` cannot steer a link anywhere; `runDir`
 * is the caller's own temp/attempt path, not artifact-controlled either.
 *
 * SEC: `runDir/node_modules` is `lstat`'d **before** `mkdir` and refused if it
 * is already a symlink. `fs.mkdir(…, { recursive: true })` silently succeeds
 * when the path is a symlink to a directory, and every entry linked below
 * would then land inside whatever that symlink points at. Harmless for a
 * fresh `mkdtemp`, but the solve flow's run directory is a *persistent*
 * `attempts/project_<slug>_<run>/` graded repeatedly across Run Tests and
 * Submit, and a `build` check's argv is arbitrary code by design — it could
 * replace `node_modules` with a symlink between two gradings, and a trusting
 * `mkdir` would accept it on the next one.
 *
 * @param runDir   - Absolute path of the run directory (already created).
 * @param cacheDir - Absolute path of the shared cache for this lib set
 *                   (`libCacheDir(libs)`); its `node_modules` must already exist.
 * @returns Nothing. Throws on failure — the caller (`runProjectChecks`) already
 *          catches and maps a throw onto every check red with the reason.
 * @throws Error when `<cacheDir>/node_modules` does not exist or is unreadable,
 *         or when `<runDir>/node_modules` already exists as a symlink.
 *
 * @example
 * await linkModules('/tmp/leet-project-abc', libCacheDir(['react@^19.0.0']));
 */
export async function linkModules(runDir: string, cacheDir: string): Promise<void> {
	const runModules = path.join(runDir, 'node_modules');
	await assertNotSymlink(runModules);
	await fs.mkdir(runModules, { recursive: true });

	const cacheModules = path.join(cacheDir, 'node_modules');
	const entries = await fs.readdir(cacheModules, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.isDirectory() && isScopeLike(entry.name)) {
			await linkScopeChildren(cacheModules, runModules, entry.name);
		} else {
			await linkIfAbsent(
				path.join(cacheModules, entry.name),
				path.join(runModules, entry.name),
				entry.isDirectory() ? 'junction' : 'file',
			);
		}
	}
}
