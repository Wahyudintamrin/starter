/* Standalone test harness for Phase 3 (Virtual Multimeter Lab).

   Loads app.js THEN realtimeParameter.js THEN multimeter.js in a Node vm sandbox with a
   richer DOM mock (canvas 2D, timeline, SVG measurement dots, lab elements),
   then runs Phase 3 acceptance tests 01-12 plus API checks. */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const phase2Js = fs.readFileSync(path.join(ROOT, 'realtimeParameter.js'), 'utf8');
const phase3Js = fs.readFileSync(path.join(ROOT, 'multimeter.js'), 'utf8');

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

// Pre-create all $('id') element references used in all three files
const idsInJs = [...appJs.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1])
    .concat([...phase2Js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]))
    .concat([...phase3Js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
for (const id of idsInJs) makeEl(id);

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

/* ---------------- Deterministic random ---------------- */
Math.random = () => 0.05; // always < engineStartChance -> engine starts

/* ---------------- Boot all three in vm ---------------- */
const context = vm.createContext({
    document,
    localStorage: localStorageMock,
    console,
    Math,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: () => 0,   // never fires; tests drive Phase2.step()
    cancelAnimationFrame: () => {},
    window: null,
});

context.window = context;

vm.runInContext(appJs, context, { filename: 'app.js' });
vm.runInContext(phase2Js, context, { filename: 'realtimeParameter.js' });
vm.runInContext(phase3Js, context, { filename: 'multimeter.js' });

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

const P2 = expr => getVal('Phase2.' + expr);
const P3 = expr => getVal('Phase3.' + expr);

async function main() {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const mutate = (expr, val) => vm.runInContext(`Sim.${expr} = ${JSON.stringify(val)}`, context);
    const S = getVal;

    function m(probe, node) {
        return vm.runInContext(`Phase3.attachProbe(${JSON.stringify(probe)}, ${JSON.stringify(node)})`, context);
    }

    // Drive the real state machine into CRANKING then return.
    // Optional setup callback runs AFTER reset (mutations survive reset).
    async function crankToCranking(setup) {
        call('resetSimulation');
        if (setup) setup();
        call('setIgnition', 'ON');
        await wait(60);
        call('setIgnition', 'START');
        await wait(300);   // relay
        await wait(350);   // solenoid
        await wait(1200);  // pinion + last pinion
        assert(S('Sim.starterState') === 'CRANKING', 'starter CRANKING for measurement session');
    }

    console.log('=== PHASE 3 - VIRTUAL MULTIMETER TESTS ===');

    // ---- 01. Battery voltage ----
    console.log('\n01: BATTERY VOLTAGE MEASUREMENT');
    call('resetSimulation');
    call('Phase3.openLab');
    call('Phase3.setMode', 'V');
    m('red', 'batteryPositive');
    m('black', 'batteryNegative');
    const vBat = P3('measure()');
    assert(!!vBat && typeof vBat.value === 'number', 'measure() returns a reading object');
    assert(Math.abs(vBat.value - 12.6) < 0.2, 'battery V = ~12.6 (got ' + vBat.value + ')');
    assert(P3('getReading().unit') === 'V DC', 'unit is V DC');

    // ---- 02. Reverse polarity ----
    console.log('\n02: REVERSE POLARITY => NEGATIVE READING');
    call('Phase3.resetMultimeter');
    m('red', 'batteryNegative');
    m('black', 'batteryPositive');
    const rev = P3('measure()');
    assert(rev.value < 0, 'reverse polarity gives negative value (' + rev.value + ')');

    // ---- 03. Same node => 0 V ----
    console.log('\n03: SAME NODE => 0 V');
    call('Phase3.resetMultimeter');
    m('red', 'batteryPositive');
    m('black', 'batteryPositive');
    const same = P3('measure()');
    assert(same.value === 0, 'same node reads 0V');

    // ---- 04. Weak battery affects reading ----
    console.log('\n04: WEAK BATTERY SHOWN BY READING');
    call('resetSimulation');
    mutate('batteryCondition', 'WEAK');
    mutate('batteryVoltage', 12.0);
    call('Phase3.setMode', 'V');
    m('red', 'batteryPositive');
    m('black', 'batteryNegative');
    const weak = P3('measure()');
    assert(Math.abs(weak.value - 12.0) < 0.3, 'weak battery reads ~12.0V (got ' + weak.value + ')');
    call('resetSimulation');

    // ---- 05. Fuse continuity (beep) ----
    console.log('\n05: FUSE CONTINUITY');
    call('Phase3.resetMultimeter');
    call('Phase3.setMode', 'CONT');
    m('red', 'fuseInput');
    m('black', 'fuseOutput');
    const cont = P3('measure()');
    assert(cont.ok === true, 'good fuse => CONTINUITY (ok=true)');
    // open fuse -> OL
    mutate('fuseState', 'OPEN');
    const openCont = P3('measure()');
    assert(openCont.ol === true && openCont.ok === false, 'open fuse => OL (no continuity)');
    mutate('fuseState', 'GOOD');

    // ---- 06. Resistance safety (OHM while energized) ----
    console.log('\n06: SAFETY — OHM BLOCKED WHILE ENERGIZED');
    call('Phase3.resetMultimeter');
    call('Phase3.setMode', 'OHM');
    m('red', 'relayInput');
    m('black', 'relayGround');
    call('setIgnition', 'ON');
    await wait(50);
    const beforeBlock = P3('getHistory().length');
    const blocked = P3('measure()');
    assert(blocked === null, 'measure() returns null while blocked');
    assert(P3('isSafetyBlocked()') === true, 'safetyBlocked flag raised');
    assert(P3('getHistory().length') === beforeBlock, 'blocked reading NOT recorded in history');
    // confirm safety -> shuts system down, measure proceeds
    call('Phase3.confirmSafety');
    await wait(60);
    assert(S('Sim.ignitionState') === 'OFF', 'confirmSafety powers the system down');
    assert(P3('getHistory().length') === beforeBlock + 1, 'measurement recorded after power down');
    const coil = P3('getHistory()[0].value');
    assert(Math.abs(coil - 3.2) < 0.4, 'relay coil ~3.2Ω after power down (got ' + coil + ')');
    call('resetSimulation');

    // ---- API checks ----
    console.log('\nAPI: getMeasurementResult / getNodeState / mode A / open cable OL');
    const res = call('Phase3.getMeasurementResult', 'TEST-X', 'batteryPositive', 'batteryNegative');
    assert(res.test === 'TEST-X' && typeof res.value === 'number', 'getMeasurementResult computes value');
    const ns = call('Phase3.getNodeState', 'batteryPositive');
    assert(typeof ns.voltage === 'number' && ns.energized === (ns.voltage > 0.5), 'getNodeState returns node info');
    call('Phase3.setMode', 'A');
    m('red', 'batteryPositive');
    m('black', 'batteryNegative');
    const amp = P3('getExpectedValue("A", "batteryPositive", "batteryNegative")');
    assert(amp === 0, 'mode A: current 0 when not cranking');
    // open cable -> OL resistance on positive cable
    mutate('cableState', 'OPEN');
    call('Phase3.setMode', 'OHM');
    m('red', 'starterPositive');
    m('black', 'solenoidMain');
    const olCable = P3('getExpectedValue("OHM", "starterPositive", "solenoidMain")');
    assert(olCable === null, 'open positive cable => OL resistance');
    mutate('cableState', 'GOOD');
    call('resetSimulation');

    // ---- Guided practices ----
    console.log('\nPRACTICES: LIST + BATTERY VOLTAGE COMPLETION');
    const practices = P3('getPractices()');
    assert(practices.length === 8, '8 guided practices defined');
    call('Phase3.resetMultimeter');
    call('Phase3.startPractice', 0);
    call('Phase3.setMode', 'V');
    m('red', 'batteryPositive');
    m('black', 'batteryNegative');
    const pracMeasure = P3('measure()');
    assert(!!pracMeasure, 'battery voltage practice measure ok');
    await wait(20);
    const doneBattery = getVal('Phase3.getPractices().filter(function(p){return p.id==="batvolt";})[0].done');
    assert(doneBattery === true, 'battery voltage practice completed (done=true)');
    assert(P3('score().procedure') >= 4, 'procedure score >= 4 after practice');
    call('Phase3.resetMultimeter');

    // ---- 09/10. Live measurement during START (history records) ----
    console.log('\n09/10: LIVE MEASUREMENT DURING START + HISTORY ACCUMULATION');
    const histBefore = P3('getHistory().length');
    call('Phase3.setMode', 'V');
    m('red', 'batteryPositive');
    m('black', 'batteryNegative');
    await crankToCranking();
    const live1 = P3('measure()');
    const live2 = P3('measure()');
    const live3 = P3('measure()');
    assert(live1.value < 12.5, 'live battery reading reflects sag during cranking (' + live1.value + 'V)');
    assert(P3('getHistory().length') === histBefore + 3, '3 measurements recorded in history during START');

    // ---- 07. Positive voltage drop during cranking ----
    console.log('\n07: POSITIVE VOLTAGE DROP');
    call('Phase3.setMode', 'DROP');
    m('red', 'batteryPositive');
    m('black', 'starterPositive');
    const dropPos = P3('measure()');
    assert(dropPos.value > 0.15 && dropPos.value < 0.30, 'positive drop ~0.22V during cranking (got ' + dropPos.value + ')');

    // ---- 08a. Ground drop normal ----
    console.log('\n08: GROUND VOLTAGE DROP (normal vs poor)');
    call('Phase3.setMode', 'DROP');
    m('red', 'starterGround');
    m('black', 'batteryNegative');
    const dropGndNormal = P3('measure()');
    assert(dropGndNormal.value > 0.1 && dropGndNormal.value < 0.3, 'normal ground drop ~0.2V (got ' + dropGndNormal.value + ')');

    // Starter voltage during cranking (diagnostic value check)
    call('Phase3.setMode', 'V');
    m('red', 'starterPositive');
    m('black', 'batteryNegative');
    const vStart = P3('measure()');
    assert(vStart.value > 11.0 && vStart.value < 12.0, 'starter M voltage ~11.45V during cranking (got ' + vStart.value + ')');

    // ---- 08b. Poor ground -> elevated ground drop ----
await wait(900);
    call('Phase3.resetMultimeter');
    await crankToCranking(() => { vm.runInContext("Sim.groundCondition = 'POOR'", context); });
    assert(S('Sim.groundCondition') === 'POOR', 'poor ground active in session');
    call('Phase3.setMode', 'DROP');
    m('red', 'starterGround');
    m('black', 'batteryNegative');
    const dropGndPoor = P3('measure()');
    assert(dropGndPoor.value > 0.5, 'poor ground drop elevated (>0.5V, got ' + dropGndPoor.value + ')');
    call('resetSimulation');

    // ---- 11. Worksheet recorded ----
    console.log('\n11: WORKSHEET RECORDS MEASUREMENT');
    assert(P3('getWorksheet().length') > 0, 'worksheet has entries');
    const lastWs = P3('getWorksheet()[0]');
    assert(typeof lastWs.test === 'string' && lastWs.redProbe && lastWs.raw !== undefined, 'worksheet entry structure complete');

    // ---- 12. Reset multimeter ----
    console.log('\n12: RESET MULTIMETER');
    call('Phase3.resetMultimeter');
    assert(P3('getHistory().length') === 0, 'history cleared');
    assert(P3('getWorksheet().length') === 0, 'worksheet cleared');
    assert(P3('getRecords().length') === 0, 'phase4 records cleared');
    assert(P3('isSafetyBlocked()') === false, 'safety flag cleared');
    assert(P3('getReading()') === null || P3('getReading()').text === '0.00', 'reading reset');

    // Phase 4 record structure (captured earlier)
    call('Phase3.resetMultimeter');
    call('Phase3.setMode', 'V');
    m('red', 'batteryPositive');
    m('black', 'batteryNegative');
    const r4 = P3('measure()');
    const rec = call('Phase3.getRecords', null)[0];
    assert(!!rec && rec.test !== undefined && rec.redProbe === 'batteryPositive'
        && rec.blackProbe === 'batteryNegative' && typeof rec.value === 'number'
        && typeof rec.timestamp === 'number' && rec.unit === 'V DC',
        'Phase 4 record structure: { test, redProbe, blackProbe, value, unit, timestamp }');

    call('Phase3.closeLab');
    await wait(50);

    console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('TEST CRASH: ' + (e.stack || e.message)); process.exit(1); });