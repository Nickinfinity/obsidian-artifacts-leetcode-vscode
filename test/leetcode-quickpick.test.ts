import * as assert from 'node:assert';
import {
    buildQuickPickItems,
    FILE_TYPE_DIRECTORY,
    FILE_TYPE_SYMBOLIC_LINK,
    parentPath,
    splitDirEntries,
} from '../src/commands/quickpick-item.helpers.js';
import type { LeetCodeSummary } from '../src/types/leetcode.types.js';

const FILE = 1;

/**
 * Unit tests for splitDirEntries(entries): DirLevel and parentPath(relPath): string.
 *
 * Pure, vscode-free: the picker browses one level at a time, so these two decide
 * what a level shows (folders alphabetical, then `.md` files, symlinks dropped) and
 * where its `..` row goes.
 */
suite('splitDirEntries', () => {

    test('flat level: keeps .md files, drops other extensions', () => {
        const { dirs, files } = splitDirEntries([
            ['two-sum.md', FILE],
            ['notes.txt', FILE],
            ['three-sum.md', FILE],
        ]);
        assert.deepStrictEqual(dirs, []);
        assert.deepStrictEqual(files, ['two-sum.md', 'three-sum.md']);
    });

    test('empty level: no entries → empty dirs and files', () => {
        assert.deepStrictEqual(splitDirEntries([]), { dirs: [], files: [] });
    });

    test('folders come back alphabetical, independent of listing order', () => {
        const { dirs, files } = splitDirEntries([
            ['Strings', FILE_TYPE_DIRECTORY],
            ['two-sum.md', FILE],
            ['Arrays', FILE_TYPE_DIRECTORY],
        ]);
        assert.deepStrictEqual(dirs, ['Arrays', 'Strings']);
        assert.deepStrictEqual(files, ['two-sum.md']);
    });

    test('SECURITY: a symlinked directory is never listed, so it can never be entered', () => {
        const symlinkedDir = FILE_TYPE_DIRECTORY | FILE_TYPE_SYMBOLIC_LINK;
        const { dirs, files } = splitDirEntries([
            ['escape', symlinkedDir],
            ['safe.md', FILE],
        ]);
        assert.deepStrictEqual(dirs, [], 'a symlinked directory must not become a navigable row');
        assert.deepStrictEqual(files, ['safe.md']);
    });

});

suite('parentPath', () => {

    test('root-level path has no parent', () => {
        assert.strictEqual(parentPath('two-sum.md'), '');
    });

    test('nested path drops its last segment', () => {
        assert.strictEqual(parentPath('function/arrays/two-sum.md'), 'function/arrays');
    });

    test('a one-level folder goes back to the root', () => {
        assert.strictEqual(parentPath('Arrays'), '');
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
