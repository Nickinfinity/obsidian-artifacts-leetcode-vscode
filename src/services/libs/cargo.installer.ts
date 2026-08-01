import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CargoLibSpec, LibInstaller, RunArgv } from './lib-ecosystem.js';
import { parseCargoSpec } from './lib-spec.helpers.js';

/** Edition every generated manifest pins. A constant, never artifact-derived. */
const EDITION = '2021';

/** Package name of the throwaway binary the pre-warm build compiles. */
const WARM_PACKAGE = 'leet_warm';

/** The pre-warm binary's source: enough to link every declared crate. */
const WARM_MAIN = 'fn main() {}\n';

/** Where cargo is told to put build artefacts, relative to the cache dir. */
export const CARGO_TARGET_SUBDIR = 'target';

/**
 * One dependency rendered as a `[dependencies]` entry.
 *
 * Rendered from **validated fields**, never from author text: a crate name, a
 * version requirement and a feature list have each already matched an anchored
 * pattern, so nothing here can close a string or open a new TOML table. The
 * quoting is belt and braces on top of that.
 *
 * @param spec - One parsed cargo dependency.
 * @returns The manifest line, without a trailing newline.
 *
 * @example
 * dependencyLine({ ecosystem: 'cargo', name: 'serde', req: '^1', features: ['derive'] });
 * // → 'serde = { version = "^1", features = ["derive"] }'
 */
function dependencyLine(spec: CargoLibSpec): string {
	const version = spec.req ?? '*';
	if (spec.features.length === 0) { return `${spec.name} = "${version}"`; }
	const features = spec.features.map(feature => `"${feature}"`).join(', ');
	return `${spec.name} = { version = "${version}", features = [${features}] }`;
}

/**
 * Render a complete `Cargo.toml` for a set of dependencies.
 *
 * Exported because the `function × rust` environment emits its own manifest
 * for the run's project and must not grow a second renderer — the two would
 * drift the first time a field is added.
 *
 * The package name is a **parameter** rather than a constant: two concurrent
 * rust suites share one `CARGO_TARGET_DIR`, and identical package names mean
 * they overwrite one another's binary.
 *
 * @param packageName - Package name; hash-derived at the call site.
 * @param specs       - Parsed dependencies, in declaration order.
 * @returns The manifest text.
 *
 * @example
 * renderCargoToml('leet_warm', [{ ecosystem: 'cargo', name: 'serde', req: '^1', features: [] }]);
 * // → '[package]\nname = "leet_warm"\n…\n[dependencies]\nserde = "^1"\n'
 */
export function renderCargoToml(packageName: string, specs: readonly CargoLibSpec[]): string {
	const dependencies = specs.map(dependencyLine).join('\n');
	return [
		'[package]',
		`name = "${packageName}"`,
		'version = "0.0.0"',
		`edition = "${EDITION}"`,
		'',
		'[dependencies]',
		dependencies,
		'',
	].join('\n');
}

/**
 * The cargo ecosystem's installer: a throwaway crate whose dependencies are
 * fetched **and compiled**, so the cache holds a warm `target/`.
 *
 * **The build is the point, not an optimisation.** A cold `cargo build` of
 * serde takes minutes, and `tryCompile` in the suite runner passes no timeout
 * at all — so without a warm target the first solve of a library-backed Rust
 * exercise is an unbounded wait that looks like a hung extension. Paying it
 * here puts the cost inside the install budget, where a slow install is at
 * least reported as one.
 *
 * `~/.cargo` is cargo's own registry cache and is never written directly; only
 * `CARGO_TARGET_DIR` is redirected, into this cache directory.
 *
 * @example
 * await cargoInstaller.install('/cache/cargo-9f2c', [serdeSpec], run);
 */
export const cargoInstaller: LibInstaller<CargoLibSpec> = {
	ecosystem: 'cargo',
	relocatable: true,
	missingTool: 'cargo not found — install Rust to run library-backed Rust exercises',

	// `Cargo.lock` proves resolution finished; `target` proves the pre-warm
	// build did. Without the second, a swept target reads warm and hands the
	// first solve the cold build this installer exists to avoid.
	warmPaths: () => ['Cargo.lock', CARGO_TARGET_SUBDIR],

	parseSpec: parseCargoSpec,

	async install(dir: string, specs: readonly CargoLibSpec[], run: RunArgv): Promise<void> {
		await fs.mkdir(path.join(dir, 'src'), { recursive: true });
		await fs.writeFile(path.join(dir, 'Cargo.toml'), renderCargoToml(WARM_PACKAGE, specs), 'utf-8');
		await fs.writeFile(path.join(dir, 'src', 'main.rs'), WARM_MAIN, 'utf-8');

		const env = { ...process.env, CARGO_TARGET_DIR: path.join(dir, CARGO_TARGET_SUBDIR) };
		await run('cargo', ['fetch'], dir, env);
		await run('cargo', ['build', '--offline', '--release'], dir, env);
	},
};
