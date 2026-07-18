import * as assert from 'node:assert';
import { formatClock, formatDuration, splitMs } from '../src/utils/time.helpers.js';

/**
 * Unit tests for the shared ms → minutes/seconds split and the two thin
 * formatters built on it: `formatClock` (`MM:SS`, the countdown) and
 * `formatDuration` (`XmYs`, the solve-duration stamp). The two differ only in
 * rounding direction (ceil vs. floor) — these tests pin that difference down
 * so a future edit to `splitMs` cannot silently swap one format's edge
 * behaviour for the other's.
 */
suite('time.helpers', () => {

    suite('splitMs', () => {

        test('floor truncates a partial second', () => {
            assert.deepStrictEqual(splitMs(65_500), { minutes: 1, seconds: 5 });
        });

        test('ceil rounds a partial second up', () => {
            assert.deepStrictEqual(splitMs(500, 'ceil'), { minutes: 0, seconds: 1 });
        });

        test('zero ms is zero minutes and seconds under either mode', () => {
            assert.deepStrictEqual(splitMs(0), { minutes: 0, seconds: 0 });
            assert.deepStrictEqual(splitMs(0, 'ceil'), { minutes: 0, seconds: 0 });
        });
    });

    suite('formatClock (MM:SS)', () => {

        test('zero renders as 00:00', () => {
            assert.strictEqual(formatClock(0), '00:00');
        });

        test('sub-minute value pads to two digits', () => {
            assert.strictEqual(formatClock(5_000), '00:05');
        });

        test('rounds a partial second up rather than truncating to zero', () => {
            assert.strictEqual(formatClock(500), '00:01');
        });

        test('whole minutes and seconds', () => {
            assert.strictEqual(formatClock(65_000), '01:05');
        });

        test('hour-plus value overflows past 59 rather than wrapping', () => {
            assert.strictEqual(formatClock(61 * 60_000), '61:00');
        });
    });

    suite('formatDuration (XmYs)', () => {

        test('zero renders as 0m0s', () => {
            assert.strictEqual(formatDuration(0), '0m0s');
        });

        test('sub-minute value has no leading zero padding', () => {
            assert.strictEqual(formatDuration(5_000), '0m5s');
        });

        test('truncates a partial second rather than rounding up', () => {
            assert.strictEqual(formatDuration(999), '0m0s');
        });

        test('whole minutes and seconds', () => {
            assert.strictEqual(formatDuration(192_000), '3m12s');
        });

        test('hour-plus value keeps minutes unbounded', () => {
            assert.strictEqual(formatDuration(61 * 60_000), '61m0s');
        });
    });
});
