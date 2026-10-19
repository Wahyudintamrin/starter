/* Tes: wajib ganti sandi bawaan Superadmin (server) + roster tanpa nama di kode */
'use strict';
delete process.env.SIM_SUPERADMIN_PASSWORD;   /* instalasi baru: sandi bawaan */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { openDb } = require(path.join(ROOT, 'backend', 'db.js'));
const seedMod = require(path.join(ROOT, 'backend', 'seed.js'));
const { api } = require(path.join(ROOT, 'backend', 'api.js'));

let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.log('  FAIL: ' + m); } }
function fakeRes() { return { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = String(b); } }; }
function mk(db) {
    const svc = api(db, {});
    return function call(action, body, token) {
        const r = fakeRes();
        svc[action]({ headers: token ? { authorization: 'Bearer ' + token } : {}, method: 'GET', url: '/api/v1/x' }, r, body || null, {});
        let json = null; try { json = JSON.parse(r.body); } catch (e) { }
        return { status: r.status, json };
    };
}

console.log('FIRST-LOGIN TEST');
const db = openDb(':memory:');
seedMod.seed(db);
const call = mk(db);
assert(db.prepare('SELECT must_change_password AS m FROM users WHERE id = ?').get('USER_SUPERADMIN').m === 1, 'F1 Superadmin bersandi bawaan ditandai wajib ganti');
let r = call('login', { username: 'superadmin', password: 'superadmin123' });
assert(r.status === 200 && r.json.data.user.mustChangePassword === true, 'F2 login mengembalikan mustChangePassword = true');
const tok = r.json.data.token;
r = call('adminStats', null, tok);
assert(r.status === 401 || r.status === 403, 'F3 endpoint admin DIBLOKIR sebelum sandi diganti (' + r.status + ')');
r = call('changePassword', { oldPassword: 'salah', newPassword: 'SandiBaru#2026' }, tok);
assert(r.status === 400 && r.json.error.code === 'BAD_PASSWORD', 'F4 sandi lama salah ditolak');
r = call('changePassword', { oldPassword: 'superadmin123', newPassword: 'pendek' }, tok);
assert(r.status === 400 && r.json.error.code === 'WEAK_PASSWORD', 'F5 sandi baru < 8 karakter ditolak');
r = call('changePassword', { oldPassword: 'superadmin123', newPassword: 'superadmin123' }, tok);
assert(r.status === 400 && r.json.error.code === 'WEAK_PASSWORD', 'F6 sandi baru = sandi bawaan ditolak');
r = call('changePassword', { oldPassword: 'superadmin123', newPassword: 'SandiBaru#2026' }, null);
assert(r.status === 401, 'F7 tanpa token ditolak');
r = call('changePassword', { oldPassword: 'superadmin123', newPassword: 'SandiBaru#2026' }, tok);
assert(r.status === 200 && r.json.data.changed === true, 'F8 ganti sandi berhasil');
assert(call('adminStats', null, tok).status === 200, 'F9 endpoint admin terbuka setelah sandi diganti');
assert(call('login', { username: 'superadmin', password: 'superadmin123' }).status === 401, 'F10 sandi bawaan tidak berlaku lagi');
r = call('login', { username: 'superadmin', password: 'SandiBaru#2026' });
assert(r.status === 200 && r.json.data.user.mustChangePassword === false, 'F11 login sandi baru: tidak wajib ganti lagi');

/* sandi diatur admin lewat env -> tidak dipaksa ganti */
process.env.SIM_SUPERADMIN_PASSWORD = 'AturSendiri#1';
const db2 = openDb(':memory:'); seedMod.seed(db2);
assert(db2.prepare('SELECT must_change_password AS m FROM users WHERE id = ?').get('USER_SUPERADMIN').m === 0, 'F12 sandi dari env tidak ditandai wajib ganti');
delete process.env.SIM_SUPERADMIN_PASSWORD;

/* database lama (sebelum fitur ini) bersandi bawaan -> ditandai saat boot */
const db3 = openDb(':memory:'); seedMod.seed(db3);
db3.prepare('UPDATE users SET must_change_password = 0').run();
assert(seedMod.flagDefaultPasswords(db3) === 1 && db3.prepare('SELECT must_change_password AS m FROM users WHERE id = ?').get('USER_SUPERADMIN').m === 1, 'F13 DB lama bersandi bawaan ditandai');
assert(seedMod.flagDefaultPasswords(db3) === 0, 'F14 penandaan idempoten');

/* roster: tanpa daftar = tidak melakukan apa pun; tidak ada nama nyata di kode */
const db4 = openDb(':memory:'); seedMod.seed(db4);
const rr = seedMod.ensureRoster(db4, []);
assert(rr.inserted === 0 && db4.prepare('SELECT COUNT(*) AS c FROM organizations').get().c === 0, 'R1 roster kosong -> tidak membuat sekolah/siswa');
const src = ['backend/seed.js', 'authUI.js', 'server.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
assert(!/Afdiansyah|Sulkifli|Brillian Forento/.test(src), 'R2 tidak ada nama siswa nyata di kode');

console.log('=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed ? 1 : 0);
