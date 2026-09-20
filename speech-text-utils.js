/**
 * speech-text-utils.js — Textaufbereitung für die Sprachausgabe.
 * Dual-Export wie note-pad.js: in Node testbar, im Browser als global.SpeechTextUtils.
 *
 * Problem: Deutsche TTS-Stimmen lesen „Zahl + Punkt" als Ordnungszahl —
 * „die Rechnung 2 + 1. In unserer Aufgabe …" wird zu „zwei plus ERSTER In …".
 * Lösung: Bei Zahlen, deren Punkt ein Satzende ist, den Punkt mit einem
 * Leerzeichen abtrennen („1 ."). Die Sprechpause bleibt, die Ordnungszahl-
 * Interpretation entfällt. Echte Ordnungszahlen werden per Heuristik erkannt
 * und behalten ihren Punkt.
 */
(function (global) {
    'use strict';

    // Wörter, nach denen eine „Zahl." typischerweise eine echte Ordnungszahl ist
    // (Artikel, Präpositionen mit Artikel, Possessiv-/Demonstrativpronomen).
    var ORDINAL_HINTS = {};
    ('der die das dem den des ein eine einem einen einer eines ' +
     'am im vom zum zur beim jede jeder jedes jedem jeden ' +
     'welche welcher welches welchem welchen ' +
     'diese dieser dieses diesem diesen jene jener jenes jenem jenen ' +
     'meine meiner meinem meinen deine deiner deinem deinen ' +
     'seine seiner seinem seinen ihre ihrer ihrem ihren ' +
     'unsere unserer unserem unseren eure eurer eurem euren')
        .split(' ')
        .forEach(function (w) { ORDINAL_HINTS[w] = true; });

    /**
     * Trennt bei Satz-finalen Zahlen den Punkt ab („bekommt 6. Wie …" -> „bekommt 6 . Wie …"),
     * damit die TTS keine Ordnungszahl liest. Erhalten bleiben:
     * - echte Ordnungszahlen nach Artikel/Pronomen („die 2. Mannschaft", „am 3. Mai"),
     * - Ordnungszahlen vor kleingeschriebenen Wörtern („beim 1. großen Rennen"),
     * - nummerierte Listen am Zeilenanfang („1. Lies die Aufgabe"),
     * - Dezimal-/Tausenderschreibweisen („3.50", „1.000") und Ellipsen.
     */
    function fixNumberPeriodsForSpeech(text) {
        if (typeof text !== 'string' || !text) { return ''; }
        // Zahl + Punkt, gefolgt von Leerraum + Großbuchstabe/Ziffer/Anführung
        // (neuer Satz) oder vom Textende.
        var re = /(\d+)\.(?=\s+["„“»«‚'']?[A-Z0-9ÄÖÜ]|\s*$)/g;
        return text.replace(re, function (match, num, offset, whole) {
            var before = whole.slice(0, offset);
            // Zeilen-/Textanfang: nummerierte Liste -> Ordnungszahl behalten
            if (/(^|\n)\s*$/.test(before)) { return match; }
            // Wort direkt vor der Zahl: Artikel/Pronomen -> Ordnungszahl behalten
            var prevWord = before.match(/([A-Za-zÄÖÜäöüß]+)\s+$/);
            if (prevWord && ORDINAL_HINTS[prevWord[1].toLowerCase()]) { return match; }
            return num + ' .';
        });
    }

    // ---------- Export ----------
    global.SpeechTextUtils = global.SpeechTextUtils || {};
    global.SpeechTextUtils.fixNumberPeriodsForSpeech = fixNumberPeriodsForSpeech;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { fixNumberPeriodsForSpeech: fixNumberPeriodsForSpeech };
    }
})(typeof window !== 'undefined' ? window : globalThis);
