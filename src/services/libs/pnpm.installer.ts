import * as path from 'node:path';
import type { LibInstaller, NpmLibSpec, RunArgv } from './lib-ecosystem.js';
import { parseNpmSpec } from './lib-spec.helpers.js';

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

/**
 * One spec rendered back to the single argv element pnpm reads.
 *
 * @param spec - One parsed npm spec.
 * @returns e.g. `react@^19.0.0`, or the bare name when no range was declared.
 *
 * @example
 * argvElementOf({ ecosystem: 'npm', name: '@types/node', range: '^20' }); // → '@types/node@^20'
 */
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
 * Relocatable: pnpm hard-links from a content-addressable store and its
 * `node_modules` holds relative links, so the finished tree survives the cache
 * service's build-then-rename.
 *
 * @example
 * await pnpmInstaller.install('/cache/npm-9f2c', [{ ecosystem: 'npm', name: 'react' }], run);
 */
export const pnpmInstaller: LibInstaller<NpmLibSpec> = {
	ecosystem: 'npm',
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
	warmPaths: specs => specs.map(spec => path.join('node_modules', spec.name)),

	parseSpec: parseNpmSpec,

	async install(dir: string, specs: readonly NpmLibSpec[], run: RunArgv): Promise<void> {
		if (specs.length === 0) { return; }
		await run('pnpm', ['add', '--dir', dir, ...PNPM_FLAGS, ...specs.map(argvElementOf)], dir);
	},
};
