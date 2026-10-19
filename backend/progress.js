'use strict';
/* ============================================================================
   PROGRESS SERVICE — StarterLab
   ----------------------------------------------------------------------------
   Satu lapisan layanan mencatat progres materi/simulator/diagnosis/evaluasi
   dan menyiapkan data dashboard guru. Semua metrik dihitung dari data yang
   benar-benar tersimpan (bukan angka statis).
   Definisi metrik:
   - Modul wajib = learning_modules.required = 1.
   - Progres siswa/kelas = jumlah modul wajib berstatus COMPLETED dibagi total
     modul wajib dikali 100. Jika belum ada modul wajib => null ("Belum tersedia").
   - Status belajar siswa: NOT_STARTED semua => 'belum-mulai'; sudah ada aktivitas
     tapi belum semua tuntas => 'berlangsung'; semua wajib tuntas => 'selesai';
     memenuhi aturan perhatian => 'perlu-perhatian'.
   - Evaluasi: setiap percobaan disimpan terpisah; terbaru & terbaik dipisah.
   - Idempotensi: event di-skip bila event_key sudah ada.
   ============================================================================ */
var auth = require('./auth');
var rand = auth.randToken;

function nowIso() { return new Date().toISOString(); }
function iso(a) {
    if (a == null) return null;
    var d = new Date(a);
    return isNaN(d.getTime()) ? null : d.toISOString();
}
function tod(a) { return new Date(a).getTime(); }
function daysBetween(fromIso, toIso) { return Math.max(0, Math.floor((tod(toIso) - tod(fromIso)) / 86400000)); }
function clampPct(p) {
    p = Number(p);
    if (isNaN(p)) return 0;
    return Math.max(0, Math.min(100, Math.round(p)));
}
function idFor(prefix) { return prefix + '_' + rand(8); }

/* ---------- seed modul konten (idempoten) ---------- */
function ensureModulesSeeded(db) {
    var n = db.prepare('SELECT COUNT(*) AS c FROM learning_modules').get().c;
    if (n > 0) return 0;
    var rows = require('./content').moduleRows();
    var st = db.prepare('INSERT INTO learning_modules (id, code, type, title, seq, required, competency, criteria, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    try {
        rows.forEach(function (r) { st.run(r.id, r.code, r.type, r.title, r.seq, r.required, r.competency, r.criteria, nowIso()); });
        db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return rows.length;
}
function moduleRow(db, moduleId) {
    return db.prepare('SELECT * FROM learning_modules WHERE id = ?').get(moduleId) || null;
}
function moduleByIdCode(db, code) {
    return db.prepare('SELECT * FROM learning_modules WHERE code = ? OR id = ? LIMIT 1').get(code, 'mod-' + code) || null;
}

/* ---------- progres modul per siswa ---------- */
function upsertModuleProgress(db, studentId, moduleId, opts) {
    var now = nowIso();
    var row = db.prepare('SELECT * FROM student_module_progress WHERE student_id = ? AND module_id = ?').get(studentId, moduleId);
    var status = opts.status || (row ? row.status : 'IN_PROGRESS');
    var percent = opts.percent != null ? clampPct(opts.percent) : (row ? row.percent : 0);
    var openedAt = opts.openedAt ? iso(opts.openedAt) : (row ? row.opened_at : null);
    if (status === 'COMPLETED') {
        percent = 100;
        openedAt = openedAt || now;
    }
    if (row) {
        var completedAt = row.completed_at;
        if (status === 'COMPLETED' && !completedAt) completedAt = now;
        db.prepare('UPDATE student_module_progress SET status=?, percent=?, opened_at=COALESCE(?,opened_at), completed_at=COALESCE(?,completed_at), updated_at=? WHERE id=?')
            .run(status, percent, openedAt, completedAt, now, row.id);
        return row.id;
    }
    var completedAt = status === 'COMPLETED' ? now : null;
    var id = idFor('SMP');
    db.prepare('INSERT INTO student_module_progress (id, student_id, module_id, status, percent, opened_at, completed_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, studentId, moduleId, status, percent, openedAt, completedAt, now);
    return id;
}

/* ---------- activity event (idempoten via event_key) ---------- */
function recordEvent(db, opts) {
    var evKey = opts.eventKey;
    if (evKey) {
        var ex = db.prepare('SELECT id FROM learning_activity_events WHERE event_key = ?').get(evKey);
        if (ex) return ex.id;
    }
    var id = idFor('LAE');
    db.prepare('INSERT INTO learning_activity_events (id, event_key, student_id, module_id, type, payload, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, evKey || null, opts.studentId, opts.moduleId || null, opts.type, opts.payload ? JSON.stringify(opts.payload) : null, iso(opts.createdAt) || nowIso());
    return id;
}

/* ---------- evaluasi: riwayat percobaan ---------- */
function recordAssessmentAttempt(db, opts) {
    var dup = db.prepare('SELECT id FROM assessment_attempts WHERE student_id=? AND assessment_id=? AND attempt_number=?')
        .get(opts.studentId, opts.assessmentId, opts.attemptNumber);
    if (dup) return dup.id;
    var percent = opts.maxScore > 0 ? Math.round((opts.score / opts.maxScore) * 100) : (opts.percent != null ? opts.percent : null);
    var id = idFor('AA');
    db.prepare('INSERT INTO assessment_attempts (id, student_id, assessment_id, attempt_number, score, max_score, correct, wrong, percent, passed, started_at, submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, opts.studentId, opts.assessmentId, opts.attemptNumber, opts.score, opts.maxScore,
            opts.correct == null ? null : opts.correct, opts.wrong == null ? null : opts.wrong,
            percent != null ? Math.round(percent) : null, opts.passed ? 1 : 0, iso(opts.startedAt), iso(opts.submittedAt) || nowIso());
    return id;
}

/* ---------- sesi & percobaan simulator ---------- */
function recordSimulatorSession(db, opts) {
    var id = opts.id || idFor('SS');
    db.prepare('INSERT OR IGNORE INTO simulator_sessions (id, student_id, mode, started_at, ended_at, duration_sec, summary) VALUES (?,?,?,?,?,?,?)')
        .run(id, opts.studentId, opts.mode || null, iso(opts.startedAt) || nowIso(), iso(opts.endedAt), opts.durationSec || 0, opts.summary ? JSON.stringify(opts.summary) : null);
    return id;
}
function recordSimulatorAttempt(db, opts) {
    var id = idFor('SA');
    db.prepare('INSERT INTO simulator_attempts (id, session_id, student_id, kind, ref_id, payload, success, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, opts.sessionId || null, opts.studentId, opts.kind, opts.refId || null, opts.payload ? JSON.stringify(opts.payload) : null,
            opts.success == null ? null : (opts.success ? 1 : 0), iso(opts.createdAt) || nowIso());
    return id;
}

/* ---------- umpan balik guru ---------- */
function addFeedback(db, opts) {
    var id = idFor('TF');
    db.prepare('INSERT INTO teacher_feedback (id, teacher_id, student_id, class_id, body, created_at) VALUES (?,?,?,?,?,?)')
        .run(id, opts.teacherId, opts.studentId, opts.classId || null, opts.body, nowIso());
    return id;
}

/* ---------- query helpers ---------- */
function requiredModules(db, type) {
    var sql = 'SELECT * FROM learning_modules WHERE required = 1';
    var params = [];
    if (type) { sql += ' AND type = ?'; params.push(type); }
    sql += ' ORDER BY seq ASC';
    var st = db.prepare(sql);
    return params.length ? st.all.apply(st, params) : st.all();
}
function lastActivity(db, studentId) {
    var r = db.prepare('SELECT MAX(created_at) AS t FROM learning_activity_events WHERE student_id = ?').get(studentId);
    return r && r.t ? r.t : null;
}
function moduleProgressRows(db, studentId) {
    return db.prepare('SELECT smp.*, lm.code, lm.type, lm.title FROM student_module_progress smp JOIN learning_modules lm ON lm.id = smp.module_id WHERE smp.student_id = ? ORDER BY lm.seq ASC').all(studentId);
}
function attemptRows(db, studentId, assessmentId) {
    return db.prepare('SELECT * FROM assessment_attempts WHERE student_id = ? AND assessment_id = ? ORDER BY attempt_number ASC').all(studentId, assessmentId);
}

/* ---------- status belajar + metrik ---------- */
function studentStatus(all, completed, progress) {
    var activity = progress.anyActivity;
    if (all > 0 && completed === all) return 'selesai';
    if (activity) return 'berlangsung';
    return 'belum-mulai';
}

function studentProgress(db, studentId) {
    var mods = requiredModules(db, null);
    if (!mods.length) return { total: 0, completed: 0, inProgress: 0, notStarted: 0, percent: null, anyActivity: false, lastActiveAt: null };
    var rows = moduleProgressRows(db, studentId);
    var byMod = {};
    rows.forEach(function (r) { byMod[r.module_id] = r; });
    var completed = 0, inProgress = 0;
    mods.forEach(function (m) {
        var r = byMod[m.id];
        if (r && r.status === 'COMPLETED') completed++;
        else if (r && (r.status === 'IN_PROGRESS' || r.status === 'REVIEW')) inProgress++;
    });
    var last = lastActivity(db, studentId);
    var any = rows.length > 0 || last != null;
    return {
        total: mods.length, completed: completed, inProgress: inProgress,
        notStarted: mods.length - completed - inProgress,
        percent: mods.length ? Math.round((completed / mods.length) * 100) : null,
        anyActivity: any, lastActiveAt: last
    };
}

function assessmentStats(db, studentId) {
    var subs = db.prepare('SELECT assessment_id, percent, passed, attempt_number FROM assessment_attempts WHERE student_id = ? ORDER BY submitted_at ASC').all(studentId);
    var map = {};
    subs.forEach(function (a) {
        if (!map[a.assessment_id]) map[a.assessment_id] = { attempts: 0, best: null, latest: null, passed: false };
        var e = map[a.assessment_id];
        e.attempts++;
        if (a.percent != null) { e.best = e.best == null ? a.percent : Math.max(e.best, a.percent); e.latest = a.percent; }
        if (a.passed) e.passed = true;
    });
    var arr = Object.keys(map).map(function (k) { return { assessmentId: k };
    }).map(function (o) { return Object.assign(o, map[o.assessmentId]); });
    return arr.sort(function (x, y) { return x.assessmentId < y.assessmentId ? -1 : 1; });
}
function avgScoreOf(rows) {
    var n = 0, sum = 0;
    rows.forEach(function (r) { if (r.percent != null) { n++; sum += r.percent; } });
    return n ? Math.round(sum / n) : null;
}

/* ---------- aturan "perlu pendampingan" (netral, berbasis data) ---------- */
function attentionRules(opts) {
    return {
        inactiveDays: opts && opts.inactiveDays != null ? opts.inactiveDays : 7,
        failAttempts: opts && opts.failAttempts != null ? opts.failAttempts : 2,
        lagPct: opts && opts.lagPct != null ? opts.lagPct : 15
    };
}
function attentionReasons(db, studentId, classPercent, rules) {
    var reasons = [];
    var now = new Date().toISOString();
    var last = lastActivity(db, studentId);
    if (last && daysBetween(last, now) >= rules.inactiveDays) {
        reasons.push('Tidak ada aktivitas belajar selama ' + daysBetween(last, now) + ' hari');
    }
    var as = assessmentStats(db, studentId);
    as.forEach(function (e) {
        if (e.attempts >= rules.failAttempts && e.best != null && e.best < 75) {
            reasons.push('Beberapa kali gagal pada evaluasi ' + e.assessmentId + ' (terbaik ' + e.best + '%)');
        }
    });
    var diagFail = db.prepare('SELECT COUNT(*) AS c FROM learning_activity_events WHERE student_id=? AND type=? AND payload LIKE ?')
        .get(studentId, 'diagnosis_result', '%"success":false%');
    if (diagFail && diagFail.c >= rules.failAttempts) {
        reasons.push('Beberapa kali belum berhasil menyelesaikan diagnosis kerusakan');
    }
    if (classPercent != null && rules.lagPct > 0) {
        var p = studentProgress(db, studentId);
        if (p.percent != null && p.percent >= 0 && p.percent < Math.max(0, classPercent - rules.lagPct)) {
            reasons.push('Progres belajar tertinggal dari rata-rata kelas');
        }
    }
    return reasons;
}

module.exports = {
    nowIso: nowIso, iso: iso, clampPct: clampPct,
    ensureModulesSeeded: ensureModulesSeeded, moduleRow: moduleRow, moduleByIdCode: moduleByIdCode,
    upsertModuleProgress: upsertModuleProgress, recordEvent: recordEvent,
    recordAssessmentAttempt: recordAssessmentAttempt, recordSimulatorSession: recordSimulatorSession,
    recordSimulatorAttempt: recordSimulatorAttempt, addFeedback: addFeedback,
    requiredModules: requiredModules, moduleProgressRows: moduleProgressRows,
    attemptRows: attemptRows, studentProgress: studentProgress,
    assessmentStats: assessmentStats, avgScoreOf: avgScoreOf,
    studentStatus: studentStatus, attentionReasons: attentionReasons, attentionRules: attentionRules,
    lastActivity: lastActivity
};