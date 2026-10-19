/* ============================================================
   PHASE 2 — PARAMETER & VISUALISASI REAL-TIME
   Web Simulator Sistem Starter

   Module ini memperluas app.js (Phase 1) dengan:
     - model tegangan beban (V_load = V_oc - I x R_internal)
     - simulation loop requestAnimationFrame + smoothing lerp
     - gauge digital (tachometer, voltage, current)
     - technical data panel (node voltage + voltage drop)
     - event log + clear
     - data graph (battery voltage & starter current)
     - recording + export CSV
     - debug panel
     - timeline starter
     - mode BASIC / TECHNICAL
     - reduce motion
     - Phase 3 API: getVoltageAtNode / getCurrentAtPath /
       calculateVoltageDrop / getComponentState / getSystemState / getActiveFault

   Dependensi global dari app.js:
     Sim, CONFIG, SystemState, EventBus, $, oc, computeStarterVoltage,
     flashMessage.
   ============================================================ */
(function () {
    'use strict';

    if (window.Phase2) return; // sudah dimuat

    function $(id) { return document.getElementById(id); }

    /* ============================================================
       STATE (display & tools)
       ============================================================ */
    const D = {
        batteryVoltage: 12.6,
        starterVoltage: 12.6,
        starterCurrent: 0,
        starterRPM: 0,
        engineRPM: 0,
        voltageDropPositive: 0,
        voltageDropGround: 0,
        systemState: 'OFF',
        activeFault: null,
    };

    const P2 = {
        active: true,
        D: D,
        simTime: 0,                 // ms simulasi
        lastTs: 0,
        rafId: 0,
        running: false,
        reduceMotion: false,
        displayMode: 'BASIC',       // BASIC | TECHNICAL
        technical: false,           // state panel technical
        logOpen: false,
        debugOn: false,
        recording: false,
        recordStart: 0,
        recorded: [],               // [{ t, v, i }]
        eventLog: [],               // [{ time, message }]
        graph: { buffer: [], max: 500 },
        graphTimer: 0,
        dip: D,
    };

    /* ============================================================
       MODEL TEGANGAN NODE
       V_load = V_oc - I x R_internal  (battery di bawah beban)
       ============================================================ */
    function nodeResistances() {
        const rInt = Sim.batteryResistance || CONFIG.battery.internalResistance;
        const rTerminal = Sim.terminalResistance || 0;
        const rCable = (Sim.cableState === 'OPEN' ? CONFIG.cable.resistance * 10 : CONFIG.cable.resistance) * (Sim.cableResistanceMult || 1);
        const rGround = Sim.groundCondition === 'POOR' ? CONFIG.ground.poorResistance : CONFIG.ground.resistance;
        return { rInt, rTerminal, rCable, rGround };
    }

    // Main current yang menimbulkan sag pada node daya.
    function mainLoadCurrent() {
        if (Sim.solenoidState === 'ACTIVE' || Sim.starterState === 'CRANKING') {
            return Math.max(Sim.starterCurrent, 0);
        }
        return 0;
    }

    function computeNodeVoltages() {
        const ocv = Sim.batteryVoltage;
        const { rInt, rTerminal, rCable, rGround } = nodeResistances();
        const i = mainLoadCurrent();

        const terminalDrop = i * rTerminal;
        const cableDrop = i * rCable;
        const groundDrop = i * rGround;

        const batteryPositive = Math.max(0, ocv - i * rInt - terminalDrop);
        const batteryNegative = 0;
        // Kontak utama solenoid menutup hanya saat solenoid aktif & tidak gagal.
        // Jika gagal, terminal starter (M) tidak menerima tegangan dari battery.
        const mainContactClosed = !Sim.solenoidMainFail
            && (Sim.solenoidState === 'ACTIVE' || Sim.starterState === 'CRANKING');
        const starterPositive = mainContactClosed ? Math.max(0, batteryPositive - cableDrop) : 0;
        const starterGround = Math.min(groundDrop, batteryPositive);

        const ignActive = Sim.ignitionState === 'ON' || Sim.ignitionState === 'START';
        const fuseOk = Sim.fuseState !== 'OPEN';
        const ignOk = !Sim.ignitionFail;
        const cableOk = Sim.cableState !== 'OPEN';

        const ignitionOutput = (ignActive && fuseOk && ignOk) ? batteryPositive : 0;
        const relayInput = (ignActive && fuseOk && ignOk && cableOk) ? batteryPositive : 0;
        const relayOutput = (Sim.relayState === 'ACTIVE' && !Sim.relayFail && Sim.relayFaultType !== 'contactOpen') ? relayInput : 0;
        const solenoidControl = (Sim.relayState === 'ACTIVE' && !Sim.solenoidFail) ? relayOutput : 0;

        // Node tambahan untuk Phase 3 (virtual multimeter).
        // Semuanya diturunkan dari model yang sama (single source of truth).
        const fuseInput = batteryPositive;
        const fuseOutput = fuseOk ? batteryPositive : 0;
        const ignitionInput = fuseOk ? batteryPositive : 0;
        const relayGround = 0;
        const relayFeed = fuseOk ? batteryPositive : 0;   // kaki 30 relay: umpan dari keluaran fuse
        const solenoidMain = cableOk ? batteryPositive : 0;
        const solenoidGround = 0;
        const engineGround = 0;
        const chassisGround = 0;
        const starterHousing = starterGround;

        return {
            ocv,
            batteryPositive, ignitionOutput, relayInput, relayOutput,
            solenoidControl, starterPositive, starterGround, batteryNegative,
            fuseInput, fuseOutput, ignitionInput, relayGround, relayFeed,
            solenoidMain, solenoidGround, engineGround, chassisGround, starterHousing,
            cableDrop: cableDrop + terminalDrop, groundDrop, terminalDrop,
        };
    }

    function refreshSimVoltage() {
        const i = mainLoadCurrent();
        if (i > 0) {
            computeStarterVoltage();
        } else {
            Sim.starterVoltage = Sim.batteryVoltage;
            Sim.voltageDropPositive = 0;
            Sim.voltageDropGround = 0;
        }
    }

    /* ============================================================
       TARGET NILAI (sumber kebenaran dari model Sim)
       ============================================================ */
    function targets() {
        const V = computeNodeVoltages();
        const running = Sim.engineState === 'RUNNING';
        const wobble = P2.reduceMotion ? 0 : (CONFIG.engine && CONFIG.engine.idleWobble ? CONFIG.engine.idleWobble : 0);
        const engineRPM = running && wobble
            ? Sim.engineRPM + Math.sin(P2.simTime * 0.05) * wobble
            : Sim.engineRPM;
        return {
            batteryVoltage: V.batteryPositive,
            starterVoltage: V.starterPositive,
            starterCurrent: Sim.starterCurrent,
            starterRPM: Sim.starterRPM,
            engineRPM: Math.max(0, engineRPM),
            voltageDropPositive: V.cableDrop,
            voltageDropGround: V.groundDrop,
            systemState: Sim.systemState,
            activeFault: Sim.activeFaults.length ? Sim.activeFaults[0] : null,
        };
    }

    // Frame-rate independent smoothing: v += (t - v) * (1 - exp(-dt/tau))
    function lerpValue(cur, target, dt, tau) {
        if (tau <= 0) return target;
        const k = 1 - Math.exp(-dt / tau);
        return cur + (target - cur) * k;
    }

    function step(dt) {
        dt = dt || 16;
        if (P2.paused) return;
        P2.simTime += dt;

        refreshSimVoltage();
        const T = targets();

        D.batteryVoltage = lerpValue(D.batteryVoltage, T.batteryVoltage, dt, 60);
        D.starterVoltage = lerpValue(D.starterVoltage, T.starterVoltage, dt, 60);
        D.starterCurrent = lerpValue(D.starterCurrent, T.starterCurrent, dt, 45);
        D.starterRPM = lerpValue(D.starterRPM, T.starterRPM, dt, 90);
        D.engineRPM = lerpValue(D.engineRPM, T.engineRPM, dt, 140);
        D.voltageDropPositive = T.voltageDropPositive;
        D.voltageDropGround = T.voltageDropGround;
        D.systemState = T.systemState;
        D.activeFault = T.activeFault;

        // Graph sampling ~ setiap 100ms
        P2.graphTimer += dt;
        if (P2.graphTimer >= 100) {
            P2.graphTimer = 0;
            pushSample(P2.simTime, D.batteryVoltage, D.starterCurrent);
        }

        if (P2.recording) {
            P2.recorded.push({
                t: P2.simTime - P2.recordStart,
                v: Math.round(D.batteryVoltage * 100) / 100,
                i: Math.round(D.starterCurrent * 10) / 10,
            });
        }

        render();
    }

    /* ============================================================
       RENDER — semua kanal UI
       ============================================================ */
    function render() {
        renderInstruments();
        renderTimeline();
        renderFaultMarks();
        renderGraph();
        if (P2.technical) renderTechnicalPanel();
        if (P2.debugOn) renderDebug();
        updateWireVoltageLabel();
    }

    function renderInstruments() {
        // Panel instrumen dasar (Phase 1)
        setText('dispVoltage', D.batteryVoltage.toFixed(2) + ' V');
        setWidth('voltageBar', Math.min(100, (D.batteryVoltage / 13) * 100));
        if (D.batteryVoltage < 11.5) setStyle('voltageBar', 'background', 'var(--danger)');
        else if (D.batteryVoltage < 12.0) setStyle('voltageBar', 'background', 'var(--warning)');
        else setStyle('voltageBar', 'background', '');

        setText('dispCurrent', Math.round(D.starterCurrent).toFixed(0) + ' A');
        setWidth('currentBar', Math.min(100, (D.starterCurrent / 300) * 100));

        setText('dispStarterRPM', Math.round(D.starterRPM) + ' RPM');
        setWidth('starterRPMBar', Math.min(100, (D.starterRPM / 300) * 100));

        setText('dispEngineRPM', Math.round(D.engineRPM) + ' RPM');
        setWidth('engineRPMBar', Math.min(100, (D.engineRPM / 1000) * 100));

        setText('dispSystemStatus', D.systemState);
        setText('dispBatteryStatus', Sim.batteryCondition);
        setText('dispRelayStatus', Sim.relayState);
        setText('dispSolenoidStatus', Sim.solenoidState);
        setText('dispPinionStatus', Sim.pinionEngaged ? 'ENGAGED' : 'DISENGAGED');

        updateStatusRow();

        // Gauges digital (Phase 2)
        renderGauges();
    }

    /* ---------- Gauges ---------- */
    function buildGauge(id, label, unit, min, max, bigEnd) {
        return '<div class="p2-gauge" id="' + id + '">'
            + '<div class="p2-gauge-face">'
            + '<div class="p2-gauge-needle"></div>'
            + '</div>'
            + '<div class="p2-gauge-meta">'
            + '<span class="p2-gauge-label">' + label + '</span>'
            + '<span class="p2-gauge-value" id="' + id + '-val">0</span>'
            + '<span class="p2-gauge-unit">' + unit + '</span>'
            + '</div>'
            + '</div>';
    }

    function ensureGauges() {
        const host = $('p2-gaugesContent');
        if (!host) return;
        if (host.p2GauesBuilt) return;
        if ($('p2-gauge-tach')) { host.p2GauesBuilt = true; return; }
        host.innerHTML = ''
            + buildGauge('p2-gauge-tach', 'TACH', 'RPM', 0, 1000)
            + buildGauge('p2-gauge-volt', 'BATT', 'V', 8, 16)
            + buildGauge('p2-gauge-amp', 'CRANK', 'A', 0, 300);
        host.p2GauesBuilt = true;
    }

    function renderGauges() {
        const setNeedle = (id, ratio) => {
            const el = $(id);
            if (!el) return;
            const needle = el.querySelector ? el.querySelector('.p2-gauge-needle') : null;
            if (!needle) return;
            const startAngle = 225; // titik awal (kiri bawah)
            const span = 270;
            const angle = startAngle - span * Math.max(0, Math.min(1, ratio));
            needle.style.transform = 'rotate(' + angle + 'deg)';
        };
        const setVal = (id, text) => {
            const el = $(id + '-val');
            if (el) el.textContent = text;
        };

        setNeedle('p2-gauge-tach', D.engineRPM / 1000);
        setVal('p2-gauge-tach', Math.round(D.engineRPM));
        setNeedle('p2-gauge-volt', (D.batteryVoltage - 8) / 8);
        setVal('p2-gauge-volt', D.batteryVoltage.toFixed(1));
        setNeedle('p2-gauge-amp', D.starterCurrent / 300);
        setVal('p2-gauge-amp', Math.round(D.starterCurrent));
    }

    /* ---------- Timeline ---------- */
    const TIMELINE_MAP = {
        'OFF': 'rest',
        'IGNITION_ON': 'ign',
        'START_REQUEST': 'ign',
        'RELAY_ACTIVE': 'relay',
        'SOLENOID_ACTIVE': 'sol',
        'PINION_ENGAGED': 'pinion',
        'STARTER_CRANKING': 'crank',
        'ENGINE_RUNNING': 'run',
    };

    function renderTimeline() {
        const key = TIMELINE_MAP[D.systemState] || 'rest';
        const track = document.querySelector ? document.querySelector('.timeline-track') : null;
        if (!track || !track.children || !track.children.length) return;
        for (let i = 0; i < track.children.length; i++) {
            const seg = track.children[i];
            const cls = 'timeline-seg';
            if (seg.classList && seg.classList.contains) {
                seg.classList.toggle('active', seg.getAttribute('data-step') === key);
            }
        }
    }

    /* ---------- Fault marks (SVG) ---------- */
    function renderFaultMarks() {
        const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? 'block' : 'none'; };
        show('fuseBreakMark', Sim.fuseState === 'OPEN');
        show('relayBreakMark', !!Sim.relayFail);
        show('cableBreakMark', Sim.cableState === 'OPEN');
    }

    function updateWireVoltageLabel() {
        const el = $('p2-wireVoltageLabel');
        if (!el) return;
        const V = computeNodeVoltages();
        if (V.ocv <= 0 && Sim.ignitionState === 'OFF') {
            el.textContent = '—';
            return;
        }
        el.textContent = V.starterPositive.toFixed(1) + 'V';
    }

    /* ---------- Technical panel ---------- */
    function renderTechnicalPanel() {
        const V = computeNodeVoltages();
        setText('p2-tn-batteryPositive', V.batteryPositive.toFixed(1) + 'V');
        setText('p2-tn-ignitionOutput', V.ignitionOutput.toFixed(1) + 'V');
        setText('p2-tn-relayInput', V.relayInput.toFixed(1) + 'V');
        setText('p2-tn-relayOutput', V.relayOutput.toFixed(1) + 'V');
        setText('p2-tn-solenoidControl', V.solenoidControl.toFixed(1) + 'V');
        setText('p2-tn-starterPositive', V.starterPositive.toFixed(1) + 'V');
        setText('p2-tn-starterGround', V.starterGround.toFixed(2) + 'V');
        setText('p2-tn-batteryNegative', V.batteryNegative.toFixed(1) + 'V');
        setText('p2-dropPos', V.cableDrop.toFixed(2) + 'V');
        setText('p2-dropGnd', V.groundDrop.toFixed(2) + 'V');
    }

    /* ---------- Graph canvas ---------- */
    function pushSample(t, v, i) {
        const b = P2.graph.buffer;
        b.push({ t: t, v: v, i: i });
        if (b.length > P2.graph.max) b.shift();
    }

    function renderGraph() {
        const c = $('p2-graphCanvas');
        if (!c || !c.getContext) return;
        const ctx = c.getContext('2d');
        if (!ctx) return;

        const W = c.width || 340;
        const H = c.height || 120;
        const padL = 6, padR = 6, padT = 6, padB = 14;
        const iw = W - padL - padR;
        const ih = H - padT - padB;

        ctx.clearRect(0, 0, W, H);

        // Grid & labels
        ctx.font = '7px monospace';
        // Voltage scale 8..14
        const vMin = 8, vMax = 14;
        const iMax = 300;
        const xFor = t => {
            const b = P2.graph.buffer;
            if (b.length < 2) return padL;
            const t0 = b[0].t, t1 = b[b.length - 1].t;
            const span = Math.max(1, t1 - t0);
            return padL + (t - t0) / span * iw;
        };
        const yForV = v => padT + (1 - (v - vMin) / (vMax - vMin)) * ih;
        const yForI = i => padT + (1 - i / iMax) * ih;

        ctx.strokeStyle = '#cdd8e4';
        ctx.lineWidth = 1;
        for (let g = 0; g <= 4; g++) {
            const y = padT + g / 4 * ih;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(W - padR, y);
            ctx.stroke();
        }
        ctx.fillStyle = '#465e78';
        ctx.fillText('14V', 0, padT + 4);
        ctx.fillText('8V', 0, padT + ih);
        ctx.fillText('300A', 0, padT + ih - 2);

        const b = P2.graph.buffer;
        const drawLine = (mapper, color) => {
            if (b.length < 2) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            for (let n = 0; n < b.length; n++) {
                const x = xFor(b[n].t);
                const y = mapper(b[n].v, b[n].i);
                if (n === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        };
        drawLine((v, i) => yForV(v), '#0a9cb4');
        drawLine((v, i) => yForI(i), '#ff9100');

        if (P2.recording) {
            ctx.fillStyle = '#ff5252';
            ctx.fillRect(W - 12, 2, 8, 8);
        }
    }

    /* ---------- Event log ---------- */
    function timeString(ms) {
        const s = Math.floor(ms / 1000);
        const pad = n => (n < 10 ? '0' : '') + n;
        return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
    }

    function logEvent(message) {
        P2.eventLog.push({ time: P2.simTime, message: message });
        if (P2.eventLog.length > 200) P2.eventLog.shift();
        renderLog();
    }

    function renderLog() {
        const list = $('p2-logList');
        if (!list) return;
        let html = '';
        for (let i = 0; i < P2.eventLog.length; i++) {
            const e = P2.eventLog[i];
            html += '<div class="p2-log-item">[' + timeString(e.time) + '] ' + escapeHtml(e.message) + '</div>';
        }
        list.innerHTML = html || '<div class="p2-log-empty">Belum ada event.</div>';
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /* ---------- Debug panel ---------- */
    function renderDebug() {
        const el = $('p2-debugContent');
        if (!el) return;
        el.textContent = 'STATE=' + Sim.systemState
            + ' | Vbat=' + D.batteryVoltage.toFixed(2)
            + 'V | Vstarter=' + D.starterVoltage.toFixed(2)
            + 'V | I=' + Math.round(D.starterCurrent) + 'A'
            + ' | RPM=' + Math.round(D.starterRPM)
            + ' | eRPM=' + Math.round(D.engineRPM)
            + ' | fault=' + (D.activeFault || 'NONE')
            + ' | rect:' + Sim.relayState + '/' + Sim.solenoidState
            + ' | pinion=' + Sim.pinionEngaged;
    }

    /* ============================================================
       TOGGLES & ACTIONS
       ============================================================ */
    function toggleTechnical(force) {
        const on = force === undefined ? !P2.technical : !!force;
        P2.technical = on;
        const panel = $('p2-technicalPanel');
        if (panel) panel.style.display = on ? 'block' : 'none';
        if (on) renderTechnicalPanel();
    }

    function toggleDisplayMode() {
        P2.displayMode = P2.displayMode === 'BASIC' ? 'TECHNICAL' : 'BASIC';
        const btn = $('p2-display-btn');
        if (btn) btn.textContent = P2.displayMode;
        toggleTechnical(P2.displayMode === 'TECHNICAL');
        if (document.body && document.body.classList) {
            document.body.classList.toggle('p2-technical-mode', P2.displayMode === 'TECHNICAL');
        }
    }

    function toggleLog() {
        P2.logOpen = !P2.logOpen;
        const panel = $('p2-logPanel');
        if (panel) panel.style.display = P2.logOpen ? 'block' : 'none';
        if (P2.logOpen) renderLog();
    }

    function toggleDebug() {
        P2.debugOn = !P2.debugOn;
        const panel = $('p2-debugPanel');
        if (panel) panel.style.display = P2.debugOn ? 'block' : 'none';
        if (P2.debugOn) renderDebug();
    }

    function toggleReduceMotion(force) {
        P2.reduceMotion = force === undefined ? !P2.reduceMotion : !!force;
        document.body.classList.toggle('reduce-motion', P2.reduceMotion);
        const cb = $('p2-reduceMotion');
        if (cb) cb.checked = P2.reduceMotion;
    }

    function clearLog() {
        P2.eventLog = [];
        renderLog();
    }

    /* ---------- Recording + CSV ---------- */
    function startRecord() {
        P2.recorded = [];
        P2.recordStart = P2.simTime;
        P2.recording = true;
        const btn = $('p2-record-btn');
        if (btn) btn.textContent = 'STOP';
        const csvBtn = $('p2-export-btn');
        if (csvBtn) csvBtn.disabled = false;
        logEvent('Recording dimulai');
    }

    function stopRecord() {
        P2.recording = false;
        const btn = $('p2-record-btn');
        if (btn) btn.textContent = 'REC';
        logEvent('Recording dihentikan (' + P2.recorded.length + ' sampel)');
    }

    function buildCSV() {
        let csv = 'time_ms,voltage_v,current_a\n';
        for (let i = 0; i < P2.recorded.length; i++) {
            const r = P2.recorded[i];
            csv += r.t.toFixed(0) + ',' + r.v.toFixed(2) + ',' + r.i.toFixed(1) + '\n';
        }
        return csv;
    }

    function exportCSV() {
        if (!P2.recorded.length) {
            logEvent('Tidak ada data recording untuk diekspor');
            return;
        }
        const csv = buildCSV();
        const filename = 'starter-recording.csv';
        try {
            if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                if (document.body && document.body.appendChild) document.body.appendChild(a);
                a.click();
                if (a.remove) a.remove();
            } else {
                // Fallback (Node/harness): minimalkan interrupt
                console.log('CSV export:', filename);
            }
        } catch (e) {
            console.log('CSV export (fallback):', filename);
        }
        logEvent('CSV diekspor (' + P2.recorded.length + ' baris)');
    }

    /* ============================================================
       PHASE 3 API
       ============================================================ */
    function getSystemState() { return Sim.systemState; }

    function getActiveFault() { return Sim.activeFaults.length ? Sim.activeFaults[0] : null; }

    function getVoltageAtNode(nodeName) {
        const V = computeNodeVoltages();
        const map = {
            'batterypositive': V.batteryPositive,
            'ignitionoutput': V.ignitionOutput,
            'relayinput': V.relayInput,
            'relayoutput': V.relayOutput,
            'solenoidcontrol': V.solenoidControl,
            'starterpositive': V.starterPositive,
            'starterground': V.starterGround,
            'batterynegative': V.batteryNegative,
            'fuseinput': V.fuseInput,
            'fuseoutput': V.fuseOutput,
            'ignitioninput': V.ignitionInput,
            'relayground': V.relayGround,
            'relayfeed': V.relayFeed,
            'solenoidmain': V.solenoidMain,
            'solenoidground': V.solenoidGround,
            'engineground': V.engineGround,
            'chassisground': V.chassisGround,
            'starterhousing': V.starterHousing,
        };
        const key = String(nodeName || '').toLowerCase();
        if (Object.prototype.hasOwnProperty.call(map, key)) return round3(map[key]);
        return -1; // node tidak dikenal
    }

    function round3(v) { return Math.round(v * 1000) / 1000; }

    function getCurrentAtPath(pathName) {
        const p = String(pathName || '').toLowerCase();
        switch (p) {
            case 'control':           return Sim.relayState === 'ACTIVE' ? CONFIG.starter.relayCurrent : 0;
            case 'solenoid-control':  return Sim.solenoidState === 'ACTIVE' && !Sim.solenoidFail ? CONFIG.starter.solenoidCurrent : 0;
            case 'main':
                if (Sim.starterState === 'CRANKING') return Sim.starterCurrent;
                if (Sim.solenoidState === 'ACTIVE') return CONFIG.starter.solenoidCurrent + CONFIG.starter.relayCurrent;
                return 0;
            case 'starter':           return Sim.starterState === 'CRANKING' ? Sim.starterCurrent : 0;
            default:                  return 0;
        }
    }

    function calculateVoltageDrop(pointA, pointB) {
        const va = getVoltageAtNode(pointA);
        const vb = getVoltageAtNode(pointB);
        if (va < 0 || vb < 0) return 0;
        return round3(Math.abs(va - vb));
    }

    function getComponentState(componentName) {
        const map = {
            battery: { state: Sim.batteryCondition, voltage: Sim.batteryVoltage, current: Sim.starterCurrent },
            fuse: { state: Sim.fuseState },
            ignition: { state: Sim.ignitionState, fault: !!Sim.ignitionFail },
            relay: { state: Sim.relayState, fault: !!Sim.relayFail },
            solenoid: { state: Sim.solenoidState, fault: !!Sim.solenoidFail, pinion: Sim.pinionEngaged },
            starter: {
                state: Sim.starterState,
                rpm: Sim.starterRPM,
                current: Sim.starterCurrent,
                voltage: getVoltageAtNode('starterPositive'),
                fault: Sim.starterMotorFault,
            },
            cable: { state: Sim.cableState, drop: round3(D.voltageDropPositive || Sim.voltageDropPositive) },
            ground: { state: Sim.groundCondition, drop: round3(D.voltageDropGround || Sim.voltageDropGround) },
            engine: { state: Sim.engineState, rpm: Sim.engineRPM },
        };
        if (Object.prototype.hasOwnProperty.call(map, componentName)) return map[componentName];
        return { state: 'UNKNOWN' };
    }

    /* ============================================================
       EVENT BUS HOOKS -> event log
       ============================================================ */
    function hookEvents() {
        EventBus.on('ignitionChanged', s => logEvent('Ignition: ' + s));
        EventBus.on('relayActivated', () => logEvent('Relay AKTIF'));
        EventBus.on('solenoidActivated', () => logEvent('Solenoid AKTIF'));
        EventBus.on('pinionEngaged', () => logEvent('Pinion terkait dengan flywheel'));
        EventBus.on('starterStarted', () => logEvent('Starter cranking dimulai'));
        EventBus.on('engineStarted', () => logEvent('ENGINE START BERHASIL'));
        EventBus.on('engineCranking', ok => logEvent(ok ? 'Cranking...' : 'Engine gagal start, tetap cranking'));
        EventBus.on('systemShutdown', () => logEvent('Sistem dimatikan (shutdown)'));
        EventBus.on('faultApplied', faults => {
            const fl = Object.keys(FAULTS).filter(k => faults.indexOf(k) >= 0);
            logEvent('Fault diterapkan: ' + (fl.length ? fl.map(k => FAULTS[k].label).join(', ') : 'tanpa fault'));
        });
        EventBus.on('simulationReset', () => {
            logEvent('Simulasi direset');
            P2.graph.buffer = [];
        });
    }

    /* ============================================================
       SIMULATION LOOP (requestAnimationFrame tunggal)
       ============================================================ */
    function frame(ts) {
        if (!P2.running) return;
        if (!P2.lastTs) P2.lastTs = ts;
        const dt = Math.min(100, ts - P2.lastTs || 16);
        P2.lastTs = ts;
        step(dt);
        if (typeof requestAnimationFrame === 'function') {
            P2.rafId = requestAnimationFrame(frame);
        }
    }

    function startLoop() {
        if (P2.running) return;
        P2.running = true;
        P2.lastTs = 0;
        if (typeof requestAnimationFrame === 'function') {
            P2.rafId = requestAnimationFrame(frame);
        }
    }

    function stopLoop() {
        P2.running = false;
        if (P2.rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(P2.rafId);
        P2.rafId = 0;
    }

    /* ============================================================
       HELPERS + INIT
       ============================================================ */
    function setText(id, text) {
        const el = $(id);
        if (el) el.textContent = text;
    }
    function setWidth(id, width) {
        const el = $(id);
        if (el && el.style) el.style.width = width + '%';
    }
    function setStyle(id, prop, val) {
        const el = $(id);
        if (el && el.style) el.style[prop] = val;
    }

    function init() {
        ensureGauges();
        hookEvents();
        setText('dispSystemStatus', D.systemState);
        logEvent('Fase lanjutan (Phase 2) siap');
        startLoop();
    }

    // ==========================================================
    //   EXPORT
    // ==========================================================
    window.Phase2 = {
        active: true,
        D: D,
        step: step,
        renderInstruments: renderInstruments,
        // toggles & actions
        toggleTechnical: toggleTechnical,
        toggleDisplayMode: toggleDisplayMode,
        toggleLog: toggleLog,
        clearLog: clearLog,
        toggleDebug: toggleDebug,
        toggleReduceMotion: toggleReduceMotion,
        startRecord: startRecord,
        stopRecord: stopRecord,
        exportCSV: exportCSV,
        // Phase 3 API
        getSystemState: getSystemState,
        getActiveFault: getActiveFault,
        getVoltageAtNode: getVoltageAtNode,
        getCurrentAtPath: getCurrentAtPath,
        calculateVoltageDrop: calculateVoltageDrop,
        getComponentState: getComponentState,
        // utilitas
        logEvent: logEvent,
        clearLog: clearLog,
        // simulasi pause (dipakai Phase 6: PAUSE SIMULATION)
        togglePause: function () { P2.paused = !P2.paused; return P2.paused; },
        isPaused: function () { return !!P2.paused; },
        // Test helpers / internals
        _P2: P2,
    };

    init();
})();