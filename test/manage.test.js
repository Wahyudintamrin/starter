process.env.SIM_SUPERADMIN_PASSWORD = 'superadmin123'; /* tes mewakili instalasi dengan sandi yang diatur admin */
/* ============================================================
   MANAGE TEST — dashboard Superadmin (kelola semua guru & siswa),
   dashboard Guru (kelola siswa sekolahnya + edit kelas) dan
   tombol Detail. authUI dijalankan di VM dengan DOM tiruan.
   Run: node test/manage.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fixtures = require('./fixtures');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.log('  FAIL: ' + msg); } }

function makeEl(attrs, text) {
    const el = { _a: Object.assign({}, attrs || {}), parentNode: null, value: '', checked: false, textContent: text || '',
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(el._a, k) ? el._a[k] : null; },
        setAttribute(k, v) { el._a[k] = v; }, querySelector() { return null; }, querySelectorAll() { return []; },
        focus() {}, closest() { return null; } };
    return el;
}

function boot(login) {
    /* 1) boot pertama: hanya untuk membuat data seed di localStorage; 2) boot kedua: dengan sesi login */
    const seedLs = {};
    const first = build(seedLs, null, {});
    fixtures.installLocal(first.P8);   /* produk tidak membawa data contoh: pasang fixture uji */
    const seedSs = {};
    const SESSION_USER = JSON.parse(seedLs.starterSim_phase8_db_v1).users;
    const su = Object.keys(SESSION_USER).map((k) => SESSION_USER[k]).filter((x) => x.username === login)[0];
    seedSs.starterSim_auth_session_v1 = JSON.stringify({ userId: su.id, role: su.role, name: su.name, username: su.username, at: Date.now() });
    return build(seedLs, login, seedSs);
}

function build(ls, login, ss) {
    const byId = {};
    const docL = {};
    const host = makeEl({}); host.id = 'au-dashboard'; byId['au-dashboard'] = host; host.innerHTML = '';
    const ctx = {
        console, setTimeout, clearTimeout, Math, Date, JSON, parseInt, parseFloat, String, Number, Object, Array, RegExp, isNaN, Promise,
        document: {
            readyState: 'complete', body: makeEl(),
            getElementById(id) { return byId[id] || null; },
            querySelector() { return null; }, querySelectorAll() { return []; },
            createElement() { return makeEl(); },
            addEventListener(t, fn) { (docL[t] = docL[t] || []).push(fn); }
        },
        localStorage: {
            getItem: (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null),
            setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; }
        },
        sessionStorage: {
            getItem: (k) => (Object.prototype.hasOwnProperty.call(ss, k) ? ss[k] : null),
            setItem: (k, v) => { ss[k] = String(v); }, removeItem: (k) => { delete ss[k]; }
        },
        location: { href: '', hash: '#/dashboard', replace(u) { this.href = u; } },
        CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
        addEventListener() {}, dispatchEvent() { return true; }
    };
    ctx.window = ctx; ctx.globalThis = ctx; ctx.ProgressApi = null;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'instructorPlatform.js'), 'utf8'), ctx, { filename: 'instructorPlatform.js' });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'authUI.js'), 'utf8'), ctx, { filename: 'authUI.js' });
    const P8 = ctx.Phase8;
    const app = { ctx, P8, host, ls, ss };
    if (login) ctx.AuthUI.refresh();
    app.html = () => host.innerHTML;
    app.fire = (type, e) => { (docL[type] || []).forEach((f) => f(e)); };
    app.click = (action, data) => {
        const attrs = Object.assign({ 'data-au-act': action }, data || {});
        const el = makeEl(attrs); el.parentNode = ctx.document;
        app.fire('click', { target: el });
    };
    app.tab = (t) => app.click('admin-tab', { 'data-tab': t });
    app.submit = (kind, fields, checks) => {
        const form = makeEl({ 'data-au-form': kind });
        const elements = {};
        Object.keys(fields).forEach((k) => { elements[k] = { value: fields[k] }; });
        form.elements = elements;
        form.querySelectorAll = () => (checks || []).map((v) => ({ value: v, checked: true }));
        form.querySelector = () => null;
        let prevented = false;
        app.fire('submit', { target: form, preventDefault() { prevented = true; } });
        return prevented;
    };
    app.search = (q) => {
        const el = makeEl({ 'data-au-search': '1' }); el.value = q; el.selectionStart = q.length;
        app.fire('input', { target: el });
    };
    app.filter = (name, value) => {
        const el = makeEl({ 'data-au-filter': name }); el.value = value;
        app.fire('change', { target: el });
    };
    app.user = (name) => P8.repositories.userRepository.list().filter((x) => x.username === name)[0] || null;
    return app;
}

console.log('MANAGE TEST');

/* ---------- Bagian 0: akar masalah Detail ---------- */
{
    const a = boot('guru');
    assert(typeof a.P8.analyticsRepository === 'undefined' && typeof a.P8.repositories.analyticsRepository === 'object',
        '0a analyticsRepository hanya ada di P8.repositories (penyebab Detail error sebelumnya)');
    assert(a.fire && a.html().indexOf('Dashboard Guru') >= 0, '0b dashboard guru dirender');
}

/* ---------- A. SUPERADMIN ---------- */
{
    const a = boot('superadmin');
    assert(a.html().indexOf('Dashboard Superadmin') >= 0, 'A1 dashboard superadmin dirender');
    assert(a.html().indexOf('data-tab="guru"') >= 0 && a.html().indexOf('data-tab="siswa"') >= 0, 'A2 tab Data Guru & Data Siswa tersedia');

    a.tab('siswa');
    assert(a.html().indexOf('Siswa Uji A') >= 0 && a.html().indexOf('Siswa Uji B') >= 0, 'A3 tab Siswa menampilkan semua siswa');
    a.tab('guru');
    assert(a.html().indexOf('Guru Uji') >= 0 && a.html().indexOf('Siswa Uji A') < 0, 'A4 tab Guru hanya menampilkan guru');

    /* tambah sekolah kedua + guru & siswa di sana -> superadmin melihat lintas sekolah */
    a.P8.repositories.organizationRepository.save({ id: 'ORG_B', name: 'SMK Bhakti 2', type: 'SCHOOL', status: 'ACTIVE', createdBy: 'SYSTEM' });

    a.click('add-user-open', { 'data-role': 'INSTRUCTOR' });
    assert(a.html().indexOf('data-au-form="user-save"') >= 0, 'A5 form tambah guru terbuka');
    a.submit('user-save', { mode: 'add', id: '', role: 'INSTRUCTOR', name: 'Dewi Lestari', username: 'dewi', email: 'dewi@x.id', password: 'abc123', organizationId: 'ORG_B', status: '' });
    const dewi = a.user('dewi');
    assert(dewi && dewi.role === 'INSTRUCTOR' && dewi.organizationId === 'ORG_B', 'A6 guru baru tersimpan dengan sekolah yang dipilih');
    assert(dewi && dewi.passwordHash && dewi.passwordHash.indexOf('abc123') < 0, 'A7 sandi tidak disimpan plaintext');
    assert(a.html().indexOf('Dewi Lestari') >= 0 && a.html().indexOf('SMK Bhakti 2') >= 0, 'A8 guru baru tampil di tabel beserta sekolahnya');
    assert(a.html().indexOf('ditambahkan') >= 0, 'A9 pesan sukses tampil di dashboard');

    /* validasi */
    a.click('add-user-open', { 'data-role': 'INSTRUCTOR' });
    a.submit('user-save', { mode: 'add', id: '', role: 'INSTRUCTOR', name: 'X', username: 'dewi', password: 'abc123', organizationId: 'ORG_B' });
    assert(a.html().indexOf('sudah dipakai') >= 0, 'A10 username ganda ditolak');
    a.submit('user-save', { mode: 'add', id: '', role: 'INSTRUCTOR', name: 'X', username: 'xx', password: 'abc123', organizationId: 'ORG_B' });
    assert(a.html().indexOf('Username 3-30') >= 0 && !a.user('xx'), 'A11 username terlalu pendek ditolak');
    a.submit('user-save', { mode: 'add', id: '', role: 'INSTRUCTOR', name: 'Y', username: 'yyy', password: '123', organizationId: 'ORG_B' });
    assert(a.html().indexOf('minimal 6') >= 0 && !a.user('yyy'), 'A12 sandi pendek ditolak');
    a.submit('user-save', { mode: 'add', id: '', role: 'INSTRUCTOR', name: 'Y', username: 'yyy', password: '123456', organizationId: '' });
    assert(a.html().indexOf('wajib dihubungkan') >= 0 && !a.user('yyy'), 'A13 guru tanpa sekolah ditolak');

    /* tambah siswa di sekolah B */
    a.tab('siswa');
    a.click('add-user-open', { 'data-role': 'STUDENT' });
    a.submit('user-save', { mode: 'add', id: '', role: 'STUDENT', name: 'Rudi Hartono', username: 'rudi', email: '', nis: '555', password: 'rudi123', organizationId: 'ORG_B' });
    const rudi = a.user('rudi');
    const hash0 = rudi.passwordHash; /* objek repo bersifat 'live', simpan nilainya */
    assert(rudi && rudi.role === 'STUDENT' && rudi.nis === '555' && rudi.organizationId === 'ORG_B', 'A14 siswa baru tersimpan (NIS & sekolah)');

    /* edit */
    a.click('edit-user', { 'data-user': rudi.id });
    assert(a.html().indexOf('Edit data siswa') >= 0, 'A15 form edit terbuka dengan data siswa');
    a.submit('user-save', { mode: 'edit', id: rudi.id, role: 'STUDENT', name: 'Rudi H. Putra', username: 'rudi.p', email: 'r@x.id', nis: '556', password: '', organizationId: 'ORG_DEMO', status: 'ACTIVE' }, ['CLASS_DEMO']);
    const rudi2 = a.P8.repositories.userRepository.getById(rudi.id);
    assert(rudi2.name === 'Rudi H. Putra' && rudi2.username === 'rudi.p' && rudi2.nis === '556' && rudi2.organizationId === 'ORG_DEMO', 'A16 edit mengubah nama, username, NIS, sekolah');
    assert(rudi2.passwordHash === hash0, 'A17 sandi tidak berubah bila dikosongkan');
    const cd = a.P8.repositories.classRepository.getById('CLASS_DEMO');
    assert(cd.studentIds.indexOf(rudi.id) >= 0 && rudi2.classIds.indexOf('CLASS_DEMO') >= 0, 'A18 siswa dimasukkan ke kelas lewat checkbox kelas');
    a.click('edit-user', { 'data-user': rudi.id });
    a.submit('user-save', { mode: 'edit', id: rudi.id, role: 'STUDENT', name: 'Rudi H. Putra', username: 'rudi.p', nis: '556', password: 'baru999', organizationId: 'ORG_DEMO', status: 'ACTIVE' }, []);
    const rudi3 = a.P8.repositories.userRepository.getById(rudi.id);
    assert(rudi3.passwordHash !== hash0, 'A19 sandi baru mengganti sandi lama');
    assert(a.P8.repositories.classRepository.getById('CLASS_DEMO').studentIds.indexOf(rudi.id) < 0, 'A20 checkbox kelas dikosongkan -> siswa keluar dari kelas');
    assert(a.P8.authService.login('rudi.p', 'baru999').success === true, 'A21 login lokal dengan username & sandi baru berhasil');

    /* nonaktifkan / aktifkan */
    a.click('toggle-user', { 'data-user': rudi.id });
    assert(a.P8.repositories.userRepository.getById(rudi.id).status === 'INACTIVE', 'A22 akun dinonaktifkan');
    assert(a.P8.authService.login('rudi.p', 'baru999').success === false, 'A23 akun nonaktif tidak bisa masuk');
    a.click('toggle-user', { 'data-user': rudi.id });
    assert(a.P8.repositories.userRepository.getById(rudi.id).status === 'ACTIVE', 'A24 akun diaktifkan kembali');

    /* detail siswa & guru */
    a.click('detail-user', { 'data-user': rudi.id });
    assert(a.html().indexOf('Detail siswa') >= 0 && a.html().indexOf('Tugas &amp; nilai') >= 0, 'A25 Detail siswa tampil tanpa error');
    a.tab('guru');
    a.click('detail-user', { 'data-user': 'USER_GURU' });
    assert(a.html().indexOf('Detail guru') >= 0 && a.html().indexOf('Kelas yang diajar') >= 0 && a.html().indexOf('Kelas Uji 1') >= 0, 'A26 Detail guru menampilkan kelas yang diajar');

    /* pencarian & filter */
    a.tab('siswa');
    a.search('uji b');
    assert(a.html().indexOf('Siswa Uji B') >= 0 && a.html().indexOf('Siswa Uji A') < 0, 'A27 pencarian menyaring daftar');
    a.search('');
    a.filter('org', 'ORG_B');
    assert(a.html().indexOf('Siswa Uji B') < 0, 'A28 filter sekolah menyaring daftar');
    a.filter('org', '');

    /* hapus: konfirmasi dua langkah */
    a.click('delete-ask', { 'data-user': rudi.id });
    assert(a.html().indexOf('Ya, hapus') >= 0 && a.user('rudi.p'), 'A29 hapus meminta konfirmasi dulu');
    a.click('delete-cancel');
    assert(a.user('rudi.p') && a.html().indexOf('Ya, hapus') < 0, 'A30 batal hapus -> data utuh');
    a.P8.repositories.submissionRepository.save({ id: 'SUB_R', assignmentId: 'ASSIGN_DEMO2', classId: 'CLASS_DEMO', studentId: rudi.id, status: 'SUBMITTED' });
    a.click('delete-ask', { 'data-user': rudi.id });
    a.click('delete-user', { 'data-user': rudi.id });
    assert(!a.user('rudi.p'), 'A31 siswa dihapus');
    assert(!a.P8.repositories.submissionRepository.getById('SUB_R'), 'A32 kiriman tugas siswa ikut dibersihkan');
    /* guru admin sekolah dihapus -> admin dialihkan */
    a.P8.repositories.userRepository.save({ id: 'USER_G2', role: 'INSTRUCTOR', name: 'Guru Dua', username: 'guru2', organizationId: 'ORG_DEMO', classIds: [], status: 'ACTIVE', passwordHash: 'x', salt: 's' });
    a.tab('guru');
    a.click('delete-user', { 'data-user': 'USER_GURU' });
    assert(!a.user('guru'), 'A33 guru dihapus');
    assert(a.P8.repositories.classRepository.getById('CLASS_DEMO').instructorIds.indexOf('USER_GURU') < 0, 'A34 guru dihapus dari daftar pengajar kelas');
    const orgD = a.P8.repositories.organizationRepository.getById('ORG_DEMO');
    assert(orgD.adminUserId === 'USER_G2', 'A35 admin sekolah dialihkan ke guru lain saat admin lama dihapus');
}

/* ---------- B. GURU ---------- */
{
    const g = boot('guru');
    const repo = g.P8.repositories;
    /* sekolah lain + siswa sekolah lain (tidak boleh terlihat/terkelola) */
    repo.organizationRepository.save({ id: 'ORG_B', name: 'SMK Bhakti 2', type: 'SCHOOL', status: 'ACTIVE', createdBy: 'SYSTEM' });
    repo.userRepository.save({ id: 'USER_LUAR', role: 'STUDENT', name: 'Siswa Luar', username: 'luar', organizationId: 'ORG_B', classIds: [], status: 'ACTIVE', passwordHash: 'x', salt: 's' });
    g.ctx.AuthUI.refresh();
    const h = g.html();
    assert(h.indexOf('Data Siswa') >= 0 && h.indexOf('Sekolah Saya') >= 0, 'B1 guru melihat bagian Data Siswa sekolahnya');
    assert(h.indexOf('Siswa Uji A') >= 0 && h.indexOf('Siswa Uji B') >= 0, 'B2 siswa sekolahnya tampil');
    assert(h.indexOf('Siswa Luar') < 0, 'B3 siswa sekolah lain TIDAK tampil');
    assert(h.indexOf('data-tab="guru"') < 0, 'B4 guru tidak punya tab kelola guru');
    assert(h.indexOf('delete-ask') < 0, 'B5 guru tidak punya tombol hapus permanen');

    /* tambah siswa: sekolah otomatis = sekolah guru */
    g.click('add-user-open', { 'data-role': 'STUDENT' });
    assert(g.html().indexOf('name="organizationId"') < 0, 'B6 form guru tidak menampilkan pilihan sekolah');
    g.submit('user-save', { mode: 'add', id: '', role: 'STUDENT', name: 'Tono Wijaya', username: 'tono', nis: '777', password: 'tono123', organizationId: 'ORG_B' }, ['CLASS_DEMO']);
    const tono = g.user('tono');
    assert(tono && tono.organizationId === 'ORG_DEMO', 'B7 sekolah siswa dipaksa mengikuti sekolah guru (abaikan manipulasi form)');
    assert(repo.classRepository.getById('CLASS_DEMO').studentIds.indexOf(tono.id) >= 0, 'B8 siswa baru langsung masuk kelas yang dipilih');

    /* guru tidak bisa menambah guru / mengubah siswa sekolah lain */
    g.submit('user-save', { mode: 'add', id: '', role: 'INSTRUCTOR', name: 'Guru Palsu', username: 'palsu', password: 'abc123' });
    assert(!g.user('palsu'), 'B9 guru tidak dapat membuat akun guru');
    g.submit('user-save', { mode: 'edit', id: 'USER_LUAR', role: 'STUDENT', name: 'Diretas', username: 'luar', password: '' });
    assert(repo.userRepository.getById('USER_LUAR').name === 'Siswa Luar', 'B10 guru tidak dapat mengedit siswa sekolah lain');
    g.click('toggle-user', { 'data-user': 'USER_LUAR' });
    assert(repo.userRepository.getById('USER_LUAR').status === 'ACTIVE', 'B11 guru tidak dapat menonaktifkan siswa sekolah lain');
    g.click('detail-user', { 'data-user': 'USER_LUAR' });
    assert(g.html().indexOf('Siswa Luar') < 0, 'B12 detail siswa sekolah lain tidak dibuka');

    /* edit siswa sendiri */
    g.click('edit-user', { 'data-user': tono.id });
    g.submit('user-save', { mode: 'edit', id: tono.id, role: 'STUDENT', name: 'Tono W.', username: 'tono', nis: '778', password: '', status: 'INACTIVE' }, ['CLASS_DEMO']);
    const t2 = repo.userRepository.getById(tono.id);
    assert(t2.name === 'Tono W.' && t2.nis === '778' && t2.status === 'INACTIVE', 'B13 guru dapat mengedit data & menonaktifkan siswa sekolahnya');
    assert(g.P8.authService.login('tono', 'tono123').success === false, 'B14 siswa nonaktif tidak bisa masuk');

    /* detail */
    g.click('detail-user', { 'data-user': 'USER_SISWA1' });
    assert(g.html().indexOf('Detail siswa') >= 0 && g.html().indexOf('Diagnosis: Starter Tidak Berputar') >= 0, 'B15 Detail siswa menampilkan tugas kelas');
    g.click('detail-user', { 'data-user': 'USER_SISWA1' });

    /* Detail dari panel kelas (tombol yang sebelumnya error) */
    g.click('toggle-class', { 'data-class': 'CLASS_DEMO' });
    g.click('open-student', { 'data-class': 'CLASS_DEMO', 'data-student': 'USER_SISWA1' });
    assert(g.html().indexOf('Detail siswa') >= 0 && g.html().indexOf('Dashboard gagal dimuat') < 0, 'B16 tombol Detail di panel kelas berfungsi (tanpa error)');
    g.click('open-student', { 'data-class': 'CLASS_DEMO', 'data-student': 'USER_SISWA1' });

    /* keluarkan dari kelas */
    g.click('remove-ask', { 'data-class': 'CLASS_DEMO', 'data-student': 'USER_SISWA2' });
    assert(g.html().indexOf('Keluarkan?') >= 0, 'B17 keluarkan siswa meminta konfirmasi');
    g.click('remove-student', { 'data-class': 'CLASS_DEMO', 'data-student': 'USER_SISWA2' });
    assert(repo.classRepository.getById('CLASS_DEMO').studentIds.indexOf('USER_SISWA2') < 0, 'B18 siswa keluar dari kelas');
    assert(!!g.user('siswa2'), 'B19 akun siswa tetap ada setelah dikeluarkan dari kelas');

    /* ---- edit kelas ---- */
    assert(g.html().indexOf('data-au-act="edit-class"') >= 0, 'B20 tombol Edit tersedia pada setiap kelas');
    g.click('edit-class', { 'data-class': 'CLASS_DEMO' });
    assert(g.html().indexOf('data-au-form="edit-class"') >= 0 && g.html().indexOf('Edit kelas') >= 0, 'B21 form edit kelas terbuka');
    g.submit('edit-class', { classId: 'CLASS_DEMO', name: 'Kelas Uji 1 (Pagi)', subject: 'Kelistrikan Body', academicYear: '2026/2027' });
    const c = repo.classRepository.getById('CLASS_DEMO');
    assert(c.name === 'Kelas Uji 1 (Pagi)' && c.subject === 'Kelistrikan Body' && c.academicYear === '2026/2027', 'B22 nama, mapel, tahun ajaran kelas berubah');
    assert(c.joinEnabled === false, 'B23 checkbox kode gabung dimatikan -> joinEnabled false');
    assert(g.html().indexOf('Kelas Uji 1 (Pagi)') >= 0 && g.html().indexOf('Kelas &quot;Kelas Uji 1 (Pagi)&quot; diperbarui') >= 0, 'B24 tampilan & pesan sukses diperbarui');
    g.click('edit-class', { 'data-class': 'CLASS_DEMO' });
    g.submit('edit-class', { classId: 'CLASS_DEMO', name: '  ', subject: '', academicYear: '' });
    assert(repo.classRepository.getById('CLASS_DEMO').name === 'Kelas Uji 1 (Pagi)', 'B25 nama kelas kosong ditolak');
    /* guru lain tidak dapat mengedit kelas ini */
    const other = repo.classRepository.save({ id: 'CLASS_X', organizationId: 'ORG_B', name: 'Kelas Orang Lain', subject: 's', instructorIds: ['USER_LAIN'], studentIds: [], academicYear: '2026', status: 'ACTIVE', joinCode: 'ZZZ-1', joinEnabled: true, joinExpiresAt: null });
    g.submit('edit-class', { classId: 'CLASS_X', name: 'Dibajak', subject: '', academicYear: '' });
    assert(repo.classRepository.getById('CLASS_X').name === 'Kelas Orang Lain', 'B26 guru tidak dapat mengedit kelas milik guru lain');

    /* arsip & aktifkan kembali */
    g.click('edit-class', { 'data-class': 'CLASS_DEMO' });
    g.click('archive-class', { 'data-class': 'CLASS_DEMO' });
    assert(repo.classRepository.getById('CLASS_DEMO').status === 'ARCHIVED' && g.html().indexOf('Kelas Diarsipkan') >= 0, 'B27 kelas dapat diarsipkan & muncul di daftar arsip');
    g.click('restore-class', { 'data-class': 'CLASS_DEMO' });
    assert(repo.classRepository.getById('CLASS_DEMO').status === 'ACTIVE', 'B28 kelas dapat diaktifkan kembali');
}


/* ---------- D. SUPERADMIN: sekolah & kelas ---------- */
{
    const a = boot('superadmin');
    const R = a.P8.repositories;
    assert(['sekolah', 'guru', 'siswa', 'kelas'].every((k) => a.html().indexOf('data-kind="' + k + '"') >= 0), 'D1 tombol tambah cepat: sekolah, guru, siswa, kelas');
    assert(a.html().indexOf('data-tab="kelas"') >= 0, 'D2 tab Data Kelas tersedia');

    /* tambah sekolah (+ admin) lewat tombol tambah cepat */
    a.click('quick-add', { 'data-kind': 'sekolah' });
    assert(a.html().indexOf('data-au-form="org-save"') >= 0 && a.html().indexOf('Tambah sekolah baru') >= 0, 'D3 tambah cepat membuka form sekolah');
    a.submit('org-save', { mode: 'add', id: '', name: 'SMK Maju Jaya', type: 'SCHOOL', address: 'Jl. Merdeka 1', adminName: 'Pak Admin', adminUsername: 'adminmaju', adminPassword: 'rahasia1' });
    const org = R.organizationRepository.list().filter((o) => o.name === 'SMK Maju Jaya')[0];
    assert(org && org.status === 'ACTIVE' && org.address === 'Jl. Merdeka 1', 'D4 sekolah baru tersimpan & langsung aktif');
    const adm = a.user('adminmaju');
    assert(adm && adm.role === 'INSTRUCTOR' && adm.organizationId === org.id && adm.orgAdmin === true && org.adminUserId === adm.id, 'D5 akun admin sekolah dibuat dan ditautkan');
    assert(a.P8.authService.login('adminmaju', 'rahasia1').success === true, 'D6 admin sekolah baru bisa login');
    assert(a.html().indexOf('SMK Maju Jaya') >= 0 && a.html().indexOf('ditambahkan beserta admin') >= 0, 'D7 tampil di tabel + pesan sukses');

    /* validasi sekolah */
    a.click('add-org-open');
    a.submit('org-save', { mode: 'add', id: '', name: 'smk maju jaya', type: 'SCHOOL' });
    assert(a.html().indexOf('sudah dipakai') >= 0, 'D8 nama sekolah ganda ditolak (tanpa beda huruf besar/kecil)');
    a.submit('org-save', { mode: 'add', id: '', name: '', type: 'SCHOOL' });
    assert(a.html().indexOf('Nama sekolah wajib') >= 0, 'D9 nama kosong ditolak');
    a.submit('org-save', { mode: 'add', id: '', name: 'Sekolah X', type: 'SCHOOL', adminName: 'A', adminUsername: '', adminPassword: '' });
    assert(a.html().indexOf('harus diisi lengkap') >= 0 && !R.organizationRepository.list().some((o) => o.name === 'Sekolah X'), 'D10 data admin setengah terisi ditolak');
    a.submit('org-save', { mode: 'add', id: '', name: 'Sekolah X', type: 'SCHOOL', adminName: 'A', adminUsername: 'adminmaju', adminPassword: '123456' });
    assert(a.html().indexOf('sudah dipakai') >= 0 && !R.organizationRepository.list().some((o) => o.name === 'Sekolah X'), 'D11 username admin ganda ditolak');

    /* edit sekolah + ganti admin */
    R.userRepository.save({ id: 'USER_G3', role: 'INSTRUCTOR', name: 'Guru Tiga', username: 'guru3', organizationId: org.id, classIds: [], status: 'ACTIVE', passwordHash: 'x', salt: 's' });
    a.click('edit-org', { 'data-org': org.id });
    assert(a.html().indexOf('Edit sekolah') >= 0 && a.html().indexOf('Guru Tiga') >= 0, 'D12 form edit sekolah menampilkan guru sebagai pilihan admin');
    a.submit('org-save', { mode: 'edit', id: org.id, name: 'SMK Maju Jaya 1', type: 'TRAINING_CENTER', address: 'Jl. Baru 2', status: 'ACTIVE', adminUserId: 'USER_G3' });
    const org2 = R.organizationRepository.getById(org.id);
    assert(org2.name === 'SMK Maju Jaya 1' && org2.type === 'TRAINING_CENTER' && org2.address === 'Jl. Baru 2', 'D13 nama, jenis, alamat sekolah berubah');
    assert(org2.adminUserId === 'USER_G3' && R.userRepository.getById('USER_G3').orgAdmin === true && R.userRepository.getById(adm.id).orgAdmin === false, 'D14 admin sekolah dipindahkan (flag lama dicabut)');
    a.click('edit-org', { 'data-org': org.id });
    a.submit('org-save', { mode: 'edit', id: org.id, name: 'SMK Maju Jaya 1', type: 'SCHOOL', address: '', status: 'ACTIVE', adminUserId: 'USER_SISWA1' });
    assert(a.html().indexOf('harus guru dari sekolah ini') >= 0 && R.organizationRepository.getById(org.id).adminUserId === 'USER_G3', 'D15 admin sekolah wajib guru dari sekolah itu');

    /* nonaktifkan sekolah -> hilang dari pilihan; aktifkan lagi */
    a.click('toggle-org', { 'data-org': org.id });
    assert(R.organizationRepository.getById(org.id).status === 'ARCHIVED', 'D16 sekolah dinonaktifkan');
    a.click('quick-add', { 'data-kind': 'guru' });
    assert(a.html().indexOf('SMK Maju Jaya 1') < 0 || a.html().indexOf('<option value="' + org.id + '"') < 0, 'D17 sekolah nonaktif tidak muncul di pilihan sekolah form guru');
    a.tab('sekolah');
    a.click('toggle-org', { 'data-org': org.id });
    assert(R.organizationRepository.getById(org.id).status === 'ACTIVE', 'D18 sekolah diaktifkan kembali');

    /* hapus sekolah: ditolak bila masih ada isi, boleh bila kosong */
    a.click('org-delete-ask', { 'data-org': org.id });
    assert(a.html().indexOf('Ya, hapus') >= 0, 'D19 hapus sekolah minta konfirmasi');
    a.click('delete-org', { 'data-org': org.id });
    assert(!!R.organizationRepository.getById(org.id) && a.html().indexOf('masih punya') >= 0, 'D20 sekolah berisi guru/siswa/kelas TIDAK bisa dihapus');
    a.click('quick-add', { 'data-kind': 'sekolah' });
    a.submit('org-save', { mode: 'add', id: '', name: 'Sekolah Kosong', type: 'SCHOOL' });
    const kosong = R.organizationRepository.list().filter((o) => o.name === 'Sekolah Kosong')[0];
    a.click('delete-org', { 'data-org': kosong.id });
    assert(!R.organizationRepository.getById(kosong.id), 'D21 sekolah kosong dapat dihapus');

    /* kelas: tambah */
    a.click('quick-add', { 'data-kind': 'kelas' });
    assert(a.html().indexOf('data-au-form="class-admin-save"') >= 0, 'D22 tambah cepat membuka form kelas');
    a.submit('class-admin-save', { mode: 'add', id: '', name: 'X TKR 2', subject: 'Kelistrikan', academicYear: '2026/2027', organizationId: org.id }, ['USER_G3', 'USER_GURU']);
    const kls = R.classRepository.list().filter((c) => c.name === 'X TKR 2')[0];
    assert(kls && kls.organizationId === org.id && kls.subject === 'Kelistrikan' && kls.joinCode, 'D23 kelas baru tersimpan beserta kode gabung');
    assert(kls.instructorIds.join() === 'USER_G3', 'D24 hanya guru dari sekolah yang sama diterapkan sebagai pengajar');
    a.click('add-class-open');
    a.submit('class-admin-save', { mode: 'add', id: '', name: 'Tanpa Sekolah', subject: '', academicYear: '', organizationId: '' });
    assert(a.html().indexOf('Pilih sekolah') >= 0 && !R.classRepository.list().some((c) => c.name === 'Tanpa Sekolah'), 'D25 kelas tanpa sekolah ditolak');

    /* kelas: edit, arsip, hapus */
    a.click('edit-class-admin', { 'data-class': kls.id });
    a.submit('class-admin-save', { mode: 'edit', id: kls.id, name: 'X TKR 2 Pagi', subject: 'Kelistrikan Body', academicYear: '2027/2028', status: 'ACTIVE' }, ['USER_G3', 'USER_G3']);
    const k2 = R.classRepository.getById(kls.id);
    assert(k2.name === 'X TKR 2 Pagi' && k2.subject === 'Kelistrikan Body' && k2.academicYear === '2027/2028', 'D26 data kelas diedit superadmin');
    a.click('toggle-class-admin', { 'data-class': kls.id });
    assert(R.classRepository.getById(kls.id).status === 'ARCHIVED', 'D27 kelas diarsipkan');
    a.click('toggle-class-admin', { 'data-class': kls.id });
    assert(R.classRepository.getById(kls.id).status === 'ACTIVE', 'D28 kelas diaktifkan kembali');
    a.search('pagi');
    assert(a.html().indexOf('X TKR 2 Pagi') >= 0 && a.html().indexOf('Kelas Uji 1') < 0, 'D29 pencarian kelas bekerja');
    a.search('');
    /* hapus kelas membersihkan tugas, kiriman, dan keanggotaan siswa */
    R.userRepository.save({ id: 'USER_S9', role: 'STUDENT', name: 'Siswa 9', username: 's9', organizationId: org.id, classIds: [kls.id], status: 'ACTIVE', passwordHash: 'x', salt: 's' });
    const kk = R.classRepository.getById(kls.id); kk.studentIds.push('USER_S9'); R.classRepository.save(kk);
    R.assignmentRepository.save({ id: 'ASSIGN_K', classId: kls.id, title: 'T', type: 'LESSON', status: 'PUBLISHED' });
    R.submissionRepository.save({ id: 'SUB_K', assignmentId: 'ASSIGN_K', classId: kls.id, studentId: 'USER_S9', status: 'SUBMITTED' });
    a.click('class-delete-ask', { 'data-class': kls.id });
    assert(a.html().indexOf('Hapus kelas') >= 0 && R.classRepository.getById(kls.id), 'D30 hapus kelas minta konfirmasi');
    a.click('delete-class-admin', { 'data-class': kls.id });
    assert(!R.classRepository.getById(kls.id) && !R.assignmentRepository.getById('ASSIGN_K') && !R.submissionRepository.getById('SUB_K'), 'D31 kelas + tugas + kiriman terhapus');
    assert(R.userRepository.getById('USER_S9').classIds.indexOf(kls.id) < 0, 'D32 siswa tidak lagi menyimpan id kelas yang dihapus');
}

/* ---------- D2. guru tidak boleh memakai aksi superadmin ---------- */
{
    const g = boot('guru');
    const R = g.P8.repositories;
    assert(g.html().indexOf('data-au-act="quick-add"') < 0 && g.html().indexOf('org-save') < 0, 'E1 dashboard guru tidak memuat menu tambah sekolah/kelas lintas sekolah');
    g.submit('org-save', { mode: 'add', id: '', name: 'Sekolah Siluman', type: 'SCHOOL' });
    assert(!R.organizationRepository.list().some((o) => o.name === 'Sekolah Siluman'), 'E2 guru tidak dapat menambah sekolah (dicek di fungsi, bukan hanya tombol)');
    g.click('delete-org', { 'data-org': 'ORG_DEMO' });
    assert(!!R.organizationRepository.getById('ORG_DEMO'), 'E3 guru tidak dapat menghapus sekolah');
    g.click('toggle-org', { 'data-org': 'ORG_DEMO' });
    assert(R.organizationRepository.getById('ORG_DEMO').status === 'ACTIVE', 'E4 guru tidak dapat menonaktifkan sekolah');
    g.submit('class-admin-save', { mode: 'edit', id: 'CLASS_DEMO', name: 'Dibajak', subject: '', academicYear: '' });
    assert(R.classRepository.getById('CLASS_DEMO').name !== 'Dibajak', 'E5 guru tidak dapat memakai form kelas superadmin');
    g.click('delete-class-admin', { 'data-class': 'CLASS_DEMO' });
    assert(!!R.classRepository.getById('CLASS_DEMO'), 'E6 guru tidak dapat menghapus kelas lewat aksi superadmin');
}

/* ---------- C. SERVER: endpoint admin baru ---------- */
{
    const { openDb } = require(path.join(ROOT, 'backend', 'db.js'));
    const { seed } = require(path.join(ROOT, 'backend', 'seed.js'));
    const { api } = require(path.join(ROOT, 'backend', 'api.js'));
    const db = openDb(':memory:'); seed(db); fixtures.seedServer(db);
    const svc = api(db, {});
    const call = (fn, headers, body, params) => {
        const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = String(b); } };
        fn({ headers: headers || {}, method: 'X' }, res, body, params || {});
        let j = null; try { j = JSON.parse(res.body); } catch (e) { /* noop */ }
        return { status: res.status, json: j };
    };
    const login = (u, p) => call(svc.login, {}, { username: u, password: p });
    const tok = login('superadmin', 'superadmin123').json.data.token;
    const H = { authorization: 'Bearer ' + tok };
    let r = call(svc.adminUpdateUser, H, { name: 'Andi P. Baru', nis: '999', email: 'a@x.id', password: 'sandibaru1' }, { userId: 'USER_SISWA1' });
    assert(r.status === 200 && r.json.data.user.name === 'Andi P. Baru' && r.json.data.user.nis === '999', 'C1 admin dapat memperbarui data siswa di server');
    assert(login('siswa', 'sandibaru1').status === 200 && login('siswa', 'siswa123').status === 401, 'C2 sandi baru berlaku & sandi lama tidak');
    r = call(svc.adminUpdateUser, H, { username: 'guru' }, { userId: 'USER_SISWA1' });
    assert(r.status === 409, 'C3 username ganda ditolak server');
    r = call(svc.adminUpdateUser, {}, { name: 'x' }, { userId: 'USER_SISWA1' });
    assert(r.status === 401, 'C4 tanpa token ditolak');
    const gtok = login('guru', 'guru123').json.data.token;
    r = call(svc.adminUpdateUser, { authorization: 'Bearer ' + gtok }, { name: 'x' }, { userId: 'USER_SISWA1' });
    assert(r.status === 401, 'C5 guru tidak boleh memakai endpoint admin');
    r = call(svc.adminUpdateUser, H, { name: 'x' }, { userId: 'USER_SUPERADMIN' });
    assert(r.status === 403, 'C6 akun Superadmin tidak dapat diubah lewat endpoint ini');
    r = call(svc.adminCreateUser, H, { name: 'Baru', username: 'baru1', role: 'STUDENT', password: 'abc123', organizationId: 'ORG_TIDAK_ADA' });
    assert(r.status === 200 && r.json.data.user.organizationId === null, 'C7 sekolah tak dikenal server tidak membuat error FK (diabaikan)');
    r = call(svc.adminSetUserStatus, H, { status: 'DISABLED' }, { userId: r.json.data.id });
    assert(r.status === 200 && r.json.data.status === 'DISABLED', 'C8 status akun dapat diubah lewat userId yang benar');
}

console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed ? 1 : 0);
