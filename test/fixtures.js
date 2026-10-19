'use strict';
/* ============================================================================
   FIXTURE UJI - BUKAN DATA PRODUK
   Produk tidak membawa sekolah/guru/siswa contoh. Tes yang butuh data memasangnya
   lewat berkas ini (nama netral: "Sekolah Uji", "Guru Uji", "Siswa Uji A/B/C").
   ============================================================================ */
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* sama dengan hashPassword di authUI.js (FNV-1a) agar login lokal dapat dipakai di tes */
function localHash(pw, salt) {
    const s = salt + '|' + pw;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
}

function installLocal(P8) {
    const R = P8.repositories;
    if (R.userRepository.getById('USER_GURU')) return false;
    const now = Date.now();
    R.organizationRepository.save({ id: 'ORG_DEMO', name: 'Sekolah Uji', type: 'SCHOOL', status: 'ACTIVE', createdBy: 'SYSTEM', address: 'Jl. Uji No. 1', adminUserId: 'USER_GURU' });
    function mk(id, name, username, password, role, extra) {
        const salt = 'seed_' + username;
        const u = { id, role, name, username, email: null, organizationId: 'ORG_DEMO', classIds: [], status: 'ACTIVE', passwordHash: localHash(password, salt), salt };
        Object.assign(u, extra || {});
        return R.userRepository.save(u);
    }
    mk('USER_GURU', 'Guru Uji', 'guru', 'guru123', 'INSTRUCTOR', { orgAdmin: true });
    mk('USER_SISWA1', 'Siswa Uji A', 'siswa', 'siswa123', 'STUDENT', { classIds: ['CLASS_DEMO'], nis: '202423001' });
    mk('USER_SISWA2', 'Siswa Uji B', 'siswa2', 'siswa123', 'STUDENT', { classIds: ['CLASS_DEMO'], nis: '202423002' });
    mk('USER_SISWA_PENDING', 'Siswa Uji C', 'rina', 'rina123', 'STUDENT', { status: 'PENDING', requestedAt: now, registeredBy: 'PUBLIC' });
    R.classRepository.save({ id: 'CLASS_DEMO', organizationId: 'ORG_DEMO', name: 'Kelas Uji 1', subject: 'Sistem Starter', instructorIds: ['USER_GURU'], studentIds: ['USER_SISWA1', 'USER_SISWA2'], academicYear: String(new Date().getFullYear()), status: 'ACTIVE', joinCode: 'TKR-AB12', joinEnabled: true, joinExpiresAt: null });
    R.assignmentRepository.save({ id: 'ASSIGN_DEMO1', classId: 'CLASS_DEMO', organizationId: 'ORG_DEMO', type: 'DIAGNOSTIC_CASE', contentId: 'CASE_001', rubricId: null, title: 'Diagnosis: Starter Tidak Berputar', description: 'Temukan penyebab starter tidak berputar.', startAt: null, dueAt: now + 7 * 86400000, attempts: 1, passingScore: 75, timeLimitMs: null, required: true, bestScoreMode: 'BEST', studentIds: [], status: 'PUBLISHED', createdBy: 'USER_GURU', publishedAt: now });
    R.assignmentRepository.save({ id: 'ASSIGN_DEMO2', classId: 'CLASS_DEMO', organizationId: 'ORG_DEMO', type: 'QUIZ', contentId: null, rubricId: null, title: 'Kuis Dasar Sistem Starter', description: 'Kuis pilihan ganda.', startAt: null, dueAt: now + 14 * 86400000, attempts: 1, passingScore: 70, timeLimitMs: null, required: false, bestScoreMode: 'BEST', studentIds: [], status: 'PUBLISHED', createdBy: 'USER_GURU', publishedAt: now });
    R.submissionRepository.save({ id: 'SUB_DEMO1', assignmentId: 'ASSIGN_DEMO1', classId: 'CLASS_DEMO', studentId: 'USER_SISWA1', attemptNumber: 1, startedAt: now - 3600000, submittedAt: now - 1800000, status: 'SUBMITTED', score: null, feedback: null, rubric: null, measurementHistory: [{ label: 'Baterai 12.4V', at: now - 3000000 }], diagnosticPath: [{ label: 'Cek baterai', at: now - 3000000 }], hypotheses: [{ label: 'Relay rusak', at: now - 2000000 }], evidence: [{ label: 'Tidak ada tegangan di terminal 30 relay', at: now - 2100000 }], repairs: [], verification: null, hints: 0, mistakes: [], timeStarted: now - 3600000, timeSpent: 1800000, timeSubmitted: now - 1800000, diagnosticTime: 1200000, testTime: 300000, repairTime: null });
    return true;
}

/* fixture server: sekolah + guru + 2 siswa + 1 kelas (dipasang di atas seed() yang hanya berisi Superadmin) */
function seedServer(db) {
    const auth = require(path.join(ROOT, 'backend', 'auth.js'));
    if (db.prepare("SELECT 1 AS x FROM users WHERE id = 'USER_GURU'").get()) return false;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO organizations (id, name, type, address, status, admin_user_id, created_at) VALUES (?,?,?,?,?,?,?)').run('ORG_DEMO', 'Sekolah Uji', 'SCHOOL', 'Jl. Uji No. 1', 'ACTIVE', null, now);
    function user(id, username, name, role, password, extra) {
        db.prepare('INSERT INTO users (id, username, name, email, role, status, password_hash, organization_id, nis, nisn, registered_at, last_active_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(id, username, name, null, role, 'ACTIVE', auth.hashPassword(password), (extra && extra.organizationId) || null, (extra && extra.nis) || null, null, now, now);
    }
    user('USER_GURU', 'guru', 'Guru Uji', 'INSTRUCTOR', 'guru123', { organizationId: 'ORG_DEMO' });
    user('USER_SISWA1', 'siswa', 'Siswa Uji A', 'STUDENT', 'siswa123', { organizationId: 'ORG_DEMO', nis: '202423001' });
    user('USER_SISWA2', 'siswa2', 'Siswa Uji B', 'STUDENT', 'siswa123', { organizationId: 'ORG_DEMO', nis: '202423002' });
    db.prepare('UPDATE organizations SET admin_user_id = ? WHERE id = ?').run('USER_GURU', 'ORG_DEMO');
    db.prepare('INSERT INTO classes (id, organization_id, name, level, program, subject, academic_year, join_code, join_enabled, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run('CLASS_DEMO', 'ORG_DEMO', 'Kelas Uji 1', 'XII', 'Teknik Kendaraan Ringan', 'Sistem Starter', String(new Date().getFullYear()), 'TKR-AB12', 1, 'ACTIVE', 'USER_GURU', now);
    db.prepare('INSERT INTO teacher_class_assignments (id, class_id, teacher_id, assigned_at) VALUES (?,?,?,?)').run('TCA_DEMO1', 'CLASS_DEMO', 'USER_GURU', now);
    db.prepare('INSERT INTO class_memberships (id, class_id, student_id, status, joined_at) VALUES (?,?,?,?,?)').run('CM_DEMO1', 'CLASS_DEMO', 'USER_SISWA1', 'ACTIVE', now);
    db.prepare('INSERT INTO class_memberships (id, class_id, student_id, status, joined_at) VALUES (?,?,?,?,?)').run('CM_DEMO2', 'CLASS_DEMO', 'USER_SISWA2', 'ACTIVE', now);
    return true;
}

module.exports = { installLocal, seedServer, localHash };
