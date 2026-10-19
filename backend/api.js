'use strict';
/* ============================================================================
   REST API — StarterLab Progress Tracking
   ----------------------------------------------------------------------------
   Semua hak akses & validasi diperiksa DI SERVER (auth.requireRole,
   canAccessClass, canSeeStudent). URL: /api/v1/...
   ============================================================================ */
var auth = require('./auth');
var svc = require('./progress');

function isoDates(obj) {
    Object.keys(obj).forEach(function (k) {
        if (k.indexOf('At') > 0 && typeof obj[k] === 'string') { /* biarkan */ }
    });
    return obj;
}

function err(res, status, code, message) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: { code: code, message: message } }));
}
function ok(res, data) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, data: data }));
}
function tokenOf(req) {
    var h = req.headers['authorization'] || '';
    if (h.indexOf('Bearer ') === 0) return h.slice(7);
    return null;
}
function requireRole(db, req, roles) {
    var t = tokenOf(req);
    var o = auth.requireRole(db, t, roles);
    if (!o.ok) { return { error: true }; }
    return { error: false, user: o.user, token: t };
}

/* ---------- inline serializer ringan supaya data fiktif tidak bocor ke luar ---------- */
function sanitize(userRow, isOwnerOrAdmin) {
    var u = auth.publicUser(userRow);
    if (!isOwnerOrAdmin) { u.nis = u.nis || null; u.nisn = u.nisn || null; u.email = u.email || null; }
    return u;
}

/* ========================================================================
   HANDLERS (masing-masing menerima db, api, params -> respons)
   ======================================================================== */
function api(db, routes) {
    var out = {};
    /* resolve modul by code atau id lengkap */
    function resolveModule(ref) {
        if (!ref) return null;
        return db.prepare('SELECT * FROM learning_modules WHERE id = ? OR code = ? OR id = ? LIMIT 1')
            .get(ref, ref, ref.indexOf('mod-') === 0 ? ref : 'mod-' + ref) || null;
    }

    /* ---------- AUTH ---------- */
    out.login = function (req, res, body) {
        var username = String((body && body.username) || '').trim();
        var password = String((body && body.password) || '');
        if (!username || !password) return err(res, 400, 'MISSING_FIELDS', 'Username dan password wajib diisi.');
        var u = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
        if (!u || !auth.verifyPassword(password, u.password_hash)) {
            return err(res, 401, 'INVALID_CREDENTIALS', 'Username atau sandi salah.');
        }
        if (u.status !== 'ACTIVE') return err(res, 403, 'ACCOUNT_DISABLED', 'Akun sedang tidak aktif.');
        /* Portal login terpisah (ditegakkan di server, setelah sandi benar):
           - portal 'superadmin' hanya menerima role ADMIN
           - portal 'general' (siswa/guru) menolak role ADMIN
           - tanpa portal -> perilaku lama (kompatibel mundur) */
        var portal = String((body && body.portal) || '').toLowerCase();
        if (portal === 'superadmin' && u.role !== 'ADMIN') {
            return err(res, 403, 'WRONG_PORTAL', 'Akun ini bukan Superadmin. Gunakan halaman login Siswa/Guru.');
        }
        if (portal === 'general' && u.role === 'ADMIN') {
            return err(res, 403, 'WRONG_PORTAL', 'Akun Superadmin masuk lewat halaman login khusus Superadmin.');
        }
        var token = auth.createSession(db, u.id);
        auth.audit(db, u.id, 'login', 'user', u.id, {});
        ok(res, { token: token, user: sanitize(u, true) });
    };

    /* Ganti sandi akun sendiri. Dipakai juga untuk ganti sandi bawaan pada login pertama. */
    var KNOWN_DEFAULTS = ['superadmin123', 'siswa123', 'guru123'];
    out.changePassword = function (req, res, body) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        var oldPw = String((body && body.oldPassword) || '');
        var newPw = String((body && body.newPassword) || '');
        if (!auth.verifyPassword(oldPw, u.password_hash)) return err(res, 400, 'BAD_PASSWORD', 'Sandi saat ini salah.');
        if (newPw.length < 8) return err(res, 400, 'WEAK_PASSWORD', 'Sandi baru minimal 8 karakter.');
        if (newPw === oldPw || KNOWN_DEFAULTS.indexOf(newPw.toLowerCase()) !== -1) {
            return err(res, 400, 'WEAK_PASSWORD', 'Sandi baru tidak boleh sama dengan sandi lama atau sandi bawaan.');
        }
        db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(auth.hashPassword(newPw), u.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(u.id, t);
        auth.audit(db, u.id, 'change_password', 'user', u.id, {});
        ok(res, { changed: true });
    };

    out.logout = function (req, res) {
        auth.destroySession(db, tokenOf(req));
        ok(res, { ok: true });
    };

    out.me = function (req, res, body) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        ok(res, {
            user: sanitize(u, true),
            progress: studentData(db, u),
            classes: classesOf(db, u),
            feedback: feedbackList(db, u.id)
        });
    };

    /* ---------- helper data siswa ---------- */
    function classesOf(db, u) {
        var ids = auth.reachableClassIds(db, u);
        if (!ids.length) return [];
        var rows = db.prepare('SELECT * FROM classes WHERE id IN (SELECT value FROM json_each(?)) ORDER BY name').all(JSON.stringify(ids));
        return rows.map(function (c) {
            var n = db.prepare('SELECT COUNT(*) AS c FROM class_memberships WHERE class_id = ? AND status = ?').get(c.id, 'ACTIVE');
            return { id: c.id, name: c.name, program: c.program, subject: c.subject, academicYear: c.academic_year, studentCount: n.c, joinCode: c.join_code };
        });
    }
    function studentData(db, u) {
        return {
            modules: svc.studentProgress(db, u.id),
            assessments: svc.assessmentStats(db, u.id),
            latestScore: svc.avgScoreOf(svc.assessmentStats(db, u.id)),
            lastActiveAt: svc.lastActivity(db, u.id)
        };
    }
    function feedbackList(db, studentId) {
        return db.prepare('SELECT id, teacher_id, class_id, body, created_at FROM teacher_feedback WHERE student_id = ? ORDER BY created_at DESC LIMIT 20').all(studentId).map(function (f) {
            var t = db.prepare('SELECT name FROM users WHERE id = ?').get(f.teacher_id);
            return { id: f.id, teacherName: t ? t.name : null, classId: f.class_id, body: f.body, createdAt: f.created_at };
        });
    }

    /* ---------- PENCATATAN PROGRES (siswa; verifikasi identitas) ---------- */
    out.recordModule = function (req, res, body) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        if (u.role !== 'STUDENT') return err(res, 403, 'FORBIDDEN', 'Hanya siswa.');
        var mod = resolveModule(body && body.moduleId);
        if (!mod) return err(res, 400, 'MODULE_NOT_FOUND', 'Modul tidak dikenal.');
        var status = String((body && body.status) || 'IN_PROGRESS').toUpperCase();
        if (['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'REVIEW'].indexOf(status) === -1) return err(res, 400, 'BAD_STATUS', 'Status tidak valid.');
        if (body.eventKey) {
            var ex = db.prepare('SELECT id FROM learning_activity_events WHERE event_key = ?').get(String(body.eventKey));
            if (ex) return ok(res, { moduleId: mod.id, status: status, dup: true });
        }
        svc.upsertModuleProgress(db, u.id, mod.id, {
            status: status, percent: body.percent, openedAt: body.openedAt
        });
        try {
            svc.recordEvent(db, {
                eventKey: body.eventKey, studentId: u.id, moduleId: mod.id,
                type: status === 'COMPLETED' ? 'module_completed' : 'module_activity',
                payload: { moduleId: mod.id, status: status, percent: body.percent }, createdAt: body.createdAt
            });
        } catch (e) { /* event optional */ }
        ok(res, { moduleId: mod.id, status: status });
    };

    out.recordEvent = function (req, res, body) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        var mod = null;
        if (body && body.moduleId) {
            mod = resolveModule(body.moduleId);
            if (!mod) return err(res, 400, 'MODULE_NOT_FOUND', 'Modul tidak dikenal.');
        }
        var type = String((body && body.type) || '').trim();
        if (!type) return err(res, 400, 'MISSING_TYPE', 'Jenis aktivitas wajib diisi.');
        evt: {
            var id = svc.recordEvent(db, {
                eventKey: body && body.eventKey, studentId: u.id, moduleId: mod ? mod.id : null,
                type: type, payload: (body && body.payload) || null, createdAt: body && body.createdAt
            });
        }
        ok(res, { id: id, type: type });
    };

    out.recordAssessment = function (req, res, body) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        if (!body || !body.assessmentId || typeof body.score !== 'number') return err(res, 400, 'BAD_ATTEMPT', 'assessmentId dan score wajib.');
        var max = body.maxScore || 100;
        var attempt = body.attemptNumber || 1;
        svc.recordAssessmentAttempt(db, {
            studentId: u.id, assessmentId: String(body.assessmentId), attemptNumber: attempt,
            score: Math.round(body.score), maxScore: max, correct: body.correct, wrong: body.wrong,
            percent: body.percent, passed: body.score >= (body.passingScore || 75), startedAt: body.startedAt, submittedAt: body.submittedAt
        });
        if (body.eventKey) {
            var ex = db.prepare('SELECT id FROM learning_activity_events WHERE event_key = ?').get(String(body.eventKey));
            if (!ex) {
                svc.recordEvent(db, { eventKey: body.eventKey, studentId: u.id, moduleId: null, type: 'assessment_result', payload: { assessmentId: body.assessmentId, score: body.score }, createdAt: body.submittedAt });
            }
        }
        ok(res, { assessmentId: body.assessmentId, attemptNumber: attempt, passed: body.score >= (body.passingScore || 75) });
    };

    out.recordSession = function (req, res, body) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        var id = svc.recordSimulatorSession(db, {
            id: body && body.id, studentId: u.id, mode: body && body.mode,
            startedAt: body && body.startedAt, endedAt: body && body.endedAt,
            durationSec: body && body.durationSec, summary: body && body.summary
        });
        ok(res, { id: id });
    };

    out.recordAttempt = function (req, res, body) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        var id = svc.recordSimulatorAttempt(db, {
            sessionId: body && body.sessionId, studentId: u.id, kind: (body && body.kind) || 'generic',
            refId: body && body.refId, payload: body && body.payload, success: body && body.success, createdAt: body && body.createdAt
        });
        ok(res, { id: id });
    };

    out.myProgress = function (req, res) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        ok(res, studentData(db, u));
    };
    out.myActivity = function (req, res) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        var rows = db.prepare('SELECT id, module_id, type, payload, created_at FROM learning_activity_events WHERE student_id = ? ORDER BY created_at DESC LIMIT 100').all(u.id);
        ok(res, rows.map(function (r) {
            var m = r.module_id ? db.prepare('SELECT code, title, type FROM learning_modules WHERE id = ?').get(r.module_id) : null;
            var payload = null;
            try { payload = r.payload ? JSON.parse(r.payload) : null; } catch (e) { /* noop */ }
            return { id: r.id, moduleId: r.module_id, type: r.type, payload: payload, createdAt: r.created_at, module: m };
        }));
    };

    out.importLocal = function (req, res, body) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        if (u.role !== 'STUDENT') return err(res, 403, 'FORBIDDEN', 'Hanya siswa.');
        if (!body || typeof body !== 'object') return err(res, 400, 'BAD_PAYLOAD', 'Payload tidak valid.');
        var store = body.store; /* payload localStorage starterHub_v1 */
        var count = 0;
        db.prepare('INSERT INTO migration_marks (user_id, origin, imported_at, payload_hash, status) VALUES (?,?,?,?,?)')
            .run(u.id, 'starterHub_v1', new Date().toISOString(), String(body.hash || ''), 'PROCESSING');
        /* materi yang paham / cek -> COMPLETED */
        if (store && store.materi) {
            Object.keys(store.materi).forEach(function (k) {
                var r = store.materi[k];
                var mod = resolveModule(k);
                if (!mod) return;
                if (r && (r.paham || r.cek)) {
                    svc.upsertModuleProgress(db, u.id, mod.id, { status: 'COMPLETED', openedAt: r.pahamAt });
                    count++;
                }
            });
        }
        /* kuis -> assessment attempts */
        if (store && store.quiz) {
            Object.keys(store.quiz).forEach(function (qk) {
                var q = store.quiz[qk];
                if (!q || typeof q.best !== 'number') return;
                svc.recordAssessmentAttempt(db, {
                    studentId: u.id, assessmentId: qk, attemptNumber: q.attempts || 1,
                    score: Math.round(q.best), maxScore: 100, percent: q.best, passed: q.best >= 75,
                    submittedAt: q.last || new Date().toISOString()
                });
                count++;
            });
        }
        db.prepare('UPDATE migration_marks SET status = ? WHERE user_id = ? AND origin = ?').run('OK', u.id, 'starterHub_v1');
        auth.audit(db, u.id, 'import_local', 'progress', u.id, { count: count });
        ok(res, { imported: count });
    };

    /* ---------- DASHBOARD GURU ---------- */
    out.teacherClasses = function (req, res) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        if (u.role !== 'INSTRUCTOR' && u.role !== 'ADMIN') return err(res, 403, 'FORBIDDEN', 'Peran tidak diizinkan.');
        ok(res, classesOf(db, u));
    };

    function classParticipants(db, classId, u) {
        if (!auth.canAccessClass(db, u, classId)) return null;
        return db.prepare('SELECT u.* FROM class_memberships cm JOIN users u ON u.id = cm.student_id WHERE cm.class_id = ? AND cm.status = ? ORDER BY u.name COLLATE NOCASE')
            .all(classId, 'ACTIVE');
    }

    out.createClass = function (req, res, body) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        if (u.role === 'STUDENT') return err(res, 403, 'FORBIDDEN', 'Peran tidak diizinkan.');
        var name = String((body && body.name) || '').trim();
        if (!name) return err(res, 400, 'MISSING_FIELDS', 'Nama kelas wajib diisi.');
        var orgId = u.role === 'ADMIN' ? (body && body.organizationId) || u.organization_id : u.organization_id;
        if (!orgId) return err(res, 400, 'NO_ORGANIZATION', 'Akun belum terhubung sekolah.');
        var org = db.prepare('SELECT * FROM organizations WHERE id = ? AND status = ?').get(orgId, 'ACTIVE');
        if (!org) return err(res, 400, 'ORG_INACTIVE', 'Sekolah tidak aktif.');
        var id = auth.randToken(8);
        var code = String((body && body.joinPrefix) || 'TKR').toUpperCase().slice(0, 6) + '-' + svc.nowIso().slice(-6).toUpperCase();
        db.prepare('INSERT INTO classes (id, organization_id, name, level, program, subject, academic_year, join_code, join_enabled, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(id, orgId, name, body && body.level || null, body && body.program || 'Teknik Kendaraan Ringan', body && body.subject || null,
                body && body.academicYear || String(new Date().getFullYear()), code, 1, 'ACTIVE', u.id, new Date().toISOString());
        if (u.role === 'INSTRUCTOR') {
            db.prepare('INSERT INTO teacher_class_assignments (id, class_id, teacher_id, assigned_at) VALUES (?,?,?,?)')
                .run(auth.randToken(8), id, u.id, new Date().toISOString());
        }
        auth.audit(db, u.id, 'create_class', 'class', id, { name: name });
        ok(res, { id: id, joinCode: code });
    };

    out.addStudentToClass = function (req, res, body, params) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        if (u.role === 'STUDENT') return err(res, 403, 'FORBIDDEN', 'Peran tidak diizinkan.');
        var classId = params.classId;
        if (!auth.canAccessClass(db, u, classId)) return err(res, 403, 'FORBIDDEN', 'Bukan kelas Anda.');
        var student = null;
        if (body && body.userId) student = db.prepare('SELECT * FROM users WHERE id = ?').get(body.userId);
        if (!student && body && body.username) student = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(body.username).trim());
        if (!student || student.role !== 'STUDENT') return err(res, 404, 'STUDENT_NOT_FOUND', 'Siswa tidak ditemukan.');
        if (student.status !== 'ACTIVE') return err(res, 400, 'STUDENT_DISABLED', 'Akun siswa tidak aktif.');
        if (!student.organization_id) {
            db.prepare('UPDATE users SET organization_id = ? WHERE id = ?').run(classOrgId(db, classId), student.id);
        }
        var ex = db.prepare('SELECT id FROM class_memberships WHERE class_id = ? AND student_id = ?').get(classId, student.id);
        if (ex) {
            db.prepare('UPDATE class_memberships SET status = ? WHERE id = ?').run('ACTIVE', ex.id);
        } else {
            db.prepare('INSERT INTO class_memberships (id, class_id, student_id, status, joined_at) VALUES (?,?,?,?,?)')
                .run(auth.randToken(8), classId, student.id, 'ACTIVE', new Date().toISOString());
        }
        auth.audit(db, u.id, 'add_student', 'class_member', classId, { studentId: student.id });
        ok(res, { classId: classId, studentId: student.id, name: student.name });
    };
    function classOrgId(db, classId) {
        var c = db.prepare('SELECT organization_id FROM classes WHERE id = ?').get(classId);
        return c ? c.organization_id : null;
    }

    out.classStudents = function (req, res, unused, params) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        var rows = classParticipants(db, params.classId, u);
        if (rows === null) return err(res, 403, 'FORBIDDEN', 'Bukan kelas Anda.');
        ok(res, rows.map(function (s) {
            var p = svc.studentProgress(db, s.id);
            var as = svc.assessmentStats(db, s.id);
            var sc = svc.avgScoreOf(as);
            var status = studentRowStatus(db, s.id, p);
            return { user: sanitize(s, false), progress: p, score: sc, status: status, lastActiveAt: p.lastActiveAt };
        }));
    };
    function studentRowStatus(db, studentId, p) {
        var rules = svc.attentionRules({});
        var reasons = svc.attentionReasons(db, studentId, null, rules);
        if (reasons.length) return { key: 'perlu-pendampingan', label: 'Perlu pendampingan', reasons: reasons };
        if (p.total > 0 && p.completed === p.total) return { key: 'selesai', label: 'Selesai' };
        if (p.anyActivity) return { key: 'berlangsung', label: 'Berlangsung' };
        return { key: 'belum-mulai', label: 'Belum mulai' };
    }

    out.classProgress = function (req, res, unused, params) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        var rows = classParticipants(db, params.classId, u);
        if (rows === null) return err(res, 403, 'FORBIDDEN', 'Bukan kelas Anda.');
        var all = svc.requiredModules(db, null);
        var data = rows.map(function (s) {
            var p = svc.studentProgress(db, s.id);
            var as = svc.assessmentStats(db, s.id);
            return {
                student: { id: s.id, name: s.name, username: s.username, nis: s.nis || null },
                modules: p, score: svc.avgScoreOf(as), best: as.reduce(function (m, a) { return a.best != null && (m == null || a.best > m) ? a.best : m; }, null),
                status: studentRowStatus(db, s.id, p), lastActiveAt: p.lastActiveAt
            };
        });
        var started = 0, notStarted = 0, allDone = 0, attention = 0;
        var sumPct = 0, pctN = 0, sumScore = 0, scoreN = 0;
        data.forEach(function (r) {
            if (r.modules.percent != null) { sumPct += r.modules.percent; pctN++; }
            if (r.score != null) { sumScore += r.score; scoreN++; }
            if (r.modules.anyActivity) started++; else notStarted++;
            if (r.modules.total > 0 && r.modules.completed === r.modules.total) allDone++;
            if (r.status.key === 'perlu-pendampingan') attention++;
        });
        var classPercent = pctN ? Math.round(sumPct / pctN) : null;
        var avgScore = scoreN ? Math.round(sumScore / scoreN) : null;
        ok(res, {
            classId: params.classId, kkm: 75,
            students: data, totals: { total: data.length, started: started, notStarted: notStarted, allDone: allDone, attention: attention },
            avgProgress: classPercent, avgScore: avgScore, classPercent: classPercent
        });
    };

    out.classModules = function (req, res, unused, params) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        var rows = classParticipants(db, params.classId, u);
        if (rows === null) return err(res, 403, 'FORBIDDEN', 'Bukan kelas Anda.');
        var ids = rows.map(function (r) { return r.id; });
        var mods = svc.requiredModules(db, null);
        var result = mods.map(function (m) {
            var done = 0, active = 0, none = 0;
            ids.forEach(function (sid) {
                var r = db.prepare('SELECT status FROM student_module_progress WHERE student_id = ? AND module_id = ?').get(sid, m.id);
                if (!r || r.status === 'NOT_STARTED') none++;
                else if (r.status === 'COMPLETED') done++;
                else active++;
            });
            return { moduleId: m.id, code: m.code, type: m.type, title: m.title, completed: done, inProgress: active, notStarted: none };
        });
        ok(res, { modules: result });
    };

    out.studentDetail = function (req, res, unused, params) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        var studentId = params.studentId;
        if (!auth.canSeeStudent(db, u, studentId)) return err(res, 403, 'FORBIDDEN', 'Bukan siswa yang menjadi kewenangan Anda.');
        var s = db.prepare('SELECT * FROM users WHERE id = ?').get(studentId);
        if (!s) return err(res, 404, 'STUDENT_NOT_FOUND', 'Siswa tidak ditemukan.');
        var p = svc.studentProgress(db, studentId);
        var mods = svc.moduleProgressRows(db, studentId);
        var as = svc.assessmentStats(db, studentId);
        var ev = db.prepare('SELECT id, module_id, type, payload, created_at FROM learning_activity_events WHERE student_id = ? ORDER BY created_at DESC LIMIT 50').all(studentId);
        var attempts = db.prepare('SELECT id, kind, ref_id, payload, success, created_at FROM simulator_attempts WHERE student_id = ? ORDER BY created_at DESC LIMIT 50').all(studentId);
        var sessions = db.prepare('SELECT id, mode, started_at, ended_at, duration_sec FROM simulator_sessions WHERE student_id = ? ORDER BY started_at DESC LIMIT 20').all(studentId);
        var asRows = db.prepare('SELECT a.id, a.assessment_id, a.attempt_number, a.score, a.max_score, a.percent, a.passed, a.submitted_at FROM assessment_attempts a WHERE a.student_id = ? ORDER BY a.submitted_at ASC').all(studentId);
        var fb = feedbackList(db, studentId);
        var rules = svc.attentionRules({});
        ok(res, {
            profile: sanitize(s, u.role !== 'STUDENT' || u.id === studentId),
            progress: p, status: studentRowStatus(db, studentId, p),
            modules: mods.map(function (r) { return { moduleId: r.module_id, code: r.code, type: r.type, title: r.title, status: r.status, percent: r.percent, openedAt: r.opened_at, completedAt: r.completed_at, updatedAt: r.updated_at }; }),
            assessmentHistory: asRows, assessmentStats: as,
            activity: ev.map(function (r) {
                var m = r.module_id ? db.prepare('SELECT code, title FROM learning_modules WHERE id = ?').get(r.module_id) : null;
                var payload = null;
                try { payload = r.payload ? JSON.parse(r.payload) : null; } catch (e) { /* noop */ }
                return { id: r.id, moduleCode: m && m.code, moduleTitle: m && m.title, type: r.type, payload: payload, createdAt: r.created_at };
            }),
            simulatorSessions: sessions,
            simulatorAttempts: attempts.map(function (a) { var x = {}; try { x.payload = a.payload ? JSON.parse(a.payload) : null; } catch (e) { x.payload = null; } return Object.assign({ id: a.id, kind: a.kind, refId: a.ref_id, success: a.success, createdAt: a.created_at }, x); }),
            feedback: fb,
            recommendations: svc.attentionReasons(db, studentId, null, rules),
            nextModule: nextModuleFor(db, studentId, mods)
        });
    };
    function nextModuleFor(db, studentId, rows) {
        var mods = svc.requiredModules(db, null);
        var by = {};
        rows.forEach(function (r) { by[r.module_id] = r; });
        for (var i = 0; i < mods.length; i++) {
            var r = by[mods[i].id];
            if (!r || r.status !== 'COMPLETED') return { moduleId: mods[i].id, code: mods[i].code, title: mods[i].title, type: mods[i].type };
        }
        return null;
    }

    out.addFeedback = function (req, res, body, params) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        if (u.role === 'STUDENT') return err(res, 403, 'FORBIDDEN', 'Peran tidak diizinkan.');
        var studentId = params.studentId;
        if (!auth.canSeeStudent(db, u, studentId)) return err(res, 403, 'FORBIDDEN', 'Bukan siswa yang menjadi kewenangan Anda.');
        var bodyTxt = String((body && body.body) || '').trim();
        if (!bodyTxt) return err(res, 400, 'MISSING_FIELDS', 'Catatan wajib diisi.');
        svc.addFeedback(db, { teacherId: u.id, studentId: studentId, classId: body && body.classId || null, body: bodyTxt });
        auth.audit(db, u.id, 'feedback', 'student', studentId, {});
        ok(res, { ok: true });
    };

    out.exportCsv = function (req, res, unused, params) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('UNAUTHENTICATED'); return; }
        var rows = classParticipants(db, params.classId, u);
        if (rows === null) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('FORBIDDEN'); return; }
        var lines = [];
        lines.push(['No', 'Nama', 'Username', 'NIS/NISN', 'Kelas', 'Progres (%)', 'Modul selesai', 'Nilai terakhir', 'Nilai terbaik', 'Aktivitas terakhir', 'Status belajar'].join(','));
        rows.forEach(function (s, i) {
            var p = svc.studentProgress(db, s.id);
            var as = svc.assessmentStats(db, s.id);
            var score = svc.avgScoreOf(as);
            var best = as.reduce(function (m, a) { return a.best != null && (m == null || a.best > m) ? a.best : m; }, null);
            var st = studentRowStatus(db, s.id, p);
            lines.push([
                i + 1, csv(s.name), csv(s.username), csv(s.nis || ''), csv(clsName(db, params.classId)),
                p.percent == null ? '' : p.percent, p.completed + '/' + p.total,
                score == null ? '' : score, best == null ? '' : best,
                csv((p.lastActiveAt || '').slice(0, 10)), csv(st.key)
            ].join(','));
        });
        var data = '\uFEFF' + lines.join('\r\n');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="progres_kelas_' + params.classId + '_' + String(new Date().getFullYear()) + '.csv"' });
        res.end(data);
    };
    function csv(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    function clsName(db, id) { var c = db.prepare('SELECT name FROM classes WHERE id = ?').get(id); return c ? c.name : ''; }

    /* ---------- ADMIN ---------- */
    function requireAdmin(db, req) {
        var o = requireRole(db, req, ['ADMIN']);
        if (o.error) return null;
        return o.user;
    }
    out.adminStats = function (req, res) {
        var u = requireAdmin(db, req);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Tidak diizinkan.');
        var orgs = db.prepare('SELECT COUNT(*) AS c FROM organizations WHERE status = ?').get('ACTIVE').c;
        var users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
        var guru = db.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ?').get('INSTRUCTOR').c;
        var siswa = db.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ?').get('STUDENT').c;
        var kelas = db.prepare('SELECT COUNT(*) AS c FROM classes').get().c;
        var siswaPending = db.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ? AND status = ?').get('STUDENT', 'PENDING').c;
        ok(res, { organizations: orgs, users: users, teachers: guru, students: siswa, classes: kelas, pendingStudents: siswaPending });
    };
    out.adminUsers = function (req, res) {
        var u = requireAdmin(db, req);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Tidak diizinkan.');
        ok(res, db.prepare('SELECT * FROM users ORDER BY name COLLATE NOCASE').all().map(function (x) { return sanitize(x, true); }));
    };
    out.adminCreateUser = function (req, res, body) {
        var u = requireAdmin(db, req);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Tidak diizinkan.');
        var name = String((body && body.name) || '').trim();
        var username = String((body && body.username) || '').trim();
        var role = String((body && body.role) || '').toUpperCase();
        var password = String((body && body.password) || '');
        if (!name || !username || !password || ['STUDENT', 'INSTRUCTOR'].indexOf(role) === -1) return err(res, 400, 'MISSING_FIELDS', 'name, username, role, password wajib.');
        var ex = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
        if (ex) return err(res, 409, 'USERNAME_TAKEN', 'Username sudah dipakai.');
        var id = 'USER_' + auth.randToken(6);
        var wantOrg = (body && body.organizationId) || u.organization_id || null;
        var orgOk = wantOrg && db.prepare('SELECT 1 AS x FROM organizations WHERE id = ?').get(wantOrg) ? wantOrg : null;
        db.prepare('INSERT INTO users (id, username, name, email, role, status, password_hash, organization_id, nis, nisn, registered_at, last_active_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(id, username, name, (body && body.email) || null, role, 'ACTIVE', auth.hashPassword(password),
                orgOk, (body && body.nis) || null, (body && body.nisn) || null, new Date().toISOString(), null);
        auth.audit(db, u.id, 'create_user', 'user', id, { role: role });
        ok(res, { id: id, user: sanitize(db.prepare('SELECT * FROM users WHERE id = ?').get(id), true) });
    };
    /* Ubah profil sendiri (guru/siswa): nama, dan sandi bila sandi lama benar. Username tidak berubah. */
    out.updateMe = function (req, res, body) {
        var t = tokenOf(req);
        var u = auth.getSessionUser(db, t);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
        if (u.role === 'ADMIN') return err(res, 403, 'FORBIDDEN', 'Akun Superadmin diatur lewat portal Superadmin.');
        var b = body || {};
        var name = b.name != null ? String(b.name).trim() : u.name;
        if (!name) return err(res, 400, 'MISSING_FIELDS', 'Nama tidak boleh kosong.');
        var hash = u.password_hash;
        if (b.newPassword) {
            if (!auth.verifyPassword(String(b.oldPassword || ''), u.password_hash)) return err(res, 400, 'BAD_PASSWORD', 'Sandi saat ini salah.');
            if (String(b.newPassword).length < 8) return err(res, 400, 'WEAK_PASSWORD', 'Sandi baru minimal 8 karakter.');
            hash = auth.hashPassword(String(b.newPassword));
        }
        db.prepare('UPDATE users SET name = ?, password_hash = ? WHERE id = ?').run(name, hash, u.id);
        if (b.newPassword) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(u.id, t);
        auth.audit(db, u.id, 'update_self', 'user', u.id, { password: !!b.newPassword });
        ok(res, { id: u.id, user: sanitize(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id), true) });
    };
    /* Guru mengubah nama / sandi siswa di sekolahnya atau di kelas yang ia ajar. */
    out.teacherUpdateStudent = function (req, res, body, params) {
        var o = requireRole(db, req, ['INSTRUCTOR', 'ADMIN']);
        if (o.error) return err(res, 401, 'UNAUTHENTICATED', 'Tidak diizinkan.');
        var u = o.user;
        var t = db.prepare('SELECT * FROM users WHERE id = ?').get(params.userId);
        if (!t || t.role !== 'STUDENT') return err(res, 404, 'USER_NOT_FOUND', 'Siswa tidak ditemukan.');
        var sameOrg = !!(t.organization_id && t.organization_id === u.organization_id);
        if (u.role !== 'ADMIN' && !sameOrg && !auth.canSeeStudent(db, u, t.id)) return err(res, 403, 'FORBIDDEN', 'Siswa di luar kewenangan Anda.');
        var b = body || {};
        var name = b.name != null ? String(b.name).trim() : t.name;
        if (!name) return err(res, 400, 'MISSING_FIELDS', 'Nama tidak boleh kosong.');
        var hash = t.password_hash;
        if (b.password) {
            if (String(b.password).length < 6) return err(res, 400, 'WEAK_PASSWORD', 'Sandi minimal 6 karakter.');
            hash = auth.hashPassword(String(b.password));
        }
        db.prepare('UPDATE users SET name = ?, password_hash = ? WHERE id = ?').run(name, hash, t.id);
        if (b.password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
        auth.audit(db, u.id, 'teacher_update_student', 'user', t.id, { password: !!b.password });
        ok(res, { id: t.id, user: sanitize(db.prepare('SELECT * FROM users WHERE id = ?').get(t.id), true) });
    };
    /* Ubah data guru/siswa (Superadmin). Peran tidak bisa diubah; username unik. */
    out.adminUpdateUser = function (req, res, body, params) {
        var u = requireAdmin(db, req);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Tidak diizinkan.');
        var t = db.prepare('SELECT * FROM users WHERE id = ?').get(params.userId);
        if (!t) return err(res, 404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan.');
        if (t.role === 'ADMIN') return err(res, 403, 'FORBIDDEN', 'Akun Superadmin tidak dapat diubah lewat endpoint ini.');
        var b = body || {};
        var name = b.name != null ? String(b.name).trim() : t.name;
        var username = b.username != null ? String(b.username).trim() : t.username;
        if (!name || !username) return err(res, 400, 'MISSING_FIELDS', 'name dan username tidak boleh kosong.');
        var dup = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?').get(username, t.id);
        if (dup) return err(res, 409, 'USERNAME_TAKEN', 'Username sudah dipakai.');
        var email = b.email !== undefined ? (b.email ? String(b.email).trim() : null) : t.email;
        if (email) {
            var de = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, t.id);
            if (de) return err(res, 409, 'EMAIL_TAKEN', 'Email sudah dipakai.');
        }
        var nis = b.nis !== undefined ? (b.nis ? String(b.nis).trim() : null) : t.nis;
        var orgId = t.organization_id;
        if (b.organizationId !== undefined) {
            orgId = b.organizationId && db.prepare('SELECT 1 AS x FROM organizations WHERE id = ?').get(b.organizationId) ? b.organizationId : (b.organizationId ? t.organization_id : null);
        }
        var hash = t.password_hash;
        if (b.password) {
            if (String(b.password).length < 6) return err(res, 400, 'WEAK_PASSWORD', 'Sandi minimal 6 karakter.');
            hash = auth.hashPassword(String(b.password));
        }
        db.prepare('UPDATE users SET name = ?, username = ?, email = ?, nis = ?, organization_id = ?, password_hash = ? WHERE id = ?')
            .run(name, username, email, nis, orgId, hash, t.id);
        if (b.password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
        auth.audit(db, u.id, 'update_user', 'user', t.id, { password: !!b.password });
        ok(res, { id: t.id, user: sanitize(db.prepare('SELECT * FROM users WHERE id = ?').get(t.id), true) });
    };
    out.adminSetUserStatus = function (req, res, body, params) {
        var u = requireAdmin(db, req);
        if (!u) return err(res, 401, 'UNAUTHENTICATED', 'Tidak diizinkan.');
        var status = String((body && body.status) || '').toUpperCase();
        if (['ACTIVE', 'PENDING', 'REJECTED', 'DISABLED'].indexOf(status) === -1) return err(res, 400, 'BAD_STATUS', 'Status tidak valid.');
        var target = db.prepare('SELECT * FROM users WHERE id = ?').get(params.userId);
        if (!target) return err(res, 404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan.');
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, target.id);
        if (status !== 'ACTIVE') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
        auth.audit(db, u.id, 'set_user_status', 'user', target.id, { status: status });
        ok(res, { id: target.id, status: status });
    };

    return out;
}

module.exports = { api: api, err: err, ok: ok, tokenOf: tokenOf };