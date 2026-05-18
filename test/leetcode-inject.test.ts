import * as assert from 'node:assert';
import { injectSolution } from '../src/services/leetcode-codegen.service.js';

/**
 * Unit tests for injectSolution(boilerplate, solution): string.
 *
 * The injector swaps the first `<<SOLUTION>>` marker with the user's solution,
 * indenting each line of the solution to match the marker's leading whitespace.
 */
suite('injectSolution', () => {

    test('replaces <<SOLUTION>> marker with solution code', () => {
        const out = injectSolution('before\n<<SOLUTION>>\nafter', 'my code');
        assert.strictEqual(out, 'before\nmy code\nafter');
    });

    test('preserves marker line indentation on solution', () => {
        const out = injectSolution('    <<SOLUTION>>', 'return 0;');
        assert.strictEqual(out, '    return 0;');
    });

    test('indents every line of a multi-line solution', () => {
        const boil = '\t<<SOLUTION>>';
        const sol  = 'int x = 1;\nint y = 2;\nreturn x + y;';
        const out  = injectSolution(boil, sol);
        assert.strictEqual(out, '\tint x = 1;\n\tint y = 2;\n\treturn x + y;');
    });

    test('no <<SOLUTION>> marker → appends solution at end', () => {
        const out = injectSolution('class Main {}\n', 'extra code');
        assert.ok(out.endsWith('extra code'));
        assert.ok(out.startsWith('class Main {}'));
    });

    test('multiple <<SOLUTION>> markers → only first replaced', () => {
        const out = injectSolution('<<SOLUTION>>\n<<SOLUTION>>', 'fill');
        assert.strictEqual(out, 'fill\n<<SOLUTION>>');
    });

    test('empty solution → marker line replaced with empty string', () => {
        const out = injectSolution('before\n<<SOLUTION>>\nafter', '');
        assert.strictEqual(out, 'before\n\nafter');
    });

});
