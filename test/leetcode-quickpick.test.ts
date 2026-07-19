import * as assert from 'node:assert';
import {
    buildQuickPickItems,
    collectMdFilePaths,
    FILE_TYPE_DIRECTORY,
    FILE_TYPE_SYMBOLIC_LINK,
} from '../src/commands/quickpick-item.helpers.js';
import type { DirEntry, DirReader } from '../src/commands/quickpick-item.helpers.js';
import type { LeetCodeSummary } from '../src/types/leetcode.types.js';

const FILE = 1;

/**
 * Unit tests for collectMdFilePaths(readDir): string[].
 *
 * Pure, vscode-free recursive walk driven entirely through the injected
 * `readDir` seam — a fixed in-memory table stands in for
 * `vscode.workspace.fs.readDirectory`, so multi-level trees and the
 * symlink-containment rule are testable without touching vscode or a real
 * filesystem.
 */
suite('collectMdFilePaths', () => {

    /** Builds a DirReader from a `{ path: entries }` table and counts calls per path. */
    function tableReader(table: Record<string, DirEntry[]>): { readDir: DirReader; calls: string[] } {
        const calls: string[] = [];
        const readDir: DirReader = relPath => {
            calls.push(relPath);
            return Promise.resolve(table[relPath] ?? []);
        };
        return { readDir, calls };
    }

    test('flat vault: single level of .md files, byte-identical to the old filter/map', async () => {
        const { readDir } = tableReader({
            '': [
                ['two-sum.md', FILE],
                ['notes.txt', FILE],
                ['three-sum.md', FILE],
            ],
        });
        const paths = await collectMdFilePaths(readDir);
        assert.deepStrictEqual(paths, ['two-sum.md', 'three-sum.md']);
    });

    test('empty vault: no entries → empty result', async () => {
        const { readDir } = tableReader({ '': [] });
        assert.deepStrictEqual(await collectMdFilePaths(readDir), []);
    });

    test('nested: descends into subfolders and returns vault-relative paths', async () => {
        const { readDir } = tableReader({
            '': [['function', FILE_TYPE_DIRECTORY]],
            function: [['arrays', FILE_TYPE_DIRECTORY]],
            'function/arrays': [['two-sum.md', FILE]],
        });
        const paths = await collectMdFilePaths(readDir);
        assert.deepStrictEqual(paths, ['function/arrays/two-sum.md']);
    });

    test('mixes root-level and nested files in one result', async () => {
        const { readDir } = tableReader({
            '': [
                ['readme.md', FILE],
                ['function', FILE_TYPE_DIRECTORY],
            ],
            function: [['two-sum.md', FILE]],
        });
        const paths = await collectMdFilePaths(readDir);
        assert.deepStrictEqual(paths.sort(), ['function/two-sum.md', 'readme.md']);
    });

    test('SECURITY: a symlinked directory is never followed — readDir is never called for it', async () => {
        const symlinkedDir = FILE_TYPE_DIRECTORY | FILE_TYPE_SYMBOLIC_LINK;
        const { readDir, calls } = tableReader({
            '': [
                ['escape', symlinkedDir],
                ['safe.md', FILE],
            ],
            // If containment ever breaks and the walker descends anyway, this proves the leak:
            // secrets.md would appear in the result.
            escape: [['secrets.md', FILE]],
        });
        const paths = await collectMdFilePaths(readDir);
        assert.deepStrictEqual(paths, ['safe.md']);
        assert.ok(!calls.includes('escape'), 'readDir must never be called for a symlinked directory');
    });

    test('a plain (non-symlinked) directory is still recursed into', async () => {
        const { readDir, calls } = tableReader({
            '': [['function', FILE_TYPE_DIRECTORY]],
            function: [['two-sum.md', FILE]],
        });
        await collectMdFilePaths(readDir);
        assert.ok(calls.includes('function'), 'a plain subdirectory must be descended into');
    });

});

/**
 * Unit tests for buildQuickPickItems(entries): QuickPickItemData[].
 *
 * Pure, vscode-free mapping from { fileName, parsed } pairs to the
 * label/description/detail shown in the exercise picker, plus the sort order
 * (unsolved first, then by difficulty).
 */
suite('buildQuickPickItems', () => {

    function summary(overrides: Partial<LeetCodeSummary> = {}): LeetCodeSummary {
        return {
            title: 'Two Sum',
            difficulty: 'easy',
            status: 'unsolved',
            algorithm: undefined,
            tags: [],
            ...overrides,
        };
    }

    // ── label / description / detail ────────────────────────────────────────

    test('label carries a status icon and the title', () => {
        const [item] = buildQuickPickItems([{ fileName: 'two-sum.md', parsed: summary({ status: 'solved' }) }]);
        assert.strictEqual(item.label, '$(check) Two Sum');
    });

    test('unsolved status uses the outline icon', () => {
        const [item] = buildQuickPickItems([{ fileName: 'a.md', parsed: summary({ status: 'unsolved' }) }]);
        assert.strictEqual(item.label, '$(circle-large-outline) Two Sum');
    });

    test('attempted status uses the warning icon', () => {
        const [item] = buildQuickPickItems([{ fileName: 'a.md', parsed: summary({ status: 'attempted' }) }]);
        assert.strictEqual(item.label, '$(warning) Two Sum');
    });

    test('description is "Difficulty · Status" for a root-level (flat vault) file', () => {
        const [item] = buildQuickPickItems([
            { fileName: 'a.md', parsed: summary({ difficulty: 'medium', status: 'attempted' }) },
        ]);
        assert.strictEqual(item.description, 'Medium · Attempted');
    });

    test('description prepends the folder path as a category label for a nested file', () => {
        const [item] = buildQuickPickItems([
            {
                fileName: 'function/arrays/two-sum.md',
                parsed: summary({ difficulty: 'medium', status: 'attempted' }),
            },
        ]);
        assert.strictEqual(item.description, 'function/arrays · Medium · Attempted');
    });

    test('description category label reflects only the immediate parent folders, not the fileName', () => {
        const [item] = buildQuickPickItems([{ fileName: 'topic/two-sum.md', parsed: summary() }]);
        assert.strictEqual(item.description, 'topic · Easy · Unsolved');
    });

    test('detail combines algorithm and #tags', () => {
        const [item] = buildQuickPickItems([{
            fileName: 'a.md',
            parsed: summary({ algorithm: 'hash-map', tags: ['arrays', 'hash-map'] }),
        }]);
        assert.strictEqual(item.detail, 'hash-map · #arrays #hash-map');
    });

    test('detail omits algorithm when absent', () => {
        const [item] = buildQuickPickItems([{ fileName: 'a.md', parsed: summary({ tags: ['arrays'] }) }]);
        assert.strictEqual(item.detail, '#arrays');
    });

    test('detail omits tags when empty', () => {
        const [item] = buildQuickPickItems([{ fileName: 'a.md', parsed: summary({ algorithm: 'two-pointer' }) }]);
        assert.strictEqual(item.detail, 'two-pointer');
    });

    test('detail is empty string when neither algorithm nor tags are present', () => {
        const [item] = buildQuickPickItems([{ fileName: 'a.md', parsed: summary() }]);
        assert.strictEqual(item.detail, '');
    });

    test('carries the source fileName through unchanged', () => {
        const [item] = buildQuickPickItems([{ fileName: 'binary-search.md', parsed: summary() }]);
        assert.strictEqual(item.fileName, 'binary-search.md');
    });

    test('carries a nested vault-relative fileName through unchanged', () => {
        const [item] = buildQuickPickItems([{ fileName: 'function/arrays/binary-search.md', parsed: summary() }]);
        assert.strictEqual(item.fileName, 'function/arrays/binary-search.md');
    });

    // ── sort order ───────────────────────────────────────────────────────────

    test('sorts unsolved before attempted before solved', () => {
        const items = buildQuickPickItems([
            { fileName: 'solved.md',    parsed: summary({ title: 'Solved',    status: 'solved' }) },
            { fileName: 'unsolved.md',  parsed: summary({ title: 'Unsolved',  status: 'unsolved' }) },
            { fileName: 'attempted.md', parsed: summary({ title: 'Attempted', status: 'attempted' }) },
        ]);
        assert.deepStrictEqual(items.map(i => i.fileName), ['unsolved.md', 'attempted.md', 'solved.md']);
    });

    test('within the same status, sorts easy before medium before hard', () => {
        const items = buildQuickPickItems([
            { fileName: 'hard.md',   parsed: summary({ title: 'Hard',   difficulty: 'hard' }) },
            { fileName: 'easy.md',   parsed: summary({ title: 'Easy',   difficulty: 'easy' }) },
            { fileName: 'medium.md', parsed: summary({ title: 'Medium', difficulty: 'medium' }) },
        ]);
        assert.deepStrictEqual(items.map(i => i.fileName), ['easy.md', 'medium.md', 'hard.md']);
    });

    test('ties on status and difficulty break alphabetically by title', () => {
        const items = buildQuickPickItems([
            { fileName: 'b.md', parsed: summary({ title: 'Bravo' }) },
            { fileName: 'a.md', parsed: summary({ title: 'Alpha' }) },
        ]);
        assert.deepStrictEqual(items.map(i => i.fileName), ['a.md', 'b.md']);
    });

    test('empty input → empty output', () => {
        assert.deepStrictEqual(buildQuickPickItems([]), []);
    });

});
