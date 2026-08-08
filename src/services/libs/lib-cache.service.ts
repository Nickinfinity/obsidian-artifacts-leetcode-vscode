import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { cargoInstaller } from './cargo.installer.js';
import type { LibEcosystem, LibInstaller, ParsedLibSpec, RunArgv } from './lib-ecosystem.js';
import { mavenInstaller } from './maven.installer.js';
import { pipInstaller } from './pip.installer.js';
import { pnpmInstaller } from './pnpm.installer.js';
import { safeJsonParse } from '../../utils/safe-json.js';

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
 * A cold install of a React toolchain — or a cargo pre-warm — routinely
 * outlives a whole test suite's budget; sharing one number would either kill
 * every install or give every test case five minutes.
 */
const INSTALL_TIMEOUT_MS = 300_000;

/**
 * The real installer per ecosystem — the whole capability matrix for `libs:`.
 *
 * The casts are the one place the spec-type parameter is widened: each
 * installer only ever receives specs its *own* `parseSpec` produced, because
 * {@link ensureLibEnv} pairs the two, and nothing else assembles a spec list.
 *
 * Tests inject their own map instead of reaching the network.
 */
const INSTALLERS: Record<LibEcosystem, LibInstaller> = {
	pnpm: pnpmInstaller as LibInstaller,
	pip: pipInstaller as LibInstaller,
	cargo: cargoInstaller as LibInstaller,
	maven: mavenInstaller as LibInstaller,
};

/** How the cache door reports back. */
export type LibEnvResult =
	| { readonly ok: true; readonly dir: string }
	| { readonly ok: false; readonly reason: string };

/** Seams a caller (almost always a test) can replace. */
export interface LibEnvOptions {
	/** Subprocess runner; defaults to `execFile` under the install budget. */
	run?: RunArgv;
	/** Installer per ecosystem; defaults to the real registry. */
	installers?: Partial<Record<LibEcosystem, LibInstaller>>;
}

/**
 * Absolute path of the shared cache directory for exactly this
 * `(ecosystem, spec set)`.
 *
 * Pure and **`vscode`-free by construction**: this resolves both inside the
 * extension and inside the headless `verify-exercise` / `grade-candidate`
 * CLIs, which have no `globalStorageUri`, so the location cannot come from an
 * extension context. Hash-derived, never artifact-derived.
 *
 * The ecosystem is part of the key, and that is a defect fix rather than
 * tidiness: keyed on the spec set alone, `['react']` named one directory
 * whether it meant the npm package or a PyPI one, so a python run could be
 * served a `node_modules` and report a green install.
 *
 * @param ecosystem - Registry the specs are written for.
 * @param specs     - Raw specs, any order.
 * @returns Absolute cache directory path; never inside the repository.
 *
 * @example
 * libEnvDir('pip', ['numpy>=2']); // → '/var/folders/…/obsidian-leetcode-libcache/pip-9f2c…'
 */
export function libEnvDir(ecosystem: LibEcosystem, specs: readonly string[]): string {
	const key = createHash('sha256')
		.update(`${ecosystem}\n${[...specs].sort((a, b) => a.localeCompare(b)).join('\n')}`)
		.digest('hex')
		.slice(0, 16);
	return path.join(cacheRoot(), `${ecosystem}-${key}`);
}

/**
 * Resolve the cache directory holding exactly these libraries, installing them
 * once if it does not exist yet.
 *
 * **The grammar runs first, on every call.** A warm key short-circuits the
 * *install*, never the validation — otherwise a set whose key happened to be
 * warm would be a way to smuggle an unvalidated spec through. Specs reach the
 * package manager as elements of an **argv array**, so a `--flag`-shaped or
 * `../`-shaped spec could not be reinterpreted even if it got that far.
 *
 * @param ecosystem - Registry the specs are written for.
 * @param specs     - Raw specs exactly as written in `libs:`.
 * @param options   - Injectable runner and installer map, for tests.
 * @returns The cache directory, or the reason the libraries are unavailable.
 *
 * @example
 * await ensureLibEnv('pip', ['numpy>=2']);
 * // → { ok: true, dir: '…/obsidian-leetcode-libcache/pip-9f2c…' }
 */
export async function ensureLibEnv(
	ecosystem: LibEcosystem, specs: readonly string[], options: LibEnvOptions = {},
): Promise<LibEnvResult> {
	const installer = (options.installers ?? INSTALLERS)[ecosystem];
	if (!installer) {
		return { ok: false, reason: `no installer for '${ecosystem}' libraries` };
	}

	const parsed = parseAll(installer, specs);
	if (!parsed.ok) { return parsed; }

	const dir = libEnvDir(ecosystem, specs);
	if (specs.length === 0) { return { ok: true, dir }; }
	if (await isWarm(dir, installer, parsed.specs)) { return { ok: true, dir }; }

	return installEnv(installer, dir, parsed.specs, options.run ?? defaultRun);
}

/**
 * Parse every spec, or refuse the whole set naming each offender.
 *
 * All-or-nothing on purpose: a partially installed environment is a run that
 * fails later, further from the cause. The parser that drops individual
 * entries is the *artifact parser*, which warns the author at authoring time.
 *
 * @param installer - The ecosystem's installer, for its grammar.
 * @param specs     - Raw specs.
 * @returns The parsed fields, or the refusal to hand back unchanged.
 */
function parseAll(
	installer: LibInstaller, specs: readonly string[],
): { ok: true; specs: ParsedLibSpec[] } | { ok: false; reason: string } {
	const out: ParsedLibSpec[] = [];
	const refused: string[] = [];
	for (const raw of specs) {
		const parsed = installer.parseSpec(raw);
		if (parsed.ok) { out.push(parsed.spec); } else { refused.push(parsed.reason); }
	}
	return refused.length === 0
		? { ok: true, specs: out }
		: { ok: false, reason: `refused library specs: ${refused.join('; ')}` };
}

/** The marker's content once a file count has been recorded. */
interface WarmMarker {
	readonly files: number;
}

/**
 * Count every file (and symlink) under `dir`, recursing into real
 * subdirectories only.
 *
 * A symlink is counted as one entry and never followed — which is exactly
 * right for pnpm's layout, where `node_modules/<pkg>` is a symlink into
 * `.pnpm/…`: the link itself is one file, and the real files it points at are
 * already being counted where they actually live, inside `.pnpm/`. A sweep
 * that removes one of *those* real files shrinks the total the same way it
 * would for any other file.
 *
 * `rootMarker`, when given, is skipped at the top level only — so the marker
 * never counts itself, regardless of whether it exists yet.
 *
 * @param dir        - Directory to walk.
 * @param rootMarker - A filename to skip, but only in `dir` itself.
 * @returns Total file/symlink count.
 */
async function countFiles(dir: string, rootMarker?: string): Promise<number> {
	const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
	let count = 0;
	for (const entry of entries) {
		if (rootMarker !== undefined && entry.name === rootMarker) { continue; }
		count += entry.isDirectory() ? await countFiles(path.join(dir, entry.name)) : 1;
	}
	return count;
}

/**
 * The file count a previous install recorded, or `null` when there is none to
 * read.
 *
 * `null` covers two cases identically, and both must pass rather than fail:
 * a marker written **before** this check existed (plain ecosystem text, not
 * JSON — every real cache on a developer's machine today) and a marker whose
 * JSON happens to carry no `files` field. Either way "no recorded count" reads
 * as "no opinion", never as cold — a strict fix here must not turn into a
 * reinstall stampede across every warm cache on the machine that adopts it.
 *
 * @param dir - The cache directory for this set.
 * @returns The recorded count, or `null`.
 */
async function recordedFileCount(dir: string): Promise<number | null> {
	const raw = await fs.readFile(path.join(dir, WARM_MARKER), 'utf-8').catch(() => null);
	if (raw === null) { return null; }
	const parsed = safeJsonParse<Partial<WarmMarker>>(raw);
	return typeof parsed?.files === 'number' ? parsed.files : null;
}

/**
 * Whether the tree still holds at least as many files as were recorded at
 * install time.
 *
 * This is the check that closes the *transitive*-dependency gap every other
 * layer misses: `warmPaths` only names paths a spec can predict up front
 * (`node_modules/<pkg>/package.json`), so a sweep that takes a file *inside*
 * an installed package — `.pnpm/iconv-lite@0.6.3/node_modules/iconv-lite/lib/
 * bom-handling.js`, with its siblings left intact — passed every other probe
 * and still failed at run time with `Cannot find module './bom-handling'`.
 * Five committed artifacts failed exactly that way, with the marker present
 * and every per-spec `package.json` present too.
 *
 * Strict less-than only: a tool writing into the cache after install (a lock
 * file, a `.vite` dir, a log) only ever adds, and must never invalidate an
 * otherwise-healthy entry.
 *
 * **A marker carrying no count reads COLD, and that is a deliberate reversal.**
 * The first cut treated "no recorded count" as "no opinion" and passed, to
 * avoid re-installing every pre-existing entry on the machine that adopts
 * this. Measured consequence: it made the whole check **inert on exactly the
 * entries that were already broken**. A real entry
 * (`pnpm-fd0dbf12c304de57`) held a legacy plain-text marker over a tree whose
 * `iconv-lite/lib/bom-handling.js` had been swept, passed every probe, and
 * failed five committed artifacts on two consecutive runs — after this fix
 * had supposedly landed. Grandfathering the old format grandfathers the
 * defect with it.
 *
 * The cost of the reversal is bounded and one-time: each pre-existing entry
 * reinstalls **once**, then carries a count and is checked properly forever.
 * That is a few cold resolves on one machine, against a defect that otherwise
 * never repairs.
 *
 * @param dir - The cache directory for this set.
 * @returns `true` only when a count is recorded and the tree still meets it.
 */
async function fileCountHolds(dir: string): Promise<boolean> {
	const recorded = await recordedFileCount(dir);
	if (recorded === null) { return false; }
	return await countFiles(dir, WARM_MARKER) >= recorded;
}

/**
 * Whether a previous install of this exact set completed **and is still there**.
 *
 * Requires the marker, every declared warm path, the installer's own deeper
 * probe, and — last, because it is the most expensive of the four — that the
 * tree still holds as many files as were recorded at install time. Each layer
 * was added because the one before it read warm over a broken tree: macOS
 * prunes `/var/folders` **file by file**, so a swept entry keeps its directory
 * skeleton and loses its contents. Probing for a bare *directory* per spec
 * therefore proved nothing — every installer now names a **file** per spec
 * (pnpm: `node_modules/<name>/package.json`; maven: the copied jar; cargo:
 * the release binary), `verifyWarm` additionally checks that a declared
 * **executable** still exists, and the file-count pass below catches a sweep
 * that took a file *inside* a package while leaving its declared marker paths
 * untouched. A failed probe reinstalls, which repairs the entry in place.
 *
 * Remaining ceiling: the count is content-blind. A sweep that removes N files
 * and something unrelated (a tool's own write) adds N or more back is
 * indistinguishable from a healthy entry — this catches a net loss, not a
 * swap. That is a narrower gap than "any transitive dependency ever," which
 * is what this check replaces.
 *
 * @param dir       - The cache directory for this set.
 * @param warmPaths - Relative paths the installer says must exist.
 * @returns `true` only when the install can safely be skipped.
 */
async function isWarm(
	dir: string, installer: LibInstaller, specs: readonly ParsedLibSpec[],
): Promise<boolean> {
	const exists = async (target: string): Promise<boolean> =>
		fs.access(target).then(() => true, () => false);

	if (!await exists(path.join(dir, WARM_MARKER))) { return false; }
	for (const relative of installer.warmPaths(specs)) {
		if (!await exists(path.join(dir, relative))) { return false; }
	}
	if (installer.verifyWarm && !await installer.verifyWarm(dir, specs)) { return false; }
	return fileCountHolds(dir);
}

/**
 * Build the environment and put it at `dir`, atomically where the product
 * allows it.
 *
 * A relocatable product is built in `<dir>.tmp-<pid>` and renamed, so a second
 * window racing the same key can never observe a half-built tree. The loser of
 * that race finds the winner's directory already in place — both wanted
 * exactly that directory, so it reports success and deletes its own tmp rather
 * than failing a run whose packages are on disk.
 *
 * @param installer - The ecosystem's installer.
 * @param dir       - Final cache directory.
 * @param specs     - Already-parsed specs.
 * @param run       - Subprocess seam.
 * @returns The cache directory, or the reason the install failed.
 */
async function installEnv(
	installer: LibInstaller, dir: string, specs: readonly ParsedLibSpec[], run: RunArgv,
): Promise<LibEnvResult> {
	const buildDir = installer.relocatable ? `${dir}.tmp-${process.pid}` : dir;
	try {
		await fs.mkdir(buildDir, { recursive: true });
		await installer.install(buildDir, specs, run);
		const marker: WarmMarker = { files: await countFiles(buildDir, WARM_MARKER) };
		await fs.writeFile(path.join(buildDir, WARM_MARKER), JSON.stringify(marker), 'utf-8');
		if (buildDir !== dir) { await renameIntoPlace(buildDir, dir, installer, specs); }
		return { ok: true, dir };
	} catch (e) {
		if (buildDir !== dir) { await discard(buildDir); }
		return { ok: false, reason: reasonFor(installer, e) };
	}
}

/**
 * Move a finished build into place.
 *
 * A collision has **two** causes and they need opposite handling — conflating
 * them was a live defect that made every affected exercise fail forever:
 *
 * - **Another run finished first.** Its directory holds the same set under the
 *   same key, so the build is redundant and gets discarded. Losing that race
 *   is success; both runs wanted that directory.
 * - **A stale directory is squatting the key.** macOS prunes `/var/folders` by
 *   age, file by file, so a swept entry keeps its directory tree and loses its
 *   contents. `rename` then fails exactly as it does for a race — and treating
 *   it as one **threw away the freshly built repair and kept the gutted tree**,
 *   every run, forever. That is why "a failed check reinstalls, repairing the
 *   entry in place" was false: the repair was built, then deleted.
 *
 * The two are told apart by asking the same question `ensureLibEnv` asks up
 * front — is what is already there actually warm? Only a warm winner keeps its
 * directory; a stale one is replaced by the build that just succeeded.
 *
 * @param buildDir  - The tmp directory holding the finished install.
 * @param dir       - Where it belongs.
 * @param installer - The ecosystem's installer, for its warm probe.
 * @param specs     - The parsed specs, for that same probe.
 */
async function renameIntoPlace(
	buildDir: string, dir: string, installer: LibInstaller, specs: readonly ParsedLibSpec[],
): Promise<void> {
	try {
		await fs.rename(buildDir, dir);
		return;
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code !== 'ENOTEMPTY' && code !== 'EEXIST') { throw e; }
	}

	if (await isWarm(dir, installer, specs)) { await discard(buildDir); return; }

	// Stale squatter: swap the good build in, then drop the old tree. The stale
	// directory is moved aside first so the window in which the key resolves to
	// nothing is a rename, not a recursive delete.
	const stale = `${dir}.stale-${process.pid}`;
	try {
		await fs.rename(dir, stale);
		await fs.rename(buildDir, dir);
	} catch {
		// Another run may have repaired it in the meantime; its tree is as good
		// as ours, so keep whatever is in place rather than fighting over it.
		await discard(buildDir);
		return;
	} finally {
		await discard(stale);
	}
}

/** Remove a directory, never letting cleanup failure mask the real error. */
async function discard(dir: string): Promise<void> {
	await fs.rm(dir, { recursive: true, force: true }).catch(() => { /* best effort */ });
}

/**
 * A user-facing sentence for an install failure.
 *
 * `ENOENT` means the toolchain itself is missing, which is a "install Maven"
 * answer rather than a stack trace — the same shape a missing language runtime
 * already gets.
 *
 * @param installer - The ecosystem's installer, for its named message.
 * @param error     - Whatever the install threw.
 * @returns One sentence to show per case.
 */
function reasonFor(installer: LibInstaller, error: unknown): string {
	if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
		return installer.missingTool;
	}
	const detail = childOutput(error) || (error instanceof Error ? error.message : JSON.stringify(error));
	return `install failed: ${detail}`;
}

/** How much of a failed installer's output to keep — enough to diagnose, not a wall. */
const MAX_OUTPUT = 2_000;

/**
 * What the package manager actually said, trimmed to its tail.
 *
 * Without this a failed install reported only `Command failed: mvn -q -f …`,
 * which names the command and nothing about the problem. **stdout matters as
 * much as stderr**: Maven prints its `[ERROR]` diagnostics to stdout, so
 * reading stderr alone would have kept the message empty for the one
 * ecosystem most likely to fail on a version that does not exist.
 *
 * The tail rather than the head, because a resolver's useful line is its last.
 *
 * @param error - Whatever the install threw.
 * @returns The child's output, trimmed, or `''` when it said nothing.
 *
 * @example
 * childOutput({ stdout: '[ERROR] guava:33.3.1-jre was not found' });
 * // → '[ERROR] guava:33.3.1-jre was not found'
 */
function childOutput(error: unknown): string {
	const { stderr, stdout } = (error ?? {}) as { stderr?: string; stdout?: string };
	const text = `${stderr ?? ''}\n${stdout ?? ''}`.trim();
	return text.length <= MAX_OUTPUT ? text : `…${text.slice(-MAX_OUTPUT)}`;
}

/** Real runner: argv array via `execFile`, never a command string. */
const defaultRun: RunArgv = async (file, args, cwd, env) => {
	await execFileAsync(file, args, { cwd, env, timeout: INSTALL_TIMEOUT_MS });
};
