import type { LangId } from '../../../types/languages.js';

/**
 * Per-language piece `makeProgramEnv` needs beyond what `selectRunner` (T2.4,
 * `runner-select.ts`) already decides on its own: only the basename a
 * `program:` block falls back to when it declares no `entry:`
 * (`ARTIFACT_LEETCODE_FILE_FORMAT.md` §2.5.1).
 *
 * One field, deliberately — unlike `FunctionEnvSpec` (`make-function-env.ts`),
 * there is no `candidateContent`/`buildRunner` here: a `program` candidate
 * *is* the whole program, written verbatim, with no generated driver to link
 * against it and no per-language wrapping to author. Compile/run argv and the
 * library shape swap are both derived by `selectRunner`, not per-language
 * state duplicated here.
 */
export interface ProgramSpec {
	/** Canonical language this env targets. */
	readonly language: LangId;
	/** Basename `emit` writes the candidate to when `program:` declares no `entry:`. */
	readonly defaultEntry: string;
}

/**
 * The five `program` specs, one per runnable language — exhaustive over
 * `LangId` and compiler-checked via `satisfies`, the same discipline
 * `LANG_CODEGEN` uses so a sixth `LangId` cannot silently ship without one.
 *
 * The mapped type pins each entry's `language` to **its own key**, which a
 * plain `Record<LangId, ProgramSpec>` does not: that form accepts
 * `java: { language: 'python', … }`, and no test catches the swap, because
 * `PROGRAM_ENVS` is built by iterating the values and still yields five envs
 * with five distinct languages. The lookup and the payload would simply
 * disagree — a java artifact resolving a spec that writes `main.py`.
 */
export const PROGRAM_SPECS = {
	java: { language: 'java', defaultEntry: 'Main.java' },
	python: { language: 'python', defaultEntry: 'main.py' },
	javascript: { language: 'javascript', defaultEntry: 'main.js' },
	rust: { language: 'rust', defaultEntry: 'main.rs' },
	typescript: { language: 'typescript', defaultEntry: 'main.ts' },
} satisfies { [K in LangId]: ProgramSpec & { language: K } };
