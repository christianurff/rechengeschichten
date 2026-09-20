const { test } = require('node:test');
const assert = require('node:assert/strict');

const ReaderTextView = require('../reader-text-view.js');

test('loading word images preserves syllable markup', async () => {
    let removedWordWrapping = false;
    const reader = Object.create(ReaderTextView.prototype);

    Object.assign(reader, {
        isLoadingWordImages: false,
        _wordImagesNeedRefresh: true,
        isHyphenated: true,
        showWordImages: true,
        wordImageCache: {},
        wordDisabledCache: {},
        textElement: {},
        _dispatchEvent() {},
        _removeWordWrapping() {
            removedWordWrapping = true;
        },
        _ensureWordWrapping() {},
        getText() {
            return 'Sti\u00ADcker';
        },
        _extractUniqueWords() {
            return [];
        },
        _applyWordImages() {}
    });

    await reader.loadWordImages();

    assert.equal(removedWordWrapping, false);
    assert.equal(reader._wordImagesNeedRefresh, false);
});

test('hyphenated punctuation is kept outside the word wrapper', () => {
    const reader = Object.create(ReaderTextView.prototype);
    reader.options = { hyphenationColors: ['red', 'blue'] };
    reader.textElement = { innerHTML: '' };
    reader._refreshGraphicTablesForMode = () => {};
    reader._escapeHtml = (value) => value;

    reader._applyHyphenatedText('Sti\u00ADcker.');

    assert.match(reader.textElement.innerHTML, /data-word="Sticker"/);
    assert.match(reader.textElement.innerHTML, /<\/span>\.$/);
    assert.doesNotMatch(reader.textElement.innerHTML, /data-word="Sticker\."/);
});

test('all image-eligible words keep matching cache keys after hyphenation', () => {
    const reader = Object.create(ReaderTextView.prototype);
    reader.options = { hyphenationColors: ['red', 'blue'] };
    reader.textElement = { innerHTML: '' };
    reader.minWordLengthForImages = 4;
    reader._refreshGraphicTablesForMode = () => {};
    reader._escapeHtml = (value) => value;

    const text = 'Anna sammelt Sticker. Sie hat schon 12 Sticker. Ihre Freundin schenkt ihr 9 Sticker. Wie viele Sticker hat Anna nun insgesamt?';
    const hyphenated = 'An\u00ADna sam\u00ADmelt Sti\u00ADcker. Sie hat schon 12 Sti\u00ADcker. Ih\u00ADre Freun\u00ADdin schenkt ihr 9 Sti\u00ADcker. Wie vie\u00ADle Sti\u00ADcker hat An\u00ADna nun ins\u00ADge\u00ADsamt?';

    reader._applyHyphenatedText(hyphenated);

    const renderedKeys = [...reader.textElement.innerHTML.matchAll(/data-word="([^"]+)"/g)]
        .map((match) => match[1].toLowerCase())
        .filter((word) => word.length >= reader.minWordLengthForImages);
    const expectedKeys = text.match(/[A-Za-zÄÖÜäöüßẞ]{4,}/g).map((word) => word.toLowerCase());

    assert.deepEqual(renderedKeys, expectedKeys);
});
