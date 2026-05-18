import * as vscode from 'vscode';
import { openSettingsPanel } from '../ui/panels/settings.panel.js';

/**
 * Registers the `obsidian-leetcode.settings` command, which opens the settings
 * webview panel where the user configures their Obsidian vault path.
 *
 * @param context - Extension context for subscription management.
 *
 * @example
 * registerOpenSettingsCommand(context);
 */
export function registerOpenSettingsCommand(context: vscode.ExtensionContext): void {
	const disposable = vscode.commands.registerCommand('obsidian-leetcode.settings', () => {
		openSettingsPanel(context);
	});
	context.subscriptions.push(disposable);
}
