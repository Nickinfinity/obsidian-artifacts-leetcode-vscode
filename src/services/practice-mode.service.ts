import * as vscode from 'vscode';
import type { PracticeOptionId } from '../types/leetcode.types.js';
import { collectSettings } from './practice-mode.helpers.js';

/**
 * Applies and restores the editor restrictions selected for a challenge run.
 *
 * VS Code exposes no per-editor configuration scope, so the settings named by
 * `PRACTICE_OPTIONS` are written at **global** (user) scope and therefore apply
 * to every open editor while the challenge is live. `restore()` puts each key
 * back to the exact `globalValue` it had before `apply()` — including removing
 * keys the user had never set.
 *
 * One instance owns one snapshot: calling `apply()` twice without an
 * intervening `restore()` is a no-op on the second call, so the original
 * snapshot is never overwritten with our own values.
 *
 * @example
 * const mode = new PracticeMode();
 * await mode.apply(['noCompletion', 'noAiAgents']);
 * // …user solves the exercise…
 * await mode.restore();
 */
export class PracticeMode {
	/** Setting key → the `globalValue` observed before `apply()`; `undefined` = unset. */
	private snapshot: Map<string, unknown> | null = null;

	/**
	 * Write the settings for every option in `ids`, snapshotting prior values.
	 *
	 * Unknown ids are ignored. Does nothing when a snapshot is already held.
	 *
	 * @param ids - Practice options the user (or the artifact) selected.
	 * @returns Resolves once every setting has been written.
	 *
	 * @example
	 * await new PracticeMode().apply(['noSnippets']);
	 */
	async apply(ids: PracticeOptionId[]): Promise<void> {
		if (this.snapshot) { return; }

		const config = vscode.workspace.getConfiguration();
		const settings = collectSettings(ids);
		const snapshot = new Map<string, unknown>();

		for (const [key, value] of settings) {
			snapshot.set(key, config.inspect(key)?.globalValue);
			await safeUpdate(config, key, value);
		}
		this.snapshot = snapshot;
	}

	/**
	 * Restore every setting captured by the last `apply()` and drop the snapshot.
	 *
	 * Safe to call when nothing was applied.
	 *
	 * @returns Resolves once every setting has been written back.
	 *
	 * @example
	 * await mode.restore();
	 */
	async restore(): Promise<void> {
		if (!this.snapshot) { return; }

		const config = vscode.workspace.getConfiguration();
		for (const [key, previous] of this.snapshot) {
			await safeUpdate(config, key, previous);
		}
		this.snapshot = null;
	}

	/** True while restrictions are in force. */
	isActive(): boolean { return this.snapshot !== null; }
}

/**
 * Write one global setting, swallowing failures.
 *
 * `github.copilot.enable` (and any other extension-contributed key) throws when
 * that extension is not installed. A missing Copilot is not a reason to abort a
 * challenge, so the error is reported to the output-less console and skipped.
 *
 * @param config - Root workspace configuration.
 * @param key    - Fully-qualified setting key.
 * @param value  - Value to write; `undefined` removes the user-scope override.
 * @returns Resolves whether or not the write succeeded.
 *
 * @example
 * await safeUpdate(vscode.workspace.getConfiguration(), 'editor.hover.enabled', false);
 */
async function safeUpdate(
	config: vscode.WorkspaceConfiguration, key: string, value: unknown,
): Promise<void> {
	try {
		await config.update(key, value, vscode.ConfigurationTarget.Global);
	} catch {
		// Setting is not registered (its owning extension is absent) — skip it.
	}
}
