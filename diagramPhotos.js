(function () {
    'use strict';
    /* ============================================================================
       FOTO ASLI KOMPONEN PADA DIAGRAM
       ----------------------------------------------------------------------------
       Setiap komponen memakai foto dari folder images/ bila filenya ada, dan
       otomatis kembali ke gambar skema (SVG) bila belum ada. Animasi, status
       (titik hijau/merah), label, klik komponen, fault, dan aliran arus tetap
       berjalan seperti biasa.

       Nama file (png / webp / jpg / jpeg):
         aki, fuse, kunci-kontak, relay, selenoid, motor-starter, pinion, flywheel, mesin
       ============================================================================ */
    var SVGNS = 'http://www.w3.org/2000/svg';
    var XLINK = 'http://www.w3.org/1999/xlink';
    var DIR = 'images/';
    var EXTS = ['webp', 'png', 'jpg', 'jpeg'];   /* webp lebih kecil (~10x); png tetap didukung sebagai cadangan */

    /* x,y,w,h = kotak foto di dalam viewBox diagram (900 x 520). `into` = grup yang
       ikut berputar (flywheel) sehingga foto ikut berputar saat cranking. */
    var SLOTS = [
        { comp: 'battery',  id: 'comp-battery',  file: 'aki',           label: 'Aki (battery)',     x: 68,  y: 86,  w: 104, h: 80 },
        { comp: 'fuse',     id: 'comp-fuse',     file: 'fuse',          label: 'Fuse',              x: 168, y: 160, w: 64,  h: 46 },
        { comp: 'ignition', id: 'comp-ignition', file: 'kunci-kontak',  label: 'Kunci kontak',      x: 294, y: 238, w: 72,  h: 58 },
        { comp: 'relay',    id: 'comp-relay',    file: 'relay',         label: 'Relay starter',     x: 424, y: 312, w: 72,  h: 64 },
        { comp: 'solenoid', id: 'comp-solenoid', file: 'selenoid',      label: 'Selenoid starter',  x: 578, y: 238, w: 84,  h: 94 },
        { comp: 'starter',  id: 'comp-starter',  file: 'motor-starter', label: 'Motor starter',     x: 658, y: 322, w: 112, h: 84 },
        { comp: 'pinion',   id: 'comp-pinion',   file: 'pinion',        label: 'Pinion gear',       x: 738, y: 348, w: 44,  h: 44, into: 'pinionGroup' },
        { comp: 'flywheel', id: 'comp-flywheel', file: 'flywheel',      label: 'Flywheel',          x: 770, y: 330, w: 80,  h: 80, into: 'flywheelGroup' },
        { comp: 'engine',   id: 'comp-engine',   file: 'mesin',         label: 'Mesin (engine)',    x: 762, y: 424, w: 96,  h: 62 }
    ];

    var status = {};      /* comp -> 'photo' | 'schema' */
    var mode = 'photo';   /* tampilan yang dipilih pengguna */

    function doc() { return typeof document !== 'undefined' ? document : null; }
    function byId(id) { var d = doc(); return d ? d.getElementById(id) : null; }

    /* Cari file foto pertama yang ada (webp -> png -> jpg -> jpeg). */
    function probe(file, done) {
        var i = 0;
        function next() {
            if (i >= EXTS.length) { done(null); return; }
            var url = DIR + file + '.' + EXTS[i++];
            var img = new Image();
            img.onload = function () { done(url); };
            img.onerror = next;
            img.src = url;
        }
        next();
    }

    function addClass(el, c) { if (el && el.classList) el.classList.add(c); }

    function apply(slot, url) {
        var g = byId(slot.id);
        if (!g) return false;
        var host = slot.into ? byId(slot.into) : g;
        if (!host) return false;
        var existing = host.querySelector ? host.querySelector('.dg-photo') : null;
        if (existing) {
            existing.setAttribute('href', url);
            existing.setAttributeNS(XLINK, 'xlink:href', url);
            return true;
        }
        /* tandai gambar skema (kecuali teks, titik status, dan grup yang memuat foto) */
        function mark(parent) {
            var kids = parent.children || [];
            for (var i = 0; i < kids.length; i++) {
                var k = kids[i];
                var tag = String(k.tagName || '').toLowerCase();
                var isDot = k.classList && k.classList.contains('status-dot');
                var isTerm = k.classList && k.classList.contains('dg-term');
                if (tag === 'text' || isDot || isTerm || tag === 'title') continue;
                if (slot.into && k.id === slot.into) { mark(k); continue; }
                addClass(k, 'dg-schem');
            }
        }
        mark(g);
        var im = doc().createElementNS(SVGNS, 'image');
        im.setAttribute('class', 'dg-photo');
        im.setAttribute('x', slot.x); im.setAttribute('y', slot.y);
        im.setAttribute('width', slot.w); im.setAttribute('height', slot.h);
        im.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        im.setAttribute('href', url);
        im.setAttributeNS(XLINK, 'xlink:href', url);
        im.setAttribute('role', 'img');
        im.setAttribute('aria-label', slot.label);
        host.insertBefore(im, host.firstChild);
        addClass(g, 'has-photo');
        return true;
    }

    function load(slot) {
        probe(slot.file, function (url) {
            if (url && apply(slot, url)) status[slot.comp] = 'photo';
            else status[slot.comp] = 'schema';
            refreshButton();
        });
    }

    function root() { return byId('starterSVG'); }
    function setMode(m) {
        mode = m === 'schema' ? 'schema' : 'photo';
        var svg = root();
        if (svg && svg.classList) svg.classList.toggle('dg-schema-mode', mode === 'schema');
        refreshButton();
        return mode;
    }
    function toggle() { return setMode(mode === 'photo' ? 'schema' : 'photo'); }
    function photoCount() {
        return Object.keys(status).filter(function (k) { return status[k] === 'photo'; }).length;
    }
    function refreshButton() {
        var b = byId('dgPhotoBtn');
        if (!b) return;
        var n = photoCount();
        b.textContent = mode === 'photo' ? 'SKEMA' : 'FOTO';
        b.title = mode === 'photo'
            ? 'Tampilkan gambar skema (' + n + ' dari ' + SLOTS.length + ' komponen memakai foto)'
            : 'Tampilkan foto asli komponen (' + n + ' dari ' + SLOTS.length + ' foto tersedia)';
        b.disabled = n === 0;
    }

    function init() {
        if (!doc() || !byId('starterSVG')) return;
        SLOTS.forEach(load);
        refreshButton();
    }

    window.DiagramPhotos = {
        slots: SLOTS, status: status, reload: init, toggle: toggle, setMode: setMode,
        mode: function () { return mode; }, photoCount: photoCount, _apply: apply
    };

    if (doc()) {
        if (doc().readyState === 'loading') doc().addEventListener('DOMContentLoaded', init);
        else init();
    }
})();
