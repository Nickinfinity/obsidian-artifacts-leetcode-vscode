import * as path from 'node:path';
import type { LangId } from '../../../types/languages.js';

/**
 * Decision inputs for `selectRunner` — everything the choice of toolchain
 * depends on, and nothing else. The function reads no filesystem and no
 * `process.env`; every fact it needs is a field here.
 */
export interface RunnerSelectionInput {
	/** Which runnable language the entry file is written in. */
	readonly language: LangId;
	/**
	 * Absolute path to the program's entry file, already containment-checked
	 * by the caller (S8 — see T2.1's `resolveContained`). Placed verbatim as
	 * an argv element; never re-derived, re-resolved, or walked for siblings.
	 */
	readonly entryPath: string;
	/**
	 * How many files the artifact's file tree declares.
	 *
	 * **Currently read by no selector, and that is deliberate** — see the
	 * `SELECTORS` block below for why a third file next to the entry earns no
	 * escalation that `javac`/`rustc` do not already handle. It stays on the
	 * input because P4 names it as one of the four decision inputs and a
	 * future language may genuinely need it; it is not dead weight left by
	 * accident. Do not read it without saying, there, what it buys.
	 */
	readonly fileCount: number;
	/** Whether the artifact declares `libs:` for this language. */
	readonly hasLibs: boolean;
	/** Whether the artifact ships its own build manifest (`pom.xml` / `Cargo.toml`) among its files. */
	readonly hasManifest: boolean;
}

/**
 * One selected runner: an optional build step and the run step, both argv
 * arrays — never a shell command string (this repo's standing rule: user
 * data reaches a subprocess as file contents or argv elements, never
 * command-string interpolation).
 */
export interface RunnerCommand {
	/** Build/compile argv, run once with the run's temp dir as `cwd`. Absent for an interpreted language. */
	readonly build?: readonly string[];
	/** Run argv, executed once per case (P1) with the temp dir as `cwd`. */
	readonly run: readonly string[];
}

/** Compiled-binary name for the light `rustc` path — a fixed literal invented here, not derived from `entryPath`. */
const RUST_LIGHT_BINARY = 'leet_program';

/** Where the light `javac`/`java` path's class lives once mvn's `dependency:copy-dependencies` has run. */
const JAVA_DEPS_SUBDIR = 'target/deps';

/**
 * `java` × `program` — bare `javac`/`java` unless the artifact ships its own
 * `pom.xml`.
 *
 * **Libraries do not, on their own, select Maven.** `libs:` is already
 * resolved *before* a runner is ever selected: `maven.installer.ts` runs
 * this exact `dependency:copy-dependencies` goal into the **shared cache**,
 * and `lib-env.helpers.ts` exposes the result as `CLASSPATH=<cache>/jars/*:.`.
 * Re-running that resolve inside the run directory would be a second
 * dependency authority for the same coordinates — a second cold Maven
 * resolve per exercise, the opposite of P4's lightest-thing-that-works, and
 * exactly the kind of drift this repo keeps paying for.
 *
 * Instead this mirrors `javaFunctionEnv.withLibs` exactly: when libraries
 * are present, **drop `-cp` entirely** so `CLASSPATH` governs. A
 * command-line `-cp` overrides the environment variable outright — `javac`
 * reads `CLASSPATH` with no `-cp` of its own, so the jars compile in, and
 * `java` would then fail to find them at run time if `-cp` were still on the
 * command line. The cache's `CLASSPATH` ends in a trailing `.`, which is
 * what resolves `className` from this run's own `cwd`; that only works when
 * the run directory *is* the `cwd`, exactly as every other env here assumes.
 * With no libraries there is no `CLASSPATH` to shadow, so `-cp <dir>` is
 * fine and needed (nothing else puts `entryPath`'s directory on the path).
 *
 * `hasManifest` is the only trigger for the manifest path: an
 * author-shipped `pom.xml` genuinely wants the build tool, the way `libs:`
 * does not, because it already has one.
 *
 * The class name is `entryPath`'s basename with the `.java` extension
 * stripped — never a filesystem read of the file's own `package` line.
 *
 * ponytail: a nested `src/main/java/<pkg>/…` layout resolves to the wrong,
 * unqualified main class either way (light or manifest path) — this reads
 * only the given path's basename, never its structure. Upgrade path: thread
 * the declared package through `EnvContext` instead of inferring one here,
 * which would be a second path authority (S8).
 *
 * The manifest build runs Maven's own `dependency:copy-dependencies` goal —
 * the same goal `mavenInstaller` uses, here into a fixed `target/deps` next
 * to the artifact's *own* `pom.xml` — so `run` is a plain, fast `java`
 * invocation that never re-invokes `mvn` (P1): the build pays for
 * dependency resolution once, the run step just loads a classpath.
 */
function selectJava(entryPath: string, hasLibs: boolean, hasManifest: boolean): RunnerCommand {
	const className = path.basename(entryPath, '.java');

	if (hasManifest) {
		return {
			build: [
				'mvn', '-q', '-DskipTests', `-DoutputDirectory=${JAVA_DEPS_SUBDIR}`, 'dependency:copy-dependencies', 'compile',
			],
			run: ['java', '-cp', `target/classes${path.delimiter}${JAVA_DEPS_SUBDIR}/*`, className],
		};
	}

	// `-d .` puts the `.class` at the run root rather than beside its source.
	// Without it a **nested** entry (`src/Main.java`) compiles into `src/`,
	// which the libs branch's classpath never contains: that branch drops
	// `-cp` so the cache's `CLASSPATH=<jars>/*:.` can govern, and its `.` is
	// the run root. The no-libs branch happened to survive nesting because its
	// `-cp` was `dirname(entryPath)` — one output location for both branches
	// is what makes the two agree instead of agreeing by accident.
	const build = ['javac', '-d', '.', entryPath];
	return hasLibs
		? { build, run: ['java', className] }
		: { build, run: ['java', '-cp', '.', className] };
}

/**
 * `rust` × `program` — bare `rustc` unless a library or a manifest is in
 * play.
 *
 * Mirrors `rustFunctionEnv`/`spec.withLibs` exactly: libraries switch
 * *shape*, not just environment, because `CARGO_TARGET_DIR` (set downstream,
 * never read here) points into the shared cache, so `./target/release/<bin>`
 * does not exist under this run's own `cwd` — only `cargo run` can find it.
 * Unlike Java, Rust has no environment-variable path to a library once it's
 * resolved (no `CLASSPATH` equivalent for crates), so `hasLibs` alone
 * already forces Cargo in the shipped `function` env, and this agrees with
 * it rather than inventing a second rule. An author-shipped `Cargo.toml`
 * gets the same treatment for the same reason `hasManifest` does for Java.
 *
 * ponytail: `cargo run` is invoked once per case (P1's "N runs"), each
 * paying a small fingerprint-check — not a rebuild, but not free either.
 * A direct binary path would be faster but needs the resolved
 * `CARGO_TARGET_DIR` and package name, both computed downstream from state
 * this pure function never sees; upgrade path if it measures hot.
 */
function selectRust(entryPath: string, hasLibs: boolean, hasManifest: boolean): RunnerCommand {
	if (hasLibs || hasManifest) {
		return {
			build: ['cargo', 'build', '--offline', '--release', '--quiet'],
			// The trailing `--` is load-bearing, not decoration: the runner
			// appends each case's argv (P5), and `cargo run` would otherwise
			// read those as **its own** options — `cargo run 5 7` is
			// *unexpected argument*, and an artifact-declared `--flag` would
			// reach cargo's parser instead of the candidate's. The light
			// `rustc` path needs none, since the binary is invoked directly.
			run: ['cargo', 'run', '--offline', '--release', '--quiet', '--'],
		};
	}
	return { build: ['rustc', '-O', entryPath, '-o', RUST_LIGHT_BINARY], run: [`./${RUST_LIGHT_BINARY}`] };
}

/**
 * Per-language selector, keyed the same exhaustive way `LANG_CODEGEN` is —
 * a missing entry is a compile error, not a silent `undefined` at the call
 * site.
 *
 * **`fileCount` never escalates java or rust on its own.** Both compilers
 * already auto-discover every unit the entry file references — `javac
 * <entry>` walks sibling `.java` files the same implicit-compilation way
 * `javac Solution.java Runner.java` compiles two units today, and `rustc
 * <entry>` follows `mod` declarations to their sibling files — and this
 * function is only ever handed the one entry path, never a file list, so a
 * build tool would have nothing more to compile from than the compiler
 * already reaches on its own. A `pom.xml`/`Cargo.toml` earns the switch
 * because it configures something the compiler cannot (dependency
 * resolution, packaging); a third file next to the entry configures nothing
 * the compiler doesn't already discover for itself. `fileCount` stays a
 * field on `RunnerSelectionInput` for the shape P4 names, but no selector
 * reads it.
 *
 * python/javascript/typescript each have exactly one sensible answer: no
 * compile step, and no manifest-driven build tool exists in their `program`
 * shape at all — a library reaches the child process through an environment
 * variable set downstream (`NODE_PATH` / `VIRTUAL_ENV`), never through
 * anything this module returns. TypeScript never invokes `tsc` — the same
 * house rule the `function` env already follows — so it runs identically to
 * JavaScript.
 */
const SELECTORS: Record<LangId, (entryPath: string, fileCount: number, hasLibs: boolean, hasManifest: boolean) => RunnerCommand> = {
	java: (entryPath, _fileCount, hasLibs, hasManifest) => selectJava(entryPath, hasLibs, hasManifest),
	rust: (entryPath, _fileCount, hasLibs, hasManifest) => selectRust(entryPath, hasLibs, hasManifest),
	python: entryPath => ({ run: ['python3', entryPath] }),
	javascript: entryPath => ({ run: ['node', entryPath] }),
	typescript: entryPath => ({ run: ['node', entryPath] }),
};

/**
 * Select the argv commands that build (optionally) and run a `program`
 * candidate.
 *
 * Pure and synchronous: no subprocess, no filesystem, no `process.env`. That
 * is what makes P4 ("the runner is chosen by what the exercise needs, never
 * from the label") testable with plain golden argv-array assertions, and it
 * is why library/manifest **consumption** — `CLASSPATH`, `NODE_PATH`,
 * `CARGO_TARGET_DIR`, a `PATH` prefix — is deliberately not this function's
 * job; that seam is `EmittedProgram.env` / `.pathPrepend`, owned by whatever
 * calls this (see `env.types.ts`).
 *
 * @param input - Language, entry path, and the three P4 decision flags.
 * @returns The build (if any) and run argv arrays.
 *
 * @example
 * selectRunner({ language: 'java', entryPath: '/tmp/x/Main.java', fileCount: 1, hasLibs: false, hasManifest: false });
 * // → { build: ['javac', '-d', '.', '/tmp/x/Main.java'], run: ['java', '-cp', '.', 'Main'] }
 */
export function selectRunner(input: RunnerSelectionInput): RunnerCommand {
	const { language, entryPath, fileCount, hasLibs, hasManifest } = input;
	return SELECTORS[language](entryPath, fileCount, hasLibs, hasManifest);
}
