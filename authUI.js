(function () {
    'use strict';

    var LS_DB = 'starterSim_phase8_db_v1';
    var LS_SESSION = 'starterSim_auth_session_v1';
    /* Sesi login hanya berlaku di tab/jendela ini (sessionStorage): membuka link baru -> wajib login. */
    var LEGACY_GUEST_KEYS = ['starterSim_auth_guest_v1', 'starterSim_auth_guest_count_v1'];
    var APP_URL = 'index.html';
    var LOGIN_URL = 'login.html';
    var SUPERADMIN_URL = 'superadmin.html';
    var LS_IDENT = 'starterSim_identity_v1';
    var LS_OWNER = 'starterSim_data_owner_v1';
    var LS_STASH = 'starterSim_data_stash_v1_';
    /* Data progres lokal yang dipisahkan per akun (satu browser dipakai banyak siswa) */
    var DATA_KEYS = ['starterHub_v1', 'p5Profile', 'p5Progress', 'p5Assessments', 'p5JobSheets',
        'p5Diagnostics', 'p5Achievements', 'p5Meta', 'starterSimulatorProgress',
        'phase4DiagnosticSessions', 'p6Interactions'];

    var ENTITY_STORES = ['users', 'organizations', 'classes', 'assignments', 'submissions',
        'courses', 'contents', 'caseRefs', 'rubrics', 'achievements', 'assessments'];
    var ENTITY_LISTS = ['audit', 'syncQueue', 'notifications', 'activity'];

    /* ---- Supabase (cloud.js). Aktif hanya bila config.js mengisi STARTERLAB_SUPABASE. ---- */
    var CL = (typeof window !== 'undefined') ? window.StarterCloud : null;
    function cloudOn() { return !!(CL && CL.enabled && CL.enabled()); }
    var freshSalts = {};   /* salt baru dari saltFor(): hanya salt ini yang boleh mencatat sandi polos untuk dikirim ke server */
    var LS_LEGACY_BACKUP = 'starterSim_phase8_db_legacy_backup_v1';
    var LS_CLOUD_MIGRATED = 'starterLab_cloud_migrated_v1';
    var SS_FLASH = 'starterLab_flash_v1';

    var ROLE_LABEL = { GUEST: 'Tamu', STUDENT: 'Siswa', INSTRUCTOR: 'Guru', ADMIN: 'Superadmin' };
    var STATUS_LABEL = {
        NOT_STARTED: 'Belum Mulai', IN_PROGRESS: 'Sedang Dikerjakan', SUBMITTED: 'Menunggu Penilaian',
        GRADED: 'Sudah Dinilai', RETURNED: 'Perlu Revisi', COMPLETED: 'Selesai',
        DRAFT: 'Draf', PUBLISHED: 'Terbit', ARCHIVED: 'Arsip',
        PENDING: 'Menunggu Persetujuan', REJECTED: 'Ditolak', ACTIVE: 'Aktif'
    };
    var ORG_TYPE_LABEL = {
        SCHOOL: 'Sekolah', TRAINING_CENTER: 'Pusat Pelatihan',
        AUTOMOTIVE_INSTITUTION: 'Institusi Otomotif', INDIVIDUAL: 'Perorangan'
    };
    var ASSIGN_TYPE_LABEL = {
        LESSON: 'Materi', PRACTICE: 'Praktik', JOB_SHEET: 'Job Sheet', QUIZ: 'Kuis',
        DIAGNOSTIC_CASE: 'Kasus Diagnosis', PRACTICAL_ASSESSMENT: 'Asesmen Praktik'
    };

    var P8 = typeof window !== 'undefined' ? window.Phase8 : null;
    var db = null;
    var realProvider = null;

    var state = {
        tab: 'login',
        forceChange: null,
        registerRole: 'STUDENT',
        session: null,
        message: null,
        dash: { openClass: null, openStudent: null, grading: null, reject: null, addingStudent: null, editClass: null, editSelf: false, editAssign: null, regrade: null, adminTab: 'sekolah', q: '', fOrg: '', editUser: null, addUser: null, detailUser: null, studentQ: '', studentDetail: null },
        classSel: {}
    };

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function readJSON(k, fb) {
        try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; }
    }
    function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
    function removeKey(k) { try { localStorage.removeItem(k); } catch (e) { } }
    /* penyimpanan sesi: sessionStorage (per tab). Cadangan ke localStorage hanya bila sessionStorage tidak ada. */
    function sessStore() {
        try { if (typeof sessionStorage !== 'undefined' && sessionStorage) return sessionStorage; } catch (e) { }
        return null;
    }
    function readSession() {
        var st = sessStore();
        try { var v = (st || localStorage).getItem(LS_SESSION); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    }
    function writeSession(v) {
        var st = sessStore();
        try { (st || localStorage).setItem(LS_SESSION, JSON.stringify(v)); } catch (e) { }
    }
    function clearSession() {
        var st = sessStore();
        try { if (st) st.removeItem(LS_SESSION); } catch (e) { }
        removeKey(LS_SESSION);   /* bersihkan sisa sesi lama yang dulu tersimpan di localStorage */
    }
    function hashStr(s) {
        var h = 2166136261;
        for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return (h >>> 0).toString(36);
    }
    function hashPassword(pw, salt) {
        if (freshSalts[salt]) { delete freshSalts[salt]; if (cloudOn()) CL.notePlain(salt, pw); }
        return hashStr(salt + '|' + pw);
    }
    function saltFor(seed) { var sl = (seed + '_' + Date.now().toString(36)).slice(0, 40); freshSalts[sl] = true; return sl; }
    function fmtDate(ts) {
        if (!ts) return '-';
        try { return new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }
        catch (e) { return '-'; }
    }
    function initials(name) {
        var p = String(name || '?').trim().split(/\s+/);
        return ((p[0] || '?').charAt(0) + (p[1] ? p[1].charAt(0) : '')).toUpperCase();
    }
    function closestAttr(el, attr) {
        while (el && el !== document) {
            if (el.getAttribute && el.getAttribute(attr) != null) return el;
            el = el.parentNode;
        }
        return null;
    }
    function isLoginMode() { return !!$('au-login'); }
    /* 'superadmin' bila halaman login dibuka lewat superadmin.html, selain itu 'general' (siswa/guru) */
    function portalName() {
        var h = $('au-login');
        return (h && h.getAttribute('data-portal') === 'superadmin') ? 'superadmin' : 'general';
    }
    function roleAllowed(role) { return portalName() === 'superadmin' ? role === 'ADMIN' : role !== 'ADMIN'; }
    function wrongPortalMsg() {
        return portalName() === 'superadmin'
            ? 'Akun ini bukan Superadmin. Gunakan halaman login Siswa/Guru.'
            : 'Akun Superadmin masuk lewat halaman login khusus Superadmin.';
    }
    function statusLabel(s) { return STATUS_LABEL[s] || s || '-'; }
    function roleLabel(r) { return ROLE_LABEL[r] || r || '-'; }
    function orgTypeLabel(t) { return ORG_TYPE_LABEL[t] || t || '-'; }
    function assignTypeLabel(t) { return ASSIGN_TYPE_LABEL[t] || t || '-'; }

    function newDb() {
        var d = {};
        ENTITY_STORES.forEach(function (e) { d[e] = {}; });
        ENTITY_LISTS.forEach(function (e) { d[e] = []; });
        return d;
    }
    function persist() {
        writeJSON(LS_DB, db);
        if (cloudOn()) { try { CL.schedulePush(); } catch (e) { /* noop */ } }
    }

    function installStore() {
        if (!P8) return;
        db = readJSON(LS_DB, null) || newDb();
        ENTITY_STORES.forEach(function (e) { if (!db[e] || typeof db[e] !== 'object') db[e] = {}; });
        ENTITY_LISTS.forEach(function (e) { if (!Array.isArray(db[e])) db[e] = []; });
        realProvider = {
            getStore: function (e) { return db[e] || (db[e] = {}); },
            getList: function (e) { return db[e] || (db[e] = []); },
            onSaved: function () { persist(); }
        };
        P8.setStoreProvider(realProvider);
    }

    function maxSeq(prefix) {
        var re = new RegExp('^' + prefix + '_(\\d+)$');
        var max = 0;
        ENTITY_STORES.forEach(function (e) {
            var store = db[e] || {};
            Object.keys(store).forEach(function (id) {
                var m = re.exec(id);
                if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
            });
        });
        return max;
    }

    function primeSequences() {
        var repo = {
            USER: P8.repositories.userRepository, ORG: P8.repositories.organizationRepository,
            CLASS: P8.repositories.classRepository, ASSIGN: P8.repositories.assignmentRepository,
            SUB: P8.repositories.submissionRepository, COURSE: P8.repositories.courseRepository,
            CONT: P8.repositories.contentRepository, CASE: P8.repositories.caseRepository,
            RUB: P8.repositories.rubricRepository, ASMT: P8.repositories.assessmentRepository
        };
        var throwDb = {};
        var throwProvider = {
            getStore: function (e) { return throwDb[e] || (throwDb[e] = {}); },
            getList: function (e) { return throwDb[e] || (throwDb[e] = []); },
            onSaved: function () { }
        };
        Object.keys(repo).forEach(function (prefix) {
            var n = maxSeq(prefix);
            if (!n) return;
            P8.setStoreProvider(throwProvider);
            for (var i = 0; i < n; i++) repo[prefix].save({});
            P8.setStoreProvider(realProvider);
        });
    }

    function ensureSuperadmin() {
        var exists = P8.repositories.userRepository.list().some(function (u) { return u.username === 'superadmin'; });
        if (exists) return;
        var salt = 'seed_superadmin';
        P8.repositories.userRepository.save({
            id: 'USER_SUPERADMIN', role: 'ADMIN', name: 'Superadmin', username: 'superadmin',
            email: null, organizationId: null, classIds: [], status: 'ACTIVE',
            passwordHash: hashPassword('superadmin123', salt), salt: salt
        });
    }

    function ensureSchoolAdmins() {
        P8.repositories.organizationRepository.list().forEach(function (o) {
            if (o.status !== 'ACTIVE') return;
            if (o.adminUserId && P8.repositories.userRepository.getById(o.adminUserId)) return;
            var instr = P8.repositories.userRepository.list().filter(function (x) {
                return x.role === 'INSTRUCTOR' && x.organizationId === o.id;
            })[0];
            if (!instr) return;
            o.adminUserId = instr.id;
            P8.repositories.organizationRepository.save(o);
            if (!instr.orgAdmin) { instr.orgAdmin = true; P8.repositories.userRepository.save(instr); }
        });
    }

    /* Tidak ada data contoh. Sekolah, guru, dan siswa dibuat oleh Superadmin atau lewat pendaftaran.
       Bila browser pernah menyimpan data contoh versi lama, hapus (hanya yang persis cocok id + nama aslinya). */
    var LEGACY_DEMO = {
        users: { USER_GURU: 'Budi Santoso', USER_SISWA1: 'Andi Pratama', USER_SISWA2: 'Siti Aminah', USER_SISWA_PENDING: 'Rina Dewi' },
        org: { ORG_DEMO: 'SMK Negeri 1 Contoh' },
        cls: { CLASS_DEMO: 'XII TKR 1' },
        assigns: ['ASSIGN_DEMO1', 'ASSIGN_DEMO2'],
        subs: ['SUB_DEMO1']
    };
    function purgeLegacyDemo() {
        if (!P8) return 0;
        var R = P8.repositories, removed = 0, demoUserIds = [];
        Object.keys(LEGACY_DEMO.users).forEach(function (id) {
            var u = R.userRepository.getById(id);
            if (u && u.name === LEGACY_DEMO.users[id]) { R.userRepository.remove(id); demoUserIds.push(id); removed++; }
        });
        Object.keys(LEGACY_DEMO.cls).forEach(function (id) {
            var c = R.classRepository.getById(id);
            if (c && c.name === LEGACY_DEMO.cls[id]) {
                R.assignmentRepository.list().forEach(function (a) { if (a.classId === id) { R.assignmentRepository.remove(a.id); removed++; } });
                R.submissionRepository.list().forEach(function (x) { if (x.classId === id) { R.submissionRepository.remove(x.id); removed++; } });
                R.classRepository.remove(id); removed++;
            }
        });
        Object.keys(LEGACY_DEMO.org).forEach(function (id) {
            var o = R.organizationRepository.getById(id);
            if (o && o.name === LEGACY_DEMO.org[id]) {
                var stillUsed = R.userRepository.list().some(function (u) { return u.organizationId === id; })
                    || R.classRepository.list().some(function (c) { return c.organizationId === id; });
                if (!stillUsed) { R.organizationRepository.remove(id); removed++; }
            }
        });
        demoUserIds.forEach(function (id) { try { localStorage.removeItem(LS_STASH + 'u:' + ({ USER_GURU: 'guru', USER_SISWA1: 'siswa', USER_SISWA2: 'siswa2', USER_SISWA_PENDING: 'rina' }[id])); } catch (e) { } });
        return removed;
    }

    /* Roster siswa asli: kelas XI TKR 1 SMKN 3 Makassar (36 siswa) dari berkas
       daftar nama di config.js (window.STARTERLAB_ROSTER). Impor
       IDEMPOTEN tiap boot: pakai sekolah/kelas yang sudah ada (dicocokkan nama),
       tidak menimpa, sandi default 'siswa123' (username = nama tanpa spasi). */
        var ROSTER_NAMES = [];   /* diisi dari window.STARTERLAB_ROSTER (config.js); tidak ada nama di kode */
    function rosterUsernames() {
        ROSTER_NAMES = (typeof window !== 'undefined' && Array.isArray(window.STARTERLAB_ROSTER)) ? window.STARTERLAB_ROSTER : [];
        var used = {};
        return ROSTER_NAMES.map(function (name) {
            var base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'siswa';
            var uname = base, k = 1;
            while (used[uname]) uname = base + (++k);
            used[uname] = true;
            return uname;
        });
    }
    function ensureMakassarRoster() {
        if (!P8) return;
        rosterUsernames();
        if (!ROSTER_NAMES.length) return;
        var R = P8.repositories, now = Date.now();
        var org = R.organizationRepository.list().filter(function (o) {
            return o.name === 'SMKN 3 Makassar';
        })[0];
        if (!org) {
            org = R.organizationRepository.save({
                id: 'ORG_MAKASSAR', name: 'SMKN 3 Makassar', type: 'SCHOOL', status: 'ACTIVE',
                address: 'BTP, Kec. Biringkanaya, Kota Makassar, Sulawesi Selatan', createdBy: 'SYSTEM'
            });
        }
        var cls = R.classRepository.list().filter(function (c) {
            return c.organizationId === org.id && c.name === 'XI TKR 1';
        })[0];
        if (cls) return;
        var usernames = rosterUsernames();
        var ids = [];
        ROSTER_NAMES.forEach(function (name, i) {
            var id = 'MAKR_' + String(i + 1).padStart(2, '0');
            var uname = usernames[i];
            var existing = R.userRepository.list().filter(function (u) {
                return u.username === uname;
            })[0];
            if (existing) { ids.push(existing.id); return; }
            var salt = 'seed_' + uname;
            var user = R.userRepository.save({
                id: id, role: 'STUDENT', name: String(name).trim(), username: uname,
                email: null, organizationId: org.id, classIds: [], status: 'ACTIVE',
                passwordHash: hashPassword('siswa123', salt), salt: salt, createdBy: 'SYSTEM'
            });
            ids.push(user.id);
        });
        R.classRepository.save({
            id: 'CLASS_XITKR1', organizationId: org.id, name: 'XI TKR 1', subject: 'Sistem Starter',
            level: 'XI', instructorIds: [], studentIds: ids, academicYear: String(new Date().getFullYear()),
            status: 'ACTIVE', joinCode: 'TKR-XI1', joinEnabled: true, createdBy: 'SYSTEM'
        });
    }

    function ensureSeed() {
        if (!P8) return;
        hideDemoUsers();
        purgeLegacyDemo();
        LEGACY_GUEST_KEYS.forEach(removeKey);   /* mode tamu sudah ditiadakan */
        if (sessStore()) removeKey(LS_SESSION);   /* sesi lama di localStorage tidak berlaku lagi: wajib login di tab ini */
        if (cloudOn()) return;   /* mode cloud: Superadmin & data awal dimiliki server, jangan dibuat lokal */
        ensureSuperadmin();
        ensureSchoolAdmins();
        ensureMakassarRoster();
    }

    function currentUser() {
        if (!state.session || !P8) return null;
        return P8.repositories.userRepository.getById(state.session.userId) || null;
    }
    function actor() { return currentUser() || { id: null, role: 'GUEST' }; }

    function restoreSession() {
        state.session = readSession();
        if (state.session && !P8.repositories.userRepository.getById(state.session.userId)) { state.session = null; clearSession(); }
        /* mode cloud: sesi tanpa token server (mis. sesi lama sebelum cloud) tidak berlaku, kecuali Demo */
        if (cloudOn() && state.session && !state.session.demo && !CL.hasToken()) { state.session = null; clearSession(); }
        if (!isLoginMode() && !state.session) {
            try { location.replace(LOGIN_URL); } catch (e) { }
        }
    }

    /* ---------- data progres per akun + identitas siswa ---------- */
    function ownerOf(u) { return u ? 'u:' + String(u.username || u.id).toLowerCase() : '_guest'; }
    /* Satu browser bisa dipakai banyak akun. Sebelum akun baru masuk, simpan data progres
       pemilik lama ke 'stash' lalu pulihkan data milik akun baru (atau mulai bersih). */
    function switchDataOwner(newOwner) {
        try {
            var cur = localStorage.getItem(LS_OWNER);
            if (cur === newOwner) return true;
            if (cur) {
                var blob = {};
                DATA_KEYS.forEach(function (k) { var v = localStorage.getItem(k); if (v != null) blob[k] = v; });
                if (cur !== DEMO_OWNER) localStorage.setItem(LS_STASH + cur, JSON.stringify(blob));   /* data demo dibuang, tidak disimpan */
                DATA_KEYS.forEach(function (k) { localStorage.removeItem(k); });
                var mine = null;
                try { mine = JSON.parse(localStorage.getItem(LS_STASH + newOwner)); } catch (e) { mine = null; }
                if (mine && typeof mine === 'object') {
                    Object.keys(mine).forEach(function (k) { if (DATA_KEYS.indexOf(k) !== -1) localStorage.setItem(k, mine[k]); });
                    localStorage.removeItem(LS_STASH + newOwner);
                }
            }
            /* cur kosong: data lama (sebelum fitur ini) diadopsi oleh akun pertama yang masuk */
            localStorage.setItem(LS_OWNER, newOwner);
            return true;
        } catch (e) { return false; }
    }
    function identity() {
        var u = currentUser();
        if (!u) return null;
        var ex = readJSON(LS_IDENT, null);
        if (!ex || ex.username !== u.username) ex = {};
        var kelas = '';
        if (u.role === 'STUDENT') {
            var names = P8.repositories.classRepository.list().filter(function (c) {
                return (c.studentIds || []).indexOf(u.id) !== -1 || (u.classIds || []).indexOf(c.id) !== -1;
            }).map(function (c) { return c.name; });
            (ex.kelas || []).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
            kelas = names.join(', ');
        }
        var sekolah = orgName(u.organizationId) || '';
        var nis = u.nis || ex.nis || '';
        return {
            userId: u.id, username: u.username, role: u.role,
            name: u.name || '', kelas: kelas, sekolah: sekolah, nis: nis,
            locked: { name: !!u.name, kelas: !!kelas, sekolah: !!sekolah, studentId: !!nis }
        };
    }
    function announceIdentity() {
        try { window.dispatchEvent(new CustomEvent('starter:identity', { detail: identity() })); } catch (e) { }
    }

    function setSession(userId) {
        var u = P8.repositories.userRepository.getById(userId);
        if (!u) return;
        switchDataOwner(ownerOf(u));
        if (cloudOn() && !u.isDemo) { try { CL.applyProgress(ownerOf(u)); } catch (e) { /* noop */ } }
        state.session = { userId: u.id, role: u.role, name: u.name, username: u.username, at: Date.now() };
        if (u.isDemo) state.session.demo = true;
        writeSession(state.session);
        state.dash = { openClass: null, openStudent: null, grading: null, reject: null, addingStudent: null, editClass: null, editSelf: false, editAssign: null, regrade: null, adminTab: 'sekolah', q: '', fOrg: '', editUser: null, addUser: null, detailUser: null, studentQ: '', studentDetail: null };
        if (isLoginMode()) { try { location.href = APP_URL; } catch (e) { } return; }
        renderAccount();
        renderDemoBar();
        renderDashboard();
        announceIdentity();
        if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');
    }

    function doLogout() {
        if (cloudOn() && CL.hasToken()) {
            /* kirim perubahan tertunda, cabut token, bersihkan data lokal (komputer sekolah dipakai bergantian) */
            var again = function () { doLogoutNow(); };
            try { CL.logout().then(again, again); } catch (e) { again(); }
            return;
        }
        doLogoutNow();
    }
    function doLogoutNow() {
        var wasAdmin = !!(state.session && state.session.role === 'ADMIN');
        try { if (P8) P8.authService.logout(); } catch (e) { }
        try { if (typeof window !== 'undefined' && window.ProgressApi) window.ProgressApi.clearAuth(); } catch (e) { /* noop */ }
        state.session = null;
        clearSession();
        try { location.href = wasAdmin ? SUPERADMIN_URL : LOGIN_URL; } catch (e) { }
    }

    function msg(kind, text) { state.message = { kind: kind, text: text }; }

    function activeOrgs() {
        if (cloudOn() && isLoginMode() && Array.isArray(state.cloudSchools)) {
            return state.cloudSchools.map(function (o) { return { id: o.id, name: o.name, type: o.type, address: o.address, status: 'ACTIVE' }; });
        }
        return P8.repositories.organizationRepository.list().filter(function (o) { return o.status === 'ACTIVE'; });
    }
    function orgName(id) {
        var o = P8.repositories.organizationRepository.getById(id);
        return o ? o.name : null;
    }
    function userName(id) {
        var u = P8.repositories.userRepository.getById(id);
        return u ? u.name : id;
    }

    function renderSuperadminLogin() {
        var host = $('au-login');
        if (state.forceChange) { renderForceChange(); return; }
        host.innerHTML = ''
            + '<div class="au-wrap">'
            + '  <div class="au-brand">'
            + '    <div class="au-logo"><svg class="au-logo-ico" aria-hidden="true" focusable="false" width="34" height="34" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 1.6"/><path d="M17.5 5.5 10 17h5l-1.5 9.5L22 14.5h-5z" fill="currentColor"/></svg><span>StarterLab</span></div>'
            + '    <div class="au-sub-brand">Portal Superadmin &middot; Platform Pembelajaran Sistem Kelistrikan Otomotif</div>'
            + '  </div>'
            + '  <div class="au-card">'
            + '    <div class="au-hint" style="margin-bottom:.75rem">Halaman ini khusus <b>Superadmin</b>. Siswa dan guru masuk lewat halaman login biasa.</div>'
            + renderMessage()
            + loginForm()
            + '    <div class="au-sep"><span>bukan Superadmin?</span></div>'
            + '    <a class="au-btn au-btn-ghost au-btn-block" style="display:block;text-align:center;text-decoration:none" href="' + LOGIN_URL + '">Ke halaman login Siswa / Guru</a>'
            + '  </div>'
            + '</div>';
    }

    function renderLogin() {
        var host = $('au-login');
        if (!host) return;
        if (state.forceChange) { renderForceChange(); return; }
        if (portalName() === 'superadmin') { state.tab = 'login'; renderSuperadminLogin(); return; }
        var orgs = activeOrgs();
        var schoolOpts = '<option value="">(Pilih sekolah)</option>' + orgs.map(function (o) {
            return '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>';
        }).join('');


        var html = ''
            + '<div class="au-wrap">'
            + '  <div class="au-brand">'
            + '    <div class="au-logo"><svg class="au-logo-ico" aria-hidden="true" focusable="false" width="34" height="34" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 1.6"/><path d="M17.5 5.5 10 17h5l-1.5 9.5L22 14.5h-5z" fill="currentColor"/></svg><span>StarterLab</span></div>'
            + '    <div class="au-sub-brand">Platform Pembelajaran Sistem Kelistrikan Otomotif</div>'
            + '  </div>'
            + '  <div class="au-card">'
            + '    <h2 class="au-card-title">' + (state.tab === 'register' ? 'Buat akun baru' : state.tab === 'school' ? 'Daftarkan sekolah' : 'Selamat datang kembali') + '</h2>'
            + '    <p class="au-card-sub">' + (state.tab === 'register' ? 'Daftar sebagai siswa atau guru untuk mulai belajar.' : state.tab === 'school' ? 'Pendaftaran ditinjau Superadmin sebelum aktif.' : 'Masuk untuk melanjutkan belajar sistem starter.') + '</p>'
            + '    <div class="au-tabs" role="tablist">'
            + '      <button type="button" class="au-tab' + (state.tab === 'login' ? ' active' : '') + '" data-au-tab="login">Masuk</button>'
            + '      <button type="button" class="au-tab' + (state.tab === 'register' ? ' active' : '') + '" data-au-tab="register">Daftar</button>'
            + '      <button type="button" class="au-tab' + (state.tab === 'school' ? ' active' : '') + '" data-au-tab="school">Daftar Sekolah</button>'
            + '    </div>'
            + renderMessage()
            + (state.tab === 'login' ? loginForm() : '')
            + (state.tab === 'register' ? registerForm(schoolOpts) : '')
            + (state.tab === 'school' ? schoolForm() : '')
            + (state.tab === 'login' ? demoCta() : '')
            + '  </div>'
            + '  <div class="au-demo"><b>Butuh bantuan?</b> Jika mengalami kendala saat mendaftar atau masuk, tim dukungan StarterLab siap membantu melalui WhatsApp di <a href="https://wa.me/6285299557045" target="_blank" rel="noopener noreferrer" aria-label="Hubungi dukungan StarterLab melalui WhatsApp 0852-9955-7045">0852-9955-7045</a>.</div>'
            + '</div>';
        host.innerHTML = html;
    }

    function renderMessage() {
        if (!state.message) return '';
        var m = state.message;
        return '<div class="au-msg au-msg-' + esc(m.kind) + '">' + esc(m.text) + '</div>';
    }

    function loginForm() {
        return ''
            + '<form class="au-form' + (state.tab === 'login' ? ' active' : '') + '" data-au-form="login">'
            + '  <label class="au-field"><span>Username</span><input name="username" autocomplete="username" required></label>'
            + '  <label class="au-field"><span>Password</span><span class="au-pw"><input type="password" name="password" autocomplete="current-password" required><button type="button" class="au-pw-btn" data-au-pw aria-label="Tampilkan password" aria-pressed="false">Lihat</button></span></label>'
            + '  <button type="submit" class="au-btn au-btn-block">Masuk</button>'
            + '</form>';
    }

    function registerForm(schoolOpts) {
        return ''
            + '<form class="au-form' + (state.tab === 'register' ? ' active' : '') + '" data-au-form="register">'
            + '  <label class="au-field"><span>Daftar sebagai</span>'
            + '    <select name="role" data-au-role>' 
            + '      <option value="STUDENT"' + (state.registerRole === 'STUDENT' ? ' selected' : '') + '>Siswa</option>'
            + '      <option value="INSTRUCTOR"' + (state.registerRole === 'INSTRUCTOR' ? ' selected' : '') + '>Guru</option>'
            + '    </select></label>'
            + '  <label class="au-field"><span>Nama lengkap</span><input name="name" required></label>'
            + '  <label class="au-field"><span>Username</span><input name="username" autocomplete="username" required></label>'
            + '  <label class="au-field"><span>Email (opsional)</span><input type="email" name="email"></label>'
            + '  <label class="au-field"><span>Password (min. 6)</span><span class="au-pw"><input type="password" name="password" autocomplete="new-password" required minlength="6"><button type="button" class="au-pw-btn" data-au-pw aria-label="Tampilkan password" aria-pressed="false">Lihat</button></span></label>'
            + '  <label class="au-field"><span>Sekolah</span><select name="organizationId">' + schoolOpts + '</select></label>'
            + (schoolOpts.indexOf('<option value="') === schoolOpts.lastIndexOf('<option value="') ? '  <div class="au-hint au-hint-warn"><b>Belum ada sekolah terdaftar.</b> Daftarkan sekolah lebih dulu lewat tab <b>Daftar Sekolah</b>, atau hubungi Superadmin.</div>' : '')
            + '  <div class="au-hint"><b>Siswa</b> &amp; <b>Guru</b> wajib memilih sekolah asal. Pendaftaran siswa ditinjau <b>admin sekolah</b>.</div>'
            + '  <button type="submit" class="au-btn au-btn-block">Daftar</button>'
            + '</form>';
    }

    function schoolForm() {
        return ''
            + '<form class="au-form' + (state.tab === 'school' ? ' active' : '') + '" data-au-form="school">'
            + '  <div class="au-hint">Daftarkan sekolah Anda. Pendaftaran akan ditinjau <b>Superadmin</b> sebelum aktif.</div>'
            + '  <label class="au-field"><span>Nama sekolah</span><input name="name" required></label>'
            + '  <label class="au-field"><span>Alamat</span><input name="address"></label>'
            + '  <label class="au-field"><span>Nama admin/PIC</span><input name="adminName" required></label>'
            + '  <label class="au-field"><span>Username admin</span><input name="adminUsername" autocomplete="username" required></label>'
            + '  <label class="au-field"><span>Password admin (min. 6)</span><span class="au-pw"><input type="password" name="adminPassword" required minlength="6"><button type="button" class="au-pw-btn" data-au-pw aria-label="Tampilkan password" aria-pressed="false">Lihat</button></span></label>'
            + '  <button type="submit" class="au-btn au-btn-block">Kirim Pendaftaran</button>'
            + '</form>';
    }

    function renderAccount() {
        var host = $('au-account');
        if (!host) return;
        var u = currentUser();
        if (u) {
            var org = orgName(u.organizationId);
            host.innerHTML = ''
                + '<div class="au-acc-wrap">'
                + '  <button type="button" class="au-acc au-acc-btn" data-au-menu aria-haspopup="menu" aria-expanded="false" title="' + esc(u.name) + ' - ' + esc(roleLabel(u.role)) + (org ? ', ' + esc(org) : '') + ' (buka menu akun)">'
                + '    <span class="au-acc-avatar" aria-hidden="true">' + esc(initials(u.name)) + '</span>'
                + '    <span class="au-acc-info">'
                + '      <span class="au-acc-name">' + esc(u.name) + '</span>'
                + '      <span class="au-acc-role">' + esc(roleLabel(u.role)) + (org ? ' &middot; ' + esc(org) : '') + '</span>'
                + '    </span>'
                + '    <svg class="au-acc-chev" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>'
                + '  </button>'
                + '  <div class="au-acc-menu" role="menu" hidden>'
                + '    <button type="button" role="menuitem" class="au-acc-item" data-au-act="nav" data-page="dashboard">'
                + '      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>Dashboard</button>'
                + '    <button type="button" role="menuitem" class="au-acc-item au-acc-item-danger" data-au="logout">'
                + '      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Keluar</button>'
                + '  </div>'
                + '</div>';
        } else {
            host.innerHTML = ''
                + '<div class="au-acc">'
                + '  <div class="au-acc-avatar">?</div>'
                + '  <div class="au-acc-info"><div class="au-acc-name">Tamu</div><div class="au-acc-role">Belum masuk</div></div>'
                + '</div>'
                + '<div class="au-acc-actions"><button type="button" class="au-btn-sm" data-au="login">Masuk</button></div>';
        }
    }

    var STAT_ICONS = {
        'Kelas': '<path d="M3 9l9-6 9 6-9 6-9-6z"/><path d="M7 12v5c0 1.5 2.2 3 5 3s5-1.5 5-3v-5"/>',
        'Siswa': '<path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M21 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
        'Tugas Aktif': '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>',
        'Belum Selesai': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        'Rata-rata Nilai': '<polygon points="12 2 15 9 22 9.3 16.5 14 18.2 21 12 17 5.8 21 7.5 14 2 9.3 9 9"/>',
        'Menunggu Penilaian': '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
        'Sekolah Aktif': '<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/>',
        'Menunggu': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        'Ditolak': '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
        'Total Pengguna': '<path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M21 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
        'Guru': '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
        'Siswa Menunggu': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
    };
    function statCard(label, value, tone) {
        var ic = STAT_ICONS[label];
        return '<div class="dash-stat' + (tone ? ' dash-stat-' + tone : '') + '">'
            + (ic ? '<span class="dash-stat-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ic + '</svg></span>' : '')
            + '<div class="dash-stat-txt"><div class="dash-stat-val">' + esc(value) + '</div><div class="dash-stat-label">' + esc(label) + '</div></div></div>';
    }

    var EMPTY_ICONS = {
        kelas: '<path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M21 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
        tugas: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>',
        nilai: '<polygon points="12 2 15 9 22 9.3 16.5 14 18.2 21 12 17 5.8 21 7.5 14 2 9.3 9 9"/>',
        notif: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>'
    };
    function emptyState(title, text, actionHtml, icon) {
        var ic = icon && EMPTY_ICONS[icon];
        return '<div class="dash-empty dash-empty-rich">'
            + (ic ? '<span class="dash-empty-ico" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ic + '</svg></span>' : '')
            + '<b>' + esc(title) + '</b><span>' + esc(text) + '</span>' + (actionHtml || '') + '</div>';
    }
    function progressCard() {
        var H = window.StarterHub;
        if (!H || typeof H.summary !== 'function') return '';
        var sm;
        try { sm = H.summary(); } catch (e) { return ''; }
        var rows = [['Materi', sm.p.materi], ['Praktik', sm.p.praktik], ['Diagnosis', sm.p.diag], ['Evaluasi', sm.p.eval]];
        return '<div class="dash-card dash-progress"><div class="dash-card-head"><h3>Progres Belajar</h3><span class="dash-tag">' + sm.overall + '% keseluruhan</span></div>'
            + rows.map(function (r) {
                return '<div class="dash-prog-row"><span>' + r[0] + '</span><div class="dash-bar"><div class="dash-bar-fill" style="width:' + r[1] + '%"></div></div><b>' + r[1] + '%</b></div>';
            }).join('')
            + '<div class="dash-prog-actions"><button type="button" class="au-btn-sm au-btn-primary" onclick="StarterHub.startNext()">Lanjutkan belajar</button>'
            + '<button type="button" class="au-btn-sm" data-au-act="nav" data-page="progres">Lihat progres</button></div></div>';
    }

    function renderDashboard() {
        var host = $('au-dashboard');
        if (!host) return;
        var u = currentUser();
        if (!u) {
            host.innerHTML = '<div class="au-empty">Silakan masuk terlebih dahulu.</div>';
            return;
        }
        var body;
        try {
            if (u.role === 'STUDENT') body = studentDash(u);
            else if (u.role === 'ADMIN') body = superadminDash(u);
            else body = instructorDash(u);
        } catch (err) {
            body = '<div class="au-msg au-msg-error">Dashboard gagal dimuat: ' + esc(err && err.message) + '. Klik Segarkan untuk mencoba lagi.</div>'
                + '<div class="dash-actions-bar"><button type="button" class="au-btn-sm" data-au-act="refresh">Segarkan</button></div>';
        }
        host.innerHTML = renderMessage() + body;
        state.message = null;
    }

    function submissionFor(studentId, assignmentId) {
        var list = P8.repositories.submissionRepository.list().filter(function (s) {
            return s.studentId === studentId && s.assignmentId === assignmentId;
        });
        return list.length ? list[list.length - 1] : null;
    }

    function studentDash(u) {
        var d = P8.dashboardService.studentFor(u.id, u);
        var data = d.success ? d.data : { classes: [], currentAssignments: [], assignmentProgress: { submissions: 0, completed: 0 }, diagnosticCases: [], recentActivity: [] };
        var subs = P8.repositories.submissionRepository.list().filter(function (s) { return s.studentId === u.id; });
        var scored = subs.filter(function (s) { return typeof s.score === 'number'; });
        var avg = scored.length ? Math.round(scored.reduce(function (a, s) { return a + s.score; }, 0) / scored.length) : null;
        var notifs = P8.notificationService.list(u.id).slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 5);
        var pending = data.currentAssignments.filter(function (a) {
            var s = submissionFor(u.id, a.id);
            return !s || s.status === 'NOT_STARTED' || s.status === 'RETURNED';
        }).length;

        var html = ''
            + '<div class="dash-head dash-head-user"><span class="dash-avatar" aria-hidden="true">' + initials(u.name) + '</span><div><h2>Halo, ' + esc(u.name) + '</h2><p>Ringkasan belajar Anda' + (orgName(u.organizationId) ? ' di ' + esc(orgName(u.organizationId)) : '') + '.</p></div></div>'
            + '<div class="dash-stats">'
            + statCard('Kelas', data.classes.length)
            + statCard('Tugas Aktif', data.currentAssignments.length)
            + statCard('Belum Selesai', pending, pending ? 'warn' : '')
            + statCard('Rata-rata Nilai', avg == null ? '-' : avg, avg != null && avg >= 75 ? 'good' : '')
            + '</div>';

        html += '<div class="dash-grid">';
        html += progressCard();

        html += '<div class="dash-card"><div class="dash-card-head"><h3>Kelas Saya</h3></div>'
            + (data.classes.length ? '<ul class="dash-list">' + data.classes.map(function (c) {
                return '<li><div class="dash-li-main"><b>' + esc(c.name) + '</b><span>' + esc(c.subject || '') + (c.academicYear ? ' &middot; ' + esc(c.academicYear) : '') + '</span></div></li>';
            }).join('') + '</ul>' : emptyState('Belum bergabung ke kelas', 'Masukkan kode kelas dari guru Anda pada kolom di bawah.', '', 'kelas'))
            + '<form class="dash-inline-form" data-au-form="join">'
            + '  <input name="code" placeholder="Kode kelas (mis. TKR-AB12)" autocomplete="off">'
            + '  <button type="submit" class="au-btn-sm">Gabung</button>'
            + '</form></div>';

        html += '<div class="dash-card"><div class="dash-card-head"><h3>Tugas</h3></div>'
            + (data.currentAssignments.length ? '<ul class="dash-list">' + data.currentAssignments.map(function (a) {
                var s = submissionFor(u.id, a.id);
                var st = s ? s.status : 'NOT_STARTED';
                var target = a.type === 'DIAGNOSTIC_CASE' ? 'diagnosis' : (a.type === 'QUIZ' ? 'evaluasi' : 'materi');
                return '<li><div class="dash-li-main"><b>' + esc(a.title) + '</b><span>' + esc(assignTypeLabel(a.type)) + ' &middot; ' + esc(statusLabel(st)) + (a.dueAt ? ' &middot; tenggat ' + esc(fmtDate(a.dueAt)) : '') + '</span></div>'
                    + '<button class="au-btn-sm" data-au-act="nav" data-page="' + esc(target) + '">' + (st === 'IN_PROGRESS' ? 'Lanjutkan' : 'Kerjakan') + '</button></li>';
            }).join('') + '</ul>' : emptyState('Belum ada tugas', 'Tugas dari guru akan tampil di sini. Sambil menunggu, latih diagnosis mandiri.', '<button type="button" class="au-btn-sm" data-au-act="nav" data-page="diagnosis">Buka Diagnosis</button>', 'tugas')) + '</div>';

        var scoreSubs = subs.filter(function (s) { return typeof s.score === 'number' || s.status === 'RETURNED'; });
        if (!scoreSubs.length && !notifs.length) {
            html += '<div class="dash-card dash-card-wide"><div class="dash-card-head"><h3>Nilai &amp; Notifikasi</h3></div>'
                + emptyState('Belum ada nilai atau notifikasi', 'Nilai, umpan balik guru, dan pemberitahuan sekolah akan muncul di sini setelah tugas dinilai.', '<button type="button" class="au-btn-sm" data-au-act="nav" data-page="evaluasi">Kerjakan kuis</button>', 'nilai') + '</div>';
        } else {
        html += '<div class="dash-card"><div class="dash-card-head"><h3>Nilai &amp; Umpan Balik</h3></div>'
            + (scoreSubs.length ? '<ul class="dash-list">' + scoreSubs.map(function (s) {
                var a = P8.repositories.assignmentRepository.getById(s.assignmentId);
                return '<li><div class="dash-li-main"><b>' + esc(a ? a.title : s.assignmentId) + '</b><span>' + esc(statusLabel(s.status)) + (s.feedback ? ' &middot; ' + esc(s.feedback) : '') + '</span></div>'
                    + '<span class="dash-score">' + (s.score == null ? '-' : esc(s.score)) + '</span></li>';
            }).join('') + '</ul>' : emptyState('Belum ada nilai', 'Nilai dan umpan balik guru akan muncul setelah tugas dinilai.', '<button type="button" class="au-btn-sm" data-au-act="nav" data-page="evaluasi">Kerjakan kuis</button>', 'nilai')) + '</div>';

        html += '<div class="dash-card"><div class="dash-card-head"><h3>Notifikasi</h3></div>'
            + (notifs.length ? '<ul class="dash-list">' + notifs.map(function (n) {
                return '<li><div class="dash-li-main"><b>' + esc(n.title) + '</b><span>' + esc(n.body) + ' &middot; ' + esc(fmtDate(n.createdAt)) + '</span></div></li>';
            }).join('') + '</ul>' : emptyState('Tidak ada notifikasi', 'Pemberitahuan baru dari guru atau sekolah akan muncul di sini.', '', 'notif')) + '</div>';
        }

        html += '</div>';
        return html;
    }

    function instructorDash(u) {
        var d = P8.dashboardService.instructorFor(u.id, u);
        var data = d.success ? d.data : { classes: [], totals: {}, recentSubmissions: [] };
        var classList = P8.classService.listClasses(u).data || [];
        var classById = {};
        classList.forEach(function (c) { classById[c.id] = c; });
        var assigns = P8.assignmentService.list(u).data || [];
        var queue = P8.gradingService.queue(u).data || [];
        var t = data.totals || {};

        var html = ''
            + '<div class="dash-head"><h2>Dashboard Guru</h2><p>' + esc(u.name) + (orgName(u.organizationId) ? ' &middot; ' + esc(orgName(u.organizationId)) : '') + '</p></div>'
            + '<div class="dash-stats">'
            + statCard('Kelas', t.classes || data.classes.length)
            + statCard('Siswa', t.students || 0)
            + statCard('Tugas Aktif', t.activeAssignments || 0)
            + statCard('Menunggu Penilaian', t.pendingAssessments || queue.length, (t.pendingAssessments || queue.length) ? 'warn' : '')
            + '</div>'
            + '<div class="dash-actions-bar"><button type="button" class="au-btn-sm" data-au-act="refresh">Segarkan</button></div>';

        html += selfCard(u);

        if (isOrgAdmin(u)) {
            var pendSiswa = pendingStudentsFor(u.organizationId);
            html += '<div class="dash-card"><div class="dash-card-head"><h3>Pendaftaran Siswa Menunggu</h3>'
                + (pendSiswa.length ? '<span class="dash-tag">' + pendSiswa.length + ' baru</span>' : '') + '</div>'
                + (pendSiswa.length ? pendSiswa.map(function (s) { return pendingStudentRow(s, false); }).join('')
                    : '<p class="dash-empty">Tidak ada pendaftaran siswa menunggu.</p>')
                + '</div>';
        }

        html += '<div class="dash-card"><div class="dash-card-head"><h3>Buat Kelas</h3></div>'
            + '<form class="dash-form" data-au-form="create-class">'
            + '  <input name="name" placeholder="Nama kelas (mis. XII TKR 2)" required>'
            + '  <input name="subject" placeholder="Mata pelajaran (Sistem Starter)">'
            + '  <input name="joinPrefix" placeholder="Awalan kode (mis. TKR)" maxlength="3">'
            + '  <button type="submit" class="au-btn-sm">Buat Kelas</button>'
            + '</form></div>';

        html += '<div class="dash-card"><div class="dash-card-head"><h3>Kelas Saya</h3></div>';
        if (!data.classes.length) html += '<p class="dash-empty">Belum ada kelas.</p>';
        data.classes.forEach(function (c) {
            var full = classById[c.id] || {};
            var open = state.dash.openClass === c.id;
            html += '<div class="dash-class">'
                + '  <div class="dash-class-head">'
                + '    <div><b>' + esc(c.name) + '</b><span>' + esc(c.subject || '') + ' &middot; ' + esc((c.studentCount || 0)) + ' siswa</span></div>'
                + '    <div class="dash-class-meta">'
                + '      <button type="button" class="au-copy" data-au-act="copy-code" data-code="' + esc(full.joinCode || '') + '" title="Salin kode kelas">' + esc(full.joinCode || '-') + '</button>'
                + '      <button type="button" class="au-btn-sm" data-au-act="edit-class" data-class="' + esc(c.id) + '">' + (state.dash.editClass === c.id ? 'Tutup Edit' : 'Edit') + '</button>'
                + '      <button type="button" class="au-btn-sm" data-au-act="regen" data-class="' + esc(c.id) + '">Kode Baru</button>'
                + '      <button type="button" class="au-btn-sm" data-au-act="toggle-class" data-class="' + esc(c.id) + '">' + (open ? 'Tutup' : 'Kelola') + '</button>'
                + '    </div>'
                + '  </div>'
                + '  <div class="dash-bar"><div class="dash-bar-fill" style="width:' + (c.progress && c.progress.completionRate || 0) + '%"></div></div>';
            if (state.dash.editClass === c.id) html += '<div class="dash-detail">' + classEditForm(full.id ? full : c) + '</div>';
            if (open) html += classPanel(u, c, full);
            html += '</div>';
        });
        html += '</div>';

        var archived = classList.filter(function (c) { return c.status === 'ARCHIVED'; });
        if (archived.length) {
            html += '<div class="dash-card"><div class="dash-card-head"><h3>Kelas Diarsipkan</h3></div>';
            archived.forEach(function (c) {
                html += '<div class="dash-row"><div class="dash-li-main"><b>' + esc(c.name) + '</b><span>' + esc(c.subject || '') + ' &middot; ' + (c.studentIds || []).length + ' siswa</span></div>'
                    + '<button type="button" class="au-btn-sm au-btn-ok" data-au-act="restore-class" data-class="' + esc(c.id) + '">Aktifkan Kembali</button></div>';
            });
            html += '</div>';
        }

        html += userManager(u, 'STUDENT');

        html += '<div class="dash-card"><div class="dash-card-head"><h3>Buat Tugas</h3></div>'
            + '<form class="dash-form dash-form-wrap" data-au-form="create-assign">'
            + '  <select name="classId" required>' + (classList.length ? classList.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') : '<option value="">(belum ada kelas)</option>') + '</select>'
            + '  <select name="type">' + (P8.ASSIGNMENT_TYPES || []).map(function (ty) { return '<option value="' + esc(ty) + '">' + esc(assignTypeLabel(ty)) + '</option>'; }).join('') + '</select>'
            + '  <input name="title" placeholder="Judul tugas" required>'
            + '  <input name="contentId" placeholder="ID konten/kasus (opsional)">'
            + '  <input name="dueAt" type="date" title="Tenggat">'
            + '  <input name="passingScore" type="number" min="0" max="100" placeholder="KKM (75)">'
            + '  <button type="submit" class="au-btn-sm">Buat &amp; Terbitkan</button>'
            + '</form></div>';

        html += '<div class="dash-card"><div class="dash-card-head"><h3>Tugas</h3></div>';
        if (!assigns.length) html += '<p class="dash-empty">Belum ada tugas.</p>';
        assigns.forEach(function (a) {
            var cls = classById[a.classId];
            var editing = state.dash.editAssign === a.id;
            html += '<div class="dash-row dash-assign-row">'
                + '  <div class="dash-li-main"><b>' + esc(a.title) + '</b><span>' + esc(assignTypeLabel(a.type)) + ' &middot; ' + esc(cls ? cls.name : a.classId) + ' &middot; ' + esc(statusLabel(a.status))
                + (a.dueAt ? ' &middot; tenggat ' + esc(fmtDate(a.dueAt)) : '') + ((a.studentIds || []).length ? ' &middot; ' + a.studentIds.length + ' siswa tertentu' : '') + '</span></div>'
                + '  <div class="dash-mini-actions">'
                + '<button type="button" class="au-btn-sm" data-au-act="edit-assign" data-assign="' + esc(a.id) + '">' + (editing ? 'Tutup Edit' : 'Edit') + '</button>'
                + (a.status === 'DRAFT' ? '<button class="au-btn-sm" data-au-act="publish-assign" data-assign="' + esc(a.id) + '">Terbitkan</button>' : '<span class="dash-tag">' + esc(statusLabel(a.status)) + '</span>')
                + '  </div>'
                + (editing ? '<div class="dash-detail dash-assign-edit">' + assignEditForm(a, classList) + '</div>' : '')
                + '</div>';
        });
        html += '</div>';

        html += '<div class="dash-card"><div class="dash-card-head"><h3>Penilaian</h3></div>';
        if (!queue.length) html += '<p class="dash-empty">Tidak ada kiriman menunggu penilaian.</p>';
        queue.forEach(function (s) {
            var a = P8.repositories.assignmentRepository.getById(s.assignmentId);
            var open = state.dash.grading === s.id;
            html += '<div class="dash-row dash-grade">'
                + '  <div class="dash-li-main"><b>' + esc(userName(s.studentId)) + '</b><span>' + esc(a ? a.title : s.assignmentId) + ' &middot; dikumpulkan ' + esc(fmtDate(s.submittedAt || s.updatedAt)) + '</span></div>'
                + '  <button type="button" class="au-btn-sm" data-au-act="grade-open" data-sub="' + esc(s.id) + '">' + (open ? 'Tutup' : 'Nilai') + '</button>';
            if (open) html += gradeForm(s);
            html += '</div>';
        });
        html += '</div>';

        return html;
    }

    /* ---------- akun sendiri (guru): ubah nama & sandi ---------- */
    function selfCard(u) {
        var open = !!state.dash.editSelf;
        var html = '<div class="dash-card dash-self"><div class="dash-card-head"><h3>Akun Saya</h3>'
            + '<button type="button" class="au-btn-sm" data-au-act="edit-self">' + (open ? 'Tutup Edit' : 'Edit Nama &amp; Sandi') + '</button></div>'
            + '<div class="dash-kv-grid">' + kv('Nama', esc(u.name)) + kv('Username', '@' + esc(u.username || '')) + kv('Sekolah', esc(orgName(u.organizationId) || '-')) + '</div>';
        if (open) {
            html += '<form class="dash-userform" data-au-form="edit-self" novalidate autocomplete="off">'
                + '<div class="dash-form-title">Edit akun saya</div>'
                + '<div class="dash-form-grid">'
                + '<label class="dash-field"><span>Nama lengkap *</span><input name="name" value="' + esc(u.name) + '" maxlength="100" required></label>'
                + '<label class="dash-field"><span>Sandi saat ini (wajib bila mengganti sandi)</span><input name="oldPassword" type="password" autocomplete="current-password"></label>'
                + '<label class="dash-field"><span>Sandi baru (min. 8 karakter, kosongkan bila tidak diganti)</span><input name="newPassword" type="password" autocomplete="new-password"></label>'
                + '<label class="dash-field"><span>Ulangi sandi baru</span><input name="confirmPassword" type="password" autocomplete="new-password"></label>'
                + '</div><div class="dash-form-actions">'
                + '<button type="submit" class="au-btn-sm au-btn-ok">Simpan</button>'
                + '<button type="button" class="au-btn-sm au-btn-ghost" data-au-act="edit-self">Batal</button></div></form>';
        }
        return html + '</div>';
    }
    function submitEditSelf(form) {
        var u = currentUser();
        if (!u || u.role === 'ADMIN') return;
        var repo = P8.repositories.userRepository;
        var rec = repo.getById(u.id);
        function bad(t) { msg('error', t); renderDashboard(); }
        var name = fval(form, 'name').trim();
        var oldPw = fval(form, 'oldPassword'), np = fval(form, 'newPassword'), cp = fval(form, 'confirmPassword');
        if (!name) return bad('Nama lengkap wajib diisi.');
        if (np) {
            if (!cloudOn() && hashPassword(oldPw, rec.salt) !== rec.passwordHash) return bad('Sandi saat ini salah.');
            if (np.length < 8) return bad('Sandi baru minimal 8 karakter.');
            if (np !== cp) return bad('Konfirmasi sandi baru tidak sama.');
            if (np === oldPw) return bad('Sandi baru harus berbeda dari sandi lama.');
        }
        var PA = serverTokenApi();
        function applyLocal() {
            rec.name = name;
            if (np && !cloudOn()) { rec.salt = saltFor(rec.username); rec.passwordHash = hashPassword(np, rec.salt); }
            repo.save(rec);
            state.dash.editSelf = false;
            msg('ok', np ? 'Nama dan sandi diperbarui.' : 'Nama diperbarui.');
            renderAccount(); renderDashboard();
        }
        if (cloudOn()) {
            (np ? CL.changePassword(oldPw, np) : Promise.resolve({ ok: true })).then(function (r) {
                if (r && r.ok === false) { bad(r.message || 'Gagal mengganti sandi.'); return; }
                applyLocal();
            }, function () { bad('Tidak dapat terhubung ke server.'); });
            return;
        }
        if (PA && PA.updateMe) {
            PA.updateMe({ name: name, oldPassword: oldPw, newPassword: np || undefined }).then(function (r) {
                if (r && r.ok === false) { bad((r.json && r.json.error && r.json.error.message) || 'Gagal menyimpan ke server.'); return; }
                applyLocal();
            }, function () { applyLocal(); });
        } else applyLocal();
    }
    function serverTokenApi() {
        var PA = (typeof window !== 'undefined') ? window.ProgressApi : null;
        try { return PA && PA.token && PA.token() ? PA : null; } catch (e) { return null; }
    }

    /* ---------- edit tugas (guru) ---------- */
    function dateInputValue(ms) {
        if (ms == null) return '';
        var d = new Date(ms);
        if (isNaN(d.getTime())) return '';
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }
    function assignEditForm(a, classList) {
        var cls = P8.repositories.classRepository.getById(a.classId) || {};
        var studs = (cls.studentIds || []).map(function (id) { return P8.repositories.userRepository.getById(id); }).filter(Boolean);
        var chosen = a.studentIds || [];
        var html = '<form class="dash-userform" data-au-form="edit-assign" novalidate>'
            + '<input type="hidden" name="assignId" value="' + esc(a.id) + '">'
            + '<div class="dash-form-title">Edit tugas: <b>' + esc(a.title) + '</b></div>'
            + '<div class="dash-form-grid">'
            + '<label class="dash-field"><span>Judul *</span><input name="title" value="' + esc(a.title) + '" maxlength="200" required></label>'
            + '<label class="dash-field"><span>Kelas</span><select name="classId">' + classList.filter(function (c) { return c.status !== 'ARCHIVED' || c.id === a.classId; }).map(function (c) {
                return '<option value="' + esc(c.id) + '"' + (c.id === a.classId ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>'
            + '<label class="dash-field"><span>Jenis</span><select name="type">' + (P8.ASSIGNMENT_TYPES || []).map(function (ty) {
                return '<option value="' + esc(ty) + '"' + (ty === a.type ? ' selected' : '') + '>' + esc(assignTypeLabel(ty)) + '</option>'; }).join('') + '</select></label>'
            + '<label class="dash-field"><span>ID konten/kasus</span><input name="contentId" value="' + esc(a.contentId || '') + '"></label>'
            + '<label class="dash-field"><span>Tenggat</span><input name="dueAt" type="date" value="' + dateInputValue(a.dueAt) + '"></label>'
            + '<label class="dash-field"><span>KKM (0-100)</span><input name="passingScore" type="number" min="0" max="100" value="' + esc(a.passingScore == null ? '' : a.passingScore) + '"></label>'
            + '<label class="dash-field"><span>Batas percobaan (0 = bebas)</span><input name="attempts" type="number" min="0" value="' + esc(a.attempts == null ? 1 : a.attempts) + '"></label>'
            + '<label class="dash-field"><span>Status</span><select name="status">'
            + ['DRAFT', 'PUBLISHED', 'ARCHIVED'].map(function (st) { return '<option value="' + st + '"' + (a.status === st ? ' selected' : '') + '>' + esc(statusLabel(st)) + '</option>'; }).join('') + '</select></label>'
            + '<label class="dash-field dash-field-wide"><span>Deskripsi</span><input name="description" value="' + esc(a.description || '') + '" maxlength="1500"></label>'
            + '<div class="dash-field dash-field-wide"><span>Diberikan kepada (kosong = semua siswa kelas)</span><div class="dash-checks">'
            + (studs.length ? studs.map(function (x) {
                return '<label class="dash-check"><input type="checkbox" name="stu" value="' + esc(x.id) + '"' + (chosen.indexOf(x.id) >= 0 ? ' checked' : '') + '> ' + esc(x.name) + '</label>'; }).join('')
                : '<small>Kelas belum punya siswa.</small>')
            + '</div><small>Bila kelas diganti, pilihan siswa direset.</small></div>'
            + '</div><div class="dash-form-actions">'
            + '<button type="submit" class="au-btn-sm au-btn-ok">Simpan Tugas</button>'
            + '<button type="button" class="au-btn-sm au-btn-ghost" data-au-act="edit-assign" data-assign="' + esc(a.id) + '">Batal</button>'
            + '</div></form>';
        return html;
    }
    function submitEditAssign(form) {
        var u = currentUser();
        var id = fval(form, 'assignId');
        var dueRaw = fval(form, 'dueAt');
        var ps = fval(form, 'passingScore');
        var at = fval(form, 'attempts');
        var patch = {
            title: fval(form, 'title').trim(), classId: fval(form, 'classId'), type: fval(form, 'type'),
            contentId: fval(form, 'contentId').trim() || null,
            dueAt: dueRaw ? new Date(dueRaw + 'T23:59:59').getTime() : null,
            description: fval(form, 'description'), status: fval(form, 'status'),
            studentIds: checkedValues(form, 'stu')
        };
        if (ps !== '') patch.passingScore = Number(ps);
        if (at !== '') patch.attempts = Number(at);
        var cur = P8.repositories.assignmentRepository.getById(id);
        if (cur && patch.classId !== cur.classId) delete patch.studentIds;
        var res = P8.assignmentService.update(id, patch, u);
        if (!res.success) { msg('error', res.error.message || 'Gagal menyimpan tugas.'); renderDashboard(); return; }
        msg('ok', 'Tugas "' + patch.title + '" diperbarui.');
        state.dash.editAssign = null;
        renderDashboard();
    }

    function classPanel(u, c, full) {
        var students = P8.classService.getStudentList(c.id, u).data || [];
        var classAssigns = P8.repositories.assignmentRepository.list().filter(function (a) { return a.classId === c.id; });
        var orgStudents = (P8.userService.list(u).data || []).filter(function (x) {
            return x.role === 'STUDENT' && x.status === 'ACTIVE' && students.every(function (s) { return s.id !== x.id; });
        });

        var html = '<div class="dash-sub">'
            + '<div class="dash-sub-actions">'
            + '  <button type="button" class="au-btn-sm" data-au-act="add-student-open" data-class="' + esc(c.id) + '">Tambah Siswa</button>'
            + '</div>';
        if (state.dash.addingStudent === c.id) {
            html += '<div class="dash-add-student">'
                + (orgStudents.length ? '<form class="dash-inline-form" data-au-form="add-student"><input type="hidden" name="classId" value="' + esc(c.id) + '"><select name="studentId">'
                    + orgStudents.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + ' (@' + esc(s.username) + ')</option>'; }).join('')
                    + '</select><button type="submit" class="au-btn-sm">Tambah</button></form>' : '')
                + '<form class="dash-inline-form" data-au-form="add-student-username"><input type="hidden" name="classId" value="' + esc(c.id) + '"><input name="username" placeholder="atau username siswa"><button type="submit" class="au-btn-sm">Cari &amp; Tambah</button></form>'
                + '</div>';
        }
        html += '<div class="dash-hint">Kode gabung: <b>' + esc(full.joinCode || '-') + '</b> &middot; bagikan ke siswa.</div>';

        if (!students.length) { html += '<p class="dash-empty">Belum ada siswa.</p>'; }
        students.forEach(function (s) {
            var subs = P8.repositories.submissionRepository.list().filter(function (x) { return x.studentId === s.id && x.classId === c.id; });
            var prog = classAssigns.length ? Math.round(subs.length / classAssigns.length * 100) : 0;
            var vals = P8.repositories.submissionRepository.list().filter(function (x) { return x.studentId === s.id && x.classId === c.id && typeof x.score === 'number'; });
            var avg = vals.length ? Math.round(vals.reduce(function (a, x) { return a + x.score; }, 0) / vals.length) : null;
            var openS = state.dash.openStudent && state.dash.openStudent.classId === c.id && state.dash.openStudent.studentId === s.id;
            html += '<div class="dash-mon">'
                + '  <div class="dash-mon-main"><b>' + esc(s.name) + '</b><span>@' + esc(s.username || '') + '</span></div>'
                + '  <div class="dash-mon-metrics">'
                + '    <span class="dash-metric"><i>Tugas</i>' + subs.length + '/' + classAssigns.length + '</span>'
                + '    <span class="dash-metric"><i>Nilai</i>' + (avg == null ? '-' : avg) + '</span>'
                + '    <span class="dash-metric"><i>Progres</i>' + prog + '%</span>'
                + '  </div>'
                + '  <div class="dash-mini-actions"><button type="button" class="au-btn-sm" data-au-act="open-student" data-class="' + esc(c.id) + '" data-student="' + esc(s.id) + '">' + (openS ? 'Tutup' : 'Detail') + '</button>'
                + (state.dash.confirmRemove === c.id + ':' + s.id
                    ? '<span class="dash-confirm">Keluarkan? <button type="button" class="au-btn-sm au-btn-danger" data-au-act="remove-student" data-class="' + esc(c.id) + '" data-student="' + esc(s.id) + '">Ya</button><button type="button" class="au-btn-sm au-btn-ghost" data-au-act="remove-cancel">Batal</button></span>'
                    : '<button type="button" class="au-btn-sm" data-au-act="remove-ask" data-class="' + esc(c.id) + '" data-student="' + esc(s.id) + '">Keluarkan</button>')
                + '</div></div>';
            if (openS) html += studentDetailPanel(u, c.id, s.id);
        });
        html += '</div>';
        return html;
    }

    function studentDetailPanel(u, classId, studentId) {
        var target = P8.repositories.userRepository.getById(studentId);
        return userDetailHtml(target, u);
    }

    function gradeForm(s) {
        return '<div class="dash-grade-form">'
            + '  <input type="number" name="score" min="0" max="100" placeholder="Nilai 0-100" value="' + (s.score == null ? '' : esc(s.score)) + '">'
            + '  <input type="text" name="feedback" placeholder="Umpan balik" value="' + esc(s.feedback || '') + '">'
            + '  <div class="dash-grade-actions">'
            + '    <button type="button" class="au-btn-sm" data-au-act="grade" data-sub="' + esc(s.id) + '">Simpan Nilai</button>'
            + '    <button type="button" class="au-btn-sm au-btn-ghost" data-au-act="return" data-sub="' + esc(s.id) + '">Kembalikan</button>'
            + '  </div>'
            + '</div>';
    }

    function superadminDash(u) {
        var orgs = P8.repositories.organizationRepository.list();
        var users = P8.repositories.userRepository.list();
        var classes = P8.repositories.classRepository.list();
        var pending = orgs.filter(function (o) { return o.status === 'PENDING'; });
        var active = orgs.filter(function (o) { return o.status === 'ACTIVE'; });
        var rejected = orgs.filter(function (o) { return o.status === 'REJECTED'; });
        var gurus = users.filter(function (x) { return x.role === 'INSTRUCTOR'; });
        var siswas = users.filter(function (x) { return x.role === 'STUDENT'; });

        var html = ''
            + '<div class="dash-head"><h2>Dashboard Superadmin</h2><p>Kelola sekolah dan pengguna platform.</p></div>'
            + '<div class="dash-stats">'
            + statCard('Sekolah Aktif', active.length, 'good')
            + statCard('Menunggu', pending.length, pending.length ? 'warn' : '')
            + statCard('Ditolak', rejected.length)
            + statCard('Total Pengguna', users.length)
            + statCard('Guru', gurus.length)
            + statCard('Siswa', siswas.length)
            + statCard('Siswa Menunggu', pendingStudentsFor(null).length, pendingStudentsFor(null).length ? 'warn' : '')
            + statCard('Kelas', classes.length)
            + '</div>'
            + '<div class="dash-actions-bar"><button type="button" class="au-btn-sm" data-au-act="refresh">Segarkan</button></div>';

        var tab = state.dash.adminTab || 'sekolah';
        html += '<div class="dash-quickadd" role="group" aria-label="Tambah data baru"><span>Tambah cepat:</span>'
            + [['sekolah', '+ Sekolah'], ['guru', '+ Guru'], ['siswa', '+ Siswa'], ['kelas', '+ Kelas']].map(function (q) {
                return '<button type="button" class="au-btn-sm au-btn-ok" data-au-act="quick-add" data-kind="' + q[0] + '">' + q[1] + '</button>';
            }).join('') + '</div>';
        html += '<div class="dash-tabs" role="tablist">'
            + [['sekolah', 'Sekolah &amp; Pendaftaran (' + orgs.length + ')'], ['guru', 'Data Guru (' + gurus.length + ')'], ['siswa', 'Data Siswa (' + siswas.length + ')'], ['kelas', 'Data Kelas (' + classes.length + ')']].map(function (t) {
                return '<button type="button" role="tab" aria-selected="' + (tab === t[0]) + '" class="dash-tab' + (tab === t[0] ? ' active' : '') + '" data-au-act="admin-tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
            }).join('') + '</div>';
        if (tab === 'guru') return html + userManager(u, 'INSTRUCTOR');
        if (tab === 'siswa') return html + userManager(u, 'STUDENT');
        if (tab === 'kelas') return html + classManager(u);

        html += '<div class="dash-card"><div class="dash-card-head"><h3>Pendaftaran Sekolah Menunggu</h3></div>';
        if (!pending.length) html += '<p class="dash-empty">Tidak ada pendaftaran menunggu.</p>';
        pending.forEach(function (o) {
            var pa = o.pendingAdmin || {};
            var open = state.dash.reject === o.id;
            html += '<div class="dash-class">'
                + '  <div class="dash-class-head">'
                + '    <div><b>' + esc(o.name) + '</b><span>' + esc(orgTypeLabel(o.type)) + (o.address ? ' &middot; ' + esc(o.address) : '') + '</span>'
                + '      <span class="dash-subline">Admin: ' + esc(pa.name || '-') + ' (@' + esc(pa.username || '-') + ')</span></div>'
                + '    <div class="dash-class-meta">'
                + '      <button type="button" class="au-btn-sm au-btn-ok" data-au-act="approve-school" data-org="' + esc(o.id) + '">Setujui</button>'
                + '      <button type="button" class="au-btn-sm au-btn-danger" data-au-act="reject-open" data-org="' + esc(o.id) + '">' + (open ? 'Batal' : 'Tolak') + '</button>'
                + '    </div>'
                + '  </div>';
            if (open) {
                html += '<div class="dash-reject">'
                    + '  <input type="text" name="reason" placeholder="Alasan penolakan" data-reject-reason value="' + esc(o.rejectReason || '') + '">'
                    + '  <button type="button" class="au-btn-sm au-btn-danger" data-au-act="reject-confirm" data-org="' + esc(o.id) + '">Konfirmasi Tolak</button>'
                    + '</div>';
            }
            html += '</div>';
        });
        html += '</div>';

        var pendAll = pendingStudentsFor(null);
        html += '<div class="dash-card"><div class="dash-card-head"><h3>Pendaftaran Siswa Menunggu</h3>'
            + (pendAll.length ? '<span class="dash-tag">' + pendAll.length + ' baru</span>' : '') + '</div>';
        if (!pendAll.length) html += '<p class="dash-empty">Tidak ada pendaftaran siswa menunggu.</p>';
        pendAll.forEach(function (s) { html += pendingStudentRow(s, true); });
        html += '</div>';

        html += schoolManager(u);

        return html;
    }

    /* =====================================================================
       MANAJEMEN DATA PENGGUNA & KELAS
       - Superadmin : kelola SEMUA guru & siswa (lintas sekolah)
       - Guru       : kelola siswa SEKOLAHNYA sendiri + edit kelas
       Hak akses ditegakkan di fungsi (canManageUserData), bukan hanya
       dengan menyembunyikan tombol.
       ===================================================================== */
    var USER_STATUS_LABEL = { ACTIVE: 'Aktif', INACTIVE: 'Nonaktif', PENDING: 'Menunggu', REJECTED: 'Ditolak', DISABLED: 'Nonaktif' };

    function fval(form, name) {
        var el = null;
        try { el = form.elements && form.elements[name]; } catch (e) { el = null; }
        if (!el) el = form[name];
        return el && el.value != null ? String(el.value) : '';
    }
    function fchecked(form, name) {
        var el = null;
        try { el = form.elements && form.elements[name]; } catch (e) { el = null; }
        if (!el) el = form[name];
        return !!(el && el.checked);
    }
    function checkedValues(form, name) {
        var out = [];
        try {
            var nodes = form.querySelectorAll('input[name="' + name + '"]');
            for (var i = 0; i < nodes.length; i++) if (nodes[i].checked) out.push(nodes[i].value);
        } catch (e) { /* noop */ }
        return out;
    }
    function validUsername(s) { return /^[A-Za-z0-9_.\-]{3,30}$/.test(s); }
    function validEmailStr(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
    function usernameTaken(username, exceptId) {
        var low = String(username).toLowerCase();
        return P8.repositories.userRepository.list().some(function (x) {
            return x.id !== exceptId && String(x.username || '').toLowerCase() === low;
        });
    }
    function userStatusLabel(s) { return USER_STATUS_LABEL[s] || statusLabel(s); }
    function isSchoolAdminUser(u) {
        if (!u || u.role !== 'INSTRUCTOR') return false;
        if (u.orgAdmin === true) return true;
        var org = u.organizationId ? P8.repositories.organizationRepository.getById(u.organizationId) : null;
        return !!(org && org.adminUserId === u.id);
    }
    function classesOfUser(user) {
        return P8.repositories.classRepository.list().filter(function (c) {
            return user.role === 'INSTRUCTOR' ? (c.instructorIds || []).indexOf(user.id) >= 0 : (c.studentIds || []).indexOf(user.id) >= 0;
        });
    }
    function teacherClassIdsOf(actor) {
        return P8.repositories.classRepository.list().filter(function (c) {
            return (c.instructorIds || []).indexOf(actor.id) >= 0;
        }).map(function (c) { return c.id; });
    }

    /* Siapa boleh mengelola data siapa:
       - ADMIN  : semua guru & siswa
       - GURU   : hanya SISWA yang sekolahnya sama, atau siswa di kelas yang ia ajar */
    function canManageUserData(target, actor) {
        if (!target || !actor) return false;
        if (target.role !== 'STUDENT' && target.role !== 'INSTRUCTOR') return false;
        if (actor.role === 'ADMIN') return true;
        if (actor.role !== 'INSTRUCTOR' || target.role !== 'STUDENT') return false;
        if (target.organizationId && target.organizationId === actor.organizationId) return true;
        var mine = teacherClassIdsOf(actor);
        return (target.classIds || []).some(function (id) { return mine.indexOf(id) >= 0; });
    }

    function scopedUsers(actor, role) {
        var d = state.dash;
        var q = String(d.q || '').trim().toLowerCase();
        var fClass = d.fClass ? P8.repositories.classRepository.getById(d.fClass) : null;
        return P8.repositories.userRepository.list().filter(function (x) {
            if (x.role !== role) return false;
            if (!canManageUserData(x, actor)) return false;
            if (actor.role === 'ADMIN' && d.fOrg) {
                if (d.fOrg === '_none') { if (x.organizationId) return false; }
                else if (x.organizationId !== d.fOrg) return false;
            }
            if (fClass && (fClass.studentIds || []).indexOf(x.id) < 0) return false;
            if (q) {
                var hay = [x.name, x.username, x.nis, x.email].join(' ').toLowerCase();
                if (hay.indexOf(q) < 0) return false;
            }
            return true;
        }).sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    }

    function orgOptionsHtml(selected, withEmpty) {
        var opts = withEmpty ? '<option value="">(Tanpa sekolah)</option>' : '<option value="">(Pilih sekolah)</option>';
        return opts + activeOrgs().map(function (o) {
            return '<option value="' + esc(o.id) + '"' + (o.id === selected ? ' selected' : '') + '>' + esc(o.name) + '</option>';
        }).join('');
    }

    function classChecksHtml(actor, role, target) {
        var all = P8.repositories.classRepository.list().filter(function (c) {
            if (c.status === 'ARCHIVED') return false;
            if (actor.role === 'ADMIN') return true;
            return (c.instructorIds || []).indexOf(actor.id) >= 0;
        });
        if (!all.length) return '<p class="dash-hint">Belum ada kelas yang bisa dipilih.</p>';
        var items = all.map(function (c) {
            var list = role === 'INSTRUCTOR' ? (c.instructorIds || []) : (c.studentIds || []);
            var on = target && list.indexOf(target.id) >= 0;
            var sc = actor.role === 'ADMIN' && c.organizationId ? ' <i>(' + esc(orgName(c.organizationId)) + ')</i>' : '';
            return '<label class="dash-check"><input type="checkbox" name="cls" value="' + esc(c.id) + '"' + (on ? ' checked' : '') + '> ' + esc(c.name) + sc + '</label>';
        }).join('');
        return '<div class="dash-field dash-field-wide"><span>' + (role === 'INSTRUCTOR' ? 'Kelas yang diajar' : 'Kelas') + '</span><div class="dash-checks">' + items + '</div>'
            + (actor.role === 'ADMIN' ? '<small>Hanya kelas pada sekolah yang dipilih yang akan diterapkan.</small>' : '') + '</div>';
    }

    function userForm(actor, role, target) {
        var edit = !!target;
        var isAdmin = actor.role === 'ADMIN';
        var isStudent = role === 'STUDENT';
        var label = isStudent ? 'siswa' : 'guru';
        var v = function (k) { return target && target[k] != null ? esc(target[k]) : ''; };
        var html = '<form class="dash-userform" data-au-form="user-save" novalidate>'
            + '<input type="hidden" name="mode" value="' + (edit ? 'edit' : 'add') + '">'
            + '<input type="hidden" name="id" value="' + esc(target ? target.id : '') + '">'
            + '<input type="hidden" name="role" value="' + esc(role) + '">'
            + '<div class="dash-form-title">' + (edit ? 'Edit data ' + label + ': <b>' + esc(target.name) + '</b>' : 'Tambah ' + label + ' baru') + '</div>'
            + '<div class="dash-form-grid">'
            + '<label class="dash-field"><span>Nama lengkap *</span><input name="name" value="' + v('name') + '" maxlength="100" required></label>'
            + '<label class="dash-field"><span>Username *</span><input name="username" value="' + v('username') + '" maxlength="30" autocomplete="off" required></label>'
            + '<label class="dash-field"><span>Email</span><input name="email" type="email" value="' + v('email') + '" maxlength="120"></label>';
        if (isStudent) html += '<label class="dash-field"><span>NIS</span><input name="nis" value="' + v('nis') + '" maxlength="30"></label>';
        if (isAdmin) {
            html += '<label class="dash-field"><span>Sekolah' + (isStudent ? '' : ' *') + '</span><select name="organizationId">'
                + orgOptionsHtml(target ? target.organizationId : '', isStudent) + '</select></label>';
        }
        html += '<label class="dash-field"><span>' + (edit ? 'Sandi baru (kosongkan bila tidak diganti)' : 'Sandi * (min. 6 karakter)') + '</span>'
            + '<input name="password" type="password" autocomplete="new-password"' + (edit ? '' : ' required') + '></label>';
        if (edit && (target.status === 'ACTIVE' || target.status === 'INACTIVE' || target.status === 'DISABLED')) {
            var st = target.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
            html += '<label class="dash-field"><span>Status akun</span><select name="status">'
                + '<option value="ACTIVE"' + (st === 'ACTIVE' ? ' selected' : '') + '>Aktif</option>'
                + '<option value="INACTIVE"' + (st === 'INACTIVE' ? ' selected' : '') + '>Nonaktif (tidak bisa masuk)</option></select></label>';
        }
        html += classChecksHtml(actor, role, target);
        html += '</div>'
            + '<div class="dash-form-actions">'
            + '<button type="submit" class="au-btn-sm au-btn-ok">' + (edit ? 'Simpan Perubahan' : 'Tambah ' + label) + '</button>'
            + '<button type="button" class="au-btn-sm au-btn-ghost" data-au-act="user-cancel">Batal</button>'
            + '</div></form>';
        return html;
    }

    function userManager(actor, role) {
        var d = state.dash;
        var isAdmin = actor.role === 'ADMIN';
        var isStudent = role === 'STUDENT';
        var label = isStudent ? 'Siswa' : 'Guru';
        var list = scopedUsers(actor, role);
        var total = P8.repositories.userRepository.list().filter(function (x) { return x.role === role && canManageUserData(x, actor); }).length;
        var cols = isAdmin ? 6 : 5;

        var html = '<div class="dash-card"><div class="dash-card-head"><h3>Data ' + label + (isAdmin ? ' &mdash; Semua Sekolah' : ' Sekolah Saya') + '</h3>'
            + '<button type="button" class="au-btn-sm au-btn-ok" data-au-act="add-user-open" data-role="' + role + '">' + (d.addUser === role ? 'Tutup Form' : '+ Tambah ' + label) + '</button></div>';
        if (d.addUser === role) html += '<div class="dash-detail">' + userForm(actor, role, null) + '</div>';

        html += '<div class="dash-toolbar">'
            + '<input type="search" data-au-search="1" placeholder="Cari nama, username, ' + (isStudent ? 'NIS, ' : '') + 'email" value="' + esc(d.q || '') + '" aria-label="Cari ' + label.toLowerCase() + '">';
        if (isAdmin) {
            html += '<select data-au-filter="org" aria-label="Filter sekolah"><option value="">Semua sekolah</option>'
                + activeOrgs().map(function (o) { return '<option value="' + esc(o.id) + '"' + (d.fOrg === o.id ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('')
                + '<option value="_none"' + (d.fOrg === '_none' ? ' selected' : '') + '>Tanpa sekolah</option></select>';
        } else if (isStudent) {
            var myClasses = P8.repositories.classRepository.list().filter(function (c) { return (c.instructorIds || []).indexOf(actor.id) >= 0; });
            html += '<select data-au-filter="class" aria-label="Filter kelas"><option value="">Semua kelas</option>'
                + myClasses.map(function (c) { return '<option value="' + esc(c.id) + '"' + (d.fClass === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>';
        }
        html += '</div>';

        if (!list.length) {
            html += '<p class="dash-empty">' + (total ? 'Tidak ada ' + label.toLowerCase() + ' yang cocok dengan pencarian.' : 'Belum ada data ' + label.toLowerCase() + '.') + '</p></div>';
            return html;
        }

        html += '<div class="dash-table-wrap"><table class="dash-table dash-users"><thead><tr><th>Nama</th><th>' + (isStudent ? 'NIS' : 'Email') + '</th>'
            + (isAdmin ? '<th>Sekolah</th>' : '') + '<th>Kelas</th><th>Status</th><th>Aksi</th></tr></thead><tbody>';
        list.forEach(function (x) {
            var cls = classesOfUser(x).map(function (c) { return c.name; });
            var st = x.status || 'ACTIVE';
            var confirming = d.confirmDelete === x.id;
            var acts = '<button type="button" class="au-btn-sm" data-au-act="detail-user" data-user="' + esc(x.id) + '">' + (d.detailUser === x.id ? 'Tutup' : 'Detail') + '</button>'
                + '<button type="button" class="au-btn-sm" data-au-act="edit-user" data-user="' + esc(x.id) + '">' + (d.editUser === x.id ? 'Tutup' : 'Edit') + '</button>';
            if (st === 'ACTIVE') acts += '<button type="button" class="au-btn-sm" data-au-act="toggle-user" data-user="' + esc(x.id) + '">Nonaktifkan</button>';
            else if (st === 'INACTIVE' || st === 'DISABLED') acts += '<button type="button" class="au-btn-sm au-btn-ok" data-au-act="toggle-user" data-user="' + esc(x.id) + '">Aktifkan</button>';
            else if (st === 'PENDING' && isStudent && canManageStudent(x, actor)) {
                acts += '<button type="button" class="au-btn-sm au-btn-ok" data-au-act="approve-student" data-student="' + esc(x.id) + '">Setujui</button>'
                    + '<button type="button" class="au-btn-sm au-btn-danger" data-au-act="reject-student" data-student="' + esc(x.id) + '">Tolak</button>';
            }
            if (isAdmin) {
                if (confirming) acts += '<span class="dash-confirm">Hapus permanen? '
                    + '<button type="button" class="au-btn-sm au-btn-danger" data-au-act="delete-user" data-user="' + esc(x.id) + '">Ya, hapus</button>'
                    + '<button type="button" class="au-btn-sm au-btn-ghost" data-au-act="delete-cancel">Batal</button></span>';
                else acts += '<button type="button" class="au-btn-sm au-btn-danger" data-au-act="delete-ask" data-user="' + esc(x.id) + '">Hapus</button>';
            }
            html += '<tr><td><b>' + esc(x.name) + '</b><div class="dash-sub-txt">@' + esc(x.username || '') + (isSchoolAdminUser(x) ? ' &middot; Admin sekolah' : '') + '</div></td>'
                + '<td>' + esc(isStudent ? (x.nis || '-') : (x.email || '-')) + '</td>'
                + (isAdmin ? '<td>' + esc(orgName(x.organizationId) || '-') + '</td>' : '')
                + '<td>' + (cls.length ? cls.map(function (n) { return '<span class="dash-chip">' + esc(n) + '</span>'; }).join('') : '<span class="dash-sub-txt">-</span>') + '</td>'
                + '<td><span class="dash-status dash-status-' + esc(String(st).toLowerCase()) + '">' + esc(userStatusLabel(st)) + '</span></td>'
                + '<td><div class="dash-mini-actions">' + acts + '</div></td></tr>';
            if (d.editUser === x.id) html += '<tr class="dash-user-panel"><td colspan="' + cols + '">' + userForm(actor, role, x) + '</td></tr>';
            if (d.detailUser === x.id) html += '<tr class="dash-user-panel"><td colspan="' + cols + '">' + userDetailHtml(x, actor) + '</td></tr>';
        });
        html += '</tbody></table></div><p class="dash-hint">Menampilkan ' + list.length + ' dari ' + total + ' ' + label.toLowerCase() + '.</p></div>';
        return html;
    }

    /* ---------- ringkasan progres belajar lokal (data hub per akun) ---------- */
    function hubSummaryFor(target) {
        try {
            var owner = ownerOf(target);
            var raw = null;
            if (localStorage.getItem(LS_OWNER) === owner) raw = localStorage.getItem('starterHub_v1');
            else {
                var blob = JSON.parse(localStorage.getItem(LS_STASH + owner) || 'null');
                raw = blob && blob.starterHub_v1;
            }
            var h = raw ? JSON.parse(raw) : null;
            if (!h || typeof h !== 'object') return null;
            var cnt = function (o, key) { return Object.keys(o || {}).filter(function (k) { return o[k] && o[k][key]; }).length; };
            var scores = Object.keys(h.quiz || {}).map(function (k) { return h.quiz[k] && h.quiz[k].best; }).filter(function (n) { return typeof n === 'number'; });
            return {
                materi: cnt(h.materi, 'paham'), jobsheet: cnt(h.js, 'selesai'), diagnosis: cnt(h.diag, 'selesai'),
                kuis: Object.keys(h.quiz || {}).length,
                avg: scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : null
            };
        } catch (e) { return null; }
    }

    function kv(label, value) {
        return '<div class="dash-kv"><span>' + esc(label) + '</span><b>' + (value == null || value === '' ? '-' : value) + '</b></div>';
    }

    function userDetailHtml(target, actor) {
        if (!target || !canManageUserData(target, actor)) return '<div class="dash-detail"><p class="dash-empty">Detail tidak tersedia atau di luar kewenangan Anda.</p></div>';
        var cls = classesOfUser(target);
        var html = '<div class="dash-detail"><div class="dash-detail-head">Detail ' + (target.role === 'STUDENT' ? 'siswa' : 'guru') + ': <b>' + esc(target.name) + '</b></div>'
            + '<div class="dash-kv-grid">'
            + kv('Username', '@' + esc(target.username || ''))
            + kv('Peran', esc(roleLabel(target.role)))
            + kv('Status', esc(userStatusLabel(target.status)))
            + kv('Sekolah', esc(orgName(target.organizationId) || '-'))
            + kv('Email', esc(target.email || ''))
            + (target.role === 'STUDENT' ? kv('NIS', esc(target.nis || '')) : kv('Admin sekolah', isSchoolAdminUser(target) ? 'Ya' : 'Tidak'))
            + kv('Terdaftar', esc(fmtDate(target.createdAt || target.requestedAt)))
            + '</div>';

        if (target.role === 'INSTRUCTOR') {
            var classIds = cls.map(function (c) { return c.id; });
            var assigns = P8.repositories.assignmentRepository.list().filter(function (a) { return classIds.indexOf(a.classId) >= 0; });
            var pending = P8.repositories.submissionRepository.list().filter(function (s) { return s.status === 'SUBMITTED' && classIds.indexOf(s.classId) >= 0; });
            html += '<div class="dash-kv-grid">'
                + kv('Jumlah kelas', cls.length) + kv('Tugas pada kelasnya', assigns.length) + kv('Menunggu penilaian', pending.length) + '</div>';
            html += '<h4 class="dash-h4">Kelas yang diajar</h4>';
            if (!cls.length) html += '<p class="dash-empty">Belum mengajar kelas apa pun.</p>';
            else {
                html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Kelas</th><th>Mapel</th><th>Siswa</th><th>Kode</th><th>Status</th></tr></thead><tbody>';
                cls.forEach(function (c) {
                    html += '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.subject || '-') + '</td><td>' + (c.studentIds || []).length + '</td><td>' + esc(c.joinCode || '-') + '</td><td>' + esc(statusLabel(c.status)) + '</td></tr>';
                });
                html += '</tbody></table></div>';
            }
            return html + '</div>';
        }

        /* --- siswa --- */
        var classIds2 = cls.map(function (c) { return c.id; });
        var subs = P8.repositories.submissionRepository.list().filter(function (s) { return s.studentId === target.id; });
        var scored = subs.filter(function (s) { return typeof s.score === 'number'; });
        var avg = scored.length ? Math.round(scored.reduce(function (a, s) { return a + s.score; }, 0) / scored.length) : null;
        var assigns2 = P8.repositories.assignmentRepository.list().filter(function (a) { return classIds2.indexOf(a.classId) >= 0 && a.status !== 'DRAFT'; });
        var done = assigns2.filter(function (a) {
            return subs.some(function (s) { return s.assignmentId === a.id && (s.status === 'SUBMITTED' || s.status === 'GRADED' || s.status === 'COMPLETED'); });
        }).length;
        html += '<div class="dash-kv-grid">'
            + kv('Tugas dikumpulkan', done + '/' + assigns2.length)
            + kv('Rata-rata nilai', avg == null ? '-' : avg)
            + kv('Menunggu penilaian', subs.filter(function (s) { return s.status === 'SUBMITTED'; }).length) + '</div>';

        html += '<h4 class="dash-h4">Kelas</h4>' + (cls.length ? cls.map(function (c) { return '<span class="dash-chip">' + esc(c.name) + '</span>'; }).join('') : '<p class="dash-empty">Belum masuk kelas.</p>')
            + ((actor.role === 'INSTRUCTOR' || actor.role === 'ADMIN') ? ' <button type="button" class="au-btn-sm" data-au-act="edit-user" data-user="' + esc(target.id) + '">Edit nama, sandi &amp; kelas siswa</button>' : '');

        html += '<h4 class="dash-h4">Tugas &amp; nilai</h4>';
        if (!assigns2.length) html += '<p class="dash-empty">Belum ada tugas pada kelas siswa ini.</p>';
        else {
            var canEdit = actor.role === 'INSTRUCTOR' || actor.role === 'ADMIN';
            html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Tugas</th><th>Kelas</th><th>Jenis</th><th>Status</th><th>Nilai</th><th>Umpan balik</th>' + (canEdit ? '<th>Aksi</th>' : '') + '</tr></thead><tbody>';
            assigns2.forEach(function (a) {
                var sub = null;
                subs.forEach(function (s) { if (s.assignmentId === a.id) sub = s; });
                var c = P8.repositories.classRepository.getById(a.classId);
                var act = '';
                if (canEdit && sub && (sub.status === 'SUBMITTED' || sub.status === 'GRADED' || sub.status === 'COMPLETED')) {
                    act = '<div class="dash-mini-actions"><button type="button" class="au-btn-sm" data-au-act="regrade-open" data-sub="' + esc(sub.id) + '">' + (state.dash.regrade === sub.id ? 'Tutup' : 'Edit nilai') + '</button>'
                        + '<button type="button" class="au-btn-sm au-btn-ghost" data-au-act="reopen-sub" data-sub="' + esc(sub.id) + '" title="Buka ulang agar siswa dapat mengerjakan lagi">Buka ulang</button></div>';
                }
                html += '<tr><td>' + esc(a.title) + '</td><td>' + esc(c ? c.name : '-') + '</td><td>' + esc(assignTypeLabel(a.type)) + '</td>'
                    + '<td>' + esc(sub ? statusLabel(sub.status) : 'Belum Mulai') + '</td>'
                    + '<td>' + (sub && sub.score != null ? esc(sub.score) : '-') + '</td>'
                    + '<td>' + esc(sub && sub.feedback ? sub.feedback : '-') + '</td>'
                    + (canEdit ? '<td>' + act + '</td>' : '') + '</tr>';
                if (canEdit && sub && state.dash.regrade === sub.id) {
                    html += '<tr class="dash-grade"><td colspan="7"><div class="dash-grade-form">'
                        + '<input type="number" name="score" min="0" max="100" placeholder="Nilai 0-100" value="' + (sub.score == null ? '' : esc(sub.score)) + '">'
                        + '<input type="text" name="feedback" placeholder="Umpan balik" value="' + esc(sub.feedback || '') + '">'
                        + '<div class="dash-grade-actions"><button type="button" class="au-btn-sm" data-au-act="regrade" data-sub="' + esc(sub.id) + '">Simpan Nilai</button></div>'
                        + '</div></td></tr>';
                }
            });
            html += '</tbody></table></div>';
        }

        var hub = hubSummaryFor(target);
        html += '<h4 class="dash-h4">Progres belajar (Materi, Praktik, Diagnosis, Kuis)</h4>';
        var sd = state.dash.studentDetail;
        var srv = sd && sd.id === target.id ? sd : null;
        if (srv && srv.data) {
            var p = srv.data.progress || {};
            html += '<div class="dash-kv-grid">'
                + kv('Modul selesai', (p.completed != null ? p.completed : 0) + '/' + (p.total != null ? p.total : 0))
                + kv('Progres', p.percent == null ? '-' : p.percent + '%') + '</div>';
            var mods = (srv.data.modules || []).filter(function (m) { return m.status && m.status !== 'NOT_STARTED'; });
            if (mods.length) {
                html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Kode</th><th>Modul</th><th>Status</th><th>%</th></tr></thead><tbody>'
                    + mods.map(function (m) { return '<tr><td>' + esc(m.code || '') + '</td><td>' + esc(m.title || '') + '</td><td>' + esc(statusLabel(m.status)) + '</td><td>' + esc(m.percent == null ? '' : m.percent) + '</td></tr>'; }).join('')
                    + '</tbody></table></div>';
            }
        } else if (hub) {
            html += '<div class="dash-kv-grid">' + kv('Materi dipahami', hub.materi) + kv('Job sheet selesai', hub.jobsheet)
                + kv('Studi kasus selesai', hub.diagnosis) + kv('Kuis dicoba', hub.kuis) + kv('Rata-rata kuis', hub.avg == null ? '-' : hub.avg) + '</div>';
        } else if (srv && srv.loading) {
            html += '<p class="dash-empty">Memuat progres dari server&hellip;</p>';
        } else {
            html += '<p class="dash-empty">Belum ada data progres belajar untuk siswa ini.</p>';
        }

        var acts = [];
        try { acts = P8.dashboardService.recentActivity(target.id, 8) || []; } catch (e) { acts = []; }
        html += '<h4 class="dash-h4">Aktivitas terbaru</h4>';
        if (!acts.length) html += '<p class="dash-empty">Belum ada aktivitas tercatat.</p>';
        else html += '<ul class="dash-list">' + acts.map(function (a) {
            return '<li><div class="dash-li-main"><b>' + esc(a.label || a.type) + '</b><span>' + esc(a.when ? fmtDate(a.when) : '') + '</span></div></li>';
        }).join('') + '</ul>';
        return html + '</div>';
    }

    /* Ambil progres belajar siswa dari server (bila server aktif & sesi server ada). */
    function fetchServerDetail(target) {
        var PA = (typeof window !== 'undefined') ? window.ProgressApi : null;
        if (!target || target.role !== 'STUDENT' || !PA || typeof PA.studentDetail !== 'function') return;
        var has = false;
        try { has = !!(PA.token && PA.token()); } catch (e) { has = false; }
        if (!has) return;
        state.dash.studentDetail = { id: target.id, loading: true, data: null };
        PA.studentDetail(target.serverId || target.id).then(function (r) {
            var cur = state.dash.studentDetail;
            if (!cur || cur.id !== target.id) return;
            cur.loading = false;
            cur.data = (r && r.ok && r.json && r.json.success) ? r.json.data : null;
            renderDashboard();
        }, function () {
            var cur = state.dash.studentDetail;
            if (cur && cur.id === target.id) { cur.loading = false; renderDashboard(); }
        });
    }

    /* ---------- sinkron ke server (best-effort; hanya Superadmin) ---------- */
    function serverReady() {
        var PA = (typeof window !== 'undefined') ? window.ProgressApi : null;
        var u = currentUser();
        if (!PA || !u || u.role !== 'ADMIN') return null;
        try { return PA.token && PA.token() ? PA : null; } catch (e) { return null; }
    }
    function serverIdOf(rec) {
        return rec.serverId || (state.serverIdByUsername && state.serverIdByUsername[String(rec.username).toLowerCase()]) || null;
    }
    function loadServerUsers(force) {
        var PA = serverReady();
        if (!PA || typeof PA.adminUsers !== 'function') return;
        if (state.serverLoaded && !force) return;
        state.serverLoaded = true;
        PA.adminUsers().then(function (r) {
            if (!(r && r.ok && r.json && r.json.success && Array.isArray(r.json.data))) return;
            var repo = P8.repositories.userRepository;
            var changed = false;
            state.serverIdByUsername = state.serverIdByUsername || {};
            r.json.data.forEach(function (su) {
                if (!su || (su.role !== 'STUDENT' && su.role !== 'INSTRUCTOR')) return;
                var key = String(su.username).toLowerCase();
                state.serverIdByUsername[key] = su.id;
                var local = repo.list().filter(function (x) { return String(x.username).toLowerCase() === key; })[0];
                if (local) {
                    if (!local.serverId) { local.serverId = su.id; repo.save(local); }
                    return;
                }
                var salt = saltFor(su.username);
                var map = { ACTIVE: 'ACTIVE', DISABLED: 'INACTIVE', PENDING: 'PENDING', REJECTED: 'REJECTED' };
                repo.save({
                    role: su.role, name: su.name, username: su.username, email: su.email || null, nis: su.nis || null,
                    organizationId: su.organizationId && P8.repositories.organizationRepository.getById(su.organizationId) ? su.organizationId : null,
                    classIds: [], status: map[su.status] || 'ACTIVE', serverId: su.id, fromServer: true,
                    salt: salt, passwordHash: hashPassword('x' + Math.random() + Date.now(), salt)
                });
                changed = true;
            });
            if (changed) renderDashboard();
        }, function () { /* server mati: abaikan */ });
    }
    function syncServerUser(op, rec, extra) {
        var me = currentUser();
        if (me && me.role === 'INSTRUCTOR') {
            /* guru: server hanya menerima perubahan nama & sandi siswa */
            var TA = serverTokenApi();
            if (TA && TA.teacherUpdateStudent && op === 'update' && rec.role === 'STUDENT' && rec.serverId) {
                try { var tp = TA.teacherUpdateStudent(rec.serverId, { name: rec.name, password: extra && extra.password || undefined }); if (tp && tp.then) tp.then(function () { }, function () { }); } catch (e) { }
            }
            return;
        }
        var PA = serverReady();
        if (!PA) return;
        try {
            var run = function (p) { if (p && p.then) p.then(function () { }, function () { }); };
            if (op === 'create' && PA.adminCreateUser) {
                var pr = PA.adminCreateUser({
                    name: rec.name, username: rec.username, role: rec.role, password: extra.password,
                    email: rec.email, nis: rec.nis, organizationId: rec.organizationId
                });
                if (pr && pr.then) pr.then(function (r) {
                    var id = r && r.json && r.json.success && r.json.data && r.json.data.id;
                    if (id) { rec.serverId = id; P8.repositories.userRepository.save(rec); }
                }, function () { });
            } else if (op === 'update' && PA.adminUpdateUser && serverIdOf(rec)) {
                run(PA.adminUpdateUser(serverIdOf(rec), {
                    name: rec.name, username: rec.username, email: rec.email, nis: rec.nis,
                    organizationId: rec.organizationId, password: extra && extra.password || undefined
                }));
            } else if (op === 'status' && PA.adminSetUserStatus && serverIdOf(rec)) {
                run(PA.adminSetUserStatus(serverIdOf(rec), extra.status));
            }
        } catch (e) { /* best-effort */ }
    }

    /* ---------- sinkron kelas <-> pengguna ---------- */
    function syncClassesFor(user, wanted, actor) {
        var repo = P8.repositories.classRepository;
        repo.list().forEach(function (c) {
            var manageable = actor.role === 'ADMIN' || (c.instructorIds || []).indexOf(actor.id) >= 0;
            if (!manageable) return;
            if (c.organizationId && user.organizationId && c.organizationId !== user.organizationId) return;
            var isT = user.role === 'INSTRUCTOR';
            var list = isT ? (c.instructorIds = c.instructorIds || []) : (c.studentIds = c.studentIds || []);
            var has = list.indexOf(user.id) >= 0;
            var want = wanted.indexOf(c.id) >= 0;
            if (want === has) return;
            if (want) list.push(user.id);
            else list.splice(list.indexOf(user.id), 1);
            repo.save(c);
            if (!isT) {
                user.classIds = (user.classIds || []).filter(function (id) { return id !== c.id; });
                if (want) user.classIds.push(c.id);
            }
        });
    }
    function dropCrossOrgClasses(user) {
        var repo = P8.repositories.classRepository;
        repo.list().forEach(function (c) {
            var isT = user.role === 'INSTRUCTOR';
            var list = isT ? (c.instructorIds || []) : (c.studentIds || []);
            if (list.indexOf(user.id) < 0) return;
            if (c.organizationId && user.organizationId !== c.organizationId) {
                list.splice(list.indexOf(user.id), 1);
                repo.save(c);
                if (!isT) user.classIds = (user.classIds || []).filter(function (id) { return id !== c.id; });
            }
        });
    }
    function moveStash(oldUsername, newUsername) {
        try {
            var o = 'u:' + String(oldUsername).toLowerCase(), n = 'u:' + String(newUsername).toLowerCase();
            if (o === n) return;
            if (localStorage.getItem(LS_OWNER) === o) localStorage.setItem(LS_OWNER, n);
            var st = localStorage.getItem(LS_STASH + o);
            if (st != null) { localStorage.setItem(LS_STASH + n, st); localStorage.removeItem(LS_STASH + o); }
        } catch (e) { /* noop */ }
    }

    /* ---------- aksi: tambah / edit pengguna ---------- */
    function saveUser(form) {
        var actor = currentUser();
        if (!actor) return;
        var repo = P8.repositories.userRepository;
        var mode = fval(form, 'mode') === 'edit' ? 'edit' : 'add';
        var role = fval(form, 'role');
        var target = mode === 'edit' ? repo.getById(fval(form, 'id')) : null;
        function bad(text) { msg('error', text); renderDashboard(); }

        if (role !== 'STUDENT' && role !== 'INSTRUCTOR') return bad('Peran tidak valid.');
        if (mode === 'edit') {
            if (!target) return bad('Pengguna tidak ditemukan.');
            if (target.role !== role) return bad('Peran pengguna tidak dapat diubah.');
            if (!canManageUserData(target, actor)) return bad('Anda tidak berwenang mengubah data ini.');
        } else {
            if (actor.role !== 'ADMIN' && !(actor.role === 'INSTRUCTOR' && role === 'STUDENT')) return bad('Anda tidak berwenang menambah pengguna ini.');
        }

        var name = fval(form, 'name').trim();
        var username = fval(form, 'username').trim();
        var email = fval(form, 'email').trim();
        var nis = role === 'STUDENT' ? fval(form, 'nis').trim() : '';
        var pw = fval(form, 'password');
        if (!name) return bad('Nama lengkap wajib diisi.');
        if (!validUsername(username)) return bad('Username 3-30 karakter: huruf, angka, titik, garis bawah, atau strip.');
        if (usernameTaken(username, target && target.id)) return bad('Username "' + username + '" sudah dipakai.');
        if (email && !validEmailStr(email)) return bad('Format email tidak valid.');
        if (mode === 'add' && pw.length < 6) return bad('Sandi minimal 6 karakter.');
        if (mode === 'edit' && pw && pw.length < 6) return bad('Sandi baru minimal 6 karakter.');

        var orgId;
        if (actor.role === 'ADMIN') orgId = fval(form, 'organizationId') || null;
        else orgId = mode === 'edit' ? (target.organizationId || actor.organizationId) : actor.organizationId;
        if (role === 'INSTRUCTOR' && !orgId) return bad('Guru wajib dihubungkan ke sebuah sekolah.');
        if (orgId) {
            var org = P8.repositories.organizationRepository.getById(orgId);
            if (!org || (org.status !== 'ACTIVE' && !(target && target.organizationId === orgId))) return bad('Sekolah tidak ditemukan atau belum aktif.');
        }
        var wanted = checkedValues(form, 'cls');

        var rec, oldUsername = target ? target.username : null, oldStatus = target ? target.status : null;
        if (mode === 'add') {
            var salt = saltFor(username);
            rec = repo.save({
                role: role, name: name, username: username, email: email || null, nis: nis || null,
                organizationId: orgId, classIds: [], status: 'ACTIVE',
                passwordHash: hashPassword(pw, salt), salt: salt, createdBy: actor.id
            });
        } else {
            rec = target;
            rec.name = name; rec.username = username; rec.email = email || null;
            if (role === 'STUDENT') rec.nis = nis || null;
            var orgChanged = rec.organizationId !== orgId;
            rec.organizationId = orgId;
            if (pw) { rec.salt = saltFor(username); rec.passwordHash = hashPassword(pw, rec.salt); }
            var stSel = fval(form, 'status');
            if (stSel === 'ACTIVE' || stSel === 'INACTIVE') {
                if (rec.status === 'ACTIVE' || rec.status === 'INACTIVE' || rec.status === 'DISABLED') rec.status = stSel;
            }
            if (orgChanged) dropCrossOrgClasses(rec);
            if (oldUsername !== username) moveStash(oldUsername, username);
            repo.save(rec);
        }
        syncClassesFor(rec, wanted, actor);
        repo.save(rec);

        if (mode === 'add') syncServerUser('create', rec, { password: pw });
        else {
            syncServerUser('update', rec, { password: pw });
            if (oldStatus !== rec.status) syncServerUser('status', rec, { status: rec.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED' });
        }
        msg('ok', (role === 'STUDENT' ? 'Data siswa' : 'Data guru') + ' "' + rec.name + '" ' + (mode === 'add' ? 'ditambahkan.' : 'diperbarui.'));
        state.dash.addUser = null; state.dash.editUser = null;
        renderDashboard();
    }

    function toggleUserStatus(id) {
        var actor = currentUser();
        var repo = P8.repositories.userRepository;
        var t = repo.getById(id);
        if (!t || !actor || !canManageUserData(t, actor)) { msg('error', 'Anda tidak berwenang mengubah status akun ini.'); renderDashboard(); return; }
        var next = t.status === 'ACTIVE' ? 'INACTIVE' : (t.status === 'INACTIVE' || t.status === 'DISABLED' ? 'ACTIVE' : null);
        if (!next) { msg('error', 'Status akun ini diatur lewat persetujuan pendaftaran.'); renderDashboard(); return; }
        t.status = next;
        repo.save(t);
        syncServerUser('status', t, { status: next === 'ACTIVE' ? 'ACTIVE' : 'DISABLED' });
        msg('ok', 'Akun "' + t.name + '" ' + (next === 'ACTIVE' ? 'diaktifkan.' : 'dinonaktifkan. Pengguna tidak bisa masuk sampai diaktifkan kembali.'));
        renderDashboard();
    }

    function deleteUser(id) {
        var actor = currentUser();
        var repo = P8.repositories.userRepository;
        var t = repo.getById(id);
        state.dash.confirmDelete = null;
        if (!actor || actor.role !== 'ADMIN') { msg('error', 'Hanya Superadmin yang dapat menghapus akun.'); renderDashboard(); return; }
        if (!t || (t.role !== 'STUDENT' && t.role !== 'INSTRUCTOR')) { msg('error', 'Pengguna tidak ditemukan.'); renderDashboard(); return; }
        var wasSchoolAdmin = isSchoolAdminUser(t);
        var orgId = t.organizationId;
        var classRepo = P8.repositories.classRepository;
        classRepo.list().forEach(function (c) {
            var a = (c.studentIds || []).indexOf(id), b = (c.instructorIds || []).indexOf(id);
            if (a < 0 && b < 0) return;
            if (a >= 0) c.studentIds.splice(a, 1);
            if (b >= 0) c.instructorIds.splice(b, 1);
            classRepo.save(c);
        });
        if (t.role === 'STUDENT') {
            var subRepo = P8.repositories.submissionRepository;
            subRepo.list().forEach(function (s) { if (s.studentId === id) subRepo.remove(s.id); });
        }
        try { localStorage.removeItem(LS_STASH + ownerOf(t)); } catch (e) { /* noop */ }
        syncServerUser('status', t, { status: 'DISABLED' });
        repo.remove(id);
        if (wasSchoolAdmin && orgId) {
            var org = P8.repositories.organizationRepository.getById(orgId);
            if (org && org.adminUserId === id) { org.adminUserId = null; P8.repositories.organizationRepository.save(org); }
            ensureSchoolAdmins();
        }
        state.dash.editUser = null; state.dash.detailUser = null;
        msg('ok', 'Akun "' + t.name + '" dihapus.');
        renderDashboard();
    }

    function removeStudentFromClass(classId, studentId) {
        var actor = currentUser();
        state.dash.confirmRemove = null;
        var res = P8.classService.removeStudent(classId, studentId, actor);
        if (!res.success) msg('error', res.error.message || 'Gagal mengeluarkan siswa.');
        else msg('ok', 'Siswa dikeluarkan dari kelas (akun siswa tetap ada).');
        state.dash.openStudent = null;
        renderDashboard();
    }

    /* ---------- aksi: edit kelas (guru) ---------- */
    function classEditForm(c) {
        return '<form class="dash-userform dash-classform" data-au-form="edit-class" novalidate>'
            + '<input type="hidden" name="classId" value="' + esc(c.id) + '">'
            + '<div class="dash-form-title">Edit kelas: <b>' + esc(c.name) + '</b></div>'
            + '<div class="dash-form-grid">'
            + '<label class="dash-field"><span>Nama kelas *</span><input name="name" value="' + esc(c.name) + '" maxlength="120" required></label>'
            + '<label class="dash-field"><span>Mata pelajaran</span><input name="subject" value="' + esc(c.subject || '') + '" maxlength="120"></label>'
            + '<label class="dash-field"><span>Tahun ajaran</span><input name="academicYear" value="' + esc(c.academicYear || '') + '" maxlength="20"></label>'
            + '<label class="dash-check dash-field-wide"><input type="checkbox" name="joinEnabled"' + (c.joinEnabled !== false ? ' checked' : '') + '> Kode gabung aktif (siswa dapat bergabung dengan kode <b>' + esc(c.joinCode || '-') + '</b>)</label>'
            + '</div>'
            + '<div class="dash-form-actions">'
            + '<button type="submit" class="au-btn-sm au-btn-ok">Simpan Kelas</button>'
            + '<button type="button" class="au-btn-sm au-btn-ghost" data-au-act="edit-class-cancel">Batal</button>'
            + '<button type="button" class="au-btn-sm au-btn-danger" data-au-act="archive-class" data-class="' + esc(c.id) + '">Arsipkan Kelas</button>'
            + '</div></form>';
    }
    function submitEditClass(form) {
        var u = currentUser();
        var cid = fval(form, 'classId');
        var name = fval(form, 'name').trim();
        if (!name) { msg('error', 'Nama kelas wajib diisi.'); renderDashboard(); return; }
        var res = P8.classService.editClass(cid, {
            name: name, subject: fval(form, 'subject').trim(),
            academicYear: fval(form, 'academicYear').trim(), joinEnabled: fchecked(form, 'joinEnabled')
        }, u);
        if (!res.success) { msg('error', res.error.message || 'Gagal menyimpan kelas.'); renderDashboard(); return; }
        msg('ok', 'Kelas "' + name + '" diperbarui.');
        state.dash.editClass = null;
        renderDashboard();
    }
    function restoreClass(classId) {
        var u = currentUser();
        var c = P8.repositories.classRepository.getById(classId);
        if (!c || !u || !(u.role === 'ADMIN' || (c.instructorIds || []).indexOf(u.id) >= 0)) { msg('error', 'Kelas tidak ditemukan atau bukan kelas Anda.'); renderDashboard(); return; }
        c.status = 'ACTIVE';
        P8.repositories.classRepository.save(c);
        msg('ok', 'Kelas "' + c.name + '" diaktifkan kembali.');
        renderDashboard();
    }

    /* =====================================================================
       SUPERADMIN: KELOLA SEKOLAH & KELAS (tambah, edit, nonaktifkan, hapus)
       ===================================================================== */
    function isAdminActor() { var a = currentUser(); return !!(a && a.role === 'ADMIN'); }
    function orgStats(o) {
        var users = P8.repositories.userRepository.list();
        return {
            gurus: users.filter(function (x) { return x.organizationId === o.id && x.role === 'INSTRUCTOR'; }),
            siswas: users.filter(function (x) { return x.organizationId === o.id && x.role === 'STUDENT'; }),
            kelas: P8.repositories.classRepository.list().filter(function (c) { return c.organizationId === o.id; })
        };
    }
    function orgTypeOptions(sel) {
        return Object.keys(ORG_TYPE_LABEL).map(function (t) {
            return '<option value="' + esc(t) + '"' + (t === sel ? ' selected' : '') + '>' + esc(ORG_TYPE_LABEL[t]) + '</option>';
        }).join('');
    }
    function orgNameTaken(name, exceptId) {
        var low = String(name).trim().toLowerCase();
        return P8.repositories.organizationRepository.list().some(function (o) {
            return o.id !== exceptId && String(o.name || '').trim().toLowerCase() === low;
        });
    }

    function orgForm(o) {
        var edit = !!o;
        var st = o ? o.status : 'ACTIVE';
        var html = '<form class="dash-userform" data-au-form="org-save" novalidate>'
            + '<input type="hidden" name="mode" value="' + (edit ? 'edit' : 'add') + '">'
            + '<input type="hidden" name="id" value="' + esc(o ? o.id : '') + '">'
            + '<div class="dash-form-title">' + (edit ? 'Edit sekolah: <b>' + esc(o.name) + '</b>' : 'Tambah sekolah baru') + '</div>'
            + '<div class="dash-form-grid">'
            + '<label class="dash-field"><span>Nama sekolah *</span><input name="name" value="' + esc(o ? o.name : '') + '" maxlength="120" required></label>'
            + '<label class="dash-field"><span>Jenis</span><select name="type">' + orgTypeOptions(o ? o.type : 'SCHOOL') + '</select></label>'
            + '<label class="dash-field dash-field-wide"><span>Alamat</span><input name="address" value="' + esc(o && o.address ? o.address : '') + '" maxlength="200"></label>';
        if (edit) {
            if (st === 'ACTIVE' || st === 'ARCHIVED') {
                html += '<label class="dash-field"><span>Status</span><select name="status">'
                    + '<option value="ACTIVE"' + (st === 'ACTIVE' ? ' selected' : '') + '>Aktif</option>'
                    + '<option value="ARCHIVED"' + (st === 'ARCHIVED' ? ' selected' : '') + '>Nonaktif (diarsipkan)</option></select></label>';
            }
            var gurus = orgStats(o).gurus;
            html += '<label class="dash-field"><span>Admin sekolah</span><select name="adminUserId"><option value="">(Belum ada)</option>'
                + gurus.map(function (g) { return '<option value="' + esc(g.id) + '"' + (o.adminUserId === g.id ? ' selected' : '') + '>' + esc(g.name) + ' (@' + esc(g.username) + ')</option>'; }).join('')
                + '</select></label>';
        } else {
            html += '<div class="dash-field dash-field-wide"><span>Admin sekolah (opsional &mdash; isi ketiganya untuk langsung membuat akun guru admin)</span></div>'
                + '<label class="dash-field"><span>Nama admin</span><input name="adminName" maxlength="100"></label>'
                + '<label class="dash-field"><span>Username admin</span><input name="adminUsername" maxlength="30" autocomplete="off"></label>'
                + '<label class="dash-field"><span>Sandi admin (min. 6)</span><input name="adminPassword" type="password" autocomplete="new-password"></label>';
        }
        html += '</div><div class="dash-form-actions">'
            + '<button type="submit" class="au-btn-sm au-btn-ok">' + (edit ? 'Simpan Perubahan' : 'Tambah Sekolah') + '</button>'
            + '<button type="button" class="au-btn-sm au-btn-ghost" data-au-act="org-cancel">Batal</button></div></form>';
        return html;
    }

    function schoolManager(actor) {
        var d = state.dash;
        var orgs = P8.repositories.organizationRepository.list().filter(function (o) {
            var q = String(d.q || '').trim().toLowerCase();
            return !q || [o.name, o.address].join(' ').toLowerCase().indexOf(q) >= 0;
        });
        var html = '<div class="dash-card"><div class="dash-card-head"><h3>Semua Sekolah</h3>'
            + '<button type="button" class="au-btn-sm au-btn-ok" data-au-act="add-org-open">' + (d.addOrg ? 'Tutup Form' : '+ Tambah Sekolah') + '</button></div>';
        if (d.addOrg) html += '<div class="dash-detail">' + orgForm(null) + '</div>';
        html += '<div class="dash-toolbar"><input type="search" data-au-search="1" placeholder="Cari nama atau alamat sekolah" value="' + esc(d.q || '') + '" aria-label="Cari sekolah"></div>';
        if (!orgs.length) return html + '<p class="dash-empty">Belum ada sekolah' + (d.q ? ' yang cocok.' : '.') + '</p></div>';
        html += '<div class="dash-table-wrap"><table class="dash-table dash-users"><thead><tr><th>Sekolah</th><th>Jenis</th><th>Admin</th><th>Status</th><th>Guru / Siswa / Kelas</th><th>Aksi</th></tr></thead><tbody>';
        orgs.forEach(function (o) {
            var s = orgStats(o);
            var adm = o.adminUserId ? P8.repositories.userRepository.getById(o.adminUserId) : null;
            var acts = '<button type="button" class="au-btn-sm" data-au-act="edit-org" data-org="' + esc(o.id) + '">' + (d.editOrg === o.id ? 'Tutup' : 'Edit') + '</button>';
            if (o.status === 'ACTIVE') acts += '<button type="button" class="au-btn-sm" data-au-act="toggle-org" data-org="' + esc(o.id) + '">Nonaktifkan</button>';
            else if (o.status === 'ARCHIVED') acts += '<button type="button" class="au-btn-sm au-btn-ok" data-au-act="toggle-org" data-org="' + esc(o.id) + '">Aktifkan</button>';
            else if (o.status === 'PENDING') acts += '<button type="button" class="au-btn-sm au-btn-ok" data-au-act="approve-school" data-org="' + esc(o.id) + '">Setujui</button>';
            if (d.confirmDeleteOrg === o.id) acts += '<span class="dash-confirm">Hapus sekolah? <button type="button" class="au-btn-sm au-btn-danger" data-au-act="delete-org" data-org="' + esc(o.id) + '">Ya, hapus</button>'
                + '<button type="button" class="au-btn-sm au-btn-ghost" data-au-act="org-delete-cancel">Batal</button></span>';
            else acts += '<button type="button" class="au-btn-sm au-btn-danger" data-au-act="org-delete-ask" data-org="' + esc(o.id) + '">Hapus</button>';
            html += '<tr><td><b>' + esc(o.name) + '</b><div class="dash-sub-txt">' + esc(o.address || '') + '</div></td>'
                + '<td>' + esc(orgTypeLabel(o.type)) + '</td><td>' + (adm ? esc(adm.name) : '<span class="dash-sub-txt">-</span>') + '</td>'
                + '<td><span class="dash-status dash-status-' + esc(String(o.status).toLowerCase()) + '">' + esc(o.status === 'ARCHIVED' ? 'Nonaktif' : statusLabel(o.status)) + '</span></td>'
                + '<td>' + s.gurus.length + ' / ' + s.siswas.length + ' / ' + s.kelas.length + '</td>'
                + '<td><div class="dash-mini-actions">' + acts + '</div></td></tr>';
            if (d.editOrg === o.id) html += '<tr class="dash-user-panel"><td colspan="6">' + orgForm(o) + '</td></tr>';
        });
        return html + '</tbody></table></div></div>';
    }

    function saveOrg(form) {
        var actor = currentUser();
        function bad(t) { msg('error', t); renderDashboard(); }
        if (!actor || actor.role !== 'ADMIN') return bad('Hanya Superadmin yang dapat mengelola sekolah.');
        var repo = P8.repositories.organizationRepository;
        var mode = fval(form, 'mode') === 'edit' ? 'edit' : 'add';
        var o = mode === 'edit' ? repo.getById(fval(form, 'id')) : null;
        if (mode === 'edit' && !o) return bad('Sekolah tidak ditemukan.');
        var name = fval(form, 'name').trim();
        var type = fval(form, 'type');
        var address = fval(form, 'address').trim();
        if (!name) return bad('Nama sekolah wajib diisi.');
        if (orgNameTaken(name, o && o.id)) return bad('Nama sekolah "' + name + '" sudah dipakai.');
        if (!ORG_TYPE_LABEL[type]) type = 'SCHOOL';

        if (mode === 'add') {
            var aName = fval(form, 'adminName').trim(), aUser = fval(form, 'adminUsername').trim(), aPw = fval(form, 'adminPassword');
            var wantAdmin = !!(aName || aUser || aPw);
            if (wantAdmin) {
                if (!aName || !aUser || !aPw) return bad('Data admin sekolah harus diisi lengkap (nama, username, sandi) atau dikosongkan semua.');
                if (!validUsername(aUser)) return bad('Username admin 3-30 karakter: huruf, angka, titik, garis bawah, atau strip.');
                if (usernameTaken(aUser, null)) return bad('Username "' + aUser + '" sudah dipakai.');
                if (aPw.length < 6) return bad('Sandi admin minimal 6 karakter.');
            }
            var org = repo.save({ name: name, type: type, address: address || null, status: 'ACTIVE', createdBy: actor.id });
            if (wantAdmin) {
                var salt = saltFor(aUser);
                var adm = P8.repositories.userRepository.save({
                    role: 'INSTRUCTOR', name: aName, username: aUser, email: null, organizationId: org.id, classIds: [],
                    status: 'ACTIVE', orgAdmin: true, passwordHash: hashPassword(aPw, salt), salt: salt, createdBy: actor.id
                });
                org.adminUserId = adm.id;
                repo.save(org);
                syncServerUser('create', adm, { password: aPw });
            }
            msg('ok', 'Sekolah "' + name + '" ditambahkan' + (wantAdmin ? ' beserta admin sekolahnya.' : '.'));
            state.dash.addOrg = false;
        } else {
            o.name = name; o.type = type; o.address = address || null;
            var st = fval(form, 'status');
            if ((o.status === 'ACTIVE' || o.status === 'ARCHIVED') && (st === 'ACTIVE' || st === 'ARCHIVED')) o.status = st;
            var newAdmin = fval(form, 'adminUserId');
            var users = P8.repositories.userRepository;
            if (newAdmin !== (o.adminUserId || '')) {
                var cand = newAdmin ? users.getById(newAdmin) : null;
                if (newAdmin && (!cand || cand.role !== 'INSTRUCTOR' || cand.organizationId !== o.id)) return bad('Admin sekolah harus guru dari sekolah ini.');
                if (o.adminUserId) { var prev = users.getById(o.adminUserId); if (prev) { prev.orgAdmin = false; users.save(prev); } }
                o.adminUserId = newAdmin || null;
                if (cand) { cand.orgAdmin = true; users.save(cand); }
            }
            repo.save(o);
            msg('ok', 'Data sekolah "' + name + '" diperbarui.');
            state.dash.editOrg = null;
        }
        renderDashboard();
    }

    function toggleOrgStatus(id) {
        if (!isAdminActor()) { msg('error', 'Hanya Superadmin yang dapat mengubah status sekolah.'); renderDashboard(); return; }
        var repo = P8.repositories.organizationRepository;
        var o = repo.getById(id);
        if (!o || (o.status !== 'ACTIVE' && o.status !== 'ARCHIVED')) { msg('error', 'Status sekolah ini diatur lewat persetujuan pendaftaran.'); renderDashboard(); return; }
        o.status = o.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE';
        repo.save(o);
        if (o.status === 'ACTIVE') ensureSchoolAdmins();
        msg('ok', 'Sekolah "' + o.name + '" ' + (o.status === 'ACTIVE' ? 'diaktifkan.' : 'dinonaktifkan (tidak muncul di pilihan pendaftaran).'));
        renderDashboard();
    }

    function deleteOrg(id) {
        state.dash.confirmDeleteOrg = null;
        if (!isAdminActor()) { msg('error', 'Hanya Superadmin yang dapat menghapus sekolah.'); renderDashboard(); return; }
        var repo = P8.repositories.organizationRepository;
        var o = repo.getById(id);
        if (!o) { msg('error', 'Sekolah tidak ditemukan.'); renderDashboard(); return; }
        var s = orgStats(o);
        if (s.gurus.length || s.siswas.length || s.kelas.length) {
            msg('error', 'Sekolah "' + o.name + '" masih punya ' + s.gurus.length + ' guru, ' + s.siswas.length + ' siswa, ' + s.kelas.length + ' kelas. Hapus atau pindahkan dulu, atau gunakan Nonaktifkan.');
            renderDashboard();
            return;
        }
        repo.remove(id);
        state.dash.editOrg = null;
        msg('ok', 'Sekolah "' + o.name + '" dihapus.');
        renderDashboard();
    }

    /* ---------- kelas (Superadmin, lintas sekolah) ---------- */
    function classAdminForm(c) {
        var edit = !!c;
        var gurus = P8.repositories.userRepository.list().filter(function (x) { return x.role === 'INSTRUCTOR'; });
        var checks = gurus.length ? gurus.map(function (g) {
            var on = c && (c.instructorIds || []).indexOf(g.id) >= 0;
            return '<label class="dash-check"><input type="checkbox" name="cls" value="' + esc(g.id) + '"' + (on ? ' checked' : '') + '> ' + esc(g.name) + ' <i>(' + esc(orgName(g.organizationId) || 'tanpa sekolah') + ')</i></label>';
        }).join('') : '<p class="dash-hint">Belum ada guru.</p>';
        var html = '<form class="dash-userform" data-au-form="class-admin-save" novalidate>'
            + '<input type="hidden" name="mode" value="' + (edit ? 'edit' : 'add') + '">'
            + '<input type="hidden" name="id" value="' + esc(c ? c.id : '') + '">'
            + '<div class="dash-form-title">' + (edit ? 'Edit kelas: <b>' + esc(c.name) + '</b>' : 'Tambah kelas baru') + '</div>'
            + '<div class="dash-form-grid">'
            + '<label class="dash-field"><span>Nama kelas *</span><input name="name" value="' + esc(c ? c.name : '') + '" maxlength="120" required></label>'
            + '<label class="dash-field"><span>Mata pelajaran</span><input name="subject" value="' + esc(c ? c.subject || '' : '') + '" maxlength="120"></label>'
            + '<label class="dash-field"><span>Tahun ajaran</span><input name="academicYear" value="' + esc(c ? c.academicYear || '' : '') + '" maxlength="20"></label>';
        if (edit) html += '<div class="dash-field"><span>Sekolah</span><b>' + esc(orgName(c.organizationId) || '-') + '</b></div>';
        else html += '<label class="dash-field"><span>Sekolah *</span><select name="organizationId">' + orgOptionsHtml('', false) + '</select></label>';
        if (edit) {
            html += '<label class="dash-field"><span>Status</span><select name="status"><option value="ACTIVE"' + (c.status !== 'ARCHIVED' ? ' selected' : '') + '>Aktif</option>'
                + '<option value="ARCHIVED"' + (c.status === 'ARCHIVED' ? ' selected' : '') + '>Diarsipkan</option></select></label>'
                + '<label class="dash-check dash-field-wide"><input type="checkbox" name="joinEnabled"' + (c.joinEnabled !== false ? ' checked' : '') + '> Kode gabung aktif (<b>' + esc(c.joinCode || '-') + '</b>)</label>';
        }
        html += '<div class="dash-field dash-field-wide"><span>Guru pengajar</span><div class="dash-checks">' + checks + '</div>'
            + '<small>Hanya guru dari sekolah kelas yang diterapkan.</small></div>'
            + '</div><div class="dash-form-actions">'
            + '<button type="submit" class="au-btn-sm au-btn-ok">' + (edit ? 'Simpan Kelas' : 'Tambah Kelas') + '</button>'
            + '<button type="button" class="au-btn-sm au-btn-ghost" data-au-act="class-admin-cancel">Batal</button></div></form>';
        return html;
    }

    function classManager(actor) {
        var d = state.dash;
        var q = String(d.q || '').trim().toLowerCase();
        var users = P8.repositories.userRepository;
        var list = P8.repositories.classRepository.list().filter(function (c) {
            if (d.fOrg && c.organizationId !== d.fOrg) return false;
            return !q || [c.name, c.subject, c.joinCode].join(' ').toLowerCase().indexOf(q) >= 0;
        }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
        var html = '<div class="dash-card"><div class="dash-card-head"><h3>Data Kelas &mdash; Semua Sekolah</h3>'
            + '<button type="button" class="au-btn-sm au-btn-ok" data-au-act="add-class-open">' + (d.addClassA ? 'Tutup Form' : '+ Tambah Kelas') + '</button></div>';
        if (d.addClassA) html += '<div class="dash-detail">' + classAdminForm(null) + '</div>';
        html += '<div class="dash-toolbar"><input type="search" data-au-search="1" placeholder="Cari nama, mapel, kode kelas" value="' + esc(q) + '" aria-label="Cari kelas">'
            + '<select data-au-filter="org" aria-label="Filter sekolah"><option value="">Semua sekolah</option>'
            + P8.repositories.organizationRepository.list().map(function (o) { return '<option value="' + esc(o.id) + '"' + (d.fOrg === o.id ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('')
            + '</select></div>';
        if (!list.length) return html + '<p class="dash-empty">Belum ada kelas' + (q || d.fOrg ? ' yang cocok.' : '.') + '</p></div>';
        html += '<div class="dash-table-wrap"><table class="dash-table dash-users"><thead><tr><th>Kelas</th><th>Sekolah</th><th>Guru</th><th>Siswa</th><th>Kode</th><th>Status</th><th>Aksi</th></tr></thead><tbody>';
        list.forEach(function (c) {
            var gs = (c.instructorIds || []).map(function (id) { var g = users.getById(id); return g ? g.name : null; }).filter(Boolean);
            var archived = c.status === 'ARCHIVED';
            var acts = '<button type="button" class="au-btn-sm" data-au-act="edit-class-admin" data-class="' + esc(c.id) + '">' + (d.editClassA === c.id ? 'Tutup' : 'Edit') + '</button>'
                + '<button type="button" class="au-btn-sm' + (archived ? ' au-btn-ok' : '') + '" data-au-act="toggle-class-admin" data-class="' + esc(c.id) + '">' + (archived ? 'Aktifkan' : 'Arsipkan') + '</button>';
            if (d.confirmDeleteClass === c.id) acts += '<span class="dash-confirm">Hapus kelas &amp; tugasnya? <button type="button" class="au-btn-sm au-btn-danger" data-au-act="delete-class-admin" data-class="' + esc(c.id) + '">Ya, hapus</button>'
                + '<button type="button" class="au-btn-sm au-btn-ghost" data-au-act="class-delete-cancel">Batal</button></span>';
            else acts += '<button type="button" class="au-btn-sm au-btn-danger" data-au-act="class-delete-ask" data-class="' + esc(c.id) + '">Hapus</button>';
            html += '<tr><td><b>' + esc(c.name) + '</b><div class="dash-sub-txt">' + esc(c.subject || '') + (c.academicYear ? ' &middot; ' + esc(c.academicYear) : '') + '</div></td>'
                + '<td>' + esc(orgName(c.organizationId) || '-') + '</td>'
                + '<td>' + (gs.length ? gs.map(function (n) { return '<span class="dash-chip">' + esc(n) + '</span>'; }).join('') : '<span class="dash-sub-txt">-</span>') + '</td>'
                + '<td>' + (c.studentIds || []).length + '</td><td>' + esc(c.joinCode || '-') + '</td>'
                + '<td><span class="dash-status dash-status-' + (archived ? 'inactive' : 'active') + '">' + (archived ? 'Arsip' : 'Aktif') + '</span></td>'
                + '<td><div class="dash-mini-actions">' + acts + '</div></td></tr>';
            if (d.editClassA === c.id) html += '<tr class="dash-user-panel"><td colspan="7">' + classAdminForm(c) + '</td></tr>';
        });
        return html + '</tbody></table></div><p class="dash-hint">Menampilkan ' + list.length + ' kelas.</p></div>';
    }

    function saveClassAdmin(form) {
        var actor = currentUser();
        function bad(t) { msg('error', t); renderDashboard(); }
        if (!actor || actor.role !== 'ADMIN') return bad('Hanya Superadmin yang dapat mengelola kelas lintas sekolah.');
        var repo = P8.repositories.classRepository;
        var mode = fval(form, 'mode') === 'edit' ? 'edit' : 'add';
        var name = fval(form, 'name').trim();
        var subject = fval(form, 'subject').trim();
        var year = fval(form, 'academicYear').trim();
        if (!name) return bad('Nama kelas wajib diisi.');
        var wanted = checkedValues(form, 'cls');
        var c;
        if (mode === 'add') {
            var orgId = fval(form, 'organizationId');
            var org = orgId ? P8.repositories.organizationRepository.getById(orgId) : null;
            if (!org || org.status !== 'ACTIVE') return bad('Pilih sekolah yang aktif untuk kelas ini.');
            var res = P8.classService.createClass({ name: name, subject: subject, academicYear: year || undefined, organizationId: orgId }, actor);
            if (!res.success) return bad((res.error && res.error.message) || 'Gagal membuat kelas.');
            c = repo.getById(res.data.id);
        } else {
            c = repo.getById(fval(form, 'id'));
            if (!c) return bad('Kelas tidak ditemukan.');
            var er = P8.classService.editClass(c.id, { name: name, subject: subject, academicYear: year, joinEnabled: fchecked(form, 'joinEnabled') }, actor);
            if (!er.success) return bad((er.error && er.error.message) || 'Gagal menyimpan kelas.');
            c = repo.getById(c.id);
            var st = fval(form, 'status');
            if (st === 'ACTIVE' || st === 'ARCHIVED') c.status = st;
        }
        c.instructorIds = wanted.filter(function (id) {
            var g = P8.repositories.userRepository.getById(id);
            return g && g.role === 'INSTRUCTOR' && g.organizationId === c.organizationId;
        });
        repo.save(c);
        msg('ok', 'Kelas "' + c.name + '" ' + (mode === 'add' ? 'ditambahkan.' : 'diperbarui.'));
        state.dash.addClassA = false; state.dash.editClassA = null;
        renderDashboard();
    }

    function toggleClassAdmin(id) {
        if (!isAdminActor()) { msg('error', 'Hanya Superadmin yang dapat mengubah status kelas.'); renderDashboard(); return; }
        var repo = P8.repositories.classRepository;
        var c = repo.getById(id);
        if (!c) { msg('error', 'Kelas tidak ditemukan.'); renderDashboard(); return; }
        c.status = c.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED';
        repo.save(c);
        msg('ok', 'Kelas "' + c.name + '" ' + (c.status === 'ARCHIVED' ? 'diarsipkan.' : 'diaktifkan kembali.'));
        renderDashboard();
    }

    function deleteClassAdmin(id) {
        state.dash.confirmDeleteClass = null;
        if (!isAdminActor()) { msg('error', 'Hanya Superadmin yang dapat menghapus kelas.'); renderDashboard(); return; }
        var P = P8.repositories;
        var c = P.classRepository.getById(id);
        if (!c) { msg('error', 'Kelas tidak ditemukan.'); renderDashboard(); return; }
        P.submissionRepository.list().forEach(function (s) { if (s.classId === id) P.submissionRepository.remove(s.id); });
        P.assignmentRepository.list().forEach(function (a) { if (a.classId === id) P.assignmentRepository.remove(a.id); });
        P.userRepository.list().forEach(function (u) {
            if ((u.classIds || []).indexOf(id) >= 0) { u.classIds = u.classIds.filter(function (x) { return x !== id; }); P.userRepository.save(u); }
        });
        P.classRepository.remove(id);
        state.dash.editClassA = null;
        msg('ok', 'Kelas "' + c.name + '" beserta tugas dan kiriman siswanya dihapus.');
        renderDashboard();
    }

    function handleAu(action, el) {
        if (action === 'demo-dismiss') { try { sessionStorage.setItem('starterLab_demo_bar_off', '1'); } catch (e) { } renderDemoBar(); return; }
        if (action === 'logout') { doLogout(); return; }
        if (action === 'login') { try { location.href = LOGIN_URL; } catch (e) { } return; }
    }

    function handleAct(action, el) {
        var u = currentUser();
        if (action === 'nav') {
            var page = el.getAttribute('data-page');
            if (typeof window.navigateTo === 'function') window.navigateTo(page);
            else { location.hash = '#/' + page; }
            return;
        }
        if (action === 'refresh') { renderDashboard(); if (u && u.role === 'ADMIN') loadServerUsers(true); return; }
        if (!u) return;

        if (action === 'copy-code') {
            var code = el.getAttribute('data-code');
            if (code) copyText(code, el);
            return;
        }
        if (action === 'admin-tab') {
            var d0 = state.dash;
            d0.adminTab = el.getAttribute('data-tab') || 'sekolah';
            d0.q = ''; d0.fOrg = ''; d0.fClass = ''; d0.editUser = null; d0.addUser = null; d0.detailUser = null; d0.confirmDelete = null;
            d0.addOrg = false; d0.editOrg = null; d0.confirmDeleteOrg = null; d0.addClassA = false; d0.editClassA = null; d0.confirmDeleteClass = null;
            renderDashboard();
            if (d0.adminTab !== 'sekolah') loadServerUsers(false);
            return;
        }
        if (action === 'quick-add') {
            var kind = el.getAttribute('data-kind');
            var dq = state.dash;
            dq.q = ''; dq.fOrg = ''; dq.fClass = ''; dq.editUser = null; dq.detailUser = null; dq.confirmDelete = null;
            dq.addUser = null; dq.addOrg = false; dq.addClassA = false; dq.editOrg = null; dq.editClassA = null;
            dq.adminTab = kind;
            if (kind === 'sekolah') dq.addOrg = true;
            else if (kind === 'kelas') dq.addClassA = true;
            else dq.addUser = kind === 'guru' ? 'INSTRUCTOR' : 'STUDENT';
            renderDashboard();
            if (kind === 'guru' || kind === 'siswa') loadServerUsers(false);
            return;
        }
        if (action === 'add-org-open') { state.dash.addOrg = !state.dash.addOrg; state.dash.editOrg = null; renderDashboard(); return; }
        if (action === 'edit-org') { var eo = el.getAttribute('data-org'); state.dash.editOrg = state.dash.editOrg === eo ? null : eo; state.dash.addOrg = false; renderDashboard(); return; }
        if (action === 'org-cancel') { state.dash.editOrg = null; state.dash.addOrg = false; renderDashboard(); return; }
        if (action === 'toggle-org') { toggleOrgStatus(el.getAttribute('data-org')); return; }
        if (action === 'org-delete-ask') { state.dash.confirmDeleteOrg = el.getAttribute('data-org'); renderDashboard(); return; }
        if (action === 'org-delete-cancel') { state.dash.confirmDeleteOrg = null; renderDashboard(); return; }
        if (action === 'delete-org') { deleteOrg(el.getAttribute('data-org')); return; }
        if (action === 'add-class-open') { state.dash.addClassA = !state.dash.addClassA; state.dash.editClassA = null; renderDashboard(); return; }
        if (action === 'edit-class-admin') { var ecA = el.getAttribute('data-class'); state.dash.editClassA = state.dash.editClassA === ecA ? null : ecA; state.dash.addClassA = false; renderDashboard(); return; }
        if (action === 'class-admin-cancel') { state.dash.editClassA = null; state.dash.addClassA = false; renderDashboard(); return; }
        if (action === 'toggle-class-admin') { toggleClassAdmin(el.getAttribute('data-class')); return; }
        if (action === 'class-delete-ask') { state.dash.confirmDeleteClass = el.getAttribute('data-class'); renderDashboard(); return; }
        if (action === 'class-delete-cancel') { state.dash.confirmDeleteClass = null; renderDashboard(); return; }
        if (action === 'delete-class-admin') { deleteClassAdmin(el.getAttribute('data-class')); return; }
        if (action === 'add-user-open') {
            var rl = el.getAttribute('data-role');
            state.dash.addUser = state.dash.addUser === rl ? null : rl;
            state.dash.editUser = null;
            renderDashboard();
            return;
        }
        if (action === 'edit-user') {
            var eu = el.getAttribute('data-user');
            state.dash.editUser = state.dash.editUser === eu ? null : eu;
            state.dash.addUser = null;
            renderDashboard();
            return;
        }
        if (action === 'user-cancel') { state.dash.editUser = null; state.dash.addUser = null; renderDashboard(); return; }
        if (action === 'detail-user') {
            var du = el.getAttribute('data-user');
            state.dash.detailUser = state.dash.detailUser === du ? null : du;
            if (state.dash.detailUser) fetchServerDetail(P8.repositories.userRepository.getById(du));
            renderDashboard();
            return;
        }
        if (action === 'toggle-user') { toggleUserStatus(el.getAttribute('data-user')); return; }
        if (action === 'delete-ask') { state.dash.confirmDelete = el.getAttribute('data-user'); renderDashboard(); return; }
        if (action === 'delete-cancel') { state.dash.confirmDelete = null; renderDashboard(); return; }
        if (action === 'delete-user') { deleteUser(el.getAttribute('data-user')); return; }
        if (action === 'edit-class') {
            var ec = el.getAttribute('data-class');
            state.dash.editClass = state.dash.editClass === ec ? null : ec;
            renderDashboard();
            return;
        }
        if (action === 'edit-class-cancel') { state.dash.editClass = null; renderDashboard(); return; }
        if (action === 'archive-class') {
            var ac = P8.classService.archiveClass(el.getAttribute('data-class'), u);
            if (!ac.success) msg('error', ac.error.message); else msg('ok', 'Kelas diarsipkan. Aktifkan kembali dari bagian "Kelas Diarsipkan".');
            state.dash.editClass = null; state.dash.openClass = null;
            renderDashboard();
            return;
        }
        if (action === 'restore-class') { restoreClass(el.getAttribute('data-class')); return; }
        if (action === 'remove-ask') { state.dash.confirmRemove = el.getAttribute('data-class') + ':' + el.getAttribute('data-student'); renderDashboard(); return; }
        if (action === 'remove-cancel') { state.dash.confirmRemove = null; renderDashboard(); return; }
        if (action === 'remove-student') { removeStudentFromClass(el.getAttribute('data-class'), el.getAttribute('data-student')); return; }
        if (action === 'toggle-class') {
            var cid = el.getAttribute('data-class');
            state.dash.openClass = state.dash.openClass === cid ? null : cid;
            state.dash.openStudent = null;
            state.dash.addingStudent = null;
            renderDashboard();
            return;
        }
        if (action === 'add-student-open') {
            var cid2 = el.getAttribute('data-class');
            state.dash.addingStudent = state.dash.addingStudent === cid2 ? null : cid2;
            renderDashboard();
            return;
        }
        if (action === 'open-student') {
            var oc = el.getAttribute('data-class'), os = el.getAttribute('data-student');
            if (state.dash.openStudent && state.dash.openStudent.classId === oc && state.dash.openStudent.studentId === os) {
                state.dash.openStudent = null;
            } else {
                state.dash.openStudent = { classId: oc, studentId: os };
                fetchServerDetail(P8.repositories.userRepository.getById(os));
            }
            renderDashboard();
            return;
        }
        if (action === 'regen') {
            var cr = P8.classService.regenerateJoinCode(el.getAttribute('data-class'), u);
            if (!cr.success) msg('error', cr.error.message);
            renderDashboard();
            return;
        }
        if (action === 'edit-self') { state.dash.editSelf = !state.dash.editSelf; renderDashboard(); return; }
        if (action === 'edit-assign') {
            var eaid = el.getAttribute('data-assign');
            state.dash.editAssign = state.dash.editAssign === eaid ? null : eaid;
            renderDashboard();
            return;
        }
        if (action === 'regrade-open') {
            var rgo = el.getAttribute('data-sub');
            state.dash.regrade = state.dash.regrade === rgo ? null : rgo;
            renderDashboard();
            return;
        }
        if (action === 'regrade') {
            var rgid = el.getAttribute('data-sub');
            var rgrow = el.closest ? el.closest('.dash-grade') : null;
            var rgs = rgrow && rgrow.querySelector('input[name="score"]') ? rgrow.querySelector('input[name="score"]').value : '';
            var rgf = rgrow && rgrow.querySelector('input[name="feedback"]') ? rgrow.querySelector('input[name="feedback"]').value : '';
            var rgr = P8.gradingService.regrade(rgid, { score: rgs, feedback: rgf }, u);
            if (!rgr.success) msg('error', rgr.error.message); else msg('ok', 'Nilai siswa diperbarui.');
            state.dash.regrade = null;
            renderDashboard();
            return;
        }
        if (action === 'reopen-sub') {
            var rsr = P8.gradingService.reopen(el.getAttribute('data-sub'), 'Tugas dibuka ulang oleh guru. Silakan kerjakan kembali.', u);
            if (!rsr.success) msg('error', rsr.error.message); else msg('ok', 'Tugas dibuka ulang untuk siswa.');
            state.dash.regrade = null;
            renderDashboard();
            return;
        }
        if (action === 'publish-assign') {
            var pr = P8.assignmentService.publish(el.getAttribute('data-assign'), u);
            if (!pr.success) msg('error', pr.error.message);
            renderDashboard();
            return;
        }
        if (action === 'grade-open') {
            var sid = el.getAttribute('data-sub');
            state.dash.grading = state.dash.grading === sid ? null : sid;
            renderDashboard();
            return;
        }
        if (action === 'grade') {
            var gid = el.getAttribute('data-sub');
            var row = el.closest ? el.closest('.dash-grade') : null;
            var score = row && row.querySelector('input[name="score"]') ? row.querySelector('input[name="score"]').value : '';
            var fb = row && row.querySelector('input[name="feedback"]') ? row.querySelector('input[name="feedback"]').value : '';
            var gr = P8.gradingService.grade(gid, { score: Number(score), feedback: fb }, u);
            if (!gr.success) msg('error', gr.error.message); else msg('ok', 'Nilai tersimpan.');
            state.dash.grading = null;
            renderDashboard();
            return;
        }
        if (action === 'return') {
            var rid = el.getAttribute('data-sub');
            var row2 = el.closest ? el.closest('.dash-grade') : null;
            var fb2 = row2 && row2.querySelector('input[name="feedback"]') ? row2.querySelector('input[name="feedback"]').value : 'Perlu perbaikan.';
            var rr = P8.gradingService.returnForRevision(rid, fb2, u);
            if (!rr.success) msg('error', rr.error.message); else msg('ok', 'Dikembalikan untuk revisi.');
            state.dash.grading = null;
            renderDashboard();
            return;
        }
        if (action === 'approve-student') {
            approveStudent(el.getAttribute('data-student'), u);
            return;
        }
        if (action === 'reject-student') {
            rejectStudent(el.getAttribute('data-student'), u);
            return;
        }
        if (action === 'approve-school') {
            if (u.role !== 'ADMIN') return;
            approveSchool(el.getAttribute('data-org'));
            return;
        }
        if (action === 'reject-open') {
            if (u.role !== 'ADMIN') return;
            var oid = el.getAttribute('data-org');
            state.dash.reject = state.dash.reject === oid ? null : oid;
            renderDashboard();
            return;
        }
        if (action === 'reject-confirm') {
            if (u.role !== 'ADMIN') return;
            var oid2 = el.getAttribute('data-org');
            var wrap = el.closest ? el.closest('.dash-reject') : null;
            var reason = wrap && wrap.querySelector('[data-reject-reason]') ? wrap.querySelector('[data-reject-reason]').value : '';
            rejectSchool(oid2, reason);
            return;
        }
    }

    function approveSchool(orgId) {
        var org = P8.repositories.organizationRepository.getById(orgId);
        if (!org) return;
        var pa = org.pendingAdmin;
        org.status = 'ACTIVE';
        if (pa && pa.username) {
            var admin = P8.repositories.userRepository.list().filter(function (x) { return x.username === pa.username; })[0];
            if (!admin) {
                admin = P8.repositories.userRepository.save({
                    role: 'INSTRUCTOR', name: pa.name || ('Admin ' + org.name), username: pa.username,
                    email: pa.email || null, organizationId: org.id, classIds: [], status: 'ACTIVE',
                    orgAdmin: true, passwordHash: pa.passwordHash, salt: pa.salt
                });
            } else {
                admin.role = 'INSTRUCTOR'; admin.organizationId = org.id; admin.status = 'ACTIVE'; admin.orgAdmin = true;
                admin = P8.repositories.userRepository.save(admin);
            }
            if (admin) org.adminUserId = admin.id;
        }
        delete org.pendingAdmin;
        P8.repositories.organizationRepository.save(org);
        state.dash.reject = null;
        msg('ok', 'Sekolah "' + org.name + '" disetujui.');
        renderDashboard();
    }

    function rejectSchool(orgId, reason) {
        var org = P8.repositories.organizationRepository.getById(orgId);
        if (!org) return;
        org.status = 'REJECTED';
        org.rejectReason = reason || '';
        org.rejectedAt = Date.now();
        P8.repositories.organizationRepository.save(org);
        state.dash.reject = null;
        msg('ok', 'Sekolah "' + org.name + '" ditolak.');
        renderDashboard();
    }

    function isOrgAdmin(u) { return !!(u && u.role === 'INSTRUCTOR' && u.orgAdmin === true); }

    function canManageStudent(student, actor) {
        if (!student || !actor) return false;
        if (actor.role === 'ADMIN') return true;
        return isOrgAdmin(actor) && !!student.organizationId && actor.organizationId === student.organizationId;
    }

    function approveStudent(id, actor) {
        var u = P8.repositories.userRepository.getById(id);
        if (!u || u.role !== 'STUDENT') { msg('error', 'Siswa tidak ditemukan.'); renderDashboard(); return false; }
        if (!canManageStudent(u, actor)) { msg('error', 'Anda tidak berwenang menyetujui siswa ini.'); renderDashboard(); return false; }
        if (u.organizationId) {
            var org = P8.repositories.organizationRepository.getById(u.organizationId);
            if (!org || org.status !== 'ACTIVE') { msg('error', 'Sekolah siswa belum aktif.'); renderDashboard(); return false; }
        }
        u.status = 'ACTIVE';
        u.approvedAt = Date.now();
        delete u.rejectedAt;
        P8.repositories.userRepository.save(u);
        msg('ok', 'Pendaftaran siswa "' + u.name + '" disetujui.');
        renderDashboard();
        return true;
    }

    function rejectStudent(id, actor) {
        var u = P8.repositories.userRepository.getById(id);
        if (!u || u.role !== 'STUDENT') { msg('error', 'Siswa tidak ditemukan.'); renderDashboard(); return false; }
        if (!canManageStudent(u, actor)) { msg('error', 'Anda tidak berwenang menolak siswa ini.'); renderDashboard(); return false; }
        u.status = 'REJECTED';
        u.rejectedAt = Date.now();
        P8.repositories.userRepository.save(u);
        msg('ok', 'Pendaftaran siswa "' + u.name + '" ditolak.');
        renderDashboard();
        return true;
    }

    function pendingStudentRow(s, showOrg) {
        var org = (showOrg && s.organizationId) ? P8.repositories.organizationRepository.getById(s.organizationId) : null;
        var orgLabel = org ? (' &middot; ' + esc(org.name)) : (s.organizationId ? '' : ' &middot; tanpa sekolah');
        return '<div class="dash-row">'
            + '  <div class="dash-li-main"><b>' + esc(s.name) + '</b><span>@' + esc(s.username || '') + orgLabel + ' &middot; diajukan ' + esc(fmtDate(s.requestedAt)) + '</span></div>'
            + '  <div class="dash-grade-actions">'
            + '    <button type="button" class="au-btn-sm au-btn-ok" data-au-act="approve-student" data-student="' + esc(s.id) + '">Setujui</button>'
            + '    <button type="button" class="au-btn-sm au-btn-danger" data-au-act="reject-student" data-student="' + esc(s.id) + '">Tolak</button>'
            + '  </div>'
            + '</div>';
    }

    function pendingStudentsFor(orgId) {
        return P8.repositories.userRepository.list().filter(function (x) {
            return x.role === 'STUDENT' && x.status === 'PENDING' && (!orgId || x.organizationId === orgId);
        });
    }

    function copyText(text, el) {
        var done = function () {
            if (el) { var old = el.getAttribute('data-label') || el.textContent; el.setAttribute('data-label', old); el.textContent = 'Tersalin!'; setTimeout(function () { el.textContent = old; }, 1200); }
        };
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, done); return; }
        } catch (e) { }
        done();
    }

    function onSubmit(e) {
        var form = e.target;
        var kind = form.getAttribute ? form.getAttribute('data-au-form') : null;
        if (!kind) return;
        e.preventDefault();
        if (isDemoSession() && ['login', 'force-pw', 'register', 'school'].indexOf(kind) === -1) {
            msg('error', 'Fitur ini tidak tersedia di mode demo. Daftar akun untuk memakainya.');
            renderDashboard();
            return;
        }
        if (kind === 'login') return submitLogin(form);
        if (kind === 'force-pw') return submitForceChange(form);
        if (kind === 'register') return submitRegister(form);
        if (kind === 'school') return submitSchool(form);
        if (kind === 'join') return submitJoin(form);
        if (kind === 'create-class') return submitCreateClass(form);
        if (kind === 'add-student') return submitAddStudent(form);
        if (kind === 'add-student-username') return submitAddStudentUsername(form);
        if (kind === 'create-assign') return submitCreateAssign(form);
        if (kind === 'user-save') return saveUser(form);
        if (kind === 'org-save') return saveOrg(form);
        if (kind === 'class-admin-save') return saveClassAdmin(form);
        if (kind === 'edit-class') return submitEditClass(form);
        if (kind === 'edit-self') return submitEditSelf(form);
        if (kind === 'edit-assign') return submitEditAssign(form);
    }

    /* Salin akun hasil login server ke data lokal agar identitas (nama, NIS, peran)
       selalu mengikuti server dan login offline berikutnya tetap berjalan. */
    function mirrorServerUser(su, password) {
        var repo = P8.repositories.userRepository;
        var existing = repo.list().filter(function (x) { return x.username === su.username; })[0];
        var salt = existing && existing.salt ? existing.salt : saltFor(su.username);
        var rec = existing ? existing : { classIds: [] };
        rec.role = su.role;
        rec.name = su.name;
        rec.username = su.username;
        rec.email = su.email || rec.email || null;
        rec.status = 'ACTIVE';
        rec.nis = su.nis || null;
        rec.nisn = su.nisn || null;
        rec.serverId = su.id;
        if (su.organizationId && P8.repositories.organizationRepository.getById(su.organizationId)) {
            rec.organizationId = su.organizationId;
        } else if (rec.organizationId === undefined) {
            rec.organizationId = null;
        }
        rec.salt = salt;
        rec.passwordHash = hashPassword(password, salt);
        return repo.save(rec);
    }
    function saveIdentityExtras(su, me) {
        var kelas = [];
        try { ((me && me.classes) || []).forEach(function (c) { if (c && c.name) kelas.push(c.name); }); } catch (e) { }
        writeJSON(LS_IDENT, { username: su.username, nis: su.nis || '', kelas: kelas });
    }

    /* ---- Mode Demo (pratinjau tanpa akun) ----
       - Dibatasi DEMO_MAX kali per browser (penghitung di localStorage; dihitung tiap demo DIMULAI,
         muat ulang di tab yang sama tidak menambah hitungan).
       - Memakai akun siswa sementara yang disembunyikan dari daftar pengguna; data belajar demo
         selalu mulai bersih dan dibuang saat keluar. Tidak ada token/sinkronisasi server. */
    var DEMO_MAX = 5;
    var LS_DEMO = 'starterLab_demo_v1';
    var DEMO_ID = 'USER_DEMO';
    var DEMO_USERNAME = '__demo_starterlab__';
    var DEMO_OWNER = 'u:' + DEMO_USERNAME;
    function demoInfo() {
        var d = readJSON(LS_DEMO, null);
        var n = d && isFinite(d.count) && d.count > 0 ? Math.floor(d.count) : 0;
        return { count: n, max: DEMO_MAX, left: Math.max(0, DEMO_MAX - n) };
    }
    function isDemoSession() { return !!(state.session && state.session.demo); }
    function hideDemoUsers() {
        var repo = P8.repositories.userRepository;
        if (repo.__demoHidden) return;
        var list0 = repo.list, query0 = repo.query;
        repo.list = function () { return list0.apply(repo, arguments).filter(function (u) { return !u.isDemo; }); };
        repo.query = function (f) { return query0.call(repo, function (r) { return !r.isDemo && (!f || f(r)); }); };
        repo.__demoHidden = true;
    }
    function demoCta() {
        var i = demoInfo();
        return '<div class="au-sep"><span>belum punya akun?</span></div>'
            + '<button type="button" class="au-btn au-btn-block au-demo-btn" data-au-demo="1"' + (i.left ? '' : ' disabled') + '>Coba Demo</button>'
            + '<div class="au-hint au-demo-note">' + (i.left
                ? 'Lihat tampilan simulator tanpa mendaftar. Sisa akses demo: <b>' + i.left + '</b> dari ' + i.max + '.'
                : 'Batas akses demo (' + i.max + ' kali) di perangkat ini sudah tercapai. Silakan daftar untuk melanjutkan.') + '</div>';
    }
    function startDemo() {
        if (!P8) return;
        var i = demoInfo();
        if (i.left <= 0) { state.message = null; msg('error', 'Batas akses demo (' + i.max + ' kali) sudah tercapai. Silakan daftar untuk melanjutkan.'); renderLogin(); return; }
        writeJSON(LS_DEMO, { count: i.count + 1, last: Date.now() });
        try { if (cloudOn()) CL.clearToken(); } catch (e) { }
        try { if (window.ProgressApi) window.ProgressApi.clearAuth(); } catch (e) { }
        var repo = P8.repositories.userRepository;
        if (!repo.getById(DEMO_ID)) {
            var salt = 'seed_demo';
            repo.save({
                id: DEMO_ID, role: 'STUDENT', name: 'Pengguna Demo', username: DEMO_USERNAME, email: null,
                organizationId: null, classIds: [], status: 'ACTIVE', isDemo: true,
                passwordHash: hashPassword('x' + Math.random() + Date.now(), salt), salt: salt, createdBy: 'SYSTEM'
            });
        }
        /* mulai demo dari data bersih */
        try {
            if (localStorage.getItem(LS_OWNER) === DEMO_OWNER) DATA_KEYS.forEach(function (k) { localStorage.removeItem(k); });
            localStorage.removeItem(LS_STASH + DEMO_OWNER);
            localStorage.removeItem(LS_IDENT);
        } catch (e) { }
        state.message = null;
        setSession(DEMO_ID);
    }
    function demoBarDismissed() { try { return sessionStorage.getItem('starterLab_demo_bar_off') === '1'; } catch (e) { return false; } }
    function renderDemoBar() {
        var old = document.getElementById ? document.getElementById('au-demo-bar') : null;
        var root = document.documentElement;
        if (!isDemoSession() || demoBarDismissed()) {
            if (old && old.parentNode) old.parentNode.removeChild(old);
            if (root && root.classList) root.classList.remove('has-demo-bar');
            return;
        }
        var i = demoInfo();
        var html = '<span class="au-demo-bar-txt"><b>Mode Demo</b><span class="au-demo-bar-meta"> &middot; akses ke-' + i.count + ' dari ' + i.max + '</span> &middot; progres tidak disimpan</span>'
            + '<button type="button" class="au-demo-bar-btn" data-au="logout">Daftar / Masuk</button>'
            + '<button type="button" class="au-demo-bar-x" data-au="demo-dismiss" aria-label="Tutup pemberitahuan mode demo" title="Tutup">&times;</button>';
        if (root && root.classList) root.classList.add('has-demo-bar');
        if (old) { old.innerHTML = html; return; }
        try {
            var bar = document.createElement('div');
            bar.id = 'au-demo-bar'; bar.className = 'au-demo-bar'; bar.setAttribute('role', 'status');
            bar.innerHTML = html;
            document.body.appendChild(bar);
        } catch (e) { }
    }

    /* ---- Wajib ganti sandi bawaan (Superadmin) ---- */
    var DEFAULT_ADMIN_PW = 'superadmin123';
    var KNOWN_DEFAULT_PW = ['superadmin123', 'siswa123', 'guru123'];
    function askForceChange(ctx) {
        loggingIn = false;
        state.forceChange = ctx;
        state.message = null;
        msg('info', 'Sandi bawaan harus diganti sebelum melanjutkan.');
        renderLogin();
    }
    function renderForceChange() {
        var host = $('au-login');
        if (!host) return;
        host.innerHTML = ''
            + '<div class="au-wrap">'
            + '  <div class="au-brand"><div class="au-sub-brand">StarterLab &middot; Keamanan Akun</div></div>'
            + '  <div class="au-card">'
            + '    <h2 class="au-card-title">Ganti sandi bawaan</h2>'
            + '    <p class="au-card-sub">Demi keamanan, buat sandi baru (min. 8 karakter) sebelum masuk.</p>'
            + renderMessage()
            + '    <form class="au-form active" data-au-form="force-pw">'
            + '      <label class="au-field"><span>Sandi baru</span><input type="password" name="newPassword" autocomplete="new-password" required minlength="8"></label>'
            + '      <label class="au-field"><span>Ulangi sandi baru</span><input type="password" name="confirmPassword" autocomplete="new-password" required minlength="8"></label>'
            + '      <button type="submit" class="au-btn au-btn-block">Simpan &amp; Masuk</button>'
            + '      <button type="button" class="au-btn au-btn-ghost au-btn-block" data-au-cancel-force="1">Batal</button>'
            + '    </form>'
            + '  </div>'
            + '</div>';
    }
    function cancelForceChange() {
        state.forceChange = null; state.message = null;
        try { if (cloudOn()) CL.clearToken(); } catch (e) { }
        try { if (window.ProgressApi) window.ProgressApi.clearAuth(); } catch (e) { }
        try { if (P8) P8.authService.logout(); } catch (e) { }
        renderLogin();
    }
    function submitForceChange(form) {
        var ctx = state.forceChange;
        if (!ctx) { renderLogin(); return; }
        var np = form.newPassword.value || '', cp = form.confirmPassword.value || '';
        var bad = null;
        if (np.length < 8) bad = 'Sandi baru minimal 8 karakter.';
        else if (np !== cp) bad = 'Konfirmasi sandi tidak sama.';
        else if (np === ctx.oldPw || KNOWN_DEFAULT_PW.indexOf(np.toLowerCase()) !== -1) bad = 'Sandi baru tidak boleh sama dengan sandi bawaan atau sandi lama.';
        if (bad) { state.message = null; msg('error', bad); renderLogin(); return; }
        if (ctx.cloud) {
            CL.changePassword(ctx.oldPw, np).then(function (r) {
                if (r && r.ok !== false) { state.forceChange = null; state.message = null; enterCloud(ctx.user, function (t) { loggingIn = false; state.message = null; msg('error', t); renderLogin(); }); return; }
                state.message = null; msg('error', (r && r.message) || 'Gagal mengganti sandi. Coba lagi.'); renderLogin();
            });
            return;
        }
        function applyLocal() {
            var repo = P8.repositories.userRepository;
            var rec = repo.getById(ctx.localId);
            if (rec) { rec.salt = saltFor(rec.username); rec.passwordHash = hashPassword(np, rec.salt); repo.save(rec); }
            state.forceChange = null; state.message = null; loggingIn = false;
            setSession(ctx.localId);
        }
        if (!ctx.server) { applyLocal(); return; }
        var PA = window.ProgressApi;
        PA.changePassword(ctx.oldPw, np).then(function (res) {
            if (res && res.ok) { applyLocal(); return; }
            state.message = null;
            msg('error', (res && res.error && res.error.message) || 'Gagal mengganti sandi. Coba lagi.');
            renderLogin();
        });
    }

    /* ---------- mode cloud (Supabase) ---------- */
    function cloudLogin(username, password, portal, fail) {
        CL.login(username, password, portal).then(function (r) {
            if (!r || r.ok === false) { fail((r && r.message) || 'Gagal masuk.'); return; }
            if (r.mustChange) { askForceChange({ cloud: true, user: r.user, username: username, oldPw: password }); return; }
            enterCloud(r.user, fail);
        }, function () { fail('Tidak dapat terhubung ke server.'); });
    }
    /* Setelah token didapat: ambil progres + data (pull penuh) lalu buka sesi. */
    function enterCloud(user, fail) {
        var go = function () {
            var lu = P8.repositories.userRepository.getById(user.id);
            if (!lu) { try { CL.clearToken(); } catch (e) { } fail('Data akun belum dapat dimuat dari server. Coba lagi.'); return; }
            loggingIn = false; state.message = null; state.forceChange = null;
            setSession(lu.id);
        };
        CL.prefetchProgress().then(function () { return CL.pull(true); }).then(go, go);
    }
    function loadCloudSchools() {
        if (!cloudOn() || !isLoginMode() || portalName() === 'superadmin') return;
        CL.listSchools().then(function (list) {
            state.cloudSchools = list || [];
            if (!list) { msg('error', 'Daftar sekolah tidak dapat dimuat dari server. Periksa koneksi internet.'); }
            var host = $('au-login');
            var typing = false;
            try { typing = !!(host && host.querySelector && host.querySelector('input:focus,select:focus,textarea:focus')); } catch (e) { }
            if (!typing) renderLogin();
        });
    }
    function cloudRegister(role, name, username, email, password, orgId) {
        if (!orgId) { msg('error', role === 'INSTRUCTOR' ? 'Guru wajib memilih sekolah yang sudah aktif.' : 'Siswa wajib memilih sekolah asal.'); renderLogin(); return; }
        CL.registerUser(role, name, username, email, password, orgId).then(function (r) {
            if (!r || r.ok === false) { msg('error', (r && r.message) || 'Pendaftaran gagal.'); renderLogin(); return; }
            if (role === 'INSTRUCTOR' && r.status === 'ACTIVE') {
                loggingIn = true; msg(null, '');
                cloudLogin(username, password, 'general', function (t) { loggingIn = false; state.message = null; msg('error', t); renderLogin(); });
                return;
            }
            msg('ok', role === 'INSTRUCTOR' ? 'Pendaftaran guru terkirim. Menunggu persetujuan admin sekolah.'
                : 'Pendaftaran terkirim. Menunggu persetujuan admin sekolah (' + (r.orgName || '') + ').');
            state.tab = 'login'; renderLogin();
        }, function () { msg('error', 'Tidak dapat terhubung ke server.'); renderLogin(); });
    }

    var loggingIn = false;
    function submitLogin(form) {
        if (loggingIn) return;
        var username = (form.username.value || '').trim();
        var password = form.password.value || '';
        var portal = portalName();
        var btn = form.querySelector('button[type="submit"]');
        loggingIn = true;
        if (btn) { btn.disabled = true; btn.textContent = 'Memeriksa...'; }

        function fail(text) { loggingIn = false; state.message = null; msg('error', text); renderLogin(); }
        function finish(userId) { loggingIn = false; state.message = null; setSession(userId); }
        if (cloudOn()) { cloudLogin(username, password, portal, fail); return; }
        function localLogin() {
            var res = P8.authService.login(username, password);
            if (!res.success) { fail(res.error.message || 'Gagal masuk.'); return; }
            var lu = P8.repositories.userRepository.getById(res.data.user.id);
            if (!lu || !roleAllowed(lu.role)) {
                try { P8.authService.logout(); } catch (e) { }
                fail(wrongPortalMsg());
                return;
            }
            if (lu.role === 'ADMIN' && password === DEFAULT_ADMIN_PW) { askForceChange({ localId: lu.id, username: username, oldPw: password, server: false }); return; }
            finish(lu.id);
        }

        var PA = (typeof window !== 'undefined') ? window.ProgressApi : null;
        if (!PA || typeof PA.login !== 'function') { localLogin(); return; }
        /* hapus token lama: cegah progres tercatat atas nama akun sebelumnya */
        try { PA.clearAuth(); } catch (e) { }
        /* TUNGGU hasil login server sebelum pindah halaman (sebelumnya fire-and-forget:
           token bisa hilang karena halaman keburu berpindah). */
        PA.login(username, password, portal).then(function (r) {
            if (r && r.ok) {
                if (!roleAllowed(r.user.role)) { try { PA.clearAuth(); } catch (e) { } fail(wrongPortalMsg()); return; }
                var prev = P8.repositories.userRepository.list().filter(function (x) { return x.username === r.user.username; })[0];
                if (prev && (prev.status === 'INACTIVE' || prev.status === 'DISABLED')) {
                    try { PA.clearAuth(); } catch (e) { }
                    fail('Akun sedang dinonaktifkan. Hubungi guru atau Superadmin.');
                    return;
                }
                var lu = mirrorServerUser(r.user, password);
                if (r.user.mustChangePassword) { askForceChange({ localId: lu.id, username: username, oldPw: password, server: true }); return; }
                var next = function (me) { saveIdentityExtras(r.user, me); finish(lu.id); };
                try {
                    PA.init().then(next, function () { next(null); });
                } catch (e) { next(null); }
                return;
            }
            var code = r && r.error && r.error.code;
            if (code === 'WRONG_PORTAL' || code === 'ACCOUNT_DISABLED') {
                try { PA.clearAuth(); } catch (e) { }
                fail((r.error && r.error.message) || 'Gagal masuk.');
                return;
            }
            /* server tidak tersedia / akun hanya ada secara lokal -> verifikasi lokal */
            localLogin();
        }, function () { localLogin(); });
    }

    function submitRegister(form) {
        var role = form.role.value;
        state.registerRole = role;
        var name = (form.name.value || '').trim();
        var username = (form.username.value || '').trim();
        var email = (form.email.value || '').trim();
        var password = form.password.value || '';
        var orgId = form.organizationId.value || null;
        if (cloudOn()) { cloudRegister(role, name, username, email, password, orgId); return; }

        if (role === 'INSTRUCTOR') {
            if (!orgId) { msg('error', 'Guru wajib memilih sekolah yang sudah aktif.'); renderLogin(); return; }
            var org = P8.repositories.organizationRepository.getById(orgId);
            if (!org || org.status !== 'ACTIVE') { msg('error', 'Sekolah tidak aktif.'); renderLogin(); return; }
            if (P8.repositories.userRepository.list().some(function (x) { return x.username === username; })) {
                msg('error', 'Username sudah dipakai.'); renderLogin(); return;
            }
            var salt = saltFor(username);
            var u = P8.repositories.userRepository.save({
                role: 'INSTRUCTOR', name: name, username: username, email: email || null,
                organizationId: orgId, classIds: [], status: 'ACTIVE',
                passwordHash: hashPassword(password, salt), salt: salt
            });
            msg(null, '');
            setSession(u.id);
            return;
        }

        if (!orgId) { msg('error', 'Siswa wajib memilih sekolah asal.'); renderLogin(); return; }
        var studentOrg = P8.repositories.organizationRepository.getById(orgId);
        if (!studentOrg || studentOrg.status !== 'ACTIVE') { msg('error', 'Sekolah tidak aktif.'); renderLogin(); return; }

        var res = P8.authService.register({
            name: name, username: username, email: email || null, password: password,
            role: 'STUDENT', organizationId: orgId
        });
        if (!res.success) { msg('error', res.error.message || 'Pendaftaran gagal.'); renderLogin(); return; }
        var pending = P8.repositories.userRepository.getById(res.data.id);
        pending.status = 'PENDING';
        pending.requestedAt = Date.now();
        pending.registeredBy = 'PUBLIC';
        P8.repositories.userRepository.save(pending);
        msg('ok', 'Pendaftaran terkirim. Menunggu persetujuan admin sekolah (' + studentOrg.name + ').');
        state.tab = 'login';
        renderLogin();
    }

    function submitSchool(form) {
        var name = (form.name.value || '').trim();
        var type = 'SCHOOL';   /* pendaftaran publik tidak memilih jenis: otomatis Sekolah */
        var address = (form.address.value || '').trim();
        var adminName = (form.adminName.value || '').trim();
        var adminUsername = (form.adminUsername.value || '').trim();
        var adminPassword = form.adminPassword.value || '';
        if (cloudOn()) {
            CL.registerSchool(name, address, adminName, adminUsername, adminPassword).then(function (r) {
                if (!r || r.ok === false) { msg('error', (r && r.message) || 'Pendaftaran sekolah gagal.'); renderLogin(); return; }
                msg('ok', 'Pendaftaran sekolah "' + name + '" terkirim. Menunggu persetujuan Superadmin.');
                state.tab = 'login'; renderLogin();
            }, function () { msg('error', 'Tidak dapat terhubung ke server.'); renderLogin(); });
            return;
        }
        if (P8.repositories.organizationRepository.list().some(function (o) { return o.name === name; })) {
            msg('error', 'Nama sekolah sudah terdaftar.'); renderLogin(); return;
        }
        if (P8.repositories.userRepository.list().some(function (x) { return x.username === adminUsername; })) {
            msg('error', 'Username admin sudah dipakai.'); renderLogin(); return;
        }
        var salt = saltFor(adminUsername);
        P8.repositories.organizationRepository.save({
            name: name, type: type, address: address, status: 'PENDING', createdBy: 'PUBLIC',
            pendingAdmin: {
                name: adminName, username: adminUsername, email: null,
                passwordHash: hashPassword(adminPassword, salt), salt: salt
            }
        });
        msg('ok', 'Pendaftaran sekolah "' + name + '" terkirim. Menunggu persetujuan Superadmin.');
        state.tab = 'login';
        renderLogin();
    }

    function submitJoin(form) {
        var u = currentUser();
        if (!u) return;
        var code = (form.code.value || '').trim();
        if (cloudOn()) {
            CL.joinClass(code).then(function (r) {
                if (!r || r.ok === false) { msg('error', (r && r.message) || 'Kode tidak valid.'); renderDashboard(); return; }
                CL.pull(false).then(function () { msg('ok', 'Berhasil bergabung ke kelas ' + (r.className || '') + '.'); renderDashboard(); });
            }, function () { msg('error', 'Tidak dapat terhubung ke server.'); renderDashboard(); });
            return;
        }
        var res = P8.classService.joinWithCode(u, code);
        if (!res.success) msg('error', res.error.message || 'Kode tidak valid.'); else msg('ok', 'Berhasil bergabung ke kelas ' + res.data.class.name + '.');
        renderDashboard();
    }

    function submitCreateClass(form) {
        var u = currentUser();
        var res = P8.classService.createClass({
            name: (form.name.value || '').trim(),
            subject: (form.subject.value || '').trim(),
            joinPrefix: (form.joinPrefix.value || '').trim()
        }, u);
        if (!res.success) msg('error', res.error.message); else msg('ok', 'Kelas dibuat.');
        renderDashboard();
    }

    function submitAddStudent(form) {
        var u = currentUser();
        var res = P8.classService.addStudent(form.classId.value, form.studentId.value, u);
        if (!res.success) msg('error', res.error.message); else msg('ok', 'Siswa ditambahkan.');
        state.dash.addingStudent = null;
        renderDashboard();
    }

    function submitAddStudentUsername(form) {
        var u = currentUser();
        var username = (form.username.value || '').trim();
        var target = P8.repositories.userRepository.list().filter(function (x) { return x.username === username && x.role === 'STUDENT'; })[0];
        if (!target) { msg('error', 'Siswa dengan username tersebut tidak ditemukan.'); renderDashboard(); return; }
        var res = P8.classService.addStudent(form.classId.value, target.id, u);
        if (!res.success) msg('error', res.error.message); else msg('ok', 'Siswa ditambahkan.');
        state.dash.addingStudent = null;
        renderDashboard();
    }

    function submitCreateAssign(form) {
        var u = currentUser();
        var dueRaw = form.dueAt.value;
        var dueAt = dueRaw ? new Date(dueRaw + 'T23:59:59').getTime() : null;
        var res = P8.assignmentService.create({
            classId: form.classId.value,
            type: form.type.value,
            title: (form.title.value || '').trim(),
            contentId: (form.contentId.value || '').trim() || null,
            dueAt: dueAt,
            passingScore: form.passingScore.value ? Number(form.passingScore.value) : undefined
        }, u);
        if (!res.success) { msg('error', res.error.message); renderDashboard(); return; }
        var pub = P8.assignmentService.publish(res.data.id, u);
        if (!pub.success) msg('warn', 'Tugas dibuat tetapi gagal diterbitkan: ' + pub.error.message);
        else msg('ok', 'Tugas dibuat dan diterbitkan.');
        renderDashboard();
    }

    function onChange(e) {
        var flt = e.target && e.target.getAttribute ? e.target.getAttribute('data-au-filter') : null;
        if (flt) {
            if (flt === 'org') state.dash.fOrg = e.target.value || '';
            else if (flt === 'class') state.dash.fClass = e.target.value || '';
            renderDashboard();
            return;
        }
        var roleSel = e.target;
        if (roleSel && roleSel.getAttribute && roleSel.getAttribute('data-au-role') != null) {
            state.registerRole = roleSel.value;
        }
    }

    function onInput(e) {
        var t = e.target;
        if (!t || !t.getAttribute || t.getAttribute('data-au-search') == null) return;
        state.dash.q = t.value || '';
        var pos = typeof t.selectionStart === 'number' ? t.selectionStart : null;
        renderDashboard();
        try {
            var again = document.querySelector('[data-au-search]');
            if (again) { again.focus(); if (pos != null && again.setSelectionRange) again.setSelectionRange(pos, pos); }
        } catch (err) { /* noop */ }
    }

    function onHash() {
        if ((location.hash || '').indexOf('#/dashboard') === 0) renderDashboard();
    }

    function wire() {
        document.addEventListener('click', onClick);
        document.addEventListener('submit', onSubmit);
        document.addEventListener('change', onChange);
        document.addEventListener('input', onInput);
        window.addEventListener('hashchange', onHash);
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            var m = document.querySelector('.au-acc-menu');
            if (m && !m.hidden) { closeAccMenu(); var b = document.querySelector('.au-acc-btn'); if (b) b.focus(); }
        });
    }

    function closeAccMenu() {
        var m = document.querySelector && document.querySelector('.au-acc-menu');
        var b = document.querySelector && document.querySelector('.au-acc-btn');
        if (m && !m.hidden) m.hidden = true;
        if (b) b.setAttribute('aria-expanded', 'false');
    }
    function onClick(e) {
        var mb = closestAttr(e.target, 'data-au-menu');
        if (mb) {
            var menu = mb.parentNode && mb.parentNode.querySelector('.au-acc-menu');
            if (menu) {
                var open = menu.hidden;
                menu.hidden = !open;
                mb.setAttribute('aria-expanded', open ? 'true' : 'false');
            }
            return;
        }
        closeAccMenu();
        var pw = closestAttr(e.target, 'data-au-pw');
        if (pw) {
            var inp = pw.parentNode && pw.parentNode.querySelector('input');
            if (inp) {
                var show = inp.type === 'password';
                inp.type = show ? 'text' : 'password';
                pw.textContent = show ? 'Sembunyi' : 'Lihat';
                pw.setAttribute('aria-pressed', show ? 'true' : 'false');
                pw.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
            }
            return;
        }
        if (closestAttr(e.target, 'data-au-demo')) { startDemo(); return; }
        if (closestAttr(e.target, 'data-au-cancel-force')) { cancelForceChange(); return; }
        var tab = closestAttr(e.target, 'data-au-tab');
        if (tab) { state.tab = tab.getAttribute('data-au-tab'); state.message = null; renderLogin(); return; }
        var au = closestAttr(e.target, 'data-au');
        if (au) { handleAu(au.getAttribute('data-au'), au); return; }
        var act = closestAttr(e.target, 'data-au-act');
        if (act) { handleAct(act.getAttribute('data-au-act'), act); return; }
    }

    function hookNav() {
        var prev = window.navigateTo;
        window.navigateTo = function (page) {
            if (typeof prev === 'function') prev(page);
            if (page === 'dashboard') renderDashboard();
        };
    }

    /* Data lokal lama (sebelum cloud) disimpan sebagai cadangan lalu dikosongkan sekali saja:
       id lama berurutan (USER_001, ...) dan bisa bentrok dengan data di server. */
    function quarantineLegacy() {
        try {
            if (localStorage.getItem(LS_CLOUD_MIGRATED)) return;
            var has = ENTITY_STORES.some(function (e) { return Object.keys(db[e] || {}).length > 0; });
            if (has) { try { localStorage.setItem(LS_LEGACY_BACKUP, JSON.stringify(db)); } catch (e2) { } }
            ENTITY_STORES.forEach(function (e) { Object.keys(db[e]).forEach(function (k) { delete db[e][k]; }); });
            ENTITY_LISTS.forEach(function (e) { db[e].length = 0; });
            persist();
            localStorage.setItem(LS_CLOUD_MIGRATED, String(Date.now()));
        } catch (e) { /* noop */ }
    }
    function cloudRefresh() {
        if (isLoginMode() || !state.session) return;
        var d = state.dash || {};
        var formOpen = d.addUser || d.editUser || d.editClass || d.editAssign || d.editSelf || d.addingStudent || d.grading || d.reject || d.regrade;
        var typing = false;
        try { var ae = document.activeElement; typing = !!(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || '')); } catch (e) { }
        if (formOpen || typing) { state.cloudStale = true; return; }   /* jangan merusak formulir yang sedang diisi */
        state.cloudStale = false;
        try { renderAccount(); renderDashboard(); announceIdentity(); } catch (e) { /* noop */ }
    }
    function cloudAttach() {
        CL.attach({
            getDb: function () { return db; },
            persistLocal: function () { writeJSON(LS_DB, db); },
            clearDb: function () {
                ENTITY_STORES.forEach(function (e) { Object.keys(db[e] || {}).forEach(function (k) { delete db[e][k]; }); });
                ENTITY_LISTS.forEach(function (e) { if (db[e]) db[e].length = 0; });
                writeJSON(LS_DB, db);
            },
            dataKeys: DATA_KEYS,
            currentOwner: function () { var u = currentUser(); return u && !u.isDemo ? ownerOf(u) : null; },
            currentRole: function () { var u = currentUser(); return u ? u.role : null; },
            stashWrite: function (username, data) {
                var owner = 'u:' + String(username || '').toLowerCase();
                if (localStorage.getItem(LS_OWNER) === owner) return false;
                var nv = JSON.stringify(data || {});
                if (localStorage.getItem(LS_STASH + owner) === nv) return false;
                localStorage.setItem(LS_STASH + owner, nv);
                return true;
            },
            wipeLocal: function () {
                try {
                    var del = [];
                    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(LS_STASH) === 0) del.push(k); }
                    del.forEach(function (k) { localStorage.removeItem(k); });
                    DATA_KEYS.forEach(function (k) { localStorage.removeItem(k); });
                    localStorage.removeItem(LS_OWNER); localStorage.removeItem(LS_IDENT);
                } catch (e) { /* noop */ }
            },
            onRemoteChange: cloudRefresh,
            onReject: function (list) {
                var txt = list.slice(0, 3).map(function (r) { return (r.text || r.reason); }).join('; ');
                msg('error', 'Sebagian perubahan ditolak server (' + txt + '). Tampilan dikembalikan ke data server.');
                state.cloudStale = false;
                try { renderDashboard(); } catch (e) { }
            },
            onAuthLost: function () {
                var wasAdmin = !!(state.session && state.session.role === 'ADMIN');
                state.session = null; clearSession();
                try { sessionStorage.setItem(SS_FLASH, 'Sesi berakhir. Silakan masuk lagi.'); } catch (e) { }
                try { location.href = wasAdmin ? SUPERADMIN_URL : LOGIN_URL; } catch (e) { }
            }
        });
    }

    function init() {
        if (!P8) return;
        installStore();
        if (cloudOn()) { quarantineLegacy(); cloudAttach(); }
        primeSequences();
        ensureSeed();
        restoreSession();
        if (cloudOn() && isLoginMode()) {
            try { var fl = sessionStorage.getItem(SS_FLASH); if (fl) { sessionStorage.removeItem(SS_FLASH); msg('info', fl); } } catch (e) { }
            loadCloudSchools();
        }
        if (cloudOn() && !isLoginMode() && state.session && !state.session.demo) { try { CL.start(); } catch (e) { /* noop */ } }
        if (isLoginMode()) {
            if (!state.session) { try { if (window.ProgressApi) window.ProgressApi.clearAuth(); } catch (e) { /* noop */ } }
            renderLogin();
        }
        if ($('au-account') || $('au-dashboard')) { renderAccount(); renderDemoBar(); renderDashboard(); }
        wire();
        try { var cu0 = currentUser(); if (cu0 && cu0.role === 'ADMIN') loadServerUsers(false); } catch (e) { /* noop */ }
        hookNav();
        if (!isLoginMode()) announceIdentity();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AuthUI = {
        login: submitLogin,
        changeDefaultPassword: submitForceChange,
        startDemo: startDemo,
        demoInfo: demoInfo,
        logout: doLogout,
        refresh: renderDashboard,
        currentUser: currentUser,
        identity: identity,
        renderLogin: renderLogin,
        setTab: function (t) { state.tab = t; renderLogin(); },
        approveSchool: approveSchool,
        rejectSchool: rejectSchool,
        approveStudent: function (id) { return approveStudent(id, currentUser()); },
        rejectStudent: function (id) { return rejectStudent(id, currentUser()); },
        resetDemoData: function () {
            removeKey(LS_DB);
            clearSession();
            try { location.reload(); } catch (e) { }
        }
    };
})();
