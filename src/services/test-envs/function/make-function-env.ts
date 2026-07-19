import type { LangId } from '../../../types/languages.js';
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
			return spec.compile === undefined
				? { files, run: spec.run }
				: { files, compile: spec.compile, run: spec.run };
		},
		parse: parseSentinelLines,
	};
}
