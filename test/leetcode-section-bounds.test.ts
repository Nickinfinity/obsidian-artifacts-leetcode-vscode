import * as assert from 'node:assert';
import { sectionBounds } from '../src/services/leetcode-section-bounds.helpers.js';

/**
 * Unit tests for the shared section-boundary primitive that both the section
 * reader (slices the bounds out) and the attempts writer (splices around them)
 * are built on.
 */
suite('sectionBounds', () => {

    const TOP = /^# /m;
    const SUB = /^#{1,2} /m;

    test('returns null when the heading is absent', () => {
        assert.strictEqual(sectionBounds('no heading here', /^# Setup\s*$/m, TOP), null);
    });

    // The bound starts right after the heading TEXT (the `$` match excludes the
    // trailing newline), so the sliced body keeps its leading `\n` — matching the
    // pre-refactor `extractSection`, whose callers trim or fence-match past it.
    test('bounds exclude the heading and stop at the next top-level heading', () => {
        const text = '# Setup\nbody line\n# Solutions\nx';
        const b = sectionBounds(text, /^# Setup\s*$/m, TOP);
        assert.ok(b);
        assert.strictEqual(text.slice(b.headingEnd, b.bodyEnd), '\nbody line\n');
    });

    test('a top-level boundary keeps `##` children inside the section', () => {
        const text = '# Setup\n## Java\ncode\n# Solutions';
        const b = sectionBounds(text, /^# Setup\s*$/m, TOP);
        assert.ok(b);
        assert.strictEqual(text.slice(b.headingEnd, b.bodyEnd), '\n## Java\ncode\n');
    });

    test('a `##` boundary stops the slice at the next `#`/`##` heading', () => {
        const text = '## Tests\n```json\n[]\n```\n## Final Tests\n';
        const b = sectionBounds(text, /^## Tests\s*$/m, SUB);
        assert.ok(b);
        assert.strictEqual(text.slice(b.headingEnd, b.bodyEnd), '\n```json\n[]\n```\n');
    });

    test('runs to end of text when no boundary heading follows', () => {
        const text = '# Setup\ntail content';
        const b = sectionBounds(text, /^# Setup\s*$/m, TOP);
        assert.ok(b);
        assert.strictEqual(b.bodyEnd, text.length);
    });
});
