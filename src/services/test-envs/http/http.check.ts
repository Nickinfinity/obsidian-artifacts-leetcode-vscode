import { MAX_SUITE_TIMEOUT_MS, MIN_TEST_TIMEOUT_MS } from '../../../types/constants.js';
import type { ProjectCheckOutcome } from '../../../types/leetcode.types.js';
import { suiteTimeout } from '../../leetcode-runner.service.js';
import type { PackageSpec } from '../../packages-parser.helpers.js';
import { MAX_HTTP_BODY_BYTES, parseHttpCase, runHttpCase, type HttpCase } from './http-case.helpers.js';
import { bootServer, type BootOptions } from './server.lifecycle.js';

/**
 * The `http` check kind (T3.4, VSX-122 §G): boot one `packages:` server
 * **once**, fire every case in the check against it, and grade the result
 * into the same {@link ProjectCheckOutcome} shape every other check kind
 * produces.
 *
 * **`leetcode.types.ts` has no `HttpCheck` yet.** The parser still drops
 * `kind: http` as unimplemented (`RESERVED_KINDS`, `project-parser.helpers
 * .ts`), so nothing constructs one today. {@link HttpCheckInput} is this
 * module's own input shape — the orchestrator or T3.5 lands the real
 * `HttpCheck extends ProjectCheckBase` and wires dispatch; see the worker
 * report for the exact hunks this task is not allowed to make itself.
 *
 * **One boot, not one per case.** {@link bootServer} is called exactly once
 * per {@link runHttpCheck} call; every case in `check.cases` runs against
 * that single running server, the same shape as a `function` check
 * compiling once and running every case against the resulting binary
 * (`runSuite`) — never a compile, or here a boot, per case.
 *
 * **Two budgets, mirroring `program.runner.ts`'s own two-budget comment.**
 * Each request is killed on its own clock (T3.2's `AbortSignal.timeout` in
 * `runHttpCase`) — that is what makes any of this safe, see below. On top of
 * that, the **whole check** has a wall-clock ceiling: `suiteTimeout(cases
 * .length, clampedPerCase)` — imported from `leetcode-runner.service.ts`,
 * not reimplemented. (`make-program-env.ts` computes its own budget the same
 * *shape* but not the same formula: `programSuiteTimeout` adds a per-process
 * spawn allowance and caps higher, because a `program` case pays a process
 * start this one does not.) It is armed **after** `bootServer` returns so boot's own
 * `BOOT_TIMEOUT_MS` is never charged against it. Per-case budgets alone
 * bound nothing in total — a 40-case check at the per-case ceiling is 40
 * minutes with no suite deadline at all — and `MAX_SUITE_TIMEOUT_MS` caps it
 * the same way it caps every other suite. A case that cannot run inside
 * what is left is reported by name (`suite timeout — …`), never silently
 * dropped, so the check fails closed rather than reading a truncated run as
 * green — `runCasesAgainst` checks the deadline **before** attempting each
 * case, and clips whatever request it does attempt to `min(clampedPerCase,
 * remaining)`.
 *
 * **The budget excludes boot, and that is only sound because of T3.2.**
 * Excluding boot from the request-loop budget is safe only because every
 * individual request the loop issues is *already* bounded by
 * `runHttpCase`'s own `AbortSignal.timeout` (T3.2, S11) — remove that bound
 * and "excluding boot" quietly means "unbounded", because nothing else in
 * this loop would ever stop it on its own.
 *
 * **C27(b) — both halves closed here, not in T3.2's case shape.**
 * (a) `timeoutMs` is clamped to `[MIN_TEST_TIMEOUT_MS, MAX_SUITE_TIMEOUT_MS]`
 * before it ever reaches `runHttpCase`'s `AbortSignal.timeout`.
 * **`leetcode-parser.helpers.ts`'s `parseTimeoutMs` already clamps
 * `parsed.test.timeoutMs` to this exact same range at parse time** — this
 * is a second, deliberately redundant clamp, not a missed dedupe: a direct
 * caller of this module (a unit test, a future non-parsed entry point) can
 * pass anything, and this module must not assume the parse-time path ran.
 * Keep both; the parse-time clamp is the common case's protection, this one
 * is the module's own contract regardless of caller.
 * (b) the request body is capped against the very same `MAX_HTTP_BODY_BYTES`
 * T3.2 already enforces on the response — checked here, before a request is
 * ever sent, deliberately **not** added to `http-case.helpers.ts` itself
 * (out of this task's `Owns`). Reusing its exported constant keeps the
 * request cap and the response cap as one number, not two that could drift.
 */

/**
 * This module's own input shape for one `http` check — see the module doc
 * for why `leetcode.types.ts` has no `HttpCheck` yet.
 */
export interface HttpCheckInput {
	/** Unique within the artifact — echoed onto the outcome, same as every other check kind. */
	readonly name: string;
	/**
	 * Raw case data, one entry per bound `## Tests` / `## Final Tests` fence.
	 * Parsed here via {@link parseHttpCase}; the public/final boundary is
	 * never decided in this module — a caller slices to `publicCount` first,
	 * exactly as `publicCasesOf` already does for every other check kind
	 * (`project.runner.ts`), so this array is graded exactly as received.
	 */
	readonly cases: readonly unknown[];
}

/**
 * C27(b)(a): re-clamp `timeoutMs` to the bound every other suite's per-case
 * budget already uses.
 *
 * **`NaN` is floored, not passed through**, and that guard is exactly as
 * load-bearing as this function's stated reason for existing. `Math.min`/
 * `Math.max` both propagate `NaN`, so an unclamped `NaN` makes
 * `remaining <= 0` false forever and **silently disables the suite deadline**
 * — the one thing this module's round-1 fix exists to provide. It fails
 * closed today (`AbortSignal.timeout(NaN)` throws a `RangeError` that
 * `runHttpCase` catches, so every case reports `request failed`), and it is
 * unreachable through `parseTimeoutMs`. But "a direct caller can pass
 * anything" is precisely why this second clamp is here at all, so it may not
 * assume a number it was handed is finite.
 */
function clampTimeoutMs(timeoutMs: number): number {
	if (!Number.isFinite(timeoutMs)) { return MIN_TEST_TIMEOUT_MS; }
	return Math.min(Math.max(timeoutMs, MIN_TEST_TIMEOUT_MS), MAX_SUITE_TIMEOUT_MS);
}

/**
 * C27(b)(b): the request body, capped against the same bound the response
 * already obeys — measured on exactly what `fetchInit` will send, since both
 * call `JSON.stringify(body)`.
 *
 * A body that cannot be serialised at all (circular, a `BigInt`) counts as
 * refused rather than throwing: an uncaught throw here escapes the
 * `Promise<ProjectCheckOutcome>` contract the way T2.8's hostile case data
 * escaped `claimSubmission`, and a check must fail its case by name instead.
 * Unreachable from a YAML/JSON fence, which cannot express either — this is
 * the direct-caller boundary again.
 */
function requestBodyTooLarge(httpCase: HttpCase): boolean {
	if (httpCase.request.body === undefined) { return false; }
	try {
		return Buffer.byteLength(JSON.stringify(httpCase.request.body), 'utf8') > MAX_HTTP_BODY_BYTES;
	} catch {
		return true;
	}
}

/**
 * Run one `http` check end to end: boot `pkg`, grade every case against it in
 * order, and tear the server down on every path out of this function —
 * every case passing, a case failing, a case that does not even parse, boot
 * never becoming ready, or the suite running out of budget.
 *
 * First failure wins, the same verdict shape `gradeRenderOutcomes`
 * (`test-envs/project/checks.ts`) already produces — one
 * {@link ProjectCheckOutcome} for the whole check, not one per case.
 *
 * @param check     - The check's name and raw case data.
 * @param pkg       - The `packages:` entry this check's requests target —
 *   resolved by name to a `PackageSpec` by whoever calls this (T3.5); this
 *   module only boots the spec it is handed.
 * @param runDir    - Run directory `pkg.dir` resolves inside — passed straight to `bootServer`.
 * @param timeoutMs - Per-request budget before clamping (typically `parsed.test.timeoutMs`).
 * @param bootOpts  - Passed through to `bootServer` verbatim — the `mintPort` test seam included.
 *   **Omitting `registry` forfeits `endChallenge()` teardown (S12):** the `finally` below
 *   covers a run that ends, but only a registered group is killed when VS Code exits or the
 *   panel is disposed mid-check. T3.5 is the enforcement point — it must thread the session's
 *   registry through here.
 * @param now       - Clock injection — a test-only seam, the same spirit as
 *   `bootOpts.mintPort`, so the suite-deadline path can be pinned without a
 *   real multi-second (or, past the `MAX_SUITE_TIMEOUT_MS` cap, multi-minute)
 *   wait. Production callers omit it; `Date.now` is the real clock.
 * @returns One verdict for the whole check.
 *
 * @example
 * await runHttpCheck({ name: 'health', cases: [{ request: { method: 'GET', path: '/health' }, expect: { status: 200 } }] }, pkg, runDir, 5000);
 * // → { name: 'health', passed: true }
 */
export async function runHttpCheck(
	check: HttpCheckInput, pkg: PackageSpec, runDir: string, timeoutMs: number, bootOpts: BootOptions = {},
	now: () => number = Date.now,
): Promise<ProjectCheckOutcome> {
	if (check.cases.length === 0) {
		return { name: check.name, passed: false, detail: 'http check declares no cases' };
	}

	const boot = await bootServer(pkg, runDir, bootOpts);
	if (!boot.ok) {
		return { name: check.name, passed: false, detail: `server never started: ${boot.reason}` };
	}

	try {
		// Armed here, deliberately: after `bootServer` has already returned, so
		// boot's own (separate, much larger) `BOOT_TIMEOUT_MS` budget is never
		// charged against this one — see the module doc.
		return await runCasesAgainst(check, boot.server.port, clampTimeoutMs(timeoutMs), now);
	} finally {
		// Owns the boot, owns killing it — every path above reaches this,
		// including a case that threw past the try in `runCasesAgainst`.
		await boot.server.stop();
	}
}

/** The request loop itself, isolated so `runHttpCheck`'s `finally` covers every exit from it. */
async function runCasesAgainst(
	check: HttpCheckInput, port: number, clampedPerCase: number, now: () => number,
): Promise<ProjectCheckOutcome> {
	const deadline = now() + suiteTimeout(check.cases.length, clampedPerCase);

	for (const [index, raw] of check.cases.entries()) {
		const remaining = deadline - now();
		// Checked before anything about this case is even parsed: a case that
		// cannot run inside what is left must be reported by name, never
		// silently dropped — the same rule `program.runner.ts` enforces for its
		// own suite deadline, and for the same reason (a truncated run must
		// never read as an empty, green tail).
		if (remaining <= 0) {
			return {
				name: check.name, passed: false,
				detail: `case ${index}: suite timeout — the whole http check exceeded its budget`,
			};
		}

		const parsed = parseHttpCase(raw);
		if (!parsed.ok) {
			return { name: check.name, passed: false, detail: `case ${index}: ${parsed.reason}` };
		}
		if (requestBodyTooLarge(parsed.case)) {
			return {
				name: check.name, passed: false,
				detail: `case ${index}: request body exceeded the ${MAX_HTTP_BODY_BYTES}-byte limit (C27b)`,
			};
		}

		// Sequential, deliberately: one process serves every case in order —
		// concurrent requests would race the same server for no benefit the plan asks for.
		// Clipped to what the suite has left (mirrors program.runner.ts's own
		// per-case clip): below the `MAX_SUITE_TIMEOUT_MS` cap this never
		// actually shrinks a request below `clampedPerCase`, because each
		// case's fair share sums exactly to the total — it only binds once the
		// cap has already reduced the suite budget below `cases.length ×
		// clampedPerCase`.
		const result = await runHttpCase(parsed.case, port, Math.min(clampedPerCase, remaining));
		if (!result.passed) {
			return { name: check.name, passed: false, detail: `case ${index}: ${result.detail ?? 'request failed'}` };
		}
	}
	return { name: check.name, passed: true };
}
