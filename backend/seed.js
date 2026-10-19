'use strict';
/* ============================================================================
   SEED - hanya akun Superadmin + modul konten
   ----------------------------------------------------------------------------
   TIDAK ADA data contoh (sekolah, guru, siswa, kelas). Semua itu dibuat oleh
   Superadmin atau lewat pendaftaran di halaman login.
   Diisi HANYA saat database masih kosong (users & organizations kosong).
   Sandi awal Superadmin: SIM_SUPERADMIN_PASSWORD (env) atau 'superadmin123'.
   GANTI sandi ini setelah login pertama.
   ============================================================================ */
var auth = require('./auth');
var progress = require('./progress');

/* Data contoh versi lama (bila database lama masih menyimpannya) dihapus bersih. */
var LEGACY = {
    users: { USER_GURU: 'Budi Santoso', USER_SISWA1: 'Andi Pratama', USER_SISWA2: 'Siti Aminah' },
    classes: { CLASS_DEMO: 'XII TKR 1' },
    orgs: { ORG_DEMO: 'SMK Negeri 1 Contoh' }
};

function matching(db, table, map) {
    return Object.keys(map).filter(function (id) {
        var r = db.prepare('SELECT name FROM ' + table + ' WHERE id = ?').get(id);
        return !!(r && r.name === map[id]);
    });
}

/* Hapus baris yang mereferensikan `ids` pada tabel induk: kolom wajib diisi -> baris dihapus, kolom opsional -> NULL. */
function cleanReferences(db, parent, ids) {
    if (!ids.length) return;
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().forEach(function (t) {
        var info = db.prepare('PRAGMA table_info(' + t.name + ')').all();
        db.prepare('PRAGMA foreign_key_list(' + t.name + ')').all().forEach(function (fk) {
            if (fk.table !== parent) return;
            var col = info.filter(function (c) { return c.name === fk.from; })[0];
            ids.forEach(function (id) {
                if (col && col.notnull) db.prepare('DELETE FROM ' + t.name + ' WHERE ' + fk.from + ' = ?').run(id);
                else db.prepare('UPDATE ' + t.name + ' SET ' + fk.from + ' = NULL WHERE ' + fk.from + ' = ?').run(id);
            });
        });
    });
}

function purgeLegacyDemo(db) {
    var uids = matching(db, 'users', LEGACY.users);
    var cids = matching(db, 'classes', LEGACY.classes);
    var oids = matching(db, 'organizations', LEGACY.orgs);
    if (!uids.length && !cids.length && !oids.length) return 0;
    db.exec('PRAGMA foreign_keys = OFF');
    try {
        cleanReferences(db, 'classes', cids);
        cids.forEach(function (id) { db.prepare('DELETE FROM classes WHERE id = ?').run(id); });
        cleanReferences(db, 'users', uids);
        uids.forEach(function (id) { db.prepare('DELETE FROM users WHERE id = ?').run(id); });
        /* sekolah contoh hanya dihapus bila tidak dipakai data nyata */
        var free = oids.filter(function (id) {
            var u = db.prepare('SELECT COUNT(*) AS c FROM users WHERE organization_id = ?').get(id).c;
            var c = db.prepare('SELECT COUNT(*) AS c FROM classes WHERE organization_id = ?').get(id).c;
            return u === 0 && c === 0;
        });
        free.forEach(function (id) { db.prepare('DELETE FROM organizations WHERE id = ?').run(id); });
    } finally {
        db.exec('PRAGMA foreign_keys = ON');
    }
    auth.audit(db, 'SYSTEM', 'purge_demo', 'database', null, { users: uids.length, classes: cids.length });
    return uids.length + cids.length + oids.length;
}

function seed(db) {
    purgeLegacyDemo(db);
    var users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    var orgs = db.prepare('SELECT COUNT(*) AS c FROM organizations').get().c;
    if (users > 0 || orgs > 0) return 0;
    var now = new Date().toISOString();
    var pw = process.env.SIM_SUPERADMIN_PASSWORD || 'superadmin123';
    db.prepare('INSERT INTO users (id, username, name, email, role, status, password_hash, organization_id, nis, nisn, registered_at, last_active_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run('USER_SUPERADMIN', 'superadmin', 'Superadmin', null, 'ADMIN', 'ACTIVE', auth.hashPassword(pw), null, null, null, now, now);
    if (!process.env.SIM_SUPERADMIN_PASSWORD) db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run('USER_SUPERADMIN');
    progress.ensureModulesSeeded(db);
    auth.audit(db, 'SYSTEM', 'seed', 'database', null, { accounts: 1, modules: progress.requiredModules(db, null).length + 12 });
    return 1;
}

/* ============================================================================
   ROSTER SISWA - kelas XI TKR 1 SMKN 3 Makassar
   ----------------------------------------------------------------------------
   Roster siswa dimuat dari data/roster.json (tidak disertakan dalam paket). Impor IDEMPOTEN dan DIJALANKAN SETIAP BOOT
   (bukan hanya saat database kosong) sehingga database lama ikut terisi tanpa
   menimpa apa pun.
   - Username dibuat dari nama: huruf kecil, tanpa spasi/tanda baca.
   - Sandi default 'siswa123'. Satu hash scrypt untuk semua akun roster (sandi
     sama, data latihan) agar boot tetap cepat (36x scrypt [-6 dt]) -> 1x.
   - NIS/NISN tidak tersedia di berkas -> dikosongkan (tidak mengarang).
   ============================================================================ */
/* Daftar nama TIDAK disimpan di kode. Sediakan lewat data/roster.json (larik nama)
   atau argumen ensureRoster(db, names). Tanpa daftar, impor tidak melakukan apa pun. */
function loadRosterNames() {
    try {
        var f = require('path').join(__dirname, '..', 'data', 'roster.json');
        var arr = JSON.parse(require('fs').readFileSync(f, 'utf8'));
        return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === 'string' && x.trim(); }) : [];
    } catch (e) { return []; }
}
var ROSTER_ORG = { id: 'ORG_MAKASSAR', name: 'SMKN 3 Makassar' };
var ROSTER_CLASS = { id: 'CLASS_XITKR1', name: 'XI TKR 1' };
var ROSTER_PASSWORD = process.env.SIM_ROSTER_PASSWORD || 'siswa123';

function rosterUsernames(ROSTER_NAMES) {
    var used = {};
    return ROSTER_NAMES.map(function (name) {
        var base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'siswa';
        var uname = base, k = 1;
        while (used[uname]) uname = base + (++k);
        used[uname] = true;
        return uname;
    });
}

function ensureRoster(db, names) {
    var ROSTER_NAMES = Array.isArray(names) ? names : loadRosterNames();
    if (!ROSTER_NAMES.length) return { students: 0, inserted: 0 };
    var now = new Date().toISOString();
    var orgRow = db.prepare('SELECT id FROM organizations WHERE id = ? OR lower(name) = ? LIMIT 1')
        .get(ROSTER_ORG.id, 'smkn 3 makassar');
    var orgId = orgRow ? orgRow.id : ROSTER_ORG.id;
    if (!orgRow) {
        db.prepare('INSERT INTO organizations (id, name, type, address, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
            .run(ROSTER_ORG.id, ROSTER_ORG.name, 'SCHOOL', 'BTP, Kec. Biringkanaya, Kota Makassar, Sulawesi Selatan', 'ACTIVE', now, now);
    }
    var clsRow = db.prepare('SELECT id FROM classes WHERE id = ? OR (organization_id = ? AND lower(name) = ?) LIMIT 1')
        .get(ROSTER_CLASS.id, orgId, 'xi tkr 1');
    var clsId = clsRow ? clsRow.id : ROSTER_CLASS.id;
    if (!clsRow) {
        db.prepare('INSERT INTO classes (id, organization_id, name, level, program, subject, academic_year, join_code, join_enabled, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(ROSTER_CLASS.id, orgId, ROSTER_CLASS.name, 'XI', 'Teknik Kendaraan Ringan', 'Sistem Starter',
                String(new Date().getFullYear()), 'TKR-XI1', 1, 'ACTIVE', 'SYSTEM', now, now);
    }
    var usernames = rosterUsernames(ROSTER_NAMES);
    var sharedHash = auth.hashPassword(ROSTER_PASSWORD);
    var inserted = 0;
    ROSTER_NAMES.forEach(function (name, i) {
        var id = 'MAKR_' + String(i + 1).padStart(2, '0');
        var uname = usernames[i];
        var exists = db.prepare('SELECT id FROM users WHERE id = ? OR username = ? COLLATE NOCASE').get(id, uname);
        if (!exists) {
            db.prepare('INSERT INTO users (id, username, name, email, role, status, password_hash, organization_id, nis, nisn, registered_at, last_active_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
                .run(id, uname, name.trim(), null, 'STUDENT', 'ACTIVE', sharedHash, orgId, null, null, now, now);
            inserted++;
        }
        db.prepare('INSERT OR IGNORE INTO class_memberships (id, class_id, student_id, status, joined_at) VALUES (?,?,?,?,?)')
            .run('CM_' + id, clsId, exists && exists.id ? exists.id : id, 'ACTIVE', now);
    });
    return { students: ROSTER_NAMES.length, inserted: inserted };
}

/* Database lama: bila Superadmin masih bersandi bawaan dan sandi tidak diatur lewat env,
   wajibkan ganti sandi pada login berikutnya. */
function flagDefaultPasswords(db) {
    if (process.env.SIM_SUPERADMIN_PASSWORD) return 0;
    var row = db.prepare('SELECT id, password_hash, must_change_password FROM users WHERE id = ?').get('USER_SUPERADMIN');
    if (!row || row.must_change_password) return 0;
    if (!auth.verifyPassword('superadmin123', row.password_hash)) return 0;
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(row.id);
    return 1;
}

module.exports = { seed: seed, purgeLegacyDemo: purgeLegacyDemo, ensureRoster: ensureRoster, flagDefaultPasswords: flagDefaultPasswords };
