import * as assert from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { verifyExercise } from '../src/services/exercise-verify.helpers.js';

/**
 * Vault-coupled harness walk (plan §D · T0.2).
 *
 * Runs `verifyExercise` over every migrated `CoderByte/**\/*.md` in the vault —
 * but ONLY when the vault directory exists, so the committed gate stays portable
 * (decision 3): with no vault present the walk yields zero cases and the suite is
 * green. The migrated `.md` files live in the vault, never in the repo, so on a
 * fresh checkout this suite is a no-op and never blocks the gate.
 *
 * Point the walk elsewhere with `VAULT_CODERBYTE=/path node …mocha`.
 */
const VAULT_CODERBYTE = process.env.VAULT_CODERBYTE
	?? '/Users/nick/N0t3s/L33tC0d3/CoderByte';

/** Per-exercise budget: a single file runs up to five language toolchains (javac, rustc…). */
const PER_EXERCISE_TIMEOUT_MS = 120_000;

/**
 * Recursively collect every `.md` under `dir`. Returns `[]` when `dir` is absent
 * (the portability guarantee) and skips dotfiles/dotfolders (`.obsidian`, `.git`).
 *
 * @param dir - Directory to walk.
 * @returns Absolute paths of every `.md` found, or `[]` if `dir` does not exist.
 *
 * @example
 * collectMarkdown('/no/such/vault'); // → []
 */
function collectMarkdown(dir: string): string[] {
	if (!existsSync(dir)) { return []; }
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith('.')) { continue; }
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) { out.push(...collectMarkdown(full)); }
		else if (entry.endsWith('.md')) { out.push(full); }
	}
	return out;
}

suite('coderbyte-migration (vault harness)', () => {
	const files = collectMarkdown(VAULT_CODERBYTE);

	// First failing assertion (T0.2 test-first): an absent vault yields zero cases
	// and does not throw — the committed gate must stay green with no vault present.
	test('an absent vault yields zero cases (portable gate)', () => {
		assert.deepStrictEqual(collectMarkdown('/no/such/vault/coderbyte-portability-probe'), []);
	});

	// When the vault exists, every migrated exercise must pass the uniform harness.
	// Skipped entirely on a fresh checkout (empty/absent vault → `files` is `[]`).
	for (const file of files) {
		test(`harness green: ${file}`, async function () {
			this.timeout(PER_EXERCISE_TIMEOUT_MS);
			const result = await verifyExercise(readFileSync(file, 'utf-8'), file);
			assert.ok(result.ok, result.ok ? '' : result.reason);
		});
	}
});
