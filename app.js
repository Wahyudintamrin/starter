/* ============================================================
   STARTER SYSTEM SIMULATOR - Phase 1
   ============================================================
   Arsitektur modular yang memungkinkan penambahan
   Phase 2-6 tanpa membangun ulang aplikasi.
   ============================================================ */

'use strict';

/* ============================================================
   CONFIGURATION
   ============================================================ */
const CONFIG = {
    battery: {
        goodVoltage: 12.6,
        weakVoltage: 12.0,
        dischargedVoltage: 11.0,
        internalResistance: 0.005,     // ohm (V = Voc - I x R)
    },
    starter: {
        crankingRPM: 220,
        baseCrankingRPM: 220,         // RPM cranking normal
        maxVoltageDrop: 0.5,          // volt drop maksimal normal (V)
        normalAmps: 180,              // arus cranking normal (A)
        baseCurrent: 185,             // arus basis model (A)
        relayCurrent: 4,              // arus kumparan relay (A)
        solenoidCurrent: 22,          // arus kumparan solenoid (A)
        weakBatteryAmps: 140,
        engineStartChance: 0.85,      // probabilitas engine start normal
    },
    engine: {
        idleRPM: 800,
        idleWobble: 18,
    },
    timings: {
        relay: 250,                   // ms
        solenoid: 400,
        pinion: 550,
        crankingToRun: 1600,
    },
    cable: {
        resistance: 0.0012,           // ohm (kabel positif => drop ~0.22V @185A)
    },
    ground: {
        resistance: 0.0011,           // ohm normal => ~0.2V @185A
        poorResistance: 0.0045,       // ohm saat poor ground => ~0.83V @185A
    },
    storageKey: 'starterSimulatorProgress',
};

/* ============================================================
   SYSTEM STATE MACHINE
   ============================================================ */
const SystemState = {
    OFF: 'OFF',
    IGNITION_ON: 'IGNITION_ON',
    START_REQUEST: 'START_REQUEST',
    RELAY_ACTIVE: 'RELAY_ACTIVE',
    SOLENOID_ACTIVE: 'SOLENOID_ACTIVE',
    PINION_ENGAGED: 'PINION_ENGAGED',
    STARTER_CRANKING: 'STARTER_CRANKING',
    ENGINE_RUNNING: 'ENGINE_RUNNING',
};

/* ============================================================
   SIMULATION MODEL
   ============================================================ */
const Sim = {
    // Battery
    batteryVoltage: CONFIG.battery.goodVoltage,
    batteryCondition: 'GOOD',          // GOOD | WEAK | DISCHARGED
    batteryResistance: CONFIG.battery.internalResistance,  // ohm

    // Electrical components
    fuseState: 'GOOD',                 // GOOD | OPEN
    ignitionState: 'OFF',              // OFF | ON | START
    relayState: 'OFF',                 // OFF | ACTIVE
    solenoidState: 'OFF',              // OFF | ACTIVE
    cableState: 'GOOD',                // GOOD | OPEN
    groundCondition: 'GOOD',           // GOOD | POOR
    looseTerminal: false,
    // Phase 4 diagnostic hooks (default = tidak mengubah perilaku Phase 1-3)
    terminalResistance: 0,             // hambatan tambahan terminal battery (ohm)
    cableResistanceMult: 1,            // pengali hambatan kabel positif
    relayFaultType: 'none',            // none | contactOpen (kumparan OK, kontak 30-87 terbuka)
    solenoidMainFail: false,           // kontak utama solenoid tidak menutup
    pinionFail: false,                 // starter berputar tapi pinion tidak terkait
    // Phase 7 continuous fault modulators (default = perilaku Phase 1-6 tidak berubah)
    groundResistanceMult: 1,           // pengali resistansi ground (severity poor ground)
    starterEfficiency: 1,              // efisiensi mekanik starter 0..1 (wear / mechanical)
    starterCurrentMult: 1,             // pengali arus starter (interaksi fault, default 1)

    // Starter
    starterState: 'OFF',               // OFF | CRANKING
    starterMotorFault: false,
    starterCurrent: 0,
    starterVoltage: CONFIG.battery.goodVoltage,
    voltageDropPositive: 0,
    voltageDropGround: 0,
    starterRPM: 0,

    // Engine
    engineState: 'OFF',                // OFF | CRANKING | RUNNING
    engineRPM: 0,

    // Pinion
    pinionEngaged: false,

    // System
    systemState: SystemState.OFF,
    activeFaults: [],
    timers: [],
};

/* ============================================================
   EVENT BUS
   ============================================================ */
const EventBus = {
    listeners: {},
    emit(eventName, payload = null) {
        (this.listeners[eventName] || []).forEach(fn => fn(payload));
    },
    on(eventName, fn) {
        (this.listeners[eventName] = this.listeners[eventName] || []).push(fn);
    },
};

/* ============================================================
   COMPONENT DATA (untuk panel informasi)
   ============================================================ */
const COMPONENTS = {
    battery: {
        name: 'Battery',
        function: 'Sumber listrik utama sistem starter. Menyuplai arus tinggi ke motor starter saat starting.',
        check: () => Sim.batteryCondition,
        status: () => Sim.batteryVoltage.toFixed(2) + ' V',
        detail: () => `Kondisi: ${Sim.batteryCondition}. Tegangan simulasi: ${Sim.batteryVoltage.toFixed(2)} V.`,
    },
    fuse: {
        name: 'Fuse',
        function: 'Pelindung rangkaian kontrol dari arus berlebih. Jika putus, arus tidak mengalir ke relay.',
        check: () => Sim.fuseState === 'GOOD' ? 'GOOD' : 'OPEN',
        status: () => Sim.fuseState,
        detail: () => Sim.fuseState === 'GOOD'
            ? 'Fuse dalam kondisi normal.'
            : 'Fuse terbuka (OPEN). Arus ke rangkaian kontrol terputus.',
    },
    ignition: {
        name: 'Ignition Switch',
        function: 'Saklar tiga posisi untuk mengontrol sistem kelistrikan dan proses starting.',
        check: () => Sim.ignitionState,
        status: () => Sim.ignitionState,
        detail: () => `Posisi kunci saat ini: ${Sim.ignitionState}.`,
    },
    relay: {
        name: 'Starter Relay',
        function: 'Mengalirkan arus tinggi ke solenoid berdasarkan perintah dari ignition switch.',
        check: () => Sim.relayState,
        status: () => Sim.relayState,
        detail: () => Sim.ignitionState === 'START'
            ? 'Relay menerima arus kontrol dari ignition switch.'
            : 'Relay tidak menerima arus kontrol.',
    },
    solenoid: {
        name: 'Starter Solenoid',
        function: 'Kontaktor elektromagnetik yang menghubungkan battery ke motor starter dan menggerakkan pinion.',
        check: () => Sim.solenoidState,
        status: () => Sim.solenoidState,
        detail: () => Sim.solenoidState === 'ACTIVE'
            ? 'Solenoid aktif. Kontak utama tertutup, pinion didorong ke ring gear.'
            : 'Solenoid tidak aktif.',
    },
    starter: {
        name: 'Starter Motor',
        function: 'Motor DC berdaya tinggi yang memutar crankshaft melalui pinion dan ring gear.',
        check: () => Sim.starterState,
        status: () => Sim.starterState,
        detail: () => `Kecepatan starter: ${Sim.starterRPM} RPM. Arus: ${Sim.starterCurrent} A.`,
    },
    pinion: {
        name: 'Pinion Gear',
        function: 'Roda gigi kecil yang menyalurkan putaran starter ke ring gear pada flywheel.',
        check: () => Sim.pinionEngaged ? 'ENGAGED' : 'DISENGAGED',
        status: () => Sim.pinionEngaged ? 'ENGAGED' : 'DISENGAGED',
        detail: () => Sim.pinionEngaged
            ? 'Pinion sedang berkait dengan ring gear.'
            : 'Pinion terlepas dari ring gear.',
    },
    flywheel: {
        name: 'Ring Gear / Flywheel',
        function: 'Roda gila dengan ring gear yang menerima putaran dari pinion dan memutar crankshaft.',
        check: () => Sim.engineState === 'CRANKING' || Sim.engineState === 'RUNNING' ? 'ROTATING' : 'STOPPED',
        status: () => Sim.engineState === 'CRANKING' || Sim.engineState === 'RUNNING' ? 'ROTATING' : 'STOPPED',
        detail: () => `Flywheel berputar: ${Sim.engineState !== 'OFF' ? 'YA' : 'TIDAK'}. Engine RPM: ${Sim.engineRPM}.`,
    },
    engine: {
        name: 'Engine',
        function: 'Mesin kendaraan yang diputar oleh motor starter saat cranking.',
        check: () => Sim.engineState,
        status: () => Sim.engineState,
        detail: () => `Kondisi engine: ${Sim.engineState}. RPM: ${Sim.engineRPM}.`,
    },
};

/* ============================================================
   FAULT DEFINITIONS
   ============================================================ */
const FAULTS = {
    weakBattery: {
        label: 'Weak Battery',
        apply() { Sim.batteryVoltage = CONFIG.battery.weakVoltage; Sim.batteryCondition = 'WEAK'; },
        clear() { Sim.batteryVoltage = CONFIG.battery.goodVoltage; Sim.batteryCondition = 'GOOD'; },
        isActive() { return Sim.activeFaults.includes('weakBattery'); },
    },
    dischargedBattery: {
        label: 'Discharged Battery',
        apply() { Sim.batteryVoltage = CONFIG.battery.dischargedVoltage; Sim.batteryCondition = 'DISCHARGED'; },
        clear() { if (!FAULTS.weakBattery.isActive()) { Sim.batteryVoltage = CONFIG.battery.goodVoltage; Sim.batteryCondition = 'GOOD'; } },
        isActive() { return Sim.activeFaults.includes('dischargedBattery'); },
    },
    looseTerminal: {
        label: 'Loose Battery Terminal',
        apply() { Sim.looseTerminal = true; },
        clear() { Sim.looseTerminal = false; },
        isActive() { return Sim.activeFaults.includes('looseTerminal'); },
    },
    openFuse: {
        label: 'Open Fuse',
        apply() { Sim.fuseState = 'OPEN'; },
        clear() { Sim.fuseState = 'GOOD'; },
        isActive() { return Sim.activeFaults.includes('openFuse'); },
    },
    ignitionFailure: {
        label: 'Ignition Switch Failure',
        apply() { Sim.ignitionFail = true; },
        clear() { Sim.ignitionFail = false; },
        isActive() { return Sim.activeFaults.includes('ignitionFailure'); },
    },
    relayFailure: {
        label: 'Starter Relay Failure',
        apply() { Sim.relayFail = true; },
        clear() { Sim.relayFail = false; },
        isActive() { return Sim.activeFaults.includes('relayFailure'); },
    },
    solenoidFailure: {
        label: 'Solenoid Failure',
        apply() { Sim.solenoidFail = true; },
        clear() { Sim.solenoidFail = false; },
        isActive() { return Sim.activeFaults.includes('solenoidFailure'); },
    },
    openCable: {
        label: 'Open Positive Cable',
        apply() { Sim.cableState = 'OPEN'; },
        clear() { Sim.cableState = 'GOOD'; },
        isActive() { return Sim.activeFaults.includes('openCable'); },
    },
    poorGround: {
        label: 'Poor Ground',
        apply() { Sim.groundCondition = 'POOR'; },
        clear() { Sim.groundCondition = 'GOOD'; },
        isActive() { return Sim.activeFaults.includes('poorGround'); },
    },
    starterMotorFailure: {
        label: 'Starter Motor Failure',
        apply() { Sim.starterMotorFault = true; },
        clear() { Sim.starterMotorFault = false; },
        isActive() { return Sim.activeFaults.includes('starterMotorFailure'); },
    },
};

/* ============================================================
   HELPER FUNCTIONS
   ============================================================ */
function $(id) { return document.getElementById(id); }

function clearTimers() {
    Sim.timers.forEach(t => clearTimeout(t));
    Sim.timers = [];
}

function after(ms, fn) {
    const t = setTimeout(fn, ms);
    Sim.timers.push(t);
    return t;
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const target = $('page-' + page);
    if (target) target.classList.add('active');
    const btn = document.querySelector(`.nav-btn[data-page="${page}"]`);
    if (btn) btn.classList.add('active');
    $('sidebar').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleSidebar() {
    $('sidebar').classList.toggle('open');
}

/* aktifkan elemen peran tombol (kartu Beranda) lewat keyboard */
function cardKey(e, page) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        navigateTo(page);
    }
}

window.navigateTo = navigateTo;
window.toggleSidebar = toggleSidebar;
window.cardKey = cardKey;

/* ============================================================
   IGNITION CONTROL
   ============================================================ */
let ignitionPressed = false;   // START adalah tombol sementara

function setIgnition(pos) {
    const prev = Sim.ignitionState;
    if (pos === 'START') {
        ignitionPressed = true;
        Sim.ignitionState = 'START';
        updateIgnitionUI();
        handleStartRequest();
    } else {
        ignitionPressed = false;
        Sim.ignitionState = pos;
        updateIgnitionUI();
        if (pos === 'OFF') {
            shutdownSystem();
        } else if (prev === 'START') {
            // Lepas dari START -> pakai ON: system disengage, engine tetap jalan jika sudah RUNNING
            releaseStart();
        }
    }
    EventBus.emit('ignitionChanged', Sim.ignitionState);
    updateComponentInfo();
}

function releaseStart() {
    clearTimers();
    const engineStillRunning = Sim.engineState === 'RUNNING';
    Sim.relayState = 'OFF';
    Sim.solenoidState = 'OFF';
    Sim.pinionEngaged = false;
    Sim.starterState = 'OFF';
    Sim.starterCurrent = 0;
    Sim.starterRPM = 0;
    if (!engineStillRunning) {
        Sim.engineState = 'OFF';
        Sim.engineRPM = 0;
    }
    Sim.systemState = engineStillRunning ? SystemState.ENGINE_RUNNING : SystemState.IGNITION_ON;
    updateSystemVisuals();
    updateInstruments();
}

function updateIgnitionUI() {
    const mapping = { OFF: 0, ON: 1, START: 2 };
    const indicator = $('ignIndicator');
    indicator.className = 'ignition-indicator pos-' + mapping[Sim.ignitionState];

    document.querySelectorAll('.ignition-position').forEach(el => {
        el.classList.toggle('active', el.dataset.pos === Sim.ignitionState);
    });

    const key = $('ignKey');
    const label = $('ignLabel');
    if (Sim.ignitionState === 'ON' || Sim.ignitionState === 'START') {
        key.classList.add('rotated');
        label.textContent = Sim.ignitionState;
        label.setAttribute('fill', '#0a9cb4');
    } else {
        key.classList.remove('rotated');
        label.textContent = 'OFF';
        label.setAttribute('fill', '#c78a00');
    }
}

window.setIgnition = setIgnition;

/* ============================================================
   CURRENT FLOW VISUALIZATION
   ============================================================ */
let currentFlowEnabled = false;

function toggleCurrentFlow(enabled) {
    currentFlowEnabled = enabled;
    const group = $('currentFlowGroup');
    group.style.display = enabled ? 'block' : 'none';
}

window.toggleCurrentFlow = toggleCurrentFlow;

function updateWireStates() {
    const on = Sim.relayState === 'ACTIVE' || Sim.ignitionState === 'ON' || Sim.ignitionState === 'START';

    document.querySelectorAll('.positive-wire').forEach(w => {
        w.classList.toggle('active', on);
    });
    document.querySelectorAll('.thick-wire').forEach(w => {
        w.classList.toggle('active', (Sim.solenoidState === 'ACTIVE' || Sim.starterState === 'CRANKING') && Sim.cableState !== 'OPEN');
    });

    // Relay 4 kaki: kaki 30 (umpan) & 87 (keluaran) hanya dialiri saat kontak 30-87 menutup
    const relayContactClosed = Sim.relayState === 'ACTIVE' && !Sim.relayFail && Sim.relayFaultType !== 'contactOpen'
        && Sim.fuseState !== 'OPEN' && Sim.cableState !== 'OPEN';
    document.querySelectorAll('.relay-feed-wire').forEach(w => {
        w.classList.toggle('active', Sim.relayState === 'ACTIVE' && !Sim.relayFail && Sim.fuseState !== 'OPEN');
    });
    document.querySelectorAll('.relay-out-wire').forEach(w => {
        w.classList.toggle('active', relayContactClosed);
    });

    // Ground wire
    const groundActive = Sim.starterState === 'CRANKING' || Sim.engineState === 'RUNNING';
    document.querySelectorAll('.ground-wire').forEach(w => {
        w.classList.toggle('active', groundActive);
    });

    // Current flow particles only on energized & un-faulted segments
    // (aliran arus berhenti di titik gangguan / open circuit)
    const canFlow = Sim.fuseState !== 'OPEN' && Sim.cableState !== 'OPEN' && !Sim.ignitionFail;
    const seg = (id, active) => {
        const el = $(id);
        if (el) el.style.display = (currentFlowEnabled && active) ? 'block' : 'none';
    };
    seg('seg-control', canFlow && (Sim.ignitionState === 'ON' || Sim.ignitionState === 'START'));
    seg('seg-solenoid-control', canFlow && !Sim.relayFail && Sim.relayState === 'ACTIVE');
    seg('seg-main', Sim.solenoidState === 'ACTIVE' && Sim.cableState !== 'OPEN');
    seg('seg-starter', Sim.starterState === 'CRANKING' && Sim.cableState !== 'OPEN');
}

/* ============================================================
   STATUS DOT UPDATES
   ============================================================ */
function updateStatusDots() {
    setDot('status-battery', Sim.batteryCondition);
    setDot('status-fuse', Sim.fuseState);
    setDot('status-ignition', Sim.ignitionState);
    setDot('status-relay', Sim.relayState);
    setDot('status-solenoid', Sim.solenoidState);
    setDot('status-starter', Sim.starterState);
    setDot('status-engine', Sim.engineState);
}

function setDot(id, state) {
    const dot = $(id);
    if (!dot) return;
    const colorMap = {
        GOOD: '#16a164',
        WEAK: '#c78a00',
        DISCHARGED: '#ff5252',
        OPEN: '#ff5252',
        OFF: '#ff5252',
        ON: '#0a9cb4',
        START: '#0a9cb4',
        ACTIVE: '#0a9cb4',
        CRANKING: '#0a9cb4',
        RUNNING: '#16a164',
        ENGAGED: '#0a9cb4',
        POOR: '#ff5252',
        FAULT: '#ff5252',
    };
    dot.setAttribute('fill', colorMap[state] || '#5a6a7a');
    dot.style.filter = ['ACTIVE', 'CRANKING', 'RUNNING', 'ENGAGED', 'ON', 'START'].includes(state)
        ? 'drop-shadow(0 0 4px ' + (colorMap[state] || '#0a9cb4') + ')'
        : 'none';
}

/* ============================================================
   INSTRUMENT PANEL
   ============================================================ */
function updateInstruments() {
    // Delegate rendering ke Phase 2 (gauges realtime) jika aktif,
    // sedangkan instrument panel dasar (bar lampu) selalu diperbarui di bawah.
    if (window.Phase2 && window.Phase2.active) {
        window.Phase2.renderInstruments();
        return;
    }

    // Battery voltage
    $('dispVoltage').textContent = Sim.batteryVoltage.toFixed(2) + ' V';
    const voltPct = Math.min(100, (Sim.batteryVoltage / 13) * 100);
    $('voltageBar').style.width = voltPct + '%';
    $('voltageBar').style.background = Sim.batteryVoltage < 11.5
        ? 'var(--danger)' : Sim.batteryVoltage < 12.0
            ? 'var(--warning)' : '';

    // Starter current
    $('dispCurrent').textContent = Sim.starterCurrent.toFixed(1) + ' A';
    $('currentBar').style.width = Math.min(100, (Sim.starterCurrent / 300) * 100) + '%';

    // Starter RPM
    $('dispStarterRPM').textContent = Math.round(Sim.starterRPM) + ' RPM';
    $('starterRPMBar').style.width = Math.min(100, (Sim.starterRPM / 300) * 100) + '%';

    // Engine RPM
    $('dispEngineRPM').textContent = Math.round(Sim.engineRPM) + ' RPM';
    $('engineRPMBar').style.width = Math.min(100, (Sim.engineRPM / 1000) * 100) + '%';

    // Status values
    $('dispSystemStatus').textContent = Sim.systemState;
    $('dispBatteryStatus').textContent = Sim.batteryCondition;
    $('dispRelayStatus').textContent = Sim.relayState;
    $('dispSolenoidStatus').textContent = Sim.solenoidState;
    $('dispPinionStatus').textContent = Sim.pinionEngaged ? 'ENGAGED' : 'DISENGAGED';

    // Status row highlight
    updateStatusRow();
}

function updateStatusRow() {
    const rows = {
        system: oc(Sim.systemState),
        battery: oc(Sim.batteryCondition),
        relay: oc(Sim.relayState),
        solenoid: oc(Sim.solenoidState),
        pinion: oc(Sim.pinionEngaged ? 'ENGAGED' : 'DISENGAGED'),
    };
    const r = document.querySelectorAll('.status-row');
    r[0].className = 'status-row ' + rows.system;
    r[1].className = 'status-row ' + rows.battery;
    r[2].className = 'status-row ' + rows.relay;
    r[3].className = 'status-row ' + rows.solenoid;
    r[4].className = 'status-row ' + rows.pinion;
}

function oc(state) {
    if (['CRANKING', 'RUNNING', 'ACTIVE', 'ENGAGED', 'ON', 'START', 'GOOD'].includes(state)) {
        return state === 'CRANKING' || state === 'RUNNING' ? 'success-row' : 'active-row';
    }
    if (['FAULT', 'OPEN', 'DISCHARGED', 'POOR'].includes(state)) return 'fault-row';
    return '';
}

/* ============================================================
   STATE TRANSITIONS & SIMULATION LOGIC
   ============================================================ */
function handleStartRequest() {
    clearTimers();

    // Debug: allow tests even with faults
    Sim.systemState = SystemState.START_REQUEST;
    updateSystemVisuals();
    updateInstruments();

    // Battery check
    if (Sim.batteryCondition === 'DISCHARGED') {
        Sim.systemState = SystemState.OFF;
        updateSystemVisuals();
        updateInstruments();
        flashMessage('Battery lemah/discharged. Starter tidak dapat bekerja.', 'warning');
        return;
    }
    if (Sim.looseTerminal) {
        Sim.systemState = SystemState.OFF;
        updateSystemVisuals();
        updateInstruments();
        flashMessage('Terminal battery longgar. Arus tidak mengalir sempurna.', 'warning');
        return;
    }
    if (Sim.fuseState === 'OPEN') {
        Sim.systemState = SystemState.OFF;
        updateSystemVisuals();
        updateInstruments();
        flashMessage('Fuse terbuka. Rangkaian kontrol tidak berfungsi.', 'warning');
        return;
    }
    if (Sim.ignitionFail) {
        Sim.systemState = SystemState.OFF;
        updateSystemVisuals();
        updateInstruments();
        flashMessage('Ignition switch rusak. Tidak ada output saat START.', 'warning');
        return;
    }
    if (Sim.cableState === 'OPEN') {
        Sim.systemState = SystemState.OFF;
        updateSystemVisuals();
        updateInstruments();
        flashMessage('Kabel positif battery terbuka. Arus tidak sampai ke starter.', 'warning');
        return;
    }
    if (Sim.relayFail) {
        Sim.systemState = SystemState.OFF;
        updateSystemVisuals();
        updateInstruments();
        flashMessage('Starter relay gagal. Solenoid tidak menerima perintah.', 'warning');
        return;
    }

    // ===== Normal sequence =====
    // Relay active
    after(CONFIG.timings.relay, () => {
        const door = relayCondition();
        if (!door) return;
        Sim.relayState = 'ACTIVE';
        Sim.systemState = SystemState.RELAY_ACTIVE;
        EventBus.emit('relayActivated');
        flashMessage('Relay aktif. Mengirim arus ke solenoid...', 'info');
        updateSystemVisuals();
        updateInstruments();
    });

    // Solenoid active
    after(CONFIG.timings.relay + CONFIG.timings.solenoid, () => {
        if (!solenoidCondition()) return;
        Sim.solenoidState = 'ACTIVE';
        Sim.systemState = SystemState.SOLENOID_ACTIVE;
        EventBus.emit('solenoidActivated');
        flashMessage('Solenoid aktif. Pinion bergerak maju...', 'info');
        updateSystemVisuals();
        updateInstruments();
    });

    // Pinion engaged
    after(CONFIG.timings.relay + CONFIG.timings.solenoid + CONFIG.timings.pinion, () => {
        if (!solenoidCondition()) return;
        if (Sim.pinionFail) return;
        Sim.pinionEngaged = true;
        Sim.systemState = SystemState.PINION_ENGAGED;
        EventBus.emit('pinionEngaged');
        flashMessage('Pinion berkait dengan ring gear.', 'info');
        updateSystemVisuals();
        updateInstruments();
    });

    // Starter cranking
    after(CONFIG.timings.relay + CONFIG.timings.solenoid + CONFIG.timings.pinion + CONFIG.timings.pinion, () => {
        if (!solenoidCondition()) return;
        const motorOk = !Sim.starterMotorFault && !Sim.solenoidMainFail;

        Sim.systemState = SystemState.STARTER_CRANKING;
        if (motorOk) {
            Sim.starterState = 'CRANKING';
            Sim.starterRPM = starterRPMTarget();
            Sim.starterCurrent = starterCurrentTarget();
            computeStarterVoltage();
            if (Sim.pinionEngaged) {
                Sim.engineState = 'CRANKING';
                Sim.engineRPM = engineRPMTarget();
                flashMessage('Motor starter berputar. Engine cranking...', 'info');
            } else {
                Sim.engineState = 'OFF';
                Sim.engineRPM = 0;
                flashMessage('Motor starter berputar, tetapi pinion tidak terkait dengan ring gear.', 'warning');
            }
            EventBus.emit('starterStarted');
        } else {
            Sim.starterState = 'OFF';
            Sim.starterRPM = 0;
            Sim.starterCurrent = 0;
            Sim.engineState = 'OFF';
            Sim.engineRPM = 0;
            EventBus.emit('engineCranking', false);
            flashMessage(Sim.solenoidMainFail
                ? 'Solenoid aktif dan pinion terkait, tetapi kontak utama tidak menutup. Motor starter tidak menerima arus.'
                : 'Solenoid aktif dan pinion terkait, tetapi motor starter tidak berputar.', 'warning');
        }
        updateSystemVisuals();
        updateInstruments();
    });

    // Engine running attempt
    after(CONFIG.timings.relay + CONFIG.timings.solenoid + CONFIG.timings.pinion * 2 + CONFIG.timings.crankingToRun, () => {
        if (Sim.starterState !== 'CRANKING') return;   // hanya lanjut jika motor benar-benar cranking
        if (!Sim.pinionEngaged) return;
        if (!solenoidCondition()) return;
        if (Sim.starterMotorFault) return;
        if (!ignitionPressed) return;

        let chance = CONFIG.starter.engineStartChance;
        if (Sim.batteryCondition === 'WEAK') chance *= 0.45;
        if (Sim.groundCondition === 'POOR') chance *= 0.7;
        if (Sim.looseTerminal) chance *= 0.5;

        if (Math.random() < chance) {
            Sim.engineState = 'RUNNING';
            Sim.engineRPM = CONFIG.engine.idleRPM;
            Sim.systemState = SystemState.ENGINE_RUNNING;
            Sim.relayState = 'OFF';
            Sim.solenoidState = 'OFF';
            Sim.pinionEngaged = false;
            Sim.starterState = 'OFF';
            Sim.starterRPM = 0;
            Sim.starterCurrent = 0;
            EventBus.emit('engineStarted');
            flashMessage('Engine berhasil dinyalakan! Putar ignition ke ON.', 'success');
        } else {
            // Gagal start - return to cranking attempt requires re-START
            Sim.engineState = 'OFF';
            Sim.engineRPM = 0;
            Sim.engineState = 'CRANKING';
            Sim.engineRPM = Sim.starterRPM * 0.45;
            EventBus.emit('engineCranking', false);
            flashMessage('Engine gagal start. Coba kembali dengan menahan posisi START.', 'warning');
        }
        updateSystemVisuals();
        updateInstruments();
    });
}

function relayCondition() {
    return Sim.ignitionState === 'START'
        && Sim.batteryCondition !== 'DISCHARGED'
        && !Sim.looseTerminal
        && Sim.fuseState !== 'OPEN'
        && !Sim.ignitionFail
        && Sim.cableState !== 'OPEN'
        && !Sim.relayFail;
}

function solenoidCondition() {
    return Sim.ignitionState === 'START'
        && Sim.relayState === 'ACTIVE'
        && !Sim.solenoidFail
        && Sim.relayFaultType !== 'contactOpen';
}

/* ============================================================
   SHARED FACTORS & TARGET HELPERS
   (dipakai Phase 1, Phase 2, dan API eksternal)
   ============================================================ */

// Faktor kondisi baterai terhadap arus & RPM cranking (0..1)
function batteryFactor() {
    if (Sim.batteryCondition === 'GOOD') return 1;
    if (Sim.batteryCondition === 'WEAK') return 0.7;
    return 0.4; // DISCHARGED
}

// Faktor mekanis (ground buruk, terminal longgar) terhadap RPM starter
function mechFactor() {
    let f = 1;
    if (Sim.groundCondition === 'POOR') f *= Math.max(0.35, 1 - 0.2 * (Sim.groundResistanceMult || 1));
    if (Sim.looseTerminal || Sim.terminalResistance > 0) f *= 0.6;
    return f;
}

// Arus starter target saat cranking (A)
function starterCurrentTarget() {
    let f = batteryFactor();
    if (Sim.groundCondition === 'POOR') f *= Math.max(0.55, 1 - 0.1 * (Sim.groundResistanceMult || 1));
    if (Sim.looseTerminal || Sim.terminalResistance > 0) f *= 0.7;
    f /= Math.max(0.25, Sim.starterEfficiency || 1);   // beban mekanis => arus naik
    f *= (Sim.starterCurrentMult || 1);                // interaksi fault => arus puncak
    return CONFIG.starter.baseCurrent * f;
}

// Kecepatan starter target saat cranking (RPM)
function starterRPMTarget() {
    return CONFIG.starter.baseCrankingRPM * batteryFactor() * mechFactor() * (Sim.starterEfficiency != null ? Sim.starterEfficiency : 1);
}

// Kecepatan engine saat cranking (RPM)
function engineRPMTarget() {
    return starterRPMTarget() * 0.45;
}

// Menghasilkan Sim.starterVoltage (tegangan di terminal + starter)
// berdasarkan arus saat ini dan resistansi internal baterai.
// V_starter = V_oc - I * R_internal - drop kabel.
// Dipanggil oleh Phase 2 (simulation loop) dan oleh UI non-Phase 2.
function computeStarterVoltage() {
    const i = Sim.starterCurrent;
    const ocv = Sim.batteryVoltage;
    const rInt = Sim.batteryResistance || CONFIG.battery.internalResistance;
    const p4Terminal = Sim.terminalResistance || 0;
    const rCable = (Sim.cableState === 'OPEN' ? CONFIG.cable.resistance * 10 : CONFIG.cable.resistance) * (Sim.cableResistanceMult || 1);
    const rGround = (Sim.groundCondition === 'POOR' ? CONFIG.ground.poorResistance : CONFIG.ground.resistance) * (Sim.groundResistanceMult || 1);
    const terminalDrop = i * p4Terminal;
    const cableDrop = i * rCable;
    const groundDrop = i * rGround;
    const drop = i * rInt + terminalDrop + cableDrop + groundDrop;
    Sim.voltageDropPositive = cableDrop + terminalDrop;
    Sim.voltageDropGround = groundDrop;
    const v = Math.max(0, ocv - drop);
    Sim.starterVoltage = Math.round(v * 10) / 10;
    return Sim.starterVoltage;
}

function shutdownSystem() {
    clearTimers();
    Sim.systemState = SystemState.OFF;
    Sim.relayState = 'OFF';
    Sim.solenoidState = 'OFF';
    Sim.pinionEngaged = false;
    Sim.starterState = 'OFF';
    Sim.starterCurrent = 0;
    Sim.starterVoltage = Sim.batteryVoltage;
    Sim.voltageDropPositive = 0;
    Sim.voltageDropGround = 0;
    Sim.starterRPM = 0;
    Sim.engineState = 'OFF';
    Sim.engineRPM = 0;
    updateSystemVisuals();
    updateInstruments();
    EventBus.emit('systemShutdown', Sim);
}

/* ============================================================
   SYSTEM VISUALS (SVG animations)
   ============================================================ */
function updateSystemVisuals() {
    // Armature spin
    const armature = $('armatureGroup');
    const spinning = Sim.starterState === 'CRANKING';
    armature.classList.toggle('spinning', spinning);

    // Flywheel spin
    const flywheel = $('flywheelGroup');
    const flySpinning = Sim.engineState === 'CRANKING' || Sim.engineState === 'RUNNING';
    flywheel.classList.toggle('spinning', flySpinning);
    // Adjust flywheel speed based on engine state
    if (flySpinning) {
        const speed = Sim.engineState === 'RUNNING' ? '0.3s' : '0.7s';
        flywheel.style.animationDuration = speed;
    }

    // Pinion engage
    const pinion = $('pinionGroup');
    pinion.classList.toggle('engaged', Sim.pinionEngaged);

    // Engine label
    $('engineStateLabel').textContent = Sim.engineState;
    $('engineStateLabel').setAttribute('fill', Sim.engineState === 'RUNNING' ? '#16a164' : Sim.engineState === 'CRANKING' ? '#c78a00' : '#465e78');

    updateWireStates();
    updateStatusDots();
}

/* ============================================================
   MESSAGE FLASH
   ============================================================ */
function flashMessage(text, type) {
    // Remove existing message
    const existing = document.querySelector('.flash-msg');
    if (existing) existing.remove();

    const msg = document.createElement('div');
    msg.className = 'flash-msg ' + (type || 'info');
    msg.textContent = text;
    msg.setAttribute('role', 'status');
    $('simDiagramArea').appendChild(msg);

    setTimeout(() => msg.classList.add('show'), 10);
    setTimeout(() => {
        msg.classList.remove('show');
        setTimeout(() => msg.remove(), 300);
    }, 3500);
}

/* ============================================================
   COMPONENT INFO
   ============================================================ */
let activeCompInfo = null;

function showComponentInfo(key) {
    activeCompInfo = key;
    renderComponentInfo(key);
}

function updateComponentInfo() {
    if (activeCompInfo) renderComponentInfo(activeCompInfo);
}

function renderComponentInfo(key) {
    const comp = COMPONENTS[key];
    if (!comp) return;
    const panel = $('compInfoContent');
    const check = comp.check();
    const isFault = check === 'OPEN' || check === 'DISCHARGED' || Sim.activeFaults.length > 0
        && (key === 'fuse' && Sim.fuseState === 'OPEN'
            || key === 'relay' && Sim.relayFail
            || key === 'solenoid' && Sim.solenoidFail
            || key === 'starter' && Sim.starterMotorFault);
    const valClass = isFault ? 'fault' : (check === 'ACTIVE' || check === 'CRANKING' || check === 'RUNNING' || check === 'ENGAGED' || check === 'ON' || check === 'START') ? 'active' : 'good';
    panel.innerHTML = `
        <div class="comp-info-title">${comp.name}</div>
        <div class="comp-info-func">${comp.function}</div>
        <div class="comp-info-row"><span class="row-key">Status</span><span class="row-val ${valClass}">${comp.status()}</span></div>
        <div class="comp-info-row"><span class="row-key">Kondisi</span><span class="row-val">${comp.detail()}</span></div>
    `;
}

window.showComponentInfo = showComponentInfo;

/* ============================================================
   FAULT INJECTION
   ============================================================ */
function toggleFaultPanel() {
    $('faultPanel').classList.toggle('open');
}

function applyFaults() {
    const checked = document.querySelectorAll('.fault-check:checked');
    clearAllFaults(false);

    checked.forEach(cb => {
        const fault = FAULTS[cb.dataset.fault];
        if (fault) {
            fault.apply();
            Sim.activeFaults.push(cb.dataset.fault);
        }
    });

    shutdownSystem();
    updateFaultVisuals();
    toggleFaultPanel();
    EventBus.emit('faultApplied', Sim.activeFaults.slice());
}

function applyRandomFault() {
    clearAllFaults(false);
    const faultKeys = Object.keys(FAULTS);
    const pick = faultKeys[Math.floor(Math.random() * faultKeys.length)];
    FAULTS[pick].apply();
    Sim.activeFaults.push(pick);
    shutdownSystem();
    updateFaultVisuals();
    flashMessage('Fault diterapkan: ' + FAULTS[pick].label, 'warning');
    toggleFaultPanel();
    EventBus.emit('faultApplied', Sim.activeFaults.slice());
}

function clearAllFaults(withUI = true) {
    Object.keys(FAULTS).forEach(key => {
        FAULTS[key].clear();
    });
    Sim.activeFaults = [];
    // Reset battery stuff fully
    Sim.batteryVoltage = CONFIG.battery.goodVoltage;
    Sim.batteryCondition = 'GOOD';
    // Reset Phase 4 diagnostic hooks ke default
    Sim.terminalResistance = 0;
    Sim.cableResistanceMult = 1;
    Sim.groundResistanceMult = 1;
    Sim.starterEfficiency = 1;
    Sim.starterCurrentMult = 1;
    Sim.relayFaultType = 'none';
    Sim.solenoidMainFail = false;
    Sim.pinionFail = false;
    if (withUI) {
        shutdownSystem();
        updateFaultVisuals();
        document.querySelectorAll('.fault-check').forEach(cb => cb.checked = false);
    }
}

function updateFaultVisuals() {
    // Clear fault classes
    document.querySelectorAll('.component').forEach(c => c.classList.remove('faulted'));

    // Mark faulted components
    if (FAULTS.openFuse.isActive()) $('comp-fuse').classList.add('faulted');
    if (FAULTS.ignitionFailure.isActive()) $('comp-ignition').classList.add('faulted');
    if (FAULTS.relayFailure.isActive()) $('comp-relay').classList.add('faulted');
    if (FAULTS.solenoidFailure.isActive()) $('comp-solenoid').classList.add('faulted');
    if (FAULTS.starterMotorFailure.isActive()) $('comp-starter').classList.add('faulted');
    if (FAULTS.openCable.isActive()) {
        const wire = $('wire-bat-solenoid');
        wire.style.stroke = '#ff5252';
    } else {
        $('wire-bat-solenoid').style.stroke = '';
    }
    if (FAULTS.poorGround.isActive()) {
        $('wire-ground-bat').style.stroke = '#ff5252';
        $('wire-ground-starter').style.stroke = '#ff5252';
    } else {
        $('wire-ground-bat').style.stroke = '';
        $('wire-ground-starter').style.stroke = '';
    }
}

window.toggleFaultPanel = toggleFaultPanel;
window.applyFaults = applyFaults;
window.applyRandomFault = applyRandomFault;
window.clearAllFaults = clearAllFaults;

/* ============================================================
   RESET
   ============================================================ */
function resetSimulation() {
    clearTimers();
    clearAllFaults(false);
    document.querySelectorAll('.fault-check').forEach(cb => cb.checked = false);

    Sim.batteryVoltage = CONFIG.battery.goodVoltage;
    Sim.batteryCondition = 'GOOD';
    Sim.batteryResistance = CONFIG.battery.internalResistance;
    Sim.fuseState = 'GOOD';
    Sim.ignitionState = 'OFF';
    Sim.relayState = 'OFF';
    Sim.solenoidState = 'OFF';
    Sim.cableState = 'GOOD';
    Sim.groundCondition = 'GOOD';
    Sim.looseTerminal = false;
    Sim.terminalResistance = 0;
    Sim.cableResistanceMult = 1;
    Sim.groundResistanceMult = 1;
    Sim.starterEfficiency = 1;
    Sim.starterCurrentMult = 1;
    Sim.relayFaultType = 'none';
    Sim.solenoidMainFail = false;
    Sim.pinionFail = false;
    Sim.starterState = 'OFF';
    Sim.starterMotorFault = false;
    Sim.starterCurrent = 0;
    Sim.starterVoltage = Sim.batteryVoltage;
    Sim.voltageDropPositive = 0;
    Sim.voltageDropGround = 0;
    Sim.starterRPM = 0;
    Sim.engineState = 'OFF';
    Sim.engineRPM = 0;
    Sim.pinionEngaged = false;
    Sim.systemState = SystemState.OFF;
    Sim.activeFaults = [];
    ignitionPressed = false;

    updateIgnitionUI();
    updateSystemVisuals();
    updateInstruments();
    updateFaultVisuals();
    flashMessage('Simulasi di-reset ke kondisi normal.', 'info');
    EventBus.emit('simulationReset', Sim);
}

window.resetSimulation = resetSimulation;

/* ============================================================
   MATERI (Phase 2-5 placeholder + data Phase 5)
   ============================================================ */
const MATERI_MODULES = [
    { id: 1, title: 'Pengertian Sistem Starter', desc: 'Memahami konsep dasar sistem starter pada kendaraan.', sim: 'simulator',
      konten: [
        'Sistem starter adalah rangkaian kelistrikan & mekanis yang memutar (cranking) crankshaft mesin saat akan dihidupkan.',
        'Bekerja dengan tegangan DC 12V dari battery kendaraan.',
        'Tujuan: memutar mesin sampai tercapai pembakaran pertama yang mandiri.',
        'Komponen utamanya: battery, ignition switch, starter relay, solenoid, starter motor, pinion, dan flywheel (ring gear).'
      ] },
    { id: 2, title: 'Fungsi Sistem Starter', desc: 'Peran sistem starter dalam memutar crankshaft saat starting.', sim: 'simulator',
      konten: [
        'Memutar crankshaft dengan kecepatan cukup agar mesin dapat mulai membakar campuran.',
        'Mengalirkan arus besar (ratusan ampere) hanya saat proses starting (singkat).',
        'Melepas pinion otomatis dari flywheel begitu mesin sudah menyala (mencegah kerusakan).',
        'Bekerja dengan pengaman: relay/solenoid menjaga saklar kecil tetap aman dari arus besar.'
      ] },
    { id: 3, title: 'Komponen Sistem Starter', desc: 'Komponen kelistrikan dan mekanis pada sistem starter.', sim: 'simulator',
      konten: [
        'Battery: sumber energi listrik utama (12V DC).',
        'Ignition switch: saklar utama tempat kunci kontak / tombol start.',
        'Starter relay: menghubungkan arus kecil ke solenoid, menjembatani arus besar.',
        'Solenoid: elektromagnet yang mendorong pinion dan menutup kontak daya utama.',
        'Starter motor: motor DC (armature, field coil, komutator, brush) yang menghasilkan putaran.',
        'Flywheel/ring gear: gigi besar tempat pinion bertaut untuk memutar mesin.'
      ] },
    { id: 4, title: 'Prinsip Kerja', desc: 'Alur kerja dari battery hingga engine menyala.', sim: 'simulator',
      konten: [
        'Alur arus: battery -> ignition switch (kunci START) -> relay -> solenoid.',
        'Solenoid menarik (pull-in) sehingga pinion terdorong bertaut ke ring gear.',
        'Kontak utama solenoid menutup -> arus besar mengalir ke starter motor.',
        'Starter motor berputar -> pinion memutar flywheel -> crankshaft berputar -> mesin menghidup.',
        'Setelah mesin menyala, kunci dilepas ke ON -> solenoid lepas -> pinion mundur.'
      ] },
    { id: 5, title: 'Rangkaian Kelistrikan', desc: 'Baca dan pahami rangkaian kelistrikan sistem starter.', sim: 'simulator',
      konten: [
        'Rangkaian terbagi dua: rangkaian KONTROL (arus kecil) dan rangkaian DAYA (arus besar).',
        'Kontrol: battery -> ignition switch -> relay coil -> ground (mengalirkan arus kecil).',
        'Daya: battery -> relay kontak -> solenoid -> starter motor -> ground (arus besar).',
        'Semua beban memakai jalur ground yang sama (negatif battery / massa bodi).',
        'Fuse/pengaman melindungi jalur kontrol dari beban lebih.'
      ] },
    { id: 6, title: 'Battery', desc: 'Sumber listrik utama dan pemeriksaannya.', sim: 'simulator',
      konten: [
        'Battery menyediakan arus besar untuk starter motor saat starting.',
        'Periksa tegangan: 12,6V ke atas = kondisi penuh; di bawah 12,4V perlu pengisian.',
        'Periksa terminal: kencang, bersih, bebas korosi, kutub benar (+ dan -).',
        'Battery lemah menjadi penyebab umum starter berputar lambat atau tidak berputar.'
      ] },
    { id: 7, title: 'Starter Relay', desc: 'Fungsi relay dan gejala kerusakannya.', sim: 'simulator',
      konten: [
        'Starter relay adalah saklar elektromagnetik (kontaktor) untuk memindahkan arus besar lewat arus kontrol kecil.',
        'Kontak 85/86 = kumparan kontrol; kontak 30/87 = jalur daya.',
        'Gejala rusak: starter tidak berputar padahal battery & motor baik, atau bunyi klik tanpa putaran.',
        'Relay menahan arus besar agar TIDAK melewati ignition switch (melindungi saklar).'
      ] },
    { id: 8, title: 'Starter Solenoid', desc: 'Kontaktor elektromagnetik dan cara kerjanya.', sim: 'simulator',
      konten: [
        'Solenoid bekerja dengan dua kumparan: pull-in (menarik) dan hold-in (menahan).',
        'Saat kunci START: pull-in + hold-in aktif -> plunger tertarik (pinion maju ke ring gear).',
        'Kontak utama menutup -> arus penuh mengalir & pull-in ter-short (hanya hold-in bekerja).',
        'Bila hold-in lemah, solenoid bergetar/klik-klik saat starting (arus drop).'
      ] },
    { id: 9, title: 'Starter Motor', desc: 'Motor DC dan komponen internalnya.', sim: 'simulator',
      konten: [
        'Starter motor adalah motor DC seri: armature, field coil, komutator, dan brush (sikat karbon).',
        'Brush mengantarkan arus ke komutator agar armature berputar.',
        'Field coil menghasilkan medan magnet untuk torsi besar saat starting.',
        'Gejala aus: brush pendek -> arus tidak mengalir sempurna -> motor lemah/macet.'
      ] },
    { id: 10, title: 'Pinion Gear', desc: 'Gigi pinion dan mekanisme engagement.', sim: 'simulator',
      konten: [
        'Pinion adalah gigi kecil (10-12 gigi) yang bertaut ke ring gear flywheel.',
        'Overrunning clutch (kopling satu arah) mengunci pinion saat mendorong, dan membebaskan saat mesin menyala.',
        'Engagement didorong oleh plunger solenoid lewat tuas/lever.',
        'Pinion aus/longgar -> tidak bisa bertaut, starter whine/overrun.'
      ] },
    { id: 11, title: 'Flywheel', desc: 'Ring gear dan perannya dalam starting.', sim: 'simulator',
      konten: [
        'Flywheel adalah roda gila di ujung crankshaft; ring gear adalah gigi di sekelilingnya.',
        'Ring gear menerima putaran dari pinion selama starting.',
        'Bila ring gear rusak (gigi terbuka/aus), pinion tidak dapat bertaut sempurna.',
        'Perbandingan gigi membuat torsi besar dari starter motor ke mesin.'
      ] },
    { id: 12, title: 'Pemeriksaan Sistem Starter', desc: 'Prosedur pemeriksaan komponen sistem starter.', sim: 'simulator',
      konten: [
        'Urutan pemeriksaan: battery -> sambungan -> ignition switch -> relay -> solenoid -> motor.',
        'Cek battery (beban/tegangan), cek pengencangan dan kebersihan terminal.',
        'Cek relay & solenoid: dengar bunyi klik dan ukur tegangan saat START.',
        'Cek voltage drop kabel daya & masa; ukur arus starter dengan clamp meter.'
      ] },
    { id: 13, title: 'Voltage Drop', desc: 'Konsep voltage drop dan penerapannya.', sim: 'simulator',
      konten: [
        'Voltage drop adalah beda tegangan yang hilang pada kabel/sambungan/kontak yang resistif.',
        'Batas normal: drop kecil (sekitar 0,2-0,5V total) pada jalur starter.',
        'Ukur dengan mode DC volt pada kabel positif dan jalur ground saat starting.',
        'Drop berlebih = sambungan longgar/berkarat/kabel korslet -> arus starter turun.'
      ] },
    { id: 14, title: 'Troubleshooting', desc: 'Langkah-langkah diagnosa kerusakan.', sim: 'diagnosis',
      konten: [
        'Langkah: identifikasi gejala -> periksa battery -> periksa kontrol -> periksa daya -> periksa komponen mekanis.',
        'Starter tidak berputar & tidak ada bunyi: cek battery, kunci kontak, relay, solenoid.',
        'Ada bunyi klik tapi tidak berputar: cek battery lemah, hold-in, kontak utama, ground.',
        'Starter berputar lambat: cek battery, voltage drop, brush/motor, keausan bearing.',
        'Grammy pinion berdengung (whine): cek ring gear dan overrunning clutch.',
        'Catat setiap temuan dan verifikasi ulang dengan pengukuran nyata sebelum menyimpulkan.'
      ] },
];

function renderMateri() {
    const grid = $('materiGrid');
    grid.innerHTML = MATERI_MODULES.map(m => `
        <div class="materi-card" onclick="toggleMateriDetail(${m.id})">
            <div class="materi-num">MODUL ${String(m.id).padStart(2, '0')}</div>
            <h3>${m.title}</h3>
            <p>${m.desc}</p>
            <span class="materi-toggle" id="materiToggle-${m.id}">Baca Isi Materi (klik)</span>
        </div>
        <div class="materi-detail" id="materiDetail-${m.id}" style="display:none">
            <ul class="materi-konten">
                ${m.konten.map(k => `<li>${k}</li>`).join('')}
            </ul>
            <div class="materi-aksi">
                <button class="btn-materi-sim" onclick="event.stopPropagation(); navigateTo('${m.sim}')">Mulai Simulasi Modul Ini</button>
            </div>
        </div>
    `).join('');
}

function toggleMateriDetail(id) {
    const detail = $('materiDetail-' + id);
    const toggle = $('materiToggle-' + id);
    if (!detail) return;
    const open = detail.style.display !== 'none';
    detail.style.display = open ? 'none' : 'block';
    toggle.textContent = open
        ? 'Baca Isi Materi (klik)'
        : 'Tutup Isi Materi (klik)';
    toggle.classList.toggle('open', !open);
}

/* ============================================================
   PRAKTIK
   ============================================================ */
const PRAKTIK_ITEMS = [
    { id: 1, title: 'Pemeriksaan Battery', done: false },
    { id: 2, title: 'Pemeriksaan Ignition Switch', done: false },
    { id: 3, title: 'Pemeriksaan Relay', done: false },
    { id: 4, title: 'Pemeriksaan Solenoid', done: false },
    { id: 5, title: 'Pemeriksaan Starter Motor', done: false },
    { id: 6, title: 'Voltage Drop Positive', done: false },
    { id: 7, title: 'Voltage Drop Ground', done: false },
    { id: 8, title: 'Diagnosis Starter Tidak Berputar', done: false },
];

function renderPraktik() {
    const list = $('praktikList');
    list.innerHTML = PRAKTIK_ITEMS.map(p => `
        <div class="praktik-card" onclick="navigateTo('simulator')">
            <div class="praktik-title">
                <span class="praktik-num">${String(p.id).padStart(2, '0')}</span>
                ${p.title}
            </div>
            <span class="praktik-status ${p.done ? 'completed' : ''}">${p.done ? 'Selesai' : 'Belum'}</span>
        </div>
    `).join('');
}

/* ============================================================
   DIAGNOSIS
   ============================================================ */
const DIAGNOSIS_CASES = [
    {
        title: 'Mesin tidak dapat di-start',
        desc: 'Ketika ignition diputar ke START, mesin tidak berputar sama sekali. Amati gejala, periksa komponen, dan tentukan penyebabnya.',
        faultKey: 'openFuse',
        checks: [
            { id: 'diag-fuse', label: 'Periksa fuse' },
            { id: 'diag-battery', label: 'Ukur tegangan battery' },
            { id: 'diag-relay', label: 'Dengarkan bunyi relay' },
        ],
        hint: ['Periksa kondisi sumber listrik terlebih dahulu.', 'Pastikan fuse pada rangkaian kontrol dalam keadaan baik.', 'Jika fuse terbuka, arus kontrol tidak sampai ke relay.'],
        correctDiagnosisId: 'diag-fuse',
    },
    {
        title: 'Starter berputar pelan',
        desc: 'Engine berputar sangat lambat saat starting, hampir tidak mampu memutar crankshaft.',
        faultKey: 'poorGround',
        checks: [
            { id: 'diag-ground', label: 'Periksa koneksi ground' },
            { id: 'diag-cable', label: 'Periksa kabel positif' },
            { id: 'diag-vdrop', label: 'Ukur voltage drop ground' },
        ],
        hint: ['Periksa jalur ground terlebih dahulu.', 'Kabel ground yang korosi akan meningkatkan hambatan.', 'Voltage drop ground yang tinggi menurunkan performa starter.'],
        correctDiagnosisId: 'diag-ground',
    },
    {
        title: 'Tidak ada respon sama sekali',
        desc: 'Saat START tidak ada bunyi relay, solenoid, dan motor tidak berputar. Engine dalam kondisi mati total dari sisi starter.',
        faultKey: 'relayFailure',
        checks: [
            { id: 'diag-relay2', label: 'Uji relay' },
            { id: 'diag-ignition', label: 'Periksa ignition switch' },
            { id: 'diag-solenoid', label: 'Periksa solenoid' },
        ],
        hint: ['Bunyi klik dari relay adalah indikasi awal relay bekerja.', 'Relay yang rusak tidak akan mengalirkan arus ke solenoid.', 'Ganti relay jika terbukti tidak ada output.'],
        correctDiagnosisId: 'diag-relay2',
    },
];

let currentCase = null;
let hintIndex = 0;

function newDiagnosisCase() {
    currentCase = DIAGNOSIS_CASES[Math.floor(Math.random() * DIAGNOSIS_CASES.length)];
    hintIndex = 0;
    $('diagCaseTitle').textContent = currentCase.title;
    $('diagCaseDesc').textContent = currentCase.desc;
    $('diagChecks').innerHTML = currentCase.checks.map(c => `
        <label class="diag-check-item">
            <input type="radio" name="diagCheck" value="${c.id}">
            <span>${c.label}</span>
        </label>
    `).join('');
    const fb = $('diagFeedback');
    fb.className = 'diag-feedback';
    fb.style.display = 'none';
}

function useHint() {
    if (!currentCase) return;
    const fb = $('diagFeedback');
    if (hintIndex < currentCase.hint.length) {
        fb.innerHTML = '<strong>Hint:</strong> ' + currentCase.hint[hintIndex];
        fb.className = 'diag-feedback show';
        hintIndex++;
    } else {
        fb.innerHTML = '<strong>Hint:</strong> Tidak ada hint lagi. Gunakan pengetahuan Anda.';
        fb.className = 'diag-feedback show';
    }
}

function submitDiagnosis() {
    if (!currentCase) return;
    const selected = document.querySelector('input[name="diagCheck"]:checked');
    const fb = $('diagFeedback');
    if (!selected) {
        fb.innerHTML = '<strong>Peringatan:</strong> Pilih salah satu hasil pemeriksaan terlebih dahulu.';
        fb.className = 'diag-feedback show error';
        return;
    }
    if (selected.value === currentCase.correctDiagnosisId) {
        fb.innerHTML = '<strong>Benar!</strong> Diagnosis Anda tepat.';
        fb.className = 'diag-feedback show success';
    } else {
        fb.innerHTML = '<strong>Kurang tepat.</strong> Periksa kembali hasil pengukuran Anda. Gunakan hint jika perlu.';
        fb.className = 'diag-feedback show error';
    }
}

window.newDiagnosisCase = newDiagnosisCase;
window.useHint = useHint;
window.submitDiagnosis = submitDiagnosis;

/* ============================================================
   QUIZ
   ============================================================ */
const QUIZ_QUESTIONS = [
    {
        q: 'Apa fungsi utama motor starter?',
        options: ['Mengisi battery', 'Memutar crankshaft saat starting', 'Mengatur bahan bakar', 'Mengatur temperatur engine'],
        answer: 1,
        explain: 'Motor starter memutar crankshaft melalui pinion dan ring gear agar proses pembakaran dapat dimulai.',
    },
    {
        q: 'Battery dengan kondisi GOOD kira-kira memiliki tegangan?',
        options: ['9.0 V', '10.5 V', '12.6 V', '15.0 V'],
        answer: 2,
        explain: 'Battery penuh yang sehat kira-kira 12.6 V saat tidak terbebani.',
    },
    {
        q: 'Apa fungsi starter relay?',
        options: ['Menghubungkan arus besar battery ke solenoid', 'Memanaskan mesin', 'Menyalurkan bahan bakar', 'Mengatur RPM idle'],
        answer: 0,
        explain: 'Relay mengalirkan arus tinggi ke solenoid berdasarkan arus kecil dari ignition switch.',
    },
    {
        q: 'Ketika starter cranking, arus yang mengalir kira-kira sebesar?',
        options: ['100-200 mA', '150-250 A', '10-20 A', '1000 A'],
        answer: 1,
        explain: 'Motor starter menarik arus sangat besar (150-250 A) saat cranking.',
    },
    {
        q: 'Fungsi pinion gear adalah?',
        options: ['Mengatur bahan bakar', 'Menghubungkan relay ke solenoid', 'Meneruskan putaran starter ke ring gear', 'Mengisi battery'],
        answer: 2,
        explain: 'Pinion gear menghubungkan putaran armature ke ring gear flywheel.',
    },
    {
        q: 'Gejala voltage drop ground yang tinggi adalah?',
        options: ['Engine lebih cepat start', 'Starter berputar pelan', 'Battery cepat penuh', 'Tidak ada gejala'],
        answer: 1,
        explain: 'Ground yang buruk meningkatkan hambatan sehingga arus starter berkurang dan putaran pelan.',
    },
];

let quizIndex = 0;
let quizScore = 0;
let quizStarted = false;

function startQuiz() {
    quizIndex = 0;
    quizScore = 0;
    quizStarted = true;
    renderQuizQuestion();
}

function renderQuizQuestion() {
    const area = $('quizArea');
    const fb = $('quizFeedback');
    fb.className = 'quiz-feedback';
    fb.style.display = 'none';
    const q = QUIZ_QUESTIONS[quizIndex];
    area.innerHTML = `
        <div class="quiz-question">${quizIndex + 1}. ${q.q}</div>
        <div class="quiz-options">
            ${q.options.map((opt, i) => `<div class="quiz-option" tabindex="0" onclick="answerQuiz(${i})">${String.fromCharCode(65 + i)}. ${opt}</div>`).join('')}
        </div>
    `;
}

function answerQuiz(idx) {
    const q = QUIZ_QUESTIONS[quizIndex];
    const opts = document.querySelectorAll('.quiz-option');
    opts.forEach((o, i) => {
        o.classList.add(i === q.answer ? 'correct' : 'wrong');
        o.style.pointerEvents = 'none';
    });
    const fb = $('quizFeedback');
    if (idx === q.answer) {
        quizScore++;
        fb.innerHTML = '<strong>Benar!</strong> ' + q.explain;
        fb.className = 'quiz-feedback show correct';
    } else {
        fb.innerHTML = '<strong>Kurang tepat.</strong> ' + q.explain;
        fb.className = 'quiz-feedback show wrong';
    }
}

function nextQuizQuestion() {
    if (!quizStarted) return;
    quizIndex++;
    if (quizIndex < QUIZ_QUESTIONS.length) {
        renderQuizQuestion();
    } else {
        const score = (quizScore / QUIZ_QUESTIONS.length * 100).toFixed(0);
        $('quizArea').innerHTML = '<div class="quiz-question">Quiz selesai!</div>';
        $('quizFeedback').style.display = 'none';
        $('quizScore').style.display = 'block';
        $('quizScore').innerHTML = `
            <h3>Skor Quiz</h3>
            <div class="score-value">${score}%</div>
            <p>${score >= 80 ? 'Luar biasa!' : score >= 60 ? 'Bagus, terus berlatih!' : 'Pelajari kembali materinya.'}</p>
        `;
        saveProgress('quiz', score);
        quizStarted = false;
    }
}

window.startQuiz = startQuiz;
window.nextQuizQuestion = nextQuizQuestion;
window.answerQuiz = answerQuiz;

/* ============================================================
   PHASE 3 API STUBS
   (implementasi penuh disediakan oleh realtimeParameter.js; stub ini
    menjaga kompatibilitas bila realtimeParameter.js belum termuat/uji)
   ============================================================ */
function getSystemState() {
    if (window.Phase2 && window.Phase2.getSystemState) return window.Phase2.getSystemState();
    return Sim.systemState;
}

function getActiveFault() {
    return Sim.activeFaults[0] || null;
}

function getVoltageAtNode(nodeName) {
    if (window.Phase2 && window.Phase2.getVoltageAtNode) return window.Phase2.getVoltageAtNode(nodeName);
    return Sim.batteryVoltage;
}

function getCurrentAtPath(pathName) {
    if (window.Phase2 && window.Phase2.getCurrentAtPath) return window.Phase2.getCurrentAtPath(pathName);
    return Sim.starterCurrent;
}

function calculateVoltageDrop(pointA, pointB) {
    if (window.Phase2 && window.Phase2.calculateVoltageDrop) return window.Phase2.calculateVoltageDrop(pointA, pointB);
    return Math.max(0, Sim.batteryVoltage - Sim.starterVoltage);
}

function getComponentState(componentName) {
    if (window.Phase2 && window.Phase2.getComponentState) return window.Phase2.getComponentState(componentName);
    const map = {
        battery: Sim.batteryCondition,
        fuse: Sim.fuseState,
        ignition: Sim.ignitionState,
        relay: Sim.relayState,
        solenoid: Sim.solenoidState,
        starter: Sim.starterState,
        engine: Sim.engineState,
    };
    return map[componentName] || 'UNKNOWN';
}

window.getSystemState = getSystemState;
window.getActiveFault = getActiveFault;
window.getVoltageAtNode = getVoltageAtNode;
window.getCurrentAtPath = getCurrentAtPath;
window.calculateVoltageDrop = calculateVoltageDrop;
window.getComponentState = getComponentState;

/* ============================================================
   PROGRESS / LOCAL STORAGE
   ============================================================ */
function loadProgress() {
    try {
        return JSON.parse(localStorage.getItem(CONFIG.storageKey)) || {};
    } catch {
        return {};
    }
}

function saveProgress(key, value) {
    const data = loadProgress();
    data[key] = value;
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
}

function renderProgress() {
    const data = loadProgress();
    const set = (id, valId, key, suffix = '%') => {
        const v = data[key] || 0;
        if (typeof v === 'number') {
            $(id).style.width = v + '%';
            $(valId).textContent = v + suffix;
        }
    };
    set('prog-materi', 'prog-materi-val', 'materi');
    set('prog-praktik', 'prog-praktik-val', 'praktik');
    set('prog-diagnosis', 'prog-diagnosis-val', 'diagnosis');
    set('prog-quiz', 'prog-quiz-val', 'quiz');
}

/* ============================================================
   INIT
   ============================================================ */
function init() {
    // Register event bus listeners
    EventBus.on('faultApplied', updateFaultVisuals);

    // Render data-driven pages
    renderMateri();
    renderPraktik();
    renderProgress();

    // Initialize visuals
    updateIgnitionUI();
    updateSystemVisuals();
    updateInstruments();

    console.log('StarterLab v1.0 initialized.');
    console.log('States: ', Object.keys(SystemState).join(' -> '));
}

// Boot
document.addEventListener('DOMContentLoaded', init);

/* Menu "Lainnya" pada toolbar simulator: tutup saat klik di luar atau tekan Escape */
(function () {
    function more() { return document.getElementById('tbMore'); }
    document.addEventListener('click', function (e) {
        var m = more();
        if (m && m.open && !m.contains(e.target)) m.open = false;
    });
    document.addEventListener('keydown', function (e) {
        var m = more();
        if (e.key === 'Escape' && m && m.open) { m.open = false; var sm = m.querySelector('summary'); if (sm) sm.focus(); }
    });
})();
