/**
 * Manual stopwatch used by the LeetCode flow to record solve duration.
 *
 * The timer is started on the first **Run Tests** press and stopped on a
 * successful **Submit**. `stop()` returns the elapsed duration formatted as
 * `XmYs` (e.g. `'3m12s'`) ready to embed in the solution's `<!-- meta: … -->`
 * comment.
 *
 * @example
 * const t = new LeetCodeTimer();
 * t.start();
 * // …user works on solution…
 * const duration = t.stop(); // → '8m22s'
 */
export class LeetCodeTimer {
	private startTime: number | null = null;
	private running = false;

	/**
	 * Begin timing. Throws if the timer is already running.
	 *
	 * @example
	 * const t = new LeetCodeTimer();
	 * t.start();
	 */
	start(): void {
		if (this.running) { throw new Error('Timer is already running'); }
		this.startTime = Date.now();
		this.running   = true;
	}

	/**
	 * Stop timing and return the elapsed duration formatted as `XmYs`.
	 *
	 * After `stop()`, the timer is reset to an idle state so `start()` can be
	 * called again. Throws if the timer is not currently running.
	 *
	 * @returns Duration string, e.g. `'3m12s'`.
	 *
	 * @example
	 * t.stop(); // → '0m4s'
	 */
	stop(): string {
		if (!this.running || this.startTime === null) { throw new Error('Timer is not running'); }
		const ms = Date.now() - this.startTime;
		this.running   = false;
		this.startTime = null;
		return formatDuration(ms);
	}

	/**
	 * Returns the elapsed milliseconds while the timer is running; `0`
	 * otherwise.
	 *
	 * @example
	 * t.start(); t.getElapsed(); // → small positive integer
	 */
	getElapsed(): number {
		if (!this.running || this.startTime === null) { return 0; }
		return Date.now() - this.startTime;
	}

	/** True while the timer is currently running. */
	isRunning(): boolean { return this.running; }

	/**
	 * Reset the timer to a clean idle state regardless of its current status.
	 *
	 * @example
	 * t.reset();
	 */
	reset(): void {
		this.startTime = null;
		this.running   = false;
	}
}

/**
 * Format an elapsed-millisecond count as the `XmYs` string used in solution
 * metadata comments.
 *
 * @param ms - Elapsed time in milliseconds.
 * @returns `XmYs` formatted string.
 *
 * @example
 * formatDuration(192_000); // → '3m12s'
 */
function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m${seconds}s`;
}
