/**
 * Hauptanwendungslogik fuer die Rechengeschichten-App
 */

// ===== GLOBALE VARIABLEN =====

let reader = null;
let creationMode = 'text'; // 'text', 'explore', 'dialog'
let currentStrategy = null;
let taskText = '';
let taskTextWithGraphics = ''; // Vollstaendiger Text mit Grafik-Tags fuer KI-Kontext
let taskGraphics = []; // Gespeicherte Grafiken [{type, content}]
let taskImageBase64 = null;
let taskGraphicBase64 = null; // Grafik aus dem Foto (falls vorhanden)
let chatHistory = [];
let chatRequestGeneration = 0; // entwertet verspätete Chat-Antworten nach Strategie-/Aufgabenwechsel
let chatSendInFlight = false;  // blockt Doppel-Senden während einer laufenden Anfrage
let isRecording = false;
let mediaRecorder = null;
let sendAfterRecording = false;
let audioChunks = [];
let browserSpeechRecognition = null; // Web Speech API Instanz (Fallback wenn Groq Whisper nicht verfügbar)
let browserSpeechFinalText = '';
let browserSpeechPrefix = ''; // Bereits vorhandener Text im Eingabefeld vor Start der Erkennung
let browserSpeechSilenceTimer = null; // Stoppt die Erkennung nach längerer Stille
const BROWSER_SPEECH_SILENCE_MS = 2000; // Pause-Länge bis zum Stop (ms)
// Der alte OpenRouter-Qualitaetshinweis bleibt im HTML erhalten und kann fuer die
// rein kostenlose Modellkette jederzeit wieder eingeblendet werden.
const SHOW_OPENROUTER_QUALITY_NOTICE = false;
const WEB_PRIVACY_CONSENT_KEY = 'rechengeschichten_web_privacy_consent_v1';
const WEB_PRIVACY_CONSENT_DATE_KEY = 'rechengeschichten_web_privacy_consent_date';
let nativeSpeechActive = false; // Läuft gerade eine iOS-native SFSpeechRecognizer-Session?
let nativeSpeechFinalText = '';
let nativeSpeechPrefix = ''; // Bereits vorhandener Text im Eingabefeld vor Start der Erkennung
let nativeSpeechFailedThisSession = false; // Bei nativem Fehler einmalig auf Groq Whisper zurückfallen
let cloudTranscribePrefix = ''; // Vorhandener Eingabetext vor einer Groq-Whisper-Aufnahme
let readingWordOverview = null;
let readingWordOverviewTask = null;
let isWordOverviewLoading = false;
let lastCheckedTaskText = null; // Speichert den zuletzt geprueften Text
let currentTaskType = null; // 'standard', 'fermi', 'captain' - wird durch classifyTask() gesetzt
let currentSolutionHint = null; // Interne Lösungs-/Pädagogik-Referenz aus classifyTask() - wird der KI als Hintergrundwissen mitgegeben (nicht für das Kind sichtbar)
let currentTaskVisualizable = false; // Eignung für Plättchen (fail-closed: erst Klassifikation + Pre-Check geben frei)
let classifyGeneration = 0; // entwertet verspätete classifyTask-Antworten nach einem Aufgabenwechsel
let currentVisualizationPlan = null; // Fester Gesamtplan (Schrittfolge) im begleiteten Visualisieren-Modus
let soundEnabled = true; // Ton fuer Chat-Antworten aktiviert/deaktiviert (Session-State)
let currentDialogCalculation = null; // Speichert die vorgegebene Rechnung im "Zu einer Rechnung"-Modus

// Wortbilder / ARASAAC Variablen
let isWordImagesActive = false;
let currentSearchWord = null;
let wordImagesLastText = null; // Text, fuer den zuletzt Bilder geladen wurden

// Worterklärung mit Bild/Emoji
let explanationImagesEnabled = true;
const wordExplanationCache = new Map();   // Key: Wort (lowercase) -> { explanation, visual }
let wordExplanationCacheText = null;      // Aufgabentext, für den der Cache gilt

// Mehrsprachigkeit
let languageButtonEnabled = false;
let activeLanguageCode = 'de';
let languageList = [];

// Fehler-Detektiv Variablen
let currentWrongSolution = null; // Speichert die generierte falsche Loesung
let correctSolution = null; // Speichert die korrekte Loesung

// Notizbuch-Variablen
let currentNotebookData = null;

// Urkunden/Zertifikat-Variablen
let certificatesState = { certificates: [] };
let missionAlreadyCompleted = false; // Verhindert mehrfache Completion pro Session
let pendingCertificatePresentation = null; // Urkunde speichern, aber erst beim Verlassen zeigen
let pendingMicroAssessment = null; // Nach der aufgeschobenen Urkundenanzeige zeigen

// Collection-Variablen
let collectionState = {
    userStories: [],
    exampleStories: [],
    activeFilters: {
        type: null,
        difficulty: null,
        zahlenraum: []
    },
    searchQuery: ''
};
let pendingLoadStory = null; // Fuer Bestaetigungs-Dialog

// Undo-Funktion: vorherige Aufgabe speichern
let previousTask = null; // { text, textWithGraphics, graphics, taskType, solutionHint, visualizable }

// Zeichnung / Foto im Chat (XOR: nur eines kann angehängt sein)
let drawingImageBase64 = null;
let photoImageBase64 = null;   // Foto der eigenen Lösung im Chat (XOR zur Zeichnung)

// NotePad-Status
let notePadReady = false;
let noteObjectCache = { text: null, items: null, promise: null };
let objectTrayOpen = false;
let chatToolsMeasureFrame = null;

// Integrierte Notizfläche unter dem Aufgabentext
let inlineNoteReady = false;
// Nur geänderte Notizen werden (erneut) mitgesendet — sonst müsste die KI die
// unveränderte Zeichnung bei jeder Nachricht erneut beschreiben (Vision-Pflichtprompt).
let inlineNoteDirty = false;
// Nach manuellem Ziehen der Höhe keine Auto-Anpassung mehr (bis zur nächsten Aufgabe)
let inlineNoteUserSized = false;

// Onboarding
let currentOnboardingSlide = 0;
const TOTAL_ONBOARDING_SLIDES = 4;

// Mapping: Welche Elemente bei welchem Slide hervorgehoben werden
const ONBOARDING_HIGHLIGHTS = {
    0: ['btn-open-collection', 'btn-photo', 'btn-generate', 'btn-dialog-develop'], // Aufgabe eingeben
    1: ['btn-go-explore'], // Aufgabe erkunden — Los-geht's-Button
    2: ['btn-header-menu'], // Urkunden (im geschlossenen Menü — Menü-Button hervorheben)
    3: ['btn-header-menu'] // Einstellungen (im geschlossenen Menü — Menü-Button hervorheben)
};

// ===== DOM ELEMENTE =====

const DOM = {};

// ===== INITIALISIERUNG =====

document.addEventListener('DOMContentLoaded', () => {
    initDOMReferences();
    initReader();
    initEventListeners();
    initNativeAppUI();    // Native App UI-Anpassungen
    // Bridge für iOS-Native-Spracherkennung (SFSpeechRecognizer)
    window.addEventListener('nativeSpeechRecognition', handleNativeSpeechRecognitionEvent);
    checkForSharedTask(); // Zuerst URL-Parameter verarbeiten (speichert in localStorage)
    loadSettings();       // Dann Einstellungen laden (inkl. URL-Parameter)
    loadCollection();     // Sammlung aus localStorage laden
    loadCertificates();   // Urkunden aus localStorage laden
    loadExampleTasks();   // Beispiel-Aufgaben laden (async)
    updateUI();
    updateCollectionButtonVisibility();
    const webConsentShown = showWebPrivacyConsentIfNeeded();
    if (!webConsentShown) showOnboardingIfNeeded(); // Tutorial beim ersten Besuch anzeigen
    updateInputStateUI(); // Zustands-UI (Leer/Bereit) initial setzen
    // Matheforscher-Plattform-Bridge: Hooks und URL-Config nur wirksam,
    // wenn die App im iframe der Plattform läuft (sonst No-Op).
    initMatheforscherIntegration();
});

/**
 * Initialisiert UI-Anpassungen fuer die native iOS-App
 */
function initNativeAppUI() {
    // Pruefen ob wir in der nativen App laufen
    const isNativeApp = isNativeAppContext();

    if (isNativeApp) {
        // Footer auf der Hauptseite ausblenden
        const mainFooter = document.getElementById('main-footer');
        if (mainFooter) {
            mainFooter.style.display = 'none';
        }

        // Credits in den Einstellungen anzeigen
        const settingsCredits = document.getElementById('settings-credits');
        if (settingsCredits) {
            settingsCredits.style.display = 'block';
        }

        // Zugangsschluessel-Option beim Teilen ausblenden
        const shareApiKeyOption = document.getElementById('share-api-key-option');
        if (shareApiKeyOption) {
            shareApiKeyOption.style.display = 'none';
        }

        // Body-Klasse setzen fuer weitere CSS-Anpassungen
        document.body.classList.add('native-app');
    }
}

function isNativeAppContext() {
    return !!window.isNativeApp
        || window.location.protocol === 'file:'
        || window.location.protocol === 'rechengeschichten-app:';
}

function initDOMReferences() {
    // Toolbar-Buttons fuer Aufgaben-Erstellung
    DOM.btnGenerate = document.getElementById('btn-generate');
    DOM.btnDialogDevelop = document.getElementById('btn-dialog-develop');
    DOM.btnUndoTask = document.getElementById('btn-undo-task');

    // Reader & Task
    DOM.readerContainer = document.getElementById('reader-container');
    DOM.taskImageContainer = document.getElementById('task-image-container');
    DOM.taskImage = document.getElementById('task-image');
    DOM.btnRemoveTaskImage = document.getElementById('btn-remove-task-image');

    // Photo
    DOM.btnPhoto = document.getElementById('btn-photo');
    DOM.photoDropdown = document.getElementById('photo-dropdown');
    DOM.btnPhotoGallery = document.getElementById('btn-photo-gallery');
    DOM.btnPhotoCamera = document.getElementById('btn-photo-camera');
    DOM.photoUpload = document.getElementById('photo-upload');
    DOM.cameraCapture = document.getElementById('camera-capture');

    // Recognize Progress
    DOM.recognizeProgress = document.getElementById('recognize-progress');
    DOM.recognizeStatus = document.getElementById('recognize-status');

    // Strategy List (im Chat-Bereich)
    DOM.strategyList = document.getElementById('strategy-list');
    DOM.strategyListBtns = document.querySelectorAll('.strategy-list-btn');

    // Chat
    DOM.chatContainer = document.getElementById('chat-container');
    DOM.chatSide = document.getElementById('chat-side');
    DOM.chatHeader = document.getElementById('chat-header');
    DOM.chatModeLabel = document.getElementById('chat-mode-label');
    DOM.btnBackToStrategies = document.getElementById('btn-back-to-strategies');
    DOM.btnToggleSound = document.getElementById('btn-toggle-sound');
    DOM.chatMessages = document.getElementById('chat-messages');
    DOM.chatTyping = document.getElementById('chat-typing');
    DOM.chatInputArea = document.getElementById('chat-input-area');
    DOM.chatInputTools = document.getElementById('chat-input-tools');
    DOM.chatToolsToggle = document.getElementById('chat-tools-toggle');
    DOM.chatInputToolsList = document.getElementById('chat-input-tools-list');
    DOM.chatComposer = document.getElementById('chat-composer');
    DOM.chatInput = document.getElementById('chat-input');
    DOM.chatSendBtn = document.getElementById('chat-send-btn');
    DOM.chatMicBtn = document.getElementById('chat-mic-btn');
    DOM.chatDrawBtn = document.getElementById('chat-draw-btn');
    DOM.chatPhotoBtn = document.getElementById('chat-photo-btn');
    DOM.chatPhotoCapture = document.getElementById('chat-photo-capture');
    DOM.chatPhotoPreview = document.getElementById('chat-photo-preview');
    DOM.photoInChat = document.getElementById('photo-in-chat');

    // Drawing Area / NotePad
    DOM.drawingCanvas = document.getElementById('drawing-canvas');
    DOM.btnCloseDrawing = document.getElementById('btn-close-drawing');
    DOM.btnToggleGrid = document.getElementById('btn-toggle-grid');
    DOM.btnClearCanvas = document.getElementById('btn-clear-canvas');
    DOM.btnDoneDrawing = document.getElementById('btn-done-drawing');
    DOM.mainEl = document.querySelector('main'); // Träger der note-active-Klasse
    DOM.taskChatWrapper = document.querySelector('.task-chat-wrapper');
    DOM.noteResizeHandle = document.getElementById('note-resize-handle');
    DOM.noteCanvasWrap = document.getElementById('note-canvas-wrap');
    DOM.toolPen = document.getElementById('tool-pen');
    DOM.toolEraser = document.getElementById('tool-eraser');
    DOM.noteSizes = Array.from(document.querySelectorAll('.note-size'));
    DOM.colorOptions = Array.from(document.querySelectorAll('#drawing-area .color-option'));
    DOM.btnNoteUndo = document.getElementById('btn-note-undo');
    DOM.btnNoteObjects = document.getElementById('btn-note-objects');
    DOM.noteObjectTray = document.getElementById('note-object-tray');
    DOM.sketchPreview = document.getElementById('chat-sketch-preview');
    DOM.sketchPreviewImg = document.getElementById('chat-sketch-preview-img');
    DOM.sketchPreviewRemove = document.getElementById('chat-sketch-preview-remove');
    DOM.noteObjectsSetting = document.getElementById('note-objects');

    // Integrierte Notizfläche
    DOM.inlineNoteSheet = document.getElementById('inline-note-sheet');
    DOM.inlineNoteResize = document.getElementById('inline-note-resize');
    DOM.inlineNoteScroll = document.getElementById('inline-note-scroll');
    DOM.inlineNoteCanvas = document.getElementById('inline-note-canvas');
    DOM.inlineNoteMore = document.getElementById('inline-note-more');
    DOM.inlineToolPen = document.getElementById('inline-tool-pen');
    DOM.inlineToolEraser = document.getElementById('inline-tool-eraser');
    DOM.inlineNoteColors = Array.from(document.querySelectorAll('.inline-note-color'));
    DOM.inlineNoteUndo = document.getElementById('inline-note-undo');
    DOM.inlineNoteClear = document.getElementById('inline-note-clear');
    DOM.inlineNoteCollapse = document.getElementById('inline-note-collapse');
    DOM.inlineNoteReopen = document.getElementById('inline-note-reopen');
    DOM.inlineNotesSetting = document.getElementById('inline-notes');
    DOM.inlineNoteRail = document.getElementById('inline-note-rail');
    DOM.inlineNoteThumb = document.getElementById('inline-note-thumb');

    // Generator Panel
    DOM.generatorPanel = document.getElementById('generator-panel');
    DOM.btnCloseGenerator = document.getElementById('btn-close-generator');
    DOM.generatorTopic = document.getElementById('generator-topic');
    DOM.generatorOperation = document.getElementById('generator-operation');
    DOM.generatorDifficulty = document.getElementById('generator-difficulty');
    DOM.generatorCaptainTask = document.getElementById('generator-captain-task');
    DOM.btnDoGenerate = document.getElementById('btn-do-generate');
    DOM.generateProgress = document.getElementById('generate-progress');
    DOM.generateStatus = document.getElementById('generate-status');

    // Reading Controls
    DOM.btnRead = document.getElementById('btn-read');
    DOM.btnStop = document.getElementById('btn-stop');
    DOM.btnHyphenate = document.getElementById('btn-hyphenate');
    DOM.btnWordImages = document.getElementById('btn-word-images');
    DOM.btnImageManager = document.getElementById('btn-image-manager');
    DOM.btnShare = document.getElementById('btn-share');
    DOM.fontSizeReading = document.getElementById('font-size-reading');
    DOM.fontSizeValueReading = document.getElementById('font-size-value-reading');

    // Wortbilder / ARASAAC Modals
    DOM.imageManagerModal = document.getElementById('image-manager-modal');
    DOM.btnCloseImageManager = document.getElementById('btn-close-image-manager');
    DOM.wordListContainer = document.getElementById('word-list-container');
    DOM.addWordInput = document.getElementById('add-word-input');
    DOM.btnAddWord = document.getElementById('btn-add-word');
    DOM.imageSearchModal = document.getElementById('image-search-modal');
    DOM.btnCloseImageSearch = document.getElementById('btn-close-image-search');
    DOM.imageSearchInput = document.getElementById('image-search-input');
    DOM.btnSearchImages = document.getElementById('btn-search-images');
    DOM.searchResultsGrid = document.getElementById('search-results-grid');
    DOM.searchResultsLoading = document.getElementById('search-results-loading');
    DOM.searchNoResults = document.getElementById('search-no-results');
    DOM.searchWordLabel = document.getElementById('search-word-label');
    DOM.arasaacAttribution = document.getElementById('arasaac-attribution');

    // Status
    DOM.statusBar = document.getElementById('status-bar');
    DOM.statusDot = document.getElementById('status-dot');
    DOM.statusText = document.getElementById('status-text');
    DOM.wordCount = document.getElementById('word-count');

    // Erster Web-Start: Datenschutzhinweis und Alterswahl
    DOM.webConsentModal = document.getElementById('web-consent-modal');
    DOM.webConsentAgeOptions = document.getElementById('web-consent-age-options');
    DOM.webConsentAgeValue = document.getElementById('web-consent-age-value');
    DOM.btnWebConsentBasic = document.getElementById('btn-web-consent-basic');

    // Settings Modal
    DOM.settingsModal = document.getElementById('settings-modal');
    DOM.btnSettings = document.getElementById('btn-settings');
    DOM.btnHelp = document.getElementById('btn-help');
    DOM.btnCloseSettings = document.getElementById('btn-close-settings');
    DOM.btnSaveSettings = document.getElementById('btn-save-settings');
    DOM.btnSaveSettingsTop = document.getElementById('btn-save-settings-top');
    DOM.btnResetSettings = document.getElementById('btn-reset-settings');
    DOM.ageSlider = document.getElementById('age-slider');
    DOM.ageValue = document.getElementById('age-value');
    DOM.modelSelect = document.getElementById('model-select');
    DOM.voiceSelect = document.getElementById('voice-select');
    DOM.readingSpeedSettings = document.getElementById('reading-speed-settings');
    DOM.readingSpeedValueSettings = document.getElementById('reading-speed-value-settings');
    DOM.visualizeSpeedSettings = document.getElementById('visualize-speed-settings');
    DOM.visualizeSpeedValueSettings = document.getElementById('visualize-speed-value-settings');
    DOM.showWordCount = document.getElementById('show-word-count');
    DOM.renderGraphics = document.getElementById('render-graphics');
    DOM.explanationImages = document.getElementById('explanation-images');
    DOM.btnLanguage = document.getElementById('btn-language');
    DOM.languageButtonToggle = document.getElementById('language-button-toggle');
    DOM.languageButtonWrap = document.getElementById('language-button-wrap');
    DOM.languageList = document.getElementById('language-list');
    DOM.languageAddInput = document.getElementById('language-add-input');
    DOM.btnAddLanguage = document.getElementById('btn-add-language');
    DOM.hideCaptainTask = document.getElementById('hide-captain-task');
    DOM.captainTaskOption = document.getElementById('captain-task-option');
    DOM.fermiTaskOption = document.getElementById('fermi-task-option');
    DOM.generatorFermiTask = document.getElementById('generator-fermi-task');
    DOM.assumptionsStrategyBtn = document.getElementById('assumptions-strategy-btn');
    DOM.googleApiKey = document.getElementById('google-api-key');
    DOM.apiKey = document.getElementById('api-key');
    DOM.openrouterWorkerUrl = document.getElementById('openrouter-worker-url');
    DOM.hetznerWorkerUrl = document.getElementById('hetzner-worker-url');
    DOM.hetznerModel = document.getElementById('hetzner-model');

    // Dauerhinweis: kostenlose Test-KI
    DOM.freeAiNotice = document.getElementById('free-ai-notice');
    DOM.freeAiNoticeSettings = document.getElementById('free-ai-notice-settings');

    // Share Modal
    DOM.shareModal = document.getElementById('share-modal');
    DOM.btnCloseShare = document.getElementById('btn-close-share');
    DOM.shareQrCode = document.getElementById('share-qr-code');
    DOM.shareLinkInput = document.getElementById('share-link-input');
    DOM.btnCopyLink = document.getElementById('btn-copy-link');
    DOM.copyFeedback = document.getElementById('copy-feedback');
    DOM.btnDownloadQr = document.getElementById('btn-download-qr');
    DOM.shareIncludeApiKey = document.getElementById('share-include-api-key');
    DOM.shareIncludeSettings = document.getElementById('share-include-settings');
    DOM.shareApiKeyOption = document.getElementById('share-api-key-option');

    // Grafik-Container
    DOM.graphicContainer = document.getElementById('graphic-container');

    // Wrong Solution Container (Fehler-Detektiv)
    DOM.wrongSolutionContainer = document.getElementById('wrong-solution-container');
    DOM.wrongSolutionContent = document.getElementById('wrong-solution-content');
    DOM.btnRevealCorrect = document.getElementById('btn-reveal-correct');
    DOM.btnReadWrongSolution = document.getElementById('btn-read-wrong-solution');

    // Notizbuch Container
    DOM.notebookContainer = document.getElementById('notebook-container');
    DOM.notebookContent = document.getElementById('notebook-content');
    DOM.btnReadNotebook = document.getElementById('btn-read-notebook');
    DOM.showNotebook = document.getElementById('show-notebook');
    DOM.microAssessmentEnabled = document.getElementById('micro-assessment-enabled');

    // Mikro-Assessment Modal
    DOM.microAssessmentModal = document.getElementById('micro-assessment-modal');
    DOM.maItemText = document.getElementById('ma-item-text');
    DOM.maAnswerInput = document.getElementById('ma-answer-input');
    DOM.maCheckBtn = document.getElementById('ma-check-btn');
    DOM.maSkipBtn = document.getElementById('ma-skip-btn');
    DOM.maFeedback = document.getElementById('ma-feedback');
    DOM.maCloseBtn = document.getElementById('ma-close-btn');

    // Collection
    DOM.btnAddCollection = document.getElementById('btn-add-collection');
    DOM.btnOpenCollection = document.getElementById('btn-open-collection');
    DOM.collectionModal = document.getElementById('collection-modal');
    DOM.btnCloseCollection = document.getElementById('btn-close-collection');
    DOM.exampleTasksList = document.getElementById('example-tasks-list');
    DOM.userTasksList = document.getElementById('user-tasks-list');
    DOM.userTasksEmpty = document.getElementById('user-tasks-empty');
    DOM.filterTags = document.querySelectorAll('.filter-tag');
    DOM.collectionSearchInput = document.getElementById('collection-search-input');
    DOM.btnClearSearch = document.getElementById('btn-clear-search');

    // Import/Export
    DOM.btnImportTasks = document.getElementById('btn-import-tasks');
    DOM.btnExportTasks = document.getElementById('btn-export-tasks');
    DOM.importTasksInput = document.getElementById('import-tasks-input');

    // Confirm Load Modal
    DOM.confirmLoadModal = document.getElementById('confirm-load-modal');
    DOM.btnCloseConfirmLoad = document.getElementById('btn-close-confirm-load');
    DOM.confirmLoadPreview = document.getElementById('confirm-load-preview');
    DOM.btnCancelLoad = document.getElementById('btn-cancel-load');
    DOM.btnConfirmLoad = document.getElementById('btn-confirm-load');

    // Certificates Modal
    DOM.btnOpenCertificates = document.getElementById('btn-open-certificates');
    DOM.certificatesModal = document.getElementById('certificates-modal');
    DOM.btnCloseCertificates = document.getElementById('btn-close-certificates');
    DOM.certificatesList = document.getElementById('certificates-list');
    DOM.btnExportCertificatesPdf = document.getElementById('btn-export-certificates-pdf');
    DOM.certificateCountBadge = document.getElementById('certificate-count-badge');
    DOM.clearCertificatesAfterExport = document.getElementById('clear-certificates-after-export');
    DOM.certificateDetailModal = document.getElementById('certificate-detail-modal');
    DOM.certificateDetailTitle = document.getElementById('certificate-detail-title');
    DOM.certificateDetailBody = document.getElementById('certificate-detail-body');
    DOM.btnCloseCertificateDetail = document.getElementById('btn-close-certificate-detail');

    // Celebration Modal
    DOM.celebrationModal = document.getElementById('celebration-modal');
    DOM.celebrationIcon = document.getElementById('celebration-icon');
    DOM.celebrationKompetenz = document.getElementById('celebration-kompetenz');
    DOM.celebrationFeedback = document.getElementById('celebration-feedback');
    DOM.btnCelebrationCertificate = document.getElementById('btn-celebration-certificate');
    DOM.btnCelebrationContinue = document.getElementById('btn-celebration-continue');

    // Onboarding Modal
    DOM.onboardingModal = document.getElementById('onboarding-modal');
    DOM.onboardingSlides = document.querySelectorAll('.onboarding-slide');
    DOM.onboardingDots = document.querySelectorAll('.onboarding-dot');
    DOM.btnOnboardingSkip = document.getElementById('btn-onboarding-skip');
    DOM.btnOnboardingNext = document.getElementById('btn-onboarding-next');
}

function initReader() {
    reader = new ReaderTextView('#reader-container', {
        mode: 'edit',
        fontSize: 24,
        language: 'de-DE',
        placeholder: 'Gib hier eine Sachsituation ein oder mach ein Foto der Textaufgabe...',
        editable: true,
        hyphenationPatternUrl: 'hyph-de-1996.pat.txt'
    });

    // Primaeraktion in der Textkarte verankern. ReaderTextView hat seine eigenen
    // Ebenen jetzt aufgebaut, daher bleibt der Button als letztes Element darueber.
    const goBar = document.getElementById('go-explore-bar');
    if (goBar) DOM.readerContainer.appendChild(goBar);

    // ReaderTextView verwendet CustomEvents mit Prefix 'readertextview:'
    document.addEventListener('readertextview:input', () => {
        updateWordCount();
        taskText = reader.getText();
        // Text mit Grafik-Tags aktualisieren (für Sammlung-Speichern)
        taskTextWithGraphics = reader.getTextWithTags();
        // Text wurde geaendert - Pruefung zuruecksetzen
        lastCheckedTaskText = null;
        updateUI();
        updateCollectionButtonVisibility();
        updateInputStateUI();
    });
}

function closeChatToolsPopover() {
    if (!DOM.chatInputTools || !DOM.chatToolsToggle) return;
    DOM.chatInputTools.classList.remove('is-open');
    DOM.chatToolsToggle.setAttribute('aria-expanded', 'false');
}

function scheduleChatToolsOverflowUpdate() {
    if (chatToolsMeasureFrame !== null) cancelAnimationFrame(chatToolsMeasureFrame);
    chatToolsMeasureFrame = requestAnimationFrame(() => {
        chatToolsMeasureFrame = null;
        updateChatToolsOverflow();
    });
}

function updateChatToolsOverflow() {
    if (!DOM.chatInputArea || !DOM.chatInputTools || !window.ChatInputOverflow) return;

    const availableWidth = DOM.chatInputArea.clientWidth;
    if (!availableWidth) {
        DOM.chatInputTools.classList.remove('is-collapsed');
        closeChatToolsPopover();
        return;
    }

    const toolButtons = [
        DOM.chatDrawBtn,
        DOM.chatPhotoBtn,
        document.getElementById('chat-visualize-btn')
    ];
    const toolCount = toolButtons.filter(button => button && button.style.display !== 'none').length;
    const previewVisible = DOM.sketchPreview && DOM.sketchPreview.style.display !== 'none';
    const previewWidth = previewVisible ? (DOM.sketchPreview.offsetWidth || 60) : 0;
    const compactControls = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
    const buttonSize = compactControls ? 44 : 48;
    // Standard-Werkzeuge duerfen das Eingabefeld etwas kompakter machen. Erst eine zusaetzliche
    // Vorschau reserviert mehr Lesebreite und loest das Plus-Menue entsprechend frueher aus.
    const minimumInputWidth = previewVisible
        ? (availableWidth <= 420 ? 150 : 180)
        : (availableWidth <= 420 ? 120 : 140);
    const areaStyle = window.getComputedStyle(DOM.chatInputArea);
    const gap = parseFloat(areaStyle.columnGap || areaStyle.gap) || 8;
    const horizontalPadding = (parseFloat(areaStyle.paddingLeft) || 0)
        + (parseFloat(areaStyle.paddingRight) || 0);
    const shouldCollapse = window.ChatInputOverflow.shouldCollapseChatTools({
        availableWidth,
        toolCount,
        buttonSize,
        gap,
        horizontalPadding,
        sendWidth: DOM.chatSendBtn.offsetWidth || buttonSize,
        minimumInputWidth,
        previewWidth,
        fixedControlsWidth: DOM.chatMicBtn.offsetWidth || buttonSize,
        fixedControlCount: 0
    });

    DOM.chatInputTools.classList.toggle('is-collapsed', shouldCollapse);
    if (!shouldCollapse) closeChatToolsPopover();
}

function initChatInputToolsOverflow() {
    if (!DOM.chatInputTools || !DOM.chatToolsToggle || !DOM.chatInputToolsList) return;

    DOM.chatToolsToggle.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!DOM.chatInputTools.classList.contains('is-collapsed')) return;
        const isOpen = DOM.chatInputTools.classList.toggle('is-open');
        DOM.chatToolsToggle.setAttribute('aria-expanded', String(isOpen));
    });

    DOM.chatInputToolsList.addEventListener('click', (event) => {
        const toolButton = event.target.closest('.chat-icon-btn');
        if (toolButton && toolButton !== DOM.chatMicBtn) closeChatToolsPopover();
    });

    document.addEventListener('click', (event) => {
        if (!DOM.chatInputTools.contains(event.target)) closeChatToolsPopover();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !DOM.chatInputTools.classList.contains('is-open')) return;
        closeChatToolsPopover();
        DOM.chatToolsToggle.focus();
    });

    if (typeof ResizeObserver !== 'undefined') {
        const resizeObserver = new ResizeObserver(scheduleChatToolsOverflowUpdate);
        resizeObserver.observe(DOM.chatInputArea);
    } else {
        window.addEventListener('resize', scheduleChatToolsOverflowUpdate);
    }

    if (typeof MutationObserver !== 'undefined') {
        const mutationObserver = new MutationObserver(scheduleChatToolsOverflowUpdate);
        [DOM.chatInputArea, DOM.chatDrawBtn, DOM.chatPhotoBtn,
            document.getElementById('chat-visualize-btn'), DOM.sketchPreview]
            .filter(Boolean)
            .forEach(element => mutationObserver.observe(element, {
                attributes: true,
                attributeFilter: ['style']
            }));
    }

    scheduleChatToolsOverflowUpdate();
}

function initEventListeners() {
    // Erster Web-Start: Alter waehlen und dem Datenschutzhinweis zustimmen.
    if (DOM.webConsentAgeOptions) {
        DOM.webConsentAgeOptions.addEventListener('click', (event) => {
            const button = event.target.closest('.web-consent-age');
            if (button) selectWebConsentAge(button.dataset.age);
        });
        DOM.webConsentAgeOptions.addEventListener('keydown', handleWebConsentAgeKeydown);
    }
    if (DOM.btnWebConsentBasic) {
        DOM.btnWebConsentBasic.addEventListener('click', () => completeWebPrivacyConsent());
    }
    if (DOM.webConsentModal) {
        DOM.webConsentModal.addEventListener('keydown', trapWebConsentFocus);
    }

    // Eingabe-Wege: Buttons fuer Aufgaben-Erstellung
    DOM.btnGenerate.addEventListener('click', () => openGeneratorPanel());
    DOM.btnDialogDevelop.addEventListener('click', () => startDialogDevelopment());
    if (DOM.btnUndoTask) {
        DOM.btnUndoTask.addEventListener('click', undoGeneratedTask);
    }

    // „Los geht's!" — einziger Einstieg ins Erkunden
    const btnGoExplore = document.getElementById('btn-go-explore');
    if (btnGoExplore) {
        // Arrow-Wrapper: Matheforscher-Hooks ersetzen die Funktions-Bindings zur Laufzeit
        btnGoExplore.addEventListener('click', () => switchToExploreMode());
    }

    // Photo
    DOM.btnPhoto.addEventListener('click', togglePhotoDropdown);
    DOM.btnPhotoGallery.addEventListener('click', () => {
        DOM.photoUpload.click();
        hidePhotoDropdown();
    });
    DOM.btnPhotoCamera.addEventListener('click', () => {
        DOM.cameraCapture.click();
        hidePhotoDropdown();
    });
    DOM.photoUpload.addEventListener('change', handlePhotoUpload);
    DOM.cameraCapture.addEventListener('change', handlePhotoUpload);
    if (DOM.chatPhotoBtn) {
        DOM.chatPhotoBtn.addEventListener('click', () => DOM.chatPhotoCapture.click());
    }
    if (DOM.chatPhotoCapture) {
        DOM.chatPhotoCapture.addEventListener('change', handleChatPhotoCapture);
    }
    DOM.btnRemoveTaskImage.addEventListener('click', removeTaskImage);

    // Click outside to close dropdown
    document.addEventListener('click', (e) => {
        if (!DOM.btnPhoto.contains(e.target) && !DOM.photoDropdown.contains(e.target)) {
            hidePhotoDropdown();
        }
    });

    // Strategy List Buttons (im Chat-Bereich)
    DOM.strategyListBtns.forEach(btn => {
        btn.addEventListener('click', () => selectStrategy(btn.dataset.mode));
    });

    // Chat
    DOM.btnBackToStrategies.addEventListener('click', backToStrategies);
    DOM.btnToggleSound.addEventListener('click', toggleSound);
    DOM.chatSendBtn.addEventListener('click', handleChatSend);
    DOM.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleChatSend();
    });
    DOM.chatMicBtn.addEventListener('click', handleMicToggle);
    initChatInputToolsOverflow();

    // Drawing / NotePad
    DOM.chatDrawBtn.addEventListener('click', () => {
        if (isNoteActive()) { closeNoteStage(); } else { openDrawingArea(); }
    });
    DOM.btnCloseDrawing.addEventListener('click', closeNoteStage);

    // Fehler-Detektiv: Richtige Loesung anzeigen und Vorlesen
    if (DOM.btnRevealCorrect) {
        DOM.btnRevealCorrect.addEventListener('click', revealCorrectSolution);
    }
    if (DOM.btnReadWrongSolution) {
        DOM.btnReadWrongSolution.addEventListener('click', readWrongSolution);
    }
    if (DOM.btnReadNotebook) {
        DOM.btnReadNotebook.addEventListener('click', readNotebook);
    }
    DOM.btnDoneDrawing.addEventListener('click', finishDrawing);
    // NotePad-Werkzeugleiste verdrahten
    wireNoteToolbar();
    initNoteResize();
    // Integrierte Notizfläche verdrahten
    wireInlineNoteSheet();

    // Generator
    DOM.btnDoGenerate.addEventListener('click', handleGenerateTask);
    DOM.btnCloseGenerator.addEventListener('click', closeGeneratorPanel);
    // Vom Nutzer geänderte Generator-Auswahl merken (überdauert Neustarts)
    if (DOM.generatorDifficulty) {
        DOM.generatorDifficulty.addEventListener('change', () => {
            storeGeneratorSettings();
            updateGeneratorMixedLabel();
        });
    }
    if (DOM.generatorOperation) {
        DOM.generatorOperation.addEventListener('change', storeGeneratorSettings);
    }

    // Fermi und Kapitaen-Checkboxen: Gegenseitig ausschliessen
    if (DOM.generatorFermiTask) {
        DOM.generatorFermiTask.addEventListener('change', () => {
            if (DOM.generatorFermiTask.checked && DOM.generatorCaptainTask) {
                DOM.generatorCaptainTask.checked = false;
            }
        });
    }
    if (DOM.generatorCaptainTask) {
        DOM.generatorCaptainTask.addEventListener('change', () => {
            if (DOM.generatorCaptainTask.checked && DOM.generatorFermiTask) {
                DOM.generatorFermiTask.checked = false;
            }
        });
    }

    // Reading Controls
    DOM.btnRead.addEventListener('click', () => {
        if (reader.isReading && !reader.isPaused) {
            reader.pauseReading();
        } else if (reader.isPaused) {
            reader.resumeReading();
        } else {
            reader.readText();
        }
    });
    DOM.btnStop.addEventListener('click', () => reader.stopReading());
    DOM.btnHyphenate.addEventListener('click', toggleHyphenation);
    DOM.btnWordImages.addEventListener('click', handleWordImagesToggle);
    DOM.btnImageManager.addEventListener('click', openImageManager);
    DOM.btnShare.addEventListener('click', openShareModal);
    DOM.fontSizeReading.addEventListener('input', handleFontSizeChangeReading);

    // Stift an der Karten-Ecke: zurueck in den Eingabe-Modus
    const btnEditTask = document.getElementById('btn-edit-task');
    // Arrow-Wrapper: Matheforscher-Hooks ersetzen die Funktions-Bindings zur Laufzeit
    if (btnEditTask) btnEditTask.addEventListener('click', () => switchToInputMode());
    // ⋯-Werkzeug: Darstellungs-Popover oeffnen/schliessen
    const optionsBtn = document.getElementById('btn-task-options');
    const optionsPop = document.getElementById('task-options-popover');
    if (optionsBtn && optionsPop) {
        optionsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = optionsPop.classList.toggle('open');
            optionsBtn.setAttribute('aria-expanded', String(open));
        });
        // Klick ausserhalb schliesst das Popover. Toggle-Buttons (Silben/Wortbilder)
        // liegen im Popover und schliessen es bewusst NICHT (Kind sieht die Wirkung sofort).
        document.addEventListener('click', (e) => {
            if (optionsPop.classList.contains('open')
                && !optionsPop.contains(e.target) && e.target !== optionsBtn) {
                optionsPop.classList.remove('open');
                optionsBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // Reader Events
    document.addEventListener('readertextview:readingstart', () => {
        DOM.btnRead.querySelector('.toolbar-btn-label').textContent = 'Pause';
        DOM.btnStop.style.display = '';
        setStatus('Liest vor...', 'reading');
    });
    document.addEventListener('readertextview:readingpause', () => {
        DOM.btnRead.querySelector('.toolbar-btn-label').textContent = 'Vorlesen';
        setStatus('Pausiert', 'ready');
    });
    document.addEventListener('readertextview:readingresume', () => {
        DOM.btnRead.querySelector('.toolbar-btn-label').textContent = 'Pause';
        setStatus('Liest vor...', 'reading');
    });
    document.addEventListener('readertextview:readingstop', () => {
        DOM.btnRead.querySelector('.toolbar-btn-label').textContent = 'Vorlesen';
        DOM.btnStop.style.display = 'none';
        setStatus('Bereit', 'ready');
    });
    document.addEventListener('readertextview:readingend', () => {
        DOM.btnRead.querySelector('.toolbar-btn-label').textContent = 'Vorlesen';
        DOM.btnStop.style.display = 'none';
        setStatus('Bereit', 'ready');
    });

    // Wortbilder Events
    document.addEventListener('readertextview:wordimagesloadstart', () => {
        DOM.btnWordImages.disabled = true;
        DOM.btnWordImages.innerHTML = `
            <div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></div>
            <span class="toolbar-btn-label">Lade...</span>
        `;
    });
    document.addEventListener('readertextview:wordimagesloadend', () => {
        DOM.btnWordImages.disabled = false;
        DOM.btnWordImages.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span class="toolbar-btn-label">Bilder</span>
        `;
    });
    document.addEventListener('readertextview:wordimageschange', (e) => {
        isWordImagesActive = e.detail.enabled;
        updateWordImagesUI();
    });

    // Image Manager Modal Events
    DOM.btnCloseImageManager.addEventListener('click', closeImageManager);
    DOM.imageManagerModal.addEventListener('click', (e) => {
        if (e.target === DOM.imageManagerModal) closeImageManager();
    });
    DOM.btnAddWord.addEventListener('click', addWordAndSearch);
    DOM.addWordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addWordAndSearch(); }
    });

    // Image Search Modal Events
    DOM.btnCloseImageSearch.addEventListener('click', closeImageSearch);
    DOM.btnSearchImages.addEventListener('click', performImageSearch);
    DOM.imageSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); performImageSearch(); }
    });
    DOM.imageSearchModal.addEventListener('click', (e) => {
        if (e.target === DOM.imageSearchModal) closeImageSearch();
    });

    // Long-Press Worterklärung (im Lesemodus)
    document.addEventListener('readertextview:wordexplanation', async (e) => {
        // Nur im Erkunden-Modus (Reader ist im Lesemodus)
        if (creationMode !== 'explore') return;

        const { word, wordInfo } = e.detail;
        if (!word || !taskText) return;

        // Cache pro Aufgabe: bei neuem Aufgabentext leeren
        if (wordExplanationCacheText !== taskText) {
            wordExplanationCache.clear();
            wordExplanationCacheText = taskText;
        }
        const cacheKey = word.replace(/­/g, '').toLowerCase();
        const cached = wordExplanationCache.get(cacheKey);
        if (cached) {
            // Live-Einstellung berücksichtigen, falls der Toggle nach dem Cachen geändert wurde
            const cachedVisual = explanationImagesEnabled ? cached.visual : null;
            reader._showExplanationPopup(wordInfo, cached.explanation, cachedVisual, cached.translation || null);
            return;
        }

        try {
            setStatus('Erkläre Wort...', 'processing');
            const result = await RechengeschichtenAPI.getWordExplanation(
                word, taskText, { withVisual: explanationImagesEnabled }
            );

            // Visual auflösen: ARASAAC zuerst (kontext-eindeutige Begriffe), sonst Emoji
            let visual = null;
            if (explanationImagesEnabled && result.depictable && result.imageQuery.length) {
                let arasaacUrl = null;
                for (const term of result.imageQuery) {
                    arasaacUrl = await RechengeschichtenAPI.getArasaacImageUrl(term);
                    if (arasaacUrl) break;
                }
                visual = resolveWordVisual(result, arasaacUrl);
            }

            // Übersetzung in der ausgewaehlten Sprache aufbereiten (falls vorhanden)
            const langEntry = getActiveLanguageEntry();
            let translation = null;
            if (langEntry && result.translation) {
                translation = {
                    text: result.translation,
                    label: langEntry.flag || '🌐',
                    lang: langEntry.bcp47 || null,
                    speakable: isLanguageSpeakable(langEntry.bcp47)
                };
            }

            wordExplanationCache.set(cacheKey, { explanation: result.explanation, visual, translation });
            reader._showExplanationPopup(wordInfo, result.explanation, visual, translation);
            setStatus('Bereit', 'ready');
        } catch (error) {
            console.error('Word explanation error:', error);
            reader._showExplanationPopup(wordInfo, 'Das Wort konnte leider nicht erklärt werden.');
            setStatus('Bereit', 'ready');
        }
    });

    // Header-Menü (⋯)
    const headerMenuBtn = document.getElementById('btn-header-menu');
    const headerMenu = document.getElementById('header-menu');
    if (headerMenuBtn && headerMenu) {
        const closeHeaderMenu = () => {
            headerMenu.classList.remove('open');
            headerMenuBtn.setAttribute('aria-expanded', 'false');
        };
        headerMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = headerMenu.classList.toggle('open');
            headerMenuBtn.setAttribute('aria-expanded', String(open));
        });
        document.addEventListener('click', (e) => {
            if (headerMenu.classList.contains('open') && !headerMenu.contains(e.target)) closeHeaderMenu();
        });
        headerMenu.querySelectorAll('.header-menu-item').forEach(item =>
            item.addEventListener('click', closeHeaderMenu));
    }

    // Settings
    DOM.btnSettings.addEventListener('click', openSettingsModal);
    if (DOM.freeAiNoticeSettings) {
        DOM.freeAiNoticeSettings.addEventListener('click', openSettingsModal);
    }
    if (DOM.btnHelp) {
        DOM.btnHelp.addEventListener('click', showOnboardingManually);
    }
    DOM.btnCloseSettings.addEventListener('click', closeSettingsModal);
    DOM.btnSaveSettings.addEventListener('click', saveSettings);
    DOM.btnSaveSettingsTop.addEventListener('click', saveSettings);
    DOM.btnResetSettings.addEventListener('click', resetSettings);
    DOM.ageSlider.addEventListener('input', updateAgeValue);
    DOM.readingSpeedSettings.addEventListener('input', updateReadingSpeedValue);
    if (DOM.visualizeSpeedSettings) DOM.visualizeSpeedSettings.addEventListener('input', applyVisualizeSpeedFromSettings);
    if (DOM.btnAddLanguage) {
        DOM.btnAddLanguage.addEventListener('click', addLanguageFromInput);
    }
    if (DOM.languageAddInput) {
        DOM.languageAddInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addLanguageFromInput(); }
        });
    }
    if (DOM.languageList) {
        DOM.languageList.addEventListener('click', handleLanguageListClick);
    }
    if (DOM.btnLanguage) {
        DOM.btnLanguage.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLanguageDropdown();
        });
    }

    // Vorlesen einer Übersetzung in der ausgewaehlten Sprache (aus dem Erklaerungs-Popup)
    document.addEventListener('readertextview:speaktranslation', (e) => {
        const detail = e.detail || {};
        if (!detail.text) return;
        speakText(detail.text, { lang: detail.lang || undefined });
    });

    // Share Modal
    DOM.btnCloseShare.addEventListener('click', closeShareModal);
    DOM.btnCopyLink.addEventListener('click', copyShareLink);
    DOM.btnDownloadQr.addEventListener('click', downloadQrCode);
    if (DOM.shareIncludeApiKey) {
        DOM.shareIncludeApiKey.addEventListener('change', updateShareUrl);
    }
    if (DOM.shareIncludeSettings) {
        DOM.shareIncludeSettings.addEventListener('change', updateShareUrl);
    }

    // Close modals on overlay click
    DOM.settingsModal.addEventListener('click', (e) => {
        if (e.target === DOM.settingsModal) closeSettingsModal();
    });
    DOM.shareModal.addEventListener('click', (e) => {
        if (e.target === DOM.shareModal) closeShareModal();
    });

    // Mikro-Assessment Modal
    if (DOM.maCheckBtn) DOM.maCheckBtn.addEventListener('click', handleMicroAssessmentCheck);
    if (DOM.maSkipBtn) DOM.maSkipBtn.addEventListener('click', closeMicroAssessmentModal);
    if (DOM.maCloseBtn) DOM.maCloseBtn.addEventListener('click', closeMicroAssessmentModal);
    if (DOM.microAssessmentModal) {
        DOM.microAssessmentModal.addEventListener('click', (e) => {
            if (e.target === DOM.microAssessmentModal) closeMicroAssessmentModal();
        });
    }

    // Collection
    if (DOM.btnAddCollection) {
        DOM.btnAddCollection.addEventListener('click', addToCollection);
    }
    if (DOM.btnOpenCollection) {
        DOM.btnOpenCollection.addEventListener('click', openCollectionModal);
    }
    if (DOM.btnCloseCollection) {
        DOM.btnCloseCollection.addEventListener('click', closeCollectionModal);
    }
    if (DOM.collectionModal) {
        DOM.collectionModal.addEventListener('click', (e) => {
            if (e.target === DOM.collectionModal) closeCollectionModal();
        });
    }

    // Import/Export
    if (DOM.btnImportTasks) {
        DOM.btnImportTasks.addEventListener('click', () => DOM.importTasksInput.click());
    }
    if (DOM.btnExportTasks) {
        DOM.btnExportTasks.addEventListener('click', exportUserTasks);
    }
    if (DOM.importTasksInput) {
        DOM.importTasksInput.addEventListener('change', handleTasksImport);
    }

    // Collection Filter Tags
    DOM.filterTags.forEach(tag => {
        tag.addEventListener('click', () => {
            toggleCollectionFilter(tag.dataset.filterType, tag.dataset.filterValue);
        });
    });

    // Collection Search
    if (DOM.collectionSearchInput) {
        DOM.collectionSearchInput.addEventListener('input', handleCollectionSearch);
    }
    if (DOM.btnClearSearch) {
        DOM.btnClearSearch.addEventListener('click', clearCollectionSearch);
    }

    // Confirm Load Modal
    if (DOM.btnCloseConfirmLoad) {
        DOM.btnCloseConfirmLoad.addEventListener('click', () => {
            DOM.confirmLoadModal.classList.remove('visible');
            pendingLoadStory = null;
        });
    }
    if (DOM.btnCancelLoad) {
        DOM.btnCancelLoad.addEventListener('click', () => {
            DOM.confirmLoadModal.classList.remove('visible');
            pendingLoadStory = null;
        });
    }
    if (DOM.btnConfirmLoad) {
        DOM.btnConfirmLoad.addEventListener('click', () => {
            DOM.confirmLoadModal.classList.remove('visible');
            if (pendingLoadStory) {
                loadFromCollection(pendingLoadStory);
                pendingLoadStory = null;
            }
        });
    }
    if (DOM.confirmLoadModal) {
        DOM.confirmLoadModal.addEventListener('click', (e) => {
            if (e.target === DOM.confirmLoadModal) {
                DOM.confirmLoadModal.classList.remove('visible');
                pendingLoadStory = null;
            }
        });
    }

    // Certificates Modal
    if (DOM.btnOpenCertificates) {
        DOM.btnOpenCertificates.addEventListener('click', openCertificatesModal);
    }
    // Urkunden-Trophäe im Header (nur sichtbar, wenn Urkunden existieren)
    const headerCertBtn = document.getElementById('btn-header-certificates');
    if (headerCertBtn) {
        headerCertBtn.addEventListener('click', openCertificatesModal);
    }
    if (DOM.btnCloseCertificates) {
        DOM.btnCloseCertificates.addEventListener('click', closeCertificatesModal);
    }
    if (DOM.certificatesModal) {
        DOM.certificatesModal.addEventListener('click', (e) => {
            if (e.target === DOM.certificatesModal) closeCertificatesModal();
        });
    }
    if (DOM.btnExportCertificatesPdf) {
        DOM.btnExportCertificatesPdf.addEventListener('click', exportCertificatesAsPdf);
    }
    if (DOM.btnCloseCertificateDetail) {
        DOM.btnCloseCertificateDetail.addEventListener('click', closeCertificateDetail);
    }
    if (DOM.certificateDetailModal) {
        DOM.certificateDetailModal.addEventListener('click', (e) => {
            if (e.target === DOM.certificateDetailModal) closeCertificateDetail();
        });
    }
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (DOM.certificateDetailModal?.classList.contains('visible')) {
            closeCertificateDetail();
        }
    });

    // Celebration Modal
    if (DOM.btnCelebrationCertificate) {
        DOM.btnCelebrationCertificate.addEventListener('click', () => {
            closeCelebrationModal({ deferMicroAssessment: true });
            openCertificatesModal();
        });
    }
    if (DOM.btnCelebrationContinue) {
        DOM.btnCelebrationContinue.addEventListener('click', closeCelebrationModal);
    }
    if (DOM.celebrationModal) {
        DOM.celebrationModal.addEventListener('click', (e) => {
            if (e.target === DOM.celebrationModal) closeCelebrationModal();
        });
    }

    // Onboarding Modal
    if (DOM.btnOnboardingSkip) {
        DOM.btnOnboardingSkip.addEventListener('click', closeOnboarding);
    }
    if (DOM.btnOnboardingNext) {
        DOM.btnOnboardingNext.addEventListener('click', nextOnboardingSlide);
    }
    if (DOM.onboardingDots) {
        DOM.onboardingDots.forEach(dot => {
            dot.addEventListener('click', () => {
                goToOnboardingSlide(parseInt(dot.dataset.slide));
            });
        });
    }
    if (DOM.onboardingModal) {
        DOM.onboardingModal.addEventListener('click', (e) => {
            if (e.target === DOM.onboardingModal) closeOnboarding();
        });
    }
}

// ===== TAB MANAGEMENT =====

// ===== Moduslose Zustands-UI: Leer / Bereit (Erkunden regeln switchTo*-Funktionen) =====
function getLayoutTransitionElements(extraElements = []) {
    const ways = document.getElementById('input-ways');
    return [
        // Nur sichtbare Blatt-Surfaces animieren. Gleichzeitige FLIP-Transforms
        // auf Eltern und Kindern wuerden sich sonst gegenseitig verdoppeln.
        DOM.readerContainer,
        DOM.chatContainer,
        DOM.generatorPanel,
        document.getElementById('task-tools'),
        document.getElementById('btn-edit-task'),
        ...Array.from(ways?.children || []),
        ...extraElements
    ].filter(Boolean);
}

function animateAppLayout(mutate, extraElements = []) {
    if (window.LayoutTransitions?.animateLayoutChange) {
        return window.LayoutTransitions.animateLayoutChange(
            getLayoutTransitionElements(extraElements),
            mutate
        );
    }
    return mutate();
}

function updateInputStateUI() {
    if (creationMode === 'explore') return;
    const ways = document.getElementById('input-ways');
    const goBtn = document.getElementById('btn-go-explore');
    const goBar = document.getElementById('go-explore-bar');
    if (!ways || !goBtn || !goBar) return;
    const hasText = reader.getText().trim().length > 0;
    const saveBtn = document.getElementById('btn-add-collection');
    const compactStateChanged = ways.classList.contains('compact') !== hasText;
    const applyState = () => {
        ways.classList.toggle('compact', hasText);
        goBtn.disabled = !hasText;
        goBar.classList.toggle('is-ready', hasText);
        DOM.readerContainer.classList.toggle('has-go-action', hasText);
        if (saveBtn) saveBtn.style.display = hasText ? '' : 'none';
    };

    if (compactStateChanged) {
        animateAppLayout(applyState, [saveBtn]);
    } else {
        applyState();
    }
}

// Blendet die Eingeben-Zonen (Wege + Go-Bar) bzw. die Erkunden-Werkzeuge an der Karte um
function applyInputZonesVisibility(inputVisible) {
    const ways = document.getElementById('input-ways');
    const goBar = document.getElementById('go-explore-bar');
    const editBtn = document.getElementById('btn-edit-task');
    const taskTools = document.getElementById('task-tools');
    if (ways) ways.style.display = inputVisible ? '' : 'none';
    if (goBar) goBar.style.display = inputVisible ? '' : 'none';
    if (!inputVisible) {
        if (goBar) goBar.classList.remove('is-ready');
        DOM.readerContainer.classList.remove('has-go-action');
    }
    if (editBtn) editBtn.style.display = inputVisible ? 'none' : 'flex';
    if (taskTools) taskTools.style.display = inputVisible ? 'none' : 'flex';
}

function setInputZonesVisible(inputVisible, animate = true) {
    const ways = document.getElementById('input-ways');
    const currentlyVisible = !!ways && ways.style.display !== 'none';
    const mutate = () => applyInputZonesVisibility(inputVisible);

    if (animate && currentlyVisible !== inputVisible) {
        animateAppLayout(mutate);
    } else {
        mutate();
    }
}

function showChatContainerInSide() {
    const alreadyVisible = DOM.chatContainer.parentNode === DOM.chatSide
        && DOM.chatContainer.classList.contains('visible');
    if (alreadyVisible) return;

    animateAppLayout(() => {
        DOM.chatSide.appendChild(DOM.chatContainer);
        DOM.chatContainer.classList.add('visible');
    });
}

// Schliesst das Darstellungs-Popover (⋯) an der Aufgaben-Karte.
function closeTaskOptionsPopover() {
    const pop = document.getElementById('task-options-popover');
    const btn = document.getElementById('btn-task-options');
    if (pop) pop.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

function switchToInputMode() {
    // Darstellungs-Popover schliessen, falls offen
    closeTaskOptionsPopover();

    creationMode = 'text';
    resetReadingWordOverview();

    // Automatische Verkleinerung zurücknehmen - beim Bearbeiten gilt wieder die eingestellte Größe
    if (reader && DOM.fontSizeReading) {
        reader.setFontSize(parseInt(DOM.fontSizeReading.value, 10) || 24);
    }

    // Textmarkierungen entfernen (z.B. von "Text verstehen")
    clearMarkupFromTask();

    // Fehler-Detektiv State zuruecksetzen
    hideWrongSolutionContainer();
    currentWrongSolution = null;
    correctSolution = null;

    // Notizbuch zuruecksetzen
    hideNotebookContainer();
    // Visualisierungs-Bühne ausblenden
    hideVisualizationContainer();

    // Reset Sections und Eingabe-Werkzeuge in einem zusammenhaengenden
    // Layout-Uebergang umschalten.
    animateAppLayout(() => {
        DOM.chatContainer.classList.remove('visible');
        if (DOM.chatContainer.parentNode === DOM.chatSide) {
            document.querySelector('main').appendChild(DOM.chatContainer);
        }
        closeGeneratorPanel(false);
        applyInputZonesVisibility(true);
        // Notizfläche im Bearbeitungs-Modus ausblenden (Inhalt bleibt erhalten)
        refreshInlineNoteVisibility();
    });

    // Grafiken sind jetzt inline im Reader - nichts extra zu tun
    // Separaten Grafik-Container leeren (falls noch was drin ist)
    clearGraphics();

    // Wortbilder deaktivieren wenn aktiv
    if (isWordImagesActive) {
        isWordImagesActive = false;
        reader.setWordImages(false);
        updateWordImagesUI();
    }

    // Eingabe-Modus anzeigen
    DOM.readerContainer.style.display = 'block';
    reader.setMode('edit');
    updateUI();
    presentPendingCertificateOnExit();
    updateInputStateUI();
}

async function switchToExploreMode() {
    // Pruefen ob Text vorhanden ist
    const textFromReader = reader.getText().trim();
    if (!textFromReader) {
        alert('Bitte gib zuerst eine Sachaufgabe ein oder lade ein Foto hoch.');
        return;
    }

    if (!RechengeschichtenAPI.hasValidApiKey()) {
        meldeKeineKi();
        return;
    }

    // Generator-Panel schliessen falls offen
    closeGeneratorPanel();

    // Pruefen ob der Text im Reader geaendert wurde
    // (OCR passiert bereits beim Foto-Upload; hier kommt immer Text an.)
    // Der Reader-Text (innerText) enthaelt keine Tags mehr, also mit taskText vergleichen
    const cleanReaderText = textFromReader.replace(/📊 Tabelle|📈 Diagramm|🖼️ Bildbeschreibung/g, '').trim();
    const cleanTaskText = taskText.trim();

    if (cleanReaderText !== cleanTaskText && taskGraphics.length > 0) {
        // Text wurde geaendert - Grafiken zuruecksetzen
        taskGraphics = [];
        taskTextWithGraphics = '';
        taskText = textFromReader;
    } else if (taskTextWithGraphics) {
        // Text unveraendert - vollstaendigen Text mit Tags beibehalten
        taskText = cleanReaderText;
    } else {
        taskText = textFromReader;
    }

    // Pruefen ob es eine Sachaufgabe ist (nur wenn Text noch nicht geprueft wurde)
    const needsCheck = lastCheckedTaskText !== taskText;

    // Schon mal in den Lesemodus wechseln und UI vorbereiten
    creationMode = 'explore';
    reader.setMode('read');
    setInputZonesVisible(false);
    resetReadingWordOverview();
    syncFontSizeSliders();
    // Lange Aufgaben leicht verkleinern, damit Text + Notizfeld zusammen passen
    applyAutoReadingFontSize();

    // Notizfläche einblenden; bei geänderter Aufgabe alte Notizen verwerfen
    // und die Höhen-Automatik wieder freigeben
    if (needsCheck) {
        if (inlineNoteReady) { InlineNoteSheet.clear(); }
        inlineNoteUserSized = false;
    }
    refreshInlineNoteVisibility();

    if (needsCheck) {
        // Chat-Container sofort mit Ladeanzeige anzeigen
        showChatContainerInSide();
        DOM.strategyList.style.display = 'none';
        DOM.chatMessages.style.display = 'none';
        DOM.chatInputArea.style.display = 'none';
        DOM.chatModeLabel.textContent = 'Aufgabe wird geprüft...';
        DOM.btnBackToStrategies.style.display = 'none';
        DOM.chatTyping.querySelector('span').textContent = 'Aufgabe wird genau angeschaut...';
        DOM.chatTyping.classList.add('visible');

        setStatus('Prüfe Aufgabe...', 'processing');

        // Timeout-Promise fuer 15 Sekunden
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('TIMEOUT')), 15000);
        });

        // Pruefungs-Promise
        const checkPromise = (async () => {
            const checkResult = await RechengeschichtenAPI.checkIfMathTask(taskText);

            if (!checkResult.isMathTask) {
                return { success: false, message: checkResult.message };
            }

            // Text wurde erfolgreich geprueft - merken
            lastCheckedTaskText = taskText;

            // Aufgabentyp klassifizieren (Fermi/Standard/Kapitän) + Lösungsreferenz mitgenerieren
            classifyGeneration++; // laufende Hintergrund-Klassifikationen gehören zur alten Aufgabe
            try {
                const classification = await RechengeschichtenAPI.classifyTask(taskText);
                currentTaskType = classification.type;
                currentSolutionHint = classification.solutionHint || null;
                currentTaskVisualizable = classification.visualizable !== false
                    && VisualizationGuard.precheckVisualizable(taskText).ok;
                console.log('Task classification:', classification);
            } catch (classifyError) {
                console.warn('Task classification failed:', classifyError);
                currentTaskType = 'standard'; // Fallback
                currentSolutionHint = null;
                currentTaskVisualizable = false; // fail-closed
            }

            return { success: true };
        })();

        try {
            const result = await Promise.race([checkPromise, timeoutPromise]);

            DOM.chatTyping.classList.remove('visible');
            DOM.chatTyping.querySelector('span').textContent = 'Denke nach...';

            // Nutzer hat währenddessen den Stift gedrückt (zurück zum Bearbeiten) — nichts mehr anfassen
            if (creationMode !== 'explore') return;

            if (!result.success) {
                setStatus('Keine Sachaufgabe erkannt', 'ready');
                showToast(result.message || 'Das ist noch keine Rechengeschichte. Bitte ergänze oder ändere den Text.', 'error');
                switchToInputMode();
                return;
            }

            setStatus('Bereit', 'ready');
        } catch (error) {
            DOM.chatTyping.classList.remove('visible');
            DOM.chatTyping.querySelector('span').textContent = 'Denke nach...';

            if (error.message === 'TIMEOUT') {
                console.warn('Task check timed out after 15 seconds');
                setStatus('Prüfung fehlgeschlagen', 'error');
                showToast('Die Prüfung konnte nicht abgeschlossen werden. Bitte versuche es nochmal.', 'error');
                switchToInputMode();
                return;
            } else {
                console.error('Check task error:', error);
                // Bei Fehler trotzdem fortfahren und als geprueft markieren
                lastCheckedTaskText = taskText;
                currentTaskType = 'standard'; // Fallback
                currentSolutionHint = null;
                currentTaskVisualizable = false; // fail-closed, kein stale Wert der Voraufgabe
                classifyGeneration++; // verspätete Klassifikationen verwerfen
                setStatus('Bereit', 'ready');
            }
        }
    }

    // Nutzer hat währenddessen den Stift gedrückt (zurück zum Bearbeiten) — nichts mehr anfassen
    if (creationMode !== 'explore') return;

    // Annahmen-Button nur bei Fermi-Aufgaben anzeigen
    updateAssumptionsButton();
    // Visualisieren-Button nur bei geeigneten Aufgaben anzeigen
    updateVisualizeButton();

    // Strategie-Liste anzeigen (Chat-Container ist bereits sichtbar)
    showChatContainerInSide();
    DOM.strategyList.style.display = 'flex';
    DOM.chatMessages.style.display = 'none';
    DOM.chatMessages.innerHTML = '';
    DOM.chatInputArea.style.display = 'none';
    DOM.chatModeLabel.textContent = 'Was möchtest du tun?';
    DOM.btnBackToStrategies.style.display = 'none';

    // Reset Strategie
    currentStrategy = null;
    chatHistory = [];
    chatRequestGeneration++; // laufende Chat-Anfragen gehören zum alten Kontext
    chatSendInFlight = false;
    chatBaselineTaskText = '';
}

function openGeneratorPanel() {
    // Toggle: Wenn bereits offen, schliessen
    if (DOM.generatorPanel.classList.contains('visible')) {
        closeGeneratorPanel();
        return;
    }

    animateAppLayout(() => {
        // Chat-Container schliessen falls offen
        DOM.chatContainer.classList.remove('visible');

        // Generator-Panel in die chat-side verschieben und anzeigen
        DOM.chatSide.appendChild(DOM.generatorPanel);
        DOM.generatorPanel.classList.add('visible');
    });

    // Kapitaensaufgabe-Option basierend auf Einstellung ein-/ausblenden
    const hideCaptainTask = localStorage.getItem('rechengeschichten_hide_captain_task') === 'true';
    DOM.captainTaskOption.style.display = hideCaptainTask ? 'none' : 'block';
    if (hideCaptainTask) {
        DOM.generatorCaptainTask.checked = false;
    }

    // Vorauswahl basierend auf Alter treffen
    applyAgeBasedGeneratorDefaults();
}

function closeGeneratorPanel(animate = true) {
    const isOpen = DOM.generatorPanel.classList.contains('visible')
        || DOM.generatorPanel.parentNode === DOM.chatSide;
    if (!isOpen) return;

    const mutate = () => {
        DOM.generatorPanel.classList.remove('visible');
        // Panel aus chat-side entfernen (zurueck an urspruengliche Position im main)
        if (DOM.generatorPanel.parentNode === DOM.chatSide) {
            document.querySelector('main').appendChild(DOM.generatorPanel);
        }
    };

    if (animate) {
        animateAppLayout(mutate);
    } else {
        mutate();
    }
}

/**
 * Alter (6-12) -> Klassenstufe (1-6). Bewusst selbstständig gehalten,
 * damit der Test die Funktion isoliert auswerten kann.
 */
function generatorKlasseForAge(age) {
    var a = parseInt(age, 10);
    if (isNaN(a)) { a = 8; }
    var klasse = a - 5;
    if (klasse < 1) { klasse = 1; }
    if (klasse > 6) { klasse = 6; }
    return klasse;
}

const GENERATOR_SETTINGS_KEY = 'rechengeschichten_generator';

// Vom Nutzer geänderte Generator-Einstellungen (Klasse + Rechenart) lesen/speichern.
// Gespeichert wird nur bei echter Änderung (change-Event); programmatische
// Voreinstellungen lösen kein change aus und überschreiben nichts.
function readStoredGeneratorSettings() {
    try {
        const parsed = JSON.parse(localStorage.getItem(GENERATOR_SETTINGS_KEY));
        return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch (e) {
        return null;
    }
}

function storeGeneratorSettings() {
    try {
        localStorage.setItem(GENERATOR_SETTINGS_KEY, JSON.stringify({
            klasse: DOM.generatorDifficulty.value,
            operation: DOM.generatorOperation.value
        }));
    } catch (e) { /* egal */ }
}

// „Gemischt" bedeutet je nach Klasse etwas anderes (Kl. 1-2 nur +/−, Kl. 3 auch ×,
// ab Kl. 4 alle Grundrechenarten) — das Label der Option spiegelt das wider.
function updateGeneratorMixedLabel() {
    const opt = DOM.generatorOperation
        && DOM.generatorOperation.querySelector('option[value="mixed"]');
    if (!opt) return;
    const k = parseInt(DOM.generatorDifficulty.value, 10) || 3;
    opt.textContent = k <= 2 ? 'Gemischt (+ und −)'
        : (k === 3 ? 'Gemischt (+, − und ×)' : 'Gemischt (alle Rechenarten)');
}

/**
 * Setzt die Vorauswahl im Generator: gespeicherte Nutzer-Einstellungen haben
 * Vorrang, sonst passend zur Altersangabe (Klasse 1: +/− bis 20, Klasse 2:
 * +/− bis 100, ab Klasse 3 auch ×, ab Klasse 4 auch ÷ — die Zahlenräume
 * stecken im Generierungs-Prompt in api.js).
 */
function applyAgeBasedGeneratorDefaults() {
    const age = RechengeschichtenAPI.getAge();
    const stored = readStoredGeneratorSettings();
    const validOps = ['addition', 'subtraction', 'multiplication', 'division', 'mixed'];
    const storedKlasse = stored && /^[1-6]$/.test(String(stored.klasse)) ? String(stored.klasse) : null;
    const storedOp = stored && validOps.includes(stored.operation) ? stored.operation : null;

    DOM.generatorDifficulty.value = storedKlasse || String(generatorKlasseForAge(age));
    DOM.generatorOperation.value = storedOp || 'mixed';
    updateGeneratorMixedLabel();

    // Themen-Vorschlaege basierend auf Alter
    const ageThemes = {
        6: 'Spielzeug, Süßigkeiten, Tiere',
        7: 'Schule, Spielplatz, Geburtstag',
        8: 'Sport, Freunde, Haustiere',
        9: 'Einkaufen, Ausflug, Hobbys',
        10: 'Taschengeld, Freizeit, Natur',
        11: 'Sport, Musik, Reisen',
        12: 'Technik, Umwelt, Alltag'
    };

    // Placeholder mit altersgerechten Themen aktualisieren
    const themes = ageThemes[age] || ageThemes[8];
    DOM.generatorTopic.placeholder = `z.B. ${themes}`;
}

function updateUI() {
    // Speichern-Button aktualisieren (sichtbar wenn Text vorhanden)
    updateCollectionButtonVisibility();
}

// ===== PHOTO HANDLING =====

function togglePhotoDropdown() {
    DOM.photoDropdown.classList.toggle('visible');
    DOM.btnPhoto.setAttribute('aria-expanded', DOM.photoDropdown.classList.contains('visible'));
}

function hidePhotoDropdown() {
    DOM.photoDropdown.classList.remove('visible');
    DOM.btnPhoto.setAttribute('aria-expanded', 'false');
}

async function handlePhotoUpload(event) {
    const files = event.target.files;
    if (files.length === 0) return;

    const file = files[0];
    const readerFile = new FileReader();

    readerFile.onload = async (e) => {
        const base64 = e.target.result;
        const resizedImage = await RechengeschichtenAPI.resizeImageForApi(base64);
        if (!resizedImage) {
            event.target.value = '';
            setStatus('Foto konnte nicht gelesen werden', 'ready');
            return;
        }

        // Clear the input
        event.target.value = '';

        // Pruefen ob KI verfuegbar ist (eigener Zugang oder KI-Kanal der App-Sammlung)
        if (!RechengeschichtenAPI.hasValidApiKey()) {
            meldeKeineKi();
            return;
        }

        // OCR direkt durchfuehren
        setStatus('Erkenne Aufgabe...', 'processing');
        hidePhotoDropdown();

        try {
            const recognizedText = await RechengeschichtenAPI.recognizeTaskFromImage(resizedImage);

            // Text direkt setzen (ersetzt bestehenden Text)
            reader.setText(recognizedText);

            // Pruefung zuruecksetzen (neuer Text)
            lastCheckedTaskText = null;

            setStatus('Aufgabe erkannt!', 'ready');
        } catch (error) {
            console.error('OCR Error:', error);
            alert('Fehler beim Erkennen: ' + error.message);
            setStatus('Fehler', 'ready');
        }

        updateUI();
        updateInputStateUI();
    };

    readerFile.readAsDataURL(file);
}

function removeTaskImage() {
    taskImageBase64 = null;
    DOM.taskImage.src = '';
    DOM.taskImageContainer.classList.remove('visible');
    // Reset Chat
    DOM.chatContainer.classList.remove('visible');
    resetReadingWordOverview();
    // Grafiken leeren
    clearGraphics();
    // Pruefung zuruecksetzen
    lastCheckedTaskText = null;
    reader.setMode('edit');
    updateUI();
}

// ===== TASK RECOGNITION =====
// (Die Aufgabenpruefung ist jetzt in switchToExploreMode integriert)

// ===== STRATEGY SELECTION =====

function selectStrategy(strategy) {
    // Externe Integrationen koennen direkt in einen anderen Modus springen. Auch dann gilt der
    // bisherige Modus als verlassen und eine vorgemerkte Urkunde darf jetzt erscheinen.
    if (currentStrategy) presentPendingCertificateOnExit();

    if (strategy === 'visualize' && !isVisualizationAllowed()) {
        showToast('Diese Aufgabe lässt sich nicht gut mit Plättchen legen.', 'error');
        return;
    }

    currentStrategy = strategy;
    window._lastUserMsg = '';
    chatHistory = [];
    chatRequestGeneration++; // laufende Chat-Anfragen gehören zur alten Strategie
    chatSendInFlight = false;
    chatBaselineTaskText = '';
    missionAlreadyCompleted = false; // Reset fuer neue Strategie

    // Aktuellen Text aus Reader holen (falls bearbeitet wurde)
    const currentReaderText = reader.getText().trim();
    if (currentReaderText && currentReaderText !== taskText) {
        // Text wurde geaendert - aktualisieren
        taskText = currentReaderText;
        taskTextWithGraphics = reader.getTextWithTags ? reader.getTextWithTags() : currentReaderText;
        // Grafik-Tags neu parsen falls vorhanden
        if (taskTextWithGraphics.includes('[TABELLE]') || taskTextWithGraphics.includes('[GRAFIK]') || taskTextWithGraphics.includes('[BILDBESCHREIBUNG]')) {
            const { textOnly, graphics } = RechengeschichtenAPI.parseGraphicTags(taskTextWithGraphics);
            taskText = textOnly;
            taskGraphics = graphics;
        } else {
            taskGraphics = [];
        }
    }

    // Vorherige Markierungen entfernen
    clearMarkupFromTask();

    // Update UI - Strategie-Liste Buttons markieren
    DOM.strategyListBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === strategy);
    });

    // "Text lesen" - Lesemodus mit Wortuebersicht
    if (strategy === 'read') {
        DOM.strategyList.style.display = 'none';
        DOM.chatMessages.style.display = 'flex';
        DOM.chatMessages.innerHTML = '';
        DOM.chatInputArea.style.display = 'none';
        DOM.chatModeLabel.textContent = 'Text lesen';
        DOM.btnBackToStrategies.style.display = 'flex';
        reader.setMode('read');
        // Automatisch vorlesen starten
        reader.readText();
        loadReadingWordOverview();
        return;
    }

    // Update chat header
    const strategyLabels = {
        read: 'Text lesen',
        ask: 'Fragen stellen',
        understand: 'Text verstehen',
        solve: 'Lösungen entwickeln',
        check: 'Lösung prüfen',
        assumptions: 'Annahmen treffen',
        detective: 'Fehler-Detektiv',
        visualize: 'Visualisieren'
    };
    DOM.chatModeLabel.textContent = strategyLabels[strategy];

    // Strategie-Liste ausblenden, Chat anzeigen
    DOM.strategyList.style.display = 'none';
    DOM.chatMessages.style.display = 'flex';
    DOM.chatMessages.innerHTML = '';
    // Sauberer Start: ein evtl. noch angehängtes Foto/Zeichnung aus einer vorherigen
    // Sitzung verwerfen, damit nichts in den neuen Chat-Kontext durchsickert.
    clearChatPhoto();
    drawingImageBase64 = null;
    if (DOM.chatDrawBtn) DOM.chatDrawBtn.classList.remove('has-drawing');
    // NotePad-Szene und Bühne beim Strategiewechsel zurücksetzen
    if (notePadReady) { NotePad.clear(); }
    if (isNoteActive()) { closeNoteStage(); }
    // Notizfläche bleibt erhalten — aber der neue Chat kennt das Bild noch nicht,
    // deshalb beim nächsten Senden wieder mitschicken
    inlineNoteDirty = true;
    updateInlineNoteSendBadge();
    if (DOM.sketchPreview) DOM.sketchPreview.style.display = 'none';
    if (DOM.sketchPreviewImg) DOM.sketchPreviewImg.removeAttribute('src');
    // (Sichtbarkeit des Stift-Knopfs setzt die Strategie-Logik weiter unten)
    noteObjectCache = { text: null, items: null, promise: null };
    DOM.chatInputArea.style.display = 'flex';
    DOM.btnBackToStrategies.style.display = 'flex';

    // Zeichnen-Button zentral setzen (nur Zeichen-Strategien, nicht bei aktiver Notizfläche)
    refreshDrawBtnVisibility();

    // Visualisieren-Button (Reuse) nur bei Lösen/Prüfen UND geeigneter Aufgabe
    const reuseVisBtn = document.getElementById('chat-visualize-btn');
    if (reuseVisBtn) {
        const reuseOk = (strategy === 'solve' || strategy === 'check') && isVisualizationAllowed();
        reuseVisBtn.style.display = reuseOk ? 'flex' : 'none';
        if (reuseOk) wireReuseVisualizeButton();
    }
    // Foto-Button (eigene Modul-Liste inkl. Text verstehen, abhängig von Einstellung + Vision)
    updateChatPhotoButtonVisibility(strategy);

    // Wrong-Solution-Container fuer Detective-Modus vorbereiten (wird spaeter befuellt)
    if (strategy === 'detective') {
        showWrongSolutionContainer();
    } else {
        hideWrongSolutionContainer();
    }

    // Notizbuch zuruecksetzen
    hideNotebookContainer();

    // Visualisierungs-Container nur im Visualisieren-Modus zeigen und frisch mounten
    visualizationActive = (strategy === 'visualize');
    const visContainer = document.getElementById('visualization-container');
    if (visContainer) {
        if (strategy === 'visualize') {
            visContainer.style.display = 'block';
            currentVisualizationPlan = null; // wird in startStrategyChat frisch erzeugt
            QuantityVisualizer.mount(document.getElementById('qv-mount'));
            setVisualizationCaption('');
            setupVisualizationToggle();
        } else {
            visContainer.style.display = 'none';
            QuantityVisualizer.reset();
        }
    }

    // Get start message
    startStrategyChat();
}

// ---- Visualisieren: Hilfsfunktionen -------------------------------------
let visualizationActive = false;   // im Modus 'visualize' oder per Reuse-Button aktiv
let _visToggleWired = false;

function setupVisualizationToggle() {
    if (_visToggleWired) return;
    const toggle = document.getElementById('qv-toggle');
    if (!toggle) return;
    _visToggleWired = true;
    toggle.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            toggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            QuantityVisualizer.setRepresentation(btn.dataset.rep);
        });
    });
    const showAllBtn = document.getElementById('qv-show-all-btn');
    if (showAllBtn) showAllBtn.addEventListener('click', showWholeTaskVisualization);
    const prevBtn = document.getElementById('qv-prev-btn');
    if (prevBtn) prevBtn.addEventListener('click', () => planBack());
    const nextBtn = document.getElementById('qv-next-btn');
    if (nextBtn) nextBtn.addEventListener('click', () => planForward());
}

// Aktualisiert die Schritt-Navigation (Anzeige x/n, Buttons aktiv/inaktiv)
function updateStepNav() {
    const info = QuantityVisualizer.seqInfo();
    // Sichtbare Stationen (ohne unsichtbares "vorbereiten") für Anzeige & Abschluss
    const visTotal = totalVisibleStations() || info.total;
    const visIdx = currentVisualizationPlan ? appliedVisibleStations() : info.index;
    const complete = visTotal > 0 && visIdx >= visTotal;

    // "Ganze Aufgabe zeigen" erst anbieten, wenn alle Schritte erarbeitet wurden
    const showAll = document.getElementById('qv-show-all-btn');
    if (showAll) showAll.style.display = complete ? 'inline-block' : 'none';

    const nav = document.getElementById('qv-stepnav');
    if (!nav) return;
    if (info.total === 0) { nav.style.display = 'none'; return; }
    nav.style.display = 'flex';
    const ind = document.getElementById('qv-step-indicator');
    const prev = document.getElementById('qv-prev-btn');
    const next = document.getElementById('qv-next-btn');
    if (ind) ind.textContent = visIdx + ' / ' + visTotal;
    if (prev) prev.disabled = info.index <= 0;
    if (next) next.disabled = info.index >= info.total;
}

let _reuseVisWired = false;
function wireReuseVisualizeButton() {
    if (_reuseVisWired) return;
    const btn = document.getElementById('chat-visualize-btn');
    if (!btn) return;
    _reuseVisWired = true;
    btn.addEventListener('click', () => {
        visualizationActive = true;
        const c = document.getElementById('visualization-container');
        if (c) c.style.display = 'block';
        QuantityVisualizer.mount(document.getElementById('qv-mount'));
        setupVisualizationToggle();
        setVisualizationCaption('');
        // KI bitten, die aktuelle Aufgabe mit Plättchen zu zeigen
        DOM.chatInput.value = 'Kannst du mir das mit Plättchen zeigen?';
        handleChatSend();
    });
}

// Lässt die KI die KOMPLETTE Schrittfolge erzeugen und spielt sie animiert ab
async function showWholeTaskVisualization() {
    const btn = document.getElementById('qv-show-all-btn');
    const original = btn ? btn.textContent : '';
    try {
        if (btn) { btn.disabled = true; btn.textContent = '… wird vorbereitet'; }
        // Vorhandenen Plan nutzen, sonst frisch erzeugen
        let steps = currentVisualizationPlan;
        if (!steps || !steps.length) {
            syncTaskFromReader();
            const text = (taskTextWithGraphics || taskText || '').trim();
            if (!text) { setVisualizationCaption('Es ist noch keine Aufgabe da.'); return; }
            steps = await RechengeschichtenAPI.getVisualizationScript(text);
            const check = VisualizationGuard.validatePlan(steps, {
                expectedAnswer: VisualizationGuard.extractAnswerNumber(currentSolutionHint)
            });
            if (!check.ok) {
                showToast('Das klappt bei dieser Aufgabe leider nicht.', 'error');
                return;
            }
            currentVisualizationPlan = steps;
        }
        if (!steps || !steps.length) {
            setVisualizationCaption('Das hat nicht geklappt - probier es im Dialog Schritt für Schritt.');
            return;
        }
        const container = document.getElementById('visualization-container');
        if (container) container.style.display = 'block';
        QuantityVisualizer.mount(document.getElementById('qv-mount'));
        setupVisualizationToggle();
        await QuantityVisualizer.loadSequence(steps);
        updateStepNav();
        // Stationen automatisch nacheinander aufbauen (von der Ausgangsmenge an)
        let guard = 0;
        while (QuantityVisualizer.seqInfo().index < steps.length && guard++ < steps.length + 2) {
            const before = QuantityVisualizer.seqInfo().index;
            await planForward();
            await new Promise(r => setTimeout(r, QuantityVisualizer.getStepPause()));
            if (QuantityVisualizer.seqInfo().index === before) break;
        }
    } catch (e) {
        console.error('Ganze-Aufgabe-Visualisierung fehlgeschlagen:', e);
        setVisualizationCaption('Es gab ein Problem beim Anzeigen.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = original || '▶ Ganze Aufgabe zeigen'; }
    }
}

function setVisualizationCaption(text) {
    const cap = document.getElementById('qv-caption');
    if (cap) cap.textContent = text || '';
}

// Wendet eine Folge von KI-Visualisierungs-Schritten nacheinander an
async function applyVisualizationSteps(steps) {
    const container = document.getElementById('visualization-container');
    if (container) container.style.display = 'block';
    const mount = document.getElementById('qv-mount');
    if (mount && !QuantityVisualizer.getState()) {
        QuantityVisualizer.mount(mount);
        setupVisualizationToggle();
    }
    const nav = document.getElementById('qv-stepnav');
    if (nav) nav.style.display = 'none'; // im Dialog Schritt-für-Schritt, keine Sequenz-Navigation
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const v = QuantityVisualizer.validateStep(step);
        if (!v.ok) {
            console.warn('Visualisierungs-Schritt abgelehnt:', v.error, step);
            continue; // Schritt überspringen, Bühne bleibt konsistent
        }
        // Mengen-Deckel wie im Plan-Validator (der läuft im Dialog-Modus nicht):
        // ein einzelner Schritt darf die Bühne nicht über 100 Plättchen treiben.
        const norm = (typeof QVHelpers !== 'undefined' && QVHelpers.normalizeStep)
            ? QVHelpers.normalizeStep(step) : step;
        const stepMagnitude = Math.max(
            Number(norm.anzahl) || 0,
            (Number(norm.gruppen) || 0) * (Number(norm.proGruppe) || 0),
            Number(norm.anzahlGruppen) || 0,
            Number(norm.proGruppe) || 0
        );
        if (stepMagnitude > 100) {
            console.warn('Visualisierungs-Schritt abgelehnt: Menge über 100', step);
            continue;
        }
        await QuantityVisualizer.applyStep(step);
        if (step && step.text) setVisualizationCaption(step.text);
        if (i < steps.length - 1) await new Promise(r => setTimeout(r, QuantityVisualizer.getStepPause()));
    }
}

// Entfernt die Steuersignale [WEITER]/[ZURUECK] aus dem angezeigten Chattext.
// Tolerant: auch [WEITER zur naechsten Station], [ZURÜCK], evtl. mit umschliessendem **fett**.
function stripVisualizationControl(text) {
    return (text || '')
        .replace(/\*{0,2}\[\s*(WEITER|ZUR(?:UE|U|Ü)CK)[^\]]*\]\*{0,2}/gi, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Begleiteter Plan-Modus: wendet die [WEITER]/[ZURUECK]-Signale der KI auf den festen Plan an
async function handleVisualizationControl(response) {
    if (currentStrategy !== 'visualize' || !currentVisualizationPlan) return;
    const container = document.getElementById('visualization-container');
    if (container) container.style.display = 'block';
    const tokens = (response || '').match(/\[\s*(WEITER|ZUR(?:UE|U|Ü)CK)[^\]]*\]/gi) || [];
    // Clamp: höchstens EIN Vorwärts- und EIN Rückwärts-Schritt pro Nachricht
    let forwardDone = false, backDone = false;
    for (const tk of tokens) {
        if (/WEITER/i.test(tk)) {
            if (!forwardDone) { await planForward(); forwardDone = true; }
        } else if (!backDone) { await planBack(); backDone = true; }
    }
}

// Sperre gegen überlappende Schritt-Animationen: die mehrphasigen Renders
// (z.B. "teilen") verzahnen sich sonst bei schnellem Tippen auf Vor/Zurück.
let planNavBusy = false;

// Eine Station vorwärts schalten (unsichtbares "vorbereiten" überspringen)
async function planForward() {
    if (planNavBusy) return;
    planNavBusy = true;
    try {
        let s = await QuantityVisualizer.stepForward();
        while (s && s.aktion === 'vorbereiten') s = await QuantityVisualizer.stepForward();
        const _info = (QuantityVisualizer.seqInfo ? QuantityVisualizer.seqInfo() : null);
        if (s && s.text) setVisualizationCaption(s.text);
        updateStepNav();
    } finally {
        planNavBusy = false;
    }
}

// Eine Station zurück schalten
async function planBack() {
    if (planNavBusy) return;
    planNavBusy = true;
    try {
        let s = await QuantityVisualizer.stepBack();
        while (s && s.aktion === 'vorbereiten') s = await QuantityVisualizer.stepBack();
        const _info = (QuantityVisualizer.seqInfo ? QuantityVisualizer.seqInfo() : null);
        setVisualizationCaption(s && s.text ? s.text : '');
        updateStepNav();
    } finally {
        planNavBusy = false;
    }
}

// Wie viele sichtbare Stationen der Plan insgesamt hat
function totalVisibleStations() {
    if (!currentVisualizationPlan) return 0;
    return currentVisualizationPlan.filter(s => s && s.aktion !== 'vorbereiten' && s.aktion !== 'zuruecksetzen').length;
}
// Wie viele sichtbare Stationen aktuell schon gelegt sind (für die KI-Zustandseinblendung)
function appliedVisibleStations() {
    if (!currentVisualizationPlan) return 0;
    const applied = QuantityVisualizer.seqInfo().index;
    let visible = 0;
    for (let i = 0; i < applied && i < currentVisualizationPlan.length; i++) {
        const a = currentVisualizationPlan[i].aktion;
        if (a !== 'vorbereiten' && a !== 'zuruecksetzen') visible++;
    }
    return visible;
}

async function startStrategyChat() {
    DOM.chatTyping.classList.add('visible');

    try {
        // Sicherstellen, dass die KI mit der aktuell angezeigten Aufgabe arbeitet
        syncTaskFromReader();
        chatBaselineTaskText = (taskText || '').trim();
        // Vollstaendigen Text mit Grafiken verwenden (falls vorhanden)
        const textForAI = taskTextWithGraphics || taskText;

        // Spezialbehandlung fuer Fehler-Detektiv Modus
        if (currentStrategy === 'detective') {
            const detectiveData = await RechengeschichtenAPI.generateDetectiveProblem(textForAI, taskImageBase64);
            currentWrongSolution = detectiveData.wrongSolution;
            correctSolution = detectiveData.correctSolution;
            displayWrongSolution(detectiveData.wrongSolution);
            // Fehler-Detektiv gestartet — fehlerhafte Lösung wird dem Kind präsentiert
            appendChatMessage(detectiveData.startMessage, 'bot');
            speakText(detectiveData.startMessage);
            return;
        }

        // Visualisieren: festen Gesamtplan erzeugen, streng validieren, sonst sauber abbrechen
        if (currentStrategy === 'visualize') {
            currentVisualizationPlan = null;
            DOM.chatTyping.querySelector('span').textContent = 'Plättchen werden vorbereitet...';
            const expectedAnswer = VisualizationGuard.extractAnswerNumber(currentSolutionHint);
            let plan = null;
            let check = { ok: false, errors: ['kein Plan'] };
            try {
                plan = await RechengeschichtenAPI.getVisualizationScript(textForAI);
                check = VisualizationGuard.validatePlan(plan, { expectedAnswer });
                if (!check.ok) {
                    // genau EIN Retry mit konkretem Fehler-Feedback an die KI
                    plan = await RechengeschichtenAPI.getVisualizationScript(textForAI, {
                        feedback: JSON.stringify(plan) + '\nProbleme: ' + check.errors.join('; ')
                    });
                    check = VisualizationGuard.validatePlan(plan, { expectedAnswer });
                }
            } catch (e) {
                console.warn('Visualisierungsplan konnte nicht erstellt werden:', e);
                check = { ok: false, errors: ['exception: ' + (e && e.message)] };
            }
            DOM.chatTyping.querySelector('span').textContent = 'Denke nach...';

            if (!check.ok) {
                // fail-closed: kein stiller freier Modus mehr
                currentTaskVisualizable = false;
                classifyGeneration++; // verspätete Klassifikationen dürfen das fail-closed nicht aufheben
                updateVisualizeButton();
                hideVisualizationContainer();
                showToast('Diese Aufgabe lässt sich nicht gut mit Plättchen legen. Such dir einen anderen Weg aus!', 'error');
                backToStrategies();
                return;
            }

            currentVisualizationPlan = plan;
            QuantityVisualizer.loadSequence(plan);
            setVisualizationCaption('');
            updateStepNav();
        }

        const startMessage = await RechengeschichtenAPI.getStrategyStartMessage(
            textForAI,
            currentStrategy,
            taskImageBase64,
            currentTaskType || 'standard',
            currentSolutionHint,
            currentVisualizationPlan
        );
        let cleanStart = startMessage;
        if (currentStrategy === 'visualize' && currentVisualizationPlan) {
            await handleVisualizationControl(startMessage);
            cleanStart = stripVisualizationControl(startMessage);
        }
        // Rohe [VISUALISIERUNG]-Tags nie im Chat anzeigen (auch nicht im Reuse-Modus)
        if (typeof QuantityVisualizer !== 'undefined' && QuantityVisualizer.stripVisualizationTag) {
            cleanStart = QuantityVisualizer.stripVisualizationTag(cleanStart);
        }
        appendChatMessage(cleanStart, 'bot');
        speakText(cleanStart);
    } catch (error) {
        console.error('Start chat error:', error);
        appendChatMessage('Entschuldigung, es gab einen Fehler. Bitte versuche es nochmal.', 'bot');
    } finally {
        DOM.chatTyping.classList.remove('visible');
    }
}

function resetReadingWordOverview() {
    readingWordOverview = null;
    readingWordOverviewTask = null;
}

function clearReadingImportantWordHighlights() {
    if (!reader || !reader.textElement) return;
    const highlights = reader.textElement.querySelectorAll('.reading-important-word');
    highlights.forEach(highlight => {
        const parent = highlight.parentNode;
        if (!parent) return;
        while (highlight.firstChild) parent.insertBefore(highlight.firstChild, highlight);
        parent.removeChild(highlight);
    });
    reader.textElement.normalize();
}

function highlightReadingImportantWords(overviewText) {
    clearReadingImportantWordHighlights();
    if (!reader || !reader.textElement || !window.ReadingWordUtils) return;

    const words = window.ReadingWordUtils.extractImportantWords(overviewText);
    if (words.length === 0) return;

    const walker = document.createTreeWalker(reader.textElement, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(node => {
        const text = node.textContent || '';
        const ranges = window.ReadingWordUtils.findWholeWordRanges(text, words);
        if (ranges.length === 0 || !node.parentNode) return;

        const fragment = document.createDocumentFragment();
        let cursor = 0;
        ranges.forEach(range => {
            if (range.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, range.start)));
            const highlight = document.createElement('span');
            highlight.className = 'reading-important-word';
            highlight.textContent = text.slice(range.start, range.end);
            fragment.appendChild(highlight);
            cursor = range.end;
        });
        if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
        node.parentNode.replaceChild(fragment, node);
    });
}

function renderReadingWordOverview(overviewText) {
    const header = '**Wichtige Wörter**\n';
    DOM.chatMessages.innerHTML = '';
    appendChatMessage(header + overviewText, 'bot');

    const overviewMessage = DOM.chatMessages.lastElementChild;
    if (overviewMessage) {
        const hint = document.createElement('div');
        hint.className = 'reading-word-hint';

        const hintIcon = document.createElement('span');
        hintIcon.className = 'reading-word-hint-icon';
        hintIcon.setAttribute('aria-hidden', 'true');
        hintIcon.textContent = 'i';

        const hintText = document.createElement('span');
        hintText.textContent = 'Tipp: Drücke ein schwieriges Wort im Text länger. Dann wird es dir erklärt.';

        hint.appendChild(hintIcon);
        hint.appendChild(hintText);
        overviewMessage.appendChild(hint);
    }

    highlightReadingImportantWords(overviewText);
}

async function loadReadingWordOverview(forceReload = false) {
    if (currentStrategy !== 'read') {
        return;
    }

    const currentText = (taskText || '').trim();
    if (!currentText) {
        return;
    }

    if (!forceReload && readingWordOverview && readingWordOverviewTask === currentText) {
        renderReadingWordOverview(readingWordOverview);
        return;
    }

    if (isWordOverviewLoading) {
        return;
    }

    isWordOverviewLoading = true;
    DOM.chatTyping.classList.add('visible');

    try {
        const overview = await RechengeschichtenAPI.getReadingWordOverview(currentText);
        readingWordOverview = overview;
        readingWordOverviewTask = currentText;
        renderReadingWordOverview(overview);
    } catch (error) {
        console.error('Word overview error:', error);
        appendChatMessage('Entschuldigung, die Wortliste konnte nicht geladen werden.', 'bot');
    } finally {
        DOM.chatTyping.classList.remove('visible');
        isWordOverviewLoading = false;
    }
}

function backToStrategies() {
    // Markierungen entfernen
    clearMarkupFromTask();

    // Fehler-Detektiv State zuruecksetzen und Container verstecken
    hideWrongSolutionContainer();
    currentWrongSolution = null;
    correctSolution = null;

    // Notizbuch zuruecksetzen
    hideNotebookContainer();
    // Visualisierungs-Bühne ausblenden
    hideVisualizationContainer();

    // Bei Dialog-Modus: Zurueck zum Eingabe-Modus
    if (creationMode === 'dialog') {
        DOM.chatContainer.classList.remove('visible');
        currentDialogCalculation = null; // Reset Rechnung
        switchToInputMode();
        return;
    }

    currentStrategy = null;
    chatHistory = [];
    chatRequestGeneration++; // laufende Chat-Anfragen gehören zum alten Kontext
    chatSendInFlight = false;
    clearChatPhoto();
    chatBaselineTaskText = '';
    // NotePad-Szene und Bühne beim Zurück-Klick zurücksetzen
    drawingImageBase64 = null;
    if (notePadReady) { NotePad.clear(); }
    if (isNoteActive()) { closeNoteStage(); }
    if (DOM.sketchPreview) DOM.sketchPreview.style.display = 'none';
    if (DOM.sketchPreviewImg) DOM.sketchPreviewImg.removeAttribute('src');
    if (DOM.chatDrawBtn) DOM.chatDrawBtn.classList.remove('has-drawing');
    refreshDrawBtnVisibility();
    noteObjectCache = { text: null, items: null, promise: null };

    // Zurueck zur Strategie-Liste
    DOM.strategyList.style.display = 'flex';
    DOM.chatMessages.style.display = 'none';
    DOM.chatMessages.innerHTML = '';
    DOM.chatInputArea.style.display = 'none';
    DOM.chatModeLabel.textContent = 'Was möchtest du tun?';
    DOM.btnBackToStrategies.style.display = 'none';

    // Strategie-Buttons zuruecksetzen
    DOM.strategyListBtns.forEach(btn => btn.classList.remove('active'));
    // Button-Sichtbarkeiten gemäß aktueller Aufgabe
    updateAssumptionsButton();
    updateVisualizeButton();
    presentPendingCertificateOnExit();
}

// ===== FEHLER-DETEKTIV FUNKTIONEN =====

function showWrongSolutionContainer() {
    if (DOM.wrongSolutionContainer) {
        DOM.wrongSolutionContainer.style.display = 'block';
    }
}

function hideWrongSolutionContainer() {
    if (DOM.wrongSolutionContainer) {
        DOM.wrongSolutionContainer.style.display = 'none';
        DOM.wrongSolutionContent.innerHTML = '';
        DOM.btnRevealCorrect.style.display = 'none';
    }
}

function displayWrongSolution(wrongSolutionData) {
    if (!DOM.wrongSolutionContent || !wrongSolutionData) return;

    let html = '<div class="wrong-solution-steps">';

    // Zeige die Rechenschritte
    if (wrongSolutionData.steps && wrongSolutionData.steps.length > 0) {
        wrongSolutionData.steps.forEach((step, index) => {
            html += `<div class="wrong-solution-step">
                <span class="step-number">${index + 1}.</span>
                <span class="step-text">${formatMathSymbols(step)}</span>
            </div>`;
        });
    }

    // Zeige die (falsche) Antwort
    if (wrongSolutionData.answer) {
        html += `<div class="wrong-solution-answer">
            <strong>Antwort:</strong> ${formatMathSymbols(wrongSolutionData.answer)}
        </div>`;
    }

    html += '</div>';

    DOM.wrongSolutionContent.innerHTML = html;
    DOM.wrongSolutionContainer.style.display = 'block';
    // Reveal-Button wird erst angezeigt, wenn das Kind den Fehler gefunden hat
}

/**
 * Prueft ob die KI-Antwort bestaetigt, dass das Kind den Fehler gefunden hat
 */
function checkIfErrorFound(response) {
    if (currentStrategy !== 'detective') return false;

    const lowerResponse = response.toLowerCase();

    // Positive Bestaetigung-Phrasen
    const confirmationPhrases = [
        'super entdeckt',
        'richtig erkannt',
        'gut gefunden',
        'genau richtig',
        'das stimmt',
        'du hast recht',
        'toll gefunden',
        'prima erkannt',
        'fehler gefunden',
        'das ist der fehler',
        'genau das ist',
        'richtig! der fehler',
        'super! du hast',
        'toll! du hast',
        'klasse! du hast',
        'perfekt!',
        'sehr gut!',
        'ausgezeichnet',
        'wunderbar',
        'fehler-detektiv',
        'echter detektiv'
    ];

    return confirmationPhrases.some(phrase => lowerResponse.includes(phrase));
}

/**
 * Zeigt den Reveal-Button fuer die korrekte Loesung an
 */
function showRevealButton() {
    if (DOM.btnRevealCorrect && correctSolution) {
        DOM.btnRevealCorrect.style.display = 'block';
    }
}

/**
 * Liest die falsche Loesung vor
 */
function readWrongSolution() {
    if (!currentWrongSolution) return;

    // Text aus der falschen Loesung zusammenbauen
    let textToRead = 'Hier ist die Lösung zum Prüfen: ';

    if (currentWrongSolution.steps && currentWrongSolution.steps.length > 0) {
        currentWrongSolution.steps.forEach((step, index) => {
            textToRead += `Schritt ${index + 1}: ${step}. `;
        });
    }

    if (currentWrongSolution.answer) {
        textToRead += `Antwort: ${currentWrongSolution.answer}`;
    }

    speakText(textToRead);
}

function revealCorrectSolution() {
    if (!correctSolution || !DOM.wrongSolutionContent) return;

    // Füge die korrekte Loesung unter der falschen hinzu
    const correctHtml = `
        <div class="correct-solution-reveal">
            <div class="correct-solution-header">
                <span class="correct-icon">✓</span>
                <span>So wäre es richtig:</span>
            </div>
            <div class="correct-solution-steps">
                ${correctSolution.steps ? correctSolution.steps.map((step, i) =>
                    `<div class="correct-solution-step">
                        <span class="step-number">${i + 1}.</span>
                        <span class="step-text">${formatMathSymbols(step)}</span>
                    </div>`
                ).join('') : ''}
                ${correctSolution.answer ? `<div class="correct-solution-answer">
                    <strong>Antwort:</strong> ${formatMathSymbols(correctSolution.answer)}
                </div>` : ''}
            </div>
        </div>
    `;

    DOM.wrongSolutionContent.innerHTML += correctHtml;
    DOM.btnRevealCorrect.style.display = 'none';

    // Scroll zur korrekten Loesung
    const revealElement = DOM.wrongSolutionContent.querySelector('.correct-solution-reveal');
    if (revealElement) {
        revealElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// ===== NOTIZBUCH FUNKTIONEN =====

function isNotebookStrategy(strategy) {
    return strategy === 'solve' || strategy === 'check' || strategy === 'assumptions';
}

function isPhotoInChatEnabled() {
    return localStorage.getItem('rechengeschichten_photo_in_chat') !== 'false';
}

function providerHasVisionForChat() {
    return !!(window.RechengeschichtenAPI
        && RechengeschichtenAPI.providerSupportsVision
        && RechengeschichtenAPI.providerSupportsVision());
}

/**
 * Foto-Button nur zeigen, wenn: passender Modus UND Einstellung an UND Vision-Anbieter da.
 */
function updateChatPhotoButtonVisibility(strategy) {
    if (!DOM.chatPhotoBtn) return;
    const show = isPhotoInChatEnabled()
        && typeof isPhotoChatStrategy === 'function' && isPhotoChatStrategy(strategy)
        && providerHasVisionForChat();
    DOM.chatPhotoBtn.style.display = show ? 'flex' : 'none';
}

/**
 * Setzt das Chat-Foto (verwirft eine Zeichnung, da XOR), zeigt Vorschau + Button-Zustand.
 */
function setChatPhoto(dataUrl) {
    if (drawingImageBase64) {
        drawingImageBase64 = null;
        if (DOM.chatDrawBtn) DOM.chatDrawBtn.classList.remove('has-drawing');
    }
    // XOR: eine evtl. vorhandene Skizze (lebt jetzt in NotePad.scene + Vorschau) ebenfalls verwerfen,
    // sonst würde sie beim Senden das gerade angehängte Foto verdrängen.
    if (notePadReady && NotePad.hasContent()) {
        NotePad.clear();
        if (DOM.chatDrawBtn) DOM.chatDrawBtn.classList.remove('has-drawing');
    }
    if (DOM.sketchPreview) {
        DOM.sketchPreview.style.display = 'none';
        if (DOM.sketchPreviewImg) DOM.sketchPreviewImg.removeAttribute('src');
    }
    refreshDrawBtnVisibility(); // Stift-Knopf gemäß Strategie/Vorschau wieder anzeigen
    photoImageBase64 = dataUrl;
    renderChatPhotoPreview();
    if (DOM.chatPhotoBtn) DOM.chatPhotoBtn.classList.add('has-photo');
}

function clearChatPhoto() {
    photoImageBase64 = null;
    if (DOM.chatPhotoPreview) {
        DOM.chatPhotoPreview.style.display = 'none';
        DOM.chatPhotoPreview.innerHTML = '';
    }
    if (DOM.chatPhotoBtn) DOM.chatPhotoBtn.classList.remove('has-photo');
}

function renderChatPhotoPreview() {
    if (!DOM.chatPhotoPreview || !photoImageBase64) return;
    // photoImageBase64 ist eine eigene, vertrauenswürdige Canvas-DataURL (kein Fremdtext)
    DOM.chatPhotoPreview.innerHTML =
        '<img src="' + photoImageBase64 + '" alt="Vorschau deines Fotos">' +
        '<button type="button" class="chat-photo-preview-remove" aria-label="Foto entfernen">&times;</button>';
    DOM.chatPhotoPreview.style.display = 'flex';
    const rm = DOM.chatPhotoPreview.querySelector('.chat-photo-preview-remove');
    if (rm) rm.addEventListener('click', clearChatPhoto);
}

/**
 * Aufnahme-Handler: Foto lesen, für den Chat verkleinern (768 px, Qualität 0.7), anhängen.
 */
async function handleChatPhotoCapture(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const readerFile = new FileReader();
    readerFile.onload = async (e) => {
        event.target.value = '';
        try {
            setStatus('Foto wird vorbereitet...', 'processing');
            const resized = await RechengeschichtenAPI.resizeImageForApi(e.target.result, 768, 0.7);
            if (!resized) {
                setStatus('Foto konnte nicht gelesen werden', 'ready');
                return;
            }
            setChatPhoto(resized);
            setStatus('Bereit', 'ready');
        } catch (err) {
            console.error('Chat-Foto-Fehler:', err);
            setStatus('Bereit', 'ready');
        }
    };
    readerFile.onerror = () => {
        event.target.value = '';
        setStatus('Bereit', 'ready');
        console.error('Chat-Foto: Datei konnte nicht gelesen werden.');
    };
    readerFile.readAsDataURL(file);
}

function isNotebookEnabled() {
    return localStorage.getItem('rechengeschichten_show_notebook') !== 'false';
}

function showNotebookContainer() {
    if (DOM.notebookContainer) {
        DOM.notebookContainer.style.display = 'block';
    }
}

function hideNotebookContainer() {
    if (DOM.notebookContainer) {
        DOM.notebookContainer.style.display = 'none';
        DOM.notebookContent.innerHTML = '';
    }
    currentNotebookData = null;
}

function displayNotebook(notebookData) {
    if (!DOM.notebookContent || !notebookData) return;

    currentNotebookData = notebookData;

    let html = '<div class="notebook-steps">';

    // Zeige die Schritte
    if (notebookData.schritte && notebookData.schritte.length > 0) {
        notebookData.schritte.forEach((step, index) => {
            html += `<div class="notebook-step">
                <span class="step-number">${index + 1}.</span>
                <span class="step-text">${formatMathSymbols(step)}</span>
            </div>`;
        });
    }

    // Zeige die Antwort
    if (notebookData.antwort) {
        html += `<div class="notebook-answer">
            <strong>Antwort:</strong> ${formatMathSymbols(notebookData.antwort)}
        </div>`;
    }

    html += '</div>';

    DOM.notebookContent.innerHTML = html;
    showNotebookContainer();
}

function checkForNotebook(response) {
    const match = response.match(/\[NOTIZBUCH\]([\s\S]*?)\[\/NOTIZBUCH\]/);
    if (match) {
        try {
            return JSON.parse(match[1].trim());
        } catch (e) {
            console.error('Fehler beim Parsen des NOTIZBUCH Tags:', e);
            return null;
        }
    }
    return null;
}

function stripNotebookTag(response) {
    return response.replace(/\[NOTIZBUCH\][\s\S]*?\[\/NOTIZBUCH\]/g, '').trim();
}

function readNotebook() {
    if (!currentNotebookData) return;

    let textToRead = 'Mein Notizbuch: ';

    if (currentNotebookData.schritte && currentNotebookData.schritte.length > 0) {
        currentNotebookData.schritte.forEach((step, index) => {
            textToRead += `Schritt ${index + 1}: ${step}. `;
        });
    }

    if (currentNotebookData.antwort) {
        textToRead += `Antwort: ${currentNotebookData.antwort}`;
    }

    speakText(textToRead);
}

// ===== CHAT HANDLING =====

// Aufgabentext, mit dem der aktuelle Strategie-Chat begonnen hat.
// Wird bei jedem Strategie-Start gesetzt und bei Aufgaben-Wechsel
// (während ein Chat läuft) genutzt, um den alten Verlauf zu verwerfen.
let chatBaselineTaskText = '';

/**
 * Holt den aktuellen Text aus dem Reader und synchronisiert
 * `taskText`/`taskTextWithGraphics`/`taskGraphics` damit, falls
 * sie auseinandergelaufen sind.
 * Gibt zurück, ob sich der bereinigte Aufgabentext geändert hat.
 */
function syncTaskFromReader() {
    if (!reader || typeof reader.getText !== 'function') {
        return { changed: false, newText: taskText || '' };
    }

    const readerTextWithTags = (typeof reader.getTextWithTags === 'function')
        ? (reader.getTextWithTags() || '')
        : '';
    const readerPlain = (reader.getText() || '');
    const readerPlainTrimmed = readerPlain.trim();
    const oldPlainTrimmed = (taskText || '').trim();

    if (!readerPlainTrimmed) {
        // Leerer Reader -> nichts überschreiben (z.B. während Aufgaben-Wechsel)
        return { changed: false, newText: oldPlainTrimmed };
    }

    if (readerPlainTrimmed === oldPlainTrimmed) {
        // Aufgabe unverändert - sicherstellen, dass Tags-Variante aktuell ist
        if (readerTextWithTags && readerTextWithTags !== taskTextWithGraphics) {
            taskTextWithGraphics = readerTextWithTags;
        }
        return { changed: false, newText: oldPlainTrimmed };
    }

    // Aufgabe hat sich geändert -> Globale aktualisieren
    if (readerTextWithTags &&
        (readerTextWithTags.includes('[TABELLE]') ||
         readerTextWithTags.includes('[GRAFIK]') ||
         readerTextWithTags.includes('[BILDBESCHREIBUNG]'))) {
        const { textOnly, graphics } = RechengeschichtenAPI.parseGraphicTags(readerTextWithTags);
        taskText = textOnly;
        taskTextWithGraphics = readerTextWithTags;
        taskGraphics = graphics || [];
    } else {
        taskText = readerPlain;
        taskTextWithGraphics = readerTextWithTags || readerPlain;
        taskGraphics = [];
    }

    return { changed: true, newText: (taskText || '').trim() };
}

async function handleChatSend() {
    // Wenn gerade aufgenommen wird: Aufnahme stoppen und direkt senden
    if (isRecording) {
        sendAfterRecording = true;
        stopRecording();
        return;
    }

    let message = DOM.chatInput.value.trim();
    const hasSketch = notePadReady && NotePad.hasContent();
    const hasInlineNote = creationMode === 'explore' && isInlineNotesEnabled()
        && inlineNoteReady && InlineNoteSheet.hasContent();
    // Die Notizfläche wird nur mitgesendet, wenn sie sich seit dem letzten Senden
    // geändert hat (sonst müsste die KI sie jedes Mal erneut beschreiben) und kein
    // anderes Bild angehängt ist (nur ein Bild pro Nachricht). Sie bleibt erhalten.
    const willSendInlineNote = hasInlineNote && inlineNoteDirty && !hasSketch
        && !drawingImageBase64 && !photoImageBase64;
    if (!message && !drawingImageBase64 && !photoImageBase64 && !hasSketch && !willSendInlineNote) return;

    // Doppel-Senden verhindern (Enter + Klick, schnelles Doppel-Tippen):
    // eine Anfrage zur Zeit; freigegeben im finally bzw. beim Kontextwechsel.
    if (chatSendInFlight) return;
    chatSendInFlight = true;
    if (DOM.chatSendBtn) DOM.chatSendBtn.disabled = true;
    // Generation merken: wechselt das Kind währenddessen Strategie/Aufgabe,
    // wird die verspätete Antwort unten verworfen statt in den neuen Chat gemischt.
    const myChatGen = chatRequestGeneration;

    // Zeichnungs-Prefix entfernen wenn vorhanden
    message = message.replace('[Zeichnung bereit!] ', '').replace('[Bild bereit!] ', '').trim();

    // Skizze aus NotePad bzw. Notizfläche exportieren und als drawingImageBase64 setzen
    if (hasSketch) {
        const sketchPng = await NotePad.exportPng();
        if (sketchPng) { drawingImageBase64 = sketchPng; }
    } else if (willSendInlineNote) {
        const notePng = await InlineNoteSheet.exportPng();
        if (notePng) { drawingImageBase64 = notePng; }
    }

    // Anzuhängendes Bild bestimmen (Zeichnung ODER Foto, schließen sich aus).
    // Alle drei Werte folgen derselben Vorrang-Reihenfolge (Zeichnung zuerst),
    // damit Bild, Quelle und Platzhalter nie auseinanderlaufen.
    const chatImage = drawingImageBase64 || photoImageBase64;
    const imageSource = drawingImageBase64 ? 'drawing' : 'photo';
    const imagePlaceholder = drawingImageBase64 ? 'Hier ist meine Zeichnung:' : 'Hier ist mein Foto:';

    DOM.chatInput.value = '';
    DOM.chatInput.style.borderColor = '';
    if (DOM.chatDrawBtn) DOM.chatDrawBtn.classList.remove('has-drawing');

    // User-Nachricht anzeigen
    if (chatImage) {
        appendChatMessage(message || imagePlaceholder, 'user', chatImage);
    } else {
        appendChatMessage(message, 'user');
    }
    chatHistory.push({ role: 'user', content: message || imagePlaceholder });

    DOM.chatTyping.classList.add('visible');

    try {
        // Aktuell angezeigten Aufgabentext für den System-Prompt verwenden
        syncTaskFromReader();

        // Hat sich die Aufgabe seit Chat-Start geändert? Dann alten Verlauf
        // verwerfen und mit der neuen Aufgabe frisch starten. Im Dialog-Modus
        // ändert sich der Text bewusst während der Konversation - dort nicht resetten.
        const isDialogMode = creationMode === 'dialog';
        const currentTrimmed = (taskText || '').trim();
        const baselineWasSet = !!chatBaselineTaskText;
        const taskChangedMidChat = !isDialogMode
            && baselineWasSet
            && currentTrimmed
            && currentTrimmed !== chatBaselineTaskText;

        if (taskChangedMidChat) {
            // Alle bisherigen Nachrichten gehören zur alten Aufgabe -> verwerfen,
            // damit die KI nicht durch alten Kontext verwirrt wird.
            chatHistory = [];
            chatBaselineTaskText = currentTrimmed;
            console.log('[Chat] Aufgabe hat sich geändert - alter Verlauf verworfen.');
        }

        // User-Nachricht zur (ggf. frischen) History hinzufügen
        // Wurde der Verlauf gerade geleert, ist die User-Nachricht der erste Eintrag
        if (taskChangedMidChat) {
            chatHistory.push({ role: 'user', content: message || imagePlaceholder });
        }

        // Vollstaendigen Text mit Grafiken verwenden (falls vorhanden)
        const textForAI = taskTextWithGraphics || taskText;
        let response = await RechengeschichtenAPI.sendStrategyChat(
            textForAI,
            chatHistory,
            message || 'Bitte analysiere mein Bild.',
            currentStrategy,
            taskImageBase64,
            chatImage,
            currentTaskType || 'standard',
            currentDialogCalculation,
            currentSolutionHint,
            imageSource,
            { visualize: visualizationActive, visualizePlan: currentVisualizationPlan,
              visualizeStation: appliedVisibleStations(), visualizeStationTotal: totalVisibleStations() }
        );

        // Kontext wurde während der Anfrage gewechselt (Strategie/Aufgabe):
        // verspätete Antwort verwerfen, sie gehört zum alten Chat.
        if (myChatGen !== chatRequestGeneration) return;

        // Notiz ist bei der KI angekommen -> erst wieder mitsenden, wenn sie sich ändert
        if (willSendInlineNote) { inlineNoteDirty = false; }

        // Dialog-Entwicklung: Aufgabe aus Antwort extrahieren
        if (creationMode === 'dialog') {
            const extractedTask = extractTaskFromResponse(response);
            if (extractedTask) {
                taskText = extractedTask;
                reader.setText(extractedTask);
                updateInputStateUI();
            }
        }

        // Notizbuch-Tag pruefen und verarbeiten
        if (isNotebookEnabled() && isNotebookStrategy(currentStrategy)) {
            const notebookData = checkForNotebook(response);
            if (notebookData) {
                displayNotebook(notebookData);
            }
        }
        // Immer Tag strippen (auch wenn deaktiviert), damit er nicht im Chat erscheint
        response = stripNotebookTag(response);

        // Begleiteter Plan-Modus: die KI steuert die Bühne nur per [WEITER]/[ZURUECK];
        // die gezeigten Schritte stammen aus dem festen Gesamtplan (konsistent).
        const guidedPlan = currentStrategy === 'visualize' && currentVisualizationPlan;
        if (guidedPlan) {
            await handleVisualizationControl(response);
        } else {
            // Freier Modus / Reuse: die KI liefert eigene Schritte
            const visSteps = QVHelpers.parseVisualizationSteps(response);
            if (visSteps.length && (currentStrategy === 'visualize' || visualizationActive)) {
                applyVisualizationSteps(visSteps);
            }
        }
        // Tags/Steuersignale immer aus dem Anzeigetext entfernen
        response = QVHelpers.stripVisualizationTag(response);
        response = stripVisualizationControl(response);

        // Mission-Completion pruefen
        const missionData = checkForMissionComplete(response);
        let cleanResponse = response;
        if (missionData) {
            cleanResponse = stripMissionCompleteTag(response);
        }

        // Fehler-Detektiv: Pruefen ob Kind den Fehler gefunden hat
        if (currentStrategy === 'detective' && checkIfErrorFound(cleanResponse)) {
            showRevealButton();
        }

        chatHistory.push({ role: 'assistant', content: cleanResponse });
        appendChatMessage(cleanResponse, 'bot');
        speakText(cleanResponse);
        // Erst nach der eigentlichen Bot-Nachricht den dezenten Abschluss-Hinweis anhaengen.
        // Die Urkunde wird sofort gespeichert, aber erst beim Verlassen des Modus gezeigt.
        if (missionData) handleMissionComplete(missionData);
    } catch (error) {
        console.error('Chat error:', error);
        // Fehler einer verworfenen (alten) Anfrage nicht im neuen Chat anzeigen
        if (myChatGen === chatRequestGeneration) {
            appendChatMessage('Entschuldigung, es gab einen Fehler. Bitte versuche es nochmal.', 'bot');
        }
    } finally {
        chatSendInFlight = false;
        if (DOM.chatSendBtn) DOM.chatSendBtn.disabled = false;
        DOM.chatTyping.classList.remove('visible');
        drawingImageBase64 = null; // Reset nach dem Senden
        clearChatPhoto();          // Foto-Anhang + Vorschau ebenfalls zurücksetzen
        // Die Notizfläche bleibt zum Weiterarbeiten erhalten; nur das Badge aktualisieren
        updateInlineNoteSendBadge();
        // NotePad-Szene + Vorschau nach dem Senden zurücksetzen
        if (notePadReady) { NotePad.clear(); }
        if (DOM.sketchPreview) DOM.sketchPreview.style.display = 'none';
        if (DOM.sketchPreviewImg) DOM.sketchPreviewImg.removeAttribute('src');
        if (DOM.chatDrawBtn) DOM.chatDrawBtn.classList.remove('has-drawing');
        if (isNoteActive()) { closeNoteStage(); }
        refreshDrawBtnVisibility(); // Stift-Knopf gemäß Strategie wieder anzeigen (nicht blind)
    }
}

function extractTaskFromResponse(response) {
    // Suche nach [AUFGABE]...[/AUFGABE] Tags
    const match = response.match(/\[AUFGABE\]([\s\S]*?)\[\/AUFGABE\]/);
    if (match) {
        return match[1].trim();
    }
    return null;
}

/**
 * Konvertiert Markdown-Tabellen zu HTML-Tabellen
 */
function convertMarkdownTablesToHtml(text) {
    const lines = text.split('\n');
    let result = [];
    let inTable = false;
    let tableRows = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Pruefe ob die Zeile eine Tabellen-Zeile ist (beginnt und endet mit |)
        if (line.startsWith('|') && line.endsWith('|')) {
            // Separator-Zeile (|---|---|) ueberspringen - erlaubt | dazwischen
            if (line.match(/^\|[\s\-:|]+\|$/)) {
                continue;
            }

            if (!inTable) {
                inTable = true;
                tableRows = [];
            }

            // Zellen extrahieren
            const cells = line
                .slice(1, -1) // Fuehrende und abschliessende | entfernen
                .split('|')
                .map(cell => cell.trim());
            tableRows.push(cells);
        } else {
            // Wenn wir eine Tabelle hatten, diese jetzt rendern
            if (inTable && tableRows.length > 0) {
                result.push(renderTableToHtml(tableRows));
                inTable = false;
                tableRows = [];
            }
            result.push(line);
        }
    }

    // Falls die Datei mit einer Tabelle endet
    if (inTable && tableRows.length > 0) {
        result.push(renderTableToHtml(tableRows));
    }

    return result.join('\n');
}

/**
 * Rendert Tabellen-Zeilen als HTML-Tabelle
 */
function renderTableToHtml(rows) {
    if (rows.length === 0) return '';

    let html = '<table class="word-overview-table">';

    // Erste Zeile als Header
    html += '<thead><tr>';
    rows[0].forEach(cell => {
        html += `<th>${cell}</th>`;
    });
    html += '</tr></thead>';

    // Rest als Body
    if (rows.length > 1) {
        html += '<tbody>';
        for (let i = 1; i < rows.length; i++) {
            html += '<tr>';
            rows[i].forEach(cell => {
                html += `<td>${cell}</td>`;
            });
            html += '</tr>';
        }
        html += '</tbody>';
    }

    html += '</table>';
    return html;
}

/**
 * Wandelt Rechenzeichen in deutsche Schulschreibweise um.
 * - "*" wird zum Malpunkt "·"
 * - "/" zwischen Zahlen wird zum Doppelpunkt ":" (Geteilt-Zeichen)
 * Wird nach der **fett**-Konvertierung angewendet, damit verbleibende Sterne
 * sicher Multiplikationszeichen sind. Das Slash-Pattern verlangt Ziffern auf
 * beiden Seiten, damit HTML-Tags (z.B. </strong>) oder URLs nicht betroffen sind.
 */
function formatMathSymbols(text) {
    if (!text) return text;
    text = text.replace(/\*/g, '·');
    text = text.replace(/(\d)\s*\/\s*(\d)/g, '$1 : $2');
    return text;
}

/**
 * Wandelt einfache LaTeX-Fragmente innerhalb von $...$ oder \\(...\\) in lesbares HTML um.
 * Wir wollen kein vollwertiges KaTeX/MathJax (Offline-Bundle, Größe), sondern decken die
 * paar Konstrukte ab, die das Modell typischerweise nutzt: \\cdot, \\times, \\div, \\frac,
 * ^{...}, _{...}, \\sqrt{...}. Für komplexere Math fällt die Anweisung im Prompt darauf
 * zurück, Klartext zu nutzen.
 */
function renderInlineMath(text) {
    if (!text) return text;

    // Konvertierungstabelle für LaTeX-Befehle innerhalb der Math-Region
    const convertFragment = (latex) => {
        return latex
            // Brüche: \frac{a}{b}
            .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,
                '<span class="math-frac"><span class="math-num">$1</span><span class="math-den">$2</span></span>')
            // Wurzel: \sqrt{a}
            .replace(/\\sqrt\s*\{([^{}]+)\}/g, '<span class="math-sqrt">√<span class="math-radicand">$1</span></span>')
            // Operatoren
            .replace(/\\cdot/g, '·')
            .replace(/\\times/g, '×')
            .replace(/\\div/g, '÷')
            .replace(/\\pm/g, '±')
            .replace(/\\leq/g, '≤')
            .replace(/\\geq/g, '≥')
            .replace(/\\neq/g, '≠')
            .replace(/\\approx/g, '≈')
            // Hoch-/Tiefstellung mit oder ohne {}
            .replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>')
            .replace(/\^(\w)/g, '<sup>$1</sup>')
            .replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>')
            .replace(/_(\w)/g, '<sub>$1</sub>')
            // Übrig gebliebene Backslash-Befehle entfernen (z.B. \mathrm), Inhalt behalten
            .replace(/\\[a-zA-Z]+\s*\{([^{}]*)\}/g, '$1')
            .replace(/\\[a-zA-Z]+/g, '');
    };

    // Display-Math: $$...$$ oder \[...\]
    text = text.replace(/\$\$([^$]+)\$\$/g, (_, m) => `<span class="math-display">${convertFragment(m)}</span>`);
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `<span class="math-display">${convertFragment(m)}</span>`);
    // Inline-Math: $...$ oder \(...\)
    text = text.replace(/\$([^$\n]+)\$/g, (_, m) => `<span class="math-inline">${convertFragment(m)}</span>`);
    text = text.replace(/\\\(([^)]+)\\\)/g, (_, m) => `<span class="math-inline">${convertFragment(m)}</span>`);

    return text;
}

function appendChatMessage(text, sender, imageBase64 = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;

    // Bild anzeigen wenn vorhanden (fuer User-Zeichnungen)
    if (imageBase64 && sender === 'user') {
        const img = document.createElement('img');
        img.src = imageBase64;
        img.className = 'chat-drawing-preview';
        img.alt = 'Bild';
        messageDiv.appendChild(img);
        if (text) {
            const textDiv = document.createElement('div');
            textDiv.textContent = text;
            messageDiv.appendChild(textDiv);
        }
        DOM.chatMessages.appendChild(messageDiv);
        DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
        return;
    }

    // Fuer Bot-Nachrichten: Markup parsen und formatieren
    if (sender === 'bot') {
        // Strategie-Attribut setzen fuer CSS-Styling
        if (currentStrategy) {
            messageDiv.setAttribute('data-strategy', currentStrategy);
        }

        // Markup-Anweisungen parsen
        const { cleanResponse, markupInstructions } = RechengeschichtenAPI.parseMarkupInstructions(text);

        // Text formatieren
        let formattedText = cleanResponse;

        // Markdown-Tabellen zu HTML-Tabellen konvertieren
        formattedText = convertMarkdownTablesToHtml(formattedText);

        // **fett** zu <strong> konvertieren
        formattedText = formattedText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Aufzaehlungspunkte formatieren
        formattedText = formattedText.replace(/^- /gm, '• ');

        // Rechenzeichen in deutsche Schulschreibweise umwandeln (* → ·, / → :)
        formattedText = formatMathSymbols(formattedText);

        // Einfache LaTeX-Ausdrücke in lesbares HTML überführen
        // (\\cdot, \\times, \\frac, ^{}, _{}, \\sqrt - reicht für Schulmathematik)
        formattedText = renderInlineMath(formattedText);

        // Zeilenumbrueche sichtbar machen
        formattedText = formattedText.replace(/\n/g, '<br>');

        messageDiv.innerHTML = formattedText;

        // Markup auf den Aufgabentext anwenden (falls Anweisungen vorhanden)
        if (markupInstructions.length > 0) {
            applyMarkupToTask(markupInstructions);
        }
    } else {
        // User-Nachrichten: Einfacher Text
        messageDiv.textContent = text;
    }

    DOM.chatMessages.appendChild(messageDiv);
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

/**
 * Wendet Markup-Hervorhebungen auf den Aufgabentext an
 * @param {Array} instructions - Array von {color, text} Objekten
 */
function applyMarkupToTask(instructions) {
    if (!reader || !reader.textElement) return;

    // Vorherige Markierungen entfernen, bevor neue angewendet werden
    clearMarkupFromTask();

    if (!instructions || instructions.length === 0) return;

    const container = reader.textElement;

    // Begrenzung: Maximal 6 Markierungen gleichzeitig - sonst wird der Text "bunt-überladen".
    // Auch Duplikate über VERSCHIEDENE FARBEN ausfiltern - sonst stapelt die KI z.B. "Lisa"
    // einmal grün und einmal gelb übereinander. Erstes Vorkommen gewinnt.
    const seenTexts = new Set();
    const limitedInstructions = [];
    for (const ins of instructions) {
        const key = (ins.text || '').toLowerCase();
        if (seenTexts.has(key)) continue;
        seenTexts.add(key);
        limitedInstructions.push(ins);
        if (limitedInstructions.length >= 6) break;
    }

    limitedInstructions.forEach(instruction => {
        const cssClass = RechengeschichtenAPI.getMarkupClass(instruction.color);
        const textToMark = instruction.text;

        // Suche den Text im Reader und markiere ihn
        highlightTextInElement(container, textToMark, cssClass);
    });
}

/**
 * Entfernt alle Markup-Hervorhebungen aus dem Aufgabentext.
 * Robust gegen verschachtelte Spans und gegen unerwartete Klassennamen
 * (z.B. info-highlight als Fallback) - wir räumen so lange, bis nichts mehr da ist.
 */
function clearMarkupFromTask() {
    if (!reader || !reader.textElement) return;

    const container = reader.textElement;
    const selector = '.markup-gegeben, .markup-gesucht, .markup-unwichtig, .markup-zahl, .info-highlight, .reading-important-word';

    // Mehrere Durchläufe, damit auch nested Markup-Spans sauber abgebaut werden
    let safetyCounter = 0;
    while (safetyCounter < 10) {
        const markupSpans = container.querySelectorAll(selector);
        if (markupSpans.length === 0) break;

        markupSpans.forEach(span => {
            const parent = span.parentNode;
            if (!parent) return;
            // Inhalte (inkl. Kind-Spans) an die Position des Spans ziehen, dann Span entfernen
            while (span.firstChild) {
                parent.insertBefore(span.firstChild, span);
            }
            parent.removeChild(span);
        });

        container.normalize();
        safetyCounter++;
    }
}

/**
 * Markiert Text in einem Element mit einer CSS-Klasse
 * @param {Element} element - Das DOM-Element
 * @param {string} searchText - Der zu markierende Text
 * @param {string} cssClass - Die anzuwendende CSS-Klasse
 */
function highlightTextInElement(element, searchText, cssClass) {
    const markupClassPattern = /\b(markup-(gegeben|gesucht|unwichtig|zahl)|info-highlight)\b/;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];

    while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes(searchText)) {
            textNodes.push(walker.currentNode);
        }
    }

    textNodes.forEach(node => {
        const text = node.textContent;
        const index = text.indexOf(searchText);
        if (index < 0) return;

        const parent = node.parentNode;
        if (!parent) return;

        // Wenn der Text-Knoten bereits in einem Markup-Span lebt und exakt
        // diesem Markup-Span entspricht, NICHT noch einmal umwickeln, sondern
        // einfach die Klasse austauschen (letzte Farbe gewinnt).
        if (parent.nodeType === 1
            && parent !== element
            && markupClassPattern.test(parent.className || '')
            && parent.childNodes.length === 1
            && text === searchText) {
            parent.className = cssClass;
            return;
        }

        const before = text.substring(0, index);
        const match = text.substring(index, index + searchText.length);
        const after = text.substring(index + searchText.length);

        const span = document.createElement('span');
        span.className = cssClass;
        span.textContent = match;

        if (before) parent.insertBefore(document.createTextNode(before), node);
        parent.insertBefore(span, node);
        if (after) parent.insertBefore(document.createTextNode(after), node);
        parent.removeChild(node);
    });
}

// ===== VOICE INPUT =====

/**
 * Haelt Mikrofon, Eingabefeld und Screenreader-Text im gleichen Aufnahmezustand.
 * @param {boolean} recording - Spracheingabe laeuft
 */
function setMicRecordingState(recording) {
    if (!DOM.chatMicBtn) return;
    DOM.chatMicBtn.classList.toggle('recording', recording);
    DOM.chatMicBtn.setAttribute('aria-pressed', String(recording));
    DOM.chatMicBtn.setAttribute('aria-label', recording ? 'Spracheingabe stoppen' : 'Text einsprechen');
    DOM.chatMicBtn.setAttribute('title', recording ? 'Spracheingabe stoppen' : 'Text einsprechen');
    if (DOM.chatComposer) DOM.chatComposer.classList.toggle('is-recording', recording);
    if (DOM.chatInput) {
        DOM.chatInput.placeholder = recording ? 'Ich höre zu …' : 'Schreiben oder sprechen …';
    }
}

async function handleMicToggle() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

/**
 * Prüft, ob der Browser die Web Speech API für lokale Spracherkennung anbietet.
 * iOS Safari/WKWebView unterstützt das nicht zuverlässig, Chrome/Edge/Desktop-Safari schon.
 */
function isBrowserSpeechRecognitionAvailable() {
    return typeof window !== 'undefined' &&
           (typeof window.SpeechRecognition !== 'undefined' ||
            typeof window.webkitSpeechRecognition !== 'undefined');
}

/**
 * Prüft, ob die iOS-App eine native SFSpeechRecognizer-Session anbieten kann.
 * Wird beim Laden der WebApp vom WebViewCoordinator gesetzt.
 */
function isNativeSpeechRecognitionAvailable() {
    return window.nativeSpeechRecognitionAvailable === true
        && window.webkit?.messageHandlers?.nativeApp != null;
}

async function startRecording() {
    // Sprachausgabe stoppen, damit es sich nicht ueberlagert
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
    if (reader) {
        reader.stopReading();
    }

    // Pfadpriorität auf iOS: 1) Native SFSpeechRecognizer (on-device, offline, keine Quota)
    //                        2) Groq Whisper via Native-Proxy (wenn nativ scheitert)
    //                        3) Web Speech API (in WKWebView nicht verfügbar)
    if (isNativeSpeechRecognitionAvailable() && !nativeSpeechFailedThisSession) {
        startNativeSpeechRecognition();
        return;
    }

    // Protokoll v3.2: Ist die KI in der App-Sammlung ausgeschaltet, entfällt die
    // Spracherkennung ganz (der Mikrofon-Knopf ist dann ohnehin ausgeblendet).
    if (kiKanalStatus() === 'deaktiviert') {
        alert('Die Spracheingabe steht nicht zur Verfügung, weil die KI in der App-Sammlung ausgeschaltet ist.');
        return;
    }

    // Im Web ohne Groq-Key: Web Speech API als lokalen Fallback nutzen
    const canUseCloud = RechengeschichtenAPI.canTranscribeWithCloud();
    if (!canUseCloud && isBrowserSpeechRecognitionAvailable()) {
        startBrowserSpeechRecognition();
        return;
    }

    if (!canUseCloud && !isBrowserSpeechRecognitionAvailable()) {
        alert('Spracheingabe ist nicht verfügbar. Bitte einen Groq-API-Key in den Einstellungen eingeben oder einen Browser mit Spracherkennung nutzen.');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Nochmal stoppen nach Mikrofon-Zugriff (fuer bessere Zuverlaessigkeit)
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        // Vorhandenen Text im Eingabefeld als Präfix sichern, damit das
        // Transkript anhängt statt zu ersetzen.
        const existing = DOM.chatInput.value || '';
        cloudTranscribePrefix = (existing.length > 0 && !/\s$/.test(existing))
            ? existing + ' '
            : existing;
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            stream.getTracks().forEach(track => track.stop());
            const shouldSend = sendAfterRecording;
            sendAfterRecording = false;

            try {
                setStatus('Transkribiere...', 'processing');
                const transcription = await RechengeschichtenAPI.transcribeAudio(audioBlob);
                applyTranscriptionResult(transcription, shouldSend);
            } catch (error) {
                console.error('Transcription error:', error);
                cloudTranscribePrefix = '';
                // Fallback auf Web Speech API ist nicht möglich (Audio wurde bereits aufgenommen).
                // Wenn der Browser sie unterstützt, sollte der nächste Versuch direkt diese Strecke wählen,
                // sofern Groq dauerhaft fehlt - das deckt canTranscribeWithCloud() vor dem Aufnehmen ab.
                alert('Fehler bei der Spracherkennung: ' + error.message);
                setStatus('Bereit', 'ready');
            }
        };

        mediaRecorder.start();
        isRecording = true;
        setMicRecordingState(true);
        setStatus('Aufnahme...', 'processing');
    } catch (error) {
        console.error('Recording error:', error);
        alert('Mikrofon-Zugriff nicht möglich.');
    }
}

function stopRecording() {
    if (nativeSpeechActive) {
        // iOS-Native-SFSpeechRecognizer-Strecke
        window.webkit?.messageHandlers?.nativeApp?.postMessage({ action: 'stopSpeechRecognition' });
        return;
    }
    if (browserSpeechRecognition) {
        // Web-Speech-API-Strecke
        try {
            browserSpeechRecognition.stop();
        } catch (e) {
            // .stop() darf nach onend nicht mehr aufgerufen werden
        }
        return;
    }
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        setMicRecordingState(false);
    }
}

/**
 * Startet eine iOS-native Spracherkennung über SFSpeechRecognizer.
 * Vorteile gegenüber Cloud-Whisper: läuft on-device (offline), keine API-Quota, geringe Latenz.
 * Die WebViewCoordinator-Bridge schickt 'nativeSpeechRecognition'-CustomEvents zurück.
 */
function startNativeSpeechRecognition() {
    if (!window.webkit?.messageHandlers?.nativeApp) {
        nativeSpeechFailedThisSession = true;
        startRecording(); // Fallback erneut versuchen (jetzt ohne native)
        return;
    }

    nativeSpeechFinalText = '';
    // Vorhandenen Text als Präfix sichern, damit Erkennung anhängt statt zu ersetzen
    const existing = DOM.chatInput.value || '';
    nativeSpeechPrefix = (existing.length > 0 && !/\s$/.test(existing))
        ? existing + ' '
        : existing;
    nativeSpeechActive = true;
    isRecording = true;
    sendAfterRecording = sendAfterRecording || false;
    setMicRecordingState(true);
    setStatus('Aufnahme...', 'processing');

    window.webkit.messageHandlers.nativeApp.postMessage({ action: 'startSpeechRecognition' });
}

/**
 * Wird beim Laden der App eingehängt: empfängt Events der nativen SFSpeechRecognizer-Session.
 */
function handleNativeSpeechRecognitionEvent(event) {
    const detail = event.detail || {};
    const type = detail.event;

    if (type === 'start') {
        setStatus('Aufnahme...', 'processing');
        return;
    }

    if (type === 'result') {
        const transcript = detail.transcript || '';
        const isFinal = detail.isFinal === true;
        if (isFinal) {
            nativeSpeechFinalText = transcript;
        }
        DOM.chatInput.value = nativeSpeechPrefix + transcript;
        return;
    }

    if (type === 'end') {
        const shouldSend = sendAfterRecording;
        sendAfterRecording = false;
        nativeSpeechActive = false;
        isRecording = false;
        nativeSpeechPrefix = '';
        setMicRecordingState(false);
        setStatus('Bereit', 'ready');
        if (shouldSend && DOM.chatInput.value.trim()) {
            handleChatSend();
        }
        return;
    }

    if (type === 'error') {
        console.error('[Native Speech] error:', detail.error);
        nativeSpeechActive = false;
        isRecording = false;
        nativeSpeechPrefix = '';
        setMicRecordingState(false);
        setStatus('Bereit', 'ready');

        // Bei harten Engine-Fehlern und im Simulator (no_microphone_input) auf Groq-Whisper-Pfad
        // zurückfallen, sodass der User trotzdem diktieren kann.
        // permission_denied/restricted lassen wir liegen - dort ist Hilfe in den iOS-Einstellungen nötig.
        const fallbackErrors = [
            'recognizer_unavailable',
            'audio_session_failed',
            'audio_engine_failed',
            'request_creation_failed',
            'no_microphone_input',
            'microphone_permission_denied'
        ];
        const isFallbackable = fallbackErrors.some(prefix => (detail.error || '').startsWith(prefix));
        if (isFallbackable && RechengeschichtenAPI.canTranscribeWithCloud()) {
            nativeSpeechFailedThisSession = true;
            console.log('[Native Speech] Fehler erkannt, falle auf Groq Whisper zurück:', detail.error);
            startRecording();
            return;
        }

        if (detail.error === 'permission_denied') {
            alert('Bitte erlaube die Spracherkennung in den iOS-Einstellungen, um diktieren zu können.');
        } else if (detail.error === 'microphone_permission_denied') {
            alert('Bitte erlaube den Mikrofon-Zugriff in den iOS-Einstellungen, um diktieren zu können.');
        } else if (detail.error !== 'aborted') {
            console.warn('Spracherkennung-Fehler:', detail.error);
        }
        return;
    }
}

/**
 * Lokale Spracherkennung über die Web Speech API als Fallback,
 * wenn weder ein Groq-Key noch der iOS-Native-Proxy verfügbar sind.
 * Hinweis: In iOS-Safari/WKWebView ist diese API nicht verlässlich verfügbar -
 * dort sollte Groq über den nativen Proxy laufen.
 */
function startBrowserSpeechRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
        alert('Spracheingabe wird in diesem Browser nicht unterstützt.');
        return;
    }

    const recognition = new Recognition();
    recognition.lang = 'de-DE';
    recognition.interimResults = true;
    // Kontinuierlich erkennen, damit eine kurze Sprechpause die Session nicht
    // beendet. Das tatsächliche Ende steuert der Silence-Timer (siehe unten)
    // oder ein expliziter Klick auf den Mikrofon-Button.
    recognition.continuous = true;
    browserSpeechFinalText = '';
    // Vorhandenen Eingabetext als Präfix merken, damit neue Erkennung anhängt
    // statt zu ersetzen. Falls Präfix nicht mit Leerzeichen endet, eines anhängen.
    const existing = DOM.chatInput.value || '';
    browserSpeechPrefix = (existing.length > 0 && !/\s$/.test(existing))
        ? existing + ' '
        : existing;
    clearBrowserSpeechSilenceTimer();

    recognition.onresult = (event) => {
        let interim = '';
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalText += transcript;
            } else {
                interim += transcript;
            }
        }
        if (finalText) {
            browserSpeechFinalText += finalText;
        }
        DOM.chatInput.value = browserSpeechPrefix + browserSpeechFinalText + interim;
        // Silence-Timer nach jedem Result neu starten - erst längere Pause stoppt
        scheduleBrowserSpeechSilenceStop();
    };

    recognition.onerror = (event) => {
        console.error('SpeechRecognition error:', event.error);
        // 'no-speech' kommt während längerer Pausen häufig vor - nicht alarmieren
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
            alert('Fehler bei der Spracherkennung: ' + event.error);
        }
    };

    recognition.onend = () => {
        clearBrowserSpeechSilenceTimer();
        const shouldSend = sendAfterRecording;
        sendAfterRecording = false;
        isRecording = false;
        browserSpeechRecognition = null;
        browserSpeechPrefix = '';
        setMicRecordingState(false);
        setStatus('Bereit', 'ready');
        if (shouldSend && DOM.chatInput.value.trim()) {
            handleChatSend();
        }
    };

    try {
        recognition.start();
        browserSpeechRecognition = recognition;
        isRecording = true;
        setMicRecordingState(true);
        setStatus('Aufnahme...', 'processing');
        // Auch ohne erstes Result einen Silence-Timer setzen, damit eine
        // Session, in der gar nicht gesprochen wird, irgendwann endet.
        scheduleBrowserSpeechSilenceStop();
    } catch (error) {
        console.error('SpeechRecognition start error:', error);
        alert('Spracheingabe konnte nicht gestartet werden.');
    }
}

function scheduleBrowserSpeechSilenceStop() {
    clearBrowserSpeechSilenceTimer();
    browserSpeechSilenceTimer = setTimeout(() => {
        browserSpeechSilenceTimer = null;
        if (browserSpeechRecognition) {
            try {
                browserSpeechRecognition.stop();
            } catch (e) {
                // .stop() nach onend ist ok zu ignorieren
            }
        }
    }, BROWSER_SPEECH_SILENCE_MS);
}

function clearBrowserSpeechSilenceTimer() {
    if (browserSpeechSilenceTimer) {
        clearTimeout(browserSpeechSilenceTimer);
        browserSpeechSilenceTimer = null;
    }
}

function applyTranscriptionResult(transcription, shouldSend) {
    const combined = (cloudTranscribePrefix || '') + transcription;
    cloudTranscribePrefix = '';
    if (shouldSend && combined.trim()) {
        DOM.chatInput.value = combined;
        setStatus('Bereit', 'ready');
        handleChatSend();
    } else {
        DOM.chatInput.value = combined;
        setStatus('Bereit', 'ready');
    }
}

// ===== TEXT-TO-SPEECH =====

function speakTooltipText(text) {
    if (!soundEnabled) return;

    const speechText = RechengeschichtenAPI.parseMarkupInstructions(text).cleanResponse;
    if (speechText) {
        speakText(speechText);
    }
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    updateSoundButton();

    // Bei Deaktivierung aktuelle Sprachausgabe stoppen
    if (!soundEnabled) {
        stopSpeaking();
    }
}

function updateSoundButton() {
    if (!DOM.btnToggleSound) return;

    const icon = DOM.btnToggleSound.querySelector('svg');
    if (soundEnabled) {
        DOM.btnToggleSound.classList.remove('sound-off');
        DOM.btnToggleSound.setAttribute('title', 'Ton deaktivieren');
        DOM.btnToggleSound.setAttribute('aria-label', 'Ton deaktivieren');
        icon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>';
    } else {
        DOM.btnToggleSound.classList.add('sound-off');
        DOM.btnToggleSound.setAttribute('title', 'Ton aktivieren');
        DOM.btnToggleSound.setAttribute('aria-label', 'Ton aktivieren');
        icon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>';
    }
}

// ===== NOTEPAD (Zeichenfeld) =====

/**
 * Kleiner HTML-Escape-Helfer (wird für Objekt-Labels in der Leiste benötigt).
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function ensureNotePad() {
    if (notePadReady) { NotePad.resize(); return; }
    NotePad.init(DOM.drawingCanvas, { onChange: updateSketchPreview });
    notePadReady = true;
}

// Notizfeld-Höhe per Ziehen am oberen Rand anpassen (verändert die Höhe der oberen Reihe via --note-top-h)
function initNoteResize() {
    const handle = DOM.noteResizeHandle;
    if (!handle || !DOM.mainEl) return;
    let dragging = false;

    const onMove = (e) => {
        if (!dragging) return;
        e.preventDefault();
        const wrap = DOM.taskChatWrapper || DOM.mainEl;
        const wrapTop = wrap.getBoundingClientRect().top;
        const mainBottom = DOM.mainEl.getBoundingClientRect().bottom;
        // Neue Höhe der oberen Reihe = Abstand vom oberen Rand der Reihe bis zum Finger
        let topH = e.clientY - wrapTop;
        const min = 120;                                   // obere Reihe nicht zu klein
        const max = Math.max(min, mainBottom - wrapTop - 160); // Notizfeld mind. ~160px lassen
        topH = Math.max(min, Math.min(max, topH));
        DOM.mainEl.style.setProperty('--note-top-h', topH + 'px');
        if (notePadReady) NotePad.resize();
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        if (notePadReady) NotePad.resize();
    };
    handle.addEventListener('pointerdown', (e) => {
        dragging = true;
        e.preventDefault();
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    });
}

function wireNoteToolbar() {
    if (DOM.toolPen) {
        DOM.toolPen.addEventListener('click', () => {
            NotePad.setTool('pen');
            DOM.toolPen.classList.add('selected');
            if (DOM.toolEraser) DOM.toolEraser.classList.remove('selected');
        });
    }
    if (DOM.toolEraser) {
        DOM.toolEraser.addEventListener('click', () => {
            NotePad.setTool('eraser');
            DOM.toolEraser.classList.add('selected');
            if (DOM.toolPen) DOM.toolPen.classList.remove('selected');
        });
    }
    if (DOM.noteSizes) {
        DOM.noteSizes.forEach(btn => btn.addEventListener('click', () => {
            NotePad.setSize(btn.dataset.size);
            DOM.noteSizes.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        }));
    }
    if (DOM.colorOptions) {
        DOM.colorOptions.forEach(opt => opt.addEventListener('click', () => {
            NotePad.setColor(opt.dataset.color);
            DOM.colorOptions.forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            // Farbe wählen heißt: Stift aktiv
            if (DOM.toolPen) DOM.toolPen.classList.add('selected');
            if (DOM.toolEraser) DOM.toolEraser.classList.remove('selected');
        }));
    }
    if (DOM.btnNoteUndo) {
        DOM.btnNoteUndo.addEventListener('click', () => NotePad.undo());
    }
    if (DOM.btnClearCanvas) {
        DOM.btnClearCanvas.addEventListener('click', () => NotePad.clear());
    }
    if (DOM.btnToggleGrid) {
        DOM.btnToggleGrid.addEventListener('click', () => {
            const on = DOM.noteCanvasWrap.classList.toggle('grid-on');
            DOM.btnToggleGrid.classList.toggle('selected', on);
        });
    }
    if (DOM.btnNoteObjects) {
        DOM.btnNoteObjects.addEventListener('click', () => toggleObjectTray());
    }
    // Vorschau: Tippen öffnet Bühne wieder; × verwirft Skizze
    if (DOM.sketchPreviewImg) {
        DOM.sketchPreviewImg.addEventListener('click', () => { openDrawingArea(); });
    }
    if (DOM.sketchPreviewRemove) {
        DOM.sketchPreviewRemove.addEventListener('click', () => {
            if (notePadReady) { NotePad.clear(); }
            updateSketchPreview();
        });
    }
    window.addEventListener('resize', () => { if (isNoteActive()) { NotePad.resize(); } });
}

function isNoteActive() {
    return DOM.mainEl && DOM.mainEl.classList.contains('note-active');
}

function openDrawingArea() {
    DOM.mainEl.classList.add('note-active');
    if (DOM.chatDrawBtn) DOM.chatDrawBtn.classList.add('active');
    // Nach Layout-Wechsel Canvas vermessen (doppeltes rAF wie zuvor)
    requestAnimationFrame(() => requestAnimationFrame(() => {
        ensureNotePad();
        NotePad.resize();
    }));
    maybeShowObjectsButton();
    // Beim Bearbeiten: Vorschau ausblenden, Stift-Knopf wieder zeigen (schließt die Bühne)
    updateSketchPreview();
}

function closeNoteStage() {
    DOM.mainEl.classList.remove('note-active');
    if (DOM.chatDrawBtn) DOM.chatDrawBtn.classList.remove('active');
    hideObjectTray();
    updateSketchPreview(); // erzeugt/aktualisiert die Vorschau, falls Inhalt vorhanden
}

function hideObjectTray() {
    objectTrayOpen = false;
    if (DOM.noteObjectTray) { DOM.noteObjectTray.style.display = 'none'; }
}

// Zeichen-Strategien, in denen der Stift-/Notiz-Knopf erscheint
function isDrawStrategy(s) {
    return s === 'solve' || s === 'check' || s === 'assumptions' || s === 'detective';
}

// Sichtbarkeit des Stift-Knopfs zentral setzen: eine sichtbare Skizzen-Vorschau ersetzt ihn;
// sonst erscheint er nur in Zeichen-Strategien. Verhindert, dass ein blindes display=''
// ihn in Nicht-Zeichen-Strategien (z. B. „Fragen stellen", „Text verstehen") fälschlich einblendet.
function refreshDrawBtnVisibility() {
    if (!DOM.chatDrawBtn) return;
    const previewShown = !!(DOM.sketchPreview && DOM.sketchPreview.style.display === '');
    // Ist die integrierte Notizfläche aktiv, ersetzt sie den Zeichnen-Knopf komplett
    // (sonst gäbe es zwei konkurrierende Skizzen).
    const inlineActive = creationMode === 'explore' && isInlineNotesEnabled();
    DOM.chatDrawBtn.style.display = (!previewShown && !inlineActive && isDrawStrategy(currentStrategy)) ? 'flex' : 'none';
}

async function updateSketchPreview() {
    // Während die Bühne offen ist, ist das große Canvas die aktive Ansicht —
    // dann KEIN teures PNG-Export pro Strich. Vorschau aus, Stift-Knopf sichtbar
    // (er schaltet die Bühne zu); Vorschau entsteht erst beim Schließen.
    if (isNoteActive()) {
        if (DOM.sketchPreview) DOM.sketchPreview.style.display = 'none';
        refreshDrawBtnVisibility();
        return;
    }
    if (!notePadReady || !NotePad.hasContent()) {
        if (DOM.sketchPreview) DOM.sketchPreview.style.display = 'none';
        if (DOM.sketchPreviewImg) DOM.sketchPreviewImg.removeAttribute('src');
        if (DOM.chatDrawBtn) DOM.chatDrawBtn.classList.remove('has-drawing');
        refreshDrawBtnVisibility();
        return;
    }
    const dataUrl = await NotePad.exportPng();
    if (!dataUrl) {
        if (DOM.sketchPreview) DOM.sketchPreview.style.display = 'none';
        refreshDrawBtnVisibility();
        return;
    }
    DOM.sketchPreviewImg.src = dataUrl;
    DOM.sketchPreview.style.display = '';
    // Die Vorschau ersetzt den Stift-Knopf — Antippen der Vorschau öffnet die Notiz wieder.
    if (DOM.chatDrawBtn) DOM.chatDrawBtn.classList.add('has-drawing');
    refreshDrawBtnVisibility();
}

// ===== INTEGRIERTE NOTIZFLÄCHE (kariertes Blatt unter dem Aufgabentext) =====

function isInlineNotesEnabled() {
    return localStorage.getItem('rechengeschichten_inline_notes') !== 'false';
}

function isInlineNotesOpen() {
    return localStorage.getItem('rechengeschichten_inline_notes_open') !== 'false';
}

function ensureInlineNoteSheet() {
    if (inlineNoteReady) { InlineNoteSheet.resize(); return; }
    InlineNoteSheet.init(DOM.inlineNoteCanvas, {
        scrollEl: DOM.inlineNoteScroll,
        onChange: handleInlineNoteChange
    });
    inlineNoteReady = true;
}

// Jede Änderung an der Notiz macht sie „ungesendet" -> wird beim nächsten Senden angehängt
function handleInlineNoteChange() {
    inlineNoteDirty = true;
    updateInlineNoteSendBadge();
    updateInlineNoteRail(); // Blatt kann durch Auto-Wachstum höher geworden sein
}

// Zentrale Sichtbarkeits-Logik: Fläche in jedem Erkunden-Modus zeigen (alle Strategien),
// nie im Eingabe-/Dialog-Modus. Eingeklappt bleibt nur der „Notizen"-Chip.
function refreshInlineNoteVisibility() {
    if (!DOM.inlineNoteSheet) return;
    const active = creationMode === 'explore' && isInlineNotesEnabled();
    const open = isInlineNotesOpen();
    DOM.inlineNoteSheet.style.display = (active && open) ? 'flex' : 'none';
    if (DOM.inlineNoteReopen) {
        DOM.inlineNoteReopen.style.display = (active && !open) ? 'inline-flex' : 'none';
    }
    if (active && open) {
        // Nach Layout-Wechsel Canvas vermessen (doppeltes rAF wie bei der Bühne)
        requestAnimationFrame(() => requestAnimationFrame(() => {
            ensureInlineNoteSheet();
            autoFitInlineNoteHeight();
            updateInlineNoteMoreBtn();
            // Zweiter Durchlauf, wenn Layout-Übergänge/Schriften/Silbentrennung fertig sind
            setTimeout(autoFitInlineNoteHeight, 450);
        }));
    }
    updateInlineNoteSendBadge();
    refreshDrawBtnVisibility();
}

// Kleines ✏️-Badge am Senden-Knopf: Notiz hat Inhalt UND geht beim nächsten Senden mit
function updateInlineNoteSendBadge() {
    if (!DOM.chatSendBtn) return;
    const has = creationMode === 'explore' && isInlineNotesEnabled()
        && inlineNoteReady && inlineNoteDirty && InlineNoteSheet.hasContent();
    DOM.chatSendBtn.classList.toggle('has-note', has);
}

function updateInlineNoteMoreBtn() {
    if (!DOM.inlineNoteMore) return;
    DOM.inlineNoteMore.style.display = (inlineNoteReady && !InlineNoteSheet.canGrow()) ? 'none' : '';
}

// Tatsächliche Höhe des Textinhalts im Reader (inkl. Padding). scrollHeight taugt
// dafür NICHT: es ist bei nicht überlaufendem Inhalt immer == clientHeight, der
// freie Platz wäre damit stets 0. Ein Range misst den Inhalt selbst.
function readerTextContentHeight() {
    const textEl = reader && reader.textElement;
    if (!textEl) return null;
    try {
        const range = document.createRange();
        range.selectNodeContents(textEl);
        const contentH = range.getBoundingClientRect().height;
        const cs = getComputedStyle(textEl);
        return contentH + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    } catch (e) {
        return null;
    }
}

// Ist der Text kürzer als der Platz im Reader, wächst das Panel so weit, dass es mit
// etwas Abstand direkt unter dem Text beginnt. Bei langem Text bleibt die Standardhöhe
// (Text scrollt intern). Nach manuellem Ziehen greift die Automatik nicht mehr.
function autoFitInlineNoteHeight() {
    if (inlineNoteUserSized || !DOM.inlineNoteSheet) return;
    if (DOM.inlineNoteSheet.style.display === 'none') return;
    const textEl = reader && reader.textElement;
    const contentH = readerTextContentHeight();
    if (!textEl || contentH == null) return;
    // Von der Standardhöhe aus messen (frühere Auto-Werte zurücksetzen)
    DOM.inlineNoteSheet.style.removeProperty('--inline-note-h');
    const slack = textEl.clientHeight - contentH;
    if (slack > 24) {
        const taskSide = DOM.inlineNoteSheet.parentElement;
        const current = DOM.inlineNoteSheet.getBoundingClientRect().height;
        const max = Math.max(140, (taskSide ? taskSide.clientHeight : 600) - 200);
        const target = Math.min(max, current + slack - 16);
        if (target > current) {
            DOM.inlineNoteSheet.style.setProperty('--inline-note-h', Math.round(target) + 'px');
        }
    }
    if (inlineNoteReady) InlineNoteSheet.resize();
    updateInlineNoteRail();
}

// Eigene Scroll-Leiste rechts im Notizfeld: Daumen-Größe/-Position aus dem
// Scroll-Zustand ableiten. Immer sichtbar, solange es etwas zu scrollen gibt.
function updateInlineNoteRail() {
    const sc = DOM.inlineNoteScroll, rail = DOM.inlineNoteRail, thumb = DOM.inlineNoteThumb;
    if (!sc || !rail || !thumb) return;
    const view = sc.clientHeight, content = sc.scrollHeight;
    if (content <= view + 2) { rail.style.display = 'none'; return; }
    rail.style.display = '';
    const railH = rail.clientHeight;
    const thumbH = Math.max(36, railH * view / content);
    const maxTop = railH - thumbH;
    const top = maxTop > 0 ? maxTop * (sc.scrollTop / (content - view)) : 0;
    thumb.style.height = Math.round(thumbH) + 'px';
    thumb.style.transform = 'translateY(' + Math.round(top) + 'px)';
}

// Vorlesen/⋯ schweben unten rechts in der TEXT-Karte (nicht über dem Notizfeld):
// .task-tools ist absolut zur .task-side positioniert — der Abstand nach unten wird
// deshalb dynamisch an die Unterkante der Karte gekoppelt (wandert beim Ziehen mit).
function initTaskToolsAnchor() {
    const tools = document.getElementById('task-tools');
    if (!tools || !DOM.readerContainer) return;
    const reposition = () => {
        const side = tools.parentElement;
        if (!side) return;
        const offset = side.getBoundingClientRect().bottom
            - DOM.readerContainer.getBoundingClientRect().bottom;
        tools.style.bottom = Math.max(12, Math.round(offset) + 12) + 'px';
    };
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(reposition);
        ro.observe(DOM.readerContainer);
        if (tools.parentElement) ro.observe(tools.parentElement);
    }
    window.addEventListener('resize', reposition);
    reposition();
}

function wireInlineNoteSheet() {
    if (!DOM.inlineNoteSheet) return;
    if (DOM.inlineToolPen) {
        DOM.inlineToolPen.addEventListener('click', () => {
            InlineNoteSheet.setTool('pen');
            DOM.inlineToolPen.classList.add('selected');
            if (DOM.inlineToolEraser) DOM.inlineToolEraser.classList.remove('selected');
        });
    }
    if (DOM.inlineToolEraser) {
        DOM.inlineToolEraser.addEventListener('click', () => {
            InlineNoteSheet.setTool('eraser');
            DOM.inlineToolEraser.classList.add('selected');
            if (DOM.inlineToolPen) DOM.inlineToolPen.classList.remove('selected');
        });
    }
    DOM.inlineNoteColors.forEach(opt => opt.addEventListener('click', () => {
        InlineNoteSheet.setColor(opt.dataset.color);
        DOM.inlineNoteColors.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        // Farbe wählen heißt: Stift aktiv
        if (DOM.inlineToolPen) DOM.inlineToolPen.classList.add('selected');
        if (DOM.inlineToolEraser) DOM.inlineToolEraser.classList.remove('selected');
    }));
    if (DOM.inlineNoteUndo) {
        DOM.inlineNoteUndo.addEventListener('click', () => InlineNoteSheet.undo());
    }
    if (DOM.inlineNoteClear) {
        DOM.inlineNoteClear.addEventListener('click', () => InlineNoteSheet.clear());
    }
    if (DOM.inlineNoteMore) {
        DOM.inlineNoteMore.addEventListener('click', () => {
            if (InlineNoteSheet.grow()) {
                // Neuen Platz direkt zeigen
                if (DOM.inlineNoteScroll) DOM.inlineNoteScroll.scrollTop += 200;
            }
            updateInlineNoteMoreBtn();
            updateInlineNoteRail();
        });
    }
    // Eigene Scroll-Leiste: Daumen folgt dem Scrollen; Ziehen (Finger/Maus) scrollt
    if (DOM.inlineNoteRail && DOM.inlineNoteThumb && DOM.inlineNoteScroll) {
        DOM.inlineNoteScroll.addEventListener('scroll', updateInlineNoteRail);
        let railDrag = null;
        const moveRail = (e) => {
            if (!railDrag) return;
            e.preventDefault();
            const sc = DOM.inlineNoteScroll;
            const maxTop = railDrag.railH - railDrag.thumbH;
            if (maxTop <= 0) return;
            const top = Math.max(0, Math.min(maxTop, e.clientY - railDrag.railTop - railDrag.grab));
            sc.scrollTop = (top / maxTop) * (sc.scrollHeight - sc.clientHeight);
        };
        DOM.inlineNoteRail.addEventListener('pointerdown', (e) => {
            const railRect = DOM.inlineNoteRail.getBoundingClientRect();
            const thumbRect = DOM.inlineNoteThumb.getBoundingClientRect();
            // Treffer auf den Daumen: Griff-Position halten; sonst Daumen unter den Finger setzen
            const onThumb = e.clientY >= thumbRect.top && e.clientY <= thumbRect.bottom;
            railDrag = {
                grab: onThumb ? (e.clientY - thumbRect.top) : thumbRect.height / 2,
                thumbH: thumbRect.height,
                railTop: railRect.top,
                railH: railRect.height
            };
            try { DOM.inlineNoteRail.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
            moveRail(e);
        });
        DOM.inlineNoteRail.addEventListener('pointermove', moveRail);
        DOM.inlineNoteRail.addEventListener('pointerup', () => { railDrag = null; });
        DOM.inlineNoteRail.addEventListener('pointercancel', () => { railDrag = null; });
    }
    initTaskToolsAnchor();
    if (DOM.inlineNoteCollapse) {
        DOM.inlineNoteCollapse.addEventListener('click', () => {
            localStorage.setItem('rechengeschichten_inline_notes_open', 'false');
            refreshInlineNoteVisibility();
        });
    }
    if (DOM.inlineNoteReopen) {
        DOM.inlineNoteReopen.addEventListener('click', () => {
            localStorage.setItem('rechengeschichten_inline_notes_open', 'true');
            refreshInlineNoteVisibility();
        });
    }
    initInlineNoteResize();
    window.addEventListener('resize', () => {
        if (inlineNoteReady && DOM.inlineNoteSheet.style.display !== 'none') {
            autoFitInlineNoteHeight(); // ruft am Ende InlineNoteSheet.resize()
        }
    });
}

// Panel-Höhe per Ziehen am oberen Rand anpassen (setzt --inline-note-h am Panel)
function initInlineNoteResize() {
    const handle = DOM.inlineNoteResize;
    if (!handle || !DOM.inlineNoteSheet) return;
    let dragging = false;

    const onMove = (e) => {
        if (!dragging) return;
        e.preventDefault();
        const sheetRect = DOM.inlineNoteSheet.getBoundingClientRect();
        const taskSide = DOM.inlineNoteSheet.parentElement;
        let h = sheetRect.bottom - e.clientY;
        const max = Math.max(140, (taskSide ? taskSide.clientHeight : 600) - 200);
        h = Math.max(120, Math.min(max, h));
        DOM.inlineNoteSheet.style.setProperty('--inline-note-h', h + 'px');
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        inlineNoteUserSized = true; // manuelle Höhe hat ab jetzt Vorrang vor der Automatik
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        if (inlineNoteReady) InlineNoteSheet.resize();
        updateInlineNoteRail();
    };
    handle.addEventListener('pointerdown', (e) => {
        dragging = true;
        e.preventDefault();
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    });
}

// ===== NOTIZFELD: OBJEKT-VORSCHLÄGE =====

function isNoteObjectsEnabled() {
    return localStorage.getItem('rechengeschichten_note_objects') !== 'false';
}

function getNoteObjectSuggestions() {
    if (!isNoteObjectsEnabled()) { return Promise.resolve([]); }
    const text = (taskText || '').trim();
    if (!text) { return Promise.resolve([]); }
    // Bereits fertig gecacht
    if (noteObjectCache.text === text && noteObjectCache.items) { return Promise.resolve(noteObjectCache.items); }
    // Laufende Anfrage wiederverwenden (In-Flight-Deduplizierung)
    if (noteObjectCache.text === text && noteObjectCache.promise) { return noteObjectCache.promise; }

    const promise = (async () => {
        let raw = [];
        // 1) Bereits im Reader aufgelöste Wort-Bilder bevorzugen (keine neuen API-Aufrufe)
        try {
            if (reader && typeof reader.getWordImageStatus === 'function') {
                const status = reader.getWordImageStatus() || [];
                raw = status.filter(s => s && s.url && !s.disabled).map(s => ({ keyword: s.word, url: s.url }));
            }
        } catch (e) { /* ignorieren */ }
        // 2) Fallback: KI-Suchbegriffe -> ARASAAC erster Treffer
        if (raw.length === 0 && typeof RechengeschichtenAPI !== 'undefined' &&
            typeof RechengeschichtenAPI.suggestImageSearchTerms === 'function') {
            try {
                const map = await RechengeschichtenAPI.suggestImageSearchTerms(text);
                const words = map ? Object.keys(map) : [];
                for (const w of words.slice(0, 8)) {
                    const terms = map[w] || [w];
                    const url = await RechengeschichtenAPI.getArasaacImageUrl(terms[0]);
                    if (url) { raw.push({ keyword: w, url }); }
                }
            } catch (e) { /* ignorieren */ }
        }
        const items = NotePadHelpers.buildObjectSuggestions(raw, 8);
        noteObjectCache.items = items;
        noteObjectCache.promise = null;
        return items;
    })();

    noteObjectCache = { text, items: null, promise };
    return promise;
}

async function maybeShowObjectsButton() {
    if (DOM.btnNoteObjects) DOM.btnNoteObjects.style.display = 'none';
    if (!isNoteObjectsEnabled()) { return; }
    const items = await getNoteObjectSuggestions();
    if (items && items.length > 0) {
        if (DOM.btnNoteObjects) DOM.btnNoteObjects.style.display = '';
    }
}

async function toggleObjectTray() {
    if (objectTrayOpen) { hideObjectTray(); return; }
    const items = await getNoteObjectSuggestions();
    if (!items || items.length === 0) { hideObjectTray(); return; }
    DOM.noteObjectTray.innerHTML = '';
    items.forEach(it => {
        const el = document.createElement('button');
        el.className = 'note-object-item';
        el.innerHTML = '<img alt=""><span>' + escapeHtml(it.keyword) + '</span>';
        el.querySelector('img').src = it.url;
        el.addEventListener('click', () => { NotePad.addObject(it.url); });
        DOM.noteObjectTray.appendChild(el);
    });
    // „Suchen"-Eintrag: YAGNI — vorerst weggelassen, Vorschläge reichen fürs MVP
    DOM.noteObjectTray.style.display = 'flex';
    objectTrayOpen = true;
}

function finishDrawing() {
    closeNoteStage(); // schließt Bühne; updateSketchPreview() erzeugt die Vorschau, wenn Inhalt vorhanden
}

// ===== CREATE MODE =====


function startDialogDevelopment() {
    // Pruefen ob bereits eine Geschichte existiert
    const existingTask = reader.getText().trim();

    // Immer Optionen zeigen - auch ohne bestehende Geschichte
    showDialogDevelopmentOptions(existingTask);
}

/**
 * Zeigt Optionen fuer den Dialog-Modus an
 */
function showDialogDevelopmentOptions(existingTask) {
    // Dialog-Modus initialisieren
    initDialogDevelopmentUI();

    // Optionen basierend auf vorhandener Geschichte erstellen
    let introHtml = '';
    let modifyButtonHtml = '';

    if (existingTask) {
        introHtml = `
            <p><strong>Du hast bereits eine Rechengeschichte:</strong></p>
            <p class="existing-task-preview">"${escapeHtml(existingTask.substring(0, 100))}${existingTask.length > 100 ? '...' : ''}"</p>
        `;
        modifyButtonHtml = `
            <button class="dialog-option-btn" data-action="modify">
                <span class="option-icon">✏️</span>
                <span class="option-text">Geschichte verändern</span>
            </button>
        `;
    }

    const optionsHtml = `
        <div class="dialog-options">
            ${introHtml}
            <p>Was möchtest du tun?</p>
            <div class="dialog-option-buttons">
                ${modifyButtonHtml}
                <button class="dialog-option-btn" data-action="new">
                    <span class="option-icon">📖</span>
                    <span class="option-text">Geschichte erfinden</span>
                </button>
                <button class="dialog-option-btn" data-action="fromCalculation">
                    <span class="option-icon">🔢</span>
                    <span class="option-text">Zu einer Rechnung eine Geschichte erfinden</span>
                </button>
            </div>
        </div>
    `;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message bot';
    messageDiv.innerHTML = optionsHtml;
    DOM.chatMessages.appendChild(messageDiv);

    // Event-Listener fuer die Buttons
    messageDiv.querySelectorAll('.dialog-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            // Buttons entfernen nach Auswahl
            messageDiv.querySelector('.dialog-option-buttons').remove();

            if (action === 'modify') {
                // User-Nachricht anzeigen
                appendChatMessage('Ich möchte die Geschichte verändern.', 'user');
                chatHistory.push({ role: 'user', content: 'Ich möchte die Geschichte verändern.' });
                // Dialog zum Veraendern starten
                startModifyDialogChat(existingTask);
            } else if (action === 'new') {
                // User-Nachricht anzeigen
                appendChatMessage('Ich möchte eine Geschichte erfinden.', 'user');
                chatHistory.push({ role: 'user', content: 'Ich möchte eine Geschichte erfinden.' });
                // Aufgabe leeren und neu starten
                reader.setText('');
                updateInputStateUI();
                taskText = '';
                startDialogDevelopmentChat();
            } else if (action === 'fromCalculation') {
                // User-Nachricht anzeigen
                appendChatMessage('Ich möchte zu einer Rechnung eine Geschichte erfinden.', 'user');
                chatHistory.push({ role: 'user', content: 'Ich möchte zu einer Rechnung eine Geschichte erfinden.' });
                // Aufgabe leeren und Rechnungs-Dialog starten
                reader.setText('');
                updateInputStateUI();
                taskText = '';
                showCalculationInputOptions();
            }
        });
    });
}

/**
 * Zeigt Optionen fuer die Eingabe einer Rechenaufgabe an
 */
function showCalculationInputOptions() {
    const optionsHtml = `
        <div class="dialog-options">
            <p>Super! Hast du schon eine Rechenaufgabe, zu der du eine Geschichte erfinden möchtest?</p>
            <div class="dialog-option-buttons">
                <button class="dialog-option-btn" data-action="enterOwn">
                    <span class="option-icon">✍️</span>
                    <span class="option-text">Ja, ich gebe eine ein</span>
                </button>
                <button class="dialog-option-btn" data-action="suggest">
                    <span class="option-icon">💡</span>
                    <span class="option-text">Nein, schlage mir eine vor</span>
                </button>
            </div>
        </div>
    `;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message bot';
    messageDiv.innerHTML = optionsHtml;
    DOM.chatMessages.appendChild(messageDiv);
    speakText('Super! Hast du schon eine Rechenaufgabe, zu der du eine Geschichte erfinden möchtest?');

    // Event-Listener fuer die Buttons
    messageDiv.querySelectorAll('.dialog-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            // Buttons entfernen nach Auswahl
            messageDiv.querySelector('.dialog-option-buttons').remove();

            if (action === 'enterOwn') {
                appendChatMessage('Ja, ich gebe eine ein.', 'user');
                chatHistory.push({ role: 'user', content: 'Ja, ich gebe eine ein.' });
                showCalculationInputField();
            } else if (action === 'suggest') {
                appendChatMessage('Schlage mir eine Rechenaufgabe vor.', 'user');
                chatHistory.push({ role: 'user', content: 'Schlage mir eine Rechenaufgabe vor.' });
                startDialogFromCalculationChat(null); // null = KI schlaegt vor
            }
        });
    });
}

/**
 * Zeigt ein Eingabefeld fuer die Rechenaufgabe an
 */
function showCalculationInputField() {
    const inputHtml = `
        <div class="dialog-options">
            <p>Gib deine Rechenaufgabe ein (z.B. <strong>12 + 5</strong> oder <strong>24 : 4</strong>):</p>
            <div class="calculation-input-wrapper">
                <input type="text" class="calculation-input" placeholder="z.B. 8 + 7" autocomplete="off">
                <button class="calculation-submit-btn">Los!</button>
            </div>
        </div>
    `;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message bot';
    messageDiv.innerHTML = inputHtml;
    DOM.chatMessages.appendChild(messageDiv);
    speakText('Gib deine Rechenaufgabe ein.');

    const input = messageDiv.querySelector('.calculation-input');
    const submitBtn = messageDiv.querySelector('.calculation-submit-btn');

    // Focus auf Eingabefeld
    setTimeout(() => input.focus(), 100);

    const submitCalculation = () => {
        const calculation = input.value.trim();
        if (!calculation) return;

        // Eingabefeld deaktivieren
        input.disabled = true;
        submitBtn.disabled = true;

        // User-Nachricht anzeigen
        appendChatMessage(calculation, 'user');
        chatHistory.push({ role: 'user', content: `Meine Rechenaufgabe: ${calculation}` });

        // Dialog mit dieser Rechnung starten
        startDialogFromCalculationChat(calculation);
    };

    submitBtn.addEventListener('click', submitCalculation);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitCalculation();
    });
}

/**
 * Startet den Dialog zum Erfinden einer Geschichte zu einer Rechenaufgabe
 * @param {string|null} calculation - Die Rechenaufgabe oder null fuer KI-Vorschlag
 */
async function startDialogFromCalculationChat(calculation) {
    // Speichere die Rechnung fuer den fortlaufenden Dialog
    currentDialogCalculation = calculation;

    DOM.chatTyping.classList.add('visible');

    try {
        const startMessage = await RechengeschichtenAPI.startDialogFromCalculation(calculation);
        appendChatMessage(startMessage, 'bot');
        speakText(startMessage);
    } catch (error) {
        console.error('Dialog from calculation error:', error);
        if (calculation) {
            appendChatMessage(`Super, die Aufgabe "${calculation}"! Jetzt erfinden wir zusammen eine Geschichte dazu. In welchem Thema soll deine Geschichte spielen? Zum Beispiel: Tiere, Sport, Einkaufen...`, 'bot');
        } else {
            appendChatMessage('Wie wäre es mit dieser Aufgabe: 15 + 8? Das ist eine schöne Plus-Aufgabe! In welchem Thema soll deine Geschichte dazu spielen?', 'bot');
        }
    } finally {
        DOM.chatTyping.classList.remove('visible');
    }
}

/**
 * Initialisiert die Dialog-Entwicklungs-UI
 */
function initDialogDevelopmentUI() {
    creationMode = 'dialog';
    currentStrategy = 'dialog';
    chatHistory = [];
    chatRequestGeneration++; // laufende Chat-Anfragen gehören zum alten Kontext
    chatSendInFlight = false;
    currentDialogCalculation = null; // Reset Rechnung
    // Dialog gilt als Bearbeitungs-Modus: Notizfläche ausblenden
    refreshInlineNoteVisibility();

    // Generator-Panel schliessen falls offen
    closeGeneratorPanel();

    // Chat-Container zeigen
    DOM.chatModeLabel.textContent = 'Eigene Geschichte entwickeln';
    DOM.chatSide.appendChild(DOM.chatContainer);
    DOM.chatContainer.classList.add('visible');
    DOM.strategyList.style.display = 'none';
    DOM.chatMessages.style.display = 'flex';
    DOM.chatMessages.innerHTML = '';
    DOM.chatInputArea.style.display = 'flex';
    DOM.chatDrawBtn.style.display = 'none';
    DOM.btnBackToStrategies.style.display = 'flex';

    // Reader auf Lesemodus setzen (Text behalten falls vorhanden)
    reader.setMode('read');
}

/**
 * Startet den Dialog zum Veraendern einer bestehenden Geschichte
 */
async function startModifyDialogChat(existingTask) {
    DOM.chatTyping.classList.add('visible');

    try {
        const startMessage = await RechengeschichtenAPI.continueDialogDevelopment(existingTask);
        appendChatMessage(startMessage, 'bot');
        speakText(startMessage);
    } catch (error) {
        console.error('Modify dialog error:', error);
        appendChatMessage('Ich habe deine Geschichte gelesen! Was möchtest du verändern? Du könntest zum Beispiel die Zahlen ändern, eine andere Rechenart verwenden, oder neue Ereignisse hinzufügen.', 'bot');
    } finally {
        DOM.chatTyping.classList.remove('visible');
    }
}

async function startDialogDevelopmentChat() {
    DOM.chatTyping.classList.add('visible');

    try {
        const startMessage = await RechengeschichtenAPI.startDialogDevelopment();
        appendChatMessage(startMessage, 'bot');
        speakText(startMessage);
    } catch (error) {
        console.error('Dialog development error:', error);
        appendChatMessage('Hallo! Ich helfe dir beim Entwickeln einer Rechengeschichte. Worüber soll deine Geschichte handeln?', 'bot');
    } finally {
        DOM.chatTyping.classList.remove('visible');
    }
}

/**
 * Setzt den Chat-State zurück, wenn eine neue Aufgabe geladen wird.
 * Wichtig: VOR dem Überschreiben von taskText aufrufen.
 */
function resetChatForNewTask() {
    if (currentStrategy && chatHistory && chatHistory.length > 0) {
    }
    chatHistory = [];
    chatRequestGeneration++; // laufende Chat-Anfragen gehören zum alten Kontext
    chatSendInFlight = false;
    chatBaselineTaskText = '';
    currentStrategy = null;
    // Solution-Hint gehört zur alten Aufgabe und wird nachher neu (oder gar nicht) gesetzt
    currentSolutionHint = null;
    currentTaskType = null;
    currentTaskVisualizable = false; // fail-closed bis zur neuen Klassifikation
    classifyGeneration++; // verspätete Klassifikationen verwerfen
    if (DOM.chatMessages) {
        DOM.chatMessages.innerHTML = '';
        DOM.chatMessages.style.display = 'none';
    }
    if (DOM.chatInputArea) {
        DOM.chatInputArea.style.display = 'none';
    }
    if (DOM.strategyList) {
        DOM.strategyList.style.display = 'flex';
    }
    if (DOM.btnBackToStrategies) {
        DOM.btnBackToStrategies.style.display = 'none';
    }
    presentPendingCertificateOnExit();
    if (DOM.chatModeLabel) {
        DOM.chatModeLabel.textContent = 'Was möchtest du tun?';
    }
}

async function handleGenerateTask() {
    const topic = DOM.generatorTopic.value.trim();
    const operation = DOM.generatorOperation.value;
    const difficulty = DOM.generatorDifficulty.value;
    const isCaptainTask = DOM.generatorCaptainTask.checked;
    const isFermiTask = DOM.generatorFermiTask ? DOM.generatorFermiTask.checked : false;

    if (!RechengeschichtenAPI.hasValidApiKey()) {
        meldeKeineKi();
        return;
    }

    // Aktuelle Aufgabe vor dem Generieren speichern (fuer Undo-Funktion)
    const currentText = reader ? reader.getText().trim() : '';
    if (currentText) {
        previousTask = {
            text: taskText,
            textWithGraphics: taskTextWithGraphics || currentText,
            graphics: taskGraphics,
            taskType: currentTaskType,
            solutionHint: currentSolutionHint,
            // gegateten Klassifikations-Wert mitsichern, damit der Undo-Restore
            // keinen fail-open erzeugt (undefined !== false ergäbe sonst true)
            visualizable: currentTaskVisualizable
        };
        showUndoButton();
    }

    // Chat zurücksetzen, BEVOR die neue Aufgabe gesetzt wird.
    resetChatForNewTask();

    DOM.generateProgress.classList.add('visible');
    DOM.btnDoGenerate.disabled = true;
    setStatus('Generiere Aufgabe...', 'processing');

    try {
        const generatedTask = await RechengeschichtenAPI.generateTask(topic, operation, difficulty, isCaptainTask, isFermiTask);

        // Generator-Panel schliessen
        closeGeneratorPanel();

        // Vollstaendigen Text mit Grafik-Tags im Reader anzeigen (Reader rendert inline)
        reader.setText(generatedTask);

        // Reinen Text ohne Tags fuer interne Verwendung extrahieren
        const { textOnly, graphics } = RechengeschichtenAPI.parseGraphicTags(generatedTask);
        taskText = textOnly;
        taskTextWithGraphics = generatedTask;
        taskGraphics = graphics;

        // Generierte Aufgabe als bereits geprueft markieren
        lastCheckedTaskText = textOnly;

        // Aufgabentyp basierend auf Generierungs-Optionen setzen
        if (isFermiTask) {
            currentTaskType = 'fermi';
        } else if (isCaptainTask) {
            currentTaskType = 'captain';
        } else {
            currentTaskType = 'standard';
        }
        // Fail-closed: erst die asynchrone Klassifikation gibt Visualisieren frei
        currentTaskVisualizable = false;


        // Pädagogische Lösungsreferenz im Hintergrund generieren - damit die KI im Chat
        // eine konsistente Referenz zum Abgleich kindlicher Eingaben hat.
        // Nicht awaiten (läuft parallel, Strategie-Chat würde sonst unnötig warten).
        currentSolutionHint = null;
        const myClassifyGen = ++classifyGeneration;
        RechengeschichtenAPI.classifyTask(textOnly)
            .then(result => {
                // Nutzer hat inzwischen eine andere Aufgabe geladen - Ergebnis verwerfen
                if (myClassifyGen !== classifyGeneration) return;
                currentSolutionHint = result.solutionHint || null;
                currentTaskVisualizable = result.visualizable !== false
                    && VisualizationGuard.precheckVisualizable(textOnly).ok;
                updateVisualizeButton();
                console.log('[SolutionHint] für generierte Aufgabe geladen');
            })
            .catch(err => {
                console.warn('[SolutionHint] Generierung fehlgeschlagen:', err);
            });

        // Separaten Grafik-Container leeren (Grafiken sind jetzt inline)
        clearGraphics();

        // UI anzeigen
        DOM.readerContainer.style.display = 'block';
        reader.setMode('edit');
        setInputZonesVisible(true);

        updateUI();
        updateInputStateUI();

        const statusMessage = isFermiTask ? 'Fermi-Aufgabe generiert!' : (isCaptainTask ? 'Kapitänsaufgabe generiert!' : 'Aufgabe generiert!');
        setStatus(statusMessage, 'ready');
    } catch (error) {
        console.error('Generate error:', error);
        alert('Fehler beim Generieren: ' + error.message);
        setStatus('Fehler', 'ready');
    } finally {
        DOM.generateProgress.classList.remove('visible');
        DOM.btnDoGenerate.disabled = false;
    }
}

// ===== UNDO-FUNKTION =====

/**
 * Zeigt den Undo-Button an
 */
function showUndoButton() {
    if (DOM.btnUndoTask) {
        DOM.btnUndoTask.style.display = 'inline-flex';
    }
}

/**
 * Versteckt den Undo-Button
 */
function hideUndoButton() {
    if (DOM.btnUndoTask) {
        DOM.btnUndoTask.style.display = 'none';
    }
    previousTask = null;
}

/**
 * Stellt die vorherige Aufgabe wieder her
 */
function undoGeneratedTask() {
    if (!previousTask) {
        hideUndoButton();
        return;
    }

    // Vor dem Wechsel: laufenden Chat zur aktuellen Aufgabe sauber abschließen
    resetChatForNewTask();

    // Vorherige Aufgabe wiederherstellen
    const textToRestore = previousTask.textWithGraphics || previousTask.text || '';
    reader.setText(textToRestore);

    // Interne Variablen wiederherstellen
    taskText = previousTask.text || '';
    taskTextWithGraphics = previousTask.textWithGraphics || '';
    taskGraphics = previousTask.graphics || [];
    currentTaskType = previousTask.taskType || 'standard';
    currentSolutionHint = previousTask.solutionHint || null;
    currentTaskVisualizable = previousTask.visualizable !== false;
    classifyGeneration++; // laufende Klassifikationen gehören nicht zu dieser Aufgabe

    // Geprueften Text aktualisieren
    lastCheckedTaskText = previousTask.text || '';

    // Undo-Button verstecken (nur einmal rueckgaengig machen)
    hideUndoButton();

    // UI aktualisieren
    updateUI();
    updateInputStateUI();

    setStatus('Vorherige Aufgabe wiederhergestellt', 'ready');
}

// ===== FONT & HYPHENATION =====

/**
 * Berechnet die automatische Lese-Schriftgröße: kurze Aufgaben behalten die
 * eingestellte Größe, längere werden sanft verkleinert, damit Aufgabe und
 * Notizfeld gemeinsam auf den Bildschirm passen. Ab der Obergrenze wird
 * nicht weiter verkleinert (Lesbarkeits-Untergrenze) - dann wird gescrollt.
 * Selbstständige Funktion (wird in test/auto-font-size.test.js extrahiert).
 */
function autoFontSizeFor(textLength, baseSize) {
    const SHORT = 250;      // bis hierhin (Zeichen): keine Verkleinerung
    const LONG = 700;       // ab hier: maximale Verkleinerung erreicht
    const MIN_FACTOR = 0.8; // "etwas kleiner", nicht winzig
    const MIN_PX = 16;      // absolute Untergrenze (entspricht dem Slider-Minimum)
    const base = parseInt(baseSize, 10) || 24;
    const len = Number(textLength) || 0;
    if (len <= SHORT) return base;
    const t = Math.min(1, (len - SHORT) / (LONG - SHORT));
    const factor = 1 - t * (1 - MIN_FACTOR);
    return Math.max(Math.min(base, MIN_PX), Math.round(base * factor));
}

// Wendet die automatische Schriftgröße auf den Reader an (Basis = Slider-Wert).
function applyAutoReadingFontSize() {
    if (!reader) return;
    const base = DOM.fontSizeReading ? parseInt(DOM.fontSizeReading.value, 10) : 24;
    reader.setFontSize(autoFontSizeFor((taskText || '').length, base));
}

// Der Eingabe-Slider (#font-size) entfiel mit den Toolbars; es bleibt nur der Lese-Slider.
function handleFontSizeChangeReading() {
    const size = DOM.fontSizeReading.value;
    DOM.fontSizeValueReading.textContent = `${size}px`;
    if (creationMode === 'explore') {
        // Im Erkunden-Modus bleibt die Längen-Anpassung relativ zur neuen Basis aktiv,
        // damit Bearbeiten/Erkunden deterministisch dieselbe Größe zeigen.
        applyAutoReadingFontSize();
    } else {
        reader.setFontSize(parseInt(size));
    }
}

function syncFontSizeSliders() {
    // Nur noch der Lese-Slider existiert — Werte-Anzeige mit dem aktuellen Slider-Wert abgleichen.
    if (DOM.fontSizeReading) {
        DOM.fontSizeValueReading.textContent = `${DOM.fontSizeReading.value}px`;
    }
}

function toggleHyphenation() {
    const isHyphenated = DOM.btnHyphenate.classList.contains('active');

    if (isHyphenated) {
        reader.dehyphenateText();
        DOM.btnHyphenate.classList.remove('active');
    } else {
        reader.hyphenateText();
        DOM.btnHyphenate.classList.add('active');
    }
}

// ===== WORTBILDER / ARASAAC =====

async function handleWordImagesToggle() {
    const text = reader.getText().trim();
    if (!text) {
        return;
    }

    isWordImagesActive = !isWordImagesActive;

    if (!isWordImagesActive) {
        // Deaktivieren (Cache bleibt erhalten)
        await reader.setWordImages(false);
        updateWordImagesUI();
        setStatus('Wortbilder deaktiviert', 'ready');
        return;
    }

    // Pruefen ob Cache wiederverwendet werden kann (gleicher Text wie beim letzten Laden)
    const cacheValid = wordImagesLastText === text && Object.keys(reader.wordImageCache).length > 0;

    if (cacheValid) {
        // Cache ist aktuell - nur Anzeige wieder aktivieren
        await reader.setWordImages(true);
        updateWordImagesUI();
        setStatus('Wortbilder aktiv', 'ready');
        return;
    }

    // Aktivieren mit neuem Laden
    setStatus('Lade Wortbilder...', 'processing');

    // Mindestlaenge setzen (Standard: 4 Buchstaben)
    reader.setMinWordLengthForImages(4);

    try {
        const hasApiKey = RechengeschichtenAPI.hasValidApiKey();

        if (hasApiKey) {
            // KI-MODUS: KI waehlt wichtige Woerter aus und gibt Suchbegriffe zurueck
            setStatus('KI analysiert Text...', 'processing');

            // Cache leeren fuer frischen Start
            reader.clearWordImageCache();

            // Woerter aus dem Text extrahieren
            const allWords = extractWordsFromText(text, 4);
            console.log('Verfügbare Wörter:', allWords.length);

            // KI den Text UND die Wortliste geben
            const suggestions = await RechengeschichtenAPI.suggestImageSearchTerms(text, allWords);
            const suggestionCount = Object.keys(suggestions).length;
            console.log('KI-Vorschläge erhalten:', suggestionCount, suggestions);

            // Alle Woerter als disabled markieren (keine Standard-Suche)
            allWords.forEach(word => {
                reader.setWordImageDisabled(word, true);
            });

            if (suggestionCount > 0) {
                setStatus(`Lade ${suggestionCount} KI-optimierte Bilder...`, 'processing');

                // KI-vorgeschlagene Woerter wieder aktivieren und Bilder laden
                Object.keys(suggestions).forEach(word => {
                    reader.setWordImageDisabled(word, false);
                });

                await loadImagesWithAiSuggestions(suggestions);
            }

            // Wortbilder aktivieren
            await reader.setWordImages(true);

        } else {
            // STANDARD-MODUS: Normale Bildsuche
            await reader.setWordImages(true);
        }

        // Text merken, fuer den Bilder geladen wurden
        wordImagesLastText = text;

        updateWordImagesUI();
        setStatus('Wortbilder aktiv', 'ready');

    } catch (error) {
        console.error('Fehler beim Laden der Wortbilder:', error);
        setStatus('Fehler beim Laden der Bilder', 'error');
        isWordImagesActive = false;
        updateWordImagesUI();
    }
}

/**
 * Extrahiert eindeutige Woerter aus dem Text (lowercase)
 * @param {string} text - Der Text
 * @param {number} minLength - Mindestlaenge fuer Woerter
 * @returns {string[]}
 */
function extractWordsFromText(text, minLength = 4) {
    const cleanText = text.replace(/\u00AD/g, '');
    const words = cleanText.match(/[A-Za-zÄÖÜäöüßẞ]{2,}/g) || [];
    const filteredWords = words.filter(w => w.length >= minLength);
    return [...new Set(filteredWords.map(w => w.toLowerCase()))];
}

/**
 * Laedt Bilder fuer Woerter mit KI-optimierten Suchbegriffen
 * @param {Object<string, string[]>} suggestions - Map von Wort zu Array von Suchbegriffen
 */
async function loadImagesWithAiSuggestions(suggestions) {
    const entries = Object.entries(suggestions);
    const batchSize = 5;

    for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);

        await Promise.all(batch.map(async ([word, searchTerms]) => {
            const terms = Array.isArray(searchTerms) ? searchTerms : [searchTerms];

            for (const searchTerm of terms) {
                try {
                    const imageUrl = await RechengeschichtenAPI.getArasaacImageUrl(searchTerm);

                    if (imageUrl) {
                        console.log(`KI-Bild: "${word}" -> "${searchTerm}" -> gefunden`);
                        reader.setWordImage(word, imageUrl);
                        return;
                    } else {
                        console.log(`KI-Bild: "${word}" -> "${searchTerm}" -> nicht gefunden, versuche nächsten...`);
                    }
                } catch (error) {
                    console.warn(`Fehler bei "${word}" -> "${searchTerm}":`, error);
                }
            }

            console.log(`KI-Bild: "${word}" -> kein Bild gefunden (${terms.length} Begriffe probiert)`);
        }));
    }
}

function updateWordImagesUI() {
    if (isWordImagesActive) {
        DOM.btnWordImages.classList.add('active');
        DOM.btnWordImages.setAttribute('aria-pressed', 'true');
        DOM.btnImageManager.style.display = '';
        if (DOM.arasaacAttribution) DOM.arasaacAttribution.style.display = 'inline';
    } else {
        DOM.btnWordImages.classList.remove('active');
        DOM.btnWordImages.setAttribute('aria-pressed', 'false');
        DOM.btnImageManager.style.display = 'none';
        if (DOM.arasaacAttribution) DOM.arasaacAttribution.style.display = 'none';
    }
}

function openImageManager() {
    const wordStatus = reader.getWordImageStatus();

    if (wordStatus.length === 0) {
        return;
    }

    renderWordList(wordStatus);
    DOM.imageManagerModal.classList.add('visible');
}

function closeImageManager() {
    DOM.imageManagerModal.classList.remove('visible');
}

function addWordAndSearch() {
    const word = DOM.addWordInput.value.trim().toLowerCase();
    if (!word) return;

    if (!/^[a-zA-ZäöüÄÖÜßẞ]+$/.test(word)) {
        return;
    }

    DOM.addWordInput.value = '';
    openImageSearch(word);
}

function renderWordList(wordStatus) {
    DOM.wordListContainer.innerHTML = '';

    const wordsToShow = wordStatus.filter(item => item.url || item.disabled);

    if (wordsToShow.length === 0) {
        DOM.wordListContainer.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #6b7280;">
                Für keines der Wörter wurden Bilder gefunden.<br>
                Füge oben ein Wort hinzu oder verwende die Suche.
            </div>
        `;
        return;
    }

    wordsToShow.forEach(item => {
        const div = document.createElement('div');
        const isManuallyAdded = item.inText === false;
        div.className = `word-item ${item.disabled ? 'disabled' : ''} ${isManuallyAdded ? 'manually-added' : ''}`;
        div.dataset.word = item.word;

        const imageHtml = item.url
            ? `<img class="word-item-image" src="${item.url}" alt="${item.word}">`
            : `<div class="word-item-image no-image">?</div>`;

        const actionsHtml = isManuallyAdded
            ? `
                <button class="word-item-btn search" title="Anderes Bild suchen" aria-label="Anderes Bild für ${item.word} suchen">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                </button>
                <button class="word-item-btn delete" title="Wort entfernen" aria-label="Wort ${item.word} entfernen">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            `
            : `
                <button class="word-item-btn search" title="Anderes Bild suchen" aria-label="Anderes Bild für ${item.word} suchen">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                </button>
                <button class="word-item-btn toggle ${item.disabled ? 'disabled' : ''}" title="${item.disabled ? 'Bild aktivieren' : 'Bild deaktivieren'}" aria-label="${item.disabled ? 'Bild für ' + item.word + ' aktivieren' : 'Bild für ' + item.word + ' deaktivieren'}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        ${item.disabled
                            ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>'
                            : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>'
                        }
                    </svg>
                </button>
            `;

        const labelHtml = isManuallyAdded
            ? `<span class="word-item-text">${item.word} <span class="word-item-badge">Zusatz</span></span>`
            : `<span class="word-item-text">${item.word}</span>`;

        div.innerHTML = `
            ${imageHtml}
            ${labelHtml}
            <div class="word-item-actions">
                ${actionsHtml}
            </div>
        `;

        div.querySelector('.word-item-btn.search').addEventListener('click', () => {
            openImageSearch(item.word);
        });

        if (isManuallyAdded) {
            div.querySelector('.word-item-btn.delete').addEventListener('click', () => {
                removeManualWord(item.word);
            });
        } else {
            div.querySelector('.word-item-btn.toggle').addEventListener('click', () => {
                toggleWordImageDisabled(item.word, !item.disabled);
            });
        }

        DOM.wordListContainer.appendChild(div);
    });
}

function removeManualWord(word) {
    reader.setWordImage(word, null);
    const wordStatus = reader.getWordImageStatus();
    renderWordList(wordStatus);
}

function toggleWordImageDisabled(word, disabled) {
    reader.setWordImageDisabled(word, disabled);
    const wordStatus = reader.getWordImageStatus();
    renderWordList(wordStatus);
}

function openImageSearch(word) {
    currentSearchWord = word;
    DOM.searchWordLabel.textContent = word;
    DOM.imageSearchInput.value = word;
    DOM.searchResultsGrid.innerHTML = '';
    DOM.searchNoResults.style.display = 'none';

    DOM.imageSearchModal.classList.add('visible');
    DOM.imageSearchInput.focus();

    // Auto-search
    performImageSearch();
}

function closeImageSearch() {
    DOM.imageSearchModal.classList.remove('visible');
    currentSearchWord = null;
}

async function performImageSearch() {
    const searchTerm = DOM.imageSearchInput.value.trim();
    if (!searchTerm) return;

    DOM.searchResultsGrid.innerHTML = '';
    DOM.searchNoResults.style.display = 'none';
    DOM.searchResultsLoading.style.display = 'flex';

    try {
        const results = await RechengeschichtenAPI.searchArasaac(searchTerm);

        DOM.searchResultsLoading.style.display = 'none';

        if (results.length === 0) {
            DOM.searchNoResults.style.display = 'block';
            return;
        }

        results.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.innerHTML = `<img src="${item.url}" alt="${item.keyword}" loading="lazy">`;
            div.addEventListener('click', () => {
                selectSearchImage(item.url);
            });
            DOM.searchResultsGrid.appendChild(div);
        });
    } catch (error) {
        console.error('Fehler bei der Bildsuche:', error);
        DOM.searchResultsLoading.style.display = 'none';
        DOM.searchNoResults.style.display = 'block';
        DOM.searchNoResults.textContent = 'Fehler bei der Suche. Bitte versuche es erneut.';
    }
}

function selectSearchImage(url) {
    if (!currentSearchWord) return;

    reader.setWordImage(currentSearchWord, url);

    closeImageSearch();

    // Update image manager
    const wordStatus = reader.getWordImageStatus();
    renderWordList(wordStatus);
}

// ===== STATUS & WORD COUNT =====

function setStatus(text, state = 'ready') {
    DOM.statusText.textContent = text;
    DOM.statusDot.className = 'status-dot ' + state;
}

/**
 * Zeigt/versteckt den Annahmen-Button basierend auf Aufgabentyp
 */
function updateAssumptionsButton() {
    if (!DOM.assumptionsStrategyBtn) return;

    if (currentTaskType === 'fermi') {
        DOM.assumptionsStrategyBtn.style.display = 'flex';
    } else {
        DOM.assumptionsStrategyBtn.style.display = 'none';
    }
}

// Zentrale Freigabe: Typ ok UND KI-Flag UND deterministischer Pre-Check.
// fail-closed: currentTaskVisualizable startet false und wird nur durch Klassifikation true.
function isVisualizationAllowed() {
    if (currentTaskType !== 'standard' && currentTaskType !== null) return false;
    if (currentTaskVisualizable !== true) return false;
    try {
        return VisualizationGuard.precheckVisualizable(taskText).ok;
    } catch (e) {
        return false;
    }
}

function updateVisualizeButton() {
    const btn = document.getElementById('visualize-strategy-btn');
    if (!btn) return;
    btn.style.display = isVisualizationAllowed() ? 'flex' : 'none';
}

// Visualisierungs-Bühne ausblenden und zurücksetzen (beim Verlassen/Bearbeiten)
function hideVisualizationContainer() {
    const c = document.getElementById('visualization-container');
    if (c) c.style.display = 'none';
    visualizationActive = false;
    currentVisualizationPlan = null;
    if (typeof QuantityVisualizer !== 'undefined') QuantityVisualizer.reset();
    const showAllBtn = document.getElementById('qv-show-all-btn');
    if (showAllBtn) showAllBtn.style.display = 'none';
}

// Geschwindigkeit der Visualisierung (Slider 1-4) auf den Visualizer anwenden
const VIS_SPEED_LEVELS = { '1': 'sehr-langsam', '2': 'langsam', '3': 'mittel', '4': 'schnell' };
const VIS_SPEED_LABELS = { '1': 'Sehr langsam', '2': 'Langsam', '3': 'Mittel', '4': 'Schnell' };
function applyVisualizeSpeedFromSettings() {
    const v = DOM.visualizeSpeedSettings ? String(DOM.visualizeSpeedSettings.value) : '2';
    if (DOM.visualizeSpeedValueSettings) DOM.visualizeSpeedValueSettings.textContent = VIS_SPEED_LABELS[v] || 'Langsam';
    if (typeof QuantityVisualizer !== 'undefined') QuantityVisualizer.setSpeed(VIS_SPEED_LEVELS[v] || 'langsam');
}

function updateWordCount() {
    const text = reader.getText();
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    DOM.wordCount.textContent = `${words} Wörter`;
}

// ===== MEHRSPRACHIGKEIT =====

/**
 * Kleiner HTML-Escaper für dynamisch gerenderte Sprachnamen (Freitext).
 */
function escapeLangText(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Rendert die pflegbare Sprachliste in den Einstellungen.
 */
function renderLanguageSettingsList() {
    if (!DOM.languageList) return;
    if (!languageList.length) {
        DOM.languageList.innerHTML = '<small class="language-empty">Noch keine zusätzlichen Sprachen.</small>';
        return;
    }
    DOM.languageList.innerHTML = languageList.map(function (it) {
        return '<div class="language-settings-row" data-code="' + escapeLangText(it.code) + '">' +
            '<span class="language-flag" aria-hidden="true">' + escapeLangText(it.flag || '🌐') + '</span>' +
            '<span class="language-name" dir="auto">' + escapeLangText(it.name) + '</span>' +
            '<button type="button" class="language-remove" data-code="' + escapeLangText(it.code) + '" aria-label="' + escapeLangText(it.name) + ' entfernen">✕</button>' +
            '</div>';
    }).join('');
}

/**
 * Fuegt eine frei benannte Sprache oder einen Dialekt hinzu. Freie Eintraege sind zunaechst "nur Text"
 * (bcp47 = null) – Übersetzung funktioniert, Vorlesen nur für Preset-Sprachen
 * mit bekanntem Code. (Stimmen-Zuordnung für Freitext: spätere Erweiterung.)
 */
function addLanguageFromInput() {
    if (!DOM.languageAddInput) return;
    const name = DOM.languageAddInput.value.trim();
    if (!name) return;
    const code = (typeof slugifyLanguageCode === 'function') ? slugifyLanguageCode(name) : name.toLowerCase();
    if (!code || code === 'de' || languageList.some(function (l) { return l.code === code; })) {
        DOM.languageAddInput.value = '';
        return;
    }
    languageList.push({ code: code, name: name, bcp47: null, flag: '🌐' });
    DOM.languageAddInput.value = '';
    renderLanguageSettingsList();
    persistLanguageList();
}

/**
 * Entfernt eine Sprache aus der Liste (Event-Delegation).
 */
function handleLanguageListClick(e) {
    const btn = e.target.closest('.language-remove');
    if (!btn) return;
    const code = btn.getAttribute('data-code');
    languageList = languageList.filter(function (l) { return l.code !== code; });
    if (activeLanguageCode === code) {
        setActiveLanguage('de'); // entfernte aktive Sprache → zurück auf Deutsch
    }
    renderLanguageSettingsList();
    persistLanguageList();
}

/**
 * Liefert den zusaetzlichen Sprach-Eintrag {code,name,bcp47,flag} oder null bei Deutsch.
 */
function getActiveLanguageEntry() {
    if (!activeLanguageCode || activeLanguageCode === 'de') return null;
    if (typeof findLanguageByCode === 'function') {
        return findLanguageByCode(languageList, activeLanguageCode);
    }
    return null;
}

/**
 * Setzt die aktuell ausgewaehlte Sprache, persistiert sie und invalidiert den
 * Worterklärungs-Cache (Übersetzungen sind sprachabhängig).
 */
function setActiveLanguage(code) {
    activeLanguageCode = code || 'de';
    localStorage.setItem('rechengeschichten_active_language', activeLanguageCode);
    wordExplanationCache.clear();
    wordExplanationCacheText = null;
    updateLanguageButtonLabel();
}

/**
 * Persistiert die aktuelle Sprachliste sofort, damit der In-Memory-State und
 * der von api.js gelesene localStorage-Wert nie auseinanderlaufen.
 */
function persistLanguageList() {
    localStorage.setItem('rechengeschichten_language_list', JSON.stringify(languageList));
}

/**
 * Button-Sichtbarkeit anhand der Einstellung.
 */
function updateLanguageButtonVisibility() {
    if (!DOM.btnLanguage) return;
    // Den Wrapper ein-/ausblenden (der Wrapper ist der Anker für das Popover)
    const target = DOM.languageButtonWrap || DOM.btnLanguage;
    target.style.display = languageButtonEnabled ? '' : 'none';
    updateLanguageButtonLabel();
}

/**
 * Button-Label/-Zustand an die aktive Sprache anpassen (inkl. aria-label-Sync).
 */
function updateLanguageButtonLabel() {
    if (!DOM.btnLanguage) return;
    const labelEl = DOM.btnLanguage.querySelector('.toolbar-btn-label');
    const entry = getActiveLanguageEntry();
    if (entry) {
        // Deutsch bleibt aktiv; die ausgewaehlte Sprache kommt als weitere Lernressource hinzu.
        if (labelEl) { labelEl.textContent = 'Deutsch + ' + entry.name; labelEl.style.display = ''; }
        DOM.btnLanguage.classList.add('language-active');
        DOM.btnLanguage.setAttribute('aria-label', 'Mehrsprachige Unterstützung: Deutsch und ' + entry.name);
    } else {
        // Deutsch ist ausgewaehlt: Funktion im Menue eindeutig benennen.
        if (labelEl) { labelEl.textContent = 'Mehrsprachigkeit'; labelEl.style.display = ''; }
        DOM.btnLanguage.classList.remove('language-active');
        DOM.btnLanguage.setAttribute('aria-label', 'Sprachauswahl: Deutsch');
    }
}

/**
 * Prüft, ob für eine Sprache (bcp47) vorgelesen werden kann.
 * Nativ: optimistisch true (nicht installierte Sprache bleibt einfach still).
 * Web: nur wenn eine passende Stimme existiert.
 */
function isLanguageSpeakable(bcp47) {
    if (!bcp47) return false;
    if (window._useNativeTTS) return true;
    if (!('speechSynthesis' in window)) return false;
    if (typeof resolveVoiceForLanguage !== 'function') return false;
    return !!resolveVoiceForLanguage(bcp47, window.speechSynthesis.getVoices());
}

/**
 * Öffnet/schließt das Sprach-Dropdown über dem Leisten-Button.
 */
function toggleLanguageDropdown() {
    const existing = document.getElementById('language-dropdown');
    if (existing) { closeLanguageDropdown(); return; }
    if (!DOM.btnLanguage) return;

    const dd = document.createElement('div');
    dd.id = 'language-dropdown';
    dd.className = 'language-dropdown';
    dd.setAttribute('role', 'dialog');
    dd.setAttribute('aria-label', 'Meine Sprachen');
    DOM.btnLanguage.setAttribute('aria-expanded', 'true');

    const items = languageList.slice();
    let html = '<div class="language-dropdown-header">' +
        '<div class="language-dropdown-title">Meine Sprachen</div>' +
        '<div class="language-dropdown-subtitle">Deutsch ist immer dabei. Welche weitere Sprache hilft dir gerade?</div>' +
        '</div>';
    html += '<section class="language-thinking-card" aria-labelledby="language-thinking-title">' +
        '<div class="language-card-heading"><span class="language-card-icon" aria-hidden="true">🌍</span>' +
        '<div><div class="language-card-eyebrow" id="language-thinking-title">Zum Denken und Verstehen</div>' +
        '<p>Nutze Deutsch und, wenn du möchtest, eine weitere Sprache. Mischen ist auch okay.</p></div></div>' +
        '<div class="language-choice-list" role="group" aria-label="Deutsch und weitere Sprache">' +
        '<div class="language-dropdown-item selected language-always-active" role="checkbox" aria-checked="true" aria-disabled="true">' +
        '<span class="language-flag" aria-hidden="true">🇩🇪</span>' +
        '<span class="language-name">Deutsch</span>' +
        '<span class="language-always-label">Immer dabei</span>' +
        '<span class="language-check" aria-hidden="true">✓</span></div>' +
        items.map(function (it) {
            const selected = it.code === activeLanguageCode;
            return '<button type="button" class="language-dropdown-item' + (selected ? ' selected' : '') + '" data-code="' + escapeLangText(it.code) + '" aria-pressed="' + selected + '">' +
                '<span class="language-flag" aria-hidden="true">' + escapeLangText(it.flag || '🌐') + '</span>' +
                '<span class="language-name" dir="auto">' + escapeLangText(it.name) + '</span>' +
                '<span class="language-check" aria-hidden="true">✓</span>' +
                '</button>';
        }).join('') +
        '<button type="button" class="language-dropdown-item language-more" data-action="more">' +
        '<span class="language-symbol language-add-symbol" aria-hidden="true">＋</span>' +
        '<span class="language-name">Weitere Sprache oder Dialekt</span></button>' +
        '</div></section>' +
        '<section class="language-sharing-card" aria-labelledby="language-sharing-title">' +
        '<span class="language-card-icon" aria-hidden="true">💬</span><div>' +
        '<div class="language-card-eyebrow" id="language-sharing-title">Zum gemeinsamen Teilen</div>' +
        '<p>Wenn du dein Ergebnis in der Klasse teilst, hilft dir die App auch beim Formulieren auf Deutsch.</p>' +
        '</div></section>';
    dd.innerHTML = html;

    // In den Button-Wrapper einhängen: das Popover wird per CSS (position: absolute,
    // bottom: 100%) direkt über dem Button verankert – unabhängig von Viewport-/Scroll-
    // Eigenheiten des iOS-WebView.
    const anchor = DOM.languageButtonWrap || DOM.btnLanguage.parentElement || document.body;
    anchor.appendChild(dd);
    const anchorRect = DOM.btnLanguage.getBoundingClientRect();
    const spaceAbove = Math.max(0, anchorRect.top - 12);
    const spaceBelow = Math.max(0, window.innerHeight - anchorRect.bottom - 12);
    const opensDown = spaceAbove < 360 && spaceBelow > spaceAbove;
    dd.classList.toggle('opens-down', opensDown);
    dd.style.maxHeight = Math.max(180, Math.min(560, opensDown ? spaceBelow : spaceAbove)) + 'px';

    dd.addEventListener('click', function (e) {
        const btn = e.target.closest('.language-dropdown-item');
        if (!btn) return;
        if (btn.getAttribute('data-action') === 'more') {
            closeLanguageDropdown();
            openSettingsModal();
            const grp = document.getElementById('settings-languages');
            if (grp) grp.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        const selectedCode = btn.getAttribute('data-code');
        const selectedItem = items.find(function (item) { return item.code === selectedCode; });
        const deselectsAdditionalLanguage = selectedCode === activeLanguageCode;
        setActiveLanguage(deselectsAdditionalLanguage ? 'de' : selectedCode);
        closeLanguageDropdown();
        if (deselectsAdditionalLanguage) {
            showToast('Deutsch bleibt aktiv. Du kannst jederzeit wieder eine weitere Sprache wählen.', 'success');
        } else if (selectedItem) {
            showToast('Deutsch und ' + selectedItem.name + ' können dir jetzt beim Denken und Erklären helfen.', 'success');
        }
    });

    // Außerhalb-Klick schließt (verzögert registrieren, damit der öffnende Klick nicht sofort schließt)
    setTimeout(function () {
        document.addEventListener('click', closeLanguageDropdownOnOutside);
    }, 0);
}

function closeLanguageDropdown() {
    const dd = document.getElementById('language-dropdown');
    if (dd) dd.remove();
    if (DOM.btnLanguage) DOM.btnLanguage.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', closeLanguageDropdownOnOutside);
}

function closeLanguageDropdownOnOutside(e) {
    const dd = document.getElementById('language-dropdown');
    if (!dd) { document.removeEventListener('click', closeLanguageDropdownOnOutside); return; }
    if (!dd.contains(e.target) && DOM.btnLanguage && !DOM.btnLanguage.contains(e.target)) {
        closeLanguageDropdown();
    }
}

// ===== SETTINGS =====

function loadSettings() {
    const age = localStorage.getItem('rechengeschichten_age') || '8';
    const model = localStorage.getItem('rechengeschichten_model') || 'llama-3.3-70b-versatile';

    // Einmalige Migration: Bestandsnutzer mit dem alten Default 0.6 (zu langsam) auf
    // den neuen Default 0.9 anheben. Nur einmal pro Gerät - wenn der Nutzer
    // bewusst danach wieder 0.6 wählt, bleibt das so.
    if (!localStorage.getItem('rechengeschichten_reading_speed_migrated_v2')) {
        const oldSpeed = localStorage.getItem('rechengeschichten_reading_speed');
        if (oldSpeed === '0.6') {
            localStorage.setItem('rechengeschichten_reading_speed', '0.9');
            console.log('[Migration] Vorlesegeschwindigkeit von 0.6 auf 0.9 angehoben');
        }
        localStorage.setItem('rechengeschichten_reading_speed_migrated_v2', 'true');
    }
    const speed = localStorage.getItem('rechengeschichten_reading_speed') || '0.9';
    const showWordCount = localStorage.getItem('rechengeschichten_show_word_count') === 'true';
    const renderGraphics = localStorage.getItem('rechengeschichten_render_graphics') !== 'false'; // Standard: true
    const explanationImages = localStorage.getItem('rechengeschichten_explanation_images') !== 'false'; // Standard: true
    const showNotebook = localStorage.getItem('rechengeschichten_show_notebook') !== 'false'; // Standard: true
    const hideCaptainTask = localStorage.getItem('rechengeschichten_hide_captain_task') === 'true';
    const clearCertificatesAfterExport = localStorage.getItem('rechengeschichten_clear_certificates_after_export') === 'true';
    const googleApiKey = localStorage.getItem('rechengeschichten_google_api_key') || '';
    const apiKey = localStorage.getItem('rechengeschichten_api_key') || '';
    const openrouterWorkerUrl = localStorage.getItem('rechengeschichten_openrouter_worker_url') || '';
    const hetznerWorkerUrl = localStorage.getItem('rechengeschichten_hetzner_worker_url') || '';

    DOM.ageSlider.value = age;
    DOM.ageValue.textContent = `${age} Jahre`;
    DOM.modelSelect.value = model;
    DOM.readingSpeedSettings.value = speed;
    DOM.readingSpeedValueSettings.textContent = `${speed}x`;
    if (DOM.visualizeSpeedSettings) {
        DOM.visualizeSpeedSettings.value = localStorage.getItem('rechengeschichten_visualize_speed') || '2';
        applyVisualizeSpeedFromSettings();
    }
    DOM.showWordCount.checked = showWordCount;
    DOM.renderGraphics.checked = renderGraphics;
    explanationImagesEnabled = explanationImages; // Flag auch ohne DOM-Element setzen
    if (DOM.explanationImages) {
        DOM.explanationImages.checked = explanationImages;
    }

    // Mehrsprachigkeit laden
    languageButtonEnabled = localStorage.getItem('rechengeschichten_language_button') !== 'false'; // Standard: true
    activeLanguageCode = localStorage.getItem('rechengeschichten_active_language') || 'de';
    languageList = (typeof parseLanguageList === 'function')
        ? parseLanguageList(localStorage.getItem('rechengeschichten_language_list'))
        : [];
    if (DOM.languageButtonToggle) {
        DOM.languageButtonToggle.checked = languageButtonEnabled;
    }
    renderLanguageSettingsList();
    updateLanguageButtonVisibility();

    if (DOM.showNotebook) {
        DOM.showNotebook.checked = showNotebook;
    }
    const microAssessmentSetting = localStorage.getItem('rechengeschichten_micro_assessment_enabled');
    const microAssessmentOn = isNativeAppContext()
        ? microAssessmentSetting !== 'false'
        : microAssessmentSetting === 'true';
    if (DOM.microAssessmentEnabled) DOM.microAssessmentEnabled.checked = microAssessmentOn;
    if (DOM.photoInChat) {
        DOM.photoInChat.checked = localStorage.getItem('rechengeschichten_photo_in_chat') !== 'false';
    }
    if (DOM.noteObjectsSetting) {
        DOM.noteObjectsSetting.checked = localStorage.getItem('rechengeschichten_note_objects') !== 'false';
    }
    if (DOM.inlineNotesSetting) {
        DOM.inlineNotesSetting.checked = isInlineNotesEnabled();
    }
    DOM.hideCaptainTask.checked = hideCaptainTask;
    if (DOM.clearCertificatesAfterExport) {
        DOM.clearCertificatesAfterExport.checked = clearCertificatesAfterExport;
    }
    DOM.googleApiKey.value = googleApiKey;
    DOM.apiKey.value = apiKey;
    if (DOM.openrouterWorkerUrl) {
        DOM.openrouterWorkerUrl.value = openrouterWorkerUrl;
    }
    if (DOM.hetznerWorkerUrl) {
        DOM.hetznerWorkerUrl.value = hetznerWorkerUrl;
    }
    populateHetznerModelSelect();

    reader.setReadingSpeed(parseFloat(speed));

    // Verfuegbare Stimmen laden
    loadAvailableVoices();

    // Status-Bar ein-/ausblenden basierend auf Einstellung
    updateStatusBarVisibility();

    // Dauerhinweis zur kostenlosen Test-KI ggf. anzeigen
    updateFreeAiNoticeVisibility();
}

function saveSettings() {
    // Geänderte Altersangabe: gespeicherte Generator-Auswahl verwerfen, damit
    // die altersbasierte Voreinstellung (Klasse/Rechenarten) wieder greift
    const prevAge = localStorage.getItem('rechengeschichten_age');
    if (prevAge !== null && prevAge !== DOM.ageSlider.value) {
        localStorage.removeItem(GENERATOR_SETTINGS_KEY);
    }
    localStorage.setItem('rechengeschichten_age', DOM.ageSlider.value);
    localStorage.setItem('rechengeschichten_model', DOM.modelSelect.value);
    localStorage.setItem('rechengeschichten_voice', DOM.voiceSelect.value);
    localStorage.setItem('rechengeschichten_reading_speed', DOM.readingSpeedSettings.value);
    if (DOM.visualizeSpeedSettings) {
        localStorage.setItem('rechengeschichten_visualize_speed', DOM.visualizeSpeedSettings.value);
        applyVisualizeSpeedFromSettings();
    }
    localStorage.setItem('rechengeschichten_show_word_count', DOM.showWordCount.checked);
    localStorage.setItem('rechengeschichten_render_graphics', DOM.renderGraphics.checked);
    if (DOM.explanationImages) {
        explanationImagesEnabled = DOM.explanationImages.checked;
        localStorage.setItem('rechengeschichten_explanation_images', DOM.explanationImages.checked);
    }
    if (DOM.languageButtonToggle) {
        languageButtonEnabled = DOM.languageButtonToggle.checked;
        localStorage.setItem('rechengeschichten_language_button', DOM.languageButtonToggle.checked);
    }
    persistLanguageList();
    updateLanguageButtonVisibility();
    if (DOM.showNotebook) {
        localStorage.setItem('rechengeschichten_show_notebook', DOM.showNotebook.checked);
    }
    if (DOM.photoInChat) {
        localStorage.setItem('rechengeschichten_photo_in_chat', DOM.photoInChat.checked);
        if (typeof updateChatPhotoButtonVisibility === 'function') {
            updateChatPhotoButtonVisibility(currentStrategy);
        }
    }
    if (DOM.noteObjectsSetting) {
        localStorage.setItem('rechengeschichten_note_objects', DOM.noteObjectsSetting.checked);
    }
    if (DOM.inlineNotesSetting) {
        localStorage.setItem('rechengeschichten_inline_notes', DOM.inlineNotesSetting.checked);
        refreshInlineNoteVisibility();
    }
    // Mikro-Assessment-Einstellung speichern
    if (DOM.microAssessmentEnabled) {
        localStorage.setItem('rechengeschichten_micro_assessment_enabled', DOM.microAssessmentEnabled.checked);
    }
    localStorage.setItem('rechengeschichten_hide_captain_task', DOM.hideCaptainTask.checked);
    if (DOM.clearCertificatesAfterExport) {
        localStorage.setItem('rechengeschichten_clear_certificates_after_export', DOM.clearCertificatesAfterExport.checked);
    }

    // Stimme im Reader aktualisieren
    updateReaderVoice();

    // Status-Bar aktualisieren
    updateStatusBarVisibility();

    // Keys getrimmt verarbeiten - beim Einfügen landet oft Whitespace/Zeilenumbruch mit,
    // der sonst den startsWith-Check und die Authentifizierung scheitern lässt.
    const googleApiKeyValue = DOM.googleApiKey.value.trim();
    const groqApiKeyValue = DOM.apiKey.value.trim();

    // Google API-Key hat Prioritaet
    if (googleApiKeyValue.startsWith('AIza')) {
        localStorage.setItem('rechengeschichten_google_api_key', googleApiKeyValue);
        // Groq-Keys behalten, aber nicht loeschen (falls User spaeter wechseln will)
    } else {
        localStorage.removeItem('rechengeschichten_google_api_key');
    }

    // Groq API-Key
    if (groqApiKeyValue.startsWith('gsk_')) {
        localStorage.setItem('rechengeschichten_api_key', groqApiKeyValue);
    }

    // OpenRouter Worker-URL
    // Hetzner-Proxy-URL
    if (DOM.hetznerWorkerUrl) {
        const hetznerUrlValue = DOM.hetznerWorkerUrl.value.trim();
        if (hetznerUrlValue.startsWith('https://')) {
            localStorage.setItem('rechengeschichten_hetzner_worker_url', hetznerUrlValue);
        } else {
            localStorage.removeItem('rechengeschichten_hetzner_worker_url');
        }
    }

    if (DOM.openrouterWorkerUrl && DOM.openrouterWorkerUrl.value.startsWith('https://')) {
        localStorage.setItem('rechengeschichten_openrouter_worker_url', DOM.openrouterWorkerUrl.value.trim());
    } else {
        localStorage.removeItem('rechengeschichten_openrouter_worker_url');
    }

    // Hetzner Inference (Testoption): leerer Wert = aus
    if (DOM.hetznerModel && DOM.hetznerModel.value) {
        localStorage.setItem('rechengeschichten_hetzner_model', DOM.hetznerModel.value);
    } else {
        localStorage.removeItem('rechengeschichten_hetzner_model');
    }

    reader.setReadingSpeed(parseFloat(DOM.readingSpeedSettings.value));

    // Dauerhinweis nach Speichern aktualisieren (Provider hat sich evtl. geändert)
    updateFreeAiNoticeVisibility();

    closeSettingsModal();
}

/**
 * Fuellt das Hetzner-Modell-Dropdown aus der Modellliste in api.js
 * (dort ist die einzige Quelle - Worker-Whitelist und UI bleiben so synchron).
 * Leerer Wert = Hetzner-Test aus.
 */
function populateHetznerModelSelect() {
    if (!DOM.hetznerModel || !window.RechengeschichtenAPI) return;

    const models = window.RechengeschichtenAPI.HETZNER_MODELS || [];
    const defaultModel = window.RechengeschichtenAPI.HETZNER_DEFAULT_CHAT_MODEL;
    const selected = localStorage.getItem('rechengeschichten_hetzner_model') || '';

    DOM.hetznerModel.innerHTML = '';
    const offOption = document.createElement('option');
    offOption.value = '';
    offOption.textContent = 'Aus';
    DOM.hetznerModel.appendChild(offOption);

    for (const model of models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.id === defaultModel ? `${model.label} (Standard)` : model.label;
        DOM.hetznerModel.appendChild(option);
    }

    // Unbekannte Altwerte fallen auf "Aus" zurueck
    DOM.hetznerModel.value = models.some(m => m.id === selected) ? selected : '';
}

function resetSettings() {
    localStorage.removeItem('rechengeschichten_age');
    localStorage.removeItem('rechengeschichten_model');
    localStorage.removeItem('rechengeschichten_voice');
    localStorage.removeItem('rechengeschichten_reading_speed');
    localStorage.removeItem('rechengeschichten_show_word_count');
    localStorage.removeItem('rechengeschichten_toolbar_collapsed_input');
    localStorage.removeItem('rechengeschichten_toolbar_collapsed_explore');
    localStorage.removeItem('rechengeschichten_render_graphics');
    localStorage.removeItem('rechengeschichten_explanation_images');
    localStorage.removeItem('rechengeschichten_language_button');
    localStorage.removeItem('rechengeschichten_active_language');
    localStorage.removeItem('rechengeschichten_language_list');
    localStorage.removeItem('rechengeschichten_show_notebook');
    localStorage.removeItem('rechengeschichten_photo_in_chat');
    localStorage.removeItem('rechengeschichten_note_objects');
    localStorage.removeItem('rechengeschichten_hide_captain_task');
    localStorage.removeItem('rechengeschichten_clear_certificates_after_export');
    localStorage.removeItem('rechengeschichten_google_api_key');
    localStorage.removeItem('rechengeschichten_api_key');
    localStorage.removeItem('rechengeschichten_hetzner_model');
    localStorage.removeItem('rechengeschichten_hetzner_worker_url');
    localStorage.removeItem('rechengeschichten_openrouter_worker_url');
    loadSettings();
}

function updateStatusBarVisibility() {
    const showWordCount = localStorage.getItem('rechengeschichten_show_word_count') === 'true';
    if (showWordCount) {
        DOM.statusBar.classList.add('visible');
    } else {
        DOM.statusBar.classList.remove('visible');
    }
}

/**
 * Zeigt den Dauerhinweis zur kostenlosen Test-KI an, wenn die Webapp
 * (nicht iOS) ohne eigenen API-Key auf den OpenRouter-Fallback zurückgreift.
 */
function updateFreeAiNoticeVisibility() {
    if (!DOM.freeAiNotice) return;
    const provider = (typeof RechengeschichtenAPI !== 'undefined' && RechengeschichtenAPI.getActiveProvider)
        ? RechengeschichtenAPI.getActiveProvider()
        : null;
    const isNative = !!window.nativeApiProxyAvailable;
    // Protokoll v3.2: Stellt die App-Sammlung die KI (oder ist sie dort aus), ist der
    // Hinweis auf die kostenlose Test-KI schlicht falsch.
    const eigenerZugang = kiKanalStatus() === 'eigener-zugang';
    const showNotice = SHOW_OPENROUTER_QUALITY_NOTICE && !isNative && eigenerZugang && provider === 'openrouter';
    DOM.freeAiNotice.style.display = showNotice ? 'flex' : 'none';
}

// Hook für die native iOS-App: Wird aufgerufen, nachdem der native API-Proxy
// (window.nativeApiProxyAvailable) gesetzt wurde. Das geschieht erst nach dem Laden
// der Seite (didFinish), also nachdem die provider-abhängige UI beim Init noch vom
// Web-Fallback (OpenRouter) ausgegangen ist. Deshalb hier neu auswerten, damit der
// "kostenlose KI"-Hinweis in der nativen App (mit fest integrierter KI) verschwindet.
window.onNativeApiKeyInjected = function () {
    updateFreeAiNoticeVisibility();
};

function updateAgeValue() {
    DOM.ageValue.textContent = `${DOM.ageSlider.value} Jahre`;
}

function updateReadingSpeedValue() {
    DOM.readingSpeedValueSettings.textContent = `${DOM.readingSpeedSettings.value}x`;
}

/**
 * Laedt die verfuegbaren deutschen Stimmen und fuellt das Dropdown
 * Verwendet native iOS-Stimmen wenn verfuegbar, sonst Web Speech API
 */
function loadAvailableVoices() {
    // Pruefen ob native iOS-Stimmen verfuegbar sind
    if (window._nativeVoices && window._nativeVoices.length > 0) {
        populateNativeVoices();
        return;
    }

    if (!('speechSynthesis' in window)) {
        DOM.voiceSelect.innerHTML = '<option value="">Nicht verfügbar</option>';
        return;
    }

    const populateWebVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        const germanVoices = voices.filter(v => v.lang.startsWith('de'));

        if (germanVoices.length === 0) {
            DOM.voiceSelect.innerHTML = '<option value="">Keine deutschen Stimmen gefunden</option>';
            return;
        }

        // Stimmen sortieren: Enhanced/Premium zuerst, dann alphabetisch
        germanVoices.sort((a, b) => {
            const aIsEnhanced = a.name.includes('Enhanced') || a.name.includes('Premium') || a.localService === false;
            const bIsEnhanced = b.name.includes('Enhanced') || b.name.includes('Premium') || b.localService === false;

            if (aIsEnhanced && !bIsEnhanced) return -1;
            if (!aIsEnhanced && bIsEnhanced) return 1;
            return a.name.localeCompare(b.name);
        });

        // Dropdown befuellen
        DOM.voiceSelect.innerHTML = germanVoices.map(voice => {
            const qualityLabel = (voice.name.includes('Enhanced') || voice.name.includes('Premium'))
                ? ' ⭐' : '';
            const displayName = voice.name.replace('German ', '').replace('(Germany)', '').trim();
            return `<option value="${voice.name}">${displayName}${qualityLabel}</option>`;
        }).join('');

        // Gespeicherte Stimme laden oder beste Stimme auswaehlen
        const savedVoice = localStorage.getItem('rechengeschichten_voice');
        if (savedVoice && germanVoices.some(v => v.name === savedVoice)) {
            DOM.voiceSelect.value = savedVoice;
        } else {
            DOM.voiceSelect.value = germanVoices[0].name;
        }

        updateReaderVoice();
    };

    // Stimmen laden (bei manchen Browsern async)
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        populateWebVoices();
    } else {
        window.speechSynthesis.addEventListener('voiceschanged', populateWebVoices, { once: true });
    }
}

/**
 * Befuellt das Dropdown mit nativen iOS-Stimmen
 */
function populateNativeVoices() {
    const voices = window._nativeVoices;

    if (!voices || voices.length === 0) {
        DOM.voiceSelect.innerHTML = '<option value="">Keine Stimmen gefunden</option>';
        return;
    }

    // Dropdown befuellen (Stimmen sind bereits sortiert von iOS)
    DOM.voiceSelect.innerHTML = voices.map(voice => {
        const qualityLabel = voice.quality ? ' ⭐' : '';
        return `<option value="${voice.identifier}">${voice.name}${qualityLabel}</option>`;
    }).join('');

    // Gespeicherte Stimme laden oder beste Stimme auswaehlen
    const savedVoice = localStorage.getItem('rechengeschichten_voice');
    if (savedVoice && voices.some(v => v.identifier === savedVoice)) {
        DOM.voiceSelect.value = savedVoice;
    } else {
        // Beste Stimme (erste in der Liste = Enhanced/Premium) auswaehlen
        DOM.voiceSelect.value = voices[0].identifier;
    }

    console.log('[Voice] Native iOS-Stimmen geladen:', voices.length);
    updateReaderVoice();
}

/**
 * Gibt die aktuell ausgewaehlte Stimme zurueck (Web Speech API)
 */
function getSelectedVoice() {
    if (!('speechSynthesis' in window)) return null;

    const selectedVoiceName = localStorage.getItem('rechengeschichten_voice') || DOM.voiceSelect?.value;
    if (!selectedVoiceName) return null;

    const voices = window.speechSynthesis.getVoices();
    return voices.find(v => v.name === selectedVoiceName) || voices.find(v => v.lang.startsWith('de'));
}

/**
 * Gibt den Identifier der ausgewaehlten nativen Stimme zurueck
 */
function getSelectedNativeVoiceIdentifier() {
    return localStorage.getItem('rechengeschichten_voice') || DOM.voiceSelect?.value || null;
}

/**
 * Aktualisiert die Stimme im Reader
 */
function updateReaderVoice() {
    if (window._useNativeTTS && reader) {
        // Bei nativer TTS den Identifier speichern
        reader._nativeVoiceIdentifier = getSelectedNativeVoiceIdentifier();
    } else {
        const voice = getSelectedVoice();
        if (voice && reader) {
            reader.preferredVoice = voice;
        }
    }
}

/**
 * Spricht Text mit nativer iOS TTS oder Web Speech API
 */
function speakText(text, options = {}) {
    if (!text) return;

    // Ton-Toggle respektieren: Wenn Sprachausgabe deaktiviert ist, nicht vorlesen
    // (gilt auch beim Wechsel zwischen Strategien - Mute-Zustand bleibt erhalten)
    if (!soundEnabled) return;

    // Markup-Tags entfernen bevor der Text vorgelesen wird
    // [MARKIEREN:farbe]text[/MARKIEREN] -> text
    let cleanText = text
        .replace(/\[MARKIEREN:\w+\]([^\[]+)\[\/MARKIEREN\]/g, '$1')
        .replace(/\[HERVORHEBEN\]([^\[]+)\[\/HERVORHEBEN\]/g, '$1')
        .replace(/\[NOTIZBUCH\][\s\S]*?\[\/NOTIZBUCH\]/g, '')
        // Bindestrich/Minuszeichen zwischen Zahlen als „minus" sprechen (z. B. „5-2" -> „5 minus 2"),
        // sonst liest die Sprachausgabe „5 bis 2". Nur zwischen Ziffern -> „50-Euro-Schein" bleibt erhalten.
        // Lookahead behält die folgende Zahl, damit auch Ketten wie „5-2-1" korrekt werden.
        .replace(/(\d)\s*[-–—−]\s*(?=\d)/g, '$1 minus ')
        .trim();

    // Satz-finale Zahlen nicht als Ordnungszahl lesen („2 + 1. In …" -> „zwei plus ERSTER In …"):
    // Punkt abtrennen, echte Ordnungszahlen/Listen bleiben erhalten (speech-text-utils.js).
    // Nur hier im Chat — der Reader braucht unveränderte Offsets fürs Wort-Highlighting.
    if (window.SpeechTextUtils) {
        cleanText = SpeechTextUtils.fixNumberPeriodsForSpeech(cleanText);
    }

    if (!cleanText) return;

    const speed = options.rate || parseFloat(localStorage.getItem('rechengeschichten_reading_speed') || '0.9');
    const lang = options.lang || 'de-DE';
    const isGerman = lang.toLowerCase().indexOf('de') === 0;

    // Native iOS TTS verwenden wenn verfuegbar
    if (window._useNativeTTS && window.webkit?.messageHandlers?.nativeApp) {
        window.webkit.messageHandlers.nativeApp.postMessage({
            action: 'speak',
            text: cleanText,
            voiceIdentifier: isGerman ? getSelectedNativeVoiceIdentifier() : null,
            lang: lang,
            rate: speed,
            utteranceId: options.utteranceId || Date.now().toString()
        });
        return;
    }

    // Fallback: Web Speech API
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = lang;
        utterance.rate = speed;

        if (isGerman) {
            const selectedVoice = getSelectedVoice();
            if (selectedVoice) utterance.voice = selectedVoice;
        } else if (typeof resolveVoiceForLanguage === 'function') {
            const langVoice = resolveVoiceForLanguage(lang, window.speechSynthesis.getVoices());
            if (langVoice) utterance.voice = langVoice;
        }

        if (options.onend) {
            utterance.onend = options.onend;
        }

        window.speechSynthesis.speak(utterance);
    }
}

/**
 * Stoppt die aktuelle Sprachausgabe
 */
function stopSpeaking() {
    if (window._useNativeTTS && window.webkit?.messageHandlers?.nativeApp) {
        window.webkit.messageHandlers.nativeApp.postMessage({ action: 'stopSpeaking' });
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
}

function openSettingsModal() {
    DOM.settingsModal.classList.add('visible');
}

function closeSettingsModal() {
    DOM.settingsModal.classList.remove('visible');
}

// ===== MIKRO-ASSESSMENT =====

// Zustandsvariablen für das aktuelle Mikro-Assessment-Item
let _maItem = null;
let _maTaskHash = null;
let _maShownAt = null; // Zeitstempel fürs Anzeigen (Protokoll v3.0: dauerMs im ergebnis-Event)

/**
 * Kurzer deterministischer Hash über einen Text (Summe der CharCodes modulo 1e9).
 * Dient als isomorph_zu_task_id.
 * @param {string} text
 * @returns {number}
 */
function simpleTaskHash(text) {
    let h = 0;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) { h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0; }
    return String(h);
}

function closeMicroAssessmentModal() {
    if (DOM.microAssessmentModal) DOM.microAssessmentModal.classList.remove('visible');
    _maItem = null;
    _maShownAt = null;
}

async function maybeShowMicroAssessment(originalTaskText, taskType) {
    // Gleiche Default-Logik wie in loadSettings(): nativ standardmäßig an,
    // im Web nur nach ausdrücklicher Aktivierung (sonst widerspricht das
    // Popup der ausgeschaltet angezeigten Einstellungs-Checkbox).
    const microAssessmentSetting = localStorage.getItem('rechengeschichten_micro_assessment_enabled');
    const enabled = isNativeAppContext()
        ? microAssessmentSetting !== 'false'
        : microAssessmentSetting === 'true';
    if (!enabled || taskType !== 'standard' || !originalTaskText) return;
    const item = await RechengeschichtenAPI.generateMicroAssessmentItem(originalTaskText);
    if (!item) return;
    _maItem = item;
    _maTaskHash = simpleTaskHash(originalTaskText);
    _maShownAt = Date.now();
    if (DOM.maItemText) DOM.maItemText.textContent = item.aufgabe;
    if (DOM.maAnswerInput) DOM.maAnswerInput.value = '';
    if (DOM.maFeedback) DOM.maFeedback.textContent = '';
    if (DOM.microAssessmentModal) DOM.microAssessmentModal.classList.add('visible');
}

function handleMicroAssessmentCheck() {
    if (!_maItem || !DOM.maAnswerInput) return;
    const antwortRaw = DOM.maAnswerInput.value;
    const antwort = Number(antwortRaw);
    const korrekt = Number.isFinite(antwort) && antwort === _maItem.loesung;
    // Protokoll v3.0: bewertetes Item melden — einzige echte, KI-unabhängig
    // prüfbare Aufgabe der App (erwartete vs. tatsächliche Zahl). Sendet nur,
    // wenn der Host 'ergebnis' als capability gemeldet hat (Gate in der Bridge).
    if (window.Matheforscher && typeof window.Matheforscher.ergebnis === 'function') {
        const ergebnisPayload = {
            aufgabe: _maItem.aufgabe,
            korrekt,
            typ: 'sachaufgabe-transfer-item',
            antwort: Number.isFinite(antwort) ? String(antwort) : (antwortRaw || ''),
            erwartet: String(_maItem.loesung),
            versuche: 1,
            hilfen: 0,
            didaktik: { inhaltsbereich: 'Sachrechnen' },
            beschreibung: korrekt
                ? 'Kind löst die strukturgleiche Transferaufgabe im ersten Versuch richtig.'
                : 'Kind löst die strukturgleiche Transferaufgabe im ersten Versuch falsch.'
        };
        if (typeof _maShownAt === 'number') {
            ergebnisPayload.dauerMs = Math.max(0, Date.now() - _maShownAt);
        }
        if (!korrekt && typeof window.Matheforscher.diagnoseFehlertyp === 'function') {
            const fehlertyp = window.Matheforscher.diagnoseFehlertyp(_maItem.loesung, antwort);
            if (fehlertyp) ergebnisPayload.fehlertyp = fehlertyp;
        }
        window.Matheforscher.ergebnis(ergebnisPayload);
        if (typeof window.Matheforscher.sendReport === 'function') {
            window.Matheforscher.sendReport('sitzung'); // unaufgefordert nach abgeschlossenem Durchgang
        }
    }
    if (DOM.maFeedback) DOM.maFeedback.textContent = korrekt ? 'Super, richtig! 🎉' : 'Gut probiert!';
    // Kurz anzeigen, dann schließen (kein zweiter Versuch, keine gestuften Hinweise)
    setTimeout(() => closeMicroAssessmentModal(), 1500);
}

// ===== SHARE =====

function openShareModal() {
    // Checkboxen zuruecksetzen
    if (DOM.shareIncludeApiKey) DOM.shareIncludeApiKey.checked = false;
    if (DOM.shareIncludeSettings) DOM.shareIncludeSettings.checked = false;

    // API-Key-Option nur anzeigen wenn ein Key vorhanden ist UND nicht in der nativen App
    const isNativeApp = window.isNativeApp || window.location.protocol === 'file:';
    const hasApiKey = localStorage.getItem('rechengeschichten_google_api_key') ||
                      localStorage.getItem('rechengeschichten_api_key');
    if (DOM.shareApiKeyOption) {
        DOM.shareApiKeyOption.style.display = (hasApiKey && !isNativeApp) ? 'flex' : 'none';
    }

    updateShareUrl();
    DOM.shareModal.classList.add('visible');
}

function updateShareUrl() {
    const includeApiKey = DOM.shareIncludeApiKey ? DOM.shareIncludeApiKey.checked : false;
    const includeSettings = DOM.shareIncludeSettings ? DOM.shareIncludeSettings.checked : false;

    const shareUrl = generateShareUrl(includeApiKey, includeSettings);
    DOM.shareLinkInput.value = shareUrl;

    // Generate QR Code
    DOM.shareQrCode.innerHTML = '';

    // QR-Code nur generieren wenn URL nicht zu lang ist (max ~2000 Zeichen fuer QR-Code)
    if (shareUrl.length > 2000) {
        DOM.shareQrCode.innerHTML = '<div style="padding: 20px; text-align: center; color: #6b7280; font-size: 14px;">Die Aufgabe ist zu lang für einen QR-Code.<br>Bitte den Link kopieren.</div>';
        return;
    }

    try {
        new QRCode(DOM.shareQrCode, {
            text: shareUrl,
            width: 200,
            height: 200,
            colorDark: '#059669',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.L // Niedrigere Fehlerkorrektur fuer laengere URLs
        });
    } catch (error) {
        console.warn('QR-Code Generierung fehlgeschlagen:', error);
        DOM.shareQrCode.innerHTML = '<div style="padding: 20px; text-align: center; color: #6b7280; font-size: 14px;">QR-Code konnte nicht erstellt werden.<br>Bitte den Link kopieren.</div>';
    }
}

function closeShareModal() {
    DOM.shareModal.classList.remove('visible');
}

function generateShareUrl(includeApiKey = false, includeSettings = false) {
    // Teilen-Links zeigen auf die Adresse, unter der die App gerade läuft.
    const baseUrl = (window.location.origin && window.location.origin !== 'null')
        ? window.location.origin + window.location.pathname.replace(/\/index\.html$/, '')
        : '';
    const params = new URLSearchParams();

    // Aufgabentext komprimiert hinzufuegen (LZ-String)
    if (taskText) {
        // Pruefen ob LZ-String verfuegbar ist
        if (typeof LZString !== 'undefined') {
            const compressed = LZString.compressToEncodedURIComponent(taskText);
            params.set('t', compressed); // 't' fuer komprimierten Text
        } else {
            // Fallback ohne Komprimierung
            params.set('task', taskText);
        }
    }

    // API-Key hinzufuegen wenn gewuenscht
    if (includeApiKey) {
        const googleApiKey = localStorage.getItem('rechengeschichten_google_api_key');
        const groqApiKey = localStorage.getItem('rechengeschichten_api_key');

        if (googleApiKey) {
            params.set('gak', googleApiKey);
        } else if (groqApiKey) {
            params.set('ak', groqApiKey);
        }
    }

    // Einstellungen hinzufuegen wenn gewuenscht
    if (includeSettings) {
        const age = localStorage.getItem('rechengeschichten_age');
        if (age) params.set('age', age);
    }

    const queryString = params.toString();
    return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

function copyShareLink() {
    DOM.shareLinkInput.select();

    const showCopied = () => {
        DOM.copyFeedback.textContent = 'Link kopiert!';
        DOM.copyFeedback.classList.add('visible');
        DOM.btnCopyLink.classList.add('copied');
        setTimeout(() => {
            DOM.copyFeedback.classList.remove('visible');
            DOM.btnCopyLink.classList.remove('copied');
        }, 2000);
    };

    // Erfolg erst nach tatsächlichem Kopieren melden; ohne Clipboard-Permission
    // (z.B. unsicherer Kontext) auf execCommand über die bestehende Selektion ausweichen.
    const clipboardPromise = navigator.clipboard
        ? navigator.clipboard.writeText(DOM.shareLinkInput.value)
        : Promise.reject(new Error('Clipboard API nicht verfügbar'));
    clipboardPromise.then(showCopied).catch(() => {
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { /* nicht unterstützt */ }
        if (ok) {
            showCopied();
        } else {
            DOM.copyFeedback.textContent = 'Bitte den markierten Link selbst kopieren';
            DOM.copyFeedback.classList.add('visible');
            setTimeout(() => DOM.copyFeedback.classList.remove('visible'), 3000);
        }
    });
}

function downloadQrCode() {
    const canvas = DOM.shareQrCode.querySelector('canvas');
    if (canvas) {
        const link = document.createElement('a');
        link.download = 'rechengeschichte-qr.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }
}

function checkForSharedTask() {
    // URL-Parameter parsen (Query-String und Hash)
    const urlParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash;

    // API-Keys aus URL-Parametern uebernehmen (werden automatisch gespeichert)
    const googleApiKey = urlParams.get('gak') || urlParams.get('google_api_key');
    const groqApiKey = urlParams.get('ak') || urlParams.get('api_key');
    const age = urlParams.get('age');
    const model = urlParams.get('model');

    // Konfiguration aus URL anwenden
    if (googleApiKey && googleApiKey.startsWith('AIza')) {
        localStorage.setItem('rechengeschichten_google_api_key', googleApiKey);
    }
    if (groqApiKey && groqApiKey.startsWith('gsk_')) {
        localStorage.setItem('rechengeschichten_api_key', groqApiKey);
    }
    if (age && !isNaN(parseInt(age))) {
        const ageVal = Math.min(12, Math.max(6, parseInt(age)));
        localStorage.setItem('rechengeschichten_age', ageVal.toString());
    }
    if (model) {
        localStorage.setItem('rechengeschichten_model', model);
    }

    // Aufgabentext aus URL-Parameter oder Hash
    let sharedTask = null;

    // Zuerst komprimierten Parameter 't' pruefen (LZ-String)
    const compressedTask = urlParams.get('t');
    if (compressedTask) {
        if (typeof LZString !== 'undefined') {
            try {
                sharedTask = LZString.decompressFromEncodedURIComponent(compressedTask);
            } catch (e) {
                console.warn('Fehler beim Dekomprimieren:', e);
            }
        }
    }

    // Fallback: unkomprimierter Parameter 'task'
    if (!sharedTask) {
        sharedTask = urlParams.get('task');
    }

    // Fallback: Hash-Format (#task=...)
    if (!sharedTask && hash.startsWith('#task=')) {
        const encodedTask = hash.substring(6);
        sharedTask = decodeURIComponent(encodedTask);
    }

    if (sharedTask) {
        taskText = sharedTask;
        reader.setText(sharedTask);
        updateUI();

        // URL bereinigen (Parameter entfernen, damit sie nicht sichtbar bleiben)
        if (window.history.replaceState) {
            const cleanUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
        }
    }
}

// ===== GRAFIK-RENDERING =====

/**
 * Rendert erkannte Grafiken/Tabellen in den Grafik-Container
 * @param {Array} graphics - Array von {type, content} Objekten
 */
function renderGraphics(graphics) {
    if (!graphics || graphics.length === 0) {
        DOM.graphicContainer.style.display = 'none';
        DOM.graphicContainer.innerHTML = '';
        return;
    }

    DOM.graphicContainer.innerHTML = '';
    DOM.graphicContainer.style.display = 'flex';

    graphics.forEach((graphic, index) => {
        const view = createGraphicView(graphic);
        if (view) {
            DOM.graphicContainer.appendChild(view);
        }
    });

    // Nach dem Rendern: Schriftgroesse anpassen
    requestAnimationFrame(() => {
        adjustGraphicFontSizes();
    });
}

/**
 * Parst eine ASCII-Tabelle und konvertiert sie zu HTML
 * @param {string} content - ASCII-Tabellen-Inhalt
 * @returns {HTMLElement|null} - HTML-Tabelle oder null wenn nicht parsebar
 */
function parseAsciiTable(content) {
    const lines = content.trim().split('\n').filter(line => line.trim());
    console.log('[parseAsciiTable] lines:', lines.length, 'content preview:', content.substring(0, 100));
    if (lines.length < 2) {
        console.log('[parseAsciiTable] RETURN NULL: weniger als 2 Zeilen');
        return null;
    }

    // Versuche Pipe-Format zu erkennen: | Kopf | Wert |
    const pipeLines = lines.filter(line => line.includes('|'));
    if (pipeLines.length >= 2) {
        const table = document.createElement('table');
        table.className = 'rendered-table';

        let isHeader = true;
        let separatorFound = false;

        for (const line of lines) {
            // Trennlinie erkennen (z.B. |---|---|)
            if (/^\|?[\s\-:+|]+\|?$/.test(line)) {
                separatorFound = true;
                continue;
            }

            if (!line.includes('|')) continue;

            // Zellen extrahieren
            const cells = line.split('|')
                .map(cell => cell.trim())
                .filter((cell, idx, arr) => idx > 0 && idx < arr.length - 1 || (idx === 0 && cell) || (idx === arr.length - 1 && cell));

            if (cells.length === 0) continue;

            const row = document.createElement('tr');
            const cellTag = isHeader && !separatorFound ? 'th' : 'td';

            cells.forEach(cellContent => {
                const cell = document.createElement(cellTag);
                cell.textContent = cellContent;
                row.appendChild(cell);
            });

            if (row.children.length > 0) {
                table.appendChild(row);
            }

            if (separatorFound) {
                isHeader = false;
            } else if (isHeader && table.children.length === 1) {
                // Nach erster Zeile nicht mehr Header
                isHeader = false;
            }
        }

        console.log('[parseAsciiTable] Pipe-Format: table.children.length =', table.children.length);
        if (table.children.length >= 2) {
            console.log('[parseAsciiTable] SUCCESS: Returning table with', table.children.length, 'rows');
            return table;
        }
    }

    // Versuche Space-Aligned Format zu erkennen
    // Suche nach konsistenten Spaltentrennungen durch mehrere Spaces
    const nonEmptyLines = lines.filter(line => line.trim() && !/^[\-=+]+$/.test(line));
    if (nonEmptyLines.length >= 2) {
        // Finde Spaltenpositionen durch 2+ aufeinanderfolgende Spaces
        const firstLine = nonEmptyLines[0];
        const columnBreaks = [];
        let inSpace = false;
        let spaceStart = 0;

        for (let i = 0; i < firstLine.length; i++) {
            if (firstLine[i] === ' ') {
                if (!inSpace) {
                    spaceStart = i;
                    inSpace = true;
                }
            } else {
                if (inSpace && i - spaceStart >= 2) {
                    columnBreaks.push(Math.floor((spaceStart + i) / 2));
                }
                inSpace = false;
            }
        }

        if (columnBreaks.length >= 1) {
            const table = document.createElement('table');
            table.className = 'rendered-table';

            nonEmptyLines.forEach((line, lineIdx) => {
                const row = document.createElement('tr');
                let lastPos = 0;
                const cellTag = lineIdx === 0 ? 'th' : 'td';

                columnBreaks.forEach(breakPos => {
                    const cell = document.createElement(cellTag);
                    cell.textContent = line.substring(lastPos, breakPos).trim();
                    row.appendChild(cell);
                    lastPos = breakPos;
                });

                // Letzte Spalte
                const lastCell = document.createElement(cellTag);
                lastCell.textContent = line.substring(lastPos).trim();
                row.appendChild(lastCell);

                table.appendChild(row);
            });

            if (table.children.length >= 2) {
                return table;
            }
        }
    }

    console.log('[parseAsciiTable] RETURN NULL: Keine Tabelle erkannt');
    return null;
}

/**
 * Parst ein ASCII-Balkendiagramm und konvertiert es zu SVG
 * @param {string} content - ASCII-Diagramm-Inhalt
 * @returns {SVGElement|null} - SVG-Element oder null wenn nicht parsebar
 */
function parseAsciiBarChart(content) {
    const lines = content.trim().split('\n').filter(line => line.trim());
    const bars = [];

    // Erkenne Format: Label |####| Wert  oder  Label #### Wert  oder  Label: #### (Wert)
    for (const line of lines) {
        // Verschiedene Balken-Patterns
        // Pattern 1: Label |####| Wert
        let match = line.match(/^(.+?)\s*\|([#█▓▒░=*]+)\|\s*(\d+(?:[.,]\d+)?)/);
        if (!match) {
            // Pattern 2: Label ####... Wert
            match = line.match(/^(.+?)\s+([#█▓▒░=*]{2,})\s+(\d+(?:[.,]\d+)?)/);
        }
        if (!match) {
            // Pattern 3: Label: #### (Wert)
            match = line.match(/^(.+?):\s*([#█▓▒░=*]{2,}).*?(\d+(?:[.,]\d+)?)/);
        }
        if (!match) {
            // Pattern 4: Nur Balken mit Zahl am Ende: Label ###...### 42
            match = line.match(/^(.+?)\s+([█▓▒#=*]{3,})\s*(\d+)$/);
        }

        if (match) {
            const label = match[1].trim();
            const barLength = match[2].length;
            const value = parseFloat(match[3].replace(',', '.'));

            if (label && !isNaN(value)) {
                bars.push({ label, barLength, value });
            }
        }
    }

    // Mindestens 2 Balken fuer ein gueltiges Diagramm
    if (bars.length < 2) return null;

    // SVG erstellen
    const svgNS = 'http://www.w3.org/2000/svg';
    const barHeight = 35;
    const barSpacing = 12;
    const labelWidth = 100;
    const valueWidth = 50;
    const chartWidth = 300;
    const totalWidth = labelWidth + chartWidth + valueWidth + 20;
    const totalHeight = bars.length * (barHeight + barSpacing) + 20;

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'rendered-chart');
    svg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', totalHeight);

    const maxValue = Math.max(...bars.map(b => b.value));

    // Kindgerechte Farben
    const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

    bars.forEach((bar, index) => {
        const y = 10 + index * (barHeight + barSpacing);
        const barWidth = (bar.value / maxValue) * chartWidth;
        const color = colors[index % colors.length];

        // Label
        const labelText = document.createElementNS(svgNS, 'text');
        labelText.setAttribute('x', labelWidth - 10);
        labelText.setAttribute('y', y + barHeight / 2 + 5);
        labelText.setAttribute('text-anchor', 'end');
        labelText.setAttribute('class', 'chart-label');
        labelText.textContent = bar.label.length > 12 ? bar.label.substring(0, 10) + '...' : bar.label;
        svg.appendChild(labelText);

        // Balken
        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', labelWidth);
        rect.setAttribute('y', y);
        rect.setAttribute('width', barWidth);
        rect.setAttribute('height', barHeight);
        rect.setAttribute('rx', '6');
        rect.setAttribute('fill', color);
        svg.appendChild(rect);

        // Wert
        const valueText = document.createElementNS(svgNS, 'text');
        valueText.setAttribute('x', labelWidth + barWidth + 10);
        valueText.setAttribute('y', y + barHeight / 2 + 5);
        valueText.setAttribute('class', 'chart-value');
        valueText.textContent = Number.isInteger(bar.value) ? bar.value : bar.value.toFixed(1);
        svg.appendChild(valueText);
    });

    return svg;
}

/**
 * Erstellt ein einzelnes Grafik-View-Element
 * @param {Object} graphic - {type: 'table'|'graphic'|'description', content: string}
 * @returns {HTMLElement}
 */
function createGraphicView(graphic) {
    const view = document.createElement('div');
    view.className = 'graphic-view';

    // Typ-spezifische Konfiguration
    const typeConfig = {
        table: {
            cssClass: 'table-view',
            icon: '📊',
            label: 'Tabelle',
            isMonospace: true
        },
        graphic: {
            cssClass: 'chart-view',
            icon: '📈',
            label: 'Grafik',
            isMonospace: true
        },
        description: {
            cssClass: 'description-view',
            icon: '🖼️',
            label: 'Bildbeschreibung',
            isMonospace: false
        }
    };

    const config = typeConfig[graphic.type] || typeConfig.description;
    view.classList.add(config.cssClass);

    // Header
    const header = document.createElement('div');
    header.className = 'graphic-view-header';
    header.innerHTML = `<span class="graphic-view-header-icon">${config.icon}</span><span>${config.label}</span>`;
    view.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'graphic-view-content';

    // Prüfe ob Rendering aktiviert ist
    const renderGraphics = localStorage.getItem('rechengeschichten_render_graphics') !== 'false';
    let rendered = false;

    console.log('[Grafik-Rendering] type:', graphic.type, 'renderGraphics:', renderGraphics, 'isMonospace:', config.isMonospace);

    if (renderGraphics && config.isMonospace) {
        // Versuche HTML/SVG-Rendering
        if (graphic.type === 'table') {
            const htmlTable = parseAsciiTable(graphic.content);
            console.log('[Grafik-Rendering] parseAsciiTable result:', htmlTable, 'rows:', htmlTable?.children?.length);
            if (htmlTable) {
                content.appendChild(htmlTable);
                rendered = true;
                view.classList.add('rendered');
            }
        } else if (graphic.type === 'graphic') {
            const svgChart = parseAsciiBarChart(graphic.content);
            if (svgChart) {
                content.appendChild(svgChart);
                rendered = true;
                view.classList.add('rendered');
            }
        }
    }

    // Fallback auf Monospace wenn nicht gerendert
    if (!rendered) {
        if (config.isMonospace) {
            const pre = document.createElement('pre');
            pre.className = 'graphic-view-pre';
            pre.textContent = graphic.content;
            content.appendChild(pre);
        } else {
            content.textContent = graphic.content;
        }
    }

    view.appendChild(content);

    return view;
}

/**
 * Passt die Schriftgroesse aller Grafik-Views an die verfuegbare Breite an
 */
function adjustGraphicFontSizes() {
    const preElements = DOM.graphicContainer.querySelectorAll('.graphic-view-pre');

    preElements.forEach(pre => {
        const content = pre.textContent;
        const container = pre.closest('.graphic-view-content');
        const containerWidth = container.clientWidth - 30; // Padding abziehen

        if (containerWidth > 0) {
            const optimalSize = RechengeschichtenAPI.calculateOptimalFontSize(
                content,
                containerWidth,
                10, // min font size
                16  // max font size
            );
            pre.style.fontSize = `${optimalSize}px`;
        }
    });
}

/**
 * Leert den Grafik-Container
 */
function clearGraphics() {
    DOM.graphicContainer.style.display = 'none';
    DOM.graphicContainer.innerHTML = '';
}

// Window resize handler fuer Grafik-Anpassung
let graphicResizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(graphicResizeTimeout);
    graphicResizeTimeout = setTimeout(() => {
        if (DOM.graphicContainer.style.display !== 'none') {
            adjustGraphicFontSizes();
        }
    }, 250);
});

// ===== COLLECTION (SAMMLUNG) =====

/**
 * Laedt die Sammlung aus localStorage
 */
function loadCollection() {
    try {
        const stored = localStorage.getItem('rechengeschichten_collection');
        if (stored) {
            collectionState.userStories = JSON.parse(stored);
        }
    } catch (e) {
        console.warn('Fehler beim Laden der Sammlung:', e);
        collectionState.userStories = [];
    }
    updateExportButtonState();
}

/**
 * Speichert die Sammlung in localStorage
 */
function saveCollection() {
    try {
        localStorage.setItem('rechengeschichten_collection', JSON.stringify(collectionState.userStories));
    } catch (e) {
        console.warn('Fehler beim Speichern der Sammlung:', e);
        showToast('Fehler beim Speichern', 'error');
    }
}

/**
 * Laedt die Beispiel-Aufgaben aus der JSON-Datei
 */
async function loadExampleTasks() {
    // Pruefen ob Beispiel-Aufgaben bereits nativ injiziert wurden (iOS App)
    if (window._nativeExampleTasks) {
        collectionState.exampleStories = window._nativeExampleTasks.map(ex => ({
            ...ex,
            isPreConfigured: true,
            source: 'example',
            createdAt: 0
        }));
        console.log('Beispiel-Aufgaben (nativ injiziert) geladen:', collectionState.exampleStories.length);
        delete window._nativeExampleTasks;
        return;
    }

    // Falls bereits durch native Injektion geladen, nicht nochmal laden
    if (collectionState.exampleStories && collectionState.exampleStories.length > 0) {
        console.log('Beispiel-Aufgaben bereits vorhanden:', collectionState.exampleStories.length);
        return;
    }

    try {
        // Bei lokalen file:// URLs kein Cache-Busting verwenden
        const isLocalFile = window.location.protocol === 'file:';
        const url = isLocalFile ? 'example-tasks.json' : 'example-tasks.json?v=' + Date.now();

        const response = await fetch(url);
        if (response.ok) {
            const examples = await response.json();
            collectionState.exampleStories = examples.map(ex => ({
                ...ex,
                isPreConfigured: true,
                source: 'example',
                createdAt: 0
            }));
            console.log('Beispiel-Aufgaben geladen:', collectionState.exampleStories.length);
        } else {
            console.warn('Beispiel-Aufgaben Response nicht OK:', response.status);
        }
    } catch (e) {
        console.warn('Beispiel-Aufgaben konnten nicht geladen werden:', e);
        collectionState.exampleStories = [];
    }
}

/**
 * Prueft ob ein aehnlicher Text bereits in der Sammlung existiert
 * @param {string} text - Der zu pruefende Text
 * @returns {Object|null} - Die gefundene Story oder null
 */
function checkForDuplicate(text) {
    const normalizedText = text.toLowerCase().trim().replace(/\s+/g, ' ');

    // Pruefe User-Stories
    for (const story of collectionState.userStories) {
        const normalizedStory = story.text.toLowerCase().trim().replace(/\s+/g, ' ');
        // Sehr aehnlich wenn > 90% der Zeichen uebereinstimmen
        if (normalizedText === normalizedStory) {
            return story;
        }
        // Levenshtein-Distanz waere hier ideal, aber fuer Einfachheit:
        // Pruefen ob einer im anderen enthalten ist
        if (normalizedText.includes(normalizedStory) || normalizedStory.includes(normalizedText)) {
            const similarity = Math.min(normalizedText.length, normalizedStory.length) /
                              Math.max(normalizedText.length, normalizedStory.length);
            if (similarity > 0.9) {
                return story;
            }
        }
    }
    return null;
}

/**
 * Fuegt die aktuelle Aufgabe zur Sammlung hinzu
 */
async function addToCollection() {
    const text = reader.getText().trim();
    if (!text) {
        showToast('Keine Aufgabe zum Speichern', 'error');
        return;
    }

    // Duplikat-Check
    const duplicate = checkForDuplicate(text);
    if (duplicate) {
        showToast('Diese Aufgabe ist bereits gespeichert', 'info');
        return;
    }

    // Pruefen ob es eine sinnvolle Rechengeschichte ist
    if (RechengeschichtenAPI.hasValidApiKey()) {
        try {
            showToast('Prüfe Aufgabe...', 'info');
            const check = await RechengeschichtenAPI.checkIfMathTask(text);
            if (!check.isMathTask) {
                showToast('Bitte ergänze oder ändere den Text: ' + (check.message || 'Das ist keine mathematische Sachaufgabe.'), 'error');
                return;
            }
        } catch (e) {
            console.warn('Pruefung fehlgeschlagen:', e);
            // Bei Fehler trotzdem fortfahren
        }
    } else {
        // Ohne API: Einfache Pruefung ob Zahlen vorhanden
        const hasNumbers = /\d+/.test(text);
        if (!hasNumbers) {
            showToast('Bitte ergänze Zahlen - eine Rechengeschichte braucht Zahlenangaben.', 'error');
            return;
        }
    }

    // Klassifizierung
    let classification = {
        type: 'standard',
        difficulty: 'mittel',
        zahlenraum: '1-100',
        operations: [],
        tags: ['Alltag'],
        suggestedTitle: text.split(/\s+/).slice(0, 3).join(' ') + '...',
        reason: 'Automatisch'
    };

    // Versuche KI-Klassifizierung
    if (RechengeschichtenAPI.hasValidApiKey()) {
        try {
            showToast('Klassifiziere Aufgabe...', 'info');
            classification = await RechengeschichtenAPI.classifyTaskForCollection(text);
        } catch (e) {
            console.warn('KI-Klassifizierung fehlgeschlagen:', e);
        }
    }

    // Text mit Grafik-Tags holen (für korrekte Speicherung)
    const textWithTags = reader.getTextWithTags();

    // Story-Objekt erstellen
    const story = {
        id: 'user_' + Date.now(),
        text: text,
        textWithGraphics: textWithTags || text,
        createdAt: Date.now(),
        isPreConfigured: false,
        classification: {
            type: classification.type,
            difficulty: classification.difficulty,
            zahlenraum: classification.zahlenraum,
            operations: classification.operations,
            tags: classification.tags,
            reason: classification.reason
        },
        title: classification.suggestedTitle,
        source: 'user'
    };

    // Zur Sammlung hinzufuegen
    collectionState.userStories.unshift(story);
    saveCollection();
    updateCollectionButtonVisibility();
    showToast('Aufgabe gespeichert!', 'success');
}

/**
 * Entfernt eine Story aus der User-Sammlung
 * @param {string} id - Die Story-ID
 */
function removeFromCollection(id) {
    const index = collectionState.userStories.findIndex(s => s.id === id);
    if (index !== -1) {
        collectionState.userStories.splice(index, 1);
        saveCollection();
        renderCollectionList();
        updateCollectionButtonVisibility();
        showToast('Aufgabe gelöscht', 'info');
    }
}

/**
 * Exportiert die Benutzer-Aufgaben als JSON-Datei
 */
function exportUserTasks() {
    if (collectionState.userStories.length === 0) {
        showToast('Keine Aufgaben zum Exportieren', 'info');
        return;
    }

    // Erstelle Export-Daten (ohne interne Felder wie isPreConfigured, source)
    const exportData = collectionState.userStories.map(story => ({
        id: story.id,
        text: story.text,
        textWithGraphics: story.textWithGraphics,
        createdAt: story.createdAt,
        classification: story.classification,
        title: story.title
    }));

    // Erstelle Export-Objekt mit Metadaten
    const exportObj = {
        version: 1,
        exportedAt: Date.now(),
        taskCount: exportData.length,
        tasks: exportData
    };

    // Erstelle Blob und Download-Link
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Erstelle Dateiname mit Datum
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const filename = `meine-aufgaben-${dateStr}.rechengeschichten`;

    // Download ausloesen
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();

    // Aufraeumen
    URL.revokeObjectURL(url);

    showToast(`${exportData.length} Aufgabe${exportData.length !== 1 ? 'n' : ''} exportiert`, 'success');
}

/**
 * Verarbeitet den Import von Aufgaben aus einer Datei
 * @param {Event} event - Das change-Event des File-Inputs
 */
async function handleTasksImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Reset input for future imports
    event.target.value = '';

    try {
        const text = await file.text();
        let importData;

        try {
            importData = JSON.parse(text);
        } catch (parseError) {
            showToast('Ungültige Datei: Kein gültiges JSON-Format', 'error');
            return;
        }

        // Validiere Import-Struktur
        let tasksToImport = [];

        if (importData.version && importData.tasks && Array.isArray(importData.tasks)) {
            // Neues Format mit Metadaten
            tasksToImport = importData.tasks;
        } else if (Array.isArray(importData)) {
            // Altes/einfaches Format (Array von Aufgaben, wie example-tasks.json)
            tasksToImport = importData;
        } else {
            showToast('Ungültige Datei: Unbekanntes Format', 'error');
            return;
        }

        if (tasksToImport.length === 0) {
            showToast('Die Datei enthält keine Aufgaben', 'info');
            return;
        }

        // Importiere Aufgaben mit Duplikat-Pruefung
        const result = importTasks(tasksToImport);

        // Feedback anzeigen
        if (result.imported === 0 && result.skipped > 0) {
            showToast(`Alle ${result.skipped} Aufgaben bereits vorhanden`, 'info');
        } else if (result.skipped > 0) {
            showToast(`${result.imported} importiert, ${result.skipped} übersprungen`, 'success');
        } else {
            showToast(`${result.imported} Aufgabe${result.imported !== 1 ? 'n' : ''} importiert`, 'success');
        }

        // UI aktualisieren
        renderCollectionList();
        updateExportButtonState();

    } catch (error) {
        console.error('Import-Fehler:', error);
        showToast('Fehler beim Importieren der Datei', 'error');
    }
}

/**
 * Importiert Aufgaben in die Sammlung mit Duplikat-Pruefung
 * @param {Array} tasks - Die zu importierenden Aufgaben
 * @returns {Object} - { imported: number, skipped: number }
 */
function importTasks(tasks) {
    let imported = 0;
    let skipped = 0;

    for (const task of tasks) {
        // Validiere minimale Aufgabenstruktur
        if (!task.text || typeof task.text !== 'string' || task.text.trim().length === 0) {
            skipped++;
            continue;
        }

        // Pruefe auf Duplikat (Titel UND erste ~50 Zeichen des Texts)
        if (isDuplicateTask(task)) {
            skipped++;
            continue;
        }

        // Erstelle neue Aufgabe mit korrekten Feldern
        const newTask = {
            id: 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            text: task.text.trim(),
            textWithGraphics: task.textWithGraphics || task.text.trim(),
            createdAt: task.createdAt || Date.now(),
            isPreConfigured: false,
            source: 'user',
            classification: task.classification || null,
            title: task.title || generateTaskTitle(task.text)
        };

        // Fuege am Anfang ein (neueste zuerst)
        collectionState.userStories.unshift(newTask);
        imported++;
    }

    // Speichere nach dem Import
    if (imported > 0) {
        saveCollection();
    }

    return { imported, skipped };
}

/**
 * Prueft ob eine Aufgabe bereits existiert
 * Vergleicht Titel UND erste ~50 Zeichen des Texts
 * @param {Object} task - Die zu pruefende Aufgabe
 * @returns {boolean} - true wenn Duplikat
 */
function isDuplicateTask(task) {
    const normalizedTitle = (task.title || '').toLowerCase().trim();
    const normalizedText = task.text.toLowerCase().trim().substring(0, 50);

    for (const existing of collectionState.userStories) {
        const existingTitle = (existing.title || '').toLowerCase().trim();
        const existingText = existing.text.toLowerCase().trim().substring(0, 50);

        // Duplikat wenn Titel UND Text-Anfang uebereinstimmen
        if (normalizedTitle && existingTitle && normalizedTitle === existingTitle) {
            if (normalizedText === existingText) {
                return true;
            }
        }

        // Auch Duplikat wenn kein Titel aber Text-Anfang identisch
        if (!normalizedTitle || !existingTitle) {
            if (normalizedText === existingText && normalizedText.length > 20) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Generiert einen Titel aus dem Aufgabentext
 * @param {string} text - Der Aufgabentext
 * @returns {string} - Ein generierter Titel
 */
function generateTaskTitle(text) {
    const words = text.trim().split(/\s+/);
    let title = '';
    for (const word of words) {
        if ((title + ' ' + word).length > 30) break;
        title += (title ? ' ' : '') + word;
    }
    return title + (title.length < text.length ? '...' : '');
}

/**
 * Aktualisiert den Zustand des Export-Buttons
 */
function updateExportButtonState() {
    if (DOM.btnExportTasks) {
        DOM.btnExportTasks.disabled = collectionState.userStories.length === 0;
    }
}

/**
 * Laedt eine Story in den Reader
 * @param {Object} story - Die zu ladende Story
 */
function loadFromCollection(story) {
    // Text mit Grafik-Tags verwenden falls vorhanden
    const textToLoad = story.textWithGraphics || story.text;

    // Undo-Button verstecken (neue Aufgabe geladen)
    hideUndoButton();

    // Chat zurücksetzen, damit kein alter Verlauf unter der neuen Aufgabe hängt
    resetChatForNewTask();

    // Text in Reader setzen (mit Tags für korrekte Formatierung)
    reader.setText(textToLoad);
    taskText = story.text;
    taskTextWithGraphics = textToLoad;

    // Grafiken parsen falls vorhanden (nur interner State — die Darstellung
    // übernimmt der Reader inline; der separate Grafik-Container wäre doppelt)
    if (story.textWithGraphics && story.textWithGraphics !== story.text) {
        const { graphics } = RechengeschichtenAPI.parseGraphicTags(story.textWithGraphics);
        if (graphics && graphics.length > 0) {
            taskGraphics = graphics;
        }
    }

    // UI aktualisieren
    updateUI();
    updateInputStateUI();
    closeCollectionModal();
    showToast('Aufgabe geladen', 'success');
}

/**
 * Prueft ob vor dem Laden bestaetigt werden muss und laedt dann
 * @param {Object} story - Die zu ladende Story
 */
function confirmLoadFromCollection(story) {
    const currentText = reader.getText().trim();

    if (currentText && currentText !== story.text) {
        // Text vorhanden - Bestaetigung erfragen
        pendingLoadStory = story;
        DOM.confirmLoadPreview.textContent = story.text.substring(0, 150) + (story.text.length > 150 ? '...' : '');
        DOM.confirmLoadModal.classList.add('visible');
    } else {
        // Kein Text oder gleicher Text - direkt laden
        loadFromCollection(story);
    }
}

/**
 * Oeffnet das Sammlungs-Modal
 */
async function openCollectionModal() {
    // Falls Beispiel-Aufgaben noch nicht geladen, jetzt laden
    if (collectionState.exampleStories.length === 0) {
        await loadExampleTasks();
    }
    renderCollectionList();
    DOM.collectionModal.classList.add('visible');
}

/**
 * Schliesst das Sammlungs-Modal
 */
function closeCollectionModal() {
    DOM.collectionModal.classList.remove('visible');
    // Filter und Suche zuruecksetzen
    collectionState.activeFilters = { type: null, difficulty: null, zahlenraum: [] };
    collectionState.searchQuery = '';
    DOM.filterTags.forEach(tag => tag.classList.remove('active'));

    // Suchfeld leeren
    if (DOM.collectionSearchInput) {
        DOM.collectionSearchInput.value = '';
    }
    if (DOM.btnClearSearch) {
        DOM.btnClearSearch.style.display = 'none';
    }
}

/**
 * Rendert die Sammlungsliste
 */
function renderCollectionList() {
    // Filter anwenden
    const filteredExamples = applyCollectionFilters(collectionState.exampleStories);
    const filteredUser = applyCollectionFilters(collectionState.userStories);

    // Beispiel-Aufgaben rendern
    DOM.exampleTasksList.innerHTML = '';
    if (filteredExamples.length === 0) {
        DOM.exampleTasksList.innerHTML = '<p class="collection-empty-hint">Keine passenden Beispiel-Aufgaben gefunden.</p>';
    } else {
        filteredExamples.forEach(story => {
            DOM.exampleTasksList.appendChild(createCollectionItem(story, false));
        });
    }

    // User-Aufgaben rendern
    DOM.userTasksList.innerHTML = '';
    if (filteredUser.length === 0) {
        const emptyMsg = collectionState.userStories.length === 0
            ? 'Du hast noch keine eigenen Aufgaben gespeichert.'
            : 'Keine passenden eigenen Aufgaben gefunden.';
        DOM.userTasksList.innerHTML = `<p class="collection-empty-hint">${emptyMsg}</p>`;
    } else {
        filteredUser.forEach(story => {
            DOM.userTasksList.appendChild(createCollectionItem(story, true));
        });
    }

    // Export-Button-Status aktualisieren
    updateExportButtonState();
}

/**
 * Behandelt die Sucheingabe in der Sammlung
 */
function handleCollectionSearch() {
    const query = DOM.collectionSearchInput.value.trim().toLowerCase();
    collectionState.searchQuery = query;

    // Clear-Button anzeigen/verstecken
    if (DOM.btnClearSearch) {
        DOM.btnClearSearch.style.display = query ? 'flex' : 'none';
    }

    renderCollectionList();
}

/**
 * Leert die Suche in der Sammlung
 */
function clearCollectionSearch() {
    if (DOM.collectionSearchInput) {
        DOM.collectionSearchInput.value = '';
    }
    collectionState.searchQuery = '';

    if (DOM.btnClearSearch) {
        DOM.btnClearSearch.style.display = 'none';
    }

    renderCollectionList();
}

/**
 * Wendet die aktiven Filter auf eine Story-Liste an
 * @param {Array} stories - Die zu filternde Liste
 * @returns {Array} - Gefilterte Liste
 */
function applyCollectionFilters(stories) {
    return stories.filter(story => {
        // Textsuche
        if (collectionState.searchQuery) {
            const query = collectionState.searchQuery;
            const searchableText = [
                story.title || '',
                story.text || '',
                ...(story.classification?.tags || [])
            ].join(' ').toLowerCase();

            if (!searchableText.includes(query)) {
                return false;
            }
        }

        if (collectionState.activeFilters.type &&
            story.classification?.type !== collectionState.activeFilters.type) {
            return false;
        }
        if (collectionState.activeFilters.difficulty &&
            story.classification?.difficulty !== collectionState.activeFilters.difficulty) {
            return false;
        }
        // Zahlenraum-Filter (Mehrfachauswahl)
        if (collectionState.activeFilters.zahlenraum.length > 0) {
            // Normalisiere Zahlenraum-Wert fuer Vergleich
            let storyZahlenraum = story.classification?.zahlenraum;
            if (storyZahlenraum === '10') storyZahlenraum = '1-10';
            if (storyZahlenraum === '20') storyZahlenraum = '1-20';
            if (storyZahlenraum === '100') storyZahlenraum = '1-100';
            if (storyZahlenraum === '1000') storyZahlenraum = '1-1000';
            if (!collectionState.activeFilters.zahlenraum.includes(storyZahlenraum)) {
                return false;
            }
        }
        return true;
    });
}

/**
 * Schaltet einen Filter um
 * @param {string} filterType - 'type', 'difficulty' oder 'zahlenraum'
 * @param {string} value - Der Filterwert
 */
function toggleCollectionFilter(filterType, value) {
    if (filterType === 'zahlenraum') {
        // Mehrfachauswahl fuer Zahlenraum
        const index = collectionState.activeFilters.zahlenraum.indexOf(value);
        if (index > -1) {
            // Wert entfernen
            collectionState.activeFilters.zahlenraum.splice(index, 1);
        } else {
            // Wert hinzufuegen
            collectionState.activeFilters.zahlenraum.push(value);
        }
    } else {
        // Einfachauswahl fuer type und difficulty
        if (collectionState.activeFilters[filterType] === value) {
            // Gleicher Filter - ausschalten
            collectionState.activeFilters[filterType] = null;
        } else {
            // Neuer Filter - einschalten
            collectionState.activeFilters[filterType] = value;
        }
    }

    // UI aktualisieren
    DOM.filterTags.forEach(tag => {
        const tagType = tag.dataset.filterType;
        const tagValue = tag.dataset.filterValue;
        if (tagType === 'zahlenraum') {
            tag.classList.toggle('active', collectionState.activeFilters.zahlenraum.includes(tagValue));
        } else {
            tag.classList.toggle('active', collectionState.activeFilters[tagType] === tagValue);
        }
    });

    renderCollectionList();
}

/**
 * Erstellt ein DOM-Element fuer einen Sammlungseintrag
 * @param {Object} story - Die Story
 * @param {boolean} isDeletable - Ob der Eintrag loeschbar ist
 * @returns {HTMLElement}
 */
function createCollectionItem(story, isDeletable) {
    const item = document.createElement('div');
    item.className = 'collection-item';
    item.dataset.storyId = story.id;

    const classification = story.classification || {};

    // Zahlenraum-Tag erstellen
    const zahlenraumLabels = {
        '1-10': '10',
        '1-20': '20',
        '1-100': '100',
        '1-1000': '1000',
        'gross': '>1000'
    };
    // Alias fuer Rueckwaertskompatibilitaet
    if (classification.zahlenraum === '10') classification.zahlenraum = '1-10';
    if (classification.zahlenraum === '20') classification.zahlenraum = '1-20';
    if (classification.zahlenraum === '100') classification.zahlenraum = '1-100';
    if (classification.zahlenraum === '1000') classification.zahlenraum = '1-1000';
    const zahlenraumTag = classification.zahlenraum
        ? `<span class="collection-tag zahlenraum-tag">${zahlenraumLabels[classification.zahlenraum] || classification.zahlenraum}</span>`
        : '';

    // Operations-Tags erstellen
    const operationNames = {
        'addition': '+',
        'subtraction': '-',
        'multiplication': '\u00d7',
        'division': '\u00f7'
    };
    const operationTags = (classification.operations || [])
        .map(op => `<span class="collection-tag operation-tag">${operationNames[op] || op}</span>`)
        .join('');

    // Themen-Tags (max 2)
    const themeTags = (classification.tags || [])
        .slice(0, 2)
        .map(tag => `<span class="collection-tag">${tag}</span>`)
        .join('');

    item.innerHTML = `
        <div class="collection-item-content">
            <div class="collection-item-title">
                ${story.title || 'Rechenaufgabe'}
                <span class="type-badge ${classification.type || 'standard'}">${classification.type || 'standard'}</span>
            </div>
            <div class="collection-item-preview">${story.text}</div>
            <div class="collection-item-tags">
                <span class="collection-tag difficulty-tag ${classification.difficulty || 'mittel'}">${classification.difficulty || 'mittel'}</span>
                ${zahlenraumTag}
                ${operationTags}
                ${themeTags}
            </div>
        </div>
        <div class="collection-item-actions">
            <button class="collection-item-btn btn-load" title="Aufgabe laden">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="16 16 12 12 8 16"></polyline>
                    <line x1="12" y1="12" x2="12" y2="21"></line>
                    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path>
                </svg>
            </button>
            ${isDeletable ? `
            <button class="collection-item-btn btn-delete" title="Aufgabe löschen">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
            ` : ''}
        </div>
    `;

    // Event-Listener
    const loadBtn = item.querySelector('.btn-load');
    loadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmLoadFromCollection(story);
    });

    if (isDeletable) {
        const deleteBtn = item.querySelector('.btn-delete');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Aufgabe wirklich löschen?')) {
                removeFromCollection(story.id);
            }
        });
    }

    // Klick auf Item = Laden
    item.addEventListener('click', () => {
        confirmLoadFromCollection(story);
    });

    return item;
}

/**
 * Aktualisiert die Sichtbarkeit der Sammlungs-Buttons
 */
function updateCollectionButtonVisibility() {
    const hasText = reader && reader.getText().trim().length > 0;

    // Speichern-Button: Nur sichtbar wenn Text vorhanden
    if (DOM.btnAddCollection) {
        DOM.btnAddCollection.style.display = hasText ? 'inline-flex' : 'none';
    }

    // Sammlung-Button: Immer sichtbar
    if (DOM.btnOpenCollection) {
        DOM.btnOpenCollection.style.display = 'inline-flex';
    }
}

/**
 * Zeigt eine Toast-Benachrichtigung an
 * @param {string} message - Die Nachricht
 * @param {string} type - 'success', 'error', oder 'info'
 */
function showToast(message, type = 'info') {
    // Bestehende Toasts entfernen
    const existing = document.querySelector('.toast-notification');
    if (existing) {
        existing.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${type === 'success' ? '<polyline points="20 6 9 17 4 12"></polyline>' :
              type === 'error' ? '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>' :
              '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>'}
        </svg>
        ${message}
    `;

    document.body.appendChild(toast);

    const anchor = document.getElementById('go-explore-bar');
    let toastPositionFrame = null;
    const syncToastPosition = () => {
        if (!toast.isConnected) return;
        if (anchor && window.LayoutTransitions?.positionElementAboveAnchor) {
            window.LayoutTransitions.positionElementAboveAnchor(toast, anchor);
        }
        toastPositionFrame = requestAnimationFrame(syncToastPosition);
    };
    syncToastPosition();

    // Animation triggern
    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

    // Nach 3 Sekunden ausblenden
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => {
            if (toastPositionFrame !== null) cancelAnimationFrame(toastPositionFrame);
            toast.remove();
        }, 300);
    }, 3000);
}

// ===== URKUNDEN / ZERTIFIKATE SYSTEM =====

/**
 * Strategie-Informationen (Name, Icon, Beschreibung)
 */
const STRATEGY_INFO = {
    read: { name: 'Text lesen', icon: '📚', kompetenz: 'Hat den Text gelesen und verstanden' },
    ask: { name: 'Fragen stellen', icon: '❓', kompetenz: 'Hat Fragen zur Aufgabe geklärt' },
    understand: { name: 'Text verstehen', icon: '📖', kompetenz: 'Hat wichtige Informationen gefunden' },
    solve: { name: 'Lösen', icon: '🧩', kompetenz: 'Hat die Aufgabe bearbeitet' },
    check: { name: 'Prüfen', icon: '✅', kompetenz: 'Hat eine Lösung geprüft' },
    detective: { name: 'Fehler finden', icon: '🔍', kompetenz: 'Hat Fehler in einer Lösung gefunden' },
    assumptions: { name: 'Schätzen', icon: '🔮', kompetenz: 'Hat Annahmen getroffen und geschätzt' },
    visualize: { name: 'Visualisieren', icon: '🟦', kompetenz: 'Hat die Aufgabe visualisiert' }
};

/**
 * Gibt Strategie-Informationen zurueck
 * @param {string} strategyMode - Die Strategie
 * @returns {Object} - {name, icon, kompetenz}
 */
function getStrategyInfo(strategyMode) {
    return STRATEGY_INFO[strategyMode] || { name: 'Unbekannt', icon: '🎯', kompetenz: 'Aufgabe bearbeitet' };
}

/**
 * Laedt Urkunden aus localStorage
 */
function loadCertificates() {
    try {
        const stored = localStorage.getItem('rechengeschichten_certificates');
        if (stored) {
            certificatesState.certificates = JSON.parse(stored);
        } else {
            certificatesState.certificates = [];
        }
    } catch (e) {
        console.error('Fehler beim Laden der Urkunden:', e);
        certificatesState.certificates = [];
    }
    updateCertificateBadge();
}

/**
 * Speichert Urkunden in localStorage
 * @param {Object} options - updateBadge=false haelt den laufenden Modus visuell ungestoert
 */
function saveCertificates(options = {}) {
    try {
        localStorage.setItem('rechengeschichten_certificates', JSON.stringify(certificatesState.certificates));
        if (options.updateBadge !== false) updateCertificateBadge();
    } catch (e) {
        console.error('Fehler beim Speichern der Urkunden:', e);
    }
}

/**
 * Aktualisiert das Badge mit der Anzahl der Urkunden und den Button-Style
 */
function updateCertificateBadge() {
    const count = getCertificateTaskGroups().length;

    // Badge aktualisieren
    if (DOM.certificateCountBadge) {
        DOM.certificateCountBadge.textContent = count;
        DOM.certificateCountBadge.style.display = count > 0 ? 'flex' : 'none';
    }

    // Header-Trophäe nur zeigen, wenn mindestens eine Urkunde da ist
    const headerCertBtn = document.getElementById('btn-header-certificates');
    if (headerCertBtn) {
        headerCertBtn.style.display = count > 0 ? 'flex' : 'none';
    }

    // Button-Style aktualisieren (hervorgehoben wenn Urkunden vorhanden)
    if (DOM.btnOpenCertificates) {
        if (count > 0) {
            DOM.btnOpenCertificates.classList.add('has-certificates');
        } else {
            DOM.btnOpenCertificates.classList.remove('has-certificates');
        }
    }
}

/**
 * Oeffnet das Urkunden-Modal
 */
function openCertificatesModal() {
    loadCertificates();
    renderCertificateList();
    DOM.certificatesModal.classList.add('visible');
}

/**
 * Schliesst das Urkunden-Modal
 */
function closeCertificatesModal() {
    closeCertificateDetail();
    DOM.certificatesModal.classList.remove('visible');
    showPendingMicroAssessment();
}

/**
 * Buendelt alle Strategie-Erfolge, die zur gleichen Aufgabe gehoeren.
 * Alte und neue localStorage-Eintraege bleiben dabei unveraendert erhalten.
 * @returns {Array<Object>} - Aufgabengruppen mit ihren Einzelurkunden
 */
function getCertificateTaskGroups() {
    const sortedCerts = [...certificatesState.certificates]
        .sort((a, b) => (b.lastCompletedAt || b.completedAt) - (a.lastCompletedAt || a.completedAt));
    const groups = [];

    for (const cert of sortedCerts) {
        const normalizedTask = normalizeTaskText(cert.taskText);
        let group = groups.find(candidate => {
            const normalizedCandidate = normalizeTaskText(candidate.taskText);
            return normalizedTask === normalizedCandidate ||
                calculateSimilarity(normalizedTask, normalizedCandidate) > 0.9;
        });

        if (!group) {
            group = {
                id: 'task-group-' + groups.length,
                taskText: cert.taskText || 'Aufgabe ohne Text',
                certificates: [],
                completedAt: cert.lastCompletedAt || cert.completedAt
            };
            groups.push(group);
        }

        group.certificates.push(cert);
        group.completedAt = Math.max(group.completedAt || 0, cert.lastCompletedAt || cert.completedAt || 0);
    }

    return groups;
}

/**
 * Rendert die Urkunden-Liste
 */
function renderCertificateList() {
    if (!DOM.certificatesList) return;

    // Leere die Liste
    DOM.certificatesList.innerHTML = '';

    if (certificatesState.certificates.length === 0) {
        // Zeige leere Hinweis-Nachricht
        const emptyHint = document.createElement('p');
        emptyHint.className = 'certificates-empty-hint';
        emptyHint.textContent = 'Du hast noch keine Urkunden. Bearbeite Aufgaben und zeige was du kannst!';
        DOM.certificatesList.appendChild(emptyHint);
        if (DOM.btnExportCertificatesPdf) DOM.btnExportCertificatesPdf.disabled = true;
        return;
    }

    if (DOM.btnExportCertificatesPdf) DOM.btnExportCertificatesPdf.disabled = false;

    const taskGroups = getCertificateTaskGroups();

    for (const group of taskGroups) {
        const date = new Date(group.completedAt);
        const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const achievementHtml = group.certificates.map(cert => {
            const info = getStrategyInfo(cert.strategie);
            const kompetenzen = Array.isArray(cert.kompetenzen)
                ? cert.kompetenzen
                : (cert.kompetenz ? [cert.kompetenz] : [info.kompetenz]);
            return `
                <div class="certificate-achievement">
                    <span class="certificate-achievement-icon" aria-hidden="true">${info.icon}</span>
                    <span class="certificate-achievement-copy">
                        <strong>${escapeHtml(info.name)}</strong>
                        <span>${escapeHtml(truncateText(kompetenzen[kompetenzen.length - 1], 74))}</span>
                    </span>
                </div>
            `;
        }).join('');

        const card = document.createElement('article');
        card.className = 'certificate-card';
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', 'Urkunde zur Aufgabe öffnen');
        card.innerHTML = `
            <div class="certificate-ornament" aria-hidden="true">★</div>
            <div class="certificate-card-header">
                <span class="certificate-kicker">Urkunde</span>
                <span class="certificate-date">${dateStr}</span>
            </div>
            <h3 class="certificate-card-title">Diese Aufgabe hast du gemeistert</h3>
            <div class="certificate-task-preview">${escapeHtml(truncateText(group.taskText, 150))}</div>
            <div class="certificate-kompetenzen">
                <div class="certificate-kompetenzen-label">Das kannst du</div>
                <div class="certificate-achievements">${achievementHtml}</div>
            </div>
            <span class="certificate-open-hint">Antippen für mehr Details <span aria-hidden="true">→</span></span>
        `;
        card.addEventListener('click', () => openCertificateDetail(group));
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openCertificateDetail(group);
            }
        });
        DOM.certificatesList.appendChild(card);
    }
}

/**
 * Zeigt alle Kompetenzen und Rueckmeldungen zu einer Aufgabe.
 * @param {Object} group - Gebuendelte Urkunden einer Aufgabe
 */
function openCertificateDetail(group) {
    if (!DOM.certificateDetailModal || !DOM.certificateDetailBody) return;
    if (DOM.certificateDetailTitle) DOM.certificateDetailTitle.textContent = 'Diese Aufgabe hast du gemeistert';

    const achievements = group.certificates.map(cert => {
        const info = getStrategyInfo(cert.strategie);
        const kompetenzen = Array.isArray(cert.kompetenzen)
            ? cert.kompetenzen
            : (cert.kompetenz ? [cert.kompetenz] : [info.kompetenz]);
        const erkenntnisse = Array.isArray(cert.erkenntnisse)
            ? cert.erkenntnisse.filter(Boolean)
            : (cert.erkenntnisse ? [cert.erkenntnisse] : []);
        const detailItems = erkenntnisse.map(item => `<li>${escapeHtml(item)}</li>`).join('');
        const kompetenzItems = kompetenzen.map(item => `<li>${escapeHtml(item)}</li>`).join('');

        return `
            <section class="certificate-detail-achievement">
                <div class="certificate-detail-achievement-header">
                    <span class="certificate-detail-icon" aria-hidden="true">${info.icon}</span>
                    <div><span>Kompetenz</span><h3>${escapeHtml(info.name)}</h3></div>
                    <button class="certificate-delete-btn" title="Diese Kompetenz löschen"
                        aria-label="Kompetenz ${escapeHtml(info.name)} löschen" data-cert-id="${escapeHtml(cert.id)}">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
                <ul class="certificate-detail-competencies">${kompetenzItems}</ul>
                ${detailItems ? `<div class="certificate-detail-observation"><strong>Das ist dir gut gelungen</strong><ul>${detailItems}</ul></div>` : ''}
                ${cert.feedback ? `<p class="certificate-detail-feedback">„${escapeHtml(cert.feedback)}“</p>` : ''}
            </section>
        `;
    }).join('');

    DOM.certificateDetailBody.innerHTML = `
        <div class="certificate-detail-task">
            <span>Deine Aufgabe</span>
            <p>${escapeHtml(group.taskText)}</p>
        </div>
        <div class="certificate-detail-grid">${achievements}</div>
    `;
    DOM.certificateDetailBody.querySelectorAll('.certificate-delete-btn').forEach(button => {
        button.addEventListener('click', () => {
            deleteCertificate(button.dataset.certId);
            const updatedGroup = getCertificateTaskGroups().find(candidate =>
                calculateSimilarity(normalizeTaskText(candidate.taskText), normalizeTaskText(group.taskText)) > 0.9
            );
            if (updatedGroup) openCertificateDetail(updatedGroup);
            else closeCertificateDetail();
        });
    });
    DOM.certificateDetailModal.classList.add('visible');
    DOM.btnCloseCertificateDetail?.focus();
}

function closeCertificateDetail() {
    if (DOM.certificateDetailModal) DOM.certificateDetailModal.classList.remove('visible');
}

/**
 * Kuerzt Text auf eine maximale Laenge
 * @param {string} text - Der Text
 * @param {number} maxLength - Maximale Laenge
 * @returns {string} - Gekuerzter Text
 */
function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

/**
 * Loescht eine Urkunde
 * @param {string} id - Die Urkunden-ID
 */
function deleteCertificate(id) {
    const index = certificatesState.certificates.findIndex(c => c.id === id);
    if (index !== -1) {
        certificatesState.certificates.splice(index, 1);
        saveCertificates();
        renderCertificateList();
        showToast('Urkunde gelöscht', 'info');
    }
}

/**
 * Prueft ob die KI-Antwort ein Mission-Complete-Tag enthaelt
 * @param {string} response - Die KI-Antwort
 * @returns {Object|null} - Die Completion-Daten oder null
 */
function checkForMissionComplete(response) {
    const match = response.match(/\[MISSION_COMPLETE\]([\s\S]*?)\[\/MISSION_COMPLETE\]/);
    if (match) {
        try {
            return JSON.parse(match[1].trim());
        } catch (e) {
            console.error('Fehler beim Parsen des MISSION_COMPLETE Tags:', e);
            return null;
        }
    }
    return null;
}

/**
 * Entfernt das Mission-Complete-Tag aus der Antwort fuer die Anzeige
 * @param {string} response - Die KI-Antwort
 * @returns {string} - Die Antwort ohne Tag
 */
function stripMissionCompleteTag(response) {
    return response.replace(/\[MISSION_COMPLETE\][\s\S]*?\[\/MISSION_COMPLETE\]/g, '').trim();
}

/**
 * Zeigt im laufenden Chat nur einen kleinen, nicht blockierenden Abschluss-Hinweis.
 * @param {boolean} isUpdate - Bestehende Urkunde wurde um eine Kompetenz ergaenzt
 */
function appendMissionCompleteIndicator(isUpdate) {
    if (!DOM.chatMessages) return;
    const indicator = document.createElement('div');
    indicator.className = 'chat-completion-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');

    const icon = document.createElement('span');
    icon.className = 'chat-completion-indicator-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✓';

    const label = document.createElement('span');
    label.textContent = isUpdate ? 'Geschafft – neue Kompetenz gespeichert' : 'Geschafft – Urkunde gespeichert';

    indicator.appendChild(icon);
    indicator.appendChild(label);
    DOM.chatMessages.appendChild(indicator);
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

/**
 * Zeigt eine im Modus vorgemerkte Urkunde erst nach dessen Verlassen.
 */
function presentPendingCertificateOnExit() {
    if (!pendingCertificatePresentation) return false;
    const pending = pendingCertificatePresentation;
    pendingCertificatePresentation = null;
    pendingMicroAssessment = {
        taskText: pending.taskText,
        taskType: pending.taskType
    };
    updateCertificateBadge();
    showCelebrationModal(pending.certificate, pending.isUpdate);
    if (!DOM.celebrationModal) showPendingMicroAssessment();
    return true;
}

/**
 * Startet das optionale Mikro-Assessment erst, wenn keine Urkundenansicht mehr davor liegt.
 */
function showPendingMicroAssessment() {
    if (!pendingMicroAssessment) return;
    const pending = pendingMicroAssessment;
    pendingMicroAssessment = null;
    setTimeout(() => {
        maybeShowMicroAssessment(pending.taskText, pending.taskType).catch(() => {});
    }, 220);
}

/**
 * Behandelt eine erfolgreiche Mission-Completion
 * Wenn dieselbe Aufgabe bereits geloest wurde, wird die Urkunde aktualisiert statt neu erstellt
 * @param {Object} data - Die Completion-Daten aus dem Tag
 */
function handleMissionComplete(data) {
    if (missionAlreadyCompleted) return; // Verhindert doppelte Completion
    missionAlreadyCompleted = true;
    matheforscherStrategienAbgeschlossen++; // Protokoll v3.0: Sitzungszähler für den Report


    const info = getStrategyInfo(data.strategie);
    const currentTaskText = taskText || '';

    // Lade bestehende Urkunden
    loadCertificates();

    // Suche nach bestehender Urkunde fuer dieselbe Aufgabe und Strategie
    const existingCert = findExistingCertificate(currentTaskText, data.strategie);

    if (existingCert) {
        // Bestehende Urkunde aktualisieren
        updateExistingCertificate(existingCert, data, info);
        saveCertificates({ updateBadge: false });
        pendingCertificatePresentation = {
            certificate: existingCert,
            isUpdate: true,
            taskText: currentTaskText,
            taskType: currentTaskType
        };
        appendMissionCompleteIndicator(true);
    } else {
        // Neue Urkunde erstellen
        const certificate = {
            id: 'cert_' + Date.now(),
            taskText: currentTaskText,
            strategie: data.strategie,
            strategieName: info.name,
            completedAt: Date.now(),
            kompetenzen: [data.kompetenz || info.kompetenz], // Array fuer mehrere Kompetenzen
            erkenntnisse: [data.erkenntnisse || ''].filter(e => e), // Array fuer mehrere Erkenntnisse
            schwierigkeiten: [data.schwierigkeiten || ''].filter(s => s && s !== 'keine'),
            feedback: data.feedback || '',
            trophyIcon: info.icon,
            completionCount: 1
        };

        certificatesState.certificates.push(certificate);
        saveCertificates({ updateBadge: false });
        pendingCertificatePresentation = {
            certificate: certificate,
            isUpdate: false,
            taskText: currentTaskText,
            taskType: currentTaskType
        };
        appendMissionCompleteIndicator(false);
    }
}

/**
 * Sucht nach einer bestehenden Urkunde fuer die gleiche Aufgabe und Strategie
 * @param {string} taskTextToFind - Der Aufgabentext
 * @param {string} strategie - Die Strategie
 * @returns {Object|null} - Die gefundene Urkunde oder null
 */
function findExistingCertificate(taskTextToFind, strategie) {
    if (!taskTextToFind) return null;

    const normalizedTask = normalizeTaskText(taskTextToFind);

    return certificatesState.certificates.find(cert => {
        if (cert.strategie !== strategie) return false;
        const normalizedCertTask = normalizeTaskText(cert.taskText);
        // Pruefe auf hohe Aehnlichkeit (gleicher Text oder sehr aehnlich)
        return normalizedTask === normalizedCertTask ||
               calculateSimilarity(normalizedTask, normalizedCertTask) > 0.9;
    });
}

/**
 * Normalisiert einen Aufgabentext fuer Vergleiche
 * @param {string} text - Der Text
 * @returns {string} - Normalisierter Text
 */
function normalizeTaskText(text) {
    if (!text) return '';
    return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Berechnet die Aehnlichkeit zwischen zwei Texten (0-1)
 * @param {string} text1 - Erster Text
 * @param {string} text2 - Zweiter Text
 * @returns {number} - Aehnlichkeitswert zwischen 0 und 1
 */
function calculateSimilarity(text1, text2) {
    if (text1 === text2) return 1;
    if (!text1 || !text2) return 0;

    // Einfache Aehnlichkeitsberechnung basierend auf Laengenverhaeltnis
    // und ob einer im anderen enthalten ist
    const shorter = text1.length < text2.length ? text1 : text2;
    const longer = text1.length < text2.length ? text2 : text1;

    if (longer.includes(shorter)) {
        return shorter.length / longer.length;
    }

    // Wortbasierte Aehnlichkeit
    const words1 = new Set(text1.split(' '));
    const words2 = new Set(text2.split(' '));
    const intersection = [...words1].filter(w => words2.has(w)).length;
    const union = new Set([...words1, ...words2]).size;

    return union > 0 ? intersection / union : 0;
}

/**
 * Aktualisiert eine bestehende Urkunde mit neuen Erkenntnissen
 * @param {Object} cert - Die bestehende Urkunde
 * @param {Object} data - Die neuen Completion-Daten
 * @param {Object} info - Strategie-Info
 */
function updateExistingCertificate(cert, data, info) {
    // Completion-Zaehler erhoehen
    cert.completionCount = (cert.completionCount || 1) + 1;
    cert.lastCompletedAt = Date.now();

    // Kompetenzen-Array sicherstellen (Migration von altem Format)
    if (!Array.isArray(cert.kompetenzen)) {
        cert.kompetenzen = cert.kompetenz ? [cert.kompetenz] : [];
        delete cert.kompetenz;
    }

    // Neue Kompetenz hinzufuegen wenn noch nicht vorhanden
    const newKompetenz = data.kompetenz || info.kompetenz;
    if (newKompetenz && !cert.kompetenzen.includes(newKompetenz)) {
        cert.kompetenzen.push(newKompetenz);
    }

    // Erkenntnisse-Array sicherstellen
    if (!Array.isArray(cert.erkenntnisse)) {
        cert.erkenntnisse = cert.erkenntnisse ? [cert.erkenntnisse] : [];
    }

    // Neue Erkenntnis hinzufuegen wenn vorhanden und noch nicht enthalten
    if (data.erkenntnisse && data.erkenntnisse.trim() &&
        !cert.erkenntnisse.some(e => e.toLowerCase() === data.erkenntnisse.toLowerCase())) {
        cert.erkenntnisse.push(data.erkenntnisse);
    }

    // Schwierigkeiten-Array sicherstellen
    if (!Array.isArray(cert.schwierigkeiten)) {
        cert.schwierigkeiten = cert.schwierigkeiten ? [cert.schwierigkeiten] : [];
    }

    // Neue Schwierigkeit hinzufuegen wenn vorhanden und relevant
    if (data.schwierigkeiten && data.schwierigkeiten.trim() &&
        data.schwierigkeiten.toLowerCase() !== 'keine' &&
        !cert.schwierigkeiten.some(s => s.toLowerCase() === data.schwierigkeiten.toLowerCase())) {
        cert.schwierigkeiten.push(data.schwierigkeiten);
    }

    // Feedback aktualisieren (neuestes behalten)
    if (data.feedback) {
        cert.feedback = data.feedback;
    }
}

/**
 * Zeigt das Feier-Modal
 * @param {Object} cert - Die Urkunde
 * @param {boolean} isUpdate - Ob es ein Update einer bestehenden Urkunde ist
 */
function showCelebrationModal(cert, isUpdate = false) {
    if (!DOM.celebrationModal) return;

    const info = getStrategyInfo(cert.strategie);

    // Icon setzen (Haekchen statt Strategie-Icon)
    if (DOM.celebrationIcon) {
        DOM.celebrationIcon.textContent = '✓';
    }

    // Titel anpassen
    const titleEl = document.getElementById('celebration-modal-title');
    if (titleEl) {
        titleEl.textContent = isUpdate ? 'Neue Kompetenz erreicht!' : 'Urkunde erhalten!';
    }

    // Kompetenz setzen (neueste aus Array oder Fallback)
    if (DOM.celebrationKompetenz) {
        const kompetenz = Array.isArray(cert.kompetenzen) && cert.kompetenzen.length > 0
            ? cert.kompetenzen[cert.kompetenzen.length - 1]
            : (cert.kompetenz || info.kompetenz);
        DOM.celebrationKompetenz.textContent = kompetenz;
    }

    // Feedback setzen
    if (DOM.celebrationFeedback) {
        DOM.celebrationFeedback.textContent = cert.feedback || 'Gut gemacht!';
    }

    DOM.celebrationModal.classList.add('visible');
}

/**
 * Schliesst das Feier-Modal
 */
function closeCelebrationModal(options = {}) {
    if (DOM.celebrationModal) {
        DOM.celebrationModal.classList.remove('visible');
    }
    if (!options.deferMicroAssessment) showPendingMicroAssessment();
}

// ===== ERSTER WEB-START: DATENSCHUTZ UND ALTER =====
function selectWebConsentAge(value, options = {}) {
    const age = Math.min(12, Math.max(6, parseInt(value, 10) || 8));
    if (!DOM.webConsentAgeOptions) return age;

    const buttons = Array.from(DOM.webConsentAgeOptions.querySelectorAll('.web-consent-age'));
    buttons.forEach((button) => {
        const selected = parseInt(button.dataset.age, 10) === age;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-checked', String(selected));
        button.tabIndex = selected ? 0 : -1;
    });
    if (DOM.webConsentAgeValue) DOM.webConsentAgeValue.textContent = age + ' Jahre';

    if (options.focus) {
        const selectedButton = buttons.find((button) => parseInt(button.dataset.age, 10) === age);
        selectedButton?.focus();
    }
    return age;
}

function handleWebConsentAgeKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const current = event.target.closest('.web-consent-age');
    if (!current) return;
    const direction = (event.key === 'ArrowRight' || event.key === 'ArrowDown') ? 1 : -1;
    selectWebConsentAge(parseInt(current.dataset.age, 10) + direction, { focus: true });
}

function trapWebConsentFocus(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        return;
    }
    if (event.key !== 'Tab' || !DOM.webConsentModal?.classList.contains('visible')) return;

    const focusable = Array.from(DOM.webConsentModal.querySelectorAll(
        'button:not([disabled]):not([tabindex="-1"]), a[href], [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function showWebPrivacyConsentIfNeeded() {
    if (isNativeAppContext() || !DOM.webConsentModal) return false;
    if (localStorage.getItem(WEB_PRIVACY_CONSENT_KEY) === 'accepted') return false;

    selectWebConsentAge(localStorage.getItem('rechengeschichten_age') || '8');
    DOM.webConsentModal.classList.add('visible');
    document.body.classList.add('web-consent-open');
    requestAnimationFrame(() => {
        DOM.webConsentAgeOptions?.querySelector('.web-consent-age.selected')?.focus();
    });
    return true;
}

function completeWebPrivacyConsent() {
    if (isNativeAppContext() || !DOM.webConsentModal) return;
    const selected = DOM.webConsentAgeOptions?.querySelector('.web-consent-age.selected');
    const age = selectWebConsentAge(selected?.dataset.age || '8');
    const now = new Date().toISOString();

    localStorage.setItem('rechengeschichten_age', String(age));
    localStorage.setItem(WEB_PRIVACY_CONSENT_KEY, 'accepted');
    localStorage.setItem(WEB_PRIVACY_CONSENT_DATE_KEY, now);

    if (DOM.ageSlider) DOM.ageSlider.value = String(age);
    if (DOM.ageValue) DOM.ageValue.textContent = age + ' Jahre';

    DOM.webConsentModal.classList.remove('visible');
    document.body.classList.remove('web-consent-open');
    showOnboardingIfNeeded();
}

// ===== ONBOARDING =====

/**
 * Zeigt das Onboarding-Tutorial an (beim ersten Besuch)
 */
function showOnboardingIfNeeded() {
    // Pruefen ob Onboarding bereits gesehen wurde
    const hasSeenOnboarding = localStorage.getItem('rechengeschichten_onboarding_seen');
    if (!hasSeenOnboarding && DOM.onboardingModal) {
        currentOnboardingSlide = 0;
        updateOnboardingUI();
        showOnboardingSpotlight();
        DOM.onboardingModal.classList.add('visible');
    }
}

/**
 * Zeigt das Onboarding manuell an (ueber Hilfe-Button)
 */
function showOnboardingManually() {
    if (DOM.onboardingModal) {
        currentOnboardingSlide = 0;
        updateOnboardingUI();
        showOnboardingSpotlight();
        DOM.onboardingModal.classList.add('visible');
    }
}

/**
 * Aktualisiert die Onboarding-UI (Slides und Dots)
 */
function updateOnboardingUI() {
    // Slides aktualisieren
    if (DOM.onboardingSlides) {
        DOM.onboardingSlides.forEach((slide, index) => {
            slide.classList.toggle('active', index === currentOnboardingSlide);
        });
    }

    // Dots aktualisieren
    if (DOM.onboardingDots) {
        DOM.onboardingDots.forEach((dot, index) => {
            dot.classList.toggle('active', index === currentOnboardingSlide);
        });
    }

    // Button-Text aktualisieren
    if (DOM.btnOnboardingNext) {
        const isLastSlide = currentOnboardingSlide === TOTAL_ONBOARDING_SLIDES - 1;
        DOM.btnOnboardingNext.textContent = isLastSlide ? 'Los geht\'s!' : 'Weiter';
    }

    // Hervorhebungen aktualisieren
    updateOnboardingHighlights();
}

/**
 * Entfernt alle Onboarding-Hervorhebungen
 */
function clearOnboardingHighlights() {
    // Alle Elemente mit der Highlight-Klasse finden und entfernen
    document.querySelectorAll('.onboarding-highlight').forEach(el => {
        el.classList.remove('onboarding-highlight');
    });
}

/**
 * Aktualisiert die Hervorhebungen fuer den aktuellen Onboarding-Slide
 */
function updateOnboardingHighlights() {
    // Zuerst alle Hervorhebungen entfernen
    clearOnboardingHighlights();

    // Dann die neuen Hervorhebungen fuer den aktuellen Slide setzen
    const elementsToHighlight = ONBOARDING_HIGHLIGHTS[currentOnboardingSlide];
    if (elementsToHighlight) {
        elementsToHighlight.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                element.classList.add('onboarding-highlight');
            }
        });
    }

    // Spotlight mit Ausschnitten aktualisieren (kurz verzoegert fuer Layout-Berechnung)
    requestAnimationFrame(() => {
        updateOnboardingSpotlight();
    });
}

/**
 * Aktualisiert das Spotlight-Overlay mit Ausschnitten fuer die hervorgehobenen Elemente
 * Verwendet ein SVG mit Maske fuer bessere Browser-Kompatibilitaet
 */
function updateOnboardingSpotlight() {
    const spotlight = document.getElementById('onboarding-spotlight');
    if (!spotlight) return;

    const highlights = document.querySelectorAll('.onboarding-highlight');

    // Altes SVG entfernen falls vorhanden
    const oldSvg = spotlight.querySelector('svg');
    if (oldSvg) oldSvg.remove();

    if (highlights.length === 0) {
        return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 6;

    // SVG mit Maske erstellen
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';

    // Defs fuer die Maske
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
    mask.setAttribute('id', 'spotlight-mask');

    // Weisser Hintergrund (sichtbarer Bereich)
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', '0');
    bgRect.setAttribute('y', '0');
    bgRect.setAttribute('width', '100%');
    bgRect.setAttribute('height', '100%');
    bgRect.setAttribute('fill', 'white');
    mask.appendChild(bgRect);

    // Schwarze Rechtecke fuer die Loecher (unsichtbare Bereiche)
    highlights.forEach(el => {
        const rect = el.getBoundingClientRect();
        const x = rect.left - padding;
        const y = rect.top - padding;
        const w = rect.width + padding * 2;
        const h = rect.height + padding * 2;

        // Ermittle den border-radius des Elements
        const computedStyle = window.getComputedStyle(el);
        let r = parseFloat(computedStyle.borderRadius) || 12;
        r = Math.min(r + 4, w / 2, h / 2);

        const holeRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        holeRect.setAttribute('x', x);
        holeRect.setAttribute('y', y);
        holeRect.setAttribute('width', w);
        holeRect.setAttribute('height', h);
        holeRect.setAttribute('rx', r);
        holeRect.setAttribute('ry', r);
        holeRect.setAttribute('fill', 'black');
        mask.appendChild(holeRect);
    });

    defs.appendChild(mask);
    svg.appendChild(defs);

    // Halbtransparentes Rechteck mit der Maske
    const overlayRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    overlayRect.setAttribute('x', '0');
    overlayRect.setAttribute('y', '0');
    overlayRect.setAttribute('width', '100%');
    overlayRect.setAttribute('height', '100%');
    overlayRect.setAttribute('fill', 'rgba(0, 0, 0, 0.5)');
    overlayRect.setAttribute('mask', 'url(#spotlight-mask)');
    svg.appendChild(overlayRect);

    spotlight.appendChild(svg);
}

/**
 * Zeigt das Onboarding-Spotlight an
 */
function showOnboardingSpotlight() {
    const spotlight = document.getElementById('onboarding-spotlight');
    if (spotlight) {
        spotlight.classList.add('visible');
    }
}

/**
 * Versteckt das Onboarding-Spotlight
 */
function hideOnboardingSpotlight() {
    const spotlight = document.getElementById('onboarding-spotlight');
    if (spotlight) {
        spotlight.classList.remove('visible');
        spotlight.style.clipPath = 'none';
    }
}

/**
 * Wechselt zum naechsten Onboarding-Slide
 */
function nextOnboardingSlide() {
    if (currentOnboardingSlide < TOTAL_ONBOARDING_SLIDES - 1) {
        currentOnboardingSlide++;
        updateOnboardingUI();
    } else {
        closeOnboarding();
    }
}

/**
 * Wechselt zu einem bestimmten Onboarding-Slide
 */
function goToOnboardingSlide(slideIndex) {
    if (slideIndex >= 0 && slideIndex < TOTAL_ONBOARDING_SLIDES) {
        currentOnboardingSlide = slideIndex;
        updateOnboardingUI();
    }
}

/**
 * Schliesst das Onboarding und merkt sich, dass es gesehen wurde
 */
function closeOnboarding() {
    localStorage.setItem('rechengeschichten_onboarding_seen', 'true');
    clearOnboardingHighlights();
    hideOnboardingSpotlight();
    if (DOM.onboardingModal) {
        DOM.onboardingModal.classList.remove('visible');
    }
}

/**
 * Exportiert alle Urkunden als PDF
 */
async function exportCertificatesAsPdf() {
    if (certificatesState.certificates.length === 0) {
        showToast('Keine Urkunden zum Exportieren', 'info');
        return;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 20;
        const contentWidth = pageWidth - 2 * margin;

        const sortedCerts = [...certificatesState.certificates].sort((a, b) => b.completedAt - a.completedAt);
        const taskGroups = getCertificateTaskGroups();

        // --- Hilfsfunktion: Dekorativen Rahmen zeichnen ---
        function drawBorder() {
            doc.setDrawColor(5, 150, 105);
            doc.setLineWidth(2);
            doc.roundedRect(10, 10, pageWidth - 20, pageHeight - 20, 5, 5, 'S');
            doc.setLineWidth(0.5);
            doc.roundedRect(15, 15, pageWidth - 30, pageHeight - 30, 3, 3, 'S');
        }

        // --- Hilfsfunktion: Footer zeichnen ---
        function drawFooter() {
            doc.setFontSize(9);
            doc.setTextColor(150, 150, 150);
            doc.setFont(undefined, 'normal');
            doc.text('Erstellt mit der Rechengeschichten-App', pageWidth / 2, pageHeight - 20, { align: 'center' });
        }

        // ============================
        // SEITE 1: Uebersichts-Urkunde
        // ============================
        drawBorder();
        let y = 35;

        // Titel
        doc.setFontSize(28);
        doc.setTextColor(5, 150, 105);
        doc.text('URKUNDE', pageWidth / 2, y, { align: 'center' });

        // Stern-Symbol (sicher in Standard-Font)
        y += 18;
        doc.setFontSize(36);
        doc.text('*', pageWidth / 2, y, { align: 'center' });

        // Untertitel
        y += 14;
        doc.setFontSize(16);
        doc.setTextColor(0, 0, 0);
        doc.text('Rechengeschichten-Meister', pageWidth / 2, y, { align: 'center' });

        // Name-Feld
        y += 22;
        doc.setFontSize(12);
        doc.setTextColor(100, 100, 100);
        doc.text('Fuer:', margin, y);
        y += 5;
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.5);
        doc.line(margin, y, pageWidth - margin, y);
        doc.setFontSize(10);
        doc.text('(Name)', pageWidth / 2, y + 5, { align: 'center' });

        // Zeitraum
        y += 18;
        const dates = sortedCerts.map(c => c.completedAt);
        const earliest = new Date(Math.min(...dates));
        const latest = new Date(Math.max(...dates));
        const fmtOpts = { day: '2-digit', month: 'long', year: 'numeric' };
        const earliestStr = earliest.toLocaleDateString('de-DE', fmtOpts);
        const latestStr = latest.toLocaleDateString('de-DE', fmtOpts);
        doc.setFontSize(11);
        doc.setTextColor(100, 100, 100);
        if (earliestStr === latestStr) {
            doc.text('Datum: ' + latestStr, margin, y);
        } else {
            doc.text('Zeitraum: ' + earliestStr + ' - ' + latestStr, margin, y);
        }

        // Kompetenzen und Rueckmeldungen nach Strategie gruppieren
        const grouped = {};
        for (const cert of sortedCerts) {
            const info = getStrategyInfo(cert.strategie);
            const key = cert.strategie || 'unknown';
            if (!grouped[key]) {
                grouped[key] = { name: info.name, kompetenzen: new Set(), rueckmeldungen: [], count: 0 };
            }
            grouped[key].count++;
            const komps = Array.isArray(cert.kompetenzen)
                ? cert.kompetenzen
                : (cert.kompetenz ? [cert.kompetenz] : [info.kompetenz]);
            for (const k of komps) {
                grouped[key].kompetenzen.add(k);
            }
            // Erkenntnisse und Feedback sammeln
            const erks = Array.isArray(cert.erkenntnisse)
                ? cert.erkenntnisse.filter(e => e && e !== 'keine')
                : (cert.erkenntnisse && cert.erkenntnisse !== 'keine' ? [cert.erkenntnisse] : []);
            for (const e of erks) {
                grouped[key].rueckmeldungen.push(e);
            }
            if (cert.feedback) {
                grouped[key].rueckmeldungen.push(cert.feedback);
            }
        }

        // Ueberschrift Kompetenzen
        y += 16;
        doc.setFontSize(14);
        doc.setTextColor(5, 150, 105);
        doc.setFont(undefined, 'bold');
        doc.text('Erreichte Kompetenzen', margin, y);
        doc.setFont(undefined, 'normal');
        y += 3;
        doc.setDrawColor(5, 150, 105);
        doc.setLineWidth(0.5);
        doc.line(margin, y, pageWidth - margin, y);
        y += 8;

        // Pro Strategie: Name + Anzahl, dann Kompetenzen
        const strategyOrder = ['read', 'understand', 'ask', 'solve', 'visualize', 'check', 'detective', 'assumptions'];
        for (const key of strategyOrder) {
            if (!grouped[key]) continue;
            const group = grouped[key];

            // Pruefen ob genug Platz, sonst kein Seitenumbruch noetig (passt auf eine Seite)
            if (y > pageHeight - 45) break;

            // Strategie-Name mit Anzahl
            doc.setFontSize(12);
            doc.setTextColor(5, 150, 105);
            doc.setFont(undefined, 'bold');
            const countLabel = group.count === 1 ? '1 Aufgabe' : group.count + ' Aufgaben';
            doc.text(group.name + '  (' + countLabel + ')', margin, y);
            doc.setFont(undefined, 'normal');
            y += 6;

            // Kompetenzen auflisten
            doc.setFontSize(10);
            doc.setTextColor(50, 50, 50);
            for (const komp of group.kompetenzen) {
                const kompLines = doc.splitTextToSize('- ' + komp, contentWidth - 5);
                for (const line of kompLines) {
                    doc.text(line, margin + 3, y);
                    y += 4.5;
                }
            }

            y += 4;
        }

        // Zusammenfassung
        y += 4;
        if (y < pageHeight - 50) {
            doc.setFontSize(11);
            doc.setTextColor(5, 150, 105);
            doc.setFont(undefined, 'italic');
            const totalTasks = taskGroups.length;
            const totalStrategies = Object.keys(grouped).length;
            const summaryText = 'Insgesamt ' + totalTasks + (totalTasks === 1 ? ' Aufgabe' : ' Aufgaben')
                + ' in ' + totalStrategies + (totalStrategies === 1 ? ' Bereich' : ' Bereichen') + ' bearbeitet.';
            doc.text(summaryText, pageWidth / 2, y, { align: 'center' });
            doc.setFont(undefined, 'normal');
        }

        drawFooter();

        // ============================
        // SEITE 2+: Urkundenblaetter pro Aufgabe
        // ============================
        function startTaskCertificatePage() {
            doc.addPage();
            drawBorder();
            doc.setFontSize(18);
            doc.setTextColor(5, 150, 105);
            doc.setFont(undefined, 'bold');
            doc.text('Meine Urkundenblaetter', pageWidth / 2, 30, { align: 'center' });
            doc.setFont(undefined, 'normal');
            return 43;
        }

        y = startTaskCertificatePage();
        const achievementGap = 4;
        const achievementWidth = (contentWidth - achievementGap - 12) / 2;

        for (let groupIndex = 0; groupIndex < taskGroups.length; groupIndex++) {
            const taskGroup = taskGroups[groupIndex];
            const taskDate = new Date(taskGroup.completedAt);
            const taskDateStr = taskDate.toLocaleDateString('de-DE', {
                day: '2-digit', month: '2-digit', year: 'numeric'
            });
            let taskLines = doc.splitTextToSize(
                (taskGroup.taskText || 'Aufgabe ohne Text').replace(/\n/g, ' '),
                contentWidth - 18
            );
            if (taskLines.length > 8) {
                taskLines = taskLines.slice(0, 8);
                taskLines[7] += ' ...';
            }

            const achievementCards = taskGroup.certificates.map(cert => {
                const info = getStrategyInfo(cert.strategie);
                const komps = Array.isArray(cert.kompetenzen)
                    ? cert.kompetenzen
                    : (cert.kompetenz ? [cert.kompetenz] : [info.kompetenz]);
                let lines = doc.splitTextToSize(komps.map(k => '- ' + k).join(' '), achievementWidth - 8);
                if (lines.length > 7) {
                    lines = lines.slice(0, 7);
                    lines[6] += ' ...';
                }
                return { name: info.name, lines, height: Math.max(20, 12 + lines.length * 3.8) };
            });

            const rowHeights = [];
            for (let i = 0; i < achievementCards.length; i += 2) {
                rowHeights.push(Math.max(
                    achievementCards[i].height,
                    achievementCards[i + 1] ? achievementCards[i + 1].height : 0
                ));
            }
            const taskHeight = taskLines.length * 4.2;
            const cardHeight = 29 + taskHeight + rowHeights.reduce((sum, height) => sum + height, 0)
                + Math.max(0, rowHeights.length - 1) * achievementGap + 9;

            if (y + cardHeight > pageHeight - 30) {
                drawFooter();
                y = startTaskCertificatePage();
            }

            const cardTop = y;
            doc.setFillColor(255, 255, 255);
            doc.setDrawColor(167, 243, 208);
            doc.setLineWidth(0.7);
            doc.roundedRect(margin, cardTop, contentWidth, cardHeight, 4, 4, 'FD');

            doc.setFillColor(236, 253, 245);
            doc.roundedRect(margin, cardTop, contentWidth, 15, 4, 4, 'F');
            doc.rect(margin, cardTop + 8, contentWidth, 7, 'F');
            doc.setFontSize(11);
            doc.setTextColor(5, 150, 105);
            doc.setFont(undefined, 'bold');
            doc.text('URKUNDE ' + (groupIndex + 1), margin + 7, cardTop + 9.5);
            doc.setFont(undefined, 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(107, 114, 128);
            doc.text(taskDateStr, pageWidth - margin - 7, cardTop + 9.5, { align: 'right' });

            let cardY = cardTop + 22;
            doc.setFontSize(8);
            doc.setTextColor(5, 150, 105);
            doc.setFont(undefined, 'bold');
            doc.text('DIESE AUFGABE HAST DU GEMEISTERT', margin + 7, cardY);
            doc.setFont(undefined, 'normal');
            cardY += 5;
            doc.setFontSize(9);
            doc.setTextColor(55, 65, 81);
            for (const line of taskLines) {
                doc.text(line, margin + 7, cardY);
                cardY += 4.2;
            }
            cardY += 3;

            for (let rowIndex = 0; rowIndex < rowHeights.length; rowIndex++) {
                const rowHeight = rowHeights[rowIndex];
                for (let column = 0; column < 2; column++) {
                    const achievement = achievementCards[rowIndex * 2 + column];
                    if (!achievement) continue;
                    const achievementX = margin + 6 + column * (achievementWidth + achievementGap);
                    doc.setFillColor(247, 250, 248);
                    doc.roundedRect(achievementX, cardY, achievementWidth, rowHeight, 3, 3, 'F');
                    doc.setFontSize(9);
                    doc.setTextColor(5, 150, 105);
                    doc.setFont(undefined, 'bold');
                    doc.text(achievement.name, achievementX + 4, cardY + 6);
                    doc.setFont(undefined, 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(55, 65, 81);
                    let achievementY = cardY + 11;
                    for (const line of achievement.lines) {
                        doc.text(line, achievementX + 4, achievementY);
                        achievementY += 3.8;
                    }
                }
                cardY += rowHeight + achievementGap;
            }

            y = cardTop + cardHeight + 8;
        }

        drawFooter();

        // PDF herunterladen oder teilen
        const filename = 'Urkunde_' + new Date().toISOString().split('T')[0] + '.pdf';

        // In iOS native App: PDF ueber Share Sheet teilen
        if (window.isNativeApp && window.nativeAppPlatform === 'ios') {
            const pdfBase64 = doc.output('datauristring');
            window.webkit.messageHandlers.nativeApp.postMessage({
                action: 'sharePDF',
                data: pdfBase64,
                filename: filename
            });
            showToast('PDF wird geteilt...', 'success');
        } else {
            // Im Browser: PDF herunterladen
            doc.save(filename);
            showToast('PDF wurde erstellt!', 'success');
        }

        // Optional: Archiv leeren nach Export
        if (DOM.clearCertificatesAfterExport && DOM.clearCertificatesAfterExport.checked) {
            certificatesState.certificates = [];
            saveCertificates();
            renderCertificateList();
            showToast('Archiv wurde geleert', 'info');
        }

    } catch (error) {
        console.error('Fehler beim PDF-Export:', error);
        showToast('Fehler beim Erstellen des PDFs', 'error');
    }
}

// ============================================================
// Matheforscher-Plattform-Integration (postMessage-Protokoll)
// Aktiv nur, wenn die App im iframe der Matheforscher-Plattform
// läuft. Sonst sind alle Aufrufe No-Ops (window.Matheforscher
// gibt is.Embedded=false zurück und ignoriert send-Calls).
// ============================================================

let matheforscherErrorFoundFlag = false;
let matheforscherHooksInstalled = false;
// Protokoll v3.0: Sitzungszähler für den Report — nur im Speicher, kein Storage.
let matheforscherStrategienAbgeschlossen = 0;

/**
 * Status des KI-Kanals der App-Sammlung (Protokoll v3.2).
 * Ohne Bridge/Kanal immer 'eigener-zugang' — die App arbeitet dann wie bisher.
 * @returns {'bereit'|'deaktiviert'|'eigener-zugang'}
 */
function kiKanalStatus() {
    if (window.Matheforscher && typeof window.Matheforscher.kiStatus === 'function') {
        return window.Matheforscher.kiStatus();
    }
    return 'eigener-zugang';
}

/**
 * Spiegelt den Status des KI-Kanals in die Oberfläche:
 *   'bereit'      -> Body-Klasse "ki-host": eigene Schlüssel-/Anbieter-Felder ausblenden
 *   'deaktiviert' -> Body-Klasse "ki-aus": KI-Funktionen ausblenden, KEIN eigener Zugang
 *   sonst         -> keine Klasse, alles unverändert wie bisher
 */
function applyKiKanalUI(status) {
    document.body.classList.toggle('ki-host', status === 'bereit');
    document.body.classList.toggle('ki-aus', status === 'deaktiviert');
    updateFreeAiNoticeVisibility();
    updateChatPhotoButtonVisibility(currentStrategy);
}

/**
 * Meldet, dass gerade keine KI zur Verfügung steht — mit dem passenden Grund.
 * Bei ausgeschalteter KI in der App-Sammlung gibt es bewusst KEINEN Verweis auf
 * eigene Schlüssel (Protokoll v3.2: kein Rückfall auf den eigenen Zugang).
 */
function meldeKeineKi() {
    if (kiKanalStatus() === 'deaktiviert') {
        alert('Die KI ist in der App-Sammlung ausgeschaltet. Diese Funktion steht deshalb gerade nicht zur Verfügung.');
        return;
    }
    alert('Bitte gib einen API-Key oder eine OpenRouter Worker-URL in den Einstellungen ein.');
    openSettingsModal();
}

function initMatheforscherIntegration() {
    const M = window.Matheforscher;
    if (!M) return;

    // Overflow-„⋯"-Button: blendet Sammlungs-Buttons im Embed ein/aus.
    // Außerhalb des Embed bleibt der Button per CSS unsichtbar — Listener trotzdem registrieren.
    const overflowBtn = document.getElementById('btn-embed-overflow');
    if (overflowBtn) {
        overflowBtn.addEventListener('click', () => {
            const expanded = document.body.classList.toggle('embed-show-extras');
            overflowBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        });
    }

    // Protokoll v3.2: KI-Kanal der App-Sammlung. Der Status kommt erst mit dem hello
    // des Hosts, deshalb per Callback spiegeln statt einmalig abzufragen.
    if (typeof M.onKiStatus === 'function') {
        M.onKiStatus(applyKiKanalUI);
    }

    if (!M.isEmbedded) return;

    M.setStateProvider(buildMatheforscherState);
    M.onConfigChange(async (newConfig) => {
        await applyMatheforscherConfig(newConfig);
        return getActiveMatheforscherConfig();
    });

    // Protokoll v3.0: Report-Ergänzung — zählt erfolgreich abgeschlossene
    // Strategie-Durchgänge (Urkunden) zusätzlich zu den Transfer-Item-Kennzahlen,
    // die die Bridge selbst aus ergebnis()-Aufrufen mitführt.
    if (typeof M.setReportProvider === 'function') {
        M.setReportProvider(() => ({
            kennzahlen: { strategienAbgeschlossen: matheforscherStrategienAbgeschlossen }
        }));
    }

    installMatheforscherHooks();

    // Initiale URL-Konfiguration anwenden, dann State + ready senden.
    Promise.resolve(applyMatheforscherConfig(M.config))
        .catch((err) => console.warn('[Matheforscher] Konfig-Init fehlgeschlagen', err))
        .finally(() => {
            M.pushStateDebounced(50);
            M.ready();
        });
}

function buildMatheforscherState() {
    const lastUser = lastChatMessageByRole('user');
    const lastBot = lastChatMessageByRole('assistant');
    return {
        phase: creationMode === 'explore' ? 'explore' : (creationMode === 'dialog' ? 'dialog' : 'input'),
        task: taskText ? taskText.slice(0, 1200) : null,
        hasImage: !!taskImageBase64,
        taskType: currentTaskType || null,
        strategy: currentStrategy || null,
        messageCount: Array.isArray(chatHistory) ? chatHistory.length : 0,
        lastUserMessage: lastUser ? lastUser.slice(0, 240) : null,
        lastAssistantMessage: lastBot ? lastBot.slice(0, 240) : null,
        errorFound: matheforscherErrorFoundFlag,
        wrongSolutionShown: !!(DOM.wrongSolutionContainer && DOM.wrongSolutionContainer.style.display && DOM.wrongSolutionContainer.style.display !== 'none')
    };
}

function lastChatMessageByRole(role) {
    if (!Array.isArray(chatHistory)) return null;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
        if (chatHistory[i] && chatHistory[i].role === role && typeof chatHistory[i].content === 'string') {
            return chatHistory[i].content;
        }
    }
    return null;
}

function getActiveMatheforscherConfig() {
    return {
        aufgabe: taskText || '',
        strategie: currentStrategy || '',
        modus: creationMode === 'explore' ? 'erkunden' : 'eingeben'
    };
}

async function applyMatheforscherConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;

    // 1) Aufgabe setzen (überschreibt aktuellen Reader-Inhalt, leert Chat)
    const newTask = (typeof cfg.aufgabe === 'string') ? cfg.aufgabe.trim() : '';
    if (newTask && newTask !== (taskText || '').trim()) {
        taskText = newTask;
        taskTextWithGraphics = '';
        taskGraphics = [];
        taskImageBase64 = null;
        currentTaskType = null;
        currentSolutionHint = null;
        currentTaskVisualizable = false; // fail-closed bis zur neuen Klassifikation
        classifyGeneration++; // verspätete Klassifikationen verwerfen
        chatHistory = [];
        chatRequestGeneration++; // laufende Chat-Anfragen gehören zur alten Aufgabe
        chatSendInFlight = false;
        chatBaselineTaskText = '';
        matheforscherErrorFoundFlag = false;
        lastCheckedTaskText = null;
        if (reader && typeof reader.setText === 'function') {
            try { reader.setText(newTask); } catch (e) { console.warn('[Matheforscher] reader.setText', e); }
        }
        if (DOM.chatMessages) DOM.chatMessages.innerHTML = '';
        hideWrongSolutionContainer();
        hideNotebookContainer && hideNotebookContainer();
        currentWrongSolution = null;
        correctSolution = null;
        updateInputStateUI();
    }

    // 2) Modus wechseln
    const wantsExplore = cfg.modus === 'erkunden';
    const wantsInput = cfg.modus === 'eingeben';

    if (wantsExplore && taskText) {
        if (creationMode !== 'explore') {
            try { await switchToExploreMode(); } catch (e) { console.warn('[Matheforscher] switchToExploreMode', e); }
        }
        // 3) Start-Strategie aktivieren
        const strat = typeof cfg.strategie === 'string' ? cfg.strategie.trim() : '';
        if (strat && currentStrategy !== strat) {
            try { selectStrategy(strat); } catch (e) { console.warn('[Matheforscher] selectStrategy', e); }
        }
    } else if (wantsInput) {
        if (creationMode !== 'text') {
            try { switchToInputMode(); } catch (e) { console.warn('[Matheforscher] switchToInputMode', e); }
        }
    }
}

function installMatheforscherHooks() {
    if (matheforscherHooksInstalled) return;
    matheforscherHooksInstalled = true;
    const M = window.Matheforscher;

    // selectStrategy: Action „select strategy" + State.
    const _selectStrategy = selectStrategy;
    selectStrategy = function (strategy) {
        const ret = _selectStrategy.apply(this, arguments);
        matheforscherErrorFoundFlag = false;
        M.action('select', 'strategy', { strategy });
        M.pushStateDebounced(50);
        return ret;
    };

    // backToStrategies: zurück zur Strategie-Liste.
    if (typeof backToStrategies === 'function') {
        const _backToStrategies = backToStrategies;
        backToStrategies = function () {
            const ret = _backToStrategies.apply(this, arguments);
            M.action('back', 'strategies');
            M.pushStateDebounced(50);
            return ret;
        };
    }

    // switchToInputMode
    const _switchToInputMode = switchToInputMode;
    switchToInputMode = function () {
        const ret = _switchToInputMode.apply(this, arguments);
        M.action('enter', 'mode', { mode: 'eingeben' });
        M.pushStateDebounced(50);
        return ret;
    };

    // switchToExploreMode (async)
    const _switchToExploreMode = switchToExploreMode;
    switchToExploreMode = async function () {
        const ret = await _switchToExploreMode.apply(this, arguments);
        M.action('enter', 'mode', { mode: 'erkunden' });
        M.pushStateDebounced(50);
        return ret;
    };

    // appendChatMessage
    const _appendChatMessage = appendChatMessage;
    appendChatMessage = function (text, sender, imageBase64) {
        const ret = _appendChatMessage.apply(this, arguments);
        const role = (sender === 'bot') ? 'assistant' : 'user';
        const payload = { preview: (text || '').slice(0, 240) };
        if (currentStrategy) payload.strategy = currentStrategy;
        if (imageBase64) payload.hasImage = true;
        M.action('message', role, payload);
        M.pushStateDebounced(200);
        return ret;
    };

    // checkIfErrorFound (Detektiv-Modus): Erfolgssignal.
    const _checkIfErrorFound = checkIfErrorFound;
    checkIfErrorFound = function (response) {
        const found = _checkIfErrorFound.apply(this, arguments);
        if (found && !matheforscherErrorFoundFlag) {
            matheforscherErrorFoundFlag = true;
            M.progress('Fehler im Detektiv-Modus gefunden');
            M.complete({ strategy: 'detective', taskType: currentTaskType || null });
            M.pushStateDebounced(50);
        }
        return found;
    };

    // handlePhotoUpload
    if (typeof handlePhotoUpload === 'function') {
        const _handlePhotoUpload = handlePhotoUpload;
        handlePhotoUpload = async function () {
            const ret = await _handlePhotoUpload.apply(this, arguments);
            M.action('upload', 'photo');
            M.pushStateDebounced(500);
            return ret;
        };
    }

    // handleGenerateTask
    if (typeof handleGenerateTask === 'function') {
        const _handleGenerateTask = handleGenerateTask;
        handleGenerateTask = async function () {
            const ret = await _handleGenerateTask.apply(this, arguments);
            M.action('generate', 'task');
            M.pushStateDebounced(500);
            return ret;
        };
    }
}
