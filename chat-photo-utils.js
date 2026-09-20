/**
 * Reine Hilfsfunktionen für das Foto-im-Chat-Feature.
 * Funktioniert als klassisches Browser-Script (hängt Funktionen an window)
 * UND als CommonJS-Modul (für Node-Tests).
 */
(function (global) {
    'use strict';

    // Module, in denen das Kind eigene Lösungen/Skizzen einbringt
    const PHOTO_CHAT_STRATEGIES = ['solve', 'check', 'assumptions', 'detective', 'understand'];
    Object.freeze(PHOTO_CHAT_STRATEGIES);

    function isPhotoChatStrategy(strategy) {
        return PHOTO_CHAT_STRATEGIES.indexOf(strategy) !== -1;
    }

    /**
     * Prompt-Baustein, der enaktives/ikonisches Arbeiten anregt.
     * @param {string} strategy
     * @param {{photoEnabled: boolean}} [opts]
     * @returns {string} leer, wenn der Modus nicht passt
     */
    function getEnactiveNudge(strategy, opts) {
        if (typeof strategy !== 'string') { return ''; }
        const photoEnabled = !!(opts && opts.photoEnabled);
        // alle PHOTO_CHAT_STRATEGIES außer 'understand'
        const solutionModes = PHOTO_CHAT_STRATEGIES.filter(function (s) { return s !== 'understand'; });
        let note = '';
        if (solutionModes.indexOf(strategy) !== -1) {
            note = '\n\nARBEITEN MIT PAPIER/MATERIAL: Wenn das Kind beim Rechnen nicht weiterkommt, ' +
                'darfst du anregen, die Aufgabe auf Papier zu bearbeiten oder eine Skizze zu zeichnen. ' +
                'Schlage konkretes Material (z. B. Plättchen, Rechenfeld, Zahlenstrahl) NUR vor, wenn es ' +
                'wirklich zur Lösungsstrategie dieser Aufgabe passt, und ausschließlich als unverbindliche ' +
                'Anregung — das Kind hat das Material vielleicht nicht zur Hand oder kennt es nicht. ' +
                'Dränge kein Material auf.';
        } else if (strategy === 'understand') {
            note = '\n\nSKIZZE: Du darfst anregen, die Zusammenhänge der Aufgabe als kleine Skizze zu ' +
                'zeichnen (z. B. wer hat was, was wird gesucht).';
        } else {
            return '';
        }
        if (photoEnabled) {
            note += ' Das Kind kann seine Notizen, Skizze oder das gelegte Material auch fotografieren ' +
                'und hier im Chat zeigen.';
        }
        return note;
    }

    global.isPhotoChatStrategy = isPhotoChatStrategy;
    global.getEnactiveNudge = getEnactiveNudge;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { isPhotoChatStrategy: isPhotoChatStrategy, getEnactiveNudge: getEnactiveNudge };
    }
})(typeof window !== 'undefined' ? window : globalThis);
