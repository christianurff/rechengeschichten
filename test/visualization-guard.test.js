const { test } = require('node:test');
const assert = require('node:assert');
const Guard = require('../visualization-guard.js');

test('precheck: einfache zählbare Aufgabe ist ok', () => {
    assert.strictEqual(Guard.precheckVisualizable(
        'Lisa hat 5 Äpfel. Sie gibt 2 Äpfel an Tom. Wie viele Äpfel hat Lisa noch?').ok, true);
});
test('precheck: Geld wird abgelehnt', () => {
    assert.strictEqual(Guard.precheckVisualizable('Ein Heft kostet 3 Euro. Lena kauft 2 Hefte.').ok, false);
    assert.strictEqual(Guard.precheckVisualizable('Das Eis kostet 1,50 €.').ok, false);
});
test('precheck: Größen/Einheiten werden abgelehnt', () => {
    assert.strictEqual(Guard.precheckVisualizable('Der Weg ist 5 km lang.').ok, false);
    assert.strictEqual(Guard.precheckVisualizable('Eine Flasche hat 2 Liter Saft.').ok, false);
    assert.strictEqual(Guard.precheckVisualizable('Die Pause dauert 20 Minuten.').ok, false);
    assert.strictEqual(Guard.precheckVisualizable('Der Zug fährt um 14:32 Uhr ab.').ok, false);
});
test('precheck: Kommazahlen und Brüche werden abgelehnt', () => {
    assert.strictEqual(Guard.precheckVisualizable('Tim isst 2,5 Brezeln.').ok, false);
    assert.strictEqual(Guard.precheckVisualizable('Die Hälfte der 8 Kekse wird gegessen.').ok, false);
    assert.strictEqual(Guard.precheckVisualizable('Ein Viertel der Kinder fehlt.').ok, false);
});
test('precheck: Vergleichsaufgaben werden abgelehnt', () => {
    assert.strictEqual(Guard.precheckVisualizable(
        'Tim hat 8 Murmeln, Anna hat 5. Wie viele mehr hat Tim?').ok, false);
    assert.strictEqual(Guard.precheckVisualizable(
        'Wie groß ist der Unterschied zwischen 9 und 4 Stiften?').ok, false);
});
test('precheck: Zahlen über 100 werden abgelehnt', () => {
    assert.strictEqual(Guard.precheckVisualizable('Die Bibliothek hat 156 Bücher. 28 werden ausgeliehen.').ok, false);
    assert.strictEqual(Guard.precheckVisualizable('96 Spieler verteilen sich auf 8 Mannschaften.').ok, true);
});
test('precheck: reason wird gesetzt', () => {
    const r = Guard.precheckVisualizable('Das Eis kostet 3 Euro.');
    assert.strictEqual(r.ok, false);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
});
test('precheck: leerer Text wird abgelehnt', () => {
    assert.strictEqual(Guard.precheckVisualizable('').ok, false);
    assert.strictEqual(Guard.precheckVisualizable(null).ok, false);
});
test('precheck: Aufgabennummerierung mit Doppelpunkt ist KEIN Uhrzeit-Blocker', () => {
    assert.strictEqual(Guard.precheckVisualizable(
        'Aufgabe 1: 5 Kinder teilen 20 Äpfel gerecht auf.').ok, true);
    assert.strictEqual(Guard.precheckVisualizable(
        'Teil 2: 8 Murmeln liegen auf dem Tisch, 3 kommen dazu.').ok, true);
});
test('precheck: echte Uhrzeiten und Verhältnis-Wort werden weiter abgelehnt', () => {
    assert.strictEqual(Guard.precheckVisualizable('Der Film beginnt um 7:30 und 6 Kinder schauen zu.').ok, false);
    assert.strictEqual(Guard.precheckVisualizable('Im Verhältnis 3 zu 4 werden 21 Bonbons verteilt.').ok, false);
});
test('precheck: Halbzeit/Halbfinale sind KEIN Bruch-Blocker', () => {
    assert.strictEqual(Guard.precheckVisualizable(
        'In der Halbzeit liegen 6 Bälle bereit, 2 kommen dazu.').ok, true);
    assert.strictEqual(Guard.precheckVisualizable(
        'Im Halbfinale spielen 8 Kinder, 4 scheiden aus.').ok, true);
});
test('precheck: echte Bruch-Wörter werden weiter abgelehnt', () => {
    assert.strictEqual(Guard.precheckVisualizable('Tim isst die halbe Pizza und 3 Brezeln.').ok, false);
    assert.strictEqual(Guard.precheckVisualizable('Nach anderthalb Runden sind 4 Kinder fertig.').ok, false);
    assert.strictEqual(Guard.precheckVisualizable('Eineinhalb Kuchen werden auf 3 Teller verteilt.').ok, false);
});

const QV = require('../quantity-visualizer.js');

function planAddRemove() {
    return [
        { aktion: 'vorbereiten', objekte: [{ name: 'apfel', suchbegriff: 'apfel' }], darstellung: 'symbol' },
        { aktion: 'hinzufuegen', objekt: 'apfel', anzahl: 12 },
        { aktion: 'wegnehmen', objekt: 'apfel', anzahl: 5 },
        { aktion: 'hinzufuegen', objekt: 'apfel', anzahl: 3 }
    ];
}

test('validatePlan: korrekter Plan mit passender Antwort ist ok', () => {
    const r = Guard.validatePlan(planAddRemove(), { expectedAnswer: 10 });
    assert.deepStrictEqual(r, { ok: true, errors: [] });
});
test('validatePlan: falsche Endmenge wird erkannt', () => {
    const r = Guard.validatePlan(planAddRemove(), { expectedAnswer: 11 });
    assert.strictEqual(r.ok, false);
});
test('validatePlan: leerer Plan schlägt fehl', () => {
    assert.strictEqual(Guard.validatePlan([], {}).ok, false);
    assert.strictEqual(Guard.validatePlan(null, {}).ok, false);
});
test('validatePlan: Plan darf nicht mit Operation beginnen', () => {
    const r = Guard.validatePlan([
        { aktion: 'vorbereiten', objekte: [{ name: 'apfel' }] },
        { aktion: 'wegnehmen', objekt: 'apfel', anzahl: 5 }
    ], {});
    assert.strictEqual(r.ok, false);
});
test('validatePlan: wegnehmen über Bestand wird erkannt', () => {
    const r = Guard.validatePlan([
        { aktion: 'vorbereiten', objekte: [{ name: 'apfel' }] },
        { aktion: 'hinzufuegen', objekt: 'apfel', anzahl: 3 },
        { aktion: 'wegnehmen', objekt: 'apfel', anzahl: 5 }
    ], {});
    assert.strictEqual(r.ok, false);
});
test('validatePlan: mehr als 3 sichtbare Stationen werden abgelehnt', () => {
    const r = Guard.validatePlan([
        { aktion: 'vorbereiten', objekte: [{ name: 'apfel' }] },
        { aktion: 'hinzufuegen', objekt: 'apfel', anzahl: 5 },
        { aktion: 'hinzufuegen', objekt: 'apfel', anzahl: 1 },
        { aktion: 'hinzufuegen', objekt: 'apfel', anzahl: 1 },
        { aktion: 'hinzufuegen', objekt: 'apfel', anzahl: 1 }
    ], {});
    assert.strictEqual(r.ok, false);
});
test('validatePlan: malnehmen ohne anhaengen bei belegter Bühne wird abgelehnt', () => {
    const r = Guard.validatePlan([
        { aktion: 'vorbereiten', objekte: [{ name: 'bonbon' }] },
        { aktion: 'hinzufuegen', objekt: 'bonbon', anzahl: 5 },
        { aktion: 'malnehmen', gruppen: 3, proGruppe: 5, grundvorstellung: 'gruppen' }
    ], {});
    assert.strictEqual(r.ok, false);
});
test('validatePlan: Malplan mit leeren Gruppen und Gesamtmenge ist gültig', () => {
    const r = Guard.validatePlan([
        { aktion: 'vorbereiten', objekte: [{ name: 'karotte' }] },
        { aktion: 'gruppen_anlegen', gruppen: 4, proGruppe: 3, gruppenname: 'Hase' },
        { aktion: 'malnehmen', gruppen: 4, proGruppe: 3, grundvorstellung: 'gruppen' },
        { aktion: 'zusammenfassen' }
    ], { expectedAnswer: 12 });
    assert.deepStrictEqual(r, { ok: true, errors: [] });
});
test('validatePlan: vorbereitete Gruppenzahl muss zum Mal-Schritt passen', () => {
    const r = Guard.validatePlan([
        { aktion: 'vorbereiten', objekte: [{ name: 'karotte' }] },
        { aktion: 'gruppen_anlegen', gruppen: 4, proGruppe: 3 },
        { aktion: 'malnehmen', gruppen: 5, proGruppe: 3, grundvorstellung: 'gruppen' }
    ], {});
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some(e => /vorbereitete Gruppen/.test(e)));
});
test('validatePlan: vorbereitete Gruppengröße muss zum Mal-Schritt passen', () => {
    const r = Guard.validatePlan([
        { aktion: 'vorbereiten', objekte: [{ name: 'karotte' }] },
        { aktion: 'gruppen_anlegen', gruppen: 4, proGruppe: 2 },
        { aktion: 'malnehmen', gruppen: 4, proGruppe: 3, grundvorstellung: 'gruppen' }
    ], {});
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some(e => /Gruppengröße/.test(e)));
});
test('validatePlan: verteilen — Antwort als Gruppengröße wird akzeptiert', () => {
    const r = Guard.validatePlan([
        { aktion: 'vorbereiten', objekte: [{ name: 'muffin' }] },
        { aktion: 'hinzufuegen', objekt: 'muffin', anzahl: 24 },
        { aktion: 'teilen', grundvorstellung: 'verteilen', anzahlGruppen: 8 }
    ], { expectedAnswer: 3 });
    assert.strictEqual(r.ok, true);
});
test('validatePlan: nicht teilbare Menge beim Teilen wird erkannt', () => {
    const r = Guard.validatePlan([
        { aktion: 'vorbereiten', objekte: [{ name: 'muffin' }] },
        { aktion: 'hinzufuegen', objekt: 'muffin', anzahl: 25 },
        { aktion: 'teilen', grundvorstellung: 'verteilen', anzahlGruppen: 8 }
    ], {});
    assert.strictEqual(r.ok, false);
});
test('validatePlan: teilen(aufteilen) mit falschem Parameter wird abgelehnt', () => {
    const r = Guard.validatePlan([
        { aktion: 'vorbereiten', objekte: [{ name: 'muffin' }] },
        { aktion: 'hinzufuegen', objekt: 'muffin', anzahl: 24 },
        { aktion: 'teilen', grundvorstellung: 'aufteilen', anzahlGruppen: 3 }
    ], {});
    assert.strictEqual(r.ok, false);
});
test('extractAnswerNumber', () => {
    assert.strictEqual(Guard.extractAnswerNumber({ antwort: '14 Murmeln' }), 14);
    assert.strictEqual(Guard.extractAnswerNumber({ antwort: 'ungefähr 200 Schritte' }), 200);
    assert.strictEqual(Guard.extractAnswerNumber(null), null);
    assert.strictEqual(Guard.extractAnswerNumber({ antwort: 'nicht lösbar' }), null);
});
