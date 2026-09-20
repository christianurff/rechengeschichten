const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('Los-gehts-Button wird in der Textkarte verankert', () => {
    assert.match(app, /DOM\.readerContainer\.appendChild\(goBar\)/);
    assert.match(css, /\.go-explore-bar\s*\{[^}]*position:\s*absolute;[^}]*right:\s*20px;[^}]*bottom:\s*20px;/s);
    assert.doesNotMatch(css, /\.go-explore-bar\s*\{[^}]*position:\s*fixed;/s);
});

test('Primaeraktion erscheint nur bei gefuellter Aufgabe', () => {
    assert.match(app, /goBar\.classList\.toggle\('is-ready', hasText\)/);
    assert.match(app, /DOM\.readerContainer\.classList\.toggle\('has-go-action', hasText\)/);
    assert.match(css, /\.go-explore-bar\.is-ready\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;/s);
});

test('Sichtbarer Button verdeckt den Aufgabentext nicht', () => {
    assert.match(css, /\.reader-text-view-container\.has-go-action \.reader-text-view\s*\{[^}]*padding-bottom:\s*108px !important;/s);
});

test('Button bleibt nach dem Einblenden ruhig und respektiert reduzierte Bewegung', () => {
    assert.doesNotMatch(css, /go-hop|\.btn-go-explore\.hop/);
    assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.go-explore-bar\.is-ready/);
    assert.match(css, /\.btn-go-explore:active:not\(:disabled\)\s*\{[^}]*transform:\s*scale\(0\.96\)/s);
});
