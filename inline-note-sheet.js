/**
 * inline-note-sheet.js — Integrierte Notizfläche unter dem Aufgabentext.
 * Dual-Export wie note-pad.js: reine Hilfsfunktionen sind in Node testbar,
 * die DOM-/Canvas-Komponente (InlineNoteSheet) läuft nur im Browser.
 *
 * Im Unterschied zur Zeichen-Bühne (note-pad.js) ist dieses Blatt dauerhaft
 * unter dem Text sichtbar, scrollt in einem eigenen Container und wächst nach
 * unten („endloses Blatt"). Szenen-Modell wie NotePad, aber nur Striche:
 *   { type:'stroke', color, width, eraser:boolean, points:[{x,y}, ...] }
 * Koordinaten in CSS-Pixeln; DPR-Skalierung passiert zentral beim Rendern.
 */
(function (global) {
    'use strict';

    // ---------- Reine Hilfsfunktionen (Node-testbar) ----------

    /**
     * Entscheidet, was ein neuer Pointer auf dem Blatt tut: 'draw' | 'pan' | 'ignore'.
     * Modell: Stift/Maus zeichnen immer. Finger zeichnet nur, solange auf dem Gerät
     * noch nie ein Stift gesehen wurde (penDetected) — danach scrollt der Finger
     * (GoodNotes-Modell). Ein zweiter Finger während einer Finger-Zeichnung oder
     * während eines laufenden Pans scrollt ebenfalls. Während Stiftkontakt werden
     * Touches komplett ignoriert (Handballen).
     * state: { penActive, penDetected, drawPointerType, panPointerCount }
     */
    function resolveTouchIntent(state, evt) {
        state = state || {};
        if (evt.pointerType === 'pen' || evt.pointerType === 'mouse') { return 'draw'; }
        // ab hier: touch
        if (state.penActive) { return 'ignore'; }
        if (state.drawPointerType === 'touch') { return 'pan'; }   // zweiter Finger -> scrollen
        if (state.panPointerCount > 0) { return 'pan'; }
        if (state.penDetected) { return 'pan'; }
        return 'draw';
    }

    /**
     * Bounding-Box der sichtbaren Tinte (ohne reine Radierer-Striche).
     * Gibt {left, top, right, bottom} oder null zurück.
     */
    function inkBounds(scene) {
        if (!scene || !Array.isArray(scene.items)) { return null; }
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        var found = false;
        scene.items.forEach(function (it) {
            if (!it || it.type !== 'stroke' || it.eraser || !Array.isArray(it.points)) { return; }
            var hw = (it.width || 1) / 2;
            it.points.forEach(function (p) {
                found = true;
                if (p.x - hw < minX) { minX = p.x - hw; }
                if (p.y - hw < minY) { minY = p.y - hw; }
                if (p.x + hw > maxX) { maxX = p.x + hw; }
                if (p.y + hw > maxY) { maxY = p.y + hw; }
            });
        });
        if (!found) { return null; }
        return { left: minX, top: minY, right: maxX, bottom: maxY };
    }

    /**
     * Export-Ausschnitt aus Tinten-Bounds: Rand addieren, an Canvas klemmen,
     * Mindestgröße sicherstellen. Gibt {left, top, w, h} oder null zurück.
     */
    function exportRegion(bounds, cssW, cssH, pad) {
        if (!bounds) { return null; }
        var MIN = 40;
        var left = Math.max(0, Math.floor(bounds.left - pad));
        var top = Math.max(0, Math.floor(bounds.top - pad));
        var right = Math.min(cssW, Math.ceil(bounds.right + pad));
        var bottom = Math.min(cssH, Math.ceil(bounds.bottom + pad));
        // Mindestgröße: innerhalb der Canvas-Grenzen aufweiten
        if (right - left < MIN) {
            right = Math.min(cssW, left + MIN);
            left = Math.max(0, right - MIN);
        }
        if (bottom - top < MIN) {
            bottom = Math.min(cssH, top + MIN);
            top = Math.max(0, bottom - MIN);
        }
        var w = right - left, h = bottom - top;
        if (w <= 0 || h <= 0) { return null; }
        return { left: left, top: top, w: w, h: h };
    }

    /** Nächste Blatt-Höhe beim Wachsen (geklemmt an die Obergrenze). */
    function growHeight(current, step, max) {
        return Math.min(max, current + step);
    }

    /** Wachsen, wenn die Tinte nahe an die Unterkante kommt. */
    function shouldAutoGrow(maxStrokeY, cssH, threshold) {
        return maxStrokeY >= cssH - threshold;
    }

    // ---------- Komponente (nur Browser) ----------

    var PEN_WIDTH = 4;
    var ERASER_WIDTH = 24;
    var GROW_STEP = 400;
    var MAX_HEIGHT = 2800;
    var AUTO_GROW_THRESHOLD = 120;
    var EXPORT_PAD = 14;
    var PEN_SEEN_KEY = 'rechengeschichten_pen_seen';

    var InlineNoteSheet = {
        canvas: null,
        ctx: null,
        scrollEl: null,       // Scroll-Container um das Blatt
        dpr: 1,
        cssW: 0,
        sheetH: 0,            // logische Blatt-Höhe in CSS-Pixeln (wächst)
        scene: { items: [] },
        tool: 'pen',          // 'pen' | 'eraser'
        color: '#1f2937',
        onChange: null,
        _p: null,             // Pointer-/Interaktions-State

        init: function (canvasEl, opts) {
            this.canvas = canvasEl;
            this.ctx = canvasEl.getContext('2d');
            this.scrollEl = (opts && opts.scrollEl) || canvasEl.parentElement;
            this.onChange = (opts && opts.onChange) || null;
            this.scene = { items: [] };
            this.tool = 'pen';
            this.color = '#1f2937';
            // Stift-Erkennung gilt nur pro Sitzung (sessionStorage): auf geteilten
            // Klassen-iPads würde ein dauerhaft gemerkter Stift sonst allen späteren
            // Kindern ohne Stift das Finger-Zeichnen für immer sperren.
            var penSeen = false;
            try { penSeen = sessionStorage.getItem(PEN_SEEN_KEY) === 'true'; } catch (e) { /* egal */ }
            // Alten dauerhaften Merker aus früheren Versionen entfernen
            try { localStorage.removeItem(PEN_SEEN_KEY); } catch (e) { /* egal */ }
            this._p = {
                penActive: false, penDetected: penSeen,
                drawPointerId: null, drawPointerType: null, draft: null,
                panPointers: {}, panPointerCount: 0
            };
            var self = this;
            canvasEl.style.touchAction = 'none';
            canvasEl.addEventListener('pointerdown', function (e) { self._pointerDown(e); });
            canvasEl.addEventListener('pointermove', function (e) { self._pointerMove(e); });
            canvasEl.addEventListener('pointerup', function (e) { self._pointerUp(e); });
            canvasEl.addEventListener('pointercancel', function (e) { self._pointerUp(e); });
            this.resize();
        },

        _emitChange: function () { if (typeof this.onChange === 'function') { this.onChange(); } },

        // Breite an den Container anpassen; Höhe ist die (wachsende) Blatt-Höhe.
        // Die Blatt-Höhe wächst nur (nie schrumpfen — sonst gingen Striche verloren)
        // und deckt mindestens den sichtbaren Panel-Ausschnitt ab.
        resize: function () {
            if (!this.canvas || !this.scrollEl) { return; }
            var w = this.scrollEl.clientWidth;
            if (w <= 0) { return; }
            this.sheetH = Math.min(MAX_HEIGHT,
                Math.max(this.sheetH || 0, this.scrollEl.clientHeight, 400));
            this.cssW = w;
            this.dpr = Math.min(global.devicePixelRatio || 1, 2);
            this.canvas.style.height = this.sheetH + 'px';
            this.canvas.width = Math.round(w * this.dpr);
            this.canvas.height = Math.round(this.sheetH * this.dpr);
            this.render();
        },

        grow: function () {
            var next = growHeight(this.sheetH, GROW_STEP, MAX_HEIGHT);
            if (next === this.sheetH) { return false; }
            this.sheetH = next;
            this.resize();
            return true;
        },

        canGrow: function () { return this.sheetH < MAX_HEIGHT; },

        _pointerPos: function (e) {
            var rect = this.canvas.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        },

        render: function () {
            if (!this.ctx) { return; }
            var ctx = this.ctx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.scale(this.dpr, this.dpr);
            this._drawStrokes(ctx, this._p && this._p.draft);
        },

        // Zeichnet alle Striche der Szene (plus optionalem Entwurf) auf einen 2D-Kontext.
        _drawStrokes: function (ctx, draft) {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            var all = this.scene.items.slice();
            if (draft) { all.push(draft); }
            all.forEach(function (it) {
                if (!it || it.type !== 'stroke' || !it.points || it.points.length === 0) { return; }
                ctx.globalCompositeOperation = it.eraser ? 'destination-out' : 'source-over';
                ctx.strokeStyle = it.color || '#000';
                ctx.lineWidth = it.width || PEN_WIDTH;
                ctx.beginPath();
                ctx.moveTo(it.points[0].x, it.points[0].y);
                for (var i = 1; i < it.points.length; i++) { ctx.lineTo(it.points[i].x, it.points[i].y); }
                if (it.points.length === 1) { ctx.lineTo(it.points[0].x + 0.1, it.points[0].y + 0.1); }
                ctx.stroke();
            });
            ctx.globalCompositeOperation = 'source-over';
        },

        _markPenDetected: function () {
            if (this._p.penDetected) { return; }
            this._p.penDetected = true;
            try { sessionStorage.setItem(PEN_SEEN_KEY, 'true'); } catch (e) { /* egal */ }
        },

        _pointerDown: function (e) {
            var intent = resolveTouchIntent(this._p, e);
            if (intent === 'ignore') { return; }
            if (e.pointerType === 'pen') { this._p.penActive = true; this._markPenDetected(); }

            if (intent === 'pan') {
                // Laufende Finger-Zeichnung verwerfen — zwei Finger heißt scrollen.
                if (this._p.drawPointerType === 'touch') { this._cancelDraft(); }
                this._p.panPointers[e.pointerId] = e.clientY;
                this._p.panPointerCount++;
                e.preventDefault();
                return;
            }

            // intent === 'draw' — nur ein zeichnender Pointer gleichzeitig
            if (this._p.drawPointerId != null) { return; }
            e.preventDefault();
            var pos = this._pointerPos(e);
            this._p.drawPointerId = e.pointerId;
            this._p.drawPointerType = e.pointerType;
            this._p.draft = {
                type: 'stroke',
                color: this.color,
                width: this.tool === 'eraser' ? ERASER_WIDTH : PEN_WIDTH,
                eraser: this.tool === 'eraser',
                points: [pos]
            };
            this.render();
        },

        _pointerMove: function (e) {
            if (this._p.panPointers[e.pointerId] != null) {
                e.preventDefault();
                var dy = e.clientY - this._p.panPointers[e.pointerId];
                this._p.panPointers[e.pointerId] = e.clientY;
                // Nur der „erste" Pan-Finger bewegt (sonst doppelte Geschwindigkeit)
                if (String(e.pointerId) === Object.keys(this._p.panPointers)[0] && this.scrollEl) {
                    this.scrollEl.scrollTop -= dy;
                }
                return;
            }
            if (this._p.drawPointerId !== e.pointerId || !this._p.draft) { return; }
            e.preventDefault();
            this._p.draft.points.push(this._pointerPos(e));
            this.render();
        },

        _pointerUp: function (e) {
            if (this._p.panPointers[e.pointerId] != null) {
                delete this._p.panPointers[e.pointerId];
                this._p.panPointerCount = Math.max(0, this._p.panPointerCount - 1);
                return;
            }
            if (this._p.drawPointerId !== e.pointerId) {
                // penActive auch dann lösen, wenn der Stift ohne Zeichnung endet
                if (e.pointerType === 'pen') { this._p.penActive = false; }
                return;
            }
            e.preventDefault();
            var committed = false;
            if (this._p.draft && this._p.draft.points.length > 0 && e.type !== 'pointercancel') {
                this.scene.items.push(this._p.draft);
                committed = true;
            }
            var draft = this._p.draft;
            this._p.draft = null;
            this._p.drawPointerId = null;
            this._p.drawPointerType = null;
            // penActive immer zurücksetzen, wenn der aktive Pointer endet (auch bei
            // pointercancel, wo manche WKWebView-Varianten kein pointerType:'pen' senden).
            if (e.pointerType === 'pen' || this._p.penActive) { this._p.penActive = false; }
            if (committed) {
                // Erst wachsen lassen (falls der Strich nahe der Unterkante endet),
                // DANN onChange melden — so sieht der Listener schon die neue Blatt-Höhe.
                var maxY = 0;
                draft.points.forEach(function (p) { if (p.y > maxY) { maxY = p.y; } });
                if (shouldAutoGrow(maxY, this.sheetH, AUTO_GROW_THRESHOLD)) { this.grow(); }
                this._emitChange();
            }
            this.render();
        },

        _cancelDraft: function () {
            this._p.draft = null;
            this._p.drawPointerId = null;
            this._p.drawPointerType = null;
            this.render();
        },

        setTool: function (tool) { this.tool = (tool === 'eraser') ? 'eraser' : 'pen'; },
        setColor: function (hex) { if (typeof hex === 'string' && hex) { this.color = hex; this.tool = 'pen'; } },
        undo: function () {
            if (global.NotePadHelpers) { global.NotePadHelpers.popLast(this.scene); }
            else if (this.scene.items.length) { this.scene.items.pop(); }
            this._emitChange();
            this.render();
        },
        clear: function () {
            this.scene = { items: [] };
            this._emitChange();
            this.render();
        },
        hasContent: function () { return inkBounds(this.scene) !== null; },

        /**
         * Exportiert nur den Tinten-Ausschnitt (plus Rand) auf weißem Grund als
         * PNG-DataURL — kein Ganzflächen-getImageData, bleibt auch bei hohen
         * Blättern schnell. null bei leerer Szene.
         */
        exportPng: function () {
            var region = exportRegion(inkBounds(this.scene), this.cssW, this.sheetH, EXPORT_PAD);
            if (!region) { return Promise.resolve(null); }
            var self = this;
            return Promise.resolve().then(function () {
                var scale = Math.min(self.dpr || 1, 2);
                // a) Striche auf transparentes Canvas (Radierer wirkt korrekt)
                var tmp = document.createElement('canvas');
                tmp.width = Math.max(1, Math.round(region.w * scale));
                tmp.height = Math.max(1, Math.round(region.h * scale));
                var tctx = tmp.getContext('2d');
                tctx.scale(scale, scale);
                tctx.translate(-region.left, -region.top);
                self._drawStrokes(tctx, null);
                // b) auf weißen Hintergrund abflachen
                var flat = document.createElement('canvas');
                flat.width = tmp.width;
                flat.height = tmp.height;
                var fctx = flat.getContext('2d');
                fctx.fillStyle = '#ffffff';
                fctx.fillRect(0, 0, flat.width, flat.height);
                fctx.drawImage(tmp, 0, 0);
                return flat.toDataURL('image/png');
            }).catch(function () {
                return null;
            });
        }
    };

    // ---------- Export ----------
    global.InlineNoteSheetHelpers = {
        resolveTouchIntent: resolveTouchIntent,
        inkBounds: inkBounds,
        exportRegion: exportRegion,
        growHeight: growHeight,
        shouldAutoGrow: shouldAutoGrow
    };
    global.InlineNoteSheet = InlineNoteSheet;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            resolveTouchIntent: resolveTouchIntent,
            inkBounds: inkBounds,
            exportRegion: exportRegion,
            growHeight: growHeight,
            shouldAutoGrow: shouldAutoGrow
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
