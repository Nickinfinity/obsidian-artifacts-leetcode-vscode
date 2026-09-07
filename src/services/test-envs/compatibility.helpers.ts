import type { TestTypeId } from '../../types/leetcode.types.js';
import type { LeetcodeTypeId } from '../../types/leetcode-type.js';
import { testEnvFor } from './env.registry.js';

/**
 * Answers "is this `(leetcodeType × testType × language)` triple implemented?"
 * — the "SEC" half of VSX-153 (T1.6).
 *
 * **Its one production caller is the preview panel** (`renderLanguageRow`,
 * which turns this into the hint shown when no language can be offered). This
 * docblock claimed three — the panel, the run handlers and `grade-candidate` —
 * while **nothing at all** called it, and the claim outlived two attempts to
 * wire it. Both attempts failed for the same reason, which is worth stating
 * here so a third does not start: on the directory-grading path this function
 * refuses **nothing**, because `projectEnvFor` declares
 * `leetcodeTypes: ['package', 'stack']` and that path is reached only once
 * `isMultiFile` is already true. The run handlers' real authority is the
 * artifact's own dropped kinds (`projectGradeRefusal`), and the per-file
 * question is answered directly by `testEnvFor` at `project.runner.ts`.
 * **Keep this list honest** — a documented consumer that does not exist is
 * how both inert guards were born.
 *
 * It is a thin wrapper over `testEnvFor`, deliberately: the registry
 * (`env.registry.ts`) is already the single capability matrix — "the absence
 * of a registration is still the matrix" — so this function must never
 * maintain a second copy of it. Its only job is turning that `undefined` into
 * a sentence a solver can act on, naming all three axes rather than a bare
 * "unsupported".
 *
 * **Produced before any file is written.** Every caller must check this before
 * `emit`/`writeProjectFiles` runs, not after — a refusal that fires mid-grade
 * has already spent the work it was meant to skip.
 *
 * **An artifact is ungradeable as a whole, never per-surviving-check.** A
 * `package`/`stack` artifact's `checks:` may declare several kinds; when this
 * returns a refusal for *any one* of them, the caller must refuse the whole
 * artifact rather than grading the checks that did resolve. Grading only the
 * survivors is the false-green vector (S3) this function exists to close: an
 * artifact with one `build` check that passes and one `http` check silently
 * dropped at parse time must never report "solved" on the strength of the
 * `build` check alone.
 *
 * `verifyExercise` does **not** call this — it keeps today's `reserved`
 * semantics (well-formed vs. executable are different questions). What this
 * function governs is what a solver is **offered**: the panel will not put a
 * language in front of someone when no environment could run it.
 *
 * @param leetcodeType - The artifact's shape (`function` / `package` / `stack`).
 * @param testType     - The execution strategy — a single suite's `test.type`
 *   or one check's `kind:`. Both spellings share this vocabulary.
 * @param language     - Canonical `languageId` the solver selected.
 * @returns `null` when an environment serves this triple; otherwise a
 *   user-facing sentence naming all three.
 *
 * @example
 * refusalFor('function', 'function', 'java'); // → null — javaFunctionEnv serves it
 * refusalFor('stack', 'call', 'python');
 * // → "stack artifacts cannot run 'call' in python — no environment is registered for that combination."
 */
export function refusalFor(
	leetcodeType: LeetcodeTypeId, testType: TestTypeId, language: string,
): string | null {
	if (testEnvFor(testType, language, leetcodeType)) { return null; }
	return `${leetcodeType} artifacts cannot run '${testType}' in ${language} — `
		+ 'no environment is registered for that combination.';
}
