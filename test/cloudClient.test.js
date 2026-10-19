'use strict';
/* ============================================================
   CLOUD CLIENT TEST — authUI.js + cloud.js asli di beberapa "perangkat"
   (masing-masing punya localStorage/sessionStorage sendiri) yang berbagi
   satu database Postgres lewat fungsi sl_* (supabase/schema.sql).
   Ini mereproduksi masalah awal: data sekolah/guru/siswa berbeda antar perangkat.

     SL_PGURL="postgresql://postgres@/sltest?host=/tmp/slpg&port=54329" node test/cloudClient.test.js
   Database harus baru (jalankan skema pada database kosong). Tanpa SL_PGURL tes dilewati.
   Run: node test/cloudClient.test.js
   ============================================================ */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const URL_PG = process.env.SL_PGURL;
if (!URL_PG) { console.log('CLOUD CLIENT TEST dilewati (SL_PGURL tidak diatur)\n=== RESULTS: 0 passed, 0 failed ==='); process.exit(0); }

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.log('  FAIL: ' + msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- jaringan palsu -> Postgres sungguhan (peran anon) ---------- */
const net = { down: false, calls: 0 };
function lit(k, v) {
    if (v === null || v === undefined) return 'NULL';
    if (k === 'p_since') return '$q$' + v + '$q$::timestamptz';
    if (typeof v === 'object') return '$q$' + JSON.stringify(v) + '$q$::jsonb';
    return '$q$' + String(v) + '$q$';
}
function fakeFetch(url, opts) {
    if (net.down) return Promise.reject(new TypeError('Failed to fetch'));
    net.calls++;
    const fn = String(url).split('/rpc/')[1];
    const args = JSON.parse(opts.body || '{}');
    const named = Object.keys(args).map((k) => k + ' => ' + lit(k, args[k])).join(', ');
    let out, status = 200;
    try {
        out = execFileSync('psql', [URL_PG, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', 'set role anon; select public.' + fn + '(' + named + ')'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) { status = 400; out = JSON.stringify({ message: String(e.stderr || e.message) }); }
    return Promise.resolve({ ok: status === 200, status, text: () => Promise.resolve(out) });
}
function sql(stmt) { return execFileSync('psql', [URL_PG, '-X', '-q', '-At', '-c', stmt], { encoding: 'utf8' }).trim(); }
function rpc(fn, args) {
    const named = Object.keys(args || {}).map((k) => k + ' => ' + lit(k, args[k])).join(', ');
    return JSON.parse(execFileSync('psql', [URL_PG, '-X', '-q', '-At', '-c', 'set role anon; select public.' + fn + '(' + named + ')'], { encoding: 'utf8' }).trim());
}

/* ---------- perangkat ---------- */
function makeEl(attrs) {
    const el = { _a: Object.assign({}, attrs || {}), parentNode: null, value: '', checked: false, textContent: '', style: {},
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(el._a, k) ? el._a[k] : null; },
        setAttribute(k, v) { el._a[k] = v; }, querySelector() { return null; }, querySelectorAll() { return []; }, focus() {}, closest() { return null; } };
    return el;
}
/* page: 'login' | 'superadmin' | 'app' */
function device(store, page) {
    const ls = store.ls, ss = store.ss, byId = {}, docL = {};
    const host = makeEl(page === 'app' ? {} : { 'data-portal': page === 'superadmin' ? 'superadmin' : 'general' });
    host.innerHTML = '';
    byId[page === 'app' ? 'au-dashboard' : 'au-login'] = host;
    const ctx = {
        console, setTimeout, clearTimeout, setInterval, clearInterval, Math, Date, JSON, parseInt, parseFloat, String, Number, Object, Array, RegExp, isNaN, Promise,
        fetch: fakeFetch,
        document: {
            readyState: 'complete', body: makeEl(), getElementById(id) { return byId[id] || null; },
            querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return makeEl(); },
            addEventListener(t, fn) { (docL[t] = docL[t] || []).push(fn); }
        },
        localStorage: {
            getItem: (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null),
            setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; },
            get length() { return Object.keys(ls).length; }, key: (i) => Object.keys(ls)[i] || null
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
    ctx.STARTERLAB_SUPABASE = { url: 'https://proyek-uji.supabase.co', anonKey: 'eyJ.uji.kunci' };
    vm.createContext(ctx);
    ['instructorPlatform.js', 'cloud.js', 'authUI.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
    const app = { ctx, P8: ctx.Phase8, CL: ctx.StarterCloud, AU: ctx.AuthUI, host, ls, ss };
    app.html = () => host.innerHTML;
    app.fire = (type, e) => { (docL[type] || []).forEach((f) => f(e)); };
    app.click = (action, data) => { const el = makeEl(Object.assign({ 'data-au-act': action }, data || {})); el.parentNode = ctx.document; app.fire('click', { target: el }); };
    app.tab = (t) => app.fire('click', { target: Object.assign(makeEl({ 'data-au-tab': t }), { parentNode: ctx.document }) });
    app.submit = (kind, fields, checks) => {
        const form = makeEl({ 'data-au-form': kind }), elements = {};
        Object.keys(fields).forEach((k) => { elements[k] = { value: fields[k] }; form[k] = { value: fields[k] }; });
        form.elements = elements;
        form.querySelectorAll = () => (checks || []).map((v) => ({ value: v, checked: true }));
        form.querySelector = () => null;
        app.fire('submit', { target: form, preventDefault() {} });
    };
    app.users = () => app.P8.repositories.userRepository.list();
    app.user = (n) => app.users().filter((x) => x.username === n)[0] || null;
    app.session = () => { const v = ss.starterSim_auth_session_v1; return v ? JSON.parse(v) : null; };
    return app;
}
const newStore = () => ({ ls: {}, ss: {} });

(async () => {
    console.log('CLOUD CLIENT TEST');

    /* ===== 1. Superadmin pertama kali (sandi bawaan wajib diganti) ===== */
    const stA = newStore();
    let A = device(stA, 'superadmin');
    assert(A.CL.enabled() === true, '1a cloud aktif bila config terisi');
    A.submit('login', { username: 'superadmin', password: 'salah' });
    await sleep(400);
    assert(A.html().indexOf('salah') >= 0 && !A.session(), '1b sandi salah ditolak server');
    A.submit('login', { username: 'superadmin', password: 'superadmin123' });
    await sleep(400);
    assert(A.html().indexOf('Ganti sandi bawaan') >= 0, '1c sandi bawaan memaksa ganti sandi (diputuskan server)');
    A.submit('force-pw', { newPassword: 'superadmin123', confirmPassword: 'superadmin123' });
    await sleep(100);
    assert(A.html().indexOf('tidak boleh sama') >= 0, '1d sandi baru tidak boleh sama dengan bawaan');
    A.submit('force-pw', { newPassword: 'RahasiaBaru#7', confirmPassword: 'RahasiaBaru#7' });
    await sleep(1200);
    assert(A.session() && A.session().role === 'ADMIN', '1e Superadmin masuk setelah ganti sandi');
    assert(A.ctx.location.href === 'index.html', '1f diarahkan ke aplikasi');
    assert(!!stA.ss.starterLab_cloud_token_v1, '1g token cloud tersimpan di sesi tab');
    assert(JSON.stringify(stA.ls).indexOf('RahasiaBaru') < 0, '1h sandi polos tidak tersimpan di localStorage');

    /* ===== 2. Sekolah mendaftar dari perangkat B (tanpa login) ===== */
    const stB = newStore();
    let B = device(stB, 'login');
    await sleep(500);
    B.tab('school');
    B.submit('school', { name: 'SMK Awan', address: 'Jl. Awan 1', adminName: 'Pak Admin', adminUsername: 'adm', adminPassword: 'rahasia9' });
    await sleep(600);
    assert(B.html().indexOf('terkirim') >= 0, '2a pendaftaran sekolah terkirim ke server');
    assert(sql("select count(*) from public.sl_docs where kind='organizations' and data->>'name'='SMK Awan'") === '1', '2b sekolah ada di database server (bukan hanya di browser B)');
    assert(B.P8.repositories.organizationRepository.list().length === 0, '2c tidak ada salinan lokal liar di perangkat B');

    /* ===== 3. Superadmin di perangkat A melihat & menyetujui ===== */
    A = device(stA, 'app');   /* muat ulang halaman aplikasi di perangkat A (sesi tab sama) */
    await sleep(1500);
    const pend = A.P8.repositories.organizationRepository.list().filter((o) => o.name === 'SMK Awan')[0];
    assert(pend && pend.status === 'PENDING', '3a perangkat A melihat sekolah yang didaftarkan dari perangkat B');
    assert(!pend.pendingAdmin.passwordHash, '3b data pendaftaran tanpa hash sandi');
    A.AU.approveSchool(pend.id);
    await sleep(1200);
    assert(sql("select data->>'status' from public.sl_docs where kind='organizations' and id='" + pend.id + "'") === 'ACTIVE', '3c persetujuan tersimpan di server');
    assert(rpc('sl_login', { p_username: 'adm', p_password: 'rahasia9', p_portal: 'general' }).ok === true, '3d admin sekolah bisa login dengan sandi saat mendaftar');

    /* ===== 4. Perangkat C (lain lagi) melihat sekolah yang sama ===== */
    const stC = newStore();
    let C = device(stC, 'login');
    await sleep(500);
    C.tab('register');
    assert(C.html().indexOf('SMK Awan') >= 0, '4a perangkat C melihat sekolah aktif di daftar pendaftaran');

    /* ===== 5. Admin sekolah login di perangkat B, tambah siswa ===== */
    B.submit('login', { username: 'adm', password: 'rahasia9' });
    await sleep(1500);
    assert(B.session() && B.session().role === 'INSTRUCTOR', '5a admin sekolah login di perangkat B');
    B = device(stB, 'app');
    await sleep(1500);
    assert(B.user('adm') && B.user('adm').organizationId === pend.id, '5b data admin sekolah termuat di perangkat B');
    B.click('add-user-open', { 'data-role': 'STUDENT' });
    B.submit('user-save', { mode: 'add', id: '', role: 'STUDENT', name: 'Budi Santoso', username: 'budi', email: '', password: 'budi1234', organizationId: pend.id, status: '', nis: '123' });
    await sleep(1000);
    assert(!!B.user('budi'), '5c siswa tersimpan lokal');
    assert(sql("select count(*) from public.sl_docs where kind='users' and data->>'username'='budi'") === '1', '5d siswa tersimpan di server');
    assert(JSON.stringify(sql("select data::text from public.sl_docs where kind='users' and data->>'username'='budi'")).indexOf('passwordHash') < 0, '5e server tidak menyimpan hash FNV browser');
    assert(rpc('sl_login', { p_username: 'budi', p_password: 'budi1234', p_portal: 'general' }).ok === true, '5f sandi siswa tersimpan aman di server (bcrypt) dan bisa dipakai login');

    /* ===== 6. Siswa login di perangkat C ===== */
    C.tab('login');
    C.submit('login', { username: 'budi', password: 'budi1234' });
    await sleep(1500);
    assert(C.session() && C.session().role === 'STUDENT', '6a siswa yang dibuat guru di perangkat B bisa login di perangkat C');
    C = device(stC, 'app');
    await sleep(1200);
    assert(C.user('budi') && C.users().length <= 2, '6b siswa hanya memuat data yang berhak dilihatnya (dirinya + guru)');
    assert(!C.user('superadmin'), '6c siswa tidak menerima akun Superadmin');

    /* ===== 7. Pendaftaran publik siswa + persetujuan lintas perangkat ===== */
    const stD = newStore();
    const D = device(stD, 'login');
    await sleep(500);
    D.tab('register');
    D.submit('register', { role: 'STUDENT', name: 'Citra Dewi', username: 'citra', email: '', password: 'citra123', organizationId: pend.id });
    await sleep(600);
    assert(D.html().indexOf('Menunggu persetujuan') >= 0, '7a pendaftaran siswa menunggu persetujuan');
    D.tab('login');
    D.submit('login', { username: 'citra', password: 'citra123' });
    await sleep(500);
    assert(!D.session() && D.html().indexOf('menunggu persetujuan') >= 0, '7b siswa PENDING belum bisa masuk');
    await B.CL.pull(false);
    const citra = B.user('citra');
    assert(citra && citra.status === 'PENDING', '7c guru di perangkat B melihat pendaftar baru (tanpa muat ulang manual)');
    B.AU.approveStudent(citra.id);
    await sleep(1200);
    D.submit('login', { username: 'citra', password: 'citra123' });
    await sleep(1500);
    assert(D.session() && D.session().username === 'citra', '7d setelah disetujui guru, siswa masuk dari perangkat D');

    /* ===== 8. Progres belajar mengikuti akun ke perangkat lain ===== */
    C.ls.starterHub_v1 = JSON.stringify({ materi: { m1: { paham: true }, m2: { paham: true } }, quiz: { q1: { best: 80 } } });
    await C.CL._test.progressTick();
    assert(sql("select count(*) from public.sl_progress where user_id = '" + C.user('budi').id + "'") === '1', '8a progres siswa terkirim ke server');
    const stC2 = newStore();
    let C2 = device(stC2, 'login');
    await sleep(300);
    C2.submit('login', { username: 'budi', password: 'budi1234' });
    await sleep(1500);
    assert(/"m2"/.test(stC2.ls.starterHub_v1 || ''), '8b progres muncul di perangkat baru setelah login');
    await B.CL.pullOrgProgress();
    const stashKey = 'starterSim_data_stash_v1_u:budi';
    assert(!!B.ls[stashKey] && /m2/.test(B.ls[stashKey]), '8c guru menerima progres siswa untuk dashboard');

    /* ===== 9. Perubahan terlarang dikembalikan ===== */
    const budi = C.P8.repositories.userRepository.getById(C.user('budi').id);
    budi.role = 'ADMIN';
    C.P8.repositories.userRepository.save(budi);
    await C.CL.push();
    await sleep(800);
    assert(C.user('budi').role === 'STUDENT', '9a peningkatan hak siswa -> ADMIN ditolak server dan dikembalikan');
    assert(sql("select data->>'role' from public.sl_docs where kind='users' and data->>'username'='budi'") === 'STUDENT', '9b server tetap STUDENT');
    assert(C.html().indexOf('ditolak') >= 0, '9c pengguna diberi tahu bahwa perubahan ditolak');

    /* ===== 10. Offline lalu online ===== */
    net.down = true;
    const adm = B.P8.repositories.userRepository.getById(B.user('adm').id);
    adm.name = 'Pak Admin (offline)';
    B.P8.repositories.userRepository.save(adm);
    const okOff = await B.CL.push();
    assert(okOff === false && B.CL.status().state === 'offline', '10a offline: gagal kirim, status offline, data tetap di lokal');
    assert(B.user('adm').name === 'Pak Admin (offline)', '10b perubahan offline tidak hilang');
    net.down = false;
    await B.CL.push();
    assert(sql("select data->>'name' from public.sl_docs where kind='users' and data->>'username'='adm'") === 'Pak Admin (offline)', '10c setelah online, perubahan terkirim otomatis');
    const AA = device(stA, 'app'); await sleep(1500);
    assert(AA.user('adm') && AA.user('adm').name === 'Pak Admin (offline)', '10d perangkat A ikut melihat perubahan');

    /* ===== 11. Keluar membersihkan data (komputer sekolah dipakai bergantian) ===== */
    B.AU.logout();
    await sleep(1500);
    assert(!B.ls.starterSim_auth_session_v1 && !B.ss.starterLab_cloud_token_v1, '11a sesi dan token dibuang');
    const dbAfter = JSON.parse(B.ls.starterSim_phase8_db_v1 || '{"users":{}}');
    assert(Object.keys(dbAfter.users || {}).length === 0 && Object.keys(dbAfter.organizations || {}).length === 0, '11b data sekolah/siswa dihapus dari browser setelah keluar');
    assert(!Object.keys(B.ls).some((k) => k.indexOf('starterSim_data_stash_v1_') === 0), '11c progres siswa lain dihapus dari browser guru');

    /* ===== 12. Kesalahan konfigurasi / server ===== */
    const stE = newStore();
    const E = device(stE, 'login');
    E.ctx.StarterCloud.enabled();
    net.down = true;
    E.submit('login', { username: 'adm', password: 'rahasia9' });
    await sleep(500);
    assert(E.html().indexOf('terhubung') >= 0 && !E.session(), '12a server tak terjangkau: pesan jelas, tidak login lokal diam-diam');
    net.down = false;

    /* ===== 13. Data lokal lama dikarantina (id lama bisa bentrok) ===== */
    const stF = newStore();
    stF.ls.starterSim_phase8_db_v1 = JSON.stringify({ users: { USER_001: { id: 'USER_001', role: 'STUDENT', name: 'Lama', username: 'lama', status: 'ACTIVE' } }, organizations: {}, classes: {}, assignments: {}, submissions: {}, courses: {}, contents: {}, caseRefs: {}, rubrics: {}, achievements: {}, assessments: {}, audit: [], syncQueue: [], notifications: [], activity: [] });
    const F = device(stF, 'login');
    await sleep(300);
    assert(!F.user('lama'), '13a data lokal lama tidak ikut dipakai/dikirim');
    assert(/USER_001/.test(stF.ls.starterSim_phase8_db_legacy_backup_v1 || ''), '13b data lokal lama disimpan sebagai cadangan');
    assert(sql("select count(*) from public.sl_docs where data->>'username'='lama'") === '0', '13c data lama tidak bocor ke server');

    console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
