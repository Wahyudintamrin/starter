/* ============================================================
   PORTAL TEST — login Superadmin terpisah, sinkron identitas
   siswa di Progres, dan pemisahan data progres per akun.
   Bagian A: server (RBAC portal)   Bagian B: authUI (VM + mock)
   Bagian C: learningHub (identitas)  Bagian D: HTTP link nyata
   Run: node test/portal.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.log('  FAIL: ' + msg); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- A. SERVER: portal login ---------------- */
const { openDb } = require(path.join(ROOT, 'backend', 'db.js'));
const seedMod = require(path.join(ROOT, 'backend', 'seed.js'));
const { api } = require(path.join(ROOT, 'backend', 'api.js'));
const fixtures = require('./fixtures');
const db = openDb(':memory:');
seedMod.seed(db);
fixtures.seedServer(db);   /* produk tidak membawa data contoh; fixture hanya untuk tes */
const service = api(db, {});
function srvLogin(username, password, portal) {
    const body = { username, password };
    if (portal) body.portal = portal;
    const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = String(b); } };
    service.login({ headers: {}, method: 'POST', url: '/api/v1/auth/login' }, res, body, {});
    let json = null; try { json = JSON.parse(res.body); } catch (e) { /* noop */ }
    return { status: res.status, json };
}

console.log('PORTAL TEST');
let r = srvLogin('superadmin', 'superadmin123', 'superadmin');
assert(r.status === 200 && r.json.data.user.role === 'ADMIN', 'A1 superadmin masuk lewat portal superadmin');
r = srvLogin('superadmin', 'superadmin123', 'general');
assert(r.status === 403 && r.json.error.code === 'WRONG_PORTAL', 'A2 superadmin DITOLAK di portal siswa/guru');
assert(!r.json.data && !(r.json.error && r.json.error.token), 'A2b penolakan tidak membocorkan token');
r = srvLogin('siswa', 'siswa123', 'superadmin');
assert(r.status === 403 && r.json.error.code === 'WRONG_PORTAL', 'A3 siswa DITOLAK di portal superadmin');
r = srvLogin('guru', 'guru123', 'superadmin');
assert(r.status === 403 && r.json.error.code === 'WRONG_PORTAL', 'A4 guru DITOLAK di portal superadmin');
r = srvLogin('guru', 'guru123', 'general');
assert(r.status === 200 && r.json.data.user.role === 'INSTRUCTOR', 'A5 guru masuk lewat portal umum');
r = srvLogin('siswa', 'siswa123', 'general');
assert(r.status === 200 && r.json.data.user.nis === '202423001', 'A6 siswa masuk; NIS ikut dalam data akun');
r = srvLogin('superadmin', 'salah', 'superadmin');
assert(r.status === 401, 'A7 sandi salah tetap 401 (peran tidak bocor sebelum sandi benar)');
r = srvLogin('siswa', 'salah', 'superadmin');
assert(r.status === 401, 'A8 siswa + sandi salah di portal superadmin -> 401, bukan WRONG_PORTAL');
r = srvLogin('superadmin', 'superadmin123');
assert(r.status === 200, 'A9 tanpa portal tetap kompatibel (perilaku lama)');

/* ---------------- B. authUI di VM ---------------- */
function makeEl(id) {
    const el = {
        id, innerHTML: '', value: '', textContent: '', disabled: false, style: {},
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() {}, setAttribute(k, v) { el[k] = v; }, getAttribute(k) { return el[k] === undefined ? null : el[k]; }
    };
    return el;
}
function bootAuth(portal, opts) {
    opts = opts || {};
    const byId = {};
    const ls = opts.ls || {};
    const ss = opts.ss || {};   /* sessionStorage: sesi login hanya berlaku di tab ini */
    const listeners = {};
    const host = makeEl('au-login'); host['data-portal'] = portal; byId['au-login'] = host;
    const ctx = {
        console, setTimeout, clearTimeout, Math, Date, JSON, parseInt, parseFloat, String, Number, Object, Array, RegExp, isNaN, Promise,
        document: {
            readyState: 'complete', body: makeEl('body'),
            getElementById(id) { return byId[id] || null; },
            querySelector() { return null; }, querySelectorAll() { return []; },
            createElement() { return makeEl(); }, addEventListener() {}
        },
        localStorage: {
            getItem: (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null),
            setItem: (k, v) => { ls[k] = String(v); },
            removeItem: (k) => { delete ls[k]; }
        },
        sessionStorage: {
            getItem: (k) => (Object.prototype.hasOwnProperty.call(ss, k) ? ss[k] : null),
            setItem: (k, v) => { ss[k] = String(v); },
            removeItem: (k) => { delete ss[k]; }
        },
        location: { href: '', hash: '', replace(u) { this.href = u; } },
        CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
        addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
        dispatchEvent(ev) { (listeners[ev.type] || []).forEach((f) => f(ev)); return true; }
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    ctx.ProgressApi = opts.progressApi === undefined ? null : opts.progressApi;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'instructorPlatform.js'), 'utf8'), ctx, { filename: 'instructorPlatform.js' });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'authUI.js'), 'utf8'), ctx, { filename: 'authUI.js' });
    if (!opts.noFixture) fixtures.installLocal(ctx.Phase8);
    return { ctx, ls, ss, host, listeners };
}
function formOf(username, password) {
    return { username: { value: username }, password: { value: password }, querySelector: () => null };
}

(async function main() {
    /* B1: tampilan portal */
    let g = bootAuth('general');
    assert(g.host.innerHTML.indexOf('siap membantu melalui WhatsApp') >= 0 && g.host.innerHTML.indexOf('wa.me/6285299557045') >= 0, 'B1 halaman login memuat pesan bantuan WhatsApp');
    assert(g.host.innerHTML.indexOf('Isi Guru') < 0 && g.host.innerHTML.indexOf('Isi Siswa') < 0, 'B1b tombol Isi Guru/Isi Siswa sudah dihapus');
    assert(g.host.innerHTML.indexOf('Akun demo') < 0 && g.host.innerHTML.indexOf('guru123') < 0 && g.host.innerHTML.indexOf('Login Superadmin') < 0, 'B1c teks akun demo & link Login Superadmin sudah dihapus');
    assert(g.host.innerHTML.indexOf('superadmin123') < 0, 'B2 sandi demo superadmin TIDAK tampil di halaman umum');
    assert(g.host.innerHTML.indexOf('data-role="superadmin"') < 0, 'B3 tombol "Isi Superadmin" dihapus dari halaman umum');
    assert(g.host.innerHTML.indexOf('data-au-tab="register"') >= 0, 'B4 halaman umum tetap punya tab Daftar');
    let s = bootAuth('superadmin');
    assert(s.host.innerHTML.indexOf('Portal Superadmin') >= 0, 'B5 halaman superadmin dirender');
    assert(s.host.innerHTML.indexOf('data-au-tab="register"') < 0, 'B6 halaman superadmin tanpa tab Daftar');
    assert(s.host.innerHTML.indexOf('data-au="guest"') < 0, 'B7 halaman superadmin tanpa tombol Tamu');
    assert(s.host.innerHTML.indexOf('href="login.html"') >= 0, 'B8 halaman superadmin punya link balik ke login.html');
    assert(s.host.innerHTML.indexOf('superadmin123') < 0, 'B9 sandi superadmin tidak ditulis di halaman');

    /* B10-13: penegakan portal secara lokal (server offline) */
    let o = bootAuth('general');
    o.ctx.AuthUI.login(formOf('superadmin', 'superadmin123'));
    await wait(20);
    assert(!o.ss.starterSim_auth_session_v1, 'B10 superadmin TIDAK dapat sesi lewat portal umum');
    assert(o.host.innerHTML.indexOf('khusus Superadmin') >= 0, 'B11 pesan arahan ke login Superadmin tampil');
    o = bootAuth('superadmin');
    o.ctx.AuthUI.login(formOf('siswa', 'siswa123'));
    await wait(20);
    assert(!o.ss.starterSim_auth_session_v1, 'B12 siswa TIDAK dapat sesi lewat portal superadmin');
    o.ctx.AuthUI.login(formOf('superadmin', 'superadmin123'));
    await wait(20);
    o.ctx.AuthUI.changeDefaultPassword({ newPassword: { value: 'SandiBaru#2026' }, confirmPassword: { value: 'SandiBaru#2026' } });
    await wait(20);
    const sess = o.ss.starterSim_auth_session_v1 ? JSON.parse(o.ss.starterSim_auth_session_v1) : null;
    assert(sess && sess.role === 'ADMIN', 'B13 superadmin dapat sesi lewat portal superadmin');
    assert(o.ctx.location.href === 'index.html', 'B14 superadmin diarahkan ke aplikasi setelah masuk');
    o.ctx.AuthUI.logout();
    assert(o.ctx.location.href === 'superadmin.html', 'B15 logout superadmin kembali ke portal superadmin');

    /* B16-22: login server -> identitas akun tersinkron */
    let paCalls = [];
    const pa = {
        clearAuth() { paCalls.push('clear'); },
        login(u, p, portal) {
            paCalls.push('login:' + portal);
            if (u === 'budi.baru' && p === 'rahasia1') {
                return Promise.resolve({ ok: true, status: 200, user: { id: 'SRV_9', username: 'budi.baru', name: 'Budi Hartono', role: 'STUDENT', organizationId: 'ORG_DEMO', nis: '202423099', nisn: null, email: null } });
            }
            return Promise.resolve({ ok: false, status: 401, error: { code: 'INVALID_CREDENTIALS', message: 'x' } });
        },
        init() { paCalls.push('init'); return Promise.resolve({ classes: [{ id: 'C1', name: 'XII TKR 2' }] }); }
    };
    let a = bootAuth('general', { progressApi: pa });
    a.ctx.AuthUI.login(formOf('budi.baru', 'rahasia1'));
    await wait(30);
    assert(paCalls.indexOf('login:general') >= 0, 'B16 login server dipanggil dengan portal "general"');
    assert(a.ss.starterSim_auth_session_v1 && JSON.parse(a.ss.starterSim_auth_session_v1).username === 'budi.baru', 'B17 sesi dibuat SETELAH server menjawab (akun hanya ada di server)');
    assert(a.ctx.location.href === 'index.html', 'B18 pindah halaman hanya setelah login server selesai');
    const idn = a.ctx.AuthUI.identity();
    assert(idn && idn.name === 'Budi Hartono', 'B19 identity().name = nama akun');
    assert(idn && idn.nis === '202423099', 'B20 identity().nis = NIS dari server');
    assert(idn && idn.kelas === 'XII TKR 2', 'B21 identity().kelas = kelas dari server');
    assert(idn && idn.sekolah === 'Sekolah Uji', 'B22 identity().sekolah = nama sekolah akun');
    assert(idn && idn.locked.name && idn.locked.kelas && idn.locked.sekolah && idn.locked.studentId, 'B23 semua field identitas dikunci');

    /* B25: server menolak sandi -> fallback lokal tetap jalan; token lama dibersihkan */
    paCalls = [];
    a = bootAuth('general', { progressApi: pa });
    a.ctx.AuthUI.login(formOf('siswa', 'siswa123'));
    await wait(30);
    assert(paCalls[0] === 'clear', 'B25 token lama dihapus sebelum login (cegah progres salah akun)');
    assert(a.ss.starterSim_auth_session_v1 && JSON.parse(a.ss.starterSim_auth_session_v1).username === 'siswa', 'B26 akun lokal tetap bisa masuk saat server tidak mengenalnya');
    const idl = a.ctx.AuthUI.identity();
    assert(idl && idl.name === 'Siswa Uji A' && idl.kelas === 'Kelas Uji 1', 'B27 identitas akun lokal: nama & kelas dari data akun');

    /* B28: WRONG_PORTAL dari server bersifat final (tidak jatuh ke login lokal) */
    const paWrong = Object.assign({}, pa, { login() { return Promise.resolve({ ok: false, status: 403, error: { code: 'WRONG_PORTAL', message: 'Gunakan portal lain.' } }); } });
    a = bootAuth('general', { progressApi: paWrong });
    a.ctx.AuthUI.login(formOf('siswa', 'siswa123'));
    await wait(30);
    assert(!a.ss.starterSim_auth_session_v1, 'B28 WRONG_PORTAL dari server final, tidak ada fallback lokal');

    /* B29-33: data progres dipisah per akun */
    const shared = {};
    let ps = bootAuth('general', { ls: shared });
    ps.ctx.AuthUI.login(formOf('siswa', 'siswa123'));
    await wait(20);
    shared.starterHub_v1 = JSON.stringify({ nama: 'Siswa Uji A', materi: { 1: { paham: true } } });
    shared.p5Progress = '{"andi":1}';
    ps.ctx.AuthUI.logout();
    ps = bootAuth('general', { ls: shared });
    ps.ctx.AuthUI.login(formOf('siswa2', 'siswa123'));
    await wait(20);
    assert(shared.starterHub_v1 === undefined && shared.p5Progress === undefined, 'B29 siswa lain TIDAK melihat progres siswa sebelumnya');
    shared.starterHub_v1 = JSON.stringify({ nama: 'Siswa Uji B', materi: {} });
    ps.ctx.AuthUI.logout();
    ps = bootAuth('general', { ls: shared });
    ps.ctx.AuthUI.login(formOf('siswa', 'siswa123'));
    await wait(20);
    assert(shared.starterHub_v1 && JSON.parse(shared.starterHub_v1).nama === 'Siswa Uji A', 'B30 progres Andi kembali utuh saat Andi login lagi');
    assert(shared.p5Progress === '{"andi":1}', 'B31 data phase5 Andi juga dipulihkan');
    ps.ctx.AuthUI.logout();
    ps = bootAuth('general', { ls: shared });
    ps.ctx.AuthUI.login(formOf('siswa2', 'siswa123'));
    await wait(20);
    assert(shared.starterHub_v1 && JSON.parse(shared.starterHub_v1).nama === 'Siswa Uji B', 'B32 progres Siti tersimpan terpisah & kembali utuh');
    assert(Object.keys(shared).filter((k) => k.indexOf('starterSim_data_stash_v1_') === 0).length >= 1, 'B33 data pemilik lain disimpan di stash (tidak dihapus)');

    /* B34: data lama (sebelum fitur) diadopsi akun pertama, tidak hilang */
    const legacy = { starterHub_v1: JSON.stringify({ nama: 'Lama', materi: { 2: { paham: true } } }) };
    let lg = bootAuth('general', { ls: legacy });
    lg.ctx.AuthUI.login(formOf('siswa', 'siswa123'));
    await wait(20);
    assert(legacy.starterHub_v1 && JSON.parse(legacy.starterHub_v1).materi[2], 'B34 data lama diadopsi akun pertama (tidak hilang)');

    /* ---------------- C. learningHub: identitas di Progres ---------------- */
    const byId = {};
    const ls = {};
    const documentMock = {
        readyState: 'complete', body: makeEl('body'),
        getElementById(id) { if (!byId[id]) byId[id] = makeEl(id); return byId[id]; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        createElement() { return makeEl(); }, addEventListener() {}
    };
    const hl = {};
    const hctx = {
        console, setTimeout, clearTimeout, Math, Date, JSON, parseInt, parseFloat, String, Number, Object, Array, RegExp, isNaN,
        confirm: () => true, alert: () => {}, print: () => {}, document: documentMock,
        localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } },
        addEventListener(t, f) { (hl[t] = hl[t] || []).push(f); }, scrollTo() {}
    };
    hctx.window = hctx; hctx.globalThis = hctx;
    hctx.location = { _h: '', get hash() { return this._h; }, set hash(v) { this._h = v; } };
    vm.createContext(hctx);
    ['learningHub-data.js', 'learningJobSheets.js', 'learningHub.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), hctx, { filename: f }));
    const Hub = hctx.StarterHub;

    hctx.location.hash = '#/progres'; Hub.route();
    let html = byId['hub-progress'].innerHTML;
    assert(html.indexOf('id="hub-nama"') >= 0 && html.indexOf('readonly') < 0, 'C1 tanpa akun (tamu): kolom nama tetap bisa diisi manual');

    hctx.AuthUI = {
        identity: () => ({ userId: 'U1', username: 'siswa', role: 'STUDENT', name: 'Siswa Uji A', kelas: 'Kelas Uji 1', sekolah: 'Sekolah Uji', nis: '202423001', locked: { name: true, kelas: true, sekolah: true, studentId: true } })
    };
    Hub.getStore().nama = 'Ketikan Lama';
    Hub.route();
    html = byId['hub-progress'].innerHTML;
    assert(Hub.getStore().nama === 'Siswa Uji A', 'C2 nama di Progres dipaksa = nama akun (menimpa isian lama)');
    assert(Hub.getStore().kelas === 'Kelas Uji 1' && Hub.getStore().sekolah === 'Sekolah Uji', 'C3 kelas & sekolah ikut akun');
    assert(/id="hub-nama" placeholder="Nama siswa" readonly[^>]*value="Siswa Uji A"/.test(html), 'C4 input nama readonly berisi nama akun');
    assert(html.indexOf('NIS <b>202423001</b>') >= 0, 'C5 NIS akun ditampilkan di Progres');
    documentMock.getElementById('hub-nama').value = 'Dipalsukan'; documentMock.getElementById('hub-kelas').value = 'XII ABC'; documentMock.getElementById('hub-sekolah').value = 'Sekolah Lain';
    Hub.setProfile();
    assert(Hub.getStore().nama === 'Siswa Uji A' && Hub.getStore().kelas === 'Kelas Uji 1' && Hub.getStore().sekolah === 'Sekolah Uji', 'C6 setProfile tidak bisa menimpa identitas akun (walau DOM diubah)');
    assert(JSON.parse(ls.starterHub_v1).nama === 'Siswa Uji A', 'C7 nama akun tersimpan di penyimpanan lokal');

    /* guru: nama terkunci, kelas tetap bebas */
    hctx.AuthUI = { identity: () => ({ userId: 'G', username: 'guru', role: 'INSTRUCTOR', name: 'Guru Uji', kelas: '', sekolah: 'Sekolah Uji', nis: '', locked: { name: true, kelas: false, sekolah: true, studentId: false } }) };
    Hub.route();
    html = byId['hub-progress'].innerHTML;
    assert(/id="hub-nama" placeholder="Nama siswa" readonly/.test(html) && !/id="hub-kelas" placeholder="Kelas" readonly/.test(html), 'C8 guru: nama terkunci, kelas tetap bisa diisi');

    /* event identitas dari authUI memperbarui Progres */
    hctx.AuthUI = { identity: () => ({ userId: 'U2', username: 'siswa2', role: 'STUDENT', name: 'Siswa Uji B', kelas: 'Kelas Uji 1', sekolah: 'Sekolah Uji', nis: '202423002', locked: { name: true, kelas: true, sekolah: true, studentId: true } }) };
    (hl['starter:identity'] || []).forEach((f) => f({}));
    assert(Hub.getStore().nama === 'Siswa Uji B' && byId['hub-progress'].innerHTML.indexOf('value="Siswa Uji B"') >= 0, 'C9 event starter:identity memperbarui nama & tampilan Progres');

    /* ---------------- D. HTTP nyata: link /superadmin & /login ---------------- */
    const port = 18400 + Math.floor(Math.random() * 400);
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: Object.assign({}, process.env, { SIM_PORT: String(port), SIM_DB: ':memory:' }), stdio: 'ignore' });
    function get(p) {
        return new Promise((res) => {
            http.get({ host: '127.0.0.1', port, path: p }, (resp) => {
                let b = ''; resp.on('data', (c) => { b += c; }); resp.on('end', () => res({ status: resp.statusCode, body: b }));
            }).on('error', () => res({ status: 0, body: '' }));
        });
    }
    let up = false;
    for (let i = 0; i < 40 && !up; i++) { await wait(150); up = (await get('/api/health')).status === 200; }
    assert(up, 'D0 server uji berjalan');
    if (up) {
        const sa = await get('/superadmin');
        assert(sa.status === 200 && sa.body.indexOf('data-portal="superadmin"') >= 0, 'D1 GET /superadmin -> halaman login Superadmin');
        const lg2 = await get('/login');
        assert(lg2.status === 200 && lg2.body.indexOf('data-portal="general"') >= 0, 'D2 GET /login -> halaman login Siswa/Guru');
        const root = await get('/');
        assert(root.status === 200 && root.body.indexOf('au-login') >= 0 && root.body.indexOf('starterSVG') < 0, 'D4 GET / -> halaman login, BUKAN simulator');
        const sa2 = await get('/superadmin.html');
        assert(sa2.status === 200, 'D3 GET /superadmin.html juga bisa diakses');
    }
    child.kill();

    console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
    process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH: ' + (e.stack || e.message)); process.exit(1); });
