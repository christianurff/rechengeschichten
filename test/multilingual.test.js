const { test } = require('node:test');
const assert = require('node:assert');
const {
    DEFAULT_LANGUAGE_LIST,
    parseLanguageList,
    slugifyLanguageCode,
    getMultilingualPromptNote,
    resolveVoiceForLanguage,
    findLanguageByCode
} = require('../multilingual.js');

// --- parseLanguageList ---
test('parseLanguageList: leerer/fehlender String -> Default-Liste', () => {
    assert.deepStrictEqual(parseLanguageList(''), DEFAULT_LANGUAGE_LIST);
    assert.deepStrictEqual(parseLanguageList(null), DEFAULT_LANGUAGE_LIST);
});

test('parseLanguageList: kaputtes JSON -> Default-Liste', () => {
    assert.deepStrictEqual(parseLanguageList('{nicht json'), DEFAULT_LANGUAGE_LIST);
});

test('parseLanguageList: gültiges leeres Array bleibt leer (bewusste Nutzerwahl)', () => {
    assert.deepStrictEqual(parseLanguageList('[]'), []);
});

test('parseLanguageList: filtert ungültige Einträge und normalisiert', () => {
    const json = JSON.stringify([
        { code: 'tr', name: 'Türkisch', bcp47: 'tr-TR', flag: '🇹🇷' },
        { code: '', name: 'kaputt' },
        { name: 'ohne code' },
        { code: 'fa', name: 'Farsi' }
    ]);
    assert.deepStrictEqual(parseLanguageList(json), [
        { code: 'tr', name: 'Türkisch', bcp47: 'tr-TR', flag: '🇹🇷' },
        { code: 'fa', name: 'Farsi', bcp47: null, flag: '🌐' }
    ]);
});

// --- slugifyLanguageCode ---
test('slugifyLanguageCode: einfache Namen', () => {
    assert.strictEqual(slugifyLanguageCode('Farsi'), 'farsi');
    assert.strictEqual(slugifyLanguageCode('Sorani-Kurdisch'), 'sorani-kurdisch');
});

test('slugifyLanguageCode: Umlaute/ß und Leerzeichen', () => {
    assert.strictEqual(slugifyLanguageCode('  Tükrïsch '), 'tukrisch');
    assert.strictEqual(slugifyLanguageCode('Straße Sprache'), 'strasse-sprache');
});

test('slugifyLanguageCode: Nicht-String/leer -> leer', () => {
    assert.strictEqual(slugifyLanguageCode(''), '');
    assert.strictEqual(slugifyLanguageCode(null), '');
});

test('slugifyLanguageCode: nicht-lateinische Schriften bleiben erhalten', () => {
    assert.strictEqual(slugifyLanguageCode('عربي'), 'عربي');
    assert.strictEqual(slugifyLanguageCode('Українська'), 'українська');
});

test('slugifyLanguageCode: Dialekte funktionieren, reine Symbole bleiben leer', () => {
    assert.strictEqual(slugifyLanguageCode('Kölsch'), 'kolsch');
    assert.strictEqual(slugifyLanguageCode('🗣️'), '');
});

// --- getMultilingualPromptNote ---
test('getMultilingualPromptNote: leerer Sprachname -> leerer String', () => {
    assert.strictEqual(getMultilingualPromptNote('', 'understand'), '');
    assert.strictEqual(getMultilingualPromptNote(null, 'solve'), '');
});

test('getMultilingualPromptNote: rahmt beide Sprachen als wertvolle Lernressourcen', () => {
    const note = getMultilingualPromptNote('Türkisch', 'solve');
    assert.ok(note.includes('Türkisch'));
    assert.ok(note.includes('Alle Sprachen des Kindes sind wertvolle Lernressourcen'));
    assert.ok(note.includes('Deutsch, Türkisch oder beides gemischt'));
    assert.ok(note.includes('mit der Klasse geteilt werden soll'));
    assert.ok(!note.includes('Deutsch bleibt die Arbeitssprache'));
});

test('getMultilingualPromptNote: Verstärkung nur bei understand/ask/read', () => {
    assert.ok(getMultilingualPromptNote('Türkisch', 'understand').includes('besonders sprachsensibel'));
    assert.ok(getMultilingualPromptNote('Türkisch', 'ask').includes('besonders sprachsensibel'));
    assert.ok(getMultilingualPromptNote('Türkisch', 'read').includes('besonders sprachsensibel'));
    assert.ok(!getMultilingualPromptNote('Türkisch', 'solve').includes('besonders sprachsensibel'));
});

// --- resolveVoiceForLanguage ---
test('resolveVoiceForLanguage: exakter Match', () => {
    const voices = [{ lang: 'de-DE' }, { lang: 'ar-SA' }];
    assert.strictEqual(resolveVoiceForLanguage('ar-SA', voices), voices[1]);
});

test('resolveVoiceForLanguage: Primary-Subtag-Match (ar findet ar-SA)', () => {
    const voices = [{ lang: 'de-DE' }, { lang: 'ar-SA' }];
    assert.strictEqual(resolveVoiceForLanguage('ar', voices), voices[1]);
});

test('resolveVoiceForLanguage: kein Match -> null', () => {
    const voices = [{ lang: 'de-DE' }];
    assert.strictEqual(resolveVoiceForLanguage('fr-FR', voices), null);
});

test('resolveVoiceForLanguage: defensive Eingaben -> null', () => {
    assert.strictEqual(resolveVoiceForLanguage(null, [{ lang: 'de-DE' }]), null);
    assert.strictEqual(resolveVoiceForLanguage('de-DE', null), null);
});

// --- findLanguageByCode ---
test('findLanguageByCode: findet Eintrag bzw. null', () => {
    const list = [{ code: 'tr', name: 'Türkisch' }];
    assert.deepStrictEqual(findLanguageByCode(list, 'tr'), { code: 'tr', name: 'Türkisch' });
    assert.strictEqual(findLanguageByCode(list, 'xx'), null);
    assert.strictEqual(findLanguageByCode(null, 'tr'), null);
});
