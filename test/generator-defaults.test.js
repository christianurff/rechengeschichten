/**
 * Tests für die altersbasierte Generator-Voreinstellung (Klasse + Rechenarten)
 * und die Persistenz manuell geänderter Einstellungen.
 * Ausführen: node --test test/generator-defaults.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Die selbstständige Mapping-Funktion aus app.js extrahieren und auswerten
function extractKlasseForAge() {
    const m = app.match(/function generatorKlasseForAge\(age\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'generatorKlasseForAge nicht in app.js gefunden');
    return new Function('return ' + m[0])();
}

test('Alter 6-12 wird auf Klasse 1-6 abgebildet', () => {
    const klasseForAge = extractKlasseForAge();
    assert.equal(klasseForAge(6), 1);
    assert.equal(klasseForAge(7), 2);
    assert.equal(klasseForAge(8), 3);
    assert.equal(klasseForAge(9), 4);
    assert.equal(klasseForAge(10), 5);
    assert.equal(klasseForAge(11), 6);
    assert.equal(klasseForAge(12), 6);   // bleibt bei Klasse 6 gedeckelt
    assert.equal(klasseForAge('9'), 4);  // String-Eingabe (localStorage)
    assert.equal(klasseForAge(undefined), 3); // Fallback: mittlere Stufe
});

test('Generator-Auswahl bietet Klasse 1-6 mit Zahlenräumen an', () => {
    for (const v of ['1', '2', '3', '4', '5', '6']) {
        assert.match(html, new RegExp(`<option value="${v}">Klasse ${v}`));
    }
    assert.match(html, /Klasse 1 \(bis 20\)/);
    assert.match(html, /Klasse 2 \(bis 100\)/);
    assert.match(html, /Klasse 3 \(bis 1000\)/);
});

test('Prompt kennt Zahlenraum und Rechenarten je Klassenstufe', () => {
    assert.match(api, /Klasse 1: Zahlenraum bis 20, nur Addition und Subtraktion/);
    assert.match(api, /Klasse 2: Zahlenraum bis 100, nur Addition und Subtraktion/);
    assert.match(api, /Klasse 3: Zahlenraum bis 1000, Addition\/Subtraktion\/Multiplikation \(keine Division\)/);
    assert.match(api, /Klasse 4: Zahlenraum bis 10000 und darüber, alle Grundrechenarten/);
});

test('„Gemischt" umfasst nur die Rechenarten der Klassenstufe', () => {
    assert.match(api, /klasse <= 2 \? 'gemischte Rechenarten \(NUR Plus und Minus\)'/);
    assert.match(api, /klasse === 3 \? 'gemischte Rechenarten \(Plus, Minus, Mal — KEINE Division\)'/);
    // Das sichtbare Options-Label spiegelt das wider
    assert.match(app, /'Gemischt \(\+ und −\)'/);
});

test('Manuell geänderte Auswahl wird gespeichert und hat Vorrang', () => {
    assert.match(app, /GENERATOR_SETTINGS_KEY = 'rechengeschichten_generator'/);
    // change-Listener speichern
    assert.match(app, /DOM\.generatorDifficulty\.addEventListener\('change'/);
    assert.match(app, /DOM\.generatorOperation\.addEventListener\('change', storeGeneratorSettings\)/);
    // Gespeicherte Werte gewinnen gegen die Alters-Voreinstellung
    assert.match(app, /storedKlasse \|\| String\(generatorKlasseForAge\(age\)\)/);
    assert.match(app, /storedOp \|\| 'mixed'/);
});

test('Geänderte Altersangabe setzt die gespeicherte Auswahl zurück', () => {
    assert.match(app, /prevAge !== null && prevAge !== DOM\.ageSlider\.value/);
    assert.match(app, /localStorage\.removeItem\(GENERATOR_SETTINGS_KEY\)/);
});
