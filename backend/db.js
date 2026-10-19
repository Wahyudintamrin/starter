'use strict';
/* ============================================================================
   DATABASE LAYER — StarterLab Progress Tracking
   ----------------------------------------------------------------------------
   - node:sqlite (bawaan Node v22.5+/v24) => zero-dependency, tanpa install.
   - Migrasi tersimpan terurut (version). Diterapkan sekali, transaksional.
   - FK aktif. Riwayat belajar TIDAK dihapus otomatis (RESTRICT).
   - Semua timestamp disimpan ISO-8601 UTC (waktu server sebagai acuan).
   ============================================================================ */
var path = require('path');
var { DatabaseSync } = require('node:sqlite');

var MIGRATIONS = [
    {
        version: 1,
        name: 'init-schema',
        sql: [
            'CREATE TABLE IF NOT EXISTS organizations (',
            '  id TEXT PRIMARY KEY,',
            '  name TEXT NOT NULL,',
            '  type TEXT NOT NULL DEFAULT \'SCHOOL\',',
            '  address TEXT,',
            '  status TEXT NOT NULL DEFAULT \'ACTIVE\',',
            '  admin_user_id TEXT,',
            '  created_at TEXT NOT NULL,',
            '  updated_at TEXT,',
            '  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL',
            ');',

            'CREATE TABLE IF NOT EXISTS users (',
            '  id TEXT PRIMARY KEY,',
            '  username TEXT NOT NULL UNIQUE COLLATE NOCASE,',
            '  name TEXT NOT NULL,',
            '  email TEXT UNIQUE,',
            '  role TEXT NOT NULL CHECK (role IN (\'ADMIN\',\'INSTRUCTOR\',\'STUDENT\')),',
            '  status TEXT NOT NULL DEFAULT \'ACTIVE\' CHECK (status IN (\'ACTIVE\',\'PENDING\',\'REJECTED\',\'DISABLED\')),',
            '  password_hash TEXT NOT NULL,',
            '  organization_id TEXT,',
            '  nis TEXT,',
            '  nisn TEXT,',
            '  registered_at TEXT NOT NULL,',
            '  last_active_at TEXT,',
            '  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL',
            ');',

            'CREATE TABLE IF NOT EXISTS classes (',
            '  id TEXT PRIMARY KEY,',
            '  organization_id TEXT NOT NULL,',
            '  name TEXT NOT NULL,',
            '  level TEXT,',
            '  program TEXT NOT NULL DEFAULT \'Teknik Kendaraan Ringan\',',
            '  subject TEXT,',
            '  academic_year TEXT,',
            '  join_code TEXT UNIQUE,',
            '  join_enabled INTEGER NOT NULL DEFAULT 1,',
            '  status TEXT NOT NULL DEFAULT \'ACTIVE\',',
            '  created_by TEXT,',
            '  created_at TEXT NOT NULL,',
            '  updated_at TEXT,',
            '  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE',
            ');',

            'CREATE TABLE IF NOT EXISTS class_memberships (',
            '  id TEXT PRIMARY KEY,',
            '  class_id TEXT NOT NULL,',
            '  student_id TEXT NOT NULL,',
            '  status TEXT NOT NULL DEFAULT \'ACTIVE\' CHECK (status IN (\'ACTIVE\',\'INACTIVE\')),',
            '  joined_at TEXT NOT NULL,',
            '  UNIQUE (class_id, student_id),',
            '  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT,',
            '  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT',
            ');',
            'CREATE INDEX IF NOT EXISTS idx_cm_class ON class_memberships(class_id);',
            'CREATE INDEX IF NOT EXISTS idx_cm_student ON class_memberships(student_id);',

            'CREATE TABLE IF NOT EXISTS teacher_class_assignments (',
            '  id TEXT PRIMARY KEY,',
            '  class_id TEXT NOT NULL,',
            '  teacher_id TEXT NOT NULL,',
            '  assigned_at TEXT NOT NULL,',
            '  UNIQUE (class_id, teacher_id),',
            '  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT,',
            '  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE RESTRICT',
            ');',
            'CREATE INDEX IF NOT EXISTS idx_tca_class ON teacher_class_assignments(class_id);',
            'CREATE INDEX IF NOT EXISTS idx_tca_teacher ON teacher_class_assignments(teacher_id);',

            'CREATE TABLE IF NOT EXISTS learning_modules (',
            '  id TEXT PRIMARY KEY,',
            '  code TEXT,',
            '  type TEXT NOT NULL DEFAULT \'MATERI\' CHECK (type IN (\'MATERI\',\'JOB_SHEET\',\'KASUS_DIAGNOSIS\',\'KUIS\')),',
            '  title TEXT NOT NULL,',
            '  seq INTEGER NOT NULL,',
            '  required INTEGER NOT NULL DEFAULT 1,',
            '  competency TEXT,',
            '  criteria TEXT,',
            '  created_at TEXT NOT NULL',
            ');',
            'CREATE INDEX IF NOT EXISTS idx_lm_seq ON learning_modules(seq);',

            'CREATE TABLE IF NOT EXISTS student_module_progress (',
            '  id TEXT PRIMARY KEY,',
            '  student_id TEXT NOT NULL,',
            '  module_id TEXT NOT NULL,',
            '  status TEXT NOT NULL CHECK (status IN (\'NOT_STARTED\',\'IN_PROGRESS\',\'COMPLETED\',\'REVIEW\')),',
            '  percent INTEGER NOT NULL DEFAULT 0,',
            '  opened_at TEXT,',
            '  completed_at TEXT,',
            '  updated_at TEXT NOT NULL,',
            '  UNIQUE (student_id, module_id),',
            '  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,',
            '  FOREIGN KEY (module_id) REFERENCES learning_modules(id) ON DELETE RESTRICT',
            ');',
            'CREATE INDEX IF NOT EXISTS idx_smp_student ON student_module_progress(student_id);',
            'CREATE INDEX IF NOT EXISTS idx_smp_module ON student_module_progress(module_id);',

            'CREATE TABLE IF NOT EXISTS learning_activity_events (',
            '  id TEXT PRIMARY KEY,',
            '  event_key TEXT UNIQUE,',
            '  student_id TEXT NOT NULL,',
            '  module_id TEXT,',
            '  type TEXT NOT NULL,',
            '  payload TEXT,',
            '  created_at TEXT NOT NULL,',
            '  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,',
            '  FOREIGN KEY (module_id) REFERENCES learning_modules(id) ON DELETE SET NULL',
            ');',
            'CREATE INDEX IF NOT EXISTS idx_lae_student ON learning_activity_events(student_id, created_at);',
            'CREATE INDEX IF NOT EXISTS idx_lae_module ON learning_activity_events(module_id);',
            'CREATE INDEX IF NOT EXISTS idx_lae_key ON learning_activity_events(event_key);',

            'CREATE TABLE IF NOT EXISTS assessment_attempts (',
            '  id TEXT PRIMARY KEY,',
            '  student_id TEXT NOT NULL,',
            '  assessment_id TEXT NOT NULL,',
            '  attempt_number INTEGER NOT NULL DEFAULT 1,',
            '  score INTEGER,',
            '  max_score INTEGER,',
            '  correct INTEGER,',
            '  wrong INTEGER,',
            '  percent REAL,',
            '  passed INTEGER,',
            '  started_at TEXT,',
            '  submitted_at TEXT NOT NULL,',
            '  UNIQUE (student_id, assessment_id, attempt_number),',
            '  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT',
            ');',
            'CREATE INDEX IF NOT EXISTS idx_aa_student ON assessment_attempts(student_id, assessment_id);',

            'CREATE TABLE IF NOT EXISTS simulator_sessions (',
            '  id TEXT PRIMARY KEY,',
            '  student_id TEXT NOT NULL,',
            '  mode TEXT,',
            '  started_at TEXT NOT NULL,',
            '  ended_at TEXT,',
            '  duration_sec INTEGER NOT NULL DEFAULT 0,',
            '  summary TEXT,',
            '  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT',
            ');',
            'CREATE INDEX IF NOT EXISTS idx_ss_student ON simulator_sessions(student_id, started_at);',

            'CREATE TABLE IF NOT EXISTS simulator_attempts (',
            '  id TEXT PRIMARY KEY,',
            '  session_id TEXT,',
            '  student_id TEXT NOT NULL,',
            '  kind TEXT NOT NULL,',
            '  ref_id TEXT,',
            '  payload TEXT,',
            '  success INTEGER,',
            '  created_at TEXT NOT NULL,',
            '  FOREIGN KEY (session_id) REFERENCES simulator_sessions(id) ON DELETE RESTRICT,',
            '  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT',
            ');',
            'CREATE INDEX IF NOT EXISTS idx_sa_student ON simulator_attempts(student_id, created_at);',

            'CREATE TABLE IF NOT EXISTS teacher_feedback (',
            '  id TEXT PRIMARY KEY,',
            '  teacher_id TEXT NOT NULL,',
            '  student_id TEXT NOT NULL,',
            '  class_id TEXT,',
            '  body TEXT NOT NULL,',
            '  created_at TEXT NOT NULL,',
            '  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE RESTRICT,',
            '  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,',
            '  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL',
            ');',
            'CREATE INDEX IF NOT EXISTS idx_tf_student ON teacher_feedback(student_id, created_at);',

            'CREATE TABLE IF NOT EXISTS audit_logs (',
            '  id TEXT PRIMARY KEY,',
            '  actor_id TEXT,',
            '  action TEXT NOT NULL,',
            '  entity TEXT,',
            '  entity_id TEXT,',
            '  meta TEXT,',
            '  created_at TEXT NOT NULL',
            ');',
            'CREATE INDEX IF NOT EXISTS idx_al_created ON audit_logs(created_at);',

            'CREATE TABLE IF NOT EXISTS sessions (',
            '  token TEXT PRIMARY KEY,',
            '  user_id TEXT NOT NULL,',
            '  created_at TEXT NOT NULL,',
            '  expires_at TEXT NOT NULL,',
            '  last_seen_at TEXT,',
            '  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
            ');',
            'CREATE INDEX IF NOT EXISTS idx_sess_user ON sessions(user_id);',

            'CREATE TABLE IF NOT EXISTS migration_marks (',
            '  user_id TEXT PRIMARY KEY,',
            '  origin TEXT NOT NULL,',
            '  imported_at TEXT NOT NULL,',
            '  payload_hash TEXT,',
            '  status TEXT NOT NULL DEFAULT \'OK\',',
            '  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT',
            ');'
        ].join('\n')
    },
    {
        version: 2,
        name: 'must-change-password',
        sql: 'ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;'
    }
];

function migrate(db) {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT NOT NULL);');
    var row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
    var cur = row && row.v ? Number(row.v) : 0;
    var applied = [];
    MIGRATIONS.forEach(function (m) {
        if (m.version <= cur) return;
        db.exec('BEGIN');
        try {
            db.exec(m.sql);
            db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)')
                .run(m.version, m.name, new Date().toISOString());
            db.exec('COMMIT');
            applied.push(m.version);
        } catch (e) {
            db.exec('ROLLBACK');
            throw new Error('Migrasi ' + m.version + ' (' + m.name + ') gagal: ' + e.message);
        }
    });
    return applied;
}

/* Buka database: default ':memory:'; beri path file untuk persistensi. */
function openDb(file) {
    var db = new DatabaseSync(file || ':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    if (file && file !== ':memory:') {
        try { db.exec('PRAGMA journal_mode = WAL;'); } catch (e) { /* memori/sistem file tak mendukung */ }
    }
    var applied = migrate(db);
    return db;
}

function defaultDbFile() {
    return path.join(__dirname, '..', 'data', 'startersim.sqlite');
}

module.exports = { openDb: openDb, migrate: migrate, MIGRATIONS: MIGRATIONS, defaultDbFile: defaultDbFile };