/**
 * Reine Hilfsfunktionen fuer die Worterklaerung mit Bild/Emoji.
 * Funktioniert als klassisches Browser-Script (haengt Funktionen an window)
 * UND als CommonJS-Modul (fuer Node-Tests).
 */
(function (global) {
    'use strict';

    /**
     * Parst die KI-Antwort der Worterklaerung zu einem normalisierten Objekt.
     * @param {string} content - Rohtext der KI-Antwort (ggf. mit Markdown-Block)
     * @returns {{explanation: string, emoji: string|null, imageQuery: string[], depictable: boolean}}
     */
    function parseWordExplanationResponse(content) {
        const fallbackText = (typeof content === 'string') ? content.trim() : '';
        const fallback = { explanation: fallbackText, emoji: null, imageQuery: [], depictable: false, translation: null };

        if (!fallbackText) return fallback;

        const match = fallbackText.match(/\{[\s\S]*\}/);
        if (!match) return fallback;

        let obj;
        try {
            obj = JSON.parse(match[0]);
        } catch (e) {
            return fallback;
        }

        const explanation = (typeof obj.erklaerung === 'string') ? obj.erklaerung.trim() : '';
        if (!explanation) return fallback;

        const depictable = obj.zeigbar === true;

        let emoji = null;
        if (typeof obj.emoji === 'string') {
            const e = obj.emoji.trim();
            emoji = e.length ? e : null;
        }

        let imageQuery = [];
        if (Array.isArray(obj.bildbegriff)) {
            imageQuery = obj.bildbegriff
                .filter(t => t && typeof t === 'string')
                .map(t => t.trim().toLowerCase())
                .filter(t => t.length);
        } else if (typeof obj.bildbegriff === 'string' && obj.bildbegriff.trim()) {
            imageQuery = [obj.bildbegriff.trim().toLowerCase()];
        }

        let translation = null;
        if (typeof obj.uebersetzung === 'string') {
            const t = obj.uebersetzung.trim();
            translation = t.length ? t : null;
        }

        return {
            explanation,
            emoji,
            imageQuery: depictable ? imageQuery : [],
            depictable,
            translation
        };
    }

    /**
     * Entscheidet, welches Visual angezeigt wird (ARASAAC-Bild bevorzugt, sonst Emoji).
     * @param {{depictable: boolean, emoji: string|null}} modelResult
     * @param {string|null} arasaacUrl - gefundene ARASAAC-URL oder null
     * @returns {null | {type:'image', src:string} | {type:'emoji', emoji:string}}
     */
    function resolveWordVisual(modelResult, arasaacUrl) {
        if (!modelResult || modelResult.depictable !== true) return null;
        if (arasaacUrl) return { type: 'image', src: arasaacUrl };
        const emoji = modelResult.emoji;
        if (emoji && typeof emoji === 'string' && emoji.trim().length) {
            return { type: 'emoji', emoji: emoji.trim() };
        }
        return null;
    }

    global.parseWordExplanationResponse = parseWordExplanationResponse;
    global.resolveWordVisual = resolveWordVisual;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { parseWordExplanationResponse, resolveWordVisual };
    }
})(typeof window !== 'undefined' ? window : globalThis);
