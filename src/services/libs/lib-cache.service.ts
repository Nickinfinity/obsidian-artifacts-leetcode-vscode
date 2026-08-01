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
	if (await isWarm(dir, installer.warmPaths(parsed.specs))) { return { ok: true, dir }; }

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

/**
 * Whether a previous install of this exact set completed **and is still there**.
 *
 * Requires the marker **and** every declared warm path. The marker alone is a
 * poisoned entry: macOS prunes `/var/folders` by age, and a swept cache kept
 * its marker over an emptied tree, so every later run read warm and skipped
 * the install forever — one real cache dir claimed warm holding a single
 * module, another held 86 with `jsdom` gone. A failed probe reinstalls, which
 * repairs the entry in place.
 *
 * ponytail: top-level declared packages only — a sweep that took a *transitive*
 * dependency and left its parent still reads warm. The package manager's own
 * reify repairs that on the reinstall this triggers; walking the whole tree per
 * resolve costs far more than it saves.
 *
 * @param dir       - The cache directory for this set.
 * @param warmPaths - Relative paths the installer says must exist.
 * @returns `true` only when the install can safely be skipped.
 */
async function isWarm(dir: string, warmPaths: readonly string[]): Promise<boolean> {
	const exists = async (target: string): Promise<boolean> =>
		fs.access(target).then(() => true, () => false);

	if (!await exists(path.join(dir, WARM_MARKER))) { return false; }
	for (const relative of warmPaths) {
		if (!await exists(path.join(dir, relative))) { return false; }
	}
	return true;
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
		await fs.writeFile(path.join(buildDir, WARM_MARKER), installer.ecosystem, 'utf-8');
		if (buildDir !== dir) { await renameIntoPlace(buildDir, dir); }
		return { ok: true, dir };
	} catch (e) {
		if (buildDir !== dir) { await discard(buildDir); }
		return { ok: false, reason: reasonFor(installer, e) };
	}
}

/**
 * Move a finished build into place, treating "already there" as success.
 *
 * @param buildDir - The tmp directory holding the finished install.
 * @param dir      - Where it belongs.
 */
async function renameIntoPlace(buildDir: string, dir: string): Promise<void> {
	try {
		await fs.rename(buildDir, dir);
	} catch (e) {
		// ENOTEMPTY (Linux) / EEXIST (macOS) both mean another run finished
		// first. Its directory holds the same set under the same key.
		const code = (e as NodeJS.ErrnoException).code;
		if (code !== 'ENOTEMPTY' && code !== 'EEXIST') { throw e; }
		await discard(buildDir);
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
