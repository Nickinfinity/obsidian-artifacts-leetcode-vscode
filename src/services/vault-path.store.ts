import * as vscode from 'vscode';

/** Settings namespace retained only for one-time migration of the legacy synced value. */
export const CONFIG_NS = 'obsidianLeetcodeTrainer';

/** `globalState` key holding the vault path. Machine-local — never registered for Settings Sync. */
const VAULT_PATH_KEY = 'vaultPath';

/**
 * Reads the configured Obsidian vault root path for *this* installation.
 *
 * The path lives in `context.globalState`, which VS Code keeps per-machine
 * (it is excluded from Settings Sync because we never call
 * `globalState.setKeysForSync`). This prevents a path from one OS/host
 * (e.g. `/Users/nick/...` on macOS) leaking onto another (`/home/nick/...`
 * on Linux), which previously caused `ENOENT` on directory creation.
 *
 * @param context - Extension context owning the per-machine `globalState`.
 * @returns The trimmed vault path, or `''` when none is configured.
 *
 * @example
 * const vaultPath = getVaultPath(context);
 * if (!vaultPath) { openSettings(); }
 */
export function getVaultPath(context: vscode.ExtensionContext): string {
	return context.globalState.get<string>(VAULT_PATH_KEY, '').trim();
}

/**
 * Persists the vault path for this installation only (machine-local).
 *
 * @param context - Extension context owning the per-machine `globalState`.
 * @param vaultPath - Absolute path to the Obsidian vault root.
 * @returns Resolves once the value has been written.
 *
 * @example
 * await setVaultPath(context, '/home/nick/Notes');
 */
export async function setVaultPath(
	context: vscode.ExtensionContext,
	vaultPath: string,
): Promise<void> {
	await context.globalState.update(VAULT_PATH_KEY, vaultPath.trim());
}

/**
 * One-time migration: if the legacy synced setting
 * `obsidianLeetcodeTrainer.vaultPath` still holds a value and `globalState`
 * has none, copy it into `globalState` and then clear the synced setting so
 * the (possibly wrong-OS) path stops propagating via Settings Sync.
 *
 * Safe to call on every activation — it is a no-op once migrated.
 *
 * @param context - Extension context owning the per-machine `globalState`.
 * @returns Resolves once any pending migration has completed.
 *
 * @example
 * await migrateLegacyVaultPath(context);
 */
export async function migrateLegacyVaultPath(
	context: vscode.ExtensionContext,
): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_NS);
	const legacy = config.get<string>('vaultPath', '').trim();

	if (legacy && !context.globalState.get<string>(VAULT_PATH_KEY)) {
		await context.globalState.update(VAULT_PATH_KEY, legacy);
	}

	// Always clear the synced setting once globalState owns the value, so a
	// stale cross-OS path can never sync back in.
	if (config.get<string>('vaultPath', '')) {
		await config.update('vaultPath', undefined, vscode.ConfigurationTarget.Global);
	}
}
