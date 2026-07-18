/**
 * Pure formatting/decision helpers for the LeetCode challenge timer.
 *
 * Deliberately free of the `vscode` import — `leetcode-challenge.service.ts`
 * is a `vscode`-bound file that cannot be unit-tested directly (mocha runs
 * outside the Extension Host, so a plain `import 'vscode'` fails to resolve).
 * `formatRemaining` and `timerTick` are the pure computations that service
 * owns, so they live here instead, where TDD applies per this repo's
 * CLAUDE.md rule.
 */

import type { TimerTick } from '../types/leetcode.types.js';

/**
 * Format a remaining-millisecond count as `MM:SS`.
 *
 * Re-exported under this service's established name — the panel and the
 * challenge service both already import `formatRemaining` from here. Rounds
 * up to the next whole second rather than truncating, so a countdown never
 * shows `00:00` a second before the clock actually expires.
 *
 * @param ms - Milliseconds left on the clock (zero or positive).
 * @returns Zero-padded `MM:SS` string.
 *
 * @example
 * formatRemaining(65_000); // → '01:05'
 */
export { formatClock as formatRemaining } from '../utils/time.helpers.js';

/**
 * Decide one clock tick for a challenge, bounded or unbounded (P7).
 *
 * A `null` deadline means the run has no time limit (`practice.timeLimit`
 * was `0`/empty) — the clock counts **up** from `startedAt` and never
 * expires. A set deadline counts **down** to it, clamped at `0` so a tick
 * observed after expiry never reports negative milliseconds.
 *
 * @param startedAt - Epoch ms the challenge started.
 * @param deadline  - Epoch ms the countdown expires, or `null` for unlimited.
 * @param now       - Epoch ms to evaluate the tick at (caller-supplied so the
 *   function stays pure and testable without faking the system clock).
 * @returns The `TimerTick` for this instant.
 *
 * @example
 * timerTick(1_000, null, 12_500);   // → { unlimited: true, ms: 11_500 }
 * timerTick(1_000, 60_000, 20_000); // → { unlimited: false, ms: 40_000 }
 */
export function timerTick(startedAt: number, deadline: number | null, now: number): TimerTick {
	if (deadline === null) {
		return { unlimited: true, ms: now - startedAt };
	}
	return { unlimited: false, ms: Math.max(deadline - now, 0) };
}
