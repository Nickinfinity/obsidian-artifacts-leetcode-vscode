import * as vscode from 'vscode';
import { VAULT_CONFIGURED_KEY } from '../types/constants.js';
import { createVaultDirectory } from './vault.service.js';
import { getExercisesSubdir, getVaultPath } from './vault-path.store.js';

/**
 * Reads the stored vault path and refreshes the single `vaultConfigured`
 * context key. When a vault is configured *and* `useVaultRoot` is off (the
 * default), ensures the `LeetCode/` subfolder exists on disk (create-only —
 * never deletes). When `useVaultRoot` is on, exercises live at the vault
 * root itself, so this creates and deletes nothing — flipping the toggle
 * only changes where the picker looks, never touches files.
 *
 * Called on activation and after the settings panel saves a path or toggles
 * `useVaultRoot`.
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
		const subdir = getExercisesSubdir(context);
		if (subdir !== '') {
			createVaultDirectory(vaultPath, subdir);
		}
	}
	await vscode.commands.executeCommand('setContext', VAULT_CONFIGURED_KEY, configured);
}
