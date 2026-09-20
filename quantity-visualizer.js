/*
 * quantity-visualizer.js
 * Strukturierte, dynamische Mengen-Visualisierung für Sachaufgaben.
 *
 * Aufbau:
 *  - Reiner Kern (in Node testbar): Zustand mit Objekt-Identität, Operations-Transforme,
 *    Schritt-Validierung/-Parsing, adaptive Layout-Berechnung.
 *  - Render-Schicht (nur Browser): DOM-Token, FLIP-Animation, ARASAAC-Symbole,
 *    Symbol/Plättchen-Schalter.
 *
 * Die KI liefert pro Dialogrunde EINEN Schritt als Tag
 * [VISUALISIERUNG]{ ... JSON ... }[/VISUALISIERUNG]; die App parst ihn tolerant und
 * rendert deterministisch.
 */
(function (global) {
  'use strict';

  // =====================================================================
  // Reiner Kern
  // =====================================================================

  function createState() {
    return {
      tokens: [], objects: [], darstellung: 'symbol',
      layout: 'auto', dims: null, groupCount: null, groupCapacity: null,
      groupLabel: null, nextId: 1
    };
  }

  function cloneState(state) {
    return {
      tokens: state.tokens.map(t => ({ id: t.id, kind: t.kind, group: t.group, status: t.status })),
      objects: state.objects.map(o => ({ name: o.name, suchbegriff: o.suchbegriff, einheit: o.einheit, farbe: o.farbe })),
      darstellung: state.darstellung,
      layout: state.layout,
      dims: state.dims ? { rows: state.dims.rows, cols: state.dims.cols } : null,
      groupCount: state.groupCount,
      groupCapacity: state.groupCapacity,
      groupLabel: state.groupLabel,
      nextId: state.nextId
    };
  }

  function activeTokens(state) {
    return state.tokens.filter(t => t.status === 'aktiv');
  }

  const MAX_TOKENS = 2000; // Sicherheitsgrenze gegen versehentliche Riesenmengen

  function addTokens(state, kind, count) {
    const s = cloneState(state);
    const n = Math.max(0, Math.min(MAX_TOKENS, count | 0));
    for (let i = 0; i < n; i++) {
      s.tokens.push({ id: 't' + s.nextId++, kind: kind, group: null, status: 'aktiv' });
    }
    s.layout = 'auto'; s.dims = null; s.groupCount = null;
    s.groupCapacity = null; s.groupLabel = null;
    return s;
  }

  // Fügt jeder bestehenden (aktiven) Gruppe count Token hinzu ("jedes Kind bekommt N dazu")
  function addPerGroup(state, count, kind) {
    const s = cloneState(state);
    const n = Math.max(0, count | 0);
    const k = kind || (s.objects[0] && s.objects[0].name) || 'objekt';
    const groups = [];
    s.tokens.forEach(t => { if (t.status === 'aktiv' && groups.indexOf(t.group) === -1) groups.push(t.group); });
    groups.forEach(g => { for (let i = 0; i < n; i++) s.tokens.push({ id: 't' + s.nextId++, kind: k, group: g, status: 'aktiv' }); });
    return s;
  }

  function removeTokens(state, kind, count) {
    const s = cloneState(state);
    let remaining = Math.max(0, count | 0);
    for (let i = s.tokens.length - 1; i >= 0 && remaining > 0; i--) {
      const t = s.tokens[i];
      if (t.status === 'aktiv' && (!kind || t.kind === kind)) { t.status = 'entfernt'; remaining--; }
    }
    s.layout = 'auto'; s.dims = null; s.groupCount = null;
    s.groupCapacity = null; s.groupLabel = null;
    return s;
  }

  // Entfernt aus JEDER bestehenden (aktiven) Gruppe count Token ("jedes Kind isst N")
  function removePerGroup(state, count) {
    const s = cloneState(state);
    const n = Math.max(0, count | 0);
    const groups = [];
    s.tokens.forEach(t => { if (t.status === 'aktiv' && groups.indexOf(t.group) === -1) groups.push(t.group); });
    groups.forEach(g => {
      let remaining = n;
      for (let i = s.tokens.length - 1; i >= 0 && remaining > 0; i--) {
        const t = s.tokens[i];
        if (t.status === 'aktiv' && t.group === g) { t.status = 'entfernt'; remaining--; }
      }
    });
    return s; // Layout (Gruppen) bleibt erhalten
  }

  function applyMultiply(state, gruppen, proGruppe, grundvorstellung, anhaengen) {
    const s = cloneState(state);
    const kind = (s.objects[0] && s.objects[0].name) || 'objekt';
    const g = Math.max(1, Math.min(144, gruppen | 0));
    const p = Math.max(1, Math.min(144, proGruppe | 0));
    const feld = grundvorstellung === 'feld';

    // anhaengen: Produkt zur bestehenden Menge ergänzen (z. B. a·b + c·d). Sonst neue Arbeitsmenge.
    let baseGroup = 0;
    if (anhaengen && activeTokens(s).length > 0) {
      const existing = [];
      s.tokens.forEach(t => { if (t.status === 'aktiv' && existing.indexOf(t.group) === -1) existing.push(t.group); });
      baseGroup = existing.length;
    } else {
      s.tokens = [];
    }
    const useGroups = feld && !anhaengen ? false : true; // beim Anhängen immer Gruppen
    for (let gi = 0; gi < g; gi++) {
      for (let j = 0; j < p; j++) {
        if (s.tokens.length >= MAX_TOKENS) break;
        s.tokens.push({ id: 't' + s.nextId++, kind: kind, group: useGroups ? 'g' + (baseGroup + gi) : null, status: 'aktiv' });
      }
    }
    if (!useGroups) {
      s.layout = 'feld'; s.dims = { rows: g, cols: p }; s.groupCount = null;
      s.groupCapacity = null; s.groupLabel = null;
    } else {
      s.layout = 'gruppen'; s.dims = null; s.groupCount = baseGroup + g;
      s.groupCapacity = p;
    }
    return s;
  }

  // Legt bei einer Malaufgabe zuerst die noch leeren Gruppen an. proGruppe reserviert
  // bereits die spaetere Breite, ohne die Anzahl durch sichtbare Plaettchen vorwegzunehmen.
  function prepareGroups(state, gruppen, proGruppe, gruppenname) {
    const s = cloneState(state);
    s.tokens = [];
    s.layout = 'gruppen'; s.dims = null;
    s.groupCount = Math.max(1, Math.min(144, gruppen | 0));
    s.groupCapacity = Math.max(1, Math.min(144, proGruppe | 0));
    s.groupLabel = (typeof gruppenname === 'string' && gruppenname.trim()) ? gruppenname.trim() : null;
    return s;
  }

  // Loest die Gruppen nach der Rechnung auf und zeigt dieselben Token als Gesamtmenge.
  function summarizeTotal(state) {
    const s = cloneState(state);
    s.tokens.forEach(t => { if (t.status === 'aktiv') t.group = null; });
    s.layout = 'auto'; s.dims = null; s.groupCount = null;
    s.groupCapacity = null; s.groupLabel = null;
    return s;
  }

  function applyDivide(state, grundvorstellung, param) {
    const s = cloneState(state);
    const act = s.tokens.filter(t => t.status === 'aktiv');
    if (grundvorstellung === 'aufteilen') {
      const proGruppe = Math.max(1, param | 0);
      act.forEach((t, i) => { t.group = 'g' + Math.floor(i / proGruppe); });
      s.groupCount = Math.ceil(act.length / proGruppe) || 0;
    } else { // verteilen
      const anzahlGruppen = Math.max(1, param | 0);
      act.forEach((t, i) => { t.group = 'g' + (i % anzahlGruppen); });
      s.groupCount = Math.min(anzahlGruppen, act.length) || anzahlGruppen;
    }
    s.layout = 'gruppen'; s.dims = null;
    s.groupCapacity = null; s.groupLabel = null;
    return s;
  }

  function applyBundle(state, buendelgroesse) {
    const s = cloneState(state);
    const size = Math.max(1, (buendelgroesse | 0) || 10);
    const act = s.tokens.filter(t => t.status === 'aktiv');
    act.forEach((t, i) => { t.group = 'b' + Math.floor(i / size); });
    s.layout = 'buendel'; s.groupCount = Math.ceil(act.length / size) || 0; s.dims = { rows: 0, cols: size };
    s.groupCapacity = null; s.groupLabel = null;
    return s;
  }

  // ---------- Schritt-Validierung & Tag-Parsing ----------

  const ALLOWED = {
    vorbereiten: [], hinzufuegen: ['anzahl'], wegnehmen: ['anzahl'],
    malnehmen: ['gruppen', 'proGruppe'], teilen: ['grundvorstellung'],
    gruppen_anlegen: ['gruppen', 'proGruppe'], zusammenfassen: [],
    buendeln: [], hervorheben: [], zuruecksetzen: []
  };

  // Toleriert die von manchen Modellen erzeugte Form {"vorbereiten": {...}} und macht
  // daraus {"aktion":"vorbereiten", ...}. Idempotent.
  function normalizeStep(step) {
    if (!step || typeof step !== 'object') return step;
    if (step.aktion) return step;
    const keys = Object.keys(step);
    if (keys.length === 1 && Object.prototype.hasOwnProperty.call(ALLOWED, keys[0])) {
      const inner = (step[keys[0]] && typeof step[keys[0]] === 'object') ? step[keys[0]] : {};
      return Object.assign({ aktion: keys[0] }, inner);
    }
    return step;
  }

  function validateStep(step) {
    step = normalizeStep(step);
    if (!step || typeof step !== 'object') return { ok: false, error: 'kein Objekt' };
    if (!Object.prototype.hasOwnProperty.call(ALLOWED, step.aktion)) {
      return { ok: false, error: 'unbekannte Aktion: ' + step.aktion };
    }
    for (const req of ALLOWED[step.aktion]) {
      if (step[req] === undefined || step[req] === null) {
        return { ok: false, error: 'fehlendes Feld: ' + req };
      }
    }
    if (step.aktion === 'teilen') {
      if (step.grundvorstellung === 'aufteilen') {
        if (step.proGruppe === undefined || step.proGruppe === null) {
          return { ok: false, error: 'teilen(aufteilen) braucht proGruppe' };
        }
      } else {
        // alles andere läuft in reduceStep als "verteilen"
        if (step.anzahlGruppen === undefined || step.anzahlGruppen === null) {
          return { ok: false, error: 'teilen(verteilen) braucht anzahlGruppen' };
        }
      }
    }
    return { ok: true };
  }

  const VIS_TAG = /\[VISUALISIERUNG\]([\s\S]*?)\[\/VISUALISIERUNG\]/i;

  function parseVisualizationTag(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(VIS_TAG);
    if (!m) return null;
    try { return normalizeStep(JSON.parse(m[1].trim())); }
    catch (e) { return null; }
  }

  function stripVisualizationTag(text) {
    if (typeof text !== 'string') return text;
    return text.replace(new RegExp(VIS_TAG.source, 'gi'), '');
  }

  // Liest ALLE [VISUALISIERUNG]-Tags einer Nachricht und gibt die Schritte in Reihenfolge
  // zurück. Ein Tag darf ein einzelnes Objekt ODER ein Array von Schritten enthalten.
  function parseVisualizationSteps(text) {
    if (typeof text !== 'string') return [];
    const re = new RegExp(VIS_TAG.source, 'gi');
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(m[1].trim());
        if (Array.isArray(parsed)) parsed.forEach(s => out.push(normalizeStep(s)));
        else out.push(normalizeStep(parsed));
      } catch (e) { /* ungültiges JSON ignorieren */ }
    }
    return out;
  }

  // ---------- Schritt-Dispatcher ----------

  function reduceStep(state, step) {
    step = normalizeStep(step);
    const v = validateStep(step);
    if (!v.ok) return state; // tolerant: ungültige Schritte ignorieren
    switch (step.aktion) {
      case 'vorbereiten': {
        // Objekt(e) + Darstellung festlegen, aber bereits gelegte Token NICHT entfernen
        // (die Ausgangsmenge kommt per "hinzufuegen"; zum Leeren gibt es "zuruecksetzen").
        const s = cloneState(state);
        s.objects = (step.objekte || []).map(o => ({
          name: o.name, suchbegriff: o.suchbegriff || o.name, einheit: o.einheit || 1, farbe: o.farbe
        }));
        s.darstellung = step.darstellung === 'plaettchen' ? 'plaettchen' : 'symbol';
        return s;
      }
      case 'hinzufuegen':
        return step.jeGruppe
          ? addPerGroup(state, step.anzahl, step.objekt)
          : addTokens(state, step.objekt || (state.objects[0] && state.objects[0].name) || 'objekt', step.anzahl);
      case 'wegnehmen':
        return step.jeGruppe
          ? removePerGroup(state, step.anzahl)
          : removeTokens(state, step.objekt, step.anzahl);
      case 'malnehmen':
        return applyMultiply(state, step.gruppen, step.proGruppe, step.grundvorstellung === 'feld' ? 'feld' : 'gruppen', !!step.anhaengen);
      case 'gruppen_anlegen':
        return prepareGroups(state, step.gruppen, step.proGruppe, step.gruppenname);
      case 'zusammenfassen':
        return summarizeTotal(state);
      case 'teilen':
        return step.grundvorstellung === 'aufteilen'
          ? applyDivide(state, 'aufteilen', step.proGruppe)
          : applyDivide(state, 'verteilen', step.anzahlGruppen);
      case 'buendeln':
        return applyBundle(state, step.buendelgroesse || 10);
      case 'zuruecksetzen': {
        const s = cloneState(state); s.tokens = []; s.layout = 'auto'; s.dims = null; s.groupCount = null;
        s.groupCapacity = null; s.groupLabel = null;
        return s;
      }
      case 'hervorheben':
      default:
        return state;
    }
  }

  // ---------- Adaptive Layout-Berechnung ----------

  const DISC = 22, GAP = 6, FIVE_GAP = 14, STAGE_PAD = 12, ROW_GAP = 8, FIFTY_GAP = 12;
  const KIND_COLORS = ['blue', 'red', 'green', 'orange', 'violet'];

  // Eine Farbe je OBJEKTART: gleiche Objekte gleiche Farbe, verschiedene Objekte verschiedene.
  function kindColorMap(state) {
    const map = {};
    let idx = 0;
    (state.objects || []).forEach(o => {
      if (o && o.name && !(o.name in map)) {
        map[o.name] = (['red', 'blue', 'green', 'orange', 'violet'].indexOf(o.farbe) !== -1)
          ? o.farbe : KIND_COLORS[idx % KIND_COLORS.length];
        idx++;
      }
    });
    return function (kind) {
      if (kind in map) return map[kind];
      map[kind] = KIND_COLORS[idx++ % KIND_COLORS.length];
      return map[kind];
    };
  }

  function chooseStructure(n) {
    if (n <= 10) return 'fuenfer';
    if (n <= 100) return 'feld';
    return 'buendel';
  }

  // Positionen einer strukturierten Reihe (max. 10 pro Reihe, Lücke nach 5; Abstand nach je 50)
  function fuenferPositions(count, ox, oy) {
    const pos = [];
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 10), col = i % 10;
      const x = ox + col * (DISC + GAP) + (col >= 5 ? FIVE_GAP : 0);
      const y = oy + row * (DISC + ROW_GAP) + Math.floor(row / 5) * FIFTY_GAP;
      pos.push({ x, y });
    }
    return pos;
  }

  // Große Mengen als Hundertertafeln (10x10 mit Fünfer-Struktur), nebeneinander gelegt
  const BLOCKS_PER_ROW = 5;
  function hunderterPositions(count, ox, oy) {
    const pos = [];
    const colStep = DISC + GAP, rowStep = DISC + ROW_GAP;
    const blockW = 10 * colStep + FIVE_GAP;   // inkl. Fünfer-Lücke
    const blockH = 10 * rowStep + FIVE_GAP;
    for (let i = 0; i < count; i++) {
      const block = Math.floor(i / 100), within = i % 100;
      const bcol = block % BLOCKS_PER_ROW, brow = Math.floor(block / BLOCKS_PER_ROW);
      const bx = ox + bcol * (blockW + 26);
      const by = oy + brow * (blockH + 40);
      const col = within % 10, row = Math.floor(within / 10);
      const x = bx + col * colStep + (col >= 5 ? FIVE_GAP : 0);
      const y = by + row * rowStep + (row >= 5 ? FIVE_GAP : 0);
      pos.push({ x, y, color: col < 5 ? 'red' : 'blue' });
    }
    return pos;
  }

  function computeLayout(state, opts) {
    const tokens = [], boxes = [];
    const act = activeTokens(state);
    const removed = state.tokens.filter(t => t.status === 'entfernt');
    const pool = opts && opts.pool; // Phase 1 des Verteilens: Gesamtmenge unter den Gruppen sammeln
    const kindColor = kindColorMap(state); // gleiche Objektart -> gleiche Farbe

    if (state.layout === 'gruppen' || state.layout === 'buendel') {
      const groups = [];
      act.forEach(t => { if (groups.indexOf(t.group) === -1) groups.push(t.group); });
      if (groups.length === 0 && state.layout === 'gruppen' && state.groupCount) {
        for (let gi = 0; gi < state.groupCount; gi++) groups.push('g' + gi);
      }
      const perRow = 5;
      let bx = STAGE_PAD, maxBottom = STAGE_PAD + DISC;
      const meta = {};
      groups.forEach((g, gi) => {
        const members = act.filter(t => t.group === g);
        const reserved = members.length || state.groupCapacity || 1;
        const cols = Math.min(perRow, reserved) || 1;
        const rows = Math.ceil(reserved / perRow) || 1;
        const boxW = cols * (DISC + GAP) + 2 * GAP;
        const boxH = rows * (DISC + ROW_GAP) + 2 * GAP;
        boxes.push({
          group: g, x: bx, y: STAGE_PAD, w: boxW, h: boxH,
          label: state.layout === 'buendel' ? 'Bündel ' + (gi + 1)
            : ((state.groupLabel || 'Gruppe') + ' ' + (gi + 1))
        });
        meta[g] = { gi: gi, bx: bx };
        if (STAGE_PAD + boxH > maxBottom) maxBottom = STAGE_PAD + boxH;
        bx += boxW + 20;
      });

      if (pool) {
        // Phase 1: alle Token als Pool UNTER den (noch leeren) Gruppen, von dort wird verteilt
        const positions = fuenferPositions(act.length, STAGE_PAD, maxBottom + 34);
        act.forEach((t, i) => tokens.push({
          id: t.id, kind: t.kind, x: positions[i].x, y: positions[i].y, color: kindColor(t.kind), ghost: false
        }));
      } else {
        groups.forEach((g) => {
          const m = meta[g];
          const members = act.filter(t => t.group === g);
          members.forEach((t, i) => {
            const col = i % perRow, row = Math.floor(i / perRow);
            tokens.push({
              id: t.id, kind: t.kind,
              x: m.bx + GAP + col * (DISC + GAP), y: STAGE_PAD + GAP + row * (DISC + ROW_GAP),
              color: kindColor(t.kind), ghost: false
            });
          });
        });
      }
    } else if (state.layout === 'feld' && state.dims) {
      const rows = state.dims.rows, cols = state.dims.cols;
      let i = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const t = act[i++]; if (!t) break;
        tokens.push({
          id: t.id, kind: t.kind,
          x: STAGE_PAD + c * (DISC + GAP) + (c >= 5 ? FIVE_GAP : 0), y: STAGE_PAD + r * (DISC + ROW_GAP),
          color: kindColor(t.kind), ghost: false
        });
      }
    } else if (act.length > 100) {
      // Große Mengen: Hundertertafeln nebeneinander
      const pos = hunderterPositions(act.length, STAGE_PAD, STAGE_PAD);
      act.forEach((t, i) => tokens.push({
        id: t.id, kind: t.kind, x: pos[i].x, y: pos[i].y, color: kindColor(t.kind), ghost: false
      }));
    } else {
      const pos = fuenferPositions(act.length, STAGE_PAD, STAGE_PAD);
      act.forEach((t, i) => tokens.push({
        id: t.id, kind: t.kind, x: pos[i].x, y: pos[i].y, color: kindColor(t.kind), ghost: false
      }));
    }

    // Entfernte Token in einer "Beiseite"-Zone, verblasst
    const asideY = layoutBottom(tokens) + 28;
    removed.forEach((t, i) => {
      tokens.push({
        id: t.id, kind: t.kind,
        x: STAGE_PAD + (i % 8) * (DISC + GAP), y: asideY + Math.floor(i / 8) * (DISC + ROW_GAP),
        color: kindColor(t.kind), ghost: true
      });
    });

    // Skalierung bei großen Mengen: Token + Abstände + Boxen kleiner
    const n = act.length;
    const scale = n > 60 ? Math.max(0.58, 70 / n) : 1;
    const size = Math.round(DISC * scale);
    tokens.forEach(t => {
      t.size = size;
      if (scale < 1) { t.x = Math.round(t.x * scale); t.y = Math.round(t.y * scale); }
    });
    if (scale < 1) {
      boxes.forEach(b => { b.x = Math.round(b.x * scale); b.y = Math.round(b.y * scale); b.w = Math.round(b.w * scale); b.h = Math.round(b.h * scale); });
    }
    return { tokens, boxes };
  }

  function layoutBottom(tokens) {
    let max = STAGE_PAD + DISC;
    tokens.forEach(t => { if (t.y + DISC > max) max = t.y + DISC; });
    return max;
  }

  // =====================================================================
  // Render-Schicht (nur Browser)
  // =====================================================================

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Geschwindigkeitsprofile: dur = Dauer einer Token-Bewegung, stagger = Versatz pro Token,
  // stepPause = Pause zwischen Schritten beim automatischen Abspielen (alles in ms).
  // maxWave = obere Schranke für die GESAMTE Staffel-Welle eines Schritts (ms). Bei vielen
  // Plättchen wird der Versatz pro Plättchen entsprechend verkleinert, damit es nicht ewig dauert.
  const SPEED_PROFILES = {
    'schnell':      { dur: 400,  stagger: 70,  stepPause: 700,  maxWave: 1100 },
    'mittel':       { dur: 650,  stagger: 150, stepPause: 1100, maxWave: 1600 },
    'langsam':      { dur: 950,  stagger: 280, stepPause: 1700, maxWave: 2300 },
    'sehr-langsam': { dur: 1400, stagger: 460, stepPause: 2600, maxWave: 3500 }
  };

  const QuantityVisualizer = {
    _state: null, _stage: null, _els: {}, _symbolCache: {}, _sequence: null, _seqIndex: 0,
    _speedProfile: SPEED_PROFILES['langsam'],
    _representation: 'symbol', // dauerhafte Anzeige-Einstellung (Bilder/Plättchen), nicht Teil des Zustands

    mount(containerEl) {
      this._state = createState();
      this._els = {};
      if (!containerEl) { this._stage = null; return this; }
      containerEl.innerHTML = '';
      const stage = document.createElement('div');
      stage.className = 'qv-stage';
      containerEl.appendChild(stage);
      this._stage = stage;
      return this;
    },

    async setup(objekte, darstellung) {
      await this.applyStep({ aktion: 'vorbereiten', objekte: objekte, darstellung: darstellung || 'symbol' });
    },

    async applyStep(step) {
      this._state = reduceStep(this._state || createState(), step);
      await this._renderStep(step);
      if (step && step.aktion === 'vorbereiten') await this.resolveSymbols();
    },

    async playAll(steps) {
      for (const step of (steps || [])) { await this.applyStep(step); await wait(this.getStepPause()); }
    },

    // ---- Schritt-Navigation (vor/zurück) ----
    loadSequence(steps) {
      this._sequence = Array.isArray(steps) ? steps : [];
      this._seqIndex = 0;
      return this._rebuildSequence();
    },

    async _rebuildSequence() {
      // Zustand aus den ersten _seqIndex Schritten neu aufbauen (für "Zurück")
      this._state = createState();
      this._els = {};
      if (this._stage) this._stage.innerHTML = '';
      let needsSymbols = false;
      for (let i = 0; i < this._seqIndex; i++) {
        this._state = reduceStep(this._state, this._sequence[i]);
        if (this._sequence[i] && this._sequence[i].aktion === 'vorbereiten') needsSymbols = true;
      }
      await this._render();
      if (needsSymbols) await this.resolveSymbols();
    },

    async stepForward() {
      if (!this._sequence || this._seqIndex >= this._sequence.length) return null;
      const step = this._sequence[this._seqIndex];
      this._seqIndex++;
      this._state = reduceStep(this._state, step);
      await this._renderStep(step);
      if (step && step.aktion === 'vorbereiten') await this.resolveSymbols();
      return step;
    },

    async stepBack() {
      if (!this._sequence || this._seqIndex <= 0) return null;
      this._seqIndex--;
      await this._rebuildSequence();
      return this._seqIndex > 0 ? this._sequence[this._seqIndex - 1] : null;
    },

    seqInfo() {
      return { index: this._seqIndex || 0, total: (this._sequence && this._sequence.length) || 0 };
    },

    setRepresentation(mode) {
      this._representation = (mode === 'plaettchen') ? 'plaettchen' : 'symbol';
      this._render();
    },
    getRepresentation() { return this._representation; },

    getState() { return this._state; },

    setSpeed(level) { this._speedProfile = SPEED_PROFILES[level] || SPEED_PROFILES['langsam']; },
    getStepPause() { return (this._speedProfile || SPEED_PROFILES['langsam']).stepPause; },

    // Rohe [VISUALISIERUNG]-Tags aus einem Text entfernen (auch für den Reuse-Modus)
    stripVisualizationTag,
    // Einzelnen Schritt validieren (Reuse-Modus: ungültige Live-Schritte ablehnen statt still schlucken)
    validateStep,

    reset() {
      this._state = createState();
      this._els = {};
      this._sequence = null;
      this._seqIndex = 0;
      if (this._stage) this._stage.innerHTML = '';
    },

    async resolveSymbols() {
      const api = (typeof window !== 'undefined') ? window.RechengeschichtenAPI : null;
      if (!api || !api.getArasaacImageUrl || !this._state) return;
      let any = false;
      for (const obj of this._state.objects) {
        if (this._symbolCache[obj.name] !== undefined) { if (this._symbolCache[obj.name]) any = true; continue; }
        try {
          const url = await api.getArasaacImageUrl(obj.suchbegriff || obj.name);
          this._symbolCache[obj.name] = url || null;
          if (url) any = true;
        } catch (e) { this._symbolCache[obj.name] = null; }
      }
      if (any && typeof document !== 'undefined') {
        const att = document.getElementById('arasaac-attribution');
        if (att) att.style.display = 'inline';
      }
      this._render();
    },

    // Rendert einen Schritt; beim Teilen dreiphasig:
    // 1. Gesamtmenge unter die spaeteren Gruppen bewegen,
    // 2. leere Gruppen zeigen,
    // 3. von unten in die Gruppen verteilen.
    async _renderStep(step) {
      if (step && step.aktion === 'teilen') {
        const poolMoveMs = await this._render({ pool: true, hideBoxes: true });
        if (poolMoveMs > 0) await wait(poolMoveMs + 60);
        await this._render({ pool: true });
        const dur = (this._speedProfile || SPEED_PROFILES['langsam']).dur;
        await wait(Math.max(260, Math.min(520, Math.round(dur * 0.4))));
        await this._render();
      } else {
        await this._render();
      }
    },

    async _render(opts) {
      if (!this._stage || typeof document === 'undefined') return 0;
      const layout = computeLayout(this._state, opts);
      // Bühnenhöhe an Inhalt anpassen
      let maxY = 200;
      layout.tokens.forEach(t => { if (t.y + 60 > maxY) maxY = t.y + 60; });
      layout.boxes.forEach(b => { if (b.y + b.h + 40 > maxY) maxY = b.y + b.h + 40; });
      this._stage.style.minHeight = maxY + 'px';

      // Boxen neu aufbauen
      Array.from(this._stage.querySelectorAll('.qv-box, .qv-box-label')).forEach(e => e.remove());
      if (!(opts && opts.hideBoxes)) {
        layout.boxes.forEach(b => {
          const box = document.createElement('div'); box.className = 'qv-box';
          box.style.left = b.x + 'px'; box.style.top = b.y + 'px';
          box.style.width = b.w + 'px'; box.style.height = b.h + 'px';
          this._stage.appendChild(box);
          const lab = document.createElement('div'); lab.className = 'qv-box-label';
          lab.textContent = b.label; lab.style.left = b.x + 'px'; lab.style.top = (b.y + b.h + 2) + 'px';
          this._stage.appendChild(lab);
        });
      }

      // Token mit echter Bewegung (left/top) + Geschwindigkeit + Staffelung
      const prof = this._speedProfile || SPEED_PROFILES['langsam'];
      const dur = prof.dur, stagger = prof.stagger;
      const ease = 'cubic-bezier(.2,.8,.25,1)';

      // Vorab zählen, wie viele Token sich diesen Schritt verändern, und den Versatz so deckeln,
      // dass die gesamte Welle höchstens maxWave dauert (sonst dauern 156 Plättchen ewig).
      let animCount = 0;
      for (const t of layout.tokens) {
        const e = this._els[t.id];
        if (!e || e._qx !== t.x || e._qy !== t.y || e._qghost !== t.ghost) animCount++;
      }
      const maxWave = prof.maxWave || 2000;
      const effStagger = animCount > 0 ? Math.min(stagger, maxWave / animCount) : stagger;

      const seen = {};
      let animIndex = 0; // zählt nur Token, die sich diesen Schritt tatsächlich verändern
      const updates = [];
      let hasNew = false;
      // Phase 1: neue Token nur anlegen (Startzustand), alle Ziel-Werte sammeln
      for (const t of layout.tokens) {
        seen[t.id] = true;
        let el = this._els[t.id];
        const isNew = !el;
        const changed = isNew || el._qx !== t.x || el._qy !== t.y || el._qghost !== t.ghost;
        const delay = changed ? (animIndex++ * effStagger) : 0;
        // Beim Wegnehmen langsamer ausblenden, sonst zügiger
        const opacityDur = t.ghost ? Math.round(dur * 1.5) : Math.round(dur * 0.7);
        const trans = 'left ' + dur + 'ms ' + ease + ', top ' + dur + 'ms ' + ease +
          ', transform ' + dur + 'ms ' + ease + ', opacity ' + opacityDur + 'ms ease, background-color ' + opacityDur + 'ms ease';
        if (isNew) {
          el = document.createElement('span'); el.className = 'qv-token';
          el.style.left = t.x + 'px'; el.style.top = t.y + 'px';
          el.style.transition = 'none';
          el.style.transform = 'translateX(160px)'; el.style.opacity = '0';
          this._stage.appendChild(el); this._els[t.id] = el;
          hasNew = true;
        }
        updates.push({ el, t, isNew, delay, trans });
      }
      // EIN erzwungener Reflow für alle neuen Token gemeinsam - vorher stand
      // `void el.offsetWidth` in der Schleife und erzwang bei großen Mengen
      // hunderte synchrone Layouts pro Render (spürbares Ruckeln).
      if (hasNew) { void this._stage.offsetWidth; }
      // Phase 2: Transitions und Ziel-Werte setzen
      for (const u of updates) {
        const el = u.el, t = u.t;
        el.style.transition = u.trans;
        el.style.transitionDelay = u.delay + 'ms';
        if (u.isNew) {
          el.style.transform = 'translate(0,0)'; el.style.opacity = '1';
        } else {
          el.style.left = t.x + 'px'; el.style.top = t.y + 'px';
        }
        this._applyTokenStyle(el, t);
        el._qx = t.x; el._qy = t.y; el._qghost = t.ghost;
      }
      Object.keys(this._els).forEach(id => {
        if (!seen[id]) { this._els[id].remove(); delete this._els[id]; }
      });
      return animCount > 0 ? dur + Math.max(0, animCount - 1) * effStagger : 0;
    },

    _applyTokenStyle(el, t) {
      el.classList.remove('qv-red', 'qv-blue', 'qv-green', 'qv-ghost', 'qv-symbol');
      // Weggenommene Token behalten Farbe/Symbol, verblassen aber sanft (Opacity inline,
      // damit sie die per Inline gesetzte Enter-Opacity überschreibt und weich animiert).
      const base = t.size || DISC;
      const useSymbol = this._representation === 'symbol';
      const url = useSymbol ? (this._symbolCache[t.kind] || null) : null;
      if (url) {
        el.classList.add('qv-symbol');
        el.style.backgroundImage = 'url("' + url + '")';
        el.style.width = el.style.height = (base + 8) + 'px';
      } else {
        el.style.backgroundImage = '';
        el.classList.add('qv-' + t.color);
        el.style.width = el.style.height = base + 'px';
      }
      if (t.ghost) el.classList.add('qv-ghost');
      el.style.opacity = t.ghost ? '0.22' : '1';
    }
  };

  // =====================================================================
  // Export
  // =====================================================================

  const helpers = {
    createState, cloneState, activeTokens, addTokens, removeTokens,
    addPerGroup, removePerGroup,
    applyMultiply, prepareGroups, summarizeTotal, applyDivide, applyBundle,
    validateStep, normalizeStep, parseVisualizationTag, parseVisualizationSteps, stripVisualizationTag,
    reduceStep, chooseStructure, computeLayout
  };

  global.QVHelpers = Object.assign(global.QVHelpers || {}, helpers);
  global.QuantityVisualizer = QuantityVisualizer;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.assign(module.exports || {}, helpers);
  }
})(typeof window !== 'undefined' ? window : globalThis);
