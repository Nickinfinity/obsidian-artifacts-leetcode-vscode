import * as assert from 'node:assert';
import { renderMarkdownLite } from '../src/utils/markdown-lite.js';

/**
 * Unit tests for renderMarkdownLite(src): string.
 *
 * The artifact description is untrusted `.md` — every case here doubles as a
 * security check: the output must never carry markup the source did not earn
 * through the supported subset.
 */
suite('renderMarkdownLite', () => {

    suite('blocks', () => {

        test('a paragraph is wrapped in <p>, soft line breaks joined', () => {
            assert.strictEqual(renderMarkdownLite('one\ntwo'), '<p>one two</p>');
        });

        test('a blank line starts a new paragraph', () => {
            assert.strictEqual(renderMarkdownLite('one\n\ntwo'), '<p>one</p><p>two</p>');
        });

        test('empty source renders nothing', () => {
            assert.strictEqual(renderMarkdownLite('   \n\n  '), '');
        });

        test('a dash list becomes a <ul>', () => {
            assert.strictEqual(renderMarkdownLite('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
        });

        test('a star list becomes a <ul> too', () => {
            assert.strictEqual(renderMarkdownLite('* a'), '<ul><li>a</li></ul>');
        });

        test('a numbered list becomes an <ol>', () => {
            assert.strictEqual(renderMarkdownLite('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
        });

        test('a quote becomes a <blockquote> with its markers stripped', () => {
            assert.strictEqual(renderMarkdownLite('> note\n> more'), '<blockquote><p>note more</p></blockquote>');
        });

        test('a heading becomes an <h4> whatever its level', () => {
            assert.strictEqual(renderMarkdownLite('### Files'), '<h4>Files</h4>');
        });

        test('list, paragraph and quote can follow each other without a blank line', () => {
            assert.strictEqual(
                renderMarkdownLite('intro\n- a\n> q'),
                '<p>intro</p><ul><li>a</li></ul><blockquote><p>q</p></blockquote>',
            );
        });

    });

    suite('inline', () => {

        test('backticks become <code>', () => {
            assert.strictEqual(renderMarkdownLite('use `npm ci`'), '<p>use <code>npm ci</code></p>');
        });

        test('double asterisks become <strong>', () => {
            assert.strictEqual(renderMarkdownLite('**loud**'), '<p><strong>loud</strong></p>');
        });

        test('single asterisks become <em>', () => {
            assert.strictEqual(renderMarkdownLite('*soft*'), '<p><em>soft</em></p>');
        });

        test('an http link becomes an anchor', () => {
            assert.strictEqual(
                renderMarkdownLite('[docs](https://example.com/a)'),
                '<p><a href="https://example.com/a">docs</a></p>',
            );
        });

        test('markdown inside a code span stays literal', () => {
            assert.strictEqual(renderMarkdownLite('`a **b**`'), '<p><code>a **b**</code></p>');
        });

    });

    suite('SECURITY: nothing but the supported subset reaches the webview', () => {

        test('raw HTML in the source is escaped, never passed through', () => {
            assert.strictEqual(
                renderMarkdownLite('<img src=x onerror=alert(1)>'),
                '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
            );
        });

        test('a script tag inside a code span is escaped too', () => {
            assert.strictEqual(
                renderMarkdownLite('`<script>alert(1)</script>`'),
                '<p><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></p>',
            );
        });

        test('a javascript: link renders as plain text, never as an anchor', () => {
            const html = renderMarkdownLite('[click](javascript:alert)');
            assert.ok(!html.includes('<a '), `anchor emitted for a javascript: URL: ${html}`);
            assert.ok(!html.includes('javascript:'), `javascript: URL survived: ${html}`);
            assert.strictEqual(html, '<p>click</p>');
        });

        test('a data: link renders as plain text too', () => {
            assert.strictEqual(renderMarkdownLite('[x](data:text/html,<b>)'), '<p>x</p>');
        });

        test('a relative link renders as plain text — it resolves to nothing in a webview', () => {
            assert.strictEqual(renderMarkdownLite('[spec](../../docs/plan.md)'), '<p>spec</p>');
        });

        test('quotes in a link label cannot break out of the attribute', () => {
            assert.strictEqual(
                renderMarkdownLite('["a](https://x.test)'),
                '<p><a href="https://x.test">&quot;a</a></p>',
            );
        });

    });

});
