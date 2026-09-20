const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { extractImportantWords, findWholeWordRanges } = require('../reading-word-utils.js');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('extractImportantWords liest die erste Spalte der Wortübersicht', () => {
    const overview = [
        '| Wort | Erklärung |',
        '| --- | --- |',
        '| Rest | Was übrig bleibt |',
        '| verteilen | Gerecht aufteilen |'
    ].join('\n');

    assert.deepEqual(extractImportantWords(overview), ['Rest', 'verteilen']);
});

test('extractImportantWords entfernt Markdown und Duplikate', () => {
    const overview = '| Wort | Erklärung |\n| **Murmeln** | Kugeln |\n| murmeln | Doppelt |';
    assert.deepEqual(extractImportantWords(overview), ['Murmeln']);
    assert.deepEqual(extractImportantWords('Keine schwierigen Wörter gefunden.'), []);
});

test('findWholeWordRanges markiert unabhängig von Großschreibung nur ganze Wörter', () => {
    const text = 'Der Rest bleibt. Den RESTE-Vorrat zählen wir nicht.';
    assert.deepEqual(findWholeWordRanges(text, ['Rest']), [{ start: 4, end: 8 }]);
});

test('findWholeWordRanges findet mehrere wichtige Wörter ohne Überschneidung', () => {
    const text = 'Drei Kinder verteilen Murmeln an Kinder.';
    assert.deepEqual(findWholeWordRanges(text, ['Kinder', 'Murmeln']), [
        { start: 5, end: 11 },
        { start: 22, end: 29 },
        { start: 33, end: 39 }
    ]);
});

test('Text-lesen-Modus zeigt den festen Longpress-Hinweis und markiert wichtige Wörter', () => {
    assert.match(app, /Tipp: Drücke ein schwieriges Wort im Text länger\. Dann wird es dir erklärt\./);
    assert.match(app, /highlightReadingImportantWords\(overviewText\)/);
    assert.match(css, /\.reading-word-hint\s*\{/);
    assert.match(css, /\.reading-important-word\s*\{/);
    assert.match(api, /Übernimm jedes Wort exakt in der Form, in der es im Aufgabentext vorkommt\./);
});

test('Wortlisten-Helfer wird vor der App geladen', () => {
    assert.ok(html.indexOf('reading-word-utils.js?v=1') < html.indexOf('app.js?v='));
});
