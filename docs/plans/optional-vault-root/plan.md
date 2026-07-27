# Plan — Optional vault-root exercises directory

Branch-local plan (delete before the PR merges — `develop`/`main` never carry it).
Authority for **what** to build; CLAUDE.md stays the authority for **how** to write the code.

## 0. The feature in one line

Today, setting a vault always auto-creates a `LeetCode/` subfolder and the picker only ever
browses `<vault>/LeetCode`. Make that subfolder **optional**: a settings toggle lets the user
put exercises in the **vault root** instead (no subfolder), and the picker then browses
`<vault>` directly.

## 1. Behaviour contract

- **Default is unchanged.** A fresh install, and every existing install, keeps the `LeetCode/`
  subfolder — the new preference defaults to *off* (use subfolder). No migration, no reactivation.
- **Toggle on ("use vault root"):** exercises live at `<vault>` itself. `refreshVaultContext`
  creates **nothing** and, critically, **deletes/moves nothing** — flipping the toggle only
  changes *where the picker looks*, never touches files. An existing `LeetCode/` folder is left
  exactly as-is.
- **Toggle off ("use LeetCode subfolder", default):** current behaviour — ensure `<vault>/LeetCode`
  exists (create-only), picker browses it.
- The preference is **machine-local** — stored in `globalState`, the same policy and rationale as
  the vault path (`setKeysForSync` is never called; a synced boolean is harmless but the whole
  key space stays unsynced for consistency).
- Changing the toggle in Settings takes effect immediately — it re-runs `refreshVaultContext` and
  the *next* picker open reflects it. The picker must resolve the directory **at open time**, not
  capture it once at activation.

## 2. The single authority (DRY)

"Where do exercises live" must have exactly one source of truth — a resolver, never a re-hardcoded
`'LeetCode'` at any call site. Introduce:

- **Pure**, unit-tested: `exercisesSubdir(useVaultRoot: boolean): string`
  → `useVaultRoot ? '' : LEETCODE_DIR`. Place it where pure vault logic belongs
  (a `vault.helpers.ts` sibling is fine — create it; keep `vault.service.ts` for the
  `vscode`-touching functions). This is the TDD unit.
- **Thin**, `vscode`-coupled: `getExercisesSubdir(context): string`
  → `exercisesSubdir(getUseVaultRoot(context))`. One call site each in `refreshVaultContext` and
  the picker.

`LEETCODE_DIR = 'LeetCode'` stays the default-subfolder constant. `''` is the domain value for
"root, no subfolder".

## 3. Tasks

### T1 — store + resolver (core, TDD) — `sonnet`
- `src/types/constants.ts`: add `USE_VAULT_ROOT_KEY = 'useVaultRoot'` (globalState key). Keep
  `LEETCODE_DIR`.
- `src/services/vault-path.store.ts`: add `getUseVaultRoot(context): boolean`
  (`globalState.get<boolean>(USE_VAULT_ROOT_KEY, false)`) and
  `setUseVaultRoot(context, value): Promise<void>`. Machine-local; never `setKeysForSync`. JSDoc
  matching the file's existing style (explain the machine-local *why*, cross-ref the vault-path
  rationale).
- `src/services/vault.helpers.ts` (new): pure `exercisesSubdir(useVaultRoot)`. Full JSDoc +
  `@example`.
- `getExercisesSubdir(context)`: put the thin resolver next to the store (`vault-path.store.ts`)
  so both consumers import from one place.
- **Test first:** `test/vault-helpers.test.ts` — `exercisesSubdir(false) === 'LeetCode'`,
  `exercisesSubdir(true) === ''`. (Store get/set are thin `globalState` wrappers, verified by F5
  like `getVaultPath`/`setVaultPath` — do not contort them to be unit-testable.)

### T2 — wiring: refresh + picker resolve at open time — `sonnet`
- `src/services/context.service.ts` `refreshVaultContext`: resolve `getExercisesSubdir(context)`;
  call `createVaultDirectory(vaultPath, subdir)` **only when `subdir !== ''`**. Root mode creates
  nothing. Context key logic unchanged (`configured = vaultPath.length > 0`). Update the JSDoc.
- `src/commands/leetcode.command.ts` `pickLeetCodeExercise`: **drop the `dir` parameter**; resolve
  `getExercisesSubdir(context)` internally. Build `rootUri` as the vault URI when subdir is `''`
  (`vscode.Uri.file(vaultPath)`), else `vscode.Uri.joinPath(vault, subdir)` — do **not** pass `''`
  into `joinPath`. Update the function JSDoc (it documented `dir` as "always 'LeetCode'").
- `src/ui/views/leetcodeView.provider.ts`: drop the `dir` constructor param; `openPicker` calls
  `pickLeetCodeExercise(this.context)`. Fix the constructor JSDoc.
- `src/extension.ts`: `new LeetCodeViewProvider(context)` — drop `LEETCODE_DIR` import if now
  unused there.
- No unit test breaks here (these are all `vscode`-coupled — F5 territory). Confirm the mocha gate
  count is unchanged by this task.

### T3 — picker dotfile hygiene (pure, TDD) — `sonnet`
Root mode browses `<vault>`, which contains `.obsidian/` (and maybe `.git/`, `.trash/`). Those must
never appear as browsable rows.
- `src/commands/quickpick-item.helpers.ts` `splitDirEntries`: skip any entry whose name starts with
  `.` (both dirs and files). Harmless in subfolder mode, essential in root mode. Update the JSDoc.
- `test/leetcode-quickpick.test.ts`: add cases — a `.obsidian` dir and a `.hidden.md` are both
  excluded; a normal `Arrays` dir and `two-sum.md` still pass. Keep the existing symlink-containment
  assertion.

### T4 — settings UI — `sonnet`
- `src/ui/panels/settings.panel.ts`: add a checkbox **"Use vault root directly (don't create a
  LeetCode subfolder)"** under the Vault Location section.
  - On change → post `{ command: 'setUseVaultRoot', value: <bool> }`. Handler:
    `await setUseVaultRoot(context, value)` then `await refreshVaultContext(context)`.
  - `postCurrentConfig` also sends `{ command: 'updateUseVaultRoot', value: getUseVaultRoot(context) }`
    so the checkbox restores its state; the webview script sets `checkbox.checked` on that message.
  - Update the intro copy: the "A `LeetCode/` directory is created automatically" sentence must now
    describe the toggle (subfolder by default, root when the box is checked).
  - Keep the CSP `<meta>`, `getNonce()`, `localResourceRoots` = `src/ui`; every interpolated value
    still through nothing-untrusted (this panel builds no user strings into HTML beyond the saved
    path, which is already handled).
- `src/ui/styles.css`: minimal checkbox-row styling under `.vault-dir-section`; reuse existing
  tokens/variables, no new files.
- Webview is F5-verified (not unit-tested) — keep the logic a thin wire over the store + refresh.

### T5 — docs — `sonnet`
- `CLAUDE.md`: update the user-flow line ("auto-creates `LeetCode/`") and the **Vault path storage**
  + **context.service** bullets to describe the optional root and the resolver as the single
  authority. Note the machine-local `useVaultRoot` key beside `vaultPath`.
- No `ARTIFACT_LEETCODE_FILE_FORMAT.md` change (it specs the `.md`, not the vault layout).

## 4. Principles & gate (from CLAUDE.md — non-negotiable)

- **TDD** for the two pure units (T1 resolver, T3 filter): failing test first.
- **DDD**: `exercisesSubdir`/`useVaultRoot` are domain names; the `vscode` layer stays a thin edge.
- **DRY**: one resolver, never a second `'LeetCode'` literal at a call site.
- **KISS/YAGNI**: a boolean toggle, not a free-text subfolder field, not a multi-folder scheme.
- **Security**: no path built from user strings beyond the validated vault root + a fixed constant;
  `globalState` stays unsynced; no new runtime deps.
- **Never delete/move** vault files on toggle.
- **Gate** (run all three, clean `dist` first — `tsc` leaves orphaned `.js`):
  ```
  rm -rf dist && pnpm compile && pnpm lint && \
    node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"
  ```
  Baseline **665 passing**. A count drop is a blocker unless a relocated assertion is named.
- **Static analysis** = the SonarLint IDE extension's `<ide_diagnostics>` — fix, don't file. Do
  **not** invoke `sonar-analyze`/`mcp__sonarqube__*`/the `sonar` CLI.
- **Do not commit** — the orchestrator commits and opens the PR after review.
