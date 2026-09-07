import * as assert from 'node:assert';
import { isBatchEnv, languagesForType, register, testEnvFor } from '../src/services/test-envs/env.registry.js';
import type { TestEnv } from '../src/services/test-envs/env.types.js';

/**
 * Unit tests for the `(test type × language)` registry, filtered by leetcode type.
 *
 * The absence of a pair *is* the capability matrix, so these tests pin both the
 * hits and — more importantly — the misses that keep an unrunnable language out
 * of the panel's selector.
 *
 * Two things changed shape at T3.5 and are pinned here rather than remembered:
 * the five function envs answer to **`call`** (the legacy `function` id is not a
 * `TestTypeId` at all any more), and the five `project` stub envs are **gone** —
 * a tree is graded by dispatching its checks, never through this table.
 */
suite('test-env registry', () => {

    // ── testEnvFor ────────────────────────────────────────────────────────────

    suite('testEnvFor', () => {

        test('resolves each built-in call environment', () => {
            for (const lang of ['java', 'javascript', 'python']) {
                const env = testEnvFor('call', lang, 'function');
                assert.ok(env, `missing env for ${lang}`);
                assert.strictEqual(env.language, lang);
                assert.strictEqual(env.type, 'call');
            }
        });

        test('a reserved test type has no environment in any language', () => {
            for (const lang of ['java', 'javascript', 'python']) {
                assert.strictEqual(testEnvFor('class', lang, 'function'), undefined);
                assert.strictEqual(testEnvFor('in-place', lang, 'function'), undefined);
            }
        });

        test('an unregistered language has no environment', () => {
            // `ruby` is a non-`LangId`: rust and typescript are now registered
            // call envs (wave 3), so they resolve rather than returning undefined.
            assert.strictEqual(testEnvFor('call', 'ruby', 'function'), undefined);
            assert.strictEqual(testEnvFor('call', 'kotlin', 'function'), undefined);
        });

        test('rust and typescript resolve to their registered call envs', () => {
            assert.strictEqual(testEnvFor('call', 'rust', 'function')?.language, 'rust');
            assert.strictEqual(testEnvFor('call', 'typescript', 'function')?.language, 'typescript');
        });

        test('built-in call envs declare no external dependency', () => {
            for (const lang of ['java', 'javascript', 'python']) {
                const env = testEnvFor('call', lang, 'function');
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

        test('call resolves to the five built-in languages, sorted', () => {
            assert.deepStrictEqual(languagesForType('call', 'function'),
                ['java', 'javascript', 'python', 'rust', 'typescript']);
        });

        test('a reserved type resolves to no language at all', () => {
            assert.deepStrictEqual(languagesForType('class', 'function'), []);
            assert.deepStrictEqual(languagesForType('in-place', 'function'), []);
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

            assert.strictEqual(testEnvFor('in-place', 'javascript', 'function'), fake);
            assert.deepStrictEqual(languagesForType('in-place', 'function'), ['javascript']);
        });

        test('registering the same slot twice replaces the occupant', () => {
            const first: TestEnv = {
                type: 'class', language: 'python', leetcodeTypes: ['function'],
                emit: () => ({ files: [], run: 'first' }), parse: () => [],
            };
            const second: TestEnv = {
                type: 'class', language: 'python', leetcodeTypes: ['function'],
                emit: () => ({ files: [], run: 'second' }), parse: () => [],
            };
            register(first);
            register(second);

            assert.strictEqual(testEnvFor('class', 'python', 'function'), second);
            assert.deepStrictEqual(languagesForType('class', 'function'), ['python']);
        });
    });

    // ── what a tree resolves ──────────────────────────────────────────────────

    suite('trees', () => {

        /**
         * The T3.5 correction. `project` was a key in this table only because
         * one value used to answer both axes, and the five envs behind it
         * refused every candidate they were handed — a matrix entry claiming a
         * tree could be graded *through the suite runner*, which it never can.
         * The registry now answers only what it can answer truthfully.
         */
        test('no check kind is registered — checks are dispatched, not resolved', () => {
            for (const kind of ['build', 'dom-assert', 'css-assert', 'http'] as const) {
                for (const shape of ['package', 'stack'] as const) {
                    assert.deepStrictEqual(languagesForType(kind, shape), [], `${kind}/${shape}`);
                }
            }
        });

        test('`program` is the one suite a tree can declare, and it serves `package`', () => {
            assert.ok(testEnvFor('program', 'python', 'package'), 'program/python/package');
            assert.strictEqual(testEnvFor('program', 'python', 'function'), undefined);
            assert.ok(languagesForType('program', 'package').length > 0);
            assert.deepStrictEqual(languagesForType('program', 'function'), []);
        });

        test('the display-only react ids are still not registered', () => {
            assert.strictEqual(testEnvFor('call', 'javascriptreact', 'function'), undefined);
            assert.strictEqual(testEnvFor('program', 'typescriptreact', 'package'), undefined);
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
                assert.ok(testEnvFor('call', lang, 'function')?.leetcodeTypes.length, `call/${lang}`);
            }
        });

        test('a call env serves only the `function` leetcode type', () => {
            assert.deepStrictEqual(testEnvFor('call', 'python', 'function')?.leetcodeTypes, ['function']);
        });

        test('the shape argument is required, and it filters', () => {
            assert.ok(testEnvFor('call', 'python', 'function'));
            assert.strictEqual(testEnvFor('call', 'python', 'stack'), undefined);
            assert.strictEqual(testEnvFor('call', 'python', 'package'), undefined);
        });

        test('languagesForType filters on the leetcode type', () => {
            assert.deepStrictEqual(
                languagesForType('call', 'function'),
                ['java', 'javascript', 'python', 'rust', 'typescript'],
            );
            assert.deepStrictEqual(languagesForType('call', 'package'), []);
            assert.deepStrictEqual(languagesForType('call', 'stack'), []);
        });

        test('the registry key is still `<testType>::<language>` — the filter is not a third key', () => {
            // Two envs differing only in leetcodeTypes must collide, proving the
            // key did not silently grow a third component.
            const base = testEnvFor('call', 'python', 'function');
            assert.ok(base);
            // The restore is `finally`-guarded: the registry is module-level
            // state shared by every suite in the mocha process, so a failing
            // assertion here would otherwise leave `call::python` mutated
            // and cascade into misattributed failures elsewhere.
            try {
                register({ ...base, leetcodeTypes: ['package'] });
                assert.strictEqual(testEnvFor('call', 'python', 'function'), undefined);
                assert.ok(testEnvFor('call', 'python', 'package'));
            } finally {
                register(base);
            }
            assert.ok(testEnvFor('call', 'python', 'function'));
        });
    });
});
