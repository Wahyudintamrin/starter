/* ============================================================
   HUB TEST — Beranda (hero + jalur belajar) & routing dasar
   Menjalankan learningHub-data.js + learningHub.js di VM dengan
   mock DOM/localStorage. Tidak mengubah engine simulasi.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.log('  FAIL: ' + msg); } }
function assert(cond, msg) { ok(!!cond, msg); }

/* ---------- DOM mock ---------- */
function makeEl(id) {
    const el = {
        id: id || '', tagName: 'DIV', _cls: new Set(), style: {},
        innerHTML: '', textContent: '', value: '', title: '', disabled: false,
        children: [], onclick: null, onchange: null,
        appendChild(c) { el.children.push(c); return c; },
        prepend(c) { el.children.unshift(c); return c; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {}, removeEventListener() {},
        scrollIntoView() {}, focus() {}, blur() {},
        click() { if (typeof el.onclick === 'function') el.onclick(); },
        setAttribute(k, v) { el[k] = v; },
        getAttribute(k) { return el[k]; },
        removeAttribute(k) { delete el[k]; },
        hasAttribute(k) { return k in el; }
    };
    Object.defineProperty(el, 'className', {
        get() { return Array.from(el._cls).join(' '); },
        set(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    });
    Object.defineProperty(el, 'classList', {
        value: {
            add: (...c) => c.forEach(x => el._cls.add(x)),
            remove: (...c) => c.forEach(x => el._cls.delete(x)),
            contains: c => el._cls.has(c),
            toggle: (c, f) => { if (f === undefined) f = !el._cls.has(c); f ? el._cls.add(c) : el._cls.delete(c); return f; }
        }
    });
    return el;
}

const byId = {};
const documentMock = {
    readyState: 'complete',
    body: makeEl('body'),
    getElementById(id) { if (!byId[id]) byId[id] = makeEl(id); return byId[id]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { const e = makeEl(); e.tagName = String(tag || 'div').toUpperCase(); return e; },
    addEventListener() {}, removeEventListener() {}
};

const _ls = {};
const localStorageMock = {
    getItem: k => Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null,
    setItem: (k, v) => { _ls[k] = String(v); },
    removeItem: k => { delete _ls[k]; },
    clear: () => { for (const k in _ls) delete _ls[k]; }
};

const ctx = {
    console, setTimeout, clearTimeout, Math, Date, JSON, parseInt, parseFloat,
    String, Number, Object, Array, RegExp, isNaN,
    confirm: () => true, alert: () => {}, print: () => {},
    document: documentMock, localStorage: localStorageMock
};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.location = { _h: '', get hash() { return this._h; }, set hash(v) { this._h = v; } };
ctx.addEventListener = () => {}; ctx.scrollTo = () => {};

vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'learningHub-data.js'), 'utf8'), ctx, { filename: 'learningHub-data.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'learningJobSheets.js'), 'utf8'), ctx, { filename: 'learningJobSheets.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'learningHub.js'), 'utf8'), ctx, { filename: 'learningHub.js' });

const Hub = ctx.StarterHub;

console.log('HUB TEST — Beranda & jalur belajar');
assert(Hub && typeof Hub.route === 'function', 'StarterHub ter-expose dengan route()');
assert(typeof Hub.startNext === 'function', 'StarterHub.startNext() tersedia');

/* ---------- render beranda ---------- */
Hub.route();
const homeHTML = documentMock.getElementById('hub-home').innerHTML;
const pathHTML = documentMock.getElementById('hub-path').innerHTML;

assert(homeHTML.indexOf('hub-hero') >= 0, 'hero dirender (#hub-home)');
assert(homeHTML.indexOf('Mulai Belajar') >= 0, 'tombol "Mulai Belajar" ada');
assert(homeHTML.indexOf('hub-ring') >= 0, 'ring progres dirender');

['LIHAT', 'PAHAMI', 'COBA', 'UKUR', 'ANALISIS', 'DIAGNOSIS', 'EVALUASI'].forEach(function (s) {
    assert(pathHTML.indexOf(s) >= 0, 'jalur belajar memuat langkah ' + s);
});
assert(pathHTML.indexOf('<ol class="hub-path">') >= 0, 'jalur belajar memakai <ol class="hub-path">');
assert(pathHTML.indexOf('is-current') >= 0, 'ada langkah "current" saat progres kosong');

/* ---------- progres nyata mengubah jalur ---------- */
const st = Hub.getStore();
st.materi[1] = { paham: true };
Hub.route();
const pathHTML2 = documentMock.getElementById('hub-path').innerHTML;
assert(/is-done[\s\S]*?PAHAMI/.test(pathHTML2) || /PAHAMI[\s\S]*?is-done/.test(pathHTML2), 'PAHAMI ditandai selesai setelah materi dipahami');

/* ---------- markVisited di routing ---------- */
ctx.location.hash = '#/3d';
Hub.route();
assert(Hub.getStore().visited['3d'] === true, 'kunjungan 3D Lab tercatat (visited["3d"])');

/* ---------- startNext tidak melempar ---------- */
let threw = null;
try { Hub.startNext(); } catch (e) { threw = e; }
assert(!threw, 'startNext() berjalan tanpa error' + (threw ? ' (' + threw.message + ')' : ''));

/* ---------- reader materi: rangkuman, gejala, penyelesaian vs penguasaan ---------- */
ctx.location.hash = '#/materi-baca/1';
Hub.route();
const readerHTML = documentMock.getElementById('hub-reader').innerHTML;
assert(readerHTML.indexOf('Rangkuman') >= 0, 'reader menampilkan Rangkuman');
assert(readerHTML.indexOf('Poin penting') < 0, 'label lama "Poin penting" tidak lagi dipakai');
assert(readerHTML.indexOf('Contoh gejala') >= 0, 'reader menampilkan Contoh gejala kendaraan');
assert(readerHTML.indexOf('Penyelesaian') >= 0 && readerHTML.indexOf('Penguasaan') >= 0, 'reader membedakan penyelesaian vs penguasaan');

/* ---------- menjawab cek menandai penguasaan ---------- */
const stm = Hub.getStore();
const mod1 = ctx.HUB_MATERI.find(m => m.id === 1);
assert(stm.materi[1] && !stm.materi[1].cek, 'modul 1 belum lulus cek sebelum dijawab');
Hub.answerCheck(mod1.cek.jawab);
assert(Hub.getStore().materi[1].cek === true, 'jawaban benar menandai penguasaan (cek=true)');

/* ---------- job sheet: panduan satuan + analisis ---------- */
ctx.location.hash = '#/jobsheet-detail/JS-001';
Hub.route();
const jsHTML = documentMock.getElementById('hub-js-detail').innerHTML;
assert(jsHTML.indexOf('Panduan satuan') >= 0, 'job sheet menampilkan panduan satuan & mode');
assert(jsHTML.indexOf('F. Analisis') >= 0, 'job sheet punya bagian F. Analisis');
assert(jsHTML.indexOf('A DC') >= 0 && jsHTML.indexOf('V DROP') >= 0, 'panduan menyebut mode A DC dan V DROP');
assert(jsHTML.indexOf('H. Kesimpulan') >= 0 && jsHTML.indexOf('I. Penilaian diri') >= 0, 'penomoran bagian bergeser (H/I)');

/* ---------- job sheet arus (A DC) ---------- */
const js11 = ctx.LEARNING_JOB_SHEETS.find(j => j.id === 'JS-011');
assert(js11 && js11.expectedResult.mode === 'A', 'JS-011 (Pengukuran Arus Cranking, mode A) ada');
ctx.location.hash = '#/jobsheet-detail/JS-011';
Hub.route();
const js11HTML = documentMock.getElementById('hub-js-detail').innerHTML;
assert(js11HTML.indexOf('Pengukuran Arus Cranking') >= 0, 'JS-011 dirender dengan judul yang benar');
assert(js11HTML.indexOf('A DC') >= 0, 'JS-011 menyebut mode A DC');

/* ---------- diagnosis berbasis bukti ---------- */
const dg = ctx.HUB_DIAG_CASES[0];
ctx.location.hash = '#/diagnosis-kasus/' + dg.id;
Hub.route();
const ev0 = documentMock.getElementById('hub-evidence').innerHTML;
assert(ev0.indexOf('Bukti diagnosis') >= 0 && ev0.indexOf('bukti kunci') >= 0, 'panel bukti diagnosis dirender');

Hub.pickCause(dg.jawab);
Hub.runTest(dg.kunci[0]);
const ev1 = documentMock.getElementById('hub-evidence').innerHTML;
assert(ev1.indexOf('1/2') >= 0, 'bukti kunci tercatat di panel bukti (1/2)');

const fb1 = documentMock.getElementById('hub-diag-fb');
Hub.submitCase();
assert(fb1.innerHTML.indexOf('menebak') >= 0, 'kirim diagnosis tanpa alasan diblokir (... = menebak)');

Hub.diagReason('Tegangan diam 11,9 V dan saat cranking 8,4 V, voltage drop normal 0,2 V / 0,1 V.');
Hub.submitCase();
assert(!!Hub.getStore().diag[dg.id].selesai, 'diagnosis valid + alasan diisi = kasus selesai');

const rs = documentMock.getElementById('hub-diag-result').innerHTML;
assert(rs.indexOf('Bukti kunci') >= 0 && rs.indexOf('Langkah perbaikan') >= 0, 'hasil diagnosis menampilkan bukti kunci & langkah perbaikan');

/* ---------- Stage G: evaluasi per dimensi ---------- */
const dims = Hub.dims();
assert(Array.isArray(dims) && dims.length === 4, 'dims() mengembalikan 4 dimensi');
const dimKeys = dims.map(d => d.key).join(',');
assert(dimKeys === 'pengetahuan,keterampilan,diagnosa,sikap', 'urutan dimensi: pengetahuan, keterampilan, diagnosa, sikap');
dims.forEach(function (d) {
    assert(d.score == null || (typeof d.score === 'number' && d.score >= 0 && d.score <= 100), 'skor ' + d.key + ' bernilai null atau 0-100 (' + d.score + ')');
    assert(d.done.indexOf('Selesai:') === 0, d.key + ' membedakan baris "Selesai"');
    assert(d.master.indexOf('Menguasai:') === 0, d.key + ' membedakan baris "Menguasai"');
    assert(d.ev.length >= 2, d.key + ' punya >= 2 butir bukti nyata');
});
assert(dims[3].ev.join(' ').indexOf('K3') >= 0 || dims[3].ev.join(' ').indexOf('keselamatan') >= 0, 'dimensi sikap menyebut keselamatan/K3');

/* skor reaktif terhadap bukti belajar nyata */
const stg = Hub.getStore();
stg.quiz = { k1: { best: 90, attempts: 1 }, k2: { best: 80, attempts: 1 } };
stg.materi = {};
for (let i = 1; i <= 14; i++) stg.materi[i] = { paham: true, cek: i <= 10 };
const d2 = Hub.dims();
assert(d2[0].score >= 75 && d2[0].score <= 100, 'pengetahuan naik saat kuis+cek terpenuhi (' + d2[0].score + ')');
assert(d2[0].master.indexOf('10/14') >= 0, 'baris menguasai menampilkan jumlah modul lulus cek');
stg.quiz = {}; stg.materi = {};
const d3 = Hub.dims();
assert(d3[0].score !== d2[0].score, 'skor pengetahuan turun saat bukti dihapus');

/* progres menampilkan evaluasi per dimensi */
ctx.location.hash = '#/progres';
Hub.route();
const prHTML = documentMock.getElementById('hub-progress').innerHTML;
assert(prHTML.indexOf('Evaluasi per dimensi') >= 0, 'halaman Progres menampilkan evaluasi per dimensi');
assert(prHTML.indexOf('hub-dims') >= 0, 'grid dimensi dirender');
['Pengetahuan', 'Keterampilan ukur', 'Diagnosa', 'Sikap & K3'].forEach(function (t) {
    assert(prHTML.indexOf(t) >= 0, 'dimensi "' + t + '" tampil di Progres');
});
assert(prHTML.indexOf('Tuntas') >= 0 || prHTML.indexOf('Perlu penguatan') >= 0 || prHTML.indexOf('Belum ada bukti') >= 0, 'status tuntas/perlu penguatan tampil');
assert(/Selesai:/.test(prHTML) && /Menguasai:/.test(prHTML), 'Progres membedakan selesai vs menguasai');

/* laporan cetak memuat tabel dimensi */
Hub.printProgress();
const ph = documentMock.getElementById('hub-print-head').innerHTML;
assert(ph.indexOf('hub-dim-print') >= 0 && ph.indexOf('Dimensi') >= 0, 'cetak laporan memuat tabel dimensi');

/* ---------- Stage H: laporan cetak siap nilai kelas ---------- */
assert(ph.indexOf('SIMULATOR SISTEM STARTER') >= 0, 'laporan punya kop "SIMULATOR SISTEM STARTER"');
assert(ph.indexOf('Teknik Kendaraan Ringan') >= 0, 'kop menyebut program keahlian TKR');
assert(ph.indexOf('Laporan Progres Belajar') >= 0, 'judul laporan cetak ada');
assert(ph.indexOf('hub-rep-id') >= 0 && ph.indexOf('Nama siswa') >= 0 && ph.indexOf('Kelas') >= 0, 'identitas siswa/kelas di laporan');
assert(ph.indexOf('KKM') >= 0, 'laporan mencantumkan KKM');
assert(ph.indexOf('Rincian capaian') >= 0, 'laporan punya bagian rincian capaian');
['Materi', 'Job sheet', 'Diagnosis', 'Kuis'].forEach(function (t) {
    assert(ph.indexOf('>' + t + '<') >= 0, 'rincian memuat bidang ' + t);
});
assert(ph.indexOf('Catatan') >= 0, 'laporan punya catatan evaluasi');
assert(ph.indexOf('hub-rep-sign') >= 0 && ph.indexOf('Siswa/i') >= 0 && ph.indexOf('Guru Mapel') >= 0, 'laporan punya ruang tanda tangan siswa & guru');
assert(ph.indexOf('Selesai') >= 0 && ph.indexOf('Menguasai') >= 0, 'tabel dimensi tetap membedakan selesai vs menguasai');

/* identitas sekolah ikut tercetak */
stg.nama = 'Budi Santoso'; stg.kelas = 'XII TKR 1'; stg.sekolah = 'SMK Negeri 1 Contoh';
Hub.printProgress();
const ph2 = documentMock.getElementById('hub-print-head').innerHTML;
assert(ph2.indexOf('Budi Santoso') >= 0 && ph2.indexOf('XII TKR 1') >= 0, 'nama & kelas tercetak di laporan');
assert(ph2.indexOf('SMK Negeri 1 Contoh') >= 0, 'asal sekolah tampil di kop laporan');
assert(ph2.indexOf('Budi Santoso') >= 0, 'tanda tangan siswa memakai nama asli');

/* cetak job sheet: kop + nilai + tanda tangan */
ctx.location.hash = '#/jobsheet-detail/JS-001';
Hub.route();
Hub.printJob();
const jh = documentMock.getElementById('hub-js-print-head').innerHTML;
assert(jh.indexOf('Lembar Kerja Job Sheet JS-001') >= 0, 'cetak job sheet punya judul laporan');
assert(jh.indexOf('JS-001') >= 0 && jh.indexOf('Budi Santoso') >= 0, 'cetak job sheet memuat kode job sheet & identitas');
assert(jh.indexOf('Belum dinilai') >= 0, 'job sheet belum dinilai ditandai "Belum dinilai"');
assert(jh.indexOf('hub-rep-id') >= 0, 'cetak job sheet memuat tabel identitas');
const jt = documentMock.getElementById('hub-js-print-tail').innerHTML;
assert(jt.indexOf('hub-rep-sign') >= 0 && jt.indexOf('Siswa/i') >= 0 && jt.indexOf('Guru Mapel') >= 0, 'ekor cetak job sheet punya kolom tanda tangan ganda');

/* reset mempertahankan identitas */
Hub.resetAll();
const stR = Hub.getStore();
assert(stR.nama === 'Budi Santoso' && stR.kelas === 'XII TKR 1' && stR.sekolah === 'SMK Negeri 1 Contoh', 'reset progres mempertahankan nama/kelas/sekolah');
assert(Object.keys(stR.quiz).length === 0 && Object.keys(stR.materi).length === 0, 'reset menghapus bukti belajar');

console.log('=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed ? 1 : 0);
