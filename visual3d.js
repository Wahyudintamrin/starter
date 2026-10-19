/* ============================================================
   PHASE 6 - 3D AUTOMOTIVE VISUALIZATION, CUTAWAY
              & MECHANICAL SIMULATION LABORATORY
   ------------------------------------------------------------
   Lapisan VISUALISASI di atas engine simulasi (Phase 1-2).
   SATU SUMBER KEBENARAN: state central (Sim / Phase2).
   Dilarang membuat engine/state machine baru, dilarang
   memakai Math.random, dilarang membocorkan fault tersembunyi.

   Tier LOKNIK (adapter/animasi/registry/kondisi) bebas WebGL
   sehingga dapat diuji di Node. Tier RENDERER hanya aktif bila
   WebGL + THREE tersedia, jika tidak -> fallback 2D (SVG).

   Dependensi eksternal: three.min.js (r128, UMD) - lokal.
   ============================================================ */

(function () {
    'use strict';

    var G = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
    var HAS_THREE = (typeof THREE !== 'undefined' && THREE && typeof THREE.WebGLRenderer === 'function');

    /* ============================================================
       0. UTILITAS DASAR
       ============================================================ */
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function sCurve(t) { var x = clamp(t, 0, 1); return x * x * (3 - 2 * x); }
    function nowMs() { return (typeof performance === 'object' && performance.now) ? performance.now() : Date.now(); }
    function deepCopy(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
    function safeNumber(v, def) { var n = Number(v); return isFinite(n) ? n : (def || 0); }
    function readFlag(v, def) { return typeof v === 'boolean' ? v : (def === undefined ? false : !!def); }

    /* ============================================================
       1. KONFIGURASI SIMULASI
       ------------------------------------------------------------
       Nilai mekanik di bawah adalah KONFIGURASI (skematik edukasi),
       bukan spesifikasi universal pabrikan. Perbandingan gigi:
       pinion 10 gigi -> ring gear 150 gigi -> reduksi 15:1.
       Ring gear ke crankshaft 1:1 (baut). Silakan disesuaikan.
       ============================================================ */
    var CFG = {
        version: '1.0',
        engine: {
            starterRpmNominal: 240,
            starterToRing: 15,
            pinionTeeth: 10,
            ringTeeth: 150,
            crankRatio: 1,
            stroke: 0.086,
            rod: 0.145,
            animationScale: 1,
            maxCurrent: 250,
            maxHeatMs: 20000,
            dtMaxMs: 50,
            engageHystMs: 420,
            crawlRpm: 200,
            spinRpm: 320
        },
        quality: {
            LOW:    { pixelRatio: 0.6, shadows: false, antialias: false, particles: 6,  seg: 8,  segArc: 14, labelMax: 4 },
            MEDIUM: { pixelRatio: 1.0, shadows: true,  antialias: true,  particles: 14, seg: 12, segArc: 22, labelMax: 8 },
            HIGH:   { pixelRatio: 1.5, shadows: true,  antialias: true,  particles: 24, seg: 16, segArc: 30, labelMax: 14 }
        },
        // Orbit bebas 360° (azimut tanpa batas), bisa melihat dari atas maupun bawah
        cameraLimits: { minDist: 0.6, maxDist: 30, polarMin: 0.04, polarMax: Math.PI - 0.04, azimLim: [-Infinity, Infinity] },
        presets: {
            FULL:     { target: [0.2, -0.55, -0.4], dist: 11.2, polar: 1.1, azim: 0.62 },
            STARTER:  { target: [0.45, 0.2, 0], dist: 3.6, polar: 1.2, azim: 0.5 },
            SOLENOID: { target: [0.35, 0.71, 0], dist: 1.9, polar: 1.12, azim: -0.75 },
            PINION:   { target: [1.8, 0.0, -0.12], dist: 1.9, polar: 1.3, azim: 2.2 },
            FLYWHEEL: { target: [1.85, 0, -2.56], dist: 7.0, polar: 1.3, azim: 1.35 },
            ENGINE:   { target: [2.8, 0.2, -2.56], dist: 5.2, polar: 1.18, azim: 1.0 },
            CIRCUIT:  { target: [-1.0, -1.5, 1.5], dist: 7.0, polar: 1.0, azim: 0.35 }
        }
    };

    /* ============================================================
       2. STATE -> SINYAL ANIMASI (TABEL SEMANTIK)
       ------------------------------------------------------------
       Nilai 0..1 = intensitas target komponen pada tiap state.
       TABEL ini adalah fallback dokumentasi; saat Sim hidup, flag
       langsung dari engine (relayState/solenoidState/pinionEngaged/
       starterState) yang menang (SUMBER KEBENARAN = state engine).
       ============================================================ */
    var STATE_SIGNALS = {
        OFF:              { relay: 0, solenoid: 0, plunger: 0, pinion: 0, current: 0, starter: 0 },
        IGNITION_ON:      { relay: 0, solenoid: 0, plunger: 0, pinion: 0, current: 0, starter: 0 },
        START_REQUEST:    { relay: 0, solenoid: 0, plunger: 0, pinion: 0, current: 0, starter: 0 },
        RELAY_ACTIVE:     { relay: 1, solenoid: 0, plunger: 0, pinion: 0, current: 0, starter: 0 },
        SOLENOID_ACTIVE:  { relay: 1, solenoid: 1, plunger: 1, pinion: 0, current: 0, starter: 0 },
        PINION_ENGAGED:   { relay: 1, solenoid: 1, plunger: 1, pinion: 1, current: 0, starter: 0 },
        STARTER_CRANKING: { relay: 1, solenoid: 1, plunger: 1, pinion: 1, current: 1, starter: 1 },
        ENGINE_RUNNING:   { relay: 0, solenoid: 0, plunger: 0, pinion: 0, current: 0, starter: 0 }
    };

    function getStateSignals(name) {
        return deepCopy(STATE_SIGNALS[name] || STATE_SIGNALS.OFF);
    }

    /* ============================================================
       3. PEMBACA STATE PUSAT (SINGLE SOURCE OF TRUTH)
       ------------------------------------------------------------
       Membaca dari Phase 1 (app.js Sim), Phase 2 (Phase2.*),
       Phase 3 (multimeter), Phase 4 (diagnosis *tidak* untuk
       perilaku visual). Semua akses diguard.
       ============================================================ */
    function p2(name, fallback) {
        try {
            if (G.Phase2 && typeof G.Phase2[name] === 'function') return G.Phase2[name]();
        } catch (e) { /* noop */ }
        return fallback;
    }

    function p3(name, fallback) {
        try {
            if (G.Phase3 && typeof G.Phase3[name] === 'function') return G.Phase3[name]();
        } catch (e) { /* noop */ }
        return fallback;
    }

    function resolveGlobalSim() {
        try { if (G.Sim) return G.Sim; } catch (e) { /* noop */ }
        try { if (typeof Sim !== 'undefined' && Sim) return Sim; } catch (e) { /* noop */ }
        return {};
    }

    function readSimulationSnapshot() {
        var Sim = resolveGlobalSim();
        var sys = p2('getSystemState', Sim.systemState || 'OFF');
        var compStarter = {};
        var compEngine = {};
        var compRelay = {};
        var compSolenoid = {};
        var compBattery = {};
        try {
            if (G.Phase2 && typeof G.Phase2.getComponentState === 'function') {
                compStarter = G.Phase2.getComponentState('starter') || {};
                compEngine = G.Phase2.getComponentState('engine') || {};
                compRelay = G.Phase2.getComponentState('relay') || {};
                compSolenoid = G.Phase2.getComponentState('solenoid') || {};
                compBattery = G.Phase2.getComponentState('battery') || {};
            }
        } catch (e) { /* noop */ }

        var reading = null;
        try {
            if (G.Phase3 && typeof G.Phase3.getReading === 'function') {
                var r = G.Phase3.getReading();
                if (r && typeof r === 'object' && 'value' in r) reading = { value: r.value, unit: r.unit, ok: !!r.ok, level: r.level };
            }
        } catch (e) { /* noop */ }

        var activeFault = p2('getActiveFault', Sim.activeFaults && Sim.activeFaults.length ? Sim.activeFaults[0] : null);

        return {
            t: nowMs(),
            systemState: sys,
            starterState: compStarter.state || Sim.starterState || 'OFF',
            engineState: compEngine.state || Sim.engineState || 'STOPPED',
            relayState: compRelay.state || Sim.relayState || 'INACTIVE',
            solenoidState: compSolenoid.state || Sim.solenoidState || 'INACTIVE',
            pinionEngaged: compSolenoid.pinion === true ? true : (Sim.pinionEngaged === true ? true : false),
            starterRPM: safeNumber(compStarter.rpm != null ? compStarter.rpm : Sim.starterRPM, 0),
            starterCurrent: safeNumber(compStarter.current != null ? compStarter.current : Sim.starterCurrent, 0),
            starterVoltage: safeNumber(compStarter.voltage != null ? compStarter.voltage : Sim.starterVoltage, 0),
            batteryVoltage: safeNumber(compBattery.voltage != null ? compBattery.voltage : Sim.batteryVoltage, 12.6),
            batteryCondition: compBattery.state || Sim.batteryCondition || 'GOOD',
            engineRPM: safeNumber(compEngine.rpm != null ? compEngine.rpm : Sim.engineRPM, 0),
            relayFault: Sim.relayFail === true,
            solenoidFault: Sim.solenoidFail === true || Sim.solenoidMainFail === true,
            pinionFault: Sim.pinionFail === true,
            starterFault: Sim.starterMotorFault === true,
            ignitionFault: Sim.ignitionFail === true,
            fuseOpen: Sim.fuseState === 'OPEN' || Sim.fuseState === 'BURNED',
            weakBattery: (Sim.batteryCondition === 'WEAK' || Sim.batteryCondition === 'LEMAH'),
            groundPoor: Sim.groundCondition === 'BURUK' || Sim.groundCondition === 'POOR',
            looseTerminal: Sim.looseTerminal === true,
            activeFault: activeFault,
            faultIds: (Sim.activeFaults || []).slice(),
            multimeterReading: reading,
            diagnosticsActive: (function () {
                try { return !!(G.Phase4 && G.Phase4.getDiagnosticState && G.Phase4.getDiagnosticState().active); } catch (e) { return false; }
            })()
        };
    }

    /* ============================================================
       4. KINEMATIKA / MEKANIK  (murni matematis, deterministik)
       ============================================================ */
    function rpmToAngularVelocity(rpm) { return (safeNumber(rpm, 0) / 60) * Math.PI * 2; }

    function rotationStep(angleRad, rpm, dtMs, scale) {
        var s = scale == null ? 1 : scale;
        var dt = clamp(safeNumber(dtMs, 0), 0, CFG.engine.dtMaxMs) / 1000;
        return angleRad + rpmToAngularVelocity(rpm) * dt * s;
    }

    function pistonDisplacement(thetaDeg, stroke, rod) {
        var r = (stroke || CFG.engine.stroke) / 2;
        var l = rod || CFG.engine.rod;
        var rad = (thetaDeg % 360) * Math.PI / 180;
        var sinT = Math.sin(rad);
        var x = r * (1 - Math.cos(rad)) + (l - Math.sqrt(Math.max(0, l * l - (r * sinT) * (r * sinT))));
        var norm = clamp(x / (r * 2), 0, 1);
        return { meters: x, norm: norm, thetaDeg: thetaDeg % 360 };
    }

    function computeHeat(current, activeMs) {
        var c = clamp(safeNumber(current, 0) / CFG.engine.maxCurrent, 0, 1);
        var t = clamp(safeNumber(activeMs, 0) / CFG.engine.maxHeatMs, 0, 1);
        return c * t;
    }

    function particleSpeed(current, min, max) {
        var lo = min == null ? 0 : min;
        var hi = max == null ? CFG.engine.maxCurrent : max;
        if (hi <= lo) return 0;
        return clamp((safeNumber(current, 0) - lo) / (hi - lo), 0, 1);
    }

    function getGearConfig() { return deepCopy(CFG.engine); }

    /* ============================================================
       5. KOMPUTASI STATE ANIMASI (ADAPTER)
       ------------------------------------------------------------
       Semua keluaran terikat state engine. Gaya (multiplikator)
       berasal dari observasi numerik -> gejala, BUKAN nama fault.
       ============================================================ */
    var cache = {
        starterAngle: 0, flyAngle: 0, crankAngle: 0, engineAngle: 0,
        plunger: 0, pinion: 0, relayV: 0, solenoidV: 0,
        heatMs: 0, particleT: 0
    };
    var lastSnapshot = null;

    function resetStepState() {
        cache.starterAngle = 0; cache.flyAngle = 0; cache.crankAngle = 0; cache.engineAngle = 0;
        cache.plunger = 0; cache.pinion = 0; cache.relayV = 0; cache.solenoidV = 0;
        cache.heatMs = 0; cache.particleT = 0;
        lastSnapshot = null;
    }

    function rpmScaleFor(snap) {
        var scale = 1;
        if (snap.weakBattery || snap.looseTerminal) scale *= 0.62;
        if (snap.groundPoor) scale *= 0.78;
        if (snap.starterFault || snap.ignitionFault) scale = 0;
        return scale;
    }

    function currentScaleFor(snap) {
        var scale = 1;
        if (snap.fuseOpen) scale = 0;
        if (snap.relayFault) scale = 0;
        if (snap.starterFault) scale = 0;
        if (snap.weakBattery || snap.groundPoor || snap.looseTerminal) scale *= 0.72;
        return scale;
    }

    function computeAnimationState() {
        var snap = readSimulationSnapshot();
        lastSnapshot = snap;

        var sig = getStateSignals(snap.systemState);

        var crankGating = (snap.engineState === 'RUNNING');
        var relay = (snap.relayState === 'ACTIVE');
        var solenoid = (snap.solenoidState === 'ACTIVE');
        var engaged = snap.pinionEngaged === true;
        var spinning = (snap.starterState === 'CRANKING');

        var rpmScale = rpmScaleFor(snap);
        var curScale = currentScaleFor(snap);

        var spinRpm = spinning ? snap.starterRPM : 0;
        if (spinRpm <= 0 && spinning) spinRpm = snap.starterRPM;
        var starterRpmEff = spinRpm * rpmScale;
        var crankRpm = (engaged && !crankGating) ? starterRpmEff / CFG.engine.starterToRing : 0;
        var engineRpmVis = crankGating ? snap.engineRPM : crankRpm;

        var currentNorm = particleSpeed(snap.starterCurrent * curScale, 0, CFG.engine.maxCurrent);
        if (!spinning) currentNorm = particleSpeed(snap.starterCurrent > 0 ? snap.starterCurrent * curScale : 0, 0, CFG.engine.maxCurrent);

        var observed = [];
        if (!crankGating) {
            if (spinning && starterRpmEff > 0 && starterRpmEff < CFG.engine.starterRpmNominal * 0.85) observed.push('crankTerlambat');
            if (spinning && starterRpmEff <= 0) observed.push('tidakBerputar');
            if (relay && !crankGating && currentNorm <= 0.01) observed.push('arusHilang');
            if (solenoid && !engaged && !spinning && !relay) observed.push('pinionTidakMajtur');
        }
        if (crankGating && snap.engineRPM <= 0) observed.push('mesinBerhenti');

        var plungerTarget = (solenoid || engaged) ? 1 : 0;
        var pinionTarget = engaged ? 1 : 0;
        var relayTarget = relay ? 1 : 0;
        var solenoidTarget = solenoid ? 1 : 0;

        var hy = CFG.engine.engageHystMs;
        var k = clamp(16 / hy, 0, 1);
        var next = {
            t: snap.t,
            systemState: snap.systemState,
            relayV: lerp(cache.relayV, relayTarget, k),
            solenoidV: lerp(cache.solenoidV, solenoidTarget, k),
            plunger: lerp(cache.plunger, plungerTarget, k),
            pinion: lerp(cache.pinion, pinionTarget, k),
            relayTarget: relayTarget, solenoidTarget: solenoidTarget,
            plungerTarget: plungerTarget, pinionTarget: pinionTarget,
            starterRPM: starterRpmEff,
            nominalRpm: CFG.engine.starterRpmNominal,
            crankRPM: crankRpm,
            engineRPM: engineRpmVis,
            currentNorm: currentNorm,
            current: snap.starterCurrent * curScale,
            starterVoltage: snap.starterVoltage,
            batteryVoltage: snap.batteryVoltage,
            engaged: engaged,
            spinning: spinning,
            running: crankGating,
            heat: computeHeat(snap.starterCurrent * curScale, cache.heatMs),
            flow: {
                relay: relayTarget,
                solenoid: solenoidTarget,
                motor: spinning ? 1 : 0,
                effective: curScale
            },
            gear: {
                ratio: CFG.engine.starterToRing,
                crankRatio: CFG.engine.crankRatio,
                teeth: { pinion: CFG.engine.pinionTeeth, ring: CFG.engine.ringTeeth }
            },
            observed: observed,
            battery: { condition: snap.batteryCondition, conditionScale: rpmScale },
            fuseOpen: snap.fuseOpen,
            activeFaultId: snap.activeFault,
            diagnosticsActive: snap.diagnosticsActive,
            multimeter: snap.multimeterReading,
            deterministic: true
        };
        return next;
    }

    function observedSigns() {
        var st = computeAnimationState();
        return { signs: st.observed.slice(), state: st.systemState, spinning: st.spinning, running: st.running };
    }

    /* ============================================================
       6. REGISTRY KOMPONEN + INFO (ID WAJIB per prompt)
       ------------------------------------------------------------
       - measure: pemetaan ke titik ukur Phase 3 (MENGAMBIL node
         yang sudah ada, TIDAK membuat node baru).
       - inspect: fungsi menghasilkan laporan teknis komponen
         berdasarkan snapshot terkini (tanpa nama fault tersembunyi).
       ============================================================ */
    function componentReport(id) {
        var info = COMPONENTS[id];
        if (!info) return null;
        var snap = readSimulationSnapshot();
        var out = {
            id: id,
            label: info.label,
            en: info.en,
            role: info.role,
            function: info.function,
            electrical: info.electrical,
            mechanical: info.mechanical,
            measure: info.measure
        };
        if (info.value) {
            try { out.value = info.value(snap); } catch (e) { out.value = null; }
        }
        return out;
    }

    var COMPONENTS = {
        starterHousing: {
            label: 'Rumah Motor Starter', en: 'Starter housing',
            role: 'motor', function: 'Menahan komponen motor (armatur, brush, bidang kutub) dan menjadi jalur massa listrik ke rangka.',
            electrical: 'Massa (ground) motor; terminal massa adalah badan motor.', mechanical: 'Casing motor; mencegah kontaminasi pada armatur/brush.',
            measure: { red: 'starterPositive' },
            value: function (s) { return { voltage: s.starterVoltage, current: s.starterCurrent, state: s.starterState }; }
        },
        starterArmature: {
            label: 'Armatur (Rotor)', en: 'Armature / rotor',
            role: 'rotating', function: 'Inti berputar tempat lilitan; menerima arus dari brush dan memutar shaft.',
            electrical: 'Lilitan rotor membawa arus antara komutator; medan listriknya menghasilkan torsi.', mechanical: 'Berputar dengan kecepatan beberapa ratus RPM saat cranking.',
            measure: {},
            value: function (s) { return { rpm: s.starterRPM, current: s.starterCurrent }; }
        },
        starterBrushes: {
            label: 'Sikat (Brush)', en: 'Brushes',
            role: 'static', function: 'Menyalurkan arus dari lilitan medan ke komutator saat armatur berputar.',
            electrical: 'Kontak geser; keausan brush menurunkan transfer arus.', mechanical: 'Menekan komutator dengan pegas.',
            measure: {},
            value: null
        },
        starterCommutator: {
            label: 'Komutator', en: 'Commutator',
            role: 'rotating', function: 'Segmen tembaga pengarah arus agar torsi armatur tetap searah.',
            electrical: 'Membalik arah arus setiap segmen saat rotor berputar.', mechanical: 'Permukaan silinder licin tempat brush menempel.',
            measure: {},
            value: function (s) { return { rpm: s.starterRPM }; }
        },
        starterShaft: {
            label: 'Poros Armatur', en: 'Armature shaft',
            role: 'rotating', function: 'Meneruskan putaran armatur ke pinion lalu ke flywheel mesin.',
            mechanical: 'Digeser maju (Aksial) oleh solenoid saat penguncian (meshing).',
            measure: {},
            value: function (s) { return { engaged: s.pinionEngaged, rpm: s.starterRPM }; }
        },
        starterPinion: {
            label: 'Pinion Gear', en: 'Pinion gear',
            role: 'rotating', function: 'Gigi kecil penyalur putaran, digeser solenoid ke ring gear flywheel.',
            mechanical: '10 gigi; rasio terhadap ring gear (~150 gigi) = reduksi 15:1.',
            measure: {},
            value: function (s) { return { engaged: s.pinionEngaged }; }
        },
        starterSolenoid: {
            label: 'Solenoid', en: 'Solenoid (starter relay)',
            role: 'solenoid', function: 'Kumparan utama mendorong plunger: menutup kontak utama mengalirkan arus besar motor dan menggeser pinion.',
            electrical: 'Kontak utama menyambung jalur arus besar dari baterai ke motor saat plunger menutup.',
            mechanical: 'Plunger + fork menggerakkan shaft pinion ke ring gear.',
            measure: { red: 'solenoidControl', black: 'solenoidMain' },
            value: function (s) { return { state: s.solenoidState, plunger: Math.round(cache.plunger * 100) / 100, engaged: s.pinionEngaged }; }
        },
        starterRelay: {
            label: 'Relay Starter', en: 'Starter relay (S terminal)',
            role: 'relay', function: 'Relay kecil di sirkuit kontrol: menghubungkan kunci kontak (ignition) ke kumparan solenoid.',
            electrical: 'Kumparan relay (S) memicu kontak yang mengaliri kumparan solenoid.',
            mechanical: 'Kontak menutup/terbuka secara elektromagnetik.',
            measure: { red: 'relayInput', black: 'relayOutput' },
            value: function (s) { return { state: s.relayState }; }
        },
        battery: {
            label: 'Baterai', en: 'Battery',
            role: 'source', function: 'Sumber energi listrik 12 V; menyuplai arus besar saat cranking (arus start bisa ratusan A).',
            electrical: 'Tegangan terminal turun saat beban besar (drop internal).', mechanical: 'Terminal + dan - sebagai titik ukur referensi.',
            measure: { red: 'batteryPositive', black: 'batteryNegative' },
            value: function (s) { return { voltage: s.batteryVoltage, condition: s.batteryCondition }; }
        },
        positiveCable: {
            label: 'Kabel Positif', en: 'Positive cable',
            role: 'wiring', function: 'Menghubungkan terminal + baterai ke fuse, relay, solenoid, lalu motor starter.',
            electrical: 'Jalur arus utama; tahanan kabel menentukan drop tegangan.',
            mechanical: 'Kabel tembaga besar dengan isolator merah.',
            measure: { red: 'batteryPositive' },
            value: function (s) { return { current: s.starterCurrent }; }
        },
        groundCable: {
            label: 'Kabel Massa', en: 'Ground cable',
            role: 'wiring', function: 'Menghubungkan badan motor starter ke rangka/chassis dan kembali ke terminal - baterai.',
            electrical: 'Jalur balik arus; massa buruk menaikkan drop dan menurunkan arus.',
            mechanical: 'Kabel pilin dari housings motor ke body.',
            measure: { black: 'starterGround' },
            value: function (s) { return { condition: s.groundPoor ? 'POOR' : 'GOOD' }; }
        },
        flywheel: {
            label: 'Flywheel', en: 'Flywheel',
            role: 'mechanical', function: 'Roda gila mesin: tempat ring gear, menyimpan energi rotasi agar putaran mesin stabil.',
            mechanical: 'Ring gear (150 gigi) menerima putaran pinion; flywheel meneruskan ke crankshaft 1:1.',
            measure: { black: 'engineGround' },
            value: function (s) { return { rpm: Math.round(s.engineRPM * 100) / 100 }; }
        },
        ringGear: {
            label: 'Ring Gear', en: 'Ring gear',
            role: 'mechanical', function: 'Gigi besar di sekeliling flywheel tempat pinion starter berkaitan.',
            mechanical: 'Digerakkan pinion saat cranking; lepas saat mesin sudah hidup (overrun).',
            measure: {},
            value: function (s) { return { engaged: s.pinionEngaged }; }
        },
        crankshaft: {
            label: 'Poros Engkol (Crankshaft)', en: 'Crankshaft',
            role: 'mechanical', function: 'Mengubah gerak rotasi flywheel menjadi gerak bolak-balik piston lewat batang piston.',
            mechanical: 'Kondisi θ -> piston: pergerakan x = r(1-cosθ)+koreksi batang.',
            measure: { black: 'engineGround' },
            value: function (s) { return { rpm: Math.round(s.engineRPM * 100) / 100 }; }
        },
        engineBlock: {
            label: 'Blok Mesin', en: 'Engine block',
            role: 'mechanical', function: 'Struktur utama mesin tempat crankcase, flywheel, dan piston bekerja.',
            mechanical: 'Massa mesin menjadi referensi ground engine.',
            measure: { black: 'engineGround' },
            value: function (s) { return { state: s.engineState, rpm: Math.round(s.engineRPM * 100) / 100 }; }
        },
        piston: {
            label: 'Piston', en: 'Piston',
            role: 'mechanical', function: 'Bergerak bolak-balik di dalam silinder mengikuti putaran crankshaft.',
            mechanical: 'Posisi mengikuti persamaan crank-slider terhadap sudut crankshaft.',
            measure: {},
            value: function (s) { return {}; }
        },
        fieldCoil: {
            label: 'Lilitan Medan', en: 'Field coils',
            role: 'electric', function: 'Magnet stator yang memunculkan medan untuk menghasilkan torsi armatur.',
            electrical: 'Empat kutub (dua pasang) yang dialiri arus seri dengan lilitan armatur (motor seri).',
            mechanical: 'Menempel pada rumah motor.',
            measure: {},
            value: null
        },
        overrunningClutch: {
            label: 'Kopling Satu Arah', en: 'Overrunning clutch',
            role: 'mechanical', function: 'Meneruskan putaran armatur ke pinion hanya ke satu arah. Setelah mesin hidup dan ring gear berputar lebih cepat, kopling selip (freewheel) sehingga armatur tidak ikut terputar berlebihan.',
            electrical: 'Tidak dialiri arus (komponen mekanik).',
            mechanical: 'Roller dan pegas di dalam rumah kopling mengunci pada satu arah putar; digeser maju-mundur oleh tuas bersama pinion.',
            measure: {},
            value: function (s) { return { engaged: s.pinionEngaged }; }
        },
        shiftLever: {
            label: 'Tuas Penggeser', en: 'Shift lever / drive fork',
            role: 'mechanical', function: 'Menghubungkan plunger solenoid ke kopling. Saat plunger tertarik, tuas berputar pada engselnya dan garpunya mendorong pinion maju ke ring gear.',
            electrical: 'Tidak dialiri arus.',
            mechanical: 'Prinsip pengungkit: ujung atas ditarik plunger, ujung bawah (garpu) mendorong kopling dan pinion.',
            measure: {},
            value: function (s) { return { engaged: s.pinionEngaged }; }
        },
        driveHousing: {
            label: 'Rumah Depan (Drive End)', en: 'Drive end frame',
            role: 'motor', function: 'Rumah aluminium bagian depan: menopang ujung poros (bushing), melindungi kopling dan pinion, serta menjadi dudukan baut ke blok mesin.',
            electrical: 'Jalur massa: badan starter terhubung ke blok mesin melalui baut dudukan.',
            mechanical: 'Memiliki jendela terbuka tempat pinion berkaitan dengan ring gear flywheel.',
            measure: {},
            value: null
        },
        rearCover: {
            label: 'Tutup Belakang', en: 'Commutator end frame',
            role: 'motor', function: 'Menutup sisi belakang motor, menopang ujung poros armatur dengan bushing, serta melindungi komutator dan sikat.',
            electrical: 'Bagian dari massa badan motor.',
            mechanical: 'Dijepit ke rumah depan oleh dua baut panjang (through bolt) yang melewati yoke.',
            measure: {},
            value: null
        },
        ignitionSwitch: {
            label: 'Kunci Kontak', en: 'Ignition switch',
            role: 'switch', function: 'Saklar pengendali sirkuit starter: posisi OFF, ON, lalu START (ditahan) mengirim arus ke kaki 86 kumparan relay.',
            electrical: 'Terminal IN menerima + dari fuse; terminal OUT menuju kaki 86 relay hanya saat START.', mechanical: 'Silinder kunci berputar; posisi START dikembalikan pegas ke ON saat kunci dilepas.',
            measure: { red: 'ignitionInput', black: 'ignitionOutput' },
            value: function (s) { var pos = 'OFF'; try { pos = Sim.ignitionState || pos; } catch (e) { /* noop */ } return { position: pos, fault: !!s.ignitionFault }; }
        },
        fuse: {
            label: 'Sekering (Fuse)', en: 'Fuse',
            role: 'wiring', function: 'Pelindung arus lebih pada jalur positif.',
            electrical: 'Terbuka (OPEN) menghentikan arus; drop diukur di fuse input/output.',
            mechanical: 'Elemen logam dalam rumah keramik/kaca.',
            measure: { red: 'fuseInput', black: 'fuseOutput' },
            value: function (s) { return { state: s.fuseOpen ? 'OPEN' : 'GOOD' }; }
        }
    };

    var REQUIRED_IDS = [
        'starterHousing', 'starterArmature', 'starterBrushes', 'starterCommutator',
        'starterShaft', 'starterPinion', 'starterSolenoid', 'starterRelay',
        'battery', 'positiveCable', 'groundCable', 'flywheel', 'ringGear', 'crankshaft',
        'fuse', 'ignitionSwitch', 'engineBlock'
    ];

    function getComponentIds() { return REQUIRED_IDS.slice(); }
    function getComponentInfo(id) { return id && COMPONENTS[id] ? componentReport(id) : null; }

    /* ============================================================
       7. JEMBATAN PENGUKURAN (3D/2D -> Phase 3)
       ------------------------------------------------------------
       Klik komponen 3D -> menempelkan probe merah/hitam pada titik
       ukur Phase 3 yang SUDAH ADA. Tidak membuat node baru.
       ============================================================ */
    function probeForNext() {
        var st = null;
        try { st = G.Phase3 && typeof G.Phase3.state === 'function' ? G.Phase3.state() : null; } catch (e) { st = null; }
        if (!st || !st.probes) return 'red';
        var redTaken = st.probes.red != null && st.probes.red !== '';
        var blackTaken = st.probes.black != null && st.probes.black !== '';
        if (!redTaken) return 'red';
        if (!blackTaken) return 'black';
        return 'red';
    }

    function pickForMeasurement(componentId) {
        var info = COMPONENTS[componentId];
        if (!info) return { ok: false, error: 'unknown' };
        var probe = probeForNext();
        var node = info.measure && (probe === 'black' ? info.measure.black : info.measure.red);
        if (probe === 'black' && !node && info.measure && info.measure.red) node = info.measure.red;
        if (!node) return { ok: false, error: 'noMeasureNode', componentId: componentId, probe: probe };
        if (G.Phase3 && typeof G.Phase3.attachProbe === 'function') {
            var res;
            try { res = G.Phase3.attachProbe(probe, node); } catch (e) { res = null; }
            var okNow = res && (res.ok !== false);
            p6log('p6:measure-pick', { componentId: componentId, probe: probe, node: node });
            return { ok: okNow !== false, probe: probe, node: node, componentId: componentId, result: res };
        }
        return { ok: false, error: 'noPhase3', probe: probe };
    }

    /* ============================================================
       8. JEMBATAN DIAGNOSIS + LEARNING (tanpa bocor)
       ------------------------------------------------------------
       - observedSigns() hanya memakai angka observasi.
       - Activity log (Phase2.logEvent) untuk jejak interaksi 3D.
       - lessonDemo(lessonId): pencarian demo berdasar judul materi.
       - p6Log: jejak interaksi tersimpan lokal.
       ============================================================ */
    var P6LOG_KEY = 'p6Interactions';
    function p6log(type, payload) {
        var arr = [];
        try {
            var raw = G.localStorage && G.localStorage.getItem ? G.localStorage.getItem(P6LOG_KEY) : null;
            if (raw) { arr = JSON.parse(raw) || []; }
        } catch (e) { arr = []; }
        arr.push({ t: nowMs(), type: type, data: payload || {} });
        if (arr.length > 300) arr.splice(0, arr.length - 300);
        try { if (G.localStorage && G.localStorage.setItem) G.localStorage.setItem(P6LOG_KEY, JSON.stringify(arr)); } catch (e) { /* noop */ }
        if (G.Phase2 && typeof G.Phase2.logEvent === 'function') {
            try { G.Phase2.logEvent('p6:' + type, payload); } catch (e) { /* noop */ }
        }
        return arr.length;
    }

    function getInspectionLog() {
        try {
            var raw = G.localStorage && G.localStorage.getItem ? G.localStorage.getItem(P6LOG_KEY) : null;
            return raw ? (JSON.parse(raw) || []) : [];
        } catch (e) { return []; }
    }

    function recordComponentInspection(componentId) {
        var rep = componentReport(componentId);
        if (!rep) return { ok: false };
        p6log('p6:inspect', { componentId: componentId, label: rep.label });
        return { ok: true, report: rep };
    }

    function checkAnswer3D(questionKey, answerId) {
        var table = {
            'putaran-cranking': 'starterArmature',
            'bagian-solenoid': 'starterSolenoid',
            'pemasok-arus-start': 'battery',
            'penyalur-putaran-ke-flywheel': 'starterPinion',
            'gigi-flywheel': 'ringGear',
            'pengubah-rotasi-ke-piston': 'crankshaft'
        };
        var correct = table[questionKey];
        var ok = !!correct && correct === answerId;
        p6log('p6:answer3d', { questionKey: questionKey, answer: answerId, correct: !!ok });
        return { ok: ok, questionKey: questionKey, correctId: correct, answerId: answerId };
    }

    function getComponentIdsIncludingHelpers() {
        return Object.keys(COMPONENTS);
    }

    /* ---- Demo pembelajaran (DILATAR: tanpa nama fault tersembunyi) ---- */
    var DEMO_SCENES = {
        relay: {
            label: 'Relay Starter', preset: 'CIRCUIT', focus: ['starterRelay'],
            steps: [
                { title: 'Kunci ON', text: 'Saat kunci kontak ON belum ada arus kontrol. Relay hanya menerima sinyal S saat START.', focus: ['starterRelay'] },
                { title: 'Momen START', text: 'Sinyal dari kunci kontak mengaliri kumparan relay (S). Kontak relay menutup dan meneruskan arus ke kumparan solenoid.', focus: ['starterRelay'] },
                { title: 'Kontak menutup', text: 'Perhatikan lampu indikator relay: hijau berarti kontak relay menutup saat arus kontrol mengalir.', focus: ['starterRelay', 'starterSolenoid'] }
            ]
        },
        solenoid: {
            label: 'Solenoid & Kontak Utama', preset: 'SOLENOID', focus: ['starterSolenoid'],
            steps: [
                { title: 'Kumparan kontrol', text: 'Arus kecil dari relay mengaliri lilitan solenoid. Ambil voltmeter di titik solenoid control.', focus: ['starterSolenoid'] },
                { title: 'Plunger bergerak', text: 'Plunger tertarik masuk ke kumparan, menggerakkan fork ke pinion dan menarik plat kontak utama.', focus: ['starterSolenoid', 'starterPinion'] },
                { title: 'Kontak utama', text: 'Kontak utama menutup: arus besar mengalir dari baterai ke motor starter. Perhatikan kabel positif dan aliran arus.', focus: ['starterSolenoid', 'positiveCable'] }
            ]
        },
        pinion: {
            label: 'Penguncian Pinion', preset: 'PINION', focus: ['starterPinion'],
            steps: [
                { title: 'Pinion mundur', text: 'Sebelum START pinion bergeser bebas di poros dan tidak menyentuh ring gear.', focus: ['starterPinion'] },
                { title: 'Meshing', text: 'Plunger solenoid mendorong pinion maju hingga berkaitan dengan ring gear flywheel.', focus: ['starterPinion', 'ringGear'] },
                { title: 'Cranking', text: 'Pinion memutar ring gear. Rasio gigi mengurangi kecepatan tetapi menambah torsi (10 gigi : 150 gigi).', focus: ['starterPinion', 'flywheel'] }
            ]
        },
        crank: {
            label: 'Flywheel → Crankshaft → Piston', preset: 'ENGINE', focus: ['flywheel'],
            steps: [
                { title: 'Flywheel', text: 'Ring gear (150 gigi) di sekeliling flywheel menerima putaran pinion.', focus: ['flywheel', 'ringGear'] },
                { title: 'Crankshaft', text: 'Flywheel terhubung langsung ke crankshaft (rasio 1:1). Poros engkol berputar.', focus: ['crankshaft'] },
                { title: 'Piston', text: 'Crank-slider: sudut crankshaft diubah menjadi gerak bolak-balik piston. Amati piston naik-turun mengikuti putaran.', focus: ['crankshaft', 'piston'] }
            ]
        },
        cutaway: {
            label: 'Mode Cutaway', preset: 'STARTER', focus: ['starterArmature'],
            steps: [
                { title: 'Rumah transparan', text: 'Mode cutaway membuat rumah motor transparan sehingga armatur, lilitan medan, sikat, dan komutator terlihat.', focus: ['starterHousing'] },
                { title: 'Armatur', text: 'Inti berputar di dalam lilitan medan. Arus dari brush memasuki komutator lalu lilitan rotor.', focus: ['starterArmature', 'starterCommutator'] },
                { title: 'Brush & Komutator', text: 'Sikat menekan komutator. Di sinilah arus berpindah dari bagian stasioner ke rotor.', focus: ['starterBrushes', 'starterCommutator'] }
            ]
        },
        exploded: {
            label: 'Mode Exploded', preset: 'STARTER', focus: ['starterHousing'],
            steps: [
                { title: 'Urutan komponen', text: 'Mode exploded memisahkan komponen untuk memperlihatkan urutan perakitan motor starter.', focus: ['starterHousing'] },
                { title: 'Dari kiri', text: 'Rumah (kiri), armatur, sikat+pegas, komutator, shaft, pinion, solenoid, relay.', focus: ['starterArmature'] }
            ]
        },
        current: {
            label: 'Aliran Arus', preset: 'CIRCUIT', focus: ['battery'],
            steps: [
                { title: 'Sumber', text: 'Arus besar berasal dari baterai saat cranking (ratusan ampere). Tegangan terminal turun.', focus: ['battery'] },
                { title: 'Jalur utama', text: 'Arus mengalir: +baterai → fuse → kontak solenoid → motor → housings ground → -baterai.', focus: ['positiveCable', 'starterSolenoid', 'groundCable'] },
                { title: 'Kembali', text: 'Jalur massa menyelesaikan rangkaian. Massa buruk akan terlihat sebagai pengurangan arus (gejala, bukan label).', focus: ['groundCable', 'battery'] }
            ]
        }
    };

    var LESSON_KEYWORDS = [
        { k: /solenoid/i, scene: 'solenoid' },
        { k: /relay/i, scene: 'relay' },
        { k: /pinion/i, scene: 'pinion' },
        { k: /flywheel|roda gila|crankshaft|poros engkol|piston/i, scene: 'crank' },
        { k: /rangkaian|arus|kabel|tegangan|baterai/i, scene: 'current' },
        { k: /motor starter|komponen|bagian/i, scene: 'cutaway' }
    ];

    function lessonDemo(lessonId) {
        var mt = null;
        try {
            if (G.Learning && typeof G.Learning.getLesson === 'function') mt = G.Learning.getLesson(lessonId);
        } catch (e) { mt = null; }
        if (!mt) {
            try {
                if (G.Learning && typeof G.Learning.getLessons === 'function') {
                    var all = G.Learning.getLessons();
                    if (Array.isArray(all)) mt = all.find(function (x) { return x.id === lessonId; }) || null;
                }
            } catch (e) { mt = null; }
        }
        if (!mt) return null;
        var title = (mt.title || '') + ' ' + (mt.function || '') + ' ' + ((mt.sections || []).map(function (s) { return s.content || ''; }).join(' '));
        for (var i = 0; i < LESSON_KEYWORDS.length; i++) {
            if (LESSON_KEYWORDS[i].k.test(title)) {
                var scene = LESSON_KEYWORDS[i].scene;
                return { scene: scene, label: DEMO_SCENES[scene].label, lessonId: lessonId, lessonTitle: mt.title };
            }
        }
        return null;
    }

    var demoState = { active: false, scene: null, index: 0, t: 0, steps: [], lessonId: null };

    function openDemo3D(sceneKey) {
        var scene = DEMO_SCENES[sceneKey];
        if (!scene) return { ok: false, error: 'unknown' };
        demoState.active = true;
        demoState.scene = sceneKey;
        demoState.index = 0;
        demoState.t = 0;
        demoState.lessonId = null;
        demoState.steps = scene.steps || [];
        p6log('p6:demo-open', { scene: sceneKey, steps: demoState.steps.length });
        if (scene.preset && typeof apiSetCameraPreset === 'function') apiSetCameraPreset(scene.preset);
        return { ok: true, scene: sceneKey, steps: demoState.steps.length, step: demoState.steps[0] || null };
    }

    function startDemoFromLesson(lessonId) {
        var d = lessonDemo(lessonId);
        if (!d) return { ok: false, error: 'noDemo' };
        var r = openDemo3D(d.scene);
        if (r.ok) {
            demoState.lessonId = lessonId;
            p6log('p6:demo-from-lesson', { lessonId: lessonId, scene: d.scene });
        }
        return r;
    }

    function demoStepCurrent() {
        var i = clamp(demoState.index, 0, Math.max(0, demoState.steps.length - 1));
        return demoState.active && demoState.steps.length ? demoState.steps[i] : null;
    }
    function demoHasPrev() { return demoState.active && demoState.index > 0; }
    function demoHasNext() { return demoState.active && demoState.index < demoState.steps.length - 1; }
    function demoNext() { if (demoHasNext()) { demoState.index++; demoState.t = 0; } p6log('p6:demo-step', { scene: demoState.scene, index: demoState.index }); return demoStepCurrent(); }
    function demoPrev() { if (demoHasPrev()) { demoState.index--; demoState.t = 0; } return demoStepCurrent(); }
    function demoStop() { demoState.active = false; demoState.scene = null; demoState.index = 0; demoState.t = 0; demoState.steps = []; demoState.lessonId = null; }
    function getDemoState() { return { active: demoState.active, scene: demoState.scene, index: demoState.index, total: demoState.steps.length, lessonId: demoState.lessonId }; }
    function getDemoScenes() {
        var out = {};
        Object.keys(DEMO_SCENES).forEach(function (k) { out[k] = { label: DEMO_SCENES[k].label, preset: DEMO_SCENES[k].preset, steps: (DEMO_SCENES[k].steps || []).length }; });
        return out;
    }

    /* ============================================================
       9. DETEKSI MODE 3D / FALLBACK
       ============================================================ */
    var _webglSupportCache = null;
    function supportsWebGL() {
        if (!HAS_THREE) return false;
        // PERBAIKAN KEDIP: deteksi hanya sekali. Sebelumnya fungsi ini membuat
        // context WebGL baru setiap frame (via modeName()), sehingga browser
        // membuang context lama (batas ~16) termasuk milik renderer -> layar 3D berkedip.
        if (_webglSupportCache !== null) return _webglSupportCache;
        _webglSupportCache = probeWebGL();
        return _webglSupportCache;
    }

    function probeWebGL() {
        var c = null;
        try { c = G.document.createElement('canvas'); } catch (e) { return false; }
        if (!c || typeof c.getContext !== 'function') return false;
        var gl = null;
        try {
            gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
        } catch (e) { gl = null; }
        var ok = !!(gl && typeof gl.getParameter === 'function' && typeof gl.getExtension === 'function');
        if (ok) {
            // Lepaskan context uji agar tidak memakan slot context milik renderer.
            try { var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (e) { /* noop */ }
        }
        return ok;
    }

    function capabilities() {
        return {
            three: HAS_THREE,
            webgl: supportsWebGL(),
            mode: supportsWebGL() ? '3D' : '2D_FALLBACK',
            quality: currentQuality,
            performanceMode: performanceMode
        };
    }

    /* ============================================================
       10. KONTROL MODE / VIEW / KAMERA (UI-level state)
       ============================================================ */
    var currentQuality = 'MEDIUM';
    var performanceMode = false;
    var debugMode = false;
    var soundOn = false;
    var labelsOn = true;
    var labelsAll = false;   /* false = hanya label komponen terpilih/di-hover (tampilan bersih); true = semua label */
    var viewMode = 'NORMAL';      // NORMAL | CUTAWAY | EXPLODED
    var displayMode = 'COMBINED'; // COMBINED | ELECTRICAL | MECHANICAL | SYNCHRONIZED
    var teachingMode = false;
    var exploreMode = true;
    var paused3d = false;
    var pausedSim = false;
    var lastTs = 0;
    var labelsMap = {};

    function getModes() { return { view: viewMode, display: displayMode, teaching: teachingMode, explore: exploreMode }; }
    function getCameraPresets() {
        return Object.keys(CFG.presets).map(function (k) { return { id: k, label: k, target: CFG.presets[k].target.slice() }; });
    }

    function setQuality(q) {
        if (!CFG.quality[q]) return { ok: false };
        currentQuality = q;
        p6log('p6:quality', { quality: q });
        if (renderer && renderer.setPixelRatio && typeof renderer.setPixelRatio === 'function') {
            try { applyRenderQuality(); } catch (e) { /* noop */ }
        }
        applyQualityVisuals();
        return { ok: true, quality: q };
    }

    function setPerformanceMode(on) {
        performanceMode = !!on;
        p6log('p6:perf', { on: performanceMode });
        if (performanceMode) { try { toggleLabels(false); } catch (e) { /* noop */ } }
        if (renderer) setQuality(currentQuality);
        applyQualityVisuals();
        return { ok: true, on: performanceMode };
    }

    function applyQualityVisuals() {
        var q = CFG.quality[currentQuality];
        if (shadowLight) { shadowLight.castShadow = !!q.shadows; }
    }

    function setViewMode(m) {
        if (['NORMAL', 'CUTAWAY', 'EXPLODED'].indexOf(m) < 0) return { ok: false };
        viewMode = m;
        p6log('p6:viewmode', { mode: m });
        applyViewMode();
        return { ok: true, mode: m };
    }

    function setDisplayMode(m) {
        if (['COMBINED', 'ELECTRICAL', 'MECHANICAL', 'SYNCHRONIZED'].indexOf(m) < 0) return { ok: false };
        displayMode = m;
        p6log('p6:displaymode', { mode: m });
        return { ok: true, mode: m };
    }

    function setTeaching(on) {
        teachingMode = !!on;
        if (teachingMode) exploreMode = !teachingMode;
        if (!teachingMode) demoStop();
        try { renderTeachPanel(); } catch (e) { /* noop */ }
        p6log('p6:teaching', { on: teachingMode });
        return { ok: true, teaching: teachingMode };
    }
    function setExplore(on) {
        exploreMode = !!on;
        if (exploreMode) { teachingMode = false; demoStop(); try { renderTeachPanel(); } catch (e) { /* noop */ } }
        return { ok: true, explore: exploreMode };
    }

    function togglePause3D() { paused3d = !paused3d; p6log('p6:pause3d', { on: paused3d }); return paused3d; }
    function togglePauseSim() {
        pausedSim = !pausedSim;
        if (G.Phase2 && typeof G.Phase2.togglePause === 'function') {
            var target = pausedSim ? true : false;
            if (target !== (G.Phase2.isPaused ? G.Phase2.isPaused() : null)) G.Phase2.togglePause();
        }
        p6log('p6:pausesim', { on: pausedSim });
        return pausedSim;
    }

    function setCameraFace(face) {
        if (!THREE) return { ok: false, mode: modeName() };
        face = String(face || '').toUpperCase();
        var preset = null;
        var p = null;
        var sd = Math.min(Math.max(camDistBase, 2.6), 4.5);
        if (face === 'FRONT') { p = { target: STARTER_C, dist: sd, polar: Math.PI / 2 - 0.05, azim: 0 }; }
        else if (face === 'SIDE') { p = { target: STARTER_C, dist: sd, polar: Math.PI / 2 - 0.05, azim: Math.PI / 2 }; }
        else if (face === 'TOP') { p = { target: STARTER_C, dist: sd, polar: 0.05, azim: 0 }; }
        else if (face === 'EXPLODED') { p = { target: [0.55, 0.35, -0.35], dist: 6.4, polar: 1.18, azim: 0.42 }; }
        else if (face === 'RESET') { p = CFG.presets.FULL; }
        else if (CFG.presets[face]) { p = CFG.presets[face]; }
        if (!p) return { ok: false };
        preset = p;
        setCameraFromPreset(preset);
        p6log('p6:camera', { face: face });
        return { ok: true, face: face };
    }
    function setCameraPreset(id) { return setCameraFace(id); }

    function modeName() {
        if (renderer) return contextLost ? '2D_FALLBACK' : '3D';
        return supportsWebGL() ? '3D' : '2D_FALLBACK';
    }

    /* Mode label: PILIHAN (bawaan: hanya terpilih / di-hover) -> SEMUA -> OFF. Mengembalikan true bila label tampil. */
    function toggleLabels(on) {
        if (on === undefined) {
            if (!labelsOn) { labelsOn = true; labelsAll = false; }
            else if (!labelsAll) { labelsAll = true; }
            else { labelsOn = false; labelsAll = false; }
        } else if (on) { if (!labelsOn) { labelsOn = true; labelsAll = false; } }
        else { labelsOn = false; labelsAll = false; }
        if (labels && labels.length) labels.forEach(function (l) { l.visible = labelsOn; });
        return labelsOn;
    }
    function labelBtnText() { return !labelsOn ? 'LABEL: OFF' : (labelsAll ? 'LABEL: SEMUA' : 'LABEL: PILIHAN'); }

    function toggleSound() {
        soundOn = !soundOn;
        if (soundOn) { try { var a = ensureAudio(); if (a && a.ctx.state === 'suspended') a.ctx.resume(); clickSound(2600, 0.04, 0.5); } catch (e) { /* noop */ } }
        p6log('p6:sound', { on: soundOn });
        return soundOn;
    }

    function toggleDebug() {
        debugMode = !debugMode;
        var el = G.document && G.document.getElementById ? G.document.getElementById('p6-debug') : null;
        if (el) { try { el.style.display = debugMode ? 'block' : 'none'; } catch (e) { /* noop */ } }
        return debugMode;
    }

    function fullscreen() {
        var el = G.document && G.document.getElementById ? G.document.getElementById('p6-canvas-wrap') : null;
        if (!el) return false;
        var e = el;
        if (e.requestFullscreen) { e.requestFullscreen(); return true; }
        return false;
    }

    function setSoundEnabled(on) { soundOn = !!on; return soundOn; }

    function reset3DScene() {
        resetStepState();
        setViewMode('NORMAL');
        setDisplayMode('COMBINED');
        setCameraFace('RESET');
        demoStop();
        teachingMode = false; exploreMode = true;
        paused3d = false;
        try { renderTeachPanel(); syncControls(); } catch (e) { /* noop */ }
        p6log('p6:reset');
        return { ok: true };
    }

    /* ---- animation kepercayaan animasi (prompt §41) ---- */
    function animateStarter(rpm) {
        return { kind: 'starter', rpm: safeNumber(rpm, 0), angle: rotationStep(cache.starterAngle, safeNumber(rpm, 0), 16, CFG.engine.animationScale) };
    }
    function animatePinion(position) { return { kind: 'pinion', position: clamp(position, 0, 1) }; }
    function animateFlywheel(rpm) { return { kind: 'flywheel', rpm: safeNumber(rpm, 0) }; }
    function animateCrankshaft(rpm) { return { kind: 'crankshaft', rpm: safeNumber(rpm, 0) }; }
    function animateSolenoid(state) { return { kind: 'solenoid', state: state }; }
    function animateRelay(state) { return { kind: 'relay', state: state }; }
    function animateCurrentFlow(current) { return { kind: 'current', current: safeNumber(current, 0), speed: particleSpeed(safeNumber(current, 0), 0, CFG.engine.maxCurrent) }; }
    function setCutawayMode(enabled) { return setViewMode(enabled ? 'CUTAWAY' : 'NORMAL'); }
    function setExplodedMode(enabled) { return setViewMode(enabled ? 'EXPLODED' : 'NORMAL'); }
    function inspectComponent(componentId) { return recordComponentInspection(componentId); }
    function highlightComponent(componentId) {
        focusComponent(componentId);
        return { ok: true, componentId: componentId };
    }

    /* ============================================================
       11. FRAME ADVANCE (dipakai loop browser dan pengujian _frame)
       ============================================================ */
    function frameAdvance(dtMs) {
        var dt = clamp(safeNumber(dtMs, 16), 0, CFG.engine.dtMaxMs);
        var anim = computeAnimationState();

        if (!paused3d) {
            var hyMs = CFG.engine.engageHystMs;
            var k = clamp(dt / hyMs, 0, 1);
            cache.relayV = lerp(cache.relayV, anim.relayTarget, k);
            cache.solenoidV = lerp(cache.solenoidV, anim.solenoidTarget, k);
            if (anim.solenoidTarget === 1 || anim.plungerTarget === 1) cache.plunger = lerp(cache.plunger, anim.plungerTarget, k);
            else cache.plunger = lerp(cache.plunger, 0, clamp(dt / (hyMs * 0.6), 0, 1));
            if (anim.pinionTarget === 1) cache.pinion = lerp(cache.pinion, 1, clamp(dt / (hyMs * 0.5), 0, 1));
            else cache.pinion = lerp(cache.pinion, 0, clamp(dt / (hyMs * 0.8), 0, 1));

            if (anim.spinning) {
                cache.starterAngle = rotationStep(cache.starterAngle, anim.starterRPM, dt, CFG.engine.animationScale);
                if (anim.engaged) cache.flyAngle = rotationStep(cache.flyAngle, anim.starterRPM / CFG.engine.starterToRing, dt, CFG.engine.animationScale);
                cache.crankAngle = cache.flyAngle;
            } else if (anim.running) {
                cache.engineAngle = rotationStep(cache.engineAngle, anim.engineRPM, dt, CFG.engine.animationScale);
                cache.flyAngle = cache.engineAngle;
                cache.crankAngle = cache.engineAngle;
                cache.starterAngle = 0;
                cache.pinion = lerp(cache.pinion, 0, 1);
            }

            if (anim.currentNorm > 0.001) {
                cache.heatMs += dt;
                cache.particleT += dt * (0.2 + anim.currentNorm * 1.6);
            } else {
                cache.heatMs = Math.max(0, cache.heatMs - dt * 2.2);
            }
        }

        applySceneState(anim);
        updateHud(anim);
        updateDemoProgress(dt);

        return {
            states: anim,
            cache: {
                starterAngle: cache.starterAngle, flyAngle: cache.flyAngle,
                crankAngle: cache.crankAngle, engineAngle: cache.engineAngle,
                plunger: cache.plunger, pinion: cache.pinion,
                relayV: cache.relayV, solenoidV: cache.solenoidV,
                heat: computeHeat(anim.current, cache.heatMs), heatMs: cache.heatMs
            }
        };
    }

    function getAnimationCache() {
        var anim = lastSnapshot ? computeAnimationState() : null;
        return {
            starterAngle: cache.starterAngle, flyAngle: cache.flyAngle,
            crankAngle: cache.crankAngle, engineAngle: cache.engineAngle,
            plunger: cache.plunger, pinion: cache.pinion,
            relayV: cache.relayV, solenoidV: cache.solenoidV,
            heat: lastSnapshot ? computeHeat(lastSnapshot.starterCurrent, cache.heatMs) : 0,
            heatMs: cache.heatMs, particleT: cache.particleT,
            currentNorm: anim ? anim.currentNorm : 0
        };
    }

    function updateDemoProgress(dt) {
        if (!demoState.active || !demoState.steps.length) return;
        demoState.t += dt;
        if (demoState.auto && demoHasNext() && demoState.t > 9000) { demoState.t = 0; demoState.index++; stepFocus(demoStepCurrent()); }
    }

    function stepFocus(step) {
        if (!step) return;
        if (step.focus && step.focus.length) {
            focusComponent(step.focus[0]);
            if (renderer && typeof flyToComponent === 'function') flyToComponent(step.focus[0]);
        }
        if (step.preset) setCameraFace(step.preset);
        updateTeachingUI();
    }

    /* ============================================================
       12. HUD + PANEL INFORMASI (mode agnostik; selalu tersedia)
       ============================================================ */
    function uiEl(id) {
        try { return G.document.getElementById(id); } catch (e) { return null; }
    }

    function updateHud(anim) {
        var now = nowMs();
        if (now - (updateHud._last || 0) < 240) return;
        updateHud._last = now;
        var el = uiEl('p6-hud');
        if (el) {
            var eng = anim.running ? Math.round(anim.engineRPM) : Math.round(anim.crankRPM);
            var html = '<div class="p6-hud-cell"><span>STATE</span><b>' + esc(anim.systemState) + '</b></div>'
                + '<div class="p6-hud-cell"><span>STARTER</span><b>' + Math.round(anim.starterRPM) + ' RPM</b></div>'
                + '<div class="p6-hud-cell"><span>CRANK/ENG</span><b>' + eng + ' RPM</b></div>'
                + '<div class="p6-hud-cell"><span>ARUS</span><b>' + Math.round(anim.current) + ' A</b></div>'
                + '<div class="p6-hud-cell"><span>V BATT</span><b>' + anim.batteryVoltage.toFixed(1) + ' V</b></div>'
                + '<div class="p6-hud-cell"><span>PINION</span><b>' + (anim.engaged ? 'IN' : 'OUT') + '</b></div>';
            if (html !== updateHud._hudHtml) { el.innerHTML = html; updateHud._hudHtml = html; }
        }
        var panel = uiEl('p6-info-panel');
        if (panel) {
            var panelHtml;
            var sel = selectedComponent;
            if (sel && COMPONENTS[sel]) {
                var rep = componentReport(sel);
                panelHtml = '<div class="p6-info-head">' + esc(rep.label) + '<span class="p6-info-en">' + esc(rep.en) + '</span></div>'
                    + '<div class="p6-info-row"><b>Fungsi</b>' + esc(rep.function) + '</div>'
                    + '<div class="p6-info-row"><b>Elektrik</b>' + esc(rep.electrical) + '</div>'
                    + '<div class="p6-info-row"><b>Mekanik</b>' + esc(rep.mechanical) + '</div>'
                    + (rep.value ? '<div class="p6-info-val">' + esc(JSON.stringify(rep.value)) + '</div>' : '')
                    + '<button class="btn-sm" onclick="Phase6.pickForMeasurement(\'' + esc(sel) + '\')">Ukur <div class="p6-prop">' + esc(probeForNext()) + '</div></button>'
                    + '<button class="btn-sm" onclick="Phase6.inspectComponent(\'' + esc(sel) + '\')">Catat Inspeksi</button>';
            } else {
                panelHtml = '<div class="p6-info-head">Starter System 3D</div>'
                    + '<div class="p6-info-row"><b>Tips</b>Klik komponen untuk inspeksi. Klik komponen di sisi kiri daftar untuk fokus kamera.</div>'
                    + '<div class="p6-info-row"><b>Mode</b>' + esc(modeName()) + (performanceMode ? ' · PERFORMANCE' : '') + ' · ' + esc(currentQuality) + '</div>'
                    + (anim.observed.length ? '<div class="p6-info-row p6-warn"><b>Gejala teramati</b>' + anim.observed.map(esc).join(', ') + '</div>' : '');
            }
            if (panelHtml !== updateHud._panelHtml) { panel.innerHTML = panelHtml; updateHud._panelHtml = panelHtml; }
        }
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    var selectedComponent = null;

    function focusComponent(componentId) {
        if (!COMPONENTS[componentId]) return { ok: false };
        selectedComponent = componentId;
        p6log('p6:focus', { componentId: componentId });
        uiLabelsHighlight(componentId);
        uiInfoHighlight(componentId);
        if (renderer) highlightMeshFor(componentId);
        return { ok: true, componentId: componentId };
    }

    function uiLabelsHighlight(id) {
        var c = uiEl('p6-components');
        if (!c) return;
        var btns = c.querySelectorAll ? c.querySelectorAll('button[data-cid]') : [];
        for (var i = 0; i < (btns || []).length; i++) {
            var b = btns[i];
            var v = b.getAttribute('data-cid') === id;
            if (v) b.classList.add('sel'); else b.classList.remove('sel');
        }
    }
    function uiInfoHighlight(id) {
        var el = uiEl('p6-line-' + id);
        if (el) { try { el.style.background = 'rgba(255,255,255,0.06)'; } catch (e) { /* noop */ } }
        var el2 = uiEl('p6-focus-' + id);
        if (el2) { try { el2.style.display = 'block'; } catch (e) { /* noop */ } }
    }

    var partsToggle = [];
    var labels = [];
    var renderer = null;
    var sceneObj = null;
    var camera3d = null;
    var shadowLight = null;
    var arrows3d = {};

    /* ============================================================
       13. RENDERER THREE.JS (hanya bila WebGL tersedia)
       ============================================================ */
    var canvasW = 800, canvasH = 480;
    var contextLost = false;
    /* Kamera orbit bebas.
       - cam* = nilai TUJUAN (diubah input mouse/touch/preset)
       - view = nilai TAMPIL yang dihaluskan tiap frame (gerak lembut + inersia) */
    var camDistBase = CFG.presets.FULL.dist;
    var camTarget = CFG.presets.FULL.target.slice();
    var camPolar = CFG.presets.FULL.polar;
    var camAzim = CFG.presets.FULL.azim;
    var view = { target: camTarget.slice(), dist: camDistBase, polar: camPolar, azim: camAzim };
    var camVel = { az: 0, pol: 0 };
    var autoRotate = false;
    var userDragging = false;
    var lastFrameTs = 0;
    var hoverCid = null;
    var STARTER_C = [0.45, 0.2, 0];

    function wrapAngle(a) {
        while (a > Math.PI) a -= 2 * Math.PI;
        while (a < -Math.PI) a += 2 * Math.PI;
        return a;
    }

    function setCameraFromPreset(p) {
        camTarget = (p.target || camTarget).slice();
        camDistBase = p.dist != null ? p.dist : camDistBase;
        camPolar = p.polar != null ? p.polar : camPolar;
        if (p.azim != null) camAzim = view.azim + wrapAngle(p.azim - view.azim);
        camVel.az = 0; camVel.pol = 0;
    }

    function pixelRatioFor(q) {
        var r = CFG.quality[q].pixelRatio * (G.devicePixelRatio || 1);
        if (performanceMode) r = Math.min(r, 0.8);
        return Math.min(2, Math.max(0.5, r));
    }

    function webglUnavailable() { return !supportsWebGL() || !HAS_THREE; }

    function linColor(hex) {
        var c = new THREE.Color(hex);
        if (typeof c.convertSRGBToLinear === 'function') c.convertSRGBToLinear();
        return c;
    }

    function buildEnvironment() {
        try {
            var pm = new THREE.PMREMGenerator(renderer);
            var es = new THREE.Scene();
            var g = new THREE.SphereGeometry(20, 32, 16);
            var pos = g.attributes.position, cols = [];
            for (var i = 0; i < pos.count; i++) {
                var t = pos.getY(i) / 20;
                var r, gg, b;
                if (t > 0) { r = lerp(0.32, 0.85, t); gg = lerp(0.34, 0.9, t); b = lerp(0.38, 1.0, t); }
                else { r = lerp(0.32, 0.05, -t); gg = lerp(0.34, 0.05, -t); b = lerp(0.38, 0.06, -t); }
                cols.push(r, gg, b);
            }
            g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
            es.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
            function panel(w, h, x, y, z, k) {
                var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
                m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m);
            }
            panel(12, 4, 0, 15, 5, 3.2);
            panel(6, 7, 13, 4, -5, 2.2);
            panel(7, 3, -13, 4, 7, 1.6);
            panel(5, 5, 2, 3, 14, 1.2);
            var tex = pm.fromScene(es, 0.035).texture;
            pm.dispose();
            return tex;
        } catch (e) { return null; }
    }

    function buildRenderer() {
        var parent = uiEl('p6-canvas');
        if (!parent) return false;
        if (webglUnavailable()) return false;
        var Q = CFG.quality[currentQuality];
        try {
            renderer = new THREE.WebGLRenderer({ antialias: Q.antialias, alpha: false, powerPreference: 'high-performance' });
        } catch (e) { renderer = null; return false; }
        renderer.setPixelRatio(pixelRatioFor(currentQuality));
        renderer.shadowMap.enabled = !!Q.shadows;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.localClippingEnabled = true;
        parent.appendChild(renderer.domElement);
        // SVG fallback 2D (kosong) berada di atas kanvas & menelan klik/geser -> sembunyikan di mode 3D
        var fb = uiEl('p6-fallback-svg');
        if (fb) fb.style.display = 'none';
        try {
            renderer.domElement.addEventListener('webglcontextlost', function (e) {
                e.preventDefault(); contextLost = true; p6log('p6:contextlost');
            }, false);
            renderer.domElement.addEventListener('webglcontextrestored', function () {
                contextLost = false; p6log('p6:contextrestored');
            }, false);
        } catch (e) { /* noop */ }
        syncCanvasSize();
        if (typeof ResizeObserver === 'function') {
            try { new ResizeObserver(function () { syncCanvasSize(); }).observe(parent); } catch (e) { /* noop */ }
        }

        sceneObj = new THREE.Scene();
        // warna clear tidak melalui encoding sRGB, warna fog melalui shader -> disamakan
        sceneObj.background = new THREE.Color(0x1d2530);
        sceneObj.fog = new THREE.Fog(linColor(0x1d2530).getHex(), 16, 38);
        camera3d = new THREE.PerspectiveCamera(42, canvasW / canvasH, 0.05, 200);
        applyCamera3d();

        envTex = buildEnvironment();
        if (envTex) sceneObj.environment = envTex;

        sceneObj.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a2118, 0.35));
        shadowLight = new THREE.DirectionalLight(0xffffff, 1.7);
        shadowLight.position.set(4, 9, 6);
        shadowLight.target.position.set(0.5, -1, -1);
        sceneObj.add(shadowLight.target);
        shadowLight.castShadow = !!Q.shadows;
        shadowLight.shadow.mapSize.set(currentQuality === 'HIGH' ? 2048 : 1024, currentQuality === 'HIGH' ? 2048 : 1024);
        var sc = shadowLight.shadow.camera;
        sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7; sc.near = 1; sc.far = 30;
        shadowLight.shadow.bias = -0.0006;
        shadowLight.shadow.normalBias = 0.02;
        sceneObj.add(shadowLight);
        var fill = new THREE.DirectionalLight(0x9fc3ff, 0.45);
        fill.position.set(-6, 3, 4);
        sceneObj.add(fill);
        var rim = new THREE.DirectionalLight(0xffe2c0, 0.7);
        rim.position.set(-2, 4, -8);
        sceneObj.add(rim);

        buildSceneGraph();
        buildParticles();
        buildLabels();
        bind3DEvents();
        buildOverlayUi();
        buildRotationArrows();
        buildLabExtras();
        applyRenderQuality();
        applyHighlights();
        /* model .glb eksternal tidak dimuat otomatis: kotak MODEL dihapus dari UI, 3D Lab memakai model simulasi */
        renderer.render(sceneObj, camera3d);
        return true;
    }

    function applyCamera3d(dtMs) {
        if (!camera3d) return;
        var L = CFG.cameraLimits;
        var instant = dtMs == null;
        var dt = instant ? 16 : dtMs;
        if (!userDragging && !instant) {
            if (Math.abs(camVel.az) > 1e-5 || Math.abs(camVel.pol) > 1e-5) {
                camAzim += camVel.az;
                camPolar += camVel.pol;
                var damp = Math.pow(0.9, dt / 16.7);
                camVel.az *= damp; camVel.pol *= damp;
            }
            if (autoRotate) camAzim += dt * 0.00022;
        }
        camDistBase = clamp(camDistBase, L.minDist, L.maxDist);
        camPolar = clamp(camPolar, L.polarMin, L.polarMax);
        camAzim = clamp(camAzim, L.azimLim[0], L.azimLim[1]);
        var k = instant ? 1 : 1 - Math.exp(-dt / 85);
        view.dist = lerp(view.dist, camDistBase, k);
        view.polar = lerp(view.polar, camPolar, k);
        view.azim = lerp(view.azim, camAzim, k);
        for (var i = 0; i < 3; i++) view.target[i] = lerp(view.target[i], camTarget[i], k);
        var sp = view.dist * Math.sin(view.polar);
        camera3d.position.set(
            view.target[0] + sp * Math.sin(view.azim),
            view.target[1] + view.dist * Math.cos(view.polar),
            view.target[2] + sp * Math.cos(view.azim)
        );
        camera3d.lookAt(view.target[0], view.target[1], view.target[2]);
    }

    function syncCanvasSize() {
        if (!renderer) return;
        var parent = uiEl('p6-canvas');
        var w = parent ? (parent.clientWidth || parent.offsetWidth || 0) : 0;
        var h = parent ? (parent.clientHeight || parent.offsetHeight || 0) : 0;
        if (w < 10 || h < 10) return; // tersembunyi: jangan ubah ukuran buffer
        if (w === canvasW && h === canvasH && renderer.domElement) return;
        canvasW = w;
        canvasH = h;
        renderer.setSize(w, h, false);
        if (camera3d) {
            camera3d.aspect = w / h;
            camera3d.updateProjectionMatrix();
        }
    }

    /* ============================================================
       13a. MATERIAL & GEOMETRI BANTU (model motor starter realistis)
       ------------------------------------------------------------
       Satuan: 1 unit ~ 100 mm. Sumbu motor starter = sumbu X.
       ============================================================ */
    var envTex = null;
    var MATS = {
        yoke:     [0x22262c, { metal: 0.55, rough: 0.36 }],
        alu:      [0xbfc4ca, { metal: 0.85, rough: 0.42 }],
        steel:    [0xd2d6db, { metal: 1.0, rough: 0.2 }],
        steelDk:  [0x7d848d, { metal: 0.95, rough: 0.34 }],
        zinc:     [0xd4d3c2, { metal: 0.9, rough: 0.3 }],
        copper:   [0xc8733a, { metal: 1.0, rough: 0.28 }],
        copperDk: [0xa1552a, { metal: 0.95, rough: 0.38 }],
        brass:    [0xcfa94f, { metal: 1.0, rough: 0.3 }],
        carbon:   [0x2f2f33, { metal: 0.1, rough: 0.9 }],
        bakelite: [0x1c1714, { metal: 0.0, rough: 0.5 }],
        phenolic: [0x6a4527, { metal: 0.0, rough: 0.6 }],
        mica:     [0x2b1a10, { metal: 0.0, rough: 0.6 }],
        rubber:   [0x131415, { metal: 0.0, rough: 0.85 }],
        castIron: [0x5d636b, { metal: 0.75, rough: 0.58 }],
        lamin:    [0x959ca5, { metal: 0.9, rough: 0.38 }],
        batt:     [0x23262b, { metal: 0.0, rough: 0.55 }],
        battLid:  [0x33373e, { metal: 0.0, rough: 0.5 }],
        red:      [0xd8322a, { metal: 0.0, rough: 0.4 }],
        cableRed: [0xc62a22, { metal: 0.0, rough: 0.45 }],
        cableBlk: [0x17181b, { metal: 0.0, rough: 0.5 }],
        cableYel: [0xd9a21b, { metal: 0.0, rough: 0.45 }],
        lead:     [0xa3a8ad, { metal: 0.9, rough: 0.4 }],
        plastic:  [0x2a2d33, { metal: 0.0, rough: 0.5 }],
        dash:     [0x3b414b, { metal: 0.05, rough: 0.55 }],
        chrome:   [0xe3e7ec, { metal: 1.0, rough: 0.12 }],
        floor:    [0x1b2028, { metal: 0.0, rough: 0.92 }]
    };
    var matCache = {};
    var CUT = { plane: null, mats: [] };

    /* mc(jenis, idKomponen, opsi) -> material per (jenis, komponen) agar highlight per komponen */
    function mc(kind, cid, extra) {
        var ex = extra || {};
        var key = kind + '|' + (cid || '') + '|' + (ex.key || '');
        if (matCache[key]) return matCache[key];
        var d = MATS[kind] || MATS.steel;
        var o = d[1];
        var m = new THREE.MeshStandardMaterial({
            color: linColor(ex.color != null ? ex.color : d[0]),
            metalness: ex.metal != null ? ex.metal : o.metal,
            roughness: ex.rough != null ? ex.rough : o.rough,
            side: ex.side || THREE.FrontSide,
            transparent: !!ex.transparent,
            opacity: ex.opacity != null ? ex.opacity : 1,
            flatShading: !!ex.flat
        });
        if (ex.map) m.map = ex.map;
        if (ex.transparent) m.depthWrite = !!ex.depthWrite;
        if (ex.emissive != null) { m.emissive = linColor(ex.emissive); m.emissiveIntensity = ex.ei != null ? ex.ei : 1; }
        m.userData.cid = cid || null;
        m.userData.baseEmissive = m.emissive.getHex();
        m.userData.baseEI = m.emissiveIntensity;
        if (ex.cut) { CUT.mats.push(m); m.side = THREE.DoubleSide; }
        matCache[key] = m;
        return m;
    }
    function shell(kind, cid) { return mc(kind, cid, { cut: true, key: 'cut' }); }

    function v3(p) { return new THREE.Vector3(p[0], p[1], p[2]); }

    var pickables = [];
    function mk(geo, material, cid, parent, pos, rot) {
        var m = new THREE.Mesh(geo, material);
        if (pos) m.position.set(pos[0], pos[1], pos[2]);
        if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
        m.castShadow = true;
        m.receiveShadow = true;
        if (cid) { m.userData.componentId = cid; pickables.push(m); }
        if (parent) parent.add(m);
        return m;
    }

    function segs(n) { return Math.max(10, Math.round(n * CFG.quality[currentQuality].segArc / 22)); }

    /* silinder sepanjang sumbu X: r1 = ujung -X, r2 = ujung +X */
    function cylX(r1, r2, x0, x1, n, open) {
        var g = new THREE.CylinderGeometry(r2, r1, Math.abs(x1 - x0), n || segs(40), 1, !!open);
        g.rotateZ(-Math.PI / 2);
        g.translate((x0 + x1) / 2, 0, 0);
        return g;
    }
    function invertGeo(g) {
        var nrm = g.attributes.normal;
        for (var i = 0; i < nrm.array.length; i++) nrm.array[i] = -nrm.array[i];
        if (g.index) {
            var ix = g.index.array;
            for (var j = 0; j < ix.length; j += 3) { var t = ix[j + 1]; ix[j + 1] = ix[j + 2]; ix[j + 2] = t; }
        }
        return g;
    }
    function hexX(r, x0, x1) { return cylX(r, r, x0, x1, 6); }

    /* tabung berdinding (cincin) sepanjang X -> group 4 permukaan, tepi tajam */
    function ringX(rIn, rOut, x0, x1, material, cid, parent, pos) {
        var grp = new THREE.Group();
        var n = segs(44);
        mk(cylX(rOut, rOut, x0, x1, n, true), material, cid, grp);
        mk(invertGeo(cylX(rIn, rIn, x0, x1, n, true)), material, cid, grp);
        var c0 = new THREE.RingGeometry(rIn, rOut, n, 1); c0.rotateY(-Math.PI / 2); c0.translate(x0, 0, 0);
        var c1 = new THREE.RingGeometry(rIn, rOut, n, 1); c1.rotateY(Math.PI / 2); c1.translate(x1, 0, 0);
        mk(c0, material, cid, grp); mk(c1, material, cid, grp);
        if (pos) grp.position.set(pos[0], pos[1], pos[2]);
        if (parent) parent.add(grp);
        return grp;
    }

    /* kulit hasil putar (lathe) dari profil [x, r] (belakang->depan) dengan tebal dinding */
    function latheShellX(outer, dr, dx, phiStart, phiLen, n) {
        var inner = outer.map(function (p) { return [p[0] + (dx || 0), Math.max(0.002, p[1] - dr)]; }).reverse();
        var prof = outer.concat(inner, [outer[0]]);
        var pts = prof.map(function (p) { return new THREE.Vector2(Math.max(0.001, p[1]), p[0]); });
        var g = new THREE.LatheGeometry(pts, n || segs(48), phiStart || 0, phiLen || Math.PI * 2);
        g.rotateZ(-Math.PI / 2);
        return g;
    }

    /* sektor cincin (pole shoe) : sudut a diukur pada bidang Y-Z (y = r cos a, z = r sin a) */
    function sectorGeo(rIn, rOut, a0, a1, x0, x1) {
        var sh = new THREE.Shape(), n = 12, i, a;
        function pt(r, ang, first) { var x = -r * Math.sin(ang), y = r * Math.cos(ang); if (first) sh.moveTo(x, y); else sh.lineTo(x, y); }
        for (i = 0; i <= n; i++) { a = a0 + (a1 - a0) * i / n; pt(rOut, a, i === 0); }
        for (i = n; i >= 0; i--) { a = a0 + (a1 - a0) * i / n; pt(rIn, a, false); }
        var g = new THREE.ExtrudeGeometry(sh, { depth: x1 - x0, bevelEnabled: false });
        g.rotateY(Math.PI / 2);
        g.translate(x0, 0, 0);
        return g;
    }

    /* roda gigi lurus (profil mendekati involute), sumbu X, lebar gigi = face */
    function gearGeo(teeth, m, face, boreR, xc) {
        var rp = m * teeth / 2, ra = rp + m, rf = rp - 1.25 * m;
        var sh = new THREE.Shape(), p = 2 * Math.PI / teeth;
        for (var i = 0; i < teeth; i++) {
            var c = i * p;
            var pts = [[c - 0.5 * p, rf], [c - 0.29 * p, rf], [c - 0.22 * p, rf + 0.55 * (rp - rf)], [c - 0.18 * p, rp], [c - 0.12 * p, ra], [c + 0.12 * p, ra], [c + 0.18 * p, rp], [c + 0.22 * p, rf + 0.55 * (rp - rf)], [c + 0.29 * p, rf]];
            for (var j = 0; j < pts.length; j++) {
                var x = Math.cos(pts[j][0]) * pts[j][1], y = Math.sin(pts[j][0]) * pts[j][1];
                if (i === 0 && j === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
            }
        }
        sh.closePath();
        if (boreR) { var h = new THREE.Path(); h.absarc(0, 0, boreR, 0, Math.PI * 2, true); sh.holes.push(h); }
        var g = new THREE.ExtrudeGeometry(sh, { depth: face, bevelEnabled: false, curveSegments: boreR > 1 ? 120 : 24 });
        g.translate(0, 0, -face / 2);
        g.rotateY(Math.PI / 2);
        g.translate(xc || 0, 0, 0);
        return g;
    }

    /* inti armatur berlapis (laminasi) dengan alur (slot) semi-tertutup */
    function slottedCoreGeo(slots, rO, rI, slotFrac, x0, x1, bore) {
        var sh = new THREE.Shape(), p = 2 * Math.PI / slots, sw = p * slotFrac, first = true;
        function add(a, r) { var x = Math.cos(a) * r, y = Math.sin(a) * r; if (first) { sh.moveTo(x, y); first = false; } else sh.lineTo(x, y); }
        for (var i = 0; i < slots; i++) {
            var c = i * p, a0 = c - sw / 2, a1 = c + sw / 2;
            add(a0 + sw * 0.28, rO); add(a0 + sw * 0.28, rO - 0.012); add(a0, rO - 0.022); add(a0, rI);
            add(a1, rI); add(a1, rO - 0.022); add(a1 - sw * 0.28, rO - 0.012); add(a1 - sw * 0.28, rO);
            var nx = (i + 1) * p - sw / 2 + sw * 0.28;
            for (var k = 1; k < 4; k++) add(a1 - sw * 0.28 + (nx - (a1 - sw * 0.28)) * k / 4, rO);
        }
        sh.closePath();
        if (bore) { var h = new THREE.Path(); h.absarc(0, 0, bore, 0, Math.PI * 2, true); sh.holes.push(h); }
        var g = new THREE.ExtrudeGeometry(sh, { depth: x1 - x0, bevelEnabled: false, curveSegments: 16 });
        g.rotateY(Math.PI / 2);
        g.translate(x0, 0, 0);
        return g;
    }

    function tube(points, r, material, cid, parent, closed, tubSeg, radSeg) {
        var curve = new THREE.CatmullRomCurve3(points.map(v3), !!closed, 'catmullrom', 0.5);
        var m = mk(new THREE.TubeGeometry(curve, tubSeg || 48, r, radSeg || 10, !!closed), material, cid, parent);
        return { curve: curve, mesh: m };
    }

    /* titik pegas ulir: sepanjang sumbu 'ax' (0=x,1=y) */
    function helixPts(a0, a1, rad, turns, ax, c) {
        var out = [], n = Math.round(turns * 14);
        for (var i = 0; i <= n; i++) {
            var t = i / n, ang = t * turns * 2 * Math.PI, s = a0 + (a1 - a0) * t;
            if (ax === 0) out.push([s, c[1] + rad * Math.cos(ang), c[2] + rad * Math.sin(ang)]);
            else out.push([c[0] + rad * Math.cos(ang), s, c[2] + rad * Math.sin(ang)]);
        }
        return out;
    }

    function textTexture(w, h, draw) {
        var c = null;
        try { c = G.document.createElement('canvas'); } catch (e) { return null; }
        c.width = w; c.height = h;
        var g = c.getContext('2d');
        if (!g) return null;
        draw(g, w, h);
        var t = new THREE.CanvasTexture(c);
        t.encoding = THREE.sRGBEncoding;
        t.anisotropy = 4;
        return t;
    }

    /* ---- titik jangkar label ---- */
    var anchors = {};
    function anchor(key, obj, local, text, minor) {
        if (anchors[key]) return;
        anchors[key] = { cid: minor ? null : key, owner: minor ? String(minor) : key, obj: obj, local: v3(local), text: text || (COMPONENTS[key] ? COMPONENTS[key].label : key), minor: !!minor };
    }

    var G3D = { starter: null, armature: null, flywheelGroup: null, crankGroup: null, piston: null, pistonRod: null, solenoid: null, relay: null, batteryMesh: null, pinionGroup: null, plunger: null, relayLeaf: null, fuseBox: null, ignition: null, ignKey: null, cables: [], explodeHide: [] };

    /* ============================================================
       13b. SCENE GRAPH - MOTOR STARTER TIPE KONVENSIONAL
       (yoke + 4 kutub medan, armatur, komutator, 4 sikat, rumah
        depan & tutup belakang, solenoid di atas, tuas penggeser,
        kopling satu arah + pinion 10 gigi <-> ring gear 150 gigi)
       ============================================================ */
    function buildSceneGraph() {
        var root = new THREE.Group();
        root.name = 'starter3d';
        sceneObj.add(root);
        CUT.plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

        var starter = new THREE.Group();
        starter.name = 'starterMotor';
        root.add(starter);
        G3D.starter = starter;

        buildRearCover(starter);
        buildBrushes(starter);
        buildYoke(starter);
        buildArmature(starter);
        buildDriveHousing(starter);
        buildPinionClutch(starter);
        buildLever(starter);
        buildSolenoid(starter);
        buildEngine(root);
        buildBatteryAndRelay(root);
        buildFuseBox(root);
        buildIgnitionSwitch(root);
        buildCables(root);

        var floorG = new THREE.PlaneGeometry(40, 40);
        floorG.rotateX(-Math.PI / 2);
        var floor = mk(floorG, mc('floor'), null, root, [0, -2.62, 0]);
        floor.castShadow = false;
        var grid = new THREE.GridHelper(24, 24, 0x35506a, 0x243445);
        grid.position.y = -2.615;
        if (grid.material) { grid.material.transparent = true; grid.material.opacity = 0.55; }
        root.add(grid);

        partsToggle.push({ obj: arrowGroupRef });
    }

    function buildRearCover(parent) {
        var g = new THREE.Group(); g.name = 'rearCover'; parent.add(g); G3D.rear = g;
        var cid = 'rearCover';
        var outer = [[-0.75, 0.455], [-0.8, 0.455], [-0.85, 0.44], [-0.885, 0.4], [-0.9, 0.3], [-0.905, 0.2], [-0.915, 0.15], [-0.99, 0.14], [-1.03, 0.12], [-1.04, 0.085]];
        mk(latheShellX(outer, 0.03, 0.02), shell('alu', cid), cid, g);
        // baut penutup bushing
        mk(cylX(0.14, 0.14, -0.93, -0.915, segs(30)), mc('alu', cid), cid, g);
        anchor(cid, g, [-0.97, 0.12, 0.08]);
        anchor('m:bushRear', g, [-1.04, 0.05, 0.05], 'Bushing belakang', 'rearCover');
    }

    function buildBrushes(parent) {
        var g = new THREE.Group(); g.name = 'brushPlate'; parent.add(g); G3D.brushPlate = g;
        var cidP = 'starterBrushes';
        ringX(0.12, 0.42, -0.8, -0.775, mc('phenolic', cidP), cidP, g);
        var holderM = mc('brass', cidP), brushM = mc('carbon', cidP), springM = mc('steel', cidP, { key: 'spring' }), pigM = mc('copper', cidP, { key: 'pig' }), insM = mc('bakelite', cidP);
        for (var i = 0; i < 4; i++) {
            var a = i * Math.PI / 2;
            var asm = new THREE.Group(); asm.rotation.x = a; g.add(asm);
            // dudukan sikat (dua dinding + punggung)
            mk(new THREE.BoxGeometry(0.2, 0.15, 0.012), holderM, cidP, asm, [-0.67, 0.265, 0.052]);
            mk(new THREE.BoxGeometry(0.2, 0.15, 0.012), holderM, cidP, asm, [-0.67, 0.265, -0.052]);
            mk(new THREE.BoxGeometry(0.012, 0.15, 0.104), holderM, cidP, asm, [-0.765, 0.265, 0]);
            if (i % 2 === 0) mk(new THREE.BoxGeometry(0.03, 0.05, 0.13), insM, cidP, asm, [-0.77, 0.33, 0]);
            // sikat karbon
            mk(new THREE.BoxGeometry(0.085, 0.1, 0.088), brushM, cidP, asm, [-0.61, 0.222, 0]);
            // pegas penekan
            tube(helixPts(0.272, 0.335, 0.022, 4, 1, [-0.61, 0, 0]), 0.0055, springM, cidP, asm, false, 64, 5);
            // kabel pigtail
            tube([[-0.6, 0.27, 0.03], [-0.64, 0.33, 0.07], [-0.72, 0.36, 0.07], [-0.77, 0.37, 0.04]], 0.009, pigM, cidP, asm, false, 20, 6);
        }
        anchor(cidP, g, [-0.61, 0.0, 0.27]);
    }

    function buildYoke(parent) {
        var g = new THREE.Group(); g.name = 'yoke'; parent.add(g); G3D.yoke = g;
        var cid = 'starterHousing';
        ringX(0.41, 0.45, -0.75, 0.75, shell('yoke', cid), cid, g);
        // bibir ujung yoke
        ringX(0.44, 0.458, -0.75, -0.72, shell('steelDk', cid), cid, g);
        ringX(0.44, 0.458, 0.72, 0.75, shell('steelDk', cid), cid, g);
        // pelat nama
        var tex = textTexture(512, 192, function (c, w, h) {
            c.fillStyle = '#c9ccd1'; c.fillRect(0, 0, w, h);
            c.strokeStyle = '#555'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
            c.fillStyle = '#1b1f24'; c.font = 'bold 50px sans-serif'; c.fillText('STARTER MOTOR', 26, 72);
            c.font = '36px sans-serif'; c.fillText('12 V  ·  1.2 kW  ·  10T', 26, 128);
            c.font = '26px sans-serif'; c.fillText('MODEL EDUKASI SMK', 26, 168);
        });
        if (tex) {
            var np = mk(new THREE.PlaneGeometry(0.46, 0.17), mc('alu', cid, { key: 'plate', map: tex, metal: 0.4, rough: 0.5, color: 0xffffff }), cid, g, [-0.1, -0.02, 0.452]);
            np.castShadow = false;
            CUT.mats.push(np.material);
        }
        // kutub (pole shoe) dan lilitan medan
        var poleM = mc('steelDk', 'fieldCoil'), coilM = mc('copper', 'fieldCoil'), coilM2 = mc('copperDk', 'fieldCoil');
        for (var i = 0; i < 4; i++) {
            var a = i * Math.PI / 2;
            mk(sectorGeo(0.302, 0.411, a - 0.42, a + 0.42, -0.34, 0.44), poleM, 'fieldCoil', g);
            [[0.372, 0.52, 0.036, coilM], [0.352, 0.45, 0.03, coilM2]].forEach(function (L) {
                var r = L[0], da = L[1], x0 = -0.4, x1 = 0.5, pts = [], n, t;
                for (n = 0; n <= 6; n++) { t = n / 6; pts.push([x0 + (x1 - x0) * t, r * Math.cos(a - da), r * Math.sin(a - da)]); }
                for (n = 1; n <= 5; n++) { t = -da + 2 * da * n / 6; pts.push([x1 + 0.03 * Math.sin(Math.PI * n / 6), r * Math.cos(a + t), r * Math.sin(a + t)]); }
                for (n = 0; n <= 6; n++) { t = n / 6; pts.push([x1 - (x1 - x0) * t, r * Math.cos(a + da), r * Math.sin(a + da)]); }
                for (n = 1; n <= 5; n++) { t = da - 2 * da * n / 6; pts.push([x0 - 0.03 * Math.sin(Math.PI * n / 6), r * Math.cos(a + t), r * Math.sin(a + t)]); }
                tube(pts, L[2], L[3], 'fieldCoil', g, true, 90, 8);
            });
        }
        // baut panjang (through bolt)
        [Math.PI / 4, Math.PI * 5 / 4].forEach(function (a) {
            var y = 0.37 * Math.cos(a), z = 0.37 * Math.sin(a);
            mk(cylX(0.018, 0.018, -0.9, 0.9, 10), mc('steel', cid, { key: 'bolt' }), cid, g, [0, y, z]);
            mk(hexX(0.038, -0.925, -0.886), mc('steel', cid, { key: 'bolt' }), cid, g, [0, y, z]);
        });
        // grommet karet kabel medan
        var ga = -0.75, gdir = new THREE.Vector3(0, Math.cos(ga), Math.sin(ga));
        var grom = mk(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 16), mc('rubber', 'fieldCoil'), 'fieldCoil', g);
        grom.position.set(-0.3, 0.45 * gdir.y, 0.45 * gdir.z);
        grom.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), gdir);
        anchor(cid, g, [-0.45, 0.25, 0.37]);
        anchor('fieldCoil', g, [0.53, 0.0, 0.372]);
        anchor('m:pole', g, [0.05, 0.0, 0.305], 'Kutub magnet (pole shoe)', 'fieldCoil');
    }

    function buildArmature(parent) {
        var arm = new THREE.Group(); arm.name = 'armature'; parent.add(arm); G3D.armature = arm;
        var ref = new THREE.Group(); parent.add(ref); // jangkar label statis (tidak ikut berputar)
        var cidA = 'starterArmature', cidC = 'starterCommutator', cidS = 'starterShaft';
        // poros + spline heliks
        mk(cylX(0.055, 0.055, -1.08, 2.1, segs(24)), mc('steel', cidS), cidS, arm);
        for (var s = 0; s < 8; s++) {
            var sa = s * Math.PI / 4;
            mk(new THREE.BoxGeometry(0.42, 0.012, 0.018), mc('steel', cidS), cidS, arm, [1.3, 0.058 * Math.cos(sa), 0.058 * Math.sin(sa)], [sa + 0.25, 0, 0]);
        }
        // inti berlapis + konduktor di alur
        var slots = 18, rO = 0.29, rI = 0.212, frac = 0.36;
        mk(slottedCoreGeo(slots, rO, rI, frac, -0.38, 0.46, 0.055), mc('lamin', cidA), cidA, arm);
        for (var l = 0; l < 7; l++) mk(cylX(0.2915, 0.2915, -0.33 + l * 0.12, -0.327 + l * 0.12, segs(40), true), mc('steelDk', cidA, { key: 'lam', side: THREE.DoubleSide }), cidA, arm);
        var cu = mc('copper', cidA);
        var pw = 2 * 0.25 * Math.sin((2 * Math.PI / slots) * frac / 2) * 0.86;
        for (var i = 0; i < slots; i++) {
            var a = i * 2 * Math.PI / slots;
            var ang = Math.atan2(Math.sin(a), Math.cos(a));
            // alur pada shape: sudut a dari sumbu +X shape -> y = r sin a (shape y), z = -r cos a
            var yy = Math.sin(ang), zz = -Math.cos(ang);
            var rr = (rI + rO - 0.022) / 2;
            var cb = mk(new THREE.BoxGeometry(0.94, rO - 0.024 - rI, pw), cu, cidA, arm, [0.04, rr * yy, rr * zz]);
            cb.rotation.x = Math.atan2(zz, yy);
        }
        // kepala lilitan (end turn)
        var et1 = new THREE.TorusGeometry(0.212, 0.055, 12, segs(40)); et1.rotateY(Math.PI / 2); et1.translate(-0.43, 0, 0);
        var et2 = new THREE.TorusGeometry(0.212, 0.055, 12, segs(40)); et2.rotateY(Math.PI / 2); et2.translate(0.51, 0, 0);
        mk(et1, mc('copperDk', cidA), cidA, arm); mk(et2, mc('copperDk', cidA), cidA, arm);
        // komutator (segmen tembaga + isolator mika)
        mk(cylX(0.168, 0.168, -0.74, -0.49, segs(40)), mc('copper', cidC), cidC, arm);
        mk(cylX(0.2, 0.2, -0.49, -0.455, segs(40)), mc('copperDk', cidC), cidC, arm);
        for (var k = 0; k < slots; k++) {
            var b = k * 2 * Math.PI / slots + Math.PI / slots;
            mk(new THREE.BoxGeometry(0.25, 0.012, 0.009), mc('mica', cidC), cidC, arm, [-0.615, 0.166 * Math.cos(b), 0.166 * Math.sin(b)], [b, 0, 0]);
            mk(new THREE.BoxGeometry(0.045, 0.03, 0.012), mc('mica', cidC), cidC, arm, [-0.472, 0.196 * Math.cos(b), 0.196 * Math.sin(b)], [b, 0, 0]);
        }
        anchor(cidA, ref, [0.1, 0.205, 0.205]);
        anchor(cidC, ref, [-0.66, 0.12, 0.12]);
        anchor(cidS, ref, [2.1, 0.05, 0]);
        anchor('m:lam', ref, [0.3, -0.205, 0.205], 'Inti besi berlapis (laminasi)', 'starterArmature');
    }

    function buildDriveHousing(parent) {
        var g = new THREE.Group(); g.name = 'driveHousing'; parent.add(g); G3D.drive = g;
        var cid = 'driveHousing';
        var m = shell('alu', cid);
        mk(latheShellX([[0.745, 0.458], [0.95, 0.458], [1.1, 0.445], [1.3, 0.405], [1.46, 0.365]], 0.03, 0), m, cid, g);
        // bagian hidung dengan jendela terbuka ke arah ring gear (-Z)
        var win = 70 * Math.PI / 180;
        mk(latheShellX([[1.45, 0.366], [1.6, 0.335], [1.8, 0.3], [1.95, 0.26], [2.0, 0.2], [2.03, 0.14]], 0.03, 0, Math.PI + win, 2 * Math.PI - 2 * win), m, cid, g);
        ringX(0.058, 0.115, 1.98, 2.07, mc('alu', cid), cid, g);
        // flens dudukan + telinga baut
        ringX(0.3, 0.52, 0.86, 0.93, m, cid, g);
        [0.35, Math.PI + 0.35].forEach(function (a) {
            var sh = new THREE.Shape();
            sh.moveTo(-0.1, 0.42); sh.lineTo(-0.1, 0.62); sh.absarc(0, 0.62, 0.1, Math.PI, 0, true); sh.lineTo(0.1, 0.42); sh.closePath();
            var hole = new THREE.Path(); hole.absarc(0, 0.62, 0.045, 0, Math.PI * 2, true); sh.holes.push(hole);
            var eg = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: false, curveSegments: 16 });
            eg.rotateY(Math.PI / 2); eg.translate(0.86, 0, 0);
            var ear = mk(eg, mc('alu', cid), cid, g); ear.rotation.x = a;
        });
        // rumah tuas + dudukan solenoid
        mk(new THREE.BoxGeometry(0.3, 0.6, 0.3), m, cid, g, [1.22, 0.58, 0]);
        mk(new THREE.BoxGeometry(0.56, 0.1, 0.26), mc('alu', cid), cid, g, [0.8, 0.47, 0]);
        // pin engsel tuas
        mk(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 12), mc('steel', 'shiftLever', { key: 'pin' }), 'shiftLever', g, [1.21, 0.45, 0], [Math.PI / 2, 0, 0]);
        anchor(cid, g, [1.72, 0.26, 0.12]);
        anchor('m:window', g, [1.8, -0.05, -0.27], 'Jendela pinion (ke ring gear)', 'driveHousing');
    }

    function buildPinionClutch(parent) {
        var slide = new THREE.Group(); slide.name = 'pinionSlide'; parent.add(slide);
        var spin = new THREE.Group(); spin.name = 'pinionSpin'; slide.add(spin);
        G3D.pinionGroup = slide; G3D.pinionSpin = spin;
        var cidK = 'overrunningClutch', cidP = 'starterPinion';
        // selongsong penggerak + alur garpu
        mk(cylX(0.1, 0.1, 1.13, 1.29, segs(30)), mc('steel', cidK), cidK, spin);
        mk(cylX(0.16, 0.16, 1.13, 1.16, segs(30)), mc('steelDk', cidK), cidK, spin);
        mk(cylX(0.16, 0.16, 1.26, 1.29, segs(30)), mc('steelDk', cidK), cidK, spin);
        // rumah kopling (dipotong saat cutaway -> roller terlihat)
        ringX(0.165, 0.2, 1.29, 1.52, shell('steelDk', cidK), cidK, spin);
        mk(cylX(0.2, 0.12, 1.52, 1.555, segs(30)), mc('steelDk', cidK), cidK, spin);
        mk(cylX(0.085, 0.085, 1.3, 1.51, segs(24)), mc('steel', cidK, { key: 'hub' }), cidK, spin);
        for (var r = 0; r < 5; r++) {
            var a = r * 2 * Math.PI / 5;
            mk(cylX(0.03, 0.03, 1.32, 1.49, 12), mc('steel', cidK, { key: 'roll' }), cidK, spin, [0, 0.125 * Math.cos(a), 0.125 * Math.sin(a)]);
            tube(helixPts(1.34, 1.47, 0.012, 5, 0, [0, 0.125 * Math.cos(a + 0.45), 0.125 * Math.sin(a + 0.45)]), 0.004, mc('steel', cidK, { key: 'spring' }), cidK, spin, false, 60, 4);
        }
        // pinion 10 gigi (modul 0.032 -> diameter pitch 0.32)
        mk(gearGeo(10, 0.032, 0.17, 0.055, 1.64), mc('steel', cidP, { key: 'gear', rough: 0.28 }), cidP, spin);
        anchor(cidP, slide, [1.64, 0.19, 0.04]);
        anchor(cidK, slide, [1.4, 0.2, 0.03]);
        anchor('m:rollers', slide, [1.4, 0.125, 0.0], 'Roller kopling', 'overrunningClutch');
    }

    function buildLever(parent) {
        var base = new THREE.Group(); base.name = 'leverBase'; base.position.set(1.21, 0.45, 0); parent.add(base);
        var lev = new THREE.Group(); lev.name = 'shiftLever'; base.add(lev);
        G3D.leverBase = base; G3D.lever = lev;
        var cid = 'shiftLever', m = mc('steelDk', cid, { key: 'lev', metal: 0.8, rough: 0.45 });
        mk(new THREE.BoxGeometry(0.04, 0.32, 0.07), m, cid, lev, [0, 0.1, 0]);
        mk(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10), mc('steel', cid, { key: 'pin' }), cid, lev, [0, 0.26, 0], [Math.PI / 2, 0, 0]);
        mk(new THREE.BoxGeometry(0.04, 0.2, 0.07), m, cid, lev, [0, -0.13, 0]);
        mk(new THREE.BoxGeometry(0.04, 0.05, 0.3), m, cid, lev, [0, -0.245, 0]);
        [0.13, -0.13].forEach(function (z) {
            mk(new THREE.BoxGeometry(0.04, 0.22, 0.035), m, cid, lev, [0, -0.36, z]);
            mk(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 8), mc('steel', cid, { key: 'pin' }), cid, lev, [0, -0.45, z * 0.85], [Math.PI / 2, 0, 0]);
        });
        anchor(cid, base, [0.03, 0.1, 0.16]);
    }

    function buildSolenoid(parent) {
        var g = new THREE.Group(); g.name = 'solenoid'; g.position.set(0, 0.71, 0); parent.add(g);
        G3D.solenoid = g;
        var cid = 'starterSolenoid';
        ringX(0.215, 0.24, -0.02, 1.08, shell('zinc', cid), cid, g);
        ringX(0.105, 0.24, 1.06, 1.085, shell('zinc', cid), cid, g);
        ringX(0.232, 0.252, -0.045, 0.0, mc('zinc', cid, { key: 'crimp' }), cid, g);
        // tutup terminal (bakelit)
        mk(latheShellX([[-0.02, 0.232], [-0.07, 0.228], [-0.11, 0.2], [-0.13, 0.13], [-0.138, 0.001]], 0.022, 0.018), shell('bakelite', cid), cid, g);
        // kumparan pull-in & hold-in + selongsong kuningan
        ringX(0.118, 0.16, 0.22, 1.0, mc('copper', cid), cid, g);
        ringX(0.16, 0.205, 0.22, 1.0, mc('copperDk', cid), cid, g);
        ringX(0.105, 0.116, 0.22, 1.06, mc('brass', cid), cid, g);
        // terminal 30 (B) dan C (M): baut kuningan + mur + kepala kontak di dalam
        var tB = [0.055, 0.11], tC = [0.055, -0.11];
        [tB, tC].forEach(function (t) {
            mk(cylX(0.03, 0.03, -0.27, 0.03), mc('brass', cid, { key: 'stud' }), cid, g, [0, t[0], t[1]]);
            mk(hexX(0.056, -0.205, -0.17), mc('steel', cid, { key: 'nut' }), cid, g, [0, t[0], t[1]]);
            mk(cylX(0.07, 0.07, -0.168, -0.155, 20), mc('steel', cid, { key: 'nut' }), cid, g, [0, t[0], t[1]]);
            mk(cylX(0.05, 0.05, -0.005, 0.03, 20), mc('copper', cid, { key: 'contact' }), cid, g, [0, t[0], t[1]]);
        });
        // terminal 50 (ST) - sekun kecil
        mk(cylX(0.016, 0.016, -0.2, -0.1), mc('brass', cid, { key: 'stud' }), cid, g, [0, -0.11, 0]);
        mk(new THREE.BoxGeometry(0.1, 0.012, 0.055), mc('brass', cid, { key: 'stud' }), cid, g, [-0.24, -0.11, 0]);
        // plunger bergerak: batang pendorong + plat kontak + pegas
        var pl = new THREE.Group(); pl.name = 'plunger'; g.add(pl); G3D.plunger = pl;
        mk(cylX(0.1, 0.1, 0.48, 1.2, segs(28)), mc('steel', cid, { key: 'plunger' }), cid, pl);
        mk(new THREE.BoxGeometry(0.08, 0.05, 0.1), mc('steel', cid, { key: 'plunger' }), cid, pl, [1.225, 0, 0]);
        mk(cylX(0.02, 0.02, 0.18, 0.48, 10), mc('steel', cid, { key: 'plunger' }), cid, pl);
        mk(cylX(0.155, 0.155, 0.155, 0.18, segs(30)), mc('copper', cid, { key: 'plate' }), cid, pl);
        tube(helixPts(1.09, 1.19, 0.118, 5, 0, [0, 0, 0]), 0.008, mc('steel', cid, { key: 'spring' }), cid, pl, false, 90, 5);
        anchor(cid, g, [0.55, 0.17, 0.17]);
        anchor('m:t30', g, [-0.27, 0.055, 0.11], 'Terminal 30 (B+ baterai)', 'starterSolenoid');
        anchor('m:tC', g, [-0.27, 0.055, -0.11], 'Terminal C / M (ke motor)', 'starterSolenoid');
        anchor('m:t50', g, [-0.28, -0.11, 0], 'Terminal 50 (ST, kunci kontak)', 'starterSolenoid');
        anchor('m:plunger', pl, [0.85, 0.1, 0], 'Plunger', 'starterSolenoid');
        anchor('m:plate', pl, [0.165, 0.155, 0], 'Plat kontak utama', 'starterSolenoid');
        anchor('m:coil', g, [0.55, 0.205, 0.0], 'Kumparan pull-in & hold-in', 'starterSolenoid');
        // strip tembaga terminal C -> lilitan medan (jalur arus motor)
        G3D.motorStrap = tube([[-0.27, 0.765, -0.11], [-0.34, 0.74, -0.2], [-0.37, 0.58, -0.3], [-0.3, 0.33, -0.32]], 0.022, mc('copper', 'fieldCoil', { key: 'strap' }), 'fieldCoil', parent, false, 40, 8);
        G3D.explodeHide.push(G3D.motorStrap.mesh);
    }

    function buildEngine(root) {
        var eng = new THREE.Group(); eng.name = 'engine'; eng.position.set(0, 0, -2.56); root.add(eng);
        G3D.engine = eng; G3D.explodeHide.push(eng);
        // flywheel + ring gear (berputar bersama)
        var fly = new THREE.Group(); fly.name = 'flywheel'; eng.add(fly);
        G3D.flywheelGroup = fly;
        mk(gearGeo(150, 0.032, 0.16, 2.2, 1.82), mc('steel', 'ringGear', { key: 'gear', rough: 0.32 }), 'ringGear', fly);
        var sh = new THREE.Shape(); sh.absarc(0, 0, 2.21, 0, Math.PI * 2, false);
        var hc = new THREE.Path(); hc.absarc(0, 0, 0.2, 0, Math.PI * 2, true); sh.holes.push(hc);
        for (var i = 0; i < 6; i++) {
            var a = i * Math.PI / 3 + Math.PI / 6;
            var h1 = new THREE.Path(); h1.absarc(1.3 * Math.cos(a), 1.3 * Math.sin(a), 0.3, 0, Math.PI * 2, true); sh.holes.push(h1);
            var h2 = new THREE.Path(); h2.absarc(0.45 * Math.cos(a + 0.5), 0.45 * Math.sin(a + 0.5), 0.05, 0, Math.PI * 2, true); sh.holes.push(h2);
        }
        var fg = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: false, curveSegments: 40 });
        fg.rotateY(Math.PI / 2); fg.translate(1.86, 0, 0);
        mk(fg, mc('castIron', 'flywheel'), 'flywheel', fly);
        ringX(2.03, 2.2, 1.74, 1.96, mc('castIron', 'flywheel', { key: 'rim' }), 'flywheel', fly);
        mk(new THREE.BoxGeometry(0.02, 0.2, 0.05), mc('red', 'flywheel', { key: 'mark', emissive: 0x551111, ei: 0.4 }), 'flywheel', fly, [1.735, 2.12, 0]);
        // crankshaft (poros engkol) + lengan + crankpin
        var crank = new THREE.Group(); crank.name = 'crankshaft'; eng.add(crank); G3D.crankGroup = crank;
        var cc = 'crankshaft', cm = mc('steel', cc), cw = mc('steelDk', cc);
        mk(cylX(0.32, 0.32, 1.96, 2.06, segs(36)), cw, cc, crank);
        mk(cylX(0.12, 0.12, 2.06, 2.82, segs(28)), cm, cc, crank);
        mk(new THREE.BoxGeometry(0.1, 0.78, 0.36), cw, cc, crank, [2.85, 0.1, 0]);
        mk(cylX(0.1, 0.1, 2.9, 3.1, segs(24)), cm, cc, crank, [0, 0.35, 0]);
        mk(new THREE.BoxGeometry(0.1, 0.78, 0.36), cw, cc, crank, [3.15, 0.1, 0]);
        mk(cylX(0.12, 0.12, 3.2, 3.85, segs(28)), cm, cc, crank);
        // batang piston + piston
        var rod = new THREE.Group(); rod.position.set(3.0, 0, 0); eng.add(rod); G3D.pistonRod = rod;
        var pc = 'piston', pm = mc('steelDk', pc, { key: 'rod' });
        mk(new THREE.BoxGeometry(0.07, 0.8, 0.05), pm, pc, rod);
        var be = new THREE.TorusGeometry(0.12, 0.035, 10, 24); be.rotateY(Math.PI / 2); be.translate(0, -0.525, 0);
        var se = new THREE.TorusGeometry(0.065, 0.025, 8, 20); se.rotateY(Math.PI / 2); se.translate(0, 0.525, 0);
        mk(be, pm, pc, rod); mk(se, pm, pc, rod);
        var pis = new THREE.Group(); pis.position.set(3.0, 1.1, 0); eng.add(pis); G3D.piston = pis;
        mk(new THREE.CylinderGeometry(0.3, 0.3, 0.36, segs(36)), mc('alu', pc), pc, pis, [0, 0.1, 0]);
        [0.21, 0.16].forEach(function (y) {
            var rg = new THREE.TorusGeometry(0.301, 0.008, 6, segs(36)); rg.rotateX(Math.PI / 2);
            mk(rg, mc('steelDk', pc, { key: 'ring' }), pc, pis, [0, y, 0]);
        });
        mk(cylX(0.05, 0.05, -0.2, 0.2, 12), mc('steel', pc, { key: 'pin' }), pc, pis);
        // blok mesin (tembus pandang agar mekanisme terlihat)
        var bm = mc('castIron', 'engineBlock', { key: 'tr', transparent: true, opacity: 0.34, side: THREE.DoubleSide });
        var blk = mk(new THREE.BoxGeometry(1.7, 2.5, 1.6), bm, 'engineBlock', eng, [3.0, -0.65, 0]); blk.castShadow = false;
        var top = mk(new THREE.BoxGeometry(0.9, 1.4, 1.0), bm, 'engineBlock', eng, [3.0, 1.3, 0]); top.castShadow = false;
        var bore = latheShellX([[0.6, 0.36], [2.0, 0.36]], 0.05, 0);
        bore.rotateZ(Math.PI / 2);
        var bmesh = mk(bore, mc('castIron', 'engineBlock', { key: 'bore', transparent: true, opacity: 0.35, side: THREE.DoubleSide }), 'engineBlock', eng, [3.0, 0, 0]);
        bmesh.castShadow = false;
        // oil pan, rumah kopling (bell housing), kepala silinder & tutup katup: mesin tampak utuh
        var oilPan = mk(new THREE.BoxGeometry(1.5, 0.34, 1.35), mc('alu', 'engineBlock', { key: 'pan' }), 'engineBlock', eng, [3.0, -2.0, 0]);
        var headBox = mk(new THREE.BoxGeometry(1.0, 0.22, 1.1), mc('castIron', 'engineBlock', { key: 'head' }), 'engineBlock', eng, [3.0, 2.12, 0]);
        var cover = mk(new THREE.BoxGeometry(0.86, 0.14, 0.9), mc('steelDk', 'engineBlock', { key: 'cover' }), 'engineBlock', eng, [3.0, 2.3, 0]);
        var bell = mk(cylX(1.18, 1.0, 2.0, 2.3, segs(40), true), mc('castIron', 'engineBlock', { key: 'bell', transparent: true, opacity: 0.3, side: THREE.DoubleSide }), 'engineBlock', eng);
        bell.castShadow = false;
        anchor('engineBlock_label', eng, [3.0, 2.5, 0.2], 'Mesin', 'engineBlock');
        anchor('flywheel', fly.parent, [1.96, 1.3, 0.9]);
        anchor('ringGear', fly.parent, [1.82, 1.25, 2.1]);
        anchor('crankshaft', eng, [2.45, 0.12, 0.1]);
        anchor('piston', pis, [0, 0.28, 0.2]);
        anchor('engineBlock', eng, [2.15, -1.2, 0.8]);
    }

    function buildBatteryAndRelay(root) {
        var b = new THREE.Group(); b.name = 'battery'; b.position.set(-2.3, -2.62, 1.4); root.add(b);
        G3D.batteryMesh = b; G3D.explodeHide.push(b);
        var cid = 'battery';
        mk(new THREE.BoxGeometry(1.0, 0.8, 0.62), mc('batt', cid), cid, b, [0, 0.4, 0]);
        mk(new THREE.BoxGeometry(1.03, 0.08, 0.65), mc('battLid', cid), cid, b, [0, 0.84, 0]);
        for (var i = 0; i < 6; i++) mk(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), mc('plastic', cid), cid, b, [-0.3 + i * 0.12, 0.895, -0.14]);
        mk(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 16), mc('lead', cid), cid, b, [0.33, 0.93, 0.1]);
        mk(new THREE.CylinderGeometry(0.075, 0.09, 0.08, 16, 1, true), mc('red', cid, { side: THREE.DoubleSide }), cid, b, [0.33, 0.93, 0.1]);
        mk(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 16), mc('lead', cid), cid, b, [-0.33, 0.93, 0.1]);
        var tex = textTexture(512, 256, function (c, w, h) {
            c.fillStyle = '#23262b'; c.fillRect(0, 0, w, h);
            c.fillStyle = '#e8b21c'; c.fillRect(0, 0, w, 44);
            c.fillStyle = '#111'; c.font = 'bold 30px sans-serif'; c.fillText('MAINTENANCE FREE', 18, 32);
            c.fillStyle = '#f2f4f7'; c.font = 'bold 84px sans-serif'; c.fillText('12V', 24, 150);
            c.font = '44px sans-serif'; c.fillText('45 Ah · 430 A', 200, 146);
            c.font = 'bold 60px sans-serif'; c.fillStyle = '#ff4a3d'; c.fillText('+', 440, 230); c.fillStyle = '#9fb3c8'; c.fillText('−', 30, 230);
        });
        if (tex) mk(new THREE.PlaneGeometry(0.78, 0.39), mc('batt', cid, { key: 'lbl', map: tex, color: 0xffffff }), cid, b, [0, 0.42, 0.311]).castShadow = false;
        anchor(cid, b, [0, 0.8, 0.31]);
        anchor('m:bplus', b, [0.33, 0.98, 0.1], 'Terminal + baterai', 'battery');
        anchor('m:bminus', b, [-0.33, 0.98, 0.1], 'Terminal − baterai', 'battery');

        if (PHOTO.on) { buildPhotoRelay(root); return; }
        // kotak relay & sekering
        var box = new THREE.Group(); box.name = 'relayBox'; box.position.set(-1.2, -2.62, 1.5); root.add(box);
        G3D.relay = box; G3D.explodeHide.push(box);
        mk(new THREE.BoxGeometry(0.6, 0.3, 0.42), mc('plastic', 'starterRelay', { key: 'box' }), 'starterRelay', box, [0, 0.15, 0]);
        var rc = 'starterRelay';
        var rcase = mk(new THREE.BoxGeometry(0.24, 0.24, 0.24), mc('plastic', rc, { key: 'tr', transparent: true, opacity: 0.35, color: 0x3a4250 }), rc, box, [0.12, 0.42, 0]);
        rcase.castShadow = false;
        mk(cylX(0.045, 0.045, 0.03, 0.15, 16), mc('copper', rc), rc, box, [0, 0.44, -0.05]);
        mk(cylX(0.02, 0.02, 0.02, 0.16, 8), mc('steelDk', rc), rc, box, [0, 0.44, -0.05]);
        var leaf = mk(new THREE.BoxGeometry(0.018, 0.14, 0.09), mc('brass', rc), rc, box, [0.19, 0.44, 0.05]);
        G3D.relayLeaf = leaf; G3D.relayLeafX0 = 0.19;
        mk(new THREE.BoxGeometry(0.02, 0.05, 0.05), mc('copper', rc, { key: 'ct' }), rc, box, [0.225, 0.46, 0.05]);
        // 4 kaki relay: 30 (umpan), 87 (keluaran), 86 (+ kumparan), 85 (- kumparan)
        var pinDefs = [['30', -0.06, -0.07], ['87', 0.06, -0.07], ['86', -0.06, 0.07], ['85', 0.06, 0.07]];
        pinDefs.forEach(function (pd) {
            mk(new THREE.BoxGeometry(0.03, 0.14, 0.012), mc('brass', rc, { key: 'pin' + pd[0] }), rc, box, [0.12 + pd[1], 0.61, pd[2]]);
            anchor('m:relay' + pd[0], box, [0.12 + pd[1], 0.72, pd[2]], 'Kaki ' + pd[0], 'starterRelay');
        });
        anchor(rc, box, [0.12, 0.54, 0.12]);
    }

    /* ============================================================
       FOTO ASLI: kunci kontak, fuse, relay
       Foto dari folder images/ dipasang pada bidang yang menghadap depan, dengan ketebalan
       gelap di belakangnya, lampu indikator status, dan ujung kabel tepat di terminal pada foto.
       Hanya aktif saat dibuka lewat server (http/https); dari file:// WebGL menolak tekstur foto,
       sehingga model prosedural lama dipakai sebagai cadangan.
       ============================================================ */
    var PHOTO = {
        on: !!(G.location && /^https?:$/.test(G.location.protocol)),
        parts: {
            fuse:  { file: 'fuse',         W: 305, H: 341, pw: 0.5,  y0: 0.03, base: [-1.8, -2.62, 2.45], led: [0.80, 0.20], t: { IN: [130, 333], OUT: [258, 306] } },
            relay: { file: 'relay',        W: 267, H: 420, pw: 0.5,  y0: 0.03, base: [-1.2, -2.62, 1.5],  led: [0.76, 0.30], t: { '30': [93, 410], '85': [124, 410], '86': [192, 408], '87': [210, 394] } },
            ign:   { file: 'kunci-kontak', W: 358, H: 366, pw: 0.62, y0: 0.45, base: [-0.5, -2.62, 2.45], led: [0.84, 0.33], t: { IN: [71, 14], OUT: [18, 72] } }
        }
    };
    function photoH(p) { return p.pw * p.H / p.W; }
    function photoLocal(p, px, py) { return [(px / p.W - 0.5) * p.pw, p.y0 + (1 - py / p.H) * photoH(p), 0.05]; }
    function photoWorld(key, name) {
        var p = PHOTO.parts[key], l = photoLocal(p, p.t[name][0], p.t[name][1]);
        return [p.base[0] + l[0], p.base[1] + l[1], p.base[2] + l[2]];
    }
    function photoPart(key, root, name, cid, slab) {
        var p = PHOTO.parts[key], ph = photoH(p);
        var g = new THREE.Group(); g.name = name; g.position.set(p.base[0], p.base[1], p.base[2]); root.add(g);
        G3D.explodeHide.push(g);
        if (slab) {
            var sw = (slab.u1 - slab.u0) * p.pw, sh = (slab.v1 - slab.v0) * ph;
            mk(new THREE.BoxGeometry(sw, sh, slab.d), mc('plastic', null, { key: 'slab' + name, color: slab.color }), cid, g,
                [((slab.u0 + slab.u1) / 2 - 0.5) * p.pw, p.y0 + (1 - (slab.v0 + slab.v1) / 2) * ph, -slab.d / 2 - 0.004]);
        }
        var hit = mk(new THREE.BoxGeometry(p.pw, ph, 0.05), mc('plastic', cid, { key: 'hit', transparent: true, opacity: 0.0, depthWrite: false }), cid, g, [0, p.y0 + ph / 2, 0.01]);
        hit.castShadow = false; hit.receiveShadow = false;
        var mat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, transparent: true, alphaTest: 0.06, side: THREE.DoubleSide });
        var plane = new THREE.Mesh(new THREE.PlaneGeometry(p.pw, ph), mat);
        plane.position.set(0, p.y0 + ph / 2, 0.012); plane.name = name + 'Photo'; g.add(plane);
        try {
            new THREE.TextureLoader().load('images/' + p.file + '.png', function (t) {
                if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
                t.anisotropy = 4; mat.map = t; mat.color.setHex(0xffffff); mat.needsUpdate = true;
            });
        } catch (eTex) { /* tanpa tekstur: bidang polos */ }
        return { group: g, ph: ph, p: p };
    }
    function photoLed(r, cid, key) {
        var led = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), new THREE.MeshBasicMaterial({ color: 0x3a3f47 }));
        led.position.set((r.p.led[0] - 0.5) * r.p.pw, r.p.y0 + (1 - r.p.led[1]) * r.ph, 0.035);
        led.name = 'led' + key;
        r.group.add(led);
        return led;
    }
    function buildPhotoRelay(root) {
        var r = photoPart('relay', root, 'relayBox', 'starterRelay', { u0: 0.12, u1: 0.86, v0: 0.30, v1: 0.80, d: 0.16, color: 0x15171b });
        G3D.relay = r.group;
        ['30', '85', '86', '87'].forEach(function (n) {
            var t = PHOTO.parts.relay.t[n];
            anchor('m:relay' + n, r.group, photoLocal(PHOTO.parts.relay, t[0], t[1]), 'Kaki ' + n, 'starterRelay');
        });
        anchor('starterRelay', r.group, [0, PHOTO.parts.relay.y0 + r.ph * 0.78, 0.05]);
        G3D.leds = G3D.leds || {}; G3D.leds.relay = photoLed(r, 'starterRelay', 'R');
    }
    function buildPhotoFuse(root) {
        var r = photoPart('fuse', root, 'fuseBox', 'fuse', { u0: 0.14, u1: 0.88, v0: 0.2, v1: 0.58, d: 0.1, color: 0x8f1d17 });
        var p = PHOTO.parts.fuse;
        anchor('fuse', r.group, [0, p.y0 + r.ph * 0.9, 0.05], 'Fuse');
        anchor('m:fuseIn', r.group, photoLocal(p, p.t.IN[0], p.t.IN[1]), 'IN', 'fuse');
        anchor('m:fuseOut', r.group, photoLocal(p, p.t.OUT[0], p.t.OUT[1]), 'OUT', 'fuse');
        G3D.leds = G3D.leds || {}; G3D.leds.fuse = photoLed(r, 'fuse', 'F');
    }
    function buildPhotoIgnition(root) {
        var p = PHOTO.parts.ign, ic = 'ignitionSwitch';
        var r = photoPart('ign', root, 'ignitionSwitch', ic, { u0: 0.3, u1: 0.84, v0: 0.25, v1: 0.75, d: 0.18, color: 0x1b1e23 });
        var ig = r.group; G3D.ignition = ig;
        mk(new THREE.BoxGeometry(0.62, 0.04, 0.5), mc('dash', ic, { key: 'base' }), ic, ig, [0, 0.02, 0]);
        mk(new THREE.BoxGeometry(0.1, p.y0 - 0.04, 0.1), mc('dash', ic, { key: 'stand' }), ic, ig, [0, 0.04 + (p.y0 - 0.04) / 2, -0.04]);
        // lampu status posisi kunci (OFF abu-abu / ON kuning / START hijau); ignKey = grup pembawanya
        var lamp = photoLed(r, ic, 'K');
        var key = new THREE.Group(); key.position.copy(lamp.position); ig.add(key); G3D.ignKey = key;
        lamp.position.set(0, 0, 0); key.add(lamp);
        G3D.leds = G3D.leds || {}; G3D.leds.ign = lamp;
        anchor(ic, ig, [0, p.y0 + r.ph * 0.8, 0.05], 'Kunci Kontak');
        anchor('m:ignIN', ig, photoLocal(p, p.t.IN[0], p.t.IN[1]), 'IN', ic);
        anchor('m:ignOUT', ig, photoLocal(p, p.t.OUT[0], p.t.OUT[1]), 'OUT', ic);
    }
    function setLed(led, hex, inten) {
        if (!led || !led.material) return;
        led.material.color.setHex(hex);
    }
    function updateControlLeds(anim) {
        if (!G3D.leds) return;
        var closed = !!(anim && anim.relayV > 0.4);
        var ip = 'OFF';
        try { ip = (typeof Sim !== 'undefined' && Sim && Sim.ignitionState) || 'OFF'; } catch (eI) { ip = 'OFF'; }
        setLed(G3D.leds.ign, ip === 'START' ? 0x2ecc71 : (ip === 'ON' ? 0xffb020 : 0x3a3f47), 0);
        setLed(G3D.leds.relay, closed ? 0x2ecc71 : 0x3a3f47, 0);
        var blown = false;
        try { blown = typeof FAULTS !== 'undefined' && !!(FAULTS.openFuse && FAULTS.openFuse.isActive()); } catch (eF) { blown = false; }
        setLed(G3D.leds.fuse, blown ? 0xff3b30 : 0x2ecc71, 0);
    }
    function photoControlWires(add, red, blk, yel, root) {
        var BP = [-1.97, -1.65, 1.5];
        var FIN = photoWorld('fuse', 'IN'), FOUT = photoWorld('fuse', 'OUT'), IGI = photoWorld('ign', 'IN'), IGO = photoWorld('ign', 'OUT');
        var R30 = photoWorld('relay', '30'), R85 = photoWorld('relay', '85'), R86 = photoWorld('relay', '86'), R87 = photoWorld('relay', '87');
        // aki (+) -> fuse IN
        add(tube([BP, [-1.97, -2.05, 1.8], [FIN[0] - 0.04, -2.45, 2.25], FIN], 0.022, red, 'positiveCable', root, false, 30, 6));
        // fuse OUT -> kunci kontak IN (lewat depan, naik rapi ke terminal atas)
        add(tube([FOUT, [-1.35, -2.5, 2.8], [IGI[0] - 0.3, -2.1, 2.75], [IGI[0] - 0.06, IGI[1] - 0.1, IGI[2] + 0.18], IGI], 0.02, red, 'positiveCable', root, false, 40, 6));
        // fuse OUT -> relay kaki 30
        add(tube([FOUT, [-1.5, -2.52, 2.2], [R30[0] - 0.03, -2.55, 1.8], R30], 0.02, red, 'positiveCable', root, false, 40, 6));
        // kunci kontak OUT -> relay kaki 86 (kumparan +)
        add(tube([IGO, [IGO[0] - 0.06, -1.95, 2.45], [-0.95, -2.35, 2.0], [R86[0] + 0.06, -2.52, 1.75], R86], 0.018, yel, 'positiveCable', root, false, 40, 6));
        // relay kaki 85 -> massa
        add(tube([R85, [-1.2, -2.58, 1.1], [-1.0, -2.58, 0.4], [-0.8, -2.56, -0.22]], 0.018, blk, 'groundCable', root, false, 40, 6));
        // relay kaki 87 -> terminal 50 (S) solenoid
        add(tube([R87, [-0.95, -2.3, 1.3], [-0.6, -0.3, 0.6], [-0.4, 0.45, 0.15], [-0.26, 0.6, 0.0]], 0.018, yel, 'positiveCable', root, false, 60, 6));
    }

    /* ---- Kotak fuse terpisah (IN dari aki, OUT ke kunci kontak & relay kaki 30) ---- */
    function buildFuseBox(root) {
        if (PHOTO.on) { buildPhotoFuse(root); return; }
        var fb = new THREE.Group(); fb.name = 'fuseBox'; fb.position.set(-1.8, -2.62, 2.45); root.add(fb);
        G3D.fuseBox = fb; G3D.explodeHide.push(fb);
        var fc = 'fuse';
        mk(new THREE.BoxGeometry(0.62, 0.2, 0.34), mc('plastic', fc, { key: 'box' }), fc, fb, [0, 0.1, 0]);
        mk(new THREE.BoxGeometry(0.58, 0.04, 0.3), mc('plastic', fc, { key: 'lid', transparent: true, opacity: 0.35, color: 0x555d6a }), fc, fb, [0, 0.22, 0]).castShadow = false;
        // sekering pisau (blade fuse) berwarna merah + elemen kuning
        mk(new THREE.BoxGeometry(0.2, 0.17, 0.05), mc('red', fc, { key: 'blade', transparent: true, opacity: 0.85, depthWrite: true }), fc, fb, [0, 0.285, 0]);
        mk(new THREE.BoxGeometry(0.1, 0.02, 0.052), mc('brass', fc, { key: 'element', emissive: 0x553300, ei: 0.3 }), fc, fb, [0, 0.285, 0]);
        mk(new THREE.BoxGeometry(0.02, 0.1, 0.012), mc('zinc', fc), fc, fb, [-0.07, 0.17, 0]);
        mk(new THREE.BoxGeometry(0.02, 0.1, 0.012), mc('zinc', fc), fc, fb, [0.07, 0.17, 0]);
        // terminal IN / OUT
        mk(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 14), mc('brass', fc, { key: 'tin' }), fc, fb, [-0.14, 0.25, 0]);
        mk(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 14), mc('brass', fc, { key: 'tout' }), fc, fb, [0.14, 0.25, 0]);
        anchor(fc, fb, [0, 0.42, 0.12], 'Fuse');
        anchor('m:fuseIn', fb, [-0.14, 0.34, 0.05], 'IN', 'fuse');
        anchor('m:fuseOut', fb, [0.14, 0.34, 0.05], 'OUT', 'fuse');
    }

    /* ---- Kunci kontak: panel, silinder kunci, kunci (berputar OFF/ON/START), terminal di belakang ---- */
    function buildIgnitionSwitch(root) {
        if (PHOTO.on) { buildPhotoIgnition(root); return; }
        var ig = new THREE.Group(); ig.name = 'ignitionSwitch'; ig.position.set(-0.5, -2.62, 2.45); root.add(ig);
        G3D.ignition = ig; G3D.explodeHide.push(ig);
        var ic = 'ignitionSwitch';
        mk(new THREE.BoxGeometry(0.62, 0.04, 0.5), mc('dash', ic, { key: 'base' }), ic, ig, [0, 0.02, 0]);
        mk(new THREE.BoxGeometry(0.12, 0.66, 0.12), mc('dash', ic, { key: 'stand' }), ic, ig, [0, 0.37, -0.02]);
        mk(new THREE.BoxGeometry(0.62, 0.52, 0.08), mc('dash', ic, { key: 'plate' }), ic, ig, [0, 0.98, 0]);
        // rumah silinder kunci + silinder (menghadap +z)
        var housing = new THREE.CylinderGeometry(0.17, 0.17, 0.1, 28); housing.rotateX(Math.PI / 2);
        mk(housing, mc('chrome', ic, { key: 'ring' }), ic, ig, [0, 0.98, 0.08]);
        var barrel = new THREE.CylinderGeometry(0.12, 0.12, 0.12, 24); barrel.rotateX(Math.PI / 2);
        mk(barrel, mc('steelDk', ic, { key: 'barrel' }), ic, ig, [0, 0.98, 0.1]);
        // kunci: kepala (bow) + bilah, berputar pada sumbu z
        var key = new THREE.Group(); key.position.set(0, 0.98, 0.18); ig.add(key); G3D.ignKey = key;
        mk(new THREE.BoxGeometry(0.05, 0.2, 0.025), mc('brass', ic, { key: 'blade' }), ic, key, [0, -0.02, 0]);
        var bow = new THREE.TorusGeometry(0.07, 0.022, 10, 24);
        mk(bow, mc('brass', ic, { key: 'bow' }), ic, key, [0, 0.14, 0]);
        // penanda posisi OFF / ON / START pada panel
        [['OFF', -0.2, 1.17], ['ON', 0, 1.2], ['START', 0.2, 1.17]].forEach(function (m) {
            mk(new THREE.BoxGeometry(0.03, 0.03, 0.012), mc('brass', ic, { key: 'mark' + m[0] }), ic, ig, [m[1], m[2], 0.045]);
        });
        // terminal di belakang panel: IN (dari fuse) dan OUT (ke relay 86)
        mk(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 12), mc('brass', ic, { key: 'tIN' }), ic, ig, [-0.15, 0.86, -0.1], [Math.PI / 2, 0, 0]);
        mk(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 12), mc('brass', ic, { key: 'tOUT' }), ic, ig, [0.15, 0.86, -0.1], [Math.PI / 2, 0, 0]);
        anchor(ic, ig, [0, 1.35, 0.1], 'Kunci Kontak');
        anchor('m:ignIN', ig, [-0.15, 0.78, -0.12], 'IN', 'ignitionSwitch');
        anchor('m:ignOUT', ig, [0.15, 0.78, -0.12], 'OUT', 'ignitionSwitch');
    }

    var arrowGroupRef = null;
    function buildCables(root) {
        var red = mc('cableRed', 'positiveCable'), blk = mc('cableBlk', 'groundCable'), yel = mc('cableYel', 'positiveCable', { key: 'ctl' });
        G3D.cables = [];
        function add(c) { G3D.cables.push(c); G3D.explodeHide.push(c.mesh); return c; }
        // kabel besar B+ -> terminal 30 solenoid
        var mainPos = add(tube([[-1.97, -1.62, 1.5], [-1.95, -1.15, 1.45], [-1.5, -0.35, 0.95], [-0.85, 0.5, 0.4], [-0.5, 0.83, 0.2], [-0.29, 0.765, 0.11]], 0.05, red, 'positiveCable', root, false, 80, 12));
        // strip tembaga C -> lilitan medan (sudah dibuat di solenoid)
        if (G3D.motorStrap) G3D.cables.push(G3D.motorStrap);
        // massa starter -> blok mesin (strap)
        add(tube([[0.9, -0.58, -0.21], [1.1, -1.0, -0.8], [1.7, -1.25, -1.5], [2.15, -1.15, -1.9]], 0.03, blk, 'groundCable', root, false, 40, 8));
        // B- -> blok mesin
        var mainGnd = add(tube([[-2.63, -1.62, 1.5], [-2.72, -2.2, 1.25], [-1.5, -2.56, 0.2], [0.8, -2.56, -1.2], [2.2, -1.8, -1.95]], 0.045, blk, 'groundCable', root, false, 80, 10));
        if (PHOTO.on) { photoControlWires(add, red, blk, yel, root); } else {
        // Jaringan kontrol (sama dengan diagram): aki + -> fuse IN -> fuse OUT -> kunci kontak IN / relay kaki 30
        // Titik terminal (koordinat dunia): B+ (-1.97,-1.69,1.5); fuse IN (-1.94,-2.34,2.45), OUT (-1.66,-2.34,2.45);
        // kunci kontak IN (-0.65,-1.82,2.36), OUT (-0.35,-1.82,2.36); relay 30 (-1.14,-1.98,1.43), 87 (-1.02,-1.98,1.43), 86 (-1.14,-1.98,1.57), 85 (-1.02,-1.98,1.57)
        add(tube([[-1.97, -1.65, 1.5], [-1.95, -1.9, 1.9], [-1.94, -2.2, 2.3], [-1.94, -2.34, 2.45]], 0.022, red, 'positiveCable', root, false, 30, 6));
        add(tube([[-1.66, -2.34, 2.45], [-1.4, -2.46, 2.58], [-0.9, -2.2, 2.5], [-0.65, -1.82, 2.36]], 0.02, red, 'positiveCable', root, false, 40, 6));
        add(tube([[-1.66, -2.34, 2.45], [-1.6, -2.2, 2.0], [-1.3, -2.05, 1.6], [-1.14, -1.98, 1.43]], 0.02, red, 'positiveCable', root, false, 40, 6));
        // kunci kontak OUT -> relay kaki 86 (+ kumparan)
        add(tube([[-0.35, -1.82, 2.36], [-0.5, -1.9, 2.1], [-0.9, -1.95, 1.8], [-1.14, -1.98, 1.57]], 0.018, yel, 'positiveCable', root, false, 40, 6));
        // relay kaki 85 (- kumparan) -> massa (bus kabel B-)
        add(tube([[-1.02, -1.98, 1.57], [-0.95, -2.3, 1.2], [-0.85, -2.5, 0.5], [-0.8, -2.56, -0.22]], 0.018, blk, 'groundCable', root, false, 40, 6));
        // relay kaki 87 -> terminal 50 (S) solenoid (kabel kontrol)
        add(tube([[-1.02, -1.98, 1.43], [-0.9, -1.6, 1.25], [-0.6, -0.3, 0.6], [-0.4, 0.45, 0.15], [-0.26, 0.6, 0.0]], 0.018, yel, 'positiveCable', root, false, 60, 6));
        }
        anchor('positiveCable', mainPos.mesh, [-1.5, -0.35, 0.95]);
        anchor('groundCable', mainGnd.mesh, [-0.4, -2.56, -0.3]);

        var arrows = new THREE.Group();
        arrows.name = 'currentArrows';
        root.add(arrows);
        arrowGroupRef = arrows;
        G3D.arrows = arrows;
        G3D.explodeHide.push(arrows);
    }

    var particleMeshes = [];
    var partPathIndex = 0;
    function buildParticles() {
        var n = CFG.quality[currentQuality].particles;
        var mat = new THREE.MeshStandardMaterial({ color: 0x58c6ff, emissive: linColor(0x2a8cff), emissiveIntensity: 2.2, transparent: true, opacity: 0.95, metalness: 0, roughness: 0.4 });
        var geo = new THREE.SphereGeometry(0.045, 12, 10);
        for (var i = 0; i < n; i++) {
            var sp = new THREE.Mesh(geo, mat);
            sp.visible = false;
            if (arrowGroupRef) arrowGroupRef.add(sp);
            else sceneObj.add(sp);
            particleMeshes.push(sp);
        }
    }

    /* ============================================================
       13c. LABEL HTML (tajam, tidak menutupi model, anti-tumpang)
       ============================================================ */
    var labelLayer = null, tipEl = null, labelItems = [];
    var _lv = null;
    function buildLabels() {
        var wrap = uiEl('p6-canvas-wrap');
        if (!wrap || !G.document) return;
        if (labelLayer && labelLayer.parentNode) labelLayer.parentNode.removeChild(labelLayer);
        labelLayer = G.document.createElement('div');
        labelLayer.className = 'p6-labels';
        wrap.appendChild(labelLayer);
        labels = []; labelItems = [];
        Object.keys(anchors).forEach(function (key) {
            var a = anchors[key];
            var el = G.document.createElement('div');
            el.className = 'p6-lbl' + (a.minor ? ' minor' : '');
            el.innerHTML = '<span class="p6-lbl-t">' + esc(a.text) + '</span><i class="p6-lbl-ln"></i><b class="p6-lbl-dot"></b>';
            el.style.display = 'none';
            labelLayer.appendChild(el);
            var it = { key: key, cid: a.cid, owner: a.owner, occluded: false, minor: a.minor, el: el, obj: a.obj, local: a.local, visible: labelsOn, w: a.text.length * (a.minor ? 5.6 : 6.4) + 16, shown: false, cls: '' };
            labelItems.push(it); labels.push(it);
        });
    }

    /* label disembunyikan bila titiknya tertutup bagian lain (mis. armatur di dalam yoke) */
    var _occRay = null, _occDir = null;
    function labelOccluded(worldPt, dist, owner) {
        if (!_occRay) { _occRay = new THREE.Raycaster(); _occDir = new THREE.Vector3(); }
        _occDir.copy(worldPt).sub(camera3d.position).normalize();
        _occRay.set(camera3d.position, _occDir);
        _occRay.far = dist - 0.02;
        var hits = _occRay.intersectObjects(pickables, false), cut = viewMode === 'CUTAWAY';
        for (var i = 0; i < hits.length; i++) {
            var h = hits[i], m = h.object.material;
            if (!objShown(h.object)) continue;
            if (m && m.transparent && m.opacity < 0.5) continue;
            if (cut && m && m.clippingPlanes && CUT.plane.distanceToPoint(h.point) < 0) continue;
            if (h.object.userData.componentId === owner) continue;
            if (dist - h.distance < 0.05) continue;
            return true;
        }
        return false;
    }

    function objShown(o) {
        while (o) { if (!o.visible) return false; o = o.parent; }
        return true;
    }

    function updateLabels() {
        if (!labelLayer || !camera3d) return;
        if (!_lv) _lv = new THREE.Vector3();
        if (!labelsOn) { if (labelLayer.style.display !== 'none') labelLayer.style.display = 'none'; return; }
        if (labelLayer.style.display === 'none') labelLayer.style.display = '';
        var W = canvasW, H = canvasH, zoomed = view.dist < 3.3, list = [];
        var nowT = nowMs(), doOcc = nowT - (updateLabels._occT || 0) > 120;
        if (doOcc) updateLabels._occT = nowT;
        labelItems.forEach(function (it) {
            it.want = false;
            if (it.minor && !zoomed) return;
            if (!objShown(it.obj)) return;
            if (!labelsAll && !(it.cid && (it.cid === selectedComponent || it.cid === hoverCid))) return;
            it.obj.localToWorld(_lv.copy(it.local));
            it.depth = _lv.distanceTo(camera3d.position);
            if (doOcc) it.occluded = labelOccluded(_lv, it.depth, it.owner);
            if (it.occluded && !(it.cid && (it.cid === selectedComponent || it.cid === hoverCid))) return;
            _lv.project(camera3d);
            if (_lv.z > 1 || _lv.x < -1.1 || _lv.x > 1.1 || _lv.y < -1.1 || _lv.y > 1.1) return;
            it.sx = (_lv.x * 0.5 + 0.5) * W;
            it.sy = (-_lv.y * 0.5 + 0.5) * H;
            it.pri = it.cid && it.cid === selectedComponent ? 0 : (it.cid && it.cid === hoverCid ? 1 : (it.minor ? 2 : 3));
            list.push(it);
        });
        list.sort(function (a, b) { return a.pri - b.pri || a.depth - b.depth; });
        var placed = [];
        list.forEach(function (it) {
            var w = it.w, h = 40, x0 = it.sx - w / 2, y0 = it.sy - h;
            for (var i = 0; i < placed.length; i++) {
                var r = placed[i];
                if (!(x0 + w < r.x || r.x + r.w < x0 || y0 + h < r.y || r.y + r.h < y0)) { if (it.pri > 1) return; break; }
            }
            placed.push({ x: x0, y: y0, w: w, h: h });
            it.want = true;
        });
        labelItems.forEach(function (it) {
            if (!it.want) { if (it.shown) { it.el.style.display = 'none'; it.shown = false; } return; }
            if (!it.shown) { it.el.style.display = ''; it.shown = true; }
            it.el.style.transform = 'translate(' + it.sx.toFixed(1) + 'px,' + it.sy.toFixed(1) + 'px) translate(-50%,-100%)';
            var cls = 'p6-lbl' + (it.minor ? ' minor' : '') + (it.pri === 0 ? ' sel' : (it.pri === 1 ? ' hov' : ''));
            if (cls !== it.cls) { it.el.className = cls; it.cls = cls; }
        });
    }

    /* ---- UI overlay: tips kontrol, tooltip hover, tombol putar otomatis ---- */
    function buildOverlayUi() {
        var wrap = uiEl('p6-canvas-wrap');
        if (!wrap || !G.document) return;
        if (!uiEl('p6-tip')) {
            tipEl = G.document.createElement('div');
            tipEl.id = 'p6-tip'; tipEl.className = 'p6-tip'; tipEl.style.display = 'none';
            wrap.appendChild(tipEl);
        } else tipEl = uiEl('p6-tip');
        if (!uiEl('p6-hint')) {
            var hint = G.document.createElement('div');
            hint.id = 'p6-hint'; hint.className = 'p6-hint';
            hint.innerHTML = '<b>Klik + geser</b> putar &nbsp;·&nbsp; <b>Scroll / cubit</b> zoom &nbsp;·&nbsp; <b>Klik kanan / Shift + geser</b> geser &nbsp;·&nbsp; <b>Klik dobel</b> fokus bagian';
            wrap.appendChild(hint);
            var hideHint = function () { hint.classList.add('gone'); };
            try { G.setTimeout(hideHint, 15000); } catch (e) { /* noop */ }
            if (renderer && renderer.domElement) renderer.domElement.addEventListener('pointerdown', function () { G.setTimeout(hideHint, 2500); }, { once: true });
        }
    }
    function updateAutoBtn() {
        var b = uiEl('p6-btn-autorot');
        if (b) b.textContent = autoRotate ? 'PUTAR OTOMATIS: ON' : 'PUTAR OTOMATIS: OFF';
    }

    /* ============================================================
       13d. INPUT: orbit bebas 360°, zoom, geser (pan), klik, hover
       ============================================================ */
    function bind3DEvents() {
        if (!renderer) return;
        var el = renderer.domElement;
        if (!el) return;
        el.style.touchAction = 'none';
        el.style.cursor = 'grab';
        var pointers = {}, mode = null, lastX = 0, lastY = 0, downX = 0, downY = 0, moved = false, lastMoveT = 0, pinchD = 0;
        function count() { return Object.keys(pointers).length; }
        function pts() { return Object.keys(pointers).map(function (k) { return pointers[k]; }); }
        function pdist() { var p = pts(); return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
        function pmid() { var p = pts(); return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }; }

        el.addEventListener('pointerdown', function (e) {
            try { el.setPointerCapture(e.pointerId); } catch (x) { /* noop */ }
            pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
            if (count() === 1) {
                mode = (e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.metaKey) ? 'pan' : 'rotate';
                downX = lastX = e.clientX; downY = lastY = e.clientY; moved = false;
                camVel.az = 0; camVel.pol = 0;
                userDragging = true;
            } else if (count() === 2) {
                mode = 'pinch'; pinchD = pdist(); var m = pmid(); lastX = m.x; lastY = m.y; moved = true;
            }
            if (autoRotate) { autoRotate = false; updateAutoBtn(); }
        });
        el.addEventListener('pointermove', function (e) {
            if (!pointers[e.pointerId]) { hoverAt(e.clientX, e.clientY); return; }
            pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
            if (mode === 'pinch' && count() >= 2) {
                var d = pdist();
                if (pinchD > 0 && d > 0) camDistBase *= pinchD / d;
                pinchD = d;
                var m = pmid(); panBy(m.x - lastX, m.y - lastY); lastX = m.x; lastY = m.y;
                return;
            }
            var dx = e.clientX - lastX, dy = e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
            if (!moved && Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) { moved = true; hideTip(); }
            if (!moved) return;
            el.style.cursor = mode === 'pan' ? 'move' : 'grabbing';
            if (mode === 'rotate') {
                var da = -dx * 0.0068, dp = -dy * 0.0068;
                camAzim += da; camPolar += dp;
                camVel.az = da; camVel.pol = dp;
                lastMoveT = nowMs();
            } else {
                panBy(dx, dy);
            }
        });
        function end(e) {
            if (!pointers[e.pointerId]) return;
            delete pointers[e.pointerId];
            try { el.releasePointerCapture(e.pointerId); } catch (x) { /* noop */ }
            if (count() === 0) {
                userDragging = false;
                if (nowMs() - lastMoveT > 90) { camVel.az = 0; camVel.pol = 0; }
                if (!moved && e.type === 'pointerup' && mode !== 'pinch') pick3DAt(e.clientX, e.clientY);
                mode = null;
                el.style.cursor = hoverCid ? 'pointer' : 'grab';
            } else if (count() === 1) {
                var p = pts()[0]; mode = 'rotate'; lastX = p.x; lastY = p.y; moved = true;
            }
        }
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
        el.addEventListener('pointerleave', function () { if (!count()) { hoverCid = null; hideTip(); applyHighlights(); } });
        el.addEventListener('wheel', function (e) {
            e.preventDefault();
            var dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
            camDistBase *= Math.pow(1.0014, clamp(dy, -300, 300));
        }, { passive: false });
        el.addEventListener('dblclick', function (e) {
            var hit = raycastAt(e.clientX, e.clientY);
            if (hit) {
                camTarget = [hit.point.x, hit.point.y, hit.point.z];
                camDistBase = Math.min(camDistBase, 2.2);
            }
        });
        el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }

    function panBy(dx, dy) {
        if (!camera3d) return;
        var s = 2 * view.dist * Math.tan((camera3d.fov * Math.PI / 180) / 2) / Math.max(1, canvasH);
        var e = camera3d.matrixWorld.elements;
        // kolom 0 = kanan, kolom 1 = atas (ruang dunia)
        for (var i = 0; i < 3; i++) camTarget[i] += -dx * s * e[i] + dy * s * e[4 + i];
    }

    var _ray = null, _ndc = null, _lastHover = 0;
    function raycastAt(clientX, clientY) {
        if (!renderer || !camera3d) return null;
        if (modelMode === 'ASLI') { var gh = glbRaycast(clientX, clientY); return gh ? { cid: null, point: gh.point, glb: gh } : null; }
        var rect = renderer.domElement.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        if (!_ray) { _ray = new THREE.Raycaster(); _ndc = new THREE.Vector2(); }
        _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
        _ray.setFromCamera(_ndc, camera3d);
        var cand = pickables.filter(objShown);
        var hits = _ray.intersectObjects(cand, false);
        var cut = viewMode === 'CUTAWAY', firstTr = null;
        for (var i = 0; i < hits.length; i++) {
            var h = hits[i], m = h.object.material;
            if (cut && m && m.clippingPlanes && CUT.plane.distanceToPoint(h.point) < 0) continue;
            if (m && m.transparent && m.opacity < 0.5) { if (!firstTr) firstTr = h; continue; }
            return { cid: h.object.userData.componentId, point: h.point };
        }
        return firstTr ? { cid: firstTr.object.userData.componentId, point: firstTr.point } : null;
    }

    function hoverAt(clientX, clientY) {
        var now = nowMs();
        if (now - _lastHover < 40) return;
        _lastHover = now;
        var hit = raycastAt(clientX, clientY);
        if (hit && hit.glb) {
            if (renderer && renderer.domElement) renderer.domElement.style.cursor = 'pointer';
            if (tipEl) {
                var wr = uiEl('p6-canvas-wrap'), rr = wr ? wr.getBoundingClientRect() : { left: 0, top: 0 };
                tipEl.innerHTML = '<b>' + esc(hit.glb.name) + '</b><span>Model asli · klik untuk memilih</span>'; tipEl._html = null;
                tipEl.style.display = 'block';
                tipEl.style.transform = 'translate(' + Math.round(clientX - rr.left + 16) + 'px,' + Math.round(clientY - rr.top + 14) + 'px)';
            }
            return;
        }
        var cid = hit ? hit.cid : null;
        if (cid !== hoverCid) { hoverCid = cid; applyHighlights(); }
        if (renderer && renderer.domElement) renderer.domElement.style.cursor = cid ? 'pointer' : 'grab';
        if (!tipEl) return;
        if (!cid || !COMPONENTS[cid]) { hideTip(); return; }
        var wrap = uiEl('p6-canvas-wrap');
        var r = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0 };
        var html = '<b>' + esc(COMPONENTS[cid].label) + '</b><span>' + esc(COMPONENTS[cid].en) + ' · klik untuk info</span>';
        if (tipEl._html !== html) { tipEl.innerHTML = html; tipEl._html = html; }
        tipEl.style.display = 'block';
        tipEl.style.transform = 'translate(' + Math.round(clientX - r.left + 16) + 'px,' + Math.round(clientY - r.top + 14) + 'px)';
    }
    function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

    function pick3DAt(clientX, clientY) {
        var hit = raycastAt(clientX, clientY);
        if (hit && hit.glb) { glbHighlight(hit.glb.mesh); return; }
        if (hit && hit.cid) {
            focusComponent(hit.cid);
            pickForMeasurement(hit.cid);
        }
    }

    var FOCUS_DIST = { flywheel: 6.5, ringGear: 5.5, engineBlock: 5.5, crankshaft: 4.2, piston: 3.2, battery: 3.2, positiveCable: 7, groundCable: 7.5, starterHousing: 3.2, driveHousing: 2.8, rearCover: 2.2, starterSolenoid: 2.4, starterRelay: 1.6, fuse: 1.4, ignitionSwitch: 1.8, fieldCoil: 2.4, starterArmature: 2.4 };
    var FRONT_VIEW = ['starterRelay', 'fuse', 'ignitionSwitch'];
    function flyToComponent(cid) {
        var a = anchors[cid];
        if (!a || !camera3d) return { ok: false };
        var p = a.obj.localToWorld(a.local.clone());
        camTarget = [p.x, p.y, p.z];
        camDistBase = FOCUS_DIST[cid] || 1.9;
        /* komponen kontrol kecil (relay, fuse, kunci kontak) dilihat dari depan: foto menghadap kamera
           dan tidak terhalang komponen lain pada sudut kamera bawaan */
        if (FRONT_VIEW.indexOf(cid) >= 0) {
            camPolar = 1.3;
            camAzim = view.azim + wrapAngle(0.12 - view.azim);
            camVel.az = 0; camVel.pol = 0;
        }
        return { ok: true };
    }

    function highlightMeshFor(componentId) { applyHighlights(); }

    function applyHighlights() {
        Object.keys(matCache).forEach(function (k) {
            var m = matCache[k], cid = m.userData.cid;
            if (!m.emissive) return;
            if (cid && cid === selectedComponent) { m.emissive.setHex(0x1d6fe0); m.emissiveIntensity = 0.55; }
            else if (cid && cid === hoverCid) { m.emissive.setHex(0x3b5870); m.emissiveIntensity = 0.28; }
            else { m.emissive.setHex(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseEI; }
        });
    }

    /* ============================================================
       13e. MODE TAMPILAN: NORMAL / CUTAWAY (potong) / EXPLODED (urai)
       ============================================================ */
    var lastViewMode = 'NORMAL';
    function applyViewMode() {
        if (!renderer) {
            applyFallbackView();
            return;
        }
        var cut = viewMode === 'CUTAWAY';
        CUT.mats.forEach(function (m) {
            m.clippingPlanes = cut ? [CUT.plane] : null;
            m.clipShadows = cut;
            m.needsUpdate = true;
        });
        if (viewMode === 'EXPLODED' && lastViewMode !== 'EXPLODED') setCameraFace('EXPLODED');
        if (viewMode === 'CUTAWAY' && lastViewMode !== 'CUTAWAY' && view.dist > 5) setCameraFace('STARTER');
        lastViewMode = viewMode;
        applyExploded(0);
    }

    var explodedLevel = 0;
    function applyExploded(level) { /* animasi halus di updateExplode() */ return explodedLevel; }

    function updateExplode(dt) {
        var goal = viewMode === 'EXPLODED' ? 1 : 0;
        explodedLevel = lerp(explodedLevel, goal, 1 - Math.exp(-dt / 260));
        if (Math.abs(explodedLevel - goal) < 0.001) explodedLevel = goal;
        var e = sCurve(explodedLevel);
        if (G3D.rear) G3D.rear.position.x = -1.6 * e;
        if (G3D.brushPlate) G3D.brushPlate.position.x = -1.2 * e;
        if (G3D.yoke) G3D.yoke.position.z = -1.35 * e;
        if (G3D.drive) G3D.drive.position.x = 2.0 * e;
        if (G3D.solenoid) G3D.solenoid.position.y = 0.71 + 0.85 * e;
        if (G3D.leverBase) G3D.leverBase.position.set(1.21 + 0.95 * e, 0.45 + 0.55 * e, 0);
        G3D.explodeOffset = 0.95 * e;
        var hide = e > 0.02;
        G3D.explodeHide.forEach(function (o) { if (o) o.visible = !hide && modelMode === 'SIM'; });
    }

    function updateCutPlane() {
        if (viewMode !== 'CUTAWAY' || !CUT.plane || !camera3d) return;
        var c = new THREE.Vector3(STARTER_C[0], STARTER_C[1], STARTER_C[2]);
        var n = c.clone().sub(camera3d.position).normalize();
        CUT.plane.normal.copy(n);
        CUT.plane.constant = -n.dot(c);
    }

    function applySceneState(anim) {
        if (renderer) {
            if (contextLost || !canvasVisible()) { lastFrameTs = 0; silence(); return; }
            var now = nowMs();
            var dt = lastFrameTs ? Math.min(100, now - lastFrameTs) : 16;
            lastFrameTs = now;
            syncCanvasSize();
            applyCamera3d(dt);
            updateExplode(dt);
            updateGlbExplode(sCurve(explodedLevel));
            if (G3D.pinionGroup) G3D.pinionGroup.position.x = cache.pinion * 0.21 + (G3D.explodeOffset || 0);
            if (!paused3d) {
                if (G3D.armature) G3D.armature.rotation.x = cache.starterAngle;
                if (G3D.pinionSpin) G3D.pinionSpin.rotation.x = cache.starterAngle;
                if (G3D.flywheelGroup) G3D.flywheelGroup.rotation.x = -cache.flyAngle;
                if (G3D.crankGroup) G3D.crankGroup.rotation.x = -cache.crankAngle;
                if (G3D.piston && G3D.pistonRod) {
                    var phi = -cache.crankAngle, rT = 0.35, Lr = 1.05;
                    var cy = rT * Math.cos(phi), cz = rT * Math.sin(phi);
                    var py = cy + Math.sqrt(Lr * Lr - cz * cz);
                    G3D.piston.position.y = py;
                    G3D.pistonRod.position.set(3.0, (cy + py) / 2, cz / 2);
                    G3D.pistonRod.rotation.x = Math.atan2(-cz, py - cy);
                }
                if (G3D.plunger) G3D.plunger.position.x = -cache.plunger * 0.12;
                if (G3D.lever) G3D.lever.rotation.z = Math.asin(clamp(cache.plunger * 0.12 / 0.26, -1, 1));
                if (G3D.ignKey) {
                    var ipos = 'OFF';
                    try { ipos = (typeof Sim !== 'undefined' && Sim && Sim.ignitionState) || 'OFF'; } catch (e0) { /* noop */ }
                    var kt = ipos === 'START' ? -1.45 : (ipos === 'ON' ? -0.72 : 0);
                    G3D.ignKey.rotation.z = lerp(G3D.ignKey.rotation.z, kt, 0.2);
                }
                updateControlLeds(anim);
                if (G3D.relayLeaf) {
                    if (anim.relayV > 0.4) G3D.relayClosed = true;
                    if (anim.relayV <= 0.4) G3D.relayClosed = false;
                    var tx = G3D.relayLeafX0 + (G3D.relayClosed ? 0.02 : 0);
                    G3D.relayLeaf.position.x = lerp(G3D.relayLeaf.position.x, tx, 0.25);
                    G3D.relayLeaf.rotation.y = G3D.relayClosed ? 0 : 0.25;
                }
                updateArrayAnimation(anim);
            }
            updateDisplayFrame(anim, dt);
            updateSound(anim);
            updateIgnitionMini();
            updateCutPlane();
            renderer.render(sceneObj, camera3d);
            updateDebug(dt, anim);
            if (modelMode === 'SIM') updateLabels(); else if (labelLayer) labelLayer.style.display = 'none';
        } else {
            applyFallbackFrame(anim);
        }
    }

    function canvasVisible() {
        var parent = uiEl('p6-canvas');
        if (!parent) return false;
        // offsetParent null = halaman 3D Lab sedang tersembunyi (tab lain aktif)
        if (parent.offsetParent === null && !(G.document && G.document.fullscreenElement)) return false;
        return (parent.clientWidth || 0) > 10 && (parent.clientHeight || 0) > 10;
    }

    function updateArrayAnimation(anim) {
        var n = particleMeshes.length;
        if (!n || !G3D.cables.length) return;
        var speed = 0.02 + anim.currentNorm * 0.05;
        var flow = anim.flow.effective > 0 && anim.currentNorm > 0.01;
        var show = displayMode === 'ELECTRICAL' || displayMode === 'COMBINED' || displayMode === 'SYNCHRONIZED';
        for (var i = 0; i < n; i++) {
            var sp = particleMeshes[i];
            if (!flow || !show || sp.userData.off || modelMode !== 'SIM') { sp.visible = false; continue; }
            var idx = i % G3D.cables.length;
            var c = G3D.cables[idx];
            if (!c) { sp.visible = false; continue; }
            sp.visible = true;
            var pos = (cache.particleT * speed * 0.6 + i / n * 3) % 1;
            sp.position.copy(c.curve.getPoint(pos));
        }
    }

    /* ============================================================
       13f. KONTROL LANJUTAN 3D LAB
       DISPLAY (electrical / mechanical / combined / synchronized),
       TEACHING tour, SUARA (WebAudio), DEBUG overlay, status aktif
       tombol, kunci kontak mini, dan MODEL ASLI (.glb).
       ============================================================ */
    var modelMode = 'SIM';          // SIM | ASLI
    var CAT_MECH = ['flywheel', 'ringGear', 'crankshaft', 'piston', 'engineBlock', 'overrunningClutch', 'shiftLever', 'starterPinion'];
    var CAT_ELEC = ['battery', 'starterRelay', 'fuse', 'ignitionSwitch', 'positiveCable', 'groundCable'];
    var lastFadeKey = '';
    var SYNC_STAGES = [
        { s: 'RELAY_ACTIVE', t: 'RELAY', cid: 'starterRelay', d: 'Kunci START → arus kecil mengaliri kumparan relay, kontak relay menutup.' },
        { s: 'SOLENOID_ACTIVE', t: 'SOLENOID', cid: 'starterSolenoid', d: 'Arus dari relay masuk terminal 50 → pull-in & hold-in menarik plunger.' },
        { s: 'PINION_ENGAGED', t: 'PINION', cid: 'shiftLever', d: 'Tuas penggeser mendorong kopling & pinion maju berkaitan dengan ring gear.' },
        { s: 'STARTER_CRANKING', t: 'CRANKING', cid: 'starterArmature', d: 'Kontak utama menutup → arus besar ke motor, armatur memutar ring gear & crankshaft.' },
        { s: 'ENGINE_RUNNING', t: 'MESIN HIDUP', cid: 'crankshaft', d: 'Mesin hidup, kunci kembali ke ON → solenoid lepas, pinion mundur.' }
    ];

    function setAct(id, on) { var b = uiEl(id); if (b && b.classList) b.classList.toggle('active', !!on); }
    function setTxt(id, t) { var b = uiEl(id); if (b && b.textContent !== t) b.textContent = t; }
    function syncControls() {
        setAct('p6-btn-normal', viewMode === 'NORMAL');
        setAct('p6-btn-cutaway', viewMode === 'CUTAWAY');
        setAct('p6-btn-exploded', viewMode === 'EXPLODED');
        setAct('p6-btn-electrical', displayMode === 'ELECTRICAL');
        setAct('p6-btn-mechanical', displayMode === 'MECHANICAL');
        setAct('p6-btn-combined', displayMode === 'COMBINED');
        setAct('p6-btn-synced', displayMode === 'SYNCHRONIZED');
        setAct('p6-btn-teaching', teachingMode);
        setAct('p6-btn-explore', !teachingMode);
        setAct('p6-btn-pause3d', paused3d); setTxt('p6-btn-pause3d', paused3d ? 'RESUME 3D' : 'PAUSE 3D');
        setAct('p6-btn-pausesim', pausedSim); setTxt('p6-btn-pausesim', pausedSim ? 'RESUME SIM' : 'PAUSE SIM');
        setAct('p6-btn-labels', labelsOn); setTxt('p6-btn-labels', labelBtnText());
        setAct('p6-btn-sound', soundOn); setTxt('p6-btn-sound', soundOn ? 'SUARA: ON' : 'SUARA: OFF');
        setAct('p6-btn-debug', debugMode);
        var q = uiEl('p6-quality'); if (q && q.value !== currentQuality) q.value = currentQuality;
        var pf = uiEl('p6-perf'); if (pf) pf.checked = performanceMode;
        setAct('p6-btn-model-sim', modelMode === 'SIM');
        setAct('p6-btn-model-asli', modelMode === 'ASLI');
        setAct('p6-btn-autorot', autoRotate);
        var pb = uiEl('p6-pausebadge'); if (pb) pb.style.display = paused3d ? 'block' : 'none';
        var st = uiEl('p6-stage'); if (st) st.style.display = (displayMode === 'SYNCHRONIZED' && modelMode === 'SIM') ? 'flex' : 'none';
        var lg = uiEl('p6-legend'); if (lg) lg.innerHTML = legendHtml();
    }
    function legendHtml() {
        if (modelMode === 'ASLI') return '<b>MODEL ASLI</b> · tampilan file .glb (tanpa animasi kerja)';
        var m = { ELECTRICAL: '<b>ELECTRICAL</b> · fokus jalur listrik & aliran arus (bagian mekanis transparan)', MECHANICAL: '<b>MECHANICAL</b> · fokus gerak mekanis & arah putaran (kabel/battery transparan)', COMBINED: '<b>COMBINED</b> · listrik + mekanis', SYNCHRONIZED: '<b>SYNCHRONIZED</b> · tahap kerja mengikuti simulator' };
        return m[displayMode] || '';
    }

    /* ---- DISPLAY: transparansi kategori + glow kabel + tahap sinkron ---- */
    function applyDisplayFade() {
        var key = displayMode + '|' + modelMode;
        if (key === lastFadeKey) return;
        lastFadeKey = key;
        var fade = displayMode === 'ELECTRICAL' ? CAT_MECH : (displayMode === 'MECHANICAL' ? CAT_ELEC : []);
        Object.keys(matCache).forEach(function (k) {
            var m = matCache[k], cid = m.userData.cid;
            if (m.userData.baseOpacity == null) { m.userData.baseOpacity = m.opacity; m.userData.baseTransparent = m.transparent; m.userData.baseDepthWrite = m.depthWrite; }
            var f = !!cid && fade.indexOf(cid) >= 0;
            m.transparent = f ? true : m.userData.baseTransparent;
            m.opacity = f ? Math.min(0.12, m.userData.baseOpacity) : m.userData.baseOpacity;
            m.depthWrite = f ? false : m.userData.baseDepthWrite;
            m.needsUpdate = true;
        });
    }
    var _pulseT = 0;
    function updateDisplayFrame(anim, dt) {
        applyDisplayFade();
        _pulseT += dt;
        var elec = displayMode === 'ELECTRICAL' || displayMode === 'COMBINED' || displayMode === 'SYNCHRONIZED';
        var flow = anim.flow && anim.flow.effective > 0 && anim.currentNorm > 0.01;
        var pulse = 0.6 + 0.4 * Math.sin(_pulseT / 140);
        var syncCid = null;
        if (displayMode === 'SYNCHRONIZED') {
            var stg = SYNC_STAGES.find(function (x) { return x.s === anim.systemState; });
            syncCid = stg ? stg.cid : null;
        }
        Object.keys(matCache).forEach(function (k) {
            var m = matCache[k], cid = m.userData.cid;
            if (!cid || !m.emissive || cid === selectedComponent || cid === hoverCid) return;
            if (elec && flow && (cid === 'positiveCable' || cid === 'groundCable')) {
                m.emissive.setHex(cid === 'positiveCable' ? 0xff4a20 : 0x2f6bff);
                m.emissiveIntensity = (0.25 + 0.75 * anim.currentNorm) * pulse;
            } else if (syncCid && cid === syncCid) {
                m.emissive.setHex(0xffb020); m.emissiveIntensity = 0.55 * pulse;
            } else if (m.emissiveIntensity !== m.userData.baseEI || m.emissive.getHex() !== m.userData.baseEmissive) {
                m.emissive.setHex(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseEI;
            }
        });
        // panah arah putar (mode mekanis)
        var mech = displayMode !== 'ELECTRICAL' && modelMode === 'SIM' && explodedLevel < 0.05;
        if (G3D.arrowArm) { G3D.arrowArm.visible = mech && anim.spinning; if (!paused3d) G3D.arrowArm.rotation.x += dt * 0.004; }
        if (G3D.arrowFly) { G3D.arrowFly.visible = mech && ((anim.spinning && anim.engaged) || anim.running); if (!paused3d) G3D.arrowFly.rotation.x -= dt * 0.003; }
        updateStageOverlay(anim);
    }
    function buildRotationArrows() {
        function arrow(r, color) {
            var g = new THREE.Group();
            var arc = Math.PI * 1.45;
            var tg = new THREE.TorusGeometry(r, 0.022, 8, 48, arc); tg.rotateY(Math.PI / 2);
            var mat = new THREE.MeshStandardMaterial({ color: color, emissive: linColor(color), emissiveIntensity: 0.8, metalness: 0, roughness: 0.4 });
            g.add(new THREE.Mesh(tg, mat));
            var cone = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.15, 14), mat);
            var a = arc;
            cone.position.set(0, r * Math.sin(a), -r * Math.cos(a));
            var tan = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
            cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
            g.add(cone);
            g.visible = false;
            return g;
        }
        if (G3D.starter) { G3D.arrowArm = arrow(0.3, 0xffa51f); G3D.arrowArm.position.set(-1.16, 0, 0); G3D.starter.add(G3D.arrowArm); }
        if (G3D.engine) { G3D.arrowFly = arrow(0.5, 0x3fd27f); G3D.arrowFly.position.set(2.45, 0, 0); G3D.arrowFly.rotation.y = 0; G3D.engine.add(G3D.arrowFly); }
    }
    var _stageKey = '';
    function updateStageOverlay(anim) {
        var el = uiEl('p6-stage');
        if (!el || el.style.display === 'none') return;
        var idx = SYNC_STAGES.findIndex(function (x) { return x.s === anim.systemState; });
        var key = anim.systemState + '|' + idx;
        if (key === _stageKey) return;
        _stageKey = key;
        var html = '<div class="p6-stage-row">' + SYNC_STAGES.map(function (s, i) {
            var cls = i === idx ? 'cur' : (idx > i ? 'done' : '');
            return '<span class="p6-stage-step ' + cls + '"><i>' + (i + 1) + '</i>' + s.t + '</span>';
        }).join('<span class="p6-stage-arrow">›</span>') + '</div>';
        var cap = idx >= 0 ? SYNC_STAGES[idx].d : (anim.systemState === 'IGNITION_ON' ? 'Kunci ON — sistem siap. Tekan & tahan START untuk memulai.' : 'Sistem OFF. Putar kunci ke ON lalu tahan START (kontrol kunci di kanan atas).');
        el.innerHTML = html + '<div class="p6-stage-cap">' + esc(cap) + '</div>';
    }

    /* ---- TEACHING: tur terpandu ---- */
    var SCENE_VIEW = { cutaway: 'CUTAWAY', exploded: 'EXPLODED', solenoid: 'CUTAWAY', pinion: 'CUTAWAY', relay: 'NORMAL', crank: 'NORMAL', current: 'NORMAL' };
    var SCENE_RUN = { relay: 1, solenoid: 1, pinion: 1, crank: 1, current: 1 };
    function startTour(sceneKey) {
        var r = openDemo3D(sceneKey);
        if (!r.ok) return r;
        teachingMode = true; exploreMode = false;
        if (SCENE_VIEW[sceneKey] && modelMode === 'SIM') setViewMode(SCENE_VIEW[sceneKey]);
        if (sceneKey === 'current' && displayMode === 'MECHANICAL') setDisplayMode('COMBINED');
        stepFocus(demoStepCurrent());
        renderTeachPanel(); syncControls();
        return r;
    }
    function renderTeachPanel() {
        var wrap = uiEl('p6-teach'), txt = uiEl('p6-teach-text');
        if (!wrap || !txt) return;
        if (!teachingMode) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';
        var prev = uiEl('p6-teach-prev'), next = uiEl('p6-teach-next'), stop = uiEl('p6-teach-stop');
        if (!demoState.active) {
            txt.innerHTML = '<div class="p6t-kicker">MODE TEACHING</div><div class="p6t-title">Pilih topik tur terpandu</div><div class="p6t-scenes">'
                + Object.keys(DEMO_SCENES).map(function (k) { return '<button type="button" class="btn-sm" data-scene="' + k + '">' + esc(DEMO_SCENES[k].label) + ' <small>' + DEMO_SCENES[k].steps.length + ' langkah</small></button>'; }).join('') + '</div>';
            if (prev) prev.style.display = 'none';
            if (next) next.style.display = 'none';
            if (stop) { stop.textContent = 'TUTUP'; stop.onclick = function () { setTeaching(false); setExplore(true); renderTeachPanel(); syncControls(); }; }
            Array.prototype.forEach.call(txt.querySelectorAll('[data-scene]'), function (b) { b.onclick = function () { startTour(b.getAttribute('data-scene')); }; });
            return;
        }
        var step = demoStepCurrent(), sc = DEMO_SCENES[demoState.scene];
        var n = demoState.steps.length, i = demoState.index;
        txt.innerHTML = '<div class="p6t-kicker">TUR: ' + esc(sc.label).toUpperCase() + ' · LANGKAH ' + (i + 1) + '/' + n + '</div>'
            + '<div class="p6t-dots">' + demoState.steps.map(function (s, k) { return '<i class="' + (k === i ? 'cur' : (k < i ? 'done' : '')) + '"></i>'; }).join('') + '</div>'
            + '<div class="p6t-title">' + esc(step.title) + '</div><p>' + esc(step.text) + '</p>'
            + (SCENE_RUN[demoState.scene] && modelMode === 'SIM' ? '<button type="button" class="btn-sm p6t-run" id="p6t-run">▶ JALANKAN START 3 DETIK</button>' : '');
        if (prev) { prev.style.display = ''; prev.disabled = !demoHasPrev(); prev.onclick = function () { demoPrev(); stepFocus(demoStepCurrent()); renderTeachPanel(); }; }
        if (next) {
            next.style.display = '';
            next.disabled = false;
            next.textContent = demoHasNext() ? 'NEXT →' : 'SELESAI ✓';
            next.onclick = function () { if (demoHasNext()) { demoNext(); stepFocus(demoStepCurrent()); } else { demoStop(); } renderTeachPanel(); };
        }
        if (stop) { stop.textContent = 'TOPIK LAIN'; stop.onclick = function () { demoStop(); renderTeachPanel(); }; }
        var run = uiEl('p6t-run'); if (run) run.onclick = function () { pulseStart(3000); };
    }
    function pulseStart(ms) {
        try {
            if (typeof G.setIgnition === 'function') {
                G.setIgnition('ON');
                setTimeout(function () { G.setIgnition('START'); }, 150);
                setTimeout(function () { if (typeof G.releaseStart === 'function') G.releaseStart(); }, 150 + (ms || 3000));
            }
        } catch (e) { /* noop */ }
    }

    /* ---- kunci kontak mini di dalam 3D Lab ---- */
    function buildIgnitionMini(wrap) {
        if (uiEl('p6-ign')) return;
        var d = G.document.createElement('div');
        d.id = 'p6-ign'; d.className = 'p6-ign';
        d.innerHTML = '<span>KUNCI</span><button type="button" data-k="OFF">OFF</button><button type="button" data-k="ON">ON</button><button type="button" data-k="START" title="Tekan & tahan">START</button>';
        wrap.appendChild(d);
        Array.prototype.forEach.call(d.querySelectorAll('button'), function (b) {
            var k = b.getAttribute('data-k');
            if (k === 'START') {
                var down = function (e) { e.preventDefault(); try { G.setIgnition('ON'); G.setIgnition('START'); } catch (x) { /* noop */ } };
                var up = function () { try { if (typeof G.releaseStart === 'function') G.releaseStart(); } catch (x) { /* noop */ } };
                b.addEventListener('pointerdown', down);
                b.addEventListener('pointerup', up);
                b.addEventListener('pointerleave', up);
            } else b.addEventListener('click', function () { try { G.setIgnition(k); } catch (x) { /* noop */ } });
        });
    }
    function updateIgnitionMini() {
        var d = uiEl('p6-ign');
        if (!d) return;
        var pos = 'OFF';
        try { pos = (G.Sim && G.Sim.ignitionState) || pos; } catch (e) { /* noop */ }
        if (typeof Sim !== 'undefined' && Sim && Sim.ignitionState) pos = Sim.ignitionState;
        if (d._pos === pos) return;
        d._pos = pos;
        Array.prototype.forEach.call(d.querySelectorAll('button'), function (b) { b.classList.toggle('active', b.getAttribute('data-k') === pos); });
    }

    /* ---- SUARA (WebAudio, tanpa file) ---- */
    var audio = null, sndPrev = { relay: false, sol: false };
    function ensureAudio() {
        if (audio) return audio;
        var AC = G.AudioContext || G.webkitAudioContext;
        if (!AC) return null;
        try {
            var ctx = new AC();
            var master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
            var mo = ctx.createOscillator(); mo.type = 'sawtooth';
            var mf = ctx.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 1100;
            var mg = ctx.createGain(); mg.gain.value = 0;
            mo.connect(mf); mf.connect(mg); mg.connect(master); mo.start();
            var eo = ctx.createOscillator(); eo.type = 'square';
            var ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 260;
            var eg = ctx.createGain(); eg.gain.value = 0;
            eo.connect(ef); ef.connect(eg); eg.connect(master); eo.start();
            var nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate), ch = nb.getChannelData(0), seed = 1234567;
            for (var i = 0; i < ch.length; i++) { seed = (seed * 16807) % 2147483647; ch[i] = (seed / 2147483647) * 2 - 1; }
            audio = { ctx: ctx, master: master, mo: mo, mg: mg, eo: eo, eg: eg, noise: nb };
        } catch (e) { audio = null; }
        return audio;
    }
    function clickSound(freq, dur, vol) {
        if (!audio) return;
        var c = audio.ctx, s = c.createBufferSource(); s.buffer = audio.noise;
        var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 2.5;
        var g = c.createGain(), t = c.currentTime;
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        s.connect(f); f.connect(g); g.connect(audio.master);
        s.start(t); s.stop(t + dur + 0.02);
    }
    function silence() { if (audio) { var t = audio.ctx.currentTime; audio.mg.gain.setTargetAtTime(0, t, 0.05); audio.eg.gain.setTargetAtTime(0, t, 0.05); } }
    function updateSound(anim) {
        if (!soundOn || !audio || modelMode !== 'SIM') { silence(); return; }
        var t = audio.ctx.currentTime;
        var relayOn = anim.relayV > 0.4, solOn = anim.solenoidV > 0.4;
        if (relayOn !== sndPrev.relay) clickSound(2600, 0.035, 0.6);
        if (solOn !== sndPrev.sol) clickSound(solOn ? 320 : 520, solOn ? 0.12 : 0.07, 1.0);
        sndPrev.relay = relayOn; sndPrev.sol = solOn;
        if (anim.spinning) {
            audio.mo.frequency.setTargetAtTime(70 + anim.starterRPM * 0.38, t, 0.08);
            audio.mg.gain.setTargetAtTime(0.11, t, 0.05);
        } else audio.mg.gain.setTargetAtTime(0, t, 0.08);
        if (anim.running) {
            audio.eo.frequency.setTargetAtTime(Math.max(36, anim.engineRPM / 60 * 4), t, 0.2);
            audio.eg.gain.setTargetAtTime(0.09, t, 0.2);
        } else audio.eg.gain.setTargetAtTime(0, t, 0.15);
    }

    /* ---- DEBUG overlay ---- */
    var dbg = { frames: 0, acc: 0, fps: 0, last: 0 };
    function updateDebug(dt, anim) {
        dbg.frames++; dbg.acc += dt;
        if (dbg.acc >= 500) { dbg.fps = Math.round(dbg.frames * 1000 / dbg.acc); dbg.frames = 0; dbg.acc = 0; }
        var el = uiEl('p6-debug');
        if (!el || !debugMode) return;
        var now = nowMs();
        if (now - dbg.last < 400) return;
        dbg.last = now;
        var inf = renderer && renderer.info ? renderer.info : { render: {}, memory: {} };
        var rows = [
            ['FPS', dbg.fps], ['Draw calls', inf.render.calls], ['Segitiga', (inf.render.triangles || 0).toLocaleString('id-ID')],
            ['Geometri', inf.memory.geometries], ['Tekstur', inf.memory.textures], ['Pixel ratio', renderer ? renderer.getPixelRatio().toFixed(2) : '-'],
            ['Kualitas', currentQuality + (performanceMode ? ' + PERF' : '')], ['Model', modelMode], ['View / Display', viewMode + ' / ' + displayMode],
            ['State', anim.systemState], ['Starter / Mesin', Math.round(anim.starterRPM) + ' / ' + Math.round(anim.engineRPM) + ' rpm'], ['Arus', Math.round(anim.current) + ' A'],
            ['Kamera', 'd ' + view.dist.toFixed(2) + ' · θ ' + view.polar.toFixed(2) + ' · φ ' + wrapAngle(view.azim).toFixed(2)],
            ['Target', view.target.map(function (v) { return v.toFixed(2); }).join(', ')]
        ];
        el.innerHTML = '<div class="p6-dbg-title">DEBUG 3D</div>' + rows.map(function (r) { return '<div><span>' + r[0] + '</span><b>' + esc(String(r[1])) + '</b></div>'; }).join('');
    }

    /* ---- KUALITAS ---- */
    function applyRenderQuality() {
        if (!renderer) return;
        var Q = CFG.quality[currentQuality];
        var sh = !!Q.shadows && !performanceMode;
        if (renderer.shadowMap.enabled !== sh) {
            renderer.shadowMap.enabled = sh;
            sceneObj.traverse(function (o) { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; }); } });
        }
        if (shadowLight) {
            shadowLight.castShadow = sh;
            var size = currentQuality === 'HIGH' ? 2048 : (currentQuality === 'LOW' ? 512 : 1024);
            if (shadowLight.shadow.mapSize.x !== size) {
                shadowLight.shadow.mapSize.set(size, size);
                if (shadowLight.shadow.map) { shadowLight.shadow.map.dispose(); shadowLight.shadow.map = null; }
            }
        }
        var lim = performanceMode ? Math.ceil(particleMeshes.length / 2) : particleMeshes.length;
        particleMeshes.forEach(function (p, i) { p.userData.off = i >= lim; });
        try { renderer.setPixelRatio(pixelRatioFor(currentQuality)); canvasW = 0; syncCanvasSize(); } catch (e) { /* noop */ }
    }

    /* ============================================================
       13g. MODEL ASLI (.glb / .gltf) — pembaca glTF 2.0 ringan
       Mendukung: mesh statis, hierarki node, material PBR (metal-
       rough & spec-gloss), tekstur tertanam, warna vertex.
       Tidak mendukung: kompresi Draco/Meshopt, animasi/skin.
       ============================================================ */
    var glb = { root: null, meshes: [], name: '', explode: [] };
    var GL_TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
    var GL_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
    function parseGltfContainer(buf) {
        var dv = new DataView(buf), json = null, bin = null;
        if (dv.getUint32(0, true) === 0x46546C67) {
            var len = dv.getUint32(8, true), off = 12;
            while (off < len) {
                var clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true);
                var chunk = buf.slice(off + 8, off + 8 + clen);
                if (ctype === 0x4E4F534A) json = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(chunk)));
                else if (ctype === 0x004E4942) bin = chunk;
                off += 8 + clen;
            }
        } else {
            json = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buf)));
        }
        if (!json) throw new Error('File bukan glTF/GLB yang valid.');
        return { json: json, bin: bin };
    }
    function dataUriToBuffer(uri) {
        var b64 = uri.split(',')[1] || '', s = atob(b64), a = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
        return a.buffer;
    }
    function buildGltf(json, bin) {
        var req = (json.extensionsRequired || []);
        if (req.indexOf('KHR_draco_mesh_compression') >= 0 || req.indexOf('EXT_meshopt_compression') >= 0) throw new Error('Model memakai kompresi Draco/Meshopt yang belum didukung. Ekspor ulang model tanpa kompresi.');
        var buffers = (json.buffers || []).map(function (b, i) {
            if (b.uri && /^data:/.test(b.uri)) return dataUriToBuffer(b.uri);
            if (!b.uri && i === 0 && bin) return bin;
            throw new Error('File .gltf dengan buffer terpisah tidak didukung — gunakan format .glb.');
        });
        function viewBytes(vi) { var v = json.bufferViews[vi]; return { buf: buffers[v.buffer], off: v.byteOffset || 0, len: v.byteLength, stride: v.byteStride || 0 }; }
        var accCache = {};
        function accessor(ai) {
            if (accCache[ai]) return accCache[ai];
            var a = json.accessors[ai], T = GL_TYPES[a.componentType], n = GL_SIZE[a.type], out;
            if (a.bufferView == null) out = new T(a.count * n);
            else {
                var v = viewBytes(a.bufferView), base = v.off + (a.byteOffset || 0), el = T.BYTES_PER_ELEMENT * n;
                if (!v.stride || v.stride === el) out = new T(v.buf.slice(base, base + a.count * el));
                else {
                    out = new T(a.count * n);
                    var src = new DataView(v.buf), getter = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
                    for (var i = 0; i < a.count; i++) for (var k = 0; k < n; k++) out[i * n + k] = src[getter](base + i * v.stride + k * T.BYTES_PER_ELEMENT, true);
                }
            }
            var res = { arr: out, size: n, norm: !!a.normalized };
            accCache[ai] = res;
            return res;
        }
        var texCache = {}, pending = [];
        function texture(ti, srgb) {
            if (ti == null) return null;
            var key = ti + (srgb ? 's' : 'l');
            if (texCache[key]) return texCache[key];
            var t = json.textures[ti], src = t.source != null ? t.source : (t.extensions && t.extensions.EXT_texture_webp ? t.extensions.EXT_texture_webp.source : null);
            var im = json.images[src];
            if (!im) return null;
            var url;
            if (im.bufferView != null) {
                var v = viewBytes(im.bufferView);
                url = URL.createObjectURL(new Blob([new Uint8Array(v.buf, v.off, v.len)], { type: im.mimeType || 'image/png' }));
            } else if (im.uri && /^data:/.test(im.uri)) url = im.uri;
            else return null;
            var tex = new THREE.Texture();
            tex.flipY = false;
            if (srgb) tex.encoding = THREE.sRGBEncoding;
            var smp = t.sampler != null ? json.samplers[t.sampler] : {};
            var wrap = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping };
            tex.wrapS = wrap[smp.wrapS] || THREE.RepeatWrapping; tex.wrapT = wrap[smp.wrapT] || THREE.RepeatWrapping;
            tex.anisotropy = 4;
            var img = new Image();
            pending.push(new Promise(function (res) {
                img.onload = function () { tex.image = img; tex.needsUpdate = true; res(); };
                img.onerror = function () { res(); };
            }));
            img.src = url;
            texCache[key] = tex;
            return tex;
        }
        var matCacheG = {};
        function material(mi, vcol) {
            var key = mi + (vcol ? 'v' : '');
            if (matCacheG[key]) return matCacheG[key];
            var md = mi != null ? json.materials[mi] : {};
            var pbr = md.pbrMetallicRoughness || {}, sg = md.extensions && md.extensions.KHR_materials_pbrSpecularGlossiness;
            var m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
            if (sg) {
                var df = sg.diffuseFactor || [1, 1, 1, 1];
                m.color.setRGB(df[0], df[1], df[2]); m.opacity = df[3];
                if (sg.diffuseTexture) m.map = texture(sg.diffuseTexture.index, true);
                m.metalness = 0.1; m.roughness = 1 - (sg.glossinessFactor != null ? sg.glossinessFactor : 1) * 0.85;
            } else {
                var bc = pbr.baseColorFactor || [1, 1, 1, 1];
                m.color.setRGB(bc[0], bc[1], bc[2]); m.opacity = bc[3];
                if (pbr.baseColorTexture) m.map = texture(pbr.baseColorTexture.index, true);
                m.metalness = pbr.metallicFactor != null ? pbr.metallicFactor : 1;
                m.roughness = pbr.roughnessFactor != null ? pbr.roughnessFactor : 1;
                if (pbr.metallicRoughnessTexture) { var mr = texture(pbr.metallicRoughnessTexture.index, false); m.metalnessMap = mr; m.roughnessMap = mr; }
            }
            if (md.normalTexture) { m.normalMap = texture(md.normalTexture.index, false); var sc = md.normalTexture.scale != null ? md.normalTexture.scale : 1; m.normalScale.set(sc, -sc); }
            if (md.emissiveFactor) m.emissive.setRGB(md.emissiveFactor[0], md.emissiveFactor[1], md.emissiveFactor[2]);
            if (md.emissiveTexture) m.emissiveMap = texture(md.emissiveTexture.index, true);
            if (md.alphaMode === 'BLEND') { m.transparent = true; m.depthWrite = false; }
            else if (md.alphaMode === 'MASK') m.alphaTest = md.alphaCutoff != null ? md.alphaCutoff : 0.5;
            if (vcol) m.vertexColors = true;
            m.userData.baseEmissive = m.emissive.getHex(); m.userData.baseEI = m.emissiveIntensity; m.userData.glb = true;
            matCacheG[key] = m;
            return m;
        }
        function toFloat(acc) {
            if (acc.arr instanceof Float32Array) return acc.arr;
            var out = new Float32Array(acc.arr.length);
            var div = acc.norm ? ({ Int8Array: 127, Uint8Array: 255, Int16Array: 32767, Uint16Array: 65535 }[acc.arr.constructor.name] || 1) : 1;
            for (var i = 0; i < out.length; i++) out[i] = acc.arr[i] / div;
            return out;
        }
        var meshes = [];
        function buildMesh(mi, nodeName) {
            var md = json.meshes[mi], grp = new THREE.Group();
            md.primitives.forEach(function (p) {
                if (p.mode != null && p.mode !== 4) return;
                if (p.extensions && p.extensions.KHR_draco_mesh_compression) throw new Error('Model memakai kompresi Draco yang belum didukung.');
                var g = new THREE.BufferGeometry(), at = p.attributes;
                if (at.POSITION == null) return;
                var pos = accessor(at.POSITION);
                g.setAttribute('position', new THREE.BufferAttribute(toFloat(pos), 3));
                if (at.NORMAL != null) g.setAttribute('normal', new THREE.BufferAttribute(toFloat(accessor(at.NORMAL)), 3));
                if (at.TEXCOORD_0 != null) g.setAttribute('uv', new THREE.BufferAttribute(toFloat(accessor(at.TEXCOORD_0)), 2));
                var vcol = false;
                if (at.COLOR_0 != null) { var c = accessor(at.COLOR_0); g.setAttribute('color', new THREE.BufferAttribute(toFloat(c), c.size)); vcol = true; }
                if (p.indices != null) { var ix = accessor(p.indices); g.setIndex(new THREE.BufferAttribute(ix.arr instanceof Uint8Array ? new Uint16Array(ix.arr) : ix.arr, 1)); }
                if (at.NORMAL == null) g.computeVertexNormals();
                var mesh = new THREE.Mesh(g, material(p.material, vcol));
                mesh.castShadow = true; mesh.receiveShadow = true;
                mesh.userData.glbName = nodeName || md.name || ('Bagian ' + (meshes.length + 1));
                grp.add(mesh); meshes.push(mesh);
            });
            return grp;
        }
        function buildNode(ni) {
            var nd = json.nodes[ni], o = new THREE.Group();
            o.name = nd.name || '';
            if (nd.matrix) { o.matrix.fromArray(nd.matrix); o.matrix.decompose(o.position, o.quaternion, o.scale); }
            else {
                if (nd.translation) o.position.fromArray(nd.translation);
                if (nd.rotation) o.quaternion.fromArray(nd.rotation);
                if (nd.scale) o.scale.fromArray(nd.scale);
            }
            if (nd.mesh != null) o.add(buildMesh(nd.mesh, nd.name));
            (nd.children || []).forEach(function (c) { o.add(buildNode(c)); });
            return o;
        }
        var scene = new THREE.Group();
        var sIdx = json.scene != null ? json.scene : 0;
        var roots = json.scenes && json.scenes[sIdx] ? json.scenes[sIdx].nodes : (json.nodes || []).map(function (n, i) { return i; });
        roots.forEach(function (n) { scene.add(buildNode(n)); });
        return { group: scene, meshes: meshes, ready: Promise.all(pending) };
    }

    function loadGLBBuffer(buf, name) {
        if (!renderer) return Promise.reject(new Error('3D belum siap.'));
        var parsed = parseGltfContainer(buf);
        var res = buildGltf(parsed.json, parsed.bin);
        if (!res.meshes.length) throw new Error('Model tidak berisi mesh yang dapat ditampilkan.');
        if (glb.root) { sceneObj.remove(glb.root); glb.root.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
        CUT.mats = CUT.mats.filter(function (m) { return !m.userData.glb; });
        var holder = new THREE.Group(); holder.name = 'glbModel';
        holder.add(res.group);
        sceneObj.add(holder);
        holder.updateMatrixWorld(true);
        var box = new THREE.Box3().setFromObject(res.group), size = new THREE.Vector3(), ctr = new THREE.Vector3();
        box.getSize(size); box.getCenter(ctr);
        var s = 3.4 / Math.max(size.x, size.y, size.z, 1e-6);
        res.group.scale.multiplyScalar(s);
        res.group.position.sub(ctr.multiplyScalar(s));
        holder.position.set(STARTER_C[0], STARTER_C[1], STARTER_C[2]);
        holder.updateMatrixWorld(true);
        // arah urai (exploded) per mesh: dari pusat model ke pusat mesh
        var mctr = new THREE.Vector3(STARTER_C[0], STARTER_C[1], STARTER_C[2]);
        glb.explode = res.meshes.map(function (m) {
            var b = new THREE.Box3().setFromObject(m), c = new THREE.Vector3(); b.getCenter(c);
            var dir = c.clone().sub(mctr);
            if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
            dir.normalize().multiplyScalar(1.1);
            var p0 = m.parent.worldToLocal(c.clone()), p1 = m.parent.worldToLocal(c.clone().add(dir));
            return { mesh: m, base: m.position.clone(), local: p1.sub(p0) };
        });
        var mats = [];
        res.meshes.forEach(function (m) { if (mats.indexOf(m.material) < 0) mats.push(m.material); });
        mats.forEach(function (m) { CUT.mats.push(m); });
        glb.root = holder; glb.meshes = res.meshes; glb.name = name || 'model.glb';
        p6log('p6:glb-loaded', { name: glb.name, meshes: res.meshes.length });
        setModelMode('ASLI');
        applyViewMode();
        return res.ready.then(function () { return { ok: true, meshes: res.meshes.length, name: glb.name }; });
    }
    function loadGLBFile(file) {
        if (!file) return;
        var info = uiEl('p6-model-info');
        if (info) info.textContent = 'Memuat ' + file.name + '…';
        var fr = new FileReader();
        fr.onload = function () {
            try {
                loadGLBBuffer(fr.result, file.name).then(function (r) { if (info) info.textContent = 'Model asli: ' + r.name + ' (' + r.meshes + ' bagian)'; }, function (e) { if (info) info.textContent = e.message; });
            } catch (e) { if (info) info.textContent = 'Gagal memuat: ' + e.message; }
        };
        fr.readAsArrayBuffer(file);
    }
    function tryAutoLoadGLB() {
        if (!G.fetch || !G.location || !/^https?:/.test(G.location.protocol)) return;
        G.fetch('models/starter-motor.glb').then(function (r) { if (!r.ok) throw new Error('none'); return r.arrayBuffer(); })
            .then(function (buf) {
                loadGLBBuffer(buf, 'starter-motor.glb').then(function (r) { var info = uiEl('p6-model-info'); if (info) info.textContent = 'Model asli: ' + r.name + ' (' + r.meshes + ' bagian)'; });
            }).catch(function () { /* tidak ada model asli → tetap model simulasi */ });
    }
    function setModelMode(mode) {
        if (mode === 'ASLI' && !glb.root) {
            var inp = uiEl('p6-glb-input'); if (inp) inp.click();
            return { ok: false, error: 'noModel' };
        }
        modelMode = mode === 'ASLI' ? 'ASLI' : 'SIM';
        if (glb.root) glb.root.visible = modelMode === 'ASLI';
        if (G3D.starter) G3D.starter.visible = modelMode === 'SIM';
        lastFadeKey = '';
        if (modelMode === 'ASLI') { setCameraFace('STARTER'); camDistBase = 5.2; }
        syncControls();
        return { ok: true, mode: modelMode };
    }
    function updateGlbExplode(e) {
        if (!glb.root || modelMode !== 'ASLI') return;
        for (var i = 0; i < glb.explode.length; i++) {
            var x = glb.explode[i];
            x.mesh.position.set(x.base.x + x.local.x * e, x.base.y + x.local.y * e, x.base.z + x.local.z * e);
        }
    }
    var glbSel = null;
    function glbRaycast(clientX, clientY) {
        if (!glb.meshes.length || !camera3d) return null;
        var rect = renderer.domElement.getBoundingClientRect();
        if (!_ray) { _ray = new THREE.Raycaster(); _ndc = new THREE.Vector2(); }
        _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
        _ray.setFromCamera(_ndc, camera3d);
        var hits = _ray.intersectObjects(glb.meshes, false), cut = viewMode === 'CUTAWAY';
        for (var i = 0; i < hits.length; i++) {
            if (cut && CUT.plane.distanceToPoint(hits[i].point) < 0) continue;
            return { mesh: hits[i].object, name: hits[i].object.userData.glbName, point: hits[i].point };
        }
        return null;
    }
    function glbHighlight(mesh) {
        if (glbSel && glbSel.material) { glbSel.material.emissive.setHex(glbSel.material.userData.baseEmissive); glbSel.material.emissiveIntensity = glbSel.material.userData.baseEI; }
        glbSel = mesh;
        if (mesh && mesh.material) {
            if (!mesh.material.userData.own) { mesh.material = mesh.material.clone(); mesh.material.userData.own = true; mesh.material.userData.glb = true; if (viewMode === 'CUTAWAY') mesh.material.clippingPlanes = [CUT.plane]; CUT.mats.push(mesh.material); }
            mesh.material.emissive.setHex(0x1d6fe0); mesh.material.emissiveIntensity = 0.5;
        }
        var panel = uiEl('p6-info-panel');
        if (panel && mesh) {
            panel.innerHTML = '<div class="p6-info-head">' + esc(mesh.userData.glbName) + '<span class="p6-info-en">Model asli (.glb)</span></div><div class="p6-info-row"><b>Info</b>Bagian dari file model 3D asli. Untuk penjelasan fungsi & animasi kerja, beralih ke MODEL SIMULASI lalu klik komponen yang sama.</div>';
            updateHud._panelHtml = null;
        }
    }

    /* ---- overlay & tombol tambahan di area kanvas ---- */
    function buildLabExtras() {
        var wrap = uiEl('p6-canvas-wrap');
        if (!wrap || !G.document) return;
        var teach = uiEl('p6-teach'); if (teach && teach.parentNode !== wrap) { wrap.appendChild(teach); teach.classList.add('overlay'); }
        var dbgEl = uiEl('p6-debug'); if (dbgEl && dbgEl.parentNode !== wrap) { wrap.appendChild(dbgEl); dbgEl.classList.add('overlay'); }
        buildIgnitionMini(wrap);
        if (!uiEl('p6-stage')) { var st = G.document.createElement('div'); st.id = 'p6-stage'; st.className = 'p6-stage'; st.style.display = 'none'; wrap.appendChild(st); }
        if (!uiEl('p6-pausebadge')) { var pb = G.document.createElement('div'); pb.id = 'p6-pausebadge'; pb.className = 'p6-pausebadge'; pb.textContent = '❚❚ ANIMASI 3D DIJEDA'; pb.style.display = 'none'; wrap.appendChild(pb); }
        if (!uiEl('p6-legend')) { var lg = G.document.createElement('div'); lg.id = 'p6-legend'; lg.className = 'p6-legend'; wrap.appendChild(lg); }
        syncControls();
    }

    function focusAndFly(cid) {
        if (modelMode !== 'SIM') setModelMode('SIM');
        var INTERNAL = ['starterArmature', 'starterCommutator', 'starterBrushes', 'fieldCoil', 'overrunningClutch', 'starterPinion', 'shiftLever'];
        if (INTERNAL.indexOf(cid) >= 0 && viewMode === 'NORMAL') setViewMode('CUTAWAY');
        focusComponent(cid);
        if (renderer) flyToComponent(cid);
        syncControls();
        return { ok: true };
    }

    /* ============================================================
       14. FALLBACK 2D (SVG) - bila WebGL tidak tersedia
       ============================================================ */
    var fallbackSvg = null;
    var fallbackSig = null;
    function buildFallback2D() {
        var host = uiEl('p6-fallback-svg');
        if (!host) return;
        host.innerHTML = '';
        fallbackSvg = host;
        fallbackSig = null;
        renderFallback();
    }

    function renderFallback() {
        if (!fallbackSvg) return;
        var anim = computeAnimationState();
        if (typeof fallbackSvg.querySelector !== 'function') {
            fallbackSvg.innerHTML = generateBasicSchematic(anim, viewMode === 'EXPLODED');
            return;
        }
        var sig = fallbackSignature(anim);
        if (sig !== fallbackSig) {
            fallbackSvg.innerHTML = generateBasicSchematic(anim, viewMode === 'EXPLODED');
            fallbackSig = sig;
        } else {
            updateFallbackLive(anim);
        }
    }

    function fallbackSignature(anim) {
        return [
            viewMode, displayMode,
            anim.fuseOpen ? 1 : 0,
            anim.currentNorm > 0.01 ? 1 : 0,
            anim.relayV > 0.4 ? 1 : 0,
            anim.solenoidV > 0.4 ? 1 : 0,
            anim.spinning ? 1 : 0,
            anim.engaged ? 1 : 0,
            anim.running ? 1 : 0,
            anim.batteryVoltage < 11.5 ? 1 : 0
        ].join('|');
    }

    function updateFallbackLive(anim) {
        setFallbackText('p6f2d-batt', anim.batteryVoltage.toFixed(1) + ' V');
        setFallbackText('p6f2d-rpm-s', anim.spinning ? Math.round(anim.starterRPM) + ' RPM' : '');
        setFallbackText('p6f2d-rpm-e', anim.running ? Math.round(anim.engineRPM) + ' RPM' : '');
    }

    function setFallbackText(id, txt) {
        if (!fallbackSvg || typeof fallbackSvg.querySelector !== 'function') return;
        var el = null;
        try { el = fallbackSvg.querySelector('#' + id); } catch (e) { return; }
        if (el && el.textContent !== txt) el.textContent = txt;
    }

    function generateBasicSchematic(anim, exploded) {
        var on = anim.currentNorm > 0.01;
        var relayOn = anim.relayV > 0.4;
        var spin = anim.spinning;
        var engage = anim.engaged;
        var dim2 = displayMode === 'ELECTRICAL';
        var h = 480, w = 820;
        var flow = on ? ' class="flow"' : '';
        var svg = '<div class="p6-fallback-wrap"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Skema 2D sistem starter">';
        svg += '<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="10" fill="#f4f7fb"/>';
        svg += '<path d="M90,150 L205,150" class="cable' + (dim2 ? ' dim' : '') + '"' + flow + '/>';
        svg += '<path d="M205,150 L205,240 L330,240" class="cable' + (dim2 ? ' dim' : '') + '"' + flow + '/>';
        svg += '<path d="M330,240 L330,290" class="cable' + (dim2 ? ' dim' : '') + '"' + flow + '/>';
        svg += '<path d="M420,320 L420,370 L600,370" class="cable' + (dim2 ? ' dim' : '') + '"' + flow + '/>';
        svg += '<path d="M600,305 L600,240 L420,165 L420,150" class="cable' + (dim2 ? ' dim' : '') + '"' + flow + '/>';
        svg += '<path d="M90,240 L90,320 L420,320" class="cable gnd' + (dim2 ? ' dim' : '') + '"' + flow + '/>';
        svg += '<path d="M90,240 L90,150" stroke="#44566a"/>';
        var explOffset = exploded ? 26 : 0;
        var battery = '<g class="part" data-cid="battery" title="Baterai" transform="translate(0,' + (-explOffset) + ')">'
            + '<rect x="50" y="120" width="64" height="60" rx="6" fill="#e9f2fb" stroke="#4a8fd4"/>'
            + '<text x="82" y="156" fill="#16324b" font-size="13" text-anchor="middle">B+</text>'
            + '<line x1="82" y1="120" x2="82" y2="104" stroke="#2c4056" stroke-width="3"/>'
            + '<line x1="82" y1="180" x2="82" y2="202" stroke="#7a8ba0" stroke-width="3"/>'
            + '<text id="p6f2d-batt" x="82" y="220" class="cap" fill="#2c5f86" font-size="11" text-anchor="middle">' + anim.batteryVoltage.toFixed(1) + ' V</text></g>';
        var fuse = '<g class="part" data-cid="fuse" title="Fuse">'
            + '<rect x="205" y="138" width="22" height="24" fill="none" stroke="#c9972e"/>'
            + '<path d="M216,140 L216,160" stroke="#c9972e" stroke-width="2"' + (anim.fuseOpen ? ' stroke-dasharray="3 3"' : '') + '/></g>';
        var relay = '<g class="part" data-cid="starterRelay" title="Relay Starter" transform="translate(0,' + (-explOffset) + ')">'
            + '<rect x="300" y="200" width="60" height="52" rx="6" fill="#eef3fa" stroke="#4a8fd4"/>'
            + '<text x="330" y="270" fill="#23364c" font-size="11" text-anchor="middle">Relay</text>'
            + '<path d="M312,214 L348,214" stroke="#c9972e" stroke-width="3"' + (relayOn ? '' : ' stroke-dasharray="4 4"') + '/>'
            + '<circle cx="330" cy="214" r="3" fill="' + (relayOn ? '#22c96e' : '#9aa6b4') + '"/></g>';
        var solenoid = '<g class="part" data-cid="starterSolenoid" title="Solenoid" transform="translate(0,' + (-explOffset) + ')">'
            + '<rect x="420" y="150" width="46" height="70" rx="8" fill="#fdf2e5" stroke="#e0852e"/>'
            + '<text x="443" y="235" fill="#23364c" font-size="11" text-anchor="middle">Solenoid</text>'
            + '<circle cx="443" cy="180" r="6" fill="' + (anim.solenoidV > 0.4 ? '#22c96e' : '#9aa6b4') + '"/></g>';
        var starter = '<g class="part" data-cid="starterHousing" title="Motor Starter" transform="translate(0,' + explOffset + ')">'
            + '<rect x="600" y="220" width="56" height="86" rx="8" fill="#f0f4f9" stroke="#e0852e"/>'
            + '<circle cx="628" cy="263" r="20" fill="none" stroke="#7a8ba0" stroke-width="6"' + (spin ? ' class="spin-link"' : '') + '/>'
            + '<text x="628" y="315" fill="#23364c" font-size="11" text-anchor="middle">Starter</text>'
            + (spin ? '<text id="p6f2d-rpm-s" x="628" y="332" fill="#0e9f63" font-size="10" text-anchor="middle">' + Math.round(anim.starterRPM) + ' RPM</text>' : '') + '</g>';
        var ringG = '<g class="part" data-cid="ringGear" title="Ring gear / flywheel" transform="translate(0,' + explOffset + ')">'
            + '<circle cx="420" cy="340" r="34" fill="none" stroke="#8a96a6" stroke-width="10"' + (spin || anim.running ? ' class="spin-link"' : '') + '/>'
            + '<circle cx="420" cy="340" r="18" fill="#dde6f0" stroke="#6b7a8e"/></g>';
        var flyLabel = '<text x="420" y="392" fill="#23364c" font-size="11" text-anchor="middle">Flywheel</text>'
            + (anim.running ? '<text id="p6f2d-rpm-e" x="420" y="406" fill="#0e5f9e" font-size="10" text-anchor="middle">' + Math.round(anim.engineRPM) + ' RPM</text>' : '');
        var gnd = '<g class="part" data-cid="groundCable" title="Kabel massa">'
            + '<circle cx="90" cy="320" r="4" fill="#6b7a8e"/>'
            + '<line x1="90" y1="320" x2="56" y2="340" stroke="#7a8ba0" stroke-width="3"/>'
            + '<line x1="90" y1="320" x2="124" y2="340" stroke="#7a8ba0" stroke-width="3"/>'
            + '<text x="90" y="352" fill="#4b5d70" font-size="10" text-anchor="middle">GND</text></g>';
        var ignPos = 'OFF';
        try { ignPos = (typeof Sim !== 'undefined' && Sim && Sim.ignitionState) || 'OFF'; } catch (e0) { /* noop */ }
        var ign = '<g class="part" data-cid="ignitionSwitch" title="Kunci Kontak" transform="translate(0,' + (-explOffset) + ')">'
            + '<rect x="226" y="190" width="54" height="40" rx="6" fill="#eef3fa" stroke="#4a8fd4"/>'
            + '<circle cx="246" cy="210" r="9" fill="none" stroke="#c9972e" stroke-width="2"/>'
            + '<line x1="246" y1="210" x2="' + (ignPos === 'START' ? 266 : (ignPos === 'ON' ? 262 : 246)) + '" y2="' + (ignPos === 'START' ? 218 : (ignPos === 'ON' ? 202 : 196)) + '" stroke="#c9972e" stroke-width="2.5" stroke-linecap="round"/>'
            + '<text x="253" y="184" fill="#23364c" font-size="11" text-anchor="middle">Kunci Kontak</text>'
            + '<text x="253" y="244" fill="#8a6a1a" font-size="10" text-anchor="middle">' + ignPos + '</text></g>';
        var engineG = '<g class="part" data-cid="engineBlock" title="Mesin" transform="translate(0,' + explOffset + ')">'
            + '<rect x="372" y="420" width="96" height="46" rx="8" fill="#e6ebf1" stroke="#6b7a8e"/>'
            + '<line x1="420" y1="374" x2="420" y2="420" stroke="#8a96a6" stroke-width="4"/>'
            + '<text x="420" y="448" fill="#23364c" font-size="12" text-anchor="middle">Mesin</text></g>';
        svg += battery + fuse + ign + relay + solenoid + ringG + flyLabel + engineG + starter + gnd;
        svg += '<text x="8" y="20" fill="#5a6c80" font-size="11">MODE 2D (fallback) - klik komponen untuk ukur/inspeksi</text>';
        svg += '</svg></div>';
        return svg;
    }

    function applyFallbackView() {
        renderFallback();
    }

    function applyFallbackFrame(anim) {
        if (!fallbackSvg) return;
        if (frameThrottle()) renderFallback();
    }
    function frameThrottle() {
        var now = nowMs();
        if (now - (frameThrottle._last || 0) < 300) return false;
        frameThrottle._last = now;
        return true;
    }

    function bindFallbackEvents() {
        var host = uiEl('p6-fallback-svg');
        if (!host) return;
        host.addEventListener('click', function (e) {
            var node = e.target;
            while (node && node !== host && !node.getAttribute('data-cid')) node = node.parentNode;
            if (node && node.getAttribute) {
                var cid = node.getAttribute('data-cid');
                if (cid) { focusComponent(cid); pickForMeasurement(cid); }
            }
        });
    }

    /* ============================================================
       15. CONTROL BIND + INIT (browser)
       ============================================================ */
    function bindControls() {
        bindBtn('p6-btn-normal', function () { return setViewMode('NORMAL'); });
        bindBtn('p6-btn-cutaway', function () { return setViewMode('CUTAWAY'); });
        bindBtn('p6-btn-exploded', function () { return setViewMode('EXPLODED'); });
        bindBtn('p6-btn-electrical', function () { return setDisplayMode('ELECTRICAL'); });
        bindBtn('p6-btn-mechanical', function () { return setDisplayMode('MECHANICAL'); });
        bindBtn('p6-btn-combined', function () { return setDisplayMode('COMBINED'); });
        bindBtn('p6-btn-synced', function () { return setDisplayMode('SYNCHRONIZED'); });
        bindBtn('p6-btn-teaching', function () { return setTeaching(true); });
        bindBtn('p6-btn-explore', function () { return setExplore(true); });
        bindBtn('p6-btn-pause3d', function () { var p = togglePause3D(); var b = uiEl('p6-btn-pause3d'); if (b) { b.textContent = p ? 'RESUME 3D' : 'PAUSE 3D'; } return p; });
        bindBtn('p6-btn-pausesim', function () { var p = togglePauseSim(); var b = uiEl('p6-btn-pausesim'); if (b) { b.textContent = p ? 'RESUME SIM' : 'PAUSE SIM'; } return p; });
        bindBtn('p6-btn-reset', function () { return reset3DScene(); });
        bindBtn('p6-btn-fullscreen', function () { return fullscreen(); });
        bindBtn('p6-btn-labels', function () { var v = toggleLabels(); var b = uiEl('p6-btn-labels'); if (b) b.textContent = labelBtnText(); return v; });
        bindBtn('p6-btn-sound', function () { var v = toggleSound(); var b = uiEl('p6-btn-sound'); if (b) b.textContent = v ? 'SUARA: ON' : 'SUARA: OFF'; return v; });
        bindBtn('p6-btn-debug', function () { return toggleDebug(); });
        bindBtn('p6-btn-front', function () { return setCameraFace('FRONT'); });
        bindBtn('p6-btn-side', function () { return setCameraFace('SIDE'); });
        bindBtn('p6-btn-top', function () { return setCameraFace('TOP'); });
        bindBtn('p6-btn-resetcam', function () { return setCameraFace('RESET'); });

        var preset = uiEl('p6-camera-preset');
        if (preset && preset.addEventListener) {
            preset.addEventListener('change', function () {
                setCameraFace(preset.value || 'FULL');
            });
        }
        var qual = uiEl('p6-quality');
        if (qual && qual.addEventListener) {
            qual.addEventListener('change', function () { setQuality(qual.value || 'MEDIUM'); syncControls(); });
        }
        var perf = uiEl('p6-perf');
        if (perf && perf.addEventListener) {
            perf.addEventListener('change', function () { setPerformanceMode(!!perf.checked); syncControls(); });
        }
        var comp = uiEl('p6-components');
        if (comp && comp.addEventListener) {
            comp.addEventListener('click', function (e) {
                var t = e.target;
                while (t && t !== comp && !t.getAttribute('data-cid')) t = t.parentNode;
                if (t && t.getAttribute && t.getAttribute('data-cid')) {
                    var cidL = t.getAttribute('data-cid');
                    focusComponent(cidL);
                    if (renderer) {
                        // bagian di dalam motor -> otomatis tampilkan potongan (cutaway)
                        var INTERNAL = ['starterArmature', 'starterCommutator', 'starterBrushes', 'fieldCoil', 'overrunningClutch', 'starterPinion', 'shiftLever'];
                        if (INTERNAL.indexOf(cidL) >= 0 && viewMode === 'NORMAL') setViewMode('CUTAWAY');
                        flyToComponent(cidL);
                    }
                }
            });
        }
        var dash = uiEl('p6-loading-skip');
        if (dash && dash.addEventListener) {
            dash.addEventListener('click', function () { forceFallback(); });
        }
    }

    function bindBtn(id, fn) {
        var el = uiEl(id);
        if (el && el.addEventListener) el.addEventListener('click', function () { try { fn(); } catch (e) { /* noop */ } try { syncControls(); } catch (e2) { /* noop */ } });
    }

    function updateTeachingUI() {
        try { renderTeachPanel(); } catch (e) { /* noop */ }
    }

    function fillComponentList() {
        var comp = uiEl('p6-components');
        if (!comp) return;
        var ids = getComponentIdsIncludingHelpers();
        comp.innerHTML = ids.map(function (id) {
            return '<button type="button" data-cid="' + esc(id) + '">' + esc(COMPONENTS[id].label) + '</button>';
        }).join('');
    }

    var framedLoopStarted = false;
    function startFrameLoop() {
        if (framedLoopStarted) return;
        framedLoopStarted = true;
        function loop(ts) {
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(loop);
            var dt = lastTs ? Math.min(200, ts - lastTs) : 16;
            lastTs = ts || nowMs();
            try { frameAdvance(dt); } catch (e) { if (debugMode && typeof console !== 'undefined') console.error(e); }
        }
        loop(0);
    }

    function forceFallback() {
        var loading = uiEl('p6-loading');
        if (loading) loading.style.display = 'none';
        var lab = uiEl('p6-lab');
        if (lab) lab.style.display = 'block';
        var note = uiEl('p6-fallback-note');
        if (note) note.style.display = 'block';
        startFallback();
    }

    function startFallback() {
        buildFallback2D();
        bindFallbackEvents();
        renderFallback();
        fillComponentList();
        updateHud(computeAnimationState());
    }

    var initDone = false;
    function init() {
        if (initDone) return;
        initDone = true;
        bindControls();
        fillComponentList();
        if (supportsWebGL()) {
            var loading = uiEl('p6-loading');
            if (loading) {
                loading.style.display = 'block';
                var bar = uiEl('p6-loading-bar');
                if (bar) { bar.style.width = '0%'; }
                stagedLoad(0, function () {
                    try {
                        if (webglUnavailable()) { forceFallback(); startFrameLoop(); return; }
                        var ok = buildRenderer();
                        if (!ok) { forceFallback(); startFrameLoop(); return; }
                        applyViewMode();
                        updateTeachingUI();
                        if (loading) loading.style.display = 'none';
                        var lab = uiEl('p6-lab');
                        if (lab) lab.style.display = 'block';
                        startFrameLoop();
                    } catch (e) {
                        p6log('p6:init:error', String((e && e.message) || e));
                        try { if (renderer) { renderer.dispose(); renderer = null; } } catch (e2) { /* noop */ }
                        forceFallback();
                        startFrameLoop();
                    }
                });
            } else {
                var ok2 = buildRenderer();
                if (!ok2) startFallback();
                updateTeachingUI();
                startFrameLoop();
            }
        } else {
            var loading2 = uiEl('p6-loading');
            if (loading2) loading2.style.display = 'none';
            forceFallback();
            // startFrameLoop dips in forceFallback path
        }
        p6log('p6:init', { mode: modeName(), three: HAS_THREE, webgl: supportsWebGL() });
    }

    function stagedLoad(step, done) {
        var stages = [
            { label: 'Loading scene...', p: 18 },
            { label: 'Loading starter model...', p: 42 },
            { label: 'Preparing cutaway...', p: 63 },
            { label: 'Preparing animation...', p: 82 },
            { label: 'Preparing simulation link...', p: 100 }
        ];
        var bar = uiEl('p6-loading-bar');
        var msg = uiEl('p6-loading-msg');
        var i = step;
        setTimeout(function () {
            if (bar) bar.style.width = stages[i].p + '%';
            if (msg) msg.textContent = stages[i].label;
            if (i < stages.length - 1) stagedLoad(i + 1, done);
            else if (done) done();
        }, 120);
    }

    function dispose() {
        resetStepState();
        demoStop();
        if (renderer) {
            try {
                if (sceneObj) sceneObj.traverse(function (o) {
                    if (o.geometry) o.geometry.dispose();
                    if (o.material) {
                        if (Array.isArray(o.material)) o.material.forEach(function (mm) { mm.dispose(); });
                        else o.material.dispose();
                    }
                });
                renderer.dispose();
            } catch (e) { /* noop */ }
            renderer = null;
        }
        return { ok: true };
    }

    /* ============================================================
       16. PUBLIC API
       ============================================================ */
    function apiSetCameraPreset(id) { return setCameraFace(id); }

    var api = {
        active: true,
        version: CFG.version,

        // deteksi & mode
        capabilities,
        supportsWebGL,
        modeName,

        // logic/adaptor (bebas WebGL -> teruji di Node)
        readSimulationSnapshot,
        computeAnimationState,
        observedSigns,
        rpmToAngularVelocity,
        rotationStep,
        pistonDisplacement,
        computeHeat,
        particleSpeed,
        getGearConfig,
        getStateSignals,
        getModes,
        getCameraPresets,
        getAnimationCache,
        resetStepState,
        frameAdvance,
        getDemoScenes,
        getDemoState,
        lessonDemo,
        openDemo3D,
        startDemoFromLesson,
        demoNext,
        demoPrev,
        demoStop,
        demoStepCurrent,
        recording: recordComponentInspection,
        inspectComponent,
        checkAnswer3D,
        getInspectionLog,

        // registry
        getComponentInfo,
        getComponentIds,
        getComponentIdsIncludingHelpers,

        // jembatan Phase 3 multimeter
        pickForMeasurement,
        probeForNext,

        // mode UI
        setQuality,
        setPerformanceMode,
        setViewMode,
        setDisplayMode,
        setTeaching,
        setExplore,
        togglePause3D,
        togglePauseSim,
        setCameraFace,
        setCameraPreset,
        reset3DScene,
        toggleLabels,
        labelMode: function () { return !labelsOn ? 'OFF' : (labelsAll ? 'ALL' : 'FOCUS'); },
        toggleSound,
        setSoundEnabled,
        toggleDebug,
        fullscreen,
        focusComponent,
        highlightComponent,

        // animasi API (prompt §41)
        animateStarter,
        animatePinion,
        animateFlywheel,
        animateCrankshaft,
        animateSolenoid,
        animateRelay,
        animateCurrentFlow,
        setCutawayMode,
        setExplodedMode,

        // siklus hidup
        init,
        dispose,
        focusAndFly: focusAndFly,
        setModelMode: setModelMode,
        getModelMode: function () { return modelMode; },
        loadGLBBuffer: loadGLBBuffer,
        startTour: startTour,
        forceFallback,
        getConfig: function () { return deepCopy(CFG); },
        stateSignals: getStateSignals
    };

    G.Phase6 = api;
    G.ThreeD = api;

    if (G.document && typeof G.document.addEventListener === 'function') {
        G.document.addEventListener('DOMContentLoaded', function () { init(); });
        if (G.document.readyState && G.document.readyState === 'complete') init();
        else if (G.document.readyState && G.document.readyState === 'interactive') init();
    }
    if (typeof G.addEventListener === 'function') {
        G.addEventListener('beforeunload', function () { try { dispose(); } catch (e) { /* noop */ } });
        G.addEventListener('pagehide', function () { try { dispose(); } catch (e) { /* noop */ } });
    }
})();