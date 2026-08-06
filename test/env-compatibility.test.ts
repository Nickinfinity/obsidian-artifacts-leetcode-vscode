import * as assert from 'node:assert';
import { refusalFor } from '../src/services/test-envs/compatibility.helpers.js';

/**
 * Unit tests for `refusalFor` — the one function that answers "is this
 * `(leetcodeType × testType × language)` triple implemented?" for the panel,
 * the run handlers and the verifier (VSX-153 / T1.6).
 *
 * It is a thin, deliberately dumb wrapper over `testEnvFor`: the registry is
 * still the single capability matrix (env.registry.ts), so these tests pin
 * the *message*, not a second copy of the matrix.
 */
suite('env compatibility', () => {

	test('an unimplemented triple names the leetcode type, the test type and the language', () => {
		// `call` has no registered environment yet (function envs still answer
		// to the legacy `function` id) and `stack` serves no function env
		// regardless — either reason alone would refuse this triple.
		const refusal = refusalFor('stack', 'call', 'python');
		assert.ok(refusal, 'expected a refusal sentence, got null');
		assert.ok(refusal.includes('stack'), refusal);
		assert.ok(refusal.includes('call'), refusal);
		assert.ok(refusal.includes('python'), refusal);
	});

	test('an implemented triple is not refused', () => {
		assert.strictEqual(refusalFor('function', 'function', 'python'), null);
	});

	test('a registered test type serving the wrong leetcode type is still refused, by name', () => {
		// javaFunctionEnv answers `function`/`java`, but only serves the
		// `function` leetcode type — a `stack` asking for it must still refuse.
		const refusal = refusalFor('stack', 'function', 'java');
		assert.ok(refusal);
		assert.ok(refusal.includes('stack'));
		assert.ok(refusal.includes('function'));
		assert.ok(refusal.includes('java'));
	});

	test('the project env implements package and stack, never the function shape', () => {
		assert.strictEqual(refusalFor('package', 'project', 'python'), null);
		assert.strictEqual(refusalFor('stack', 'project', 'python'), null);
		assert.ok(refusalFor('function', 'project', 'python'));
	});

	test('an unregistered or hostile language string never throws, and is refused', () => {
		for (const language of ['__proto__', 'constructor', '', 'kotlin']) {
			const refusal = refusalFor('function', 'function', language);
			assert.ok(refusal, `expected a refusal for language ${JSON.stringify(language)}`);
		}
	});
});
