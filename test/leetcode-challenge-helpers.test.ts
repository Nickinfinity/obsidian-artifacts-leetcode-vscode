import * as assert from 'node:assert';
import { formatRemaining, timerTick } from '../src/services/leetcode-challenge.helpers.js';

/**
 * Unit tests for the pure countdown-formatting helper shared by the
 * status-bar countdown and the P4 in-view header timer.
 */
suite('leetcode-challenge.helpers', () => {

    suite('formatRemaining', () => {

        test('formats a whole number of minutes and seconds', () => {
            assert.strictEqual(formatRemaining(65_000), '01:05');
        });

        test('pads single-digit minutes and seconds', () => {
            assert.strictEqual(formatRemaining(5_000), '00:05');
        });

        test('rounds a partial second up rather than truncating to zero', () => {
            assert.strictEqual(formatRemaining(500), '00:01');
        });

        test('zero remaining renders as 00:00', () => {
            assert.strictEqual(formatRemaining(0), '00:00');
        });

        test('minutes overflow past 59 rather than wrapping', () => {
            assert.strictEqual(formatRemaining(61 * 60_000), '61:00');
        });
    });

    suite('timerTick', () => {

        test('deadline null counts up elapsed time since start', () => {
            const startedAt = 1_000;
            const now = 12_500;
            assert.deepStrictEqual(timerTick(startedAt, null, now), { unlimited: true, ms: 11_500 });
        });

        test('deadline set and still in the future counts down the remainder', () => {
            const startedAt = 1_000;
            const deadline = 60_000;
            const now = 20_000;
            assert.deepStrictEqual(timerTick(startedAt, deadline, now), { unlimited: false, ms: 40_000 });
        });

        test('deadline set and already past clamps ms to zero rather than going negative', () => {
            const startedAt = 1_000;
            const deadline = 10_000;
            const now = 25_000;
            assert.deepStrictEqual(timerTick(startedAt, deadline, now), { unlimited: false, ms: 0 });
        });

        test('unlimited run at the moment it starts reads zero elapsed', () => {
            const startedAt = 5_000;
            assert.deepStrictEqual(timerTick(startedAt, null, startedAt), { unlimited: true, ms: 0 });
        });
    });
});
