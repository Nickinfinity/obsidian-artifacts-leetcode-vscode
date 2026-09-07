import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { canonicalJson } from '../../../utils/canonical-json.js';
import { safeJsonParse } from '../../../utils/safe-json.js';
import type { CaseOutcome } from '../env.types.js';

/**
 * Environment variable name a `program`-type child reads its out-of-band
 * result path from. The one spelling — the format doc promises solvers
 * `$LEET_OUT` by exactly this name, so nothing else may re-litter it as a
 * string literal.
 */
export const LEET_OUT_ENV_VAR = 'LEET_OUT';

/**
 * Hard cap on a `$LEET_OUT` file, enforced before any byte is read.
 *
 * A solver's graded value is a JSON scalar, array or small object — never a
 * payload — so 64 KiB is generous headroom, not a tuned budget. A program
 * that writes past it is a bug for the solver to see as a failed case, not a
 * multi-megabyte string this process would otherwise pull into its own heap.
 */
export const MAX_LEET_OUT_BYTES = 64 * 1024;

/**
 * Mint the path a case's `$LEET_OUT` file will live at.
 *
 * Built from `runDir` and the case's own index — never from artifact text,
 * so a title or author string can never reach a filesystem path. Stable for
 * a given `(runDir, index)` pair: minting is not itself an I/O operation.
 *
 * @param runDir - The run's temp directory (already created by the caller).
 * @param index  - Zero-based case index.
 * @returns Absolute path the child process should be told about via
 *   `LEET_OUT_ENV_VAR`.
 *
 * @example
 * mintOutChannelPath('/tmp/leet-run-abc', 0); // → '/tmp/leet-run-abc/leet-out-0.json'
 */
export function mintOutChannelPath(runDir: string, index: number): string {
	return path.join(runDir, `leet-out-${index}.json`);
}

/**
 * Read one case's `$LEET_OUT` file back and classify the outcome.
 *
 * `stat` runs before any `read` (S11): a file over `MAX_LEET_OUT_BYTES` is
 * rejected on its declared size alone, never partially parsed, and never
 * pulled into the extension host's heap. A missing file — the shape left by
 * a crashed or timed-out child — is a **failed** case, matching the same
 * rule the `__LEET__` sentinel protocol enforces for stdout: a killed
 * program must never read as an empty, and therefore green, result.
 *
 * The returned `actual` is already canonical JSON (sorted keys, no
 * whitespace), matching every other `TestEnv`'s contract, so `collectResults`
 * can compare it against `canonicalJson(testCase.expected)` unchanged.
 *
 * @param filePath - Path minted by {@link mintOutChannelPath}.
 * @param index    - Case index, echoed into the outcome.
 * @param ms       - Wall-clock time for this case, measured by the caller
 *   (this module does no timing of its own — it only reads a file back).
 * @returns The case's outcome, in the shared `CaseOutcome` shape.
 *
 * @example
 * await readOutChannel('/tmp/run/leet-out-0.json', 0, 12);
 * // → { index: 0, actual: '[0,1]', ms: 12 }               (file held `[1,0]`… sorted N/A, arrays keep order)
 * // → { index: 0, error: 'the program wrote no $LEET_OUT file …', ms: 12 } (file absent)
 */
export async function readOutChannel(filePath: string, index: number, ms: number): Promise<CaseOutcome> {
	const stats = await statOrNull(filePath);
	if (!stats) {
		return {
			index, ms,
			error: 'the program wrote no $LEET_OUT file (it may have crashed or timed out)',
		};
	}
	if (stats.size > MAX_LEET_OUT_BYTES) {
		return {
			index, ms,
			error: `the program's $LEET_OUT file is ${stats.size} bytes, over the `
				+ `${MAX_LEET_OUT_BYTES}-byte limit — a runaway write, not a graded value`,
		};
	}

	const raw = await fs.readFile(filePath, 'utf8');
	// `safeJsonParse` collapses "invalid JSON" and "the literal `null`" onto
	// the same `null` return — the one case a solver's actual answer can be —
	// so a bare-`null`-on-disk is disambiguated from a parse failure by the
	// raw text itself before falling back to the parse-failure reason.
	const parsed = safeJsonParse<unknown>(raw);
	if (parsed === null && raw.trim() !== 'null') {
		return { index, ms, error: 'the program\'s $LEET_OUT file is not valid JSON' };
	}
	return { index, ms, actual: canonicalJson(parsed) };
}

/** `fs.stat`, returning `null` instead of throwing when the path is absent. */
async function statOrNull(filePath: string): Promise<{ size: number } | null> {
	try {
		return await fs.stat(filePath);
	} catch {
		return null;
	}
}
