/**
 * Reine Hilfsfunktionen für die mehrsprachige Unterstützung.
 * Funktioniert als klassisches Browser-Script (hängt Funktionen an window)
 * UND als CommonJS-Modul (für Node-Tests).
 */
(function (global) {
    'use strict';

    // Voreingestellte zusaetzliche Sprachen. Deutsch wird im Sprachmenue separat
    // angeboten; alle Eintraege sind gleichwertige sprachliche Lernressourcen.
    const DEFAULT_LANGUAGE_LIST = [
        { code: 'en', name: 'Englisch',   bcp47: 'en-US', flag: '🇬🇧' },
        { code: 'tr', name: 'Türkisch',   bcp47: 'tr-TR', flag: '🇹🇷' },
        { code: 'ar', name: 'Arabisch',   bcp47: 'ar-SA', flag: '🇸🇦' },
        { code: 'uk', name: 'Ukrainisch', bcp47: 'uk-UA', flag: '🇺🇦' }
    ];
    DEFAULT_LANGUAGE_LIST.forEach(Object.freeze);
    Object.freeze(DEFAULT_LANGUAGE_LIST);

    /**
     * Parst die gespeicherte Sprachliste.
     * - Fehlender/leerer String oder kaputtes JSON -> Default-Liste (erster Start).
     * - Gültiges Array (auch leeres) -> übernehmen; ungültige Einträge werden gefiltert.
     */
    function parseLanguageList(json) {
        if (typeof json !== 'string' || !json.trim()) return DEFAULT_LANGUAGE_LIST.map(cloneEntry);
        let arr;
        try {
            arr = JSON.parse(json);
        } catch (e) {
            return DEFAULT_LANGUAGE_LIST.map(cloneEntry);
        }
        if (!Array.isArray(arr)) return DEFAULT_LANGUAGE_LIST.map(cloneEntry);
        return arr
            .filter(function (e) {
                return e && typeof e === 'object'
                    && typeof e.code === 'string' && e.code.trim()
                    && typeof e.name === 'string' && e.name.trim();
            })
            .map(function (e) {
                return {
                    code: e.code.trim(),
                    name: e.name.trim(),
                    bcp47: (typeof e.bcp47 === 'string' && e.bcp47.trim()) ? e.bcp47.trim() : null,
                    flag: (typeof e.flag === 'string' && e.flag.trim()) ? e.flag.trim() : '🌐'
                };
            });
    }

    function cloneEntry(e) {
        return { code: e.code, name: e.name, bcp47: e.bcp47, flag: e.flag };
    }

    /**
     * Bildet aus einem Sprachnamen einen ASCII-Slug (für Freitext-Sprachen).
     */
    function slugifyLanguageCode(name) {
        if (typeof name !== 'string') return '';
        const code = name
            .trim()
            .toLowerCase()
            .replace(/ß/g, 'ss')
            .normalize('NFD').replace(/(\p{Script=Latin})\p{Mark}+/gu, '$1')
            .replace(/[^\p{Letter}\p{Number}\p{Mark}]+/gu, '-')
            .replace(/^-+|-+$/g, '')
            .normalize('NFC');
        return /[\p{Letter}\p{Number}]/u.test(code) ? code : '';
    }

    /**
     * Baut den Mehrsprachigkeits-Hinweis für KI-Prompts.
     * Leer, wenn kein Sprachname übergeben wird (= einsprachiger Modus).
     * Verstärkter Hinweis für 'understand', 'ask', 'read'.
     */
    function getMultilingualPromptNote(languageName, strategyMode) {
        if (!languageName || typeof languageName !== 'string') return '';
        const name = languageName.trim();
        if (!name) return '';
        let note = '\n\nMEHRSPRACHIGE LERNBEGLEITUNG: Ausgewählte Sprache: ' + name +
            '. Alle Sprachen des Kindes sind wertvolle Lernressourcen. Das Kind darf Deutsch, ' + name +
            ' oder beides gemischt zum Denken, Fragen und Erklären verwenden. Bestärke diese Sprachwahl freundlich und selbstverständlich. ' +
            'Reagiere auf die tatsächlich verwendete Sprache und biete bei Bedarf Wörter, Erklärungen oder kurze Passagen auf ' + name +
            ' an. Nutze gelegentlich Sprachvergleiche, wenn sie das mathematische Verstehen fördern. ' +
            'Wenn ein Ergebnis mit der Klasse geteilt werden soll, hilf anschließend bei einer verständlichen Formulierung auf Deutsch. ' +
            'Erzwinge keinen Sprachwechsel und übersetze nicht automatisch alles.';
        const emphasis = ['understand', 'ask', 'read'];
        if (emphasis.indexOf(strategyMode) !== -1) {
            note += ' Achte in diesem Modus besonders sprachsensibel auf mögliche Sprachhürden: Erkläre schwierige Fachwörter ' +
                'einfach und biete dem Kind an, sie auch auf ' + name + ' zu klären.';
        }
        return note;
    }

    /**
     * Sucht eine zur Sprache passende Stimme (exakt, dann Primary-Subtag).
     * @param {string} bcp47 - z.B. 'ar' oder 'ar-SA'
     * @param {Array} voices - Liste mit .lang (z.B. speechSynthesis.getVoices())
     */
    function resolveVoiceForLanguage(bcp47, voices) {
        if (!bcp47 || typeof bcp47 !== 'string' || !Array.isArray(voices)) return null;
        const want = bcp47.toLowerCase();
        const wantPrimary = want.split('-')[0];
        const exact = voices.find(function (v) {
            return v && typeof v.lang === 'string' && v.lang.toLowerCase() === want;
        });
        if (exact) return exact;
        const primary = voices.find(function (v) {
            return v && typeof v.lang === 'string' && v.lang.toLowerCase().split('-')[0] === wantPrimary;
        });
        return primary || null;
    }

    /**
     * Findet den Listen-Eintrag zu einem Code.
     */
    function findLanguageByCode(list, code) {
        if (!Array.isArray(list) || !code) return null;
        return list.find(function (e) { return e && e.code === code; }) || null;
    }

    global.DEFAULT_LANGUAGE_LIST = DEFAULT_LANGUAGE_LIST;
    global.parseLanguageList = parseLanguageList;
    global.slugifyLanguageCode = slugifyLanguageCode;
    global.getMultilingualPromptNote = getMultilingualPromptNote;
    global.resolveVoiceForLanguage = resolveVoiceForLanguage;
    global.findLanguageByCode = findLanguageByCode;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            DEFAULT_LANGUAGE_LIST: DEFAULT_LANGUAGE_LIST,
            parseLanguageList: parseLanguageList,
            slugifyLanguageCode: slugifyLanguageCode,
            getMultilingualPromptNote: getMultilingualPromptNote,
            resolveVoiceForLanguage: resolveVoiceForLanguage,
            findLanguageByCode: findLanguageByCode
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
