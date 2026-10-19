process.env.SIM_SUPERADMIN_PASSWORD = 'superadmin123';
/* ============================================================
   TEST — fitur guru: edit akun sendiri, edit nama/sandi siswa,
   edit tugas, koreksi nilai & buka ulang tugas siswa
   ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { openDb } = require(path.join(ROOT, 'backend', 'db.js'));
const seedMod = require(path.join(ROOT, 'backend', 'seed.js'));
const auth = require(path.join(ROOT, 'backend', 'auth.js'));
const { api } = require(path.join(ROOT, 'backend', 'api.js'));
const fixtures = require('./fixtures');
let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.log('  FAIL: ' + m); } }

const db = openDb(':memory:'); seedMod.seed(db); fixtures.seedServer(db);
const service = api(db, {});
function fakeRes() { return { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = String(b); } }; }
function call(action, body, token, params) {
    const r = fakeRes();
    action({ headers: token ? { authorization: 'Bearer ' + token } : {}, method: 'PUT', url: '/x' }, r, body || null, params || {});
    return { status: r.status, json: r.body ? JSON.parse(r.body) : null };
}
const login = (u, p) => call(service.login, { username: u, password: p }).json.data.token;
const guru = login('guru', 'guru123');
const siswa = login('siswa', 'siswa123');

console.log('TEACHER TEST');
/* --- server: profil sendiri --- */
let r = call(service.updateMe, { name: 'Guru Baru' }, guru);
assert(r.status === 200 && db.prepare("SELECT name FROM users WHERE id='USER_GURU'").get().name === 'Guru Baru', 'S1 guru mengubah nama sendiri');
r = call(service.updateMe, { name: 'Guru Baru', oldPassword: 'salah', newPassword: 'sandibaru99' }, guru);
assert(r.status === 400 && r.json.error.code === 'BAD_PASSWORD', 'S2 sandi lama salah ditolak');
r = call(service.updateMe, { name: 'Guru Baru', oldPassword: 'guru123', newPassword: 'pendek' }, guru);
assert(r.status === 400 && r.json.error.code === 'WEAK_PASSWORD', 'S3 sandi baru < 8 ditolak');
r = call(service.updateMe, { name: 'Guru Baru', oldPassword: 'guru123', newPassword: 'sandibaru99' }, guru);
assert(r.status === 200 && auth.verifyPassword('sandibaru99', db.prepare("SELECT password_hash h FROM users WHERE id='USER_GURU'").get().h), 'S4 sandi sendiri berubah');
assert(call(service.updateMe, { name: 'x' }, null).status === 401, 'S5 tanpa sesi ditolak');
assert(call(service.updateMe, { name: '' }, siswa).status === 400, 'S6 nama kosong ditolak');
const guru2 = login('guru', 'sandibaru99');
/* --- server: guru -> siswa --- */
r = call(service.teacherUpdateStudent, { name: 'Siswa A Baru', password: 'siswabaru1' }, guru2, { userId: 'USER_SISWA1' });
assert(r.status === 200 && db.prepare("SELECT name FROM users WHERE id='USER_SISWA1'").get().name === 'Siswa A Baru', 'S7 guru mengubah nama siswa');
assert(auth.verifyPassword('siswabaru1', db.prepare("SELECT password_hash h FROM users WHERE id='USER_SISWA1'").get().h), 'S8 guru mereset sandi siswa');
assert(!db.prepare('SELECT 1 x FROM sessions WHERE user_id = ?').get('USER_SISWA1'), 'S9 sesi lama siswa dicabut');
assert(call(service.teacherUpdateStudent, { name: 'x' }, siswa, { userId: 'USER_SISWA2' }).status === 401, 'S10 siswa tidak boleh mengubah siswa lain');
assert(call(service.teacherUpdateStudent, { password: '123' }, guru2, { userId: 'USER_SISWA2' }).status === 400, 'S11 sandi siswa < 6 ditolak');
assert(call(service.teacherUpdateStudent, { name: 'x' }, guru2, { userId: 'USER_GURU' }).status === 404, 'S12 target non-siswa ditolak');
db.prepare("INSERT INTO organizations (id,name,type,status,created_at) VALUES ('ORG_X','Lain','SCHOOL','ACTIVE','2026-01-01')").run();
db.prepare("INSERT INTO users (id,username,name,role,status,password_hash,organization_id,registered_at) VALUES ('U_OUT','out','Luar','STUDENT','ACTIVE','x','ORG_X','2026-01-01')").run();
assert(call(service.teacherUpdateStudent, { name: 'x' }, guru2, { userId: 'U_OUT' }).status === 403, 'S13 siswa sekolah lain ditolak');

/* --- layanan lokal (Phase 8) --- */
const vm = require('vm');
const win = { addEventListener() {}, localStorage: null };
const store = {};
const ctx = { window: win, console, setTimeout, clearTimeout, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }, Date, Math, JSON };
win.window = win; vm.createContext(ctx);
vm.runInContext(require('fs').readFileSync(path.join(ROOT, 'instructorPlatform.js'), 'utf8'), ctx);
const P8 = ctx.window.Phase8 || ctx.Phase8;
assert(!!P8, 'L0 Phase8 termuat');
if (P8) {
    fixtures.installLocal(P8);
    const R = P8.repositories;
    const T = R.userRepository.getById('USER_GURU');
    let a = P8.assignmentService.update('ASSIGN_DEMO2', { title: 'Kuis Edit', passingScore: 85, dueAt: null, studentIds: ['USER_SISWA1'], attempts: 3 }, T);
    assert(a.success && a.data.title === 'Kuis Edit' && a.data.passingScore === 85 && a.data.dueAt === null && a.data.studentIds.length === 1, 'L1 edit judul/KKM/tenggat/siswa tertentu');
    a = P8.assignmentService.update('ASSIGN_DEMO2', { type: 'NGAWUR' }, T);
    assert(!a.success, 'L2 jenis tidak valid ditolak');
    a = P8.assignmentService.update('ASSIGN_DEMO2', { title: '   ' }, T);
    assert(!a.success, 'L3 judul kosong ditolak');
    a = P8.assignmentService.update('ASSIGN_DEMO2', { passingScore: 150 }, T);
    assert(!a.success, 'L4 KKM > 100 ditolak');
    a = P8.assignmentService.update('ASSIGN_DEMO2', { status: 'ARCHIVED' }, T);
    assert(a.success && a.data.status === 'ARCHIVED', 'L5 arsip lewat edit');
    a = P8.assignmentService.update('ASSIGN_DEMO2', { status: 'PUBLISHED' }, T);
    assert(a.success && a.data.status === 'PUBLISHED', 'L6 terbitkan kembali');
    const other = { id: 'X', role: 'INSTRUCTOR', organizationId: 'ORG_DEMO' };
    assert(!P8.assignmentService.update('ASSIGN_DEMO2', { title: 'hack' }, other).success, 'L7 guru lain tidak bisa mengedit');
    /* nilai */
    let g = P8.gradingService.grade('SUB_DEMO1', { score: 60, feedback: 'ok' }, T);
    assert(g.success, 'L8 nilai awal');
    g = P8.gradingService.regrade('SUB_DEMO1', { score: 88, feedback: 'revisi nilai' }, T);
    assert(g.success && R.submissionRepository.getById('SUB_DEMO1').score === 88, 'L9 koreksi nilai setelah dinilai');
    assert(!P8.gradingService.regrade('SUB_DEMO1', { score: '' }, T).success, 'L10 nilai kosong ditolak');
    assert(!P8.gradingService.regrade('SUB_DEMO1', { score: 50 }, other).success, 'L11 guru lain tidak bisa koreksi');
    g = P8.gradingService.reopen('SUB_DEMO1', 'Kerjakan lagi', T);
    const s1 = R.submissionRepository.getById('SUB_DEMO1');
    assert(g.success && s1.status === 'RETURNED' && s1.score === null, 'L12 buka ulang tugas siswa');
    assert(!P8.gradingService.reopen('SUB_DEMO1', '', T).success, 'L13 buka ulang hanya untuk kiriman/dinilai');
}
console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed ? 1 : 0);
