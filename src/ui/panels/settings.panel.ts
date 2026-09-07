import * as vscode from 'vscode';
import { getNonce } from '../../utils/helpers.js';
import { validateObsidianVault } from '../../services/vault.service.js';
import { refreshVaultContext } from '../../services/context.service.js';
import { getUseVaultRoot, getVaultPath, setUseVaultRoot, setVaultPath } from '../../services/vault-path.store.js';

/**
 * Opens the settings webview panel where the user selects their Obsidian vault
 * root directory and toggles `useVaultRoot`. Unlike the core extension there
 * are no artifact-type toggles — this extension only ever reads exercises
 * from either the `LeetCode/` subfolder (default, auto-created) or the vault
 * root itself (`useVaultRoot: true`, nothing created or moved).
 *
 * The vault path and the toggle are both persisted in per-machine
 * `globalState` (not Settings Sync) so each installation keeps its own
 * OS-correct path and preference.
 *
 * @param context - Extension context providing the extension URI for assets.
 *
 * @example
 * openSettingsPanel(context);
 */
export function openSettingsPanel(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'settings',
		'Obsidian Artifacts: AI LeetCode Trainer - Settings',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'src', 'ui')],
			retainContextWhenHidden: true,
		}
	);

	panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);

	// ── Restore saved config ──────────────────────────────────────────────────
	function postCurrentConfig(): void {
		const savedPath = getVaultPath(context);

		if (savedPath) {
			panel.webview.postMessage({ command: 'updatePath', path: savedPath });
		}
		panel.webview.postMessage({ command: 'updateUseVaultRoot', value: getUseVaultRoot(context) });
	}

	panel.onDidChangeViewState(({ webviewPanel }) => {
		if (webviewPanel.visible) {
			postCurrentConfig();
		}
	});

	panel.webview.onDidReceiveMessage(async (message) => {
		if (message.command === 'selectFolder') {
			const folderUri = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: 'Select Vault',
			});

			if (folderUri?.[0]) {
				const selectedFolderPath = folderUri[0].fsPath;

				if (!validateObsidianVault(selectedFolderPath)) {
					return;
				}

				await setVaultPath(context, selectedFolderPath);

				vscode.window.showInformationMessage(`Obsidian vault path saved: ${selectedFolderPath}`);

				// Sets the vaultConfigured context key and creates LeetCode/ unless useVaultRoot is on.
				await refreshVaultContext(context);

				panel.webview.postMessage({ command: 'updatePath', path: selectedFolderPath });
			} else {
				vscode.window.showWarningMessage('No folder selected.');
			}
		} else if (message.command === 'setUseVaultRoot') {
			await setUseVaultRoot(context, Boolean(message.value));
			await refreshVaultContext(context);
		}
	});

	postCurrentConfig();
}

/**
 * Generates the self-contained HTML for the settings webview.
 *
 * @param webview      - Webview for asset URIs and the CSP source token.
 * @param extensionUri - Extension root URI for resolving the stylesheet.
 * @returns Complete HTML document string.
 *
 * @example
 * panel.webview.html = getWebviewContent(panel.webview, ctx.extensionUri);
 */
function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const nonce = getNonce();
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'ui', 'styles.css'));

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>Obsidian Artifacts: AI LeetCode Trainer - CONFIG</title>
</head>
<body class="settings-body">
  <div id="webviewContent">
    <div class="logo-row">
      <span class="logo-icon">🧠</span>
      <h1>Obsidian Artifacts: AI LeetCode Trainer</h1>
    </div>
    <p class="tagline">Run and practice LeetCode problems straight from your Obsidian vault</p>

    <hr>

    <div class="intro">
      <p>This extension turns <code>type: leetcode</code> notes in your <strong>Obsidian vault</strong> into runnable coding challenges with auto-generated boilerplate, a per-language test harness, and a child-process test runner.</p>
      <p>Point the extension to your vault's root folder — the directory that contains your <code>.obsidian/</code> folder. By default a <code>LeetCode/</code> subfolder is created automatically and exercises live there; check the box below to keep exercises in the vault root instead. Your selection is saved per installation (not synced across devices).</p>
    </div>

    <div class="vault-dir-section">
      <p class="section-label">Vault Location</p>

      <div class="vault-card">
        <span class="vault-icon">📁</span>
        <span id="folderPath">No vault selected</span>
      </div>

      <button id="selectFolderButton">
        <span>Select Vault Folder</span>
      </button>

      <label class="vault-root-toggle">
        <input type="checkbox" id="useVaultRootCheckbox">
        <span>Use vault root directly (don't create a LeetCode subfolder)</span>
      </label>
    </div>

  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById('selectFolderButton').addEventListener('click', () => {
      vscode.postMessage({ command: 'selectFolder' });
    });

    document.getElementById('useVaultRootCheckbox').addEventListener('change', (event) => {
      vscode.postMessage({ command: 'setUseVaultRoot', value: event.target.checked });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.command === 'updatePath') {
        const el = document.getElementById('folderPath');
        el.textContent = message.path;
        el.classList.add('has-path');
      } else if (message.command === 'updateUseVaultRoot') {
        document.getElementById('useVaultRootCheckbox').checked = message.value;
      }
    });
  </script>
</body>
</html>`;
}
