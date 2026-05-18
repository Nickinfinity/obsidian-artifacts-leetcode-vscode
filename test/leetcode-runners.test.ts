import * as assert from 'node:assert';
import { javaRunner }   from '../src/services/lang-runners/java.runner.js';
import { jsRunner }     from '../src/services/lang-runners/javascript.runner.js';
import { pythonRunner } from '../src/services/lang-runners/python.runner.js';

/**
 * Unit tests for the three built-in `LangRunner` configs.
 *
 * Each runner is checked against its required identity/extension/command shape.
 */
suite('lang-runners', () => {

    suite('javaRunner', () => {
        test('id is "java"',                 () => assert.strictEqual(javaRunner.id, 'java'));
        test('displayName is "Java"',        () => assert.strictEqual(javaRunner.displayName, 'Java'));
        test('fileExtension is ".java"',     () => assert.strictEqual(javaRunner.fileExtension, '.java'));
        test('fileName is "Main.java"',      () => assert.strictEqual(javaRunner.fileName, 'Main.java'));
        test('compile is defined',           () => assert.strictEqual(typeof javaRunner.compile, 'function'));
        test('compile returns string containing javac', () => {
            assert.ok(javaRunner.compile!('/tmp/Main.java').includes('javac'));
        });
        test('run returns string containing "java Main"', () => {
            assert.ok(javaRunner.run('/tmp/Main.java').includes('java') &&
                javaRunner.run('/tmp/Main.java').includes('Main'));
        });
        test('detectCmd is "java --version"', () => assert.strictEqual(javaRunner.detectCmd, 'java --version'));
    });

    suite('jsRunner', () => {
        test('id is "javascript"',           () => assert.strictEqual(jsRunner.id, 'javascript'));
        test('displayName is "JavaScript"',  () => assert.strictEqual(jsRunner.displayName, 'JavaScript'));
        test('fileExtension is ".js"',       () => assert.strictEqual(jsRunner.fileExtension, '.js'));
        test('fileName is undefined',        () => assert.strictEqual(jsRunner.fileName, undefined));
        test('compile is undefined',         () => assert.strictEqual(jsRunner.compile, undefined));
        test('run returns string containing "node"', () => {
            assert.ok(jsRunner.run('/tmp/sol.js').includes('node'));
        });
        test('detectCmd is "node --version"', () => assert.strictEqual(jsRunner.detectCmd, 'node --version'));
    });

    suite('pythonRunner', () => {
        test('id is "python"',               () => assert.strictEqual(pythonRunner.id, 'python'));
        test('displayName is "Python"',      () => assert.strictEqual(pythonRunner.displayName, 'Python'));
        test('fileExtension is ".py"',       () => assert.strictEqual(pythonRunner.fileExtension, '.py'));
        test('fileName is undefined',        () => assert.strictEqual(pythonRunner.fileName, undefined));
        test('compile is undefined',         () => assert.strictEqual(pythonRunner.compile, undefined));
        test('run returns string containing "python3"', () => {
            assert.ok(pythonRunner.run('/tmp/sol.py').includes('python3'));
        });
        test('detectCmd is "python3 --version"', () => assert.strictEqual(pythonRunner.detectCmd, 'python3 --version'));
    });

});
