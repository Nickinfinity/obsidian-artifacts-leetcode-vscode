import * as vscode from 'vscode';
import { registerOpenSettingsCommand } from './commands/openSettings.command.js';
import { openLeetCodePicker } from './commands/leetcode.command.js';
import { refreshVaultContext, CONFIG_NS } from './services/context.service.js';
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

	context.subscriptions.push(
		vscode.commands.registerCommand('obsidian-leetcode.open', () => {
			void openLeetCodePicker(LEETCODE_DIR, 'LeetCode', context.extensionUri);
		})
	);

	// Await so the context key is set before the user can interact with menus.
	await refreshVaultContext();

	const vaultPath = vscode.workspace
		.getConfiguration(CONFIG_NS)
		.get<string>('vaultPath', '')
		.trim();

	if (!vaultPath) {
		vscode.commands.executeCommand('obsidian-leetcode.settings');
	}

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(CONFIG_NS)) {
				void refreshVaultContext();
			}
		})
	);
}

export function deactivate(): void {}
