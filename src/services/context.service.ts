import * as vscode from 'vscode';
import { createVaultDirectory, LEETCODE_DIR } from './vault.service.js';

/** Settings namespace for this extension. */
export const CONFIG_NS = 'obsidianLeetcodeTrainer';

/** Context key used by `package.json` `when` clauses to gate the open command. */
const VAULT_CONFIGURED_KEY = 'obsidian-leetcode.vaultConfigured';

/**
 * Reads the stored vault path and refreshes the single `vaultConfigured`
 * context key. When a vault is configured, ensures the `LeetCode/` directory
 * exists on disk (create-only — never deletes).
 *
 * Called on activation, after the settings panel saves a path, and on any
 * `obsidianLeetcodeTrainer.*` configuration change.
 *
 * @returns Resolves once the context key has been set.
 *
 * @example
 * await refreshVaultContext();
 */
export async function refreshVaultContext(): Promise<void> {
	const vaultPath = vscode.workspace
		.getConfiguration(CONFIG_NS)
		.get<string>('vaultPath', '')
		.trim();

	const configured = vaultPath.length > 0;
	if (configured) {
		createVaultDirectory(vaultPath, LEETCODE_DIR);
	}
	await vscode.commands.executeCommand('setContext', VAULT_CONFIGURED_KEY, configured);
}
