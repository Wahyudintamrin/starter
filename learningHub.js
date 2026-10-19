/* ============================================================
   LEARNING HUB — Materi · Praktik/Job Sheet · Diagnosis ·
   Evaluasi · Progres · Panduan
   ------------------------------------------------------------
   - Satu penyimpanan progres (localStorage 'starterHub_v1') yang
     dipakai bersama oleh semua halaman → Progres terintegrasi.
   - Setiap materi, job sheet, studi kasus, dan kuis dibuka di
     halaman tersendiri (routing #/...), bisa kembali dengan tombol
     "Kembali" maupun tombol back browser.
   - Membutuhkan learningHub-data.js. Tidak mengubah engine simulasi.
   ============================================================ */
(function () {
    'use strict';
    if (typeof window === 'undefined' || !window.document) return;

    var D = document;
    var MATERI = window.HUB_MATERI || [];
    var QB = window.HUB_QUESTIONS || {};
    var QUIZZES = window.HUB_QUIZZES || [];
    var KKM = window.HUB_KKM || 75;
    var TESTS = window.HUB_DIAG_TESTS || [];
    var CAUSES = window.HUB_DIAG_CAUSES || [];
    var CASES = window.HUB_DIAG_CASES || [];
    var JOBS = window.LEARNING_JOB_SHEETS || [];
    var PRAKTIK_MAP = ['JS-001', 'JS-002', 'JS-003', 'JS-004', 'JS-007', 'JS-005', 'JS-006', 'JS-011', 'JS-008'];

    /* Contoh gejala per modul (bahasa gejala, bukan spesifikasi).
       Hanya sebagai petunjuk memilih pemeriksaan — wajib dibuktikan dengan ukur. */
    var GEJALA = {
        1: ['Kunci diputar ke START, mesin tidak berputar sama sekali.', 'Terdengar bunyi klik tetapi mesin tetap diam.'],
        2: ['Mesin tidak dapat distarter walau battery tampak baik.', 'Starter hanya bekerja sangat singkat lalu berhenti.'],
        3: ['Starter mati total karena satu komponen (fuse/kabel/relay) bermasalah.', 'Bunyi abnormal dari area motor starter saat START.'],
        4: ['Tidak ada reaksi apa pun saat kunci ke START.', 'Pinion berputar tetapi tidak mengait ke ring gear.'],
        5: ['Starter mati total (rangkaian kontrol terputus).', 'Starter lemah karena jalur massa buruk.'],
        6: ['Cranking lambat dan lampu dasbor meredup.', 'Bunyi klik berulang cepat saat START.'],
        7: ['Tidak ada bunyi klik relay saat START.', 'Starter kadang bekerja, kadang tidak.'],
        8: ['Satu bunyi klik keras, motor tidak berputar.', 'Bunyi “tek-tek-tek” cepat berulang.'],
        9: ['Motor berdengung tetapi mesin tidak berputar.', 'Arus cranking besar namun putaran starter rendah.'],
        10: ['Motor berdengung tinggi tetapi mesin tidak berputar.', 'Bunyi gemeretak/gerinda saat starting.'],
        11: ['Bunyi gerinda saat starting.', 'Starter kadang gagal memutar mesin pada posisi tertentu.'],
        12: ['Keluhan utama: starter tidak bekerja atau bekerja tidak normal.', 'Lampu dasbor meredup saat mencoba start.'],
        13: ['Starter terasa lemah walau battery penuh.', 'Kabel atau sambungan terasa panas setelah cranking.'],
        14: ['Mesin tidak mau start dan penyebabnya belum pasti.', 'Komponen pernah diganti tanpa didahului pengukuran.']
    };

    /* ============================================================
       0. UTIL
       ============================================================ */
    function $(id) { return D.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function pad2(n) { return String(n).padStart(2, '0'); }
    function now() { return Date.now(); }
    function fmtDate(t) {
        if (!t) return '—';
        try { return new Date(t).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); }
        catch (e) { return new Date(t).toISOString().slice(0, 16).replace('T', ' '); }
    }
    function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
    function letter(i) { return String.fromCharCode(65 + i); }
    function parseNum(s) {
        if (s == null) return NaN;
        var m = String(s).replace(',', '.').match(/-?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : NaN;
    }
    function rangeOf(txt) {
        var nums = (String(txt || '').match(/\d+(?:,\d+)?/g) || []).map(function (x) { return parseFloat(x.replace(',', '.')); });
        if (nums.length >= 2) return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]) };
        return null;
    }

    var ICON = {
        back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="15 18 9 12 15 6"/></svg>',
        next: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="9 18 15 12 9 6"/></svg>',
        check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"/></svg>',
        clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        bulb: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>',
        play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
        print: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
        search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/></svg>'
    };

    /* ============================================================
       1. STORE (progres terpadu)
       ============================================================ */
    var KEY = 'starterHub_v1';
    var store = load();
    function blank() { return { nama: '', kelas: '', sekolah: '', materi: {}, js: {}, diag: {}, quiz: {}, visited: {}, log: [] }; }
    function load() {
        try {
            var s = JSON.parse(localStorage.getItem(KEY));
            if (s && typeof s === 'object') { var b = blank(); Object.keys(b).forEach(function (k) { if (s[k] == null) s[k] = b[k]; }); return s; }
        } catch (e) { /* noop */ }
        return blank();
    }
    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* noop */ }
        syncLegacy();
        updateLevelBadge();
    }
    function logAct(type, text) {
        store.log.unshift({ t: now(), type: type, text: text });
        if (store.log.length > 60) store.log.length = 60;
    }
    /* catat kunjungan halaman (data nyata untuk jalur belajar) */
    var VISIT_PAGES = { '3d': 1, 'simulator': 1 };
    function markVisited(page) {
        if (!VISIT_PAGES[page] || store.visited[page]) return;
        store.visited[page] = true; save();
    }

    /* ---- ringkasan progres ---- */
    function phase3Practices() {
        try { if (window.Phase3 && typeof Phase3.getPractices === 'function') { var p = Phase3.getPractices(); return { done: p.filter(function (x) { return x.done; }).length, total: p.length }; } } catch (e) { /* noop */ }
        return { done: 0, total: 0 };
    }
    function summary() {
        var mDone = MATERI.filter(function (m) { return store.materi[m.id] && store.materi[m.id].paham; }).length;
        var jDone = JOBS.filter(function (j) { return store.js[j.id] && store.js[j.id].selesai; }).length;
        var dDone = CASES.filter(function (c) { return store.diag[c.id] && store.diag[c.id].selesai; }).length;
        var qPass = QUIZZES.filter(function (q) { return store.quiz[q.id] && store.quiz[q.id].best >= KKM; }).length;
        var scores = QUIZZES.map(function (q) { return store.quiz[q.id] ? store.quiz[q.id].best : null; }).filter(function (x) { return x != null; });
        var avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : null;
        var p = {
            materi: pct(mDone, MATERI.length), praktik: pct(jDone, JOBS.length),
            diag: pct(dDone, CASES.length), eval: pct(qPass, QUIZZES.length)
        };
        var overall = Math.round((p.materi + p.praktik + p.diag + p.eval) / 4);
        return { mDone: mDone, jDone: jDone, dDone: dDone, qPass: qPass, avg: avg, p: p, overall: overall, p3: phase3Practices() };
    }
    /* ---- evaluasi per dimensi (berbasis bukti, bukan sekadar "diselesaikan") ---- */
    function avgNum(a) { return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length) : null; }
    var K3_RE = /(OHM|berenergi|sistem mati|probe|mode|urutan|drop|kontinuitas)/i;
    function dims() {
        var mDone = MATERI.filter(function (m) { return store.materi[m.id] && store.materi[m.id].paham; }).length;
        var mCek = MATERI.filter(function (m) { return store.materi[m.id] && store.materi[m.id].cek; }).length;
        var qTried = QUIZZES.filter(function (q) { return store.quiz[q.id] && store.quiz[q.id].attempts; }).length;
        var qPass = QUIZZES.filter(function (q) { return store.quiz[q.id] && store.quiz[q.id].best >= KKM; }).length;
        var qAvg = avgNum(QUIZZES.filter(function (q) { return store.quiz[q.id]; }).map(function (q) { return store.quiz[q.id].best; }));
        var ukur = JOBS.filter(function (j) { return j.expectedResult.mode !== 'CASE'; });
        var caseJobs = JOBS.filter(function (j) { return j.expectedResult.mode === 'CASE'; });
        function rec(id) { return store.js[id]; }
        function selesai(j) { var r = rec(j.id); return r && r.selesai; }
        var uDone = ukur.filter(selesai).length;
        var uMaster = ukur.filter(function (j) { return selesai(j) && rec(j.id).nilai >= KKM; }).length;
        var uAvg = avgNum(ukur.filter(selesai).map(function (j) { return rec(j.id).nilai; }));
        var cJobDone = caseJobs.filter(selesai).length;
        var cJobAvg = avgNum(caseJobs.filter(selesai).map(function (j) { return rec(j.id).nilai; }));
        var dAll = CASES.filter(function (c) { var r = store.diag[c.id]; return r && r.selesai; });
        var dMaster = dAll.filter(function (c) { return store.diag[c.id].skor >= KKM; }).length;
        var dAvg = avgNum(dAll.map(function (c) { return store.diag[c.id].skor; }));
        var keyFull = dAll.filter(function (c) { var r = store.diag[c.id]; return c.kunci.every(function (k) { return r.tests.indexOf(k) >= 0; }); }).length;
        var p3 = phase3Practices();
        var jsSent = JOBS.filter(selesai).length;
        var kritTot = 0, kritOk = 0, k3Tot = 0, k3Ok = 0, kritFull = 0;
        JOBS.forEach(function (j) {
            var r = rec(j.id);
            if (!r || !r.kriteria || !r.kriteria.length) return;
            var full = true;
            r.kriteria.forEach(function (ok, i) {
                var t = j.assessmentCriteria[i]; if (!t) return;
                kritTot++; if (ok) kritOk++; else full = false;
                if (K3_RE.test(t)) { k3Tot++; if (ok) k3Ok++; }
            });
            if (full) kritFull++;
        });
        function comp(a) { return avgNum(a.filter(function (x) { return x != null; })); }
        var penC = []; if (qAvg != null) penC.push(qAvg); if (mDone > 0) penC.push(pct(mCek, MATERI.length));
        var skiC = []; if (uAvg != null) skiC.push(uAvg); if (p3.total) skiC.push(pct(p3.done, p3.total));
        var diaC = []; if (dAvg != null) diaC.push(dAvg); if (cJobAvg != null) diaC.push(cJobAvg);
        var sikC = []; if (kritTot) sikC.push(pct(kritOk, kritTot)); if (k3Tot) sikC.push(pct(k3Ok, k3Tot));
        return [
            {
                key: 'pengetahuan', label: 'Pengetahuan', score: comp(penC),
                done: 'Selesai: ' + mDone + '/' + MATERI.length + ' modul ditandai paham · ' + qTried + '/' + QUIZZES.length + ' kuis dikerjakan',
                master: 'Menguasai: ' + mCek + '/' + MATERI.length + ' lulus cek pemahaman · ' + qPass + '/' + QUIZZES.length + ' kuis ≥ KKM ' + KKM,
                ev: ['Rata-rata nilai kuis terbaik: ' + (qAvg == null ? '-' : qAvg), 'Modul lulus cek pemahaman: ' + mCek + '/' + MATERI.length]
            },
            {
                key: 'keterampilan', label: 'Keterampilan ukur', score: comp(skiC),
                done: 'Selesai: ' + uDone + '/' + ukur.length + ' job sheet pengukuran dikirim',
                master: 'Menguasai: ' + uMaster + '/' + ukur.length + ' nilai ≥ KKM ' + KKM,
                ev: ['Nilai rata-rata job sheet pengukuran: ' + (uAvg == null ? '-' : uAvg), p3.total ? 'Latihan multimeter di Simulator: ' + p3.done + '/' + p3.total : 'Latihan multimeter di Simulator: belum tersedia']
            },
            {
                key: 'diagnosa', label: 'Diagnosa', score: comp(diaC),
                done: 'Selesai: ' + dAll.length + '/' + CASES.length + ' kasus · ' + cJobDone + '/' + caseJobs.length + ' job sheet diagnosis',
                master: 'Menguasai: ' + dMaster + '/' + CASES.length + ' kasus dengan skor ≥ KKM ' + KKM,
                ev: ['Rata-rata skor kasus diagnosis: ' + (dAvg == null ? '-' : dAvg), 'Bukti kunci lengkap pada ' + keyFull + '/' + dAll.length + ' kasus selesai', 'Setiap diagnosis wajib disertai alasan berbasis hasil ukur']
            },
            {
                key: 'sikap', label: 'Sikap & K3', score: comp(sikC),
                done: 'Selesai: ' + jsSent + '/' + JOBS.length + ' job sheet dikirim',
                master: 'Menguasai: ' + kritFull + ' job sheet seluruh kriteria penilaian diri terpenuhi',
                ev: ['Kriteria penilaian diri terpenuhi: ' + kritOk + '/' + kritTot, 'Kriteria keselamatan/pengukuran aman: ' + k3Ok + '/' + k3Tot]
            }
        ];
    }
    var LEVELS = [
        { min: 0, n: 1, t: 'Mengenal Sistem Starter' }, { min: 20, n: 2, t: 'Memahami Prinsip Kerja' },
        { min: 45, n: 3, t: 'Terampil Mengukur' }, { min: 70, n: 4, t: 'Mampu Mendiagnosis' }, { min: 100, n: 5, t: 'Teknisi Sistem Starter' }
    ];
    function levelOf(o) { var l = LEVELS[0]; LEVELS.forEach(function (x) { if (o >= x.min) l = x; }); return l; }
    function updateLevelBadge() { /* kredit sidebar dihapus; akses lewat menu Tentang */ }
    /* sinkron ke progress bar lama di Beranda (app.js) */
    function syncLegacy() {
        try {
            var s = summary();
            var lkey = (typeof CONFIG !== 'undefined' && CONFIG.storageKey) || 'starterSimProgress';
            var data = JSON.parse(localStorage.getItem(lkey) || '{}') || {};
            data.materi = s.p.materi; data.praktik = s.p.praktik; data.diagnosis = s.p.diag;
            if (s.avg != null) data.quiz = s.avg;
            localStorage.setItem(lkey, JSON.stringify(data));
            if (typeof window.renderProgress === 'function') window.renderProgress();
            else if (typeof renderProgress === 'function') renderProgress();
        } catch (e) { /* noop */ }
    }

    /* ============================================================
       2. ROUTING (#/halaman/id) + navigasi
       ============================================================ */
    var SUB = { 'materi-baca': 'materi', 'jobsheet-detail': 'jobsheet', 'diagnosis-kasus': 'diagnosis', 'kuis': 'evaluasi' };
    var origNavigate = window.navigateTo;
    function showPage(page) {
        if (typeof origNavigate === 'function') origNavigate(page);
        var parent = SUB[page];
        if (parent) {
            D.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
            var btn = D.querySelector('.nav-btn[data-page="' + parent + '"]');
            if (btn) btn.classList.add('active');
        }
        try { window.scrollTo(0, 0); } catch (e) { /* noop */ }
    }
    var routing = false;
    function go(page, id) {
        var h = '#/' + page + (id != null ? '/' + id : '');
        if (location.hash === h) { route(); return; }
        location.hash = h;
    }
    function navigateWrapped(page) {
        var h = '#/' + page;
        if (!routing && location.hash !== h) { location.hash = h; return; }
        route();
    }
    function route() {
        var m = (location.hash || '').match(/^#\/([\w-]+)(?:\/([\w-]+))?/);
        var page = m ? m[1] : 'beranda', id = m ? m[2] : null;
        if (!$('page-' + page)) page = 'beranda';
        markVisited(page);
        routing = true;
        try {
            switch (page) {
                case 'materi': renderMateriList(); break;
                case 'materi-baca': renderReader(parseInt(id, 10) || 1); break;
                case 'praktik': renderPraktik(); break;
                case 'jobsheet': renderJobList(); break;
                case 'jobsheet-detail': renderJobDetail(id); break;
                case 'diagnosis': renderDiagList(); break;
                case 'diagnosis-kasus': renderCase(id); break;
                case 'evaluasi': renderEvalList(); break;
                case 'kuis': startQuizPage(id); break;
                case 'progres': renderProgress(); break;
                case 'panduan': renderPanduan(); break;
                case 'beranda': renderHomeExtras(); break;
            }
            showPage(page);
        } finally { routing = false; }
    }

    function toast(msg, kind) {
        var t = $('hub-toast');
        if (!t) { t = D.createElement('div'); t.id = 'hub-toast'; t.className = 'hub-toast'; D.body.appendChild(t); }
        t.className = 'hub-toast show ' + (kind || '');
        t.innerHTML = msg;
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { t.className = 'hub-toast'; }, 3200);
    }

    function crumb(items) {
        return '<nav class="hub-crumb">' + items.map(function (it, i) {
            return it.go ? '<a href="#/' + it.go + '">' + esc(it.label) + '</a>' : '<span>' + esc(it.label) + '</span>';
        }).join('<span class="hub-crumb-sep">›</span>') + '</nav>';
    }
    function bar(p, cls) { return '<div class="hub-bar ' + (cls || '') + '"><i style="width:' + Math.max(0, Math.min(100, p)) + '%"></i></div>'; }
    function chip(text, cls) { return '<span class="hub-chip ' + (cls || '') + '">' + text + '</span>'; }

    /* aksi lintas halaman (simulator / 3D / job sheet) */
    function doAction(a) {
        if (!a) return;
        if (a.jobsheet) return go('jobsheet-detail', a.jobsheet);
        if (a.page === '3d') {
            go('3d');
            if (a.focus) setTimeout(function () { try { if (window.Phase6) { if (Phase6.focusAndFly) Phase6.focusAndFly(a.focus); else Phase6.focusComponent(a.focus); } } catch (e) { /* noop */ } }, 900);
            return;
        }
        if (a.page === 'simulator' && a.multimeter) { go('simulator'); setTimeout(function () { try { Phase3.openLab(); } catch (e) { /* noop */ } }, 300); return; }
        go(a.page);
    }

    /* ============================================================
       3. MATERI — daftar + halaman baca
       ============================================================ */
    function matStatus(id) {
        var r = store.materi[id];
        if (r && r.paham) return 'paham';
        if (r && r.dibuka) return 'dibuka';
        return 'baru';
    }
    function renderMateriList() {
        var el = $('hub-materi');
        if (!el) return;
        var s = summary();
        var nextM = MATERI.find(function (m) { return matStatus(m.id) !== 'paham'; });
        var html = '<div class="hub-summary">'
            + '<div class="hub-summary-main"><div class="hub-summary-label">Progres materi</div>'
            + '<div class="hub-summary-value">' + s.mDone + ' <small>/ ' + MATERI.length + ' modul dipahami</small></div>' + bar(s.p.materi) + '</div>'
            + (nextM ? '<button class="hub-btn primary" onclick="StarterHub.go(\'materi-baca\',' + nextM.id + ')">' + ICON.play + ' ' + (s.mDone ? 'Lanjutkan: Modul ' + pad2(nextM.id) : 'Mulai dari Modul 01') + '</button>'
                : '<button class="hub-btn success" onclick="StarterHub.go(\'evaluasi\')">' + ICON.check + ' Semua modul dipahami — ke Evaluasi</button>')
            + '</div>';
        html += '<div class="hub-mat-grid">' + MATERI.map(function (m) {
            var st = matStatus(m.id);
            var stTxt = st === 'paham' ? chip(ICON.check + ' Selesai dibaca', 'ok') : st === 'dibuka' ? chip('Sedang dipelajari', 'warn') : chip('Belum dibaca', 'muted');
            if (store.materi[m.id] && store.materi[m.id].cek) stTxt += ' ' + chip('Cek ' + ICON.check, 'ok');
            return '<button type="button" class="hub-mat-card st-' + st + '" onclick="StarterHub.go(\'materi-baca\',' + m.id + ')">'
                + '<div class="hub-mat-top"><span class="hub-mat-num">MODUL ' + pad2(m.id) + '</span>' + stTxt + '</div>'
                + '<h3>' + esc(m.title) + '</h3><p>' + esc(m.desc) + '</p>'
                + '<div class="hub-mat-meta">' + ICON.clock + ' ' + m.durasi + ' menit · ' + esc(m.tingkat) + '<span class="hub-mat-open">Buka materi ' + ICON.next + '</span></div>'
                + '</button>';
        }).join('') + '</div>';
        el.innerHTML = html;
    }

    function renderSection(b) {
        var h = '<section class="hub-sec">';
        if (b.judul) h += '<h3>' + esc(b.judul) + '</h3>';
        if (b.teks) h += '<p>' + esc(b.teks) + '</p>';
        if (b.poin) h += '<ul class="hub-list">' + b.poin.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>';
        if (b.langkah) h += '<ol class="hub-steps">' + b.langkah.map(function (p) { return '<li><span>' + esc(p) + '</span></li>'; }).join('') + '</ol>';
        if (b.tabel) h += '<div class="hub-table-wrap"><table class="hub-table"><thead><tr>' + b.tabel.kepala.map(function (k) { return '<th>' + esc(k) + '</th>'; }).join('') + '</tr></thead><tbody>'
            + b.tabel.baris.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
        return h + '</section>';
    }

    var readerId = 1;
    function renderReader(id) {
        var m = MATERI.find(function (x) { return x.id === id; }) || MATERI[0];
        if (!m) return;
        readerId = m.id;
        if (!store.materi[m.id]) store.materi[m.id] = {};
        if (!store.materi[m.id].dibuka) { store.materi[m.id].dibuka = now(); logAct('materi', 'Membuka Modul ' + pad2(m.id) + ' — ' + m.title); save(); }
        var idx = MATERI.indexOf(m), next = MATERI[idx + 1], prev = MATERI[idx - 1];
        var paham = matStatus(m.id) === 'paham';
        var mastered = !!(store.materi[m.id] && store.materi[m.id].cek);
        var el = $('hub-reader');
        var html = crumb([{ label: 'Materi', go: 'materi' }, { label: 'Modul ' + pad2(m.id) }])
            + '<header class="hub-head">'
            + '<div class="hub-head-num">' + pad2(m.id) + '</div>'
            + '<div class="hub-head-txt"><h1>' + esc(m.title) + '</h1><p>' + esc(m.desc) + '</p>'
            + '<div class="hub-head-meta">' + chip(ICON.clock + ' ± ' + m.durasi + ' menit') + chip('Tingkat: ' + esc(m.tingkat)) + (paham ? chip(ICON.check + ' Selesai dibaca', 'ok') : chip('Belum ditandai', 'muted')) + (mastered ? chip(ICON.check + ' Penguasaan: lulus cek', 'ok') : '') + '</div></div>'
            + '</header>'
            + '<div class="hub-reader-grid"><article class="hub-article">'
            + '<section class="hub-box hub-goal"><h3>Tujuan pembelajaran</h3><ul class="hub-list check">' + m.tujuan.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></section>'
            + m.bagian.map(renderSection).join('')
            + (GEJALA[m.id] ? '<section class="hub-box hub-gejala"><h3>Contoh gejala kendaraan</h3><ul class="hub-list">' + GEJALA[m.id].map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul><p class="hub-muted">Gejala hanya petunjuk awal untuk memilih pemeriksaan — bukan kesimpulan. Buktikan dengan pengukuran.</p></section>' : '')
            + '<section class="hub-callout">' + ICON.bulb + '<div><h3>Rangkuman</h3><ul class="hub-list">' + m.penting.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div></section>';
        if (m.cek) {
            html += '<section class="hub-box hub-check" id="hub-cek"><h3>Cek pemahaman</h3><p class="hub-q">' + esc(m.cek.q) + '</p><div class="hub-opts">'
                + m.cek.opsi.map(function (o, i) { return '<button type="button" class="hub-opt" data-i="' + i + '" onclick="StarterHub.answerCheck(' + i + ')"><b>' + letter(i) + '</b><span>' + esc(o) + '</span></button>'; }).join('')
                + '</div><div class="hub-fb" id="hub-cek-fb"></div></section>';
        }
        html += '<section class="hub-box hub-mastery"><h3>Penyelesaian &amp; penguasaan</h3><div class="hub-mastery-row">'
            + '<span class="hub-mastery-item ' + (paham ? 'ok' : '') + '">Penyelesaian materi: <b>' + (paham ? 'Selesai dibaca' : 'Belum') + '</b></span>'
            + '<span class="hub-mastery-item ' + (mastered ? 'ok' : '') + '">Penguasaan (cek pemahaman): <b>' + (mastered ? 'Lulus' : 'Belum diuji') + '</b></span>'
            + '</div><p class="hub-muted">Menandai <b>Paham</b> berarti materi selesai dibaca. <b>Menguasai</b> berarti sudah menjawab cek pemahaman dengan benar.</p></section>';
        if (m.aksi && m.aksi.length) {
            html += '<section class="hub-box hub-try"><h3>Praktikkan</h3><div class="hub-try-row">' + m.aksi.map(function (a, i) {
                return '<button type="button" class="hub-btn ghost" onclick="StarterHub.materiAction(' + i + ')">' + ICON.play + ' ' + esc(a.label) + '</button>';
            }).join('') + '</div></section>';
        }
        html += '</article><aside class="hub-aside"><div class="hub-aside-card"><div class="hub-aside-title">Daftar modul</div><ol class="hub-toc">'
            + MATERI.map(function (x) {
                var st = matStatus(x.id);
                return '<li class="' + (x.id === m.id ? 'cur ' : '') + 'st-' + st + '"><a href="#/materi-baca/' + x.id + '"><span class="dot">' + (st === 'paham' ? ICON.check : pad2(x.id)) + '</span>' + esc(x.title) + '</a></li>';
            }).join('') + '</ol></div></aside></div>'
            + '<footer class="hub-actionbar">'
            + '<button type="button" class="hub-btn" onclick="StarterHub.go(\'materi\')">' + ICON.back + ' Kembali</button>'
            + '<button type="button" id="hub-paham-btn" class="hub-btn ' + (paham ? 'success' : 'primary-outline') + '" onclick="StarterHub.togglePaham(' + m.id + ')">' + ICON.check + ' ' + (paham ? 'Sudah Paham' : 'Paham') + '</button>'
            + (next ? '<button type="button" class="hub-btn primary" onclick="StarterHub.nextMateri()">Lanjut: ' + esc(next.title) + ' ' + ICON.next + '</button>'
                : '<button type="button" class="hub-btn primary" onclick="StarterHub.go(\'evaluasi\')">Selesai — Kerjakan Evaluasi ' + ICON.next + '</button>')
            + '</footer>';
        el.innerHTML = html;
        void prev;
        if (store.materi[m.id].cek && m.cek) {
            var rb = D.querySelector('#hub-cek .hub-opt[data-i="' + m.cek.jawab + '"]');
            if (rb) rb.classList.add('right');
            var cf = $('hub-cek-fb'); if (cf) { cf.className = 'hub-fb show ok'; cf.innerHTML = '<b>Tepat!</b> ' + esc(m.cek.bahas); }
        }
    }
    function answerCheck(i) {
        var m = MATERI.find(function (x) { return x.id === readerId; });
        if (!m || !m.cek) return;
        var ok = i === m.cek.jawab;
        D.querySelectorAll('#hub-cek .hub-opt').forEach(function (b) {
            var k = +b.getAttribute('data-i');
            b.classList.remove('right', 'wrong');
            if (k === m.cek.jawab && ok) b.classList.add('right');
            if (k === i && !ok) b.classList.add('wrong');
        });
        var fb = $('hub-cek-fb');
        fb.className = 'hub-fb show ' + (ok ? 'ok' : 'bad');
        fb.innerHTML = ok ? '<b>Tepat!</b> ' + esc(m.cek.bahas) : '<b>Belum tepat.</b> Baca kembali bagian materi di atas, lalu coba lagi.';
        if (ok) {
            store.materi[m.id].cek = true; save();
            var mi = D.querySelector('.hub-mastery .hub-mastery-item:last-child');
            if (mi) { mi.className = 'hub-mastery-item ok'; mi.innerHTML = 'Penguasaan (cek pemahaman): <b>Lulus</b>'; }
        }
    }
    function togglePaham(id) {
        var r = store.materi[id] || (store.materi[id] = {});
        var m = MATERI.find(function (x) { return x.id === id; });
        if (r.paham) {
            r.paham = false; r.pahamAt = null;
            logAct('materi', 'Membatalkan tanda paham Modul ' + pad2(id));
            save(); renderReader(id);
            toast('Tanda paham Modul ' + pad2(id) + ' dibatalkan.');
            return;
        }
        r.paham = true; r.pahamAt = now();
        logAct('materi', 'Memahami Modul ' + pad2(id) + ' — ' + (m ? m.title : ''));
        save(); renderReader(id);
        var s = summary();
        toast(ICON.check + ' Modul ' + pad2(id) + ' ditandai <b>paham</b>. Progres materi ' + s.mDone + '/' + MATERI.length + ' (' + s.p.materi + '%).', 'ok');
    }
    function nextMateri() {
        var idx = MATERI.findIndex(function (x) { return x.id === readerId; });
        var nx = MATERI[idx + 1];
        if (nx) go('materi-baca', nx.id); else go('evaluasi');
    }
    function materiAction(i) {
        var m = MATERI.find(function (x) { return x.id === readerId; });
        if (m && m.aksi && m.aksi[i]) doAction(m.aksi[i]);
    }

    /* ============================================================
       4. PRAKTIK & JOB SHEET
       ============================================================ */
    function jsState(id) {
        var job = JOBS.find(function (j) { return j.id === id; });
        if (!store.js[id]) store.js[id] = { steps: [], hasil: '', analisis: '', jawab: [], simpulan: '', catatan: '', kriteria: [] };
        var s = store.js[id];
        if (job) { while (s.steps.length < job.procedure.length) s.steps.push(false); }
        return s;
    }
    function jsStatus(id) {
        var s = store.js[id];
        if (s && s.selesai) return 'selesai';
        if (s && (s.steps.some(Boolean) || s.hasil || s.simpulan)) return 'proses';
        return 'baru';
    }
    function jsChip(id) {
        var st = jsStatus(id), s = store.js[id];
        return st === 'selesai' ? chip(ICON.check + ' Selesai · nilai ' + s.nilai, 'ok') : st === 'proses' ? chip('Sedang dikerjakan', 'warn') : chip('Belum', 'muted');
    }
    function renderPraktik() {
        var el = $('praktikList');
        if (!el) return;
        var done = PRAKTIK_MAP.filter(function (id) { return jsStatus(id) === 'selesai'; }).length;
        var p3 = phase3Practices();
        el.className = 'hub-praktik';
        el.innerHTML = '<div class="hub-summary"><div class="hub-summary-main"><div class="hub-summary-label">Praktik selesai</div><div class="hub-summary-value">' + done + ' <small>/ ' + PRAKTIK_MAP.length + ' praktik</small></div>' + bar(pct(done, PRAKTIK_MAP.length)) + '</div>'
            + '<div class="hub-summary-note">Setiap praktik dikerjakan melalui <b>job sheet</b>: ikuti langkah kerja, ukur di Simulator (tombol MULTI), isi hasil, lalu kirim.' + (p3.total ? '<br>Latihan multimeter di Simulator: <b>' + p3.done + '/' + p3.total + '</b> selesai.' : '') + '</div></div>'
            + '<div class="hub-list-cards">' + PRAKTIK_MAP.map(function (id, i) {
                var job = JOBS.find(function (j) { return j.id === id; }) || { title: id, objective: '' };
                var t = (typeof PRAKTIK_ITEMS !== 'undefined' && PRAKTIK_ITEMS[i] && PRAKTIK_ITEMS[i].title) || job.title;
                return '<button type="button" class="hub-row-card" onclick="StarterHub.go(\'jobsheet-detail\',\'' + id + '\')">'
                    + '<span class="hub-row-num">' + pad2(i + 1) + '</span>'
                    + '<span class="hub-row-main"><b>' + esc(t) + '</b><small>' + esc(job.objective) + ' · Job sheet ' + id + '</small></span>'
                    + jsChip(id) + '<span class="hub-row-go">' + ICON.next + '</span></button>';
            }).join('') + '</div>';
    }
    function renderJobList() {
        var el = $('hub-js-list');
        if (!el) return;
        var s = summary();
        el.innerHTML = '<div class="hub-summary"><div class="hub-summary-main"><div class="hub-summary-label">Job sheet selesai</div><div class="hub-summary-value">' + s.jDone + ' <small>/ ' + JOBS.length + '</small></div>' + bar(s.p.praktik) + '</div>'
            + '<div class="hub-summary-note">Klik job sheet untuk membuka lembar kerjanya di halaman tersendiri. Hasil tersimpan otomatis dan bisa dicetak.</div></div>'
            + '<div class="hub-js-grid">' + JOBS.map(function (j) {
                return '<button type="button" class="hub-js-card st-' + jsStatus(j.id) + '" onclick="StarterHub.go(\'jobsheet-detail\',\'' + j.id + '\')">'
                    + '<div class="hub-mat-top"><span class="hub-mat-num">' + j.id + '</span>' + jsChip(j.id) + '</div>'
                    + '<h3>' + esc(j.title) + '</h3><p>' + esc(j.objective) + '</p>'
                    + '<div class="hub-mat-meta">' + j.procedure.length + ' langkah · ' + esc(j.tools.join(', ')) + '<span class="hub-mat-open">Buka ' + ICON.next + '</span></div></button>';
            }).join('') + '</div>';
    }

    var curJob = null;
    function fieldLabel(f) {
        if (!f || f === 'diagnosis') return 'Diagnosis kasus';
        return f.split('-').map(function (x) { return x.replace(/([A-Z])/g, ' $1').toLowerCase(); }).join(' → ');
    }
    function renderJobDetail(id) {
        var j = JOBS.find(function (x) { return x.id === id; }) || JOBS[0];
        if (!j) return;
        curJob = j;
        var s = jsState(j.id);
        var isCase = j.expectedResult && j.expectedResult.mode === 'CASE';
        var idx = JOBS.indexOf(j), next = JOBS[idx + 1];
        var doneSteps = s.steps.filter(Boolean).length;
        var el = $('hub-js-detail');
        var solved = CASES.filter(function (c) { return store.diag[c.id] && store.diag[c.id].selesai; });
        var html = crumb([{ label: 'Job Sheet', go: 'jobsheet' }, { label: j.id }])
            + '<header class="hub-head js"><div class="hub-head-num small">' + j.id.replace('JS-', '') + '</div><div class="hub-head-txt"><div class="hub-kicker">JOB SHEET ' + j.id + '</div><h1>' + esc(j.title) + '</h1>'
            + '<div class="hub-head-meta">' + jsChip(j.id) + chip(j.procedure.length + ' langkah kerja') + (s.selesai ? chip('Dikirim ' + fmtDate(s.selesai), 'muted') : '') + '</div></div>'
            + '<div class="hub-head-side"><button class="hub-btn ghost" onclick="StarterHub.printJob()">' + ICON.print + ' Cetak</button></div></header>'
            + '<div class="hub-reader-grid"><article class="hub-article js-sheet">'
            + '<section class="hub-box"><h3>A. Tujuan</h3><p>' + esc(j.objective) + '</p></section>'
            + '<section class="hub-box"><h3>B. Alat & bahan</h3><div class="hub-tags">' + j.tools.map(function (t) { return chip(esc(t)); }).join('') + '</div></section>'
            + '<section class="hub-callout warn">' + ICON.warn + '<div><h3>C. Keselamatan kerja (K3)</h3><ul class="hub-list">' + j.safety.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div></section>'
            + '<section class="hub-box"><h3>D. Langkah kerja <small id="hub-js-stepcount">(' + doneSteps + '/' + j.procedure.length + ')</small></h3><ol class="hub-checklist">'
            + j.procedure.map(function (p, i) {
                return '<li><label><input type="checkbox" ' + (s.steps[i] ? 'checked ' : '') + 'onchange="StarterHub.jsStep(' + i + ',this.checked)"><span class="n">' + (i + 1) + '</span><span>' + esc(p) + '</span></label></li>';
            }).join('') + '</ol>'
            + '<div class="hub-try-row"><button class="hub-btn ghost" onclick="StarterHub.openSimulator(' + (isCase ? 'false' : 'true') + ')">' + ICON.play + (isCase ? ' Buka Studi Kasus Diagnosis' : ' Buka Simulator & Multimeter') + '</button></div></section>';
        html += '<section class="hub-box"><h3>E. Hasil pengukuran</h3>'
            + '<div class="hub-callout">' + ICON.bulb + '<div><h4>Panduan satuan &amp; mode alat ukur</h4><ul class="hub-list">'
            + '<li><b>V DC</b> — mengukur tegangan (volt).</li>'
            + '<li><b>A DC</b> — mengukur arus (ampere), mis. arus cranking.</li>'
            + '<li><b>&Omega;</b> — mengukur tahanan; <b>hanya saat sistem MATI</b>.</li>'
            + '<li><b>CONTINUITY</b> — mengecek jalur tersambung/terputus (sistem mati).</li>'
            + '<li><b>V DROP</b> — tegangan hilang saat berarus (cranking); positif &le; 0,5 V, massa &le; 0,2 V.</li>'
            + '</ul></div></div>';
        if (isCase) {
            html += '<p class="hub-muted">Kerjakan salah satu studi kasus di menu <b>Diagnosis</b>, lalu pilih kasus yang sudah diselesaikan.</p>'
                + '<div class="hub-field"><label>Kasus yang dikerjakan</label><select id="hub-js-hasil" onchange="StarterHub.jsField(\'hasil\',this.value)"><option value="">— pilih kasus yang sudah selesai —</option>'
                + solved.map(function (c) { return '<option value="' + c.id + '"' + (s.hasil === c.id ? ' selected' : '') + '>' + c.id + ' — ' + esc(c.judul) + ' (skor ' + store.diag[c.id].skor + ')</option>'; }).join('')
                + '</select>' + (solved.length ? '' : '<small class="hub-warn-txt">Belum ada kasus yang selesai. Buka menu Diagnosis terlebih dahulu.</small>') + '</div>';
        } else {
            var er = j.expectedResult;
            html += '<div class="hub-table-wrap"><table class="hub-table"><thead><tr><th>Titik ukur</th><th>Mode</th><th>Nilai standar</th><th>Hasil ukur</th><th>Status</th></tr></thead><tbody><tr>'
                + '<td>' + esc(fieldLabel(er.field)) + '</td><td>' + esc(er.mode) + '</td><td>' + esc(er.normalRange) + '</td>'
                + '<td><input class="hub-input" id="hub-js-hasil" value="' + esc(s.hasil) + '" placeholder="mis. 12,6" oninput="StarterHub.jsField(\'hasil\',this.value)"></td>'
                + '<td id="hub-js-status">' + measureStatus(j, s.hasil) + '</td></tr></tbody></table></div>'
                + '<div class="hub-try-row"><button class="hub-btn ghost small" onclick="StarterHub.jsFromMeter()">Ambil nilai dari multimeter</button><span class="hub-muted" id="hub-js-meter"></span></div>';
        }
        html += '</section><section class="hub-box"><h3>F. Analisis</h3><p class="hub-muted">' + (isCase ? 'Jelaskan bagaimana bukti pengukuran mendukung diagnosis, dan mengapa kemungkinan penyebab lain ditolak.' : 'Bandingkan hasil ukur dengan nilai standar. Apakah dalam batas? Jelaskan arti hasil terhadap kondisi komponen.') + '</p><textarea class="hub-input" rows="3" placeholder="Tulis analisis berdasarkan data pengukuran…" oninput="StarterHub.jsField(\'analisis\',this.value)">' + esc(s.analisis) + '</textarea></section>'
            + '<section class="hub-box"><h3>G. Pertanyaan</h3>' + j.questions.map(function (q, i) {
            return '<div class="hub-field"><label>' + (i + 1) + '. ' + esc(q.q) + '</label><input class="hub-input" value="' + esc(s.jawab[i] || '') + '" oninput="StarterHub.jsAnswer(' + i + ',this.value)" placeholder="Tulis jawaban…"><small class="hub-muted">Format jawaban: ' + esc(q.expect) + '</small></div>';
        }).join('') + '</section>'
            + '<section class="hub-box"><h3>H. Kesimpulan</h3><div class="hub-radio-row">'
            + ['Normal', 'Tidak normal'].map(function (v) { return '<label class="hub-radio"><input type="radio" name="hub-js-simp" value="' + v + '"' + (s.simpulan === v ? ' checked' : '') + ' onchange="StarterHub.jsField(\'simpulan\',this.value)"> ' + v + '</label>'; }).join('')
            + '</div><textarea class="hub-input" rows="3" placeholder="Jelaskan alasan kesimpulan berdasarkan data…" oninput="StarterHub.jsField(\'catatan\',this.value)">' + esc(s.catatan) + '</textarea></section>'
            + '<section class="hub-box"><h3>I. Penilaian diri</h3><p class="hub-muted">Centang kriteria yang sudah Anda penuhi.</p><div class="hub-checks">'
            + j.assessmentCriteria.map(function (c, i) { return '<label class="hub-radio"><input type="checkbox"' + (s.kriteria[i] ? ' checked' : '') + ' onchange="StarterHub.jsCrit(' + i + ',this.checked)"> ' + esc(c) + '</label>'; }).join('')
            + '</div></section><div id="hub-js-result"></div></article>'
            + '<aside class="hub-aside"><div class="hub-aside-card"><div class="hub-aside-title">Kelengkapan</div><div id="hub-js-progress"></div></div>'
            + '<div class="hub-aside-card"><div class="hub-aside-title">Job sheet lain</div><ol class="hub-toc">' + JOBS.map(function (x) {
                var st = jsStatus(x.id);
                return '<li class="' + (x.id === j.id ? 'cur ' : '') + 'st-' + (st === 'selesai' ? 'paham' : st) + '"><a href="#/jobsheet-detail/' + x.id + '"><span class="dot">' + (st === 'selesai' ? ICON.check : x.id.slice(-2)) + '</span>' + esc(x.title) + '</a></li>';
            }).join('') + '</ol></div></aside></div>'
            + '<footer class="hub-actionbar"><button class="hub-btn" onclick="StarterHub.go(\'jobsheet\')">' + ICON.back + ' Kembali</button>'
            + '<button class="hub-btn primary-outline" onclick="StarterHub.jsSaveDraft()">Simpan draf</button>'
            + '<button class="hub-btn primary" onclick="StarterHub.jsSubmit()">' + ICON.check + ' Selesai & Kirim</button>'
            + (next ? '<button class="hub-btn ghost" onclick="StarterHub.go(\'jobsheet-detail\',\'' + next.id + '\')">Job sheet berikutnya ' + ICON.next + '</button>' : '')
            + '</footer>';
        el.innerHTML = html;
        updateJobProgress();
        if (s.selesai) showJobResult(j, s, false);
    }
    function measureStatus(j, val) {
        var er = j.expectedResult;
        if (!val) return '<span class="hub-muted">—</span>';
        var n = parseNum(val), r = rangeOf(er.normalRange);
        if (/^ol$/i.test(String(val).trim())) return chip('OL (terbuka)', 'bad');
        if (isNaN(n) || !r) return chip('Tercatat', 'muted');
        return n >= r.min && n <= r.max ? chip('Dalam batas', 'ok') : chip('Di luar batas', 'bad');
    }
    function jobChecks(j, s) {
        var isCase = j.expectedResult.mode === 'CASE';
        return [
            { ok: s.steps.every(Boolean), t: 'Semua langkah kerja dicentang' },
            { ok: !!s.hasil, t: isCase ? 'Kasus diagnosis dipilih' : 'Hasil pengukuran diisi' },
            { ok: (s.analisis || '').trim().length >= 5, t: 'Analisis hasil diisi' },
            { ok: j.questions.every(function (q, i) { return s.jawab[i] && s.jawab[i].trim(); }), t: 'Semua pertanyaan dijawab' },
            { ok: !!s.simpulan && (s.catatan || '').trim().length >= 5, t: 'Kesimpulan & alasannya diisi' }
        ];
    }
    function updateJobProgress() {
        if (!curJob) return;
        var s = jsState(curJob.id), el = $('hub-js-progress');
        var c = jobChecks(curJob, s), n = c.filter(function (x) { return x.ok; }).length;
        if (el) el.innerHTML = bar(pct(n, c.length)) + '<ul class="hub-req">' + c.map(function (x) { return '<li class="' + (x.ok ? 'ok' : '') + '">' + (x.ok ? ICON.check : '○') + ' ' + x.t + '</li>'; }).join('') + '</ul>';
        var sc = $('hub-js-stepcount');
        if (sc) sc.textContent = '(' + s.steps.filter(Boolean).length + '/' + curJob.procedure.length + ')';
        var st = $('hub-js-status');
        if (st) st.innerHTML = measureStatus(curJob, s.hasil);
    }
    function jsStep(i, v) { var s = jsState(curJob.id); s.steps[i] = !!v; persistJob(); }
    function jsField(k, v) { var s = jsState(curJob.id); s[k] = v; persistJob(); }
    function jsAnswer(i, v) { var s = jsState(curJob.id); s.jawab[i] = v; persistJob(); }
    function jsCrit(i, v) { var s = jsState(curJob.id); s.kriteria[i] = !!v; persistJob(); }
    function persistJob() { clearTimeout(persistJob._t); persistJob._t = setTimeout(save, 250); updateJobProgress(); }
    function jsSaveDraft() { save(); toast('Draf job sheet ' + curJob.id + ' tersimpan.'); }
    function jsFromMeter() {
        var r = null;
        try { r = window.Phase3 && Phase3.getReading ? Phase3.getReading() : null; } catch (e) { r = null; }
        var info = $('hub-js-meter');
        if (!r || (r.value == null && !r.ol)) { if (info) info.textContent = 'Belum ada pembacaan. Buka Simulator → MULTI, pasang probe merah & hitam, lalu kembali ke sini.'; return; }
        var v = r.ol ? 'OL' : String(Math.round(r.value * 1000) / 1000).replace('.', ',');
        var inp = $('hub-js-hasil');
        if (inp) inp.value = v;
        jsField('hasil', v);
        if (info) info.textContent = 'Diambil: ' + (r.text || v) + ' ' + (r.unit || '') + (r.red ? ' (' + r.red + ' → ' + r.black + ')' : '');
    }
    function jsSubmit() {
        var j = curJob, s = jsState(j.id);
        var c = jobChecks(j, s), miss = c.filter(function (x) { return !x.ok; });
        if (miss.length) { toast(ICON.warn + ' Lengkapi dulu: ' + miss.map(function (x) { return x.t.toLowerCase(); }).join(', ') + '.', 'bad'); updateJobProgress(); return; }
        var isCase = j.expectedResult.mode === 'CASE';
        var nStep = 30, nMeas, nQ = 20, nSimp = 10;
        if (isCase) {
            var d = store.diag[s.hasil]; nMeas = d ? Math.round(30 * Math.max(0.5, d.skor / 100)) : 15;
        } else {
            var r = rangeOf(j.expectedResult.normalRange), v = parseNum(s.hasil);
            var inRange = r && !isNaN(v) && v >= r.min && v <= r.max;
            var consistent = (inRange && s.simpulan === 'Normal') || (!inRange && s.simpulan === 'Tidak normal');
            nMeas = consistent ? 30 : 15;
        }
        var nK = Math.round(10 * s.kriteria.filter(Boolean).length / Math.max(1, j.assessmentCriteria.length));
        s.nilai = nStep + nMeas + nQ + nSimp + nK;
        s.rincian = { langkah: nStep, hasil: nMeas, pertanyaan: nQ, kesimpulan: nSimp, diri: nK };
        var first = !s.selesai;
        s.selesai = now();
        logAct('jobsheet', 'Menyelesaikan ' + j.id + ' — ' + j.title + ' (nilai ' + s.nilai + ')');
        save();
        renderJobDetail(j.id);
        showJobResult(j, s, true);
        toast(ICON.check + ' Job sheet ' + j.id + (first ? ' selesai' : ' diperbarui') + ' — nilai <b>' + s.nilai + '</b>.', 'ok');
    }
    function showJobResult(j, s, scroll) {
        var el = $('hub-js-result');
        if (!el || !s.rincian) return;
        var r = s.rincian, idx = JOBS.indexOf(j), next = JOBS[idx + 1];
        el.innerHTML = '<section class="hub-result ' + (s.nilai >= KKM ? 'ok' : 'warn') + '"><div class="hub-result-score"><span>' + s.nilai + '</span><small>Nilai job sheet</small></div><div class="hub-result-body">'
            + '<h3>' + (s.nilai >= KKM ? 'Job sheet selesai dengan baik' : 'Job sheet selesai — periksa kembali hasil & kesimpulan') + '</h3>'
            + '<div class="hub-breakdown">' + [['Langkah kerja', r.langkah, 30], ['Hasil & konsistensi', r.hasil, 30], ['Pertanyaan', r.pertanyaan, 20], ['Kesimpulan', r.kesimpulan, 10], ['Penilaian diri', r.diri, 10]].map(function (x) {
                return '<div><span>' + x[0] + '</span><b>' + x[1] + '/' + x[2] + '</b></div>';
            }).join('') + '</div>'
            + '<div class="hub-try-row">' + (next ? '<button class="hub-btn primary" onclick="StarterHub.go(\'jobsheet-detail\',\'' + next.id + '\')">Lanjut ' + next.id + ' ' + ICON.next + '</button>' : '') + '<button class="hub-btn ghost" onclick="StarterHub.go(\'progres\')">Lihat progres</button></div></div></section>';
        if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function printJob() {
        var j = curJob || JOBS[0], s = j ? jsState(j.id) : null;
        var el = $('hub-js-detail');
        var head = $('hub-js-print-head');
        if (el && !head) { head = D.createElement('div'); head.id = 'hub-js-print-head'; el.prepend(head); }
        if (head) {
            head.innerHTML = repKop('Lembar Kerja Job Sheet ' + (j ? j.id : ''))
                + repId('<tr><th>Job sheet</th><td>' + (j ? esc(j.id) + ' — ' + esc(j.title) : '—') + '</td><th>Nilai</th><td>' + (s && s.selesai ? '<b>' + s.nilai + '</b> (' + (s.nilai >= KKM ? 'Tuntas' : 'Perlu penguatan') + ')' : 'Belum dinilai') + '</td></tr>');
        }
        var tail = $('hub-js-print-tail');
        if (el && !tail) { tail = D.createElement('div'); tail.id = 'hub-js-print-tail'; el.appendChild(tail); }
        if (tail) tail.innerHTML = '<div class="hub-rep-tail">' + repSign('Guru Mapel') + '</div>';
        D.body.classList.add('hub-print-js'); window.print(); setTimeout(function () { D.body.classList.remove('hub-print-js'); }, 500);
    }
    function openSimulator(withMeter) {
        if (!withMeter) return go('diagnosis');
        go('simulator');
        setTimeout(function () { try { if (window.Phase3) Phase3.openLab(); } catch (e) { /* noop */ } }, 300);
    }

    /* ============================================================
       5. DIAGNOSIS — studi kasus
       ============================================================ */
    var diagFilter = 'Semua';
    function renderDiagList() {
        var el = $('hub-diag');
        if (!el) return;
        var s = summary();
        var lv = ['Semua', 'Mudah', 'Sedang', 'Sulit'];
        el.innerHTML = '<div class="hub-summary"><div class="hub-summary-main"><div class="hub-summary-label">Kasus terpecahkan</div><div class="hub-summary-value">' + s.dDone + ' <small>/ ' + CASES.length + ' kasus</small></div>' + bar(s.p.diag) + '</div>'
            + '<ol class="hub-howto"><li><b>Baca keluhan</b> pelanggan & gejala.</li><li><b>Lakukan pemeriksaan</b> — pilih tes, bandingkan hasil dengan nilai acuan.</li><li><b>Tentukan penyebab</b> berdasarkan bukti.</li><li><b>Lihat pembahasan</b> & langkah perbaikan.</li></ol></div>'
            + '<div class="hub-filter">' + lv.map(function (l) { return '<button class="hub-pill' + (l === diagFilter ? ' active' : '') + '" onclick="StarterHub.diagFilter(\'' + l + '\')">' + l + '</button>'; }).join('') + '</div>'
            + '<div class="hub-case-grid">' + CASES.filter(function (c) { return diagFilter === 'Semua' || c.tingkat === diagFilter; }).map(function (c) {
                var r = store.diag[c.id];
                var st = r && r.selesai ? chip(ICON.check + ' Selesai · skor ' + r.skor, 'ok') : r && r.tests && r.tests.length ? chip('Sedang dikerjakan', 'warn') : chip('Belum', 'muted');
                return '<button type="button" class="hub-case-card lvl-' + c.tingkat.toLowerCase() + '" onclick="StarterHub.go(\'diagnosis-kasus\',\'' + c.id + '\')">'
                    + '<div class="hub-mat-top"><span class="hub-mat-num">' + c.id + ' · ' + c.tingkat.toUpperCase() + '</span>' + st + '</div>'
                    + '<h3>' + esc(c.judul) + '</h3><p class="hub-veh">' + esc(c.kendaraan) + '</p><p>“' + esc(c.keluhan) + '”</p>'
                    + '<div class="hub-mat-meta">' + c.gejala.length + ' gejala<span class="hub-mat-open">Diagnosis ' + ICON.next + '</span></div></button>';
            }).join('') + '</div>';
    }
    function setDiagFilter(l) { diagFilter = l; renderDiagList(); }

    var curCase = null, caseRun = null;
    function caseRec(id) {
        if (!store.diag[id]) store.diag[id] = { tests: [], hints: 0, wrong: 0 };
        return store.diag[id];
    }
    function resultFor(c, tid) {
        var t = TESTS.find(function (x) { return x.id === tid; });
        return (c.hasil && c.hasil[tid]) || (t ? t.normal : { v: '—', s: 'info' });
    }
    function renderCase(id) {
        var c = CASES.find(function (x) { return x.id === id; }) || CASES[0];
        if (!c) return;
        curCase = c;
        var r = caseRec(c.id);
        if (r.selesai && !caseRun) caseRun = { review: true };
        var done = !!r.selesai;
        var groups = [];
        TESTS.forEach(function (t) { if (groups.indexOf(t.grup) < 0) groups.push(t.grup); });
        var el = $('hub-case');
        var idx = CASES.indexOf(c), next = CASES[idx + 1];
        var html = crumb([{ label: 'Diagnosis', go: 'diagnosis' }, { label: c.id }])
            + '<header class="hub-head diag"><div class="hub-head-num small">' + c.id.slice(-2) + '</div><div class="hub-head-txt"><div class="hub-kicker">STUDI KASUS ' + c.id + ' · ' + c.tingkat.toUpperCase() + '</div><h1>' + esc(c.judul) + '</h1>'
            + '<div class="hub-head-meta">' + chip(esc(c.kendaraan)) + (done ? chip(ICON.check + ' Selesai · skor ' + r.skor, 'ok') : '') + '</div></div></header>'
            + '<div class="hub-case-layout"><div class="hub-case-left">'
            + '<section class="hub-box"><h3>Keluhan pelanggan</h3><blockquote class="hub-quote">“' + esc(c.keluhan) + '”</blockquote><div class="hub-tags">' + c.gejala.map(function (g) { return chip(esc(g), 'warn'); }).join('') + '</div></section>'
            + '<section class="hub-box"><h3><span class="hub-stepno">1</span> Lakukan pemeriksaan</h3><p class="hub-muted">Pilih pemeriksaan yang menurut Anda perlu. Hasil muncul di “Catatan hasil”. Pemeriksaan yang tidak perlu mengurangi skor efisiensi.</p>'
            + groups.map(function (g) {
                return '<div class="hub-test-group"><div class="hub-test-gtitle">' + esc(g) + '</div><div class="hub-test-grid">' + TESTS.filter(function (t) { return t.grup === g; }).map(function (t) {
                    var did = r.tests.indexOf(t.id) >= 0;
                    return '<button type="button" class="hub-test' + (did ? ' done' : '') + '" onclick="StarterHub.runTest(\'' + t.id + '\')"' + (done ? ' disabled' : '') + '><b>' + esc(t.nama) + '</b><small>' + esc(t.alat) + '</small>' + (did ? '<i>' + ICON.check + '</i>' : '') + '</button>';
                }).join('') + '</div></div>';
            }).join('') + '</section>'
            + '<section class="hub-box" id="hub-diag-answer"><h3><span class="hub-stepno">2</span> Tentukan penyebab kerusakan</h3>'
            + '<div class="hub-cause-grid">' + CAUSES.map(function (k) {
                var sel = r.pilihan === k.id;
                return '<label class="hub-cause' + (sel ? ' sel' : '') + (done && k.id === c.jawab ? ' right' : '') + '"><input type="radio" name="hub-cause" value="' + k.id + '"' + (sel ? ' checked' : '') + (done ? ' disabled' : '') + ' onchange="StarterHub.pickCause(this.value)"> <span>' + esc(k.label) + '</span></label>';
            }).join('') + '</div>'
            + '<textarea class="hub-input" rows="2" id="hub-diag-reason" placeholder="Bukti / alasan Anda (contoh: tegangan terminal 30 ada tetapi terminal C 0 V)…"' + (done ? ' disabled' : '') + ' oninput="StarterHub.diagReason(this.value)">' + esc(r.alasan || '') + '</textarea>'
            + '<div class="hub-try-row">' + (done ? '<button class="hub-btn ghost" onclick="StarterHub.resetCase()">Ulangi kasus</button>' : '<button class="hub-btn primary" onclick="StarterHub.submitCase()">' + ICON.check + ' Kirim diagnosis</button><button class="hub-btn ghost" onclick="StarterHub.caseHint()">' + ICON.bulb + ' Petunjuk (−5)</button>')
            + (c.simFault ? '<button class="hub-btn ghost" onclick="StarterHub.trySim()">' + ICON.play + ' Simulasikan gejala di Simulator</button>' : '') + '</div>'
            + '<div class="hub-fb" id="hub-diag-fb"></div></section>'
            + '<div id="hub-diag-result"></div>'
            + '</div><div class="hub-case-right"><section class="hub-box sticky"><h3>Catatan hasil pemeriksaan</h3><div id="hub-diag-log"></div><div id="hub-evidence" class="hub-evidence"></div></section></div></div>'
            + '<footer class="hub-actionbar"><button class="hub-btn" onclick="StarterHub.go(\'diagnosis\')">' + ICON.back + ' Kembali ke daftar kasus</button>'
            + (next ? '<button class="hub-btn ghost" onclick="StarterHub.go(\'diagnosis-kasus\',\'' + next.id + '\')">Kasus berikutnya ' + ICON.next + '</button>' : '') + '</footer>';
        el.innerHTML = html;
        renderCaseLog();
        renderCaseEvidence();
        renderHints();
        if (done) showCaseResult(false);
    }
    function renderCaseEvidence() {
        var c = curCase, r = caseRec(c.id), el = $('hub-evidence');
        if (!el) return;
        var keyDone = c.kunci.filter(function (k) { return r.tests.indexOf(k) >= 0; }).length;
        var missing = c.kunci.length - keyDone;
        var hasAlasan = (r.alasan || '').trim().length >= 12;
        el.innerHTML = '<div class="hub-evidence-title">Bukti diagnosis</div>'
            + '<div class="hub-evidence-row"><b>' + r.tests.length + '</b><span>pemeriksaan tercatat</span></div>'
            + '<div class="hub-evidence-row ' + (missing ? '' : 'ok') + '"><b>' + keyDone + '/' + c.kunci.length + '</b><span>bukti kunci terpenuhi</span></div>'
            + '<div class="hub-evidence-row ' + (hasAlasan ? 'ok' : '') + '"><b>' + (hasAlasan ? 'Ada' : 'Belum') + '</b><span>alasan berbasis hasil ukur</span></div>'
            + (missing ? '<p class="hub-muted">Pemeriksaan bukti kunci belum lengkap — diagnosis dianggap lemah.</p>' : '');
    }
    function renderCaseLog() {
        var c = curCase, r = caseRec(c.id), el = $('hub-diag-log');
        if (!el) return;
        if (!r.tests.length) { el.innerHTML = '<p class="hub-muted">Belum ada pemeriksaan. Pilih pemeriksaan di sebelah kiri.</p>'; return; }
        var reveal = !!r.selesai;
        el.innerHTML = '<div class="hub-table-wrap"><table class="hub-table compact"><thead><tr><th>#</th><th>Pemeriksaan</th><th>Hasil</th><th>Acuan normal</th></tr></thead><tbody>'
            + r.tests.map(function (tid, i) {
                var t = TESTS.find(function (x) { return x.id === tid; }), res = resultFor(c, tid);
                var key = c.kunci.indexOf(tid) >= 0;
                return '<tr class="' + (reveal ? 's-' + res.s : '') + '"><td>' + (i + 1) + '</td><td>' + esc(t ? t.nama : tid) + (reveal && key ? ' ' + chip('bukti kunci', 'ok') : '') + '</td><td><b>' + esc(res.v) + '</b>' + (reveal && res.n ? '<small>' + esc(res.n) + '</small>' : '') + '</td><td class="hub-muted">' + esc(t ? t.normal.v : '') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    }
    function runTest(tid) {
        var r = caseRec(curCase.id);
        if (r.selesai) return;
        if (r.tests.indexOf(tid) < 0) r.tests.push(tid);
        save();
        var btn = D.querySelector('.hub-test[onclick*="\'' + tid + '\'"]');
        if (btn && !btn.classList.contains('done')) { btn.classList.add('done'); btn.insertAdjacentHTML('beforeend', '<i>' + ICON.check + '</i>'); }
        renderCaseLog();
        renderCaseEvidence();
        var res = resultFor(curCase, tid), t = TESTS.find(function (x) { return x.id === tid; });
        toast('<b>' + esc(t.nama) + ':</b> ' + esc(res.v));
    }
    function pickCause(v) { var r = caseRec(curCase.id); r.pilihan = v; save(); D.querySelectorAll('.hub-cause').forEach(function (l) { l.classList.toggle('sel', l.querySelector('input').value === v); }); }
    function diagReason(v) { caseRec(curCase.id).alasan = v; renderCaseEvidence(); clearTimeout(diagReason._t); diagReason._t = setTimeout(save, 300); }
    function renderHints() {
        var r = caseRec(curCase.id), fb = $('hub-diag-fb');
        if (!fb || !r.hints || r.selesai) return;
        fb.className = 'hub-fb show info';
        fb.innerHTML = curCase.petunjuk.slice(0, r.hints).map(function (h, i) { return '<div>' + ICON.bulb + ' <b>Petunjuk ' + (i + 1) + ':</b> ' + esc(h) + '</div>'; }).join('');
    }
    function caseHint() {
        var r = caseRec(curCase.id);
        if (r.hints >= curCase.petunjuk.length) { toast('Semua petunjuk sudah dibuka.'); return; }
        r.hints++; save(); renderHints();
    }
    function caseScore(c, r) {
        var sc = 100, det = [];
        if (r.hints) { sc -= 5 * r.hints; det.push(['Petunjuk dipakai', -5 * r.hints]); }
        if (r.wrong) { sc -= 10 * r.wrong; det.push(['Diagnosis salah sebelumnya', -10 * r.wrong]); }
        var keyDone = c.kunci.filter(function (k) { return r.tests.indexOf(k) >= 0; }).length;
        if (keyDone < c.kunci.length) { var pk = 10 * (c.kunci.length - keyDone); sc -= pk; det.push(['Bukti kunci belum diperiksa', -pk]); }
        var extra = Math.max(0, r.tests.length - (c.kunci.length + 5));
        if (extra) { sc -= 2 * extra; det.push(['Pemeriksaan berlebih', -2 * extra]); }
        return { skor: Math.max(30, sc), det: det };
    }
    function submitCase() {
        var c = curCase, r = caseRec(c.id), fb = $('hub-diag-fb');
        if (!r.pilihan) { fb.className = 'hub-fb show bad'; fb.innerHTML = 'Pilih salah satu penyebab terlebih dahulu.'; return; }
        if (!r.tests.length) { fb.className = 'hub-fb show bad'; fb.innerHTML = 'Lakukan minimal satu pemeriksaan agar diagnosis didukung bukti.'; return; }
        if ((r.alasan || '').trim().length < 12) { fb.className = 'hub-fb show bad'; fb.innerHTML = 'Tuliskan bukti/alasan Anda lebih dulu (sertakan hasil pemeriksaan). Diagnosis tanpa alasan = menebak.'; return; }
        if (r.pilihan !== c.jawab) {
            r.wrong++; save();
            fb.className = 'hub-fb show bad';
            var lbl = (CAUSES.find(function (k) { return k.id === r.pilihan; }) || {}).label;
            fb.innerHTML = '<b>Belum tepat.</b> Data pemeriksaan tidak mendukung “' + esc(lbl) + '”. Bandingkan lagi hasil dengan nilai acuan, lakukan pemeriksaan lain, atau buka petunjuk. (−10 poin)';
            return;
        }
        var s = caseScore(c, r);
        r.skor = s.skor; r.det = s.det; r.selesai = now();
        logAct('diagnosis', 'Memecahkan ' + c.id + ' — ' + c.judul + ' (skor ' + r.skor + ')');
        save();
        renderCase(c.id);
        showCaseResult(true);
        toast(ICON.check + ' Diagnosis tepat! Skor <b>' + r.skor + '</b>.', 'ok');
    }
    function showCaseResult(scroll) {
        var c = curCase, r = caseRec(c.id), el = $('hub-diag-result');
        if (!el || !r.selesai) return;
        var idx = CASES.indexOf(c), next = CASES[idx + 1];
        var cause = (CAUSES.find(function (k) { return k.id === c.jawab; }) || {}).label;
        el.innerHTML = '<section class="hub-result ok"><div class="hub-result-score"><span>' + r.skor + '</span><small>Skor diagnosis</small></div><div class="hub-result-body">'
            + '<h3>Penyebab: ' + esc(cause) + '</h3><p>' + esc(c.bahas) + '</p>'
            + '<div class="hub-two"><div><h4>Bukti kunci</h4><ul class="hub-list">' + c.kunci.map(function (k) { var t = TESTS.find(function (x) { return x.id === k; }); var res = resultFor(c, k); return '<li>' + esc(t.nama) + ': <b>' + esc(res.v) + '</b></li>'; }).join('') + '</ul></div>'
            + '<div><h4>Langkah perbaikan</h4><ol class="hub-list num">' + c.perbaikan.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ol></div></div>'
            + (r.det && r.det.length ? '<div class="hub-breakdown">' + r.det.map(function (d) { return '<div><span>' + d[0] + '</span><b>' + d[1] + '</b></div>'; }).join('') + '</div>' : '<p class="hub-ok-txt">Sempurna — efisien, tanpa petunjuk, didukung bukti kunci.</p>')
            + '<div class="hub-try-row">' + (next ? '<button class="hub-btn primary" onclick="StarterHub.go(\'diagnosis-kasus\',\'' + next.id + '\')">Kasus berikutnya ' + ICON.next + '</button>' : '') + '<button class="hub-btn ghost" onclick="StarterHub.go(\'diagnosis\')">Daftar kasus</button></div></div></section>';
        if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function resetCase() {
        if (!confirm('Ulangi kasus ini dari awal? Skor sebelumnya akan dihapus.')) return;
        delete store.diag[curCase.id]; caseRun = null; save(); renderCase(curCase.id);
    }
    function trySim() {
        var k = curCase.simFault;
        try {
            if (typeof clearAllFaults === 'function') clearAllFaults(false);
            if (typeof FAULTS !== 'undefined' && FAULTS[k]) {
                FAULTS[k].apply(); Sim.activeFaults.push(k);
                if (typeof shutdownSystem === 'function') shutdownSystem();
                if (typeof updateFaultVisuals === 'function') updateFaultVisuals();
                if (typeof EventBus !== 'undefined') EventBus.emit('faultApplied', Sim.activeFaults.slice());
            }
        } catch (e) { /* noop */ }
        go('simulator');
        toast('Gejala kasus ' + curCase.id + ' diterapkan di Simulator. Putar kunci ke START, amati, lalu ukur dengan MULTI. Tekan Reset di Simulator untuk menghapus kerusakan.', 'warn');
    }

    /* ============================================================
       6. EVALUASI — kuis berurutan
       ============================================================ */
    function quizQuestions(qz, attempt) {
        var out = [];
        qz.bank.forEach(function (b) {
            var arr = QB[b] || [];
            if (qz.pick) {
                for (var i = 0; i < qz.pick; i++) out.push(arr[(i * 2 + (attempt || 0)) % arr.length]);
            } else arr.forEach(function (q) { out.push(q); });
        });
        return out;
    }
    function renderEvalList() {
        var el = $('hub-eval');
        if (!el) return;
        var s = summary();
        el.innerHTML = '<div class="hub-summary"><div class="hub-summary-main"><div class="hub-summary-label">Kuis lulus (KKM ' + KKM + ')</div><div class="hub-summary-value">' + s.qPass + ' <small>/ ' + QUIZZES.length + '</small></div>' + bar(s.p.eval) + '</div>'
            + '<div class="hub-summary-note">Rata-rata nilai terbaik: <b>' + (s.avg == null ? '—' : s.avg) + '</b>.<br>Soal ditampilkan satu per satu secara berurutan dengan pilihan A–D. Anda dapat kembali ke soal sebelumnya sebelum mengirim jawaban.</div></div>'
            + '<div class="hub-quiz-grid">' + QUIZZES.map(function (q, i) {
                var r = store.quiz[q.id], n = quizQuestions(q, 0).length;
                var st = r ? (r.best >= KKM ? chip(ICON.check + ' Lulus · ' + r.best, 'ok') : chip('Belum lulus · ' + r.best, 'bad')) : chip('Belum dikerjakan', 'muted');
                return '<div class="hub-quiz-card' + (q.id === 'final' ? ' final' : '') + '"><div class="hub-mat-top"><span class="hub-mat-num">' + esc(q.modul) + '</span>' + st + '</div>'
                    + '<h3>' + esc(q.title) + '</h3><p>' + esc(q.desc) + '</p>'
                    + '<div class="hub-quiz-meta"><span>' + n + ' soal</span><span>± ' + q.durasi + ' menit</span><span>' + (r ? r.attempts + '× dikerjakan' : 'pilihan ganda') + '</span></div>'
                    + '<button class="hub-btn ' + (r ? 'primary-outline' : 'primary') + '" onclick="StarterHub.go(\'kuis\',\'' + q.id + '\')">' + ICON.play + ' ' + (r ? 'Kerjakan lagi' : 'Mulai kuis') + '</button></div>';
            }).join('') + '</div>';
    }
    var QS = null;
    function startQuizPage(id) {
        var qz = QUIZZES.find(function (q) { return q.id === id; }) || QUIZZES[0];
        var rec = store.quiz[qz.id];
        if (!QS || QS.id !== qz.id || QS.finished) {
            QS = { id: qz.id, qz: qz, qs: quizQuestions(qz, rec ? rec.attempts : 0), ans: [], cur: 0, start: now(), finished: false };
        }
        renderQuiz();
    }
    function renderQuiz() {
        var el = $('hub-quiz');
        if (!el || !QS) return;
        if (QS.finished) return renderQuizResult();
        var q = QS.qs[QS.cur], n = QS.qs.length, answered = QS.ans.filter(function (a) { return a != null; }).length;
        el.innerHTML = crumb([{ label: 'Evaluasi', go: 'evaluasi' }, { label: QS.qz.title }])
            + '<div class="hub-quiz-shell"><header class="hub-quiz-head"><div><div class="hub-kicker">' + esc(QS.qz.modul) + '</div><h1>' + esc(QS.qz.title) + '</h1></div>'
            + '<div class="hub-quiz-count"><b>Soal ' + (QS.cur + 1) + '</b> dari ' + n + '<small>' + answered + ' terjawab</small></div></header>'
            + bar(pct(QS.cur + 1, n), 'thin')
            + '<section class="hub-question"><div class="hub-qnum">' + (QS.cur + 1) + '</div><p class="hub-qtext">' + esc(q.q) + '</p>'
            + '<div class="hub-opts big">' + q.o.map(function (o, i) {
                return '<button type="button" class="hub-opt' + (QS.ans[QS.cur] === i ? ' chosen' : '') + '" onclick="StarterHub.qAnswer(' + i + ')"><b>' + letter(i) + '</b><span>' + esc(o) + '</span></button>';
            }).join('') + '</div></section>'
            + '<div class="hub-quiz-nav"><button class="hub-btn" ' + (QS.cur === 0 ? 'disabled' : '') + ' onclick="StarterHub.qMove(-1)">' + ICON.back + ' Sebelumnya</button>'
            + (QS.cur < n - 1 ? '<button class="hub-btn primary" onclick="StarterHub.qMove(1)">Berikutnya ' + ICON.next + '</button>'
                : '<button class="hub-btn success" onclick="StarterHub.qFinish()">' + ICON.check + ' Selesai & Kirim</button>') + '</div>'
            + '<div class="hub-qgrid"><span class="hub-muted">Nomor soal:</span>' + QS.qs.map(function (x, i) {
                return '<button class="' + (i === QS.cur ? 'cur ' : '') + (QS.ans[i] != null ? 'ans' : '') + '" onclick="StarterHub.qJump(' + i + ')">' + (i + 1) + '</button>';
            }).join('') + '</div>'
            + '<div class="hub-try-row"><button class="hub-btn ghost small" onclick="StarterHub.qExit()">' + ICON.back + ' Kembali ke daftar kuis</button></div></div>';
    }
    function qAnswer(i) {
        QS.ans[QS.cur] = i;
        renderQuiz();
        if (QS.cur < QS.qs.length - 1) setTimeout(function () { if (QS && !QS.finished && QS.ans[QS.cur] === i) { QS.cur++; renderQuiz(); } }, 380);
    }
    function qMove(d) { QS.cur = Math.max(0, Math.min(QS.qs.length - 1, QS.cur + d)); renderQuiz(); }
    function qJump(i) { QS.cur = i; renderQuiz(); }
    function qExit() {
        if (QS && !QS.finished && QS.ans.some(function (a) { return a != null; }) && !confirm('Keluar dari kuis? Jawaban yang belum dikirim akan hilang.')) return;
        QS = null; go('evaluasi');
    }
    function qFinish() {
        var empty = QS.qs.length - QS.ans.filter(function (a) { return a != null; }).length;
        if (empty && !confirm('Masih ada ' + empty + ' soal belum dijawab. Kirim sekarang?')) return;
        var benar = QS.qs.filter(function (q, i) { return QS.ans[i] === q.a; }).length;
        var nilai = Math.round(benar / QS.qs.length * 100);
        QS.finished = true; QS.benar = benar; QS.nilai = nilai; QS.dur = Math.round((now() - QS.start) / 1000);
        var r = store.quiz[QS.id] || (store.quiz[QS.id] = { best: 0, attempts: 0 });
        r.attempts++; r.last = nilai; r.best = Math.max(r.best || 0, nilai); r.t = now();
        logAct('kuis', QS.qz.title + ': nilai ' + nilai + (nilai >= KKM ? ' (lulus)' : ' (belum lulus)'));
        save();
        renderQuizResult();
        try { window.scrollTo(0, 0); } catch (e) { /* noop */ }
    }
    function renderQuizResult() {
        var el = $('hub-quiz'), lulus = QS.nilai >= KKM;
        var idx = QUIZZES.findIndex(function (q) { return q.id === QS.id; }), next = QUIZZES[idx + 1];
        var mm = Math.floor(QS.dur / 60), ss = QS.dur % 60;
        el.innerHTML = crumb([{ label: 'Evaluasi', go: 'evaluasi' }, { label: QS.qz.title }, { label: 'Hasil' }])
            + '<section class="hub-result ' + (lulus ? 'ok' : 'warn') + ' big"><div class="hub-result-score"><span>' + QS.nilai + '</span><small>' + (lulus ? 'LULUS' : 'REMEDIAL') + '</small></div><div class="hub-result-body">'
            + '<h3>' + (lulus ? 'Selamat, Anda lulus ' : 'Belum mencapai KKM ') + esc(QS.qz.title) + '</h3>'
            + '<div class="hub-breakdown"><div><span>Jawaban benar</span><b>' + QS.benar + ' / ' + QS.qs.length + '</b></div><div><span>KKM</span><b>' + KKM + '</b></div><div><span>Waktu</span><b>' + mm + 'm ' + ss + 'd</b></div><div><span>Nilai terbaik</span><b>' + store.quiz[QS.id].best + '</b></div></div>'
            + '<div class="hub-try-row"><button class="hub-btn primary-outline" onclick="StarterHub.qRetry()">Ulangi kuis</button>'
            + (next ? '<button class="hub-btn primary" onclick="StarterHub.go(\'kuis\',\'' + next.id + '\')">' + esc(next.title.split('—')[0]) + ' ' + ICON.next + '</button>' : '')
            + '<button class="hub-btn ghost" onclick="StarterHub.go(\'evaluasi\')">Daftar kuis</button></div></div></section>'
            + '<h2 class="hub-h2">Pembahasan</h2><div class="hub-review">' + QS.qs.map(function (q, i) {
                var a = QS.ans[i], ok = a === q.a;
                return '<div class="hub-rev ' + (ok ? 'ok' : 'bad') + '"><div class="hub-rev-head"><b>' + (i + 1) + '.</b> ' + esc(q.q) + chip(ok ? 'Benar' : (a == null ? 'Tidak dijawab' : 'Salah'), ok ? 'ok' : 'bad') + '</div>'
                    + '<ol class="hub-rev-opts">' + q.o.map(function (o, k) { return '<li class="' + (k === q.a ? 'right' : (k === a ? 'wrong' : '')) + '"><b>' + letter(k) + '.</b> ' + esc(o) + '</li>'; }).join('') + '</ol>'
                    + '<p class="hub-muted">' + ICON.bulb + ' ' + esc(q.e) + '</p></div>';
            }).join('') + '</div>';
    }
    function qRetry() { var id = QS.id; QS = null; startQuizPage(id); }

    /* ============================================================
       7. PROGRES TERPADU
       ============================================================ */
    function ring(p) {
        var r = 52, c = 2 * Math.PI * r, off = c * (1 - p / 100);
        return '<svg class="hub-ring" viewBox="0 0 120 120"><circle cx="60" cy="60" r="' + r + '" class="bg"/><circle cx="60" cy="60" r="' + r + '" class="fg" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/><text x="60" y="58">' + p + '%</text><text x="60" y="78" class="sub">keseluruhan</text></svg>';
    }
    function renderProgress() {
        var el = $('hub-progress');
        if (!el) return;
        var idn = syncIdentity(), lk = idn ? idn.locked : {};
        function ro(f) { return lk[f] ? ' readonly aria-readonly="true" title="Terhubung ke akun — tidak dapat diubah di sini"' : ''; }
        var s = summary(), l = levelOf(s.overall);
        var cards = [
            { t: 'Materi dipahami', v: s.mDone + '/' + MATERI.length, p: s.p.materi, go: 'materi' },
            { t: 'Praktik / job sheet', v: s.jDone + '/' + JOBS.length, p: s.p.praktik, go: 'jobsheet' },
            { t: 'Kasus diagnosis', v: s.dDone + '/' + CASES.length, p: s.p.diag, go: 'diagnosis' },
            { t: 'Kuis lulus', v: s.qPass + '/' + QUIZZES.length, p: s.p.eval, go: 'evaluasi', x: s.avg == null ? '' : 'Rata-rata ' + s.avg }
        ];
        var html = '<section class="hub-prog-hero"><div class="hub-prog-ring">' + ring(s.overall) + '</div><div class="hub-prog-who">'
            + '<div class="hub-kicker">LEVEL ' + l.n + '</div><h2>' + esc(l.t) + '</h2>'
            + '<div class="hub-prog-form"><input class="hub-input" id="hub-nama" placeholder="Nama siswa"' + ro('name') + ' value="' + esc(store.nama) + '" onchange="StarterHub.setProfile()"><input class="hub-input" id="hub-kelas" placeholder="Kelas"' + ro('kelas') + ' value="' + esc(store.kelas) + '" onchange="StarterHub.setProfile()"><input class="hub-input" id="hub-sekolah" placeholder="Asal sekolah / kelas industri"' + ro('sekolah') + ' value="' + esc(store.sekolah || '') + '" onchange="StarterHub.setProfile()"></div>'
            + (idn ? '<p class="hub-muted">Identitas terhubung ke akun <b>' + esc(idn.username) + '</b>' + (idn.nis ? ' &middot; NIS <b>' + esc(idn.nis) + '</b>' : '') + '. Nama' + (lk.kelas ? ', kelas' : '') + (lk.sekolah ? ' &amp; sekolah' : '') + ' mengikuti data akun.</p>' : '')
            + '<div class="hub-try-row"><button class="hub-btn primary" onclick="StarterHub.printProgress()">' + ICON.print + ' Cetak laporan</button><button class="hub-btn ghost danger" onclick="StarterHub.resetAll()">Reset progres</button></div>'
            + (s.p3.total ? '<p class="hub-muted">Latihan pengukuran multimeter di Simulator: <b>' + s.p3.done + '/' + s.p3.total + '</b> selesai.</p>' : '')
            + '</div></section>'
            + '<div class="hub-stat-grid">' + cards.map(function (c) {
                return '<button class="hub-stat" onclick="StarterHub.go(\'' + c.go + '\')"><span>' + c.t + '</span><b>' + c.v + '</b>' + bar(c.p) + '<small>' + c.p + '%' + (c.x ? ' · ' + c.x : '') + '</small></button>';
            }).join('') + '</div>';
        var dv = dims();
        html += '<section class="hub-box"><h3>Evaluasi per dimensi</h3>'
            + '<p class="hub-muted">Setiap dimensi dinilai dari bukti belajar Anda, bukan sekadar dibuka. <b>Selesai</b> = aktivitas dikerjakan; <b>Menguasai</b> = bukti penguasaan memenuhi KKM ' + KKM + '.</p>'
            + '<div class="hub-dims">' + dv.map(function (d) {
                var st = d.score == null ? 'none' : (d.score >= KKM ? 'ok' : 'warn');
                var stTxt = d.score == null ? 'Belum ada bukti' : (d.score >= KKM ? 'Tuntas' : 'Perlu penguatan');
                return '<div class="hub-dim st-' + st + '">'
                    + '<div class="hub-dim-head"><b>' + d.label + '</b><span class="hub-chip ' + (st === 'ok' ? 'ok' : st === 'warn' ? 'warn' : 'muted') + '">' + stTxt + '</span></div>'
                    + '<div class="hub-dim-score">' + (d.score == null ? '—' : d.score) + '<small>/100</small></div>'
                    + (d.score == null ? '' : bar(d.score))
                    + '<div class="hub-dim-lines"><span class="ok">' + d.master + '</span><span>' + d.done + '</span></div>'
                    + '<ul class="hub-dim-ev">' + d.ev.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
            }).join('') + '</div></section>';
        html += '<section class="hub-box"><h3>Materi</h3><div class="hub-tile-grid">' + MATERI.map(function (m) {
            var st = matStatus(m.id), r = store.materi[m.id];
            return '<a class="hub-tile st-' + st + '" href="#/materi-baca/' + m.id + '" title="' + esc(m.title) + '"><b>' + pad2(m.id) + '</b><span>' + esc(m.title) + '</span><small>' + (st === 'paham' ? 'Paham · ' + fmtDate(r.pahamAt).split(' ').slice(0, 3).join(' ') : st === 'dibuka' ? 'Sedang dipelajari' : 'Belum dibaca') + '</small></a>';
        }).join('') + '</div></section>';
        html += '<div class="hub-two"><section class="hub-box"><h3>Praktik & job sheet</h3><div class="hub-table-wrap"><table class="hub-table compact"><thead><tr><th>Kode</th><th>Job sheet</th><th>Status</th><th>Nilai</th></tr></thead><tbody>'
            + JOBS.map(function (j) { var r = store.js[j.id], st = jsStatus(j.id); return '<tr><td><a href="#/jobsheet-detail/' + j.id + '">' + j.id + '</a></td><td>' + esc(j.title) + '</td><td>' + (st === 'selesai' ? chip('Selesai', 'ok') : st === 'proses' ? chip('Proses', 'warn') : chip('Belum', 'muted')) + '</td><td>' + (r && r.selesai ? '<b>' + r.nilai + '</b>' : '—') + '</td></tr>'; }).join('')
            + '</tbody></table></div></section>'
            + '<section class="hub-box"><h3>Studi kasus diagnosis</h3><div class="hub-table-wrap"><table class="hub-table compact"><thead><tr><th>Kode</th><th>Kasus</th><th>Status</th><th>Skor</th></tr></thead><tbody>'
            + CASES.map(function (c) { var r = store.diag[c.id]; return '<tr><td><a href="#/diagnosis-kasus/' + c.id + '">' + c.id + '</a></td><td>' + esc(c.judul) + '</td><td>' + (r && r.selesai ? chip('Selesai', 'ok') : r && r.tests && r.tests.length ? chip('Proses', 'warn') : chip('Belum', 'muted')) + '</td><td>' + (r && r.selesai ? '<b>' + r.skor + '</b>' : '—') + '</td></tr>'; }).join('')
            + '</tbody></table></div></section></div>';
        html += '<div class="hub-two"><section class="hub-box"><h3>Evaluasi</h3><div class="hub-table-wrap"><table class="hub-table compact"><thead><tr><th>Kuis</th><th>Terbaik</th><th>Terakhir</th><th>Percobaan</th><th>Status</th></tr></thead><tbody>'
            + QUIZZES.map(function (q) { var r = store.quiz[q.id]; return '<tr><td><a href="#/kuis/' + q.id + '">' + esc(q.title) + '</a></td><td>' + (r ? '<b>' + r.best + '</b>' : '—') + '</td><td>' + (r ? r.last : '—') + '</td><td>' + (r ? r.attempts : 0) + '</td><td>' + (r ? (r.best >= KKM ? chip('Lulus', 'ok') : chip('Remedial', 'bad')) : chip('Belum', 'muted')) + '</td></tr>'; }).join('')
            + '</tbody></table></div></section>'
            + '<section class="hub-box"><h3>Aktivitas terakhir</h3>' + (store.log.length ? '<ul class="hub-timeline">' + store.log.slice(0, 12).map(function (a) { return '<li><span class="t">' + fmtDate(a.t) + '</span><span class="k k-' + a.type + '">' + esc(a.type) + '</span> ' + esc(a.text) + '</li>'; }).join('') + '</ul>' : '<p class="hub-muted">Belum ada aktivitas. Mulai dari menu Materi.</p>') + '</section></div>';
        el.innerHTML = html;
    }
    /* Identitas siswa mengikuti AKUN yang sedang masuk (AuthUI.identity()).
       Field yang tersedia dari akun dikunci; field lain tetap bisa diisi manual. */
    function syncIdentity() {
        var A = window.AuthUI;
        var id = (A && typeof A.identity === 'function') ? A.identity() : null;
        if (!id) return null;
        var changed = false;
        if (id.name && store.nama !== id.name) { store.nama = id.name; changed = true; }
        if (id.kelas && store.kelas !== id.kelas) { store.kelas = id.kelas; changed = true; }
        if (id.sekolah && store.sekolah !== id.sekolah) { store.sekolah = id.sekolah; changed = true; }
        if (changed) { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* noop */ } }
        return id;
    }
    function setProfile() {
        store.nama = ($('hub-nama') || {}).value || '';
        store.kelas = ($('hub-kelas') || {}).value || '';
        store.sekolah = ($('hub-sekolah') || {}).value || '';
        syncIdentity();   /* nilai dari akun selalu menang atas isian manual */
        save(); toast('Progres & identitas disimpan.');
    }
    window.addEventListener('starter:identity', function () {
        try { syncIdentity(); if ($('hub-progress') && $('hub-progress').innerHTML) renderProgress(); } catch (e) { /* noop */ }
    });
    /* ---- blok kop laporan (dipakai cetak progres & job sheet) ---- */
    function repKop(title) {
        return '<div class="hub-rep-kop"><b>SIMULATOR SISTEM STARTER</b>'
            + '<span>Program Keahlian Teknik Kendaraan Ringan</span>'
            + (store.sekolah ? '<span>' + esc(store.sekolah) + '</span>' : '')
            + '<h2>' + esc(title) + '</h2></div>';
    }
    function repId(extra) {
        var idn = syncIdentity();
        return '<table class="hub-rep-id"><tbody>'
            + '<tr><th>Nama siswa</th><td>' + esc(store.nama || '—') + '</td><th>Kelas</th><td>' + esc(store.kelas || '—') + '</td></tr>'
            + (idn && idn.nis ? '<tr><th>NIS</th><td>' + esc(idn.nis) + '</td><th>Akun</th><td>' + esc(idn.username) + '</td></tr>' : '')
            + '<tr><th>Tanggal</th><td>' + fmtDate(now()) + '</td><th>KKM</th><td>' + KKM + '</td></tr>'
            + (extra || '') + '</tbody></table>';
    }
    /* tanda tangan: siswa · guru · (opsional) orang tua */
    function repSign(extraRole) {
        syncIdentity();
        var names = ['Siswa/i', extraRole || 'Guru Mapel'];
        return '<div class="hub-rep-sign">' + names.map(function (n) {
            var who = n === 'Siswa/i' ? (store.nama || '( ………………… )') : '( ………………… )';
            return '<div><span>' + esc(n) + '</span><b>' + esc(who) + '</b><i>( ………………… )</i></div>';
        }).join('') + '</div>';
    }
    function printProgress() {
        var s = summary();
        var dv = dims();
        var head = $('hub-print-head');
        if (!head) { head = D.createElement('div'); head.id = 'hub-print-head'; $('hub-progress').prepend(head); }
        var doneMat = MATERI.filter(function (m) { return matStatus(m.id) === 'paham'; }).length;
        var doneJs = JOBS.filter(function (j) { return jsStatus(j.id) === 'selesai'; });
        var doneCase = CASES.filter(function (c) { return store.diag[c.id] && store.diag[c.id].selesai; });
        var doneQuiz = QUIZZES.filter(function (q) { return store.quiz[q.id] && store.quiz[q.id].best >= KKM; });
        head.innerHTML = repKop('Laporan Progres Belajar')
            + repId('<tr><th>Progres</th><td><b>' + s.overall + '%</b></td><th>Level</th><td>' + esc(levelOf(s.overall).t) + '</td></tr>')
            + '<h3 class="hub-rep-h3">A. Evaluasi per dimensi</h3>'
            + '<table class="hub-dim-print"><thead><tr><th>Dimensi</th><th>Skor</th><th>Selesai</th><th>Menguasai</th></tr></thead><tbody>'
            + dv.map(function (d) {
                return '<tr><td>' + esc(d.label) + '</td><td><b>' + (d.score == null ? '—' : d.score) + '</b></td><td>' + esc(d.done.replace('Selesai: ', '')) + '</td><td>' + esc(d.master.replace('Menguasai: ', '')) + '</td></tr>';
            }).join('') + '</tbody></table>'
            + '<h3 class="hub-rep-h3">B. Rincian capaian</h3>'
            + '<table class="hub-dim-print hub-rep-detail"><thead><tr><th>Bidang</th><th>Kegiatan</th><th>Nilai / skor</th><th>Status</th></tr></thead><tbody>'
            + '<tr><td rowspan="' + (MATERI.length + 1) + '">Materi</td><td>Total dibaca/paham</td><td>' + doneMat + '/' + MATERI.length + '</td><td>' + (doneMat === MATERI.length ? 'Tuntas' : 'Berjalan') + '</td></tr>'
            + MATERI.map(function (m) { var st = matStatus(m.id), r = store.materi[m.id]; return '<tr><td>' + pad2(m.id) + ' ' + esc(m.title) + '</td><td>' + (st === 'paham' ? (r.cek != null ? 'Cek ' + r.cek : '100') : '—') + '</td><td>' + (st === 'paham' ? 'Paham' : st === 'dibuka' ? 'Dibuka' : 'Belum') + '</td></tr>'; }).join('')
            + '<tr><td rowspan="' + (JOBS.length + 1) + '">Job sheet</td><td>Total selesai</td><td>' + doneJs.length + '/' + JOBS.length + '</td><td>' + (doneJs.length === JOBS.length ? 'Tuntas' : 'Berjalan') + '</td></tr>'
            + JOBS.map(function (j) { var r = store.js[j.id], st = jsStatus(j.id); return '<tr><td>' + j.id + ' ' + esc(j.title) + '</td><td>' + (r && r.selesai ? r.nilai : '—') + '</td><td>' + (st === 'selesai' ? 'Selesai' : st === 'proses' ? 'Proses' : 'Belum') + '</td></tr>'; }).join('')
            + '<tr><td rowspan="' + (CASES.length + 1) + '">Diagnosis</td><td>Total kasus selesai</td><td>' + doneCase.length + '/' + CASES.length + '</td><td>' + (doneCase.length === CASES.length ? 'Tuntas' : 'Berjalan') + '</td></tr>'
            + CASES.map(function (c) { var r = store.diag[c.id]; return '<tr><td>' + c.id + ' ' + esc(c.judul) + '</td><td>' + (r && r.selesai ? r.skor : '—') + '</td><td>' + (r && r.selesai ? 'Selesai' : r && r.tests && r.tests.length ? 'Proses' : 'Belum') + '</td></tr>'; }).join('')
            + '<tr><td rowspan="' + (QUIZZES.length + 1) + '">Kuis</td><td>Total lulus KKM</td><td>' + doneQuiz.length + '/' + QUIZZES.length + '</td><td>' + (doneQuiz.length === QUIZZES.length ? 'Tuntas' : 'Berjalan') + '</td></tr>'
            + QUIZZES.map(function (q) { var r = store.quiz[q.id]; return '<tr><td>' + esc(q.title) + '</td><td>' + (r ? r.best : '—') + '</td><td>' + (r ? (r.best >= KKM ? 'Lulus' : 'Remedial') : 'Belum') + '</td></tr>'; }).join('')
            + '</tbody></table>'
            + '<h3 class="hub-rep-h3">C. Catatan &amp; tanda tangan</h3>'
            + '<p class="hub-rep-note">Progres dihitung dari bukti nyata yang tersimpan di aplikasi (materi, job sheet, kasus diagnosis, kuis). Skor dimensi &lt; ' + KKM + ' perlu penguatan.</p>'
            + repSign();
        D.body.classList.add('hub-print-prog'); window.print(); setTimeout(function () { D.body.classList.remove('hub-print-prog'); }, 500);
    }
    function resetAll() {
        if (!confirm('Hapus SEMUA progres (materi, job sheet, diagnosis, kuis)? Tindakan ini tidak dapat dibatalkan.')) return;
            var keep = { nama: store.nama, kelas: store.kelas, sekolah: store.sekolah };
            store = blank(); store.nama = keep.nama; store.kelas = keep.kelas; store.sekolah = keep.sekolah;
        save(); renderProgress(); toast('Progres direset.');
    }

    /* ============================================================
       8. BERANDA — hero, jalur belajar, rekomendasi berikutnya
       ============================================================ */
    function anyJs(pred) {
        return JOBS.some(function (j) { var r = store.js[j.id]; return r && pred(r); });
    }
    function pathSteps() {
        var s = summary();
        return [
            { label: 'LIHAT', page: '3d', text: 'Amati bentuk & gerakan komponen di 3D Lab.', done: !!store.visited['3d'] },
            { label: 'PAHAMI', page: 'materi', text: 'Baca modul 01–14 dan tandai “Paham”.', done: s.mDone > 0 },
            { label: 'COBA', page: 'simulator', text: 'Operasikan kunci kontak OFF → ON → START.', done: !!store.visited['simulator'] },
            { label: 'UKUR', page: 'praktik', text: 'Ukur tegangan, tahanan, dan voltage drop.', done: s.p3.done > 0 || anyJs(function (r) { return !!(r.hasil && String(r.hasil).trim()) || (r.steps && r.steps.some(Boolean)); }) },
            { label: 'ANALISIS', page: 'jobsheet', text: 'Bandingkan hasil ukur dengan acuan normal.', done: anyJs(function (r) { return !!r.selesai; }) },
            { label: 'DIAGNOSIS', page: 'diagnosis', text: 'Pecahkan kasus kerusakan berbasis bukti.', done: s.dDone > 0 },
            { label: 'EVALUASI', page: 'evaluasi', text: 'Kerjakan kuis, capai KKM ' + KKM + '.', done: s.qPass > 0 }
        ];
    }
    function recommend() {
        var nextM = MATERI.find(function (m) { return matStatus(m.id) !== 'paham'; });
        var nextJ = JOBS.find(function (j) { var r = store.js[j.id]; return !(r && r.selesai); });
        var nextD = CASES.find(function (c) { var r = store.diag[c.id]; return !(r && r.selesai); });
        var nextQ = QUIZZES.find(function (q) { var r = store.quiz[q.id]; return !(r && r.best >= KKM); });
        if (!store.visited['3d']) return { label: 'Jelajahi komponen di 3D Lab', run: function () { go('3d'); } };
        if (nextM) return { label: 'Modul ' + pad2(nextM.id) + ': ' + nextM.title, run: function () { go('materi-baca', nextM.id); } };
        if (!store.visited['simulator']) return { label: 'Coba Simulator Sistem Starter', run: function () { go('simulator'); } };
        if (nextJ) return { label: 'Job sheet ' + nextJ.id + ': ' + nextJ.title, run: function () { go('jobsheet-detail', nextJ.id); } };
        if (nextD) return { label: 'Kasus ' + nextD.id + ': ' + nextD.judul, run: function () { go('diagnosis-kasus', nextD.id); } };
        if (nextQ) return { label: 'Kuis ' + nextQ.title, run: function () { go('kuis', nextQ.id); } };
        return { label: 'Semua tuntas — ulangi evaluasi', run: function () { go('evaluasi'); } };
    }
    function startNext() { recommend().run(); }
    function renderHomeExtras() {
        var host = $('hub-home'), pathHost = $('hub-path');
        var s = summary(), l = levelOf(s.overall);
        if (host) {
            var rec = recommend(), started = s.overall > 0 || !!store.visited['3d'];
            host.innerHTML = '<section class="hub-hero">'
                + '<div class="hub-hero-main">'
                + '<div class="hub-kicker">LABORATORIUM VIRTUAL SISTEM STARTER</div>'
                + '<h2>Belajar sistem starter dari nol, langkah demi langkah</h2>'
                + '<p class="hub-hero-sub">Kenali komponen dan rangkaian, coba di simulator, lakukan pengukuran, lalu latih diagnosis berbasis bukti — semua dari browser.</p>'
                + '<div class="hub-next"><span class="hub-next-ico" aria-hidden="true">' + ICON.play + '</span>'
                + '<div class="hub-next-txt"><span class="hub-next-kicker">' + (started ? 'LANJUTKAN BELAJAR' : 'MULAI DARI SINI') + '</span><b>' + esc(rec.label) + '</b></div>'
                + '<button class="hub-btn primary" onclick="StarterHub.startNext()">' + (started ? 'Lanjut' : 'Mulai Belajar') + '</button></div>'
                + '<div class="hub-try-row"><button class="hub-btn ghost" onclick="StarterHub.go(\'panduan\')">Panduan penggunaan</button></div>'
                + '<div class="hub-hero-parts" aria-hidden="true"><img src="images/aki.webp" alt="" width="378" height="348" loading="lazy" decoding="async"><img src="images/relay.webp" alt="" width="267" height="420" loading="lazy" decoding="async"><img src="images/selenoid.webp" alt="" width="599" height="300" loading="lazy" decoding="async"><img src="images/motor-starter.webp" alt="" width="346" height="344" loading="lazy" decoding="async"></div>'
                + '</div>'
                + '<div class="hub-hero-side"><div class="hub-home-ring">' + ring(s.overall) + '</div>'
                + '<div class="hub-kicker">PROGRES ANDA · LEVEL ' + l.n + '</div><div class="hub-hero-level">' + esc(l.t) + '</div>'
                + '<p class="hub-muted">Materi ' + s.mDone + '/' + MATERI.length + ' · Job sheet ' + s.jDone + '/' + JOBS.length + ' · Kasus ' + s.dDone + '/' + CASES.length + ' · Kuis lulus ' + s.qPass + '/' + QUIZZES.length + '</p>'
                + '</div></section>';
        }
        if (pathHost) {
            var steps = pathSteps(), cur = steps.findIndex(function (x) { return !x.done; });
            pathHost.innerHTML = '<ol class="hub-path">' + steps.map(function (st, i) {
                var cls = st.done ? 'is-done' : (i === cur ? 'is-current' : 'is-todo');
                return '<li class="hub-path-step ' + cls + '"><a href="#/' + st.page + '"><span class="hub-path-no">' + (st.done ? ICON.check : (i + 1)) + '</span><b>' + st.label + '</b><small>' + esc(st.text) + '</small></a></li>';
            }).join('') + '</ol>';
        }
    }

    /* ============================================================
       9. PANDUAN
       ============================================================ */
    var GUIDE = [
        { id: 'mulai', t: 'Mulai cepat', html: '<p>Simulator ini adalah laboratorium virtual sistem starter. Ikuti alur belajar berikut agar hasilnya maksimal:</p><ol class="hub-flow"><li><b>Materi</b><span>Baca modul 01–14, tandai “Paham”.</span></li><li><b>Simulator</b><span>Operasikan kunci kontak & amati.</span></li><li><b>3D Lab</b><span>Lihat bentuk & gerakan komponen.</span></li><li><b>Praktik / Job Sheet</b><span>Ukur dengan multimeter, isi lembar kerja.</span></li><li><b>Diagnosis</b><span>Pecahkan studi kasus kerusakan.</span></li><li><b>Evaluasi</b><span>Kerjakan kuis, capai KKM 75.</span></li><li><b>Progres</b><span>Pantau capaian & cetak laporan.</span></li></ol><p>Semua progres tersimpan otomatis di browser yang Anda pakai.</p>' },
        { id: 'navigasi', t: 'Navigasi', html: '<ul class="hub-list"><li>Menu utama ada di sisi kiri. Di layar HP, tekan tombol <b>☰</b> di kiri atas untuk membuka menu.</li><li>Materi, job sheet, studi kasus, dan kuis terbuka di <b>halaman tersendiri</b>. Kembali dengan tombol <b>Kembali</b>, tautan di bagian atas (mis. “Materi › Modul 03”), atau tombol back browser.</li><li>Kotak <b>LEVEL</b> di bawah menu menunjukkan level dan persentase progres Anda. Klik untuk membuka halaman Progres.</li></ul>' },
        { id: 'materi', t: 'Materi', html: '<ol class="hub-steps"><li><span>Buka menu <b>Materi</b>, pilih modul (disarankan berurutan dari Modul 01).</span></li><li><span>Baca tujuan, isi materi, tabel, dan poin penting.</span></li><li><span>Jawab <b>Cek pemahaman</b> di akhir materi.</span></li><li><span>Klik <b>Paham</b> bila sudah mengerti → progres materi bertambah.</span></li><li><span>Klik <b>Lanjut Materi Berikutnya</b> untuk modul selanjutnya, atau <b>Kembali</b> ke daftar.</span></li></ol><p>Tombol di bagian “Praktikkan” membawa Anda langsung ke Simulator, 3D Lab, atau job sheet yang sesuai.</p>' },
        { id: 'simulator', t: 'Simulator', html: '<div class="hub-table-wrap"><table class="hub-table"><thead><tr><th>Bagian</th><th>Cara pakai</th></tr></thead><tbody>'
            + '<tr><td>Kunci kontak</td><td>Klik <b>OFF → ON → START</b>. START bersifat sementara seperti kunci asli; lepaskan untuk kembali ke ON.</td></tr>'
            + '<tr><td>Tahap kerja</td><td>Baris REST → IGN → RELAY → SOL → PINION → CRANK → RUN menunjukkan tahap yang sedang aktif.</td></tr>'
            + '<tr><td>Panel instrumen & gauges</td><td>Tegangan battery, arus starter, rpm starter & mesin, serta status komponen.</td></tr>'
            + '<tr><td>Aliran arus</td><td>Nyalakan untuk melihat animasi aliran arus pada diagram.</td></tr>'
            + '<tr><td>Fault</td><td>Pilih kerusakan (battery lemah, fuse putus, relay rusak, dll.), klik terapkan, lalu amati gejala.</td></tr>'
            + '<tr><td>MULTI (multimeter)</td><td>Pilih mode (V DC, Ω, kontinuitas, V DROP), pilih probe merah lalu klik titik ukur, pilih probe hitam lalu klik titik ukur kedua. Hasil tampil di layar multimeter.</td></tr>'
            + '<tr><td>DIAG</td><td>Lab diagnosis lanjutan dengan hipotesis, bukti, perbaikan, dan verifikasi.</td></tr>'
            + '<tr><td>TECH / BASIC / LOG / REC / CSV</td><td>Data teknis, mode tampilan, catatan kejadian, rekam & ekspor data.</td></tr>'
            + '<tr><td>Reset</td><td>Mengembalikan simulator ke kondisi normal dan menghapus kerusakan.</td></tr></tbody></table></div>'
            + '<div class="hub-callout warn">' + ICON.warn + '<div><h3>Keselamatan</h3><p>Seperti di bengkel, pengukuran tahanan (Ω) hanya boleh saat sistem OFF. Simulator akan memperingatkan bila prosedur salah.</p></div></div>' },
        { id: '3d', t: '3D Lab', html: '<div class="hub-table-wrap"><table class="hub-table"><thead><tr><th>Kontrol</th><th>Fungsi</th></tr></thead><tbody>'
            + '<tr><td>Klik + geser</td><td>Memutar model ke segala arah.</td></tr><tr><td>Scroll / cubit 2 jari</td><td>Zoom.</td></tr><tr><td>Klik kanan / Shift + geser</td><td>Menggeser tampilan.</td></tr><tr><td>Klik komponen</td><td>Menampilkan informasi komponen. Klik dobel untuk mendekat.</td></tr>'
            + '<tr><td>TAMPILAN</td><td><b>Normal</b>, <b>Cutaway</b> (dipotong agar isi terlihat), <b>Exploded</b> (komponen diurai).</td></tr>'
            + '<tr><td>SISTEM</td><td><b>Electrical</b> (fokus kelistrikan & aliran arus), <b>Mechanical</b> (fokus gerak mekanis), <b>Combined</b>, <b>Synchronized</b> (tahap kerja ditampilkan bersama simulator).</td></tr>'
            + '<tr><td>MODE</td><td><b>Teaching</b> (tur terpandu langkah demi langkah), <b>Explore</b> (bebas), <b>Pause 3D</b>, <b>Pause Sim</b>, <b>Reset</b>.</td></tr>'
            + '<tr><td>PENGATURAN</td><td>Kualitas grafis, Mode hemat (untuk komputer lambat), Label, Suara, Debug.</td></tr>'
            + '<tr><td>Model asli (.glb)</td><td>Klik <b>MUAT MODEL ASLI</b> untuk membuka file 3D motor starter (.glb) hasil unduhan, atau letakkan file di folder <code>models/starter-motor.glb</code> agar dimuat otomatis.</td></tr></tbody></table></div>' },
        { id: 'praktik', t: 'Praktik & Job Sheet', html: '<ol class="hub-steps"><li><span>Buka <b>Praktik</b> atau <b>Job Sheet</b>, pilih lembar kerja.</span></li><li><span>Baca tujuan, alat, dan K3.</span></li><li><span>Klik <b>Buka Simulator & Multimeter</b>, lakukan pengukuran, lalu kembali.</span></li><li><span>Centang setiap langkah kerja yang sudah dilakukan.</span></li><li><span>Isi hasil pengukuran (atau klik <b>Ambil nilai dari multimeter</b>), jawab pertanyaan, isi kesimpulan.</span></li><li><span>Klik <b>Selesai & Kirim</b>. Nilai muncul dan tercatat di Progres. Gunakan <b>Cetak</b> untuk laporan kertas.</span></li></ol>' },
        { id: 'diagnosis', t: 'Diagnosis', html: '<ol class="hub-steps"><li><span>Pilih studi kasus (filter Mudah / Sedang / Sulit).</span></li><li><span>Baca keluhan pelanggan dan gejala.</span></li><li><span><b>Langkah 1:</b> pilih pemeriksaan. Bandingkan hasil dengan kolom <b>Acuan normal</b>.</span></li><li><span><b>Langkah 2:</b> pilih penyebab kerusakan dan tulis alasannya, lalu <b>Kirim diagnosis</b>.</span></li><li><span>Pelajari pembahasan, bukti kunci, dan langkah perbaikan.</span></li></ol><p><b>Skor:</b> mulai 100; petunjuk −5, diagnosis salah −10, bukti kunci belum diperiksa −10, pemeriksaan berlebih −2. Tombol <b>Simulasikan gejala</b> menerapkan kerusakan yang sama di Simulator.</p>' },
        { id: 'evaluasi', t: 'Evaluasi', html: '<ul class="hub-list"><li>Tersedia 5 kuis per kelompok materi dan 1 ujian akhir (25 soal).</li><li>Soal tampil satu per satu secara berurutan, pilihan A–D. Setelah memilih jawaban, soal berikutnya terbuka otomatis.</li><li>Gunakan tombol <b>Sebelumnya</b>/<b>Berikutnya</b> atau nomor soal untuk berpindah.</li><li>Klik <b>Selesai & Kirim</b> untuk melihat nilai dan pembahasan. KKM = 75. Nilai terbaik yang disimpan.</li></ul>' },
        { id: 'progres', t: 'Progres', html: '<ul class="hub-list"><li>Progres keseluruhan = rata-rata dari Materi, Praktik/Job Sheet, Diagnosis, dan Evaluasi (masing-masing 25%).</li><li>Isi nama & kelas, lalu klik <b>Cetak laporan</b> untuk dikumpulkan ke guru.</li><li>Data tersimpan di browser. Jangan gunakan mode penyamaran (incognito) dan gunakan browser yang sama agar progres tidak hilang.</li></ul>' },
        { id: 'guru', t: 'Tips untuk guru', html: '<ul class="hub-list"><li>Jalankan dari folder lokal atau server sederhana (<code>python -m http.server</code>) — tidak butuh internet.</li><li>Gunakan studi kasus Diagnosis sebagai tugas; siswa mencetak laporan Progres atau job sheet.</li><li>Untuk demonstrasi kelas, pakai 3D Lab → MODE <b>Teaching</b> dan <b>Putar Otomatis</b>.</li><li>Ingin model 3D asli? Unduh file .glb motor starter (mis. dari Sketchfab dengan lisensi yang mengizinkan), simpan sebagai <code>models/starter-motor.glb</code>.</li><li><b>Reset progres</b> di halaman Progres untuk siswa berikutnya pada komputer yang sama.</li></ul>' },
        { id: 'faq', t: 'Masalah umum', html: '<div class="hub-faq">'
            + '<details><summary>3D Lab hanya menampilkan gambar 2D</summary><p>Perangkat/browser tidak mendukung WebGL. Aktifkan akselerasi perangkat keras di pengaturan browser, atau gunakan Chrome/Edge terbaru.</p></details>'
            + '<details><summary>3D Lab terasa lambat</summary><p>Ubah kualitas ke LOW atau centang MODE HEMAT di bagian PENGATURAN.</p></details>'
            + '<details><summary>Progres hilang</summary><p>Progres tersimpan di penyimpanan lokal browser. Data hilang bila cache/riwayat dihapus, memakai mode penyamaran, atau berganti browser/komputer.</p></details>'
            + '<details><summary>Model asli (.glb) tidak termuat otomatis</summary><p>Pemuatan otomatis memerlukan server lokal (bukan dibuka dengan klik ganda). Gunakan tombol MUAT MODEL ASLI untuk memilih file secara manual.</p></details>'
            + '<details><summary>Multimeter tidak menampilkan angka</summary><p>Pastikan mode sudah dipilih dan kedua probe (merah & hitam) sudah dipasang pada titik ukur. Untuk Ω, matikan sistem terlebih dahulu.</p></details>'
            + '</div>' }
    ];
    function renderPanduan() {
        var el = $('hub-panduan');
        if (!el || el._done) return;
        el._done = true;
        el.innerHTML = '<div class="hub-guide"><aside class="hub-guide-toc"><div class="hub-aside-title">Daftar isi</div><ol>' + GUIDE.map(function (g, i) { return '<li><a href="javascript:void(0)" onclick="StarterHub.guideTo(\'' + g.id + '\')"><span>' + (i + 1) + '</span>' + esc(g.t) + '</a></li>'; }).join('') + '</ol></aside>'
            + '<div class="hub-guide-body">' + GUIDE.map(function (g, i) { return '<section class="hub-box hub-guide-sec" id="guide-' + g.id + '"><h3><span class="hub-stepno">' + (i + 1) + '</span> ' + esc(g.t) + '</h3>' + g.html + '</section>'; }).join('') + '</div></div>';
    }
    function guideTo(id) { var e = $('guide-' + id); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

    /* ============================================================
       10. INIT
       ============================================================ */
    function init() {
        window.navigateTo = navigateWrapped;
        window.addEventListener('hashchange', route);
        // pertahankan fungsi lama agar halaman lama tetap konsisten
        window.renderPraktik = renderPraktik;
        updateLevelBadge();
        syncLegacy();
        if (location.hash && location.hash.length > 2) route(); else { renderHomeExtras(); }
    }

    window.StarterHub = {
        go: go, route: route, summary: summary, dims: dims, startNext: startNext, getStore: function () { return store; },
        answerCheck: answerCheck, togglePaham: togglePaham, nextMateri: nextMateri, materiAction: materiAction,
        jsStep: jsStep, jsField: jsField, jsAnswer: jsAnswer, jsCrit: jsCrit, jsSaveDraft: jsSaveDraft, jsSubmit: jsSubmit, jsFromMeter: jsFromMeter, printJob: printJob, openSimulator: openSimulator,
        diagFilter: setDiagFilter, runTest: runTest, pickCause: pickCause, diagReason: diagReason, caseHint: caseHint, submitCase: submitCase, resetCase: resetCase, trySim: trySim,
        qAnswer: qAnswer, qMove: qMove, qJump: qJump, qExit: qExit, qFinish: qFinish, qRetry: qRetry,
        setProfile: setProfile, printProgress: printProgress, resetAll: resetAll, guideTo: guideTo
    };

    if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})();
