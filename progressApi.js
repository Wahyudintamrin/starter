(function () {
    'use strict';
    /* ============================================================================
       PROGRESS API CLIENT — jembatan frontend <-> server /api/v1
       ----------------------------------------------------------------------------
       Lapisan ini bersifat OPSIONAL dan tidak mengganggu mode offline:
       - Bila server StarterLab aktif, pencatatan progres siswa & dashboard guru
         memakai data server (lintas perangkat).
       - Bila server tidak aktif, aplikasi tetap berjalan penuh dengan
         localStorage (perilaku lama tidak berubah).
       Token disimpan terpisah dari sesi lokal (starterSim_server_token_v1).
       ============================================================================ */

    var BASE = '/api/v1';
    var TKEY = 'starterSim_server_token_v1';
    var UKEY = 'starterSim_server_user_v1';
    var healthState = { value: null, at: 0 };

    function ls(fn, fb) { try { return fn(localStorage); } catch (e) { return fb; } }
    function token() { return ls(function (l) { return l.getItem(TKEY); }, null); }
    function setToken(t) { ls(function (l) { if (t) l.setItem(TKEY, t); else l.removeItem(TKEY); }); }
    function user() {
        return ls(function (l) {
            var v = l.getItem(UKEY);
            try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
        }, null);
    }
    function setUser(u) { ls(function (l) { if (u) l.setItem(UKEY, JSON.stringify(u)); else l.removeItem(UKEY); }); }
    function clearAuth() { setToken(null); setUser(null); }

    function request(method, path, body) {
        if (typeof fetch !== 'function') return Promise.resolve({ ok: false, status: 0, offline: true });
        var headers = {};
        if (body != null) headers['Content-Type'] = 'application/json';
        var t = token();
        if (t) headers['Authorization'] = 'Bearer ' + t;
        return fetch(BASE + path, {
            method: method,
            headers: headers,
            body: body != null ? JSON.stringify(body) : undefined
        }).then(function (r) {
            return r.text().then(function (txt) {
                var json = null;
                try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = null; }
                if (r.status === 401) clearAuth();
                return { ok: r.ok, status: r.status, json: json };
            });
        }).catch(function () {
            return { ok: false, status: 0, offline: true };
        });
    }

    function payload(res) {
        if (res && res.json && res.json.success) return { ok: true, status: res.status, data: res.json.data };
        return { ok: false, status: res ? res.status : 0, error: res && res.json ? res.json.error : { code: 'OFFLINE', message: 'Server tidak tersedia.' }, offline: !!(res && res.offline) };
    }

    /* Cek ketersediaan server (di-cache 15 detik agar hemat). */
    function health(force) {
        if (typeof fetch !== 'function') return Promise.resolve(false);
        var now = Date.now();
        if (!force && healthState.value !== null && now - healthState.at < 15000) {
            return Promise.resolve(healthState.value);
        }
        return fetch('/api/health').then(function (r) { return r.ok; }).catch(function () { return false; })
            .then(function (ok) { healthState.value = ok; healthState.at = Date.now(); return ok; });
    }

    function login(username, password, portal) {
        var body = { username: username, password: password };
        if (portal) body.portal = portal;
        return request('POST', '/auth/login', body).then(function (res) {
            var p = payload(res);
            if (p.ok) { setToken(p.data.token); setUser(p.data.user); return { ok: true, status: 200, user: p.data.user, data: p.data }; }
            return { ok: false, status: p.status, error: p.error };
        });
    }
    function logout() {
        return request('POST', '/auth/logout', {}).then(function () { clearAuth(); return { ok: true }; });
    }
    function init() {
        if (!token()) return Promise.resolve(null);
        return request('GET', '/auth/me').then(function (res) {
            var p = payload(res);
            if (p.ok) { setUser(p.data.user); return p.data; }
            clearAuth();
            return null;
        });
    }

    function recordModule(moduleId, status, eventKey, extra) {
        var b = { moduleId: moduleId, status: status || 'COMPLETED' };
        if (eventKey) b.eventKey = eventKey;
        if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) b[k] = extra[k]; } }
        return request('POST', '/progress/module', b);
    }
    function recordAssessment(p) { return request('POST', '/progress/assessment', p); }
    function recordSession(p) { return request('POST', '/progress/session', p); }
    function recordAttempt(p) { return request('POST', '/progress/attempt', p); }
    function importLocal(store, hash) { return request('POST', '/progress/import', { store: store, hash: hash }); }

    function progress() { return request('GET', '/progress'); }
    function activity() { return request('GET', '/progress/activity'); }
    function teacherClasses() { return request('GET', '/teacher/classes'); }
    function classProgress(classId) { return request('GET', '/classes/' + encodeURIComponent(classId) + '/progress'); }
    function classStudents(classId) { return request('GET', '/classes/' + encodeURIComponent(classId) + '/students'); }
    function classModules(classId) { return request('GET', '/classes/' + encodeURIComponent(classId) + '/modules'); }
    function studentDetail(studentId) { return request('GET', '/students/' + encodeURIComponent(studentId)); }
    function feedback(studentId, text, classId) { return request('POST', '/students/' + encodeURIComponent(studentId) + '/feedback', { body: text, classId: classId || null }); }
    function createClass(p) { return request('POST', '/classes', p); }
    function addStudent(classId, p) { return request('POST', '/classes/' + encodeURIComponent(classId) + '/students', p); }
    function adminStats() { return request('GET', '/admin/stats'); }
    function adminUsers() { return request('GET', '/admin/users'); }
    function adminCreateUser(p) { return request('POST', '/admin/users', p); }
    function adminUpdateUser(id, p) { return request('PUT', '/admin/users/' + encodeURIComponent(id), p); }
    function adminSetUserStatus(id, status) { return request('PATCH', '/admin/users/' + encodeURIComponent(id), { status: status }); }
    function updateMe(p) { return request('PUT', '/me', p); }
    function teacherUpdateStudent(id, p) { return request('PUT', '/teacher/students/' + encodeURIComponent(id), p); }
    function csvUrl(classId) { return BASE + '/classes/' + encodeURIComponent(classId) + '/progress.csv'; }

    function isStudent() { var u = user(); return !!(u && u.role === 'STUDENT'); }
    function isTeacher() { var u = user(); return !!(u && (u.role === 'INSTRUCTOR' || u.role === 'ADMIN')); }

    /* Kirim tanpa memblokir UI; abaikan bila tanpa sesi siswa. */
    function fire(fn) { try { var p = fn(); if (p && p.catch) p.catch(function () { }); } catch (e) { /* noop */ } }

    window.ProgressApi = {
        BASE: BASE,
        token: token, user: user, clearAuth: clearAuth,
        saveSession: function (t, u) { setToken(t); setUser(u); },
        login: login, logout: logout, init: init, health: health,
        changePassword: function (oldPw, newPw) {
            return request('POST', '/auth/change-password', { oldPassword: oldPw, newPassword: newPw }).then(payload);
        },
        isStudent: isStudent, isTeacher: isTeacher,
        progress: progress, activity: activity,
        recordModule: recordModule, recordAssessment: recordAssessment,
        recordSession: recordSession, recordAttempt: recordAttempt,
        importLocal: importLocal, fire: fire,
        teacherClasses: teacherClasses, classProgress: classProgress,
        classStudents: classStudents, classModules: classModules,
        studentDetail: studentDetail, feedback: feedback,
        createClass: createClass, addStudent: addStudent,
        adminStats: adminStats, adminUsers: adminUsers, adminCreateUser: adminCreateUser,
        adminUpdateUser: adminUpdateUser, adminSetUserStatus: adminSetUserStatus, updateMe: updateMe, teacherUpdateStudent: teacherUpdateStudent, csvUrl: csvUrl
    };
})();
