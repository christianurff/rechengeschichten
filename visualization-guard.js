/*
 * visualization-guard.js
 * Deterministische Absicherung des Visualisieren-Modus (fail-closed):
 * - precheckVisualizable(text): Ist die Aufgabe grundsätzlich mit Plättchen legbar?
 *   (nur zählbare Objekte, natürliche Zahlen <= 100, keine Größen/Geld/Vergleiche)
 * - validatePlan(plan, opts): siehe Task 2.
 * Dual-Export (Browser-Global + Node), Muster wie visualization-prompts.js.
 */
(function (global) {
  'use strict';

  const MAX_NUMBER = 100;

  // Nicht-zählbare Größen und Geld: als eigenständige Wörter (Umlaute beachten)
  const UNIT_WORD_RE = /\b(euro|eur|cent|ct|kilometer|meter|zentimeter|millimeter|kilogramm|gramm|tonnen?|liter|milliliter|sekunden?|minuten?|stunden?|uhr)\b/i;
  // Abgekürzte Einheiten direkt hinter einer Zahl: "5 km", "5km", "3 l", "20 min", "12 €"
  // Achtung: `\b` funktioniert nach `€` nicht (kein Wortzeichen davor/danach) — daher
  // Wortende über Lookahead auf Leerzeichen/Satzende/Satzzeichen prüfen statt `\b`.
  const UNIT_ABBR_RE = /\d\s*(km|cm|mm|m|kg|g|t|l|ml|h|min|sek|s|€)(?=\s|$|[.,!?])/i;
  // Kommazahlen (1,5 / 1.5), Uhrzeiten/Verhältnisse (14:32), Ziffern-Brüche (1/2)
  const DECIMAL_RE = /\d+[.,]\d+/;
  // Nur echte Uhrzeit-Muster (7:30, 14:05) - das frühere /\d\s*:\s*\d/ blockte
  // fälschlich Aufgabennummerierungen wie "Aufgabe 1: 5 Kinder ...".
  const COLON_RE = /\b\d{1,2}:\d{2}\b/;
  const RATIO_WORD_RE = /\bverhältnis\b/i;
  const FRACTION_RE = /\d\s*\/\s*\d|[½⅓¼¾]/;
  // Nur echte Bruch-Wörter - das frühere halb\w* blockte auch Halbzeit/Halbfinale/Halbinsel.
  const FRACTION_WORD_RE = /\b(halb(e|en|er|es)?|hälfte|drittel|viertel|achtel|anderthalb)\b|\w*einhalb\b/i;
  // Vergleichs-Signalwörter (Engine hat keine Vergleichsdarstellung)
  const COMPARE_RE = /\b(mehr als|weniger als|unterschied|wie viele? mehr|wie viele? weniger)\b/i;

  function precheckVisualizable(text) {
    if (!text || typeof text !== 'string' || !text.trim()) {
      return { ok: false, reason: 'kein Text' };
    }
    if (DECIMAL_RE.test(text)) return { ok: false, reason: 'Kommazahl' };
    if (COLON_RE.test(text) || RATIO_WORD_RE.test(text)) return { ok: false, reason: 'Uhrzeit/Verhältnis' };
    if (FRACTION_RE.test(text) || FRACTION_WORD_RE.test(text)) return { ok: false, reason: 'Bruch' };
    if (UNIT_WORD_RE.test(text) || UNIT_ABBR_RE.test(text)) return { ok: false, reason: 'Größe/Geld statt zählbarer Objekte' };
    if (COMPARE_RE.test(text)) return { ok: false, reason: 'Vergleichsaufgabe' };
    const numbers = (text.match(/\d+/g) || []).map(Number);
    if (numbers.some(n => n > MAX_NUMBER)) return { ok: false, reason: 'Zahl über ' + MAX_NUMBER };
    return { ok: true, reason: null };
  }

  // Im Browser liegen die reinen Helfer (createState, normalizeStep, reduceStep, ...)
  // auf QVHelpers — das UI-Objekt QuantityVisualizer exportiert sie nicht vollständig.
  const QV = (typeof module !== 'undefined' && typeof require === 'function')
    ? require('./quantity-visualizer.js')
    : (global.QVHelpers || global.QuantityVisualizer || null);

  function extractAnswerNumber(solutionHint) {
    if (!solutionHint || typeof solutionHint.antwort !== 'string') return null;
    if (/nicht lösbar|nicht loesbar/i.test(solutionHint.antwort)) return null;
    const m = solutionHint.antwort.match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  function activeGroupSizes(state) {
    const groups = {};
    QV.activeTokens(state).forEach(t => {
      const g = (t.group === null || t.group === undefined) ? '_' : t.group;
      groups[g] = (groups[g] || 0) + 1;
    });
    return Object.keys(groups).map(k => groups[k]);
  }

  function validatePlan(plan, opts) {
    opts = opts || {};
    const maxCount = opts.maxCount || MAX_NUMBER;
    const errors = [];
    if (!QV) return { ok: false, errors: ['QuantityVisualizer nicht verfügbar'] };
    if (!Array.isArray(plan) || plan.length === 0) return { ok: false, errors: ['leerer Plan'] };

    const steps = plan.map(QV.normalizeStep);

    // (1) jeder Schritt gültig (inkl. teilen-Paarkonsistenz aus validateStep)
    steps.forEach((s, i) => {
      const v = QV.validateStep(s);
      if (!v.ok) errors.push('Schritt ' + i + ': ' + v.error);
    });
    if (errors.length) return { ok: false, errors };

    // (2) erster sichtbarer Schritt legt eine Ausgangsmenge
    const firstVisible = steps.find(s => s && s.aktion !== 'vorbereiten' && s.aktion !== 'zuruecksetzen');
    if (!firstVisible || ['hinzufuegen', 'malnehmen', 'gruppen_anlegen'].indexOf(firstVisible.aktion) === -1) {
      errors.push('Plan beginnt nicht mit einer Ausgangsmenge (hinzufuegen/malnehmen/gruppen_anlegen)');
    }

    // (3) höchstens 3 sichtbare Stationen (Ausgangsmenge + max. 2 Operationen)
    const visible = steps.filter(s => s && s.aktion !== 'vorbereiten' && s.aktion !== 'zuruecksetzen');
    if (visible.length > 3) errors.push('zu viele Stationen: ' + visible.length + ' (max. 3)');

    // (4) Trockenlauf mit Invarianten je Schritt
    let state = QV.createState();
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const before = QV.activeTokens(state).length;
      if (s.aktion === 'wegnehmen') {
        const groupsBefore = activeGroupSizes(state).length;
        const toRemove = (s.anzahl | 0) * (s.jeGruppe ? Math.max(1, groupsBefore) : 1);
        if (toRemove > before) errors.push('Schritt ' + i + ': wegnehmen ' + toRemove + ' > Bestand ' + before);
      }
      if (s.aktion === 'malnehmen' && !s.anhaengen && before > 0) {
        errors.push('Schritt ' + i + ': malnehmen ohne anhaengen würde die liegende Menge löschen');
      }
      if (s.aktion === 'malnehmen' && !s.anhaengen && state.layout === 'gruppen' && state.groupCount &&
          state.groupCount !== (s.gruppen | 0)) {
        errors.push('Schritt ' + i + ': vorbereitete Gruppen passen nicht zu malnehmen');
      }
      if (s.aktion === 'malnehmen' && !s.anhaengen && state.layout === 'gruppen' && state.groupCapacity &&
          state.groupCapacity !== (s.proGruppe | 0)) {
        errors.push('Schritt ' + i + ': vorbereitete Gruppengröße passt nicht zu malnehmen');
      }
      if (s.aktion === 'zusammenfassen' && before === 0) {
        errors.push('Schritt ' + i + ': keine Menge zum Zusammenfassen');
      }
      if (s.aktion === 'teilen') {
        const divisor = s.grundvorstellung === 'aufteilen' ? (s.proGruppe | 0) : (s.anzahlGruppen | 0);
        if (divisor > 0 && before % divisor !== 0) {
          errors.push('Schritt ' + i + ': ' + before + ' ist nicht durch ' + divisor + ' teilbar');
        }
      }
      state = QV.reduceStep(state, s);
      const after = QV.activeTokens(state).length;
      if (after > maxCount) errors.push('Schritt ' + i + ': Menge ' + after + ' > ' + maxCount);
    }

    // (5) Endstand gegen die Lösungszahl (aktiv ODER je Gruppe ODER Gruppenzahl)
    const answer = (typeof opts.expectedAnswer === 'number' && isFinite(opts.expectedAnswer))
      ? opts.expectedAnswer : null;
    if (answer !== null) {
      const active = QV.activeTokens(state).length;
      const sizes = activeGroupSizes(state);
      const uniform = (sizes.length > 1 && sizes.every(x => x === sizes[0])) ? sizes[0] : null;
      const groupCount = sizes.length > 1 ? sizes.length : null;
      if (active !== answer && uniform !== answer && groupCount !== answer) {
        errors.push('Endstand passt nicht zur Lösung ' + answer +
          ' (aktiv ' + active + ', je Gruppe ' + uniform + ', Gruppen ' + groupCount + ')');
      }
    }

    return { ok: errors.length === 0, errors };
  }

  const api = { precheckVisualizable, validatePlan, extractAnswerNumber, MAX_NUMBER };
  global.VisualizationGuard = Object.assign(global.VisualizationGuard || {}, api);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.assign(module.exports || {}, api);
  }
})(typeof window !== 'undefined' ? window : globalThis);
