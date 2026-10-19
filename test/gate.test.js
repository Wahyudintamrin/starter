/* GATE TEST - (1) tanpa data contoh, (2) wajib login setiap membuka link, tanpa mode tamu.
   Run: node test/gate.test.js */
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
    console.log('GATE TEST');
    /* ---------- 1. tanpa data contoh ---------- */
    let a = boot('login');
    const R = a.P8.repositories;
    const rosterStudents = R.userRepository.list().filter((u) => u.role === 'STUDENT' && u.organizationId === 'ORG_MAKASSAR');
    assert(R.userRepository.list().some((u) => u.username === 'superadmin' && u.role === 'ADMIN'), 'N1 data awal berisi akun Superadmin');
    assert(rosterStudents.length === 36, 'N1b 36 siswa roster SMKN 3 Makassar diimpor');
    assert(R.organizationRepository.list().length === 1 && R.organizationRepository.list()[0].name === 'SMKN 3 Makassar', 'N2 hanya satu sekolah: SMKN 3 Makassar (bukan contoh)');
    assert(R.classRepository.list().length === 1 && R.classRepository.list()[0].name === 'XI TKR 1', 'N2b satu kelas: XI TKR 1 milik SMKN 3');
    assert(R.assignmentRepository.list().length === 0 && R.submissionRepository.list().length === 0, 'N2c tidak ada tugas/kiriman contoh');
    assert(R.userRepository.list().filter((u) => u.role === 'INSTRUCTOR').length === 0, 'N3 tidak ada guru contoh');
    assert(R.userRepository.list().filter((u) => u.role === 'STUDENT').every((u) => u.organizationId === 'ORG_MAKASSAR'), 'N3b satu-satunya siswa adalah roster SMKN 3');
    const html = a.host.innerHTML;
    assert(html.indexOf('data-au-form="login"') >= 0, 'N4 halaman login dirender');
    a.ctx.AuthUI.setTab('register');
    assert(a.host.innerHTML.indexOf('SMKN 3 Makassar') >= 0, 'N5 form Daftar memuat sekolah SMKN 3 Makassar');
    assert(/<select name="organizationId"><option value="">\(Pilih sekolah\)<\/option><option value="ORG_MAKASSAR">SMKN 3 Makassar<\/option>/.test(a.host.innerHTML), 'N6 sekolah SMKN 3 Makassar tersedia di pilihan Daftar');
    assert(typeof a.ctx.AuthUI.login === 'function', 'N7 API login tersedia');

    /* sekolah & guru berasal dari pendaftaran (alur Daftar Sekolah) */
    a.ctx.AuthUI.setTab('school');
    assert(a.host.innerHTML.indexOf('data-au-form="school"') >= 0, 'N8 tab Daftar Sekolah tersedia untuk membuat sekolah pertama');

    /* form Daftar Sekolah: hanya Nama sekolah, Alamat, Nama admin/PIC, Username admin, Password admin */
    const sf = a.host.innerHTML.match(/<form[^>]*data-au-form="school"[\s\S]*?<\/form>/)[0];
    const fieldNames = (sf.match(/<(?:input|select)[^>]*name="([^"]+)"/g) || []).map((x) => x.match(/name="([^"]+)"/)[1]);
    assert(fieldNames.join(',') === 'name,address,adminName,adminUsername,adminPassword', 'P1 form Daftar Sekolah hanya berisi: ' + fieldNames.join(', '));
    assert(sf.indexOf('name="type"') < 0 && sf.indexOf('<select') < 0 && sf.indexOf('Jenis') < 0, 'P2 pilihan Jenis sudah dihapus dari form Daftar Sekolah');
    ['Nama sekolah', 'Alamat', 'Nama admin/PIC', 'Username admin', 'Password admin (min. 6)'].forEach((l) => assert(sf.indexOf('<span>' + l + '</span>') >= 0, 'P3 label "' + l + '" ada'));
    const order = ['Nama sekolah', 'Alamat', 'Nama admin/PIC', 'Username admin', 'Password admin'].map((l) => sf.indexOf('<span>' + l));
    assert(order.every((v, i) => i === 0 || v > order[i - 1]), 'P4 urutan field sesuai permintaan');
    /* kirim pendaftaran TANPA field jenis -> tetap berhasil, jenis otomatis Sekolah, status menunggu */
    const fv = (n, v) => ({ value: v });
    a.ctx.AuthUI.setTab('school');
    const schoolFormObj = { name: fv('name', 'Sekolah Pendaftar'), address: fv('address', 'Jl. Uji 5'), adminName: fv('adminName', 'Admin Pendaftar'), adminUsername: fv('adminUsername', 'adminpendaftar'), adminPassword: fv('adminPassword', 'rahasia1'), querySelector: () => null };
    a.ctx.AuthUI.setTab('school');
    const subHandlers = [];
    /* panggil submit lewat handler dokumen: gunakan pemicu yang sama seperti browser */
    const evSubmit = { target: Object.assign(schoolFormObj, { getAttribute: (k) => (k === 'data-au-form' ? 'school' : null) }), preventDefault() {} };
    (a.listeners.submit || []).forEach((f) => f(evSubmit));
    const reg = a.P8.repositories.organizationRepository.list().filter((o) => o.name === 'Sekolah Pendaftar')[0];
    assert(reg && reg.status === 'PENDING' && reg.type === 'SCHOOL' && reg.address === 'Jl. Uji 5', 'P5 pendaftaran terkirim tanpa jenis: status menunggu, jenis otomatis "Sekolah"');
    assert(reg && reg.pendingAdmin && reg.pendingAdmin.username === 'adminpendaftar' && reg.pendingAdmin.name === 'Admin Pendaftar', 'P6 data admin/PIC tersimpan untuk persetujuan Superadmin');
    assert(reg && reg.pendingAdmin.passwordHash && reg.pendingAdmin.passwordHash.indexOf('rahasia1') < 0, 'P7 password admin tidak disimpan polos');
    /* Superadmin menyetujui -> sekolah aktif + akun admin sekolah dibuat */
    a.ctx.AuthUI.approveSchool(reg.id);
    const approved = a.P8.repositories.organizationRepository.getById(reg.id);
    const admUser = a.P8.repositories.userRepository.list().filter((u) => u.username === 'adminpendaftar')[0];
    assert(approved.status === 'ACTIVE' && admUser && admUser.role === 'INSTRUCTOR' && admUser.organizationId === reg.id, 'P8 setelah disetujui: sekolah aktif & akun admin sekolah terbentuk');
    a.ctx.AuthUI.setTab('register');
    assert(a.host.innerHTML.indexOf('>Sekolah Pendaftar</option>') >= 0 && a.host.innerHTML.indexOf('Sekolah Pendaftar &middot;') < 0, 'P9 sekolah muncul di pilihan Daftar tanpa label jenis');

    /* ---------- 2. data contoh lama dibersihkan, data nyata utuh ---------- */
    const ls = {};
    const first = boot('login', { ls });
    const F = first.P8.repositories, now = Date.now();
    F.organizationRepository.save({ id: 'ORG_DEMO', name: 'SMK Negeri 1 Contoh', type: 'SCHOOL', status: 'ACTIVE', createdBy: 'SYSTEM' });
    ['USER_GURU:Budi Santoso:guru:INSTRUCTOR', 'USER_SISWA1:Andi Pratama:siswa:STUDENT', 'USER_SISWA2:Siti Aminah:siswa2:STUDENT', 'USER_SISWA_PENDING:Rina Dewi:rina:STUDENT'].forEach((x) => {
        const p = x.split(':'); F.userRepository.save({ id: p[0], name: p[1], username: p[2], role: p[3], organizationId: 'ORG_DEMO', classIds: [], status: 'ACTIVE', passwordHash: 'x', salt: 's' });
    });
    F.classRepository.save({ id: 'CLASS_DEMO', organizationId: 'ORG_DEMO', name: 'XII TKR 1', subject: 's', instructorIds: ['USER_GURU'], studentIds: ['USER_SISWA1'], status: 'ACTIVE', joinCode: 'X', joinEnabled: true });
    F.assignmentRepository.save({ id: 'ASSIGN_DEMO1', classId: 'CLASS_DEMO', title: 't', type: 'QUIZ', status: 'PUBLISHED' });
    F.submissionRepository.save({ id: 'SUB_DEMO1', assignmentId: 'ASSIGN_DEMO1', classId: 'CLASS_DEMO', studentId: 'USER_SISWA1', status: 'SUBMITTED' });
    F.userRepository.save({ id: 'USER_NYATA', name: 'Guru Sungguhan', username: 'gurunyata', role: 'INSTRUCTOR', organizationId: 'ORG_DEMO', classIds: [], status: 'ACTIVE', passwordHash: 'x', salt: 's' });
    const second = boot('login', { ls });
    const S = second.P8.repositories;
    assert(!S.userRepository.getById('USER_GURU') && !S.userRepository.getById('USER_SISWA1') && !S.userRepository.getById('USER_SISWA2') && !S.userRepository.getById('USER_SISWA_PENDING'), 'L1 akun contoh lama (guru, siswa, siswa2, rina) dihapus saat dimuat');
    assert(!S.classRepository.getById('CLASS_DEMO') && !S.assignmentRepository.getById('ASSIGN_DEMO1') && !S.submissionRepository.getById('SUB_DEMO1'), 'L2 kelas, tugas, dan kiriman contoh lama ikut dihapus');
    assert(!!S.userRepository.getById('USER_NYATA'), 'L3 akun nyata tidak tersentuh');
    assert(!!S.organizationRepository.getById('ORG_DEMO'), 'L4 sekolah yang sudah dipakai akun nyata TIDAK dihapus');
    const third = boot('login', { ls: { starterSim_db_dummy: '1' } });
    assert(third.P8.repositories.userRepository.list().some((u) => u.username === 'superadmin') && third.P8.repositories.userRepository.list().filter((u) => u.role === 'STUDENT').length === 36, 'L5 browser baru berisi Superadmin + 36 siswa roster');

    /* ---------- 3. wajib login, tanpa mode tamu ---------- */
    a = boot('login');
    assert(a.host.innerHTML.indexOf('data-au="guest"') < 0 && a.host.innerHTML.indexOf('Tamu') < 0, 'G1 halaman login tanpa tombol "Masuk sebagai Tamu"');
    assert(typeof a.ctx.AuthUI.guest === 'undefined', 'G2 fungsi mode tamu sudah dihapus dari AuthUI');
    assert(a.host.innerHTML.indexOf('guru123') < 0 && a.host.innerHTML.indexOf('Akun demo') < 0, 'G3 tidak ada kredensial demo di halaman login');
    assert(a.host.innerHTML.indexOf('wa.me/6285299557045') >= 0, 'G4 pesan bantuan WhatsApp tetap ada');

    /* membuka halaman simulator tanpa sesi -> dialihkan ke login */
    const app0 = boot('app');
    assert(app0.ctx.location.href === 'login.html', 'G5 membuka simulator tanpa login -> dialihkan ke login.html');
    /* bendera tamu lama di localStorage tidak lagi membuka akses */
    const gl = { starterSim_auth_guest_v1: '1', starterSim_auth_guest_count_v1: '1' };
    const app1 = boot('app', { ls: gl });
    assert(app1.ctx.location.href === 'login.html', 'G6 bendera tamu lama TIDAK memberi akses');
    assert(gl.starterSim_auth_guest_v1 === undefined && gl.starterSim_auth_guest_count_v1 === undefined, 'G7 bendera tamu lama dibersihkan');
    /* sesi lama di localStorage (persisten) tidak berlaku: link baru wajib login */
    const old = { starterSim_auth_session_v1: JSON.stringify({ userId: 'USER_SUPERADMIN', role: 'ADMIN', username: 'superadmin' }) };
    const app2 = boot('app', { ls: old });
    assert(app2.ctx.location.href === 'login.html', 'G8 sesi lama di localStorage tidak lagi melewati login');
    assert(old.starterSim_auth_session_v1 === undefined, 'G9 sesi lama di localStorage dibersihkan');

    /* login berhasil -> sesi di sessionStorage SAJA */
    const lg = boot('login', { portal: 'superadmin' });
    lg.ctx.AuthUI.login(form('superadmin', 'superadmin123'));
    await wait(30);
    assert(!lg.ss.starterSim_auth_session_v1, 'S0 sandi bawaan: sesi BELUM dibuat sebelum sandi diganti');
    lg.ctx.AuthUI.changeDefaultPassword({ newPassword: { value: 'SandiBaru#2026' }, confirmPassword: { value: 'SandiBaru#2026' } });
    await wait(30);
    assert(lg.ss.starterSim_auth_session_v1 && JSON.parse(lg.ss.starterSim_auth_session_v1).username === 'superadmin', 'S1 sesi tersimpan di sessionStorage (per tab)');
    assert(lg.ls.starterSim_auth_session_v1 === undefined, 'S2 sesi TIDAK ditulis ke localStorage (tidak bertahan setelah tab ditutup)');
    assert(lg.ctx.location.href === 'index.html', 'S3 setelah login berhasil baru menuju simulator');
    /* tab/jendela baru (sessionStorage kosong, localStorage sama) -> wajib login lagi */
    const newTab = boot('app', { ls: lg.ls });
    assert(newTab.ctx.location.href === 'login.html', 'S4 membuka link di tab baru -> wajib login lagi');
    /* tab yang sama (reload) tetap masuk */
    const reload = boot('app', { ls: lg.ls, ss: lg.ss });
    assert(reload.ctx.location.href !== 'login.html', 'S5 muat ulang di tab yang sama tidak meminta login lagi');
    /* sesi menunjuk akun yang sudah dihapus -> tidak berlaku */
    const ghost = boot('app', { ls: lg.ls, ss: { starterSim_auth_session_v1: JSON.stringify({ userId: 'USER_HILANG', role: 'STUDENT', username: 'hilang' }) } });
    assert(ghost.ctx.location.href === 'login.html' && ghost.ss.starterSim_auth_session_v1 === undefined, 'S6 sesi akun yang sudah dihapus ditolak & dibersihkan');
    /* keluar */
    reload.ctx.AuthUI.logout();
    assert(reload.ss.starterSim_auth_session_v1 === undefined, 'S7 keluar menghapus sesi');

    /* ---------- 4. gerbang HTML (sebelum halaman tampil) ---------- */
    function runGate(file, sessionVal, lsVal) {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const m = src.match(/<script>\s*\/\* GERBANG LOGIN[\s\S]*?<\/script>/);
        if (!m) return null;
        const code = m[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
        const docEl = { style: { visibility: '' } };
        const g = {
            document: { documentElement: docEl },
            sessionStorage: { getItem: (k) => (k === 'starterSim_auth_session_v1' ? sessionVal : null) },
            localStorage: { getItem: (k) => (lsVal && lsVal[k]) || null },
            location: { href: '', replace(u) { this.href = u; } }
        };
        vm.createContext(g); vm.runInContext(code, g);
        return { hidden: docEl.style.visibility === 'hidden', href: g.location.href };
    }
    ['index.html', 'panduan.html'].forEach((f) => {
        const ok = runGate(f, JSON.stringify({ userId: 'U1' }));
        const none = runGate(f, null);
        const guest = runGate(f, null, { starterSim_auth_guest_v1: '1', starterSim_auth_guest_count_v1: '0' });
        const bad = runGate(f, 'bukan-json');
        const oldLs = runGate(f, null, { starterSim_auth_session_v1: JSON.stringify({ userId: 'U1' }) });
        assert(ok && !ok.hidden && ok.href === '', 'H1 ' + f + ': dengan sesi -> halaman tampil, tanpa pengalihan');
        assert(none && none.hidden && none.href === 'login.html', 'H2 ' + f + ': tanpa sesi -> halaman disembunyikan & dialihkan ke login');
        assert(guest && guest.hidden && guest.href === 'login.html', 'H3 ' + f + ': bendera tamu tidak melewati gerbang');
        assert(bad && bad.hidden && bad.href === 'login.html', 'H4 ' + f + ': sesi rusak ditolak');
        assert(oldLs && oldLs.hidden && oldLs.href === 'login.html', 'H5 ' + f + ': sesi lama di localStorage ditolak');
    });
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert(idx.indexOf('GERBANG LOGIN') < idx.indexOf('<link rel="stylesheet"') + 400 && idx.indexOf('GERBANG LOGIN') < idx.indexOf('<body>'), 'H6 gerbang dijalankan di <head>, sebelum isi halaman');
    assert(idx.indexOf('guest') < 0, 'H7 index.html tidak lagi memuat logika tamu');

    console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.stack || e.message); process.exit(1); });
