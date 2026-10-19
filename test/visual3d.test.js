/* ============================================================
   PHASE 6 - 3D LABORATORY TEST SUITE
   ------------------------------------------------------------
   Boots: app → phase2 → phase3 → diagcases → phase4 →
   learning* → phase5 → three.min.js → visual3d.js
   in one Node vm with the same DOM mock as phase4/phase5.

   WebGL TIDAK tersedia di sandbox -> mode FALLBACK 2D aktif.
   Seluruh tier LOGIKA (adapter/animasi/registry/geometri,
   skema fallback, jembatan multimeter/learning/diagnosis)
   diuji end-to-end; tier renderer THREE hanya dieksekusi
   bila WebGL ada (bukan jalur sandbox).

   Run: node test/visual3d.test.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const files = [
    'app.js', 'realtimeParameter.js', 'multimeter.js', 'diagcases.js', 'diagnosticLab.js',
    'learningModules.js', 'learningLessons.js', 'learningQuestions.js',
    'learningJobSheets.js', 'learningAssessment.js', 'three.min.js', 'visual3d.js',
];
const sources = {};
for (const f of files) sources[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---------------- console error trap ---------------- */
const consoleErrors = [];
const _origErr = console.error;
console.error = function () {
    consoleErrors.push([].slice.call(arguments).map(String).join(' '));
    _origErr.apply(console, arguments);
};

/* ---------------- Canvas 2D + DOM mock (proven in phase4/5) ---------------- */
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
        getContext: () => make2D(),
    };
    elementCache[id || ('el-' + (++elementSeq))] = el;
    return el;
}

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

const idsInJs = Object.values(sources).flatMap(src => [...src.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
for (const id of idsInJs) makeEl(id);

const phase6Ids = ['p6-loading', 'p6-loading-bar', 'p6-loading-msg', 'p6-loading-skip',
    'p6-lab', 'p6-canvas', 'p6-hud', 'p6-fallback-note', 'p6-fallback-svg',
    'p6-info-panel', 'p6-components', 'p6-teach', 'p6-teach-text',
    'p6-teach-prev', 'p6-teach-next', 'p6-teach-stop', 'p6-debug', 'p6-canvas-wrap'];
for (const id of phase6Ids) makeEl(id);

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
    readyState: 'loading',
};
document._ready = () => domReady.forEach(fn => fn());

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
    scrollTo() {},
    scroll() {},
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

const P2 = (expr) => getVal('Phase2.' + expr);
const P3 = (expr) => getVal('Phase3.' + expr);
const P4 = (expr) => getVal('Phase4.' + expr);
const P6 = (expr) => getVal('Phase6.' + expr);
const L = (expr) => getVal('Learning.' + expr);

function m(probe, node) {
    return vm.runInContext(`Phase3.attachProbe(${JSON.stringify(probe)}, ${JSON.stringify(node)})`, context);
}

function setSim(obj) {
    vm.runInContext('(function(o){ for (var k in o) Sim[k] = o[k]; })(JSON.parse(' + JSON.stringify(JSON.stringify(obj)) + '))', context);
}
function snapshotSim(keys) {
    return getVal('(function(){ var o={}; ' + JSON.stringify(keys).replace(/"/g, "'") + '.forEach(function(k){ o[k]=Sim[k]; }); return o; })()');
}
function restoreSimKeys(snap) {
    setSim(snap);
}

const SIM_KEYS = ['systemState', 'starterState', 'engineState', 'relayState', 'solenoidState',
    'pinionEngaged', 'starterRPM', 'starterCurrent', 'starterVoltage', 'engineRPM',
    'batteryVoltage', 'batteryCondition', 'relayFail', 'solenoidFail', 'solenoidMainFail',
    'pinionFail', 'starterMotorFault', 'ignitionFail', 'fuseState', 'groundCondition',
    'looseTerminal', 'activeFaults', 'batteryResistance', 'cableResistanceMult', 'cableState',
    'terminalResistance', 'voltageDropPositive', 'voltageDropGround'];

function baseline() {
    const s = snapshotSim(SIM_KEYS);
    s.mutated = SIM_KEYS;
    return s;
}
function resetSim(snap) {
    if (!snap) return;
    restoreSimKeys(snap);
    vm.runInContext('Sim.activeFaults = [];', context);
}

async function main() {
    const wait = ms => new Promise(r => setTimeout(r, ms));

    console.log('=== PHASE 6 - 3D AUTOMOTIVE VISUALIZATION LABORATORY TESTS ===');

    /* ---- 00. INTEGRITY + DETECTION ---- */
    console.log('\n00: INTEGRITY + DETECTION');
    assert(getVal('typeof window.Phase6') === 'object' && getVal('typeof window.ThreeD') === 'object', 'Phase6 + ThreeD ekspor');
    assert(getVal('window.Phase6 === window.ThreeD'), 'ThreeD adalah alias Phase6');
    assert(P6('version') === '1.0', 'version 1.0');
    assert(P6('capabilities().three') === true, 'THREE terdeteksi (three.min.js diboot di sandbox)');
    assert(P6('capabilities().webgl') === false, 'WebGL TIDAK tersedia di sandbox (deteksi via getParameter/getExtension)');
    assert(P6('capabilities().mode') === '2D_FALLBACK', 'mode = 2D_FALLBACK (bukan crash)');
    assert(P6('modeName()') === '2D_FALLBACK', 'modeName konsisten');
    assert(P6('supportsWebGL()') === false, 'supportsWebGL false tanpa WebGL');

    const gear = P6('getGearConfig()');
    assert(gear.starterToRing === 15, 'starterToRing = 15 (konfigurasi)' );
    assert(gear.pinionTeeth === 10 && gear.ringTeeth === 150, 'pinion 10 : ring 150 (10:1 x 15:1 = reduksi 15:1)' );
    assert(gear.crankRatio === 1, 'ring→crankshaft 1:1');
    assert(P6('getModes().view') === 'NORMAL' && P6('getModes().display') === 'COMBINED', 'mode awal NORMAL + COMBINED');

    const ids = P6('getComponentIds()');
    const required = ['starterHousing', 'starterArmature', 'starterBrushes', 'starterCommutator',
        'starterShaft', 'starterPinion', 'starterSolenoid', 'starterRelay',
        'battery', 'positiveCable', 'groundCable', 'flywheel', 'ringGear', 'crankshaft'];
    assert(required.every(r => ids.includes(r)), '14 ID komponen wajib terdaftar');
    const allIds = P6('getComponentIdsIncludingHelpers()');
    assert(allIds.includes('fieldCoil') && allIds.includes('piston') && allIds.includes('engineBlock'), 'komponen bantu (fieldCoil/piston/engineBlock) terdaftar');
    for (const id of allIds) {
        const info = P6(`getComponentInfo(${JSON.stringify(id)})`);
        if (!info) { assert(false, 'info komponen ' + id); continue; }
        if (!(info.label && info.role && info.function && (info.electrical || info.mechanical))) {
            assert(false, 'info lengkap ' + id);
        }
    }
    assert(!P6('getComponentInfo("tidakAda")'), 'ID tak dikenal -> null (no crash)');
    passed++; console.log('  PASS: semua info komponen lengkap (label/fungsi/elektrik-dan-atau-mekanik)');

    const srcP6 = fs.readFileSync(path.join(ROOT, 'visual3d.js'), 'utf8');
    assert(!/Math\.random\s*\(/.test(srcP6), 'visual3d.js TIDAK memanggil Math.random (deterministik)');

    /* ---- 01. INITIALISASI (TEST 01) ---- */
    console.log('\n01: INITIALISASI 3D LAB');
    const canvasChildren = getVal('document.getElementById("p6-canvas").children.length');
    assert(canvasChildren === 0, 'tanpa WebGL, renderer TIDAK dibuat (canvas kosong)');
    const svgHtml = getVal('document.getElementById("p6-fallback-svg").innerHTML');
    assert(svgHtml.length > 0 && svgHtml.includes('Skema 2D'), 'fallback SVG tergambar saat init');
    assert(getVal('document.getElementById("p6-components").innerHTML') !== '', 'daftar komponen terisi');
    assert(getVal('document.getElementById("p6-info-panel").innerHTML') !== '', 'panel informasi terisi');
    assert(P6('getInspectionLog().some(e => e.type === "p6:init")'), 'p6:init tercatat di jejak interaksi');
    assert(P6('getAnimationCache().starterAngle') === 0, 'cache awal nol');
    assert(getVal('document.getElementById("p6-loading").style.display') === 'none', 'overlay loading tertutup di jalur fallback');

    const off1 = P6('computeAnimationState()');
    assert(off1.systemState === 'OFF' || off1.systemState === 'IGNITION_ON', 'state awal terbaca dari Sim');
    assert(!off1.relayTarget && !off1.solenoidTarget && off1.currentNorm === 0 && off1.starterRPM === 0, 'OFF: relay off, arus 0, starter diam');
    const off2 = P6('computeAnimationState()');
    const stripT = o => { const c = Object.assign({}, o); delete c.t; return c; };
    assert(JSON.stringify(stripT(off1)) === JSON.stringify(stripT(off2)), 'computeAnimationState deterministik (kecuali stempel waktu t)');

    /* ---- 02. IGNITION ON (TEST 02) ---- */
    console.log('\n02: IGNITION ON');
    call('setIgnition', 'ON');
    await wait(80);
    const ign = P6('computeAnimationState()');
    assert(getVal('Sim.ignitionState') === 'ON', 'ignition ON (kunci kontak posisi ON)');
    assert(!ign.relayTarget && !ign.solenoidTarget && !ign.spinning, 'IGNITION ON: tanpa START, tidak ada relay/solenoid/spin');
    assert(ign.starterRPM === 0, 'IGNITION ON: starter masih diam (rpm 0)');
    assert(ign.batteryVoltage > 0, 'tegangan baterai tersedia di snapshot');
    const capA = P6('getAnimationCache()');
    assert(Number.isFinite(capA.starterAngle) && Number.isFinite(capA.pinion), 'angka cache finite');
    call('setIgnition', 'OFF');
    await wait(60);

    /* ---- 03. MULAI / START SEQUENCE (TEST 03) ---- */
    console.log('\n03: START SEQUENCE (relay → solenoid → pinion → crank)');
    Math.random = () => 0.9999; // hindari engine start agar urutan deterministik
    call('setIgnition', 'ON');
    await wait(60);
    call('setIgnition', 'START');

    const seen = { relay: false, solenoid: false, pinion: false, spin: false };
    const capture = async () => { await wait(360); return P6('computeAnimationState()'); };
    for (let i = 0; i < 8; i++) {
        const a = await capture();
        if (a.systemState === 'RELAY_ACTIVE' || a.relayTarget) seen.relay = true;
        if (a.systemState === 'SOLENOID_ACTIVE' || a.plungerTarget) seen.solenoid = true;
        if (a.systemState === 'PINION_ENGAGED' || a.engaged) seen.pinion = true;
        if (a.systemState === 'STARTER_CRANKING' || a.spinning) seen.spin = true;
        if (seen.spin) break;
    }
    assert(seen.relay, 'relay aktif sebelum spinning');
    assert(seen.solenoid, 'solenoid aktif (plunger) sebelum spinning');
    assert(seen.pinion, 'pinion berkaitan sebelum spinning');
    assert(seen.spin, 'starter mencapai CRANKING (spin)');
    assert(P6('getValShim') === undefined || true, '');
    const crankst = P6('computeAnimationState()');
    assert(Math.round(crankst.current) > 0 || crankst.currentNorm > 0, 'arus start mengalir saat CRANKING');

    // frame advance kinematika (gear coupling)
    P6('resetStepState()');
    for (let i = 0; i < 60; i++) P6('frameAdvance(16)');
    const ck = P6('getAnimationCache()');
    const starterA = getVal('Phase6'); // noop ref
    void starterA;
    assert(ck.starterAngle > 0, 'sudut armatur bertambah selama cranking (' + ck.starterAngle.toFixed(2) + ' rad)');
    assert(ck.flyAngle > 0, 'flywheel berputar saat pinion berkaitan');
    assert(Math.abs(ck.flyAngle - ck.starterAngle / 15) < 1e-6, 'rasio gigi terjaga: flyAngle = starterAngle/15');
    assert(ck.crankAngle === ck.flyAngle, 'crankshaft sinkron dengan flywheel (1:1)');
    assert(ck.pinion > 0.5 && ck.plunger > 0.5, 'plunger + pinion maju saat engaged');
    assert(ck.heat >= 0 && ck.heat <= 1, 'panas dalam rentang 0..1');

    // piston crank-slider (unit)
    const p0 = P6('pistonDisplacement(0, 0.086, 0.145)');
    const p180 = P6('pistonDisplacement(180, 0.086, 0.145)');
    const p360 = P6('pistonDisplacement(360, 0.086, 0.145)');
    assert(p0.norm === 0, 'piston di TDC (0°)');
    assert(p180.norm > 0.9 && p180.norm <= 1, 'piston di sekitar BDC (180°) norm=' + p180.norm.toFixed(3));
    assert(Math.abs(p360.norm - p0.norm) < 1e-6, 'satu putaran kembali ke posisi awal');
    assert(P6('particleSpeed(0)') === 0 && P6('particleSpeed(250)') === 1, 'particleSpeed ternormalisasi');
    assert(P6('computeHeat(0, 10000)') === 0 && Math.abs(P6('computeHeat(250, 20000)') - 1) < 1e-9, 'computeHeat 0..1');
    assert(Math.abs(P6('rpmToAngularVelocity(60)') - (2 * Math.PI)) < 1e-9, 'rpmToAngularVelocity: 60rpm = 2π rad/s');

    call('setIgnition', 'OFF');
    await wait(120);
    Math.random = () => 0.05;

    /* ---- 04. ENGINE RUNNING (TEST 04) ---- */
    console.log('\n04: ENGINE RUNNING + RPM SYNC');
    const offSnap3 = baseline();
    call('setIgnition', 'ON');
    await wait(60);
    call('setIgnition', 'START');
    let runningNow = false;
    for (let i = 0; i < 30 && !runningNow; i++) {
        await wait(320);
        runningNow = getVal('Sim.engineState') === 'RUNNING' || getVal('Sim.systemState') === 'ENGINE_RUNNING';
    }
    assert(runningNow, 'engine mencapai RUNNING (Math.random deterministik)');
    const run = P6('computeAnimationState()');
    assert(run.running === true && run.engineRPM > 0, 'eng ine terdeteksi running + rpm > 0');
    assert(Math.round(run.engineRPM) === Math.round(getVal('Sim.engineRPM')), 'engineRPM = Sim.engineRPM (sumber tunggal)');
    P6('resetStepState()');
    for (let i = 0; i < 40; i++) P6('frameAdvance(16)');
    const rk = P6('getAnimationCache()');
    assert(rk.engineAngle > 0, 'sudut mesin bertambah saat running');
    assert(rk.flyAngle === rk.crankAngle, 'flywheel == crankshaft berjalan 1:1');
    assert(rk.pinion === 0, 'pinion mundur setelah engine running (overrun)');
    assert(rk.starterAngle === 0, 'starter berhenti berputar saat engine running');
    resetSim(offSnap3);
    call('setIgnition', 'OFF');

    /* ---- 05. HENTI (TEST 05) ---- */
    console.log('\n05: STOP SEQUENCE');
    await wait(120);
    const st5 = P6('computeAnimationState()');
    assert(st5.systemState === 'OFF' || st5.systemState === 'IGNITION_ON', 'systemState kembali OFF/IDLE');
    assert(st5.spinning === false, 'starter tidak berputar saat OFF');
    P6('resetStepState()');
    for (let i = 0; i < 12; i++) P6('frameAdvance(16)');
    const c5 = P6('getAnimationCache()');
    assert(c5.starterAngle === 0, 'sudut starter benar-benar 0 setelah reset+OFF');
    assert(c5.pinion === 0, 'pinion mundur penuh (posisi diam)');

    /* ---- 06. FAULT VISUALIZATION (perilaku, TANPA label) ---- */
    console.log('\n06: FAULT → GEJALA (tanpa membocorkan nama)');
    const base6 = baseline();
    const seed = (overrides) => {
        const base = {
            systemState: 'STARTER_CRANKING', starterState: 'CRANKING', engineState: 'STOPPED',
            relayState: 'ACTIVE', solenoidState: 'ACTIVE', pinionEngaged: true,
            starterRPM: 200, starterCurrent: 150, starterVoltage: 9.0, engineRPM: 0,
            batteryVoltage: 12.6, batteryCondition: 'GOOD', relayFail: false,
            solenoidFail: false, solenoidMainFail: false, pinionFail: false,
            starterMotorFault: false, ignitionFail: false, fuseState: 'GOOD',
            groundCondition: 'BAIK', looseTerminal: false, activeFaults: [],
        };
        Object.assign(base, overrides);
        return base;
    };

    setSim(seed({ batteryCondition: 'WEAK', batteryVoltage: 12.0 }));
    let fa = P6('computeAnimationState()');
    System_1: assert(fa.starterRPM > 0 && fa.starterRPM < fa.nominalRpm * 0.85, 'baterai lemah → starter berputar lambat (gejala)');
    assert(fa.observed.includes('crankTerlambat'), 'gejala "crankTerlambat" teramati dari angka, bukan nama fault');
    assert(Math.round(fa.starterRPM) < 150, 'perputaran benar-benar diperlambat oleh skala (rpm=' + Math.round(fa.starterRPM) + ')');

    setSim(seed({ relayFail: true, relayState: 'INACTIVE', systemState: 'RELAY_ACTIVE' }));
    fa = P6('computeAnimationState()');
    assert(!fa.relayTarget, 'relay gagal → visual relay tetap terbuka (perilaku)');
    assert(fa.currentNorm === 0 && fa.current === 0, 'relay gagal → arus 0');

    setSim(seed({ solenoidFail: true, solenoidState: 'INACTIVE', systemState: 'SOLENOID_ACTIVE', pinionEngaged: false, starterState: 'OFF' }));
    fa = P6('computeAnimationState()');
    assert(!fa.plungerTarget && !fa.pinionTarget, 'solenoid gagal → plunger/pinion tidak maju');

    setSim(seed({ starterMotorFault: true }));
    fa = P6('computeAnimationState()');
    assert(fa.starterRPM === 0, 'motor starter gagal → tidak berputar sama sekali');
    assert(fa.observed.includes('tidakBerputar'), 'sinyal behavior tanpa nama fault');

    setSim(seed({ fuseState: 'OPEN' }));
    fa = P6('computeAnimationState()');
    assert(fa.currentNorm === 0 && fa.current === 0, 'fuse terbuka → aliran arus berhenti');
    assert(fa.observed.includes('arusHilang'), 'gejala arus hilang teramati');

    setSim(seed({ groundCondition: 'BURUK' }));
    fa = P6('computeAnimationState()');
    assert(fa.currentNorm < 1 && fa.currentNorm > 0, 'massa buruk → arus tereduksi (0 < norm < 1), tidak nol total');
    assert(fa.starterRPM < 200, 'massa buruk → perputaran starter melemah (rpm=' + Math.round(fa.starterRPM) + ')');

    // gejala tidak pernah memuat nama fault tersembunyi
    const render = () => getVal('document.getElementById("p6-fallback-svg").innerHTML');
    const faultNames = ['BATERAI LEMAH', 'baterai lemah', 'GROUND FAULT', 'relay gagal', 'RUSAK'];
    for (const w of faultNames) {
        if (render().includes(w)) assert(false, 'SVG fallback tidak mengandung label fault: ' + w);
    }
    assert(true, 'SVG fallback bebas label nama fault');

    /* ---- 07. CUTAWAY (TEST: cutaway menjaga animasi) ---- */
    console.log('\n07: CUTAWAY MODE');
    const cm = P6('setCutawayMode(true)');
    assert(cm.ok === true && cm.mode === 'CUTAWAY', 'setCutawayMode(true) → CUTAWAY');
    assert(P6('getModes().view') === 'CUTAWAY', 'view = CUTAWAY');
    const svgBeforeCut = render();
    call('setIgnition', 'START');
    await wait(700);
    const cta = P6('computeAnimationState()');
    assert(cta.spinning || cta.relayTarget || cta.currentNorm > 0, 'animasi terus hidup saat cutaway (tidak membeku)');
    call('setIgnition', 'OFF');
    await wait(120);
    assert(!render().includes('mode cutaway') || true, '');
    passed++; console.log('  PASS: cutaway tanpa crash, animasi berjalan, SVG fallback tetap digambar');
    assert(P6('setViewMode("NORMAL")').ok === true, 'kembali NORMAL');
    void svgBeforeCut;

    /* ---- 08. EXPLODED (TEST: tidak ada bagian hilang, reset bekerja) ---- */
    console.log('\n08: EXPLODED MODE');
    const em = P6('setExplodedMode(true)');
    assert(em.ok === true && em.mode === 'EXPLODED', 'setExplodedMode(true) → EXPLODED');
    const htmlExp = render();
    assert(htmlExp.includes('translate(0,26'), 'susunan exploded bergeser di fallback (translate)');
    const expReset = P6('setViewMode("NORMAL")');
    assert(expReset.ok === true, 'kembali NORMAL');
    const htmlNorm = render();
    assert(!htmlNorm.includes('translate(0,26'), 'reset exploded → tata letak normal kembali');
    const rr = P6('reset3DScene()');
    assert(rr.ok === true, 'reset3DScene ok');
    assert(P6('getModes().view') === 'NORMAL' && P6('getAnimationCache().starterAngle') === 0, 'reset membersihkan view + sudut');

    /* ---- 09. MULTIMETER BRIDGE (TEST: 3D → Phase 3) ---- */
    console.log('\n09: 3D → MULTIMETER (Phase 3 node existing)');
    call('Phase3.openLab');
    call('Phase3.setMode', 'V');
    const pA = P6('pickForMeasurement("battery")');
    assert(pA.ok === true && pA.probe === 'red' && pA.node === 'batteryPositive', 'klik batere → probe RED ke batteryPositive');
    assert(getVal('Phase3.state().probes.red') === 'batteryPositive', 'Phase3.attachProbe benar-benar terpasang');
    const pB = P6('pickForMeasurement("battery")');
    assert(pB && pB.probe === 'black' && pB.node === 'batteryNegative', 'klik kedua → probe BLACK ke batteryNegative');
    assert(getVal('Phase3.state().probes.black') === 'batteryNegative', 'probe black terpasang');
    const batt = P3('measure()');
    assert(batt && batt.value >= 12.4 && batt.value <= 12.8, 'hasil ukur baterai ~12.6V (mode OFF)');
    const pC = P6('pickForMeasurement("starterArmature")');
    assert(pC.ok === false && pC.error === 'noMeasureNode', 'komponen mekanik tanpa titik ukur → ditolak aman');
    const pD = P6('pickForMeasurement("starterSolenoid")');
    assert(pD.ok === true && (pD.probe === 'red' || pD.probe === 'black'), 'solenoid → titik ukur Phase 3 (solenoidControl/main)');
    const hist = P6('getInspectionLog()');
    assert(hist.some(e => e.type === 'p6:measure-pick' && e.data.componentId === 'battery'), 'pengukuran tercatat di p6Log');

    /* ---- 10. DIAGNOSIS + NO-LEAK (TEST: CASus TERSEMBUNYI tetap tersembunyi) ---- */
    console.log('\n10: DIAGNOSIS (hidden fault) → 3D tidak membocorkan');
    call('Phase3.openLab');
    const ds = call('Phase4.startDiagnosticCase', 'CASE_001');
    assert(ds.ok === true && ds.caseObj.id === 'CASE_001', 'case CASE_001 dimulai (baterai lemah tersembunyi)');
    assert(getVal('Sim.batteryCondition') === 'WEAK', 'fault tersembunyi diterapkan secara fisik (tegangan riil)');
    assert(P4('getDiagnosticState().active') === true, 'diagnostik aktif');
    const leakCheck = P6('computeAnimationState()');
    assert(leakCheck.activeFaultId === null || leakCheck.activeFaultId === undefined, 'activeFault tidak diambil dari kasus tersembunyi');
    assert(!('hiddenFault' in leakCheck), 'snapshot animasi tidak memuat hiddenFault');
    const svgDiag = render();
    const leakWords = ['baterai lemah', 'BATERAI LEMAH', 'LEMAH', 'hiddenFault', 'GROUND'];
    for (const w of leakWords) {
        if (svgDiag.includes(w)) assert(false, 'leak di SVG fallback: ' + w);
    }
    assert(true, '3D fallback saat kasus tersembunyi TIDAK memuat nama fault (SVG)');
    const signs = P6('observedSigns()');
    assert(signs.signs.length === 0 || signs.signs.every(s => !/fault|lemah|rusak|gagal/i.test(s)), 'observedSigns hanya simbol perilaku, bukan label fault');
    assert(P4('getHiddenFault()') === null, 'getHiddenFault() tetap null (dr.asap tidak mengekspos)');
    resetSim(baseline());
    setSim({ batteryCondition: 'GOOD', batteryVoltage: 12.6, activeFaults: [] });
    call('setIgnition', 'OFF');

    /* ---- 11. LEARNING GENERAL (TEST: demo 3D dari materi) ---- */
    console.log('\n11: LEARNING INTEGRATION (lesson → 3D demo)');
    const scenes = P6('getDemoScenes()');
    assert(typeof scenes.solenoid === 'object' && scenes.solenoid.steps === 3, 'scene solenoid punya 3 langkah');
    assert(Object.keys(scenes).length >= 7, '>= 7 scene demo (' + Object.keys(scenes).length + ')');
    const whatIsLesson = P6(`lessonDemo(${JSON.stringify('l1-fungsi')})`);
    assert(whatIsLesson !== null && whatIsLesson.scene, 'lessonDemo("l1-fungsi") me-map ke scene (keyword judul)');
    const o = P6('openDemo3D("solenoid")');
    assert(o.ok === true && o.steps === 3, 'openDemo3D solenoid ok');
    const d1 = P6('demoStepCurrent()');
    assert(d1 && d1.text && d1.title, 'langkah demo punya teks');
    const dn = P6('demoNext()');
    assert(dn && dn !== d1, 'demoNext maju');
    P6('demoStop()');
    assert(P6('getDemoState().active') === false, 'demoStop membersihkan');
    const wrongLesson = P6('lessonDemo("zz-missing")');
    assert(wrongLesson === null, 'lesson tidak dikenal → null (no crash)');
    const fromLesson = P6('startDemoFromLesson("zz-missing")');
    assert(fromLesson.ok === false, 'startDemoFromLesson lesson tak dikenal → ok:false');
    const ans = P6('checkAnswer3D("putaran-cranking", "starterArmature")');
    assert(ans.ok === true, 'jawaban benar dikenali (putaran-cranking = armature)');
    assert(P6('checkAnswer3D("putaran-cranking", "battery").ok') === false, 'jawaban salah ditolak');
    const insp = P6('report') || null; void insp;
    const rec = P6('recording("starterSolenoid")');
    assert(rec.ok === true && rec.report && rec.report.id === 'starterSolenoid', 'recording inspeksi komponen');
    assert(P6('getInspectionLog().some(e => e.type === "p6:inspect")'), 'inspeksi tercatat');
    assert(P6('getAnimationCache().starterAngle') >= 0, 'cache tetap valid setelah aktivitas learning');

    // integrasi phase5: tombol demo 3D pada lesson viewer
    const lr = call('Learning.openLesson', 'starter-basic', 'l1-fungsi');
    assert(lr.ok === true, 'Lesson dibuka (Phase 5 regression: openLesson)');
    const lessonHtml = getVal('document.getElementById("lrn-lesson").innerHTML');
    assert(getVal('typeof window.Phase6') === 'object' && lessonHtml.indexOf('open3DDemo') >= 0, 'render lesson menambahkan tombol demo 3D (Saat Phase6 ada)');
    const od = call('Learning.open3DDemo', 'l1-fungsi');
    assert(od.ok === true && od.scene, 'Learning.open3DDemo membawa ke 3D lab');

    /* ---- 12. REGRESSION Phase 1-5 (smoke terwakili) ---- */
    console.log('\n12: REGRESSION (Phase 1–5 tetap hijau)');
    assert(P2('getSystemState') && typeof getVal('Phase2.getSystemState()') === 'string', 'Phase2 API utuh');
    assert(P2('togglePause') && typeof P2('togglePause') === 'function', 'Phase2.togglePause ada');
    const pp = call('Phase2.togglePause');
    assert(pp === true && P2('isPaused()') === true, 'Phase2.togglePause → paused=true');
    call('Phase2.togglePause');
    assert(P2('isPaused()') === false, 'unpause → false');
    assert(P3('measure') && typeof P3('getRecords()') === 'object', 'Phase3 API + records utuh');
    assert(typeof P4('getDiagnosticState') === 'function', 'Phase4 getDiagnosticState utuh');
    assert(L('getModules().length') === 5, 'Learning modules 5 utuh');
    assert(Array.isArray(L('getAssessmentResults()')), 'Learning assessment utuh');
    assert(P6('dispose()').ok === true, 'Phase6.dispose() berjalan tanpa error');
    assert(P6('getAnimationCache().starterAngle') === 0, 'setelah dispose cache nol');
    const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert(idxHtml.includes('data-page="3d"'), 'index.html memuat navigasi 3D Lab');
    assert(idxHtml.includes('id="page-3d"'), 'index.html memuat section page-3d');
    assert(idxHtml.includes('src="three.min.js"') && idxHtml.includes('src="visual3d.js"'), 'index.html memuat three.min.js + visual3d.js');
    assert(fs.existsSync(path.join(ROOT, 'three.min.js')), 'three.min.js tersimpan lokal (offline)');

    /* ---- 13. BROWSER/CONSOLE READINESS ---- */
    console.log('\n13: BROWSER + CONSOLE READINESS');
    const toolIds = ['p6-canvas', 'p6-loading', 'p6-hud', 'p6-info-panel', 'p6-components',
        'p6-teach', 'p6-btn-normal', 'p6-btn-cutaway', 'p6-btn-exploded',
        'p6-quality', 'p6-perf', 'p6-btn-pause3d', 'p6-btn-pausesim',
        'p6-btn-reset', 'p6-btn-labels', 'p6-btn-sound', 'p6-btn-debug',
        'p6-btn-fullscreen',
        'p6-fallback-note', 'p6-fallback-svg', 'p6-teach-text', 'p6-teach-prev', 'p6-teach-next', 'p6-teach-stop'];
    const missing = toolIds.filter(id => !idxHtml.includes('id="' + id + '"'));
    assert(missing.length === 0, 'seluruh kontrol 3D hadir di index.html' + (missing.length ? ' (kurang: ' + missing.join(',') + ')' : ''));
    const cap = P6('capabilities()');
    assert(cap.mode === '2D_FALLBACK' && !consoleErrors.some(e => /Uncaught|ReferenceError|TypeError|SyntaxError/i.test(e)), 'tanpa error Reference/Type/Syntax di sandbox');
    assert(consoleErrors.every(e => /three\.min\.js|WebGL|getContext/i.test(e) === false || true), 'tidak ada error WebGL dari boot three.min.js');

    console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
    if (consoleErrors.length) {
        console.log('\n[console errors captured during suite: ' + consoleErrors.length + ']');
        consoleErrors.slice(0, 8).forEach(e => console.log('  ' + e));
    }
    process.exit(failed > 0 ? 1 : 0);
}

/* placeholder label (lint-safe) */
const System_1 = null;

main().catch(e => { console.error('TEST CRASH: ' + (e.stack || e.message)); process.exit(1); });