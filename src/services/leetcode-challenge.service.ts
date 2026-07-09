import * as vscode from 'vscode';
import type { ParsedLeetCode, PracticeConfig } from '../types/leetcode.types.js';
import { openExerciseFile } from './exercise-file.service.js';
import { LeetCodeTimer } from './leetcode-timer.service.js';
import { PracticeMode } from './practice-mode.service.js';

/** Command that tears the active challenge down and restores editor settings. */
export const END_CHALLENGE_COMMAND = 'obsidian-leetcode.endChallenge';

/** Status-bar refresh cadence for the countdown. */
const TICK_MS = 1000;

/**
 * A live challenge run: one temp file, one set of editor restrictions, one
 * countdown.
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
	/** Countdown status-bar entry, when a time limit was set */
	statusBar: vscode.StatusBarItem | null;
	/** Handle of the countdown interval, when a time limit was set */
	ticker: ReturnType<typeof setInterval> | null;
	/** Epoch-ms at which the time limit expires; `null` when unlimited */
	deadline: number | null;
}

/** The single in-flight session, or `null` when no challenge is running. */
let active: ChallengeSession | null = null;

/**
 * Start a challenge: open the starter file, apply editor restrictions, and
 * begin the countdown.
 *
 * Ends any session already in flight first — restoring its settings — so a
 * second *Solve It* press never leaves the previous snapshot stranded.
 *
 * @param context - Extension context owning `globalStorageUri`.
 * @param parsed  - Parsed artifact supplying the title and starter code.
 * @param langId  - Canonical `languageId` the user picked.
 * @param config  - Practice options and time limit for this run.
 * @returns The newly started session.
 *
 * @example
 * await startChallenge(ctx, parsed, 'javascript', { options: ['noAiAgents'], timeLimitMinutes: 30, locked: false });
 */
export async function startChallenge(
	context: vscode.ExtensionContext,
	parsed: ParsedLeetCode,
	langId: string,
	config: PracticeConfig,
): Promise<ChallengeSession> {
	await endChallenge();

	const fileUri = await openExerciseFile(context, parsed, langId);

	const practice = new PracticeMode();
	await practice.apply(config.options);

	const timer = new LeetCodeTimer();
	timer.start();

	const session: ChallengeSession = {
		langId, fileUri, timer, practice,
		statusBar: null, ticker: null, deadline: null,
	};

	if (config.timeLimitMinutes > 0) { startCountdown(session, parsed.title, config.timeLimitMinutes); }

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

// ── Countdown ─────────────────────────────────────────────────────────────────

/**
 * Attach a status-bar countdown to `session` and arm the expiry warning.
 *
 * The countdown is informational: expiry stops the clock and warns, but never
 * closes the editor or lifts the practice restrictions — abandoning a run is
 * the user's call, made through `endChallenge()`.
 *
 * @param session - Session to attach the countdown to (mutated in place).
 * @param title   - Problem title, shown in the expiry notification.
 * @param minutes - Positive time limit in minutes.
 *
 * @example
 * startCountdown(session, 'Two Sum', 30);
 */
function startCountdown(session: ChallengeSession, title: string, minutes: number): void {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	item.command = END_CHALLENGE_COMMAND;
	item.tooltip = `LeetCode: ${title} — click to end the challenge`;
	item.show();

	session.statusBar = item;
	session.deadline  = Date.now() + minutes * 60_000;

	const tick = (): void => {
		if (session.deadline === null) { return; }
		const remaining = session.deadline - Date.now();
		if (remaining > 0) {
			item.text = `$(watch) ${formatRemaining(remaining)}`;
			return;
		}
		expire(session, item, title);
	};

	tick();
	session.ticker = setInterval(tick, TICK_MS);
}

/** Freeze the countdown at zero and warn once. */
function expire(session: ChallengeSession, item: vscode.StatusBarItem, title: string): void {
	if (session.ticker) { clearInterval(session.ticker); }
	session.ticker   = null;
	session.deadline = null;
	item.text = '$(watch) time up';
	item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	void vscode.window.showWarningMessage(`Time is up for "${title}".`);
}

/**
 * Format a remaining-millisecond count as `MM:SS`.
 *
 * @param ms - Milliseconds left on the clock (positive).
 * @returns Zero-padded `MM:SS` string.
 *
 * @example
 * formatRemaining(65_000); // → '01:05'
 */
function formatRemaining(ms: number): string {
	const totalSeconds = Math.ceil(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
