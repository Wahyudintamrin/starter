process.env.SIM_SUPERADMIN_PASSWORD = 'superadmin123'; /* tes mewakili instalasi dengan sandi yang diatur admin */
/* ============================================================
   BACKEND TEST — progress tracking, RBAC, dashboard guru, CSV
   Menjalankan backend (node:sqlite in-memory) + handler REST
   secara langsung (tanpa port). Tidak mengubah engine simulasi.
   ============================================================ */
'use strict';
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { openDb } = require(path.join(ROOT, 'backend', 'db.js'));
const seedMod = require(path.join(ROOT, 'backend', 'seed.js'));
const svc = require(path.join(ROOT, 'backend', 'progress.js'));
const auth = require(path.join(ROOT, 'backend', 'auth.js'));
const { api } = require(path.join(ROOT, 'backend', 'api.js'));

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.log('  FAIL: ' + msg); } }
function assert(cond, msg) { ok(!!cond, msg); }

/* ---------- harness ---------- */
const fixtures = require('./fixtures');
const db = openDb(':memory:');
seedMod.seed(db);
/* seed produk: HANYA Superadmin + modul, tanpa sekolah/guru/siswa/kelas contoh */
assert(db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 1 && db.prepare("SELECT username FROM users").get().username === 'superadmin', 'seed produk hanya membuat akun Superadmin');
assert(db.prepare('SELECT COUNT(*) AS c FROM organizations').get().c === 0 && db.prepare('SELECT COUNT(*) AS c FROM classes').get().c === 0, 'seed produk tanpa sekolah & kelas contoh');
assert(db.prepare('SELECT COUNT(*) AS c FROM learning_modules').get().c > 0, 'seed produk tetap memuat modul pembelajaran');
/* ---------- roster siswa XI TKR 1 SMKN 3 Makassar (ensureRoster) ---------- */
const ROSTER_UJI = Array.from({ length: 36 }, (_, i) => 'Siswa Uji ' + String(i + 1).padStart(2, '0'));
{
    const rd = openDb(':memory:');
    seedMod.seed(rd);
    let rr = seedMod.ensureRoster(rd, ROSTER_UJI);
    assert(rr.inserted === 36, 'ensureRoster memasukkan 36 siswa roster (' + rr.inserted + ')');
    assert(rd.prepare('SELECT COUNT(*) AS c FROM users').get().c === 37, 'users = 37 (Superadmin + 36 siswa)');
    const org = rd.prepare('SELECT id, name, status FROM organizations WHERE name = ?').get('SMKN 3 Makassar');
    assert(org && org.status === 'ACTIVE', 'organisasi SMKN 3 Makassar aktif');
    assert(rd.prepare('SELECT COUNT(*) AS c FROM classes WHERE organization_id = ? AND name = ?').get(org.id, 'XI TKR 1').c === 1, 'kelas XI TKR 1 ada di SMKN 3');
    assert(rd.prepare('SELECT COUNT(*) AS c FROM class_memberships').get().c === 36, '36 keanggotaan kelas roster');
    assert(rd.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ? AND organization_id = ?').get('STUDENT', org.id).c === 36, '36 akun siswa di organisasi roster');
    const mu = rd.prepare('SELECT id, name FROM users WHERE username = ?').get('siswauji20');
    assert(mu && mu.name === 'Siswa Uji 20', 'username otomatis: Siswa Uji 20 -> siswauji20');
    rr = seedMod.ensureRoster(rd, ROSTER_UJI);
    assert(rr.inserted === 0 && rd.prepare('SELECT COUNT(*) AS c FROM users').get().c === 37, 'ensureRoster idempoten pada boot berikutnya');
    /* login siswa roster lewat API */
    const svc2 = api(rd, {});
    let rrq = call(svc2.login, { username: 'siswauji20', password: 'siswa123' });
    assert(rrq.status === 200 && rrq.json.data.user.name === 'Siswa Uji 20' && rrq.json.data.user.organizationId === org.id, 'login siswauji20/siswa123 -> Siswa Uji 20 @ SMKN 3');
    rrq = call(svc2.login, { username: 'siswauji20', password: 'salah' });
    assert(rrq.status === 401, 'sandi salah siswa roster -> 401');
    /* impor tidak membuat sekolah/kelas baru bila sudah ada (dicocokkan nama) */
    const rd2 = openDb(':memory:');
    const t0 = new Date().toISOString();
    rd2.prepare('INSERT INTO organizations (id, name, type, status, created_at) VALUES (?,?,?,?,?)').run('ORG_ADA', 'SMKN 3 Makassar', 'SCHOOL', 'ACTIVE', t0);
    rd2.prepare('INSERT INTO classes (id, organization_id, name, program, status, created_at) VALUES (?,?,?,?,?,?)').run('CLS_ADA', 'ORG_ADA', 'XI TKR 1', 'Teknik Kendaraan Ringan', 'ACTIVE', t0);
    seedMod.ensureRoster(rd2, ROSTER_UJI);
    assert(rd2.prepare('SELECT COUNT(*) AS c FROM organizations').get().c === 1 && rd2.prepare('SELECT COUNT(*) AS c FROM classes').get().c === 1, 'org & kelas lama dipakai (tidak diduplikasi)');
    assert(rd2.prepare('SELECT COUNT(*) AS c FROM class_memberships WHERE class_id = ?').get('CLS_ADA').c === 36, 'siswa menempel ke kelas yang sudah ada');
}
fixtures.seedServer(db);   /* data uji (bukan produk) untuk tes-tes di bawah */
const service = api(db, {});

function req(token, method) {
    return { headers: token ? { authorization: 'Bearer ' + token } : {}, method: method || 'GET', url: '/api/v1/x' };
}
function fakeRes() {
    return {
        status: 0, headers: null, body: '',
        writeHead(s, h) { this.status = s; this.headers = h; },
        end(b) { this.body = String(b); }
    };
}
function call(action, body, token, params, method) {
    const r = fakeRes();
    action(req(token, method), r, body || null, params || {});
    let json = null;
    try { json = r.body ? JSON.parse(r.body) : null; } catch (e) { /* ignore */ }
    return { status: r.status, json, body: r.body, headers: r.headers };
}
function login(username, password) {
    return call(service.login, { username, password });
}

console.log('BACKEND TEST — progres & dashboard guru');

/* ---------- skema & seed ---------- */
const modCount = db.prepare('SELECT COUNT(*) AS c FROM learning_modules').get().c;
assert(modCount >= 40, 'modul konten tersedia di learning_modules (' + modCount + ')');
const byType = db.prepare('SELECT type, COUNT(*) AS c FROM learning_modules GROUP BY type').all();
const tmap = {};
byType.forEach(r => { tmap[r.type] = r.c; });
assert(tmap.MATERI >= 14, '>=14 modul MATERI (' + tmap.MATERI + ')');
assert(tmap.JOB_SHEET >= 10, '>=10 JOB_SHEET (' + tmap.JOB_SHEET + ')');
assert(tmap.KUIS >= 5, '>=5 KUIS (' + tmap.KUIS + ')');
assert(tmap.KASUS_DIAGNOSIS >= 5, '>=5 KASUS_DIAGNOSIS (' + tmap.KASUS_DIAGNOSIS + ')');

/* ---------- auth ---------- */
assert(db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 4, 'fixture uji: Superadmin + guru + 2 siswa');
let r = login('siswa', 'wrongpass');
assert(r.status === 401, 'login sandi salah -> 401');
r = login('siswa', 'siswa123');
assert(r.status === 200 && r.json && r.json.data.token, 'login siswa ok');
const tokSiswa = r.json.data.token;
assert(r.json.data.user.role === 'STUDENT', 'role siswa dari server');
r = login('guru', 'guru123');
assert(r.status === 200, 'login guru ok');
const tokGuru = r.json.data.token;
r = login('superadmin', 'superadmin123');
assert(r.status === 200, 'login superadmin ok');
const tokAdmin = r.json.data.token;

r = call(service.me, null, tokSiswa);
assert(r.status === 200 && r.json.data.user.id === 'USER_SISWA1', 'me() identitas siswa benar');
/* sandi tidak plaintext di DB */
const stored = db.prepare('SELECT password_hash FROM users WHERE id = ?').get('USER_SISWA1');
assert(stored.password_hash.indexOf('scrypt$') === 0 && stored.password_hash.indexOf('siswa123') === -1, 'sandi tersimpan scrypt, bukan plaintext');

/* ---------- RBAC ---------- */
r = call(service.teacherClasses, null, tokSiswa);
assert(r.status === 403, 'siswa tidak dapat membuka dashboard guru');
r = call(service.adminStats, null, tokSiswa);
assert(r.status === 401 || r.status === 403, 'siswa tidak dapat membuka API admin');
r = call(service.classProgress, null, tokGuru, { classId: 'CLASS_DEMO' });
assert(r.status === 200, 'guru membaca progres kelasnya sendiri');
/* buat kelas lain oleh admin; guru tidak berhak -> 403 */
r = call(service.createClass, { name: 'Kelas Uji 3', organizationId: 'ORG_DEMO' }, tokAdmin);
assert(r.status === 200, 'admin membuat kelas (Kelas Uji 3)');
const otherClassId = r.json.data.id;
r = call(service.classProgress, null, tokGuru, { classId: otherClassId });
assert(r.status === 403, 'guru TIDAK dapat membaca kelas yang bukan kewenangannya');
r = call(service.studentDetail, null, tokSiswa, { studentId: 'USER_SISWA2' });
assert(r.status === 403, 'siswa A TIDAK dapat melihat data siswa B');
r = call(service.studentDetail, null, tokGuru, { studentId: 'USER_SISWA1' });
assert(r.status === 200, 'guru dapat melihat detail siswa di kelasnya');
r = call(service.studentDetail, null, tokAdmin, { studentId: 'USER_SISWA2' });
assert(r.status === 200, 'admin dapat melihat semua siswa');
/* pengguna tanpa token */
r = call(service.me, null, null);
assert(r.status === 401, 'tanpa token -> 401');

/* ---------- pencatatan progres materi ---------- */
r = call(service.recordModule, { moduleId: 'M1', status: 'COMPLETED' }, tokSiswa);
assert(r.status === 200, 'menandai modul 1 tuntas (siswa)');
r = call(service.myProgress, null, tokSiswa);
assert(r.json.data.modules.completed === 1, 'progres siswa naik (1 modul selesai)');
/* membuka saja TIDAK menandakan selesai */
const beforeOpen = r.json.data.modules;
call(service.recordModule, { moduleId: 'M2', status: 'IN_PROGRESS' }, tokSiswa);
r = call(service.myProgress, null, tokSiswa);
assert(r.json.data.modules.completed === beforeOpen.completed, 'membuka modul tidak otomatis = selesai');
assert(r.json.data.modules.inProgress === 1, 'modul dibuka = berstatus berlangsung');

/* ---------- idempotensi event & attempt ---------- */
const s1 = svc.requiredModules(db, null).length;
r = call(service.recordModule, { moduleId: 'M3', status: 'COMPLETED', eventKey: 'evt-unik-1' }, tokSiswa);
assert(r.status === 200, 'simpan modul 3 tuntas');
r = call(service.recordModule, { moduleId: 'M3', status: 'COMPLETED', eventKey: 'evt-unik-1' }, tokSiswa);
assert(r.json.data.dup === true, 'kirim ulang event yang sama -> ditandai duplikat');
const evCount = db.prepare('SELECT COUNT(*) AS c FROM learning_activity_events WHERE event_key = ?').get('evt-unik-1');
assert(evCount.c === 1, 'event tidak diduplikasi');

r = call(service.recordAssessment, { assessmentId: 'k1', attemptNumber: 1, score: 60, maxScore: 100, passingScore: 75 }, tokSiswa);
assert(r.status === 200 && r.json.data.passed === false, 'percobaan k1 skor 60 -> belum lulus');
r = call(service.recordAssessment, { assessmentId: 'k1', attemptNumber: 1, score: 60, maxScore: 100, passingScore: 75 }, tokSiswa);
assert(r.status === 200, 'kirim ulang attempt yang sama diterima (idempoten store)');
r = call(service.recordAssessment, { assessmentId: 'k1', attemptNumber: 2, score: 85, maxScore: 100, passingScore: 75 }, tokSiswa);
assert(r.json.data.passed === true, 'percobaan kedua lulus');
const k1rows = db.prepare('SELECT * FROM assessment_attempts WHERE student_id=? AND assessment_id=? ORDER BY attempt_number').all('USER_SISWA1', 'k1');
assert(k1rows.length === 2, 'riwayat 2 percobaan k1 tersimpan terpisah');
assert(k1rows[0].score === 60 && k1rows[1].score === 85, 'nilai lama tidak tertimpa nilai baru');

r = call(service.recordSession, { mode: 'LAB', durationSec: 120, summary: { start: true } }, tokSiswa);
assert(r.status === 200, 'mulai sesi simulator');
r = call(service.recordAttempt, { kind: 'measurement', refId: 'JS-001', success: true, payload: { v: 12.6 } }, tokSiswa);
assert(r.status === 200, 'simpan hasil pengukuran');

/* ---------- dashboard guru: agregasi ---------- */
r = call(service.classProgress, null, tokGuru, { classId: 'CLASS_DEMO' });
assert(r.status === 200, 'data progres kelas tersedia untuk guru');
const cp = r.json.data;
assert(cp.totals.total === 2, 'total siswa di kelas = 2');
assert(cp.avgProgress != null && cp.avgProgress >= 0 && cp.avgProgress <= 100, 'rata-rata progres kelas terhitung');
const s1row = cp.students.find(x => x.student.id === 'USER_SISWA1');
assert(s1row && s1row.status && s1row.status.key === 'berlangsung', 'status siswa berlangsung (sudah mulai, belum tuntas)');
assert(s1row.modules.completed >= 2, 'modul selesai siswa naik setelah catatan');

r = call(service.classModules, null, tokGuru, { classId: 'CLASS_DEMO' });
assert(r.status === 200 && r.json.data.modules.length >= 40, 'distribusi progres per modul tersedia');

/* ---------- detail siswa: timeline ---------- */
r = call(service.studentDetail, null, tokGuru, { studentId: 'USER_SISWA1' });
const ss = r.json.data;
assert(ss.profile.name === 'Siswa Uji A', 'profil siswa di detail');
assert(Array.isArray(ss.modules) && ss.modules.length >= 3, 'detail memuat daftar modul+status');
assert(ss.assessmentHistory.length === 2, 'detail memuat riwayat evaluasi');
assert(Array.isArray(ss.activity), 'detail memuat timeline aktivitas');
assert(Array.isArray(ss.simulatorAttempts) && ss.simulatorAttempts.length >= 1, 'detail memuat riwayat praktik simulator');
assert(ss.nextModule && ss.nextModule.moduleId, 'detail merekomendasikan modul berikutnya');

/* ---------- perlu pendampingan (aturan netral) ---------- */
const old = new Date(Date.now() - 12 * 86400000).toISOString();
svc.recordEvent(db, { studentId: 'USER_SISWA2', type: 'module_activity', moduleId: null, payload: {}, createdAt: old });
const p2 = svc.studentProgress(db, 'USER_SISWA2');
r = call(service.classProgress, null, tokGuru, { classId: 'CLASS_DEMO' });
const s2row = r.json.data.students.find(x => x.student.id === 'USER_SISWA2');
assert(s2row.status.key === 'perlu-pendampingan', 'siswa tanpa aktivitas 12 hari -> "Perlu pendampingan"');
assert(Array.isArray(s2row.status.reasons) && s2row.status.reasons.length >= 1, 'alasan berbasis data ditampilkan');

/* ---------- umpan balik guru ---------- */
r = call(service.addFeedback, { body: 'Coba ulangi job sheet voltage drop.' }, tokGuru, { studentId: 'USER_SISWA1' });
assert(r.status === 200, 'guru menulis umpan balik');
r = call(service.me, null, tokSiswa);
assert(r.json.data.feedback.length >= 1 && r.json.data.feedback[0].body.indexOf('voltage drop') >= 0, 'siswa melihat umpan balik guru');

/* ---------- ekspor CSV ---------- */
r = call(service.exportCsv, null, tokGuru, { classId: 'CLASS_DEMO' });
assert(r.status === 200, 'ekspor CSV guru berjalan');
assert(r.headers['Content-Type'].indexOf('text/csv') === 0, 'Content-Type CSV');
assert(r.body.indexOf('Nama') >= 0 && r.body.indexOf('Siswa Uji A') >= 0, 'CSV memuat header & data siswa');
assert(r.body.indexOf('\r\n') > 0, 'CSV memakai baris CRLF');
r = call(service.exportCsv, null, tokGuru, { classId: otherClassId });
assert(r.status === 403, 'CSV guru untuk kelas lain -> 403');

/* ---------- impor data lokal (migrasi hati-hati) ---------- */
const payload = {
    hash: 'abc123',
    store: {
        materi: { '1': { paham: true, pahamAt: new Date().toISOString() }, '2': { cek: true } },
        quiz: { k2: { best: 90, attempts: 2, last: new Date().toISOString() } }
    }
};
r = call(service.importLocal, payload, tokSiswa);
assert(r.status === 200 && r.json.data.imported >= 1, 'impor data lokal berjalan');
const mark = db.prepare('SELECT * FROM migration_marks WHERE user_id=?').get('USER_SISWA1');
assert(mark && mark.status === 'OK', 'migrasi tercatat (migration_marks)');
r = call(service.myProgress, null, tokSiswa);
assert(r.json.data.modules.completed >= 3, 'progres naik setelah impor (paham/cek = selesai)');

/* ---------- admin ---------- */
r = call(service.adminStats, null, tokAdmin);
assert(r.status === 200 && r.json.data.classes >= 2, 'statistik admin tersedia');
r = call(service.adminCreateUser, { name: 'Rina Dewi', username: 'rina', role: 'STUDENT', password: 'rina123' }, tokAdmin);
assert(r.status === 200, 'admin membuat akun siswa');
r = login('rina', 'rina123');
assert(r.status === 200, 'akun baru bisa login');
r = call(service.adminSetUserStatus, { status: 'DISABLED' }, tokAdmin, { userId: r.json.data.user.id });
assert(r.status === 200, 'admin menonaktifkan akun');
r = login('rina', 'rina123');
assert(r.status === 403, 'akun dinonaktifkan tidak bisa login');
r = call(service.adminCreateUser, { name: 'X', username: 'rina', role: 'STUDENT', password: 'x' }, tokAdmin);
assert(r.status === 409, 'username ganda -> 409');

/* ---------- logout ---------- */
r = call(service.logout, null, tokSiswa);
assert(r.status === 200, 'logout berhasil');
r = call(service.me, null, tokSiswa);
assert(r.status === 401, 'token sesi mati setelah logout');


/* ---------- pembersihan data contoh versi lama (database lama yang sudah terlanjur terisi) ---------- */
{
    const authMod = require('../backend/auth');
    const old = openDb(':memory:');
    const now = new Date().toISOString();
    old.prepare('INSERT INTO organizations (id, name, type, address, status, admin_user_id, created_at) VALUES (?,?,?,?,?,?,?)').run('ORG_DEMO', 'SMK Negeri 1 Contoh', 'SCHOOL', 'x', 'ACTIVE', null, now);
    const u = (id, un, nm, role, org) => old.prepare('INSERT INTO users (id, username, name, email, role, status, password_hash, organization_id, nis, nisn, registered_at, last_active_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, un, nm, null, role, 'ACTIVE', authMod.hashPassword('x12345'), org, null, null, now, now);
    u('USER_SUPERADMIN', 'superadmin', 'Superadmin', 'ADMIN', null);
    u('USER_GURU', 'guru', 'Budi Santoso', 'INSTRUCTOR', 'ORG_DEMO');
    u('USER_SISWA1', 'siswa', 'Andi Pratama', 'STUDENT', 'ORG_DEMO');
    u('USER_SISWA2', 'siswa2', 'Siti Aminah', 'STUDENT', 'ORG_DEMO');
    old.prepare('UPDATE organizations SET admin_user_id = ? WHERE id = ?').run('USER_GURU', 'ORG_DEMO');
    old.prepare('INSERT INTO classes (id, organization_id, name, level, program, subject, academic_year, join_code, join_enabled, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('CLASS_DEMO', 'ORG_DEMO', 'XII TKR 1', 'XII', 'p', 's', '2026', 'TKR-AB12', 1, 'ACTIVE', 'USER_GURU', now);
    old.prepare('INSERT INTO teacher_class_assignments (id, class_id, teacher_id, assigned_at) VALUES (?,?,?,?)').run('T1', 'CLASS_DEMO', 'USER_GURU', now);
    old.prepare('INSERT INTO class_memberships (id, class_id, student_id, status, joined_at) VALUES (?,?,?,?,?)').run('M1', 'CLASS_DEMO', 'USER_SISWA1', 'ACTIVE', now);
    old.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)').run('tok1', 'USER_SISWA1', now, now);
    const purged = seedMod.purgeLegacyDemo(old);
    const cnt = (t) => old.prepare('SELECT COUNT(*) AS c FROM ' + t).get().c;
    assert(purged >= 5, 'purge: data contoh lama terdeteksi dan dihapus (' + purged + ')');
    assert(cnt('users') === 1 && cnt('organizations') === 0 && cnt('classes') === 0, 'purge: tersisa hanya Superadmin; sekolah & kelas contoh hilang');
    assert(cnt('class_memberships') === 0 && cnt('teacher_class_assignments') === 0 && cnt('sessions') === 0, 'purge: data turunan (anggota kelas, penugasan, sesi) ikut bersih');
    /* data NYATA tidak boleh ikut terhapus: guru dengan nama berbeda di sekolah contoh -> sekolah dipertahankan */
    const old2 = openDb(':memory:');
    old2.prepare('INSERT INTO organizations (id, name, type, address, status, admin_user_id, created_at) VALUES (?,?,?,?,?,?,?)').run('ORG_DEMO', 'SMK Negeri 1 Contoh', 'SCHOOL', 'x', 'ACTIVE', null, now);
    old2.prepare('INSERT INTO users (id, username, name, email, role, status, password_hash, organization_id, nis, nisn, registered_at, last_active_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('USER_REAL', 'guru.nyata', 'Pak Nyata', null, 'INSTRUCTOR', 'ACTIVE', authMod.hashPassword('x12345'), 'ORG_DEMO', null, null, now, now);
    seedMod.purgeLegacyDemo(old2);
    assert(old2.prepare("SELECT COUNT(*) AS c FROM users WHERE id = 'USER_REAL'").get().c === 1, 'purge: akun nyata tidak tersentuh');
    assert(old2.prepare("SELECT COUNT(*) AS c FROM organizations WHERE id = 'ORG_DEMO'").get().c === 1, 'purge: sekolah yang sudah dipakai data nyata tidak dihapus');
    /* akun dengan id sama tetapi nama sudah diganti (data nyata) tidak dihapus */
    const old3 = openDb(':memory:');
    old3.prepare('INSERT INTO users (id, username, name, email, role, status, password_hash, organization_id, nis, nisn, registered_at, last_active_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('USER_GURU', 'guru', 'Nama Sudah Diganti', null, 'INSTRUCTOR', 'ACTIVE', authMod.hashPassword('x12345'), null, null, null, now, now);
    assert(seedMod.purgeLegacyDemo(old3) === 0 && old3.prepare('SELECT COUNT(*) AS c FROM users').get().c === 1, 'purge: hanya yang persis cocok id + nama aslinya yang dihapus');
    const fresh = openDb(':memory:');
    process.env.SIM_SUPERADMIN_PASSWORD = 'sandi-khusus-9';
    seedMod.seed(fresh);
    delete process.env.SIM_SUPERADMIN_PASSWORD;
    const svc2 = api(fresh, {});
    const rr = fakeRes();
    svc2.login({ headers: {}, method: 'POST', url: '/api/v1/auth/login' }, rr, { username: 'superadmin', password: 'sandi-khusus-9' }, {});
    assert(rr.status === 200, 'sandi awal Superadmin dapat diatur lewat SIM_SUPERADMIN_PASSWORD');
}

console.log('=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed ? 1 : 0);