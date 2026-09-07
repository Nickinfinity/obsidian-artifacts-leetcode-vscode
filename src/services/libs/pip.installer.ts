import * as path from 'node:path';
import type { LibInstaller, PipLibSpec, RunArgv } from './lib-ecosystem.js';
import { parsePipSpec } from './lib-spec.helpers.js';

/** The interpreter a venv is built from. Never a spec-derived name. */
const HOST_PYTHON = 'python3';

/**
 * The venv's own interpreter, relative to the cache directory.
 *
 * Also the warm probe: a venv with no interpreter is not a venv.
 */
const VENV_PYTHON = path.join('bin', HOST_PYTHON);

/**
 * One requirement rendered back to the single argv element pip reads.
 *
 * Built from validated fields, never from the author's original string — an
 * unparsed spec can therefore never reach argv, even by accident.
 *
 * @param spec - One parsed requirement.
 * @returns e.g. `requests[socks]==2.32.3`.
 *
 * @example
 * argvElementOf({ ecosystem: 'pip', name: 'numpy', extras: [], predicates: ['>=2', '<3'] });
 * // → 'numpy>=2,<3'
 */
function argvElementOf(spec: PipLibSpec): string {
	const extras = spec.extras.length === 0 ? '' : `[${spec.extras.join(',')}]`;
	return `${spec.name}${extras}${spec.predicates.join(',')}`;
}

/**
 * The pip ecosystem's installer: a **virtual environment** in the cache
 * directory, packages installed through its own interpreter.
 *
 * **Never `pip install --target`**: it does not isolate the install from system
 * site-packages and it breaks entry points, so a `build` check running
 * `['pytest', '-q']` would resolve the wrong thing or nothing at all.
 *
 * **Never `source activate`**: activation is a shell convenience that exports
 * `PATH` and `VIRTUAL_ENV`. Choosing the interpreter *is* activation, and the
 * run consumes the env the same way — through those two variables — with no
 * shell involved anywhere.
 *
 * **Invoked as `<venv>/bin/python3 -m pip`, never `<venv>/bin/pip`.** The `pip`
 * shim is a script whose shebang hard-codes the venv's absolute path; `-m`
 * needs only the interpreter, which is a symlink and survives anything.
 *
 * Not relocatable for exactly that reason: every console script a package
 * ships (`pytest`, `uvicorn`) carries the same absolute shebang, so this env is
 * built in its final directory rather than renamed into place.
 *
 * @example
 * await pipInstaller.install('/cache/pip-9f2c', [numpySpec], run);
 */
export const pipInstaller: LibInstaller<PipLibSpec> = {
	ecosystem: 'pip',
	relocatable: false,
	missingTool: 'python3 not found — install Python to run library-backed Python exercises',

	// ponytail: the interpreter only, not one path per requirement. A venv
	// stores packages under `lib/python3.<minor>/site-packages`, so a per-spec
	// probe would have to guess the minor version or read the directory; the
	// marker plus the interpreter catches the sweep that actually happens
	// (`/var/folders` pruning), and a missing package surfaces as an
	// ImportError naming itself. Upgrade path: `python3 -m pip show <name>`.
	warmPaths: () => [VENV_PYTHON],

	parseSpec: parsePipSpec,

	async install(dir: string, specs: readonly PipLibSpec[], run: RunArgv): Promise<void> {
		// `--clear` is the repair, not tidiness. `install` runs only when the
		// entry read **cold**, and the cold case that actually happens on macOS
		// is a `/var/folders` sweep that guts the venv in place. Plain
		// `python -m venv <existing dir>` runs `ensurepip` only when it *creates*
		// the environment, so it leaves a swept venv untouched and the next line
		// — `<venv>/bin/python3 -m pip` — then fails with "No module named
		// pip.__main__" on every run, forever. Measured on a real entry: marker
		// recorded 878 files, 7 survived, five vault artifacts unrepairable
		// without deleting the directory by hand.
		//
		// Rebuilding a *healthy* venv is not a cost this pays: a healthy entry
		// reads warm and never reaches `install` at all.
		//
		// ponytail: two concurrent **cold** resolves of the same key now clear
		// each other's tree mid-install, because pip opts out of the
		// tmp-then-rename dance every other installer uses (its console scripts
		// carry absolute shebangs, so a renamed venv is a dead venv). The blast
		// radius is a *failed install reported as failed* — never a false green,
		// and the next resolve rebuilds — so it is a ceiling rather than a
		// defect. Upgrade path: an `O_EXCL` lock file per key, held for the
		// install, with the loser waiting rather than clearing.
		await run(HOST_PYTHON, ['-m', 'venv', '--clear', dir], dir);
		if (specs.length === 0) { return; }
		await run(
			path.join(dir, VENV_PYTHON),
			['-m', 'pip', 'install', '--no-input', ...specs.map(argvElementOf)],
			dir,
		);
	},
};
