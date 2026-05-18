import * as assert from 'node:assert';
import { mapType } from '../src/services/leetcode-codegen.service.js';

/**
 * Unit tests for mapType(genericType, language): string.
 *
 * Covers primitives, single + nested arrays, generic maps, and passthrough
 * fallbacks for unknown generics and unknown languages.
 */
suite('mapType', () => {

    // ── Primitives ────────────────────────────────────────────────────────────

    test('int → int (java)',          () => assert.strictEqual(mapType('int',    'java'),       'int'));
    test('int → int (python)',        () => assert.strictEqual(mapType('int',    'python'),     'int'));
    test('int → number (javascript)', () => assert.strictEqual(mapType('int',    'javascript'), 'number'));
    test('int → i32 (rust)',          () => assert.strictEqual(mapType('int',    'rust'),       'i32'));

    test('float → double (java)',     () => assert.strictEqual(mapType('float',  'java'),       'double'));
    test('float → float (python)',    () => assert.strictEqual(mapType('float',  'python'),     'float'));
    test('float → f64 (rust)',        () => assert.strictEqual(mapType('float',  'rust'),       'f64'));

    test('string → String (java)',    () => assert.strictEqual(mapType('string', 'java'),       'String'));
    test('string → str (python)',     () => assert.strictEqual(mapType('string', 'python'),     'str'));
    test('string → string (javascript)', () => assert.strictEqual(mapType('string', 'javascript'), 'string'));
    test('string → String (rust)',    () => assert.strictEqual(mapType('string', 'rust'),       'String'));

    test('bool → boolean (java)',     () => assert.strictEqual(mapType('bool',   'java'),       'boolean'));
    test('bool → bool (rust)',        () => assert.strictEqual(mapType('bool',   'rust'),       'bool'));

    // ── Arrays ────────────────────────────────────────────────────────────────

    test('int[] → int[] (java)',           () => assert.strictEqual(mapType('int[]',    'java'),       'int[]'));
    test('int[] → List[int] (python)',     () => assert.strictEqual(mapType('int[]',    'python'),     'List[int]'));
    test('int[] → number[] (javascript)',  () => assert.strictEqual(mapType('int[]',    'javascript'), 'number[]'));
    test('int[] → Vec<i32> (rust)',        () => assert.strictEqual(mapType('int[]',    'rust'),       'Vec<i32>'));

    test('string[] → List[str] (python)',  () => assert.strictEqual(mapType('string[]', 'python'),     'List[str]'));

    test('int[][] → int[][] (java)',                 () => assert.strictEqual(mapType('int[][]', 'java'),   'int[][]'));
    test('int[][] → List[List[int]] (python)',       () => assert.strictEqual(mapType('int[][]', 'python'), 'List[List[int]]'));
    test('int[][] → Vec<Vec<i32>> (rust)',           () => assert.strictEqual(mapType('int[][]', 'rust'),   'Vec<Vec<i32>>'));

    // ── Maps ──────────────────────────────────────────────────────────────────

    test('map<string,int> → Map<String, Integer> (java)',     () =>
        assert.strictEqual(mapType('map<string,int>', 'java'),       'Map<String, Integer>'));
    test('map<string,int> → Dict[str, int] (python)',         () =>
        assert.strictEqual(mapType('map<string,int>', 'python'),     'Dict[str, int]'));
    test('map<string,int> → Record<string, number> (javascript)', () =>
        assert.strictEqual(mapType('map<string,int>', 'javascript'), 'Record<string, number>'));
    test('map<string,int> → HashMap<String, i32> (rust)',     () =>
        assert.strictEqual(mapType('map<string,int>', 'rust'),       'HashMap<String, i32>'));

    // ── Edge cases ────────────────────────────────────────────────────────────

    test('unknown generic type returns passthrough', () => {
        assert.strictEqual(mapType('CustomType', 'java'), 'CustomType');
    });

    test('unknown language returns the generic type as-is', () => {
        assert.strictEqual(mapType('int', 'cobol'), 'int');
    });

});
