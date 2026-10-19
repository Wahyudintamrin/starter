'use strict';
/* Penyempurnaan UI seluler (tanpa mengubah logika aplikasi):
   1) bilah menu: aria-expanded, tutup saat ketuk di luar / pilih menu;
   2) zoom diagram Simulator (tombol + cubit dua jari);
   3) tabel lebar: beri data-label agar tampil sebagai kartu di ponsel. */
(function () {
    var doc = document;
    function $(id) { return doc.getElementById(id); }

    /* ---- 1) Menu ---- */
    var sidebar = $('sidebar'), toggle = $('sidebarToggle');
    function syncMenu() {
        var open = !!(sidebar && sidebar.classList.contains('open'));
        doc.body.classList.toggle('sb-open', open);
        if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (sidebar && toggle) {
        toggle.setAttribute('aria-controls', 'sidebar');
        new MutationObserver(syncMenu).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
        doc.addEventListener('click', function (e) {
            if (!sidebar.classList.contains('open')) return;
            if (sidebar.contains(e.target) || toggle.contains(e.target)) return;
            sidebar.classList.remove('open');
        });
        doc.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && sidebar.classList.contains('open')) { sidebar.classList.remove('open'); toggle.focus(); }
        });
        syncMenu();
    }

    /* ---- 2) Zoom diagram Simulator ---- */
    var area = $('simDiagramArea');
    var mq = window.matchMedia('(max-width: 560px)');
    var DEFAULT_W = 640, MAX_W = 1400;
    var curW = DEFAULT_W;
    function svgEl() { return area && area.querySelector('svg'); }
    function minW() { return Math.max(area.clientWidth, 280); }
    function baseW() { return mq.matches ? DEFAULT_W : minW(); }   /* desktop: 100% = muat lebar area */
    var zoomed = false;
    function apply(w, anchorX) {
        var svg = svgEl(); if (!svg) return;
        var old = svg.getBoundingClientRect().width || curW;
        curW = Math.min(MAX_W, Math.max(minW(), w));
        var cx = (area.scrollLeft + anchorX) / old;
        svg.style.width = curW + 'px';
        svg.style.minWidth = curW + 'px';
        area.scrollLeft = cx * curW - anchorX;
        zoomed = !mq.matches && curW > minW() + 1;
        if (!mq.matches && !zoomed) { svg.style.width = ''; svg.style.minWidth = ''; }
        var pct = $('simZoomPct'); if (pct) pct.textContent = Math.round(curW / baseW() * 100) + '%';
    }
    function reset() {
        var svg = svgEl(); if (!svg) return;
        if (!mq.matches) {
            svg.style.width = ''; svg.style.minWidth = ''; zoomed = false; curW = minW();
            var pc = $('simZoomPct'); if (pc) pc.textContent = '100%';
            return;
        }
        curW = DEFAULT_W; svg.style.width = curW + 'px'; svg.style.minWidth = curW + 'px';
        var pct = $('simZoomPct'); if (pct) pct.textContent = '100%';
    }
    if (area && area.parentNode) {
        var bar = doc.createElement('div');
        bar.className = 'sim-zoom';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Zoom diagram');
        bar.innerHTML = '<button type="button" data-z="out" aria-label="Perkecil diagram">−</button>' +
            '<button type="button" data-z="in" aria-label="Perbesar diagram">+</button>' +
            '<button type="button" data-z="fit" class="fit" aria-label="Sesuaikan diagram dengan lebar layar">Pas layar</button>' +
            '<span class="zoom-pct" id="simZoomPct" aria-live="polite">100%</span>';
        area.parentNode.insertBefore(bar, area);
        bar.addEventListener('click', function (e) {
            var b = e.target.closest('button'); if (!b) return;
            var mid = area.clientWidth / 2, z = b.getAttribute('data-z');
            if (z === 'in') apply(curW * 1.25, mid);
            else if (z === 'out') apply(curW / 1.25, mid);
            else apply(minW(), mid);
        });
        /* desktop: Ctrl/Cmd + roda mouse untuk zoom, seret untuk menggeser */
        area.addEventListener('wheel', function (e) {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            var r = area.getBoundingClientRect();
            apply(curW * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left);
        }, { passive: false });
        /* cubit dua jari */
        var p0 = null;
        function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
        area.addEventListener('touchstart', function (e) {
            if (e.touches.length === 2) p0 = { d: dist(e.touches), w: curW };
        }, { passive: true });
        area.addEventListener('touchmove', function (e) {
            if (!p0 || e.touches.length !== 2) return;
            e.preventDefault();
            var r = area.getBoundingClientRect();
            var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
            apply(p0.w * dist(e.touches) / p0.d, cx);
        }, { passive: false });
        area.addEventListener('touchend', function (e) { if (e.touches.length < 2) p0 = null; }, { passive: true });
        (mq.addEventListener ? mq.addEventListener('change', reset) : mq.addListener(reset));
        /* diagram digambar ulang oleh app.js: pasang ulang ukuran bila elemen svg diganti */
        new MutationObserver(function () {
            var s = svgEl();
            if (s && (mq.matches || zoomed) && s.style.width !== curW + 'px') { s.style.width = curW + 'px'; s.style.minWidth = curW + 'px'; }
        }).observe(area, { childList: true });
        reset();
    }

    /* ---- 3) Tabel lebar -> kartu ---- */
    function tag(root) {
        (root || doc).querySelectorAll('table.hub-table').forEach(function (t) {
            var heads = [].map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
            if (!heads.length || t.getAttribute('data-cols') === String(heads.length)) return;
            t.setAttribute('data-cols', heads.length);
            t.querySelectorAll('tbody tr').forEach(function (tr) {
                [].forEach.call(tr.children, function (td, i) { if (heads[i]) td.setAttribute('data-label', heads[i]); });
            });
        });
    }
    var main = $('mainContent');
    if (main) {
        var pending = false;
        new MutationObserver(function () {
            if (pending) return; pending = true;
            requestAnimationFrame(function () { pending = false; tag(main); });
        }).observe(main, { childList: true, subtree: true });
        tag(main);
    }
    /* ---- 4) Progres: bagian dapat dilipat di ponsel ---- */
    var prog = $('hub-progress');
    var mqAcc = window.matchMedia('(max-width: 700px)');
    var accOpen = {};              /* ingat bagian yang dibuka walau halaman dirender ulang */
    function accSync() {
        if (!prog) return;
        prog.querySelectorAll('.hub-box > h3').forEach(function (h) {
            var box = h.parentElement, key = h.textContent.trim();
            box.classList.add('acc');
            box.classList.toggle('open', !!accOpen[key]);
            if (mqAcc.matches) {
                h.setAttribute('role', 'button'); h.setAttribute('tabindex', '0');
                h.setAttribute('aria-expanded', accOpen[key] ? 'true' : 'false');
            } else {
                h.removeAttribute('role'); h.removeAttribute('tabindex'); h.removeAttribute('aria-expanded');
            }
        });
    }
    function accToggle(h) {
        var key = h.textContent.trim(); accOpen[key] = !accOpen[key]; accSync();
    }
    if (prog) {
        prog.addEventListener('click', function (e) {
            var h = e.target.closest('.hub-box > h3');
            if (h && mqAcc.matches && prog.contains(h)) accToggle(h);
        });
        prog.addEventListener('keydown', function (e) {
            var h = e.target.closest && e.target.closest('.hub-box > h3');
            if (h && mqAcc.matches && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); accToggle(h); }
        });
        var accPending = false;
        new MutationObserver(function () {
            if (accPending) return; accPending = true;
            requestAnimationFrame(function () { accPending = false; accSync(); });
        }).observe(prog, { childList: true });
        (mqAcc.addEventListener ? mqAcc.addEventListener('change', accSync) : mqAcc.addListener(accSync));
        accSync();
    }
})();

/* ---- 3D Lab: kontrol dikelompokkan dalam tab (Tampilan / Sistem / Mode / Pengaturan) ----
   Hanya mengatur tampilan: semua tombol tetap ada di DOM dengan id yang sama. */
(function () {
    function init() {
        var box = document.querySelector('#page-3d .p6-controls');
        if (!box || box.getAttribute('data-tabs') === '1') return;
        var groups = Array.prototype.slice.call(box.querySelectorAll(':scope > .p6-ctrl-group'));
        if (groups.length < 2) return;
        box.setAttribute('data-tabs', '1');
        box.classList.add('has-tabs');
        var bar = document.createElement('div');
        bar.className = 'p6-tabs'; bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Kelompok kontrol 3D');
        var tabs = [];
        function select(i, focus) {
            groups.forEach(function (g, k) { g.classList.toggle('tab-on', k === i); g.setAttribute('role', 'tabpanel'); });
            tabs.forEach(function (t, k) { t.setAttribute('aria-selected', k === i ? 'true' : 'false'); t.tabIndex = k === i ? 0 : -1; if (k === i && focus) t.focus(); });
        }
        groups.forEach(function (g, i) {
            var lab = g.querySelector('.p6-ctrl-label');
            var name = lab ? lab.textContent.trim() : ('Grup ' + (i + 1));
            var t = document.createElement('button');
            t.type = 'button'; t.className = 'p6-tab'; t.setAttribute('role', 'tab'); t.textContent = name.charAt(0) + name.slice(1).toLowerCase();
            t.addEventListener('click', function () { select(i); });
            t.addEventListener('keydown', function (e) {
                var n = e.key === 'ArrowRight' ? i + 1 : (e.key === 'ArrowLeft' ? i - 1 : -1);
                if (n >= 0 && n < groups.length) { e.preventDefault(); select(n, true); }
            });
            bar.appendChild(t); tabs.push(t);
            if (lab) lab.classList.add('sr-only');
        });
        box.insertBefore(bar, box.firstChild);
        select(0);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
