/**
 * Tests für speech-text-utils.js: „1." am Satzende darf nicht als Ordnungszahl
 * („erster") vorgelesen werden — echte Ordnungszahlen und nummerierte Listen
 * müssen aber erhalten bleiben.
 * Ausführen: node --test test/speech-text-utils.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { fixNumberPeriodsForSpeech } = require('../speech-text-utils.js');

test('Zahl am Satzende vor Großbuchstabe: Punkt wird abgetrennt', () => {
    assert.strictEqual(
        fixNumberPeriodsForSpeech('Ich sehe die Rechnung 2 + 1. In unserer Aufgabe hat Tim 8 Murmeln.'),
        'Ich sehe die Rechnung 2 + 1 . In unserer Aufgabe hat Tim 8 Murmeln.'
    );
});

test('Zahl am Textende: Punkt wird abgetrennt', () => {
    assert.strictEqual(
        fixNumberPeriodsForSpeech('Das Ergebnis ist 14.'),
        'Das Ergebnis ist 14 .'
    );
});

test('Zahl am Satzende nach Verb: Punkt wird abgetrennt', () => {
    assert.strictEqual(
        fixNumberPeriodsForSpeech('Tim bekommt 6. Wie viele sind es jetzt?'),
        'Tim bekommt 6 . Wie viele sind es jetzt?'
    );
});

test('Echte Ordnungszahl nach Artikel bleibt erhalten', () => {
    assert.strictEqual(
        fixNumberPeriodsForSpeech('Die 2. Mannschaft hat gewonnen.'),
        'Die 2. Mannschaft hat gewonnen.'
    );
    assert.strictEqual(
        fixNumberPeriodsForSpeech('Am 3. Mai ist das Fest.'),
        'Am 3. Mai ist das Fest.'
    );
    assert.strictEqual(
        fixNumberPeriodsForSpeech('Das steht im 4. Kapitel.'),
        'Das steht im 4. Kapitel.'
    );
});

test('Nummerierte Liste am Zeilenanfang bleibt erhalten', () => {
    assert.strictEqual(
        fixNumberPeriodsForSpeech('1. Lies die Aufgabe.\n2. Rechne aus.'),
        '1. Lies die Aufgabe.\n2. Rechne aus.'
    );
});

test('Ordnungszahl vor kleingeschriebenem Wort bleibt erhalten', () => {
    assert.strictEqual(
        fixNumberPeriodsForSpeech('Er kam beim 1. großen Rennen an.'),
        'Er kam beim 1. großen Rennen an.'
    );
});

test('Dezimal-/Tausenderschreibweise bleibt unangetastet', () => {
    assert.strictEqual(fixNumberPeriodsForSpeech('Das kostet 3.50 Euro.'), 'Das kostet 3.50 Euro.');
    assert.strictEqual(fixNumberPeriodsForSpeech('Es sind 1.000 Punkte.'), 'Es sind 1.000 Punkte.');
});

test('Satzende vor Ziffern-Satzanfang wird ebenfalls abgetrennt', () => {
    assert.strictEqual(
        fixNumberPeriodsForSpeech('Rechne 3 + 4. 7 ist richtig!'),
        'Rechne 3 + 4 . 7 ist richtig!'
    );
});

test('Robust bei leerem/ungültigem Input', () => {
    assert.strictEqual(fixNumberPeriodsForSpeech(''), '');
    assert.strictEqual(fixNumberPeriodsForSpeech(null), '');
    assert.strictEqual(fixNumberPeriodsForSpeech(undefined), '');
});

test('Text ohne Zahlen bleibt identisch', () => {
    const t = 'Super gemacht! Wie bist du darauf gekommen?';
    assert.strictEqual(fixNumberPeriodsForSpeech(t), t);
});
