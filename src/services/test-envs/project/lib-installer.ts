import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { validateLibNames } from '../../lib-spec.helpers.js';

const execFileAsync = promisify(execFile);

/**
 * Root of the shared cache, resolved **per call** rather than at module load so
 * the `OBSIDIAN_LEETCODE_LIBCACHE` override works whenever it is set — including
 * from a test that must not write into a developer's real cache.
 */
function cacheRoot(): string {
	return process.env.OBSIDIAN_LEETCODE_LIBCACHE
		?? path.join(os.tmpdir(), 'obsidian-leetcode-libcache');
}

/** Marker written once an install completes — its presence means "warm". */
const WARM_MARKER = '.leet-installed';

/**
 * Install budget, separate from the suite's per-case timeout.
 *
 * A cold `npm install` of a React toolchain routinely outlives a whole test
 * suite's budget; sharing one number would either kill every install or give
 * every test case five minutes.
 */
const INSTALL_TIMEOUT_MS = 300_000;

/** How the installer reports back. */
export type InstallResult =
	| { ok: true; dir: string }
	| { ok: false; reason: string };

/** Injectable subprocess runner — the seam the tests observe instead of the network. */
export interface InstallOptions {
	/** Run `file` with `args`; rejects on non-zero exit. Defaults to `execFile`. */
	run?: (file: string, args: string[], cwd: string) => Promise<void>;
}

/**
 * Absolute path of the shared cache directory for exactly this set of libs.
 *
 * Pure and **`vscode`-free by construction**: `emit` runs both inside the
 * extension and inside the headless `verify-exercise` / `grade-candidate` CLIs,
 * which have no `globalStorageUri`, so the location cannot be derived from an
 * extension context. Keyed on the *set* — declaration order does not change the
 * key, a different version does.
 *
 * @param libs - Library specs, any order.
 * @returns Absolute cache directory path; never inside the repository.
 *
 * @example
 * libCacheDir(['react@^19.0.0']); // → '/var/folders/…/obsidian-leetcode-libcache/9f2c…'
 */
export function libCacheDir(libs: readonly string[]): string {
	const key = createHash('sha256')
		.update([...libs].sort((a, b) => a.localeCompare(b)).join('\n'))
		.digest('hex')
		.slice(0, 16);
	return path.join(cacheRoot(), key);
}

/**
 * Install an artifact's declared libraries into the shared cache, once.
 *
 * **The allowlist runs first, on every call.** A warm cache short-circuits the
 * *install*, never the validation — otherwise a set whose key happened to be
 * warm would be a way to smuggle an unvalidated name through. Names reach `npm`
 * as elements of an **argv array**, so a `--flag`-shaped or `../`-shaped name
 * could not be reinterpreted even if it got this far.
 *
 * Once warm, an install is skipped entirely, which is also what makes an
 * offline run work.
 *
 * ponytail: one global cache keyed on the lib set — two artifacts wanting
 * conflicting versions of the same package get separate keys, so they do not
 * collide today. Move to per-artifact isolated installs only if an exercise
 * ever needs two versions inside one run.
 *
 * @param libs    - Declared library specs for one language.
 * @param options - Injectable runner, for tests.
 * @returns The cache directory on success, or the reason it was refused.
 *
 * @example
 * await installLibs(['react@^19.0.0']); // → { ok: true, dir: '…/obsidian-leetcode-libcache/9f2c…' }
 */
export async function installLibs(libs: readonly string[], options: InstallOptions = {}): Promise<InstallResult> {
	const check = validateLibNames(libs);
	if (!check.ok) {
		return { ok: false, reason: `refused library names: ${check.invalid.join(', ')}` };
	}

	const dir = libCacheDir(libs);
	if (libs.length === 0) { return { ok: true, dir }; }
	if (await isWarm(dir)) { return { ok: true, dir }; }

	const run = options.run ?? defaultRun;
	try {
		await fs.mkdir(dir, { recursive: true });
		await run('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', '--loglevel', 'error', ...libs], dir);
		await fs.writeFile(path.join(dir, WARM_MARKER), libs.join('\n'), 'utf-8');
		return { ok: true, dir };
	} catch (e) {
		return { ok: false, reason: `install failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

/** Whether a previous install of this exact set completed. */
async function isWarm(dir: string): Promise<boolean> {
	return fs.access(path.join(dir, WARM_MARKER)).then(() => true, () => false);
}

/** Real runner: argv array via `execFile`, never a command string. */
async function defaultRun(file: string, args: string[], cwd: string): Promise<void> {
	await execFileAsync(file, args, { cwd, timeout: INSTALL_TIMEOUT_MS });
}
