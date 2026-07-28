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
	});
});
