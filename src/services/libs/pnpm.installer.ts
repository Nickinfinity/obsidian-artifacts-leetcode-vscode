import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { LibInstaller, PnpmLibSpec, RunArgv } from './lib-ecosystem.js';
import { parsePnpmSpec } from './lib-spec.helpers.js';
import { safeJsonParse } from '../../utils/safe-json.js';

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

/** The `bin` field of a package manifest: one path, or a name → path map. */
type BinField = string | Record<string, string>;

/**
 * Every executable path a manifest's `bin` field declares, relative to the
 * package directory.
 *
 * @param bin - The parsed `bin` value, whatever shape it arrived in.
 * @returns Relative paths; `[]` for a package declaring no executable.
 *
 * @example
 * binPathsOf({ tsc: './bin/tsc' }); // → ['./bin/tsc']
 */
function binPathsOf(bin: unknown): string[] {
	if (typeof bin === 'string') { return [bin]; }
	if (bin === null || typeof bin !== 'object') { return []; }
	return Object.values(bin as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
}

/**
 * Whether every executable declared by every installed package is still on disk.
 *
 * The gap this closes, measured rather than imagined: macOS prunes
 * `/var/folders` **file by file**, so `node_modules/typescript/package.json`
 * survived while the `bin/tsc` it declares did not. The entry passed both the
 * marker check and the per-package path check, then failed the moment a `build`
 * check spawned `tsc` — `Cannot find module '…/typescript/bin/tsc'`, on a cache
 * that reported itself warm. Clearing it needed a manual `rm -rf`.
 *
 * Bounded on purpose: only the **declared** packages, and only the executables
 * their own manifests name. That is where a `build` check's argv actually
 * points, and it costs one small read per package rather than a walk of the
 * tree.
 *
 * A manifest that cannot be read or parsed counts as **not** warm — an
 * unreadable package is exactly the state this exists to catch, so it fails
 * closed.
 *
 * @param dir   - The cache directory for this set.
 * @param specs - The parsed specs it was built for.
 * @returns `true` when every declared executable resolves.
 *
 * @example
 * await everyDeclaredBinExists('/cache/pnpm-abc', [{ ecosystem: 'pnpm', name: 'typescript' }]);
 */
async function everyDeclaredBinExists(dir: string, specs: readonly PnpmLibSpec[]): Promise<boolean> {
	for (const spec of specs) {
		const pkgDir = path.join(dir, 'node_modules', spec.name);
		const manifest = await fs.readFile(path.join(pkgDir, 'package.json'), 'utf-8').catch(() => null);
		if (manifest === null) { return false; }

		const parsed = safeJsonParse<{ bin?: BinField }>(manifest);
		if (parsed === null) { return false; }

		for (const relative of binPathsOf(parsed.bin)) {
			// `access` follows symlinks, so a link into a swept store fails here
			// exactly as a missing file does — which is the point.
			const reachable = await fs.access(path.join(pkgDir, relative)).then(() => true, () => false);
			if (!reachable) { return false; }
		}
	}
	return true;
}

/**
 * One spec rendered back to the single argv element pnpm reads.
 *
 * @param spec - One parsed npm-registry spec.
 * @returns e.g. `react@^19.0.0`, or the bare name when no range was declared.
 *
 * @example
 * argvElementOf({ ecosystem: 'pnpm', name: '@types/node', range: '^20' }); // → '@types/node@^20'
 */
function argvElementOf(spec: PnpmLibSpec): string {
	return spec.range === undefined ? spec.name : `${spec.name}@${spec.range}`;
}

/**
 * The `pnpm` ecosystem's installer — the package manager this project uses
 * everywhere else, including the subprocesses the extension spawns. Its
 * packages come from registry.npmjs.org; `npm` itself is never invoked.
 *
 * `pnpm add --dir <cache>` needs no manifest in place first — it writes its own
 * `package.json` and `pnpm-lock.yaml` beside the `node_modules` it builds — so
 * nothing here authors a manifest, and no artifact-derived text can reach one.
 * Specs travel as **argv elements**, each rendered from validated fields.
 *
 * Relocatable: pnpm hard-links from a content-addressable store and its
 * `node_modules` holds relative links, so the finished tree survives the cache
 * service's build-then-rename.
 *
 * @example
 * await pnpmInstaller.install('/cache/pnpm-9f2c', [{ ecosystem: 'pnpm', name: 'react' }], run);
 */
export const pnpmInstaller: LibInstaller<PnpmLibSpec> = {
	ecosystem: 'pnpm',
	relocatable: true,
	missingTool: 'pnpm not found — install pnpm to run library-backed JavaScript/TypeScript exercises',

	/**
	 * One path per declared package, not merely `node_modules`.
	 *
	 * Checking the *packages* is what survives an OS temp-dir sweep: macOS
	 * prunes `/var/folders` by age, and a swept entry kept its marker over an
	 * emptied (or partly emptied) `node_modules`, so every later run read warm
	 * and skipped the install forever — one real cache dir claimed warm holding
	 * a single module, another held 86 with `jsdom` gone, and five vault
	 * artifacts failed with `Cannot find module 'jsdom'`.
	 *
	 * Under pnpm's layout `node_modules/<pkg>` is a **symlink** into `.pnpm/`
	 * and the probe follows it, so a sweep that took the link's target and left
	 * the link behind reads cold — exactly what it should do.
	 */
	// `package.json`, not the package *directory*. macOS prunes `/var/folders`
	// by age and does it **file by file**, so a swept entry keeps its directory
	// tree while losing its contents: `node_modules/jsdom` survived holding
	// nothing but an empty `lib/`, which passed a directory probe and then
	// failed `require('jsdom')` with `MODULE_NOT_FOUND`. A package is warm when
	// it is *loadable*, and `package.json` is what makes it loadable.
	warmPaths: specs => specs.map(spec => path.join('node_modules', spec.name, 'package.json')),

	verifyWarm: (dir, specs) => everyDeclaredBinExists(dir, specs),

	parseSpec: parsePnpmSpec,

	async install(dir: string, specs: readonly PnpmLibSpec[], run: RunArgv): Promise<void> {
		if (specs.length === 0) { return; }
		await run('pnpm', ['add', '--dir', dir, ...PNPM_FLAGS, ...specs.map(argvElementOf)], dir);
	},
};
