import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { LibInstaller, NpmLibSpec, RunArgv } from './lib-ecosystem.js';
import { packageNameOf, parseNpmSpec, validateLibNames } from './lib-spec.helpers.js';

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
 * A cold install of a React toolchain routinely outlives a whole test suite's
 * budget; sharing one number would either kill every install or give every test
 * case five minutes.
 */
const INSTALL_TIMEOUT_MS = 300_000;

/**
 * Flags every install carries, ahead of the artifact's own specs.
 *
 * `--reporter=append-only` is pnpm's non-interactive reporter: the default one
 * redraws a live progress UI, which has nothing to redraw on the pipe
 * `execFile` hands it.
 *
 * `--config.strict-dep-builds=false` keeps an *ignored* build script from
 * failing the install. pnpm 10+ does not run dependencies' install scripts
 * unless they are approved, and pnpm 11 turns that refusal into a non-zero
 * exit — so without this flag a perfectly usable install is reported as
 * `install failed`. Not running them is the point and is **stricter than the
 * npm this replaced**, which executed every artifact-declared package's
 * postinstall. esbuild — the one lib here that looks like it needs a script —
 * ships its platform binary as an optional dependency, so it works untouched
 * (verified: `transformSync` runs from a scripts-blocked install).
 *
 * ponytail: a package that genuinely needs a build step installs quietly
 * incomplete. Upgrade path is a hardcoded `--allow-build=<pkg>` allowlist here
 * — never one read from an artifact, which would be arbitrary code execution
 * by declaration.
 */
const PNPM_FLAGS: readonly string[] = ['--reporter=append-only', '--config.strict-dep-builds=false'];

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
 * Install an artifact's declared libraries into the shared cache, once, with
 * **pnpm** — the package manager this project uses everywhere else, including
 * the subprocesses the extension spawns.
 *
 * **The allowlist runs first, on every call.** A warm cache short-circuits the
 * *install*, never the validation — otherwise a set whose key happened to be
 * warm would be a way to smuggle an unvalidated name through. Names reach `pnpm`
 * as elements of an **argv array**, so a `--flag`-shaped or `../`-shaped name
 * could not be reinterpreted even if it got this far.
 *
 * `pnpm add --dir <cache>` needs no manifest in place first: it writes its own
 * `package.json` and `pnpm-lock.yaml` beside the `node_modules` it builds.
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
	if (await isWarm(dir, libs)) { return { ok: true, dir }; }

	const run = options.run ?? defaultRun;
	try {
		await fs.mkdir(dir, { recursive: true });
		// ponytail: no lock around this install — two cold runs of the same lib
		// set (e.g. two parallel `verify-exercise.mjs` invocations) both `pnpm
		// add --dir` this same dir at once. Upgrade path: install into
		// `<key>.tmp-<pid>` then `fs.rename` into place, which also makes the
		// warm marker atomic instead of merely self-healing (see isWarm below).
		// The cache service pays exactly that for every ecosystem **but pip**,
		// whose venv console scripts carry absolute shebangs and cannot be
		// renamed after the fact.
		await pnpmInstaller.install(dir, specsOf(libs), run);
		await fs.writeFile(path.join(dir, WARM_MARKER), libs.join('\n'), 'utf-8');
		return { ok: true, dir };
	} catch (e) {
		return { ok: false, reason: `install failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

/**
 * Re-parse an already-validated list into fields.
 *
 * `installLibs` validates the whole list up front, so every entry parses here;
 * a refusal at this point would mean the two disagreed, which is why they share
 * one grammar. Kept private — `ensureLibEnv` will parse once and pass the
 * fields straight to {@link pnpmInstaller}, retiring this bridge.
 *
 * @param libs - Specs already through `validateLibNames`.
 * @returns The parsed fields, refusals dropped.
 */
function specsOf(libs: readonly string[]): NpmLibSpec[] {
	return libs.flatMap(lib => {
		const parsed = parseNpmSpec(lib);
		return parsed.ok ? [parsed.spec] : [];
	});
}

/** One spec rendered back to the single argv element pnpm reads. */
function argvElementOf(spec: NpmLibSpec): string {
	return spec.range === undefined ? spec.name : `${spec.name}@${spec.range}`;
}

/**
 * The npm ecosystem's installer: **pnpm**, the package manager this project
 * uses everywhere else, including the subprocesses the extension spawns.
 *
 * `pnpm add --dir <cache>` needs no manifest in place first — it writes its own
 * `package.json` and `pnpm-lock.yaml` beside the `node_modules` it builds — so
 * nothing here authors a manifest, and no artifact-derived text can reach one.
 * Specs travel as **argv elements**, each rendered from validated fields.
 *
 * @example
 * await pnpmInstaller.install('/cache/npm-9f2c', [{ ecosystem: 'npm', name: 'react' }], run);
 */
export const pnpmInstaller: LibInstaller<NpmLibSpec> = {
	ecosystem: 'npm',
	product: 'node_modules',
	parseSpec: parseNpmSpec,
	async install(dir: string, specs: readonly NpmLibSpec[], run: RunArgv): Promise<void> {
		if (specs.length === 0) { return; }
		await run('pnpm', ['add', '--dir', dir, ...PNPM_FLAGS, ...specs.map(argvElementOf)], dir);
	},
};

/**
 * Whether a previous install of this exact set completed **and is still there**.
 *
 * Requires the marker **and** every declared package's directory. The marker
 * alone is a poisoned entry — an install that never finished (this is exactly
 * the shape of two real cache dirs found on disk pre-fix,
 * `26cd6fc0919db386` / `acfe6d9ef8ec1555`, left behind by the installer's own
 * unit tests before cache isolation existed).
 *
 * Checking the *packages* rather than merely the `node_modules` directory is
 * what survives an OS temp-dir sweep: `/var/folders` on macOS prunes cache
 * contents by age, and a swept entry kept its marker and an emptied (or
 * partly emptied) `node_modules`, so every later run read warm and skipped the
 * install — one real cache dir claimed warm holding a single module, another
 * held 86 with `jsdom` gone, and five vault artifacts failed with
 * `Cannot find module 'jsdom'`. A failed check reinstalls, which repairs the
 * entry in place.
 *
 * Under pnpm's layout `node_modules/<pkg>` is a **symlink** into `.pnpm/`, and
 * `fs.access` follows it — so a sweep that took the link's target and left the
 * link behind reads cold here, which is exactly what it should do.
 *
 * ponytail: top-level declared packages only — a sweep that took a *transitive*
 * dependency and left its parent still reads warm. npm's own reify would repair
 * that on the reinstall this triggers; walking the whole tree per resolve costs
 * far more than it saves. Upgrade path if it ever bites: shell `npm ls
 * --prefix <dir> --depth=0 --json` instead.
 *
 * @param dir  - The cache directory for this lib set.
 * @param libs - The declared specs, already allowlist-validated by the caller.
 * @returns `true` only when the install can safely be skipped.
 */
async function isWarm(dir: string, libs: readonly string[]): Promise<boolean> {
	const hasMarker = await fs.access(path.join(dir, WARM_MARKER)).then(() => true, () => false);
	if (!hasMarker) { return false; }

	const modules = path.join(dir, 'node_modules');
	for (const lib of libs) {
		const present = await fs.access(path.join(modules, packageNameOf(lib))).then(() => true, () => false);
		if (!present) { return false; }
	}
	return true;
}

/** Real runner: argv array via `execFile`, never a command string. */
async function defaultRun(file: string, args: string[], cwd: string): Promise<void> {
	await execFileAsync(file, args, { cwd, timeout: INSTALL_TIMEOUT_MS });
}
