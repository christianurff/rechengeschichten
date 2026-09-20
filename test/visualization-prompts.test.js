const { test } = require('node:test');
const assert = require('node:assert');
const VP = require('../visualization-prompts.js');

test('interaktiver Visualisierungs-Prompt verbindet das Bild mit Operation oder Gleichung', () => {
    const prompt = VP.getVisualizeInteractivePrompt(8);
    assert.match(prompt, /ANSCHLUSS NACH DER VISUALISIERUNG/);
    assert.match(prompt, /Rechenoperation/);
    assert.match(prompt, /Term oder eine Gleichung/);
    assert.match(prompt, /Beziehe dich konkret auf das Sichtbare/);
});

test('begleiteter Visualisierungs-Prompt fordert nach dem Legen eine mathematische Anschlussfrage', () => {
    const prompt = VP.getVisualizeGuidedPrompt(8, '1. 12 Plaettchen legen');
    assert.match(prompt, /ANSCHLUSS, WENN ALLE SCHRITTE LIEGEN/);
    assert.match(prompt, /Plättchenbild/);
    assert.match(prompt, /Rechenaufgabe, einen Term oder eine Gleichung/);
    assert.match(prompt, /nicht direkt nur nach dem Endergebnis/);
});

test('Standhinweis schaltet nach dem letzten Schritt auf die Anschlussfrage um', () => {
    const hint = VP.getVisualizeStandHinweis(3, 3);
    assert.match(hint, /kein \[WEITER\]/);
    assert.match(hint, /Anschlussfrage/);
    assert.match(hint, /Rechenoperation/);
    assert.match(hint, /Plättchenbild/);
});

test('Mal-Prompt fordert leere Gruppen vor ihrer Füllung', () => {
    const prompt = VP.getVisualizeScriptSystemPrompt(8);
    assert.match(prompt, /ZUERST "gruppen_anlegen"/);
    assert.match(prompt, /Erst im NÄCHSTEN Schritt folgt "malnehmen"/);
    assert.match(prompt, /höchstens 50/);
    assert.match(prompt, /"zusammenfassen"/);
});

test('enhanceMultiplicationPlan ergänzt Gruppen und passende Gesamtmenge deterministisch', () => {
    const plan = VP.enhanceMultiplicationPlan([
        { aktion: 'vorbereiten', objekte: [{ name: 'karotte' }] },
        { aktion: 'malnehmen', gruppen: 4, proGruppe: 3, grundvorstellung: 'gruppen' }
    ], 'Auf der Wiese sind 4 Hasen. Jeder Hase hat 3 Karotten. Wie viele Karotten sind es insgesamt?');
    assert.deepStrictEqual(plan.map(s => s.aktion), [
        'vorbereiten', 'gruppen_anlegen', 'malnehmen', 'zusammenfassen'
    ]);
    assert.strictEqual(plan[1].gruppenname, 'Hase');
});

test('enhanceMultiplicationPlan lässt große oder mehrschrittige Gesamtmengen gruppiert', () => {
    const large = VP.enhanceMultiplicationPlan([
        { aktion: 'vorbereiten' },
        { aktion: 'malnehmen', gruppen: 8, proGruppe: 8, grundvorstellung: 'gruppen' },
        { aktion: 'zusammenfassen' }
    ], 'Wie viele sind es insgesamt?');
    assert.deepStrictEqual(large.map(s => s.aktion), ['vorbereiten', 'gruppen_anlegen', 'malnehmen']);

    const multi = VP.enhanceMultiplicationPlan([
        { aktion: 'vorbereiten' },
        { aktion: 'malnehmen', gruppen: 2, proGruppe: 3, grundvorstellung: 'gruppen' },
        { aktion: 'malnehmen', gruppen: 2, proGruppe: 4, grundvorstellung: 'gruppen', anhaengen: true }
    ], 'Wie viele sind es insgesamt?');
    assert.deepStrictEqual(multi.map(s => s.aktion), [
        'vorbereiten', 'gruppen_anlegen', 'malnehmen', 'malnehmen'
    ]);
});
