import * as assert from 'node:assert';
import { LeetCodeTimer } from '../src/services/leetcode-timer.service.js';

/**
 * Unit tests for the `LeetCodeTimer` class.
 *
 * Covers start/stop transitions, the `XmYs` format contract, elapsed reads,
 * error paths, reset behaviour, and consecutive start/stop cycles.
 */
suite('LeetCodeTimer', () => {

    function sleep(ms: number): Promise<void> {
        return new Promise(r => setTimeout(r, ms));
    }

    test('start() → isRunning() returns true', () => {
        const t = new LeetCodeTimer();
        t.start();
        assert.strictEqual(t.isRunning(), true);
    });

    test('stop() → isRunning() returns false', () => {
        const t = new LeetCodeTimer();
        t.start();
        t.stop();
        assert.strictEqual(t.isRunning(), false);
    });

    test('stop() returns duration string matching /^\\d+m\\d+s$/', () => {
        const t = new LeetCodeTimer();
        t.start();
        const d = t.stop();
        assert.ok(/^\d+m\d+s$/.test(d), `format mismatch: ${d}`);
    });

    test('getElapsed() while running returns number > 0 after sleep', async () => {
        const t = new LeetCodeTimer();
        t.start();
        await sleep(10);
        assert.ok(t.getElapsed() > 0);
        t.stop();
    });

    test('start() while already running throws', () => {
        const t = new LeetCodeTimer();
        t.start();
        assert.throws(() => t.start());
        t.stop();
    });

    test('stop() while not running throws', () => {
        const t = new LeetCodeTimer();
        assert.throws(() => t.stop());
    });

    test('reset() clears state — isRunning() false, getElapsed() 0', () => {
        const t = new LeetCodeTimer();
        t.start();
        t.reset();
        assert.strictEqual(t.isRunning(), false);
        assert.strictEqual(t.getElapsed(), 0);
    });

    test('after reset() can start() again without error', () => {
        const t = new LeetCodeTimer();
        t.start();
        t.reset();
        assert.doesNotThrow(() => t.start());
        t.stop();
    });

    test('consecutive start/stop cycles are independent', async () => {
        const t = new LeetCodeTimer();
        t.start();
        await sleep(5);
        t.stop();
        assert.strictEqual(t.isRunning(), false);
        t.start();
        assert.strictEqual(t.isRunning(), true);
        t.stop();
    });

});
