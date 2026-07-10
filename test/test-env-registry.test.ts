import * as assert from 'node:assert';
import { languagesForType, register, testEnvFor } from '../src/services/test-envs/env.registry.js';
import type { TestEnv } from '../src/services/test-envs/env.types.js';

/**
 * Unit tests for the `(test type × language)` registry.
 *
 * The absence of a pair *is* the capability matrix, so these tests pin both the
 * hits and — more importantly — the misses that keep an unrunnable language out
 * of the panel's selector.
 */
suite('test-env registry', () => {

    // ── testEnvFor ────────────────────────────────────────────────────────────

    suite('testEnvFor', () => {

        test('resolves each built-in function environment', () => {
            for (const lang of ['java', 'javascript', 'python']) {
                const env = testEnvFor('function', lang);
                assert.ok(env, `missing env for ${lang}`);
                assert.strictEqual(env.language, lang);
                assert.strictEqual(env.type, 'function');
            }
        });

        test('a reserved test type has no environment in any language', () => {
            for (const lang of ['java', 'javascript', 'python']) {
                assert.strictEqual(testEnvFor('class', lang), undefined);
                assert.strictEqual(testEnvFor('stdin-stdout', lang), undefined);
                assert.strictEqual(testEnvFor('in-place', lang), undefined);
            }
        });

        test('an unregistered language has no environment', () => {
            assert.strictEqual(testEnvFor('function', 'rust'), undefined);
            assert.strictEqual(testEnvFor('function', 'typescript'), undefined);
        });

        test('built-in function envs declare no external dependency', () => {
            for (const lang of ['java', 'javascript', 'python']) {
                const env = testEnvFor('function', lang);
                assert.strictEqual(env?.requires, undefined);
                assert.strictEqual(env?.detect, undefined);
            }
        });
    });

    // ── languagesForType ──────────────────────────────────────────────────────

    suite('languagesForType', () => {

        test('function resolves to the three built-in languages, sorted', () => {
            assert.deepStrictEqual(languagesForType('function'), ['java', 'javascript', 'python']);
        });

        test('a reserved type resolves to no language at all', () => {
            assert.deepStrictEqual(languagesForType('class'), []);
            assert.deepStrictEqual(languagesForType('stdin-stdout'), []);
            assert.deepStrictEqual(languagesForType('in-place'), []);
        });
    });

    // ── register ──────────────────────────────────────────────────────────────

    suite('register', () => {

        test('a newly registered pair becomes resolvable and selectable', () => {
            const fake: TestEnv = {
                type: 'in-place',
                language: 'javascript',
                emit: () => ({ files: [], run: '' }),
                parse: () => [],
            };
            register(fake);

            assert.strictEqual(testEnvFor('in-place', 'javascript'), fake);
            assert.deepStrictEqual(languagesForType('in-place'), ['javascript']);
        });

        test('registering the same slot twice replaces the occupant', () => {
            const first: TestEnv = {
                type: 'stdin-stdout', language: 'python', emit: () => ({ files: [], run: 'first' }), parse: () => [],
            };
            const second: TestEnv = {
                type: 'stdin-stdout', language: 'python', emit: () => ({ files: [], run: 'second' }), parse: () => [],
            };
            register(first);
            register(second);

            assert.strictEqual(testEnvFor('stdin-stdout', 'python'), second);
            assert.deepStrictEqual(languagesForType('stdin-stdout'), ['python']);
        });
    });
});
