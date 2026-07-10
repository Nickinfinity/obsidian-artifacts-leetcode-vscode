import type { TestTypeId } from '../../types/leetcode.types.js';
import type { TestEnv } from './env.types.js';
import { javaFunctionEnv } from './function/java.env.js';
import { javascriptFunctionEnv } from './function/javascript.env.js';
import { pythonFunctionEnv } from './function/python.env.js';

/** `"<type>::<language>"` → env. The absence of a key *is* the capability matrix. */
const registry = new Map<string, TestEnv>();

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
export function register(env: TestEnv): void {
	registry.set(keyFor(env.type, env.language), env);
}

/**
 * Look up the environment that can run `type` in `language`.
 *
 * @param type     - Execution strategy from the artifact's `test.type`.
 * @param language - Canonical `languageId`.
 * @returns The env, or `undefined` when the pair is unsupported.
 *
 * @example
 * testEnvFor('function', 'java');  // → javaFunctionEnv
 * testEnvFor('class', 'java');     // → undefined
 */
export function testEnvFor(type: TestTypeId, language: string): TestEnv | undefined {
	return registry.get(keyFor(type, language));
}

/**
 * Every language that can run `type`, sorted for a stable selector order.
 *
 * This drives the panel's language `<select>` directly — there is no second
 * capability table to keep in sync with the registry.
 *
 * @param type - Execution strategy from the artifact's `test.type`.
 * @returns Sorted canonical language ids; `[]` for a reserved type.
 *
 * @example
 * languagesForType('function'); // → ['java', 'javascript', 'python']
 * languagesForType('class');    // → []
 */
export function languagesForType(type: TestTypeId): string[] {
	const out: string[] = [];
	for (const env of registry.values()) {
		if (env.type === type) { out.push(env.language); }
	}
	return out.sort((a, b) => a.localeCompare(b));
}

// ── Built-in registrations ────────────────────────────────────────────────────
// Self-contained, zero-dependency envs. The extension has no install path, so it
// cannot assume a JUnit jar exists on the user's machine.

register(javascriptFunctionEnv);
register(pythonFunctionEnv);
register(javaFunctionEnv);
