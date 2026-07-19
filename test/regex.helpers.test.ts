import * as assert from 'node:assert';
import { escapeRe } from '../src/utils/regex.helpers.js';

/**
 * Unit tests for the shared regex-literal escaper used everywhere a
 * function/language name is interpolated into a `RegExp` constructor
 * (`declaresFunction`, the three `function` test envs, the solution-meta
 * fence lookup).
 */
suite('regex.helpers', () => {

    suite('escapeRe', () => {

        test('escapes every regex-special character', () => {
            const special = '.*+?^${}()|[]\\';
            const re = new RegExp(`^${escapeRe(special)}$`);
            assert.ok(re.test(special));
        });

        test('a name with regex-special chars matches only itself', () => {
            const re = new RegExp(escapeRe('a.b(c)'));
            assert.ok(re.test('a.b(c)'));
            assert.ok(!re.test('axb(c)'));
        });

        test('a plain alphanumeric name is left unchanged', () => {
            assert.strictEqual(escapeRe('twoSum'), 'twoSum');
        });

        test('empty string escapes to empty string', () => {
            assert.strictEqual(escapeRe(''), '');
        });

        test('a bracket-heavy name still matches literally', () => {
            const re = new RegExp(escapeRe('list[i]'));
            assert.ok(re.test('list[i]'));
            assert.ok(!re.test('listXiY'));
        });
    });
});
