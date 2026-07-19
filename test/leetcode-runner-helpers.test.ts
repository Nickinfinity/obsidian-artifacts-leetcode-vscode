import * as assert from 'node:assert';
import { collectResults, errorResult } from '../src/services/leetcode-runner.helpers.js';
import type { TestCase } from '../src/types/leetcode.types.js';
import type { CaseOutcome } from '../src/services/test-envs/env.types.js';

/**
 * Unit tests for the pure result-collection logic extracted from the runner
 * service — exercisable without spinning a subprocess, unlike the integration
 * `leetcode-runner` suite.
 */
suite('runner helpers', () => {

    const cases: TestCase[] = [
        { input: { a: 1, b: 2 }, expected: 3 },
        { input: { a: 4, b: 5 }, expected: 9 },
    ];

    suite('collectResults', () => {

        test('canonical-equal actual passes; unequal fails', () => {
            const outcomes: CaseOutcome[] = [
                { index: 0, actual: '3', ms: 1 },
                { index: 1, actual: '8', ms: 2 },
            ];
            const r = collectResults(cases, outcomes, null);
            assert.strictEqual(r[0].passed, true);
            assert.strictEqual(r[1].passed, false);
            assert.strictEqual(r[1].actual, '8');
            assert.deepStrictEqual(r.map(x => x.duration), [1, 2]);
        });

        test('compares canonically, not by raw stdout (object key order)', () => {
            const objCases: TestCase[] = [{ input: {}, expected: { b: 2, a: 1 } }];
            const r = collectResults(objCases, [{ index: 0, actual: '{"a":1,"b":2}', ms: 0 }], null);
            assert.strictEqual(r[0].passed, true);
        });

        test('an outcome error becomes a failed result carrying its duration', () => {
            const r = collectResults(cases, [{ index: 0, error: 'boom', ms: 7 }, { index: 1, actual: '9', ms: 1 }], null);
            assert.strictEqual(r[0].passed, false);
            assert.strictEqual(r[0].error, 'boom');
            assert.strictEqual(r[0].duration, 7);
            assert.strictEqual(r[1].passed, true);
        });

        test('a missing case inherits the run failure message (timeout attribution)', () => {
            const r = collectResults(cases, [{ index: 0, actual: '3', ms: 1 }], { timedOut: true, message: 'timeout' });
            assert.strictEqual(r[0].passed, true, 'printed case survives');
            assert.strictEqual(r[1].passed, false);
            assert.strictEqual(r[1].error, 'timeout');
        });

        test('a missing case with no failure reports "no output"', () => {
            const r = collectResults(cases, [], null);
            assert.ok(r.every(x => x.error === 'no output' && !x.passed));
        });
    });

    test('errorResult echoes input/expected and zeroes actual/duration', () => {
        const e = errorResult(0, cases[0], 'nope');
        assert.deepStrictEqual(e, {
            index: 0, passed: false, input: { a: 1, b: 2 }, expected: 3,
            actual: '', duration: 0, error: 'nope',
        });
    });
});
