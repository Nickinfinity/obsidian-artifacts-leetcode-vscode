import { LANG_IDS } from '../../../types/languages.js';
import type { EnvContext, EmittedProgram, TestEnv } from '../env.types.js';
import { parseSentinelLines } from '../sentinel.helpers.js';

/**
 * Message every candidate is refused with until the render driver (TB.5) and
 * the check kinds (TB.6/TB.7) land.
 *
 * `runSuite` turns a non-null `validate` into one result per case carrying this
 * text, so an artifact opened mid-build explains itself instead of running an
 * empty program and reporting a silent pass.
 */
/**
 * Why a `project` candidate can never arrive through the suite runner.
 *
 * A `project` is graded by `gradeProjectDir` against a **directory**, not by
 * running one candidate buffer, so reaching this env's `emit` means something
 * called the wrong door. It replaces an older message claiming projects were
 * "not runnable yet", which stopped being true when the render driver and the
 * check kinds landed.
 */
const NOT_A_BUFFER =
	'a project exercise is graded as a file tree, not as a single solution buffer';

/**
 * The `project` environment for one language.
 *
 * A `project` exercise is graded by its declared **checks** against a whole
 * directory (`gradeProjectDir`), never by running one candidate buffer — so
 * this entry exists to answer the capability matrix, not to execute anything.
 * `testEnvFor('project', …)` and `languagesForType('project')` give the real
 * answer, and `validate` explains the mismatch if anything routes a buffer here.
 *
 * It registers under the **runnable** ids only, never `javascriptreact` /
 * `typescriptreact` — those are display ids with no runtime. A `.jsx` / `.tsx`
 * file maps onto its runnable pair at bundle time.
 *
 * @param language - Canonical runnable `languageId`.
 * @returns A `TestEnv` for the `(project × language)` slot.
 *
 * @example
 * projectEnvFor('javascript').type; // → 'project'
 */
export function projectEnvFor(language: string): TestEnv {
	return {
		type: 'project',
		language,
		validate: (_ctx: EnvContext): string | null => NOT_A_BUFFER,
		// ponytail: trivial program — unreachable while `validate` refuses every
		// candidate, and replaced wholesale by the real emit in TB.3–TB.7.
		emit: (_ctx: EnvContext): EmittedProgram => ({ files: [], run: 'node --version' }),
		parse: parseSentinelLines,
	};
}

/**
 * The registered `project` environments — one per runnable language.
 *
 * Derived from `LANG_IDS` rather than listed here: a `project` is graded by
 * `build` and `function` checks that any language can declare, and the
 * *render* kinds carry their own refusal for a file nothing can bundle. A
 * second hand-kept language list is exactly the drift `LANGUAGES` exists to
 * prevent.
 */
export const projectEnvs: TestEnv[] = LANG_IDS.map(projectEnvFor);
