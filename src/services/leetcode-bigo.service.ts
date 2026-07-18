import {
	hasMemoIndicator,
	hasSortCall,
	hasUnknownCostCall,
	isSelfRecursive,
	scanBraceLoops,
	scanPythonLoops,
	stripCLikeComments,
	stripPythonComments,
} from './leetcode-bigo.helpers.js';
import { isLangId, type LangId } from '../types/languages.js';

/** Confidence tier for a `BigOEstimate` — how much of the classification was inferred vs. counted. */
export type BigOConfidence = 'high' | 'medium' | 'low';

/**
 * Result of a static Big-O heuristic pass over one candidate's source.
 *
 * This is **informational, never pass/fail** — static loop-counting is easily
 * fooled (hidden library costs, early returns, amortised structures), so a
 * caller must always render `confidence` and `reason` alongside `notation`
 * rather than treating the notation as a verdict.
 */
export interface BigOEstimate {
	/** Complexity class, e.g. `'O(n)'`, `'O(n^2)'`, `'O(n log n)'`, `'O(2^n)?'` */
	notation: string;
	/** How much of `notation` was counted directly vs. inferred/guessed */
	confidence: BigOConfidence;
	/** One-line, user-facing explanation of how `notation` was reached */
	reason: string;
}

/** Languages this heuristic understands. Anything else is reported, not guessed. */
type SupportedLang = LangId;

/**
 * Estimate the asymptotic complexity of a candidate solution by scanning its
 * source: strip comments/strings, count loop nesting depth, detect
 * self-recursion, and recognise a handful of well-known library calls.
 *
 * This is a **static heuristic**, not an analyser — there is no AI infra yet
 * (that is Phase 3 / MCP) and the extension ships zero runtime dependencies,
 * so a solver gets a best-effort read plus an honest confidence/caveat rather
 * than a false certainty. Recursion detection needs the candidate's own
 * name; callers should resolve it via `functionNameFor(parsed, langId)`
 * (falling back to `parsed.functionName`) before calling this — this module
 * stays free of `ParsedLeetCode` so it can be unit-tested in isolation.
 *
 * @param code         - Candidate source, already resolved to a bare
 *   declaration (e.g. via `buildExecutable`).
 * @param langId       - Canonical `languageId`. Only `'java'`, `'python'`,
 *   and `'javascript'` are understood; anything else reports `low`
 *   confidence rather than guessing.
 * @param functionName - The candidate's own function name, for self-call
 *   (recursion) detection. Omit to skip recursion detection entirely.
 * @returns The notation, a confidence tier, and a one-line explanation.
 *
 * @example
 * estimateBigO('for (int i=0;i<n;i++){ sum += a[i]; }', 'java');
 * // → { notation: 'O(n)', confidence: 'high', reason: 'single loop over the input' }
 */
export function estimateBigO(code: string, langId: string, functionName?: string): BigOEstimate {
	const lang = toSupportedLang(langId);
	if (!lang) {
		return {
			notation: 'unknown',
			confidence: 'low',
			reason: `no Big-O heuristic for language '${langId}' — only java, python, and javascript are supported`,
		};
	}

	const cleaned = lang === 'python' ? stripPythonComments(code) : stripCLikeComments(code);

	const recursive = !!functionName && isSelfRecursive(cleaned, functionName);
	const memoized = recursive && hasMemoIndicator(cleaned);
	if (recursive && !memoized) { return exponentialGuess(functionName as string); }

	const scan = lang === 'python' ? scanPythonLoops(cleaned) : scanBraceLoops(cleaned);
	const sorts = hasSortCall(cleaned, lang);

	const { notation, reason: baseReason } = classify(scan.maxDepth, sorts);
	let reason = baseReason;
	let confidence: BigOConfidence = sorts && scan.maxDepth <= 1 ? 'medium' : 'high';

	if (memoized) {
		confidence = downgrade(confidence);
		reason += `; self-recursive call to \`${functionName}\` appears memoized`;
	}
	if (scan.hasEarlyReturn) {
		confidence = downgrade(confidence);
		reason += '; an early return/break inside the loop lowers confidence in the worst-case count';
	}
	if (hasUnknownCostCall(cleaned, lang)) {
		confidence = downgrade(confidence);
		reason += '; a library call of unknown cost may hide extra work';
	}

	return { notation, confidence, reason };
}

// ── Classification ───────────────────────────────────────────────────────────

/** Fixed result for unmemoized self-recursion — a guess, flagged as one. */
function exponentialGuess(functionName: string): BigOEstimate {
	return {
		notation: 'O(2^n)?',
		confidence: 'low',
		reason: `self-recursive call to \`${functionName}\` with no memoization detected; assuming exponential branching`,
	};
}

/**
 * Map loop nesting depth (plus a detected library sort) to a notation and
 * base reason string.
 *
 * A sort call at depth 0 or 1 dominates the cost of the rest of the
 * function — `O(n log n)` beats a bare scan or a single sort call outright.
 * At depth 2+ the nested loops already dominate a single sort call, so the
 * depth-based notation stands.
 */
function classify(maxDepth: number, hasSort: boolean): { notation: string; reason: string } {
	if (hasSort && maxDepth <= 1) {
		return {
			notation: 'O(n log n)',
			reason: maxDepth === 0
				? 'no explicit loop nesting; a library sort call dominates the cost'
				: '1 loop plus a library sort call; the sort dominates the cost',
		};
	}
	if (maxDepth <= 0) { return { notation: 'O(1)', reason: 'no loop or recursion constructs found' }; }
	if (maxDepth === 1) { return { notation: 'O(n)', reason: 'single loop over the input' }; }
	return { notation: `O(n^${maxDepth})`, reason: `${maxDepth} nested loops (max depth ${maxDepth})` };
}

/** Drop one confidence tier — `low` is already the floor. */
function downgrade(confidence: BigOConfidence): BigOConfidence {
	if (confidence === 'high') { return 'medium'; }
	return 'low';
}

/** Narrow an arbitrary `langId` to one this heuristic has a scanner for. */
function toSupportedLang(langId: string): SupportedLang | null {
	return isLangId(langId) ? langId : null;
}

// Re-exported so callers that only need the scan shape don't reach into helpers.
export type { LoopScanResult } from './leetcode-bigo.helpers.js';
