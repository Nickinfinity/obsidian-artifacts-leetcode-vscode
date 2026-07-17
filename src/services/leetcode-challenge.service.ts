import * as vscode from 'vscode';
import type { ChallengeState, ParsedLeetCode, PracticeConfig, TimerTick } from '../types/leetcode.types.js';
import { formatRemaining, timerTick } from './leetcode-challenge.helpers.js';
import { openExerciseFile } from './exercise-file.service.js';
import { LeetCodeTimer } from './leetcode-timer.service.js';
import { PracticeMode } from './practice-mode.service.js';

/** Command that tears the active challenge down and restores editor settings. */
export const END_CHALLENGE_COMMAND = 'obsidian-leetcode.endChallenge';

/** Status-bar refresh cadence for the timer. */
const TICK_MS = 1000;

/**
 * A live challenge run: one temp file, one set of editor restrictions, one
 * timer (always running, bounded or unlimited).
 *
 * Only one may be active per window — `startChallenge()` ends any predecessor
 * before starting a new run, so editor settings are always restored from the
 * snapshot taken by the run that wrote them.
 */
export interface ChallengeSession {
	/** Canonical `languageId` the run was started in */
	langId: string;
	/** URI of the temp exercise file opened in the main editor group */
	fileUri: vscode.Uri;
	/** Stopwatch used to stamp `duration` into the solution metadata on Submit */
	timer: LeetCodeTimer;
	/** Snapshot-owning practice-mode applier */
	practice: PracticeMode;
	/** Status-bar clock entry — set by every run, bounded or unlimited (P7) */
	statusBar: vscode.StatusBarItem | null;
	/** Handle of the timer's tick interval — set by every run (P7) */
	ticker: ReturnType<typeof setInterval> | null;
	/** Epoch-ms at which the time limit expires; `null` when unlimited */
	deadline: number | null;
	/** Data slice describing this run for the sidebar view (and P3/P4) */
	state: ChallengeState;
	/**
	 * Set once a Submit — manual or timer-expiry — has claimed this session.
	 * Guards the re-entrancy race between the two: see `claimSubmission`.
	 */
	finishing: boolean;
}

/**
 * Per-tick and on-expiry hooks a caller may supply to `startChallenge`.
 *
 * The challenge service owns the countdown's timing but never the webview or
 * the grading path — both would create a dependency this repo forbids (the
 * run handlers already import this service; a back-import would cycle). The
 * caller (the sidebar view provider) closes over its own `WebviewView` and
 * `PanelCtx` and supplies these as plain callbacks instead.
 */
export interface ChallengeCallbacks {
	/**
	 * Invoked roughly once a second while the timer runs, with the current
	 * `TimerTick` — bounded (`unlimited: false`, `ms` remaining, clamped to
	 * `0` on the terminal tick) or unlimited (`unlimited: true`, `ms` elapsed,
	 * counting up forever). The typical implementation posts a
	 * `{ command: 'tick', unlimited, ms }` message to the live webview — never
	 * a `webview.html` reassignment, which would restart the webview and kill
	 * the timer mid-run.
	 */
	onTick?: (tick: TimerTick) => void;
	/**
	 * Invoked exactly once, when the countdown reaches zero and this call has
	 * won the `claimSubmission` race. The typical implementation runs the same
	 * `handleSubmit` a manual click uses, so auto-submit is never a second
	 * grading path.
	 */
	onExpire?: () => void;
}

/** The single in-flight session, or `null` when no challenge is running. */
let active: ChallengeSession | null = null;

/**
 * Start a challenge: open the starter file, apply editor restrictions, and
 * begin the timer — bounded countdown when `config.timeLimitMinutes > 0`,
 * unlimited count-up otherwise (P7; the timer now always runs).
 *
 * Ends any session already in flight first — restoring its settings — so a
 * second *Solve It* press never leaves the previous snapshot stranded.
 *
 * @param context     - Extension context owning `globalStorageUri`.
 * @param exerciseUri - URI of the `.md` artifact this run is for.
 * @param parsed      - Parsed artifact supplying the title and starter code.
 * @param langId      - Canonical `languageId` the user picked.
 * @param config      - Practice options and time limit for this run.
 * @param callbacks   - Optional per-tick / on-expiry hooks (P4/P7) — see `ChallengeCallbacks`.
 * @returns The newly started session.
 *
 * @example
 * await startChallenge(ctx, exerciseUri, parsed, 'javascript', { options: ['noAiAgents'], timeLimitMinutes: 30, locked: false }, {
 *   onTick: (tick) => view.webview.postMessage({ command: 'tick', unlimited: tick.unlimited, ms: tick.ms }),
 *   onExpire: () => handleSubmit(panelCtx, 'javascript'),
 * });
 */
export async function startChallenge(
	context: vscode.ExtensionContext,
	exerciseUri: vscode.Uri,
	parsed: ParsedLeetCode,
	langId: string,
	config: PracticeConfig,
	callbacks: ChallengeCallbacks = {},
): Promise<ChallengeSession> {
	await endChallenge();

	const fileUri = await openExerciseFile(context, parsed, langId);

	const practice = new PracticeMode();
	await practice.apply(config.options);

	const timer = new LeetCodeTimer();
	timer.start();

	const state: ChallengeState = {
		exerciseUri: exerciseUri.toString(),
		title: parsed.title,
		langId,
		tempFileUri: fileUri.toString(),
		editorOpen: true,
		options: config.options,
		timeLimitMinutes: config.timeLimitMinutes,
		startedAt: Date.now(),
		deadline: null,
		phase: 'running',
	};

	const session: ChallengeSession = {
		langId, fileUri, timer, practice, finishing: false,
		statusBar: null, ticker: null, deadline: null, state,
	};

	startTimer(session, parsed.title, config.timeLimitMinutes, callbacks);

	active = session;
	return session;
}

/**
 * Tear down the active challenge: restore editor settings, stop the countdown.
 *
 * Safe to call when nothing is running — used both by the explicit
 * `obsidian-leetcode.endChallenge` command and by the preview panel's dispose
 * handler.
 *
 * @returns Resolves once every setting has been written back.
 *
 * @example
 * await endChallenge();
 */
export async function endChallenge(): Promise<void> {
	if (!active) { return; }
	const session = active;
	active = null;

	if (session.ticker)    { clearInterval(session.ticker); }
	if (session.statusBar) { session.statusBar.dispose(); }
	if (session.timer.isRunning()) { session.timer.reset(); }
	await session.practice.restore();
}

/** The in-flight session, or `null`. */
export function activeChallenge(): ChallengeSession | null { return active; }

/**
 * The data slice of the in-flight session, or `null` when idle.
 *
 * The returned object is the session's live `state`, not a copy — mutating
 * `editorOpen` (the P1.5-5 tab watcher) is visible to every other reader.
 *
 * @returns The current `ChallengeState`, or `null` when no challenge is running.
 *
 * @example
 * challengeState()?.phase; // → 'running'
 */
export function challengeState(): ChallengeState | null { return active?.state ?? null; }

/**
 * Atomically claim the right to grade-and-finish `session` via Submit.
 *
 * Guards the re-entrancy race between a manual Submit click and the timer's
 * auto-submit landing at the same instant. `expire()` (a synchronous timer
 * callback) and `handleSubmit`'s synchronous prefix — everything before its
 * first `await` — each call this before doing any grading work. JS never
 * interleaves two synchronous stretches on the same thread, so whichever call
 * runs first flips `finishing` and wins; the other observes `true` already
 * set and must bail without running the suite a second time.
 *
 * @param session - The live session a Submit is about to run against.
 * @returns `true` when this call claimed the session (proceed); `false` when
 *   another call already claimed it (bail out — it is already being handled).
 *
 * @example
 * if (!claimSubmission(session)) { return; } // already submitting elsewhere
 */
export function claimSubmission(session: ChallengeSession): boolean {
	if (session.finishing) { return false; }
	session.finishing = true;
	return true;
}

/**
 * Release a claim taken by `claimSubmission` when that Submit attempt aborts
 * before it reaches `finishChallenge` — a missing runtime, for instance.
 *
 * Without this, a claimed-then-aborted attempt would leave `finishing: true`
 * on a session that is still `active`, permanently blocking every later
 * Submit for that run (manual or a still-pending auto-submit) even after the
 * user fixes whatever made this attempt bail.
 *
 * @param session - The session whose claim should be released.
 *
 * @example
 * if (!await runtimeReady(runner, env)) { releaseSubmission(session); return; }
 */
export function releaseSubmission(session: ChallengeSession): void {
	session.finishing = false;
}

// ── Timer ─────────────────────────────────────────────────────────────────────

/**
 * Attach a status-bar timer to `session` and, when bounded, arm the expiry
 * action.
 *
 * Runs unconditionally (P7) — every challenge gets a clock, not just the ones
 * with a positive `practice.timeLimit`. `minutes > 0` yields a bounded
 * countdown (`deadline` set, ticks down, auto-submits at zero); `minutes <= 0`
 * yields an unlimited count-up (`deadline` stays `null`, never expires). Both
 * modes tick through the same pure `timerTick()` decision and the same
 * `callbacks.onTick` (P4/P7) hook a caller uses to mirror the clock into the
 * webview's in-view header via `postMessage` — this function never touches a
 * webview itself, only the status-bar item and the session's own state.
 *
 * @param session   - Session to attach the timer to (mutated in place).
 * @param title     - Problem title, shown in the expiry notification.
 * @param minutes   - Time limit in minutes; `<= 0` means unlimited.
 * @param callbacks - Optional per-tick / on-expiry hooks; see `ChallengeCallbacks`.
 *
 * @example
 * startTimer(session, 'Two Sum', 30, { onTick: (t) => console.log(t.ms) });
 * startTimer(session, 'Two Sum', 0, { onTick: (t) => console.log(t.unlimited) });
 */
function startTimer(
	session: ChallengeSession, title: string, minutes: number, callbacks: ChallengeCallbacks,
): void {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	item.command = END_CHALLENGE_COMMAND;
	item.tooltip = `LeetCode: ${title} — click to end the challenge`;
	item.show();

	session.statusBar = item;
	session.deadline  = minutes > 0 ? Date.now() + minutes * 60_000 : null;
	session.state.deadline = session.deadline;

	const tick = (): void => {
		const startedAt = session.state.startedAt ?? Date.now();
		const t = timerTick(startedAt, session.deadline, Date.now());
		callbacks.onTick?.(t);

		item.text = t.unlimited
			? `$(watch) ${formatRemaining(t.ms)} · no limit`
			: `$(watch) ${formatRemaining(t.ms)}`;

		if (!t.unlimited && t.ms <= 0) {
			expire(session, item, title, callbacks.onExpire);
		}
	};

	tick();
	session.ticker = setInterval(tick, TICK_MS);
}

/**
 * Freeze the countdown at zero and either auto-submit or warn-only.
 *
 * Only ever called for a **bounded** run (`startTimer` gates the `expire`
 * call on `!t.unlimited && t.ms <= 0`) — an unlimited count-up never reaches
 * this function. Clears the ticker and deadline unconditionally — the clock
 * stops either way — then *peeks* (never claims) `finishing`: a manual Submit
 * already mid-flight owns the session, so expiry stands down (no double
 * warning, no double submit). It must **not** call `claimSubmission` here —
 * the delegated `handleSubmit` claims for itself, and stealing the claim
 * first would make that submit bail on its own claim check and never grade.
 *
 * @param session  - The expiring session.
 * @param item     - Its status-bar item, updated to the terminal "time up" state.
 * @param title    - Problem title, shown in the notification.
 * @param onExpire - Optional auto-submit hook from `ChallengeCallbacks`; a
 *   warn-only notification is shown when absent (defensive fallback for a
 *   caller that has not wired one up).
 */
function expire(session: ChallengeSession, item: vscode.StatusBarItem, title: string, onExpire?: () => void): void {
	if (session.ticker) { clearInterval(session.ticker); }
	session.ticker   = null;
	session.deadline = null;
	session.state.deadline = null;

	if (session.finishing) { return; }

	item.text = '$(watch) time up';
	item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

	if (onExpire) {
		void vscode.window.showWarningMessage(`Time is up for "${title}" — auto-submitting.`);
		onExpire();
	} else {
		void vscode.window.showWarningMessage(`Time is up for "${title}".`);
	}
}
