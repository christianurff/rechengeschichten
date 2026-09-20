/**
 * Matheforscher-Plattform postMessage-Bridge.
 *
 * Bindet die Webapp in die Matheforscher-Plattform ein, wenn sie dort
 * per iframe eingebettet wird. Außerhalb der Plattform sind alle
 * Funktionen No-Ops, sodass dieselbe Datei auch in der iOS-App
 * unschädlich enthalten sein kann.
 *
 * Protokoll-Spezifikation: postmessage-protokoll.md
 *
 * Public API (window.Matheforscher):
 *   .isEmbedded                                Boolean – läuft die App in der Plattform?
 *   .config                                    Aktuelle Konfiguration (aufgabe/strategie/modus)
 *   .supportedParams                           Schema der unterstützten Parameter
 *   .action(action, target?, payload?)         Action-Event senden
 *   .progress(hinweis, payload?)               Progress-Chip senden
 *   .state(stateOrFn)                          State direkt senden ODER Provider setzen
 *   .pushStateDebounced(ms?)                   Aktuellen State (vom Provider) debounced senden
 *   .pushState()                               Aktuellen State (vom Provider) sofort senden
 *   .complete(payload?)                        Complete-Event senden (informativ)
 *   .error(message)                            Error-Event senden
 *   .setStateProvider(fn)                      Provider-Funktion registrieren
 *   .onConfigChange(fn)                        Handler für Live-Reconfigure registrieren
 *   .ready()                                   Ready-Event manuell senden (selten nötig)
 *
 * Protokoll v3.0 — Integrierte Hosts (Profil-Kontext & Reporting):
 *   .capabilities                              Vom Host beim hello/discover gemeldete Events (Array, Default [])
 *   .context                                   Zuletzt vom Host übermittelter Kontext ({ profil, locale }), nur lokal gehalten
 *   .ergebnis(payload)                         Bewertetes Item senden (Pflicht: aufgabe, korrekt) — NUR wenn Host 'ergebnis' als capability meldet
 *   .setReportProvider(fn)                     App-spezifische Report-Ergänzung registrieren: fn(scope, stats) => { kennzahlen?, zusammenfassung?, diagnostik?, empfehlung? }
 *   .sendReport(scope?)                        Report unaufgefordert senden (z.B. nach abgeschlossenem Durchgang) — NUR wenn Host 'report' als capability meldet
 *   .diagnoseFehlertyp(erwartet, antwort)       Reine Hilfsfunktion: einfache Fehlertyp-Diagnose für numerische Transfer-Items
 *
 * Protokoll v3.2 — KI-Kanal (der Host stellt die KI):
 *   .kiStatus()                                'bereit' | 'deaktiviert' | 'eigener-zugang' (Default ohne Kanal)
 *   .kiFaehigkeiten()                          ['text','json','stream','vision'] — leer, wenn nicht 'bereit'
 *   .kiKann(name)                              Kurzform für kiFaehigkeiten().includes(name)
 *   .onKiStatus(fn)                            Callback bei Statuswechsel (hello / ki-status): fn(status, info)
 *   .kiAnfrage(payload, { onChunk })           Chat-Anfrage an den Host (Promise), siehe Protokoll 1.2
 *   .kiAbbrechen(id)                           Offene Anfrage abbrechen (ki-cancel)
 *
 * Diese App hat KEINE eigene Benutzer-/Spielerverwaltung — Abschnitt B
 * (Profil-Adoption) entfällt bewusst. Der Kontext wird gemäß Protokoll
 * gemerkt und bei set-context bestätigt, aber nirgends zur UI-Anpassung
 * verwendet.
 */
(function () {
    'use strict';

    const PROTOCOL_VERSION = 1;

    const supportedParams = {
        aufgabe: {
            type: 'string',
            default: '',
            description: 'Vorgegebener Sachaufgaben-Text. Wenn gesetzt, wird er beim Start in den Reader geladen.'
        },
        strategie: {
            type: 'string',
            default: '',
            values: ['read', 'ask', 'understand', 'solve', 'check', 'detective', 'assumptions'],
            description: 'Start-Strategie im Erkunden-Modus: read (Vorlesen), ask (Fragen stellen), understand (Text verstehen), solve (Lösen helfen), check (Lösung prüfen), detective (Fehler suchen), assumptions (Annahmen für Fermi-Aufgaben).'
        },
        modus: {
            type: 'string',
            default: 'eingeben',
            values: ['eingeben', 'erkunden'],
            description: 'Start-Modus. "erkunden" springt direkt in den Erkundungsmodus, wenn auch "aufgabe" gesetzt ist.'
        }
    };

    function readConfigFromUrl() {
        const params = new URLSearchParams(location.search);
        return {
            aufgabe: params.get('aufgabe') || '',
            strategie: params.get('strategie') || '',
            modus: params.get('modus') || supportedParams.modus.default
        };
    }

    const urlParams = new URLSearchParams(location.search);
    let inMatheforscher =
        urlParams.get('matheforscher') === '1' ||
        location.hash.includes('matheforscher=1') ||
        window.self !== window.top;

    let currentConfig = readConfigFromUrl();

    // ===== Protokoll v3.0: Capabilities & Profil-Kontext (Host → App) =====
    // Vom zuletzt empfangenen hello/discover gemeldete Events, die der Host
    // verwertet. v2-Hosts (mathe.digital prod) senden dieses Feld nicht →
    // bleibt leer → ergebnis/report werden nie gesendet (Gate weiter unten).
    let capabilities = [];
    // Zuletzt vom Host übermittelter Kontext. Rein lokal für Zuordnung/Anzeige —
    // fließt NIE in einen ausgehenden send()-Aufruf ein (Datenschutz, Regel 3).
    let hostContext = { profil: null, locale: null };
    // Optionale App-spezifische Report-Ergänzung, siehe setReportProvider().
    let reportProvider = null;
    // Sitzungszähler für den Report — ausschließlich im Speicher, kein Storage.
    const reportStats = {
        bearbeitet: 0,
        korrekt: 0,
        fehlertypen: Object.create(null),
        startZeit: Date.now()
    };

    function hasCapability(caps, type) {
        return Array.isArray(caps) && caps.indexOf(type) !== -1;
    }

    // ===== Protokoll v3.2: KI-Kanal (Host → App) =====
    // kiInfo bleibt null, bis ein hello mit 'ki' in capabilities UND einem ki-Objekt
    // eintrifft. Ohne Kanal (standalone, mathe.digital, ältere Hosts) gilt
    // 'eigener-zugang' — die App nutzt dann ihre bisherigen Zugänge unverändert.
    let kiInfo = null;
    const kiOffen = new Map();      // id -> { resolve, reject, onChunk, timer }
    let kiZaehler = 0;
    const kiStatusHandler = [];

    /** Übernimmt ein ki-Objekt (aus hello oder ki-status) und meldet Statuswechsel. */
    function applyKiInfo(info) {
        const gueltig = (info && typeof info === 'object' && typeof info.status === 'string') ? info : null;
        const vorher = kiStatus();
        kiInfo = gueltig;
        const nachher = kiStatus();
        if (vorher === nachher) return;
        for (const fn of kiStatusHandler) {
            try {
                fn(nachher, kiInfo ? { ...kiInfo } : null);
            } catch (err) {
                console.warn('[Matheforscher] onKiStatus-Handler hat geworfen', err);
            }
        }
    }

    /** 'bereit' | 'deaktiviert' | 'eigener-zugang' */
    function kiStatus() {
        return kiInfo ? kiInfo.status : 'eigener-zugang';
    }

    /** Fähigkeiten des Host-Zugangs (z.B. ['text','json','vision']); leer, wenn nicht bereit. */
    function kiFaehigkeiten() {
        return (kiInfo && kiInfo.status === 'bereit' && Array.isArray(kiInfo.faehigkeiten))
            ? kiInfo.faehigkeiten.slice()
            : [];
    }

    function kiKann(name) {
        return kiFaehigkeiten().indexOf(name) !== -1;
    }

    /** Beendet eine offene Anfrage (Timer weg, aus der Map raus) und gibt ihren Eintrag zurück. */
    function kiEintragEntnehmen(id) {
        const eintrag = kiOffen.get(id);
        if (!eintrag) return null;
        kiOffen.delete(id);
        clearTimeout(eintrag.timer);
        return eintrag;
    }

    /**
     * KI-Anfrage an den Host (Protokoll v3.2, Abschnitt 1.2).
     * payload: { messages, zweck?, modell?, temperature?, maxTokens?, antwortFormat?, stream?, timeoutMs? }
     * Löst mit der ki-response-Payload auf ({ text, json?, anbieter, modell?, usage? });
     * rejected mit einem Error, der `code` trägt (z.B. 'deaktiviert', 'timeout', 'anbieter').
     */
    function kiAnfrage(payload, options) {
        const onChunk = options && typeof options.onChunk === 'function' ? options.onChunk : null;
        return new Promise((resolve, reject) => {
            const status = kiStatus();
            if (status !== 'bereit') {
                const err = new Error(status === 'deaktiviert'
                    ? 'Die KI ist in der App-Sammlung ausgeschaltet.'
                    : 'Kein KI-Kanal verfügbar.');
                err.code = status;
                reject(err);
                return;
            }
            const id = 'k' + (++kiZaehler) + '-' + Date.now().toString(36);
            // Etwas länger warten als der Host selbst, damit dessen Timeout zuerst greift.
            const frist = (payload && typeof payload.timeoutMs === 'number' ? payload.timeoutMs : 60000) + 5000;
            const timer = setTimeout(() => {
                if (!kiOffen.has(id)) return;
                kiOffen.delete(id);
                send({ type: 'matheforscher:ki-cancel', id });
                const err = new Error('Keine Antwort vom Host.');
                err.code = 'timeout';
                reject(err);
            }, frist);
            kiOffen.set(id, { resolve, reject, onChunk, timer });
            send({ type: 'matheforscher:ki-request', id, payload });
        });
    }

    /** Bricht eine laufende Anfrage ab; der Host antwortet mit ki-error { code: 'abgebrochen' }. */
    function kiAbbrechen(id) {
        if (!kiOffen.has(id)) return;
        send({ type: 'matheforscher:ki-cancel', id });
    }

    function applyHostContext(ctx) {
        if (!ctx || typeof ctx !== 'object') return;
        if ('profil' in ctx) {
            hostContext.profil = (ctx.profil && typeof ctx.profil === 'object') ? { ...ctx.profil } : null;
        }
        if (typeof ctx.locale === 'string') hostContext.locale = ctx.locale;
    }

    /**
     * Reine Diagnose-Funktion für numerische Transfer-Items: vergleicht
     * erwartete und tatsächliche Antwort und erkennt einfache, generische
     * Fehlermuster (kein DOM-/App-Zugriff, isoliert testbar).
     */
    function diagnoseFehlertyp(erwartet, antwort) {
        if (typeof erwartet !== 'number' || !Number.isFinite(erwartet)) return null;
        if (typeof antwort !== 'number' || !Number.isFinite(antwort)) return 'keine-antwort';
        if (antwort === erwartet) return null;
        const a = Math.round(antwort);
        const e = Math.round(erwartet);
        if (e !== 0 && a === -e) return 'rechenart-verwechslung';
        const absA = Math.abs(a);
        const absE = Math.abs(e);
        if (absA >= 10 && absA <= 99 && absE >= 10 && absE <= 99) {
            const aRev = Number(String(absA).split('').reverse().join(''));
            if (aRev === absE) return 'zahlendreher';
        }
        if (Math.abs(a - e) <= 2) return 'kleiner-rechenfehler';
        return 'rechenfehler';
    }

    /** Reine Report-Payload-Bau-Funktion — Stats als Parameter, kein Modulzustand-Zugriff. */
    function buildReportPayload(stats, scope, extra) {
        const dauerSec = Math.max(0, Math.round((Date.now() - stats.startZeit) / 1000));
        const kennzahlen = { bearbeitet: stats.bearbeitet, korrekt: stats.korrekt, dauerSec };
        let zusammenfassung;
        if (stats.bearbeitet === 0) {
            zusammenfassung = 'In dieser Sitzung wurde noch keine Transfer-Aufgabe bearbeitet.';
        } else {
            const quote = Math.round((stats.korrekt / stats.bearbeitet) * 100);
            zusammenfassung = stats.bearbeitet + ' Transfer-Aufgabe(n) bearbeitet, ' + stats.korrekt + ' davon richtig (' + quote + '%).';
            const fehlertypEntries = Object.keys(stats.fehlertypen).map((k) => [k, stats.fehlertypen[k]]);
            if (fehlertypEntries.length > 0) {
                fehlertypEntries.sort((a, b) => b[1] - a[1]);
                zusammenfassung += ' Häufigster Fehlertyp: ' + fehlertypEntries[0][0] + '.';
            }
        }
        const payload = { scope: scope || 'sitzung', zusammenfassung, kennzahlen };
        if (Object.keys(stats.fehlertypen).length > 0) {
            payload.diagnostik = { fehlertypen: { ...stats.fehlertypen } };
        }
        if (stats.bearbeitet > 0 && (stats.korrekt / stats.bearbeitet) < 0.5) {
            payload.empfehlung = 'Gemeinsam weiter an Sachaufgaben üben, z.B. mit der Strategie "Lösen helfen".';
        }
        if (extra && typeof extra === 'object') {
            if (extra.kennzahlen && typeof extra.kennzahlen === 'object') {
                Object.assign(payload.kennzahlen, extra.kennzahlen);
            }
            if (typeof extra.zusammenfassung === 'string' && extra.zusammenfassung.trim()) {
                payload.zusammenfassung = (payload.zusammenfassung + ' ' + extra.zusammenfassung.trim()).trim();
            }
            if (extra.diagnostik && typeof extra.diagnostik === 'object') {
                payload.diagnostik = Object.assign({}, payload.diagnostik || {}, extra.diagnostik);
            }
            if (typeof extra.empfehlung === 'string' && extra.empfehlung.trim()) {
                payload.empfehlung = extra.empfehlung.trim();
            }
        }
        return payload;
    }

    function trackErgebnisStats(payload) {
        if (payload.korrekt === true || payload.korrekt === false) {
            reportStats.bearbeitet++;
            if (payload.korrekt === true) reportStats.korrekt++;
        }
        if (payload.korrekt === false && typeof payload.fehlertyp === 'string' && payload.fehlertyp) {
            reportStats.fehlertypen[payload.fehlertyp] = (reportStats.fehlertypen[payload.fehlertyp] || 0) + 1;
        }
    }

    function sendReportIfCapable(scope, targetWindow, targetOrigin) {
        if (!hasCapability(capabilities, 'report')) return;
        let extra = null;
        if (typeof reportProvider === 'function') {
            try {
                extra = reportProvider(scope, { ...reportStats, fehlertypen: { ...reportStats.fehlertypen } });
            } catch (err) {
                console.warn('[Matheforscher] reportProvider hat geworfen', err);
            }
        }
        const payload = buildReportPayload(reportStats, scope, extra);
        const msg = { type: 'matheforscher:report', payload };
        if (targetWindow) {
            try {
                targetWindow.postMessage(msg, targetOrigin || '*');
            } catch (err) {
                console.warn('[Matheforscher] report-Antwort fehlgeschlagen', err);
            }
        } else {
            send(msg);
        }
    }

    function send(msg) {
        if (!inMatheforscher) return;
        try {
            window.parent.postMessage(msg, '*');
        } catch (err) {
            console.warn('[Matheforscher] postMessage fehlgeschlagen', err);
        }
    }

    let stateProvider = null;
    let configChangeHandler = null;
    let lastStateJson = null;
    let stateDebounceTimer = null;

    function snapshotState() {
        if (typeof stateProvider !== 'function') return null;
        try {
            return stateProvider();
        } catch (err) {
            console.warn('[Matheforscher] State-Provider hat geworfen', err);
            return null;
        }
    }

    function pushState() {
        if (!inMatheforscher) return;
        const state = snapshotState();
        if (state == null) return;
        let json;
        try {
            json = JSON.stringify(state);
        } catch (err) {
            console.warn('[Matheforscher] State nicht JSON-serialisierbar', err);
            return;
        }
        if (json === lastStateJson) return;
        lastStateJson = json;
        send({ type: 'matheforscher:state', state });
    }

    function pushStateDebounced(ms) {
        if (!inMatheforscher) return;
        if (stateDebounceTimer) clearTimeout(stateDebounceTimer);
        stateDebounceTimer = setTimeout(pushState, typeof ms === 'number' ? ms : 250);
    }

    // App-Manifest (v3) — Selbstbeschreibung fürs ready-Event. Kein B (keine
    // eigene Benutzerverwaltung) → profilAdoption bewusst weggelassen.
    const MANIFEST = {
        name: 'Rechengeschichten',
        description: 'KI-begleitete Sachaufgaben: Kinder lesen, verstehen, lösen und prüfen Textaufgaben (Sachrechnen) in freier Konversation mit didaktischen Strategien nach PIKAS.',
        kindActions: 'Aufgabe eingeben, fotografieren oder generieren lassen; eine Strategie wählen (Text lesen, Fragen stellen, Text verstehen, Lösen, Lösung prüfen, Fehler finden, Schätzen); im Chat mit der KI arbeiten; am Ende ggf. eine kurze Transfer-Mini-Aufgabe rechnen.',
        categories: ['Sachrechnen', 'Textaufgaben', 'Modellieren'],
        stateSchema: 'state.phase: aktuelle Ansicht ("input"|"explore"|"dialog"). state.task: Aufgabentext (gekürzt) oder null. state.taskType: erkannter Aufgabentyp oder null. state.strategy: gewählte Strategie oder null. state.messageCount: Anzahl Chat-Nachrichten. state.errorFound: im Detektiv-Modus Fehler gefunden (bool).',
        defaultParams: { modus: 'eingeben' },
        version: '1.0.0',
        reporting: {
            ergebnis: true,
            reportScopes: ['sitzung'],
            reportSchema: 'kennzahlen.bearbeitet/korrekt: Anzahl bzw. richtig gelöste Transfer-Mini-Aufgaben (strukturgleiche Mini-Aufgabe direkt nach einer erfolgreich abgeschlossenen Sachaufgabe, ohne KI-Hilfe, ein Versuch). kennzahlen.strategienAbgeschlossen: Anzahl von der KI als erfolgreich erkannter Strategie-Durchgänge (Urkunden) in dieser Sitzung. kennzahlen.dauerSec: Sitzungsdauer seit App-Start. diagnostik.fehlertypen: Zähl-Objekt je erkanntem Fehlertyp bei falschen Transfer-Antworten (zahlendreher, rechenart-verwechslung, kleiner-rechenfehler, rechenfehler, keine-antwort).'
        },
        // Protokoll v3.2: Die App kann ihre gesamte Chat-KI über den Kanal des Hosts
        // beziehen. 'vision' wird für Foto-/Zeichnungs-Erkennung gebraucht, 'json' für
        // die strukturierten Anfragen (Klassifikation, Wortbilder, Fehlersuche) — fehlt
        // eine Fähigkeit, degradiert die App (Text robust parsen bzw. Bild-Funktion aus).
        ki: {
            beschreibung: 'Sachaufgaben-Begleitung: Aufgaben erkennen und generieren, Strategie-Chat, Wort-Erklärungen, Klassifikation und Visualisierungspläne',
            faehigkeiten: ['text', 'json', 'vision']
        },
        protocolLevel: 4
    };

    function sendReady(targetWindow, targetOrigin) {
        const msg = {
            type: 'matheforscher:ready',
            payload: {
                config: { ...currentConfig },
                supportedParams,
                manifest: MANIFEST
            }
        };
        if (targetWindow) {
            try {
                targetWindow.postMessage(msg, targetOrigin || '*');
            } catch (err) {
                console.warn('[Matheforscher] ready an Source fehlgeschlagen', err);
            }
        } else {
            send(msg);
        }
    }

    let html2canvasPromise = null;
    function loadHtml2canvas() {
        if (!html2canvasPromise) {
            html2canvasPromise = import('https://cdn.jsdelivr.net/npm/html2canvas-pro@2/+esm')
                .then(mod => mod.default || mod)
                .catch(err => {
                    html2canvasPromise = null;
                    throw err;
                });
        }
        return html2canvasPromise;
    }

    async function captureScreenshot() {
        try {
            const html2canvas = await loadHtml2canvas();
            const bgColor = getComputedStyle(document.body).backgroundColor || '#ffffff';
            const canvas = await html2canvas(document.body, {
                useCORS: true,
                scale: 1,
                backgroundColor: bgColor,
                logging: false
            });
            return canvas.toDataURL('image/jpeg', 0.85);
        } catch (err) {
            console.warn('[Matheforscher] Screenshot fehlgeschlagen', err);
            return null;
        }
    }

    function applyEmbeddedClass() {
        if (document.body && !document.body.classList.contains('embedded')) {
            document.body.classList.add('embedded');
        }
    }

    window.addEventListener('message', async (event) => {
        const type = event && event.data && event.data.type;
        if (typeof type !== 'string' || !type.startsWith('matheforscher:')) return;

        if (type === 'matheforscher:hello') {
            inMatheforscher = true;
            applyEmbeddedClass();
            // Protokoll v3.0: capabilities/context merken, sofern vorhanden (v2-Hosts
            // senden diese Felder nicht — hello bleibt idempotent, mehrfach unschädlich).
            if (Array.isArray(event.data.capabilities)) capabilities = event.data.capabilities.slice();
            // Protokoll v3.2: KI-Kanal nur übernehmen, wenn der Host ihn auch anbietet.
            // Bewusst nur beim hello (discover ist ein reiner Manifest-Scan).
            applyKiInfo(hasCapability(capabilities, 'ki') ? event.data.ki : null);
            if (event.data.context) applyHostContext(event.data.context);
            sendReady(event.source, event.origin || '*');
            return;
        }

        if (type === 'matheforscher:discover') {
            if (Array.isArray(event.data.capabilities)) capabilities = event.data.capabilities.slice();
            if (event.data.context) applyHostContext(event.data.context);
            sendReady(event.source, event.origin || '*');
            return;
        }

        if (type === 'matheforscher:set-context') {
            // Kein B (keine eigene Benutzerverwaltung) — Kontext wird nur gemerkt
            // (Datenschutz: nie an einen eigenen Server/Dritte gesendet) und binnen
            // < 500 ms bestätigt, reduzierte Payload wie für Apps ohne Benutzerverwaltung.
            applyHostContext(event.data && event.data.payload && event.data.payload.context);
            try {
                if (event.source) {
                    event.source.postMessage(
                        {
                            type: 'matheforscher:context-applied',
                            payload: { profil: hostContext.profil ? { id: hostContext.profil.id } : null }
                        },
                        event.origin || '*'
                    );
                }
            } catch (err) {
                console.warn('[Matheforscher] context-applied-Antwort fehlgeschlagen', err);
            }
            return;
        }

        if (type === 'matheforscher:request-report') {
            const scope = (event.data && event.data.payload && event.data.payload.scope) || 'sitzung';
            sendReportIfCapable(scope, event.source, event.origin || '*');
            return;
        }

        if (type === 'matheforscher:set-config') {
            const incoming = (event.data && event.data.payload && event.data.payload.config) || {};
            const merged = { ...currentConfig, ...incoming };
            let applied = merged;
            try {
                if (typeof configChangeHandler === 'function') {
                    const result = await configChangeHandler(merged, event.data.payload && event.data.payload.reason);
                    if (result && typeof result === 'object') applied = { ...merged, ...result };
                }
            } catch (err) {
                console.warn('[Matheforscher] Config-Handler hat geworfen', err);
            }
            currentConfig = applied;
            try {
                if (event.source) {
                    event.source.postMessage(
                        { type: 'matheforscher:configured', payload: { config: applied } },
                        event.origin || '*'
                    );
                }
            } catch (err) {
                console.warn('[Matheforscher] configured-Antwort fehlgeschlagen', err);
            }
            // State nach Config-Anwendung neu publizieren
            lastStateJson = null;
            pushStateDebounced(50);
            return;
        }

        // ===== Protokoll v3.2: Antworten des KI-Kanals =====
        // Nur vom eigenen Parent annehmen — die Payload enthält KI-Antworten, die
        // kein fremdes Fenster einschleusen können soll (Absender-Check wie im SDK).
        if (type === 'matheforscher:ki-status'
            || type === 'matheforscher:ki-chunk'
            || type === 'matheforscher:ki-response'
            || type === 'matheforscher:ki-error') {
            if (event.source !== window.parent) return;

            if (type === 'matheforscher:ki-status') {
                applyKiInfo(event.data.payload);
                return;
            }

            const payload = event.data.payload || {};
            if (type === 'matheforscher:ki-chunk') {
                const offen = kiOffen.get(event.data.id);
                if (offen && offen.onChunk && typeof payload.delta === 'string') {
                    try {
                        offen.onChunk(payload.delta);
                    } catch (err) {
                        console.warn('[Matheforscher] onChunk-Handler hat geworfen', err);
                    }
                }
                return;
            }

            const eintrag = kiEintragEntnehmen(event.data.id);
            if (!eintrag) return;
            if (type === 'matheforscher:ki-response') {
                eintrag.resolve(payload);
            } else {
                const err = new Error(payload.message || 'Fehler im KI-Kanal.');
                err.code = payload.code || 'anbieter';
                eintrag.reject(err);
            }
            return;
        }

        if (type === 'matheforscher:request-screenshot') {
            const dataUrl = await captureScreenshot();
            if (!dataUrl) return;
            try {
                if (event.source) {
                    event.source.postMessage(
                        { type: 'matheforscher:screenshot', payload: { dataUrl } },
                        event.origin || '*'
                    );
                }
            } catch (err) {
                console.warn('[Matheforscher] screenshot-Antwort fehlgeschlagen', err);
            }
            return;
        }
    });

    if (inMatheforscher) {
        if (document.body) applyEmbeddedClass();
        else document.addEventListener('DOMContentLoaded', applyEmbeddedClass, { once: true });
    }

    window.Matheforscher = {
        get isEmbedded() { return inMatheforscher; },
        get config() { return { ...currentConfig }; },
        get version() { return PROTOCOL_VERSION; },
        get capabilities() { return capabilities.slice(); },
        get context() {
            return {
                profil: hostContext.profil ? { ...hostContext.profil } : null,
                locale: hostContext.locale
            };
        },
        supportedParams,
        send,
        // Protokoll v3.0: bewertetes Item melden. NUR wirksam, wenn der zuletzt
        // empfangene hello 'ergebnis' als capability gemeldet hat (Gate: Regel 2).
        ergebnis(payload) {
            if (!inMatheforscher) return;
            if (!hasCapability(capabilities, 'ergebnis')) return;
            if (!payload || typeof payload.aufgabe !== 'string' || !payload.aufgabe.trim() ||
                !(payload.korrekt === true || payload.korrekt === false || payload.korrekt === null)) {
                console.warn('[Matheforscher] ergebnis: Pflichtfelder aufgabe/korrekt fehlen oder ungültig', payload);
                return;
            }
            trackErgebnisStats(payload);
            send({ type: 'matheforscher:ergebnis', payload });
        },
        // App-spezifische Report-Ergänzung registrieren: fn(scope, stats) => Teil-Payload.
        setReportProvider(fn) {
            reportProvider = typeof fn === 'function' ? fn : null;
        },
        // Report unaufgefordert senden (z.B. nach abgeschlossenem Durchgang).
        // NUR wirksam, wenn der Host 'report' als capability gemeldet hat.
        sendReport(scope) {
            if (!inMatheforscher) return;
            sendReportIfCapable(scope || 'sitzung');
        },
        diagnoseFehlertyp,
        // ===== Protokoll v3.2: KI-Kanal =====
        kiStatus,
        kiFaehigkeiten,
        kiKann,
        kiAnfrage,
        kiAbbrechen,
        onKiStatus(fn) {
            if (typeof fn !== 'function') return;
            kiStatusHandler.push(fn);
            // Ein hello kann schon eingetroffen sein, bevor die App ihren Handler
            // registriert — deshalb den aktuellen Stand sofort nachreichen.
            try {
                fn(kiStatus(), kiInfo ? { ...kiInfo } : null);
            } catch (err) {
                console.warn('[Matheforscher] onKiStatus-Handler hat geworfen', err);
            }
        },
        action(action, target, payload) {
            if (!inMatheforscher) return;
            const msg = { type: 'matheforscher:action', action };
            if (target != null) msg.target = target;
            if (payload != null) msg.payload = payload;
            send(msg);
        },
        progress(teilaufgabeHinweis, payload) {
            if (!inMatheforscher) return;
            const msg = { type: 'matheforscher:progress', teilaufgabeHinweis };
            if (payload != null) msg.payload = payload;
            send(msg);
        },
        complete(payload) {
            if (!inMatheforscher) return;
            const msg = { type: 'matheforscher:complete' };
            if (payload != null) msg.payload = payload;
            send(msg);
        },
        error(message) {
            if (!inMatheforscher) return;
            send({ type: 'matheforscher:error', message });
        },
        state(stateOrFn) {
            if (typeof stateOrFn === 'function') {
                stateProvider = stateOrFn;
                pushStateDebounced();
            } else if (stateOrFn != null) {
                send({ type: 'matheforscher:state', state: stateOrFn });
            }
        },
        setStateProvider(fn) {
            stateProvider = typeof fn === 'function' ? fn : null;
        },
        pushState,
        pushStateDebounced,
        onConfigChange(fn) {
            configChangeHandler = typeof fn === 'function' ? fn : null;
        },
        ready() {
            if (!inMatheforscher) return;
            sendReady();
        }
    };

    // Dual-Export wie note-pad.js/visualization-guard.js: die reinen
    // Hilfsfunktionen (kein DOM-/window-/location-Zugriff) sind so isoliert
    // in Node testbar. Das Modul selbst bleibt ein reines Browser-Script
    // (führt beim Laden `location`/`document`-Zugriffe aus) — ein direktes
    // `require()` der ganzen Datei ist deshalb nicht sinnvoll.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { hasCapability, diagnoseFehlertyp, buildReportPayload };
    }
})();
