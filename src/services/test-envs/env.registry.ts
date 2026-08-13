import type { TestTypeId } from '../../types/leetcode.types.js';
import type { LeetcodeTypeId } from '../../types/leetcode-type.js';
import type { TestEnv } from './env.types.js';
import { PROGRAM_ENVS, type ProgramEnv } from './program/make-program-env.js';
import { javaFunctionEnv } from './function/java.env.js';
import { javascriptFunctionEnv } from './function/javascript.env.js';
import { pythonFunctionEnv } from './function/python.env.js';
import { rustFunctionEnv } from './function/rust.env.js';
import { typescriptFunctionEnv } from './function/typescript.env.js';
import { projectEnvs } from './project/project.env.js';

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
 * Look up the environment that can run `type` in `language`.
 *
 * @param type         - Execution strategy from the artifact's `test.type`.
 * @param language     - Canonical `languageId`.
 * @param leetcodeType - Optional artifact shape; when given, the env must
 *   declare it in `leetcodeTypes` or the pair resolves to `undefined`.
 * @returns The env, or `undefined` when the triple is unsupported.
 *
 * @example
 * testEnvFor('function', 'java');             // → javaFunctionEnv
 * testEnvFor('function', 'java', 'function'); // → javaFunctionEnv
 * testEnvFor('function', 'java', 'stack');    // → undefined — wrong shape
 * testEnvFor('class', 'java');                // → undefined
 */
export function testEnvFor(
	type: TestTypeId, language: string, leetcodeType?: LeetcodeTypeId,
): RegisteredEnv | undefined {
	const env = registry.get(keyFor(type, language));
	if (!env) { return undefined; }
	return servesShape(env, leetcodeType) ? env : undefined;
}

/**
 * Does `env` serve `leetcodeType`, treating an absent argument as "any"?
 *
 * The compatibility path from the old two-argument signature: seven call sites
 * span three phases, so the parameter is **appended and optional** rather than
 * prepended and required. A required parameter here is a red gate clearable
 * only by editing four other tasks' files — T3.5 is the last call site to pass
 * it, and deletes this leniency with the same change.
 *
 * @param env          - A registered environment.
 * @param leetcodeType - The artifact shape, or `undefined` for the legacy path.
 * @returns True when the env serves that shape, or when no shape was asked for.
 *
 * @example
 * servesShape(javaFunctionEnv, 'function'); // → true
 * servesShape(javaFunctionEnv, 'stack');    // → false
 * servesShape(javaFunctionEnv, undefined);  // → true
 */
function servesShape(env: RegisteredEnv, leetcodeType?: LeetcodeTypeId): boolean {
	return leetcodeType === undefined || env.leetcodeTypes.includes(leetcodeType);
}

/**
 * Every language that can run `type`, sorted for a stable selector order.
 *
 * This drives the panel's language `<select>` directly — there is no second
 * capability table to keep in sync with the registry.
 *
 * @param type         - Execution strategy from the artifact's `test.type`.
 * @param leetcodeType - Optional artifact shape; when given, only envs
 *   declaring it contribute a language.
 * @returns Sorted canonical language ids; `[]` for a reserved type, and `[]`
 *   when no env serves that shape.
 *
 * @example
 * languagesForType('function');           // → ['java', 'javascript', 'python', 'rust', 'typescript']
 * languagesForType('function', 'package'); // → [] — function envs serve one buffer
 * languagesForType('class');              // → []
 */
export function languagesForType(type: TestTypeId, leetcodeType?: LeetcodeTypeId): string[] {
	const out: string[] = [];
	for (const env of registry.values()) {
		if (env.type === type && servesShape(env, leetcodeType)) { out.push(env.language); }
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

// `project` grades by declared checks, not one return value; it registers under
// the runnable ids only — `javascriptreact`/`typescriptreact` have no runtime.
projectEnvs.forEach(register);

// `program` starts one process per case rather than one per suite, so it is a
// `ProgramEnv` rather than a `TestEnv` — see `RegisteredEnv`. It registers here
// all the same, because this table is the capability matrix and a `package` +
// `program` artifact is gradeable as of wave 2.D.
PROGRAM_ENVS.forEach(register);
