import { LEET_SENTINEL } from '../../types/constants.js';
import type { CaseOutcome } from './env.types.js';

/**
 * Recover the sentinel-prefixed result lines from a program's stdout.
 *
 * Every env's generated driver prints one line per case:
 *
 * ```
 * __LEET__{"index":0,"actual":"[0,1]","ms":3}
 * ```
 *
 * The prefix exists so an incidental `print` / `console.log` in the solver's
 * own code cannot be mistaken for a result. A trailing line truncated by a
 * timeout-kill fails `JSON.parse` and is skipped rather than throwing — partial
 * stdout must stay parseable, since that is exactly what a suite timeout leaves
 * behind.
 *
 * @param stdout - Raw stdout of the generated program (possibly truncated).
 * @returns One outcome per intact sentinel line, in the order printed.
 *
 * @example
 * parseSentinelLines('noise\n__LEET__{"index":0,"actual":"1","ms":2}\n');
 * // → [{ index: 0, actual: '1', ms: 2 }]
 */
export function parseSentinelLines(stdout: string): CaseOutcome[] {
	const out: CaseOutcome[] = [];
	for (const line of stdout.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith(LEET_SENTINEL)) { continue; }
		try {
			const parsed = JSON.parse(trimmed.slice(LEET_SENTINEL.length)) as CaseOutcome;
			if (typeof parsed.index === 'number') { out.push(parsed); }
		} catch {
			// Truncated final line after a timeout-kill — drop it, keep the rest.
		}
	}
	return out;
}
