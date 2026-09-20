const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('Foto-Button nutzt denselben weißen Grundzustand wie die anderen Eingabe-Buttons', () => {
    const photoSection = css.slice(css.indexOf('/* Foto-Button */'), css.indexOf('/* Undo Button */'));
    assert.match(photoSection, /\.btn-photo\s*\{[^}]*background:\s*var\(--color-surface, #fff\) !important/s);
    assert.match(photoSection, /border:\s*2px solid transparent !important/);
    assert.doesNotMatch(photoSection, /var\(--color-bg\)/);
});

test('Foto-Popover öffnet innerhalb des Aufgabenbereichs nach rechts', () => {
    assert.match(css, /\.photo-dropdown\s*\{[^}]*left:\s*0;[^}]*right:\s*auto;/s);
});

test('Sammlungs-Speicherbutton steht in der kompakten Leiste ganz rechts', () => {
    assert.match(css, /\.input-ways\.compact \.input-way-save\s*\{[^}]*margin-left:\s*auto;/s);
});
