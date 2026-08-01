import type { LangId } from '../../../types/languages.js';
import { ecosystemFor } from '../../libs/lib-ecosystem.js';
import { libEnvVars } from '../../libs/lib-env.helpers.js';
import type { EmittedProgram, EnvContext, TestEnv } from '../env.types.js';
import { parseSentinelLines } from '../sentinel.helpers.js';

/**
 * The per-language pieces of a `function` env — everything that actually differs
 * between Java, Python, and JavaScript. Everything else (the `type: 'function'`
 * tag, the shared `parseSentinelLines` output parser, and the two-file
 * emit shape) is identical and lives in `makeFunctionEnv`.
 */
export interface FunctionEnvSpec {
	/** Canonical language this env targets. */
	language: LangId;
	/** Basename the candidate is written to verbatim-ish, e.g. `'sol.py'`. */
	candidateFile: string;
	/** Basename of the generated driver, e.g. `'runner.py'`. */
	runnerFile: string;
	/** Run command (cwd = temp dir), e.g. `'node runner.js'`. */
	run: string;
	/** Compile command for compiled languages; omitted for interpreted ones. */
	compile?: string;
	/**
	 * Content written to `candidateFile`. Interpreted languages pass the code
	 * through unchanged; Java hoists imports and wraps the method in a class.
	 */
	candidateContent(ctx: EnvContext): string;
	/** Build the generated driver source that links to the candidate. */
	buildRunner(ctx: EnvContext): string;
	/** Reject a candidate that breaks this env's contract, else `null`. */
	validate(ctx: EnvContext): string | null;
	/**
	 * Replace part of the emitted program when this run resolved libraries.
	 *
	 * Only Rust needs it: linking a crate means a Cargo project rather than a
	 * bare `rustc` invocation, which is a different file set and different
	 * commands. Every other language consumes its libraries through
	 * environment variables alone and leaves this unset — which is what keeps
	 * their no-libs and with-libs emits byte-identical apart from `env`.
	 *
	 * @param ctx    - The run context; `ctx.libDir` is set.
	 * @param libDir - The resolved cache directory, narrowed for convenience.
	 */
	withLibs?(ctx: EnvContext, libDir: string): Partial<EmittedProgram>;
}


/**
 * The emitted program, extended so the child can find this run's libraries.
 *
 * The consumption seam is environment variables (`libEnvVars`), so for four of
 * the five languages the commands and files are untouched and only `env` (and
 * `pathPrepend`, for python) is added. Rust additionally swaps its shape via
 * `spec.withLibs`, because linking a crate is a Cargo project rather than a
 * bare `rustc` call.
 *
 * @param spec   - The language's env spec.
 * @param ctx    - The run context.
 * @param libDir - Resolved cache directory for this run.
 * @param base   - The program as emitted without libraries.
 * @returns The program a library-backed run should execute.
 *
 * @example
 * withLibraries(pythonSpec, ctx, '/cache/pip-9f2c', base).pathPrepend;
 * // → '/cache/pip-9f2c/bin'
 */
function withLibraries(
	spec: FunctionEnvSpec, ctx: EnvContext, libDir: string, base: EmittedProgram,
): EmittedProgram {
	// Every `LangId` has an ecosystem, so the fallback is unreachable — it
	// exists because `ecosystemFor` takes an arbitrary key, and a cast to
	// silence that would be the kind of assertion this project refuses.
	const ecosystem = ecosystemFor(spec.language);
	const vars = ecosystem === undefined ? { env: {} } : libEnvVars(ecosystem, libDir);

	return {
		...base,
		...(spec.withLibs?.(ctx, libDir) ?? {}),
		env: vars.env,
		...(vars.pathPrepend === undefined ? {} : { pathPrepend: vars.pathPrepend }),
	};
}

/**
 * Assemble a `function` `TestEnv` from its per-language `spec`.
 *
 * Collapses the three built-in function envs (which were ~identical except for
 * their driver source and one validation rule) onto one contract: adding a
 * function-capable language is one `spec` rather than a fourth near-copy of the
 * `type`/`parse`/`emit` ceremony.
 *
 * @param spec - The per-language pieces of the env.
 * @returns A ready-to-register `TestEnv`.
 *
 * @example
 * makeFunctionEnv({ language: 'python', candidateFile: 'sol.py', … });
 */
export function makeFunctionEnv(spec: FunctionEnvSpec): TestEnv {
	return {
		type: 'function',
		language: spec.language,
		validate: spec.validate,
		emit(ctx: EnvContext): EmittedProgram {
			const files = [
				{ name: spec.candidateFile, content: spec.candidateContent(ctx) },
				{ name: spec.runnerFile, content: spec.buildRunner(ctx) },
			];
			const base: EmittedProgram = spec.compile === undefined
				? { files, run: spec.run }
				: { files, compile: spec.compile, run: spec.run };

			return ctx.libDir === undefined ? base : withLibraries(spec, ctx, ctx.libDir, base);
		},
		parse: parseSentinelLines,
	};
}
