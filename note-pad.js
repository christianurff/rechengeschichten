/**
 * note-pad.js — Skizzen-/Notizfeld für den Strategie-Chat.
 * Dual-Export wie chat-photo-utils.js: reine Hilfsfunktionen sind in Node testbar,
 * die DOM-/Canvas-Komponente (NotePad) läuft nur im Browser.
 *
 * Szenen-Modell: scene = { items: [...] }
 *   Strich: { type:'stroke', color, width, eraser:boolean, points:[{x,y}, ...] }
 *   Objekt: { type:'image', img:HTMLImageElement, url, x, y, w, h }
 * Koordinaten in CSS-Pixeln; DPR-Skalierung passiert zentral beim Rendern.
 */
(function (global) {
    'use strict';

    // ---------- Reine Hilfsfunktionen (Node-testbar) ----------

    function hasContent(scene) {
        if (!scene || !Array.isArray(scene.items)) { return false; }
        return scene.items.some(function (it) {
            if (!it) { return false; }
            if (it.type === 'image') { return true; }
            // Reine Radierer-Striche zählen NICHT als Inhalt (sonst „nur radiert" -> leeres weißes Bild)
            if (it.type === 'stroke') { return !it.eraser && Array.isArray(it.points) && it.points.length > 0; }
            return false;
        });
    }

    // Entfernt das letzte Item der Szene IN-PLACE (mutiert scene.items) und gibt scene zurück.
    // Wird für „Rückgängig" genutzt; nur mit einer Szene aufrufen, die einem gehört.
    function popLast(scene) {
        if (scene && Array.isArray(scene.items) && scene.items.length > 0) {
            scene.items.pop();
        }
        return scene;
    }

    function sceneBounds(scene) {
        if (!scene || !Array.isArray(scene.items)) { return null; }
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        var found = false;
        scene.items.forEach(function (it) {
            if (!it) { return; }
            if (it.type === 'stroke' && Array.isArray(it.points)) {
                var hw = (it.width || 1) / 2;
                it.points.forEach(function (p) {
                    found = true;
                    if (p.x - hw < minX) { minX = p.x - hw; }
                    if (p.y - hw < minY) { minY = p.y - hw; }
                    if (p.x + hw > maxX) { maxX = p.x + hw; }
                    if (p.y + hw > maxY) { maxY = p.y + hw; }
                });
            } else if (it.type === 'image' && it.w > 0 && it.h > 0) {
                found = true;
                if (it.x < minX) { minX = it.x; }
                if (it.y < minY) { minY = it.y; }
                if (it.x + it.w > maxX) { maxX = it.x + it.w; }
                if (it.y + it.h > maxY) { maxY = it.y + it.h; }
            }
        });
        if (!found) { return null; }
        return { left: minX, top: minY, right: maxX, bottom: maxY };
    }

    function objectAtPoint(scene, x, y) {
        if (!scene || !Array.isArray(scene.items)) { return null; }
        for (var i = scene.items.length - 1; i >= 0; i--) {
            var it = scene.items[i];
            if (it && it.type === 'image' &&
                x >= it.x && x <= it.x + it.w &&
                y >= it.y && y <= it.y + it.h) {
                return it;
            }
        }
        return null;
    }

    /**
     * Entscheidet, ob ein Pointer-Event verarbeitet wird (Handballenerkennung).
     * state: { penActive: boolean, activePointerId: number|null }
     */
    function shouldHandlePointer(state, evt) {
        state = state || {};
        if (evt.pointerType === 'pen') { return true; }
        if (state.penActive && evt.pointerType === 'touch') { return false; }
        if (state.activePointerId != null && state.activePointerId !== evt.pointerId) { return false; }
        return true;
    }

    /**
     * Normalisiert ARASAAC-Roh-Vorschläge: {keyword,url}[] -> dedupliziert, gefiltert, limitiert.
     */
    function buildObjectSuggestions(raw, limit) {
        var max = typeof limit === 'number' ? limit : 8;
        var out = [];
        var seen = {};
        if (!Array.isArray(raw)) { return out; }
        for (var i = 0; i < raw.length; i++) {
            var e = raw[i];
            if (!e || typeof e.url !== 'string' || !e.url) { continue; }
            var kw = (typeof e.keyword === 'string' ? e.keyword : '').trim();
            if (!kw) { continue; }
            var key = kw.toLowerCase();
            if (seen[key]) { continue; }
            seen[key] = true;
            out.push({ keyword: kw, url: e.url });
            if (out.length >= max) { break; }
        }
        return out;
    }

    // ---------- Komponente (nur Browser) ----------

    var SIZES = { thin: 3, medium: 6, thick: 10 };
    var ERASER_WIDTH = 28;
    var DEFAULT_OBJECT_SIZE = 64;
    var MIN_OBJECT_SIZE = 28;

    var NotePad = {
        canvas: null,
        ctx: null,
        dpr: 1,
        cssW: 0,
        cssH: 0,
        scene: { items: [] },
        tool: 'pen',          // 'pen' | 'eraser'
        color: '#000000',
        size: 'medium',       // 'thin' | 'medium' | 'thick'
        selected: null,       // ausgewähltes Objekt-Item oder null
        onChange: null,
        _p: null,             // Pointer-/Interaktions-State

        init: function (canvasEl, opts) {
            this.canvas = canvasEl;
            this.ctx = canvasEl.getContext('2d');
            this.onChange = (opts && opts.onChange) || null;
            this.scene = { items: [] };
            this.selected = null;
            this.tool = 'pen';
            this.color = '#000000';
            this.size = 'medium';
            this._p = { penActive: false, activePointerId: null, mode: null, draft: null,
                        dragDX: 0, dragDY: 0 };
            var self = this;
            canvasEl.style.touchAction = 'none';
            canvasEl.addEventListener('pointerdown', function (e) { self._pointerDown(e); });
            canvasEl.addEventListener('pointermove', function (e) { self._pointerMove(e); });
            canvasEl.addEventListener('pointerup', function (e) { self._pointerUp(e); });
            canvasEl.addEventListener('pointercancel', function (e) { self._pointerUp(e); });
            this.resize();
        },

        _emitChange: function () { if (typeof this.onChange === 'function') { this.onChange(); } },

        // Canvas-Bitmap an CSS-Größe + DPR anpassen, dann neu rendern
        resize: function () {
            if (!this.canvas) { return; }
            var rect = this.canvas.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) { return; }
            this.cssW = rect.width;
            this.cssH = rect.height;
            // Wie beim InlineNoteSheet auf 2 deckeln: 3x-Backing-Canvas + exportPng
            // (zwei Offscreen-Kopien + getImageData) erzeugt sonst Speicherspitzen.
            this.dpr = Math.min(global.devicePixelRatio || 1, 2);
            this.canvas.width = Math.round(rect.width * this.dpr);
            this.canvas.height = Math.round(rect.height * this.dpr);
            this.render();
        },

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
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            // 1) Striche (inkl. laufendem Entwurf)
            var all = this.scene.items.slice();
            if (this._p && this._p.draft) { all.push(this._p.draft); }
            all.forEach(function (it) {
                if (!it || it.type !== 'stroke' || !it.points || it.points.length === 0) { return; }
                ctx.globalCompositeOperation = it.eraser ? 'destination-out' : 'source-over';
                ctx.strokeStyle = it.color || '#000';
                ctx.lineWidth = it.width || 3;
                ctx.beginPath();
                ctx.moveTo(it.points[0].x, it.points[0].y);
                for (var i = 1; i < it.points.length; i++) { ctx.lineTo(it.points[i].x, it.points[i].y); }
                if (it.points.length === 1) { ctx.lineTo(it.points[0].x + 0.1, it.points[0].y + 0.1); }
                ctx.stroke();
            });
            ctx.globalCompositeOperation = 'source-over';
            // 2) Objekte
            this.scene.items.forEach(function (it) {
                if (it && it.type === 'image' && it.img) {
                    try { ctx.drawImage(it.img, it.x, it.y, it.w, it.h); } catch (err) { /* Bild evtl. noch nicht geladen */ }
                }
            });
            // 3) Auswahlrahmen für aktives Objekt
            if (this.selected) {
                var s = this.selected;
                ctx.save();
                ctx.strokeStyle = '#7c3aed';
                ctx.setLineDash([6, 4]);
                ctx.lineWidth = 2;
                ctx.strokeRect(s.x, s.y, s.w, s.h);
                ctx.setLineDash([]);
                // Lösch-Griff (oben rechts)
                this._drawHandle(ctx, s.x + s.w, s.y, '#dc2626', '×');
                // Größen-Griff (unten rechts)
                this._drawHandle(ctx, s.x + s.w, s.y + s.h, '#7c3aed', '⤢');
                ctx.restore();
            }
        },

        _drawHandle: function (ctx, cx, cy, bg, glyph) {
            var r = 11;
            ctx.beginPath();
            ctx.fillStyle = bg;
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(glyph, cx, cy + 1);
        },

        _pointerDown: function (e) {
            if (!shouldHandlePointer(this._p, e)) { return; }
            if (e.pointerType === 'pen') { this._p.penActive = true; }
            this._p.activePointerId = e.pointerId;
            e.preventDefault();
            var pos = this._pointerPos(e);

            // 1) Griffe des ausgewählten Objekts?
            if (this.selected) {
                var s = this.selected;
                if (this._hit(pos, s.x + s.w, s.y)) {            // Lösch-Griff
                    this._removeItem(s); this.selected = null; this._p.mode = null;
                    this._p.activePointerId = null; this._emitChange(); this.render(); return;
                }
                if (this._hit(pos, s.x + s.w, s.y + s.h)) {       // Größen-Griff
                    this._p.mode = 'resize'; return;
                }
            }
            // 2) Objekt treffen -> auswählen + verschieben
            var obj = objectAtPoint(this.scene, pos.x, pos.y);
            if (obj) {
                this.selected = obj;
                this._p.mode = 'drag';
                this._p.dragDX = pos.x - obj.x;
                this._p.dragDY = pos.y - obj.y;
                this.render();
                return;
            }
            // 3) sonst zeichnen
            this.selected = null;
            this._p.mode = 'draw';
            this._p.draft = {
                type: 'stroke',
                color: this.color,
                width: this.tool === 'eraser' ? ERASER_WIDTH : SIZES[this.size],
                eraser: this.tool === 'eraser',
                points: [pos]
            };
            this.render();
        },
        _pointerMove: function (e) {
            if (this._p.activePointerId !== e.pointerId) { return; }
            e.preventDefault();
            var pos = this._pointerPos(e);
            if (this._p.mode === 'draw' && this._p.draft) {
                this._p.draft.points.push(pos);
                this.render();
            } else if (this._p.mode === 'drag' && this.selected) {
                this.selected.x = pos.x - this._p.dragDX;
                this.selected.y = pos.y - this._p.dragDY;
                this.render();
            } else if (this._p.mode === 'resize' && this.selected) {
                this.selected.w = Math.max(MIN_OBJECT_SIZE, pos.x - this.selected.x);
                this.selected.h = Math.max(MIN_OBJECT_SIZE, pos.y - this.selected.y);
                this.render();
            }
        },
        _pointerUp: function (e) {
            if (this._p.activePointerId !== e.pointerId) { return; }
            e.preventDefault();
            if (this._p.mode === 'draw' && this._p.draft && this._p.draft.points.length > 0) {
                this.scene.items.push(this._p.draft);
                this._emitChange();
            } else if (this._p.mode === 'drag' || this._p.mode === 'resize') {
                this._emitChange();
            }
            this._p.draft = null;
            this._p.mode = null;
            this._p.activePointerId = null;
            // penActive immer zurücksetzen, wenn der aktive Pointer endet (auch bei pointercancel,
            // wo manche WKWebView-/Browser-Varianten kein pointerType:'pen' mitsenden) -> sonst bliebe
            // die Handballenerkennung hängen und würde alle weiteren Berührungen blockieren.
            if (e.pointerType === 'pen' || this._p.penActive) { this._p.penActive = false; }
            this.render();
        },

        setTool: function (tool) { this.tool = (tool === 'eraser') ? 'eraser' : 'pen'; },
        setColor: function (hex) { if (typeof hex === 'string' && hex) { this.color = hex; this.tool = 'pen'; } },
        setSize: function (key) { if (SIZES[key]) { this.size = key; } },
        undo: function () { popLast(this.scene); this.selected = null; this._emitChange(); this.render(); },
        clear: function () { this.scene = { items: [] }; this.selected = null; this._emitChange(); this.render(); },
        hasContent: function () { return hasContent(this.scene); },

        // Lädt ein Bild CORS-sicher und platziert es mittig. urlOrImg: string | HTMLImageElement
        addObject: function (urlOrImg) {
            var self = this;
            function place(img, url) {
                var w = DEFAULT_OBJECT_SIZE, h = DEFAULT_OBJECT_SIZE;
                if (img.naturalWidth && img.naturalHeight) {
                    var ratio = img.naturalHeight / img.naturalWidth;
                    h = Math.round(DEFAULT_OBJECT_SIZE * ratio);
                }
                var n = self.scene.items.filter(function (it) { return it && it.type === 'image'; }).length;
                var offset = (n % 5) * 14;
                var item = {
                    type: 'image', img: img, url: url || '',
                    x: Math.max(4, (self.cssW - w) / 2 + offset),
                    y: Math.max(4, (self.cssH - h) / 2 - 20 + offset),
                    w: w, h: h
                };
                self.scene.items.push(item);
                self.selected = item;
                self._emitChange();
                self.render();
            }
            if (urlOrImg && urlOrImg.nodeType === 1) { place(urlOrImg, urlOrImg.src); return; }
            var url = String(urlOrImg || '');
            if (!url) { return; }
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () { place(img, url); };
            img.onerror = function () {
                // Fallback: per fetch->Blob (vermeidet Taint, falls crossOrigin scheitert)
                fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
                    var blobUrl = URL.createObjectURL(blob);
                    var img2 = new Image();
                    img2.onload = function () { place(img2, url); URL.revokeObjectURL(blobUrl); };
                    img2.onerror = function () { URL.revokeObjectURL(blobUrl); };
                    img2.src = blobUrl;
                }).catch(function () { /* Vorschlag wird übersprungen */ });
            };
            img.src = url;
        },

        _hit: function (pos, cx, cy) {
            var dx = pos.x - cx, dy = pos.y - cy;
            return (dx * dx + dy * dy) <= (16 * 16); // großzügiger Treffer-Radius
        },
        _removeItem: function (item) {
            var i = this.scene.items.indexOf(item);
            if (i !== -1) { this.scene.items.splice(i, 1); }
        },

        // Rendert die Szene (ohne Auswahlrahmen) auf ein Offscreen-Canvas, flacht auf Weiß ab,
        // schneidet weiße Ränder weg. Gibt DataURL (PNG) zurück oder null bei leerer Szene.
        exportPng: function () {
            if (!hasContent(this.scene)) { return Promise.resolve(null); }
            var self = this;
            return Promise.resolve().then(function () {
                var w = Math.max(1, Math.round(self.cssW * self.dpr));
                var h = Math.max(1, Math.round(self.cssH * self.dpr));
                // a) Szene auf transparentes Canvas
                var tmp = document.createElement('canvas');
                tmp.width = w; tmp.height = h;
                var tctx = tmp.getContext('2d');
                tctx.scale(self.dpr, self.dpr);
                tctx.lineCap = 'round'; tctx.lineJoin = 'round';
                self.scene.items.forEach(function (it) {
                    if (!it || it.type !== 'stroke' || !it.points || !it.points.length) { return; }
                    tctx.globalCompositeOperation = it.eraser ? 'destination-out' : 'source-over';
                    tctx.strokeStyle = it.color || '#000';
                    tctx.lineWidth = it.width || 3;
                    tctx.beginPath();
                    tctx.moveTo(it.points[0].x, it.points[0].y);
                    for (var i = 1; i < it.points.length; i++) { tctx.lineTo(it.points[i].x, it.points[i].y); }
                    if (it.points.length === 1) { tctx.lineTo(it.points[0].x + 0.1, it.points[0].y + 0.1); }
                    tctx.stroke();
                });
                tctx.globalCompositeOperation = 'source-over';
                self.scene.items.forEach(function (it) {
                    if (it && it.type === 'image' && it.img) {
                        try { tctx.drawImage(it.img, it.x, it.y, it.w, it.h); } catch (err) {}
                    }
                });
                // b) auf weißen Hintergrund abflachen
                var flat = document.createElement('canvas');
                flat.width = w; flat.height = h;
                var fctx = flat.getContext('2d');
                fctx.fillStyle = '#ffffff';
                fctx.fillRect(0, 0, w, h);
                fctx.drawImage(tmp, 0, 0);
                // c) Auto-Crop (weiße Ränder weg)
                var cropped = self._autoCrop(flat);
                return cropped.toDataURL('image/png');
            }).catch(function () {
                // Bei einem „tainted" Canvas (CORS) werfen sowohl getImageData (_autoCrop)
                // als auch toDataURL -> dann lieber nichts anhängen statt den Promise zu rejecten.
                return null;
            });
        },
        _autoCrop: function (src) {
            var ctx = src.getContext('2d');
            var W = src.width, H = src.height;
            var data = ctx.getImageData(0, 0, W, H).data;
            var th = 250;
            function white(x, y) { var i = (y * W + x) * 4; return data[i] > th && data[i + 1] > th && data[i + 2] > th; }
            var top = 0, bottom = H - 1, left = 0, right = W - 1, x, y;
            outerTop: for (y = 0; y < H; y++) { for (x = 0; x < W; x++) { if (!white(x, y)) { top = y; break outerTop; } } }
            outerBottom: for (y = H - 1; y >= 0; y--) { for (x = 0; x < W; x++) { if (!white(x, y)) { bottom = y; break outerBottom; } } }
            outerLeft: for (x = 0; x < W; x++) { for (y = 0; y < H; y++) { if (!white(x, y)) { left = x; break outerLeft; } } }
            outerRight: for (x = W - 1; x >= 0; x--) { for (y = 0; y < H; y++) { if (!white(x, y)) { right = x; break outerRight; } } }
            var pad = 12;
            top = Math.max(0, top - pad); bottom = Math.min(H - 1, bottom + pad);
            left = Math.max(0, left - pad); right = Math.min(W - 1, right + pad);
            var cw = right - left + 1, ch = bottom - top + 1;
            if (cw < 30 || ch < 30) { return src; }
            var out = document.createElement('canvas');
            out.width = cw; out.height = ch;
            out.getContext('2d').drawImage(src, left, top, cw, ch, 0, 0, cw, ch);
            return out;
        }
    };

    // ---------- Export ----------
    global.NotePadHelpers = global.NotePadHelpers || {};
    global.NotePadHelpers.hasContent = hasContent;
    global.NotePadHelpers.popLast = popLast;
    global.NotePadHelpers.sceneBounds = sceneBounds;
    global.NotePadHelpers.objectAtPoint = objectAtPoint;
    global.NotePadHelpers.shouldHandlePointer = shouldHandlePointer;
    global.NotePadHelpers.buildObjectSuggestions = buildObjectSuggestions;
    global.NotePad = NotePad;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            hasContent: hasContent,
            popLast: popLast,
            sceneBounds: sceneBounds,
            objectAtPoint: objectAtPoint,
            shouldHandlePointer: shouldHandlePointer,
            buildObjectSuggestions: buildObjectSuggestions
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
