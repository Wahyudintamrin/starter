/* ============================================================
   PHASE 5 — LEARNING & ASSESSMENT TEST SUITE
   ------------------------------------------------------------
   Boots ALL files (app → phase2 → phase3 → diagcases → phase4 →
   learningModules → learningLessons → learningQuestions →
   learningJobSheets → phase5) in one Node vm with a rich DOM mock,
   then runs TESTS 01-10 from prompt §65 plus data/API integrity.

   Run: node test/learningAssessment.test.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const files = [
    'app.js', 'realtimeParameter.js', 'multimeter.js', 'diagcases.js', 'diagnosticLab.js',
    'learningModules.js', 'learningLessons.js', 'learningQuestions.js',
    'learningJobSheets.js', 'learningAssessment.js',
];
const sources = {};
for (const f of files) sources[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---------------- Canvas 2D + DOM mock (proven in phase4 suite) ---------------- */
const MP_NAMES = [
    'batteryPositive', 'batteryNegative', 'fuseInput', 'fuseOutput',
    'ignitionInput', 'ignitionOutput', 'relayInput', 'relayOutput',
    'relayGround', 'solenoidControl', 'solenoidMain', 'solenoidGround',
    'starterPositive', 'starterGround', 'starterHousing', 'engineGround',
    'chassisGround',
];
const MP_COORDS = {
    batteryPositive: [135, 130], batteryNegative: [95, 150],
    fuseInput: [175, 178], fuseOutput: [215, 194],
    ignitionInput: [318, 252], ignitionOutput: [342, 276],
    relayInput: [446, 338], relayOutput: [478, 356], relayGround: [452, 372],
    solenoidControl: [586, 318], solenoidMain: [606, 258], solenoidGround: [632, 338],
    starterPositive: [702, 300], starterGround: [758, 392],
    starterHousing: [766, 384], engineGround: [796, 470], chassisGround: [828, 470],
};

function make2D() {
    return {
        clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
        stroke() {}, fillRect() {}, fillText() {}, strokeText() {}, rect() {},
        save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
        setLineDash() {}, createLinearGradient() { return { addColorStop() {} }; },
        measureText: () => ({ width: 0 }),
        lineWidth: 1, strokeStyle: '', fillStyle: '', font: '',
    };
}

const elementCache = {};
let elementSeq = 0;

function makeEl(id) {
    const el = {
        id: id || null,
        tagName: 'DIV',
        style: { display: '', width: '', background: '', stroke: '', animationDuration: '', transform: '' },
        dataset: {},
        children: [],
        textContent: '',
        innerHTML: '',
        className: '',
        checked: false,
        disabled: false,
        value: '',
        href: '',
        download: '',
        width: 340,
        height: 120,
        _classes: new Set(),
        _attrs: {},
        classList: {
            add: (...c) => c.forEach(x => el._classes.add(x)),
            remove: (...c) => c.forEach(x => el._classes.delete(x)),
            toggle: (c, force) => {
                const should = force === undefined ? !el._classes.has(c) : !!force;
                if (should) el._classes.add(c); else el._classes.delete(c);
                return should;
            },
            contains: c => el._classes.has(c),
        },
        setAttribute: (k, v) => { el._attrs[k] = v; },
        getAttribute: k => el._attrs[k],
        appendChild: c => { el.children.push(c); },
        remove() {},
        addEventListener() {},
        querySelectorAll: () => [],
        querySelector: () => null,
        getContext: () => make2D(),
    };
    elementCache[id || ('el-' + (++elementSeq))] = el;
    return el;
}

const WS_IDS = ['complaint', 'symptom', 'inspection', 'hypothesis', 'measurement', 'evidence', 'conclusion', 'repair', 'verification'];
const P5_IDS = ['lrn-dashboard', 'lrn-module', 'lrn-lesson', 'lrn-practice',
                'p5-assessment', 'p5-progress', 'p5-jobsheets', 'p5-jobsheet-detail',
                'p5-report-print', 'p5-cert-print', 'p5-cert-view', 'p5-comp-info'];
const idsInJs = Object.values(sources).flatMap(src => [...src.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]))
    .concat(WS_IDS.map(w => 'p4ws-' + w))
    .concat(P5_IDS);
for (const id of idsInJs) {
    const el = makeEl(id);
    if (/^p4ws-/.test(id)) el.tagName = 'TEXTAREA';
}

const timelineEl = makeEl('timeline-track');
for (const step of ['rest', 'ign', 'relay', 'sol', 'pinion', 'crank', 'run']) {
    const seg = makeEl('timeline-seg-' + step);
    seg.setAttribute('data-step', step);
    timelineEl.children.push(seg);
}
timelineEl.p2Children = timelineEl.children;

const mpGroup = makeEl('p3-mp-group');
const mpDots = MP_NAMES.map(n => {
    const d = makeEl('dot-' + n);
    d.dataset.mp = n;
    d.setAttribute('data-mp', n);
    d.setAttribute('cx', String(MP_COORDS[n][0]));
    d.setAttribute('cy', String(MP_COORDS[n][1]));
    return d;
});

const body = makeEl('body');

const selectors = {
    '.status-row': [0, 1, 2, 3, 4].map(i => makeEl('row-' + i)),
    '.positive-wire': ['pw1', 'pw2', 'pw3'].map(i => makeEl(i)),
    '.thick-wire': ['tw1', 'tw2'].map(i => makeEl(i)),
    '.ground-wire': ['gw1', 'gw2'].map(i => makeEl(i)),
    '.component': ['c1', 'c2'].map(i => makeEl(i)),
    '.fault-check': ['fc1', 'fc2'].map(i => makeEl(i)),
    '.ignition-position': [],
    '.fault-check:checked': [],
    '.p3-measure-points .mp-dot': mpDots,
};

let domReady = [];
const document = {
    body,
    getElementById(id) {
        return elementCache[id] || (elementCache[id] = makeEl(id));
    },
    querySelector(sel) {
        if (sel === '.timeline-track') return timelineEl;
        if (sel === '.p3-measure-points') return mpGroup;
        return null;
    },
    querySelectorAll(sel) { return selectors[sel] || []; },
    createElement() { return makeEl('created-' + (++elementSeq)); },
    addEventListener(type, fn) { if (type === 'DOMContentLoaded') domReady.push(fn); },
};
document._ready = () => domReady.forEach(fn => fn());

for (const id of Object.keys(elementCache)) {
    if (/^p4ws-/.test(id)) elementCache[id].tagName = 'TEXTAREA';
}

const localStorageMock = {
    _data: {},
    getItem(k) { return k in this._data ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
};

Math.random = () => 0.05; // deterministic (< engineStartChance)

const context = vm.createContext({
    document,
    localStorage: localStorageMock,
    console,
    Math,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    window: null,
});
context.window = context;

for (const f of files) vm.runInContext(sources[f], context, { filename: f });
if (document._ready) document._ready();

function getVal(expr) { return vm.runInContext(expr, context); }
function call(fname, ...args) {
    return vm.runInContext(`${fname}(${args.map(a => JSON.stringify(a)).join(',')})`, context);
}

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { passed++; console.log('  PASS: ' + msg); }
    else { failed++; console.log('  FAIL: ' + msg); }
}

const L = expr => getVal('Learning.' + expr);
const P3 = expr => getVal('Phase3.' + expr);
const P4 = expr => getVal('Phase4.' + expr);

function srcQ(qid) {
    return getVal('LEARNING_QUESTIONS.find(q => q.id === ' + JSON.stringify(qid) + ')') || null;
}

async function main() {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    function m(probe, node) {
        return vm.runInContext(`Phase3.attachProbe(${JSON.stringify(probe)}, ${JSON.stringify(node)})`, context);
    }
    async function crank() {
        call('setIgnition', 'OFF');
        await wait(40);
        call('setIgnition', 'ON');
        await wait(60);
        call('setIgnition', 'START');
        await wait(250);   // relay
        await wait(400);   // solenoid
        await wait(550);   // pinion
        await wait(550);   // starter CRANKING
    }

    console.log('=== PHASE 5 - LEARNING & ASSESSMENT LABORATORY TESTS ===');

    /* ---- 00. DATA + API INTEGRITY ---- */
    console.log('\n00: DATA + API INTEGRITY');
    assert(typeof L('active') === 'boolean' && L('active') === true, 'window.Learning active');
    assert(typeof getVal('window.Phase5') === 'object' && getVal('window.Phase5') === getVal('window.Learning'), 'Phase5 === Learning');
    assert(L('version') >= 1, 'APP_DATA_VERSION >= 1');

    const moduleIds = getVal('Learning.getModules().map(m=>m.id)');
    assert(moduleIds.length === 5, '5 learning modules (got ' + moduleIds.length + ')');

    // data integrity cross-check (content — referencing data files)
    const integ = getVal(`(function(){
        const errs = [];
        // lessons referenced by modules must exist
        const lessons = LEARNING_LESSONS;
        for (const m of LEARNING_MODULES) {
            for (const lid of m.lessons || []) {
                if (!lessons.find(l => l.id === lid)) errs.push('lesson ' + lid);
            }
            for (const p of m.practices || []) if (!['pract-basic','pract-circuit','pract-sequence','pract-drop','pract-diag'].includes(p)) errs.push('practice ' + p + ':' + m.id);
            for (const js of m.jobSheets || []) if (!LEARNING_JOB_SHEETS.find(j => j.id === js)) errs.push('jobSheet ' + js);
            for (const a of m.assessments || []) {
                const pool = LEARNING_QUESTIONS.filter(q => q.moduleId === m.id);
                if (!pool.length) errs.push('no-questions ' + a.id);
            }
        }
        for (const q of LEARNING_QUESTIONS) {
            if (!q.explanation) errs.push('no-expl ' + q.id);
            if (!q.difficulty) errs.push('no-diff ' + q.id);
            if (['MULTIPLE_CHOICE','TRUE_FALSE','MULTIPLE_RESPONSE','MATCHING','ORDERING','SCENARIO'].indexOf(q.type) < 0) errs.push('type ' + q.id);
        }
        return { ok: errs.length === 0, errs };
    })()`);
    assert(integ.ok === true, 'all module→lesson/practice/jobSheet/question refs resolve' + (integ.errs.length ? ' (' + integ.errs.join(',') + ')' : ''));

    const nLessons = getVal('LEARNING_LESSONS.length');
    assert(nLessons >= 21, 'at least 21 lessons (got ' + nLessons + ')');
    const everyLessonHasSections = getVal('LEARNING_LESSONS.every(l => Array.isArray(l.sections) && l.sections.length && l.id && l.moduleId)');
    assert(everyLessonHasSections, 'every lesson has sections + id + moduleId');
    const everyCompInfo = getVal('LEARNING_COMPONENT_INFO && typeof LEARNING_COMPONENT_INFO === "object"');
    assert(everyCompInfo, 'component info map present');

    const bank = getVal('LEARNING_QUESTIONS.length');
    assert(bank >= 25, 'question bank has >=25 questions (got ' + bank + ')');
    const jsCount = getVal('LEARNING_JOB_SHEETS.length');
    assert(jsCount === 11, '11 job sheets (got ' + jsCount + ')');
    const rubricSum = getVal('Object.values(LEARNING_CONFIG.practicalRubric).reduce((a,b)=>a+b,0)');
    assert(rubricSum === 100, 'practical rubric sums to 100 (got ' + rubricSum + ')');
    const achCount = getVal('LEARNING_CONFIG.achievements.length');
    assert(achCount === 7, '7 achievement defs (got ' + achCount + ')');
    const keysOk = getVal('LEARNING_CONFIG.storagePrefix === "p5" && LEARNING_CONFIG.progressKey === "p5Progress" && LEARNING_CONFIG.studentProfileKey === "p5Profile"');
    assert(keysOk, 'versioned storage keys configured');

    // all 5 module ids also match practices taught
    const practiceIds = getVal('Learning.practiceDefs().map(p=>p.id)');
    for (const want of ['pract-basic', 'pract-circuit', 'pract-sequence', 'pract-drop', 'pract-diag']) {
        if (practiceIds.indexOf(want) < 0) failed++; passed++;
        console.log((practiceIds.indexOf(want) >= 0 ? '  PASS' : '  FAIL') + ': practice def "' + want + '" exists');
    }

    /* ---- 01. OPEN MODULE (TEST 01) ---- */
    console.log('\n01: OPEN MODULE');
    const sm = call('Learning.startModule', 'starter-basic');
    assert(sm.ok === true && sm.module.id === 'starter-basic', 'startModule returns ok + module');
    const objs = L('getObjectives("starter-basic")');
    assert(Array.isArray(objs) && objs.length === 5, '5 objectives displayed');
    assert(objs.every(o => typeof o.text === 'string' && o.text.length > 0), 'every objective has text');
    assert(objs.every(o => o.status === 'NOT_STARTED'), 'objectives start NOT_STARTED');
    const mp0 = L('moduleProgress("starter-basic")');
    assert(mp0.started === true && typeof mp0.percent === 'number', 'moduleProgress reported');
    assert(getVal('document.getElementById("lrn-module").innerHTML.length > 0'), 'module view rendered (lrn-module)');
    const dashHtml = getVal('document.getElementById("lrn-dashboard").innerHTML.length > 0');
    assert(dashHtml, 'dashboard rendered');

    /* ---- 02. COMPLETE LESSON (TEST 02) ---- */
    console.log('\n02: COMPLETE LESSON');
    const sl = call('Learning.startLesson', 'l1-fungsi');
    assert(sl.ok === true && sl.lesson.id === 'l1-fungsi', 'startLesson l1-fungsi ok');
    const cl = call('Learning.completeLesson', 'l1-fungsi');
    assert(cl.ok === true, 'completeLesson ok');
    assert(cl.moduleProgress.lessonsDone === 1, 'lesson progress updated (lessonsDone=1)');
    assert(cl.moduleProgress.percent > 0, 'module percent updated');
    const objStatus = L('getObjectives("starter-basic")');
    const fungEligible = objStatus.filter(o => o.status === 'PRACTICED').length;
    assert(fungEligible === 2, 'l1-fungsi objectives (OBJ-01/02) marked PRACTICED (got ' + fungEligible + ')');
    const master = L('computeMastery("starter-basic")');
    assert(typeof master.percent === 'number' && master.percent > 0, 'mastery percent computed');

    /* ---- 03. GUIDED PRACTICE (TEST 03) ---- */
    console.log('\n03: GUIDED PRACTICE');
    const sp = call('Learning.startPractice', 'pract-basic');
    assert(sp.ok === true && sp.practice.id === 'pract-basic' && typeof sp.step === 'number', 'startPractice ok');
    assert(getVal('Learning.getPracticeSteps("pract-basic").length') === 5, 'practice has 5 steps');

    // Failure path: wrong mode must NOT pass
    call('Phase3.openLab');
    call('Phase3.setMode', 'OHM');
    const bad = call('Learning.checkPracticeStep', 'pract-basic', 1);
    assert(bad && bad.ok === false, 'wrong mode fails step validation');

    // Success path
    call('Phase3.setMode', 'V');
    let r;
    r = call('Learning.checkPracticeStep', 'pract-basic', 0);  assert(r && r.ok, 'step 0 (Phase3 API) passes');
    r = call('Learning.checkPracticeStep', 'pract-basic', 1);  assert(r && r.ok, 'step 1 (mode V) passes');
    m('red', 'batteryPositive');
    r = call('Learning.checkPracticeStep', 'pract-basic', 2);  assert(r && r.ok, 'step 2 (probe RED batteryPositive) passes');
    m('black', 'batteryNegative');
    r = call('Learning.checkPracticeStep', 'pract-basic', 3);  assert(r && r.ok, 'step 3 (probe BLACK batteryNegative) passes');
    const bat = P3('measure()');
    assert(bat && bat.value >= 12.4 && bat.value <= 12.8, 'battery rest reads ~12.6V for measured step');
    r = call('Learning.checkPracticeStep', 'pract-basic', 4);
    assert(r && r.ok && r.total === 5, 'step 4 (measured 12.4-12.8V) passes; practice fully validated');
    const allDone = L('checkAllSteps("pract-basic")');
    assert(allDone.done === true, 'checkAllSteps -> all practice steps passed');
    const cp = call('Learning.completePractice', 'pract-basic');
    assert(cp.ok === true && cp.completed === true && cp.score === 100, 'completePractice best=100');

    // Sequence practice (ordering)
    const seqStart = call('Learning.startPractice', 'pract-sequence');
    assert(seqStart.ok === true, 'startPractice pract-sequence ok');
    call('Learning.setPracticeSequence', 'pract-sequence', [0, 1, 2, 3, 4, 5]);
    for (let i = 0; i < 6; i++) {
        const s = call('Learning.checkPracticeStep', 'pract-sequence', i);
        assert(s && s.ok, 'sequence step ' + i + ' passes (order validation)');
    }
    const seqAll = L('checkAllSteps("pract-sequence")');
    assert(seqAll.done === true, 'sequence practice complete');

    /* ---- 04. COMPLETE JOB SHEET (TEST 04) ---- */
    console.log('\n04: COMPLETE JOB SHEET');
    const sj = call('Learning.startJobSheet', 'JS-001');
    assert(sj.ok === true && sj.jobSheet.id === 'JS-001', 'startJobSheet ok');
    call('Phase3.setMode', 'V');
    m('red', 'batteryPositive');
    m('black', 'batteryNegative');
    const jsM = P3('measure()');
    assert(jsM && jsM.value >= 12.0, 'job-sheet battery measurement recorded');
    const sv = call('Learning.saveJobSheet', 'JS-001', {
        observations: 'Tegangan battery normal saat diam.',
        answers: ['12,6 V', 'GOOD'],
        conclusion: 'Battery dalam kondisi baik (GOOD).',
    });
    assert(sv.ok === true && sv.result.measurements.length >= 1, 'measurements saved into job sheet');
    const cj = call('Learning.completeJobSheet', 'JS-001');
    assert(cj.ok === true, 'completeJobSheet ok');
    const jsR = L('getJobSheetResult("JS-001")');
    assert(jsR.measurements.length >= 1, 'result exposes saved measurements');
    assert(jsR.conclusion.indexOf('GOOD') >= 0, 'conclusion saved');
    assert(jsR.completed === true, 'job sheet marked completed');
    assert(jsR.instrument && jsR.instrument.mode === 'V' && jsR.instrument.normalRange, 'instrument normal range exposed');
    const vld = L('jobSheetValidation("JS-001")');
    assert(vld.ok === true && vld.conclusionOk === true && vld.measOk === true, 'job sheet validation passes');

    /* ---- 05. QUIZ ENGINE (TEST 05) ---- */
    console.log('\n05: QUIZ');
    const gen = call('Learning.generateAssessment', { moduleId: 'starter-basic', questionCount: 6 });
    assert(gen.questions.length === 6, '6 questions loaded for module starter-basic');
    assert(gen.questions.every(q => q.explanation && q.explanation.length > 0), 'every loaded question includes explanation');
    assert(typeof gen.totalPoints === 'number' && gen.totalPoints > 0, 'total points computed');

    const asm = call('Learning.startAssessment', { moduleId: 'starter-basic', questionCount: 3 });
    assert(asm.ok === true, 'startAssessment ok');
    let sess = L('activeSession()');
    assert(sess && sess.questions.length === 3 && sess.status === 'IN_PROGRESS', '3-question session started');
    const q0 = sess.questions[0];
    const q0src = srcQ(q0.qid);
    const ansC = call('Learning.answerQuestion', null, 0, q0src.correctAnswer);
    assert(ansC.ok === true && ansC.correct === true, 'correct answer recorded (q0)');
    assert(ansC.scored === q0.points, 'points awarded for correct answer');
    assert(ansC.explanation.length > 0, 'explanation returned for displayed feedback');
    sess = L('activeSession()');
    assert(sess.answers.length === 1, 'answer persisted in active session');
    const ansW = call('Learning.answerQuestion', null, 0, (q0src.correctAnswer === 0 ? 1 : 0));
    assert(ansW.ok === true && ansW.correct === false && ansW.scored === 0, 'wrong answer earns 0 points (re-answer)');
    const ansNull = call('Learning.answerQuestion', null, 0, null);
    assert(ansNull.correct === false && ansNull.scored === 0, 'unanswered question earns 0 points (null-guard)');

    const fin = call('Learning.finishAssessmentNow');
    assert(fin.ok === true, 'finishAssessmentNow ok');
    assert(typeof fin.score.percent === 'number' && fin.score.percent >= 0 && fin.score.percent <= 100, 'score percent calculated (' + fin.score.percent + '%)');
    assert(fin.result.percent === fin.score.percent && fin.result.id, 'result persisted with percent + id');
    const resList = L('getAssessmentResults()');
    assert(resList.length >= 1, 'assessment results stored');
    const lastRes = resList[resList.length - 1];
    assert(Array.isArray(lastRes.answers) && lastRes.answers.length === 3, 'all questions answered in stored result');
    assert(lastRes.feedback && Array.isArray(lastRes.recommendations), 'feedback + recommendations attached');
    const review = L('getReview(' + JSON.stringify(lastRes.id) + ')');
    assert(Array.isArray(review) && review.length === 3, 'review answers available');
    const avg = L('assessmentAverage()');
    assert(typeof avg === 'number', 'assessment average computed');

    // MULTIPLE_RESPONSE scoring
    const asmMR = call('Learning.startAssessment', { moduleId: 'starter-circuit', questionCount: 1, types: ['MULTIPLE_RESPONSE'] });
    assert(asmMR.session.questions[0].qid === 'Q012', 'MR question Q012 selected');
    const mrFull = call('Learning.answerQuestion', null, 0, [0, 1, 3]);
    assert(mrFull.correct === true && mrFull.scored === 10, 'MR [0,1,3] fully correct = 10 pts');
    const mrPart = call('Learning.answerQuestion', null, 0, [0]);
    assert(mrPart.correct === false && mrPart.scored === 3, 'MR [0] partial = 3 pts');

    // MATCHING
    const asmM = call('Learning.startAssessment', { moduleId: 'starter-circuit', questionCount: 1, types: ['MATCHING'] });
    assert(asmM.session.questions[0].qid === 'Q015', 'MATCHING question Q015 selected');
    const mFull = call('Learning.answerQuestion', null, 0, [0, 1, 2, 3, 4]);
    assert(mFull.correct === true && mFull.scored === 10, 'MATCHING all-correct = 10 pts');
    const mPart = call('Learning.answerQuestion', null, 0, [1, 0, 2, 3, 4]);
    assert(mPart.correct === false && mPart.scored === 6, 'MATCHING partial = 6 pts');

    // ORDERING
    const asmO = call('Learning.startAssessment', { moduleId: 'starter-principles', questionCount: 1, types: ['ORDERING'] });
    const oFull = call('Learning.answerQuestion', null, 0, [0, 1, 2, 3, 4, 5]);
    assert(oFull.correct === true && oFull.scored === 10, 'ORDERING all-correct = 10 pts');
    const oBad = call('Learning.answerQuestion', null, 0, [5, 4, 3, 2, 1, 0]);
    assert(oBad.correct === false && oBad.scored === 0, 'ORDERING reversed = 0 pts');

    // SCENARIO + explanation present
    const asmS = call('Learning.startAssessment', { moduleId: 'starter-measurement', questionCount: 1, types: ['SCENARIO'] });
    const qS = asmS.session.questions[0];
    const qSsrc = srcQ(qS.qid);
    const sR = call('Learning.answerQuestion', null, 0, qSsrc.correctAnswer);
    assert(sR.ok === true && typeof sR.correct === 'boolean' && sR.explanation.length > 0, 'SCENARIO answered with explanation');
    call('Learning.abortAssessment');

    /* ---- 06. PRACTICAL ASSESSMENT (TEST 06) ---- */
    console.log('\n06: PRACTICAL ASSESSMENT (Phase 4 integration)');
    const pa = call('Learning.startPracticalAssessment', 'CASE_001');
    assert(pa.ok === true && pa.caseId === 'CASE_001', 'startPracticalAssessment starts Phase 4 case');
    assert(P4('getDiagnosticState().active === true'), 'diagnostic engine active');
    assert(getVal('Sim.batteryCondition') === 'WEAK', 'hidden weak-battery fault physically applied');

    call('Phase4.observeSystem', 'INSPECTION_AWAL');
    call('Phase3.openLab');
    call('Phase3.setMode', 'V');
    m('red', 'batteryPositive');
    m('black', 'batteryNegative');
    const vRest = P3('measure()');
    assert(vRest && vRest.value >= 11.9 && vRest.value <= 12.1, 'weak battery rest ~12.0V (got ' + (vRest && vRest.value) + ')');
    const evW = P4('evaluateHypothesisByKey("battery","WEAK")');
    assert(evW.verdict === 'SUPPORTED' && evW.matched >= 1, 'battery:WEAK SUPPORTED from rest reading');

    await crank();
    assert(getVal('Sim.starterState') === 'CRANKING', 'weak battery cranking (slow)');
    const vBatC = P3('measure()');
    assert(vBatC && vBatC.value < 11.6, 'battery sag during cranking (<11.6V)');
    call('Phase3.setMode', 'A');
    const aC = P3('measure()');
    assert(aC && aC.value > 90 && aC.value < 200, 'cranking current measured (' + (aC && aC.value) + 'A)');

    const hyp = call('Phase4.createHypothesis', { component: 'battery', faultType: 'WEAK', reason: 'rest 12.0V, sag, low current' });
    assert(hyp.ok === true && hyp.hypothesis.correct === true, 'hypothesis battery:WEAK created');
    const sub = call('Phase4.submitDiagnosis', { component: 'battery', faultType: 'WEAK' });
    assert(sub.status === 'CORRECT', 'diagnosis CORRECT (got ' + sub.status + ')');
    const wrongRep = call('Phase4.applyRepair', 'REPLACE_FUSE');
    assert(wrongRep.ok === true && wrongRep.correct === false, 'WRONG repair blocked by engine');
    call('Phase4.verifyRepair');
    const rep = call('Phase4.applyRepair', 'REPLACE_BATTERY');
    assert(rep.ok === true && rep.correct === true, 'REPLACE_BATTERY correct');
    await crank();
    const vf2 = P4('verifyRepair()');
    assert(vf2.ok === true && vf2.reason === 'VERIFIED', 'post-repair verification VERIFIED');
    call('setIgnition', 'ON');
    await wait(60);
    call('Phase3.setMode', 'V');
    const vOk2 = P3('measure()');
    assert(vOk2 && vOk2.value >= 12.3, 'post-repair battery ~12.6V');

    const rubric = L('computePracticalRubric()');
    assert(Array.isArray(rubric.parts) && rubric.parts.length === 8, 'practical rubric has 8 criteria');
    assert(rubric.total >= 0 && rubric.total <= 100, 'rubric total within 0-100 (got ' + rubric.total + ')');
    assert(rubric.verified === true && rubric.complete === true, 'rubric reflects verified completion');
    assert(rubric.parts.every(p => p.label && p.max > 0 && p.value >= 0 && p.value <= p.max), 'rubric parts well-formed');

    const cpa = call('Learning.completePracticalAssessment');
    assert(cpa.ok === true, 'completePracticalAssessment ok');
    assert(cpa.entry.caseId === 'CASE_001' && cpa.entry.verified === true, 'practical entry saved for CASE_001 (verified)');
    assert(cpa.entry.knowledgeScore !== undefined && cpa.entry.practicalScore !== undefined && cpa.entry.diagnosticScore !== undefined, 'skill scores separated');
    assert(L('getDiagnosticHistory().length') >= 1, 'diagnostic history updated');
    assert(L('diagnosticsDoneCount()') >= 1, 'diagnostics counted in progress state');

    /* ---- 07. OVERALL PROGRESS (TEST 07) ---- */
    console.log('\n07: PROGRESS');
    const ov = L('computeOverallProgress()');
    assert(typeof ov.percent === 'number' && ov.percent > 0, 'overall progress percent auto-updated (' + ov.percent + '%)');
    assert(ov.lessons.done >= 1, 'lessons counted in progress (' + ov.lessons.done + ')');
    assert(ov.jobSheets.done >= 1, 'job sheets counted (' + ov.jobSheets.done + ')');
    assert(ov.diagnostics.done >= 1, 'diagnostics counted (' + ov.diagnostics.done + ')');
    assert(typeof ov.assessments.avg === 'number', 'assessment average present');
    assert(ov.completion && typeof ov.completion.percent === 'number', 'completion summary exposed');
    const cert = L('generateCertificate()');
    assert(cert.studentName === 'Siswa' && cert.courseName === 'Starter System Virtual Laboratory', 'certificate (completion-based, labelled)');
    const report = L('generateReport()');
    assert(typeof report.overallProgress.percent === 'number', 'student report contains overall progress');
    assert(Array.isArray(report.modules) && Array.isArray(report.lessons), 'report sections present');

    /* ---- 08. ACHIEVEMENTS (TEST 08) ---- */
    console.log('\n08: ACHIEVEMENTS');
    L('checkAchievements()');
    const ach = L('getAchievements()');
    assert(Array.isArray(ach) && ach.length === 7, '7 achievements exposed (got ' + ach.length + ')');
    const map = {};
    ach.forEach(a => { map[a.id] = !!a.unlocked; });
    assert(map.FIRST_LESSON === true, 'FIRST_LESSON unlocks after lesson');
    assert(map.FIRST_QUIZ === true, 'FIRST_QUIZ unlocks after quiz');
    assert(map.FIRST_MEASUREMENT === true, 'FIRST_MEASUREMENT unlocks after measurement');
    assert(map.ELECTRICAL_ANALYST === true, 'ELECTRICAL_ANALYST unlocks at 5+ measurements');
    assert(map.TROUBLESHOOTER === true, 'TROUBLESHOOTER unlocks after verified diagnosis');
    assert(ach.every(a => a.title && a.description), 'every achievement has title + description');

    /* ---- 09. EXPORT (TEST 09) ---- */
    console.log('\n09: EXPORT');
    const exp = L('exportData()');
    assert(exp.version === 1, 'export carries APP_DATA_VERSION');
    assert(typeof exp.progress === 'object' && exp.progress.record, 'export contains progress + record trail');
    assert(Array.isArray(exp.assessments), 'export contains assessments');
    assert(typeof exp.jobSheets === 'object', 'export contains job sheet results');
    assert(Array.isArray(exp.diagnostics), 'export contains diagnostics history');
    assert(typeof exp.achievements === 'object', 'export contains achievements');
    assert(typeof exp.settings === 'object' && typeof exp.student === 'object', 'export contains settings + student');
    assert(typeof exp.exportedAt === 'number', 'export timestamped');
    const json = JSON.stringify(exp);
    assert(json.length > 0 && JSON.parse(json).version === 1, 'valid JSON round-trips without error');

    /* ---- 10. IMPORT + RESET (TEST 10) ---- */
    console.log('\n10: IMPORT + RESET');
    const beforeResetPct = L('computeOverallProgress().percent');
    const beforeResCount = L('getAssessmentResults().length');
    const beforeDiagCount = L('getDiagnosticHistory().length');
    call('Learning.confirmReset');
    assert(L('computeOverallProgress().percent') === 0 || L('computeOverallProgress().percent') < beforeResetPct, 'reset clears local progress');
    const imp = call('Learning.importData', json);
    assert(imp.ok === true, 'valid import accepted');
    assert(L('computeOverallProgress().percent') === beforeResetPct, 'progress restored to exported value (' + beforeResetPct + '%)');
    const resCount2 = L('getAssessmentResults().length');
    assert(resCount2 === beforeResCount, 'assessments restored (' + resCount2 + ' vs ' + beforeResCount + ')');
    const diag2 = L('getDiagnosticHistory().length');
    assert(diag2 === beforeDiagCount, 'diagnostics restored (' + diag2 + ' vs ' + beforeDiagCount + ')');
    const badIm = call('Learning.importData', '{invalid-json');
    assert(badIm.ok === false, 'malformed JSON rejected');
    const nover = call('Learning.importData', JSON.stringify({ foo: 1 }));
    assert(nover.ok === false && nover.error === 'NO_VERSION', 'missing version rejected');
    const noreq = call('Learning.importData', null);
    assert(noreq.ok === false || noreq.error, 'null import rejected safely');

    // guard: missing lesson / practice / job sheet / invalid assessment handled gracefully
    assert(L('getLesson("l-missing")') === null, 'missing lesson -> null (no crash)');
    assert(L('getPractice("pract-missing")') === null, 'missing practice -> null (no crash)');
    assert(call('Learning.startPractice', 'pract-missing').ok === false, 'startPractice on missing -> ok:false');
    assert(call('Learning.startJobSheet', 'JS-999').ok === false, 'startJobSheet on missing -> ok:false');
    assert(L('getJobSheet("JS-999")') === null, 'missing job sheet -> null (no crash)');
    assert(L('startAssessment({moduleId:"starter-basic", questionCount:0})').ok === true, 'assessment with degenerate options still starts safely');

    /* ---- identitas siswa mengikuti akun yang sedang masuk (AuthUI.identity) ---- */
    L('saveProfile({name:"Ketikan Bebas", klass:"X", studentId:"1"})');
    assert(L('getProfile().name') === 'Ketikan Bebas', 'tanpa akun: profil manual tetap berfungsi');
    vm.runInContext('window.AuthUI = { identity: () => ({ username: "siswa", name: "Andi Pratama", kelas: "XII TKR 1", sekolah: "SMK", nis: "202423001", locked: { name: true, kelas: true, sekolah: true, studentId: true } }) }', context);
    assert(L('getProfile().name') === 'Ketikan Bebas', 'getProfile murni (tidak mengubah apa pun)');
    call('Learning.saveProfile', { name: 'Dipalsukan', klass: 'XII ABC', studentId: '999' });
    assert(L('getProfile().name') === 'Andi Pratama', 'akun masuk: nama profil dipaksa = nama akun');
    assert(L('getProfile().klass') === 'XII TKR 1' && L('getProfile().studentId') === '202423001', 'akun masuk: kelas & NIS dipaksa = data akun');
    assert(L('generateCertificate().studentName') === 'Andi Pratama', 'sertifikat memakai nama akun');
    const progHtml = getVal('document.getElementById("p5-progress").innerHTML');
    assert(/id="pf-name" readonly[^>]*value="Andi Pratama"/.test(progHtml), 'form Student Profile: nama readonly = nama akun');
    assert(/id="pf-sid" readonly[^>]*value="202423001"/.test(progHtml), 'form Student Profile: Student ID readonly = NIS akun');
    vm.runInContext('window.AuthUI = null', context);

    console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('TEST CRASH: ' + (e.stack || e.message)); process.exit(1); });