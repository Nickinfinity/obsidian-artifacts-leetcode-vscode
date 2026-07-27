import * as vscode from 'vscode';
import { CONFIG_NS, USE_VAULT_ROOT_KEY, VAULT_PATH_KEY } from '../types/constants.js';
import { exercisesSubdir } from './vault.helpers.js';

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
 * Reads the "use vault root" preference for *this* installation.
 *
 * Machine-local, same rationale as `getVaultPath`: `globalState` is excluded
 * from Settings Sync (`setKeysForSync` is never called), so a boolean that is
 * harmless to sync still lives beside the vault path for consistency.
 *
 * @param context - Extension context owning the per-machine `globalState`.
 * @returns `true` when exercises live at the vault root; `false` (default,
 *   unchanged behaviour) when they live under the `LeetCode/` subfolder.
 *
 * @example
 * const useRoot = getUseVaultRoot(context); // → false on a fresh install
 */
export function getUseVaultRoot(context: vscode.ExtensionContext): boolean {
	return context.globalState.get<boolean>(USE_VAULT_ROOT_KEY, false);
}

/**
 * Persists the "use vault root" preference for this installation only.
 *
 * @param context - Extension context owning the per-machine `globalState`.
 * @param value - `true` to browse/create exercises at the vault root, `false`
 *   for the default `LeetCode/` subfolder.
 * @returns Resolves once the value has been written.
 *
 * @example
 * await setUseVaultRoot(context, true);
 */
export async function setUseVaultRoot(
	context: vscode.ExtensionContext,
	value: boolean,
): Promise<void> {
	await context.globalState.update(USE_VAULT_ROOT_KEY, value);
}

/**
 * Thin `vscode`-coupled wrapper resolving the vault-relative exercises
 * directory from the stored preference — the one call site both
 * `refreshVaultContext` and the exercise picker import, so neither
 * re-hardcodes `'LeetCode'`.
 *
 * @param context - Extension context owning the per-machine `globalState`.
 * @returns `''` at vault-root mode, else `LEETCODE_DIR`.
 *
 * @example
 * const subdir = getExercisesSubdir(context); // → 'LeetCode' by default
 */
export function getExercisesSubdir(context: vscode.ExtensionContext): string {
	return exercisesSubdir(getUseVaultRoot(context));
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
