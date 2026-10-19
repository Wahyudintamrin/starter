/* ============================================================
   PHASE 5 — LEARNING & ASSESSMENT LABORATORY (engine + UI)
   ------------------------------------------------------------
   Lapisan pembelajaran di atas arsitektur Phase 1–4:
   satu simulation state (Sim/Phase2), satu measurement engine
   (Phase3), satu diagnostic engine (Phase4), satu data/
   progress architecture (localStorage, versioned).
   ============================================================ */
'use strict';

(() => {
    const CFG = window.LEARNING_CONFIG || {};
    const MODULES = window.LEARNING_MODULES || [];
    const LESSON_LIST = window.LEARNING_LESSONS || [];
    const QUESTION_BANK = window.LEARNING_QUESTIONS || [];
    const JOB_SHEETS = window.LEARNING_JOB_SHEETS || [];
    const COMPONENT_INFO = window.LEARNING_COMPONENT_INFO || {};
    const PATH_LEVELS = window.LEARNING_PATH_LEVELS || [];
    const ACH_DEFS = CFG.achievements || [];
    const SETTINGS_DEFAULT = CFG.assessmentSettings || {};

    const VERSION = CFG.APP_DATA_VERSION || 1;
    const K = CFG.storagePrefix || 'p5';
    const key = (n) => K + n;

    const $ = (id) => {
        try { return document.getElementById(id); } catch (e) { return null; }
    };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const safeText = (v) => v === null || v === undefined ? '' : String(v);
    function esc(s) {
        return safeText(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    const now = () => Date.now();

    /* ============================================================
       STORAGE (error-proof — §63)
       ============================================================ */
    let storageOk = true;
    function read(keyName, fallback) {
        try {
            const raw = localStorage.getItem(keyName);
            if (raw === null || raw === undefined) return fallback;
            const v = JSON.parse(raw);
            return v === undefined || v === null ? fallback : v;
        } catch (e) { storageOk = false; return fallback; }
    }
    function write(keyName, value) {
        try { localStorage.setItem(keyName, JSON.stringify(value)); return true; }
        catch (e) { storageOk = false; return false; }
    }
    function storageWarning() {
        return storageOk ? '' : '<div class="p5-warn" role="alert">Unable to save progress locally. Your current session can continue, but progress may not persist.</div>';
    }

    /* ============================================================
       SETTINGS & PROFILE
       ============================================================ */
    let settings = Object.assign({}, SETTINGS_DEFAULT);
    (function loadSettings() {
        const s = read(CFG.settingsKey, null);
        if (s && typeof s === 'object') settings = Object.assign({}, SETTINGS_DEFAULT, s);
    })();
    function saveSettings() { write(CFG.settingsKey, settings); }

    let profile = { name: '', klass: '', studentId: '' };
    (function loadProfile() {
        const p = read(CFG.studentProfileKey, null);
        if (p && typeof p === 'object') profile = Object.assign({ name: '', klass: '', studentId: '' }, p);
    })();
    function saveProfile(p) {
        if (!p) return profile;
        profile = Object.assign({}, profile, {
            name: safeText(p.name || '').slice(0, 80),
            klass: safeText(p.klass || '').slice(0, 60),
            studentId: safeText(p.studentId || '').slice(0, 40),
        });
        write(CFG.studentProfileKey, profile);
        syncIdentity();   // nilai dari akun yang sedang masuk selalu menang atas isian manual
        renderProgressPage();
        return profile;
    }
    // Identitas siswa mengikuti AKUN (AuthUI.identity()). Field yang tersedia dari akun
    // dikunci; tanpa akun (tamu/offline murni) profil tetap bisa diisi manual.
    function syncIdentity() {
        const A = (typeof window !== 'undefined') ? window.AuthUI : null;
        const id = (A && typeof A.identity === 'function') ? A.identity() : null;
        if (!id) return null;
        const next = Object.assign({}, profile);
        if (id.name) next.name = id.name;
        if (id.kelas) next.klass = id.kelas;
        if (id.nis) next.studentId = id.nis;
        if (next.name !== profile.name || next.klass !== profile.klass || next.studentId !== profile.studentId) {
            profile = next;
            write(CFG.studentProfileKey, profile);
        }
        return id;
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('starter:identity', () => {
            try { syncIdentity(); renderDashboard(); renderProgressPage(); } catch (e) { /* noop */ }
        });
    }

    /* ============================================================
       PROGRESS STATE
       ============================================================ */
    function emptyProgress() {
        return {
            openAll: false,
            modules: {},
            lessons: {},
            objectives: {},
            practices: {},
            assessments: { count: 0, best: null },
            jobSheets: {},
            diagnostics: {},
            record: [],
        };
    }
    const P = emptyProgress();
    (function loadProgress() {
        const d = read(CFG.progressKey, null);
        if (d && typeof d === 'object') Object.assign(P, emptyProgress(), d);
    })();

    const ASSESSMENT_RESULTS = read(CFG.assessmentResultsKey, []);
    const JOB_RESULTS = read(CFG.jobSheetResultsKey, {});
    const DIAG_HISTORY = read(CFG.diagnosticHistoryKey, []);
    const ACH = read(CFG.achievementsKey, {}); // { id: { unlockedAt } }

    function persist() { write(CFG.progressKey, P); write(CFG.assessmentResultsKey, ASSESSMENT_RESULTS); write(CFG.jobSheetResultsKey, JOB_RESULTS); write(CFG.diagnosticHistoryKey, DIAG_HISTORY); write(CFG.achievementsKey, ACH); }

    function recordEvent(type, data) {
        P.record.push({ timestamp: now(), type, data: data || {} });
        if (P.record.length > 400) P.record = P.record.slice(-400);
        if (data && data.moduleId && !P.modules[data.moduleId]) P.modules[data.moduleId] = { started: false, completed: false, lessonsDone: [] };
        persist();
    }

    /* ============================================================
       MODULES & PREREQUISITES (§41, §42)
       ============================================================ */
    function getModules() { return MODULES.slice(); }
    function getModule(id) { return MODULES.find(m => m.id === id) || null; }
    function getModuleIndex(id) { return MODULES.findIndex(m => m.id === id); }
    function modState(id) {
        if (!P.modules[id]) P.modules[id] = { started: false, completed: false, lessonsDone: [] };
        return P.modules[id];
    }
    function getPracticesFor(id) { return (getModule(id) || {}).practices || []; }
    function getJobSheetsFor(id) { return (getModule(id) || {}).jobSheets || []; }
    function getAssessmentsFor(id) { return (getModule(id) || {}).assessments || []; }

    function isModuleUnlocked(id) {
        if (!getModule(id)) return false;
        if (settings.openAllModules || P.openAll) return true;
        const m = getModule(id);
        return (m.prerequisites || []).every(pid => {
            const s = modState(pid);
            return s.completed && lessonCompletion(pid) >= 1;
        });
    }
    function setOpenAll(on) { settings.openAllModules = !!on; saveSettings(); persist(); return settings.openAllModules; }
    function isOpenAll() { return !!settings.openAllModules || !!P.openAll; }
    function modulesUnlocked() { return MODULES.map(m => ({ id: m.id, unlocked: isModuleUnlocked(m.id) })); }

    function startModule(id) {
        const m = getModule(id);
        if (!m) return { ok: false, reason: 'NO_MODULE' };
        if (!isModuleUnlocked(id)) return { ok: false, reason: 'LOCKED', prerequisites: m.prerequisites };
        const st = modState(id);
        if (!st.started) { st.started = true; recordEvent('MODULE_STARTED', { moduleId: id }); }
        persist();
        renderModule(id);
        return { ok: true, module: m, progress: moduleProgress(id) };
    }

    function moduleLessons(m) { return (m.lessons || []); }
    function lessonCompletion(id) {
        const m = getModule(id);
        if (!m) return 0;
        const list = moduleLessons(m);
        if (!list.length) return 0;
        const done = list.filter(lid => { const s = P.lessons[lid]; return s && s.completed; }).length;
        return done / list.length;
    }
    function moduleProgress(id) {
        const m = getModule(id);
        if (!m) return { started: false, completed: false, percent: 0, lessonsDone: 0, lessonsTotal: 0, objectivesPracticed: 0, objectivesTotal: 0 };
        const list = moduleLessons(m);
        const lessonsDone = list.filter(lid => { const s = P.lessons[lid]; return s && s.completed; }).length;
        const objs = m.objectives || [];
        const objStatus = objs.map(o => goalStatus(id, o.id));
        const practiced = objStatus.filter(s => s === 'PRACTICED' || s === 'MASTERED').length;
        const mastered = objStatus.filter(s => s === 'MASTERED').length;
        const completed = lessonsDone === list.length && list.length > 0;
        return { started: !!modState(id).started, completed, percent: Math.round((lessonsDone / (list.length || 1)) * 100), lessonsDone, lessonsTotal: list.length, objectivesPracticed: practiced, objectivesTotal: objs.length, objectivesMastered: mastered };
    }

    /* ============================================================
       LESSONS (§7, §45)
       ============================================================ */
    function getLesson(id) { return LESSON_LIST.find(l => l.id === id) || null; }
    function getLessonSections(id) { const l = getLesson(id); return l ? l.sections : []; }
    function startLesson(id) {
        const l = getLesson(id);
        if (!l) return { ok: false, reason: 'NO_LESSON' };
        if (!P.lessons[id]) P.lessons[id] = { started: false, completed: false, timeMs: 0, lastStartedAt: now() };
        if (!P.lessons[id].started) {
            P.lessons[id].started = true;
            P.lessons[id].lastStartedAt = now();
            recordEvent('LESSON_STARTED', { moduleId: l.moduleId, lessonId: id });
        } else {
            P.lessons[id].lastStartedAt = now();
        }
        // objectif → IN_PROGRESS
        (l.objectives || []).forEach(oid => setGoalStatus(l.moduleId, oid, 'IN_PROGRESS'));
        persist();
        return { ok: true, lesson: l };
    }
    function completeLesson(id) {
        const l = getLesson(id);
        if (!l) return { ok: false, reason: 'NO_LESSON' };
        if (!P.lessons[id]) startLesson(id);
        const rec = P.lessons[id];
        if (rec.lastStartedAt) rec.timeMs = (rec.timeMs || 0) + Math.max(0, now() - rec.lastStartedAt);
        rec.lastStartedAt = null;
        if (!rec.completed) {
            rec.completed = true;
            const ms = modState(l.moduleId);
            if (ms.lessonsDone.indexOf(id) < 0) ms.lessonsDone.push(id);
            recordEvent('LESSON_COMPLETED', { moduleId: l.moduleId, lessonId: id });
            (l.objectives || []).forEach(oid => setGoalStatus(l.moduleId, oid, 'PRACTICED'));
            checkAchievements();
        }
        persist();
        return { ok: true, lesson: l, moduleProgress: moduleProgress(l.moduleId) };
    }
    function lessonBooks(m) { return getLesson; }

    /* ============================================================
       OBJECTIVES / MASTERY (§43, §44)
       ============================================================ */
    const GOAL_NONE = 'NOT_STARTED', GOAL_PROG = 'IN_PROGRESS', GOAL_PRAC = 'PRACTICED', GOAL_MASTER = 'MASTERED';
    function setGoalStatus(moduleId, oid, status) {
        if (!P.objectives[moduleId]) P.objectives[moduleId] = {};
        const cur = P.objectives[moduleId][oid] || GOAL_NONE;
        const rank = { NOT_STARTED: 0, IN_PROGRESS: 1, PRACTICED: 2, MASTERED: 3 };
        if (rank[status] > rank[cur]) P.objectives[moduleId][oid] = status;
    }
    function goalStatus(moduleId, oid) {
        return (P.objectives[moduleId] && P.objectives[moduleId][oid]) || GOAL_NONE;
    }
    function markObjectiveMastered(moduleId, oid) { setGoalStatus(moduleId, oid, GOAL_MASTER); persist(); }
    function getObjectives(moduleId) {
        const m = getModule(moduleId);
        if (!m) return [];
        return (m.objectives || []).map(o => ({ id: o.id, text: o.text, status: goalStatus(moduleId, o.id) }));
    }
    function computeMastery(moduleId) {
        const m = getModule(moduleId);
        if (!m) return { status: 'NOT_STARTED', percent: 0 };
        const objs = getObjectives(moduleId);
        const lessons = lessonCompletion(moduleId);
        const mastered = objs.filter(o => o.status === 'MASTERED').length;
        const practiced = objs.filter(o => o.status === 'PRACTICED' || o.status === 'MASTERED').length;
        const asmBest = bestAssessmentFor(moduleId);
        const pr = practiceBest(moduleId);
        const score = Math.round(
            lessons * 35 +
            (objs.length ? (practiced / objs.length) * 35 : 35) +
            ((asmBest !== null ? asmBest : 0) / 100) * 20 +
            (pr !== null ? pr / 100 : 0) * 10
        );
        let status = GOAL_NONE;
        if (score >= 90 && asmBest !== null && asmBest >= (CFG.mastery || {}).assessmentThreshold) status = GOAL_MASTER;
        else if (score >= 40) status = GOAL_PRAC;
        else if (score > 0) status = GOAL_PROG;
        return { status, percent: score, lessons, objectives: { mastered, practiced, total: objs.length }, assessmentBest: asmBest, practiceBest: pr };
    }

    /* ============================================================
       PRACTICES (§10, §11)
       ============================================================ */
    let activePractice = null; // { id, startedAt, startRecordCount, records, level, sequence, stepResults }
    let practiceStartRecordCount = 0;

    function practiceDefs() {
        return [
            {
                id: 'pract-basic', moduleId: 'starter-basic', title: 'Pengukuran Tegangan Battery', level: 'LEARN',
                steps: [
                    { instruction: 'Buka Virtual Multimeter (klik tombol MULTI di toolbar).', help: 'Buka lab multimeter (MULTI).', validate: { type: 'api' } },
                    { instruction: 'Set multitjabatan mode V DC.', help: 'Klik tombol V DC pada multimeter.', validate: { type: 'mode', value: 'V' } },
                    { instruction: 'Pasang probe merah ke batteryPositive.', help: 'Pilih RED lalu klik titik batteryPositive.', validate: { type: 'probe', color: 'red', node: 'batteryPositive' } },
                    { instruction: 'Pasang probe hitam ke batteryNegative.', help: 'Pilih COM lalu klik titik batteryNegative.', validate: { type: 'probe', color: 'black', node: 'batteryNegative' } },
                    { instruction: 'Tekan MEASURE. Pembacaan harus ≈ 12,6 V.', help: 'Tekan tombol MEASURE pada multimeter.', validate: { type: 'measured', mode: 'V', min: 12.4, max: 12.8 } },
                ],
            },
            {
                id: 'pract-circuit', moduleId: 'starter-circuit', title: 'Pemeriksaan Circuit (V + Continuity)', level: 'LEARN',
                steps: [
                    { instruction: 'Mode V DC.', validate: { type: 'mode', value: 'V' } },
                    { instruction: 'Probe merah → fuseOutput, hitam → batteryNegative, lalu MEASURE (baca ±12,6 V).', validate: { type: 'measured', mode: 'V', red: 'fuseOutput', black: 'batteryNegative', min: 12.4, max: 12.8 } },
                    { instruction: 'Matikan sistem, set mode CONTINUITY.', help: 'Sistem mati: ignition OFF.', validate: { type: 'mode', value: 'CONT' } },
                    { instruction: 'Probe fuseInput → fuseOutput, tekan MEASURE (harus berbunyi, ≤ 10 Ω).', validate: { type: 'measured', mode: 'CONT', red: 'fuseInput', black: 'fuseOutput', max: 10 } },
                ],
            },
            {
                id: 'pract-sequence', moduleId: 'starter-principles', title: 'Urutan Kerja Starter (Ordering)', level: 'LEARN',
                items: ['Ignition switch ke START', 'Relay aktif', 'Solenoid menarik pinion', 'Pinion menyambung ring gear', 'Starter motor berputar', 'Flywheel memutar crankshaft'],
                correctOrder: [0, 1, 2, 3, 4, 5],
                steps: [],
            },
            {
                id: 'pract-drop', moduleId: 'starter-measurement', title: 'Voltage Drop Test', level: 'LEARN',
                steps: [
                    { instruction: 'Set mode V DC.', help: 'Klik tombol V DC pada multimeter.', validate: { type: 'mode', value: 'V' } },
                    { instruction: 'Pasang probe merah ke batteryPositive, probe hitam ke batteryNegative.', help: 'RED ke batteryPositive, COM ke batteryNegative.', validate: { type: 'probe', color: 'red', node: 'batteryPositive' } },
                    { instruction: 'Tekan MEASURE — baca tegangan battery ≈12.6 V.', validate: { type: 'measured', mode: 'V', min: 12.4, max: 12.8 } },
                    { instruction: 'Pasang probe merah ke fuseOutput, hitam ke batteryNegative, lalu MEASURE.', validate: { type: 'measured', mode: 'V', red: 'fuseOutput', black: 'batteryNegative', min: 12.4, max: 12.8 } },
                    { instruction: 'Set ignition START, pasang probe merah ke starterPositive, hitam ke starterGround, lalu MEASURE — hitung voltage drop.', help: 'Mulai sistem ke START, ukur drop dari starter.', validate: { type: 'measured', mode: 'V', min: 0, max: 1.0 } },
                    { instruction: 'Pasang probe merah ke starterGround, hitam ke engineGround — ukur ground drop.', validate: { type: 'measured', mode: 'V', red: 'starterGround', black: 'engineGround', min: 0, max: 0.5 } },
                ],
            },
            {
                id: 'pract-diag', moduleId: 'starter-diagnosis', title: 'Diagnostic Flow Lengkap', level: 'LEARN',
                steps: [
                    { instruction: 'Buka lab diagnosis (Phase 4).', validate: { type: 'api' } },
                    { instruction: 'Mulai kasus diagnosis (startDiagnosticCase atau randomCase).', validate: { type: 'diag', check: 'active' } },
                    { instruction: 'Lakukan inspeksi, ukur, dan tentukan diagnosis.', validate: { type: 'diag', check: 'correct' } },
                    { instruction: 'Lakukan perbaikan (repair).', validate: { type: 'repair', any: true } },
                    { instruction: 'Verifikasi perbaikan berhasil.', validate: { type: 'verify' } },
                ],
            },
        ];
    }
    function buildSequenceSteps() {
        const d = practiceDefs().find(p => p.id === 'pract-sequence');
        if (d && !d.steps.length) {
            d.steps = (d.items || []).map((item, i) => ({
                instruction: 'Urutan ke-' + (i + 1) + ': pilih "' + item + '".',
                validate: { type: 'order', index: i },
            }));
        }
        return d;
    }
    function getPractice(id) {
        const p = practiceDefs().find(x => x.id === id);
        if (p && p.id === 'pract-sequence') return buildSequenceSteps();
        return p || null;
    }
    function getPracticeSteps(id) { const p = getPractice(id); return p ? p.steps : []; }

    function startPractice(id) {
        const p = getPractice(id);
        if (!p) return { ok: false, reason: 'NO_PRACTICE' };
        practiceStartRecordCount = (window.Phase3 && window.Phase3.getRecords ? window.Phase3.getRecords().length : 0);
        activePractice = { id, startedAt: now(), startRecordCount: practiceStartRecordCount, records: [], level: settings.practiceLevel || 'LEARN', sequence: null, stepResults: {} };
        recordEvent('PRACTICE_STARTED', { practiceId: id, moduleId: p.moduleId, level: activePractice.level });
        persist();
        return { ok: true, practice: p, step: 0 };
    }
    function setPracticeLevel(level) {
        if (['LEARN', 'PRACTICE', 'ASSESSMENT'].indexOf(level) < 0) level = 'LEARN';
        settings.practiceLevel = level; saveSettings();
        return settings.practiceLevel;
    }
    function recordsSince(practiceStart) {
        if (!window.Phase3 || !window.Phase3.getRecords) return [];
        return window.Phase3.getRecords().slice(practiceStart || 0);
    }
    function lastNewRecord() {
        const rs = recordsSince(activePractice ? activePractice.startRecordCount : 0);
        return rs.length ? rs[rs.length - 1] : null;
    }
    function validateStep(p) {
        const v = p.validate || {};
        const type = v.type;
        if (type === 'api') return !!window.Phase3;
        if (type === 'mode') {
            const P3 = window.Phase3 && window.Phase3.state ? window.Phase3.state() : null;
            return !!(P3 && P3.mode === v.value);
        }
        if (type === 'probe') {
            const P3 = window.Phase3 && window.Phase3.state ? window.Phase3.state() : null;
            if (!P3 || !P3.probes) return false;
            return P3.probes[v.color] === v.node;
        }
        if (type === 'measured') {
            const r = lastNewRecord();
            if (!r) return false;
            if (v.red && r.redProbe !== v.red) return false;
            if (v.black && r.blackProbe !== v.black) return false;
            if (r.ol) return false;
            if (v.mode && r.unit && r.unit.indexOf(v.mode) < 0 && !((v.mode === 'V') && /^V/.test(r.unit))) {
                const m = v.mode;
                const unit = r.unit || '';
                if (!(unit === m || unit.indexOf(m) === 0 || (m === 'V' && unit.indexOf('V') === 0) || (m === 'CONT' && unit.indexOf('Ω') === 0))) return false;
            }
            const val = r.value;
            if (typeof val !== 'number') return false;
            if (v.min !== undefined && val < v.min) return false;
            if (v.max !== undefined && val > v.max) return false;
            return true;
        }
        if (type === 'order') {
            return !!(activePractice && activePractice.sequence && activePractice.sequence[v.index] === (v.index));
        }
        if (type === 'diag') {
            const st = window.Phase4 && window.Phase4.getDiagnosticState ? window.Phase4.getDiagnosticState() : null;
            if (!st) return false;
            if (v.check === 'active') return st.active === true;
            if (v.check === 'correct') return st.diagnosisCorrect === true;
            return false;
        }
        if (type === 'repair') {
            const st = window.Phase4 && window.Phase4.getDiagnosticState ? window.Phase4.getDiagnosticState() : null;
            if (!st) return false;
            if (v.any === true) return !!st.repairPerformed;
            return st.repairPerformed === v.id;
        }
        if (type === 'verify') {
            const st = window.Phase4 && window.Phase4.getDiagnosticState ? window.Phase4.getDiagnosticState() : null;
            return !!(st && st.verificationPassed === true);
        }
        return false;
    }
    // Untuk PRACTICE order: siswa membangun urutan lewat UI.
    function setPracticeSequence(practiceId, seq) {
        const p = getPractice(practiceId);
        if (!p || p.id !== 'pract-sequence') return { ok: false };
        if (!activePractice) startPractice(practiceId);
        if (activePractice) activePractice.sequence = (seq || []).map(Number);
        return { ok: true, sequence: activePractice ? activePractice.sequence : [] };
    }
    function checkPracticeStep(practiceId, stepIndex) {
        const p = getPractice(practiceId);
        if (!p) return { ok: false, reason: 'NO_PRACTICE' };
        if (activePractice && activePractice.id !== practiceId) startPractice(practiceId);
        if (stepIndex < 0) stepIndex = 0;
        const st = p.steps[stepIndex];
        if (!st) return { ok: false, reason: 'NO_STEP' };
        const ok = validateStep(st);
        if (activePractice) {
            activePractice.stepResults[stepIndex] = !!ok;
            activePractice.records = recordsSince(activePractice.startRecordCount);
        }
        if (ok) {
            if (activePractice) activePractice.step = stepIndex + 1;
            // mark objective practiced
            const m = p.moduleId;
            const objective = (getModule(m) || {}).objectives || [];
            if (objective[stepIndex] && objective[stepIndex].id) setGoalStatus(m, objective[stepIndex].id, 'PRACTICED');
            persist();
        }
        // NB: stepResults bagi urutan → practice selesai bila semua step lolos
        if (ok && stepIndex === p.steps.length - 1) {
            const whole = (p.steps || []).every((_, i) => activePractice && activePractice.stepResults[i]);
            if (whole) completePractice(practiceId);
        }
        return { ok, step: stepIndex, total: p.steps.length, help: (activePractice && activePractice.level === 'LEARN') ? (st.help || '') : '' };
    }
    function checkAllSteps(practiceId) {
        const p = getPractice(practiceId);
        if (!p) return { done: false, index: 0 };
        // temukan langkah pertama yang belum lolos
        for (let i = 0; i < p.steps.length; i++) {
            if (!(activePractice && activePractice.stepResults[i])) return { done: false, index: i };
        }
        return { done: true, index: p.steps.length - 1 };
    }
    function completePractice(practiceId) {
        const p = getPractice(practiceId);
        if (!p) return { ok: false, reason: 'NO_PRACTICE' };
        const stepResults = activePractice && activePractice.id === practiceId ? activePractice.stepResults : {};
        const total = p.steps.length || 1;
        const passed = (p.steps || []).filter((_, i) => stepResults[i]).length;
        const score = Math.round((passed / total) * 100);
        if (!P.practices[practiceId]) P.practices[practiceId] = { attempts: 0, best: 0, completed: false, doneIds: [] };
        const pr = P.practices[practiceId];
        pr.attempts++;
        pr.best = Math.max(pr.best || 0, score);
        if (passed >= total) {
            pr.completed = true;
            recordEvent('PRACTICE_COMPLETED', { practiceId, moduleId: p.moduleId, score });
        }
        persist();
        checkAchievements();
        return { ok: true, score, passed, total, practiceId, completed: passed >= total };
    }
    function practiceBest(moduleId) {
        const ids = getPracticesFor(moduleId);
        let best = null;
        ids.forEach(id => { const pr = P.practices[id]; if (pr && typeof pr.best === 'number') best = Math.max(best === null ? -1 : best, pr.best); });
        return best;
    }

    /* ============================================================
       JOB SHEETS (§12–17)
       ============================================================ */
    function getJobSheets() { return JOB_SHEETS.slice(); }
    function getJobSheet(id) { return JOB_SHEETS.find(js => js.id === id) || null; }
    function startJobSheet(id) {
        const js = getJobSheet(id);
        if (!js) return { ok: false, reason: 'NO_JOB_SHEET' };
        if (!JOB_RESULTS[id]) JOB_RESULTS[id] = { jobSheetId: id, measurements: [], observations: '', answers: [], conclusion: '', completedAt: null, startedAt: now(), recordStart: (window.Phase3 && window.Phase3.getRecords ? window.Phase3.getRecords().length : 0) };
        if (!P.jobSheets[id]) P.jobSheets[id] = { started: false, completed: false };
        P.jobSheets[id].started = true;
        recordEvent('JOB_SHEET_STARTED', { jobSheetId: id, moduleId: js.moduleId });
        persist();
        renderJobSheet(id);
        return { ok: true, jobSheet: js };
    }
    function saveJobSheet(id, data) {
        const js = getJobSheet(id);
        if (!js) return { ok: false, reason: 'NO_JOB_SHEET' };
        data = data || {};
        if (!JOB_RESULTS[id]) startJobSheet(id);
        const rec = JOB_RESULTS[id];
        // Auto-collect pengukuran dari Phase 3 sejak job sheet dimulai.
        const startCount = rec.recordStart || 0;
        if (window.Phase3 && window.Phase3.getRecords) {
            rec.measurements = window.Phase3.getRecords().slice(startCount).map(r => ({
                test: r.test || '', red: r.redProbe || '', black: r.blackProbe || '', value: r.value, unit: r.unit || '', ol: !!r.ol, systemState: r.systemState || '',
            }));
        }
        if (typeof data.observations === 'string') rec.observations = data.observations;
        if (data.answers && Array.isArray(data.answers)) rec.answers = data.answers;
        if (typeof data.conclusion === 'string') rec.conclusion = data.conclusion;
        rec.savedAt = now();
        persist();
        return { ok: true, result: rec };
    }
    function completeJobSheet(id) {
        const js = getJobSheet(id);
        if (!js) return { ok: false, reason: 'NO_JOB_SHEET' };
        if (!JOB_RESULTS[id]) startJobSheet(id);
        const rec = JOB_RESULTS[id];
        const report = getJobSheetResult(id);
        recordEvent('JOB_SHEET_COMPLETED', { jobSheetId: id, moduleId: js.moduleId, measurements: report.measurements.length });
        rec.completedAt = now();
        P.jobSheets[id].completed = true;
        persist();
        checkAchievements();
        return { ok: true, jobSheetId: id, completedAt: rec.completedAt };
    }
    function jobSheetValidation(id) {
        const js = getJobSheet(id);
        if (!js) return { ok: false };
        const rec = getJobSheetResult(id);
        const conclusionOk = rec.conclusion && String(rec.conclusion).trim().length > 0;
        const measOk = js.id.indexOf('JS-00') === 0 ? rec.measurements.length > 0 : true; // JS pengukuran wajib ada data
        return { ok: conclusionOk && measOk, conclusionOk, measOk, reasons: [] };
    }
    function getJobSheetResult(id) {
        const rec = JOB_RESULTS[id];
        const js = getJobSheet(id);
        return {
            jobSheetId: id,
            title: js ? js.title : '',
            measurements: (rec && rec.measurements) || [],
            observations: (rec && rec.observations) || '',
            answers: (rec && rec.answers) || [],
            conclusion: (rec && rec.conclusion) || '',
            startedAt: rec ? rec.startedAt : null,
            completedAt: rec ? rec.completedAt : null,
            completed: !!(P.jobSheets[id] && P.jobSheets[id].completed),
            instrument: js && js.expectedResult ? { field: js.expectedResult.field, mode: js.expectedResult.mode, normalRange: js.expectedResult.normalRange } : null,
        };
    }
    function jobSheetsDoneCount() {
        return JOB_SHEETS.filter(j => P.jobSheets[j.id] && P.jobSheets[j.id].completed).length;
    }

    /* ============================================================
       ASSESSMENT ENGINE (§18–23, §52, §54, §55)
       ============================================================ */
    function shuffled(arr) {
        const a = arr.slice();
        if (settings.randomQuestions === false) return a;
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }
    function generateAssessment(opts) {
        opts = opts || {};
        const moduleId = opts.moduleId || null;
        let pool = QUESTION_BANK.slice();
        if (moduleId) {
            const byMod = pool.filter(q => q.moduleId === moduleId);
            if (byMod.length) pool = byMod;
        }
        if (opts.difficulty) {
            const byDiff = pool.filter(q => q.difficulty === opts.difficulty);
            if (byDiff.length) pool = byDiff;
        }
        if (opts.types && opts.types.length) {
            const byType = pool.filter(q => opts.types.indexOf(q.type) >= 0);
            if (byType.length) pool = byType;
        }
        pool = shuffled(pool);
        const count = Math.max(1, parseInt(opts.questionCount, 10) || 5);
        const questions = pool.slice(0, count);
        return {
            moduleId,
            questions,
            totalPoints: questions.reduce((s, q) => s + (q.points || 1), 0),
        };
    }

    let activeAttempt = null; // session
    let attemptCounter = 0;
    function nextAttemptId() {
        attemptCounter++;
        return 'ATT-' + now().toString(36).toUpperCase() + '-' + attemptCounter;
    }

    function startAssessment(opts) {
        opts = opts || {};
        const gen = generateAssessment(opts);
        if (!gen.questions.length) return { ok: false, reason: 'EMPTY_QUESTION_POOL' };
        const started = now();
        activeAttempt = {
            id: nextAttemptId(),
            moduleId: gen.moduleId || (opts.moduleId || null),
            startedAt: started,
            completedAt: null,
            questions: gen.questions.map(q => ({ qid: q.id, type: q.type, question: q.question, options: q.options || [], pairs: q.pairs || null, items: q.items || null, explanation: q.explanation || '', difficulty: q.difficulty, points: q.points || 1, correctAnswer: q.correctAnswer, correctAnswers: q.correctAnswers, correctOrder: q.correctOrder })),
            totalPoints: gen.totalPoints,
            answers: [],
            score: null,
            percent: null,
            status: 'IN_PROGRESS',
            attempt: currentAttemptNumber(opts.moduleId) + 1,
        };
        recordEvent('ASSESSMENT_STARTED', { moduleId: activeAttempt.moduleId, assessmentId: activeAttempt.id });
        persist();
        return { ok: true, session: activeAttempt };
    }
    function currentAttemptNumber(moduleId) {
        if (!moduleId) return 0;
        return (ASSESSMENT_RESULTS || []).filter(r => r.moduleId === moduleId).length;
    }
    function activeSession() { return activeAttempt; }
    function abortAssessment() { activeAttempt = null; renderAssessmentCenter(); return { ok: true }; }

    function scoreAnswer(q, answer) {
        const type = q.type;
        let a = answer;
        if (answer === null || answer === undefined || answer === '') return { correct: false, points: 0 };
        if (type === 'MULTIPLE_CHOICE' || type === 'TRUE_FALSE' || type === 'SCENARIO') {
            const correct = Number(q.correctAnswer);
            return { correct: Number(a) === correct, points: Number(a) === correct ? (q.points || 1) : 0 };
        }
        if (type === 'MULTIPLE_RESPONSE') {
            const correct = (q.correctAnswers || []).map(Number);
            const sel = Array.isArray(a) ? a.map(Number) : [];
            const right = sel.filter(x => correct.indexOf(x) >= 0).length;
            const wrong = sel.filter(x => correct.indexOf(x) < 0).length;
            const raw = (right - wrong) / (correct.length || 1);
            const scored = Math.max(0, Math.round(raw * (q.points || 1)));
            return { correct: scored >= (q.points || 1), points: scored };
        }
        if (type === 'MATCHING') {
            const n = (q.pairs || []).length;
            const sel = Array.isArray(a) ? a.map(Number) : [];
            let hit = 0;
            for (let i = 0; i < n; i++) if (Number(sel[i]) === i) hit++;
            const scored = Math.round((n ? hit / n : 0) * (q.points || 1));
            return { correct: hit === n, points: scored };
        }
        if (type === 'ORDERING') {
            const n = (q.items || []).length;
            const sel = Array.isArray(a) ? a.map(Number) : [];
            const correctOrder = (q.correctOrder || []).map(Number);
            let hit = 0;
            for (let i = 0; i < n; i++) if (Number(sel[i]) === correctOrder[i]) hit++;
            const scored = Math.round((n ? hit / n : 0) * (q.points || 1));
            return { correct: hit === n, points: scored };
        }
        return { correct: false, points: 0 };
    }

    function answerQuestion(session, qIndex, answer) {
        const s = session || activeAttempt;
        if (!s) return { ok: false, reason: 'NO_ACTIVE' };
        const q = s.questions[qIndex];
        if (!q) return { ok: false, reason: 'NO_QUESTION' };
        const res = scoreAnswer(q, answer);
        const record = {
            qid: q.qid, index: qIndex, type: q.type, question: q.question,
            options: q.options, pairs: q.pairs, items: q.items,
            answer, correctAnswer: q.correctAnswer !== undefined ? q.correctAnswer : (q.correctAnswers || q.correctOrder),
            correct: res.correct, points: res.points, pointsMax: q.points,
            explanation: q.explanation,
        };
        const i = s.answers.findIndex(a => a.index === qIndex);
        if (i >= 0) s.answers[i] = record; else s.answers.push(record);
        return { ok: true, correct: res.correct, scored: res.points, max: q.points, explanation: q.explanation, record };
    }
    function currentCorrectExplanation(session) {
        const s = session || activeAttempt;
        if (!s) return '';
        const q = s.questions[0];
        return q ? q.explanation : '';
    }
    function computeAssessmentResult(session) {
        const earned = session.answers.reduce((sum, a) => sum + (a.points || 0), 0);
        const total = session.totalPoints || session.questions.reduce((s, q) => s + (q.points || 1), 0);
        const percent = total ? Math.round((earned / total) * 100) : 0;
        return { earned, total, percent };
    }

    function bestAssessmentFor(moduleId) {
        const list = ASSESSMENT_RESULTS.filter(r => r.moduleId === moduleId && typeof r.percent === 'number');
        if (!list.length) return null;
        return Math.max.apply(null, list.map(r => r.percent));
    }
    function assessmentAverage() {
        if (!ASSESSMENT_RESULTS.length) return null;
        return Math.round(ASSESSMENT_RESULTS.reduce((s, r) => s + (r.percent || 0), 0) / ASSESSMENT_RESULTS.length);
    }

    function finishAssessment(session) {
        const s = session || activeAttempt;
        if (!s) return { ok: false, reason: 'NO_ACTIVE', message: 'Tidak ada sesi assessment aktif.' };
        const score = computeAssessmentResult(s);
        const feedback = getAssessmentFeedback(s, score);
        s.score = score.earned;
        s.percent = score.percent;
        s.completedAt = now();
        s.status = 'SUBMITTED';
        const resultObj = {
            id: s.id, moduleId: s.moduleId, attempt: s.attempt,
            startedAt: s.startedAt, completedAt: s.completedAt,
            score: score.earned, total: score.total, percent: score.percent,
            answers: s.answers, feedback: feedback.strengths, recommendations: feedback.recommendations,
        };
        ASSESSMENT_RESULTS.push(resultObj);
        P.assessments.count = (P.assessments.count || 0) + 1;
        P.assessments.best = P.assessments.best === null ? score.percent : Math.max(P.assessments.best, score.percent);
        recordEvent('ASSESSMENT_COMPLETED', { moduleId: s.moduleId, assessmentId: s.id, percent: score.percent });
        // master objective bila lulus ambang
        const threshold = (CFG.mastery || {}).assessmentThreshold;
        if (s.moduleId && (threshold === undefined || score.percent >= threshold)) {
            (getModule(s.moduleId) || {}).objectives && (getModule(s.moduleId).objectives || []).forEach(o => {
                // jangan override MASTERED; upgrade PRACTICED → MASTERED
                const st = goalStatus(s.moduleId, o.id);
                if (st === 'PRACTICED') markObjectiveMastered(s.moduleId, o.id);
            });
        }
        persist();
        activeAttempt = null;
        checkAchievements();
        return { ok: true, result: resultObj, feedback, score };
    }

    function getAssessmentResults() { return ASSESSMENT_RESULTS.slice(); }
    function getAssessmentResult(id) { return ASSESSMENT_RESULTS.find(r => r.id === id) || null; }

    /* §27–28: FEEDBACK ENGINE */
    function getAssessmentFeedback(s, score) {
        const strengths = [];
        const weak = [];
        (s.answers || []).forEach(a => {
            if (a.correct) strengths.push(a.question);
            else weak.push({ qid: a.qid, question: a.question, moduleId: s.moduleId });
        });
        const topicMap = {};
        weak.forEach(w => {
            const q = QUESTION_BANK.find(x => x.id === w.qid);
            const mid = q ? q.moduleId : s.moduleId;
            const m = getModule(mid);
            topicMap[mid] = m ? m.title : mid;
        });
        const recommendations = Object.keys(topicMap).map(mid => {
            const m = getModule(mid);
            return { moduleId: mid, title: m ? m.title : mid, lessons: m ? (m.lessons || []).slice(0, 2) : [] };
        });
        return { strengths, weaknesses: weak.map(w => w.question), recommendations };
    }
    function getRecommendations(assessmentId) {
        const r = getAssessmentResult(assessmentId);
        if (!r) return [];
        return r.recommendations || [];
    }
    function getReview(assessmentId) {
        const r = getAssessmentResult(assessmentId);
        if (!r) return [];
        return (r.answers || []).map(a => ({
            question: a.question, your: a.answer, correct: a.correctAnswer, correctFlag: a.correct, explanation: a.explanation,
        }));
    }

    /* ============================================================
       PRACTICAL ASSESSMENT (§24–26) — integrasi Phase 4
       ============================================================ */
    function startPracticalAssessment(caseId) {
        if (window.Phase4 && typeof window.Phase4.resetMultimeter === 'function') window.Phase4.resetMultimeter();
        const res = (caseId && window.Phase4) ? (window.Phase4.startDiagnosticCase(caseId) || {}) : (window.Phase4 ? window.Phase4.startRandomCase() || {} : {});
        const caseObj = (window.Phase4 && window.Phase4.getCurrentCase && window.Phase4.getCurrentCase());
        recordEvent('PRACTICE_STARTED', { practiceId: 'practical:' + (caseObj ? caseObj.id : ''), moduleId: 'starter-diagnosis', type: 'PRACTICAL' });
        persist();
        return { ok: !!(window.Phase4 && caseObj), caseId: caseObj ? caseObj.id : null, start: res };
    }
    function computePracticalRubric() {
        const st = window.Phase4 && window.Phase4.getDiagnosticState ? window.Phase4.getDiagnosticState() : null;
        const report = window.Phase4 && window.Phase4.generateDiagnosticReport ? window.Phase4.generateDiagnosticReport() : null;
        const R = CFG.practicalRubric || {};
        const idx = (k) => R[k] || 0;
        const sum = (a) => a.reduce((s, x) => s + (x.value || 0), 0);
        const parts = [];

        // initialInspection
        const observed = st ? st.observations : 0;
        parts.push({ key: 'initialInspection', label: 'Initial Inspection', max: idx('initialInspection'), value: observed > 0 ? idx('initialInspection') : 0 });

        // safetyProcedure — tidak ada OHM/CONT saat sistem berenergi
        let safety = idx('safetyProcedure');
        const records = window.Phase3 && window.Phase3.getRecords ? window.Phase3.getRecords() : [];
        const energizedRes = records.filter(r => (r.unit && (r.unit.indexOf('Ω') >= 0)) && r.systemState && r.systemState !== 'OFF' && r.systemState.indexOf('OFF') !== 0);
        if (energizedRes.length) safety = 0;
        parts.push({ key: 'safetyProcedure', label: 'Safety Procedure', max: idx('safetyProcedure'), value: safety });

        // measurementProcedure — proporsi pasangan berbeda
        const distinct = {};
        records.forEach(r => { if (r.redProbe && r.blackProbe) distinct[r.redProbe + '→' + r.blackProbe] = true; });
        const sig = (st && st.caseId) ? null : null;
        const kb = activeKBForPhase4();
        const sigCount = kb && kb.signature ? kb.signature.length : Math.max(4, Object.keys(distinct).length);
        const measProc = Math.round(idx('measurementProcedure') * clamp(Object.keys(distinct).length / sigCount, 0, 1));
        parts.push({ key: 'measurementProcedure', label: 'Measurement Procedure', max: idx('measurementProcedure'), value: measProc });

        // measurementAccuracy — signature cocok (dari Phase 4 score components)
        const p4score = window.Phase4 && window.Phase4.getDiagnosticScore ? window.Phase4.getDiagnosticScore() : null;
        const correctMeas = p4score && p4score.components ? p4score.components.correctMeasurements || 0 : 0;
        const accSrc = p4score && p4score.components ? p4score.components.correctMeasurements : 0;
        const accMax = (p4score && p4score.components) ? 20 : idx('measurementAccuracy');
        const measAcc = Math.round(idx('measurementAccuracy') * (accMax ? clamp(accSrc / accMax, 0, 1) : 0));
        parts.push({ key: 'measurementAccuracy', label: 'Measurement Accuracy', max: idx('measurementAccuracy'), value: measAcc });

        // diagnosticReasoning
        const diagOk = st ? (st.diagnosisCorrect === true) : false;
        const reasoning = diagOk ? idx('diagnosticReasoning') : 0;
        parts.push({ key: 'diagnosticReasoning', label: 'Diagnostic Reasoning', max: idx('diagnosticReasoning'), value: reasoning });

        // repairProcedure
        const repairGood = st ? (st.repairWasCorrect === true) : false;
        parts.push({ key: 'repairProcedure', label: 'Repair Procedure', max: idx('repairProcedure'), value: repairGood ? idx('repairProcedure') : 0 });

        // verification
        const verified = st ? (st.verificationPassed === true) : false;
        parts.push({ key: 'verification', label: 'Verification', max: idx('verification'), value: verified ? idx('verification') : 0 });

        // documentation — report/workbook diisi
        let doc = 0;
        const documentOk = report && ((report.measurements && report.measurements.length) || (report.repair));
        doc = documentOk ? idx('documentation') : 0;
        parts.push({ key: 'documentation', label: 'Documentation', max: idx('documentation'), value: doc });

        const total = sum(parts);
        return { parts, total, max: 100, status: st ? st.status : 'INACTIVE', caseId: st ? st.caseId : null, complete: st ? st.complete : false, verified: verified };
    }
    function activeKBForPhase4() {
        const st = window.Phase4 && window.Phase4.getDiagnosticState ? window.Phase4.getDiagnosticState() : null;
        if (!st || !st.finalDiagnosis) return null;
        const KB = window.DIAGNOSTIC_KNOWLEDGE || {};
        const k = KB[st.finalDiagnosis.component];
        return k ? k[st.finalDiagnosis.faultType] : null;
    }
    function completePracticalAssessment() {
        const rubric = computePracticalRubric();
        const st = window.Phase4 && window.Phase4.getDiagnosticState ? window.Phase4.getDiagnosticState() : null;
        const caseId = st ? st.caseId : null;
        const report = window.Phase4 && window.Phase4.generateDiagnosticReport ? window.Phase4.generateDiagnosticReport() : null;
        const caseObj = window.Phase4 && window.Phase4.getCurrentCase ? window.Phase4.getCurrentCase() : null;
        // skill scores terpisah (§26)
        const knowledge = assessmentAverage();   // skor kuis rata-rata
        const practical = rubric.total;
        const diagComp = rubric.parts.filter(p => p.key === 'diagnosticReasoning' || p.key === 'repairProcedure' || p.key === 'verification' || p.key === 'initialInspection');
        const diagnostic = Math.round(diagComp.reduce((s, p) => s + (p.max ? p.value / p.max * 100 : 0), 0) / (diagComp.length || 1));

        const entry = {
            type: 'PRACTICAL',
            caseId, status: st ? st.status : 'INACTIVE',
            caseTitle: caseObj ? (caseObj.title || caseObj.id) : null,
            rubric: rubric.parts,
            total: rubric.total,
            knowledgeScore: knowledge,
            practicalScore: practical,
            diagnosticScore: diagnostic,
            verified: rubric.verified,
            report: report ? { diagnosis: report.diagnosis, repair: report.repair, verification: report.verification, confidence: report.confidence, score: report.score } : null,
            completedAt: now(),
        };
        DIAG_HISTORY.push(entry);
        P.diagnostics[caseId || ('CASE_' + DIAG_HISTORY.length)] = { completed: true, status: st ? st.status : 'COMPLETED', score: rubric.total, at: now() };
        recordEvent('DIAGNOSTIC_COMPLETED', { caseId, rubric: rubric.total, verified: rubric.verified });
        persist();
        checkAchievements();
        renderAssessmentCenter();
        return { ok: true, entry, rubric };
    }
    function getDiagnosticHistory() { return DIAG_HISTORY.slice(); }
    function diagnosticsDoneCount() { return Object.keys(P.diagnostics).length; }

    /* ============================================================
       ACHIEVEMENTS (§31)
       ============================================================ */
    function checkAchievements() {
        const unlockedNow = [];
        const unlock = (id) => {
            if (!ACH[id]) { ACH[id] = { unlockedAt: now() }; unlockedNow.push(id); }
        };
        // counters
        const records = window.Phase3 && window.Phase3.getRecords ? window.Phase3.getRecords().length : 0;
        const jobMeas = Object.keys(JOB_RESULTS).reduce((s, id) => s + (JOB_RESULTS[id].measurements ? JOB_RESULTS[id].measurements.length : 0), 0);
        const totalMeas = records + jobMeas;
        const lessonsDone = Object.keys(P.lessons).filter(id => P.lessons[id].completed).length;
        const diagDone = diagnosticsDoneCount();
        const jsDone = jobSheetsDoneCount();
        const practicalVerified = DIAG_HISTORY.some(e => e.verified) || DIAG_HISTORY.some(e => (e.status === 'VERIFIED'));

        if (totalMeas >= 1) unlock('FIRST_MEASUREMENT');
        if (totalMeas >= 5) unlock('ELECTRICAL_ANALYST');
        if (diagDone >= 5) unlock('DIAGNOSTIC_THINKER');
        if (practicalVerified) unlock('TROUBLESHOOTER');
        if (jsDone >= JOB_SHEETS.length) unlock('JOB_SHEET_MASTER');
        if (lessonsDone >= 1) unlock('FIRST_LESSON');
        if (ASSESSMENT_RESULTS.length >= 1) unlock('FIRST_QUIZ');
        if (unlockedNow.length) { persist(); }
        return { ok: true, newlyUnlocked: unlockedNow };
    }
    function getAchievements() {
        return ACH_DEFS.map(d => ({ id: d.id, icon: d.icon, title: d.title, description: d.description, unlocked: !!ACH[d.id], unlockedAt: ACH[d.id] ? ACH[d.id].unlockedAt : null }));
    }
    function achievementsUnlockedCount() { return Object.keys(ACH).length; }

    /* ============================================================
       OVERALL PROGRESS (§29, §30)
       ============================================================ */
    function computeOverallProgress() {
        const modules = MODULES.length || 1;
        const modsDone = MODULES.filter(m => moduleProgress(m.id).completed).length;
        const lessonsTotal = LESSON_LIST.length || 1;
        const lessonsDone = LESSON_LIST.filter(l => P.lessons[l.id] && P.lessons[l.id].completed).length;
        const jsTotal = JOB_SHEETS.length || 1;
        const jsDone = jobSheetsDoneCount();
        const diagTotal = 10; // target kasus diagnosis (§30)
        const diagDone = Math.min(diagTotal, diagnosticsDoneCount());
        let avg = assessmentAverage();
        const weights = { modules: 0.3, lessons: 0.3, jobSheets: 0.2, diagnostics: 0.1, assessments: 0.1 };
        const c = {
            modules: modules ? modsDone / modules : 0,
            lessons: lessonsTotal ? lessonsDone / lessonsTotal : 0,
            jobSheets: jsTotal ? jsDone / jsTotal : 0,
            diagnostics: diagTotal ? diagDone / diagTotal : 0,
            assessments: avg !== null ? avg / 100 : 0,
        };
        const percent = Math.round(((c.modules * weights.modules) + (c.lessons * weights.lessons) + (c.jobSheets * weights.jobSheets) + (c.diagnostics * weights.diagnostics) + (c.assessments * weights.assessments)) * 100);
        return {
            percent: clamp(percent, 0, 100),
            modules: { done: modsDone, total: modules },
            lessons: { done: lessonsDone, total: lessonsTotal },
            jobSheets: { done: jsDone, total: jsTotal },
            diagnostics: { done: diagDone, total: diagTotal },
            assessments: { avg },
            completion: { percent, done: percent >= 100 },
        };
    }
    function getLearningRecord() { return P.record.slice().reverse(); }

    /* ============================================================
       REPORT / CERTIFICATE (§36, §57–58)
       ============================================================ */
    function generateReport() {
        const ov = computeOverallProgress();
        const knowledge = assessmentAverage();
        const skills = skillSummary();
        const mods = MODULES.map(m => ({ id: m.id, title: m.title, progress: moduleProgress(m.id), mastery: computeMastery(m.id) }));
        return {
            student: Object.assign({}, profile),
            generationTime: now(),
            modules: mods,
            lessons: LESSON_LIST.map(l => ({ id: l.id, title: l.title, moduleId: l.moduleId, completed: !!(P.lessons[l.id] && P.lessons[l.id].completed), timeMs: (P.lessons[l.id] && P.lessons[l.id].timeMs) || 0 })),
            jobSheets: JOB_SHEETS.map(j => ({ id: j.id, title: j.title, completed: !!(P.jobSheets[j.id] && P.jobSheets[j.id].completed), result: getJobSheetResult(j.id) })),
            diagnostics: DIAG_HISTORY.slice(),
            assessments: ASSESSMENT_RESULTS.slice(),
            knowledgeScore: knowledge,
            practicalScore: skills.practical,
            diagnosticScore: skills.diagnostic,
            overallProgress: ov,
            achievements: getAchievements(),
        };
    }
    function skillSummary() {
        const pra = DIAG_HISTORY.filter(e => typeof e.total === 'number');
        const practical = pra.length ? Math.round(pra.reduce((s, e) => s + e.total, 0) / pra.length) : null;
        const diagnostic = pra.length ? Math.round(pra.reduce((s, e) => s + (e.diagnosticScore || 0), 0) / pra.length) : null;
        return { practical, diagnostic, knowledge: assessmentAverage() };
    }
    function generateCertificate() {
        syncIdentity();
        const ov = computeOverallProgress();
        const rep = generateReport();
        return {
            studentName: profile.name || 'Siswa',
            courseName: 'Starter System Virtual Laboratory',
            completionPercentage: ov.percent,
            averageScore: rep.knowledgeScore !== null ? rep.knowledgeScore : (ov.percent),
            completedAt: ov.completion.done ? now() : null,
            earned: ov.completion.done,
        };
    }

    /* ============================================================
       IMPORT / EXPORT / RESET (§39, §40)
       ============================================================ */
    function exportData() {
        return {
            version: VERSION,
            student: Object.assign({}, profile),
            progress: JSON.parse(JSON.stringify(P)),
            assessments: ASSESSMENT_RESULTS.slice(),
            jobSheets: JSON.parse(JSON.stringify(JOB_RESULTS)),
            diagnostics: DIAG_HISTORY.slice(),
            achievements: JSON.parse(JSON.stringify(ACH)),
            settings: JSON.parse(JSON.stringify(settings)),
            exportedAt: now(),
        };
    }
    function importData(json) {
        try {
            let d = typeof json === 'string' ? JSON.parse(json) : json;
            if (!d || typeof d !== 'object') return { ok: false, error: 'INVALID_JSON' };
            if (typeof d.version !== 'number') return { ok: false, error: 'NO_VERSION' };
            if (d.student && typeof d.student === 'object') Object.assign(profile, { name: '', klass: '', studentId: '' }, d.student);
            if (d.progress && typeof d.progress === 'object') Object.assign(P, emptyProgress(), d.progress);
            if (Array.isArray(d.assessments)) { ASSESSMENT_RESULTS.length = 0; d.assessments.forEach(x => ASSESSMENT_RESULTS.push(x)); }
            if (d.jobSheets && typeof d.jobSheets === 'object') { Object.keys(JOB_RESULTS).forEach(k => delete JOB_RESULTS[k]); Object.keys(d.jobSheets).forEach(k => JOB_RESULTS[k] = d.jobSheets[k]); }
            if (Array.isArray(d.diagnostics)) { DIAG_HISTORY.length = 0; d.diagnostics.forEach(x => DIAG_HISTORY.push(x)); }
            if (d.achievements && typeof d.achievements === 'object') Object.keys(ACH).forEach(k => delete ACH[k]), Object.keys(d.achievements).forEach(k => ACH[k] = d.achievements[k]);
            if (d.settings && typeof d.settings === 'object') settings = Object.assign({}, SETTINGS_DEFAULT, d.settings);
            persist(); write(CFG.studentProfileKey, profile);
            checkAchievements();
            return { ok: true, version: d.version };
        } catch (e) {
            return { ok: false, error: 'IMPORT_FAILED', message: safeText(e && e.message) };
        }
    }
    let resetPending = false;
    function requestReset() { resetPending = true; renderProgressPage(); return { ok: true, pending: true }; }
    function confirmReset() {
        if (Object.keys(P).length) Object.assign(P, emptyProgress());
        Object.keys(ACH).forEach(k => delete ACH[k]);
        ASSESSMENT_RESULTS.length = 0;
        Object.keys(JOB_RESULTS).forEach(k => delete JOB_RESULTS[k]);
        DIAG_HISTORY.length = 0;
        activeAttempt = null;
        resetPending = false;
        write(CFG.progressKey, P); write(CFG.assessmentResultsKey, ASSESSMENT_RESULTS); write(CFG.jobSheetResultsKey, JOB_RESULTS); write(CFG.diagnosticHistoryKey, DIAG_HISTORY); write(CFG.achievementsKey, ACH);
        recordEvent('RESET_PROGRESS', {});
        return { ok: true };
    }
    function cancelReset() { resetPending = false; renderProgressPage(); return { ok: true }; }

    /* ============================================================
       INSTRUCTOR (§34–35) — demo single-user, bukan backend
       ============================================================ */
    function getInstructorDashboard() {
        const demo = {
            students: 25, averageScore: 82, completed: 18, inProgress: 5, needsReview: 2,
            demo: true, note: 'Data simulasi untuk mode instruktur single-user (tanpa backend).',
        };
        return demo;
    }

    /* ============================================================
       SETTINGS API
       ============================================================ */
    function getSettings() { return Object.assign({}, settings); }
    function setSettings(patch) {
        Object.assign(settings, patch || {});
        saveSettings();
        return getSettings();
    }

    /* ============================================================
       UI — LEARNING DASHBOARD (page MATERI) §3
       ============================================================ */
    function p5bar(percent) {
        return '<div class="p5-progress-track" role="progressbar" aria-valuenow="' + percent + '" aria-valuemin="0" aria-valuemax="100"><div class="p5-progress-fill" style="width:' + clamp(percent, 0, 100) + '%"></div></div>';
    }
    function statusBadge(status) {
        const map = { 'NOT_STARTED': ['○', 'p5-st-none'], 'IN_PROGRESS': ['◐', 'p5-st-prog'], 'PRACTICED': ['◑', 'p5-st-pract'], 'MASTERED': ['✓', 'p5-st-master'] };
        const m = map[status] || map['NOT_STARTED'];
        return '<span class="p5-st ' + m[1] + '">' + m[0] + ' ' + status.replace(/_/g, ' ') + '</span>';
    }
    function renderDashboard() {
        const el = $('lrn-dashboard');
        if (!el) return;
        syncIdentity();
        const ov = computeOverallProgress();
        const profileName = profile.name ? esc(profile.name) : 'Siswa';
        const hasProfile = !!profile.name;
        let html = '<div class="p5-dash">';
        html += '<div class="p5-dash-head"><div><h2>STARTER SYSTEM LEARNING LAB</h2><p class="p5-sub">Laboratorium pembelajaran terpadu: materi + praktik + evaluasi</p></div>'
            + '<div class="p5-profile-chip">' + (hasProfile ? '👤 ' + profileName : '<span class="p5-muted">Belum ada profil</span>') + '</div></div>';
        html += storageWarning();
        html += '<div class="p5-dash-grid">';
        // progress
        html += '<div class="p5-card"><div class="p5-card-title">Progress</div>' + p5bar(ov.percent) + '<div class="p5-card-value">' + ov.percent + '%</div>'
            + '<div class="p5-mini">Modul ' + ov.modules.done + '/' + ov.modules.total + ' · Lesson ' + ov.lessons.done + '/' + ov.lessons.total + '</div></div>';
        // current module
        const cur = MODULES.filter(m => isModuleUnlocked(m.id) && !moduleProgress(m.id).completed)[0] || MODULES[MODULES.length - 1];
        html += '<div class="p5-card"><div class="p5-card-title">Current Module</div><div class="p5-cur-title">' + (cur ? esc(cur.title) : '—') + '</div>'
            + '<div class="p5-cur-nav"><button class="btn-ctrl" onclick="Learning.openModule(\'' + (cur ? cur.id : '') + '\')">LANJUTKAN BELAJAR</button></div></div>';
        // modules completed
        html += '<div class="p5-card"><div class="p5-card-title">Modules Completed</div><div class="p5-module-mini-list">'
            + MODULES.map(m => {
                const st = P.lessons; const mp = moduleProgress(m.id);
                const mark = mp.completed ? '✓' : '○';
                return '<div class="p5-module-mini ' + (mp.completed ? 'p5-done' : '') + '" onclick="Learning.openModule(\'' + m.id + '\')"><span class="p5-module-mark">' + mark + '</span> ' + esc(m.shortTitle || m.title) + '</div>';
            }).join('') + '</div></div>';
        // practice score
        html += '<div class="p5-card"><div class="p5-card-title">Practice Score</div><div class="p5-card-value">' + (practiceAverage() !== null ? practiceAverage() + ' / 100' : '—') + '</div>'
            + '<div class="p5-mini">' + achievementsUnlockedCount() + '/' + ACH_DEFS.length + ' achievement terbuka</div></div>';
        html += '</div></div>';
        el.innerHTML = html;
    }
    function practiceAverage() {
        const all = practiceDefs().map(p => P.practices[p.id]).filter(p => p && typeof p.best === 'number');
        if (!all.length) return null;
        return Math.round(all.reduce((s, p) => s + p.best, 0) / all.length);
    }

    /* UI — MODULE VIEW */
    function renderModule(moduleId) {
        const el = $('lrn-module');
        if (!el) return;
        const m = getModule(moduleId);
        if (!m) { el.innerHTML = '<div class="p5-muted">Modul tidak ditemukan (' + esc(moduleId) + ').</div>'; return; }
        const unlocked = isModuleUnlocked(moduleId);
        const mp = moduleProgress(moduleId);
        const objs = getObjectives(moduleId).map(o => '<div class="p5-obj">' + statusBadge(o.status) + ' <span>' + esc(o.text) + '</span></div>').join('');
        const lessons = moduleLessons(m).map((l, i) => {
            const ls = P.lessons[l];
            const done = ls && ls.completed;
            const ln = getLesson(l);
            return '<div class="p5-lesson-row ' + (done ? 'p5-done' : '') + '">'
                + '<button class="btn-sm" onclick="Learning.openLesson(\'' + m.id + '\',\'' + l + '\')">' + (done ? '✓ ' : '') + esc(ln ? ln.title : l) + '</button>'
                + '<span class="p5-lesson-meta">' + (ln ? ln.estMinutes + ' menit' : '') + '</span></div>';
        }).join('');
        const plist = getPracticesFor(moduleId).map(p => {
            const pr = P.practices[p];
            return '<div class="p5-lesson-row"><button class="btn-sm" onclick="Learning.startPractice(\'' + p + '\')">PRAKTIK: ' + esc(practicesTitle(p)) + '</button>'
                + '<span class="p5-lesson-meta">' + (pr ? 'best ' + pr.best + '%' : '') + '</span></div>';
        }).join('');
        const ast = getAssessmentsFor(moduleId).map(a => '<div class="p5-lesson-row"><button class="btn-sm" onclick="Learning.startAssessmentForModule(\'' + moduleId + '\')">KUIS: ' + esc(a.title) + '</button></div>').join('');
        const jsList = getJobSheetsFor(moduleId).map(jsid => {
            const js = getJobSheet(jsid);
            const done = !!(P.jobSheets[jsid] && P.jobSheets[jsid].completed);
            return '<div class="p5-lesson-row ' + (done ? 'p5-done' : '') + '"><button class="btn-sm" onclick="Learning.openJobSheet(\'' + jsid + '\')">' + (done ? '✓ ' : '') + 'JOB SHEET: ' + esc(js ? js.title : jsid) + '</button></div>';
        }).join('');
        const mastery = computeMastery(moduleId);
        let html = '<div class="p5-module-head"><button class="btn-sm" onclick="Learning.backToDashboard()">← Dashboard</button>'
            + '<h3>' + esc(m.title) + ' <span class="p5-difficulty">' + esc(m.difficulty) + '</span></h3></div>';
        html += '<p class="p5-sub">' + esc(m.description) + '</p>';
        if (!unlocked) html += '<div class="p5-warn">Modul terkunci — selesaikan prasyarat: ' + (m.prerequisites || []).map(id => (getModule(id) || {}).title || id).join(', ') + '. <button class="btn-sm" onclick="Learning.setOpenAll(true)">OPEN ALL MODULES</button></div>';
        html += '<div class="p5-module-grid">';
        html += '<div class="p5-card"><div class="p5-card-title">LEARNING OBJECTIVES</div>' + objs + '</div>';
        html += '<div class="p5-card"><div class="p5-card-title">LESSONS <span class="p5-card-head-note">' + mp.lessonsDone + '/' + mp.lessonsTotal + '</span></div>' + (lessons || '<div class="p5-muted">—</div>') + '</div>';
        html += '<div class="p5-card"><div class="p5-card-title">GUIDED PRACTICE</div>' + (plist || '<div class="p5-muted">—</div>') + '</div>';
        html += '<div class="p5-card"><div class="p5-card-title">ASSESSMENT</div>' + (ast || '<div class="p5-muted">—</div>') + '</div>';
        html += '<div class="p5-card"><div class="p5-card-title">JOB SHEETS</div>' + (jsList || '<div class="p5-muted">Belum ada job sheet untuk modul ini.</div>') + '</div>';
        html += '<div class="p5-card"><div class="p5-card-title">MASTERY <span class="p5-card-head-note">' + mastery.percent + '%</span></div>' + p5bar(mastery.percent) + '<div class="p5-mini">Status: ' + masterLabel(mastery.status) + '</div></div>';
        html += '</div></div>';
        el.innerHTML = html;
        if ($('lrn-lesson')) $('lrn-lesson').innerHTML = '';
    }
    function masterLabel(s) { return { 'NOT_STARTED': 'Belum', 'IN_PROGRESS': 'Sedang', 'PRACTICED': 'Berlatih', 'MASTERED': 'Mastered' }[s] || s; }
    function practicesTitle(id) { const p = practiceDefs().find(x => x.id === id); return p ? p.title : id; }

    /* UI — LESSON VIEWER §7–9 */
    let lessonCtx = { moduleId: null, lessonId: null };
    function openLesson(moduleId, lessonId) {
        const l = getLesson(lessonId);
        if (!l) return { ok: false };
        startLesson(lessonId);
        lessonCtx = { moduleId, lessonId };
        navigateToIfNav('materi');
        renderLesson(lessonId);
        return { ok: true, lesson: l };
    }
    function navigateToIfNav(page) {
        if (typeof window.navigateTo === 'function') window.navigateTo(page);
    }
    function renderLesson(lessonId) {
        const el = $('lrn-lesson');
        if (!el) return;
        const l = getLesson(lessonId);
        if (!l) { el.innerHTML = '<div class="p5-warn">Lesson tidak ditemukan.</div>'; return; }
        const m = getModule(l.moduleId);
        const secHtml = (l.sections || []).map(sectionHtml).join('');
        let demo3dBtn = '';
        if (typeof window.Phase6 === 'object' && window.Phase6 && typeof window.Phase6.lessonDemo === 'function') {
            const dd = window.Phase6.lessonDemo(lessonId);
            if (dd && dd.scene) {
                demo3dBtn = '<div class="p5-tryit"><button type="button" class="btn-ctrl" onclick="Learning.open3DDemo(\'' + escapedAttr(lessonId) + '\')">LIHAT ANIMASI 3D · ' + esc(dd.label) + '</button></div>';
            }
        }
        let html = '<div class="p5-lesson-panel">';
        html += '<div class="p5-module-head"><button class="btn-sm" onclick="Learning.backToModule()">← Modul</button> <span class="p5-module-tag">' + (m ? esc(m.title) : '') + '</span></div>';
        html += '<h3>' + esc(l.title) + '</h3>' + secHtml + demo3dBtn + '<div class="p5-lesson-nav"></div>';
        html += '</div>';
        el.innerHTML = html;
        renderLessonNav(l.moduleId, lessonId);
    }
    function open3DDemo(lessonId) {
        if (typeof window.Phase6 !== 'object' || !window.Phase6 || typeof window.Phase6.startDemoFromLesson !== 'function') return { ok: false, error: 'noPhase6' };
        try {
            if (typeof window.navigateTo === 'function') window.navigateTo('3d');
            const r = window.Phase6.startDemoFromLesson(lessonId);
            return r && r.ok ? { ok: true, scene: r.scene } : { ok: false, error: 'noDemo' };
        } catch (e) { return { ok: false, error: 'error' }; }
    }
    function sectionHtml(s) {
        const t = s.type || 'TEXT';
        if (t === 'TEXT') return '<p class="p5-lesson-text">' + esc(s.content) + '</p>';
        if (t === 'LIST') return '<ul class="p5-lesson-list">' + (s.items || []).map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
        if (t === 'STEPS') return '<ol class="p5-lesson-list">' + (s.items || []).map(i => '<li>' + esc(i) + '</li>').join('') + '</ol>';
        if (t === 'TABLE') {
            return '<div class="p5-table-wrap" role="table" aria-label="Tabel materi"><table class="p5-table"><thead><tr>' + (s.headers || []).map(h => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>'
                + (s.rows || []).map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
        }
        if (t === 'INTERACTIVE') {
            const comps = s.components || [s.component].filter(Boolean);
            return '<div class="p5-interactive" role="group" aria-label="Interactive lesson"><p class="p5-lesson-text">' + esc(s.prompt || 'Klik komponen untuk mempelajarinya.') + '</p><div class="p5-comp-chips">'
                + comps.map(c => '<button type="button" class="p5-chip" onclick="Learning.showComponentInfo(\'' + esc(c) + '\')" aria-label="Info komponen ' + esc(c) + '">' + esc((COMPONENT_INFO[c] || {}).label || c) + '</button>').join('')
                + '</div><div id="p5-comp-info" class="p5-comp-info" aria-live="polite"></div></div>';
        }
        if (t === 'SIMULATOR_LINK') {
            return '<div class="p5-tryit"><button class="btn-ctrl" onclick="Learning.goSimulator(\'' + escapedAttr(s.target || 'simulator') + '\')">' + esc(s.label || 'COBA DI SIMULATOR') + '</button>'
                + (s.detail ? '<div class="p5-tryit-detail">' + esc(s.detail) + '</div>' : '') + '</div>';
        }
        return '';
    }
    function escapedAttr(v) { return esc(safeText(v)); }
    function showComponentInfo(comp) {
        const info = COMPONENT_INFO[comp];
        const el = $('p5-comp-info');
        if (el && info) el.innerHTML = '<strong>' + esc(info.label) + '</strong> — ' + esc(info.info);
    }
    function goSimulator(target) {
        if (target === 'multimeter') {
            navigateToIfNav('simulator');
            if (window.Phase3 && typeof window.Phase3.openLab === 'function') window.Phase3.openLab();
        } else if (target === 'diagnosis') {
            navigateToIfNav('simulator');
            if (window.Phase4 && typeof window.Phase4.openLab === 'function') window.Phase4.openLab();
        } else {
            navigateToIfNav(target || 'simulator');
        }
        return true;
    }
    function renderLessonNav(moduleId, lessonId) {
        const el = document.querySelector && document.querySelector('.p5-lesson-nav');
        if (el) {
            const list = getModule(moduleId) ? moduleLessons(getModule(moduleId)) : [];
            const i = list.indexOf(lessonId);
            const prev = i > 0 ? list[i - 1] : null;
            const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
            el.innerHTML = (prev ? '<button class="btn-sm" onclick="Learning.openLesson(\'' + moduleId + '\',\'' + prev + '\')">← SEBELUMNYA</button>' : '')
                + (next ? '<button class="btn-sm" onclick="Learning.openLesson(\'' + moduleId + '\',\'' + next + '\')">SELANJUTNYA →</button>' : '')
                + (i >= list.length - 1 && list.length ? '<button class="btn-ctrl" onclick="Learning.completeLessonFromView(\'' + moduleId + '\',\'' + lessonId + '\')">SELESAIKAN LESSON ✓</button>' : '');
        }
    }
    function completeLessonFromView(moduleId, lessonId) {
        const r = completeLesson(lessonId);
        renderLessonNav(moduleId, lessonId);
        renderModule(moduleId);
        renderDashboard();
        return r;
    }
    function backToDashboard() { if ($('lrn-module')) $('lrn-module').innerHTML = ''; if ($('lrn-lesson')) $('lrn-lesson').innerHTML = ''; renderDashboard(); }
    function backToModule() {
        if ($('lrn-lesson')) $('lrn-lesson').innerHTML = '';
        const m = getModule(lessonCtx.moduleId);
        if (m) renderModule(lessonCtx.moduleId);
    }
    function openModule(moduleId) {
        navigateToIfNav('materi');
        return startModule(moduleId);
    }

    /* UI — PRACTICE VIEW (rendered inside module) */
    function renderPractice(practiceId) {
        const p = getPractice(practiceId);
        if (!p) return;
        const el = $('lrn-practice');
        if (!el) return;
        const started = activePractice && activePractice.id === practiceId;
        const idx = started ? activePractice.step : 0;
        const st = p.steps[idx];
        const level = activePractice ? activePractice.level : settings.practiceLevel;
        let html = '<div class="p5-practice-panel"><div class="p5-module-head"><button class="btn-sm" onclick="Learning.closePractice()">×</button> <h3>GUIDED PRACTICE — ' + esc(p.title) + '</h3>'
            + '<span class="p5-difficulty">LEVEL: ' + (level || 'LEARN') + '</span></div>';
        html += '<div class="p5-practice-step">STEP ' + (idx + 1) + ' / ' + p.steps.length + '</div>';
        if (st) html += '<div class="p5-practice-instr">' + esc(st.instruction) + '</div>';
        if (level !== 'ASSESSMENT' && st && st.help) html += '<div class="p5-practice-help">💡 ' + esc(st.help) + '</div>';
        if (p.id === 'pract-sequence') html += sequencePracticeUI(p);
        html += '<div class="p5-practice-actions"><button class="btn-ctrl" onclick="Learning.checkPractice()">CEK LANGKAH</button>'
            + '<button class="btn-sm" onclick="Learning.startPractice(\'' + practiceId + '\')">MULAI ULANG</button></div>';
        html += '<div id="p5-practice-feedback" class="p5-practice-feedback"></div></div>';
        el.innerHTML = html;
    }
    function sequencePracticeUI(p) {
        const seq = activePractice && activePractice.sequence ? activePractice.sequence : [];
        const items = p.items || [];
        return '<div class="p5-seq"><strong>Urutan saat ini:</strong> <span id="p5-seq-built">' + (seq.map(i => esc(items[i] || '?')).join(' → ') || '—') + '</span>'
            + '<div class="p5-seq-items">' + items.map((it, i) => '<button type="button" class="p5-chip" onclick="Learning.orderPick(' + i + ')">' + esc(it) + '</button>').join('') + '</div>'
            + '<button class="btn-sm" onclick="Learning.orderClear()">BERSIHKAN</button></div>';
    }
    function orderPick(itemIndex) {
        if (!activePractice || !activePractice.sequence) activePractice.sequence = [];
        const seq = activePractice.sequence || [];
        if (seq.indexOf(itemIndex) < 0) seq.push(itemIndex);
        renderPractice(activePractice.id);
    }
    function orderClear() { if (activePractice) activePractice.sequence = []; renderPractice(activePractice.id); }
    function checkPractice() {
        const p = activePractice;
        if (!p) { const fb = $('p5-practice-feedback'); if (fb) fb.innerHTML = '<div class="p5-warn">Mulai praktik terlebih dahulu.</div>'; return { ok: false }; }
        const state = checkAllSteps(p.id);
        const st = getPractice(p.id);
        const idx = state.done ? st.steps.length : state.index;
        const r = checkPracticeStep(p.id, idx);
        const fb = $('p5-practice-feedback');
        if (fb && st) {
            const cur = st.steps[state.done ? st.steps.length - 1 : state.index];
            fb.innerHTML = r.ok
                ? '<div class="p5-fb-ok">✓ Langkah selesai. ' + ((state.done) ? 'Praktik selesai!' : 'Lanjut ke langkah berikutnya.') + '</div>'
                : '<div class="p5-fb-todo">' + esc(cur ? cur.instruction : '') + (state.done ? '' : ' belum terpenuhi. Pastikan: ') + '</div>';
        }
        renderPractice(p.id);
        return r;
    }
    function closePractice() { const el = $('lrn-practice'); if (el) el.innerHTML = ''; }
    function renderModulePractice() { }

    /* UI — ASSESSMENT CENTER (page EVALUASI) §18–23, §52–55 */
    let asmUi = { view: 'home', resultId: null };
    function renderAssessmentCenter() {
        const el = $('p5-assessment');
        if (!el) return;
        let html = '<div class="p5-asm">';
        html += '<div class="p5-dash-head"><div><h2>ASSESSMENT CENTER</h2><p class="p5-sub">Kuis pengetahuan, scenario questions, dan practical assessment (Phase 4)</p></div></div>';
        if (activeAttempt) {
            html += renderQuizUI(activeAttempt);
        } else if (asmUi.view === 'result' && asmUi.resultId) {
            html += renderResultUI(getAssessmentResult(asmUi.resultId));
        } else if (asmUi.view === 'practical' && window.Phase4) {
            html += renderPracticalUI();
        } else {
            html += '<div class="p5-asm-home">';
            html += '<div class="p5-card"><div class="p5-card-title">BUAT KUIS</div><div class="p5-asm-form">'
                + '<label>Modul <select id="asm-module">' + MODULES.map(m => '<option value="' + esc(m.id) + '">' + esc(m.title) + '</option>').join('') + '</select></label>'
                + '<label>Jumlah Soal <input type="number" id="asm-count" value="5" min="1" max="12"></label>'
                + '<label>Kesulitan <select id="asm-diff"><option value="">Semua</option><option>EASY</option><option>MEDIUM</option></select></label>'
                + '<button class="btn-ctrl" onclick="Learning.launchAssessment()">MULAI QUIZ</button></div></div>';
            html += '<div class="p5-card"><div class="p5-card-title">PRACTICAL ASSESSMENT</div><p class="p5-sub">Nilai keterampilan via Diagnostic Engine Phase 4 + rubric.</p>'
                + '<div class="p5-asm-row"><button class="btn-ctrl" onclick="Learning.showPractical()">START PRACTICAL ASSESSMENT</button></div></div>';
            html += '<div class="p5-card"><div class="p5-card-title">RIWAYAT ASSESSMENT</div>' + assessmentHistoryHtml() + '</div>';
            html += '</div>';
        }
        html += '</div>';
        el.innerHTML = html;
    }
    function assessmentHistoryHtml() {
        if (!ASSESSMENT_RESULTS.length) return '<div class="p5-muted">Belum ada assessment.</div>';
        return '<table class="p5-table"><thead><tr><th>ID</th><th>Modul</th><th>Skor</th><th>Tanggal</th><th></th></tr></thead><tbody>'
            + ASSESSMENT_RESULTS.slice().reverse().slice(0, 12).map(r => '<tr><td>' + esc(r.id) + '</td><td>' + esc((getModule(r.moduleId) || {}).title || r.moduleId) + '</td><td><b>' + r.percent + '%</b></td>'
                + '<td>' + esc(new Date(r.completedAt).toLocaleString()) + '</td><td><button class="btn-sm" onclick="Learning.showResult(\'' + esc(r.id) + '\')">REVIEW</button></td></tr>').join('')
            + '</tbody></table><div class="p5-mini">Best: ' + (P.assessments.best === null ? '—' : P.assessments.best + '%') + '</div>';
    }
    function renderQuizUI(s) {
        const answers = s.answers || [];
        const state = asmUi;
        const idxAnswered = answers.length;
        let html = '<div class="p5-quiz-panel">';
        html += '<div class="p5-module-head"><h3>QUIZ — ' + esc((getModule(s.moduleId) || {}).title || s.moduleId) + '</h3><span class="p5-difficulty">Attempt ' + s.attempt + ' · ' + answers.length + '/' + s.questions.length + ' dijawab</span></div>';
        if (idxAnswered < s.questions.length) {
            const q = s.questions[idxAnswered];
            html += '<div class="p5-quiz-q">' + (idxAnswered + 1) + '. ' + esc(q.question) + ' <span class="p5-difficulty">[' + (q.points || 1) + ' poin · ' + esc(q.type.replace(/_/g, ' ')) + ']</span></div>';
            html += questionInputHtml(idxAnswered, q);
        } else {
            html += '<div class="p5-muted">Semua soal dijawab. Klik SELESAI untuk melihat skor.</div>';
        }
        html += '<div class="p5-quiz-nav"><button class="btn-ctrl" onclick="Learning.finishAssessmentNow()">SELESAI &amp; SKOR</button>'
            + '<button class="btn-sm" onclick="Learning.abortAssessment()">BATAL</button></div>';
        html += '<div id="p5-quiz-feedback"></div>';
        html += '</div>';
        return html;
    }
    function questionInputHtml(idx, q) {
        if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE' || q.type === 'SCENARIO') {
            return '<div class="p5-q-options" role="radiogroup">' + (q.options || []).map((o, oi) =>
                '<button type="button" class="p5-q-opt" onclick="Learning.answerAndAdvance(' + idx + ',' + oi + ')">' + String.fromCharCode(65 + oi) + '. ' + esc(o) + '</button>').join('') + '</div>';
        }
        if (q.type === 'MULTIPLE_RESPONSE') {
            return '<div class="p5-q-options">' + (q.options || []).map((o, oi) =>
                '<button type="button" class="p5-q-opt" id="p5-mr-' + oi + '" onclick="Learning.toggleMR(' + oi + ')">' + String.fromCharCode(65 + oi) + '. ' + esc(o) + '</button>').join('')
                + '<div class="p5-q-actions"><button class="btn-ctrl" onclick="Learning.submitMR(' + idx + ')">JAWAB</button></div></div>';
        }
        if (q.type === 'MATCHING') {
            const pairs = q.pairs || [];
            return '<div class="p5-q-options">' + pairs.map((p, pi) => '<div class="p5-match-row"><span class="p5-match-left">' + esc(p[0]) + '</span>'
                + '<select id="p5-match-' + pi + '" aria-label="Pasangan ' + (pi + 1) + '">' + (q.options || []).map((o, oi) => '<option value="' + oi + '">' + esc(o) + '</option>').join('') + '</select></div>').join('')
                + '<div class="p5-q-actions"><button class="btn-ctrl" onclick="Learning.submitMatch(' + idx + ')">JAWAB</button></div></div>';
        }
        if (q.type === 'ORDERING') {
            const items = q.items || [];
            const cur = (asmQState.orderState && asmQState.orderState[q.qid]) || [];
            return '<div class="p5-q-options"><div class="p5-seq"><span class="p5-seq-built">' + (cur.map(i => esc(items[i])).join(' → ') || '—') + '</span>'
                + '<div class="p5-seq-items">' + items.map((it, i) => '<button type="button" class="p5-chip" onclick="Learning.orderPickQ(' + i + ')">' + esc(it) + '</button>').join('') + '</div>'
                + '<button class="btn-sm" onclick="Learning.orderClearQ()">BERSIHKAN</button><button class="btn-ctrl" onclick="Learning.submitOrder(' + idx + ')">JAWAB</button></div></div>';
        }
        return '<div class="p5-muted">Tipe soal belum didukung.</div>';
    }
    let asmQState = { answers: [], revision: 0 };
    function toggleMR(oi) {
        if (!asmQState.answers) asmQState.answers = [];
        const i = asmQState.answers.indexOf(oi);
        if (i >= 0) asmQState.answers.splice(i, 1); else asmQState.answers.push(oi);
    }
    function submitMR(idx) {
        return answerAndAdvance(idx, (asmQState.answers || []).slice());
    }
    function submitMatch(idx) {
        const s = activeAttempt; if (!s) return;
        const q = s.questions[idx];
        const vals = (q.pairs || []).map((_, pi) => {
            const sel = $('p5-match-' + pi);
            return sel ? Number(sel.value) : pi;
        });
        return answerAndAdvance(idx, vals);
    }
    function submitOrder(idx) {
        const state = asmQState || { orderState: {} };
        return answerAndAdvance(idx, Object.keys(state.orderState || {}).length ? (state.orderState[activeAttempt ? activeAttempt.questions[idx].qid : ''] || []) : []);
    }
    function orderPickQ(itemIndex) {
        if (!asmQState.orderState) asmQState.orderState = {};
        const s = activeAttempt; const q = s ? s.questions[s.answers.length] : null;
        if (!q) return;
        if (!asmQState.orderState[q.qid]) asmQState.orderState[q.qid] = [];
        const arr = asmQState.orderState[q.qid];
        if (arr.indexOf(itemIndex) < 0) arr.push(itemIndex);
        renderAssessmentCenter();
    }
    function orderClearQ() {
        const s = activeAttempt; const q = s ? s.questions[s.answers.length] : null;
        if (q && asmQState.orderState) asmQState.orderState[q.qid] = [];
        renderAssessmentCenter();
    }
    function answerAndAdvance(idx, answer) {
        const r = answerQuestion(activeAttempt, idx, answer);
        if (r.ok) {
            if (settings.showFeedbackImmediately) {
                const fb = $('p5-quiz-feedback');
                if (fb) fb.innerHTML = '<div class="' + (r.correct ? 'p5-fb-ok' : 'p5-fb-todo') + '">' + (r.correct ? '✓ Benar' : '✕ Kurang tepat') + ' — ' + esc(r.explanation) + '</div>';
            }
            renderAssessmentCenter();
        }
        return r;
    }
    function finishAssessmentNow() {
        const s = activeAttempt;
        if (!s) return { ok: false };
        // jawab sisa soal yang belum dijawab sebagai "tidak dijawab" (0 poin)
        s.questions.forEach((q, qi) => {
            if (!s.answers.find(a => a.index === qi)) {
                answerQuestion(s, qi, null);
            }
        });
        const res = finishAssessment(s);
        asmUi = { view: 'result', resultId: res.result ? res.result.id : null };
        renderAssessmentCenter();
        return res;
    }
    function renderResultUI(r) {
        if (!r) return '<div class="p5-warn">Hasil tidak ditemukan.</div>';
        let html = '<div class="p5-asm-result">';
        html += '<div class="p5-module-head"><button class="btn-sm" onclick="Learning.asmHome()">← Kembali</button><h3>HASIL ASSESSMENT</h3></div>';
        html += '<div class="p5-result-score">' + r.percent + '% <span class="p5-mini">(' + r.score + '/' + r.total + ' poin)</span></div>' + p5bar(r.percent);
        html += '<div class="p5-card"><div class="p5-card-title">FEEDBACK</div>';
        html += r.feedback && r.feedback.length ? '<ul class="p5-lesson-list">' + r.feedback.slice(0, 6).map(f => '<li>✓ ' + esc(f) + '</li>').join('') + '</ul>' : '<div class="p5-muted">Belum ada feedback.</div>';
        html += '</div>';
        html += '<div class="p5-card"><div class="p5-card-title">REVIEW ANSWERS</div>';
        const review = getReview(r.id);
        html += review.map((v, i) => {
            let your = Array.isArray(v.your) ? v.your.join(', ') : (v.your === null || v.your === undefined ? '(tidak dijawab)' : v.your);
            let correct = Array.isArray(v.correct) ? v.correct.join(', ') : v.correct;
            return '<div class="p5-review-item"><div class="p5-q-opt ' + (v.correctFlag ? 'p5-fb-ok' : 'p5-fb-todo') + '">' + (v.correctFlag ? '✓' : '✕') + ' ' + esc(v.question) + '</div>'
                + '<div class="p5-review-line"><b>Jawaban Anda:</b> ' + esc(your) + (v.correctFlag ? '' : ' · <b>Benar:</b> ' + esc(correct)) + '</div>'
                + (settings.showCorrectAnswers ? '<div class="p5-mini">' + esc(v.explanation) + '</div>' : '') + '</div>';
        }).join('') || '<div class="p5-muted">—</div>';
        html += '</div>';
        if (r.recommendations && r.recommendations.length) {
            html += '<div class="p5-card"><div class="p5-card-title">LEARNING RECOMMENDATION</div>';
            html += r.recommendations.map(rec => '<div class="p5-lesson-row">→ ' + esc(rec.title) + '</div>').join('');
            html += '</div>';
        }
        if (r.moduleId && (CFG.mastery || {}).assessmentThreshold !== undefined && r.percent >= (CFG.mastery || {}).assessmentThreshold) {
            html += '<div class="p5-fb-ok">✓ Lulus ambang mastery modul ini.</div>';
        }
        html += '</div>';
        return html;
    }
    function renderPracticalUI() {
        const st = window.Phase4 ? window.Phase4.getDiagnosticState() : null;
        const rhs = computePracticalRubric();
        let html = '<div class="p5-asm-result">';
        html += '<div class="p5-module-head"><button class="btn-sm" onclick="Learning.asmHome()">← Kembali</button><h3>PRACTICAL ASSESSMENT</h3>'
            + '<button class="btn-ctrl" onclick="Learning.startPractical()">' + (st && st.active ? 'GANTI KASUS' : 'START CASE') + '</button></div>';
        if (!st || !st.active) {
            html += '<div class="p5-muted">Mulai kasus diagnosis (Phase 4) untuk penilaian praktik. Kerjakan: inspeksi → ukur → diagnosis → repair → verifikasi, lalu hitung rubric.</div>';
            html += '<button class="btn-ctrl" onclick="Learning.startPracticalDefault()">START NEW RANDOM CASE</button>';
        } else {
            html += '<div class="p5-lesson-row">Case: ' + esc(st.caseId || '') + ' · Status: ' + esc(st.status || '') + ' · Confidence: ' + esc(st.confidence || '') + '</div>';
            html += '<div class="p5-card"><div class="p5-card-title">RUBRIC (live)</div>' + rubricHtml(rhs.parts) + '<div class="p5-result-score">' + rhs.total + '/100</div></div>';
            html += '<button class="btn-ctrl" onclick="Learning.completePractical()">SIMPAN HASIL PRAKTIK</button>';
        }
        html += '</div>';
        return html;
    }
    function rubricHtml(parts) {
        return '<table class="p5-table"><thead><tr><th>Kriteria</th><th>Skor</th></tr></thead><tbody>'
            + parts.map(p => '<tr><td>' + esc(p.label) + '</td><td><b>' + p.value + '</b>/' + p.max + '</td></tr>').join('')
            + '</tbody></table>';
    }
    function launchAssessment() {
        const moduleId = getValOf('asm-module');
        const count = Number(getValOf('asm-count') || 5);
        const diff = getValOf('asm-diff');
        asmUi = { view: 'quiz', resultId: null };
        const r = startAssessment({ moduleId, questionCount: count, difficulty: diff });
        if (!r.ok) return r;
        asmQState = { answers: [], orderState: {} };
        renderAssessmentCenter();
        return r;
    }
    function getValOf(id) { const el = $('' + id); return el ? (el.value !== undefined ? el.value : '') : ''; }
    function startAssessmentForModule(moduleId) {
        const def = getAssessmentsFor(moduleId)[0] || {};
        asmUi = { view: 'quiz', resultId: null };
        asmQState = { answers: [], orderState: {} };
        const r = startAssessment({ moduleId, questionCount: def.questionCount || 5, difficulty: def.difficulty, types: def.types });
        renderAssessmentCenter();
        return r;
    }
    function showResult(id) { asmUi = { view: 'result', resultId: id }; renderAssessmentCenter(); }
    function showPractical() { asmUi = { view: 'practical', resultId: null }; renderAssessmentCenter(); }
    function asmHome() { asmUi = { view: 'home', resultId: null }; renderAssessmentCenter(); }
    function startPractical() { return startPracticalAssessment(null); }
    function startPracticalDefault() { const r = startPractical(null); renderAssessmentCenter(); return r; }
    function completePractical() { const r = completePracticalAssessment(); asmUi = { view: 'practical', resultId: null }; renderAssessmentCenter(); return r; }

    /* UI — PROGRESS PAGE (§29, §30, §31, §40, §36) */
    function renderProgressPage() {
        const el = $('p5-progress');
        if (!el) return;
        const idn = syncIdentity();
        const lk = idn ? idn.locked : {};
        const ro = (f) => lk[f] ? ' readonly aria-readonly="true" title="Terhubung ke akun — tidak dapat diubah di sini"' : '';
        const ov = computeOverallProgress();
        const cert = generateCertificate();
        let html = '<div class="p5-progress-page">';
        html += '<div class="p5-dash-head"><div><h2>LEARNING PROGRESS</h2><p class="p5-sub">Pantau modul, lesson, job sheet, assessment, dan target personal</p></div></div>';
        html += storageWarning();
        // overall
        html += '<div class="p5-card"><div class="p5-card-title">Overall</div>' + p5bar(ov.percent) + '<div class="p5-card-value">' + ov.percent + '%</div></div>';
        // summary grid
        html += '<div class="p5-dash-grid">'
            + '<div class="p5-card"><div class="p5-card-title">Modules</div><div class="p5-card-value">' + ov.modules.done + ' / ' + ov.modules.total + '</div></div>'
            + '<div class="p5-card"><div class="p5-card-title">Lessons</div><div class="p5-card-value">' + ov.lessons.done + ' / ' + ov.lessons.total + '</div></div>'
            + '<div class="p5-card"><div class="p5-card-title">Job Sheets</div><div class="p5-card-value">' + ov.jobSheets.done + ' / ' + ov.jobSheets.total + '</div></div>'
            + '<div class="p5-card"><div class="p5-card-title">Diagnostic Cases</div><div class="p5-card-value">' + ov.diagnostics.done + ' / ' + ov.diagnostics.total + '</div></div>'
            + '<div class="p5-card"><div class="p5-card-title">Assessments</div><div class="p5-card-value">' + (ov.assessments.avg === null ? '—' : 'Avg ' + ov.assessments.avg) + '</div></div>'
            + '</div>';
        // objective tracking per module
        html += '<div class="p5-card"><div class="p5-card-title">LEARNING OBJECTIVE TRACKING</div>';
        html += MODULES.map(m => {
            const objs = getObjectives(m.id).map(o => '<div class="p5-obj">' + statusBadge(o.status) + ' ' + esc(o.text) + '</div>').join('');
            return '<div class="p5-obj-mod"><strong>' + esc(m.title) + '</strong><div>' + objs + '</div></div>';
        }).join('');
        html += '</div>';
        // profile
        html += '<div class="p5-card"><div class="p5-card-title">STUDENT PROFILE</div><div class="p5-asm-form">'
            + '<label>Name <input type="text" id="pf-name"' + ro('name') + ' value="' + esc(profile.name) + '"></label>'
            + '<label>Class <input type="text" id="pf-klass"' + ro('kelas') + ' value="' + esc(profile.klass) + '"></label>'
            + '<label>Student ID <input type="text" id="pf-sid"' + ro('studentId') + ' value="' + esc(profile.studentId) + '"></label>'
            + '<button class="btn-ctrl" onclick="Learning.saveProfileFromUI()">SIMPAN PROFIL</button></div>'
            + (idn ? '<p class="p5-mini">Terhubung ke akun <b>' + esc(idn.username) + '</b>. Kolom yang terkunci mengikuti data akun.</p>' : '')
            + '</div>';
        // achievements
        html += '<div class="p5-card"><div class="p5-card-title">ACHIEVEMENTS (' + achievementsUnlockedCount() + '/' + ACH_DEFS.length + ')</div>'
            + '<div class="p5-ach-grid">' + getAchievements().map(a => '<div class="p5-ach ' + (a.unlocked ? 'p5-ach-unlocked' : 'p5-ach-locked') + '" title="' + esc(a.description) + '"><div class="p5-ach-icon">' + (a.unlocked ? a.icon : '🔒') + '</div><div class="p5-ach-title">' + esc(a.title) + '</div><div class="p5-mini">' + esc(a.description) + '</div></div>').join('') + '</div></div>';
        // data tools
        html += '<div class="p5-card"><div class="p5-card-title">DATA &amp; SETTINGS</div><div class="p5-asm-row gap8 flex-wrap">'
            + '<button class="btn-sm" onclick="Learning.exportDataDownload()">EXPORT LEARNING DATA</button>'
            + '<label class="btn-sm p5-file">IMPORT LEARNING DATA<input type="file" accept="application/json" onchange="Learning.importFromFile(this)" style="display:none"></label>'
            + '<button class="btn-sm p5-warn-btn" onclick="Learning.requestReset()">RESET MY PROGRESS</button>'
            + '<button class="btn-sm" onclick="Learning.printReport()">PRINT REPORT</button>'
            + '<button class="btn-sm" onclick="Learning.printCertificate()">PRINT CERTIFICATE</button></div>'
            + '<div class="p5-asm-row gap8 flex-wrap">'
            + '<label class="p5-override"><input type="checkbox" ' + (isOpenAll() ? 'checked' : '') + ' onchange="Learning.setOpenAll(this.checked)"> OPEN ALL MODULES (instructor/demo)</label>'
            + '<label class="p5-override"><input type="checkbox" ' + (settings.randomQuestions !== false ? 'checked' : '') + ' onchange="Learning.setSettings({randomQuestions:this.checked})"> Randomize questions</label>'
            + '<label class="p5-override"><input type="checkbox" ' + (settings.showCorrectAnswers ? 'checked' : '') + ' onchange="Learning.setSettings({showCorrectAnswers:this.checked})"> Show correct answers in review</label>'
            + '</div>'
            + (resetPending ? '<div class="p5-confirm" role="alertdialog" aria-label="Konfirmasi reset"><p>Are you sure? This will delete your local learning progress.</p>'
                + '<button class="btn-ctrl p5-danger" onclick="Learning.confirmReset()">YA, RESET</button> '
                + '<button class="btn-sm" onclick="Learning.cancelReset()">BATAL</button></div>' : '')
            + '</div>';
        // skill scores
        const skills = skillSummary();
        html += '<div class="p5-card"><div class="p5-card-title">SKILL SCORES (terpisah — §26)</div>'
            + '<table class="p5-table"><thead><tr><th>Knowledge</th><th>Practical Skill</th><th>Diagnosis</th></tr></thead><tbody>'
            + '<tr><td>' + (skills.knowledge === null ? '—' : skills.knowledge) + '</td><td>' + (skills.practical === null ? '—' : skills.practical) + '</td><td>' + (skills.diagnostic === null ? '—' : skills.diagnostic) + '</td></tr></tbody></table></div>';
        // report print area
        html += '<div class="p5-print" id="p5-report-print"></div>';
        html += '<div class="p5-print" id="p5-cert-print"></div>';
        html += certCard(cert);
        html += instructorCard();
        html += '</div>';
        $('p5-module') === null ? 0 : 0;
        el.innerHTML = html;
    }
    function certCard(cert) {
        if (!cert) return '';
        return '<div class="p5-card"><div class="p5-card-title">COMPLETION &amp; CERTIFICATE</div>'
            + '<div class="p5-cert" id="p5-cert-view"><div class="p5-cert-title">CERTIFICATE OF COMPLETION</div>'
            + '<p>This certifies that</p><div class="p5-cert-name">' + esc(cert.studentName) + '</div>'
            + '<p>has completed the</p><div class="p5-cert-course">' + esc(cert.courseName) + '</div>'
            + '<p>Completion: <b>' + cert.completionPercentage + '%</b> · Avg score: <b>' + cert.averageScore + '</b>'
            + (cert.completedAt ? ' · Tanggal: ' + esc(new Date(cert.completedAt).toLocaleDateString()) : '') + '</p>'
            + '<div class="p5-mini">Certificate of Completion — bukan sertifikat profesi resmi.</div></div></div>';
    }
    function instructorCard() {
        const d = getInstructorDashboard();
        return '<div class="p5-card"><div class="p5-card-title">INSTRUCTOR DASHBOARD (demo)</div><p class="p5-sub">' + esc(d.note) + '</p>'
            + '<table class="p5-table"><thead><tr><th>Students</th><th>Average Score</th><th>Completed</th><th>In Progress</th><th>Needs Review</th></tr></thead><tbody>'
            + '<tr><td>' + d.students + '</td><td>' + d.averageScore + '</td><td>' + d.completed + '</td><td>' + d.inProgress + '</td><td>' + d.needsReview + '</td></tr></tbody></table></div>';
    }
    function saveProfileFromUI() {
        return saveProfile({ name: getValOf('pf-name'), klass: getValOf('pf-klass'), studentId: getValOf('pf-sid') });
    }
    function exportDataDownload() {
        const data = exportData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'starter-learning-data-v' + VERSION + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL && URL.revokeObjectURL(url), 2000);
        return data;
    }
    function importFromFile(input) {
        if (!input || !input.files || !input.files[0]) return { ok: false, reason: 'NO_FILE' };
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = () => {
            const r = importData(String(reader.result || ''));
            if (r.ok) { renderDashboard(); renderProgressPage(); renderAssessmentCenter(); renderJobSheets(); }
            return r;
        };
        reader.readAsText(file);
        return { ok: true };
    }
    function printReport() {
        const el = $('p5-report-print');
        if (el) { el.innerHTML = reportPrintHtml(); window.print && window.print(); }
    }
    function printCertificate() {
        const el = $('p5-cert-print');
        if (el) { el.innerHTML = '<div class="js-print cert-print">' + certCard(generateCertificate()) + '</div>'; window.print && window.print(); }
    }
    function reportPrintHtml() {
        syncIdentity();
        const rep = generateReport();
        const rows = (arr) => arr.map(a => '<tr><td>' + esc(a.id) + '</td><td>' + esc(a.title || '') + '</td><td>' + (a.completed ? '✓' : (a.progress ? a.progress.lessonsDone + '/' + a.progress.lessonsTotal : '—')) + '</td></tr>').join('');
        return '<div class="js-print p5-report-print"><h2>STUDENT PRACTICAL REPORT</h2>'
            + '<p>Student: ' + esc(profile.name) + ' · Class: ' + esc(profile.klass) + ' · ID: ' + esc(profile.studentId) + '</p>'
            + '<h3>Modules</h3><table class="p5-table"><thead><tr><th>Id</th><th>Modul</th><th>Progress</th></tr></thead><tbody>' + rep.modules.map(m => '<tr><td>' + esc(m.id) + '</td><td>' + esc(m.title) + '</td><td>' + m.progress.lessonsDone + '/' + m.progress.lessonsTotal + ' · mastery ' + m.mastery.percent + '%</td></tr>').join('') + '</tbody></table>'
            + '<h3>Lessons</h3><table class="p5-table"><thead><tr><th>Lesson</th><th>Done</th><th>Time</th></tr></thead><tbody>' + rep.lessons.map(l => '<tr><td>' + esc(l.title) + '</td><td>' + (l.completed ? '✓' : '—') + '</td><td>' + Math.round(l.timeMs / 1000) + 's</td></tr>').join('') + '</tbody></table>'
            + '<h3>Job Sheets</h3><table class="p5-table"><thead><tr><th>Job Sheet</th><th>Completed</th></tr></thead><tbody>' + rep.jobSheets.map(j => '<tr><td>' + esc(j.title) + '</td><td>' + (j.completed ? '✓' : '—') + '</td></tr>').join('') + '</tbody></table>'
            + '<h3>Diagnostic Cases</h3><table class="p5-table"><thead><tr><th>Case</th><th>Status</th><th>Score</th></tr></thead><tbody>' + rep.diagnostics.map(d => '<tr><td>' + esc(d.caseId || '') + '</td><td>' + esc(d.status || '') + '</td><td>' + (d.total || '') + '</td></tr>').join('') + '</tbody></table>'
            + '<p>Knowledge: <b>' + (rep.knowledgeScore === null ? '—' : rep.knowledgeScore) + '</b> · Practical: <b>' + (rep.practicalScore === null ? '—' : rep.practicalScore) + '</b> · Diagnostic: <b>' + (rep.diagnosticScore === null ? '—' : rep.diagnosticScore) + '</b></p>'
            + '<p>Overall Progress: <b>' + rep.overallProgress.percent + '%</b></p></div>';
    }

    /* UI — JOB SHEET PAGE (§14) */
    function renderJobSheets() {
        const el = $('p5-jobsheets');
        if (!el) return;
        let html = '<div class="p5-dash-head"><div><h2>JOB SHEET DIGITAL</h2><p class="p5-sub">Lembar kerja digital: tujuan, alat, keselamatan, langkah, hasil, kesimpulan</p></div></div>';
        html += '<div class="p5-js-list">';
        html += JOB_SHEETS.map(js => {
            const done = !!(P.jobSheets[js.id] && P.jobSheets[js.id].completed);
            return '<div class="p5-lesson-row ' + (done ? 'p5-done' : '') + '"><button class="btn-sm" onclick="Learning.openJobSheet(\'' + esc(js.id) + '\')">' + (done ? '✓ ' : '') + esc(js.id) + ' — ' + esc(js.title) + '</button></div>';
        }).join('');
        html += '</div><div id="p5-jobsheet-detail"></div>';
        el.innerHTML = html;
    }
    function openJobSheet(id) {
        const js = getJobSheet(id);
        if (!js) return { ok: false };
        startJobSheet(id);
        return { ok: true };
    }
    function renderJobSheet(id) {
        const el = $('p5-jobsheet-detail');
        if (!el) return;
        const js = getJobSheet(id);
        if (!js) { el.innerHTML = '<div class="p5-warn">Job sheet ' + esc(id) + ' tidak ditemukan.</div>'; return; }
        const r = getJobSheetResult(id);
        const val = jobSheetValidation(id);
        const measRows = r.measurements.length ? r.measurements.map(m => '<tr><td>' + esc(m.red + '→' + m.black) + '</td><td>' + esc(m.value !== null && m.value !== undefined ? m.value + ' ' + (m.unit || '') : 'OL') + '</td><td>' + esc(m.systemState || '') + '</td></tr>').join('')
            : '<tr><td colspan="3" class="p5-muted">Belum ada pengukuran — gunakan MULTIMETER lalu SIMPAN.</td></tr>';
        let html = '<div class="p5-js-panel js-print" id="p5-js-sheet">';
        html += '<div class="p5-module-head"><button class="btn-sm" onclick="Learning.forceRenderJS()">← Daftar</button><h3>' + esc(js.id) + ' — ' + esc(js.title) + '</h3></div>';
        html += '<div class="p5-card"><div class="p5-card-title">TUJUAN</div><p class="p5-lesson-text">' + esc(js.objective) + '</p></div>';
        html += '<div class="p5-card"><div class="p5-card-title">ALAT</div><div class="p5-lesson-list">' + js.tools.map(t => '<li>' + esc(t) + '</li>').join('') + '</div></div>';
        html += '<div class="p5-card"><div class="p5-card-title">KESELAMATAN</div><div class="p5-lesson-list"><span class="p5-warn">' + js.safety.map(s => esc(s)).join('<br>') + '</span></div></div>';
        html += '<div class="p5-card"><div class="p5-card-title">LANGKAH</div><ol class="p5-lesson-list">' + js.procedure.map(p => '<li>' + esc(p) + '</li>').join('') + '</ol></div>';
        html += '<div class="p5-card"><div class="p5-card-title">HASIL PENGUKURAN' + (r.instrument ? ' <span class="p5-mini">(normal: ' + esc(r.instrument.normalRange) + ')</span>' : '') + '</div>'
            + '<table class="p5-table"><thead><tr><th>Probe</th><th>Nilai</th><th>State</th></tr></thead><tbody>' + measRows + '</tbody></table></div>';
        html += '<div class="p5-card"><div class="p5-card-title">OBSERVATION NOTES</div><textarea class="p5-textarea" id="js-obs" rows="2" placeholder="Apa yang Anda amati?">' + esc(r.observations) + '</textarea></div>';
        (js.questions || []).forEach((qq, qi) => {
            html += '<div class="p5-card"><div class="p5-card-title">PERTANYAAN ' + (qi + 1) + ' <span class="p5-mini">' + esc(qq.expect || '') + '</span></div>'
                + '<textarea class="p5-textarea" id="js-ans-' + qi + '" rows="2" placeholder="Jawaban Anda...">' + esc((r.answers && r.answers[qi]) || '') + '</textarea></div>';
        });
        html += '<div class="p5-card"><div class="p5-card-title">KESIMPULAN</div><textarea class="p5-textarea" id="js-concl" rows="2" placeholder="Berdasarkan hasil pemeriksaan...">' + esc(r.conclusion) + '</textarea></div>';
        html += '<div class="p5-asm-row gap8">'
            + '<button class="btn-ctrl" onclick="Learning.saveJobSheetFromView(\'' + esc(id) + '\')">SIMPAN</button>'
            + '<button class="btn-ctrl" onclick="Learning.completeJobSheetFromView(\'' + esc(id) + '\')">TANDAI SELESAI</button>'
            + '<button class="btn-sm" onclick="Learning.printJobSheet(\'' + esc(id) + '\')">PRINT</button></div>';
        html += (r.completed ? '<div class="p5-fb-ok">JOB SHEET SELESAI ✓ · ' + esc(new Date(r.completedAt).toLocaleString()) + '</div>' : '')
            + (val.ok && !r.completed ? '<div class="p5-fb-ok">Semua field wajib terisi — siap disimpan sebagai selesai.</div>' : '');
        html += '</div>';
        el.innerHTML = html;
    }
    function forceRenderJS() { renderJobSheets(); }
    function saveJobSheetFromView(id) {
        const js = getJobSheet(id);
        const answers = (js.questions || []).map((_, qi) => getValOf('js-ans-' + qi));
        const r = saveJobSheet(id, { observations: getValOf('js-obs'), answers, conclusion: getValOf('js-concl') });
        renderJobSheet(id);
        return r;
    }
    function completeJobSheetFromView(id) {
        saveJobSheetFromView(id);
        const res = completeJobSheet(id);
        renderJobSheet(id);
        renderDashboard();
        renderJobSheets();
        return res;
    }
    function printJobSheet(id) {
        const el = $('p5-jobsheet-detail');
        if (el) { window.print && window.print(); }
    }

    /* ============================================================
       INIT + RENDER ALL
       ============================================================ */
    function renderAll() {
        renderDashboard();
        renderAssessmentCenter();
        renderProgressPage();
        renderJobSheets();
    }
    function init() {
        // Petakan 14 topik materi lama ke lesson Phase 5 (keep Phase 1 intact).
        // Sinkronkan penilaian Phase 4/Phase 3 tanpa interference.
        checkAchievements();
        renderAll();
        if (typeof console !== 'undefined') console.log('Phase 5 — Learning & Assessment Laboratory initialized.');
    }

    /* ============================================================
       PUBLIC API
       ============================================================ */
    window.Learning = window.Phase5 = {
        active: true,
        version: VERSION,

        // profile & settings
        getProfile: () => Object.assign({}, profile),
        saveProfile,
        getSettings,
        setSettings,
        getConfig: () => CFG,

        // storage
        exportData,
        importData,
        exportDataDownload,
        importFromFile,
        requestReset,
        confirmReset,
        cancelReset,
        isStorageOk: () => storageOk,

        // modules & path
        getModules,
        getModule,
        getObjectives,
        isModuleUnlocked,
        setOpenAll,
        isOpenAll,
        modulesUnlocked,
        startModule,
        moduleProgress,
        computeMastery,
        getLearningRecord,

        // lessons
        getLesson,
        getLessonSections,
        startLesson,
        completeLesson,
        completeLessonFromView,
        openLesson,
        openModule,
        backToDashboard,
        backToModule,
        showComponentInfo,
        goSimulator,
        open3DDemo,

        // practices
        practiceDefs,
        getPractice,
        getPracticeSteps,
        startPractice,
        checkPractice,
        checkPracticeStep,
        checkAllSteps,
        orderPick,
        orderClear,
        setPracticeSequence,
        setPracticeLevel,
        completePractice,
        closePractice,

        // job sheets
        getJobSheets,
        getJobSheet,
        startJobSheet,
        saveJobSheet,
        completeJobSheet,
        getJobSheetResult,
        openJobSheet,
        saveJobSheetFromView,
        completeJobSheetFromView,
        printJobSheet,
        forceRenderJS,
        renderJobSheet,
        jobSheetValidation,
        jobSheetsDoneCount,

        // quiz / assessment
        generateAssessment,
        startAssessment,
        activeSession,
        abortAssessment,
        answerQuestion,
        finishAssessment,
        finishAssessmentNow,
        answerAndAdvance,
        launchAssessment,
        startAssessmentForModule,
        getAssessmentResults,
        getAssessmentResult,
        getReview,
        getAssessmentFeedback,
        getRecommendations,
        showResult,
        asmHome,
        toggleMR,
        submitMR,
        submitMatch,
        submitOrder,
        orderPickQ,
        orderClearQ,
        assessmentAverage,
        bestAssessmentFor,

        // practical
        startPracticalAssessment,
        startPractical,
        startPracticalDefault,
        computePracticalRubric,
        completePracticalAssessment,
        completePractical,
        showPractical,
        getDiagnosticHistory,
        getRubricLive: computePracticalRubric,
        diagnosticsDoneCount,

        // progress / achievements / report
        computeOverallProgress,
        checkAchievements,
        getAchievements,
        generateReport,
        generateCertificate,
        getInstructorDashboard,
        reportPrintHtml,
        printReport,
        printCertificate,
        skillSummary,
        saveProfileFromUI,
        renderAll,
        renderDashboard,
        renderModule,
        renderProgressPage,
        renderAssessmentCenter,
        renderJobSheets,
    };

    if (document && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();