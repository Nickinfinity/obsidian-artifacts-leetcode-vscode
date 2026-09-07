import type { TestTypeId } from '../../types/leetcode.types.js';
import type { LeetcodeTypeId } from '../../types/leetcode-type.js';
import type { TestEnv } from './env.types.js';
import { PROGRAM_ENVS, type ProgramEnv } from './program/make-program-env.js';
import { javaFunctionEnv } from './function/java.env.js';
import { javascriptFunctionEnv } from './function/javascript.env.js';
import { pythonFunctionEnv } from './function/python.env.js';
import { rustFunctionEnv } from './function/rust.env.js';
import { typescriptFunctionEnv } from './function/typescript.env.js';

/**
 * Anything the registry can hold.
 *
 * Two execution contracts, one matrix. A `TestEnv` runs a whole suite in one
 * process and recovers outcomes from `__LEET__` sentinel lines; a `ProgramEnv`
 * starts **one process per case** and reads each answer back from `$LEET_OUT`
 * (P5, D6). Neither can implement the other's interface without a lying stub,
 * but both answer the same registry question — *can this
 * `(leetcodeType × testType × language)` triple be graded?* — and that question
 * is what the panel's selector, `refusalFor` and the coverage sweep all read.
 * Leaving `program` out would have made the matrix report an implemented cell
 * as missing.
 *
 * Discriminate with {@link isBatchEnv} before handing one to `runSuite`.
 */
export type RegisteredEnv = TestEnv | ProgramEnv;

/**
 * Does this env run its whole suite in one process (`runSuite`'s contract)?
 *
 * @param env - Any registered environment.
 * @returns True for a `TestEnv`; false for a `ProgramEnv`, which needs
 *   `runProgramSuite` and a run directory instead.
 *
 * @example
 * isBatchEnv(javaFunctionEnv); // → true
 */
export function isBatchEnv(env: RegisteredEnv): env is TestEnv {
	return env.type !== 'program';
}

/** `"<type>::<language>"` → env. The absence of a key *is* the capability matrix. */
const registry = new Map<string, RegisteredEnv>();

/** Compose the registry key for a `(type × language)` pair. */
function keyFor(type: TestTypeId, language: string): string {
	return `${type}::${language}`;
}

/**
 * Register a test environment, replacing any env already holding its
 * `(type × language)` slot.
 *
 * Exported so a future library-backed env (JUnit, kotest) can be contributed
 * without editing this file's imports.
 *
 * @param env - The environment to register.
 *
 * @example
 * register(javaFunctionEnv);
 */
export function register(env: RegisteredEnv): void {
	registry.set(keyFor(env.type, env.language), env);
}

/**
 * Look up the environment that can run `type` in `language` for an artifact of
 * shape `leetcodeType`.
 *
 * **All three axes are required (C1/C6).** The parameter was appended and
 * optional through Phases 1 and 2 because seven call sites spanned three
 * phases and a required parameter would have reddened four other tasks' files
 * at once; T3.5 is the last of those call sites, so the leniency — and the
 * `servesShape` "absent means any" branch it needed — is deleted here. An
 * optional shape is not a smaller version of this question: answering it as
 * "any" is what let a `stack` resolve a single-buffer env.
 *
 * @param type         - Execution strategy from the artifact's `test.type`.
 * @param language     - Canonical `languageId`.
 * @param leetcodeType - The artifact's shape; the env must declare it in
 *   `leetcodeTypes` or the triple resolves to `undefined`.
 * @returns The env, or `undefined` when the triple is unsupported.
 *
 * @example
 * testEnvFor('call', 'java', 'function');  // → javaFunctionEnv
 * testEnvFor('call', 'java', 'stack');     // → undefined — wrong shape
 * testEnvFor('class', 'java', 'function'); // → undefined
 */
export function testEnvFor(
	type: TestTypeId, language: string, leetcodeType: LeetcodeTypeId,
): RegisteredEnv | undefined {
	const env = registry.get(keyFor(type, language));
	if (!env) { return undefined; }
	return env.leetcodeTypes.includes(leetcodeType) ? env : undefined;
}

/**
 * Every language that can run `type` for `leetcodeType`, sorted for a stable
 * selector order.
 *
 * This drives the panel's language `<select>` directly — there is no second
 * capability table to keep in sync with the registry.
 *
 * **A check `kind:` is not answered here.** `build`, `dom-assert`,
 * `css-assert` and `http` have no registration at all: they are dispatched per
 * check by `runOneCheck` against an already-written directory, so this returns
 * `[]` for them and the coverage sweep asks its second authority instead. The
 * registry answers only *which language can run this artifact's own suite*.
 *
 * @param type         - Execution strategy from the artifact's `test.type`.
 * @param leetcodeType - The artifact's shape; only envs declaring it contribute.
 * @returns Sorted canonical language ids; `[]` for a reserved type, for a
 *   check kind, and when no env serves that shape.
 *
 * @example
 * languagesForType('call', 'function');  // → ['java', 'javascript', 'python', 'rust', 'typescript']
 * languagesForType('call', 'package');   // → [] — function envs serve one buffer
 * languagesForType('build', 'package');  // → [] — dispatched per check, never registered
 */
export function languagesForType(type: TestTypeId, leetcodeType: LeetcodeTypeId): string[] {
	const out: string[] = [];
	for (const env of registry.values()) {
		if (env.type === type && env.leetcodeTypes.includes(leetcodeType)) { out.push(env.language); }
	}
	return out.sort((a, b) => a.localeCompare(b));
}

// ── Built-in registrations ────────────────────────────────────────────────────
// Self-contained, zero-dependency envs. The extension has no install path, so it
// cannot assume a JUnit jar exists on the user's machine.

register(javascriptFunctionEnv);
register(pythonFunctionEnv);
register(javaFunctionEnv);
register(rustFunctionEnv);
register(typescriptFunctionEnv);

// A tree registers **nothing**, and that is the T3.5 correction: `project` was
// a key in this table only because one value used to answer both axes. It is
// not a `TestTypeId` any more, and the five stub envs behind it refused every
// candidate they were handed — a capability-matrix entry claiming a tree could
// be graded *through the suite runner*, which it never can. A tree is graded by
// `gradeProjectDir` dispatching its checks, and the coverage sweep reads that
// second authority directly. What remains registered here is exactly what the
// registry can truthfully answer: `call` for a buffer, `program` for a tree
// whose whole suite is one program.

// `program` starts one process per case rather than one per suite, so it is a
// `ProgramEnv` rather than a `TestEnv` — see `RegisteredEnv`. It registers here
// all the same, because this table is the capability matrix and a `package` +
// `program` artifact is gradeable as of wave 2.D.
PROGRAM_ENVS.forEach(register);
