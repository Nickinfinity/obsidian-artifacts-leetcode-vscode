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
const NOT_YET_RUNNABLE =
	'project exercises are not runnable yet — the render driver and check kinds are still being built';

/**
 * The `project` environment for one language.
 *
 * A `project` exercise is graded by its declared **checks**, not by one
 * function's return value, so this env's eventual `emit` materialises a file
 * tree, installs the artifact's `libs`, bundles any component, and runs each
 * check — all of it still to come (TB.3–TB.7). Today it is a registered
 * skeleton: the registry entry exists so `testEnvFor('project', …)` and
 * `languagesForType('project')` return the real answer, and `validate` refuses
 * every candidate with one readable sentence.
 *
 * It registers under the **runnable** ids `javascript` / `typescript`, never
 * `javascriptreact` / `typescriptreact` — those are display ids with no
 * runtime. A `.jsx` / `.tsx` file maps onto them at bundle time.
 *
 * @param language - Canonical runnable `languageId` (`javascript` | `typescript`).
 * @returns A `TestEnv` for the `(project × language)` slot.
 *
 * @example
 * projectEnvFor('javascript').type; // → 'project'
 */
export function projectEnvFor(language: string): TestEnv {
	return {
		type: 'project',
		language,
		validate: (_ctx: EnvContext): string | null => NOT_YET_RUNNABLE,
		// ponytail: trivial program — unreachable while `validate` refuses every
		// candidate, and replaced wholesale by the real emit in TB.3–TB.7.
		emit: (_ctx: EnvContext): EmittedProgram => ({ files: [], run: 'node --version' }),
		parse: parseSentinelLines,
	};
}

/** The registered `project` environments — one per runnable language. */
export const projectEnvs: TestEnv[] = ['javascript', 'typescript'].map(projectEnvFor);
