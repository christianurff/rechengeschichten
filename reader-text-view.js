/**
 * ReaderTextView - Web-Komponente
 *
 * Eine wiederverwendbare Web-Komponente zum unterstützten Lesen mit:
 * - Lesefinger (Touch/Mouse Tracking)
 * - Sprachausgabe (Web Speech API)
 * - Wort-Hervorhebung
 * - Silbentrennung
 * - Auto-Scroll
 *
 * Portiert von der iOS ReaderTextView Swift-Implementierung
 */

// Maßeinheiten (und einige gängige Kürzel), die NICHT in Silben getrennt werden.
// Das Sprechsilben-Muster würde sonst "kg" → "k·g", "cm" → "c·m" zerlegen.
// Vergleich erfolgt case-insensitiv gegen die (kleingeschriebenen) Einträge.
const HYPHENATION_PROTECTED_UNITS = new Set([
    // Länge
    'mm', 'cm', 'dm', 'm', 'km',
    // Gewicht / Masse
    'mg', 'g', 'kg', 't',
    // Volumen
    'ml', 'cl', 'dl', 'l', 'hl',
    // Fläche
    'qm', 'ha', 'ar',
    // Zeit
    'ms', 's', 'min', 'h',
    // Geld
    'ct',
    // Physik / höhere Klassen
    'hz', 'khz', 'kw', 'kwh', 'wh', 'kj', 'ma', 'kb', 'mb', 'gb'
]);

class PatternHyphenator {
    constructor(patternUrl, options = {}) {
        this.patternUrl = patternUrl;
        this.leftMin = typeof options.leftMin === 'number' ? options.leftMin : 2;
        this.rightMin = typeof options.rightMin === 'number' ? options.rightMin : 2;
        this.wordRegex = /[A-Za-zÄÖÜäöüßẞ]+/g;
        this.trie = null;
        this.loadingPromise = null;
    }

    async hyphenate(text) {
        await this._loadPatterns();
        return this._hyphenateText(text);
    }

    async _loadPatterns() {
        if (this.trie) {
            return;
        }
        if (!this.loadingPromise) {
            if (!this.patternUrl) {
                throw new Error('PatternHyphenator: Kein Pattern-URL gesetzt.');
            }
            this.loadingPromise = fetch(this.patternUrl)
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(`PatternHyphenator: Pattern-Datei nicht gefunden (${response.status}).`);
                    }
                    return response.text();
                })
                .then((text) => {
                    this.trie = this._buildTrie(text);
                });
        }
        return this.loadingPromise;
    }

    _buildTrie(patternText) {
        const root = { children: Object.create(null), points: null };
        const lines = patternText.split(/\r?\n/);

        for (const line of lines) {
            const pattern = line.trim();
            if (!pattern || pattern.startsWith('%') || pattern.startsWith('\\')) {
                continue;
            }

            const parsed = this._parsePattern(pattern);
            if (!parsed) {
                continue;
            }

            let node = root;
            for (const ch of parsed.letters) {
                if (!node.children[ch]) {
                    node.children[ch] = { children: Object.create(null), points: null };
                }
                node = node.children[ch];
            }

            if (!node.points) {
                node.points = parsed.points;
            } else {
                for (let i = 0; i < parsed.points.length; i++) {
                    if (parsed.points[i] > node.points[i]) {
                        node.points[i] = parsed.points[i];
                    }
                }
            }
        }

        return root;
    }

    _parsePattern(pattern) {
        const letters = [];
        const points = [0];

        for (const ch of pattern) {
            if (ch >= '0' && ch <= '9') {
                points[points.length - 1] = Number(ch);
            } else {
                letters.push(ch);
                points.push(0);
            }
        }

        if (letters.length === 0) {
            return null;
        }

        return { letters: letters.join(''), points };
    }

    _hyphenateText(text) {
        return text.replace(this.wordRegex, (word) => this._hyphenateWord(word));
    }

    _hyphenateWord(word) {
        if (word.length < this.leftMin + this.rightMin + 1) {
            return word;
        }

        const lowerWord = word.toLowerCase();
        const workWord = `.${lowerWord}.`;
        const points = new Array(workWord.length + 1).fill(0);

        for (let i = 0; i < workWord.length; i++) {
            let node = this.trie;
            let j = i;

            while (j < workWord.length) {
                node = node.children[workWord[j]];
                if (!node) {
                    break;
                }

                if (node.points) {
                    for (let k = 0; k < node.points.length; k++) {
                        const pos = i + k;
                        if (node.points[k] > points[pos]) {
                            points[pos] = node.points[k];
                        }
                    }
                }

                j++;
            }
        }

        let result = '';
        const lastHyphenIndex = word.length - this.rightMin - 1;

        for (let i = 0; i < word.length; i++) {
            result += word[i];
            const pointIndex = i + 2;

            if (i >= this.leftMin - 1 && i <= lastHyphenIndex && points[pointIndex] % 2 === 1) {
                result += '\u00AD';
            }
        }

        return result;
    }
}

/**
 * parseAsciiTableToRows(content) -> string[][] | null
 *
 * Parst eine ASCII-Pipe-Tabelle (z.B. aus OCR-Erkennung, `[TABELLE]...[/TABELLE]`)
 * in ein Zeilen/Zellen-Array. Reine, DOM-unabhängige Hilfsfunktion (testbar in Node).
 *
 * Toleriert:
 * - Zeilen der Form `| a | b |` (auch ohne äußere Pipes: `a | b`)
 * - Trennzeilen aus `-`, `+`, `:`, `|` und Leerzeichen (z.B. `|---|---|`, `|:--|--:|`) werden übersprungen
 * - ungleiche Spaltenzahlen werden mit '' aufgefüllt
 *
 * Gibt `null` zurück, wenn keine Pipe-Struktur erkennbar ist oder weniger als
 * zwei Datenzeilen übrig bleiben.
 */
function parseAsciiTableToRows(content) {
    if (typeof content !== 'string') return null;

    const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const isSeparatorLine = (line) => {
        const stripped = line.replace(/^\|/, '').replace(/\|$/, '');
        return stripped.length > 0 && /^[\s\-:+|]+$/.test(stripped) && /-/.test(stripped);
    };

    const dataLines = lines.filter((line) => line.includes('|') && !isSeparatorLine(line));

    if (dataLines.length < 2) return null;

    const rows = dataLines.map((line) => {
        const cells = line.split('|').map((cell) => cell.trim());
        if (cells.length > 0 && cells[0] === '') cells.shift();
        if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
        return cells;
    });

    const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
    if (maxCols < 1) return null;

    return rows.map((row) => {
        const padded = row.slice();
        while (padded.length < maxCols) padded.push('');
        return padded;
    });
}

class ReaderTextView {
    constructor(container, options = {}) {
        // Container-Element
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (!this.container) {
            throw new Error('ReaderTextView: Container nicht gefunden');
        }

        // Optionen mit Defaults
        this.options = {
            fontSize: options.fontSize || 24,
            fontFamily: options.fontFamily || '"ABeeZee", "Segoe UI", Tahoma, sans-serif',
            textColor: options.textColor || '#1a1a1a',
            backgroundColor: options.backgroundColor || '#fafafa',
            highlightColor: options.highlightColor || '#fde047',
            overlayBorderColor: options.overlayBorderColor || '#facc15',
            speakDelay: options.speakDelay || 300,
            readingSpeed: options.readingSpeed || 0.6,
            autoScroll: options.autoScroll !== false,
            editable: options.editable !== false,
            explanations: options.explanations !== false,
            lineSpacing: options.lineSpacing || 1.5,
            paragraphSpacing: options.paragraphSpacing || 1.8,
            textInsets: options.textInsets || 30,
            language: options.language || 'de-DE',
            hyphenationColors: options.hyphenationColors || ['#dc2626', '#2563eb'],
            hyphenationPatternUrl: options.hyphenationPatternUrl || null,
            hyphenationLeftMin: typeof options.hyphenationLeftMin === 'number' ? options.hyphenationLeftMin : 2,
            hyphenationRightMin: typeof options.hyphenationRightMin === 'number' ? options.hyphenationRightMin : 2,
            // Fallback für sehr kurze Wörter (z.B. "Oma", "Auto"), wenn die Pattern-Hyphenation nicht trennt
            hyphenationFallbackMaxWordLength: typeof options.hyphenationFallbackMaxWordLength === 'number' ? options.hyphenationFallbackMaxWordLength : 4,
            hyphenationFallbackSkipAllCaps: options.hyphenationFallbackSkipAllCaps !== false,
            hyphenopolyTimeoutMs: typeof options.hyphenopolyTimeoutMs === 'number' ? options.hyphenopolyTimeoutMs : 5000,
            // Manuelle Korrekturen für einzelne Wörter, z.B. { "Beispiel": "Bei-spiel" }
            hyphenationExceptions: options.hyphenationExceptions || {},
            onWordExplanation: options.onWordExplanation || null,
            showFloatingButtons: options.showFloatingButtons === true, // Standard: ausgeblendet
            ...options
        };

        if (!this.options.hyphenationPatternUrl && this.options.language.startsWith('de')) {
            this.options.hyphenationPatternUrl = 'hyph-de-1996.pat.txt';
        }

        // Status-Variablen
        this.isReading = false;
        this.isPaused = false;
        this.isHyphenated = false;
        this.showWordImages = false;
        this.wordImageCache = {}; // {word: url}
        this.wordDisabledCache = {}; // {word: true}
        this.isLoadingWordImages = false;
        this.minWordLengthForImages = 4;
        this._wordImagesNeedRefresh = false;
        this.lastReadWord = null;
        this.currentWordIndex = 0;
        this.wordRanges = [];
        this.panDirection = 'none';
        this.startPoint = null;
        this.scrollVelocity = 0;
        this.topOffset = 0;

        // Modus: 'edit' (Markier-/Einfügemodus) oder 'read' (Lesemodus)
        this.mode = options.initialMode || 'edit';

        // Speech Synthesizer
        this.speechSynthesizer = window.speechSynthesis;
        this.currentUtterance = null;
        this.readUtterance = null;
        this.patternHyphenator = null;
        this.hyphenopolyHyphenator = null;
        this.hyphenopolyLanguage = null;

        // Animation Frame für Scroll-Momentum
        this.scrollAnimationId = null;

        // Long-Press Timer
        this.longPressTimer = null;
        this.longPressDelay = 500;

        // Reading Delay Timer (für Touch-and-Hold Lesefinger)
        this.readingDelayTimer = null;
        this.touchStartTime = null;

        // Intelligenter Lesefinger: Aktuelles Wort und Position tracken
        this.currentWordInfo = null;
        this.lastFingerX = null;

        // Initialisierung
        this._init();
    }

    _init() {
        this._createDOM();
        this._applyStyles();
        this._setupEventListeners();
        this._loadVoices();
        this._applyMode();

        // Placeholder aus Optionen setzen
        if (this.options.placeholder) {
            this.setPlaceholder(this.options.placeholder);
        }
    }

    _createDOM() {
        // Haupt-Container
        this.container.classList.add('reader-text-view-container');

        // Text-Element
        this.textElement = document.createElement('div');
        this.textElement.classList.add('reader-text-view');
        this.textElement.setAttribute('contenteditable', this.options.editable ? 'true' : 'false');
        this.textElement.setAttribute('role', 'textbox');
        this.textElement.setAttribute('aria-multiline', 'true');
        this.textElement.setAttribute('spellcheck', 'false');

        // Wort-Overlay
        this.overlay = document.createElement('div');
        this.overlay.classList.add('reader-word-overlay');
        this.overlay.style.display = 'none';

        // Floating Buttons für Vorlesen/Stoppen
        this.floatingButtons = document.createElement('div');
        this.floatingButtons.classList.add('reader-floating-buttons');

        // Vorlesen-Button
        this.btnFloatingRead = document.createElement('button');
        this.btnFloatingRead.classList.add('reader-floating-btn', 'read-btn');
        this.btnFloatingRead.setAttribute('aria-label', 'Vorlesen');
        this.btnFloatingRead.innerHTML = `
            <img src="symbole/vorlesen.png" alt="">
            <span>Vorlesen</span>
        `;

        // Stop-Button (anfangs versteckt)
        this.btnFloatingStop = document.createElement('button');
        this.btnFloatingStop.classList.add('reader-floating-btn', 'stop-btn');
        this.btnFloatingStop.setAttribute('aria-label', 'Stopp');
        this.btnFloatingStop.innerHTML = `
            <img src="symbole/stopp_lesen.png" alt="">
            <span>Stopp</span>
        `;

        this.floatingButtons.appendChild(this.btnFloatingRead);
        this.floatingButtons.appendChild(this.btnFloatingStop);

        // Floating Buttons ausblenden wenn nicht gewünscht
        if (!this.options.showFloatingButtons) {
            this.floatingButtons.style.display = 'none';
        }

        // Zusammenfügen
        this.container.appendChild(this.textElement);
        this.container.appendChild(this.overlay);
        this.container.appendChild(this.floatingButtons);

        // Event-Listener für floating Buttons
        this._setupFloatingButtonListeners();
    }

    _setupFloatingButtonListeners() {
        // Vorlesen-Button
        this.btnFloatingRead.addEventListener('click', () => {
            if (this.isReading && !this.isPaused) {
                this.pauseReading();
            } else if (this.isPaused) {
                this.resumeReading();
            } else {
                this.readText();
            }
        });

        // Stop-Button
        this.btnFloatingStop.addEventListener('click', () => {
            this.stopReading();
        });

        // Scroll-Tracking für sticky Verhalten
        this._initialButtonTop = null;
        this.textElement.addEventListener('scroll', () => {
            this._updateFloatingButtonPosition();
        });
    }

    _updateFloatingButtonPosition() {
        if (!this._initialButtonTop) {
            this._initialButtonTop = 10; // Initial top position
        }

        const scrollTop = this.textElement.scrollTop;
        const containerRect = this.container.getBoundingClientRect();

        if (scrollTop > 50) {
            // Buttons am Viewport fixieren
            this.floatingButtons.classList.add('scrolled');
            this.floatingButtons.style.top = `${containerRect.top + 10}px`;
            this.floatingButtons.style.right = `${window.innerWidth - containerRect.right + 10}px`;
            this.floatingButtons.style.left = 'auto';
        } else {
            // Normale absolute Position
            this.floatingButtons.classList.remove('scrolled');
            this.floatingButtons.style.top = '10px';
            this.floatingButtons.style.right = '10px';
            this.floatingButtons.style.left = 'auto';
        }
    }

    _updateFloatingButtonState() {
        if (this.isReading) {
            this.btnFloatingRead.classList.add('reading');
            this.btnFloatingStop.classList.add('visible');

            if (this.isPaused) {
                this.btnFloatingRead.querySelector('span').textContent = 'Fortsetzen';
            } else {
                this.btnFloatingRead.querySelector('span').textContent = 'Pause';
            }
        } else {
            this.btnFloatingRead.classList.remove('reading');
            this.btnFloatingStop.classList.remove('visible');
            this.btnFloatingRead.querySelector('span').textContent = 'Vorlesen';
        }
    }

    _applyStyles() {
        // Container-Styles
        Object.assign(this.container.style, {
            position: 'relative',
            overflow: 'hidden',
            width: '100%',
            height: ''
        });

        // Text-Element-Styles
        Object.assign(this.textElement.style, {
            width: '100%',
            height: '100%',
            overflow: 'auto',
            padding: `${this.options.textInsets}px`,
            boxSizing: 'border-box',
            fontSize: `${this.options.fontSize}px`,
            fontFamily: this.options.fontFamily,
            color: this.options.textColor,
            backgroundColor: this.options.backgroundColor,
            lineHeight: String(this.options.lineSpacing),
            outline: 'none',
            cursor: 'text',
            userSelect: this.options.editable ? 'text' : 'none',
            WebkitUserSelect: this.options.editable ? 'text' : 'none',
            touchAction: 'auto' // Will be adjusted based on mode
        });

        // Overlay-Styles
        Object.assign(this.overlay.style, {
            position: 'absolute',
            border: `2px solid ${this.options.overlayBorderColor}`,
            borderRadius: '5px',
            backgroundColor: 'rgba(250, 204, 21, 0.1)',
            pointerEvents: 'none',
            transition: 'all 0.15s ease-out',
            zIndex: '10'
        });
    }

    _setupEventListeners() {
        // Touch Events - direkt auf textElement für beste Kompatibilität
        this.textElement.addEventListener('touchstart', this._handleTouchStart.bind(this), { passive: false });
        this.textElement.addEventListener('touchmove', this._handleTouchMove.bind(this), { passive: false });
        this.textElement.addEventListener('touchend', this._handleTouchEnd.bind(this), { passive: false });
        this.textElement.addEventListener('touchcancel', this._handleTouchEnd.bind(this), { passive: false });

        // Mouse Events (für Desktop)
        this.textElement.addEventListener('mousedown', this._handleMouseDown.bind(this));
        this.textElement.addEventListener('mousemove', this._handleMouseMove.bind(this));
        this.textElement.addEventListener('mouseup', this._handleMouseUp.bind(this));
        this.textElement.addEventListener('mouseleave', this._handleMouseUp.bind(this));

        // Textauswahl im Lesemodus verhindern (statt user-select: none)
        this.textElement.addEventListener('selectstart', (e) => {
            if (this.mode === 'read') {
                e.preventDefault();
            }
        });

        // Long Press für Worterklärungen
        if (this.options.explanations) {
            this.textElement.addEventListener('contextmenu', (e) => {
                if (this.mode === 'read') {
                    e.preventDefault();
                }
            });
        }

        // Scroll-Events
        this.textElement.addEventListener('scroll', this._handleScroll.bind(this));

        // Input-Events
        this.textElement.addEventListener('input', this._handleInput.bind(this));
        this.textElement.addEventListener('paste', this._handlePaste.bind(this));

        // Focus-Events
        this.textElement.addEventListener('focus', this._handleFocus.bind(this));
        this.textElement.addEventListener('blur', this._handleBlur.bind(this));

        // Speech Events
        this.speechSynthesizer.addEventListener('voiceschanged', this._loadVoices.bind(this));
    }

    _loadVoices() {
        this.voices = this.speechSynthesizer.getVoices();
        const langCode = this.options.language.split('-')[0];

        // Native Voice Identifier speichern wenn verfügbar
        this._nativeVoiceIdentifier = localStorage.getItem('rechengeschichten_voice');

        // Zuerst prüfen ob eine Stimme im localStorage gespeichert ist
        const savedVoiceName = localStorage.getItem('rechengeschichten_voice');
        if (savedVoiceName) {
            const savedVoice = this.voices.find(v => v.name === savedVoiceName);
            if (savedVoice) {
                this.preferredVoice = savedVoice;
                return;
            }
        }

        // Fallback: Beste deutsche Stimme wählen (Enhanced/Premium bevorzugt)
        const germanVoices = this.voices.filter(v => v.lang.startsWith(langCode));
        if (germanVoices.length > 0) {
            // Enhanced/Premium Stimmen bevorzugen
            const enhancedVoice = germanVoices.find(v =>
                v.name.includes('Enhanced') || v.name.includes('Premium')
            );
            this.preferredVoice = enhancedVoice || germanVoices[0];
        } else {
            this.preferredVoice = this.voices[0];
        }
    }

    /**
     * Prüft ob native iOS TTS verfügbar ist
     */
    _useNativeTTS() {
        return window._useNativeTTS && window.webkit?.messageHandlers?.nativeApp;
    }

    /**
     * Spricht Text mit nativer iOS TTS
     */
    _nativeSpeak(text, options = {}) {
        if (!this._useNativeTTS()) return false;

        // Voice Identifier aktualisieren
        const voiceIdentifier = localStorage.getItem('rechengeschichten_voice') || this._nativeVoiceIdentifier;

        window.webkit.messageHandlers.nativeApp.postMessage({
            action: 'speak',
            text: text,
            voiceIdentifier: voiceIdentifier,
            rate: options.rate || this.options.readingSpeed,
            utteranceId: options.utteranceId || Date.now().toString()
        });
        return true;
    }

    /**
     * Stoppt native iOS TTS
     */
    _nativeStopSpeaking() {
        if (!this._useNativeTTS()) return false;

        window.webkit.messageHandlers.nativeApp.postMessage({ action: 'stopSpeaking' });
        return true;
    }

    // === Touch/Mouse Event Handler ===

    _handleTouchStart(e) {
        if (e.touches.length !== 1) return;

        // Im Bearbeitungsmodus normale Touch-Events zulassen
        if (this.mode === 'edit') return;

        const touch = e.touches[0];
        this.startPoint = { x: touch.clientX, y: touch.clientY };
        this.panDirection = 'none';
        this.lastTouchPoint = { x: touch.clientX, y: touch.clientY };
        this.isMouseDown = true;
        this.isTouchActive = true;
        this.touchStartTime = Date.now();

        // Long-Press Timer starten (nur im Lesemodus)
        if (this.options.explanations && this.mode === 'read') {
            this.longPressTimer = setTimeout(() => {
                this._handleLongPress(touch.clientX, touch.clientY);
            }, this.longPressDelay);
        }

        // Für den Lesefinger: Nach kurzem Delay das erste Wort anzeigen (falls kein Long-Press)
        // Dies ermöglicht Touch-and-Hold zum Lesen auf iOS
        if (this.mode === 'read') {
            this.readingDelayTimer = setTimeout(() => {
                if (this.isTouchActive && this.panDirection === 'none') {
                    // Direkt Lesegeste auslösen ohne auf Bewegung zu warten
                    this._handleReadingGesture(touch.clientX, touch.clientY, true);
                }
            }, 150); // Kurzer Delay um Long-Press zu unterscheiden
        }
    }

    _handleTouchMove(e) {
        if (!this.startPoint || e.touches.length !== 1) return;

        // Im Bearbeitungsmodus normale Touch-Events zulassen
        if (this.mode === 'edit') return;

        const touch = e.touches[0];
        const dx = touch.clientX - this.startPoint.x;
        const dy = touch.clientY - this.startPoint.y;

        // Long-Press und Reading-Delay abbrechen bei Bewegung
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
            if (this.longPressTimer) {
                clearTimeout(this.longPressTimer);
                this.longPressTimer = null;
            }
            if (this.readingDelayTimer) {
                clearTimeout(this.readingDelayTimer);
                this.readingDelayTimer = null;
            }
        }

        // Bei jeder Bewegung den Lesefinger aktualisieren
        // Die intelligente Navigation kümmert sich um die Wort-Auswahl
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            this._handleReadingGesture(touch.clientX, touch.clientY, true);
        }

        this.lastTouchPoint = { x: touch.clientX, y: touch.clientY };
    }

    _handleTouchEnd(e) {
        // Timer abbrechen
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
        if (this.readingDelayTimer) {
            clearTimeout(this.readingDelayTimer);
            this.readingDelayTimer = null;
        }

        // Im Bearbeitungsmodus normale Touch-Events zulassen
        if (this.mode === 'edit') return;

        // Auto-Scroll wenn Lesefinger aktiv war und Position weit genug unten
        if (this.options.autoScroll && this.currentWordInfo && this.topOffset > this.textElement.clientHeight / 4) {
            this._autoScrollToPosition();
        }

        this.startPoint = null;
        this.panDirection = 'none';
        this.isMouseDown = false;
        this.isTouchActive = false;

        // Lesefinger-Tracking zurücksetzen für nächsten Touch
        this.currentWordInfo = null;
        this.lastFingerX = null;
        // Erneutes Antippen desselben Wortes soll es wieder vorlesen
        this.lastReadWord = null;

        this.hideOverlay();
    }

    _handleMouseDown(e) {
        if (e.button !== 0) return;

        // Im Bearbeitungsmodus normale Maus-Events zulassen
        if (this.mode === 'edit') return;

        this.startPoint = { x: e.clientX, y: e.clientY };
        this.panDirection = 'none';
        this.isMouseDown = true;

        // Long-Press Timer starten (nur im Lesemodus)
        if (this.options.explanations && this.mode === 'read') {
            this.longPressTimer = setTimeout(() => {
                this._handleLongPress(e.clientX, e.clientY);
            }, this.longPressDelay);
        }
    }

    _handleMouseMove(e) {
        if (!this.isMouseDown || !this.startPoint) return;

        // Im Bearbeitungsmodus normale Maus-Events zulassen
        if (this.mode === 'edit') return;

        const dx = e.clientX - this.startPoint.x;
        const dy = e.clientY - this.startPoint.y;

        // Long-Press abbrechen bei Bewegung
        if (this.longPressTimer && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }

        // Richtung bestimmen
        if (this.panDirection === 'none' && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
            this.panDirection = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
        }

        if (this.panDirection === 'horizontal') {
            e.preventDefault();
            this._handleReadingGesture(e.clientX, e.clientY);
        }
    }

    _handleMouseUp(e) {
        // Long-Press Timer abbrechen
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }

        // Im Bearbeitungsmodus normale Maus-Events zulassen
        if (this.mode === 'edit') return;

        // Auto-Scroll bei horizontaler Geste
        if (this.options.autoScroll && this.panDirection === 'horizontal' && this.topOffset > this.textElement.clientHeight / 4) {
            this._autoScrollToPosition();
        }

        this.startPoint = null;
        this.panDirection = 'none';
        this.isMouseDown = false;

        // Lesefinger-Tracking zurücksetzen
        this.currentWordInfo = null;
        this.lastFingerX = null;
        // Erneutes Anklicken desselben Wortes soll es wieder vorlesen
        this.lastReadWord = null;

        this.hideOverlay();
    }

    // === Lese-Funktionen ===

    _handleReadingGesture(clientX, clientY, isTouch = false) {
        // Größerer Offset für Touch-Eingaben (Finger verdeckt mehr Fläche als Mauszeiger)
        const fingerOffset = isTouch ? 50 : 30;
        const adjustedClientY = clientY - fingerOffset;

        let wordInfo = null;

        // Wenn wir bereits ein Wort haben, intelligente Navigation verwenden
        if (this.currentWordInfo && this.lastFingerX !== null) {
            const deltaX = clientX - this.lastFingerX;

            // Bewegung nach rechts: Nächstes Wort bevorzugen
            if (deltaX > 15) {
                wordInfo = this._getNextWord(this.currentWordInfo);
            }
            // Bewegung nach links: Vorheriges Wort
            else if (deltaX < -15) {
                wordInfo = this._getPreviousWord(this.currentWordInfo);
            }

            // Falls kein nächstes/vorheriges Wort gefunden, fallback auf Position
            if (!wordInfo) {
                wordInfo = this._getWordAtPositionFromClient(clientX, adjustedClientY);
            }
        } else {
            // Erstes Wort: Position-basiert finden
            wordInfo = this._getWordAtPositionFromClient(clientX, adjustedClientY);
        }

        // Finger-Position aktualisieren
        this.lastFingerX = clientX;

        if (wordInfo && wordInfo.word !== this.lastReadWord) {
            this.lastReadWord = wordInfo.word;
            this.currentWordInfo = wordInfo;

            // Overlay positionieren
            this._showOverlayForWord(wordInfo);

            // Wort vorlesen
            this._speakWord(wordInfo.word);

            // topOffset für Auto-Scroll speichern
            this.topOffset = wordInfo.rect.top - this.options.textInsets;
        }
    }

    _getNextWord(currentWordInfo) {
        if (!currentWordInfo || !currentWordInfo.textNode) return null;

        // Silbentrennung aktiv: über die Wort-Wrapper navigieren. Die rohen
        // Textknoten sind dann einzelne Silben-Spans - der Textknoten-Pfad
        // unten würde Silben (oder Soft-Hyphens) statt ganzer Wörter liefern.
        if (currentWordInfo.wordWrapper) {
            return this._getAdjacentWrappedWord(currentWordInfo.wordWrapper, 1);
        }

        const textNode = currentWordInfo.textNode;
        const text = textNode.textContent;
        let searchStart = currentWordInfo.end;

        // Im selben Textknoten nach dem nächsten Wort suchen
        while (searchStart < text.length && /\s/.test(text[searchStart])) {
            searchStart++;
        }

        if (searchStart < text.length) {
            // Nächstes Wort im selben Textknoten gefunden
            let wordEnd = searchStart;
            while (wordEnd < text.length && !/\s/.test(text[wordEnd])) {
                wordEnd++;
            }

            const word = text.substring(searchStart, wordEnd).replace(/[.,!?;:„"»«›‹'"()]/g, '').trim();
            if (word) {
                const wordRange = document.createRange();
                wordRange.setStart(textNode, searchStart);
                wordRange.setEnd(textNode, wordEnd);
                const rect = wordRange.getBoundingClientRect();

                return {
                    word,
                    range: wordRange,
                    rect: {
                        top: rect.top - this.textElement.getBoundingClientRect().top,
                        left: rect.left - this.textElement.getBoundingClientRect().left,
                        width: rect.width,
                        height: rect.height
                    },
                    textNode,
                    start: searchStart,
                    end: wordEnd
                };
            }
        }

        // Im nächsten Textknoten suchen
        const walker = document.createTreeWalker(this.textElement, NodeFilter.SHOW_TEXT, null, false);
        let foundCurrent = false;

        let node;
        while ((node = walker.nextNode())) {
            if (node === textNode) {
                foundCurrent = true;
                continue;
            }
            if (foundCurrent && node.textContent.trim()) {
                // Erstes Wort im nächsten Textknoten
                const nextText = node.textContent;
                let start = 0;
                while (start < nextText.length && /\s/.test(nextText[start])) start++;

                if (start < nextText.length) {
                    let end = start;
                    while (end < nextText.length && !/\s/.test(nextText[end])) end++;

                    const word = nextText.substring(start, end).replace(/[.,!?;:„"»«›‹'"()]/g, '').trim();
                    if (word) {
                        const wordRange = document.createRange();
                        wordRange.setStart(node, start);
                        wordRange.setEnd(node, end);
                        const rect = wordRange.getBoundingClientRect();

                        return {
                            word,
                            range: wordRange,
                            rect: {
                                top: rect.top - this.textElement.getBoundingClientRect().top,
                                left: rect.left - this.textElement.getBoundingClientRect().left,
                                width: rect.width,
                                height: rect.height
                            },
                            textNode: node,
                            start,
                            end
                        };
                    }
                }
            }
        }

        return null;
    }

    _getPreviousWord(currentWordInfo) {
        if (!currentWordInfo || !currentWordInfo.textNode) return null;

        // Silbentrennung aktiv: über die Wort-Wrapper navigieren (siehe _getNextWord)
        if (currentWordInfo.wordWrapper) {
            return this._getAdjacentWrappedWord(currentWordInfo.wordWrapper, -1);
        }

        const textNode = currentWordInfo.textNode;
        const text = textNode.textContent;
        let searchEnd = currentWordInfo.start;

        // Im selben Textknoten nach dem vorherigen Wort suchen
        while (searchEnd > 0 && /\s/.test(text[searchEnd - 1])) {
            searchEnd--;
        }

        if (searchEnd > 0) {
            // Vorheriges Wort im selben Textknoten gefunden
            let wordStart = searchEnd;
            while (wordStart > 0 && !/\s/.test(text[wordStart - 1])) {
                wordStart--;
            }

            const word = text.substring(wordStart, searchEnd).replace(/[.,!?;:„"»«›‹'"()]/g, '').trim();
            if (word) {
                const wordRange = document.createRange();
                wordRange.setStart(textNode, wordStart);
                wordRange.setEnd(textNode, searchEnd);
                const rect = wordRange.getBoundingClientRect();

                return {
                    word,
                    range: wordRange,
                    rect: {
                        top: rect.top - this.textElement.getBoundingClientRect().top,
                        left: rect.left - this.textElement.getBoundingClientRect().left,
                        width: rect.width,
                        height: rect.height
                    },
                    textNode,
                    start: wordStart,
                    end: searchEnd
                };
            }
        }

        // Im vorherigen Textknoten suchen
        const allTextNodes = [];
        const walker = document.createTreeWalker(this.textElement, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
            allTextNodes.push(node);
        }

        const currentIndex = allTextNodes.indexOf(textNode);
        for (let i = currentIndex - 1; i >= 0; i--) {
            const prevNode = allTextNodes[i];
            if (prevNode.textContent.trim()) {
                const prevText = prevNode.textContent;
                let end = prevText.length;
                while (end > 0 && /\s/.test(prevText[end - 1])) end--;

                if (end > 0) {
                    let start = end;
                    while (start > 0 && !/\s/.test(prevText[start - 1])) start--;

                    const word = prevText.substring(start, end).replace(/[.,!?;:„"»«›‹'"()]/g, '').trim();
                    if (word) {
                        const wordRange = document.createRange();
                        wordRange.setStart(prevNode, start);
                        wordRange.setEnd(prevNode, end);
                        const rect = wordRange.getBoundingClientRect();

                        return {
                            word,
                            range: wordRange,
                            rect: {
                                top: rect.top - this.textElement.getBoundingClientRect().top,
                                left: rect.left - this.textElement.getBoundingClientRect().left,
                                width: rect.width,
                                height: rect.height
                            },
                            textNode: prevNode,
                            start,
                            end
                        };
                    }
                }
            }
        }

        return null;
    }

    _getCaretRangeFromPoint(clientX, clientY) {
        let range = null;

        // Methode 1: Standard caretRangeFromPoint (Chrome, Safari)
        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(clientX, clientY);
        }

        // Methode 2: caretPositionFromPoint (Firefox)
        if (!range && document.caretPositionFromPoint) {
            const caretPosition = document.caretPositionFromPoint(clientX, clientY);
            if (caretPosition && caretPosition.offsetNode) {
                const offsetNode = caretPosition.offsetNode;
                const offset = caretPosition.offset;
                const fallbackRange = document.createRange();

                if (offsetNode.nodeType === Node.TEXT_NODE) {
                    fallbackRange.setStart(offsetNode, offset);
                } else {
                    const walker = document.createTreeWalker(offsetNode, NodeFilter.SHOW_TEXT);
                    const textNode = walker.nextNode();
                    if (!textNode) {
                        return null;
                    }
                    const safeOffset = Math.min(offset, textNode.textContent.length);
                    fallbackRange.setStart(textNode, safeOffset);
                }

                fallbackRange.collapse(true);
                range = fallbackRange;
            }
        }

        // Methode 3: Verbesserter Fallback für mobile Safari - elementFromPoint + binäre Suche
        if (!range) {
            const element = document.elementFromPoint(clientX, clientY);
            if (element && this.textElement.contains(element)) {
                // Alle Textknoten im Container durchsuchen
                const walker = document.createTreeWalker(
                    this.textElement,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                );

                let bestNode = null;
                let bestOffset = 0;
                let bestDistance = Infinity;

                let textNode;
                while ((textNode = walker.nextNode())) {
                    const text = textNode.textContent;
                    if (!text.trim()) continue;

                    // Binäre Suche nach dem nächsten Zeichen
                    for (let i = 0; i < text.length; i++) {
                        const testRange = document.createRange();
                        testRange.setStart(textNode, i);
                        testRange.setEnd(textNode, Math.min(i + 1, text.length));
                        const testRect = testRange.getBoundingClientRect();

                        // Abstand zum Klickpunkt berechnen
                        const centerX = testRect.left + testRect.width / 2;
                        const centerY = testRect.top + testRect.height / 2;
                        const distance = Math.sqrt(
                            Math.pow(centerX - clientX, 2) +
                            Math.pow(centerY - clientY, 2)
                        );

                        if (distance < bestDistance) {
                            bestDistance = distance;
                            bestNode = textNode;
                            bestOffset = i;
                        }

                        // Früher Abbruch wenn wir unter der Klickposition sind
                        if (testRect.top > clientY + 50) break;
                    }
                }

                if (bestNode) {
                    const fallbackRange = document.createRange();
                    fallbackRange.setStart(bestNode, bestOffset);
                    fallbackRange.collapse(true);
                    range = fallbackRange;
                }
            }
        }

        return range;
    }

    /**
     * Liefert das benachbarte Wort über die Silben-Wort-Wrapper (.word-Spans).
     * @param {Element} wrapper - aktueller Wort-Wrapper
     * @param {number} direction - 1 = nächstes Wort, -1 = vorheriges Wort
     */
    _getAdjacentWrappedWord(wrapper, direction) {
        const words = Array.from(this.textElement.querySelectorAll('.word'));
        const idx = words.indexOf(wrapper);
        if (idx === -1) return null;
        const target = words[idx + direction];
        if (!target) return null;
        const fullWord = target.getAttribute('data-word');
        if (!fullWord) return null;

        const range = document.createRange();
        range.selectNodeContents(target);
        const rect = target.getBoundingClientRect();
        const containerRect = this.textElement.getBoundingClientRect();
        return {
            word: fullWord.replace(/[.,!?;:„"»«›‹'"()]/g, '').trim(),
            range,
            rect: {
                top: rect.top - containerRect.top,
                left: rect.left - containerRect.left,
                width: rect.width,
                height: rect.height
            },
            textNode: target.firstChild,
            wordWrapper: target,
            start: 0,
            end: fullWord.length
        };
    }

    _getWordAtPositionFromClient(clientX, clientY) {
        // Direkt caretRangeFromPoint mit Client-Koordinaten aufrufen
        const range = this._getCaretRangeFromPoint(clientX, clientY);

        if (!range) return null;

        // Wort erweitern
        const textNode = range.startContainer;
        if (textNode.nodeType !== Node.TEXT_NODE) return null;

        // Prüfe ob TextNode innerhalb eines Word-Wrappers liegt (Silbentrennung aktiv)
        const wordWrapper = this._findWordWrapper(textNode);

        if (wordWrapper) {
            // Silbentrennung aktiv - hole ganzes Wort aus data-word
            const fullWord = wordWrapper.getAttribute('data-word');
            if (fullWord) {
                const rect = wordWrapper.getBoundingClientRect();
                const containerRect = this.textElement.getBoundingClientRect();
                return {
                    word: fullWord.replace(/[.,!?;:„"»«›‹'"()]/g, '').trim(),
                    range: range,
                    rect: {
                        top: rect.top - containerRect.top,
                        left: rect.left - containerRect.left,
                        width: rect.width,
                        height: rect.height
                    },
                    textNode: textNode,
                    wordWrapper: wordWrapper,
                    start: 0,
                    end: fullWord.length
                };
            }
        }

        // Fallback: Alte Logik für Text ohne Silbentrennung
        const text = textNode.textContent;
        let start = range.startOffset;
        let end = range.startOffset;

        // Wortgrenzen finden
        while (start > 0 && !/\s/.test(text[start - 1])) start--;
        while (end < text.length && !/\s/.test(text[end])) end++;

        const word = text.substring(start, end).replace(/[.,!?;:]/g, '').trim();
        if (!word) return null;

        // Rect für das Wort berechnen
        const wordRange = document.createRange();
        wordRange.setStart(textNode, start);
        wordRange.setEnd(textNode, end);
        const rect = wordRange.getBoundingClientRect();

        return {
            word,
            range: wordRange,
            rect: {
                top: rect.top - this.textElement.getBoundingClientRect().top,
                left: rect.left - this.textElement.getBoundingClientRect().left,
                width: rect.width,
                height: rect.height
            },
            textNode,
            start,
            end
        };
    }

    _findWordWrapper(node) {
        let current = node;
        while (current && current !== this.textElement) {
            if (current.nodeType === Node.ELEMENT_NODE &&
                current.classList &&
                current.classList.contains('word')) {
                return current;
            }
            current = current.parentNode;
        }
        return null;
    }

    _getWordAtPosition(x, y) {
        // Für Rückwärtskompatibilität: lokale Koordinaten zu Client-Koordinaten umrechnen
        const rect = this.textElement.getBoundingClientRect();
        const clientX = x + rect.left;
        const clientY = y + rect.top - this.textElement.scrollTop;
        return this._getWordAtPositionFromClient(clientX, clientY);
    }

    _showOverlayForWord(wordInfo) {
        const padding = 7;

        // Container-Rect für korrekte Positionierung (nicht textElement, da der Border dazwischen liegt)
        const containerRect = this.container.getBoundingClientRect();
        const textElementRect = this.textElement.getBoundingClientRect();

        // Offset zwischen Container und textElement berechnen (z.B. durch Border im reader-mode)
        const offsetTop = textElementRect.top - containerRect.top;
        const offsetLeft = textElementRect.left - containerRect.left;

        Object.assign(this.overlay.style, {
            display: 'block',
            top: `${wordInfo.rect.top + offsetTop - padding}px`,
            left: `${wordInfo.rect.left + offsetLeft - padding}px`,
            width: `${wordInfo.rect.width + 2 * padding}px`,
            height: `${wordInfo.rect.height + 2 * padding}px`
        });
    }

    hideOverlay() {
        this.overlay.style.display = 'none';
    }

    _speakWord(word) {
        // Aktuelle Sprachausgabe stoppen
        if (this.isReading) {
            this.stopReading();
        }
        this._nativeStopSpeaking();
        this.speechSynthesizer.cancel();

        // Neues Utterance erstellen und sprechen. Ein noch ausstehender Timer wird
        // ersetzt, damit beim schnellen Ziehen nicht mehrere Wörter nacheinander sprechen.
        clearTimeout(this._speakWordTimer);
        this._speakWordTimer = setTimeout(() => {
            // Native iOS TTS bevorzugen wenn verfügbar
            if (this._nativeSpeak(word)) {
                return;
            }

            // Fallback: Web Speech API
            const utterance = new SpeechSynthesisUtterance(word);
            utterance.voice = this.preferredVoice;
            utterance.lang = this.options.language;
            utterance.rate = this.options.readingSpeed;
            this.speechSynthesizer.speak(utterance);
        }, this.options.speakDelay);
    }

    // === Text vorlesen ===

    readText() {
        this.hideOverlay();

        // Wenn bereits am Lesen, stoppen
        if (this.isReading) {
            this.stopReading();
            return;
        }

        // Worterklärungen stoppen
        this._nativeStopSpeaking();
        this.speechSynthesizer.cancel();

        this.isReading = true;
        this.isPaused = false;
        this._prepareTextForReading();

        // Floating Buttons aktualisieren
        this._updateFloatingButtonState();

        // Event auslösen
        this._dispatchEvent('readingstart');

        // Zum Anfang scrollen
        this.textElement.scrollTo({ top: 0, behavior: 'smooth' });

        // Text vorlesen (ohne Soft Hyphens für korrekte Synchronisation)
        const text = this._textForSpeech || this.getText().replace(/\u00AD/g, '');

        // Native iOS TTS verwenden wenn verfügbar
        if (this._useNativeTTS()) {
            this._readTextNative(text);
            return;
        }

        // Fallback: Web Speech API
        this.readUtterance = new SpeechSynthesisUtterance(text);
        this.readUtterance.voice = this.preferredVoice;
        this.readUtterance.lang = this.options.language;
        this.readUtterance.rate = this.options.readingSpeed;

        // Wort-Hervorhebung
        this.readUtterance.onboundary = (e) => {
            if (e.name === 'word') {
                this._highlightWordAtCharIndex(e.charIndex);
            }
        };

        this.readUtterance.onend = () => {
            this.isReading = false;
            this.isPaused = false;
            this.hideOverlay();
            this._updateFloatingButtonState();
            this._dispatchEvent('readingend');
        };

        this.speechSynthesizer.speak(this.readUtterance);
    }

    /**
     * Liest Text mit nativer iOS TTS vor (mit Wort-Highlighting)
     */
    _readTextNative(text) {
        // Eindeutige ID für dieses Vorlesen
        this._currentReadingId = 'read_' + Date.now();

        // Voice Identifier aktualisieren (falls noch nicht gesetzt oder geändert)
        this._nativeVoiceIdentifier = localStorage.getItem('rechengeschichten_voice');

        // Event-Listener für native Speech Events
        this._nativeSpeechHandler = (e) => {
            const { event, data } = e.detail;

            // Nur Events für unser aktuelles Vorlesen verarbeiten
            if (data.utteranceId !== this._currentReadingId) return;

            switch (event) {
                case 'speechBoundary':
                    this._highlightWordAtCharIndex(data.charIndex);
                    break;
                case 'speechEnd':
                    this.isReading = false;
                    this.isPaused = false;
                    this.hideOverlay();
                    this._updateFloatingButtonState();
                    this._dispatchEvent('readingend');
                    this._removeNativeSpeechHandler();
                    break;
                case 'speechCancel':
                    this._removeNativeSpeechHandler();
                    break;
            }
        };

        window.addEventListener('nativeSpeech', this._nativeSpeechHandler);

        // Native TTS starten
        window.webkit.messageHandlers.nativeApp.postMessage({
            action: 'speak',
            text: text,
            voiceIdentifier: this._nativeVoiceIdentifier,
            rate: this.options.readingSpeed,
            utteranceId: this._currentReadingId
        });
    }

    /**
     * Entfernt den Native Speech Event Handler
     */
    _removeNativeSpeechHandler() {
        if (this._nativeSpeechHandler) {
            window.removeEventListener('nativeSpeech', this._nativeSpeechHandler);
            this._nativeSpeechHandler = null;
        }
    }

    pauseReading() {
        if (this.isReading && !this.isPaused) {
            // Native TTS pausieren
            if (this._useNativeTTS()) {
                window.webkit.messageHandlers.nativeApp.postMessage({ action: 'pauseSpeaking' });
            }
            this.speechSynthesizer.pause();
            this.isPaused = true;
            this._updateFloatingButtonState();
            this._dispatchEvent('readingpause');
        }
    }

    resumeReading() {
        if (this.isReading && this.isPaused) {
            // Native TTS fortsetzen
            if (this._useNativeTTS()) {
                window.webkit.messageHandlers.nativeApp.postMessage({ action: 'continueSpeaking' });
            }
            this.speechSynthesizer.resume();
            this.isPaused = false;
            this._updateFloatingButtonState();
            this._dispatchEvent('readingresume');
        }
    }

    stopReading() {
        this._nativeStopSpeaking();
        this._removeNativeSpeechHandler();
        clearTimeout(this._speakWordTimer);
        // Chrome kann nach pause()+cancel() dauerhaft "paused" bleiben und das
        // nächste speak() bliebe stumm - resume() vor cancel() löst den Zustand.
        this.speechSynthesizer.resume();
        this.speechSynthesizer.cancel();
        this.isReading = false;
        this.isPaused = false;
        this.currentWordIndex = 0;
        this.wordRanges = [];
        this.hideOverlay();
        this._updateFloatingButtonState();
        this._dispatchEvent('readingstop');
    }

    _prepareTextForReading() {
        // Text aus DOM holen
        const rawText = this.getText();

        // Text für Speech: Soft Hyphens entfernen, Zeilenumbrüche durch Leerzeichen ersetzen
        const textForSpeech = rawText
            .replace(/\u00AD/g, '')
            .replace(/\n/g, ' ');

        this.wordRanges = [];
        this._textForSpeech = textForSpeech;

        // Mapping von Speech-Position zu DOM-Position erstellen
        // um Soft Hyphens und Zeilenumbrüche zu berücksichtigen
        let speechLocation = 0;
        let domLocation = 0;

        // Text in Tokens aufteilen (Wörter und Whitespace separat)
        const tokens = rawText.split(/(\s+)/);

        for (const token of tokens) {
            if (token.trim()) {
                // Es ist ein Wort
                // Wort ohne Soft Hyphens für Speech-Länge
                const wordForSpeech = token.replace(/\u00AD/g, '');

                // Wort-Index für dieses Wort berechnen (für Fallback-Suche)
                const wordLower = wordForSpeech.toLowerCase();
                const existingCount = this.wordRanges.filter(w => w.word.toLowerCase() === wordLower).length;

                this.wordRanges.push({
                    start: speechLocation,  // Position im Speech-Text
                    length: wordForSpeech.length,
                    word: wordForSpeech,
                    domStart: domLocation,  // Position im DOM-Text
                    domLength: token.length,
                    wordIndex: existingCount  // Das wievielte Vorkommen dieses Wortes (0-basiert)
                });

                speechLocation += wordForSpeech.length;
                domLocation += token.length;
            } else if (token) {
                // Es ist Whitespace (Leerzeichen, Zeilenumbrüche, etc.)
                // Im Speech-Text werden alle Whitespace-Zeichen zu einem Leerzeichen
                // Zähle wie viele "echte" Leerzeichen das im Speech-Text ergibt
                const speechWhitespace = token.replace(/\n/g, ' ');
                speechLocation += speechWhitespace.length;
                domLocation += token.length;
            }
        }
    }

    _highlightWordAtCharIndex(charIndex) {
        // Wort-Range finden
        for (const wordRange of this.wordRanges) {
            if (charIndex >= wordRange.start && charIndex < wordRange.start + wordRange.length) {
                // Wort im DOM finden und hervorheben
                const wordInfo = this._findWordInDOM(wordRange);
                if (wordInfo) {
                    this._showOverlayForWord(wordInfo);
                    this._scrollToWord(wordInfo);
                }
                break;
            }
        }
    }

    _findWordInDOM(wordRange) {
        // DOM-Position verwenden wenn verfügbar (für Soft-Hyphen-Unterstützung)
        const wordStart = wordRange.domStart !== undefined ? wordRange.domStart : wordRange.start;
        const wordLength = wordRange.domLength !== undefined ? wordRange.domLength : wordRange.length;
        let wordEnd = wordStart + wordLength;

        let currentPos = 0;
        let startNode = null;
        let startOffset = 0;
        let endNode = null;
        let endOffset = 0;

        // Rekursiv durch alle Knoten gehen (inkl. BR-Elemente)
        const walkNode = (node) => {
            if (startNode && endNode) return; // Schon gefunden

            if (node.nodeType === Node.TEXT_NODE) {
                const nodeLength = node.textContent.length;
                const nodeEnd = currentPos + nodeLength;

                // Startknoten finden
                if (!startNode && nodeEnd > wordStart) {
                    startNode = node;
                    startOffset = wordStart - currentPos;
                }

                // Endknoten finden
                if (startNode && !endNode && nodeEnd >= wordEnd) {
                    endNode = node;
                    endOffset = Math.min(wordEnd - currentPos, nodeLength);
                }

                currentPos += nodeLength;
            } else if (node.nodeName === 'BR') {
                // BR-Element zählt als ein Zeichen (\n) im innerText
                currentPos += 1;
            } else if (node.childNodes) {
                // Rekursiv durch Kinder gehen
                for (const child of node.childNodes) {
                    walkNode(child);
                    if (startNode && endNode) break;
                }
            }
        };

        walkNode(this.textElement);

        const wordIndex = wordRange.wordIndex !== undefined ? wordRange.wordIndex : 0;

        // Fallback: Wort direkt im DOM suchen falls Position nicht gefunden
        if (!startNode) {
            const fallbackResult = this._findWordByText(wordRange.word, wordIndex);
            if (fallbackResult) {
                return fallbackResult;
            }
            return null;
        }

        // Falls das Wort nur in einem Knoten ist
        if (!endNode) {
            endNode = startNode;
            endOffset = Math.min(startOffset + wordLength, startNode.textContent.length);
        }

        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);

        // Validierung: Prüfen ob das gefundene Wort korrekt ist
        const foundText = range.toString().replace(/\u00AD/g, '');
        const expectedWord = wordRange.word.replace(/[.,!?;:„"»«›‹'"()]/g, '').trim();
        const foundWord = foundText.replace(/[.,!?;:„"»«›‹'"()]/g, '').trim();

        // Falls das gefundene Wort nicht übereinstimmt, Fallback verwenden
        if (foundWord.toLowerCase() !== expectedWord.toLowerCase()) {
            const fallbackResult = this._findWordByText(wordRange.word, wordIndex);
            if (fallbackResult) {
                return fallbackResult;
            }
        }

        // getClientRects() verwenden um alle Rechtecke zu bekommen (bei Zeilenumbruch)
        const rects = range.getClientRects();
        const containerRect = this.textElement.getBoundingClientRect();

        if (rects.length === 0) {
            // Fallback auf getBoundingClientRect
            const rect = range.getBoundingClientRect();
            return {
                word: wordRange.word,
                range,
                rect: {
                    // Visuelle Position relativ zum textElement (ohne scrollTop, da Overlay außerhalb des scrollenden Elements liegt)
                    top: rect.top - containerRect.top,
                    left: rect.left - containerRect.left,
                    width: rect.width,
                    height: rect.height
                }
            };
        }

        // Das erste Rechteck verwenden (wo das Wort beginnt)
        // Bei Zeilenumbruch ist das das Rechteck der aktuellen Zeile
        const firstRect = rects[0];

        // Für die Anzeige nur das aktuelle Rechteck verwenden (erste Zeile des Wortes)
        return {
            word: wordRange.word,
            range,
            rect: {
                // Visuelle Position relativ zum textElement (ohne scrollTop, da Overlay außerhalb des scrollenden Elements liegt)
                top: firstRect.top - containerRect.top,
                left: firstRect.left - containerRect.left,
                width: firstRect.width,
                height: firstRect.height
            }
        };
    }

    /**
     * Fallback-Methode: Sucht ein Wort im DOM durch Textvergleich
     * Wird verwendet wenn die positionsbasierte Suche fehlschlägt
     * @param {string} word - Das zu suchende Wort
     * @param {number} wordIndex - Das wievielte Vorkommen (0-basiert)
     */
    _findWordByText(word, wordIndex = 0) {
        if (!word) return null;

        const walker = document.createTreeWalker(
            this.textElement,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let foundCount = 0;
        let textNode;

        while ((textNode = walker.nextNode())) {
            const text = textNode.textContent;
            // Suche nach dem Wort (mit Wortgrenzen) - alle Vorkommen in diesem Knoten
            // Lookahead statt verbrauchter Gruppe: sonst wird bei direkt
            // aufeinanderfolgenden gleichen Wörtern das Trennzeichen konsumiert
            // und das n-te Vorkommen falsch gezählt.
            const regex = new RegExp(`(^|\\s)(${this._escapeRegex(word)})(?=\\s|$|[.,!?;:])`, 'gi');
            let match;

            while ((match = regex.exec(text)) !== null) {
                if (foundCount === wordIndex) {
                    const startOffset = match.index + match[1].length;
                    const endOffset = startOffset + match[2].length;

                    const range = document.createRange();
                    range.setStart(textNode, startOffset);
                    range.setEnd(textNode, endOffset);

                    const rect = range.getBoundingClientRect();
                    const containerRect = this.textElement.getBoundingClientRect();

                    return {
                        word: match[2],
                        range,
                        rect: {
                            top: rect.top - containerRect.top,
                            left: rect.left - containerRect.left,
                            width: rect.width,
                            height: rect.height
                        }
                    };
                }
                foundCount++;
            }
        }

        return null;
    }

    _escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    _scrollToWord(wordInfo) {
        const containerHeight = this.textElement.clientHeight;
        const wordTop = wordInfo.rect.top;  // Visuelle Position relativ zum textElement

        // Wenn Wort nicht im sichtbaren Bereich (wordTop ist jetzt visuell, 0 = oberer Rand)
        if (wordTop < 0 || wordTop > containerHeight - 100) {
            // Absolute Position im Dokument berechnen für das Scrollen
            const absoluteTop = wordTop + this.textElement.scrollTop;
            const newScrollTop = Math.max(0, absoluteTop - containerHeight / 4);
            this.textElement.scrollTo({ top: newScrollTop, behavior: 'smooth' });
        }
    }

    _autoScrollToPosition() {
        const newScrollTop = this.topOffset - this.textElement.clientHeight / 4;
        const maxScroll = this.textElement.scrollHeight - this.textElement.clientHeight;

        this.textElement.scrollTo({
            top: Math.min(Math.max(0, newScrollTop), maxScroll),
            behavior: 'smooth'
        });
    }

    // === Long Press / Worterklärungen ===

    _handleLongPress(clientX, clientY) {
        if (!this.options.explanations) return;

        const rect = this.textElement.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top + this.textElement.scrollTop;

        const wordInfo = this._getWordAtPosition(x, y);

        if (wordInfo && wordInfo.word) {
            // Stoppe laufendes Lesen
            this.stopReading();
            this.speechSynthesizer.cancel();

            // Wort hervorheben
            this._showOverlayForWord(wordInfo);
            this.overlay.style.borderColor = '#ef4444';
            this.overlay.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';

            // Event auslösen oder Callback aufrufen
            if (this.options.onWordExplanation) {
                this.options.onWordExplanation(wordInfo.word, (explanation) => {
                    this._showExplanationPopup(wordInfo, explanation);
                });
            } else {
                this._dispatchEvent('wordexplanation', { word: wordInfo.word, wordInfo });
            }
        }
    }

    _showExplanationPopup(wordInfo, explanation, visual = null, translation = null) {
        // Vorhandenes Popup entfernen
        const existingPopup = this.container.querySelector('.reader-explanation-popup');
        if (existingPopup) existingPopup.remove();

        // Visual-HTML aufbauen (Bild bevorzugt, sonst Emoji), falls vorhanden
        let visualHtml = '';
        if (visual && visual.type === 'image' && visual.src) {
            visualHtml = `
            <div class="reader-explanation-visual">
                <img class="reader-explanation-image" src="${this._escapeHtml(visual.src)}" alt="" loading="lazy">
                <div class="reader-explanation-attribution">© ARASAAC</div>
            </div>`;
        } else if (visual && visual.type === 'emoji' && visual.emoji) {
            visualHtml = `
            <div class="reader-explanation-visual">
                <span class="reader-explanation-emoji">${this._escapeHtml(visual.emoji)}</span>
            </div>`;
        }

        // Uebersetzungszeile in der ausgewaehlten Sprache aufbauen, falls vorhanden
        let translationHtml = '';
        if (translation && translation.text) {
            const speakBtn = translation.speakable
                ? '<button class="reader-explanation-translation-speak" aria-label="Vorlesen">🔊</button>'
                : '';
            translationHtml = `
            <div class="reader-explanation-translation">
                <span class="reader-explanation-translation-label">${this._escapeHtml(translation.label || '🌐')}</span>
                <span class="reader-explanation-translation-text">${this._escapeHtml(translation.text)}</span>
                ${speakBtn}
            </div>`;
        }

        // Popup erstellen
        const popup = document.createElement('div');
        popup.className = 'reader-explanation-popup';
        popup.innerHTML = `
            <div class="reader-explanation-body">
                ${visualHtml}
                <div class="reader-explanation-content">${explanation}${translationHtml}</div>
            </div>
            <button class="reader-explanation-close">&times;</button>
        `;

        // Positionieren
        Object.assign(popup.style, {
            position: 'absolute',
            top: `${wordInfo.rect.top + wordInfo.rect.height + 10}px`,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: '85%',
            padding: '15px 20px',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderRadius: '10px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
            fontSize: '18px',
            lineHeight: '1.5',
            zIndex: '100',
            color: '#1a1a1a'
        });

        this.container.appendChild(popup);

        // Bild-Ladefehler: Visual ausblenden
        const imgEl = popup.querySelector('.reader-explanation-image');
        if (imgEl) {
            imgEl.onerror = () => {
                const visualWrap = popup.querySelector('.reader-explanation-visual');
                if (visualWrap) visualWrap.remove();
            };
        }

        // Vorlese-Knopf der Übersetzung: Event an die App, die in der richtigen Sprache vorliest
        const translationSpeakBtn = popup.querySelector('.reader-explanation-translation-speak');
        if (translationSpeakBtn && translation && translation.text) {
            translationSpeakBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this._dispatchEvent('speaktranslation', { text: translation.text, lang: translation.lang || null });
            });
        }

        // Erklärung vorlesen (native TTS bevorzugen) – nur den Text, kein Emoji
        if (!this._nativeSpeak(explanation)) {
            const utterance = new SpeechSynthesisUtterance(explanation);
            utterance.voice = this.preferredVoice;
            utterance.lang = this.options.language;
            this.speechSynthesizer.speak(utterance);
        }

        // Close-Button
        popup.querySelector('.reader-explanation-close').addEventListener('click', () => {
            popup.remove();
            this.hideOverlay();
            this.overlay.style.borderColor = this.options.overlayBorderColor;
            this.overlay.style.backgroundColor = 'rgba(250, 204, 21, 0.1)';
        });

        // Auto-Close nach 12 Sekunden
        setTimeout(() => {
            if (popup.parentNode) {
                popup.remove();
                this.hideOverlay();
                this.overlay.style.borderColor = this.options.overlayBorderColor;
                this.overlay.style.backgroundColor = 'rgba(250, 204, 21, 0.1)';
            }
        }, 12000);
    }

    // === Silbentrennung ===

    /**
     * Setzt eine externe Hyphenation-Funktion (optional)
     * @param {Function} fn - Async Funktion die Text entgegennimmt und mit Soft-Hyphens zurückgibt
     */
    setHyphenationFunction(fn) {
        this.externalHyphenator = fn;
    }

    async hyphenateText() {
        if (this.isHyphenated) return;

        // Originaltext mit Tags verwenden (nicht den HTML-gerenderten Text)
        const text = this.getOriginalText();

        try {
            const hyphenated = await this._hyphenate(text);
            this._applyHyphenatedText(hyphenated);
            this.isHyphenated = true;
        } catch (error) {
            console.warn('Silbentrennung fehlgeschlagen, nutze Fallback:', error);
            const hyphenated = this._hyphenateFallback(text);
            this._applyHyphenatedText(hyphenated);
            this.isHyphenated = true;
        }

        // Wortbilder wieder anwenden wenn aktiv
        if (this.showWordImages) {
            this._applyWordImages();
        }
    }

    dehyphenateText() {
        if (!this.isHyphenated) return;

        // Originaltext wiederherstellen (mit Tags, ohne Silbentrennung)
        const text = this.getOriginalText().replace(/\u00AD/g, '');
        this.setText(text);
        this.isHyphenated = false;

        // Wortbilder wieder anwenden wenn aktiv
        if (this.showWordImages) {
            this._ensureWordWrapping();
            this._applyWordImages();
        }
    }

    async _hyphenate(text) {
        // Grafik-Blöcke extrahieren und schützen (nicht silbentrennen)
        // Verwende Platzhalter ohne Buchstaben, damit Silbentrenner sie nicht verändert
        const graphicBlocks = [];
        const graphicPattern = /\[TABELLE\]([\s\S]*?)\[\/TABELLE\]|\[GRAFIK\]([\s\S]*?)\[\/GRAFIK\]|\[BILDBESCHREIBUNG\]([\s\S]*?)\[\/BILDBESCHREIBUNG\]/g;
        let protectedText = text.replace(graphicPattern, (match) => {
            const placeholder = `\u2021\u2021\u2021${graphicBlocks.length}\u2021\u2021\u2021`;
            graphicBlocks.push(match);
            return placeholder;
        });

        let hyphenatedText;

        // 1. Hyphenopoly (WASM). Mit "de-x-syllable"-Patterns werden echte
        //    Sprechsilben markiert (O·ma, A·bend) – die normalen "de"-Muster
        //    sind Zeilenumbruch-Trennstellen und lassen Silben aus.
        const hyphenopolyHyphenator = await this._resolveHyphenopolyHyphenator();
        if (hyphenopolyHyphenator) {
            console.log(`ReaderTextView: Verwende Hyphenopoly (${this.hyphenopolyLanguage}) für Silbentrennung`);
            const result = await hyphenopolyHyphenator(protectedText);
            if (this.hyphenopolyLanguage && this.hyphenopolyLanguage.includes('-x-syllable')) {
                // Sprechsilben-Muster trennen vollständig – kein Kurzwort-Fallback nötig
                hyphenatedText = result;
            } else {
                hyphenatedText = this._applyShortWordFallbackHyphenation(result);
            }
        }

        // 2. Pattern-basierte Silbentrennung aus lokalen Pattern-Dateien
        if (!hyphenatedText && this.options.hyphenationPatternUrl) {
            try {
                if (!this.patternHyphenator) {
                    this.patternHyphenator = new PatternHyphenator(this.options.hyphenationPatternUrl, {
                        leftMin: this.options.hyphenationLeftMin,
                        rightMin: this.options.hyphenationRightMin
                    });
                }
                const result = await this.patternHyphenator.hyphenate(protectedText);
                if (result && result.length > 0) {
                    hyphenatedText = this._applyShortWordFallbackHyphenation(result);
                }
            } catch (error) {
                console.warn('Pattern-Silbentrennung fehlgeschlagen:', error);
            }
        }

        // 3. Externe Hyphenation-Funktion (optional)
        if (!hyphenatedText && this.externalHyphenator && typeof this.externalHyphenator === 'function') {
            try {
                const result = await this.externalHyphenator(protectedText);
                if (result && result.length > 0) {
                    hyphenatedText = this._applyShortWordFallbackHyphenation(result);
                }
            } catch (error) {
                console.warn('Externe Hyphenation fehlgeschlagen:', error);
            }
        }

        // 4. Einfacher Fallback
        if (!hyphenatedText) {
            console.log('ReaderTextView: Verwende Fallback-Silbentrennung');
            hyphenatedText = this._applyShortWordFallbackHyphenation(this._hyphenateFallback(protectedText));
        }

        // Nachbearbeitung: Zero-Width-Spaces entfernen (Kompositatrennung),
        // Abkürzungen/Markennamen (GmbH, DDR) ungetrennt lassen, Ausnahmen anwenden.
        // Läuft vor der Grafik-Wiederherstellung, damit geschützte Blöcke unberührt bleiben.
        hyphenatedText = this._postProcessHyphenation(hyphenatedText);

        // Grafik-Blöcke wiederherstellen
        graphicBlocks.forEach((block, index) => {
            hyphenatedText = hyphenatedText.replace(`\u2021\u2021\u2021${index}\u2021\u2021\u2021`, block);
        });

        return hyphenatedText;
    }

    /**
     * Sprachkandidaten für Hyphenopoly, beste zuerst:
     * "<sprache>-x-syllable" (echte Sprechsilben) vor "<sprache>" (Zeilenumbruch-Muster)
     */
    _getHyphenopolyLanguageCandidates() {
        const base = (this.options.language || 'de').split('-')[0].toLowerCase();
        return [`${base}-x-syllable`, base];
    }

    async _resolveHyphenopolyHyphenator() {
        if (!window.Hyphenopoly) {
            return null;
        }

        const candidates = this._getHyphenopolyLanguageCandidates();
        if (this.hyphenopolyHyphenator && candidates.includes(this.hyphenopolyLanguage)) {
            return this.hyphenopolyHyphenator;
        }

        const findLanguage = () => {
            const hyphenators = window.Hyphenopoly.hyphenators;
            if (!hyphenators) {
                return null;
            }
            return candidates.find((lang) => hyphenators[lang]) || null;
        };

        const start = Date.now();
        const maxWaitMs = this.options.hyphenopolyTimeoutMs;
        let language = findLanguage();
        while (!language && (Date.now() - start) < maxWaitMs) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            language = findLanguage();
        }

        if (!language) {
            return null;
        }

        const remaining = Math.max(0, maxWaitMs - (Date.now() - start));
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Hyphenopoly Timeout')), remaining)
        );

        try {
            const hyphenator = await Promise.race([
                window.Hyphenopoly.hyphenators[language],
                timeoutPromise
            ]);
            if (hyphenator && typeof hyphenator === 'function') {
                this.hyphenopolyHyphenator = hyphenator;
                this.hyphenopolyLanguage = language;
                return hyphenator;
            }
        } catch (error) {
            console.warn('Hyphenopoly fehlgeschlagen:', error);
        }

        return null;
    }

    /**
     * Nachbearbeitung des Silbentrennungs-Ergebnisses:
     * - entfernt Zero-Width-Spaces (fügt Hyphenopoly bei Bindestrich-Komposita ein)
     * - wendet konfigurierte Ausnahmen an (hyphenationExceptions: { "Wort": "Wo-rt" })
     * - lässt Abkürzungen/Mischschreibung (GmbH, DDR, iPhone) ungetrennt
     * @param {string} text - Text mit Soft-Hyphens
     * @returns {string} Bereinigter Text
     */
    _postProcessHyphenation(text) {
        let result = text.replace(/​/g, '');

        const tokenRegex = /[A-Za-zÄÖÜäöüßẞ]+(?:­[A-Za-zÄÖÜäöüßẞ]+)*/g;
        const exceptions = this.options.hyphenationExceptions || {};

        result = result.replace(tokenRegex, (token) => {
            const cleanWord = token.split('­').join('');

            if (Object.prototype.hasOwnProperty.call(exceptions, cleanWord)) {
                return exceptions[cleanWord].split('-').join('­');
            }

            // Maßeinheiten nicht trennen ("kg" statt "k-g", "cm" statt "c-m")
            if (HYPHENATION_PROTECTED_UNITS.has(cleanWord.toLowerCase())) {
                return cleanWord;
            }

            // Großbuchstabe nach der ersten Position → Abkürzung oder Markenname
            if (/[A-ZÄÖÜẞ]/.test(cleanWord.slice(1))) {
                return cleanWord;
            }

            return token;
        });

        return result;
    }

    /**
     * Trennt sehr kurze Wörter (z.B. "Oma", "Auto") nach, die von den
     * Zeilenumbruch-Mustern nicht getrennt wurden. Nur für die Fallback-Pfade
     * relevant – bei "de-x-syllable" trennt Hyphenopoly bereits vollständig.
     * @param {string} text - Text mit Soft-Hyphens
     * @returns {string}
     */
    _applyShortWordFallbackHyphenation(text) {
        const maxWordLength = this.options.hyphenationFallbackMaxWordLength;
        if (!Number.isFinite(maxWordLength) || maxWordLength < 2) {
            return text;
        }

        const wordRegex = /[A-Za-zÄÖÜäöüßẞ]+(?:­[A-Za-zÄÖÜäöüßẞ]+)*/g;
        return text.replace(wordRegex, (token) => {
            if (token.includes('­')) {
                return token;
            }

            if (token.length > maxWordLength) {
                return token;
            }

            if (this.options.hyphenationFallbackSkipAllCaps && token === token.toUpperCase()) {
                return token;
            }

            return this._hyphenateWordFallback(token);
        });
    }

    _hyphenateFallback(text) {
        // Fallback: Einfache regelbasierte Silbentrennung für Deutsch
        const words = text.split(/(\s+)/);
        const hyphenatedWords = words.map(word => {
            if (word.trim().length > 4) {
                return this._hyphenateWordFallback(word);
            }
            return word;
        });
        return hyphenatedWords.join('');
    }

    _hyphenateWordFallback(word) {
        // Verbesserte Fallback-Silbentrennung für Deutsch
        // Basiert auf den wichtigsten deutschen Trennregeln

        // Satzzeichen am Ende entfernen und später wieder anfügen
        const punctMatch = word.match(/^(.+?)([.,!?;:]+)$/);
        let mainWord = punctMatch ? punctMatch[1] : word;
        const punct = punctMatch ? punctMatch[2] : '';

        if (mainWord.length < 4) return word;

        const vowels = 'aeiouäöüAEIOUÄÖÜ';
        const consonants = 'bcdfghjklmnpqrstvwxzßBCDFGHJKLMNPQRSTVWXZ';

        // Nicht trennbare Konsonantengruppen (bleiben zusammen am Silbenanfang)
        const silbenAnfang = new Set([
            'bl', 'br', 'ch', 'ck', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gn', 'gr',
            'kl', 'kn', 'kr', 'pf', 'ph', 'pl', 'pr', 'qu', 'sch', 'schr', 'schw',
            'sk', 'sl', 'sm', 'sn', 'sp', 'spr', 'st', 'str', 'sw',
            'th', 'tr', 'tw', 'wr', 'zw'
        ]);

        const result = [];
        let currentSyllable = '';

        for (let i = 0; i < mainWord.length; i++) {
            const char = mainWord[i];
            const nextChar = mainWord[i + 1] || '';
            const afterNext = mainWord[i + 2] || '';

            currentSyllable += char;

            // Prüfen ob Trennung möglich (nach aktuellem Zeichen)
            if (i < mainWord.length - 2 && currentSyllable.length >= 2) {
                const isCurrentVowel = vowels.includes(char);
                const isNextConsonant = consonants.includes(nextChar);

                if (isCurrentVowel && isNextConsonant) {
                    // Prüfe was nach dem Konsonanten kommt
                    const twoChars = (nextChar + afterNext).toLowerCase();
                    const threeChars = (nextChar + afterNext + (mainWord[i + 3] || '')).toLowerCase();

                    // Mehrere Konsonanten?
                    if (consonants.includes(afterNext)) {
                        // Prüfe auf untrennbare Gruppe am Silbenanfang
                        if (silbenAnfang.has(threeChars.substring(0, 3)) ||
                            silbenAnfang.has(twoChars)) {
                            // Trenne vor der Konsonantengruppe
                            result.push(currentSyllable);
                            currentSyllable = '';
                        } else {
                            // Trenne zwischen den Konsonanten
                            currentSyllable += nextChar;
                            result.push(currentSyllable);
                            currentSyllable = '';
                            i++; // Überspringe den ersten Konsonanten
                        }
                    } else if (vowels.includes(afterNext)) {
                        // Einzelner Konsonant zwischen Vokalen: trenne vor dem Konsonanten
                        result.push(currentSyllable);
                        currentSyllable = '';
                    }
                }
            }
        }

        // Rest anfügen
        if (currentSyllable) {
            result.push(currentSyllable);
        }

        // Silben mit Soft-Hyphen verbinden
        return result.join('\u00AD') + punct;
    }

    _applyHyphenatedText(hyphenatedText) {
        const colors = this.options.hyphenationColors;

        // Platzhalter mit Unicode-Zeichen (werden nicht vom Silbentrenner verändert)
        const GRAPHIC_MARKER = '\u2020'; // † (Dagger)
        const LINEBREAK_MARKER = '\u2021'; // ‡ (Double Dagger)

        // Grafik-Blöcke extrahieren und durch Platzhalter ersetzen (wie in _formatText)
        const graphicBlocks = [];
        let processedText = hyphenatedText.replace(
            /\[TABELLE\]([\s\S]*?)\[\/TABELLE\]|\[GRAFIK\]([\s\S]*?)\[\/GRAFIK\]|\[BILDBESCHREIBUNG\]([\s\S]*?)\[\/BILDBESCHREIBUNG\]/g,
            (match) => {
                const placeholder = `${GRAPHIC_MARKER}${GRAPHIC_MARKER}${graphicBlocks.length}${GRAPHIC_MARKER}${GRAPHIC_MARKER}`;
                graphicBlocks.push(this._formatSingleGraphicTag(match));
                return placeholder;
            }
        );

        // Zeilenumbrüche durch Platzhalter ersetzen
        processedText = processedText.replace(/\n/g, `${LINEBREAK_MARKER}${LINEBREAK_MARKER}`);

        // Regex für Platzhalter dynamisch erstellen
        const graphicPlaceholderPattern = `${GRAPHIC_MARKER}${GRAPHIC_MARKER}\\d+${GRAPHIC_MARKER}${GRAPHIC_MARKER}`;
        const linebreakPlaceholder = `${LINEBREAK_MARKER}${LINEBREAK_MARKER}`;

        // Text in Wörter und Leerzeichen aufteilen (Leerzeichen beibehalten)
        const splitPattern = new RegExp(`(\\s+|${LINEBREAK_MARKER}${LINEBREAK_MARKER}|${graphicPlaceholderPattern})`);
        const tokens = processedText.split(splitPattern);
        let html = '';

        for (const token of tokens) {
            if (token === linebreakPlaceholder) {
                html += '<br>';
            } else if (token.match(new RegExp(`^${GRAPHIC_MARKER}${GRAPHIC_MARKER}(\\d+)${GRAPHIC_MARKER}${GRAPHIC_MARKER}$`))) {
                // Grafik-Block einfügen
                const index = parseInt(token.match(/\d+/)[0]);
                html += graphicBlocks[index];
            } else if (token.trim()) {
                html += this._formatHyphenatedToken(token, colors);
            } else if (token) {
                // Leerzeichen beibehalten
                html += token;
            }
        }

        this.textElement.innerHTML = html;
        this._refreshGraphicTablesForMode();
    }

    /**
     * Formatiert einen durch Leerzeichen begrenzten Textteil. Satzzeichen bleiben
     * ausserhalb des Wort-Wrappers, damit data-word zum Bild-Cache-Schluessel passt.
     */
    _formatHyphenatedToken(token, colors) {
        const wordPattern = /[A-Za-zÄÖÜäöüßẞ]+(?:\u00AD[A-Za-zÄÖÜäöüßẞ]+)*/g;
        let html = '';
        let lastIndex = 0;
        let match;

        while ((match = wordPattern.exec(token)) !== null) {
            html += this._escapeHtml(token.substring(lastIndex, match.index));

            const syllables = match[0].split('\u00AD');
            const cleanWord = syllables.join('');
            html += `<span class="word" data-word="${this._escapeHtml(cleanWord)}">`;

            if (syllables.length > 1) {
                syllables.forEach((syllable, idx) => {
                    const color = colors[idx % colors.length];
                    html += `<span class="syllable" style="color: ${color}">${this._escapeHtml(syllable)}</span>`;
                    if (idx < syllables.length - 1) {
                        html += '\u00AD';
                    }
                });
            } else {
                html += this._escapeHtml(cleanWord);
            }

            html += '</span>';
            lastIndex = match.index + match[0].length;
        }

        html += this._escapeHtml(token.substring(lastIndex));
        return html;
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // === Wortbilder (ARASAAC) ===

    /**
     * Aktiviert oder deaktiviert die Wortbild-Anzeige
     * @param {boolean} enabled - true zum Aktivieren
     */
    async setWordImages(enabled) {
        this.showWordImages = enabled;

        if (enabled) {
            this.textElement.classList.add('word-image-mode');
            await this.loadWordImages();
        } else {
            this.textElement.classList.remove('word-image-mode');
            this._removeWordImages();
        }

        this._dispatchEvent('wordimageschange', { enabled });
    }

    /**
     * Gibt zurueck, ob Wortbilder aktiv sind
     * @returns {boolean}
     */
    getWordImages() {
        return this.showWordImages;
    }

    /**
     * Laedt Wortbilder fuer alle Woerter im Text
     * @param {boolean} forceRefresh - Erzwingt Neuladen aller Bilder
     */
    async loadWordImages(forceRefresh = false) {
        if (this.isLoadingWordImages) return;
        this.isLoadingWordImages = true;

        this._dispatchEvent('wordimagesloadstart');

        try {
            // Pruefen ob Refresh noetig (Text wurde geaendert)
            const needsRefresh = forceRefresh || this._wordImagesNeedRefresh;
            if (needsRefresh) {
                this._wordImagesNeedRefresh = false;
                // Die Silbenansicht hat bereits vollstaendige Wort-Wrapper. Ein
                // Neuaufbau wuerde die farbigen Silben-Spans entfernen und Woerter
                // an Soft-Hyphens in einzelne, nicht bebilderbare Teile zerlegen.
                if (!this.isHyphenated) {
                    this._removeWordWrapping();
                }
            }

            // Stelle sicher, dass Woerter in Spans gewrappt sind
            this._ensureWordWrapping();

            // Alle eindeutigen Woerter extrahieren
            const text = this.getText();
            const words = this._extractUniqueWords(text);

            // Bilder fuer neue Woerter laden (parallel, aber mit Limit)
            const wordsToLoad = words.filter(word =>
                !this.wordImageCache.hasOwnProperty(word) &&
                !this.wordDisabledCache[word]
            );

            // In Batches laden, um API nicht zu ueberlasten
            const batchSize = 5;
            for (let i = 0; i < wordsToLoad.length; i += batchSize) {
                const batch = wordsToLoad.slice(i, i + batchSize);
                await Promise.all(batch.map(async (word) => {
                    if (!this.wordImageCache.hasOwnProperty(word)) {
                        const url = await this._fetchWordImage(word);
                        this.wordImageCache[word] = url; // null wenn nicht gefunden
                    }
                }));
            }

            // Bilder in DOM einfuegen
            if (this.showWordImages) {
                this._applyWordImages();
            }
        } catch (error) {
            console.warn('Fehler beim Laden der Wortbilder:', error);
        } finally {
            this.isLoadingWordImages = false;
            this._dispatchEvent('wordimagesloadend');
        }
    }

    /**
     * Extrahiert eindeutige Woerter aus Text
     * @param {string} text
     * @returns {string[]}
     */
    _extractUniqueWords(text) {
        // Soft-Hyphens entfernen bevor Woerter extrahiert werden
        const cleanText = text.replace(/\u00AD/g, '');
        // Alle Woerter mit mindestens 2 Buchstaben finden
        const words = cleanText.match(/[A-Za-zÄÖÜäöüßẞ]{2,}/g) || [];
        // Nach Mindestlaenge filtern
        const filteredWords = words.filter(w => w.length >= this.minWordLengthForImages);
        const uniqueWords = [...new Set(filteredWords.map(w => w.toLowerCase()))];
        return uniqueWords;
    }

    /**
     * Setzt die Mindestlaenge fuer Woerter, die bebildert werden
     * @param {number} length - Mindestlaenge (Standard: 4)
     */
    setMinWordLengthForImages(length) {
        this.minWordLengthForImages = length;
    }

    /**
     * Gibt die aktuelle Mindestlaenge fuer Wortbilder zurueck
     * @returns {number}
     */
    getMinWordLengthForImages() {
        return this.minWordLengthForImages;
    }

    /**
     * Entfernt Wort-Wrapping (span.word) aber behaelt Text
     */
    _removeWordWrapping() {
        const wordSpans = this.textElement.querySelectorAll('.word');
        wordSpans.forEach(span => {
            // Bilder entfernen
            const img = span.querySelector('.word-image');
            if (img) img.remove();
            // Span durch Textinhalt ersetzen
            const text = document.createTextNode(span.textContent);
            span.parentNode.replaceChild(text, span);
        });
        // Textknoten normalisieren (zusammenfuegen)
        this.textElement.normalize();
    }

    /**
     * Stellt sicher, dass Woerter in span.word Elementen gewrappt sind
     * Verwendet DOM-Manipulation um HTML-Tags zu erhalten
     */
    _ensureWordWrapping() {
        // Pruefen ob bereits Wort-Spans vorhanden sind
        const existingWordSpans = this.textElement.querySelectorAll('.word');
        if (existingWordSpans.length > 0) {
            return; // Bereits gewrappt (z.B. durch Hyphenation)
        }

        // Rekursiv durch alle Textknoten gehen und Woerter wrappen
        const wrapWordsInTextNode = (textNode) => {
            const text = textNode.textContent;
            if (!text.trim()) return;

            // Woerter finden (mindestens 2 Buchstaben)
            const wordRegex = /[A-Za-zÄÖÜäöüßẞ]{2,}/g;
            let match;
            const fragments = [];
            let lastIndex = 0;

            while ((match = wordRegex.exec(text)) !== null) {
                // Text vor dem Wort
                if (match.index > lastIndex) {
                    fragments.push(document.createTextNode(text.substring(lastIndex, match.index)));
                }

                // Wort in span wrappen
                const span = document.createElement('span');
                span.className = 'word';
                span.setAttribute('data-word', match[0]);
                span.textContent = match[0];
                fragments.push(span);

                lastIndex = match.index + match[0].length;
            }

            // Rest nach dem letzten Wort
            if (lastIndex < text.length) {
                fragments.push(document.createTextNode(text.substring(lastIndex)));
            }

            // Nur ersetzen wenn wir Fragmente haben
            if (fragments.length > 0) {
                const parent = textNode.parentNode;
                fragments.forEach(fragment => {
                    parent.insertBefore(fragment, textNode);
                });
                parent.removeChild(textNode);
            }
        };

        // Alle Textknoten sammeln (nicht waehrend der Iteration modifizieren)
        const textNodes = [];
        const walker = document.createTreeWalker(
            this.textElement,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        let node;
        while ((node = walker.nextNode())) {
            textNodes.push(node);
        }

        // Jetzt die Textknoten verarbeiten
        textNodes.forEach(wrapWordsInTextNode);
    }

    /**
     * Holt Bild-URL fuer ein Wort von ARASAAC
     * @param {string} word
     * @returns {Promise<string|null>}
     */
    async _fetchWordImage(word) {
        if (typeof window.RechengeschichtenAPI?.getArasaacImageUrl === 'function') {
            return await window.RechengeschichtenAPI.getArasaacImageUrl(word);
        }
        return null;
    }

    /**
     * Fuegt Bilder ueber allen Woertern im DOM ein
     */
    _applyWordImages() {
        // Alle word-Elemente finden
        const wordElements = this.textElement.querySelectorAll('.word');

        wordElements.forEach(wordEl => {
            // Wort aus data-word oder textContent holen und Soft-Hyphens entfernen
            const rawWord = wordEl.getAttribute('data-word') || wordEl.textContent;
            const word = rawWord.replace(/\u00AD/g, '').toLowerCase();

            // Existierendes Bild entfernen
            const existingImg = wordEl.querySelector('.word-image');
            if (existingImg) {
                existingImg.remove();
            }

            // Pruefen ob deaktiviert
            if (this.wordDisabledCache[word]) {
                return;
            }

            // Bild einfuegen wenn vorhanden
            const imageUrl = this.wordImageCache[word];
            if (imageUrl) {
                const img = document.createElement('img');
                img.className = 'word-image';
                img.src = imageUrl;
                img.alt = '';
                // Bewusst KEIN loading="lazy": Wortbilder werden dynamisch (oft während
                // der Reader kurz display:none ist, z.B. Edit-Modus) eingefügt. Lazy-Bilder
                // richten dann keinen IntersectionObserver ein und laden auch nach dem
                // Sichtbarwerden nie nach. Es sind wenige, kleine Piktogramme -> eager.
                img.loading = 'eager';
                img.onerror = () => img.classList.add('error');
                wordEl.insertBefore(img, wordEl.firstChild);
            }
        });
    }

    /**
     * Entfernt alle Wortbilder aus dem DOM
     */
    _removeWordImages() {
        const images = this.textElement.querySelectorAll('.word-image');
        images.forEach(img => img.remove());
    }

    /**
     * Setzt das Bild fuer ein bestimmtes Wort
     * @param {string} word - Das Wort
     * @param {string|null} url - Die Bild-URL oder null zum Entfernen
     */
    setWordImage(word, url) {
        // Soft-Hyphens entfernen fuer konsistenten Cache-Key
        const lowerWord = word.replace(/\u00AD/g, '').toLowerCase();
        if (url) {
            this.wordImageCache[lowerWord] = url;
            delete this.wordDisabledCache[lowerWord];
        } else {
            delete this.wordImageCache[lowerWord];
        }

        if (this.showWordImages) {
            this._applyWordImages();
        }
    }

    /**
     * Deaktiviert oder aktiviert das Bild fuer ein Wort
     * @param {string} word - Das Wort
     * @param {boolean} disabled - true zum Deaktivieren
     */
    setWordImageDisabled(word, disabled) {
        // Soft-Hyphens entfernen fuer konsistenten Cache-Key
        const lowerWord = word.replace(/\u00AD/g, '').toLowerCase();
        if (disabled) {
            this.wordDisabledCache[lowerWord] = true;
        } else {
            delete this.wordDisabledCache[lowerWord];
        }

        if (this.showWordImages) {
            this._applyWordImages();
        }
    }

    /**
     * Gibt alle Woerter mit ihrem Bildstatus zurueck
     * Inkludiert auch manuell hinzugefuegte Woerter (die nur im Cache sind)
     * @returns {Array<{word: string, url: string|null, disabled: boolean, inText: boolean}>}
     */
    getWordImageStatus() {
        const text = this.getText();
        const wordsInText = this._extractUniqueWords(text);
        const wordsInTextSet = new Set(wordsInText);

        // Woerter aus dem Text
        const result = wordsInText.map(word => ({
            word,
            url: this.wordImageCache[word] || null,
            disabled: !!this.wordDisabledCache[word],
            inText: true
        }));

        // Manuell hinzugefuegte Woerter (im Cache aber nicht im Text)
        const cacheWords = Object.keys(this.wordImageCache);
        cacheWords.forEach(word => {
            if (!wordsInTextSet.has(word) && this.wordImageCache[word]) {
                result.push({
                    word,
                    url: this.wordImageCache[word],
                    disabled: !!this.wordDisabledCache[word],
                    inText: false
                });
            }
        });

        return result;
    }

    /**
     * Setzt den Bild-Cache zurueck
     */
    clearWordImageCache() {
        this.wordImageCache = {};
        this.wordDisabledCache = {};

        if (this.showWordImages) {
            this._removeWordImages();
        }
    }

    // === Schriftgröße ===

    setFontSize(size) {
        this.options.fontSize = size;
        this.textElement.style.fontSize = `${size}px`;
        this.textElement.style.lineHeight = String(this.options.lineSpacing);
    }

    getFontSize() {
        return this.options.fontSize;
    }

    setReadingSpeed(speed) {
        this.options.readingSpeed = speed;
    }

    getReadingSpeed() {
        return this.options.readingSpeed;
    }

    // === Text-Management ===

    setText(text) {
        // Originaltext speichern (für Silbentrennung mit Tags)
        this._originalText = text;

        // Markdown-artige Formatierung anwenden
        const formattedHtml = this._formatText(text);
        this.textElement.innerHTML = formattedHtml;
        this.isHyphenated = false;
        this._refreshGraphicTablesForMode();

        // Wortbilder invalidieren bei Textaenderung (immer, nicht nur wenn aktiv)
        this._wordImagesNeedRefresh = true;

        // Placeholder-Klasse aktualisieren
        if (this.placeholder) {
            if (text && text.trim()) {
                this.textElement.classList.remove('has-placeholder');
            } else {
                this.textElement.classList.add('has-placeholder');
            }
        }
    }

    getText() {
        return this.textElement.innerText || this.textElement.textContent || '';
    }

    /**
     * Gibt den Originaltext mit Tags zurück (für Silbentrennung)
     */
    getOriginalText() {
        return this._originalText || this.getText();
    }

    /**
     * Gibt den Text mit Grafik-Tags zurück (für Speichern)
     * Rekonstruiert Tags aus HTML falls nötig
     */
    getTextWithTags() {
        const hasGraphicBlocks = this.textElement.querySelector('.reader-graphic-block');
        if (hasGraphicBlocks) {
            return this._reconstructTextWithTags();
        }
        return this._originalText || this.getText();
    }

    /**
     * Rekonstruiert den Text mit Grafik-Tags aus dem aktuellen HTML
     * Wird verwendet, wenn der Nutzer den Text bearbeitet
     */
    _reconstructTextWithTags() {
        // Clone des Elements erstellen um es zu manipulieren
        const clone = this.textElement.cloneNode(true);

        // Grafik-Blöcke finden und durch Tags ersetzen
        const graphicBlocks = clone.querySelectorAll('.reader-graphic-block');

        graphicBlocks.forEach(block => {
            let tagName = '';
            let content = '';

            // Typ bestimmen
            if (block.classList.contains('reader-table-block')) {
                tagName = 'TABELLE';
            } else if (block.classList.contains('reader-chart-block')) {
                tagName = 'GRAFIK';
            } else if (block.classList.contains('reader-description-block')) {
                tagName = 'BILDBESCHREIBUNG';
            }

            // Content extrahieren: bei Tabellen bevorzugt den unveränderten Rohtext
            // (data-raw-table), da im Lesemodus statt <pre> eine <table> steht und
            // deren textContent die Pipe-Struktur nicht mehr rekonstruieren könnte.
            const rawTable = tagName === 'TABELLE' ? block.getAttribute('data-raw-table') : null;
            if (rawTable !== null && rawTable !== undefined) {
                content = rawTable;
            } else {
                const contentEl = block.querySelector('.reader-graphic-content');
                if (contentEl) {
                    content = contentEl.textContent || '';
                }
            }

            // Block durch Tag ersetzen
            if (tagName) {
                const textNode = document.createTextNode(`[${tagName}]${content}[/${tagName}]`);
                block.parentNode.replaceChild(textNode, block);
            }
        });

        // Text aus dem modifizierten Clone extrahieren
        return clone.innerText || clone.textContent || '';
    }

    getHTML() {
        return this.textElement.innerHTML;
    }

    setHTML(html) {
        this.textElement.innerHTML = html;
        this.isHyphenated = false;
        this._refreshGraphicTablesForMode();

        // Placeholder-Klasse aktualisieren
        if (this.placeholder) {
            if (this.getText().trim()) {
                this.textElement.classList.remove('has-placeholder');
            } else {
                this.textElement.classList.add('has-placeholder');
            }
        }
    }

    _formatText(text) {
        // Grafik-Tags vor anderen Formatierungen verarbeiten
        // Grafik-Blöcke temporär durch Platzhalter ersetzen
        const graphicBlocks = [];
        let html = text.replace(/\[TABELLE\]([\s\S]*?)\[\/TABELLE\]|\[GRAFIK\]([\s\S]*?)\[\/GRAFIK\]|\[BILDBESCHREIBUNG\]([\s\S]*?)\[\/BILDBESCHREIBUNG\]/g, (match) => {
            const placeholder = `%%%GRAPHIC_BLOCK_${graphicBlocks.length}%%%`;
            graphicBlocks.push(this._formatSingleGraphicTag(match));
            return placeholder;
        });

        // Bold: **text** -> <strong>text</strong>
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Aufzählungspunkte: * item -> • item
        html = html.replace(/^\* /gm, '&bull; ');

        // Zeilenumbrüche nach Satzenden (außer bei Abkürzungen)
        html = html.replace(/([.!?])(?!\d)(?![\s]*[a-zäöü])\s+/g, '$1<br>');

        // Paragraphen
        html = html.split('\n\n').map(p => p.trim() ? `<p>${p}</p>` : '').join('');

        // Einfache Zeilenumbrüche
        html = html.replace(/\n/g, '<br>');

        // Grafik-Blöcke wieder einfügen
        graphicBlocks.forEach((block, index) => {
            html = html.replace(`%%%GRAPHIC_BLOCK_${index}%%%`, block);
        });

        return html;
    }

    /**
     * Formatiert einen einzelnen Grafik-Tag als HTML
     */
    _formatSingleGraphicTag(match) {
        // Tabellen
        // Basis-Rendering: immer der rohe ASCII-Text in <pre> (bisheriges Verhalten,
        // Bearbeiten-Modus). Ob im Lesemodus stattdessen eine echte HTML-Tabelle steht,
        // entscheidet _refreshGraphicTablesForMode() direkt danach am DOM — so bleibt die
        // Darstellung auch dann korrekt, wenn setText() vor einem setMode()-Wechsel läuft.
        // Der Rohtext wird zusätzlich in data-raw-table gesichert (u.a. für die
        // Rekonstruktion beim Speichern, siehe _reconstructTextWithTags()).
        let result = match.replace(/\[TABELLE\]([\s\S]*?)\[\/TABELLE\]/g, (m, content) => {
            const trimmedContent = content.trim();
            const escapedContent = this._escapeHtml(trimmedContent);
            const escapedAttr = this._escapeAttr(trimmedContent);
            return `<div class="reader-graphic-block reader-table-block" contenteditable="false" data-raw-table="${escapedAttr}">
                <pre class="reader-graphic-content">${escapedContent}</pre>
            </div>`;
        });

        // Grafiken/Diagramme
        result = result.replace(/\[GRAFIK\]([\s\S]*?)\[\/GRAFIK\]/g, (m, content) => {
            const escapedContent = this._escapeHtml(content.trim());
            return `<div class="reader-graphic-block reader-chart-block" contenteditable="false">
                <div class="reader-graphic-header"><span class="reader-graphic-icon">📈</span> Diagramm</div>
                <pre class="reader-graphic-content">${escapedContent}</pre>
            </div>`;
        });

        // Bildbeschreibungen
        result = result.replace(/\[BILDBESCHREIBUNG\]([\s\S]*?)\[\/BILDBESCHREIBUNG\]/g, (m, content) => {
            const escapedContent = this._escapeHtml(content.trim());
            return `<div class="reader-graphic-block reader-description-block" contenteditable="false">
                <div class="reader-graphic-header"><span class="reader-graphic-icon">🖼️</span> Bildbeschreibung</div>
                <div class="reader-graphic-content reader-description-content">${escapedContent}</div>
            </div>`;
        });

        return result;
    }

    /**
     * Wie _escapeHtml(), zusätzlich werden Anführungszeichen für die sichere
     * Einbettung in ein doppelt-quotiertes HTML-Attribut escaped.
     */
    _escapeAttr(text) {
        return this._escapeHtml(text).replace(/"/g, '&quot;');
    }

    /**
     * Baut die HTML-Tabelle (Wrapper + <table>) aus geparsten Zeilen (string[][]).
     * Erste Zeile wird als <thead> gerendert, der Rest als <tbody>. Zellen werden
     * HTML-escaped.
     */
    _buildAsciiTableHtml(rows) {
        const [headerRow, ...bodyRows] = rows;
        const headHtml = `<thead><tr>${headerRow.map((cell) => `<th>${this._escapeHtml(cell)}</th>`).join('')}</tr></thead>`;
        const bodyHtml = `<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${this._escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`;
        return `<div class="reader-graphic-content reader-ascii-table-wrapper"><table class="reader-ascii-table">${headHtml}${bodyHtml}</table></div>`;
    }

    /**
     * Gleicht die Darstellung aller Tabellen-Grafikblöcke ([TABELLE]) im DOM mit dem
     * aktuellen Modus ab:
     * - Lesemodus + parsebare ASCII-Tabelle: kindgerechte <table class="reader-ascii-table">
     * - sonst (Bearbeiten-Modus oder nicht parsebar): rohe ASCII in <pre> (bisheriges Verhalten)
     *
     * Wird nach jedem Neu-Rendern des Texts (setText/setHTML/_applyHyphenatedText) sowie
     * bei jedem Moduswechsel (_applyMode) aufgerufen, damit die Darstellung unabhängig von
     * der Aufruf-Reihenfolge (z.B. setText() vor setMode()) immer zum aktuellen Modus passt.
     * Rührt ausschließlich .reader-table-block an — GRAFIK/BILDBESCHREIBUNG bleiben unverändert.
     */
    _refreshGraphicTablesForMode() {
        if (!this.textElement || typeof this.textElement.querySelectorAll !== 'function') return;

        const blocks = this.textElement.querySelectorAll('.reader-table-block');
        blocks.forEach((block) => {
            const rawAttr = block.getAttribute('data-raw-table');
            if (rawAttr === null || rawAttr === undefined) return; // kein Rohtext gesichert, nichts zu tun

            const contentEl = block.querySelector('.reader-graphic-content');
            if (!contentEl) return;

            const rows = this.mode === 'read' ? parseAsciiTableToRows(rawAttr) : null;
            const shouldBeTable = !!rows;
            const isCurrentlyTable = contentEl.tagName === 'DIV' && contentEl.classList.contains('reader-ascii-table-wrapper');

            if (shouldBeTable === isCurrentlyTable) return; // Darstellung passt bereits

            let replacement;
            if (shouldBeTable) {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = this._buildAsciiTableHtml(rows);
                replacement = wrapper.firstElementChild;
            } else {
                replacement = document.createElement('pre');
                replacement.className = 'reader-graphic-content';
                replacement.textContent = rawAttr;
            }
            contentEl.replaceWith(replacement);
        });
    }

    // === Placeholder ===

    setPlaceholder(text) {
        this.placeholder = text;
        this.textElement.setAttribute('data-placeholder', text);
        if (!this.getText().trim()) {
            this.textElement.classList.add('has-placeholder');
        } else {
            this.textElement.classList.remove('has-placeholder');
        }
    }

    // === Event Handler ===

    _handleScroll(e) {
        // Overlay-Position aktualisieren, falls sichtbar
        if (this.overlay.style.display !== 'none') {
            // Overlay verstecken beim Scrollen
            this.hideOverlay();
        }
    }

    _handleInput(e) {
        this.hideOverlay();
        this.isHyphenated = false;

        // Originaltext aktualisieren (bei direkter Bearbeitung)
        // Grafik-Tags aus dem HTML rekonstruieren falls vorhanden
        const hasGraphicBlocks = this.textElement.querySelector('.reader-graphic-block');
        if (hasGraphicBlocks) {
            this._originalText = this._reconstructTextWithTags();
        } else {
            this._originalText = this.getText();
        }

        // Placeholder-Handling
        if (this.placeholder) {
            if (this.getText().trim()) {
                this.textElement.classList.remove('has-placeholder');
            } else {
                this.textElement.classList.add('has-placeholder');
            }
        }

        this._dispatchEvent('input', { text: this.getText() });
    }

    _handlePaste(e) {
        // Reinen Text einfügen
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');

        document.execCommand('insertText', false, text);

        // Nach oben scrollen
        setTimeout(() => {
            this.textElement.scrollTo({ top: 0, behavior: 'smooth' });
        }, 100);

        this._dispatchEvent('paste', { text });
    }

    _handleFocus(e) {
        this.hideOverlay();
        this._dispatchEvent('focus');
    }

    _handleBlur(e) {
        this._dispatchEvent('blur');
    }

    // === Utility ===

    _dispatchEvent(name, detail = {}) {
        const event = new CustomEvent(`readertextview:${name}`, {
            bubbles: true,
            detail: { ...detail, instance: this }
        });
        this.container.dispatchEvent(event);
    }

    // === Public API ===

    setEditable(editable) {
        this.options.editable = editable;
        this.textElement.setAttribute('contenteditable', editable ? 'true' : 'false');
        this.textElement.style.userSelect = editable ? 'text' : 'none';
        this.textElement.style.WebkitUserSelect = editable ? 'text' : 'none';
    }

    isEditable() {
        return this.options.editable;
    }

    setAutoScroll(enabled) {
        this.options.autoScroll = enabled;
    }

    setLanguage(lang) {
        this.options.language = lang;
        this._loadVoices();
    }

    focus() {
        this.textElement.focus();
    }

    blur() {
        this.textElement.blur();
    }

    scrollToTop() {
        this.textElement.scrollTo({ top: 0, behavior: 'smooth' });
    }

    scrollToBottom() {
        this.textElement.scrollTo({
            top: this.textElement.scrollHeight,
            behavior: 'smooth'
        });
    }

    // === Modus-Umschaltung ===

    /**
     * Setzt den Modus der Komponente
     * @param {string} mode - 'edit' für Markier-/Einfügemodus, 'read' für Lesemodus
     */
    setMode(mode) {
        if (mode !== 'edit' && mode !== 'read') {
            console.warn('ReaderTextView: Ungültiger Modus. Verwende "edit" oder "read".');
            return;
        }

        const previousMode = this.mode;
        this.mode = mode;
        this._applyMode();

        // Wortbilder aktualisieren wenn noetig (z.B. nach Textaenderung im Edit-Modus)
        if (mode === 'read' && this.showWordImages && this._wordImagesNeedRefresh) {
            this.loadWordImages();
        }

        // Event auslösen
        this._dispatchEvent('modechange', { mode, previousMode });
    }

    /**
     * Gibt den aktuellen Modus zurück
     * @returns {string} 'edit' oder 'read'
     */
    getMode() {
        return this.mode;
    }

    /**
     * Wechselt zwischen den Modi
     * @returns {string} Der neue Modus
     */
    toggleMode() {
        const newMode = this.mode === 'edit' ? 'read' : 'edit';
        this.setMode(newMode);
        return newMode;
    }

    /**
     * Prüft, ob sich die Komponente im Lesemodus befindet
     * @returns {boolean}
     */
    isReadMode() {
        return this.mode === 'read';
    }

    /**
     * Prüft, ob sich die Komponente im Bearbeitungsmodus befindet
     * @returns {boolean}
     */
    isEditMode() {
        return this.mode === 'edit';
    }

    _applyMode() {
        if (this.mode === 'read') {
            // Lesemodus: Textfeld bleibt aktiv für Touch-Events, aber nicht editierbar
            // WICHTIG: Wir setzen NICHT user-select: none, da das auf iOS Touch-Events blockiert
            // Stattdessen verhindern wir Textauswahl per selectstart Event
            this.textElement.setAttribute('contenteditable', 'false');
            this.textElement.style.cursor = 'default';
            // touch-action: auto erlaubt native Touch-Gesten inkl. Scrollen
            this.textElement.style.touchAction = 'auto';
            this.container.style.touchAction = 'auto';
            this.container.classList.add('reader-mode');
            this.container.classList.remove('edit-mode');

            // Eventuelle Auswahl aufheben
            window.getSelection()?.removeAllRanges();
        } else {
            // Bearbeitungsmodus: Editierbar, kein Lesefinger
            if (this.options.editable) {
                this.textElement.setAttribute('contenteditable', 'true');
                this.textElement.style.cursor = 'text';
            }
            // Im Bearbeitungsmodus normale Touch-Gesten erlauben
            this.textElement.style.touchAction = 'auto';
            this.container.style.touchAction = 'auto';
            this.container.classList.add('edit-mode');
            this.container.classList.remove('reader-mode');

            // Stoppe eventuelle Sprachausgabe
            this.stopReading();
            this.speechSynthesizer.cancel();
            this.hideOverlay();
        }

        // Tabellen-Grafikblöcke an den (neuen) Modus anpassen (ASCII <-> HTML-Tabelle) —
        // unabhängig davon, ob setText() vor oder nach diesem Moduswechsel lief.
        this._refreshGraphicTablesForMode();
    }

    destroy() {
        this.stopReading();
        this.speechSynthesizer.cancel();

        if (this.scrollAnimationId) {
            cancelAnimationFrame(this.scrollAnimationId);
        }

        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
        }

        // Event Listener entfernen
        this.textElement.remove();
        this.overlay.remove();
    }
}

// Dual-Export: parseAsciiTableToRows als testbare Hilfsfunktion an die Klasse anhängen
// (Muster wie visualization-guard.js) — ohne die Datei umzustrukturieren.
ReaderTextView.parseAsciiTableToRows = parseAsciiTableToRows;

// Export für verschiedene Modul-Systeme
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReaderTextView;
} else if (typeof define === 'function' && define.amd) {
    define([], function() { return ReaderTextView; });
} else {
    window.ReaderTextView = ReaderTextView;
}
