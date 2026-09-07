import * as assert from 'node:assert';
import { refusalFor } from '../src/services/test-envs/compatibility.helpers.js';
import { testEnvFor } from '../src/services/test-envs/env.registry.js';

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
		// The five `call` envs serve one buffer, so a `stack` asking for one is
		// refused on the shape, not on the id.
		const refusal = refusalFor('stack', 'call', 'python');
		assert.ok(refusal, 'expected a refusal sentence, got null');
		assert.ok(refusal.includes('stack'), refusal);
		assert.ok(refusal.includes('call'), refusal);
		assert.ok(refusal.includes('python'), refusal);
	});

	test('an implemented triple is not refused', () => {
		assert.strictEqual(refusalFor('function', 'call', 'python'), null);
	});

	test('a registered test type serving the wrong leetcode type is still refused, by name', () => {
		// javaFunctionEnv answers `call`/`java`, but only serves the
		// `function` leetcode type — a `stack` asking for it must still refuse.
		const refusal = refusalFor('stack', 'call', 'java');
		assert.ok(refusal);
		assert.ok(refusal.includes('stack'));
		assert.ok(refusal.includes('call'));
		assert.ok(refusal.includes('java'));
	});

	test('a tree is refused for every suite type but `program` — checks are not registered', () => {
		// T3.5 deleted the five `project` stub envs: the registry answers
		// *which language can run this artifact's own suite*, and a tree graded
		// by checks declares no such suite. `program` is the one suite a tree
		// can declare, and it stays implemented for `package`.
		assert.strictEqual(refusalFor('package', 'program', 'python'), null);
		for (const kind of ['build', 'dom-assert', 'css-assert', 'http'] as const) {
			assert.ok(refusalFor('package', kind, 'python'), kind);
			assert.ok(refusalFor('stack', kind, 'python'), kind);
		}
	});

	test('an unregistered or hostile language string never throws', () => {
		// The one thing this loop actually pins: `refusalFor` must not throw for
		// any of these inputs. `assert.ok(refusal, …)` reads as a pollution
		// check but is not one — none of these ids will ever equal a registered
		// `"<type>::<language>"` key, so a refusal comes back whether or not the
		// lookup underneath resists a hostile key. The real discriminator is the
		// next test, against the registry lookup itself.
		for (const language of ['__proto__', 'constructor', '', 'kotlin']) {
			const refusal = refusalFor('function', 'call', language);
			assert.ok(refusal, `expected a refusal for language ${JSON.stringify(language)}`);
		}
	});

	test('SEC: the registry lookup resolves __proto__/constructor to undefined, never to an inherited object', () => {
		// `__proto__: 'some string'` is a silent no-op (the setter ignores
		// non-object values), so an assertion built on *assigning* a hostile
		// proto — or on `Object.getPrototypeOf(result) === Object.prototype`
		// afterwards — cannot fail no matter what the lookup does; both forms
		// were tried here before and both shipped vacuous (C7).
		//
		// What actually discriminates is the registry lookup's own return
		// value, checked by strict identity rather than truthiness: a
		// `registry[type][language]` refactor (plain nested objects instead of
		// the `"<type>::<language>"`-keyed `Map`) would resolve
		// `bucket['__proto__']` through the prototype chain to the *truthy*
		// `Object.prototype` object instead of `undefined` — a spurious match
		// that `refusalFor` would read as "implemented" and silently fail to
		// refuse. `Object.keys` on that spurious match is the tell: a real env
		// carries `type`/`language`/`leetcodeTypes`/`emit`/`parse`;
		// `Object.prototype` carries none of them.
		for (const language of ['__proto__', 'constructor', 'prototype']) {
			const env = testEnvFor('call', language, 'function');
			assert.strictEqual(env, undefined, language);
		}
	});
});
