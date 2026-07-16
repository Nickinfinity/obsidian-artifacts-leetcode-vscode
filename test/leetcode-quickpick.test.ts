import * as assert from 'node:assert';
import { buildQuickPickItems } from '../src/commands/quickpick-item.helpers.js';
import type { LeetCodeSummary } from '../src/types/leetcode.types.js';

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

    test('description is "Difficulty · Status"', () => {
        const [item] = buildQuickPickItems([
            { fileName: 'a.md', parsed: summary({ difficulty: 'medium', status: 'attempted' }) },
        ]);
        assert.strictEqual(item.description, 'Medium · Attempted');
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
