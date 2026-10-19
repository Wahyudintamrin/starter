'use strict';
/* ============================================================================
   AUTH LAYER — StarterLab Progress Tracking
   ----------------------------------------------------------------------------
   - scrypt (crypto bawaan Node): sandi TIDAK disimpan plaintext/lemah.
   - Sesi: token acak 32 byte disimpan di tabel sessions; TTL default 7 hari.
   - RBAC + scope data ditegakkan DI SERVER (bukan hanya menyembunyikan tombol).
   - Waktu server (UTC ISO) adalah sumber waktu utama.
   ============================================================================ */
var crypto = require('node:crypto');

var SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
var SCRYPT_N = 16384;

function randToken(bytes) { return crypto.randomBytes(bytes || 32).toString('hex'); }

function hashPassword(password) {
    var salt = crypto.randomBytes(16);
    var hash = crypto.scryptSync(String(password), salt, 32, { N: SCRYPT_N, r: 8, p: 1 });
    return 'scrypt$' + setBase([SCRYPT_N, 8, 1, salt.toString('hex'), hash.toString('hex')]);
}
function setBase(a) { return a.join(':'); }
function parseScrypt(stored) {
    var parts = String(stored).split('$');
    if (parts.length !== 2 || parts[0] !== 'scrypt') return null;
    var p = parts[1].split(':');
    if (p.length !== 5) return null;
    return { n: +p[0], r: +p[1], p: +p[2], salt: Buffer.from(p[3], 'hex'), hash: Buffer.from(p[4], 'hex') };
}
function verifyPassword(password, stored) {
    try {
        var s = parseScrypt(stored);
        if (!s) return false;
        var hash = crypto.scryptSync(String(password), s.salt, s.hash.length, { N: s.n, r: s.r, p: s.p });
        if (hash.length !== s.hash.length) return false;
        return crypto.timingSafeEqual(hash, s.hash);
    } catch (e) { return false; }
}

/* ---------- sesi ---------- */
function createSession(db, userId) {
    var token = randToken(32);
    var now = new Date().toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?)')
        .run(token, userId, now, new Date(Date.now() + SESSION_TTL_MS).toISOString(), now);
    return token;
}
function getSessionUser(db, token) {
    if (!token) return null;
    var s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!s) return null;
    if (new Date(s.expires_at).getTime() < Date.now()) {
        destroySession(db, token);
        return null;
    }
    var u = db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(s.user_id, 'ACTIVE');
    if (!u) {
        destroySession(db, token);
        return null;
    }
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token = ?').run(new Date().toISOString(), token);
    db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(new Date().toISOString(), u.id);
    return u;
}
function destroySession(db, token) {
    if (!token) return;
    try { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); } catch (e) { /* noop */ }
}

/* ---------- RBAC & scope ---------- */
function publicUser(u) {
    return {
        id: u.id, username: u.username, name: u.name, email: u.email || null,
        role: u.role, status: u.status, organizationId: u.organization_id || null,
        nis: u.nis || null, nisn: u.nisn || null,
        mustChangePassword: !!u.must_change_password,
        registeredAt: u.registered_at, lastActiveAt: u.last_active_at
    };
}
function hasRole(u, roles) {
    return !!u && roles.indexOf(u.role) !== -1;
}
function requireRole(db, token, roles) {
    var u = getSessionUser(db, token);
    if (!u) return { ok: false, code: 'UNAUTHENTICATED', status: 401 };
    /* akun dengan sandi bawaan wajib ganti sandi dulu (POST /auth/change-password) */
    if (u.must_change_password) return { ok: false, code: 'PASSWORD_CHANGE_REQUIRED', status: 403 };
    if (!hasRole(u, roles)) return { ok: false, code: 'FORBIDDEN', status: 403 };
    return { ok: true, user: u };
}
/* kelas yang boleh diakses guru/instruktur */
function teacherClassIds(db, teacherId, orgId) {
    var rows = db.prepare('SELECT class_id FROM teacher_class_assignments WHERE teacher_id = ?').all(teacherId);
    var own = db.prepare('SELECT id FROM classes WHERE created_by = ?').all(teacherId);
    var ids = rows.map(function (r) { return r.class_id; });
    own.forEach(function (c) { if (ids.indexOf(c.id) === -1) ids.push(c.id); });
    return ids;
}
function canAccessClass(db, u, classId) {
    if (!u) return false;
    if (u.role === 'ADMIN') return true;
    if (u.role === 'INSTRUCTOR') {
        var ids = teacherClassIds(db, u.id, u.organization_id);
        return ids.indexOf(classId) !== -1;
    }
    /* STUDENT: hanya anggota kelas itu */
    var c = db.prepare('SELECT 1 AS x FROM class_memberships WHERE class_id = ? AND student_id = ? AND status = ?').get(classId, u.id, 'ACTIVE');
    return !!c;
}
/* guru boleh melihat siswa hanya dalam kelas yang menjadi haknya; admin bebas; siswa hanya dirinya sendiri */
function canSeeStudent(db, u, studentId) {
    if (!u) return false;
    if (u.role === 'ADMIN') return true;
    if (u.role === 'SYSTEM') return true;
    if (u.role === 'INSTRUCTOR') {
        var r = db.prepare([
            'SELECT 1 AS x FROM class_memberships cm',
            'JOIN teacher_class_assignments tca ON tca.class_id = cm.class_id',
            'WHERE tca.teacher_id = ? AND cm.student_id = ? AND cm.status = ?'
        ].join('\n')).get(u.id, studentId, 'ACTIVE');
        return !!r;
    }
    return u.id === studentId;
}
function reachableClassIds(db, u) {
    if (u.role === 'ADMIN') {
        return db.prepare('SELECT id FROM classes').all().map(function (c) { return c.id; });
    }
    if (u.role === 'INSTRUCTOR') return teacherClassIds(db, u.id, u.organization_id);
    if (u.role === 'STUDENT') {
        return db.prepare('SELECT class_id AS id FROM class_memberships WHERE student_id = ? AND status = ?').all(u.id, 'ACTIVE').map(function (c) { return c.id; });
    }
    return [];
}

/* ---------- audit ---------- */
function audit(db, actor, action, entity, entityId, meta) {
    db.prepare('INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, meta, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(randToken(8), actor || null, action, entity || null, entityId || null, meta ? JSON.stringify(meta) : null, new Date().toISOString());
}

module.exports = {
    hashPassword: hashPassword, verifyPassword: verifyPassword, randToken: randToken,
    createSession: createSession, getSessionUser: getSessionUser, destroySession: destroySession,
    publicUser: publicUser, hasRole: hasRole, requireRole: requireRole,
    teacherClassIds: teacherClassIds, canAccessClass: canAccessClass,
    canSeeStudent: canSeeStudent, reachableClassIds: reachableClassIds, audit: audit
};