/* Standalone test harness for Phase 2 (parameter & visualization).

   Loads app.js THEN realtimeParameter.js in a Node vm sandbox with a richer DOM mock
   (canvas 2D context, timeline elements, body, rAF stub), then runs
   phase-2 acceptance tests (A-I) plus Phase 3 API checks. */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const phase2Js = fs.readFileSync(path.join(ROOT, 'realtimeParameter.js'), 'utf8');

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
        style: { display: '', width: '', background: '', stroke: '', animationDuration: '', transform: '' },
        dataset: {},
        children: [],
        textContent: '',
        innerHTML: '',
        className: '',
        checked: false,
        disabled: false,
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

// Pre-create all $('id') element references used in app.js + realtimeParameter.js
const idsInJs = [...appJs.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1])
    .concat([...phase2Js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
for (const id of idsInJs) makeEl(id);

// Timeline track element
const timelineEl = makeEl('timeline-track');
for (const step of ['rest', 'ign', 'relay', 'sol', 'pinion', 'crank', 'run']) {
    const seg = makeEl('timeline-seg-' + step);
    seg.setAttribute('data-step', step);
    timelineEl.children.push(seg);
}
timelineEl.p2Children = timelineEl.children;

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
};

let domReady = [];
const document = {
    body,
    getElementById(id) {
        return elementCache[id] || (elementCache[id] = makeEl(id));
    },
    querySelector(sel) {
        if (sel === '.timeline-track') return timelineEl;
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

/* ---------------- Deterministic random ---------------- */
Math.random = () => 0.05; // always < engineStartChance -> engine starts

/* ---------------- Boot app.js + realtimeParameter.js in vm ---------------- */
const context = vm.createContext({
    document,
    localStorage: localStorageMock,
    console,
    Math,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 0,   // never fires; tests drive Phase2.step()
    cancelAnimationFrame: () => {},
    window: null,
});

context.window = context;

vm.runInContext(appJs, context, { filename: 'app.js' });
vm.runInContext(phase2Js, context, { filename: 'realtimeParameter.js' });

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

const P = expr => getVal('Phase2.' + expr);   // Phase2.<expr>

/* ---------------- helpers ---------------- */
async function main() {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const mutate = (expr, val) => vm.runInContext(`Sim.${expr} = ${JSON.stringify(val)}`, context);
    const S = getVal;

    // Run several manual simulation steps (rAF is stubbed).
    // Returns the number of remaining steps (0 after ~10 x 100ms).
    function drive(steps) {
        for (let i = 0; i < (steps || 12); i++) {
            vm.runInContext('Phase2.step(100)', context);
        }
    }

    console.log('=== PHASE 2 - PARAMETER & VISUALISASI TESTS ===');

    // ---- A. Normal start: parameters correct ----
    console.log('\nA: NORMAL START (parameter & voltage sag)');
    call('resetSimulation');
    call('setIgnition', 'ON');
    await wait(50);
    call('setIgnition', 'START');
    await wait(350);
    assert(S('Sim.relayState') === 'ACTIVE', 'Relay ACTIVE');
    assert(P('getCurrentAtPath("control")') === 4, 'Control-circuit current = relay coil (4A)');
    await wait(500);
    assert(S('Sim.solenoidState') === 'ACTIVE', 'Solenoid ACTIVE');
    await wait(600);
    assert(S('Sim.pinionEngaged') === true, 'Pinion ENGAGED');
    await wait(1500);
    assert(S('Sim.starterState') === 'CRANKING', 'Starter CRANKING');
    assert(S('Sim.starterRPM') > 180, 'Starter RPM ~220 (Sim)');
    assert(S('Sim.starterCurrent') > 150, 'Starter current > 150A (in 150-250A band)');

    // Voltage sag model: OCV > batteryPositive > starterPositive > 0
    const ocv = S('Sim.batteryVoltage');
    const vb = P('getVoltageAtNode("batteryPositive")');
    const vs = P('getVoltageAtNode("starterPositive")');
    const vg = P('getVoltageAtNode("starterGround")');
    assert(ocv > vb && vb > vs && vs > 0, 'Voltage sag: OCV > battery+ > starter+ > 0');
    assert(Math.abs(vb - (ocv - 185 * 0.005)) < 0.02, 'battery+ = OCV - I*R_internal');
    assert(Math.abs(vs - vb + 185 * 0.0012) < 0.02, 'starter+ = battery+ - cable drop');
    assert(vg > 0.1 && vg < 0.3, 'ground drop normal ~0.2V');
    const dropCable = P('calculateVoltageDrop("batteryPositive","starterPositive")');
    assert(Math.abs(dropCable - 0.222) < 0.05, 'calculateVoltageDrop(cable) ~0.22V');

    // Path current + component state + system state API
    assert(P('getCurrentAtPath("starter")') > 150, 'starter path current > 150A');
    const comp = getVal('Phase2.getComponentState("starter")');
    assert(comp.state === 'CRANKING' && comp.rpm > 180 && comp.current > 150, 'getComponentState(starter)');
    assert(P('getSystemState()') === 'STARTER_CRANKING', 'getSystemState() == STARTER_CRANKING');

    // Smoothing via step() converges to Sim model targets
    drive(12);
    assert(P('D.starterCurrent') > 180, 'D.starterCurrent smoothed toward ~185A');
    assert(P('D.starterRPM') > 200, 'D.starterRPM smoothed toward ~220');
    assert(P('D.batteryVoltage') < ocv && P('D.batteryVoltage') > 10, 'D.batteryVoltage reflects sag');

    // Timeline highlight
    const crankSeg = timelineEl.children[5];
    assert(crankSeg.classList.contains('active'), 'timeline "CRANK" segment active while cranking');

    // Let engine start
    await wait(2400);
    assert(S('Sim.engineState') === 'RUNNING', 'Engine RUNNING');
    assert(S('Sim.engineRPM') > 700, 'Engine ~800 RPM');
    drive(12);
    assert(P('D.engineRPM') > 700, 'Tach/D.engineRPM rises with engine');
    assert(S('Sim.starterState') === 'OFF', 'Starter released after engine start');
    assert(S('Sim.starterCurrent') === 0, 'Starter current zero at idle');
    assert(P('getCurrentAtPath("starter")') === 0, 'starter path current 0 at engine running');
    assert(P('getCurrentAtPath("main")') === 0, 'main path current 0 at engine running');

    // ---- B. Release START -> engine keeps running ----
    console.log('\nB: RELEASE START (return to ON keeps engine running)');
    call('setIgnition', 'ON');
    await wait(300);
    assert(S('Sim.ignitionState') === 'ON', 'Ignition returns to ON');
    assert(S('Sim.engineState') === 'RUNNING', 'Engine keeps RUNNING after releasing START');

    // ---- C. Weak battery ----
    console.log('\nC: WEAK BATTERY');
    call('resetSimulation');
    mutate('batteryCondition', 'WEAK');
    mutate('batteryVoltage', 12.0);
    call('setIgnition', 'START');
    await wait(350);
    await wait(500);
    await wait(600);
    await wait(1400);
    assert(S('Sim.starterState') === 'CRANKING', 'Still cranking');
    assert(S('Sim.starterRPM') > 100 && S('Sim.starterRPM') < 200, 'Starter RPM reduced (<200)');
    const weakVs = P('getVoltageAtNode("starterPositive")');
    assert(weakVs < 11.5, 'weak battery -> lower starter positive voltage (<11.5V)');
    assert(P('getComponentState("battery").state') === 'WEAK', 'getComponentState(battery).state == WEAK');

    // ---- D. Open fuse ----
    console.log('\nD: OPEN FUSE (current stops at fault)');
    call('resetSimulation');
    const openFuseEl = makeEl('fault-check-od1');
    openFuseEl.dataset.fault = 'openFuse';
    selectors['.fault-check:checked'] = [openFuseEl];
    call('applyFaults');
    selectors['.fault-check:checked'] = [];
    assert(S('Sim.fuseState') === 'OPEN', 'fuseState OPEN after Apply Fault');
    assert(S('Sim.activeFaults[0]') === 'openFuse', 'getActiveFault -> openFuse via Sim');
    assert(P('getActiveFault()') === 'openFuse', 'Phase2.getActiveFault() == openFuse');
    call('setIgnition', 'ON');
    await wait(50);
    assert(P('getVoltageAtNode("ignitionOutput")') === 0, 'ignitionOutput 0V past open fuse');
    assert(P('getVoltageAtNode("relayInput")') === 0, 'relayInput 0V');
    call('setIgnition', 'START');
    await wait(500);
    assert(S('Sim.relayState') === 'OFF', 'Relay OFF (control circuit open)');
    assert(S('Sim.starterState') === 'OFF', 'Starter OFF');
    assert(P('getComponentState("fuse").state') === 'OPEN', 'getComponentState(fuse) == OPEN');
    assert(P('getCurrentAtPath("control")') === 0 && P('getCurrentAtPath("main")') === 0,
        'no current flows on control/main paths (open fuse)');

    // ---- E. Poor ground ----
    console.log('\nE: POOR GROUND');
    call('resetSimulation');
    mutate('groundCondition', 'POOR');
    call('setIgnition', 'START');
    await wait(350);
    assert(S('Sim.relayState') === 'ACTIVE', 'Relay still ACTIVE');
    await wait(500);
    await wait(600);
    await wait(1400);
    assert(S('Sim.starterState') === 'CRANKING', 'Cranking');
    assert(S('Sim.starterRPM') < 200, 'Starter RPM reduced by poor ground');
    const poorGnd = P('getVoltageAtNode("starterGround")');
    assert(poorGnd > 0.5, 'starter ground drop elevated (>0.5V) with poor ground');
    const stableGnd = P('calculateVoltageDrop("starterGround","batteryNegative")');
    assert(stableGnd > 0.5, 'calculateVoltageDrop(ground) elevated (>0.5V)');
    assert(P('getComponentState("ground").drop') > 0.5, 'getComponentState(ground).drop > 0.5V');

    // ---- F. Starter motor failure ----
    console.log('\nF: STARTER MOTOR FAILURE');
    call('resetSimulation');
    mutate('starterMotorFault', true);
    call('setIgnition', 'START');
    await wait(350);
    assert(S('Sim.relayState') === 'ACTIVE', 'Relay ACTIVE');
    await wait(500);
    assert(S('Sim.solenoidState') === 'ACTIVE', 'Solenoid ACTIVE');
    await wait(600);
    assert(S('Sim.pinionEngaged') === true, 'Pinion ENGAGED');
    await wait(1400);
    assert(S('Sim.starterState') === 'OFF', 'Starter motor NOT rotating');
    assert(S('Sim.starterRPM') === 0, 'Starter RPM 0');
    assert(S('Sim.engineState') === 'OFF', 'Engine OFF');
    const starterComp = getVal('Phase2.getComponentState("starter")');
    assert(starterComp.state === 'OFF' && starterComp.rpm === 0 && starterComp.fault === true,
        'getComponentState(starter) faults');

    // ---- G. Current flow toggle ----
    console.log('\nG: CURRENT FLOW TOGGLE');
    call('resetSimulation');
    vm.runInContext('toggleCurrentFlow(false)', context);
    assert(S('currentFlowEnabled') === false, 'currentFlowEnabled false after OFF');
    const groupEl = getVal('document.getElementById("currentFlowGroup")');
    assert(groupEl.style.display === 'none', 'current flow group hidden');
    vm.runInContext('toggleCurrentFlow(true)', context);
    assert(S('currentFlowEnabled') === true, 'currentFlowEnabled true after ON');
    assert(groupEl.style.display === 'block', 'current flow group shown');

    // ---- H. Event log ----
    console.log('\nH: EVENT LOG');
    call('resetSimulation');
    // Re-enable flow toggle after reset (reset does not change it, but be safe)
    call('setIgnition', 'ON');
    await wait(50);
    call('setIgnition', 'START');
    await wait(250);
    // Apply a fault through the fault panel flow (UI path)
    const fc = makeEl('fault-check-ef1');
    fc.dataset.fault = 'openFuse';
    const fc2 = makeEl('fault-check-ef2');
    fc2.dataset.fault = 'poorGround';
    selectors['.fault-check:checked'] = [fc, fc2];
    call('applyFaults');
    selectors['.fault-check:checked'] = [];
    await wait(50);
    const logCount = P('_P2.eventLog.length');
    assert(logCount >= 4, 'event log populated (' + logCount + ' entries)');
    const logText = getVal('Phase2._P2.eventLog.map(function(e){return e.message;}).join("|")');
    assert(logText.indexOf('Ignition') >= 0, 'log contains ignition event');
    assert(logText.indexOf('Fault diterapkan') >= 0, 'log contains fault-applied event');
    assert(logText.indexOf('Sistem dimatikan') >= 0, 'log contains shutdown event');
    // Clear log
    call('Phase2.clearLog');
    assert(P('_P2.eventLog.length') === 0, 'clearLog empties event log');

    // ---- I. Reset ----
    console.log('\nI: RESET');
    const beforeResetGraph = P('_P2.graph.buffer.length');
    call('resetSimulation');
    assert(S('Sim.ignitionState') === 'OFF', 'ignition OFF after reset');
    assert(S('Sim.batteryCondition') === 'GOOD', 'battery GOOD');
    assert(S('Sim.fuseState') === 'GOOD', 'fuse GOOD');
    assert(S('Sim.groundCondition') === 'GOOD', 'ground GOOD');
    assert(S('Sim.activeFaults.length') === 0, 'no active faults');
    assert(P('getSystemState()') === 'OFF', 'systemState OFF');
    assert(P('_P2.graph.buffer.length') === 0, 'graph buffer cleared on reset');
    const resetLogText = getVal('Phase2._P2.eventLog.map(function(e){return e.message;}).join("|")');
    assert(resetLogText.indexOf('Simulasi direset') >= 0, 'log contains reset event');

    console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('TEST CRASH: ' + (e.stack || e.message)); process.exit(1); });