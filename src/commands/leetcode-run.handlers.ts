import * as vscode from 'vscode';
import { activeChallenge, claimSubmission, endChallenge, releaseSubmission } from '../services/leetcode-challenge.service.js';
import { buildExecutable, escapeRe } from '../services/leetcode-candidate.helpers.js';
import { closeExerciseEditor, deleteExerciseFile } from '../services/exercise-file.service.js';
import { detectRuntime, runSuite } from '../services/leetcode-runner.service.js';
import {
	publicCount,
	publicSuite,
	submitSuite,
	tagSuiteKinds,
} from '../services/leetcode-suite.helpers.js';
import { patchFrontmatterField } from '../services/frontmatter-patcher.service.js';
import { resolveLangId } from '../services/language-map.service.js';
import { functionNameFor } from '../services/leetcode-parser.service.js';
import { estimateBigO } from '../services/leetcode-bigo.service.js';
import { appendAttempt } from '../services/attempts-writer.service.js';
import { testEnvFor } from '../services/test-envs/env.registry.js';
import type { TestEnv } from '../services/test-envs/env.types.js';
import {
	renderBigOEstimateHtml,
	renderLeetCodePreviewHtml,
	renderTestResultsHtml,
} from '../ui/panels/leetcodePreview.panel.js';
import { FENCE } from '../types/constants.js';
import { isLangId, LANGUAGES, type LanguageConfig } from '../types/languages.js';
import type { AttemptEntry, BigOEstimate, ChallengePhase, LeetCodeStatus, TestResult } from '../types/leetcode.types.js';
import type { PanelCtx } from '../ui/views/leetcodeView.provider.js';

/**
 * Handle a `runTests` message — grade the **public** suite, change nothing.
 *
 * Deliberately not a variant of `handleSubmit`. Run Tests is the mid-challenge
 * feedback loop: it never writes frontmatter, never stops the clock, never
 * lifts the editor restrictions, and never touches the hidden final suite.
 *
 * There is no stored-solution fallback either — Run Tests grades the live
 * buffer or nothing. Without a live challenge the button renders `disabled`;
 * this guard exists because webview state drifts when the panel is disposed or
 * the challenge is ended from the command palette.
 *
 * The language is taken from the **live session**, not the webview: the panel
 * shows no language chooser mid-run, so the language is whatever Solve It
 * started, and grading must bind to the buffer that is actually open.
 *
 * @param ctx - Panel session state.
 *
 * @example
 * await handleRunTests(ctx);
 */
export async function handleRunTests(ctx: PanelCtx): Promise<void> {
	const session = activeChallenge();
	if (!session) {
		void vscode.window.showWarningMessage('Start the challenge with "Solve It" first.');
		return;
	}

	const setup = resolveRunSetup(ctx, session.langId);
	if (!setup) { return; }
	const { langId, lang, env } = setup;

	const code = await liveBuffer(session.fileUri);
	if (!await runtimeReady(lang, env)) { return; }

	const cases   = publicSuite(ctx.parsed);
	const source  = buildExecutable(ctx.parsed, langId, code);
	const results = tagSuiteKinds(await runSuite(source, cases, ctx.parsed, env), cases.length);
	postResults(ctx, results);

	if (results.length > 0 && results.every(r => r.passed)) {
		void vscode.window.showInformationMessage('All public tests pass — Submit when ready.');
	}
}

/**
 * Handle a `submit` message — grade public **and** final cases; one shot.
 *
 * The candidate source is the live text of the temp exercise file when a
 * challenge is running in this language, falling back to the artifact's stored
 * solution otherwise, so Submit still works when the panel is opened purely to
 * check in a solution already written into the `.md`.
 *
 * Outcomes:
 * - all pass → `status: solved`, meta comment, challenge ends
 * - any fail **during a live challenge** → `status: attempted`, challenge ends
 * - any fail with **no live challenge** → results only; a dry run against a
 *   stored solution must never downgrade a solved artifact
 *
 * Re-entrancy: when a live challenge backs this call, the session is claimed
 * via `claimSubmission` before any `await` runs (see that function's doc) —
 * this is what stops the timer's auto-submit (P4) and a manual click landing
 * in the same instant from grading and persisting the same run twice. A claim
 * that loses the race returns silently: the winning call is already carrying
 * this exact Submit through to completion.
 *
 * @param ctx      - Panel session state.
 * @param language - Language chosen in the panel.
 *
 * @example
 * await handleSubmit(ctx, 'python');
 */
export async function handleSubmit(ctx: PanelCtx, language: string | undefined): Promise<void> {
	// Claimed synchronously, before any `await` below — see the re-entrancy
	// note above. `liveSession` (not a fresh `activeChallenge()` call) is what
	// `wasLive` and `finishChallenge` both key off for the rest of this run.
	const liveSession = activeChallenge();
	// A live run's language is authoritative — the panel offers no chooser
	// mid-run, and there is only ever one session, so it is this exercise's.
	// `language` (the webview's marker/choice) is the fallback for a dry-run
	// Submit with no live challenge.
	const setup = resolveRunSetup(ctx, liveSession?.langId ?? language);
	if (!setup) { return; }
	const { langId, lang, env } = setup;

	const wasLive = liveSession !== null;
	if (wasLive && liveSession && !claimSubmission(liveSession)) { return; }

	const code = await candidateSource(ctx, langId);
	if (code === null) {
		void vscode.window.showErrorMessage(`No ${langId} attempt found. Press "Solve It" first.`);
		return;
	}
	if (!await runtimeReady(lang, env)) {
		// This attempt never reaches `finishChallenge` — release the claim so a
		// later retry (manual, after installing the runtime) is not blocked
		// forever by a session stuck mid-claim.
		if (wasLive && liveSession) { releaseSubmission(liveSession); }
		return;
	}

	const source  = buildExecutable(ctx.parsed, langId, code);
	const results = tagSuiteKinds(
		await runSuite(source, submitSuite(ctx.parsed), ctx.parsed, env),
		publicCount(ctx.parsed),
	);
	// Heuristic, not a verdict — computed once per Submit from the same buffer
	// that was graded, never from Run Tests. See leetcode-bigo.service.ts.
	const bigO = estimateBigO(code, langId, functionNameFor(ctx.parsed, langId));
	const html = renderTestResultsHtml(results) + renderBigOEstimateHtml(bigO);

	const allPassed = results.length > 0 && results.every(r => r.passed);
	const args = { ctx, langId, html, wasLive, code, bigO };
	if (allPassed)      { await finishChallenge({ ...args, status: 'solved' }); }
	else if (wasLive)   { await finishChallenge({ ...args, status: 'attempted' }); }
	else                { postResultsHtml(ctx, html); }
}

/**
 * Discard the run tied to `tempFileUri`: end the challenge, close its editor
 * tab, and delete its temp file.
 *
 * Backs the sidebar view's Back (idle) and Close (running, after confirmation)
 * controls — both roads lead here, since Back-while-idle must also sweep up a
 * stale attempt file left by an already-finished run. `null` when the exercise
 * has no attempt yet — nothing to discard.
 *
 * @param tempFileUri - URI of the attempt temp file to discard, or `null`.
 *
 * @example
 * await discardChallenge(ctx.attemptUri);
 */
export async function discardChallenge(tempFileUri: vscode.Uri | null): Promise<void> {
	await endChallenge();
	if (!tempFileUri) { return; }
	await closeExerciseEditor(tempFileUri);
	await deleteExerciseFile(tempFileUri);
}

// ── Preflight ─────────────────────────────────────────────────────────────────

/** Everything a run needs, once the language has been validated. */
interface RunSetup { langId: string; lang: LanguageConfig; env: TestEnv }

/**
 * Resolve the language to a `(runner, env)` pair, reporting why if impossible.
 *
 * A missing env means the artifact's `test.type` has no implementation for this
 * language — which the panel already prevents by filtering the selector, so
 * reaching the toast means the webview state drifted.
 *
 * @param ctx      - Panel session state.
 * @param language - Language chosen in the panel.
 * @returns The resolved setup, or `null` after showing an error.
 *
 * @example
 * resolveRunSetup(ctx, 'java');
 */
function resolveRunSetup(ctx: PanelCtx, language: string | undefined): RunSetup | null {
	if (!language) { return null; }
	const langId = resolveLangId(language);

	if (!isLangId(langId)) {
		void vscode.window.showErrorMessage(`Unsupported language: ${langId}.`);
		return null;
	}
	const lang = LANGUAGES[langId];

	const env = testEnvFor(ctx.parsed.test.type, langId);
	if (!env) {
		void vscode.window.showErrorMessage(
			`No ${ctx.parsed.test.type} test environment for ${langId}.`,
		);
		return null;
	}
	return { langId, lang, env };
}

/**
 * Confirm the toolchain is installed, and the env's own dependency when it
 * declares one.
 *
 * @param lang - Language config to probe via its `detectCmd`.
 * @param env  - Env whose optional `detect()` gates in addition.
 * @returns True when the suite can actually be executed.
 *
 * @example
 * await runtimeReady(LANGUAGES.python, pythonFunctionEnv);
 */
async function runtimeReady(lang: LanguageConfig, env: TestEnv): Promise<boolean> {
	if (!await detectRuntime(lang.detectCmd)) {
		void vscode.window.showErrorMessage(`Runtime not found. Install ${lang.displayName} to run tests.`);
		return false;
	}
	if (env.detect && !await env.detect()) {
		void vscode.window.showErrorMessage(
			`Missing test dependency for ${env.language}: ${(env.requires ?? []).join(', ')}.`,
		);
		return false;
	}
	return true;
}

// ── Candidate source ──────────────────────────────────────────────────────────

/** Read a document's live text — unsaved edits included — else its bytes on disk. */
async function liveBuffer(fileUri: vscode.Uri): Promise<string> {
	const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === fileUri.toString());
	if (open) { return open.getText(); }
	const bytes = await vscode.workspace.fs.readFile(fileUri);
	return new TextDecoder().decode(bytes);
}

/**
 * The source to test: the live attempt buffer, else a stored solution.
 *
 * @param ctx    - Panel session state.
 * @param langId - Canonical language id.
 * @returns Candidate source, or `null` when nothing is available.
 *
 * @example
 * await candidateSource(ctx, 'javascript');
 */
async function candidateSource(ctx: PanelCtx, langId: string): Promise<string | null> {
	const session = activeChallenge();
	if (session?.langId === langId) { return liveBuffer(session.fileUri); }

	const stored = ctx.parsed.solutions.find(s => resolveLangId(s.language) === langId);
	return stored ? stored.code : null;
}

// ── Finishing a challenge ─────────────────────────────────────────────────────

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
	/** Big-O estimate for this run — recorded alongside the attempt when `wasLive`. */
	bigO: BigOEstimate;
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
async function finishChallenge(args: FinishArgs): Promise<void> {
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
	/** Big-O estimate for this run — recorded alongside the attempt when `wasLive`. */
	bigO: BigOEstimate;
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
	const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri));

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
	duration: string | null, status: LeetCodeStatus, code: string, bigO: BigOEstimate,
): AttemptEntry {
	return {
		at:         new Date().toISOString(),
		duration:   duration ?? '0m0s',
		passed:     status === 'solved',
		bigO:       bigO.notation,
		confidence: bigO.confidence,
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
function postResultsHtml(ctx: PanelCtx, html: string): void {
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
