import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FileSpec } from '../src/types/leetcode.types.js';
import { resolveContained, writeProjectFiles } from '../src/services/test-envs/project/files.writer.js';

/**
 * Filesystem containment for the `## Files` writer (eval-fixes TB.3).
 *
 * Every `path` here comes from an untrusted `.md`. The rule this suite exists to
 * pin: **a bad path is rejected before any write happens at all** — not after a
 * partial tree has already landed on disk.
 */
suite('project files writer', () => {

	let runDir: string;

	setup(() => {
		runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-write-'));
	});

	teardown(() => {
		fs.chmodSync(runDir, 0o755);
		fs.rmSync(runDir, { recursive: true, force: true });
	});

	function spec(filePath: string, role: FileSpec['role'] = 'editable', content = 'x'): FileSpec {
		return { path: filePath, language: 'typescript', role, content };
	}

	// ── resolveContained ──────────────────────────────────────────────────────

	suite('resolveContained', () => {

		test('a plain relative path resolves inside the run dir', () => {
			assert.strictEqual(resolveContained(runDir, 'src/a.ts'), path.join(runDir, 'src/a.ts'));
		});

		test('an interior .. that stays inside is allowed', () => {
			assert.strictEqual(resolveContained(runDir, 'src/../a.ts'), path.join(runDir, 'a.ts'));
		});

		for (const bad of ['../escape.ts', '../../etc/passwd', 'src/../../escape.ts', '/etc/passwd', '']) {
			test(`rejects ${JSON.stringify(bad)}`, () => {
				assert.throws(() => resolveContained(runDir, bad), /path/i);
			});
		}

		test('rejects a NUL byte', () => {
			assert.throws(() => resolveContained(runDir, 'a\u0000.ts'), /path/i);
		});

		test('rejects the run dir itself', () => {
			assert.throws(() => resolveContained(runDir, '.'), /path/i);
		});

		// ── node_modules reservation (T1's shared-cache symlinks land here) ────

		test('rejects node_modules/evil.js, naming node_modules as reserved', () => {
			assert.throws(() => resolveContained(runDir, 'node_modules/evil.js'), /node_modules.*reserved/i);
		});

		test('rejects node_modules alone', () => {
			assert.throws(() => resolveContained(runDir, 'node_modules'), /node_modules.*reserved/i);
		});

		test('rejects a path that only normalises into node_modules — not a raw-string check', () => {
			assert.throws(() => resolveContained(runDir, 'src/lib/../../node_modules/x'), /node_modules.*reserved/i);
		});

		test('rejects node_modules as a non-root segment — a stack artifact links a tree per sub-package (SEC S2)', () => {
			assert.throws(() => resolveContained(runDir, 'src/node_modules/x'), /node_modules.*reserved/i);
		});

		test('rejects client/node_modules/react/index.js — the per-sub-package linked-tree case', () => {
			assert.throws(() => resolveContained(runDir, 'client/node_modules/react/index.js'), /node_modules.*reserved/i);
		});

		test('rejects a deep segment case-insensitively — client/NODE_MODULES/x', () => {
			assert.throws(() => resolveContained(runDir, 'client/NODE_MODULES/x'), /node_modules.*reserved/i);
		});

		test('rejects client/node_moduleſ/x — U+017F folds to "s" under NFKC on APFS (SEC round 2)', () => {
			assert.throws(() => resolveContained(runDir, 'client/node_moduleſ/x'), /node_modules.*reserved/i);
		});

		test('allows a root segment that merely contains node_modules as a substring', () => {
			assert.strictEqual(resolveContained(runDir, 'my_node_modules/x'), path.join(runDir, 'my_node_modules/x'));
		});

		test('allows a non-root segment that merely contains node_modules as a substring', () => {
			assert.strictEqual(resolveContained(runDir, 'client/my_node_modules/x'), path.join(runDir, 'client/my_node_modules/x'));
		});

		// ── case-insensitive filesystems (APFS, NTFS) — SEC round 1 ────────────

		test('rejects NODE_MODULES/x — all-caps is the same directory on APFS/NTFS', () => {
			assert.throws(() => resolveContained(runDir, 'NODE_MODULES/x'), /node_modules.*reserved/i);
		});

		test('rejects Node_Modules/x — mixed case', () => {
			assert.throws(() => resolveContained(runDir, 'Node_Modules/x'), /node_modules.*reserved/i);
		});

		test('rejects a mixed-case path that only normalises into NODE_MODULES', () => {
			assert.throws(() => resolveContained(runDir, 'src/../NODE_MODULES/x'), /node_modules.*reserved/i);
		});
	});

	// ── writeProjectFiles ─────────────────────────────────────────────────────

	suite('writeProjectFiles', () => {

		test('writes each file, creating intermediate directories', async () => {
			await writeProjectFiles(runDir, [spec('src/lib/a.ts', 'editable', 'contents')]);
			assert.strictEqual(fs.readFileSync(path.join(runDir, 'src/lib/a.ts'), 'utf-8'), 'contents');
		});

		test('a traversal path writes NOTHING — not even the valid files beside it', async () => {
			await assert.rejects(
				writeProjectFiles(runDir, [spec('ok.ts'), spec('../../etc/x')]),
				/path/i,
			);
			assert.deepStrictEqual(fs.readdirSync(runDir), []);
		});

		test('a readonly file lands without write permission', async () => {
			await writeProjectFiles(runDir, [spec('locked.ts', 'readonly')]);
			const mode = fs.statSync(path.join(runDir, 'locked.ts')).mode;
			assert.strictEqual(mode & 0o222, 0, `mode ${mode.toString(8)}`);
		});

		test('an editable file stays writable', async () => {
			await writeProjectFiles(runDir, [spec('open.ts', 'editable')]);
			const mode = fs.statSync(path.join(runDir, 'open.ts')).mode;
			assert.notStrictEqual(mode & 0o200, 0, `mode ${mode.toString(8)}`);
		});

		test('a hidden file is written like an editable one — the role is about opening it', async () => {
			await writeProjectFiles(runDir, [spec('secret.ts', 'hidden', 'scaffold')]);
			assert.strictEqual(fs.readFileSync(path.join(runDir, 'secret.ts'), 'utf-8'), 'scaffold');
		});

		test('two files declaring the same path is a conflict, not a silent overwrite', async () => {
			await assert.rejects(
				writeProjectFiles(runDir, [spec('a.ts', 'editable', 'first'), spec('a.ts', 'editable', 'second')]),
				/duplicate/i,
			);
		});

		test('a node_modules path writes NOTHING — the all-or-nothing property still holds', async () => {
			await assert.rejects(
				writeProjectFiles(runDir, [spec('ok.ts'), spec('node_modules/evil.js')]),
				/node_modules.*reserved/i,
			);
			assert.deepStrictEqual(fs.readdirSync(runDir), []);
		});
	});
});
