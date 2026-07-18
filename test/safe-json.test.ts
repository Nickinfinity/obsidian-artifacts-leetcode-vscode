import * as assert from 'node:assert';
import { safeJsonParse } from '../src/utils/safe-json.js';

/**
 * Unit tests for the shared guarded-JSON-parse used at every untrusted decode
 * boundary (test fences, meta/attempt comments, sentinel result lines).
 */
suite('safeJsonParse', () => {

    test('parses valid JSON', () => {
        assert.deepStrictEqual(safeJsonParse('{"index":0,"ms":2}'), { index: 0, ms: 2 });
        assert.deepStrictEqual(safeJsonParse('[1,2,3]'), [1, 2, 3]);
    });

    test('returns null for malformed JSON instead of throwing', () => {
        assert.strictEqual(safeJsonParse('{ truncated'), null);
        assert.strictEqual(safeJsonParse('not json'), null);
        assert.strictEqual(safeJsonParse(''), null);
    });

    test('preserves JSON primitives and null', () => {
        assert.strictEqual(safeJsonParse('42'), 42);
        assert.strictEqual(safeJsonParse('"hi"'), 'hi');
        assert.strictEqual(safeJsonParse('null'), null);
    });
});
