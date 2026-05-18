import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/** Vault directory this extension reads LeetCode problems from. */
export const LEETCODE_DIR = 'LeetCode';

/**
 * Validates that a given path is a valid Obsidian vault.
 *
 * A valid Obsidian vault must contain a `.obsidian/` directory at its root.
 *
 * @param vaultPath - Absolute file path to validate as an Obsidian vault root.
 * @returns True if the path contains a `.obsidian/` directory. Shows an error
 *          message to the user when validation fails.
 *
 * @example
 * if (validateObsidianVault('/home/user/my-vault')) { open(); }
 */
export function validateObsidianVault(vaultPath: string): boolean {
	const obsidianDir = path.join(vaultPath, '.obsidian');
	if (!fs.existsSync(obsidianDir)) {
		vscode.window.showErrorMessage(
			`"${vaultPath}" is not a valid Obsidian vault. The selected folder must contain a .obsidian directory.`
		);
		return false;
	}
	return true;
}

/**
 * Creates a vault directory if it does not already exist.
 *
 * Idempotent — calling this multiple times is safe. Shows an error message to
 * the user when creation fails.
 *
 * @param vaultPath - Absolute file path to the Obsidian vault root.
 * @param dirName   - Directory name to create within the vault.
 * @returns True when the directory was created or already existed, false on error.
 *
 * @example
 * createVaultDirectory('/home/user/my-vault', LEETCODE_DIR);
 */
export function createVaultDirectory(vaultPath: string, dirName: string): boolean {
	try {
		const dirPath = path.join(vaultPath, dirName);
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
		}
		return true;
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to create directory: ${error}`);
		return false;
	}
}
