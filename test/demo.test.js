/* DEMO TEST - tombol Coba Demo, batas 5 kali, isolasi data. Run: node test/demo.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.log('  FAIL: ' + m); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeEl(id) {
    const el = { id, innerHTML: '', value: '', textContent: '', disabled: false, style: {}, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}, setAttribute(k, v) { el[k] = v; }, getAttribute(k) { return el[k] === undefined ? null : el[k]; } };
    return el;
}
/* mode 'login' = halaman login; mode 'app' = halaman simulator (ada #au-dashboard) */
function boot(mode, o) {
    o = o || {};
    const ls = o.ls || {}, ss = o.ss || {};
    const byId = {};
    const host = makeEl(mode === 'login' ? 'au-login' : 'au-dashboard');
    if (mode === 'login') host['data-portal'] = o.portal || 'general';
    byId[host.id] = host;
    if (mode === 'app') byId['au-account'] = makeEl('au-account');
    const store = (o) => ({ getItem: (k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: (k) => { delete o[k]; } });
    const listeners = {}, docL = {};
    const ctx = {
        console, setTimeout, clearTimeout, Math, Date, JSON, parseInt, parseFloat, String, Number, Object, Array, RegExp, isNaN, Promise,
        document: { readyState: 'complete', body: makeEl('body'), getElementById: (id) => byId[id] || null, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return makeEl(); }, addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); } },
        localStorage: store(ls), sessionStorage: o.noSessionStorage ? undefined : store(ss),
        location: { href: '', hash: '', replace(u) { this.href = u; } },
        CustomEvent: function (t, i) { this.type = t; this.detail = i && i.detail; },
        addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); }, dispatchEvent() { return true; }
    };
    ctx.window = ctx; ctx.globalThis = ctx; ctx.STARTERLAB_ROSTER = Array.from({ length: 36 }, (_, i) => 'Siswa Uji ' + String(i + 1).padStart(2, '0')); /* roster uji (nama netral) */
    ctx.ProgressApi = o.progressApi === undefined ? null : o.progressApi;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'instructorPlatform.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'authUI.js'), 'utf8'), ctx);
    return { ctx, ls, ss, host, P8: ctx.Phase8, listeners: docL };
}
const form = (u, p) => ({ username: { value: u }, password: { value: p }, querySelector: () => null });


(async function () {
    console.log('DEMO TEST');
    const LS_DEMO = 'starterLab_demo_v1';
    const SS = 'starterSim_auth_session_v1';
    let clears = 0;
    const pa = { clearAuth() { clears++; } };

    /* D1 tombol demo tampil di halaman login umum dengan sisa 5 */
    const ls = {};
    let a = boot('login', { ls, progressApi: pa });
    assert(a.host.innerHTML.indexOf('data-au-demo') >= 0, 'D1 tombol Coba Demo tampil di halaman login');
    assert(a.host.innerHTML.indexOf('<b>5</b> dari 5') >= 0, 'D1b sisa akses demo 5 dari 5');
    const usersBefore = a.P8.repositories.userRepository.list().length;

    /* D2 memulai demo -> sesi demo, ke aplikasi, hitungan 1 */
    a.ctx.AuthUI.startDemo();
    const sess = a.ss[SS] ? JSON.parse(a.ss[SS]) : null;
    assert(sess && sess.demo === true && sess.role === 'STUDENT', 'D2 sesi demo (siswa, demo:true) dibuat');
    assert(a.ctx.location.href === 'index.html', 'D2b demo diarahkan ke aplikasi');
    assert(JSON.parse(ls[LS_DEMO]).count === 1, 'D2c hitungan demo = 1');
    assert(clears >= 1, 'D2d token server dibersihkan (demo tidak tersinkron ke server)');

    /* D3 akun demo tersembunyi dari daftar pengguna, tetapi sesi tetap valid */
    const R = a.P8.repositories.userRepository;
    assert(R.list().length === usersBefore && !R.list().some((u) => u.isDemo), 'D3 akun demo tidak muncul di daftar pengguna');
    assert(R.getById('USER_DEMO') && R.getById('USER_DEMO').isDemo === true, 'D3b akun demo tetap bisa dibaca via getById');
    assert(!R.query(() => true).some((u) => u.isDemo), 'D3c query() juga menyembunyikan akun demo');

    /* D4 muat ulang di tab yang sama (halaman aplikasi) tidak menambah hitungan */
    const app = boot('app', { ls, ss: a.ss, progressApi: pa });
    assert(JSON.parse(ls[LS_DEMO]).count === 1, 'D4 muat ulang tidak menambah hitungan');
    assert(app.ctx.AuthUI.identity() && app.ctx.AuthUI.identity().username === '__demo_starterlab__', 'D4b sesi demo dikenali di halaman aplikasi');

    /* D5 data belajar demo selalu mulai bersih */
    ls['starterSim_data_owner_v1'] = 'u:__demo_starterlab__';
    ls['starterHub_v1'] = '{"sisa":"data demo lama"}';
    const b = boot('login', { ls, progressApi: pa });
    b.ctx.AuthUI.startDemo();
    assert(ls['starterHub_v1'] === undefined, 'D5 data belajar demo sebelumnya dibersihkan');
    assert(JSON.parse(ls[LS_DEMO]).count === 2, 'D5b hitungan demo = 2');

    /* D6 data akun asli tidak hilang: dititipkan lalu dipulihkan */
    const ls2 = { starterSim_data_owner_v1: 'u:budi', starterHub_v1: '{"nilai":"milik budi"}' };
    const c = boot('login', { ls: ls2, progressApi: pa });
    c.ctx.AuthUI.startDemo();
    assert(ls2['starterSim_data_stash_v1_u:budi'] && ls2['starterSim_data_stash_v1_u:budi'].indexOf('milik budi') >= 0, 'D6 data akun asli dititipkan (stash) saat demo');
    assert(ls2['starterHub_v1'] === undefined, 'D6b demo tidak melihat data akun asli');

    /* D7 batas 5 kali: ke-1..5 berhasil (ke-1 sudah), ke-6 ditolak */
    const ls3 = {};
    let ok = 0;
    for (let i = 0; i < 5; i++) {
        const t = boot('login', { ls: ls3, progressApi: pa });
        t.ctx.AuthUI.startDemo();
        if (t.ss[SS] && JSON.parse(t.ss[SS]).demo) ok++;
    }
    assert(ok === 5, 'D7 lima kali demo berhasil (' + ok + ')');
    assert(JSON.parse(ls3[LS_DEMO]).count === 5, 'D7b hitungan = 5');
    const t6 = boot('login', { ls: ls3, progressApi: pa });
    assert(t6.host.innerHTML.indexOf('disabled') >= 0 && t6.host.innerHTML.indexOf('sudah tercapai') >= 0, 'D7c tombol demo nonaktif + pesan batas tercapai');
    t6.ctx.AuthUI.startDemo();
    assert(!t6.ss[SS], 'D7d demo ke-6 ditolak: tidak ada sesi');
    assert(JSON.parse(ls3[LS_DEMO]).count === 5, 'D7e hitungan tidak bertambah setelah batas');
    assert(t6.host.innerHTML.indexOf('Batas akses demo') >= 0, 'D7f pesan batas tampil');

    /* D8 portal Superadmin tidak punya tombol demo */
    const sa = boot('login', { portal: 'superadmin', progressApi: pa });
    assert(sa.host.innerHTML.indexOf('data-au-demo') < 0, 'D8 portal Superadmin tanpa tombol demo');

    /* D9 nilai hitungan rusak tidak membuka batas */
    const ls4 = { [LS_DEMO]: '{"count":"abc"}' };
    const d = boot('login', { ls: ls4, progressApi: pa });
    d.ctx.AuthUI.startDemo();
    assert(JSON.parse(ls4[LS_DEMO]).count === 1, 'D9 hitungan rusak dianggap 0 lalu naik jadi 1');

    console.log('=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
    process.exit(failed ? 1 : 0);
})();
