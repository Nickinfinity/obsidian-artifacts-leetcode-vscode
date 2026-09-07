import * as assert from 'node:assert';
import { mapType, jsonToLiteral } from '../src/services/leetcode-codegen.service.js';

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

/**
 * Unit tests for jsonToLiteral(value, language): string — Rust literals only.
 *
 * java/python/javascript coverage lives in test/leetcode-codegen.test.ts;
 * this suite is the failing-test-first net for T2 (Rust literal support).
 */
suite('jsonToLiteral (rust)', () => {

    test('number and boolean unchanged (rust)', () => {
        assert.strictEqual(jsonToLiteral(42, 'rust'), '42');
        assert.strictEqual(jsonToLiteral(true, 'rust'), 'true');
        assert.strictEqual(jsonToLiteral(false, 'rust'), 'false');
    });

    test('null → None (rust)', () => {
        assert.strictEqual(jsonToLiteral(null, 'rust'), 'None');
    });

    test('string → String::from("…") (rust)', () => {
        assert.strictEqual(jsonToLiteral('hi', 'rust'), 'String::from("hi")');
    });

    test('array → vec![…] (rust)', () => {
        assert.strictEqual(jsonToLiteral([1, 2], 'rust'), 'vec![1, 2]');
    });

    test('nested array → vec![vec![…]] (rust)', () => {
        assert.strictEqual(jsonToLiteral([[1, 2]], 'rust'), 'vec![vec![1, 2]]');
    });

    // ponytail: `[]` → `vec![]` cannot type-infer standalone; upgrade would
    // thread the declared param type through five languages — not now.
    test('empty array → vec![] (rust)', () => {
        assert.strictEqual(jsonToLiteral([], 'rust'), 'vec![]');
    });

    test('object → HashMap::from([(String::from("k"), v), …]) (rust)', () => {
        assert.strictEqual(jsonToLiteral({ a: 1 }, 'rust'), 'HashMap::from([(String::from("a"), 1)])');
    });

    test('undefined → None (rust)', () => {
        assert.strictEqual(jsonToLiteral(undefined, 'rust'), 'None');
    });

    // ── Hostile-input escaping ───────────────────────────────────────────────
    // Untrusted `.md` test JSON can carry raw control bytes; rustc rejects
    // JSON's own escapes (`\b`, `\f`, bare ``) outright, so the rust
    // path builds its literal from the source string's real characters
    // rather than post-processing JSON.stringify's output.

    test('rust string escapes a raw control character to \\u{…}', () => {
        assert.strictEqual(jsonToLiteral('', 'rust'), 'String::from("\\u{1}")');
    });

    test('rust string escapes a literal backspace to \\u{8}, not JSON\'s \\b', () => {
        assert.strictEqual(jsonToLiteral('\b', 'rust'), 'String::from("\\u{8}")');
    });

    test('rust string escapes a tab via the explicit map', () => {
        assert.strictEqual(jsonToLiteral('\t', 'rust'), 'String::from("\\t")');
    });

    test('rust string escapes an embedded double quote', () => {
        assert.strictEqual(jsonToLiteral('say "hi"', 'rust'), 'String::from("say \\"hi\\"")');
    });

    test('rust string does not corrupt a backslash immediately followed by "b" — the case a regex over JSON.stringify output would mangle', () => {
        const input = 'a' + '\\' + 'b'; // three raw chars: a, backslash, b — NOT the \b escape
        const expected = 'String::from("a' + '\\\\' + 'b")'; // rustc needs \\ to mean one literal backslash
        assert.strictEqual(jsonToLiteral(input, 'rust'), expected);
    });

});
