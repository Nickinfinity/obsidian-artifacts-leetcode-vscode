import type { ParsedLeetCode, TestCase, TestTypeId } from '../../types/leetcode.types.js';
import type { LeetcodeTypeId } from '../../types/leetcode-type.js';

/**
 * One test case's outcome, as reported by the generated program over stdout.
 *
 * Exactly one of `actual` / `error` is set. `actual` is already canonical JSON
 * (see `canonicalJson`) — the env is responsible for emitting it that way from
 * inside the target language, so the extension never has to re-parse a
 * language-specific value representation.
 */
export interface CaseOutcome {
	/** Zero-based index into the suite that was emitted */
	index: number;
	/** Canonical JSON of the function's return value */
	actual?: string;
	/** Message of whatever the solver's code threw / raised */
	error?: string;
	/** Wall-clock time for this case, in milliseconds, as measured in-process */
	ms: number;
}

/**
 * Everything a test environment needs to emit one runnable program.
 *
 * The whole suite runs in a single process — compiled languages pay their
 * compile cost once, not once per case.
 */
export interface EnvContext {
	/** Parsed artifact — function name, params, returns, `test` config */
	parsed: ParsedLeetCode;
	/** Canonical `languageId` the run was started in */
	langId: string;
	/** Candidate source, already resolved by `buildExecutable` */
	code: string;
	/** Every case in the suite, in order */
	cases: TestCase[];
	/**
	 * Resolved library cache directory, when this run declares `libs:` for its
	 * own language. Absent otherwise — and an env that sees no `libDir` must
	 * emit exactly what it emitted before libraries existed.
	 */
	libDir?: string;
}

/** One file to write into the run's temp directory, addressed by basename. */
export interface EmittedFile {
	/** Basename inside the temp dir, e.g. `'Solution.java'` */
	name: string;
	/** Full file contents */
	content: string;
}

/**
 * A ready-to-run program: the files to write plus the commands to build and run
 * them.
 *
 * The candidate is written **verbatim** as one of these files — never spliced
 * into a generated harness. A separate generated driver file links to it (Java:
 * a second compilation unit; Python: `import`; JavaScript: a `vm` sandbox), so
 * the solver's own imports, helper functions, and file structure survive
 * untouched. Commands run with the temp directory as `cwd`, so they reference
 * files by bare name.
 */
export interface EmittedProgram {
	/** Files to write into the temp dir. The candidate file is verbatim. */
	files: EmittedFile[];
	/** Build command (run first, cwd = temp dir). Omitted for interpreted languages. */
	compile?: string;
	/** Run command (cwd = temp dir). Its stdout is fed to `parse`. */
	run: string;
	/**
	 * Extra environment variables for the compile and run children, merged over
	 * `process.env` by the runner.
	 *
	 * This is the **whole** library-consumption seam: a cache path reaches a
	 * child as an environment value, never interpolated into `compile` or `run`,
	 * both of which stay fixed literals no shell can be tricked by.
	 */
	env?: Record<string, string>;
	/**
	 * A directory to prepend to the child's `PATH`.
	 *
	 * Separate from `env` because prepending needs the *inherited* `PATH`, and
	 * `emit` must stay pure — an env that reads `process.env` makes its own
	 * golden assertions depend on the machine that ran them. The runner owns
	 * the join.
	 */
	pathPrepend?: string;
}

/**
 * A `(test type × language)` pair that knows how to run a suite.
 *
 * The absence of a pair in the registry *is* the capability matrix: a language
 * with no env for the artifact's test type never appears in the panel's
 * language selector.
 *
 * The three built-in `function` envs are self-contained — the extension ships
 * zero runtime dependencies and has no install path, so it cannot assume a
 * JUnit jar exists. `requires` / `detect()` exist so a future library-backed env
 * (JUnit, kotest) can declare and preflight its dependency without the runner
 * learning anything new.
 */
export interface TestEnv {
	/** Test type this env implements */
	type: TestTypeId;
	/** Canonical `languageId` this env targets */
	language: string;
	/**
	 * Which artifact shapes this env can grade.
	 *
	 * The second axis, kept off the registry key deliberately. Keying
	 * `(leetcodeType × testType × language)` would be 3 × 8 × 5 = 120 slots
	 * almost all empty, plus a second list to drift out of sync with the
	 * first — so the leetcode type is a **filter on this declaration** and the
	 * absence of a registration is still the capability matrix.
	 *
	 * A `function` env serves `['function']`; a check-graded env serves
	 * `['package', 'stack']`. Nothing serves both — that is the whole point of
	 * splitting the axes.
	 */
	leetcodeTypes: readonly LeetcodeTypeId[];
	/** External dependencies, e.g. `['junit5']`. Omitted for self-contained envs */
	requires?: string[];
	/** Preflight probe — only consulted when `requires` is set */
	detect?(): Promise<boolean>;
	/**
	 * Check the candidate meets this env's contract before any file is written.
	 *
	 * Returns a plain, user-facing message when the contract is broken (e.g. a
	 * Java method wrapped in the solver's own `class`), or `null` when the
	 * candidate is runnable. Catching it here turns a raw compiler dump into an
	 * actionable sentence.
	 */
	validate?(ctx: EnvContext): string | null;
	/** Emit the candidate (verbatim) plus a generated driver, with build/run commands. */
	emit(ctx: EnvContext): EmittedProgram;
	/** Recover per-case outcomes from the program's stdout */
	parse(stdout: string): CaseOutcome[];
}
