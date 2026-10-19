/* Standalone acceptance test harness for app.js
   Uses Node vm module to sandbox the browser script with a minimal DOM mock,
   then runs acceptance tests from section 46 of the MASTER PROMPT. */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

/* ---------------- Minimal DOM mock ---------------- */
const elementCache = {};
let elementSeq = 0;

function makeEl(id) {
    const el = {
        id: id || null,
        style: { display: '', width: '', background: '', stroke: '', animationDuration: '' },
        dataset: {},
        children: [],
        textContent: '',
        innerHTML: '',
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
    };
    elementCache[id || ('el-' + (++elementSeq))] = el;
    return el;
}

// Pre-create all $('id') element references used in app.js
const idsInJs = [...appJs.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
for (const id of idsInJs) makeEl(id);

// Structural selectors used by querySelectorAll
const selectors = {
    '.status-row': [0, 1, 2, 3, 4].map(i => makeEl('row-' + i)),
    '.positive-wire': ['pw1', 'pw2', 'pw3'].map(i => makeEl(i)),
    '.thick-wire': ['tw1', 'tw2'].map(i => makeEl(i)),
    '.ground-wire': ['gw1', 'gw2'].map(i => makeEl(i)),
    '.component': ['c1', 'c2'].map(i => makeEl(i)),
    '.fault-check': ['fc1', 'fc2'].map(i => makeEl(i)),
    '.ignition-position': [],
};

const document = {
    getElementById(id) {
        return elementCache[id] || (elementCache[id] = makeEl(id));
    },
    querySelector() { return null; },
    querySelectorAll(sel) { return selectors[sel] || []; },
    createElement() { return makeEl('created-' + (++elementSeq)); },
    addEventListener(type, fn) { if (type === 'DOMContentLoaded') document._ready = fn; },
};

const localStorageMock = {
    _data: {},
    getItem(k) { return k in this._data ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
};

/* ---------------- Deterministic random ---------------- */
let forcedRandoms = null;
let forcedIdx = 0;
Math.random = () => {
    if (forcedRandoms && forcedIdx < forcedRandoms.length) {
        return forcedRandoms[forcedIdx++];
    }
    return 0.05; // default: always < engineStartChance so engine starts
};

/* ---------------- Boot app.js in vm ---------------- */
const context = vm.createContext({
    document,
    localStorage: localStorageMock,
    console,
    Math,
    setTimeout,
    clearTimeout,
});
context.window = context;

vm.runInContext(appJs, context, { filename: 'app.js' });

// Call the DOMContentLoaded callback
if (document._ready) document._ready();

function get(expr) { return vm.runInContext(expr, context); }
function call(fname, ...args) {
    return vm.runInContext(`${fname}(${args.map(a => JSON.stringify(a)).join(',')})`, context);
}

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { passed++; console.log('  PASS: ' + msg); }
    else { failed++; console.log('  FAIL: ' + msg); }
}

/* ---------------- Acceptance tests ---------------- */
async function main() {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const S = get; // S('Sim.ignitionState')
    const mutate = (expr, val) => vm.runInContext(`Sim.${expr} = ${JSON.stringify(val)}`, context);

    console.log('=== STARTER SYSTEM SIMULATOR - ACCEPTANCE TESTS ===');

    // ---- TEST 1: OFF -> ON -> START normal ----
    console.log('\nTEST 1: OFF -> ON -> START (normal)');
    call('resetSimulation');
    assert(get('Sim.ignitionState') === 'OFF', 'starts at OFF');
    call('setIgnition', 'ON');
    await wait(50);
    assert(get('Sim.ignitionState') === 'ON', 'ignition ON');

    forcedRandoms = null; // default -> engine start success
    call('setIgnition', 'START');
    await wait(350);
    assert(get('Sim.relayState') === 'ACTIVE', 'Relay ACTIVE');
    await wait(500);
    assert(get('Sim.solenoidState') === 'ACTIVE', 'Solenoid ACTIVE');
    await wait(600);
    assert(get('Sim.pinionEngaged') === true, 'Pinion ENGAGED');
    await wait(1400);
    assert(get('Sim.starterState') === 'CRANKING', 'Starter CRANKING');
    assert(get('Sim.starterRPM') > 180, 'Starter RPM ~220');
    await wait(2400);
    assert(get('Sim.engineState') === 'RUNNING', 'Engine RUNNING');
    assert(get('Sim.engineRPM') > 700, 'Engine ~800 RPM');
    assert(get('Sim.starterState') === 'OFF', 'Starter released after engine start');

    // ---- TEST 2: Weak battery -> fail start ----
    console.log('\nTEST 2: WEAK BATTERY');
    call('resetSimulation');
    mutate('batteryCondition', 'WEAK');
    mutate('batteryVoltage', 11.8);
    forcedRandoms = [0.99, 0.99, 0.99];
    forcedIdx = 0;
    call('setIgnition', 'START');
    await wait(3300);
    assert(get('Sim.starterRPM') < 200, 'Starter RPM reduced (<200)');
    assert(get('Sim.engineState') === 'CRANKING', 'Engine fails to start (keeps cranking)');

    // ---- TEST 3: Open fuse ----
    console.log('\nTEST 3: OPEN FUSE');
    call('resetSimulation');
    mutate('fuseState', 'OPEN');
    call('setIgnition', 'START');
    await wait(500);
    assert(get('Sim.relayState') === 'OFF', 'Relay OFF');
    assert(get('Sim.solenoidState') === 'OFF', 'Solenoid OFF');
    assert(get('Sim.starterState') === 'OFF', 'Starter OFF');
    assert(get('Sim.engineState') === 'OFF', 'Engine OFF');

    // ---- TEST 4: Relay failure ----
    console.log('\nTEST 4: RELAY FAILURE');
    call('resetSimulation');
    mutate('relayFail', true);
    call('setIgnition', 'START');
    await wait(500);
    assert(get('Sim.relayState') === 'OFF', 'Relay OFF');
    assert(get('Sim.solenoidState') === 'OFF', 'Solenoid OFF');
    assert(get('Sim.starterState') === 'OFF', 'Starter OFF');

    // ---- TEST 5: Poor ground ----
    console.log('\nTEST 5: POOR GROUND');
    call('resetSimulation');
    mutate('groundCondition', 'POOR');
    call('setIgnition', 'START');
    await wait(350);
    assert(get('Sim.relayState') === 'ACTIVE', 'Relay still ACTIVE with poor ground');
    await wait(3300);
    assert(get('Sim.starterRPM') < 200, 'Starter RPM reduced by poor ground');

    // ---- TEST 6: Starter motor failure ----
    console.log('\nTEST 6: STARTER MOTOR FAILURE');
    call('resetSimulation');
    mutate('starterMotorFault', true);
    call('setIgnition', 'START');
    await wait(350);
    assert(get('Sim.relayState') === 'ACTIVE', 'Relay ACTIVE');
    await wait(500);
    assert(get('Sim.solenoidState') === 'ACTIVE', 'Solenoid ACTIVE');
    await wait(600);
    assert(get('Sim.pinionEngaged') === true, 'Pinion ENGAGED');
    await wait(1400);
    assert(get('Sim.starterState') === 'OFF', 'Starter motor NOT rotating');
    assert(get('Sim.starterRPM') === 0, 'Starter RPM 0');
    assert(get('Sim.engineState') === 'OFF', 'Engine OFF');

    // ---- Release START mid-crank: system must disengage ----
    console.log('\nTEST: RELEASE START MID-CRANK');
    call('resetSimulation');
    call('setIgnition', 'START');
    await wait(800); // pinion may be engaged
    call('setIgnition', 'ON');
    await wait(300);
    assert(get('Sim.relayState') === 'OFF', 'relay disengages on release');
    assert(get('Sim.solenoidState') === 'OFF', 'solenoid disengages on release');
    assert(get('Sim.pinionEngaged') === false, 'pinion disengages on release');
    assert(get('Sim.starterState') === 'OFF', 'starter stops on release');
    assert(get('Sim.engineState') === 'OFF', 'engine OFF on release');

    // ---- Reset restores everything ----
    console.log('\nTEST: RESET');
    call('resetSimulation');
    assert(get('Sim.ignitionState') === 'OFF', 'ignition OFF after reset');
    assert(get('Sim.batteryCondition') === 'GOOD', 'battery GOOD');
    assert(get('Sim.fuseState') === 'GOOD', 'fuse GOOD');
    assert(get('Sim.groundCondition') === 'GOOD', 'ground GOOD');
    assert(get('Sim.starterMotorFault') === false, 'motor fault cleared');
    assert(get('Sim.activeFaults.length') === 0, 'no active faults');
    assert(get('Sim.engineState') === 'OFF', 'engine OFF');

    console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('TEST CRASH: ' + (e.stack || e.message)); process.exit(1); });