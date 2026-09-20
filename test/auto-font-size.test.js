/**
 * Tests für die längenabhängige automatische Lese-Schriftgröße.
 * Kurze Aufgaben behalten die eingestellte Größe, lange werden sanft
 * verkleinert (mit Untergrenze - danach wird gescrollt).
 * Ausführen: node --test test/auto-font-size.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Die selbstständige Funktion aus app.js extrahieren und auswerten
function extractAutoFontSizeFor() {
    const m = app.match(/function autoFontSizeFor\(textLength, baseSize\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'autoFontSizeFor nicht in app.js gefunden');
    return new Function('return ' + m[0])();
}

const autoFontSizeFor = extractAutoFontSizeFor();

test('kurze Aufgaben behalten die eingestellte Größe', () => {
    assert.equal(autoFontSizeFor(0, 24), 24);
    assert.equal(autoFontSizeFor(120, 24), 24);
    assert.equal(autoFontSizeFor(250, 24), 24);
});

test('längere Aufgaben werden sanft kleiner (monoton fallend)', () => {
    const sizes = [250, 350, 450, 550, 700].map(len => autoFontSizeFor(len, 24));
    for (let i = 1; i < sizes.length; i++) {
        assert.ok(sizes[i] <= sizes[i - 1], `nicht monoton bei Index ${i}: ${sizes}`);
    }
    assert.ok(autoFontSizeFor(450, 24) < 24, 'mittellange Aufgabe sollte kleiner sein');
});

test('sehr lange Aufgaben: Untergrenze statt Winzschrift (dann wird gescrollt)', () => {
    const atLong = autoFontSizeFor(700, 24);
    assert.equal(autoFontSizeFor(2000, 24), atLong, 'ab LONG keine weitere Verkleinerung');
    assert.equal(atLong, Math.round(24 * 0.8));
    assert.ok(atLong >= 16, 'nie unter das Slider-Minimum');
});

test('kleine Basisgrößen werden nie unterschritten oder vergrößert', () => {
    assert.equal(autoFontSizeFor(2000, 16), 16);
    assert.ok(autoFontSizeFor(2000, 18) >= 16);
    assert.ok(autoFontSizeFor(2000, 40) <= 40);
});

test('defensive Eingaben: ungültige Werte fallen auf Defaults zurück', () => {
    assert.equal(autoFontSizeFor(null, 24), 24);
    assert.equal(autoFontSizeFor(100, undefined), 24);
    assert.equal(autoFontSizeFor(undefined, undefined), 24);
});

test('Hooks sind verdrahtet: Erkunden wendet an, Bearbeiten stellt Basis wieder her', () => {
    assert.match(app, /syncFontSizeSliders\(\);\s*\n\s*\/\/[^\n]*\n\s*applyAutoReadingFontSize\(\);/,
        'switchToExploreMode ruft applyAutoReadingFontSize auf');
    const inputMode = app.slice(app.indexOf('function switchToInputMode'), app.indexOf('function switchToInputMode') + 1200);
    assert.match(inputMode, /reader\.setFontSize\(parseInt\(DOM\.fontSizeReading\.value, 10\)/,
        'switchToInputMode stellt die Basisgröße wieder her');
});
