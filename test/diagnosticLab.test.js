/* Standalone test harness for Phase 4 (Advanced Diagnostic & Troubleshooting Lab).

   Loads app.js THEN realtimeParameter.js THEN multimeter.js THEN diagcases.js THEN diagnosticLab.js
   in a Node vm sandbox with a rich DOM mock (canvas 2D, timeline, multimeter
   lab elements, Phase 4 lab elements), then runs Phase 4 acceptance tests 01-08
   plus data/API integrity checks.

   Run: node test/diagnosticLab.test.js
*/

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const phase2Js = fs.readFileSync(path.join(ROOT, 'realtimeParameter.js'), 'utf8');
const phase3Js = fs.readFileSync(path.join(ROOT, 'multimeter.js'), 'utf8');
const diagJs = fs.readFileSync(path.join(ROOT, 'diagcases.js'), 'utf8');
const phase4Js = fs.readFileSync(path.join(ROOT, 'diagnosticLab.js'), 'utf8');

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

/* ---------------- Canvas 2D context stub ---------------- */
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

/* ---------------- Minimal DOM mock ---------------- */
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

// Pre-create all $('id') element references used in all five files.
// Phase 4 worksheet fields are TEXTAREA so the engine writes into .value.
// (diagnosticLab.js uses $('p4ws-' + id) dynamically, so add them explicitly.)
const WS_IDS = ['complaint', 'symptom', 'inspection', 'hypothesis', 'measurement', 'evidence', 'conclusion', 'repair', 'verification'];
const idsInJs = [appJs, phase2Js, phase3Js, diagJs, phase4Js]
    .flatMap(src => [...src.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]))
    .concat(WS_IDS.map(w => 'p4ws-' + w));
for (const id of idsInJs) {
    const el = makeEl(id);
    if (/^p4ws-/.test(id)) el.tagName = 'TEXTAREA';
}

// Timeline track element
const timelineEl = makeEl('timeline-track');
for (const step of ['rest', 'ign', 'relay', 'sol', 'pinion', 'crank', 'run']) {
    const seg = makeEl('timeline-seg-' + step);
    seg.setAttribute('data-step', step);
    timelineEl.children.push(seg);
}
timelineEl.p2Children = timelineEl.children;

// Measurement point group + dots
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

const localStorageMock = {
    _data: {},
    getItem(k) { return k in this._data ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
};

// Make worksheet fields behave like real textareas for .value writes
for (const id of Object.keys(elementCache)) {
    if (/^p4ws-/.test(id)) elementCache[id].tagName = 'TEXTAREA';
}

/* ---------------- Deterministic random ---------------- */
Math.random = () => 0.05; // always < engineStartChance -> engine starts

/* ---------------- Boot all five in vm ---------------- */
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

// app.js declares `const Sim / FAULTS / EventBus / CONFIG / SystemState`
// as global lexical bindings; expose the same objects on window too so the
// Phase 4 engine (which reads Sim, FAULTS, EventBus) behaves like browser.
vm.runInContext(appJs, context, { filename: 'app.js' });
vm.runInContext(phase2Js, context, { filename: 'realtimeParameter.js' });
vm.runInContext(phase3Js, context, { filename: 'multimeter.js' });
vm.runInContext(diagJs, context, { filename: 'diagcases.js' });
vm.runInContext(phase4Js, context, { filename: 'diagnosticLab.js' });

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

const P4 = expr => getVal('Phase4.' + expr);
const P3 = expr => getVal('Phase3.' + expr);

async function main() {
    const wait = ms => new Promise(r => setTimeout(r, ms));

    function m(probe, node) {
        return vm.runInContext(`Phase3.attachProbe(${JSON.stringify(probe)}, ${JSON.stringify(node)})`, context);
    }

    // START sequence from current State (fault stays injected — do NOT reset).
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

    console.log('=== PHASE 4 - ADVANCED DIAGNOSTIC LAB TESTS ===');

    /* ---- 01. CASE DATA & API ---- */
    console.log('\n01: CASE DATA + PHASE4 API');
    call('Phase3.openLab');
    const nCases = getVal('DIAGNOSTIC_CASES.length');
    assert(nCases === 13, '13 diagnostic cases defined (got ' + nCases + ')');
    assert(typeof P4('startDiagnosticCase') === 'function', 'Phase4.startDiagnosticCase exposed');
    assert(typeof P4('evaluateHypothesisByKey') === 'function', 'Phase4.evaluateHypothesisByKey exposed');
    assert(getVal('DIAGNOSTIC_CASE_INDEX.CASE_001.id') === 'CASE_001', 'CASE_INDEX maps CASE_001');
    const idxOk = getVal('Object.keys(DIAGNOSTIC_CASE_INDEX).length') === 13;
    assert(idxOk, 'CASE_INDEX has 13 entries');
    assert(getVal('typeof DIAGNOSTIC_CASE_INDEX === "object"'), 'DIAGNOSTIC_CASE_INDEX is an object');
    const sKey = getVal('DIAGNOSTIC_CONFIG.storageKey');
    assert(sKey === 'phase4DiagnosticSessions', 'session storage key set (' + sKey + ')');
    assert(getVal('DIAGNOSTIC_CONFIG.debugMode') === false, 'debugMode OFF by default (hidden fault stays hidden)');

    /* ---- 02. START CASE -> hidden fault injected, no leak ---- */
    console.log('\n02: START CASE (CASE_001 weak battery) + NOLEAK');
    const startRes = call('Phase4.startDiagnosticCase', 'CASE_001');
    assert(startRes.ok === true && startRes.caseObj.id === 'CASE_001', 'startDiagnosticCase returns ok + caseObj');
    assert(P4('getCurrentCase().id') === 'CASE_001', 'getCurrentCase returns CASE_001');
    assert(getVal('Sim.batteryCondition') === 'WEAK', 'Hidden weak-battery fault physically applied');
    assert(Math.abs(getVal('Sim.batteryVoltage') - 12.0) < 0.01, 'battery voltage 12.0 (weak)');
    assert(getVal('Sim.activeFaults.length') === 0, 'NO LEAK — fault not added to Sim.activeFaults');
    assert(P4('getHiddenFault()') === null, 'getHiddenFault() null in normal mode (no leak)');
    const sym = P4('getSymptoms()');
    assert(Array.isArray(sym) && sym.length === 1 && typeof sym[0].description === 'string', 'getSymptoms returns complaint/symptom');
    const st0 = P4('getDiagnosticState()');
    assert(st0.active === true && st0.status === 'IN_PROGRESS' && st0.caseId === 'CASE_001', 'diagnostic state IN_PROGRESS');

    /* ---- 03. MEASURE + EVIDENCE ---- */
    console.log('\n03: MEASUREMENT + EVIDENCE ENGINE');
    call('Phase3.setMode', 'V');
    m('red', 'batteryPositive');
    m('black', 'batteryNegative');
    const vRest = P3('measure()');
    assert(!!vRest && vRest.value >= 11.9 && vRest.value <= 12.1, 'battery rest reads ~12.0V weak (got ' + (vRest && vRest.value) + ')');
    assert(P4('getMeasurementHistory().length') >= 1, 'measurement recorded into Phase4 history');
    const evW = P4('evaluateHypothesisByKey("battery","WEAK")');
    assert(evW.verdict === 'SUPPORTED' && evW.matched >= 1, 'battery:WEAK SUPPORTED from rest reading (verdict=' + evW.verdict + ')');
    assert(evW.confidence === 'MEDIUM' && evW.matched === 1, 'confidence MEDIUM at 1 matched signature');
    const evG = P4('evaluateHypothesisByKey("ground","HIGH_RESISTANCE")');
    assert(evG.verdict === 'NOT_SUPPORTED', 'ground hypothesis NOT_SUPPORTED via contradiction (verdict=' + evG.verdict + ')');
    const evD = P4('evaluateHypothesisByKey("battery","DISCHARGED")');
    assert(evD.verdict === 'NOT_SUPPORTED', 'discharged hypothesis NOT_SUPPORTED (12.0 measured, expects 11.0)');
    const evSM = P4('evaluateHypothesisByKey("starterMotor","OPEN_WINDING")');
    assert(evSM.verdict === 'INSUFFICIENT', '"during" filter prevents false contradiction; starterMotor INSUFFICIENT at rest');
    const evX = P4('evaluateHypothesisByKey("battery","PHANTOM")');
    assert(evX.verdict === 'INVALID', 'unknown fault type -> INVALID');

    /* ---- 04. FULL DIAGNOSTIC FLOW (weak battery) ---- */
    console.log('\n04: CRANK + FULL DIAGNOSIS -> REPAIR -> VERIFY');
    await crank();
    assert(getVal('Sim.starterState') === 'CRANKING', 'weak battery still cranks (slowly) for measurement session');
    const vBatC = P3('measure()');
    assert(!!vBatC && vBatC.value < 11.6, 'battery sag during cranking (<11.6V, got ' + (vBatC && vBatC.value) + ')');
    m('red', 'starterPositive');
    const vStC = P3('measure()');
    assert(!!vStC && vStC.value < 11.5, 'starter M sag during cranking (<11.5V, got ' + (vStC && vStC.value) + ')');
    call('Phase3.setMode', 'A');
    m('red', 'batteryPositive');
    m('black', 'batteryNegative');
    const aC = P3('measure()');
    assert(!!aC && aC.value > 90 && aC.value < 200, 'cranking current measured (' + (aC && aC.value) + 'A)');

    const evW4 = P4('evaluateHypothesisByKey("battery","WEAK")');
    assert(evW4.verdict === 'SUPPORTED' && evW4.matched >= 3, 'weak battery now fully supported (' + evW4.matched + '/' + evW4.total + ')');
    assert(evW4.confidence === 'HIGH', 'confidence HIGH with full evidence');

    const hyp = call('Phase4.createHypothesis', { component: 'battery', faultType: 'WEAK', reason: 'rest 12.0V, crank sag, low current' });
    assert(hyp.ok === true && hyp.hypothesis.correct === true, 'createHypothesis battery:WEAK marks correct hypothesis');
    assert(hyp.evaluation.verdict === 'SUPPORTED', 'created hypothesis evaluated SUPPORTED');

    const submit = call('Phase4.submitDiagnosis', { component: 'battery', faultType: 'WEAK' });
    assert(submit.status === 'CORRECT', 'submitDiagnosis battery:WEAK -> CORRECT (got ' + submit.status + ')');
    assert(P4('getDiagnosticState().diagnosisCorrect') === true, 'diagnosisCorrect flag set');

    const wrongRep = call('Phase4.applyRepair', 'REPLACE_FUSE');
    assert(wrongRep.ok === true && wrongRep.correct === false, 'applyRepair REPLACE_FUSE -> wrong repair flagged');
    assert(getVal('Sim.batteryCondition') === 'WEAK', 'fault still active after wrong repair');
    const vfWrong = call('Phase4.verifyRepair');
    assert(vfWrong.ok === false && vfWrong.reason === 'REPAIR_WRONG', 'verifyRepair rejected for wrong repair');

    const rep = call('Phase4.applyRepair', 'REPLACE_BATTERY');
    assert(rep.ok === true && rep.correct === true, 'applyRepair REPLACE_BATTERY -> correct');
    assert(getVal('Sim.batteryCondition') === 'GOOD', 'fault cleared after correct repair');

    await crank();
    assert(getVal('Sim.starterState') === 'CRANKING', 'post-repair cranking reached');

    const vf = call('Phase4.verifyRepair');
    assert(vf.ok === true && vf.reason === 'VERIFIED', 'verifyRepair -> VERIFIED');

    call('setIgnition', 'ON');
    await wait(60);
    call('Phase3.setMode', 'V');
    m('red', 'batteryPositive');
    m('black', 'batteryNegative');
    const vOk = P3('measure()');
    assert(!!vOk && vOk.value >= 12.3, 'post-repair battery near 12.6V at rest (got ' + (vOk && vOk.value) + ')');
    assert(P4('getDiagnosticState().verificationPassed') === true, 'verificationPassed flag set');
    assert(P4('getDiagnosticState().complete') === true, 'case marked complete');
    assert(P4('getDiagnosticState().confidence') === 'CONFIRMED', 'confidence CONFIRMED after verified repair');

    const score = P4('getDiagnosticScore()');
    assert(score.total >= 50 && score.total <= 100, 'final score in range (got ' + score.total + ')');
    const report = P4('generateDiagnosticReport()');
    assert(report.caseId === 'CASE_001' && report.status === 'VERIFIED' && report.score === score.total, 'report reflects VERIFIED status');
    assert(typeof report.measurements === 'object' && report.measurements.length > 0, 'report contains measurements');

    // Worksheet + report view (smoke the UI-facing flows)
    call('Phase4.fillWorkbook');
    assert(getVal('document.getElementById("p4ws-complaint").value.indexOf("Saat kunci diputar ke START") >= 0'), 'workbook complaint filled');
    call('Phase4.renderReport');
    assert(getVal('document.getElementById("p4-report").innerHTML.length > 0'), 'renderReport writes HTML');

    /* ---- 05. SESSION PERSISTED + RESET ---- */
    console.log('\n05: SESSION HISTORY + RESET DIAGNOSTIC CASE');
    const saved = P4('getSavedSessions()');
    assert(Array.isArray(saved) && saved.length >= 1, 'at least one session saved (' + saved.length + ')');
    const latest = saved[0];
    assert(latest.caseId === 'CASE_001' && latest.status === 'VERIFIED', 'latest saved session VERIFIED for CASE_001');
    assert(typeof latest.score === 'number' && latest.score > 0, 'saved session has score');
    const getState2 = P4('getDiagnosticState()');
    assert(getState2.complete === true, 'state still complete before reset');
    const rst = call('Phase4.resetDiagnosticCase');
    assert(rst.ok === true && P4('getDiagnosticState().active') === false, 'resetDiagnosticCase clears active case (no crash)');
    assert(getVal('Sim.activeFaults.length') === 0, 'reset leaves no faults');

    /* ---- 06. RANDOM CASE (deterministic pick) ---- */
    console.log('\n06: START RANDOM CASE');
    call('Phase4.startRandomCase');
    assert(P4('getCurrentCase().id') === 'CASE_001', 'startRandomCase picks deterministic CASE_001 (Math.random=0.05)');

    /* ---- 07. BONUS: RELAY CONTACT-OPEN (CASE_013) ---- */
    console.log('\n07: CASE_013 RELAY CONTACT OPEN');
    call('Phase3.resetMultimeter');
    call('Phase4.startDiagnosticCase', 'CASE_013');
    assert(getVal('Sim.relayFaultType') === 'contactOpen', 'relay contact-open param applied');
    assert(getVal('Sim.relayFail') === false, 'relay coil intact (relayFail false)');
    assert(getVal('Sim.activeFaults.length') === 0, 'contact-open not leaked to activeFaults');

    await crank();
    assert(getVal('Sim.relayState') === 'ACTIVE', 'relay clicks (coil works)');
    assert(getVal('Sim.solenoidState') === 'OFF', 'solenoid stays OFF (contact blocked)');
    assert(getVal('Sim.starterState') === 'OFF', 'starter stays OFF');
    call('Phase3.setMode', 'V');
    m('red', 'relayInput');
    m('black', 'batteryNegative');
    const rIn = P3('measure()');
    assert(!!rIn && rIn.value >= 11.8, 'relay input voltage near 12.6V (got ' + (rIn && rIn.value) + ')');
    m('red', 'relayOutput');
    const rOut = P3('measure()');
    assert(!!rOut && rOut.value >= -0.05 && rOut.value <= 0.05, 'relay output ~0V with contact open (got ' + (rOut && rOut.value) + ')');

    call('setIgnition', 'OFF');
    await wait(60);
    call('Phase3.setMode', 'OHM');
    m('red', 'relayInput');
    m('black', 'relayGround');
    const coilOhm = P3('measure()');
    assert(!!coilOhm && coilOhm.value >= 2.8 && coilOhm.value <= 3.6, 'relay coil ~3.2Ω (got ' + (coilOhm && coilOhm.value) + ')');
    m('red', 'relayInput');
    m('black', 'relayOutput');
    const contOhm = P3('measure()');
    assert(!!contOhm && typeof contOhm.value === 'number', 'relay contact measurable via parallel ground path (got ' + (contOhm && contOhm.value) + 'Ω)');

    const evC = P4('evaluateHypothesisByKey("relay","CONTACT_OPEN")');
    assert(evC.verdict === 'SUPPORTED' && evC.matched >= 3, 'relay CONTACT_OPEN SUPPORTED from evidence (' + evC.matched + '/' + evC.total + ')');
    const evCoil = P4('evaluateHypothesisByKey("relay","OPEN_COIL")');
    assert(evCoil.verdict === 'NOT_SUPPORTED', 'relay OPEN_COIL contradicted by 3.2Ω coil reading');
    call('Phase4.createHypothesis', { component: 'relay', faultType: 'CONTACT_OPEN', reason: 'coil ok, output 0V' });
    const subC = call('Phase4.submitDiagnosis', { component: 'relay', faultType: 'CONTACT_OPEN' });
    assert(subC.status === 'CORRECT', 'relay CONTACT_OPEN diagnosis CORRECT');
    const repC = call('Phase4.applyRepair', 'REPLACE_RELAY');
    assert(repC.ok === true && repC.correct === true, 'REPLACE_RELAY correct for CASE_013');
    assert(getVal('Sim.relayFaultType') === 'none', 'relay fault cleared after repair');
    await crank();
    assert(getVal('Sim.starterState') === 'CRANKING', 'starter cranks after relay replacement');
    const vfC = call('Phase4.verifyRepair');
    assert(vfC.ok === true && vfC.reason === 'VERIFIED', 'CASE_013 verified');

    /* ---- 08. DATA INTEGRITY + FINAL RESET ---- */
    console.log('\n08: DATA INTEGRITY + CLEAN RESET');
    call('Phase4.resetDiagnosticCase');
    assert(getVal('document.getElementById("p4-debugBody").innerHTML') === '', 'debug panel empty in normal mode');
    const integ = getVal(`(function(){
        let ok = true, err = '';
        for (const c of DIAGNOSTIC_CASES) {
            if (!c.id || !c.title || !c.difficulty || !c.expectedDiagnosis) { ok = false; err += c.id + ':core '; }
            if (!(c.hiddenFault && DIAGNOSTIC_KNOWLEDGE[c.hiddenFault.component] && DIAGNOSTIC_KNOWLEDGE[c.hiddenFault.component][c.hiddenFault.faultType])) { ok = false; err += c.id + ':kb '; }
            if (!REPAIR_ACTIONS.some(r => r.id === c.repairableBy)) { ok = false; err += c.id + ':rep '; }
            if (!Array.isArray(c.guided) || !c.guided.length) { ok = false; err += c.id + ':guided '; }
            if (c.expectedDiagnosis.component !== c.hiddenFault.component || c.expectedDiagnosis.faultType !== c.hiddenFault.faultType) { ok = false; err += c.id + ':diag '; }
        }
        return { ok, err };
    })()`);
    assert(integ.ok === true, 'all 13 cases internally consistent' + (integ.err ? ' (' + integ.err + ')' : ''));
    const repInt = getVal('REPAIR_ACTIONS.length');
    assert(repInt === 11 && getVal('REPAIR_ACTIONS.every(function(r){return r.label && Array.isArray(r.procedures) && r.procedures.length;})') === true, '11 repairs with label + procedures');
    const treeOk = getVal('DIAGNOSTIC_TREE && DIAGNOSTIC_TREE.root === "Q1" && Object.keys(DIAGNOSTIC_TREE.nodes).length >= 12');
    assert(treeOk === true, 'decision tree data present');
    assert(P4('getActivityLog().length') >= 0, 'activity log readable');

    call('Phase4.setDebug', true);
    call('Phase4.startDiagnosticCase', 'CASE_002');
    const hf = P4('getHiddenFault()');
    assert(!!hf && hf.component === 'battery' && hf.faultType === 'DISCHARGED', 'debug mode exposes hidden fault for internal use');
    call('Phase4.setDebug', false);
    assert(P4('getHiddenFault()') === null, 'debug off -> hidden fault hidden again');
    call('Phase4.resetDiagnosticCase');
    assert(P4('getMode()') === 'GUIDED', 'default mode GUIDED');

    console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('TEST CRASH: ' + (e.stack || e.message)); process.exit(1); });