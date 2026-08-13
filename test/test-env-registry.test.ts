import * as assert from 'node:assert';
import { isBatchEnv, languagesForType, register, testEnvFor } from '../src/services/test-envs/env.registry.js';
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
            // `ruby` is a non-`LangId`: rust and typescript are now registered
            // function envs (wave 3), so they resolve rather than returning undefined.
            assert.strictEqual(testEnvFor('function', 'ruby'), undefined);
            assert.strictEqual(testEnvFor('function', 'kotlin'), undefined);
        });

        test('rust and typescript resolve to their registered function envs', () => {
            assert.strictEqual(testEnvFor('function', 'rust')?.language, 'rust');
            assert.strictEqual(testEnvFor('function', 'typescript')?.language, 'typescript');
        });

        test('built-in function envs declare no external dependency', () => {
            for (const lang of ['java', 'javascript', 'python']) {
                const env = testEnvFor('function', lang);
                // The registry now holds two execution contracts, so narrow
                // before reading a `TestEnv`-only field rather than casting.
                assert.ok(env && isBatchEnv(env), `${lang} must resolve a batch env`);
                assert.strictEqual(env.requires, undefined);
                assert.strictEqual(env.detect, undefined);
            }
        });
    });

    // ── languagesForType ──────────────────────────────────────────────────────

    suite('languagesForType', () => {

        test('function resolves to the five built-in languages, sorted', () => {
            assert.deepStrictEqual(languagesForType('function'),
                ['java', 'javascript', 'python', 'rust', 'typescript']);
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
                leetcodeTypes: ['function'],
                emit: () => ({ files: [], run: '' }),
                parse: () => [],
            };
            register(fake);

            assert.strictEqual(testEnvFor('in-place', 'javascript'), fake);
            assert.deepStrictEqual(languagesForType('in-place'), ['javascript']);
        });

        test('registering the same slot twice replaces the occupant', () => {
            const first: TestEnv = {
                type: 'stdin-stdout', language: 'python', leetcodeTypes: ['function'],
                emit: () => ({ files: [], run: 'first' }), parse: () => [],
            };
            const second: TestEnv = {
                type: 'stdin-stdout', language: 'python', leetcodeTypes: ['function'],
                emit: () => ({ files: [], run: 'second' }), parse: () => [],
            };
            register(first);
            register(second);

            assert.strictEqual(testEnvFor('stdin-stdout', 'python'), second);
            assert.deepStrictEqual(languagesForType('stdin-stdout'), ['python']);
        });
    });

    // ── project registration ──────────────────────────────────────────────────

    suite('project × language', () => {

        /**
         * A `project` is graded by `build` and `function` checks against a file
         * tree, which any runnable language can declare — so the matrix is the
         * whole runnable set rather than the two the render driver can bundle.
         */
        test('every runnable language can hold a project exercise', () => {
            assert.deepStrictEqual(
                languagesForType('project'),
                ['java', 'javascript', 'python', 'rust', 'typescript'],
            );
        });

        test('the display-only react ids are still not registered', () => {
            assert.strictEqual(testEnvFor('project', 'javascriptreact'), undefined);
            assert.strictEqual(testEnvFor('project', 'typescriptreact'), undefined);
        });
    });

    // ── the leetcode-type axis ────────────────────────────────────────────────
    //
    // The registry stays keyed `"<testType>::<language>"`. A three-key table
    // would be 3 × 8 × 5 = 120 slots almost all empty, plus a second list to
    // drift out of sync with the first. The leetcode type is a *filter* on the
    // env's own declaration, and the absence of a registration is still the
    // matrix.

    suite('leetcodeTypes filter', () => {

        test('every registered env declares which leetcode types it serves', () => {
            for (const lang of ['java', 'javascript', 'python', 'rust', 'typescript']) {
                assert.ok(testEnvFor('function', lang)?.leetcodeTypes.length, `function/${lang}`);
                assert.ok(testEnvFor('project', lang)?.leetcodeTypes.length, `project/${lang}`);
            }
        });

        test('a function env serves only the `function` leetcode type', () => {
            assert.deepStrictEqual(testEnvFor('function', 'python')?.leetcodeTypes, ['function']);
        });

        test('a project env serves the two tree shapes, never `function`', () => {
            assert.deepStrictEqual(testEnvFor('project', 'python')?.leetcodeTypes, ['package', 'stack']);
        });

        test('testEnvFor filters on the third argument when it is given', () => {
            assert.ok(testEnvFor('function', 'python', 'function'));
            assert.strictEqual(testEnvFor('function', 'python', 'stack'), undefined);
            assert.strictEqual(testEnvFor('function', 'python', 'package'), undefined);
            assert.ok(testEnvFor('project', 'python', 'package'));
            assert.strictEqual(testEnvFor('project', 'python', 'function'), undefined);
        });

        test('omitting the third argument behaves exactly as before', () => {
            // The parameter is appended and optional on purpose: seven call
            // sites span three phases, and a required parameter here is a red
            // gate clearable only by editing four other tasks' files.
            assert.ok(testEnvFor('function', 'python'));
            assert.ok(testEnvFor('project', 'python'));
            assert.deepStrictEqual(
                languagesForType('function'),
                ['java', 'javascript', 'python', 'rust', 'typescript'],
            );
        });

        test('languagesForType filters on the leetcode type when it is given', () => {
            assert.deepStrictEqual(
                languagesForType('function', 'function'),
                ['java', 'javascript', 'python', 'rust', 'typescript'],
            );
            assert.deepStrictEqual(languagesForType('function', 'package'), []);
            assert.deepStrictEqual(
                languagesForType('project', 'stack'),
                ['java', 'javascript', 'python', 'rust', 'typescript'],
            );
            assert.deepStrictEqual(languagesForType('project', 'function'), []);
        });

        test('the registry key is still `<testType>::<language>` — the filter is not a third key', () => {
            // Two envs differing only in leetcodeTypes must collide, proving the
            // key did not silently grow a third component.
            const base = testEnvFor('function', 'python');
            assert.ok(base);
            // The restore is `finally`-guarded: the registry is module-level
            // state shared by every suite in the mocha process, so a failing
            // assertion here would otherwise leave `function::python` mutated
            // and cascade into misattributed failures elsewhere.
            try {
                register({ ...base, leetcodeTypes: ['package'] });
                assert.strictEqual(testEnvFor('function', 'python', 'function'), undefined);
                assert.ok(testEnvFor('function', 'python', 'package'));
            } finally {
                register(base);
            }
            assert.ok(testEnvFor('function', 'python', 'function'));
        });
    });
});
