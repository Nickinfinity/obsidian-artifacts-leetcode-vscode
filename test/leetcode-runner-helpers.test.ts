import * as assert from 'node:assert';
import {
	collectResults,
	compileFailure,
	errorResult,
	timedOut,
} from '../src/services/leetcode-runner.helpers.js';
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

    // ── Build-step failures ───────────────────────────────────────────────────

    suite('compileFailure', () => {

        test('reports a compiler diagnostic verbatim', () => {
            assert.strictEqual(
                compileFailure({ stderr: 'Solution.java:3: error: \';\' expected' }),
                "compilation error: Solution.java:3: error: ';' expected",
            );
        });

        test('falls back to the error message when there is no stderr at all', () => {
            assert.strictEqual(
                compileFailure({ message: 'Command failed: javac' }),
                'compilation error: Command failed: javac',
            );
        });

        /**
         * `??` trips on absent, not on blank — a compiler that wrote only
         * whitespace has said nothing, and the message is a wrapper line
         * (`Command failed: …`) that adds nothing either. Longstanding
         * behaviour, pinned so a later `||` "tidy-up" is a visible change.
         */
        test('a blank stderr is a silent compiler, not a reason', () => {
            assert.strictEqual(
                compileFailure({ stderr: '   ', message: 'Command failed: javac' }),
                'compilation error: unknown failure',
            );
        });

        test('never renders an empty reason', () => {
            assert.strictEqual(compileFailure({}), 'compilation error: unknown failure');
        });

        /**
         * A killed compiler usually produces no stderr at all, so the generic
         * path would say `unknown failure` and send a solver hunting for a
         * syntax mistake that is not there.
         */
        test('a killed compile is called a timeout, not an unknown failure', () => {
            assert.strictEqual(compileFailure({ killed: true }), 'compilation timed out');
            assert.strictEqual(compileFailure({ signal: 'SIGTERM' }), 'compilation timed out');
        });

        test('a timeout wins over whatever partial stderr arrived', () => {
            assert.strictEqual(
                compileFailure({ killed: true, stderr: 'warning: unused import' }),
                'compilation timed out',
            );
        });
    });

    suite('timedOut', () => {

        test('true for a killed child, however it was reported', () => {
            assert.strictEqual(timedOut({ killed: true }), true);
            assert.strictEqual(timedOut({ signal: 'SIGTERM' }), true);
        });

        test('false for a child that exited on its own terms', () => {
            assert.strictEqual(timedOut({}), false);
            assert.strictEqual(timedOut({ killed: false, signal: null }), false);
        });
    });
});
