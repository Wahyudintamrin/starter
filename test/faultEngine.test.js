/* Standalone test harness for Phase 7 STEP 2-12 (Advanced Fault Engine Core
   + Interaction Engine + Symptom Engine v2).

   Loads app.js THEN faultEngine.js in a Node vm sandbox with a minimal DOM mock,
   then verifies:
   - Multi-fault support (severe 2 multi-fault simultaneous)
   - Severity scaling bounded [0..1], continuity, clearScenario restores defaults
   - Battery exclusivity priority (DISCHARGED wins over WEAK)
   - Intermittent: TIME_BASED / START_ATTEMPT_BASED / RANDOM_SEEDED
   - Progressive: per 'attempt' & per 'timeMs'
   - Seeded PRNG reproducibility (deterministic)
   - NO Math.random for simulation values (deterministic model)
   - No leak into Sim.activeFaults (hidden fault protection)
   - Effects ONLY via existing Sim.* fields (single engine, no duplicate)
   - Fault interaction (STEP 6): coupled faults -> secondary symptoms +
     interaction severity + derived Sim effects; primary effects preserved.
   - Symptom engine v2 (STEP 7): symptoms derived LIVE from Sim.* conditions
     (deterministic), symptom matrix API (§16/§17).

   Run: node test/faultEngine.test.js
*/

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const diag7Js = fs.readFileSync(path.join(ROOT, 'faultEngine.js'), 'utf8');

/* ---------------- Minimal DOM mock (app.js only wires DOMContentLoaded) ---------------- */
const elementCache = {};
let elementSeq = 0;
function makeEl(id) {
    return {
        id: id || null,
        tagName: 'DIV',
        style: {},
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
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {},
        appendChild() {},
        addEventListener() {},
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

/* ---------------- Deterministic random (engine start etc.) ---------------- */
Math.random = () => 0.05;

/* ---------------- Boot app.js + faultEngine.js in vm ---------------- */
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

vm.runInContext(appJs, context, { filename: 'app.js' });
vm.runInContext(diag7Js, context, { filename: 'faultEngine.js' });
// NOTE: init() (DOM wiring) di-skip — uji ini hanya menggerakkan Sim.* + fungsi engine.

function getVal(expr) { return vm.runInContext(expr, context); }
const P7 = expr => getVal('Phase7.' + expr);
const call = (name, ...args) =>
    vm.runInContext(`Phase7.${name}(${args.map(a => JSON.stringify(a)).join(',')})`, context);

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { passed++; console.log('  PASS: ' + msg); }
    else { failed++; console.log('  FAIL: ' + msg); }
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 0.0001);

/* Sequence helper: simulate an ignition START attempt */
function startAttempt() {
    getVal("Sim.ignitionState='OFF'");
    P7('tick(30)');
    getVal("Sim.ignitionState='START'");
    P7('tick(30)');
}

(async function main() {
    console.log('=== PHASE 7 - ADVANCED FAULT ENGINE CORE (STEP 2-12) TESTS ===');

    /* ---- 01. MODULE + API ---- */
    console.log('\n01: MODULE & API SURFACE');
    assert(P7('active') === true, 'Phase7.active');
    assert(P7('version') === 7, 'Phase7.version = 7');
    assert(P7('step') === '2-12', 'Phase7.step = "2-12"');
    for (const m of ['installScenario', 'clearScenario', 'getScenarioState', 'addFault', 'removeFault',
        'enableFault', 'disableFault', 'setFaultSeverity', 'setIntermittentMode', 'setProgression',
        'getFaultState', 'getAllFaultStates', 'getActiveSymptoms', 'tick', 'startAuto', 'stopAuto',
        'setSeed', 'setConfig', 'listFaultLibrary',
        'generateHypotheses', 'createHypothesis', 'evaluateHypothesis', 'recordEvidence',
        'getHypotheses', 'getHypothesis', 'getRankedHypotheses', 'resetHypotheses', 'getDiagnosticPath',
        'evaluateTest', 'runTest', 'applyTestEvidence', 'getDiagnosticEvidence',
        'getTestHistory', 'listTestLibrary', 'getTestDefinition',
        'listScenarios', 'loadScenario', 'createScenario', 'validateScenario', 'getScenarioAnswer', 'generateScenario',
        'getVehicleProfiles', 'getVehicleProfile', 'setVehicleProfile', 'getActiveVehicleProfile']) {
        assert(typeof P7(m) === 'function', `Phase7.${m}() exposed`);
    }
    const lib = P7('listFaultLibrary()');
    assert(Array.isArray(lib) && lib.length === 13, `fault library has 13 entries (got ${lib.length})`);

    /* ---- 02. CONSTRAINTS: no Math.random, single-engine (Sim fields) ---- */
    console.log('\n02: SIMULATION CONSTRAINTS');
    assert(!/Math\.random\s*\(/.test(diag7Js), 'faultEngine.js TIDAK memanggil Math.random (deterministik)');
    assert(!/activeFaults/.test(diag7Js), 'faultEngine.js TIDAK menulis Sim.activeFaults (hidden-fault protection)');
    assert(typeof getVal('typeof Sim') === 'string' && getVal('typeof Sim') === 'object', 'Sim central state exists');
    assert(getVal('typeof FAULTS') === 'object', 'legacy FAULTS map untouched (single engine)');

    /* ---- 03. SINGLE FAULT apply (weak battery severity 0.5) ---- */
    console.log('\n03: SINGLE FAULT + SEVERITY + NO LEAK');
    getVal('Phase7.clearScenario()');
    const r1 = call('installScenario', { id: 'T1', fault: 'none', faults: [{ id: 'FAULT_BATTERY_WEAK', severity: 0.5 }] });
    assert(!!r1 && r1.id === 'T1', 'installScenario returns scenario state (id T1)');
    assert(near(getVal('Sim.batteryVoltage'), 11.5, 0.001), 'weak battery sev 0.5 -> 11.5V (lerp 12.6<-10.4)');
    assert(getVal('Sim.batteryCondition') === 'WEAK', 'batteryCondition = WEAK');
    assert(near(getVal('Sim.batteryResistance'), 0.007, 0.00001), `batteryResistance 0.007 (got ${getVal('Sim.batteryResistance')})`);
    assert(getVal('Sim.activeFaults.length') === 0, 'NO LEAK — Sim.activeFaults stays empty');
    assert(getVal('Sim.starterMotorFault') === false, 'unrelated field untouched (starterMotorFault false)');

    /* ---- 04. MULTI-FAULT simultaneous ---- */
    console.log('\n04: MULTI-FAULT (2 faults simultaneous)');
    call('clearScenario');
    call('installScenario', { id: 'T2', faults: [
        { id: 'FAULT_BATTERY_WEAK', severity: 0.5 },
        { id: 'FAULT_POOR_GROUND', severity: 0.5 },
    ] });
    const all = P7('getAllFaultStates()');
    assert(all.length === 2, '2 faults active together');
    assert(getVal('Sim.batteryCondition') === 'WEAK', 'weak battery still applied');
    assert(getVal('Sim.groundCondition') === 'POOR', 'poor ground applied');
    assert(near(getVal('Sim.groundResistanceMult'), 2.5, 0.001), `groundResistanceMult 2.5 (got ${getVal('Sim.groundResistanceMult')})`);
    const syms = P7('getActiveSymptoms()');
    const slc = syms.find(s => s.id === 'SLOW_CRANK');
    assert(!!slc && slc.causes.length === 2, `SLOW_CRANK aggregated from both causes (${slc && slc.causes.length})`);

    /* ---- 05. SEVERITY BOUNDS & RESTORE ---- */
    console.log('\n05: SEVERITY BOUNDS + clearScenario RESTORES DEFAULTS');
    call('clearScenario');
    assert(near(getVal('Sim.batteryVoltage'), 12.6, 0.001), 'after clear -> batteryVoltage 12.6');
    assert(getVal('Sim.batteryCondition') === 'GOOD', 'after clear -> batteryCondition GOOD');
    assert(getVal('Sim.groundCondition') === 'GOOD', 'after clear -> ground GOOD');
    assert(getVal('Sim.groundResistanceMult') === 1, 'after clear -> groundResistanceMult 1');
    assert(getVal('Sim.starterEfficiency') === 1, 'after clear -> starterEfficiency 1');
    assert(getVal('Sim.batteryResistance') === 0.005, 'after clear -> batteryResistance 0.005');
    call('installScenario', { id: 'T3', faults: [{ id: 'FAULT_BATTERY_WEAK', severity: -2 }] });
    assert(near(getVal('Sim.batteryVoltage'), 12.6, 0.001) || getVal('Sim.batteryVoltage') <= 12.6, 'severity -2 clamped (no blowup)');
    call('clearScenario');
    call('installScenario', { id: 'T4', faults: [{ id: 'FAULT_BATTERY_WEAK', severity: 7 }] });
    assert(getVal('Sim.batteryVoltage') >= 10.4 - 0.001, 'severity 7 clamped to 1 -> >= 10.4V floor');
    call('clearScenario');

    /* ---- 06. BATTERY EXCLUSIVITY PRIORITY ---- */
    console.log('\n06: BATTERY EXCLUSIVITY (DISCHARGED wins over WEAK)');
    call('installScenario', { id: 'T5', faults: [
        { id: 'FAULT_BATTERY_DISCHARGED', severity: 0.6 },
        { id: 'FAULT_BATTERY_WEAK', severity: 0.9 },
    ] });
    assert(getVal('Sim.batteryCondition') === 'DISCHARGED', 'DISCHARGED applied last (priority) -> DISCHARGED');
    assert(near(getVal('Sim.batteryVoltage'), 12.6 - 9 * 0.6, 0.001), `discharged sev0.6 -> ${(12.6 - 9 * 0.6).toFixed(1)}V`);
    call('clearScenario');

    /* ---- 07. INTERMITTENT START_ATTEMPT_BASED ---- */
    console.log('\n07: INTERMITTENT START_ATTEMPT_BASED');
    call('clearScenario');
    call('addFault', { id: 'FAULT_BATTERY_WEAK', severity: 1,
        intermittent: { mode: 'START_ATTEMPT_BASED', activation: { attemptNumber: 2 } } });
    assert(P7('getFaultState("FAULT_BATTERY_WEAK").windowActive') === true, 'initially windowActive');
    assert(near(getVal('Sim.batteryVoltage'), 10.4, 0.001), 'active -> 10.4V');
    startAttempt(); // attempt 1 (belum threshold 2)
    assert(P7('getFaultState("FAULT_BATTERY_WEAK").windowActive') === false, 'attempt 1 -> inactive (< activation)');
    assert(near(getVal('Sim.batteryVoltage'), 12.6, 0.001), 'inactive window -> battery restored 12.6V');
    startAttempt(); // attempt 2
    assert(P7('getFaultState("FAULT_BATTERY_WEAK").windowActive') === true, 'attempt 2 -> active (>= activation)');
    assert(near(getVal('Sim.batteryVoltage'), 10.4, 0.001), 'reactive -> 10.4V again');
    call('clearScenario');

    /* ---- 08. INTERMITTENT TIME_BASED ---- */
    console.log('\n08: INTERMITTENT TIME_BASED');
    call('addFault', { id: 'FAULT_BATTERY_WEAK', severity: 1,
        intermittent: { mode: 'TIME_BASED', activeDuration: 100, inactiveDuration: 100 } });
    assert(P7('getFaultState("FAULT_BATTERY_WEAK").windowActive') === true, 't0 -> active');
    P7('tick(120)');
    assert(P7('getFaultState("FAULT_BATTERY_WEAK").windowActive') === false, '120ms -> inactive (phase 120/200)');
    assert(near(getVal('Sim.batteryVoltage'), 12.6, 0.001), 'inactive -> 12.6V');
    P7('tick(100)');
    assert(P7('getFaultState("FAULT_BATTERY_WEAK").windowActive') === true, '220ms -> active again (wrap)');
    assert(near(getVal('Sim.batteryVoltage'), 10.4, 0.001), 'active -> 10.4V');
    call('clearScenario');

    /* ---- 09. RANDOM_SEEDED determinism ---- */
    console.log('\n09: RANDOM_SEEDED REPRODUCIBILITY (seed 12345)');
    function seededRun() {
        call('clearScenario');
        call('installScenario', { id: 'R', seed: 12345, faults: [
            { id: 'FAULT_BATTERY_WEAK', severity: 1,
              intermittent: { mode: 'RANDOM_SEEDED', transitionProbability: 0.5 } },
        ] });
        const seq = [];
        for (let i = 0; i < 100; i++) {
            P7('tick(30)');
            seq.push(P7('getFaultState("FAULT_BATTERY_WEAK").windowActive') ? 1 : 0);
        }
        return seq.join('');
    }
    const a1 = seededRun();
    const a2 = seededRun();
    assert(a1.length === 100 && a2.length === 100, '100 ticks sampled both runs');
    assert(a1 === a2, 'same seed -> identical intermittent sequence');
    assert(new Set(a1.split('')).size === 2, 'sequence actually toggled (0 and 1 both present)');
    call('clearScenario');

    /* ---- 10. PROGRESSIVE per attempt ---- */
    console.log('\n10: PROGRESSIVE per attempt (rate 0.15)');
    call('clearScenario');
    call('addFault', { id: 'FAULT_BATTERY_WEAK', baseSeverity: 0, severity: 0,
        progressive: { enabled: true, rate: 0.15, per: 'attempt', maximumSeverity: 1.0 } });
    const sevs = [];
    const volts = [];
    for (let i = 0; i < 4; i++) {
        startAttempt();
        sevs.push(P7(`getFaultState("FAULT_BATTERY_WEAK").severity`));
        volts.push(getVal('Sim.batteryVoltage'));
    }
    assert(near(sevs[0], 0.15, 0.001) && near(sevs[1], 0.30, 0.001) && near(sevs[2], 0.45, 0.001) && near(sevs[3], 0.60, 0.001),
        `severity sequence per attempt ${sevs.map(v => v.toFixed(2)).join(' -> ')}`);
    assert(volts[3] < volts[2] && volts[2] < volts[1] && volts[1] < volts[0], 'voltage degrades monotonically across attempts');
    call('clearScenario');

    /* ---- 11. PROGRESSIVE per timeMs ---- */
    console.log('\n11: PROGRESSIVE per timeMs');
    call('addFault', { id: 'FAULT_POOR_GROUND', severity: 0.2,
        progressive: { enabled: true, rate: 0.1, per: 'timeMs', stepMs: 1000, maximumSeverity: 1.0 } });
    for (let i = 0; i < 3; i++) P7('tick(500)'); // 1500ms -> 1 step
    assert(near(P7('getFaultState("FAULT_POOR_GROUND").progressSteps'), 1, 0.001), 'timeMs -> 1 progress step after 1500ms');
    assert(near(P7('getFaultState("FAULT_POOR_GROUND").severity'), 0.3, 0.001), `severity 0.3 (got ${P7('getFaultState("FAULT_POOR_GROUND").severity')})`);
    call('clearScenario');

    /* ---- 12. STARTER hooks (RPM/current via starterEfficiency & groundMult) ---- */
    console.log('\n12: STARTER PHYSICS HOOKS (single engine, defaults unchanged)');
    call('clearScenario');
    assert(near(getVal('starterRPMTarget()'), 220, 0.001), `baseline starterRPMTarget 220 (got ${getVal('starterRPMTarget()')})`);
    assert(near(getVal('starterCurrentTarget()'), 185, 0.001), `baseline starterCurrentTarget 185 (got ${getVal('starterCurrentTarget()')})`);
    call('addFault', { id: 'FAULT_MECHANICAL_STARTER', severity: 1 });
    assert(near(getVal('Sim.starterEfficiency'), 0.3, 0.001), `mechanical starter sev1 -> starterEfficiency 0.3 (got ${getVal('Sim.starterEfficiency')})`);
    assert(near(getVal('starterRPMTarget()'), 66, 0.01), `crank RPM drops to 66 (got ${getVal('starterRPMTarget()')})`);
    assert(getVal('starterCurrentTarget()') > 185, `crank current rises above 185 (got ${getVal('starterCurrentTarget()')})`);
    call('clearScenario');
    call('addFault', { id: 'FAULT_POOR_GROUND', severity: 1 });
    assert(near(getVal('Sim.groundResistanceMult'), 4, 0.001), 'poor ground sev1 -> groundResistanceMult 4');
    assert(near(getVal('starterRPMTarget()'), 77, 0.01), `poor ground -> crank RPM 77 (got ${getVal('starterRPMTarget()')})`);

    /* ---- 13. STARTER_MOTOR severity gating ---- */
    console.log('\n13: STARTER_MOTOR severity gating');
    call('clearScenario');
    call('addFault', { id: 'FAULT_STARTER_MOTOR', severity: 0.4 });
    assert(getVal('Sim.starterMotorFault') === false, 'sev0.4 -> motorFault OFF');
    assert(near(getVal('Sim.starterEfficiency'), 1 - 0.55 * 0.4, 0.001), `dedicated starters below threshold degrade efficiency (${getVal('Sim.starterEfficiency')})`);
    call('clearScenario');
    call('addFault', { id: 'FAULT_STARTER_MOTOR', severity: 0.9 });
    assert(getVal('Sim.starterMotorFault') === true, 'sev0.9 -> motorFault ON (no crank)');
    call('clearScenario');

    /* ---- 14. SETTERS ---- */
    console.log('\n14: SETTER API (setSeverity / enable|disable / remove / setConfig)');
    call('addFault', { id: 'FAULT_BATTERY_WEAK', severity: 0.5 });
    call('setFaultSeverity', 'FAULT_BATTERY_WEAK', 0.9);
    assert(near(P7('getFaultState("FAULT_BATTERY_WEAK").severity'), 0.9, 0.001), 'setFaultSeverity -> 0.9');
    call('disableFault', 'FAULT_BATTERY_WEAK');
    assert(near(getVal('Sim.batteryVoltage'), 12.6, 0.001), 'disabled -> battery restored 12.6V');
    assert(P7('getFaultState("FAULT_BATTERY_WEAK").active') === false, 'getFaultState.active false');
    call('enableFault', 'FAULT_BATTERY_WEAK');
    assert(near(getVal('Sim.batteryVoltage'), 12.6 - 0.9 * 2.2, 0.001), 're-enabled -> battery weak again');
    const rm = call('removeFault', 'FAULT_BATTERY_WEAK');
    assert(rm.ok === true, 'removeFault ok');
    assert(P7('getAllFaultStates().length') === 0, '0 faults after remove');
    const cfg = call('setConfig', { thresholds: { batteryWeakOn: 0.1 } });
    assert(cfg.thresholds.batteryWeakOn === 0.1, 'setConfig overrides threshold');
    call('setConfig', {});

    /* ---- 15. AUTO LOOP (single interval) ---- */
    console.log('\n15: AUTO LOOP');
    call('clearScenario');
    call('installScenario', { id: 'AUTO1', faults: [{ id: 'FAULT_BATTERY_WEAK', severity: 0.5 }] });
    const tDiff = Date.now();
    call('startAuto', 50);
    await new Promise(r => setTimeout(r, 320));
    call('stopAuto');
    const elapsed = P7('getScenarioState().elapsedMs');
    assert(elapsed >= 150, `elapsedMs advanced by auto loop (${elapsed}ms)`);
    assert(P7('getScenarioState().attemptCount') >= 0, 'auto loop does not corrupt scenario');

    /* ---- 16. FAULT INTERACTION (STEP 6 / §8) ---- */
    console.log('\n16: FAULT INTERACTION ENGINE');
    call('clearScenario');
    const defs = P7('listInteractionDefinitions()');
    assert(Array.isArray(defs) && defs.length === 4, `4 interaction definitions (got ${defs.length})`);

    // Single fault -> TIDAK ada interaksi; starterCurrentMult tetap 1
    call('addFault', { id: 'FAULT_BATTERY_WEAK', severity: 0.5 });
    assert(P7('getInteractions().length') === 0, 'single fault -> zero interactions');
    assert(getVal('Sim.starterCurrentMult') === 1, 'single fault -> starterCurrentMult stays 1');

    // Weak battery + poor ground -> INT_WEAK_GROUND: arus puncak + gejala sekunder
    call('addFault', { id: 'FAULT_POOR_GROUND', severity: 0.5 });
    assert(P7('getInteractions().length') === 1, 'two interacting faults -> 1 interaction');
    const ix = P7('getInteraction("INT_WEAK_GROUND")');
    assert(!!ix && ix.combine === 'amplify', 'INT_WEAK_GROUND active (amplify)');
    assert(near(ix.severity, 0.5, 0.001), `interaction severity = mean(0.5,0.5) = 0.5 (${ix.severity})`);
    assert(near(ix.simChanges.starterCurrentMult, 1.4, 0.001), `interaction -> starterCurrentMult 1.4 (${ix.simChanges.starterCurrentMult})`);
    assert(getVal('Sim.starterCurrentMult') === 1.4, 'sim reflects starterCurrentMult 1.4');
    assert(ix.secondarySymptoms.indexOf('HIGH_INRUSH_CURRENT') >= 0, 'secondary symptom HIGH_INRUSH_CURRENT produced');
    assert(ix.diagnosticNotes.length >= 1, 'interaction yields diagnostic note');
    // Primer tetap utuh: ground drop & volt rendah (bukan hanya "baterai rusak")
    assert(near(getVal('Sim.groundResistanceMult'), 2.5, 0.001), 'primary poor-ground effect preserved (groundMult 2.5)');
    assert(getVal('Sim.batteryCondition') === 'WEAK', 'primary weak-battery effect preserved');
    // Gejala sekunder termutakhir di symptom engine
    const syms2 = P7('getActiveSymptoms()');
    assert(syms2.some(s => s.id === 'HIGH_INRUSH_CURRENT'), 'HIGH_INRUSH_CURRENT appears in getActiveSymptoms');
    const linr = syms2.find(s => s.id === 'HIGH_INRUSH_CURRENT');
    assert(!!linr && linr.causes.length === 2, 'secondary symptom has 2 causes (both faults)');

    // Interaksi "high current": lebih tinggi daripada weak battery sendirian
    call('removeFault', 'FAULT_POOR_GROUND');
    const curWeak = getVal('starterCurrentTarget()');
    call('addFault', { id: 'FAULT_POOR_GROUND', severity: 0.5 });
    const curWeakGround = getVal('starterCurrentTarget()');
    assert(curWeakGround > curWeak + 1, `interaction raises cranking current (${curWeak.toFixed(1)}A -> ${curWeakGround.toFixed(1)}A)`);

    // disable -> interaksi hilang; enable -> kembali
    call('disableFault', 'FAULT_POOR_GROUND');
    assert(P7('getInteractions().length') === 0, 'disabled participant -> interaction off');
    assert(getVal('Sim.starterCurrentMult') === 1, 'interaction effect reverted to 1');
    call('enableFault', 'FAULT_POOR_GROUND');
    assert(P7('getInteractions().length') === 1, 're-enabled participant -> interaction back');
    call('clearScenario');

    // severity nol -> interaksi tidak aktif (threshold)
    call('installScenario', { id: 'IX0', faults: [
        { id: 'FAULT_BATTERY_WEAK', severity: 0 },
        { id: 'FAULT_POOR_GROUND', severity: 0.6 },
    ] });
    assert(P7('getInteractions().length') === 0, 'zero-severity participant -> no interaction (minSeverity)');
    call('clearScenario');

    // interaksi window intermittency: TIME_BASED ground off -> interaction off
    call('addFault', { id: 'FAULT_BATTERY_WEAK', severity: 1 });
    call('addFault', { id: 'FAULT_POOR_GROUND', severity: 0.5,
        intermittent: { mode: 'TIME_BASED', activeDuration: 100, inactiveDuration: 100 } });
    assert(P7('getInteractions().length') === 1, 'window active -> interaction present');
    P7('tick(120)');
    assert(P7('getInteractions().length') === 0, 'window inactive -> interaction gone');
    assert(getVal('Sim.starterCurrentMult') === 1, 'intermittent-off -> currentMult reverted');
    P7('tick(100)');
    assert(P7('getInteractions().length') === 1, 'window re-activates -> interaction returns');
    call('clearScenario');

    // INT_BATTERY_CABLE: kecil hambatan menumpuk (sum)
    call('installScenario', { id: 'IX2', faults: [
        { id: 'FAULT_BATTERY_WEAK', severity: 0.5 },
        { id: 'FAULT_HIGH_POSITIVE_RESISTANCE', severity: 0.5 },
    ] });
    const ix2 = P7('getInteraction("INT_BATTERY_CABLE")');
    assert(!!ix2 && ix2.combine === 'sum', 'INT_BATTERY_CABLE active (sum)');
    assert(near(getVal('Sim.cableResistanceMult'), 3.75, 0.001), `cable mult stacks: 3 + 0.75 = 3.75 (${getVal('Sim.cableResistanceMult')})`);
    assert(ix2.secondarySymptoms.indexOf('HIGH_VOLTAGE_DROP_POSITIVE') >= 0, 'secondary HIGH_VOLTAGE_DROP_POSITIVE present');
    call('clearScenario');

    // INT_MOTOR_GROUND_MASK: motor mati menutupi bukti ground (mask, tanpa ubah Sim)
    call('installScenario', { id: 'IX3', faults: [
        { id: 'FAULT_STARTER_MOTOR', severity: 0.9 },
        { id: 'FAULT_POOR_GROUND', severity: 0.5 },
    ] });
    const ix3 = P7('getInteraction("INT_MOTOR_GROUND_MASK")');
    assert(!!ix3 && ix3.combine === 'mask', 'INT_MOTOR_GROUND_MASK active (mask)');
    assert(Object.keys(ix3.simChanges).length === 0, 'mask interaction does not change Sim fields');
    assert(getVal('Sim.starterMotorFault') === true, 'motor fault primary preserved');
    assert(getVal('Sim.groundResistanceMult') === 2.5, 'ground primary preserved under mask');
    assert(P7('getActiveSymptoms()').some(s => s.id === 'CLICK_OR_BUZZ_NO_CRANK'), 'mask adds CLICK_OR_BUZZ_NO_CRANK symptom');
    call('clearScenario');

    // INT_LOOSE_RELAY: dua kontak resistif bertumpuk
    call('installScenario', { id: 'IX4', faults: [
        { id: 'FAULT_LOOSE_TERMINAL', severity: 0.5 },
        { id: 'FAULT_RELAY', severity: 0.9 },
    ] });
    const ix4 = P7('getInteraction("INT_LOOSE_RELAY")');
    assert(!!ix4 && ix4.combine === 'amplify', 'INT_LOOSE_RELAY active (amplify)');
    assert(near(getVal('Sim.terminalResistance'), 0.018, 0.0001), `terminal resistance stacks 0.011+0.007 = 0.018 (sev=mean(0.5,0.9)=0.7; got ${getVal('Sim.terminalResistance')})`);
    assert(getVal('Sim.relayFaultType') === 'contactOpen', 'relay primary preserved under interaction');
    assert(ix4.secondarySymptoms.indexOf('CONTACT_RESISTANCE_SIGNATURE') >= 0, 'secondary CONTACT_RESISTANCE_SIGNATURE present');
    call('clearScenario');

    // 3 fault simultan -> definisi interaksi tetap deterministik & primer utuh
    call('installScenario', { id: 'IX5', faults: [
        { id: 'FAULT_BATTERY_WEAK', severity: 0.4 },
        { id: 'FAULT_POOR_GROUND', severity: 0.6 },
        { id: 'FAULT_HIGH_POSITIVE_RESISTANCE', severity: 0.7 },
    ] });
    const ixs5 = P7('getInteractions()');
    assert(ixs5.length === 2, `3 faults -> 2 interactions (got ${ixs5.length})`);
    assert(getVal('Sim.batteryCondition') === 'WEAK' && getVal('Sim.groundCondition') === 'POOR', 'primaries of all 3 intact');
    call('clearScenario');

    /* ---- 17. SYMPTOM ENGINE v2 (STEP 7 / §16-17) ---- */
    console.log('\n17: SYMPTOM ENGINE v2 (live derivation + matrix)');
    call('clearScenario');
    assert(P7('getActiveSymptoms().length') === 0, 'no scenario -> no symptoms (guard)');
    assert(typeof P7('evaluateSymptoms') === 'function', 'evaluateSymptoms() exposed (API §69)');
    assert(typeof P7('getSymptomMatrix') === 'function' && typeof P7('getSymptom') === 'function', 'symptom matrix API exposed');
    const matrix = P7('getSymptomMatrix()');
    assert(Array.isArray(matrix) && matrix.length >= 10, `symptom matrix >= 10 entries (got ${matrix.length})`);
    const sldef = matrix.find(m => m.id === 'SLOW_CRANK');
    assert(!!sldef && sldef.possibleCauses.length >= 5, 'SLOW_CRANK has >= 5 possible causes (multi-cause, §17)');
    assert(Array.isArray(sldef.measurements) && sldef.measurements.length > 0, 'SLOW_CRANK lists supporting measurements');

    // Live derive LOW_CRANKING_VOLTAGE dari batteryVoltage (tanpa nama fault)
    call('installScenario', { id: 'SY1', faults: [{ id: 'FAULT_BATTERY_WEAK', severity: 0.9 }] });
    let syms3 = P7('getActiveSymptoms()');
    const lcv = syms3.find(s => s.id === 'LOW_CRANKING_VOLTAGE');
    assert(!!lcv && lcv.live === true, 'LOW_CRANKING_VOLTAGE live-derived from Sim.batteryVoltage');
    assert(near(lcv.severity, (12.6 - 10.62) / 2.2, 0.001), `live severity matches physics (${lcv.severity})`);
    assert(lcv.confidence > 0.55, `live evidence boosts confidence (${lcv.confidence})`);
    assert(lcv.causes.indexOf('FAULT_BATTERY_WEAK') >= 0, 'cause attributed to weak battery');
    assert(typeof lcv.measurements === 'object' && lcv.measurements.length > 0, 'symptom carries measurement hints');

    // SLOW_CRANK live saat CRANKING: bukti terukur (RPM rendah) mendominasi base fault
    call('clearScenario');
    call('installScenario', { id: 'SY1B', faults: [{ id: 'FAULT_BATTERY_WEAK', severity: 0.3 }] });
    getVal("Sim.starterState='CRANKING'");
    getVal('Sim.starterRPM=120');
    syms3 = P7('getActiveSymptoms()');
    const lsc = syms3.find(s => s.id === 'SLOW_CRANK');
    assert(!!lsc && lsc.live === true, 'SLOW_CRANK live-derived while CRANKING');
    // batteryVoltage = 12.6-2.2*0.3 = 11.94 => bf=0.9476, target=220*0.9476=208.47,
    // sev = (208.47-120)/208.47 = 0.4244  (di atas base fault 0.3 -> bukti live dominan)
    assert(near(lsc.severity, 0.4244, 0.01), `live SLOW_CRANK severity dominan atas base (${lsc.severity})`);
    assert(syms3.every(s => s.confidence >= 0 && s.confidence <= 0.98), 'confidence bounded');
    getVal("Sim.starterState='OFF'");
    getVal('Sim.starterRPM=0');
    call('clearScenario');

    // NO_CRANK live dari kondisi stop-hard (motor mati)
    call('clearScenario');
    call('installScenario', { id: 'SY2', faults: [{ id: 'FAULT_STARTER_MOTOR', severity: 0.9 }] });
    syms3 = P7('getActiveSymptoms()');
    const lnc = syms3.find(s => s.id === 'NO_CRANK');
    assert(!!lnc && lnc.live === true && lnc.severity === 1, 'NO_CRANK live severity 1 (motor dead)');
    // getModal: penyebab melalui getPossibleCauses
    const pc = P7('getPossibleCauses("NO_CRANK")');
    assert(pc.indexOf('FAULT_STARTER_MOTOR') >= 0 && pc.length >= 4, 'getPossibleCauses returns multi-cause list');
    call('clearScenario');

    // Deterministik: dua panggilan berurutan identik (tanpa random)
    call('installScenario', { id: 'SY3', faults: [{ id: 'FAULT_POOR_GROUND', severity: 0.3 }] });
    getVal('Sim.voltageDropGround=0.9');
    const g1 = JSON.stringify(P7('getActiveSymptoms()'));
    const g2 = JSON.stringify(P7('getActiveSymptoms()'));
    assert(g1 === g2, 'symptom evaluation fully deterministic');
    const gDrop = P7('getActiveSymptoms()').find(s => s.id === 'GROUND_VOLTAGE_DROP');
    // base fault 0.3 lebih rendah dr live (0.9-0.15)/1.4 = 0.5357 -> bukti live menang
    assert(!!gDrop && near(gDrop.severity, 0.5357, 0.001), `GROUND_VOLTAGE_DROP live severity (${gDrop && gDrop.severity})`);
    assert(!/Math\.random\s*\(/.test(diag7Js), 'faultEngine.js still deterministic (no random in engine)');
    getVal('Sim.voltageDropGround=0');
    call('clearScenario');

    // getSymptom metadata tanpa crash; symptom tak dikenal -> null
    const gs = P7('getSymptom("GRINDING")');
    assert(!!gs && gs.possibleCauses.length >= 1, 'getSymptom returns metadata');
    assert(P7('getSymptom("NOPE")') === null, 'unknown symptom -> null');

    /* ---- 18. HYPOTHESIS ENGINE (STEP 8 / §19 + alur §18) ---- */
    console.log('\n18: HYPOTHESIS ENGINE (generate / rank / evidence / status)');
    call('clearScenario');
    assert(P7('getHypotheses()').length === 0, 'no scenario -> no hypotheses');
    assert(P7('getDiagnosticPath()').length === 0, 'no scenario -> no diagnostic path');
    P7('installScenario')({ id: 'HY1', faults: [
        { id: 'FAULT_BATTERY_WEAK', severity: 0.9 },
        { id: 'FAULT_POOR_GROUND', severity: 0.6 }
    ] });
    assert(P7('getDiagnosticPath()').length >= 1 && P7('getDiagnosticPath()')[0].step === 'START', 'path starts at START');

    let hyps = P7('generateHypotheses()');
    assert(Array.isArray(hyps) && hyps.length >= 5, `candidates generated from visible symptoms (got ${hyps.length})`);
    const hWeak = hyps.find(h => h.faultId === 'FAULT_BATTERY_WEAK');
    const hGround = hyps.find(h => h.faultId === 'FAULT_POOR_GROUND');
    assert(!!hWeak && !!hGround, 'both installed faults present as candidates (matrix, bukan bocor)');
    assert(hWeak.evidenceFor.length === 0 && hWeak.evidenceAgainst.length === 0, 'evidence arrays seeded empty');
    assert(['UNTESTED', 'POSSIBLE', 'LIKELY', 'UNLIKELY', 'CONFIRMED', 'REJECTED'].includes(hWeak.status), 'status ∈ §19 set');
    assert(hWeak.sourceSymptoms.indexOf('LOW_CRANKING_VOLTAGE') >= 0 && hWeak.sourceSymptoms.indexOf('SLOW_CRANK') >= 0, 'source symptoms attributed');
    // Kandidat tanpa dukungan gejala TIDAK muncul (tidak bocor daftar fault)
    assert(!hyps.some(h => h.faultId === 'FAULT_OPEN_FUSE'), 'unsupported fault NOT spuriously ranked');
    // Kemunculan deterministik + distractor ada ekspektasi
    const hypStr1 = JSON.stringify(P7('getRankedHypotheses()'));
    const hypStr2 = JSON.stringify(P7('getRankedHypotheses()'));
    assert(hypStr1 === hypStr2, 'hypothesis ranking fully deterministic');
    const ranked = P7('getRankedHypotheses()');
    assert(ranked[0].probability >= ranked[ranked.length - 1].probability, 'ranked descending by probability');

    // Evaluasi ulang memperbarui status/default deterministik
    const evW = P7('evaluateHypothesis')(hWeak.id);
    assert(!!evW && typeof evW.probability === 'number' && evW.probability > 0, 'evaluateHypothesis recomputes probability');
    assert(['LIKELY', 'POSSIBLE', 'CONFIRMED'].includes(evW.status), 'weak battery promoted by multi-symptom evidence');

    // recordEvidence: CONTRADICTING -> REJECTED
    const rej = P7('recordEvidence')(hWeak.id, { test: 'GROUND_VOLTAGE_DROP', verdict: 'CONTRADICTING', note: 'drop normal' });
    assert(rej.ok === true && rej.hypothesis.evidenceAgainst.length === 1, 'CONTRADICTING recorded as evidence against');
    assert(rej.hypothesis.status === 'REJECTED', 'status → REJECTED on contradicting evidence');
    const un = P7('getHypothesis')(hWeak.id);
    assert(un && un.evidenceAgainst.length === 1, 'evidence persists in snapshot');
    // SUPPORTING (2x) + p cukup -> CONFIRMED (threshold diturunkan utk kasus ini, §63)
    P7('setConfig')({ hypothesis: { likelyThreshold: 0.55, confirmThreshold: 0.5 } });
    P7('recordEvidence')(hGround.id, { test: 'GROUND_VOLTAGE_DROP', verdict: 'SUPPORTING' });
    const hg = P7('recordEvidence')(hGround.id, { test: 'CRANKING_VOLTAGE', verdict: 'SUPPORTING' });
    assert(hg.ok === true && P7('getHypothesis')(hGround.id).evidenceFor.length === 2, 'dual supporting evidence recorded');
    const hgEval = P7('evaluateHypothesis')(hGround.id);
    assert(hgEval.status === 'CONFIRMED', `dual supporting evidence → CONFIRMED (got ${hgEval.status})`);

    // createHypothesis manual (bukan dari gejala)
    const cre = P7('createHypothesis')({ component: 'starter', faultType: 'MOTOR_FAULT' });
    assert(cre.ok === true && cre.hypothesis.faultId === 'FAULT_STARTER_MOTOR', 'manual hypothesis from component+faultType');
    const cre2 = P7('createHypothesis')('BOGUS_FAULT');
    assert(cre2.ok === false, 'unknown fault rejected (no leak)');
    P7('resetHypotheses')();
    assert(P7('getHypotheses()').length === 0, 'resetHypotheses clears list');
    // Path mencatat langkah diagnosis (§22 diagnosticPath)
    const path = P7('getDiagnosticPath')();
    assert(path.some(p => p.step === 'START') && path.some(p => p.step === 'GENERATE_HYPOTHESES'), 'path records diagnosis flow');
    call('clearScenario');

    /* ---- 19. EVIDENCE ENGINE (STEP 9 / §20-21 + recordEvidence/evaluateTest) ---- */
    console.log('\n19: EVIDENCE ENGINE (test library / verdict from physics)');
    call('clearScenario');
    const testLib = P7('listTestLibrary()');
    assert(Array.isArray(testLib) && testLib.length >= 6, `test library >= 6 (got ${testLib.length})`);
    const ALL5 = ['BATTERY', 'CABLE', 'GROUND', 'STARTER', 'MECHANICAL'];
    assert(testLib.every(t => ALL5.every(a => t.areas.includes(a))), 'every test evaluates all 5 areas (§20)');
    const cvt = testLib.find(t => t.id === 'TEST_CRANKING_VOLTAGE');
    assert(cvt && typeof cvt.diagnosticValue === 'number' && typeof cvt.timeCost === 'number' && ['EASY', 'MEDIUM', 'HARD'].includes(cvt.difficulty), 'test carries §21 cost/value/difficulty');
    assert(P7('getTestDefinition')('TEST_OCV').kpi.includes('batteryVoltage'), 'getTestDefinition exposes kpi');
    assert(P7('evaluateTest')('NOPE').ok === false, 'unknown test rejected');

    // §20 inti: OCV normal + cranking parah -> bukti MENOLAK baterai, mengarah sisi beban
    P7('installScenario')({ id: 'EV1', faults: [{ id: 'FAULT_LOOSE_TERMINAL', severity: 1 }] });
    getVal("Sim.starterState='CRANKING'");
    getVal('Sim.starterVoltage=8.0');
    const cvRes = P7('evaluateTest')('TEST_CRANKING_VOLTAGE');
    assert(cvRes.ok === true && cvRes.measurements.starterVoltage === 8.0, 'measurements snapshot dari Sim live');
    const evBatt = cvRes.evidence.find(e => e.candidate === 'BATTERY');
    const evSta = cvRes.evidence.find(e => e.candidate === 'STARTER');
    assert(evBatt && evBatt.verdict === 'CONTRADICTING' && evBatt.note.includes('Battery OCV normal'), '§20: OCV normal TIDAK otomatis baterai rusak');
    assert(evSta && evSta.verdict === 'SUPPORTING', 'cranking parah + baterai sehat -> sisi beban diduga');
    assert(cvRes.evidence.every(e => ['SUPPORTING', 'CONTRADICTING', 'NEUTRAL', 'INSUFFICIENT'].includes(e.verdict)), 'verdict ∈ §20 set');

    // Alirkan bukti ke hipotesis baterai -> harus REJECTED
    P7('generateHypotheses')();
    const hw2 = P7('getHypotheses()').find(h => h.faultId === 'FAULT_BATTERY_WEAK');
    const ap = P7('applyTestEvidence')(hw2.id, 'TEST_CRANKING_VOLTAGE');
    assert(ap.ok === true && ap.verdict === 'CONTRADICTING', 'applyTestEvidence auto-records verdict utk hipotesis');
    assert(P7('getHypothesis')(hw2.id).status === 'REJECTED', 'baterai ditolak oleh bukti cranking (§20)');
    assert(P7('getDiagnosticEvidence')().length >= 5, 'getDiagnosticEvidence aggregates per-candidate verdicts');
    assert(P7('getTestHistory')().length >= 1 && P7('getTestHistory')()[0].test === 'TEST_CRANKING_VOLTAGE', 'test history logged');

    // INSUFFICIENT saat kondisi tidak tepat (starter OFF)
    getVal("Sim.starterState='OFF'");
    const offRes = P7('evaluateTest')('TEST_CRANKING_VOLTAGE');
    assert(offRes.evidence.every(e => e.verdict === 'INSUFFICIENT'), 'test pada kondisi salah -> semua INSUFFICIENT');
    call('clearScenario');

    // TEST_OCV lemah -> baterai SUPPORTING; determinisme dua panggilan identik
    P7('installScenario')({ id: 'EV2', faults: [{ id: 'FAULT_BATTERY_WEAK', severity: 0.9 }] });
    const ocv1 = JSON.stringify(P7('evaluateTest')('TEST_OCV').evidence);
    const ocv2 = JSON.stringify(P7('evaluateTest')('TEST_OCV').evidence);
    assert(ocv1 === ocv2, 'evidence fully deterministic');
    const ocvEv = P7('evaluateTest')('TEST_OCV').evidence;
    assert(ocvEv.find(e => e.candidate === 'FAULT_BATTERY_WEAK').verdict === 'SUPPORTING', 'OCV lemah mendukung battery hypothesis');

    // TEST_GROUND_DROP: drop berlebih -> ground SUPPORTING (bukan baterai)
    P7('installScenario')({ id: 'EV3', faults: [{ id: 'FAULT_POOR_GROUND', severity: 0.6 }] });
    getVal('Sim.voltageDropGround=0.9');
    const gdEv = P7('evaluateTest')('TEST_GROUND_DROP').evidence;
    assert(gdEv.find(e => e.candidate === 'GROUND').verdict === 'SUPPORTING', 'ground drop tinggi -> ground SUPPORTING');
    assert(gdEv.find(e => e.candidate === 'BATTERY').verdict === 'INSUFFICIENT', 'ground drop tidak menimpa baterai');

    // Konfigurasi tes terbuka (§63): naikkan batas drop -> verdict berubah deterministik
    P7('setConfig')({ tests: { dropLimit: 1.5 } });
    const gdLen = P7('evaluateTest')('TEST_GROUND_DROP').evidence;
    assert(gdLen.find(e => e.candidate === 'GROUND').verdict === 'CONTRADICTING', 'threshold configurable (dropLimit 1.5)');
    getVal('Sim.voltageDropGround=0');
    getVal("Sim.starterState='OFF'");
    call('clearScenario');

    /* ---- 20. SCENARIO ENGINE (STEP 10 / §13 + createScenario/loadScenario/generateScenario) ---- */
    console.log('\n20: SCENARIO ENGINE (catalog / load / validate / generate)');
    call('clearScenario');
    const scMeta = P7('listScenarios()');
    assert(Array.isArray(scMeta) && scMeta.length >= 6, `built-in scenario catalog >= 6 (got ${scMeta.length})`);
    assert(scMeta.every(s => s.id && s.complaint && ['TRAINER_A', 'TRAINER_B', 'TRAINER_C'].includes(s.vehicleProfile)),
        'every scenario has required metadata');
    assert(scMeta.every(s => ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'].includes(s.difficulty)), 'difficulty vocabulary valid');
    assert(scMeta.every(s => Array.isArray(s.expectedSymptoms)), 'expectedSymptoms listed');
    assert(scMeta.every(s => !('faults' in s)), 'catalog metadata TIDAK membocorkan jawaban fault');

    const adv = P7('listScenarios')({ difficulty: 'ADVANCED' });
    assert(adv.length >= 3 && adv.every(s => s.difficulty === 'ADVANCED'), 'listScenarios supports filter');

    const ld = P7('loadScenario')('SC_WEAK_BATTERY');
    assert(ld.ok === true && ld.state.id === 'SC_WEAK_BATTERY' && ld.state.difficulty === 'BEGINNER', 'loadScenario installs case');
    assert(ld.state.expectedSymptoms.indexOf('SLOW_CRANK') >= 0, 'expectedSymptoms carried to state');
    assert(ld.state.environment && ld.state.environment.temperature === 'NORMAL', 'environment surfaced in state');
    assert(getVal('Sim.batteryVoltage') < 12.6, 'hidden case fault applied (weak battery)');
    assert(P7('getScenarioState()').faults.length === 1, 'case faults registered in scenario (instructor view)');
    assert(getVal('Sim.activeFaults').length === 0, 'hidden-fault protection: Sim.activeFaults empty');

    const ans = P7('getScenarioAnswer')('SC_WEAK_BATTERY');
    assert(ans && ans.faults.length === 1 && ans.faults[0].faultId === 'FAULT_BATTERY_WEAK', 'getScenarioAnswer exposes answer (instructor)');

    const bad = P7('validateScenario')({ id: 'X', faults: [{ faultId: 'BOGUS', severity: 5 }], difficulty: 'WILD' });
    assert(bad.ok === false && bad.errors.length >= 3, 'validateScenario catches all errors');

    const creScene = P7('createScenario')({
        id: 'SC_CUSTOM_1', complaint: 'Starter dead', difficulty: 'INTERMEDIATE',
        faults: [{ faultId: 'FAULT_RELAY', severity: 0.7 }]
    });
    assert(creScene.ok === true && creScene.id === 'SC_CUSTOM_1', 'createScenario registers custom case');
    assert(P7('listScenarios()').some(s => s.id === 'SC_CUSTOM_1'), 'custom case in catalog');
    assert(P7('loadScenario')('SC_CUSTOM_1').ok === true, 'custom case loadable');
    assert(P7('createScenario')({ id: 'SC_CUSTOM_1', complaint: 'dup' }).ok === false, 'duplicate id rejected');

    const gen1 = JSON.stringify(P7('generateScenario')(123));
    const gen2 = JSON.stringify(P7('generateScenario')(123));
    assert(gen1 === gen2, 'generateScenario fully deterministic per seed');
    const gen = JSON.parse(gen1);
    assert(gen.id === 'SC_GEN_123' && ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].includes(gen.difficulty), 'generated scenario structured');
    if (gen.expectedSymptoms.length === 0) assert(false, 'generated scenario has expected symptoms');
    assert(gen.faults.length >= 1 && gen.faults.every(f => f.severity >= 0 && f.severity <= 1), 'generated faults severity in range');
    assert(gen.environment && ['NORMAL', 'COLD', 'HOT'].includes(gen.environment.temperature), 'environment randomized deterministically');
    const g123 = P7('generateScenario')(123);
    const g999 = P7('generateScenario')(999);
    assert(g123.id !== g999.id, 'different seeds -> different scenarios');
    assert(P7('loadScenario')('SC_INTERMITTENT_RELAY').ok === true, 'intermittent case loadable');
    call('clearScenario');

    /* ---- 21. VEHICLE PROFILE (STEP 11 / §14-15 + §63-64) ---- */
    console.log('\n21: VEHICLE PROFILE (variants / override fisika / disclaimer)');
    const profs = P7('getVehicleProfiles()');
    assert(profs.length >= 3, 'at least 3 vehicle variants');
    const ids = profs.map(p => p.id);
    assert(['TRAINER_A', 'TRAINER_B', 'TRAINER_C'].every(i => ids.includes(i)), 'profiles TRAINER_A/B/C present');
    assert(profs.every(p => p.battery.nominalVoltage === 12 && typeof p.starter.gearRatio === 'number'), 'profile structure §14');
    assert(profs.every(p => p.caveats && /BUKAN/.test(p.caveats)), 'setiap profil menyertakan disclaimer §64');
    const pB = profs.find(p => p.id === 'TRAINER_B');
    const pC = profs.find(p => p.id === 'TRAINER_C');
    assert(pB.battery.goodVoltage !== profs[0].battery.goodVoltage, 'battery characteristics differ (§15)');
    assert(pC.starter.baseCurrent > 200 && pC.starter.baseRPM > 250, 'starter characteristics differ');
    assert(pC.starter.gearRatio === 9 && pC.electricalArchitecture.solenoidControlType, 'gear ratio + architecture differ');
    assert(pC.electricalArchitecture.relayPresent === true && pB.electricalArchitecture.relayPresent === false, 'relay config differs per variant');
    assert(pC.starter.currentRange.length === 2 && pC.starter.currentRange[0] < pC.starter.currentRange[1], 'configurableCurrentRange shape §14');
    assert(P7('getVehicleProfile')('TRAINER_C').starter.baseRPM === 260, 'getVehicleProfile returns profile');
    assert(P7('getVehicleProfile')('NOPE') === null, 'unknown profile -> null');

    // Profil memengaruhi fisika baterai (satu engine, varian berbeda)
    call('setVehicleProfile', 'TRAINER_B');
    assert(P7('getActiveVehicleProfile()').id === 'TRAINER_B', 'active profile = TRAINER_B');
    call('installScenario', { id: 'VF1', faults: [{ id: 'FAULT_BATTERY_WEAK', severity: 0.5 }] });
    assert(near(getVal('Sim.batteryVoltage'), (12.4 + 10.2) / 2, 0.01), `profile B berlaku: weak .5 -> ${getVal('Sim.batteryVoltage')}V (lerp 12.4/10.2)`);
    assert(P7('getScenarioState()').vehicleProfile === 'TRAINER_B', 'state reflects profile');
    call('setVehicleProfile', 'TRAINER_A');
    call('installScenario', { id: 'VF2', faults: [{ id: 'FAULT_BATTERY_WEAK', severity: 0.5 }] });
    assert(near(getVal('Sim.batteryVoltage'), (12.6 + 10.4) / 2, 0.01), `kembali profil A -> ${getVal('Sim.batteryVoltage')}V (lerp 12.6/10.4)`);

    // loadScenario auto-mengikuti vehicleProfile case (varian §15) 
    P7('createScenario')({
        id: 'SC_CUSTOM_C', complaint: 'Weak in cold climate', vehicleProfile: 'TRAINER_C', difficulty: 'INTERMEDIATE',
        faults: [{ faultId: 'FAULT_BATTERY_WEAK', severity: 0.5 }]
    });
    assert(P7('loadScenario')('SC_CUSTOM_C').ok === true, 'custom TRAINER_C case loadable');
    assert(near(getVal('Sim.batteryVoltage'), (12.9 + 10.8) / 2, 0.01), `profil C auto -> ${getVal('Sim.batteryVoltage')}V (lerp 12.9/10.8)`);
    assert(P7('getActiveVehicleProfile()').id === 'TRAINER_C', 'active profile switched to C by scenario');
    assert(P7('loadScenario')('SC_WEAK_BATTERY').ok === true, 'built-in case reloadable (switch back to A)');
    assert(near(getVal('Sim.batteryVoltage'), 12.6 - 2.2 * 0.7, 0.02), `kembali ke profil A utk case bawaan -> ${getVal('Sim.batteryVoltage')}V`);
    assert(P7('getActiveVehicleProfile()').id === 'TRAINER_A', 'active profile switched back to A');

    // Ambang tes mengikuti profil (§15 diagnostic thresholds): profil C lebih ketat
    call('setVehicleProfile', 'TRAINER_C');
    assert(P7('getConfig()').tests.crankSevereFloor === 10.0, 'C: threshold crankSevereFloor 10.0');
    call('setVehicleProfile', 'TRAINER_A');
    assert(P7('getConfig()').tests.crankSevereFloor === 9.5, 'A: threshold crankSevereFloor 9.5');
    call('clearScenario');

    /* ---- 22. 20 ADVANCED CASES (STEP 12 / §20 CASES + §31-32) ---- */
    console.log('\n22: 20 ADVANCED CASES (5 per tier, difficulty factors)');
    const cat = P7('listScenarios()');
    assert(cat.length === 20, `exactly 20 curricular cases, got ${cat.length}`);
    const tierN = (d) => P7('listScenarios')({ difficulty: d }).length;
    assert(tierN('BEGINNER') === 5 && tierN('INTERMEDIATE') === 5, '5 BEGINNER + 5 INTERMEDIATE');
    assert(tierN('ADVANCED') === 5 && tierN('EXPERT') === 5, '5 ADVANCED + 5 EXPERT');
    assert(cat.every(s => typeof s.factors === 'object'), 'every meta exposes difficulty factors §32');
    assert(cat.every(s => s.factors.faultCount >= 1 && s.factors.pathLength >= 2), 'factors well-formed');
    assert(cat.every(s => !('faults' in s)), 'catalog metadata leaks no answers');
    const sumBy = (d, k) => cat.filter(s => s.difficulty === d).reduce((a, s) => a + s.factors[k], 0);
    assert(sumBy('EXPERT', 'faultCount') > sumBy('BEGINNER', 'faultCount'), 'EXPERT >= BEGINNER fault count (monotonic)');
    assert(sumBy('EXPERT', 'ambiguity') > sumBy('BEGINNER', 'ambiguity'), 'EXPERT symptoms more ambiguous §32');
    assert(sumBy('EXPERT', 'pathLength') > sumBy('BEGINNER', 'pathLength'), 'EXPERT longer diagnostic path §32');
    assert(cat.filter(s => s.difficulty === 'EXPERT').some(s => s.factors.hasInteraction), 'EXPERT includes interaction faults');
    const expOnly = cat.filter(s => s.difficulty === 'EXPERT');
    assert(expOnly.some(s => s.factors.intermittency) && expOnly.some(s => s.factors.progression), 'EXPERT covers intermittency + progression');

    // Semua id bisa dimuat + semua expectedSymptoms sah (id SYMPTOM_DEFS)
    let allLoaded = true;
    cat.forEach(s => { if (P7('loadScenario')(s.id).ok !== true) allLoaded = false; });
    assert(allLoaded, 'all 20 cases loadable');
    assert(P7('loadScenario')('SC_OPEN_FUSE').ok === true, 'SC_OPEN_FUSE loadable');
    assert(getVal('Sim.fuseState') === 'OPEN', `SC_OPEN_FUSE live: fuseState OPEN (${getVal('Sim.fuseState')})`);
    assert(P7('loadScenario')('SC_STARTER_MOTOR').ok === true, 'SC_STARTER_MOTOR loadable');
    assert(getVal('Sim.starterMotorFault') === true, 'SC_STARTER_MOTOR live: motor fault set');
    cat.forEach(s => {
        (s.expectedSymptoms || []).forEach(sym => {
            if (!P7('getSymptom')(sym)) allLoaded = false;
        });
    });
    assert(allLoaded, 'every expected symptom is a known SYMPTOM_DEFS id');
    assert(P7('loadScenario')('SC_TRIPLE_WEAK_GROUND_LOOSE').ok === true, 'EXPERT triple-fault loadable');
    assert(P7('getScenarioAnswer')('SC_TRIPLE_WEAK_GROUND_LOOSE').faults.length === 3, 'answer has 3 faults (no leak issue on load)');
    assert(P7('loadScenario')('SC_QUAD_EXPERT').ok === true, 'EXPERT quad-fault loadable');
    assert(P7('getScenarioAnswer')('SC_QUAD_EXPERT').faults.length === 4, 'quad answer 4 faults');
    assert(near(getVal('Sim.batteryVoltage'), 12.9 - (12.9 - 10.8) * 0.4, 0.05), `quad profile C weak .4 -> ${getVal('Sim.batteryVoltage')}V`);
    assert(P7('getScenarioAnswer')('SC_WEAK_BATTERY').faults[0].faultId === 'FAULT_BATTERY_WEAK', 'legacy id SC_WEAK_BATTERY preserved');
    assert(P7('listScenarios()').find(s => s.id === 'SC_OPEN_FUSE').difficulty === 'BEGINNER', 'SC_OPEN_FUSE tier BEGINNER');
    assert(P7('listScenarios()').find(s => s.id === 'SC_TRIPLE_WEAK_GROUND_LOOSE').difficulty === 'EXPERT', 'new EXPERT tier recognized');
    call('clearScenario');

    console.log('\n==================================');
    console.log(`PHASE 7 FAULT ENGINE: ${passed} passed, ${failed} failed`);
    console.log('==================================');
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('Unhandled:', e); process.exit(1); });