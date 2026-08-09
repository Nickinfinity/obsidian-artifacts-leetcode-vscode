import * as path from 'node:path';
import { MAX_PROGRAM_SUITE_TIMEOUT_MS, PROGRAM_SPAWN_OVERHEAD_MS } from '../../../types/constants.js';
import type { LangId } from '../../../types/languages.js';
import type { FileSpec, ParsedLeetCode } from '../../../types/leetcode.types.js';
import { ecosystemFor } from '../../libs/lib-ecosystem.js';
import { libEnvVars } from '../../libs/lib-env.helpers.js';
import type { ProgramChannel, ProgramConfig } from '../../program-config.helpers.js';
import { resolveContained } from '../project/files.writer.js';
import type { EmittedFile } from '../env.types.js';
import { selectRunner, type RunnerCommand } from './runner-select.js';
import { PROGRAM_SPECS, type ProgramSpec } from './specs.js';

/**
 * `program` test type — factory for the five language envs (T2.5, VSX-166).
 *
 * **`ProgramEnv` is not a `TestEnv` and is not registered in `env.registry.ts`.**
 * `TestEnv.emit` returns a *string* `run` command and `TestEnv.parse` recovers
 * outcomes from `__LEET__` sentinel lines on stdout — `program` violates both:
 * argv/stdin differ per case (P5, so a suite cannot share one process the way
 * the `__LEET__` batch protocol assumes) and the graded value comes from
 * `$LEET_OUT` (`out-channel.ts`), never stdout. Implementing `TestEnv` here
 * would mean two lying stub members. **Consumed by T2.8 (wave 2.D); nothing
 * calls this yet** — this module is a pure, self-contained factory exactly
 * like T2.1/T2.2/T2.4 before it.
 *
 * `emit` produces the suite-*invariant* plan only: the candidate file, the
 * once-per-suite build (P1), the per-case run argv *template* (the runner
 * appends each case's own argv/stdin), the library env seam, and the
 * `channel`/`flags` facts the runner needs to serialise a case. The per-case
 * spawn loop itself is wave 2.D's module, not this one.
 */

/**
 * Context `emit` needs. Deliberately its own type rather than a reuse of
 * `TestEnv`'s `EnvContext` (`env.types.ts`): `EnvContext.parsed` has no
 * `program:` field yet — `program-config.helpers.ts` is "deliberately not
 * wired into `parseLeetCode`" as of T2.1 — so the parsed `ProgramConfig`
 * travels alongside `parsed` here rather than through it. `EnvContext.cases`
 * is dropped too: this factory never sees individual cases (P5 — that is the
 * wave-2.D runner's job), so carrying it here would be a field nothing reads.
 */
export interface ProgramEnvContext {
	/** Parsed artifact. Only `.files` (the `## Files` tree) is read here, for `fileCount`/`hasManifest` (P4). */
	parsed: ParsedLeetCode;
	/** Candidate source, already resolved by `buildExecutable` — written verbatim, no splicing. */
	code: string;
	/** Parsed `program:` config block (T2.1) — `channel`, optional `entry`, optional `flags`. */
	program: ProgramConfig;
	/** Resolved library cache directory, when this run declares `libs:` for this language. */
	libDir?: string;
}

/**
 * The suite-invariant plan `emit` hands to the wave-2.D runner.
 *
 * Extends `RunnerCommand` (T2.4) rather than re-declaring `build`/`run`: both
 * are argv arrays owned by `selectRunner`, never a joined shell string. `run`
 * is a *template* — the runner appends each case's own argv (or pipes stdin)
 * on top, per `channel`.
 */
export interface ProgramPlan extends RunnerCommand {
	/** File(s) to write into the run dir, once. The candidate is verbatim — no splicing, no generated driver. */
	files: EmittedFile[];
	/**
	 * Extra env vars for the build/run children, merged over `process.env` by
	 * the runner. The whole library-consumption seam — mirrors
	 * `EmittedProgram.env` in `make-function-env.ts`; never interpolated into
	 * `build`/`run`, both of which stay fixed argv arrays.
	 */
	env?: Record<string, string>;
	/** Directory to prepend to the child's `PATH` (mirrors `EmittedProgram.pathPrepend`; python only). */
	pathPrepend?: string;
	/** How the runner delivers each case's input — from `program:` config, passed straight through. */
	channel: ProgramChannel;
	/** Named flags, in declared order — consulted only for the `'flags'` channel; omitted when undeclared. */
	flags?: string[];
}

/** Author-shipped build manifests that switch `selectRunner`'s java/rust selection (P4). */
const MANIFEST_BASENAMES: ReadonlySet<string> = new Set(['pom.xml', 'Cargo.toml']);

/**
 * `hasManifest` decision input (P4): does the artifact's own `## Files` tree
 * ship a `pom.xml` or `Cargo.toml`? Read off `ctx.parsed.files`, never a
 * filesystem probe — `selectRunner` runs before anything is written.
 */
function hasManifestFile(files: FileSpec[] | undefined): boolean {
	return (files ?? []).some(f => MANIFEST_BASENAMES.has(path.basename(f.path)));
}

/**
 * Merge in the library-consumption seam when this run resolved one.
 *
 * Mirrors `withLibraries` in `make-function-env.ts`: only `env`/`pathPrepend`
 * change, never `build`/`run` — `selectRunner` already picked the
 * libs-aware argv shape (e.g. Rust's Cargo project) from `hasLibs` alone, so
 * there is no second `withLibs`-style shape override to apply here.
 */
function withLibrarySeam(language: LangId, libDir: string): { env?: Record<string, string>; pathPrepend?: string } {
	const ecosystem = ecosystemFor(language);
	// Every `LangId` has an ecosystem (`LANGUAGES[lang].ecosystem`); this branch
	// is unreachable but `ecosystemFor` takes an arbitrary string, so the guard
	// stays rather than an assertion this project refuses.
	if (ecosystem === undefined) { return {}; }
	const vars = libEnvVars(ecosystem, libDir);
	return vars.pathPrepend === undefined ? { env: vars.env } : { env: vars.env, pathPrepend: vars.pathPrepend };
}

/**
 * A `(program × language)` pair: emits the write-once plan a `program:`
 * candidate runs from. See the module doc for why this is its own interface,
 * not a `TestEnv`.
 */
export interface ProgramEnv {
	/** Canonical language this env targets. */
	readonly language: LangId;
	/**
	 * Emit this run's plan: the candidate file, optional build, the per-case
	 * run argv template, the library seam, and the case-delivery facts.
	 *
	 * @param ctx    - Candidate, `program:` config, and (optionally) a resolved library directory.
	 * @param runDir - Absolute run directory, minted by the caller (`mkdtemp`) — never derived from artifact text.
	 * @returns The suite-invariant plan; the caller writes `files`, runs `build` once, then `run` once per case.
	 * @throws Error when the resolved entry path escapes `runDir` (`resolveContained` — S8), including a
	 *   `program:` config built directly rather than through the parser's own shape guard.
	 *
	 * @example
	 * makeProgramEnv(PROGRAM_SPECS.python).emit(
	 *   { parsed: {} as ParsedLeetCode, code: 'print(1)', program: { channel: 'argv' } }, '/tmp/leet-run-1',
	 * );
	 * // → { files: [{ name: 'main.py', content: 'print(1)' }], run: ['python3', '/tmp/leet-run-1/main.py'], channel: 'argv' }
	 */
	emit(ctx: ProgramEnvContext, runDir: string): ProgramPlan;
}

/**
 * Assemble a `program` `ProgramEnv` from its per-language `spec`.
 *
 * @param spec - The per-language piece — currently only the default entry basename.
 * @returns A ready-to-use `ProgramEnv`. Not registered anywhere (see module doc).
 *
 * @example
 * makeProgramEnv(PROGRAM_SPECS.rust);
 */
export function makeProgramEnv(spec: ProgramSpec): ProgramEnv {
	return {
		language: spec.language,
		emit(ctx: ProgramEnvContext, runDir: string): ProgramPlan {
			const relEntry = ctx.program.entry ?? spec.defaultEntry;
			// The containment authority (S8) — belt under the parser's braces:
			// `parseProgramConfig` already shape-guards `entry` at parse time, but
			// this call is what actually resolves and asserts containment, and it
			// must run even when a `ProgramEnvContext` is built directly (as every
			// test here does) rather than through the parser.
			const entryPath = resolveContained(runDir, relEntry);

			const cmd = selectRunner({
				language: spec.language,
				entryPath,
				fileCount: ctx.parsed.files?.length ?? 0,
				hasLibs: ctx.libDir !== undefined,
				hasManifest: hasManifestFile(ctx.parsed.files),
			});
			const seam = ctx.libDir === undefined ? {} : withLibrarySeam(spec.language, ctx.libDir);

			return {
				files: [{ name: relEntry, content: ctx.code }],
				run: cmd.run,
				channel: ctx.program.channel,
				...(cmd.build === undefined ? {} : { build: cmd.build }),
				...(ctx.program.flags === undefined ? {} : { flags: ctx.program.flags }),
				...seam,
			};
		},
	};
}

/**
 * The five `program` envs, one per `LangId` — derived from `PROGRAM_SPECS`,
 * never hand-listed, the same discipline `projectEnvs = LANG_IDS.map(...)`
 * uses for the check-graded envs.
 */
export const PROGRAM_ENVS: readonly ProgramEnv[] = Object.values(PROGRAM_SPECS).map(makeProgramEnv);

/**
 * `program`'s own suite budget (P5) — `cases × (timeoutMs + PROGRAM_SPAWN_OVERHEAD_MS)`,
 * capped at `MAX_PROGRAM_SUITE_TIMEOUT_MS`. Mirrors `suiteTimeout` in
 * `leetcode-runner.service.ts:100` exactly, except for the two constants: a
 * `call` suite runs one process for the whole suite, so it pays no
 * per-process overhead and caps at the smaller `MAX_SUITE_TIMEOUT_MS`. A
 * `program` suite starts one process *per case* (argv/stdin differ per case —
 * P5), so charging `PROGRAM_SPAWN_OVERHEAD_MS` on top of every case and
 * capping at the higher `MAX_PROGRAM_SUITE_TIMEOUT_MS` is what keeps nine JVM
 * starts from being reported as `timeout` on an algorithm that was never slow.
 *
 * @param caseCount - Number of cases in the suite; floored at 1 (mirrors `suiteTimeout`).
 * @param perCaseMs - The artifact's `test.timeoutMs` (or its default).
 * @returns Milliseconds the whole suite may run for.
 *
 * @example
 * programSuiteTimeout(9, 5000);   // → 63000 — under the program cap, over the call cap
 * programSuiteTimeout(1000, 5000); // → 180000 (capped)
 */
export function programSuiteTimeout(caseCount: number, perCaseMs: number): number {
	return Math.min(Math.max(caseCount, 1) * (perCaseMs + PROGRAM_SPAWN_OVERHEAD_MS), MAX_PROGRAM_SUITE_TIMEOUT_MS);
}
