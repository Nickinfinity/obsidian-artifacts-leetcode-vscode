import type { ParsedLeetCode, TestCase, TestTypeId } from '../../types/leetcode.types.js';

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
