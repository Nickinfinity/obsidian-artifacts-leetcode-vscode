import * as vscode from 'vscode';
import { activeChallenge, endChallenge } from '../services/leetcode-challenge.service.js';
import { appendAttempt } from '../services/attempts-writer.service.js';
import { patchFrontmatterField } from '../services/frontmatter-patcher.service.js';
import { estimateBigO } from '../services/leetcode-bigo.service.js';
import { functionNameFor } from '../services/leetcode-parser.service.js';
import { escapeRe } from '../services/leetcode-candidate.helpers.js';
import {
	renderBigOEstimateHtml,
	renderLeetCodePreviewHtml,
	renderTestResultsHtml,
} from '../ui/panels/leetcodePreview.panel.js';
import { FENCE } from '../types/constants.js';
import type { AttemptEntry, BigOEstimate, ChallengePhase, LeetCodeStatus, TestResult } from '../types/leetcode.types.js';
import type { PanelCtx } from '../ui/views/leetcodeView.provider.js';

/**
 * Read a `.md` artifact's raw bytes from disk, decoded as UTF-8 — always the
 * saved file, never the live editor buffer (unlike `liveBuffer`). Used by
 * `persistOutcome`'s read-patch-write and by `projectRunAllowed`'s R2 check.
 *
 * @param fileUri - The artifact on disk.
 * @returns Its full text.
 *
 * @example
 * await readArtifactContent(ctx.fileUri);
 */
export async function readArtifactContent(fileUri: vscode.Uri): Promise<string> {
	return new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri));
}

/**
 * Ending a run and telling the webview about it — the two halves of "the
 * challenge is over" that every Submit path shares.
 *
 * Split out of `leetcode-run.handlers.ts` in wave 2.D, which took that file to
 * 756 lines (`CLAUDE.md`: past 700, split **before** adding more). The seam is
 * real rather than arithmetic: nothing here decides *what* to grade or *how* —
 * it persists an already-decided outcome and posts it, so it imports nothing
 * back from the handlers and the dependency runs one way.
 */


/** Everything `finishChallenge` needs to persist a terminal Submit outcome. */
interface FinishArgs {
	/** Panel session state. */
	ctx: PanelCtx;
	/** Canonical language id — locates the solution fence and the `## <Language>` attempt heading. */
	langId: string;
	/** Rendered results table (plus Big-O line) to seed into the re-rendered panel. */
	html: string;
	/** Terminal status to write into the artifact's frontmatter. */
	status: LeetCodeStatus;
	/** Whether this Submit graded a live challenge buffer — gates the P6 attempt-history write. */
	wasLive: boolean;
	/** The submitted buffer, verbatim — recorded as the attempt's code when `wasLive`. */
	code: string;
	/**
	 * Big-O estimate for this run — recorded alongside the attempt when `wasLive`.
	 *
	 * `null` for a `project` submit: the heuristic reads one candidate function,
	 * and a project is a component tree, so a notation would be noise dressed as
	 * analysis. `AttemptEntry` already treats it as optional.
	 */
	bigO: BigOEstimate | null;
}

/**
 * End the run, persist the outcome, and re-render the panel with its results.
 *
 * The results HTML is seeded into the fresh document rather than posted after
 * it: reassigning `webview.html` restarts the webview, and a `postMessage` into
 * one that is still booting can be dropped.
 *
 * @param args - See `FinishArgs`.
 *
 * @example
 * await finishChallenge({ ctx, langId: 'python', html, status: 'solved', wasLive: true, code, bigO });
 */
export async function finishChallenge(args: FinishArgs): Promise<void> {
	const { ctx, langId, html, status, wasLive, code, bigO } = args;
	const session = activeChallenge();
	const duration = session?.timer.isRunning() ? session.timer.stop() : null;

	await endChallenge();
	postChallengeState(ctx, false);

	await persistOutcome({ fileUri: ctx.fileUri, langId, status, duration, wasLive, code, bigO });

	ctx.parsed.status = status;
	// `status` here is always 'solved' or 'attempted' — the two terminal
	// outcomes finishChallenge is ever called with — so it maps 1:1 onto the
	// matching ChallengePhase.
	const phase: ChallengePhase = status === 'solved' ? 'solved' : 'attempted';
	postViewState(ctx, phase);
	ctx.panel.webview.html = renderLeetCodePreviewHtml(
		ctx.parsed, ctx.cssUris, ctx.panel.webview.cspSource, html, phase,
	);
}

/** Everything `persistOutcome` needs for its single read-patch-write. */
interface PersistOutcomeArgs {
	/** Path to the `.md` artifact. */
	fileUri: vscode.Uri;
	/** Canonical language id whose solution/attempt heading is targeted. */
	langId: string;
	/** Terminal status to write. */
	status: LeetCodeStatus;
	/** `XmYs` timer result, or `null` when no challenge was timed. */
	duration: string | null;
	/** Whether an attempt-history entry should be recorded (never for a dry-run Submit). */
	wasLive: boolean;
	/** The submitted buffer, verbatim — recorded as the attempt's code when `wasLive`. */
	code: string;
	/** Big-O estimate for this run, or `null` when the shape has none (a project). */
	bigO: BigOEstimate | null;
}

/**
 * Persist the terminal outcome of a Submit in **one** read-patch-write.
 *
 * `status` (+ the `<!-- meta: … -->` duration comment on a solve) and the P6
 * `# Attempts` entry both live in the same `.md` file — reading it once,
 * applying both patches to the in-memory string, and writing once avoids the
 * double-`writeFile` race the two concerns would otherwise create if each
 * patch read-modified-wrote independently.
 *
 * A dry-run Submit never reaches here (the caller only invokes
 * `finishChallenge` when `wasLive`, or when all cases passed with no live
 * challenge it skips `finishChallenge` entirely) — `wasLive` gates the attempt
 * write regardless, so a future caller cannot accidentally record one.
 *
 * @param args - See `PersistOutcomeArgs`.
 *
 * @example
 * await persistOutcome({ fileUri, langId: 'python', status: 'solved', duration: '3m12s', wasLive: true, code, bigO });
 */
async function persistOutcome(args: PersistOutcomeArgs): Promise<void> {
	const { fileUri, langId, status, duration, wasLive, code, bigO } = args;
	const raw = await readArtifactContent(fileUri);

	let next = patchFrontmatterField(raw, 'status', status);
	if (status === 'solved') { next = insertSolvedMeta(next, langId, duration); }
	if (wasLive) { next = appendAttempt(next, langId, buildAttemptEntry(duration, status, code, bigO)); }

	await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(next));
}

/**
 * Insert the `<!-- meta: { "solved_at": …, "duration": … } -->` comment
 * immediately before the first fenced code block for `language`.
 *
 * Pure string patch — no I/O — so `persistOutcome` can apply it against the
 * same in-memory `raw` the status and attempt patches also touch. An artifact
 * with no such fence, or no timed duration, is returned unchanged.
 *
 * @param raw      - Full `.md` content, already carrying the new `status:` field.
 * @param language - Language id whose solution receives the meta comment.
 * @param duration - `XmYs` timer result, or `null` when no challenge was timed.
 * @returns The patched content.
 *
 * @example
 * insertSolvedMeta(raw, 'python', '3m12s');
 */
function insertSolvedMeta(raw: string, language: string, duration: string | null): string {
	if (!duration) { return raw; }
	const meta = `<!-- meta: { "solved_at": "${new Date().toISOString()}", "duration": "${duration}" } -->`;
	const fenceRe = new RegExp(String.raw`(^|\n)(${FENCE}${escapeRe(language)}\r?\n)`);
	const m = fenceRe.exec(raw);
	if (!m) { return raw; }
	const insertAt = m.index + m[1].length;
	return `${raw.slice(0, insertAt)}${meta}\n${raw.slice(insertAt)}`;
}

/**
 * Build the `AttemptEntry` payload for `appendAttempt` from a finished
 * Submit's results.
 *
 * @param duration - `XmYs` timer result; falls back to `'0m0s'` in the
 *   unexpected case where `finishChallenge` was reached with no running timer
 *   — `wasLive` implies a challenge session started the timer, so this is a
 *   defensive default, not the common path.
 * @param status   - Terminal status this Submit produced.
 * @param code     - The submitted buffer, verbatim.
 * @param bigO     - Big-O estimate computed from the same buffer.
 * @returns The entry to append.
 *
 * @example
 * buildAttemptEntry('8m22s', 'solved', code, bigO);
 */
function buildAttemptEntry(
	duration: string | null, status: LeetCodeStatus, code: string, bigO: BigOEstimate | null,
): AttemptEntry {
	return {
		at:         new Date().toISOString(),
		duration:   duration ?? '0m0s',
		passed:     status === 'solved',
		// Omitted, not defaulted: a fabricated `O(1)` would read as a measurement.
		...(bigO ? { bigO: bigO.notation, confidence: bigO.confidence } : {}),
		code,
	};
}

// ── Webview messaging ─────────────────────────────────────────────────────────

/** Post a rendered results table into the panel's results sink. */
export function postResults(ctx: PanelCtx, results: TestResult[]): void {
	void ctx.panel.webview.postMessage({
		command: 'testResults',
		html:    renderTestResultsHtml(results),
	});
}

/**
 * Post an already-rendered results sink fragment verbatim.
 *
 * Used by a dry-run Submit (no live challenge — grading a stored solution),
 * whose fragment already carries the Big-O line alongside the results table;
 * re-deriving it from `results` via `postResults` would drop that line.
 *
 * @param ctx  - Panel session state.
 * @param html - Pre-rendered results sink fragment.
 *
 * @example
 * postResultsHtml(ctx, renderTestResultsHtml(results) + renderBigOEstimateHtml(bigO));
 */
export function postResultsHtml(ctx: PanelCtx, html: string): void {
	void ctx.panel.webview.postMessage({ command: 'testResults', html });
}

/** Tell the webview whether a challenge is live, so it can gate the Run Tests button. */
export function postChallengeState(ctx: PanelCtx, active: boolean): void {
	void ctx.panel.webview.postMessage({ command: 'challengeState', active });
}

/**
 * Tell the webview which `ChallengeState['phase']` it is now in.
 *
 * Coexists with `challengeState` rather than replacing it — `challengeState`
 * still drives the `editorOpen`-gated Run Tests toggle wired in the sidebar
 * view provider. `viewState` is the newer, more general lifecycle signal; a
 * future pass can retire `challengeState` once the webview script drives its
 * DOM purely off `viewState`, but that touches the in-page toggle logic and is
 * out of scope here — today's transitions still go through a full
 * `webview.html` re-render, and this message is a forward-compatible hook.
 *
 * @param ctx   - Panel session state.
 * @param phase - The phase the panel has just transitioned to.
 *
 * @example
 * postViewState(ctx, 'solved');
 */
export function postViewState(ctx: PanelCtx, phase: ChallengePhase): void {
	void ctx.panel.webview.postMessage({ command: 'viewState', phase });
}
