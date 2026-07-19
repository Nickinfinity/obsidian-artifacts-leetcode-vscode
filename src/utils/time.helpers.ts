/**
 * Pure ms → minutes/seconds splitting shared by the two clock formats this
 * extension renders: the `MM:SS` countdown (status bar + in-view header) and
 * the `XmYs` solve-duration stamp (solution metadata comment). The two differ
 * only in rounding direction — a countdown must round a partial second *up*
 * (so it never shows `00:00` a second before it truly expires) while an
 * elapsed-time stamp truncates (a stopwatch reads whole seconds passed) — and
 * in punctuation, both handled by the thin wrappers below.
 */

/** One ms count split into whole minutes and the remainder seconds. */
export interface MinSec {
	/** Whole minutes. */
	minutes: number;
	/** Remainder seconds, `0`–`59`. */
	seconds: number;
}

/**
 * Split a millisecond count into `{ minutes, seconds }`.
 *
 * @param ms    - Milliseconds to split (zero or positive).
 * @param round - `'ceil'` rounds a partial second up (countdown display);
 *   `'floor'` truncates (elapsed-time display). Defaults to `'floor'`.
 * @returns The split minutes/seconds.
 *
 * @example
 * splitMs(65_000);          // → { minutes: 1, seconds: 5 }
 * splitMs(500, 'ceil');     // → { minutes: 0, seconds: 1 }
 */
export function splitMs(ms: number, round: 'floor' | 'ceil' = 'floor'): MinSec {
	const totalSeconds = round === 'ceil' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
	return { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
}

/**
 * Format a millisecond count as a zero-padded `MM:SS` countdown/count-up
 * label. Rounds a partial second up — the status-bar/in-view clock must never
 * show `00:00` a second before it actually reaches zero.
 *
 * @param ms - Milliseconds to render (zero or positive).
 * @returns Zero-padded `MM:SS` string.
 *
 * @example
 * formatClock(65_000); // → '01:05'
 * formatClock(500);    // → '00:01'
 */
export function formatClock(ms: number): string {
	const { minutes, seconds } = splitMs(ms, 'ceil');
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Format an elapsed-millisecond count as the `XmYs` string used in solution
 * metadata comments. Truncates rather than rounds — an elapsed-time stamp
 * reports whole seconds already passed.
 *
 * @param ms - Elapsed time in milliseconds.
 * @returns `XmYs` formatted string.
 *
 * @example
 * formatDuration(192_000); // → '3m12s'
 */
export function formatDuration(ms: number): string {
	const { minutes, seconds } = splitMs(ms, 'floor');
	return `${minutes}m${seconds}s`;
}
