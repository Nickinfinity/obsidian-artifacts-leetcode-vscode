import * as path from 'node:path';
import { CARGO_TARGET_SUBDIR } from './cargo.installer.js';
import type { LibEcosystem } from './lib-ecosystem.js';
import { JARS_SUBDIR } from './maven.installer.js';

/**
 * How a child process is told where an ecosystem's libraries live.
 *
 * Split in two because prepending needs the *inherited* `PATH`, which only the
 * process spawning the child can read — a pure emitter must not.
 */
export interface LibEnvVars {
	/** Variables to merge over `process.env`. */
	readonly env: Record<string, string>;
	/** Directory to put ahead of the inherited `PATH`, when one is needed. */
	readonly pathPrepend?: string;
}

/**
 * The environment variables that make a resolved cache directory usable.
 *
 * **This is the entire consumption seam.** Every `compile` / `run` command in
 * the repo stays a fixed literal; a cache path reaches a child only as a
 * variable *value*, which no shell parses and no argv can be tricked by. One
 * authority, because the `function` environments and a `project`'s `build`
 * check must agree on what "python libraries are over there" means.
 *
 * @param ecosystem - Which registry produced the directory.
 * @param dir       - Absolute cache directory from `ensureLibEnv`.
 * @returns Variables to merge, plus an optional `PATH` prefix.
 *
 * @example
 * libEnvVars('pip', '/cache/pip-9f2c');
 * // → { env: { VIRTUAL_ENV: '/cache/pip-9f2c' }, pathPrepend: '/cache/pip-9f2c/bin' }
 * libEnvVars('pnpm', '/cache/pnpm-9f2c');
 * // → { env: { NODE_PATH: '/cache/pnpm-9f2c/node_modules' } }
 */
export function libEnvVars(ecosystem: LibEcosystem, dir: string): LibEnvVars {
	switch (ecosystem) {
		case 'pnpm':
			// CJS `require` resolution only — which is exactly what the js/ts
			// function envs' `vm` sandbox uses.
			// ponytail: does nothing for a bare ESM `import`. Upgrade path when an
			// exercise needs one: call `linkModules(tmpDir, dir)` from the runner
			// instead, the way a `project` run already does.
			return { env: { NODE_PATH: path.join(dir, 'node_modules') } };

		case 'pip':
			// Choosing the interpreter *is* activation: with the venv's `bin`
			// first on `PATH`, a bare `python3 runner.py` runs the venv's own
			// interpreter and sees its `site-packages`. Never `source activate`.
			return { env: { VIRTUAL_ENV: dir }, pathPrepend: path.join(dir, 'bin') };

		case 'maven':
			// The JVM expands the `*` itself — no shell is involved. **The
			// trailing `.` is load-bearing:** setting `CLASSPATH` replaces the
			// implicit current directory, and `java Runner` would then not find
			// `Runner.class` in the temp dir it was just compiled into.
			return { env: { CLASSPATH: `${path.join(dir, JARS_SUBDIR, '*')}${path.delimiter}.` } };

		case 'cargo':
			// Points at the pre-warmed target, so a run is an incremental link
			// rather than a cold build of every dependency.
			return { env: { CARGO_TARGET_DIR: path.join(dir, CARGO_TARGET_SUBDIR) } };
	}
}

/**
 * Merge the variables for several ecosystems into one child environment.
 *
 * Used where a single child needs more than one — a `project`'s `build` check
 * can be `['pytest', '-q']` in an exercise that also declares npm libraries.
 * `PATH` prefixes accumulate in ecosystem order, ahead of whatever the caller
 * prepends afterwards.
 *
 * @param dirs - Resolved cache directory per ecosystem.
 * @returns Merged variables and the joined `PATH` prefix (`''` when none).
 *
 * @example
 * mergeLibEnvVars(new Map([['pip', '/cache/pip-1'], ['pnpm', '/cache/pnpm-2']]));
 * // → { env: { VIRTUAL_ENV: '/cache/pip-1', NODE_PATH: '…' }, pathPrepend: '/cache/pip-1/bin' }
 */
export function mergeLibEnvVars(dirs: ReadonlyMap<LibEcosystem, string>): LibEnvVars {
	const env: Record<string, string> = {};
	const prefixes: string[] = [];

	for (const [ecosystem, dir] of dirs) {
		const vars = libEnvVars(ecosystem, dir);
		Object.assign(env, vars.env);
		if (vars.pathPrepend !== undefined) { prefixes.push(vars.pathPrepend); }
	}

	return prefixes.length === 0
		? { env }
		: { env, pathPrepend: prefixes.join(path.delimiter) };
}
