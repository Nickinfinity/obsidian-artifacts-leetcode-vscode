import * as assert from 'node:assert';
import { canonicalJson } from '../src/utils/canonical-json.js';

/**
 * Unit tests for the canonical serialiser both sides of a test comparison run
 * through. Its whole job is to make `[0,1]` from three different languages
 * compare equal, and `{a:1,b:2}` equal `{b:2,a:1}`.
 */
suite('canonicalJson', () => {

    test('sorts object keys', () => {
        assert.strictEqual(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
    });

    test('sorts keys recursively', () => {
        assert.strictEqual(canonicalJson({ z: { d: 1, c: 2 } }), '{"z":{"c":2,"d":1}}');
    });

    test('emits no whitespace', () => {
        assert.strictEqual(canonicalJson([1, 2, 3]), '[1,2,3]');
        assert.ok(!canonicalJson({ a: [1, 2] }).includes(' '));
    });

    test('two objects differing only in key order serialise identically', () => {
        assert.strictEqual(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
    });

    test('nested arrays keep their order', () => {
        assert.strictEqual(canonicalJson([[1, 2], [3]]), '[[1,2],[3]]');
    });

    test('null and undefined both serialise to null', () => {
        assert.strictEqual(canonicalJson(null), 'null');
        assert.strictEqual(canonicalJson(undefined), 'null');
    });

    test('array holes and nested undefined become null', () => {
        assert.strictEqual(canonicalJson([1, undefined, 3]), '[1,null,3]');
    });

    test('numbers are not reformatted', () => {
        assert.strictEqual(canonicalJson(0), '0');
        assert.strictEqual(canonicalJson(-1.5), '-1.5');
        assert.strictEqual(canonicalJson(1), '1');
    });

    test('booleans serialise unquoted', () => {
        assert.strictEqual(canonicalJson(true), 'true');
        assert.strictEqual(canonicalJson(false), 'false');
    });

    test('strings are escaped as JSON strings', () => {
        assert.strictEqual(canonicalJson('hi'), '"hi"');
        assert.strictEqual(canonicalJson('a"b'), '"a\\"b"');
        assert.strictEqual(canonicalJson('a\nb'), '"a\\nb"');
    });

    test('empty containers', () => {
        assert.strictEqual(canonicalJson([]), '[]');
        assert.strictEqual(canonicalJson({}), '{}');
    });

    test('matches the shape Java and Python envs emit for a pair of indices', () => {
        assert.strictEqual(canonicalJson([0, 1]), '[0,1]');
    });
});
