import * as vscode from 'vscode';
import { createVaultDirectory, LEETCODE_DIR } from './vault.service.js';
import { getVaultPath } from './vault-path.store.js';

/** Context key used by `package.json` `when` clauses to gate the open command. */
const VAULT_CONFIGURED_KEY = 'obsidian-leetcode.vaultConfigured';

/**
 * Reads the stored vault path and refreshes the single `vaultConfigured`
 * context key. When a vault is configured, ensures the `LeetCode/` directory
 * exists on disk (create-only — never deletes).
 *
 * Called on activation and after the settings panel saves a path.
 *
 * @param context - Extension context owning the per-machine vault path.
 * @returns Resolves once the context key has been set.
 *
 * @example
 * await refreshVaultContext(context);
 */
export async function refreshVaultContext(
	context: vscode.ExtensionContext,
): Promise<void> {
	const vaultPath = getVaultPath(context);

	const configured = vaultPath.length > 0;
	if (configured) {
		createVaultDirectory(vaultPath, LEETCODE_DIR);
	}
	await vscode.commands.executeCommand('setContext', VAULT_CONFIGURED_KEY, configured);
}
