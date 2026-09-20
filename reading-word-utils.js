(function (global) {
    'use strict';

    function cleanMarkdownCell(value) {
        return String(value || '')
            .replace(/<[^>]*>/g, '')
            .replace(/[*_`~]/g, '')
            .trim();
    }

    function extractImportantWords(overviewText) {
        if (typeof overviewText !== 'string') return [];

        const words = [];
        const seen = new Set();
        overviewText.split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (!trimmed.includes('|') || /^\|?[\s:|-]+\|?$/.test(trimmed)) return;

            const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
            if (cells.length < 2) return;
            const word = cleanMarkdownCell(cells[0]);
            const key = word.toLocaleLowerCase('de-DE');
            if (!word || key === 'wort' || key.startsWith('keine schwierigen')) return;
            if (word.length > 40 || seen.has(key)) return;

            seen.add(key);
            words.push(word);
        });

        return words.slice(0, 4);
    }

    function isWordCharacter(character) {
        return !!character && /[0-9A-Za-zÄÖÜäöüß]/.test(character);
    }

    function findWholeWordRanges(text, words) {
        if (typeof text !== 'string' || !Array.isArray(words) || words.length === 0) return [];

        const lowerText = text.toLocaleLowerCase('de-DE');
        const ranges = [];
        words.slice().sort((a, b) => String(b).length - String(a).length).forEach(rawWord => {
            const word = String(rawWord || '').trim();
            if (!word) return;
            const lowerWord = word.toLocaleLowerCase('de-DE');
            let fromIndex = 0;
            let index = lowerText.indexOf(lowerWord, fromIndex);

            while (index !== -1) {
                const end = index + lowerWord.length;
                const hasBoundary = !isWordCharacter(text[index - 1]) && !isWordCharacter(text[end]);
                const overlaps = ranges.some(range => index < range.end && end > range.start);
                if (hasBoundary && !overlaps) ranges.push({ start: index, end });
                fromIndex = Math.max(end, index + 1);
                index = lowerText.indexOf(lowerWord, fromIndex);
            }
        });

        return ranges.sort((a, b) => a.start - b.start);
    }

    const api = { extractImportantWords, findWholeWordRanges };
    global.ReadingWordUtils = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
}(typeof window !== 'undefined' ? window : globalThis));
