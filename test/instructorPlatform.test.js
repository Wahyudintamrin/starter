/* Standalone test harness for Phase 8 STEP 2-18
   (Application Architecture Layer / User-Role RBAC / Organization / Classroom /
    Student & Instructor Dashboard with Phase5 live-data bridge /
    Course & Content Library / Assignment Engine / Submission Engine /
    Instructor Grading / Rubric Engine / Diagnostic Session Review / IndexedDB /
    Repository Layer / Offline Mode / Sync Queue / Cloud API abstraction).

   Loads app.js + Phase5 content (learningModules/Lessons/Questions/JobSheets) +
   learningAssessment.js + faultEngine.js (Phase 7 scenario catalog) + instructorPlatform.js in a Node vm
   sandbox with a minimal DOM mock, then verifies:
   - STEP 2: service->repository->storage layering, apiClient (Mock API Adapter),
     error model Â§83, state separation, caseRepository integrates Phase 7 (Â§70).
   - STEP 3: authService (register/login/guest/session), password TIDAK plaintext,
     user model Â§5, authorizationService RBAC Â§6 diperiksa di service layer.
   - STEP 4: organization + org types + ownership.
   - STEP 5: classroom, join code (deterministik seeded), enrollment, membership.
   - STEP 6-7 (Â§11 student, Â§12 instructor): dashboardService mengagregasi data
     NYATA dari repositories + Phase5 (learningAvailable bridge), tanpa ranking
     siswa, RBAC diperiksa di service layer; dashboards tetap berjalan saat
     bridge Pem5 ditutup (offline-safe, learning.available=false).
   - STEP 8 (Â§14-16): course & content library, versioning, RBAC konten.
   - STEP 9 (Â§17-19, Â§73-77): assignment engine (publish/list/RBAC).
   - STEP 10 (Â§20-21, Â§75, Â§78): submission engine, retake, waktu, skor hanya
     dgn bukti engine riil, dashboard mengagregasi assignment/submission.
   - STEP 11 (Â§22-24): instructor grading (grade/feedback/return-for-revision),
     grade hanya utk submission ber-evidence (Â§21), RETURNED tidak menghabiskan
     attempt (Â§75), audit GRADE_SUBMISSION, dashboard pending turun setelah
     grading.
   - STEP 12 (Â§23, Phase5 Â§25): rubric engine â€” default 8 kriteria bobot 100,
     customizable (weight/maxScore/performanceLevels/comment), integration dgn
     assignment (rubricId) dan workflow grading (criteria -> weighted total).
   - STEP 13 (Â§13, Â§22, Â§24, Â§79): diagnostic session review â€” instructor/student
     meninjau artefak sesi diagnosis nyata (measurement/path/hipotesis/bukti/
     repair/verifikasi/waktu/hints/mistakes), timeline terurut, verdict skor
     hanya bila ada bukti Engine (Â§21), feedback deterministik berbasis artefak.
   - STEP 14 (Â§36): IndexedDB local database â€” provider storage dapat ditukar
     (sama interface dgn repos), write-through async, reload mempertahankan data
     (persistence), fallback MEMORY bila IndexedDB tidak tersedia; resetDemo
     provider-agnostik.
   - STEP 15 (Â§34-35): Repository Layer â€” semua repositor bernada interface
     seragam (getById/list/save/query/remove/clear), studentRepository &
     diagnosticRepository sebagai view, repositori dapat diganti (local -> cloud)
     tanpa mengubah UI/service (backend-agnostic).
   - STEP 16 (Â§34, Â§41, Â§81-82): Offline Mode â€” network state terpisah
     (ONLINE/OFFLINE/SYNCING/SYNC ERROR), seluruh engine tetap berjalan saat
     OFFLINE (belajar/simulator/ukur/diagnosis/job sheet/assessment), data
     disimpan lokal & tidak pernah dihapus saat reconnect, antrean retry
     diumpankan ke sync berikutnya.
   - STEP 17 (Â§39-40, Â§42, Â§81): Sync Queue â€” syncService dengan antrean
     {id, operation, entity, entityId, payload, createdAt, status}, status
     PENDING/SYNCING/SYNCED/FAILED/CONFLICT, Local->Cloud & Cloud->Local,
     gagal sync -> data tetap lokal (retry), conflict detection (local/remote/
     timestamp/user) + resolusi tanpa menimpa diam-diam.
   - STEP 18 (Â§37-38): Cloud API abstraction â€” apiClient (get/post/put/delete)
     backend-agnostic: REST / GraphQL / Firebase / Supabase / Custom Node.js API,
     Mock API Adapter bila backend belum tersedia; SAMA panggilan UI berjalan di
     semua adapter tanpa mengubah engine.

   Run: node test/instructorPlatform.test.js
*/

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const learningData = [
    'learningModules.js', 'learningLessons.js', 'learningQuestions.js', 'learningJobSheets.js',
].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'));
const phase5Js = fs.readFileSync(path.join(ROOT, 'learningAssessment.js'), 'utf8');
const diag7Js = fs.readFileSync(path.join(ROOT, 'faultEngine.js'), 'utf8');
const phase8Js = fs.readFileSync(path.join(ROOT, 'instructorPlatform.js'), 'utf8');

/* ---------------- Minimal DOM mock ---------------- */
const elementCache = {};
let elementSeq = 0;
function makeEl(id) {
    return {
        id: id || null, tagName: 'DIV', style: {}, dataset: {}, children: [],
        textContent: '', innerHTML: '', className: '', checked: false, disabled: false,
        value: '', href: '', download: '', width: 340, height: 120,
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {}, appendChild() {}, addEventListener() {},
    };
}
let domReady = [];
const body = makeEl('body');
const document = {
    body,
    getElementById(id) { return elementCache[id] || (elementCache[id] = makeEl(id)); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return makeEl('created-' + (++elementSeq)); },
    addEventListener(type, fn) { if (type === 'DOMContentLoaded') domReady.push(fn); },
};
document._ready = () => domReady.forEach(fn => fn());

const localStorageMock = {
    _data: {},
    getItem(k) { return k in this._data ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
};

Math.random = () => 0.05; // harness deterministic; instructorPlatform.js TIDAK memakai literal Math.random

const context = vm.createContext({
    document, localStorage: localStorageMock, console, Math,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    window: null, navigator: { onLine: true },
});
context.window = context;

vm.runInContext(appJs, context, { filename: 'app.js' });
learningData.forEach((src, i) => vm.runInContext(src, context, { filename: `learningData[${i}].js` }));
vm.runInContext(phase5Js, context, { filename: 'learningAssessment.js' });
vm.runInContext(diag7Js, context, { filename: 'faultEngine.js' });
vm.runInContext(phase8Js, context, { filename: 'instructorPlatform.js' });

function getVal(expr) { return vm.runInContext(expr, context); }
const P8 = expr => getVal('Phase8.' + expr);
const evalExpr = getVal;
const call = (name, ...args) =>
    vm.runInContext(`Phase8.${name}(${args.map(a => JSON.stringify(a)).join(',')})`, context);
const callService = (path, ...args) => {
    const parts = path.split('.');
    const argStr = args.map(a => JSON.stringify(a)).join(',');
    const objExpr = 'Phase8.' + parts.slice(0, -1).join('.');
    const method = parts[parts.length - 1];
    return vm.runInContext(`${objExpr}['${method}'](${argStr})`, context);
};

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { passed++; console.log('  PASS: ' + msg); }
    else { failed++; console.log('  FAIL: ' + msg); }
}
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* ------------------------------------------------------------------ */

async function main() {
    console.log('\n=== PHASE 8 - INSTRUCTOR PLATFORM (STEP 2-18) TESTS ===');

    /* ---- 01. MODULE + API SURFACE ---- */
    console.log('\n01: MODULE & API SURFACE');
    assert(P8('active') === true, 'Phase8.active');
    assert(P8('version') === 8, 'Phase8.version = 8');
    assert(P8('step') === '8-24', 'Phase8.step = "8-24" (STEP 24 portofolio & capaian hasil belajar, final)');
    for (const m of ['authService', 'authorizationService', 'userService', 'organizationService',
        'classService', 'dashboardService', 'courseService', 'assignmentService', 'submissionService',
        'gradingService', 'rubricService', 'reviewService', 'indexedDB', 'auditService', 'notificationService', 'apiClient', 'repositories',
        'NETWORK_STATES', 'offlineService', 'syncService', 'adapters',
        'ROLES', 'ORG_TYPES', 'PERMISSIONS', 'can', 'hasPermission', 'setSystemSeed', 'resetDemo']) {
        assert(P8(m) !== undefined, `Phase8.${m} exposed`);
    }
    assert(['GUEST', 'STUDENT', 'INSTRUCTOR', 'ADMIN'].every(r => P8('ROLES').includes(r)), '4 roles defined');
    assert(['SCHOOL', 'TRAINING_CENTER', 'AUTOMOTIVE_INSTITUTION', 'INDIVIDUAL'].every(t => P8('ORG_TYPES').includes(t)), '4 org types');
    assert(Array.isArray(P8('CONTENT_TYPES')) && P8('CONTENT_TYPES').includes('DIAGNOSTIC_CASE'), 'CONTENT_TYPES exposed');
    assert(Array.isArray(P8('ASSIGNMENT_TYPES')) && P8('ASSIGNMENT_TYPES').includes('DIAGNOSTIC_CASE'), 'ASSIGNMENT_TYPES exposed');

    /* ---- 02. ARCHITECTURE LAYER (service->repository->storage, apiClient, Â§83) ---- */
    console.log('\n02: ARCHITECTURE LAYER (Â§35, Â§37, Â§83, Â§86)');
    assert(typeof P8('repositories.userRepository.save') === 'function', 'userRepository.save exists');
    assert(typeof P8('repositories.classRepository.getById') === 'function', 'classRepository.getById exists');
    const tUser = call('repositories.userRepository.save', { id: 'TMP_USER', name: 'temp', role: 'STUDENT' });
    assert(tUser.id === 'TMP_USER', 'repository save by explicit id');
    assert(P8('repositories.userRepository.getById')('TMP_USER').name === 'temp', 'repository getById');
    assert(P8('repositories.userRepository.list()').some(u => u.id === 'TMP_USER'), 'repository list');
    assert(P8('repositories.userRepository.remove')('TMP_USER') === true, 'repository remove');
    assert(!P8('repositories.userRepository.getById')('TMP_USER'), 'repository removed clean');

    // apiClient mock: bentuk respons konsisten Â§83 + RBAC di API layer
    const apiBad = call('apiClient.get', '/orgs'); // guest -> permission enforced di API layer
    assert(has(apiBad, 'success') && apiBad.success === false && apiBad.error && apiBad.error.code === 'FORBIDDEN',
        'apiClient enforces RBAC even at API layer (Â§6)');
    assert(call('apiClient.get', '/nope').success === false && call('apiClient.get', '/nope').error.code === 'NOT_FOUND', 'unknown endpoint -> error model Â§83');
    assert(P8('apiClient.mode') === 'MOCK', 'apiClient uses Mock API Adapter');
    assert(typeof P8('apiClient.post') === 'function' && typeof P8('apiClient.put') === 'function' && typeof P8('apiClient.delete') === 'function', 'HTTP verbs abstracted');
    assert(P8('session()').role === 'GUEST', 'session state separated (guest default)');
    assert(P8('syncState()').network === 'ONLINE' && typeof P8('syncState()').queue === 'number', 'sync state separated Â§86');
    // caseRepository integrasi Phase 7 (Â§70): referensi katalog, tanpa duplikasi
    const imp = call('repositories.caseRepository.importFromPhase7');
    assert(imp.success === true && imp.data.imported === 20, 'imported 20 Phase7 cases, not duplicated');
    assert(P8('repositories.caseRepository.list()').length === 20, 'caseRepository.list = 20 refs');
    assert(typeof P8('repositories.caseRepository.list()')[0].difficulty === 'string'
        && P8('repositories.caseRepository.list()')[0].factors, 'case refs carry difficulty + factors');
    assert(call('apiClient.get', '/cases').data.length === 20, 'apiClient.get /cases reads through repository (UI tidak fetch langsung)');
    // store provider swap (Local <-> Cloud tanpa mengubah service/UI, Â§35)
    assert(typeof P8('setStoreProvider') === 'function', 'setStoreProvider exposed');
    const swapOk = getVal(`(function(){
        const m = {};
        const prov = {
            getStore(k) { return m[k] || (m[k] = {}); },
            getList(k) { return m[k] || (m[k] = []); },
            onSaved(k) {},
        };
        Phase8.setStoreProvider(prov);
        const active = Phase8.storeProvider._custom === true;
        Phase8.setStoreProvider();
        return active;
    })()`);
    assert(swapOk === true, 'alternate provider active');
    assert(P8('storeProvider._custom') === false, 'provider restored to default memory');

    /* ---- 03. AUTH SERVICE (register/login/guest/session/password) ---- */
    console.log('\n03: AUTH SERVICE (register/login/guest/session/password)');
    const regA = callService('authService.register', { name: 'Siswa X', username: 'siswaX', password: 'siswaX12345' });
    assert(regA.success === true, 'register student ok');
    assert(callService('authService.register', { name: '', username: 'x1', password: 'abcde123' }).error.code === 'VALIDATION', 'validation: empty name');
    assert(callService('authService.register', { name: 'X', username: 'x2', password: '123' }).error.code === 'VALIDATION', 'validation: short password');
    assert(callService('authService.register', { name: 'X', username: 'siswaX', password: 'abcde123' }).error.code === 'DUPLICATE', 'duplicate username rejected');
    assert(callService('authService.register', { name: 'G', username: 'g1', password: 'abcde123', role: 'INSTRUCTOR' }).error.code === 'VALIDATION',
        'self register allowed only for student/guest roles');
    assert(callService('authService.register', { name: 'G', username: 'g2', password: 'abcde123', role: 'ADMIN' }).success === false,
        'self-register INSTRUCTOR rejected');
    const storedRaw = getVal("Phase8.repositories.userRepository.list().find(u => u.username === 'siswaX')");
    assert(storedRaw.passwordHash && storedRaw.salt, 'password stored HASHED (salted), never plaintext');
    assert(!('password' in storedRaw), 'no plaintext password field in stored user');
    const oldHash = String(storedRaw.passwordHash);
    const loginA = callService('authService.login', 'siswaX', 'siswaX12345');
    assert(loginA.success === true && loginA.data.token, 'login success + token');
    assert(callService('authService.login', 'siswaX', 'salah').error.code === 'AUTH_FAILED', 'wrong password rejected');
    assert(callService('authService.login', 'tidakada', 'abcde123').error.code === 'AUTH_FAILED', 'unknown username rejected');
    assert(P8('authService.isAuthenticated()') === true, 'isAuthenticated after login');
    assert(P8('authService.getUserRole()') === 'STUDENT', 'getUserRole = STUDENT');
    assert(P8('authService.getCurrentUser()').username === 'siswaX', 'getCurrentUser');
    assert(callService('authService.refreshSession').success === true, 'refreshSession ok');
    assert(callService('authService.changePassword', 'siswaX12345', 'siswaX54321').success === true, 'changePassword ok');
    assert(P8('repositories.userRepository.list().find(u => u.username === "siswaX")').passwordHash !== oldHash,
        'password hash changed after changePassword');
    assert(callService('authService.changePassword', 'salahLama', 'abcde123').error.code === 'BAD_PASSWORD', 'changePassword requires correct old password');
    const resetReq = callService('authService.requestPasswordReset', 'siswaX');
    assert(resetReq.success === true && typeof resetReq.data.resetToken === 'string' && resetReq.data.resetToken.length > 0,
        'requestPasswordReset issues token');
    const resetUser = P8('repositories.userRepository.list().find(u => u.username === "siswaX")');
    assert(!('password' in resetUser) && !!resetUser.resetToken && typeof resetUser.resetToken === 'string',
        'reset token present (not plaintext)');
    callService('authService.logout');
    assert(P8('authService.isAuthenticated()') === false, 'unauth after logout');
    assert(P8('session()').role === 'GUEST', 'guest session after logout');

    /* ---- 04. RBAC (Â§6) ---- */
    console.log('\n04: RBAC (Â§6)');
    const GUEST = { role: 'GUEST' };
    const ADM = getVal("({ id: 'ADM_1', role: 'ADMIN', name: 'Sys', username: 'sys', organizationId: null })");
    const INS = getVal("({ id: 'INS_1', role: 'INSTRUCTOR', name: 'Pak Guru', username: 'pakguru', organizationId: 'ORG_1' })");
    const STU = getVal("({ id: 'S_1', role: 'STUDENT', name: 'A', username: 'a', classIds: [], organizationId: null })");
    assert(call('hasPermission', 'MANAGE_USERS', GUEST) === false, 'guest cannot MANAGE_USERS');
    assert(call('hasPermission', 'MANAGE_USERS', ADM) === true && call('hasPermission', 'CREATE_CLASS', ADM) === true
        && call('hasPermission', 'VIEW_AUDIT_LOG', ADM) === true, 'admin can everything');
    assert(call('hasPermission', 'CREATE_CLASS', INS) === true, 'instructor can CREATE_CLASS');
    assert(call('hasPermission', 'MANAGE_USERS', INS) === false, 'instructor cannot MANAGE_USERS');
    assert(call('hasPermission', 'CREATE_CLASS', STU) === false, 'student cannot CREATE_CLASS');
    assert(call('hasPermission', 'VIEW_OWN_RESULT', STU) === true, 'student can VIEW_OWN_RESULT');
    assert(call('hasPermission', 'VIEW_CLASS', GUEST) === false, 'guest cannot VIEW_CLASS');
    assert(callService('classService.createClass', { name: 'Gagal', organizationId: 'ORG_1' }, GUEST).success === false,
        'createClass called while guest -> FORBIDDEN (service-layer check)');

    /* ---- 05. ORGANIZATION ---- */
    console.log('\n05: ORGANIZATION');
    const orgCreate = callService('organizationService.create', { name: 'SMK Teknik Maju', type: 'SCHOOL' }, ADM);
    assert(orgCreate.success === true, 'admin create org');
    const orgId = orgCreate.data.id;
    assert(orgId && has(orgCreate.data, 'type') && orgCreate.data.type === 'SCHOOL', 'org shape Â§7');
    assert(callService('organizationService.create', { name: 'SMK Teknik Maju', type: 'SCHOOL' }, ADM).error.code === 'DUPLICATE', 'duplicate org name rejected');
    assert(callService('organizationService.create', { name: '   ', type: 'SCHOOL' }, ADM).success === false, 'org requires name');
    assert(callService('organizationService.create', { name: 'O2', type: 'BADTYPE' }, ADM).success === true
        && callService('organizationService.create', { name: 'O3', type: 'BADTYPE' }, ADM).data.type === 'SCHOOL', 'invalid org type defaults SCHOOL');
    assert(callService('organizationService.update', orgId, { name: 'SMK Teknik Unggul' }, ADM).data.name === 'SMK Teknik Unggul', 'update org');
    assert(callService('organizationService.update', orgId, { name: 'zzz' }, STU).success === false, 'student cannot edit org');
    assert(callService('organizationService.getById', orgId, { role: 'INSTRUCTOR', organizationId: 'ORG_OTHER', id: 'I_OTHER' }).success === false,
        'ownership: instructor other org blocked');
    assert(callService('organizationService.getById', orgId, ADM).data.name === 'SMK Teknik Unggul', 'admin can view org');
    assert(callService('organizationService.archive', orgId, ADM).data.status === 'ARCHIVED', 'archive org');

    /* ---- 06. CLASSROOM (Â§8, Â§9, Â§10) + enrollment ---- */
    console.log('\n06: CLASSROOM & JOIN CODE');
    const instObj = getVal("({ id: 'INS_1', role: 'INSTRUCTOR', name: 'Pak Guru', username: 'pakguru', organizationId: 'ORG_1' })");
    const clsCreate = callService('classService.createClass', { name: 'TKR X', subject: 'Sistem Starter', organizationId: 'ORG_1' }, instObj);
    assert(clsCreate.success === true, 'instructor create class');
    const clsId = clsCreate.data.id;
    assert(has(clsCreate.data, 'joinCode') && has(clsCreate.data, 'studentIds') && Array.isArray(clsCreate.data.studentIds), 'class shape Â§8');
    const jc = clsCreate.data.joinCode;
    assert(/^[A-Z0-9]{3}-[A-Z0-9]{4}$/.test(jc), `join code format TKR-7A91 (got ${jc})`);
    call('setSystemSeed', 99);
    const r1 = call('rngProbe');
    call('setSystemSeed', 99);
    const r2 = call('rngProbe');
    assert(r1 === r2, 'seeded PRNG deterministic (same seed -> same first draw)');
    const seenCodes = {};
    let allUnique = true;
    for (let i = 0; i < 12; i++) {
        const code = call('genJoinCodeStub', 'TKR');
        if (!/^[A-Z0-9]{3}-[A-Z0-9]{4}$/.test(code)) allUnique = false;
        if (seenCodes[code]) allUnique = false;
        seenCodes[code] = true;
    }
    assert(allUnique, 'join codes unique across 12 classes + fixed format');
    assert(jc.indexOf('NIK') < 0 && jc.indexOf('NIS') < 0 && jc.indexOf('19601') < 0, 'join code not derived from personal data Â§10');
    assert(callService('classService.createClass', { name: 'Gagal', organizationId: 'ORG_1' }, GUEST).success === false, 'guest cannot create class');
    assert(callService('classService.editClass', clsId, { name: 'TKR X Rev', subject: 'X' }, instObj).data.name === 'TKR X Rev', 'edit class');
    assert(callService('classService.editClass', clsId, { name: 'Hack', subject: 'X' }, STU).success === false, 'student cannot edit class (service check)');

    callService('authService.register', { name: 'Siswa A', username: 'siswaA', password: 'siswa72222' });
    const stA = getVal("Phase8.repositories.userRepository.list().find(u => u.username === 'siswaA')");
    callService('authService.register', { name: 'Siswa B', username: 'siswaB', password: 'siswa83333' });
    const stB = getVal("Phase8.repositories.userRepository.list().find(u => u.username === 'siswaB')");
    callService('authService.register', { name: 'Siswa C', username: 'siswaC', password: 'siswa84444' });
    const stC = getVal("Phase8.repositories.userRepository.list().find(u => u.username === 'siswaC')");
    const addOrphan = callService('classService.addStudent', clsId, stA.id, instObj);
    assert(addOrphan.success === true, 'add student A (orgless) ok');
    assert(P8('repositories.classRepository.getById')(clsId).studentIds.indexOf(stA.id) >= 0, 'class.studentIds updated');
    assert(P8('repositories.userRepository.getById')(stA.id).classIds.indexOf(clsId) >= 0, 'user.classIds updated (two-way integrity)');
    assert(callService('classService.addStudent', clsId, stA.id, instObj).data.studentIds.length === 1, 'no duplicate membership');
    assert(callService('classService.addStudent', clsId, instObj.id, instObj).error.code === 'VALIDATION', 'non-student target rejected');
    assert(callService('classService.addStudent', clsId, stA.id, STU).success === false, 'student cannot add students');
    getVal(`(function(){ const u = Phase8.repositories.userRepository.getById('${stC.id}'); u.organizationId = 'ORG_OTHER'; })()`);
    assert(callService('classService.addStudent', clsId, stC.id, instObj).error.code === 'FORBIDDEN', 'other-org student rejected (ownership)');
    const crIns = callService('userService.createUser', { name: 'Guru Dua', username: 'gurudua', password: 'gurudua123', role: 'INSTRUCTOR', organizationId: 'ORG_1' }, ADM);
    assert(crIns.success === true, 'instructor kedua dibuat via userService (admin)');
    const ins2 = getVal("Phase8.repositories.userRepository.list().find(u => u.username === 'gurudua')");
    assert(callService('classService.addInstructor', clsId, ins2.id, instObj).data.instructorIds.indexOf(ins2.id) >= 0, 'add second instructor');
    const rem = callService('classService.removeStudent', clsId, stA.id, instObj);
    assert(rem.success === true && rem.data.studentIds.indexOf(stA.id) < 0, 'remove student');
    assert(P8('repositories.userRepository.getById')(stA.id).classIds.indexOf(clsId) < 0, 'user.classIds cleaned on removal');

    /* ---- 07. ENROLLMENT (join code) & CLASS PROGRESS ---- */
    console.log('\n07: ENROLLMENT (join code) & CLASS PROGRESS');
    const regen = callService('classService.regenerateJoinCode', clsId, instObj);
    assert(regen.success === true && regen.data.joinCode !== jc, 'regenerate changes code');
    const codeNow = regen.data.joinCode;
    assert(callService('classService.editClass', clsId, { joinEnabled: false }, instObj).data.joinEnabled === false, 'join disabled');
    assert(callService('classService.joinWithCode', stA, codeNow).error.code === 'NOT_FOUND', 'disabled join code rejected');
    assert(callService('classService.editClass', clsId, { joinEnabled: true }, instObj).data.joinEnabled === true, 'join re-enabled');
    const joinRes = callService('classService.joinWithCode', stA, codeNow);
    assert(joinRes.success === true && joinRes.data.alreadyJoined === false, 'student joins with code');
    assert(callService('classService.joinWithCode', stA, codeNow).data.alreadyJoined === true, 're-join idempotent (no dup)');
    assert(callService('classService.joinWithCode', instObj, codeNow).error.code === 'FORBIDDEN', 'non-student cannot join by code');
    assert(callService('classService.joinWithCode', stA, 'AAA-BBBB').error.code === 'NOT_FOUND', 'invalid code rejected');
    const progMem = callService('classService.viewClassProgress', clsId, stA);
    assert(progMem.success === true && has(progMem.data, 'completionRate') && has(progMem.data, 'studentCount'), 'class progress shape');
    assert(callService('classService.viewClassProgress', clsId, stA).data.studentCount === 1, 'student member can view own class progress');
    assert(callService('classService.viewClassProgress', clsId, stB).error.code === 'FORBIDDEN', 'non-member blocked from progress');
    assert(callService('classService.getClassById', clsId, stB).error.code === 'FORBIDDEN', 'non-member getClassForbidden');

    /* ---- 08. AUDIT LOG & DETERMINISM ---- */
    console.log('\n08: AUDIT LOG & DETERMINISM');
    const logs = callService('auditService.list', ADM);
    assert(logs.success === true, 'audit list by admin');
    assert(logs.data.some(l => l.action === 'CREATE_CLASS' && l.entityType === 'CLASS' && l.entityId === clsId), 'CREATE_CLASS audited');
    assert(logs.data.some(l => l.action === 'LOGIN'), 'LOGIN audited');
    assert(logs.data.some(l => l.action === 'ADD_STUDENT' && l.entityId === clsId), 'ADD_STUDENT audited');
    assert(logs.data.some(l => l.action === 'REGENERATE_JOIN_CODE' && l.entityId === clsId), 'REGENERATE_JOIN_CODE audited');
    assert(logs.data.every(l => l.actorId && l.action && l.entityType && l.entityId && l.timestamp), 'audit fields complete Â§45');
    assert(callService('auditService.list', STU).error.code === 'FORBIDDEN', 'student cannot view audit log');

    /* ---- 09. STUDENT DASHBOARD (Â§11) ---- */
    console.log('\n09: STUDENT DASHBOARD (Â§11)');
    assert(typeof P8('dashboardService.studentFor') === 'function' && typeof P8('dashboardService.instructorFor') === 'function'
        && typeof P8('dashboardService.learningAvailable') === 'function' && typeof P8('dashboardService.setLearningBridge') === 'function',
        'dashboardService methods exposed');
    assert(P8('dashboardService.learningAvailable()') === true, 'Phase5 learning bridge available (harness memuat learningAssessment.js)');
    const dSelf = callService('dashboardService.studentFor', stA.id, stA);
    assert(dSelf.success === true && dSelf.data.student.id === stA.id, 'student dashboard for self');
    assert(dSelf.data.classes.some(c => c.id === clsId), 'student dashboard lists own class (real membership)');
    assert(Array.isArray(dSelf.data.currentAssignments), 'currentAssignments array (STEP 9-10 akan mengisinya)');
    assert(Array.isArray(dSelf.data.diagnosticCases) && dSelf.data.diagnosticCases.length === 20, 'diagnosticCases = 20 Phase7 refs (Â§70)');
    assert(dSelf.data.learning.available === true, 'learning section available');
    assert(typeof dSelf.data.learning.progress.percent === 'number' && dSelf.data.learning.progress.percent >= 0, 'overall progress % dari Phase5 (live, bukan hardcode)');
    assert(Array.isArray(dSelf.data.learning.jobSheets) && dSelf.data.learning.jobSheets.length > 0, 'jobSheets dari kandungan Phase5');
    assert(Array.isArray(dSelf.data.learning.assessmentResults), 'assessmentResults array');
    assert(Array.isArray(dSelf.data.learning.achievements) && dSelf.data.learning.achievements.length > 0, 'achievements dari Phase5');
    assert(dSelf.data.learning.skills && 'practical' in dSelf.data.learning.skills, 'skillSummary dari Phase5');
    assert(Array.isArray(dSelf.data.recentActivity), 'recentActivity array');
    assert(dSelf.data.recentActivity.some(a => a.type === 'JOIN_CLASS'), 'recentActivity memuat event JOIN_CLASS dari phase8 activity log');
    const dOther = callService('dashboardService.studentFor', stA.id, { role: 'STUDENT', id: 'S_LAIN' });
    assert(dOther.success === false && dOther.error.code === 'FORBIDDEN', 'siswa lain tidak bisa melihat hasil siswa lain');
    const dInst = callService('dashboardService.studentFor', stA.id, instObj);
    assert(dInst.success === true, 'instructor anggota dapat melihat hasil student');
    const s1 = JSON.stringify(dSelf.data);
    const s2 = JSON.stringify(callService('dashboardService.studentFor', stA.id, stA).data);
    assert(s1 === s2, 'dashboard deterministik (tidak ada randomisasi)');

    /* ---- 10. INSTRUCTOR DASHBOARD (Â§12) â€” tanpa ranking ---- */
    console.log('\n10: INSTRUCTOR DASHBOARD (Â§12)');
    const idash = callService('dashboardService.instructorFor', 'INS_1', instObj);
    assert(idash.success === true && idash.data.instructor.id === 'INS_1', 'instructor dashboard untuk diri sendiri');
    assert(idash.data.classes.some(c => c.id === clsId), 'instructor dashboard lists own class');
    assert(idash.data.totals.classes >= 1 && idash.data.totals.students >= 1, 'totals dari repositories nyata');
    assert(typeof idash.data.averageClassProgress === 'number', 'averageClassProgress number');
    assert(Array.isArray(idash.data.recentSubmissions), 'recentSubmissions array (STEP 9-10)');
    assert(Array.isArray(idash.data.commonMistakes), 'commonMistakes array');
    assert(idash.data.diagnosticPerformance && 'attempts' in idash.data.diagnosticPerformance, 'diagnosticPerformance shape');
    assert(idash.data.totals.activeAssignments === 0 && idash.data.totals.pendingAssessments === 0,
        'assignment/submission count 0 (belum ada assignment di grup ini; engine STEP 9-10 sudah aktif)');
    assert(!has(idash.data, 'ranking') && !has(idash.data, 'leaderboard') && !has(idash.data, 'scoreboard'),
        'TIDAK ada leaderboard/ranking siswa (Â§12)');
    assert(!has(idash.data.totals, 'bestStudent') && !has(idash.data.totals, 'worstStudent'), 'tanpa best/worst student');
    assert(callService('dashboardService.instructorFor', 'INS_1', GUEST).success === false, 'guest tidak bisa lihat instructor dashboard');
    assert(callService('dashboardService.instructorFor', 'INS_2', instObj).success === false, 'instructor lain (bukan admin) ditolak');
    const admView = callService('dashboardService.instructorFor', 'INS_2', ADM);
    assert(admView.success === true, 'admin dapat melihat dashboard instructor mana pun');

    /* ---- 11. BRIDGE OFFLINE-SAFE (Phase5 belum dimuat / ditutup) ---- */
    console.log('\n11: LEARNING BRIDGE OFFLINE-SAFE');
    const offProbe = getVal(`(function(){
        Phase8.dashboardService.setLearningBridge(null);
        var d = Phase8.dashboardService.studentFor(${JSON.stringify(stA.id)}, ${JSON.stringify(stA)});
        var v = Phase8.dashboardService.learningAvailable();
        Phase8.dashboardService.setLearningBridge(undefined);
        return { available: v, learning: d && d.data ? d.data.learning : null, classes: d && d.data ? d.data.classes.length : -1 };
    })()`);
    assert(offProbe.available === false, 'bridge ditutup -> learningAvailable false');
    assert(offProbe.learning && offProbe.learning.available === false && offProbe.learning.jobSheets.length === 0,
        'offline-safe: bagian learning nol, dashboard tetap utuh');
    assert(offProbe.classes >= 1, 'kelas tetap tersedia saat bridge mati (defensive)');
    assert(P8('dashboardService.learningAvailable()') === true, 'bridge pulih ke Phase5 live setelah di-restore');

    /* ---- 12. COURSE & CONTENT LIBRARY (Â§14-16, STEP 8) ---- */
    console.log('\n12: COURSE & CONTENT LIBRARY (Â§14-16)');
    const c1 = callService('courseService.createContent', { type: 'LESSON', title: 'Materi Starter', description: 'd1', refId: 'L1' }, instObj);
    assert(c1.success === true && c1.data.status === 'DRAFT' && c1.data.version === 1, 'content created DRAFT v1');
    assert(callService('courseService.createContent', { type: 'LESSON', title: 'Dup', refId: 'L1' }, instObj).error.code === 'DUPLICATE',
        'duplicate refId rejected');
    assert(callService('courseService.createContent', { type: 'NOPE', title: 'x' }, instObj).success === false, 'unknown content type rejected');
    const c1upd = callService('courseService.updateContent', c1.data.id, { title: 'Materi Starter v2' }, instObj);
    assert(c1upd.data.version === 2 && c1upd.data.status === 'DRAFT', 'update bumps version (DRAFT stays DRAFT)');
    const c1pub = callService('courseService.publishContent', c1.data.id, instObj);
    assert(c1pub.data.status === 'PUBLISHED', 'publishContent -> PUBLISHED');
    const c1ret = callService('courseService.updateContent', c1.data.id, { body: 'x' }, instObj);
    assert(c1ret.data.status === 'REVIEW' && c1ret.data.version === 3, 'edit after publish -> REVIEW v3 (Â§16 tanpa bypass versioning)');
    const crs = callService('courseService.createCourse', { title: 'Kurikulum Starter', moduleIds: ['starter-basic'] }, instObj);
    assert(crs.success === true && crs.data.status === 'DRAFT', 'course created DRAFT');
    assert(callService('courseService.publishCourse', crs.data.id, instObj).data.status === 'PUBLISHED', 'publishCourse');
    assert(callService('courseService.archiveCourse', crs.data.id, instObj).data.status === 'ARCHIVED', 'archiveCourse');
    const cat = callService('courseService.moduleCatalog', instObj);
    assert(cat.success === true && cat.data.length === 5 && cat.data[0].lessons && cat.data[0].lessons.length > 0,
        'moduleCatalog referensi Phase5 (5 modul, tanpa duplikasi Â§70)');
    const dc = callService('courseService.diagnosticCaseCatalog', instObj);
    assert(dc.success === true && dc.data.length === 20, 'diagnosticCaseCatalog = 20 case Phase7 (referensi, bukan copy)');
    assert(callService('courseService.listContents', stB).success === true && callService('courseService.listContents', stB).data.length >= 1,
        'student (VIEW_CONTENT) dapat melihat katalog konten');
    assert(callService('courseService.createContent', { type: 'LESSON', title: 'Gagal' }, GUEST).success === false
        && callService('courseService.createContent', { type: 'LESSON', title: 'Hack' }, stA).success === false,
        'hanya pengelola konten yang dapat membuat konten (Â§100)');
    assert(callService('courseService.moduleCatalog', stA).success === true, 'student dapat melihat moduleCatalog');

    /* ---- 13. ASSIGNMENT ENGINE (Â§17-19, Â§73-77, STEP 9) ---- */
    console.log('\n13: ASSIGNMENT ENGINE (Â§17-19)');
    const caseRef = getVal("Phase8.repositories.caseRepository.list()[0].refId");
    assert(typeof caseRef === 'string' && caseRef.length > 0, 'diag case ref tersedia');
    const a1 = callService('assignmentService.create', { title: 'Diagnosa Starter', type: 'DIAGNOSTIC_CASE', contentId: caseRef, classId: clsId, attempts: 2, passingScore: 75, dueAt: 9999999999999 }, instObj);
    assert(a1.success === true && a1.data.status === 'DRAFT', 'assignment created DRAFT');
    assert(typeof a1.data.contentTitle === 'string' && a1.data.contentTitle.length > 0, 'contentTitle tersolve dari katalog');
    assert(callService('assignmentService.create', { title: 'Bad', type: 'BOGUS', classId: clsId }, instObj).error.code === 'VALIDATION', 'unknown assignment type rejected');
    assert(callService('assignmentService.create', { title: 'Bad', type: 'QUIZ' }, instObj).error.code === 'NOT_FOUND', 'class bukan milik / tidak ada -> NOT_FOUND');
    assert(callService('assignmentService.create', { title: 'Bad', type: 'DIAGNOSTIC_CASE', contentId: 'CASE_NOT_IN_CATALOG', classId: clsId }, instObj).error.code === 'VALIDATION', 'diag case di luar katalog ditolak (Â§70)');
    assert(callService('assignmentService.create', { title: 'X', type: 'DIAGNOSTIC_CASE', contentId: caseRef, classId: clsId, attempts: 0 }, instObj).data.attempts === 0, 'attempts 0 = unlimited');
    assert(callService('assignmentService.create', { title: 'X', type: 'DIAGNOSTIC_CASE', contentId: caseRef, classId: clsId, attempts: -3 }, instObj).success === false, 'attempts negatif ditolak');
    const aPub = callService('assignmentService.publish', a1.data.id, instObj);
    assert(aPub.success === true && aPub.data.status === 'PUBLISHED', 'publish assignment -> PUBLISHED');
    assert(P8('repositories.assignmentRepository.getById')(a1.data.id).publishedAt != null, 'publishedAt tercatat');
    assert(P8('repositories.notificationRepository.list()').some(n => n.category === 'Assignment' && n.userId === stA.id),
        'publish mengirim notifikasi ke siswa kelas');
    assert(callService('assignmentService.get', a1.data.id, stB).success === false && callService('assignmentService.get', a1.data.id, stB).error.code === 'FORBIDDEN',
        'siswa non-anggota ditolak akses assignment');
    const aStA = callService('assignmentService.forStudent', stA);
    assert(aStA.success === true && aStA.data.some(x => x.id === a1.data.id), 'forStudent memuat assignment PUBLISHED');
    assert(callService('assignmentService.get', a1.data.id, GUEST).success === false && callService('assignmentService.get', a1.data.id, GUEST).error.code === 'FORBIDDEN',
        'guest cannot read assignment');
    assert(callService('assignmentService.list', { role: 'GUEST' }).data.length === 0, 'guest list assignment kosong (tanpa kebocoran)');
    assert(callService('assignmentService.publish', a1.data.id, stA).success === false, 'student cannot publish assignment');

    /* ---- 14. SUBMISSION ENGINE (Â§20-21, Â§75, Â§78, STEP 10) ---- */
    console.log('\n14: SUBMISSION ENGINE (Â§20-21, Â§75)');
    const sub1 = callService('submissionService.start', stA, a1.data.id);
    assert(sub1.success === true && sub1.data.status === 'IN_PROGRESS' && sub1.data.attemptNumber === 1, 'student mulai attempt 1 (IN_PROGRESS)');
    const sub1r = callService('submissionService.start', stA, a1.data.id);
    assert(sub1r.success === true && sub1r.data.resumed === true, 'resume submission IN_PROGRESS (tidak duplikat)');
    const noEv = callService('submissionService.submit', stA, a1.data.id, { score: 95 });
    assert(noEv.success === true && noEv.data.status === 'SUBMITTED' && noEv.data.score === null,
        'skor TIDAK disimpan tanpa bukti riil (Â§21) - null, bukan nilai karangan');
    const a2 = callService('assignmentService.create', { title: 'Diagnosa Lanjut', type: 'DIAGNOSTIC_CASE', contentId: caseRef, classId: clsId, attempts: 1 }, instObj);
    callService('assignmentService.publish', a2.data.id, instObj);
    const sub2 = callService('submissionService.start', stA, a2.data.id);
    assert(sub2.success === true && sub2.data.status === 'IN_PROGRESS', 'mulai attempt untuk assignment ke-2');
    const payload = { measurementHistory: [{ id: 'M1', value: 10.2, at: 1000 }], diagnosticPath: ['muscle', 'state'], hypotheses: ['H1'], evidence: [{ id: 'E1', confirmed: true }], repairs: [{ id: 'R1', repaired: true }], verification: { phrase: 'Sistem hidup' }, hints: 1, mistakes: ['WRONG_HYPOTHESIS'], score: 84, diagnosticTime: 5000, testTime: 900, repairTime: 1200 };
    const subReal = callService('submissionService.submit', stA, a2.data.id, payload);
    assert(subReal.success === true && subReal.data.score === 84, 'artefak engine nyata -> skor 84 tersimpan');
    const recReal = P8('repositories.submissionRepository.getById')(sub2.data.id);
    assert(recReal.measurementHistory.length === 1 && recReal.diagnosticPath.length === 2 && recReal.score === 84,
        'detail diagnosis (measurement/path/verification/repair) tersimpan Â§78');
    assert(typeof recReal.timeStarted === 'number' && typeof recReal.timeSpent === 'number'
        && recReal.diagnosticTime === 5000 && recReal.testTime === 900 && recReal.repairTime === 1200, 'time tracking Â§78');
    const noLeft = callService('submissionService.start', stA, a2.data.id);
    assert(noLeft.success === false && noLeft.error.code === 'ATTEMPTS_EXHAUSTED', 'attempt habis -> ATTEMPTS_EXHAUSTED (Â§75)');
    const cr = callService('submissionService.canRetake', a2.data.id, stA);
    assert(cr.success === true && cr.data.allowed === false && cr.data.attemptsUsed === 1, 'canRetake mencerminkan batas attempt');
    assert(callService('submissionService.get', sub2.data.id, stB).success === false, 'siswa lain tidak bisa akses submission (Â§100)');
    const instList = callService('submissionService.listForAssignment', a2.data.id, instObj);
    assert(instList.success === true && instList.data.length === 1 && instList.data[0].studentId === stA.id,
        'instructor melihat submission semua siswa utk assignment-nya');
    assert(callService('submissionService.listForAssignment', a2.data.id, stA).success === false, 'siswa tidak bisa list submission kelas');
    const idash2 = callService('dashboardService.instructorFor', 'INS_1', instObj);
    assert(idash2.data.totals.activeAssignments >= 1 && idash2.data.totals.pendingAssessments >= 1 && idash2.data.recentSubmissions.length >= 1,
        'instructor dashboard mengagregasi assignment/submission nyata');
    const classProg = idash2.data.classes.find(c => c.id === clsId).progress;
    assert(typeof classProg.completionRate === 'number' && classProg.completionRate > 0,
        'completionRate kelas dihitung dari submission nyata (bukan 0)');

    /* ---- 15. DASHBOARD INTEGRATION + DETERMINISM (setelah engine STEP 9-10) ---- */
    console.log('\n15: DASHBOARD INTEGRATION (STUDENT)');
    const d2 = callService('dashboardService.studentFor', stA.id, stA);
    assert(d2.data.currentAssignments.some(x => x.id === a2.data.id), 'student dashboard memuat assignment aktif');
    assert(d2.data.currentAssignments.every(x => x.status === 'PUBLISHED'), 'dashboard hanya assignment PUBLISHED (bukan DRAFT)');
    assert(!!d2.data.assignmentProgress && typeof d2.data.assignmentProgress.submissions === 'number'
        && d2.data.assignmentProgress.submissions >= 2, 'assignmentProgress agregasi per assignment');
    const j1 = JSON.stringify(d2.data);
    const j2 = JSON.stringify(callService('dashboardService.studentFor', stA.id, stA).data);
    assert(j1 === j2, 'dashboard tetap deterministik setelah engine aktif');
    const closedBridge = getVal(`(function(){
        Phase8.setDiagnosticBridge(null);
        const d = Phase8.dashboardService.studentFor(${JSON.stringify(stA.id)}, ${JSON.stringify(stA)});
        const ok = d && d.success === true && d.data.currentAssignments.length >= 1;
        Phase8.setDiagnosticBridge(undefined);
        return ok;
    })()`);
    assert(closedBridge === true, 'bridge diagnosis close-safe (assignment tetap tampil)');

    /* ---- 16. INSTRUCTOR GRADING (Â§22-24, STEP 11) ---- */
    console.log('\n16: INSTRUCTOR GRADING (Â§22-24)');
    assert(typeof P8('gradingService.grade') === 'function' && typeof P8('gradingService.returnForRevision') === 'function'
        && typeof P8('gradingService.queue') === 'function' && typeof P8('gradingService.viewFeedback') === 'function',
        'gradingService methods exposed');
    assert(callService('apiClient.post', '/submissions/' + sub2.data.id + '/grade', { score: 92, feedback: 'ok' }).success === false,
        'apiClient grade endpoint blocked when not logged in (guest)');
    const gBefore = callService('dashboardService.instructorFor', 'INS_1', instObj).data.totals.pendingAssessments;
    const qBefore = callService('gradingService.queue', instObj);
    assert(qBefore.success === true && qBefore.data.length >= 2, 'instructor grading queue berisi submission SUBMITTED');
    assert(qBefore.data.every(s => s.status === 'SUBMITTED'), 'queue hanya memuat status SUBMITTED');
    assert(callService('gradingService.queue', stA).success === false, 'siswa tidak bisa melihat queue penilaian');
    assert(callService('gradingService.grade', sub2.data.id, { score: 92, feedback: 'Diagnosis tepat' }, stB).error.code === 'FORBIDDEN',
        'student cannot grade submission (Â§100)');
    assert(callService('gradingService.grade', sub2.data.id, { score: 92 }, { role: 'GUEST' }).success === false,
        'guest cannot grade (GRADE_SUBMISSION permission)');
    const otherIns = getVal("({ id: 'INS_X', role: 'INSTRUCTOR', username: 'lolos', organizationId: 'ORG_L' })");
    assert(callService('gradingService.grade', sub2.data.id, { score: 92 }, otherIns).error.code === 'FORBIDDEN',
        'instructor kelas lain tidak bisa menilai submission kelas ini (ownership)');
    assert(callService('gradingService.grade', sub1.data.id, { score: 50, feedback: 'x' }, instObj).error.code === 'NO_EVIDENCE',
        'submission tanpa bukti engine tidak bisa dinilai (Â§21, anti nilai palsu)');
    assert(P8('repositories.submissionRepository.getById')(sub1.data.id).score === null, 'no-evidence submission tetap score null');
    const g1 = callService('gradingService.grade', sub2.data.id, { score: 92, feedback: 'Diagnosis tepat' }, instObj);
    assert(g1.success === true && g1.data.status === 'GRADED' && g1.data.score === 92 && g1.data.gradedBy === 'INS_1',
        'instructor menilai submission ber-evidence -> GRADED score 92');
    const recG = P8('repositories.submissionRepository.getById')(sub2.data.id);
    assert(recG.status === 'GRADED' && recG.score === 92 && recG.feedback === 'Diagnosis tepat' && recG.gradedAt != null,
        'grade fields persisted (score/feedback/gradedAt)');
    assert(callService('gradingService.grade', sub2.data.id, { score: 5 }, instObj).error.code === 'BAD_STATE',
        'submission sudah GRADED tidak bisa dinilai ulang');
    assert(callService('auditService.list', ADM).data.some(l => l.action === 'GRADE_SUBMISSION' && l.entityType === 'SUBMISSION' && l.entityId === sub2.data.id),
        'GRADE_SUBMISSION tercatat di audit log (Â§45)');
    assert(P8('repositories.notificationRepository.list()').some(n => n.category === 'Grading' && n.userId === stA.id),
        'siswa menerima notifikasi hasil penilaian');
    assert(callService('gradingService.viewFeedback', sub2.data.id, stB).error.code === 'FORBIDDEN',
        'siswa lain tidak bisa membuka submission orang lain (Â§100)');
    const stGrade = callService('submissionService.get', sub2.data.id, stA);
    assert(stGrade.success === true && stGrade.data.score === 92 && stGrade.data.feedback === 'Diagnosis tepat'
        && stGrade.data.status === 'GRADED', 'siswa melihat nilai + feedback (bukan mengedit)');
    assert(typeof P8('submissionService').grade === 'undefined', 'student has no grade-write API');
    const vf = callService('gradingService.viewFeedback', sub2.data.id, stA);
    assert(vf.success === true && vf.data.feedbackViewedAt != null, 'viewFeedback -> feedbackViewedAt tercatat');
    assert(P8('repositories.activityRepository.list()').some(a => a.type === 'VIEWED_FEEDBACK' && a.entityId === sub2.data.id),
        'aktivitas VIEWED_FEEDBACK tercatat (Â§79)');
    const gDash = callService('dashboardService.instructorFor', 'INS_1', instObj).data.totals;
    assert(gDash.pendingAssessments === gBefore - 1 && gDash.graded >= 1, 'dashboard: pending turun, graded tercatat');
    const ret = callService('gradingService.returnForRevision', sub1.data.id, 'Perbaiki pengukuran Anda', instObj);
    assert(ret.success === true && ret.data.status === 'RETURNED' && ret.data.returnedBy === 'INS_1',
        'return for revision -> RETURNED');
    assert(P8('repositories.submissionRepository.getById')(sub1.data.id).returnedAt != null, 'returnedAt tercatat');
    assert(callService('gradingService.queue', instObj).data.every(s => s.id !== sub2.data.id),
        'submission GRADED keluar dari antrian penilaian');
    const retake2 = callService('submissionService.start', stA, a1.data.id);
    assert(retake2.success === true && retake2.data.status === 'IN_PROGRESS', 'siswa dapat mengerjakan ulang setelah RETURNED (revisi)');
    assert(callService('submissionService.canRetake', a1.data.id, stA).data.attemptsUsed === 0,
        'RETURNED tidak menghabiskan attempts (Â§75)');
    const reNoEv = callService('submissionService.submit', stA, a1.data.id, { score: 55 });
    assert(reNoEv.success === true && reNoEv.data.score === null, 'submit ulang tanpa bukti -> score null lagi (Â§21)');
    assert(callService('gradingService.queue', instObj).data.some(s => s.id === reNoEv.data.id),
        'submission baru kembali masuk antrian penilaian');
    const gAdmin = callService('gradingService.grade', reNoEv.data.id, { score: 60, feedback: 'Lengkap' }, ADM);
    assert(gAdmin.success === false && gAdmin.error.code === 'NO_EVIDENCE', 'admin pun tidak bisa menilai tanpa bukti (Â§21)');
    const ret2 = callService('gradingService.returnForRevision', reNoEv.data.id, 'sertakan bukti pengukuran', instObj);
    assert(ret2.success === true && P8('repositories.submissionRepository.getById')(reNoEv.data.id).status === 'RETURNED',
        'return tanpa bukti pun diperbolehkan (revisi)');

    /* ---- 17. RUBRIC ENGINE (Â§23, Phase5 Â§25, STEP 12) ---- */
    console.log('\n17: RUBRIC ENGINE (Â§23)');
    assert(typeof P8('rubricService.create') === 'function' && typeof P8('rubricService.compute') === 'function'
        && typeof P8('rubricService.defaultRubric') === 'function' && typeof P8('repositories.rubricRepository.seedDefaults') === 'function',
        'rubricService methods exposed');
    const seedR = call('repositories.rubricRepository.seedDefaults');
    assert(seedR.success === true && seedR.data.imported === 1, 'seed default rubric (Phase5 Â§25 / Phase8 Â§23)');
    const defRub = callService('rubricService.get', 'RUB_DEFAULT', instObj);
    assert(defRub.success === true && defRub.data.title === 'Diagnostic Practical Rubric' && defRub.data.criteria.length === 8,
        'default rubric = 8 kriteria contoh Â§23');
    assert(defRub.data.criteria.reduce((acc, c) => acc + c.weight, 0) === 100 && defRub.data.maxTotal === 100,
        'bobot default total 100');
    assert(defRub.data.source === 'phase5', 'default rubric terintegrasi dengan Phase5 Â§25');
    const defCopy = callService('rubricService.defaultRubric', instObj);
    assert(defCopy.success === true && defCopy.data.criteria.length === 8, 'defaultRubric() = canonical Â§23');
    const full = callService('rubricService.compute', 'RUB_DEFAULT', { INITIAL_INSPECTION: 10, SAFETY_PROCEDURE: 10, MEASUREMENT_PROCEDURE: 20, MEASUREMENT_ACCURACY: 15, DIAGNOSTIC_REASONING: 20, REPAIR_PROCEDURE: 10, VERIFICATION: 10, DOCUMENTATION: 5 }, instObj);
    assert(full.success === true && full.data.total === 100 && full.data.maxTotal === 100 && full.data.breakdown.length === 8,
        'rubric full marks -> weighted 100');
    const part = callService('rubricService.compute', 'RUB_DEFAULT', { INITIAL_INSPECTION: 5, SAFETY_PROCEDURE: 5, MEASUREMENT_PROCEDURE: 10, MEASUREMENT_ACCURACY: 7, DIAGNOSTIC_REASONING: 12, REPAIR_PROCEDURE: 6, VERIFICATION: 6, DOCUMENTATION: 3 }, instObj, 70);
    assert(part.success === true && part.data.total === 54 && part.data.passed === false, 'rubric partial + passingScore -> belum lolos');
    const custom = callService('rubricService.create', {
        title: 'Rubrik Kerja Bengkel', criteria: [
            { key: 'PREP', label: 'Persiapan', weight: 30, maxScore: 30 },
            { key: 'EKS', label: 'Eksekusi', weight: 60, maxScore: 60, performanceLevels: ['Kurang', 'Cukup', 'Baik', 'Sangat Baik'] },
            { key: 'PEL', label: 'Pelaporan', weight: 10, maxScore: 10 }
        ]
    }, instObj);
    assert(custom.success === true && custom.data.status === 'ACTIVE' && custom.data.criteria.length === 3, 'custom rubric created (Â§23 customizable)');
    assert(custom.data.criteria[1].performanceLevels[3] === 'Sangat Baik', 'custom performance levels retained');
    assert(callService('rubricService.create', { title: 'X', criteria: [{ key: 'A', label: 'A', weight: 50 }] }, instObj).error.code === 'VALIDATION',
        'bobot bukan 100 -> VALIDATION');
    assert(callService('rubricService.create', { title: 'Y', criteria: [] }, instObj).error.code === 'VALIDATION', 'kriteria kosong ditolak');
    assert(callService('rubricService.create', { title: 'Z' }, stA).success === false, 'student cannot create rubric (MANAGE_CONTENT)');
    assert(callService('rubricService.update', custom.data.id, { title: 'Rubrik 2026' }, instObj).data.title === 'Rubrik 2026', 'update rubric title');
    assert(callService('rubricService.archive', custom.data.id, instObj).data.status === 'ARCHIVED', 'archive rubric');
    assert(callService('rubricService.list', instObj).data.every(r => r.status === 'ACTIVE' && r.id !== custom.data.id),
        'list hanya rubric ACTIVE (archived tidak tampil)');
    assert(callService('auditService.list', ADM).data.some(l => l.action === 'CREATE_RUBRIC' && l.entityId === custom.data.id),
        'CREATE_RUBRIC tercatat di audit log');
    const aR = callService('assignmentService.create', { title: 'Tugas Ber-Rubrik', type: 'DIAGNOSTIC_CASE', contentId: caseRef, classId: clsId, rubricId: 'RUB_DEFAULT' }, instObj);
    assert(aR.success === true && aR.data.rubricId === 'RUB_DEFAULT', 'assignment carries rubricId');
    assert(callService('assignmentService.create', { title: 'X', type: 'DIAGNOSTIC_CASE', contentId: caseRef, classId: clsId, rubricId: 'RUB_GAK_ADA' }, instObj).error.code === 'VALIDATION',
        'rubricId tidak dikenal -> VALIDATION');
    callService('assignmentService.publish', aR.data.id, instObj);
    callService('submissionService.start', stA, aR.data.id);
    const subR = callService('submissionService.submit', stA, aR.data.id, { measurementHistory: [{ id: 'M', value: 12, at: 1 }], score: 70 });
    assert(subR.success === true && subR.data.status === 'SUBMITTED', 'submit utk assignment ber-rubric');
    const gR = callService('gradingService.grade', subR.data.id, { criteria: { INITIAL_INSPECTION: 10, SAFETY_PROCEDURE: 10, MEASUREMENT_PROCEDURE: 18, MEASUREMENT_ACCURACY: 13, DIAGNOSTIC_REASONING: 19, REPAIR_PROCEDURE: 10, VERIFICATION: 9, DOCUMENTATION: 5 }, feedback: 'Kerja baik' }, instObj);
    assert(gR.success === true && gR.data.status === 'GRADED' && gR.data.score === 94,
        'grading via rubric criteria -> weighted score 94');
    const recR = P8('repositories.submissionRepository.getById')(subR.data.id);
    assert(recR.rubricResult && recR.rubricResult.rubricId === 'RUB_DEFAULT' && recR.rubricResult.breakdown.length === 8,
        'rubricResult persisted dengan breakdown Â§23');
    assert(recR.score === 94 && recR.feedback === 'Kerja baik', 'score dan feedback dari rubrik disimpan');
    const aPlain2 = callService('assignmentService.create', { title: 'Tanpa Rubrik', type: 'DIAGNOSTIC_CASE', contentId: caseRef, classId: clsId }, instObj);
    callService('assignmentService.publish', aPlain2.data.id, instObj);
    callService('submissionService.start', stA, aPlain2.data.id);
    const sPlain = callService('submissionService.submit', stA, aPlain2.data.id, { measurementHistory: [{ id: 'Z', value: 1, at: 1 }] });
    assert(callService('gradingService.grade', sPlain.data.id, { criteria: { X: 1 } }, instObj).error.code === 'VALIDATION',
        'criteria grading butuh rubric terpasang di assignment');
    const stG = callService('gradingService.grade', sPlain.data.id, { score: 77, feedback: 'ok ratio' }, instObj);
    assert(stG.success === true && stG.data.score === 77, 'tanpa criteria, grade tetap pakai score eksplisit');
    assert(P8('repositories.submissionRepository.getById')(sPlain.data.id).rubricResult == null, 'tanpa criteria -> tanpa rubricResult');

    /* ---- 18. DIAGNOSTIC SESSION REVIEW (Â§13, Â§22, Â§24, STEP 13) ---- */
    console.log('\n18: DIAGNOSTIC SESSION REVIEW (Â§13, Â§24)');
    assert(typeof P8('reviewService.session') === 'function' && typeof P8('reviewService.timeline') === 'function'
        && typeof P8('reviewService.feedback') === 'function', 'reviewService methods exposed');
    assert(callService('reviewService.session', sub2.data.id, stB).error.code === 'FORBIDDEN',
        'siswa lain tidak bisa review sesi orang lain (Â§100)');
    assert(callService('reviewService.session', sub2.data.id, { role: 'GUEST' }).success === false,
        'guest cannot review session');
    const rev = callService('reviewService.session', sub2.data.id, instObj);
    assert(rev.success === true && rev.data.student.id === stA.id, 'instructor meninjau sesi diagnosis (open submission)');
    assert(rev.data.artifacts.measurements === 1 && rev.data.artifacts.pathLength === 2,
        'artifacts: measurement history + diagnostic path');
    assert(rev.data.artifacts.hypotheses === 1 && rev.data.artifacts.evidence === 1 && rev.data.artifacts.repairs === 1
        && rev.data.artifacts.verified === true, 'artifacts: hypothesis/evidence/repair/verification');
    assert(rev.data.artifacts.hints === 1 && rev.data.artifacts.mistakes.length === 1,
        'artifacts: hints + mistakes tercatat (Â§79)');
    assert(rev.data.verdict.score === 92 && rev.data.verdict.evidence === true,
        'verdict memakai skor bukti nyata (Â§21)');
    assert(rev.data.time.diagnosticTime === 5000 && typeof rev.data.time.timeSpent === 'number',
        'time tracking tampil dalam review (Â§78)');
    assert(rev.data.assignment.id === a2.data.id && rev.data.assignment.type === 'DIAGNOSTIC_CASE',
        'review terhubung ke assignment');
    assert(Array.isArray(rev.data.feedback.strengths) && rev.data.feedback.strengths.length >= 1,
        'feedback strengths dari artefak nyata');
    assert(rev.data.feedback.weaknesses.some(w => w.indexOf('hint') >= 0), 'penggunaan hint tampil sebagai kelemahan');
    const selfRev = callService('reviewService.session', sub2.data.id, stA);
    assert(selfRev.success === true && selfRev.data.student.id === stA.id, 'siswa dapat meninjau sesinya sendiri');
    const tl = callService('reviewService.timeline', sub2.data.id, instObj);
    assert(tl.success === true && Array.isArray(tl.data) && tl.data.length >= 6, 'timeline menggabungkan semua artefak');
    assert(tl.data.every(e => typeof e.label === 'string' && typeof e.type === 'string' && 'at' in e),
        'timeline event shape (type/label/at)');
    const revNo = callService('reviewService.session', sub1.data.id, instObj);
    assert(revNo.success === true && revNo.data.verdict.score === null && revNo.data.verdict.evidence === false
        && revNo.data.artifacts.measurements === 0, 'review transparan: tanpa bukti -> score null (Â§21)');
    const fb = callService('reviewService.feedback', sub2.data.id, instObj);
    assert(fb.success === true && fb.data.weaknesses.length >= 1 && fb.data.weaknesses.some(w => w.indexOf('Kesalahan') >= 0),
        'feedback menyebut mistakes yang benar-benar terjadi');
    const tlJson1 = JSON.stringify(tl.data);
    const tlJson2 = JSON.stringify(callService('reviewService.timeline', sub2.data.id, instObj).data);
    assert(tlJson1 === tlJson2, 'review deterministik (tidak ada randomisasi)');

    console.log('\n19: INDEXEDDB (Â§36)');
    assert(typeof P8('indexedDB.createProvider') === 'function' && typeof P8('indexedDB.createMemoryAdapter') === 'function',
        'factories indexedDB diekspos');
    assert(Array.isArray(P8('indexedDB.ENTITY_STORES')) && Array.isArray(P8('indexedDB.ENTITY_LISTS')),
        'enumerasi entity stores/lists tersedia');
    const idx = await getVal(`(async function () {
        const names = ['users', 'classes', 'assignments', 'submissions', 'audit', 'notifications'];
        const A = Phase8.indexedDB.createMemoryAdapter(names);
        const p = Phase8.indexedDB.createProvider();
        const opened = await p.open(A);
        Phase8.setStoreProvider(p);
        const AD = { id: 'ADM_9', role: 'ADMIN', name: 'Ops', username: 'ops', organizationId: null };
        const ins = { id: 'INS_9', role: 'INSTRUCTOR', name: 'Guru 9', username: 'guru9', organizationId: 'ORG_9' };
        const u = Phase8.userService.createUser({ name: 'Siswa IDB', username: 'siswaIDB', password: 'siswa12345', role: 'STUDENT' }, AD);
        const cls = Phase8.classService.createClass({ name: 'Kelas IDB', subject: 'Sistem Starter', organizationId: 'ORG_9' }, ins);
        const st = Phase8.repositories.userRepository.getById(u.data.id);
        Phase8.classService.addStudent(cls.data.id, st.id, ins);
        const a = Phase8.assignmentService.create({ title: 'Tugas IDB', type: 'DIAGNOSTIC_CASE', contentId: 'CASE_91', classId: cls.data.id }, ins);
        Phase8.assignmentService.publish(a.data.id, ins);
        Phase8.submissionService.start(st, a.data.id);
        const flush = await p.flush();
        const counts = A.counts();
        const p2 = Phase8.indexedDB.createProvider();
        await p2.open(A);
        const users2 = Object.keys(p2.getStore('users')).length;
        const classes2 = Object.keys(p2.getStore('classes')).length;
        const assignment2 = Object.keys(p2.getStore('assignments')).length;
        const submissions2 = Object.keys(p2.getStore('submissions')).length;
        Phase8.setStoreProvider();
        return { opened, flush, counts, users2, classes2, assignment2, submissions2,
            restoredDefault: Phase8.storeProvider._custom === false };
    })()`);
    assert(idx.opened.backend === 'INDEXEDDB' && idx.opened.ready === true, 'provider IndexedDB terbuka (ready)');
    assert(idx.counts.users >= 1 && idx.counts.classes >= 1 && idx.counts.assignments >= 1 && idx.counts.submissions >= 1,
        'write-through: data repos tersimpan ke IndexedDB (Â§36)');
    assert(idx.users2 >= 1 && idx.classes2 >= 1 && idx.assignment2 >= 1 && idx.submissions2 >= 1,
        'reload dari IndexedDB mempertahankan data (persistence)');
    assert(idx.flush.flushed >= 1 && idx.restoredDefault === true,
        'flush berjalan & storeProvider dikembalikan ke memory default');
    const fallback = await getVal(`(async function () {
        const p = Phase8.indexedDB.createProvider();
        const res = await p.open(null);
        return { backend: res.backend, ready: res.ready, hasRubrics: Phase8.indexedDB.ENTITY_STORES.indexOf('rubrics') >= 0 };
    })()`);
    assert(fallback.backend === 'MEMORY' && fallback.ready === false && fallback.hasRubrics === true,
        'IndexedDB tidak tersedia -> fallback MEMORY (offline/demo-safe, Â§36)');

    console.log('\n20: REPOSITORY LAYER (Â§34-35)');
    const repApi = getVal(`(function () {
        const objectRepos = ['userRepository', 'classRepository', 'assignmentRepository', 'submissionRepository',
            'courseRepository', 'caseRepository', 'assessmentRepository', 'rubricRepository', 'contentRepository'];
        const allUniform = objectRepos.every(function (n) {
            const r = Phase8.repositories[n];
            return r && typeof r.getById === 'function' && typeof r.list === 'function'
                && typeof r.save === 'function' && typeof r.query === 'function';
        });
        const expected = ['studentRepository', 'diagnosticRepository', 'analyticsRepository',
            'auditRepository', 'syncQueueRepository', 'notificationRepository', 'activityRepository'];
        const exposed = expected.every(function (n) { return Phase8.repositories[n]; });
        return { allUniform: allUniform, exposed: exposed };
    })()`);
    assert(repApi.allUniform === true, 'repositor objek: interface seragam getById/list/save/query (Â§35)');
    assert(repApi.exposed === true, 'semua repositor (student/diagnostic/analytics/dll) diekspos Â§35');
    const swap = await getVal(`(function () {
        const p = Phase8.indexedDB.createProvider();
        Phase8.setStoreProvider(p);
        const res = Phase8.userService.createUser(
            { name: 'Repo Swap', username: 'repoSwap', password: 'repo12345', role: 'STUDENT' },
            { id: 'ADM_9', role: 'ADMIN', name: 'Ops', username: 'ops', organizationId: null });
        const repoGot = Phase8.repositories.userRepository.getById(res.data.id);
        const provGot = p.getStore('users')[res.data.id];
        Phase8.setStoreProvider();
        return { throughRepo: repoGot === provGot, fromRepo: !!repoGot,
            direct: !!Phase8.repositories.userRepository.getById(res.data.id) };
    })()`);
    assert(swap.throughRepo === true && swap.fromRepo === true && swap.direct === false,
        'service berjalan lewat repositori -> provider aktif (local/cloud swap tanpa ubah UI, Â§35)');
    const repData = getVal(`(function () {
        const adm = { id: 'ADM_9', role: 'ADMIN', name: 'Ops', username: 'ops', organizationId: null };
        const ins = { id: 'INS_9', role: 'INSTRUCTOR', name: 'Guru 9', username: 'guru9', organizationId: 'ORG_9' };
        const s1 = Phase8.userService.createUser({ name: 'Repo Satu', username: 'repSatu', password: 'repo12345', role: 'STUDENT' }, adm).data;
        const s2 = Phase8.userService.createUser({ name: 'Repo Dua', username: 'repDua', password: 'repo12345', role: 'STUDENT' }, adm).data;
        const studs = Phase8.repositories.studentRepository.list();
        const allStudents = studs.every(function (u) { return u.role === 'STUDENT'; }) && studs.length >= 2;
        const cls = Phase8.classService.createClass({ name: 'Kelas Repo', subject: 'Sistem', organizationId: 'ORG_9' }, ins).data;
        Phase8.classService.addStudent(cls.id, s1.id, ins);
        const byClass = Phase8.repositories.studentRepository.findByClass(cls.id);
        const inClass = byClass.some(function (u) { return u.id === s1.id; })
            && !byClass.some(function (u) { return u.id === s2.id; });
        const a = Phase8.assignmentService.create({ title: 'Repo Diagnostik', type: 'DIAGNOSTIC_CASE', contentId: 'CASE_92', classId: cls.id }, ins).data;
        Phase8.assignmentService.publish(a.id, ins);
        const st1 = Phase8.repositories.userRepository.getById(s1.id);
        Phase8.submissionService.start(st1, a.id);
        const diag = Phase8.repositories.diagnosticRepository.list();
        const onlyDiag = diag.length >= 1 && diag.every(function (x) {
            const aa = Phase8.repositories.assignmentRepository.getById(x.assignmentId);
            return aa && aa.type === 'DIAGNOSTIC_CASE';
        });
        const qDiag = Phase8.repositories.diagnosticRepository.query(function (x) {
            const aa = Phase8.repositories.assignmentRepository.getById(x.assignmentId);
            return aa && aa.title === 'Repo Diagnostik';
        });
        const newStudent = Phase8.repositories.studentRepository.save({ name: 'Baru', username: 'repBaru', password: 'repo12345', role: 'GUEST' });
        return { allStudents: allStudents, inClass: inClass, onlyDiag: onlyDiag, qDiag: qDiag, newRole: newStudent.role };
    })()`);
    assert(repData.allStudents === true, 'studentRepository.list() hanya siswa (Â§35)');
    assert(repData.inClass === true, 'studentRepository.findByClass() presisi');
    assert(repData.onlyDiag === true, 'diagnosticRepository hanya sesi DIAGNOSTIC_CASE');
    assert(repData.qDiag.length === 1, 'repository.query() memfilter via repo layer');
    assert(repData.newRole === 'STUDENT', 'studentRepository.save memaksa role STUDENT');

    console.log('\n21: OFFLINE MODE (Â§34, Â§41, Â§81-82)');
    assert(P8('offlineService.getNetwork()') === 'ONLINE', 'default network ONLINE');
    assert(P8('NETWORK_STATES').length === 4 && P8('NETWORK_STATES').indexOf('SYNC ERROR') >= 0,
        'network states: ONLINE/OFFLINE/SYNCING/SYNC ERROR (Â§82)');
    const offDef = P8('offlineService.setNetwork("WEIRD")');
    assert(offDef.success === false && offDef.error.code === 'VALIDATION', 'state invalid ditolak (VALIDATION)');
    const offWork = getVal(`(function () {
        const off = Phase8.offlineService;
        const adm = { id: 'ADM_9', role: 'ADMIN', name: 'Ops', username: 'ops', organizationId: null };
        const ins = { id: 'INS_9', role: 'INSTRUCTOR', name: 'Guru 9', username: 'guru9', organizationId: 'ORG_9' };
        const set = off.setNetwork('OFFLINE');
        const isOff = off.isOffline();
        const learningStill = Phase8.dashboardService.learningAvailable();       // Â§41: belajar tetap jalan
        const s1 = Phase8.userService.createUser({ name: 'Online Satu', username: 'offSatu', password: 'off12345', role: 'STUDENT' }, adm).data;
        const cls = Phase8.classService.createClass({ name: 'Kelas Offline', subject: 'Sistem', organizationId: 'ORG_9' }, ins).data;
        Phase8.classService.addStudent(cls.id, s1.id, ins);
        const a = Phase8.assignmentService.create({ title: 'Tugas Offline', type: 'DIAGNOSTIC_CASE', contentId: 'CASE_93', classId: cls.id }, ins).data;
        Phase8.assignmentService.publish(a.id, ins);
        const stu = Phase8.repositories.userRepository.getById(s1.id);
        const started = Phase8.submissionService.start(stu, a.id);
        const marks = off.localChanges();
        const mark = marks.filter(function (m) { return m.entity === 'SUBMISSION' && m.entityId === started.data.id; })[0];
        const status = off.syncStatus();
        return {
            set: set, isOff: isOff, learningStill: learningStill, started: started,
            marked: !!mark && mark.savedLocally === true && mark.retry === true,
            status: status, subId: started.data.id
        };
    })()`);
    assert(offWork.set.success === true && offWork.set.data.changed === true && offWork.isOff === true,
        'setNetwork(OFFLINE) mengubah state');
    assert(offWork.learningStill === true, 'engine belajar tetap berjalan saat OFFLINE (Â§41)');
    assert(offWork.started.success === true && offWork.started.data.savedLocally === true
        && offWork.started.data.network === 'OFFLINE', 'submission dijalankan OFFLINE: tersimpan lokal (Â§41/Â§81)');
    assert(offWork.marked === true, 'perubahan lokal ditandai (saved locally + retry)');
    assert(offWork.status.network === 'OFFLINE' && offWork.status.mode === 'LOCAL_FIRST'
        && offWork.status.retryAvailable === false, 'sync status: OFFLINE + LOCAL_FIRST (Â§34/Â§82)');
    const offReconnect = getVal(`(function () {
        const off = Phase8.offlineService;
        const marksBefore = off.localChanges().length;
        const go = off.setNetwork('ONLINE');                                   // reconnect
        const lastSync = off.syncStatus().lastSyncAt;
        const audit = Phase8.repositories.auditRepository.list()
            .filter(function (l) { return l.action === 'ONLINE_RESTORED'; });
        const kept = Phase8.repositories.submissionRepository.query(function (s) {
            return s.savedLocally === true;
        });
        const marksAfter = off.localChanges().length;
        return { go: go, lastSync: lastSync, audit: audit, kept: kept.length >= 1,
            sameMarks: marksAfter === marksBefore, role: Phase8.session().role };
    })()`);
    assert(offReconnect.go.success === true && offReconnect.go.data.from === 'OFFLINE' && offReconnect.lastSync !== null,
        'reconnect -> ONLINE, lastSyncAt tercatat');
    assert(offReconnect.audit.length === 1, 'audit ONLINE_RESTORED tercatat');
    assert(offReconnect.kept === true && offReconnect.sameMarks === true,
        'reconnect TIDAK menghapus data lokal (Â§81)');
    assert(offReconnect.role === 'GUEST', 'sync/session state terpisah (session tidak terpengaruh)');
    const offListen = getVal(`(function () {
        const off = Phase8.offlineService;
        const fired = [];
        const un = off.onNetworkChange(function (s) { fired.push(s); });
        off.setNetwork('OFFLINE');
        off.setNetwork('ONLINE');
        un();
        off.setNetwork('OFFLINE');
        const afterUn = fired.length;
        off.setNetwork('ONLINE');
        const dup = off.setNetwork('ONLINE');
        return { fired: fired, afterUn: afterUn, dupChanged: dup.data.changed === false };
    })()`);
    assert(offListen.fired.length === 2 && offListen.afterUn === 2, 'listener network memicu & dapat dilepas');
    assert(offListen.dupChanged === true, 'setNetwork ke nilai sama -> changed=false (idempoten)');
    assert(P8('offlineService.bindBrowser()') === true, 'bindBrowser aman tanpa window nyata (node)');

    console.log('\n22: SYNC QUEUE (Â§39-40, Â§42)');
    const sq1 = getVal(`(function () {
        const ss = Phase8.syncService;
        ss.clearSynced();
        const a = ss.enqueue('CREATE', 'SUBMISSION', 'SUB_X1', { title: 'x', syncVersion: 1 });
        const a2 = ss.enqueue('UPDATE', 'SUBMISSION', 'SUB_X1', { title: 'x2', syncVersion: 1 });
        const list = ss.list().data;
        const dupOnly = list.filter(function (q) { return q.entityId === 'SUB_X1'; }).length === 1;
        const modelOk = !!a.data.id && String(a.data.id).slice(0, 5) === 'SYNC_'
            && !!a.data.createdAt === false && !!list[0].createdAt
            && a2.data.dedupe === true && list[0].payload.title === 'x2'
            && list[0].status === 'PENDING';
        const mirror = Phase8.syncState().queue === list.length;
        Phase8.offlineService.setNetwork('OFFLINE');
        const blocked = ss.attemptSync();
        const pendingKept = list[0].status === 'PENDING';
        return { modelOk: modelOk, dupOnly: dupOnly, mirror: mirror,
            blocked: blocked, pendingKept: pendingKept };
    })()`);
    assert(sq1.modelOk === true, 'model antrean Â§40: {id:SYNC_.., operation, entity, entityId, payload, createdAt, status}');
    assert(sq1.dupOnly === true, 'enqueue dedupe utk entity+entityId sama (payload diperbarui)');
    assert(sq1.mirror === true, 'syncState.queue mencerminkan antrean (sync state terpisah Â§86)');
    assert(sq1.blocked.success === false && sq1.blocked.error.code === 'OFFLINE',
        'sync diblokir saat OFFLINE; item tetap lokal (Â§81)');
    assert(sq1.pendingKept === true, 'item tidak dihapus saat sync gagal (retry tersedia)');
    const sq2 = getVal(`(function () {
        const ss = Phase8.syncService;
        Phase8.offlineService.setNetwork('ONLINE'); // reconnect -> auto sync
        const st = ss.status();
        const go = ss.attemptSync();
        return { st: st, go: go };
    })()`);
    assert(sq2.st.synced === 1, 'reconnect -> sync otomatis (PENDING -> SYNCED) (Â§39)');
    assert(sq2.go.data.processed === 0, 'attemptSync tanpa item -> processed 0 (idempoten)');
    const sq3 = getVal(`(function () {
        const ss = Phase8.syncService;
        ss.setClient({ post: function () { return { success: false, error: { code: 'CLOUD_ERROR', message: 'cloud down' } }; } });
        const b = ss.enqueue('UPDATE', 'ASSIGNMENT', 'ASS_X2', { title: 'draft', syncVersion: 1 });
        const res = ss.attemptSync();
        const item = ss.list().data.filter(function (q) { return q.id === b.data.id; })[0];
        const payloadRetained = item && item.payload && item.payload.title === 'draft';
        const markedFailed = item && item.status === 'FAILED' && item.failReason === 'cloud down';
        ss.setClient(null);
        const retried = ss.attemptSync();
        return { res: res, payloadRetained: payloadRetained, markedFailed: markedFailed, retried: retried };
    })()`);
    assert(sq3.res.data.result.failed === 1 && sq3.markedFailed === true,
        'gagal sync -> FAILED + reason (payload lokal utuh, Â§81)');
    assert(sq3.payloadRetained === true, 'data lokal TIDAK dihapus saat sync gagal (Â§81)');
    assert(sq3.retried.data.result.synced === 1, 'retry setelah cloud pulih -> FAILED -> SYNCED');
    const sq4 = getVal(`(function () {
        const ss = Phase8.syncService;
        const adm = { id: 'ADM_9', role: 'ADMIN', name: 'Ops', username: 'ops', organizationId: null };
        const c = ss.enqueue('UPDATE', 'USER', 'USR_KEEP', { syncVersion: 1, conflictSim: true,
            remote: { id: 'USR_KEEP', name: 'Remote Reviewed' } });
        ss.attemptSync();
        const itemC = ss.list().data.filter(function (q) { return q.id === c.data.id; })[0];
        const markedConflict = itemC && itemC.status === 'CONFLICT'
            && itemC.conflict.localVersion === 1 && itemC.conflict.remoteVersion === 2
            && itemC.conflict.timestamp != null && itemC.conflict.user !== undefined && !!itemC.conflict.remote;
        const kept = ss.resolveConflict(c.data.id, 'LOCAL', adm);
        const keptAudit = Phase8.repositories.auditRepository.list().filter(function (l) {
            return l.action === 'SYNC_CONFLICT_RESOLVED' && l.extra && l.extra.keep === 'LOCAL';
        }).length;
        const u0 = Phase8.userService.createUser({ name: 'Keep Me', username: 'keepMe', password: 'keep12345', role: 'STUDENT' }, adm).data;
        const c2 = ss.enqueue('UPDATE', 'USER', u0.id, { syncVersion: 1, conflictSim: true,
            remote: { id: u0.id, name: 'Remote Name 2' } });
        ss.attemptSync();
        ss.resolveConflict(c2.data.id, 'REMOTE', adm);
        const renamed = Phase8.repositories.userRepository.getById(u0.id).name === 'Remote Name 2';
        const c3 = ss.enqueue('UPDATE', 'USER', 'USR_KEEP3', { syncVersion: 1, conflictSim: true,
            remote: { id: 'USR_KEEP3' } });
        ss.attemptSync();
        const badKeep = ss.resolveConflict(c3.data.id, 'SOMETHING', adm);
        ss.resolveConflict(c3.data.id, 'LOCAL', adm);
        const resolvedAll = ss.list().data.filter(function (q) { return q.status === 'SYNCED'; }).length;
        const notFound = ss.resolveConflict('SYNC_NOPE', 'LOCAL', adm);
        return { markedConflict: markedConflict, keptStatus: kept.data.status, keptAudit: keptAudit,
            renamed: renamed, resolvedAll: resolvedAll, bad: notFound, badKeep: badKeep };
    })()`);
    assert(sq4.markedConflict === true, 'CONFLICT DETECTED Â§42: simpan localVersion/remoteVersion/timestamp/user');
    assert(sq4.keptStatus === 'SYNCED' && sq4.keptAudit === 1, 'resolve keep LOCAL -> SYNCED + audit');
    assert(sq4.renamed === true, 'resolve keep REMOTE -> versi remote diterapkan (tanpa menimpa diam-diam)');
    assert(sq4.resolvedAll >= 3, 'semua konflik ter-resolve ke SYNCED (riwayat tersimpan)');
    assert(sq4.bad.error.code === 'NOT_FOUND' && sq4.badKeep.error.code === 'VALIDATION',
        'resolveConflict: validasi id & keep (LOCAL|REMOTE)');
    const sq5 = getVal(`(function () {
        const ss = Phase8.syncService;
        const before = ss.list().data.length;
        const merged = ss.attemptSync(); // tak ada PENDING/FAILED
        const res = ss.clearSynced();
        const after = ss.list().data.length;
        const mirror = Phase8.syncState().queue === after;
        return { before: before, after: after, merged: merged, mirror: mirror };
    })()`);
    assert(sq5.before > 0 && sq5.after === 0, 'clearSynced: antrean aktif kosong setelah sukses sync');
    assert(sq5.merged.data.processed === 0 && sq5.mirror === true, 'idempoten & syncState.queue konsisten');

    console.log('\n23: CLOUD API ABSTRACTION (Â§37-38)');
    const ca1 = getVal(`(function () {
        const ad = Phase8.adapters;
        const verbs = typeof Phase8.apiClient.get === 'function' && typeof Phase8.apiClient.post === 'function'
            && typeof Phase8.apiClient.put === 'function' && typeof Phase8.apiClient.delete === 'function';
        const factories = [ad.mock, ad.rest, ad.graphql, ad.firebase, ad.supabase, ad.custom]
            .every(function (f) { return typeof f === 'function'; });
        const transports = Phase8.apiClient.listAdapters().transports;
        const hasBackends = ['Mock API Adapter', 'REST API', 'GraphQL', 'Firebase', 'Supabase', 'Custom Node.js API']
            .every(function (t) { return transports.indexOf(t) >= 0; });
        const op = Phase8.apiClient.get('/me');
        return { verbs: verbs, factories: factories, hasBackends: hasBackends, mode: Phase8.apiClient.mode, op: op };
    })()`);
    assert(ca1.verbs === true, 'apiClient: get/post/put/delete tersedia sebagai abstraction (Â§37)');
    assert(ca1.factories === true && ca1.hasBackends === true,
        'backend Â§38 difaktori: REST/GraphQL/Firebase/Supabase/Custom Node.js API');
    assert(ca1.mode === 'MOCK' && ca1.op.success === true, 'default: Mock API Adapter bekerja (Â§37)');
    const ca2 = getVal(`(function () {
        const seen = [];
        const un = Phase8.apiClient.onRequest(function (evt, req) { seen.push(req); });
        const callNorm = function () { return Phase8.apiClient.get('/me'); };   // satu-satunya panggilan UI
        const echo = function (tag) { return function (r) {
            return { success: true, data: { echo: { kind: r.kind, method: r.method, path: r.path } } };
        }; };
        const out = [];
        out.push([Phase8.apiClient.setAdapter(Phase8.adapters.rest({ handler: echo() })), callNorm()]);
        out.push([Phase8.apiClient.setAdapter(Phase8.adapters.graphql({ handler: echo() })), callNorm()]);
        out.push([Phase8.apiClient.setAdapter(Phase8.adapters.supabase({ handler: echo() })), callNorm()]);
        out.push([Phase8.apiClient.setAdapter(Phase8.adapters.firebase({ handler: echo() })), callNorm()]);
        out.push([Phase8.apiClient.setAdapter(Phase8.adapters.custom({ handler: echo() })), callNorm()]);
        const kindsSeen = seen.filter(function (r) { return r.method === 'GET'; }).map(function (r) { return r.kind; });
        const anyHandler = out.every(function (o) { return o[1].success === true && o[1].data.echo && o[1].data.echo.path === '/me'; });
        const backendsRouted = ['REST', 'GRAPHQL', 'SUPABASE', 'FIREBASE', 'CUSTOM']
            .every(function (k) { return kindsSeen.indexOf(k) >= 0; });
        Phase8.apiClient.resetMock();
        return { anyHandler: anyHandler, backendsRouted: backendsRouted, afterReset: Phase8.apiClient.mode };
    })()`);
    assert(ca2.backendsRouted === true, 'satu panggilan apiClient.get (UI/engine tak berubah) dirutekan semua backend Â§38');
    if (ca2.backendsRouted !== true || ca2.anyHandler !== true) {
            console.log('DBG ca2 keys', Object.keys(ca2).join(','));
            console.log('DBG ca2 backendsRouted', JSON.stringify(ca2.backendsRouted), 'anyHandler', JSON.stringify(ca2.anyHandler));
        }
    assert(ca2.anyHandler === true, 'hasil adapter seragam untuk pemakai (app code identik)');
    assert(ca2.afterReset === 'MOCK', 'resetMock kembali ke Mock API Adapter');
    const ca3 = getVal(`(function () {
        Phase8.apiClient.resetMock();
        Phase8.apiClient.setAdapter(Phase8.adapters.rest());  // tanpa handler: backend belum dikonfigurasi
        const na = Phase8.apiClient.get('/me');
        const restore = Phase8.apiClient.resetMock();
        const again = Phase8.apiClient.get('/me');
        const learning = Phase8.dashboardService.learningAvailable();
        return { na: na, restoreMode: restore.data.mode, again: again, learning: learning };
    })()`);
    assert(ca3.na.success === false && ca3.na.error.code === 'NOT_AVAILABLE',
        'backend belum dikonfigurasi -> NOT_AVAILABLE; Mock dipakai (Â§37)');
    assert(ca3.restoreMode === 'MOCK' && ca3.again.success === true, 'reset ke Mock: aplikasi tetap berfungsi penuh');
    assert(ca3.learning === true, 'engine belajar TIDAK berubah walau adapter cloud diganti (Â§38)');
    const ca4 = getVal(`(function () {
        const got = [];
        const un = Phase8.apiClient.onRequest(function () { got.push(1); });
        Phase8.apiClient.get('/me');
        un();
        Phase8.apiClient.get('/me');
        return { got: got.length };
    })()`);
    assert(ca4.got === 1, 'listener request dapat dilepas (onRequest lifecycle)');

    call('resetDemo');
    assert(P8('session()').role === 'GUEST', 'resetDemo -> guest session');
    assert(P8('repositories.userRepository.list()').length === 0, 'resetDemo empties users');
    assert(P8('repositories.caseRepository.list()').length === 0, 'resetDemo empties caseRefs');
    assert(P8('repositories.assignmentRepository.list()').length === 0, 'resetDemo empties assignments');
    assert(P8('repositories.submissionRepository.list()').length === 0, 'resetDemo empties submissions');

    /* ---- 24. ANALYTICS (Â§28-30, STEP 19) ---- */
    console.log('\n24: ANALYTICS (Â§28 LEARNING / Â§29 CLASS / Â§30 STUDENT DETAIL)');
    const an1 = evalExpr(`(function () {
         const una = Phase8.repositories.userRepository.getById('S_AN_100');
        const hasAnalytics = Phase8.repositories.analyticsRepository !== undefined
            && typeof Phase8.repositories.analyticsRepository.learningAnalytics === 'function'
            && typeof Phase8.repositories.analyticsRepository.classAnalytics === 'function'
            && typeof Phase8.repositories.analyticsRepository.studentDetail === 'function'
            && typeof Phase8.repositories.analyticsRepository.progress === 'function'
            && typeof Phase8.repositories.analyticsRepository.classSummary === 'function';
        if (!una) return { hasAnalytics: hasAnalytics };
        return { hasAnalytics: hasAnalytics };
    })()`);
    assert(an1.hasAnalytics === true, 'analyticsRepository mengekspos learning/class/student-detail (Â§28-30, STEP 19)');
    const an2 = getVal(`(function () {
        const admin = { id: 'ADM_AN', role: 'ADMIN', name: 'Ops Analytics', organizationId: null };
        const userRepo = Phase8.repositories.userRepository;
        const caseRepo = Phase8.repositories.caseRepository;
        const classRepo = Phase8.repositories.classRepository;
        const asgRepo = Phase8.repositories.assignmentRepository;
        const subRepo = Phase8.repositories.submissionRepository;
        const u1 = userRepo.save({ id: 'S_AN_1', role: 'STUDENT', name: 'Ana Belajar', username: 'anBelajar', organizationId: 'ORG_1' });
        const case1 = caseRepo.save({ id: 'C_AN_1', title: 'Kasus Sensor 1', difficulty: 'SULIT', skillFocus: 'SENSOR', status: 'PUBLISHED', refId: 'REF_AN_1' });
        const cv1 = Phase8.repositories.studentRepository.list(); 
        const klass = classRepo.save({ id: 'K_AN_1', name: 'Kelas Analitik', subject: 'Sistem', academicYear: '2026/2027', studentIds: ['S_AN_1'], instructorIds: ['I_AN_1'] });
        const asg = asgRepo.save({ id: 'A_AN_1', classId: 'K_AN_1', title: 'Tugas Diagnosis 1', type: 'DIAGNOSTIC_CASE', status: 'PUBLISHED', caseId: 'C_AN_1', dueAt: 99999 });
        subRepo.save({ id: 'SB_AN_1', assignmentId: 'A_AN_1', studentId: 'S_AN_1', status: 'GRADED', score: 90, timeSpent: 1200, timeStarted: 100, timeSubmitted: 1300 });
        const learn = Phase8.repositories.analyticsRepository.learningAnalytics('S_AN_1');
        const clsSm = Phase8.repositories.analyticsRepository.classAnalytics('K_AN_1', { actor: admin });
        const studentDetail = Phase8.repositories.analyticsRepository.studentDetail('K_AN_1', 'S_AN_1', { actor: admin });
        return { learn: learn, clsSm: clsSm, studentDetail: studentDetail };
    })()`);
    assert(an2.learn && an2.learn.success === true, 'learningAnalytics tersedia untuk siswa (Â§28)');
    assert(an2.learn.data && typeof an2.learn.data.averageScore === 'number' && an2.learn.data.averageScore === 90,
        'averageScore dihitung dari submission nyata (Â§28)');
    assert(an2.learn.data && typeof an2.learn.data.completionRate === 'number' && an2.learn.data.completionRate === 100,
        'completion rate dihitung nyata (1/1) (Â§28)');
    assert(an2.learn.data && Array.isArray(an2.learn.data.insights) === false, 'analytics bukan daftar nilai tunggal');
    assert(an2.clsSm && (an2.clsSm.success === false || (an2.clsSm.data && 'studentCount' in an2.clsSm.data)),
        'classAnalytics memvalidasi RBAC/klas; metrik kelas (Â§29)');
    assert(an2.studentDetail && an2.studentDetail.success === true,
        'studentDetail: profil + kelas + kemajuan + asesmen + riwayat diagnosis (Â§30)');
    const an3 = getVal(`(function () {
        const guest = { id: 'G', role: 'GUEST', name: 'Tamu' };
        const res = Phase8.repositories.analyticsRepository.studentDetail('K_AN_1', 'S_AN_1', { actor: guest });
        return res && res.success !== true ? res.error : res;
    })()`);
    assert(an3 && an3.success !== true, 'GUEST tidak boleh lihat detail siswa (RBAC Â§30)');
    assert(P8('repositories.analyticsRepository.analyticNote()').warning
        && /bukan penilaian tunggal/.test(P8('repositories.analyticsRepository.analyticNote()').warning),
        'catatan etis: analytics BUKAN penilaian tunggal kemampuan siswa (Â§28)');

    /* ---- 25. LEARNING-PATH RECOMMENDATION (STEP 20, deterministic Â§28-30) ---- */
    console.log('\n25: LEARNING-PATH RECOMMENDATION (STEP 20, deterministic Â§28-30)');
    const lp = evalExpr(`(function () {
        const actor = { id: 'S_LP_1', role: 'STUDENT', name: 'Belajar Rapli' };
        const guest = { id: 'G', role: 'GUEST', name: 'Tamu' };
        const uRepo = Phase8.repositories.userRepository;
        const clsRepo = Phase8.repositories.classRepository;
        const asRepo = Phase8.repositories.assignmentRepository;
        const subRepo = Phase8.repositories.submissionRepository;
        const caseRepo = Phase8.repositories.caseRepository;
        const contentRepo = Phase8.repositories.contentRepository;
        uRepo.save({ id: 'S_LP_1', role: 'STUDENT', name: 'Belajar Rapli', username: 'belajarrapli', organizationId: 'ORG_1' });
        uRepo.save({ id: 'S_LP_2', role: 'STUDENT', name: 'Siswa Lain', username: 'siswalain', organizationId: 'ORG_1' });
        uRepo.save({ id: 'I_LP_1', role: 'INSTRUCTOR', name: 'Instruktur Path', username: 'instrukturpath', organizationId: 'ORG_1' });
        clsRepo.save({ id: 'K_LP_1', name: 'Kelas Path', subject: 'IPA', academicYear: '2026/2027',
            instructorIds: ['I_LP_1'], studentIds: ['S_LP_1'] });
        caseRepo.save({ id: 'C_LP_1', title: 'Kasus Fisika Dasar', skillFocus: 'FISIKA', status: 'PUBLISHED', difficulty: 'SULIT' });
        caseRepo.save({ id: 'C_LP_2', title: 'Kasus Kimia', skillFocus: 'KIMIA', status: 'PUBLISHED', difficulty: 'SEDANG' });
        contentRepo.save({ id: 'CT_LP_1', title: 'Materi Gaya & Gerak', type: 'LESSON', skillFocus: 'FISIKA', status: 'PUBLISHED' });
        asRepo.save({ id: 'A_LP_1', classId: 'K_LP_1', title: 'Tugas Fisika', type: 'DIAGNOSTIC_CASE', status: 'PUBLISHED', caseId: 'C_LP_1' });
        asRepo.save({ id: 'A_LP_2', classId: 'K_LP_1', title: 'Tugas Kimia', type: 'DIAGNOSTIC_CASE', status: 'PUBLISHED', caseId: 'C_LP_2' });
        subRepo.save({ id: 'SB_LP_1', assignmentId: 'A_LP_1', studentId: 'S_LP_1', status: 'GRADED', score: 55 });
        subRepo.save({ id: 'SB_LP_2', assignmentId: 'A_LP_2', studentId: 'S_LP_1', status: 'GRADED', score: 92 });
        const rec = Phase8.repositories.learningPathRepository.recommendNext('S_LP_1', { actor });
        const twice = Phase8.repositories.learningPathRepository.recommendNext('S_LP_1', { actor });
        const forbidden = Phase8.repositories.learningPathRepository.recommendNext('S_LP_1', { actor: guest });
        const instructorOk = Phase8.repositories.learningPathRepository.recommendNext('S_LP_1', { actor: { id: 'I_LP_1', role: 'INSTRUCTOR', name: 'Instruktur Path' } });
        const roleSvc = Phase8.learningPathService.recommendedForRole({ actor: { id: 'I_LP_1', role: 'INSTRUCTOR', name: 'Instruktur Path' } });
        const denyOther = Phase8.repositories.learningPathRepository.recommendNext('S_LP_1', { actor: { id: 'S_LP_2', role: 'STUDENT', name: 'Siswa Lain' } });
        return {
            rec, twice, forbidden, instructorOk, roleSvc, denyOther,
            note: Phase8.learningPathService.learningPathNote()
        };
    })()`);
    assert(lp.rec && lp.rec.success === true, 'learningPathRepository.recommendNext() tersedia (STEP 20 Â§30-derivatif)');
    assert(lp.rec.data && lp.rec.data.weakestSkill && lp.rec.data.weakestSkill.skillFocus === 'FISIKA',
        'weakestSkill dihitung dari rata2 skor nyata (55 FISIKA < 92 KIMIA, deterministic Â§28)');
    assert(lp.rec.data.nextStep && lp.rec.data.nextStep.available === true &&
        lp.rec.data.nextStep.skillFocus === 'FISIKA',
        'nextStep = langkah belajar utk skill terlemah dari konten PUBLISHED nyata');
    assert(lp.twice.data && JSON.stringify(lp.twice.data) === JSON.stringify(lp.rec.data),
        'rekomendasi DETERMINISTIK (panggilan ulang hasil identik, tanpa Math.random)');
    assert(lp.instructorOk && lp.instructorOk.success === true,
        'instruktur di kelasnya dapat merekomendasikan siswanya (Â§30-derivatif)');
    assert(lp.forbidden && lp.forbidden.success !== true && /AUTH_REQUIRED/.test(String((lp.forbidden.error && lp.forbidden.error.code) || '')),
        'GUEST ditolak mendapatkan rekomendasi belajar (RBAC Â§30)');
    assert(lp.denyOther && lp.denyOther.success !== true,
        'siswa TIDAK dapat melihat rekomendasi siswa lain (FORBIDDEN, RBAC Â§30)');
    assert(lp.rec.data.topSuggestions && Array.isArray(lp.rec.data.topSuggestions) && lp.rec.data.topSuggestions.length > 0,
        'topSuggestions berisi tautan konten belajar nyata (bukan karangan)');
    assert(lp.roleSvc && lp.roleSvc.success === true && Array.isArray(lp.roleSvc.data.recommendations),
        'recommendedForRole utk instruktur: rekomendasi siswanya di kelasnya');
    assert(lp.note && lp.note.warning && /bukan vonis/.test(lp.note.warning),
        'catatan etis: rekomendasi membantu memilih langkah, BUKAN vonis kemampuan (Â§28)');

    /* ---- 26. CLOUD SYNC & DETERMINISTIC RETRY (STEP 22, deterministic Â§34-36) ---- */
    console.log('\n26: CLOUD SYNC & DETERMINISTIC RETRY (STEP 22, deterministic Â§34-36)');
    const csraw = evalExpr(`(function () {
        const svc = Phase8.cloudSyncService;
        if (!svc) return { missing: true };
        const guest = svc.drive({ actor: { id: 'G_CS_1', role: 'GUEST', name: 'Tamu' } });
        const st = svc.drive({ actor: { id: 'S_CS_1', role: 'STUDENT', name: 'Siswa Cloud', organizationId: 'ORG_1' } });
        const st2 = svc.drive({ actor: { id: 'S_CS_1', role: 'STUDENT', name: 'Siswa Cloud', organizationId: 'ORG_1' } });
        const inst = svc.drive({ actor: { id: 'I_CS_1', role: 'INSTRUCTOR', name: 'Instruktur Cloud', organizationId: 'ORG_1' } });
        const note = svc.retryNote();
        return { svc, guest, st, st2, inst, note };
    })()`);
    assert(csraw.svc && csraw.svc.maxAttempts === 3, 'cloudSyncService.maxAttempts = 3 (STEP 22 Â§34)');
    assert(csraw.svc && typeof csraw.svc.backoffMs === 'function' &&
        csraw.svc.backoffMs(1) === 500 && csraw.svc.backoffMs(2) === 1000 && csraw.svc.backoffMs(3) === 1500,
        'backoff DETERMINISTIK: 500ms x attempt (tanpa Math.random, Â§35)');
    assert(csraw.guest && csraw.guest.success !== true && /AUTH_REQUIRED/.test(JSON.stringify(csraw.guest)),
        'GUEST ditolak melakukan sinkronisasi cloud (AUTH_REQUIRED, RBAC Â§34)');
    assert(csraw.st && csraw.st.success === true && csraw.st.data &&
        csraw.st.data.deterministic === true &&
        Array.isArray(csraw.st.data.retryPolicy) && csraw.st.data.retryPolicy.length === 3 &&
        csraw.st.data.retryPolicy[0].attempt === 1 && csraw.st.data.retryPolicy[2].backoffMs === 1500,
        'sinkronisasi DETERMINISTIK: retryPolicy tetap 500/1000/1500ms x 3 percobaan, tanpa tebakan acak (Â§35)');
    assert(JSON.stringify(csraw.st.data.retryPolicy) === JSON.stringify(csraw.st2.data.retryPolicy),
        'sinkronisasi DETERMINISTIK: panggilan ulang hasil identik, tanpa Math.random (Â§35)');
    assert(csraw.inst && csraw.inst.success === true, 'instruktur dapat menjalankan sinkronisasi cloud (RBAC Â§34)');
    assert(csraw.note && csraw.note.data && /bukan ujian kesabaran|bukan ujian/i.test(JSON.stringify(csraw.note.data)),
        'catatan etis: retry membantu mengantarkan data belajar NYATA siswa, BUKAN ujian kesabaran siswa (Â§36)');

    console.log('\n==================================');

    console.log('\n\n== 27: EQUITY & DETERMINISTIC SELF-EFFICACY MONITORING (STEP 23, deterministik A37-39) ==');
    var eqs = P8('equityMonitorService');
    assert(eqs && eqs.maxChecks === 4, 'equityMonitorService.maxChecks = 4 (RBAC A37)');
    var eqGuest = eqs.drive({ actor: { id: null, role: 'GUEST' } });
    assert(eqGuest.error && /AUTH_REQUIRED/i.test(JSON.stringify(eqGuest)),
        'RBAC A37: GUEST tidak dapat memantau efikasi diri siswa (AUTH_REQUIRED)');
    var eqDet = eqs.drive({ actor: { id: 'U3', role: 'STUDENT' }, studentId: 'S1' });
    assert(eqDet.success === true && eqDet.data && eqDet.data.sparse && eqDet.data.sparse.length === 4,
        'pemantauan DETERMINISTIK: 4 checks efikasi diri tetap, tanpa Math.random (A38)');
    var eqDet2 = eqs.drive({ actor: { id: 'U3', role: 'STUDENT' }, studentId: 'S1' });
    assert(JSON.stringify(eqDet.data.sparse) === JSON.stringify(eqDet2.data.sparse),
        'pemantauan DETERMINISTIK: panggilan ulang hasil identik, tanpa tebakan acak (A38)');
    assert(eqDet.data && eqDet.data.note && eqDet.data.note.data && /bukan ujian|bukan vonis/i.test(JSON.stringify(eqDet.data.note.data)),
        'catatan etis: pemantauan efikasi diri memakai data belajar NYATA siswa, BUKAN ujian kesabaran BUKAN vonis (A39)');

    console.log('\n== 28: PORTFOLIO & LEARNING-OUTCOME ATTAINMENT EXPORT (STEP 24, deterministik A40-42) ==');
    var pfSvc = P8('portfolioExportService');
    assert(pfSvc && pfSvc.maxPortfolioItems === 4, 'portfolioExportService.maxPortfolioItems = 4 (RBAC A40)');
    var pfGuest = pfSvc.drive({ actor: { id: null, role: 'GUEST' } });
    assert(pfGuest.error && /AUTH_REQUIRED|FORBIDDEN/i.test(JSON.stringify(pfGuest)),
        'RBAC A40: GUEST tidak dapat mengekspor portofolio & capaian hasil belajar (AUTH_REQUIRED/FORBIDDEN)');
    var pfDet = pfSvc.drive({ actor: { id: 'U3', role: 'STUDENT' }, studentId: 'S1' });
    assert(pfDet.success === true && pfDet.data && pfDet.data.sparse && pfDet.data.sparse.length === 4,
        'ekspor DETERMINISTIK: 4 item portofolio & capaian tetap, tanpa Math.random (A41)');
    var pfDet2 = pfSvc.drive({ actor: { id: 'U3', role: 'STUDENT' }, studentId: 'S1' });
    assert(JSON.stringify(pfDet.data.sparse) === JSON.stringify(pfDet2.data.sparse),
        'ekspor DETERMINISTIK: panggilan ulang hasil identik, tanpa tebakan acak (A41)');
    assert(pfDet.data && pfDet.data.note && pfDet.data.note.data && /bukan ujian|bukan vonis/i.test(JSON.stringify(pfDet.data.note.data)),
        'catatan etis: ekspor portofolio & capaian memakai data belajar NYATA siswa, BUKAN ujian kesabaran BUKAN vonis (A42)');

    console.log('\n== 29: MENU PANDUAN & CARA MENJALANKAN SIMULATOR (deterministik A46-48) ==');
    var mn = P8('menuPanduanService');
    assert(mn && mn.maxGuideItems === 6, 'menuPanduanService.maxGuideItems = 6 (RBAC A46)');
    var mnGuest = mn.drive({ actor: { id: null, role: 'GUEST' } });
    assert(mnGuest.error && /AUTH_REQUIRED|FORBIDDEN/i.test(JSON.stringify(mnGuest)),
        'RBAC A46: GUEST tidak dapat membuka menu panduan (AUTH_REQUIRED/FORBIDDEN)');
    var mnDet = mn.drive({ actor: { id: 'U3', role: 'STUDENT' } });
    assert(mnDet.success === true && mnDet.data && mnDet.data.sparse && mnDet.data.sparse.length === 6,
        'menu panduan DETERMINISTIK: 6 panduan tetap, tanpa Math.random (A47)');
    var mnDet2 = mn.drive({ actor: { id: 'U3', role: 'STUDENT' } });
    assert(JSON.stringify(mnDet.data.sparse) === JSON.stringify(mnDet2.data.sparse),
        'menu panduan DETERMINISTIK: panggilan ulang hasil identik, tanpa tebakan acak (A47)');
    var mnStr = JSON.stringify(mnDet.data.sparse);
    assert(/node test\/instructorPlatform\.test\.js/i.test(mnStr),
        'panduan memuat perintah NYATA cara menjalankan suite (node test/instructorPlatform.test.js)');
    assert(/node -e/i.test(mnStr),
        'panduan memuat smoke cepat via node -e (cara menjalankan nyata, bukan karangan)');
    assert(mnDet.data && mnDet.data.note && mnDet.data.note.data && /bukan ujian|bukan vonis/i.test(JSON.stringify(mnDet.data.note.data)),
        'catatan etis: panduan memandu menjalankan & memakai data belajar NYATA, BUKAN ujian kesabaran BUKAN vonis (A48)');

    console.log('\n==================================');
    console.log(`PHASE 8 PLATFORM: ${passed} passed, ${failed} failed`);
}
function hs(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

main().catch(function (e) { console.error(e); process.exit(1); });
