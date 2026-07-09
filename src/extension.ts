import * as vscode from 'vscode';
import { registerOpenSettingsCommand } from './commands/openSettings.command.js';
import { registerCreateExerciseCommand } from './commands/createExercise.command.js';
import { openLeetCodePicker } from './commands/leetcode.command.js';
import { END_CHALLENGE_COMMAND, endChallenge } from './services/leetcode-challenge.service.js';
import { refreshVaultContext } from './services/context.service.js';
import { getVaultPath, migrateLegacyVaultPath } from './services/vault-path.store.js';
import { LEETCODE_DIR } from './services/vault.service.js';

/**
 * Called by VS Code when the extension is activated.
 *
 * Registers the settings command and the single `obsidian-leetcode.open`
 * command, refreshes the `vaultConfigured` context key, auto-opens settings
 * on first use, and watches for configuration changes.
 *
 * @param context - Extension context provided by VS Code.
 *
 * @example
 * // invoked by VS Code; not called directly
 * activate(context);
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	registerOpenSettingsCommand(context);
	registerCreateExerciseCommand(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('obsidian-leetcode.open', () => {
			void openLeetCodePicker(context, LEETCODE_DIR, 'LeetCode', context.extensionUri);
		}),
		vscode.commands.registerCommand(END_CHALLENGE_COMMAND, () => endChallenge()),
	);

	// Move any legacy synced path into per-machine storage before reading it.
	await migrateLegacyVaultPath(context);

	// Await so the context key is set before the user can interact with menus.
	await refreshVaultContext(context);

	if (!getVaultPath(context)) {
		vscode.commands.executeCommand('obsidian-leetcode.settings');
	}
}

/**
 * Called by VS Code when the extension is deactivated.
 *
 * Restores any editor settings a live challenge had overridden — otherwise a
 * window closed mid-exercise would leave completion and AI suggestions off.
 *
 * @returns Resolves once the settings snapshot has been written back.
 *
 * @example
 * // invoked by VS Code; not called directly
 * await deactivate();
 */
export async function deactivate(): Promise<void> {
	await endChallenge();
}
