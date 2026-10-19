/* ============================================================
   PHASE 3 — VIRTUAL MULTIMETER & PRAKTIK PENGUKURAN
   Web Simulator Sistem Starter

   Menambahkan laboratorium pengukuran virtual:
     - Mode V DC / A DC (disiapkan) / OHM / CONTINUITY / V DROP
     - Probe merah & hitam (klik pada titik ukur / daftar)
     - Pengukuran live dari model (single source of truth: realtimeParameter.js)
     - Riwayat pengukuran + worksheet (ADD / CLEAR / EXPORT CSV)
     - 8 praktik terbimbing + free mode + skor
     - Aturan keselamatan: OHM/CON saat sistem berenergi diblokir
     - Data tersimpan terstruktur untuk Phase 4 (diagnosis)

   Dependensi global: Sim, CONFIG (app.js), Phase2 (realtimeParameter.js).
   ============================================================ */
(function () {
    'use strict';

    if (window.Phase3) return; // sudah dimuat

    function $(id) { return document.getElementById(id); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    /* ============================================================
       NODE REGISTRY (titik ukur + koordinat SVG)
       ============================================================ */
    const NODES = {
        batteryPositive: { label: 'Battery +',    x: 142, y: 100 },
        batteryNegative: { label: 'Battery −',    x: 88,  y: 100 },
        fuseInput:       { label: 'Fuse Input',   x: 200, y: 170 },
        fuseOutput:      { label: 'Fuse Output',  x: 200, y: 200 },
        ignitionInput:   { label: 'Ignition In',  x: 300, y: 268 },
        ignitionOutput:  { label: 'Ignition Out', x: 360, y: 268 },
        relayFeed:       { label: 'Relay Pin 30 (umpan)', x: 445, y: 310 },
        relayInput:      { label: 'Relay In',     x: 420, y: 335 },
        relayOutput:     { label: 'Relay Out',    x: 500, y: 335 },
        relayGround:     { label: 'Relay Coil −', x: 445, y: 380 },
        solenoidControl: { label: 'Solenoid Ctrl', x: 585, y: 300 },
        solenoidMain:    { label: 'Solenoid Main', x: 645, y: 245 },
        solenoidGround:  { label: 'Solenoid Coil −', x: 625, y: 325 },
        starterPositive: { label: 'Starter M',    x: 700, y: 330 },
        starterGround:   { label: 'Starter Case −', x: 700, y: 400 },
        starterHousing:  { label: 'Starter Housing', x: 745, y: 400 },
        engineGround:    { label: 'Engine Block', x: 770, y: 460 },
        chassisGround:   { label: 'Chassis Chassis', x: 880, y: 460 },
    };

    const MODES = {
        V:    { unit: 'V DC',   label: 'V DC' },
        A:    { unit: 'A DC',   label: 'A DC' },
        OHM:  { unit: 'Ω',      label: 'OHM' },
        CONT: { unit: '',       label: 'CONTINUITY' },
        DROP: { unit: 'V',      label: 'V DROP' },
    };

    /* ============================================================
       STATE
       ============================================================ */
    const S = {
        mode: 'V',
        sound: true,
        autoRange: true,
        labOpen: false,
        freeMode: false,
        selectedProbe: 'red',          // probe yang akan ditempatkan berikutnya
        probes: { red: null, black: null },
        reading: null,                 // { value, unit, ok, level, text, ol }
        lastAction: null,
        safetyBlocked: false,
        safetyPendingMode: null,
        history: [],
        worksheet: [],
        records: [],                   // untuk Phase 4: { test, redProbe, blackProbe, value, unit, timestamp, ... }
        stats: { procedure: 0, measurement: 0, accuracy: 0, safety: 0 },
        safetyStrikes: 0,
        practiceIndex: -1,             // -1 = none | 0..7
        completedPractices: [],
        pulseId: 0,
    };

    /* ============================================================
       PRAKTIK TERBIMBING (8)
       system: 'OFF' | 'ON' | 'CRANKING'  (kondisi yang dibutuhkan)
       ============================================================ */
    const PRACTICES = [
        {
            id: 'batvolt', title: 'Battery Voltage', mode: 'V', unit: 'V',
            red: 'batteryPositive', black: 'batteryNegative', system: 'OFF',
            min: 12.45, max: 12.75,
            hint: 'Ukur tegangan baterai (open circuit) dengan ignition OFF.',
        },
        {
            id: 'ignswitch', title: 'Ignition Switch Voltage', mode: 'V', unit: 'V',
            red: 'ignitionOutput', black: 'batteryNegative', system: 'ON',
            min: 11.5, max: 12.9,
            hint: 'Posisikan ignition ke ON lalu ukur keluaran saklar.',
        },
        {
            id: 'relaycoil', title: 'Relay Test (Kumparan)', mode: 'OHM', unit: 'Ω',
            red: 'relayInput', black: 'relayGround', system: 'OFF',
            min: 3.0, max: 3.5,
            hint: 'Matikan sistem; ukur resistansi kumparan relay ±3.2Ω.',
        },
        {
            id: 'solctrl', title: 'Solenoid Control Voltage', mode: 'V', unit: 'V',
            red: 'solenoidControl', black: 'batteryNegative', system: 'CRANKING',
            min: 11.0, max: 12.9,
            hint: 'Tahan START sampai cranking, ukur tegangan kontrol solenoid.',
        },
        {
            id: 'startervolt', title: 'Starter Motor Voltage', mode: 'V', unit: 'V',
            red: 'starterPositive', black: 'batteryNegative', system: 'CRANKING',
            min: 11.0, max: 12.5,
            hint: 'Saat cranking, ukur tegangan di terminal motor starter.',
        },
        {
            id: 'drop_pos', title: 'Positive Voltage Drop', mode: 'DROP', unit: 'V',
            red: 'batteryPositive', black: 'starterPositive', system: 'CRANKING',
            min: 0.10, max: 0.35,
            hint: 'Saat cranking, ukur selisih tegangan battery+ dan starter M.',
        },
        {
            id: 'drop_gnd', title: 'Ground Voltage Drop', mode: 'DROP', unit: 'V',
            red: 'starterGround', black: 'batteryNegative', system: 'CRANKING',
            min: 0.10, max: 0.35,
            hint: 'Saat cranking, ukur drop pada kabel ground starter.',
        },
        {
            id: 'fusecont', title: 'Fuse Continuity', mode: 'CONT', unit: 'Ω',
            red: 'fuseInput', black: 'fuseOutput', system: 'OFF',
            min: 0, max: 10, beeps: true,
            hint: 'Matikan sistem; gunakan CONTINUITY pada kedua kaki fuse.',
        },
    ];

    /* ============================================================
       MODEL RESISTANSI (grafik node + Dijkstra)
       OL = open loop (bukan hambatan terhubung)
       ============================================================ */
    function resistanceEdges() {
        const e = [];
        const add = (a, b, r) => {
            if (r !== null && isFinite(r) && r >= 0) e.push([a, b, r]);
        };
        const gnd = Sim.groundCondition === 'POOR' ? 0.035 : 0.01;

        // Ground network
        add('batteryNegative', 'relayGround', 0);
        add('batteryNegative', 'solenoidGround', 0);
        add('batteryNegative', 'engineGround', 0);
        add('batteryNegative', 'chassisGround', 0);
        add('engineGround', 'chassisGround', 0);
        add('solenoidGround', 'engineGround', 0);
        add('batteryNegative', 'starterGround', gnd);
        add('starterGround', 'starterHousing', 0.005);

        // Starter winding
        add('starterHousing', 'starterPositive', Sim.starterMotorFault ? null : 0.02);

        // Positive cable (solenoid main ke starter M)
        add('starterPositive', 'solenoidMain', Sim.cableState === 'OPEN' ? null : 0.01 * (Sim.cableResistanceMult || 1));

        // Kontak utama solenoid (tertutup hanya saat solenoid aktif)
        add('solenoidMain', 'batteryPositive', (Sim.solenoidState === 'ACTIVE' && !Sim.solenoidMainFail) ? 0.02 : null);

        // Fuse & jalur kontrol
        add('batteryPositive', 'fuseInput', 0.005 + (Sim.terminalResistance || 0));
        add('fuseInput', 'fuseOutput', Sim.fuseState === 'OPEN' ? null : 0.02);
        add('fuseOutput', 'ignitionInput', 0.005);
        add('ignitionInput', 'ignitionOutput', Sim.ignitionFail ? null : 0.1);
        add('ignitionOutput', 'relayInput', 0.01);
        // Kaki 30 relay diumpan langsung dari keluaran fuse (cabang sebelum kunci kontak)
        add('fuseOutput', 'relayFeed', 0.005);

        // Relay: kumparan 85-86 (relayInput - relayGround) dan kontak 30-87
        add('relayInput', 'relayGround', Sim.relayFail ? null : 3.2);
        const contactClosed = (Sim.relayState === 'ACTIVE' && Sim.relayFaultType !== 'contactOpen');
        add('relayFeed', 'relayOutput', contactClosed ? 0.02 : null);   // kontak 30-87 (jalur sebenarnya)
        add('relayInput', 'relayOutput', contactClosed ? 0.02 : null);  // dipertahankan agar kasus diagnosa lama tetap sama

        // Keluaran relay ke kontrol solenoid + kumparan solenoid
        add('relayOutput', 'solenoidControl', 0.01);
        add('solenoidControl', 'solenoidGround', Sim.solenoidFail ? null : 0.57);

        return e;
    }

    function resistanceBetween(a, b) {
        if (!a || !b) return null;
        if (a === b) return 0;
        if (!NODES[a] || !NODES[b]) return null;

        const edges = resistanceEdges();
        const dist = {};
        const seen = {};
        Object.keys(NODES).forEach(n => { dist[n] = Infinity; });
        dist[a] = 0;

        for (let i = 0; i < Object.keys(NODES).length; i++) {
            let cur = null;
            Object.keys(dist).forEach(n => {
                if (!seen[n] && (cur === null || dist[n] < dist[cur])) cur = n;
            });
            if (cur === null) break;
            seen[cur] = true;
            for (let j = 0; j < edges.length; j++) {
                const ed = edges[j];
                if (ed[0] === cur && !seen[ed[1]] && dist[cur] + ed[2] < dist[ed[1]]) {
                    dist[ed[1]] = dist[cur] + ed[2];
                } else if (ed[1] === cur && !seen[ed[0]] && dist[cur] + ed[2] < dist[ed[0]]) {
                    dist[ed[0]] = dist[cur] + ed[2];
                }
            }
        }
        if (dist[b] === Infinity) return null; // OL
        return Math.round(dist[b] * 100000) / 100000;
    }

    /* ============================================================
       ARUS SBB (mode A DC — disiapkan; clamp/amper virtual)
       ============================================================ */
    function currentAtPair(red, black) {
        const set = [red, black].filter(Boolean).sort().join(',');
        const pair = (x, y) => [x, y].sort().join(',');
        if (set === pair('starterPositive', 'starterHousing') || set === pair('starterPositive', 'batteryNegative')
            || set === pair('starterPositive', 'solenoidMain')) {
            return Sim.starterState === 'CRANKING' ? Math.round(Sim.starterCurrent) : 0;
        }
        if (set === pair('batteryPositive', 'batteryNegative')) {
            return Sim.starterState === 'CRANKING' ? Math.round(Sim.starterCurrent) : 0;
        }
        if (set === pair('solenoidControl', 'solenoidGround')) {
            return Sim.solenoidState === 'ACTIVE' && !Sim.solenoidFail ? CONFIG.starter.solenoidCurrent : 0;
        }
        if (set === pair('relayInput', 'relayGround')) {
            return Sim.relayState === 'ACTIVE' && !Sim.relayFail ? CONFIG.starter.relayCurrent : 0;
        }
        return 0; // tidak ada jalur arus antara kedua probe
    }

    /* ============================================================
       SISTEM BERENERGI + KESELAMATAN
       ============================================================ */
    function systemEnergized() {
        return Sim.ignitionState === 'ON'
            || Sim.ignitionState === 'START'
            || Sim.relayState === 'ACTIVE'
            || Sim.solenoidState === 'ACTIVE'
            || Sim.starterState === 'CRANKING'
            || Sim.engineState === 'CRANKING'
            || Sim.engineState === 'RUNNING';
    }

    function modeRequiresDeadCircuit() { return S.mode === 'OHM' || S.mode === 'CONT'; }

    /* ============================================================
       PENGUKURAN INTI
       ============================================================ */
    function getExpectedValue(mode, red, black) {
        mode = mode || S.mode;
        if (!red || !black) return null;
        switch (mode) {
            case 'V': return Math.round((Phase2.getVoltageAtNode(red) - Phase2.getVoltageAtNode(black)) * 1000) / 1000;
            case 'DROP': return Phase2.calculateVoltageDrop(red, black);
            case 'A': return currentAtPair(red, black);
            case 'OHM':
            case 'CONT': return resistanceBetween(red, black);
            default: return null;
        }
    }

    function formatValue(mode, value) {
        if (value === null || value === undefined) return 'OL';
        if (mode === 'CONT') return value <= 10 ? 'CONTINUITY' : 'NO CONTINUITY';
        if (mode === 'A') return value + ' A';
        if (Math.abs(value) >= 1000) return (value / 1000).toFixed(2) + 'kΩ';
        if (mode === 'OHM') return value.toFixed(2) + ' Ω';
        if (mode === 'DROP') return value.toFixed(2) + ' V';
        return value.toFixed(2) + ' V';
    }

    function barLevel(mode, value) {
        if (value === null || value === undefined) return 0;
        switch (mode) {
            case 'V': return clamp(Math.abs(value) / 16, 0, 1);
            case 'A': return clamp(Math.abs(value) / 300, 0, 1);
            case 'DROP': return clamp(Math.abs(value) / 1, 0, 1);
            default: return clamp(Math.abs(value) / 10, 0, 1);
        }
    }

    function assessReading(mode, value, red, black) {
        if (mode === 'V') {
            const expectGood = 12.6;
            if (value === null || value === undefined) return ['OL — sirkuit terbuka', 'err'];
            if (value < 0) return ['Polaritas terbalik (negatif). Periksa kabel probe.', 'warn'];
            if (Math.abs(value - expectGood) > 0.5 && Phase2.getCurrentAtPath('starter') === 0) {
                return ['Tegangan di bawah normal. Indikasi baterai lemah / beban berlebih.', 'warn'];
            }
            return ['Pengukuran OK.', 'ok'];
        }
        if (mode === 'OHM') {
            if (value === null) return ['OL = open circuit. Mungkin komponen putus / tidak ada kontinuitas.', 'warn'];
            return ['Resistansi terhubung (' + value.toFixed(2) + ' Ω).', 'ok'];
        }
        if (mode === 'CONT') {
            if (value === null) return ['NO CONTINUITY — putus.', 'err'];
            if (value <= 10) return ['CONTINUITY — jalur terhubung (buzz).', 'ok'];
            return ['Resistansi tinggi (>10Ω) — kontak buruk.', 'warn'];
        }
        if (mode === 'DROP') {
            if (value === null || value === undefined) return ['Tidak dapat diukur pada posisi ini.', 'err'];
            if (value > 0.5) return ['Voltage drop ABNORMAL (>0.5V). Ada tahanan tinggi.', 'err'];
            if (value > 0.35) return ['Voltage drop agak tinggi (0.35–0.5V).', 'warn'];
            return ['Voltage drop normal.', 'ok'];
        }
        if (mode === 'A') {
            if (value >= 1) return ['Arus DC terukur.', 'ok'];
            return ['Tidak ada arus pada jalur probe. Periksa posisi probe (clamp).', 'warn'];
        }
        return ['', 'ok'];
    }

    function computeReading(recomputeProbes) {
        const red = S.probes.red;
        const black = S.probes.black;
        if (!red && !black) {
            return { mode: S.mode, unit: MODES[S.mode].unit, value: null, ol: true, text: 'OL', level: 0, ok: false, red: null, black: null, safety: false };
        }
        const both = !!(red && black);
        const value = both ? getExpectedValue(S.mode, red, black) : null;
        const feedback = both ? assessReading(S.mode, value, red, black) : [null, 'ok'];
        return {
            mode: S.mode,
            unit: MODES[S.mode].unit,
            value: value,
            ol: value === null || value === undefined,
            text: both ? formatValue(S.mode, value) : '—',
            level: both ? barLevel(S.mode, value) : 0,
            ok: both && value !== null && (S.mode !== 'CONT' || value <= 10),
            feedback: feedback[0],
            verdict: feedback[1],
            red: red,
            black: black,
            safety: modeRequiresDeadCircuit() && systemEnergized(),
        };
    }

    /* ============================================================
       PROBE + POINT CLICK
       ============================================================ */
    function selectProbe(color) {
        if (color !== 'red' && color !== 'black') color = 'red';
        S.selectedProbe = color;
        renderProbesUI();
    }

    function attachProbe(probe, node) {
        if (!NODES[node]) return false;
        S.probes[probe] = node;
        // Setelah RED dipasang, lanjutkan ke BLACK (urutan pengukuran umum).
        if (probe === 'red' && !S.probes.black) S.selectedProbe = 'black';
        else if (probe === 'black') S.selectedProbe = 'red';
        renderProbesUI();
        refreshReading();
        logEvent('Probe ' + probe.toUpperCase() + ' → ' + NODES[node].label);
        return true;
    }

    function handlePoint(nodeName) {
        if (!labVisible()) return;
        const node = String(nodeName || '');
        if (!NODES[node]) return;
        if (S.probes[S.selectedProbe] === node) {
            S.probes[S.selectedProbe] = null; // lepas
        } else {
            S.probes[S.selectedProbe] = node;
            if (S.selectedProbe === 'red' && !S.probes.black) S.selectedProbe = 'black';
            else if (S.selectedProbe === 'black') S.selectedProbe = 'red';
        }
        renderProbesUI();
        refreshReading();
    }

    function labVisible() { return S.labOpen; }

    /* ============================================================
       MEASURE (snapshot -> history / worksheet / records)
       ============================================================ */
    function measure() {
        if (!S.probes.red || !S.probes.black) {
            setFeedback('Pasang kedua probe dulu (RED dan COM).', 'warn');
            return null;
        }

        // Keselamatan: OHM / CONTINUITY pada sistem berenergi -> blokir
        if (modeRequiresDeadCircuit() && systemEnergized()) {
            S.safetyBlocked = true;
            S.safetyPendingMode = S.mode;
            S.safetyStrikes += 1;
            setFeedback('⚠ SISTEM BERENERGI! Matikan sumber listrik sebelum pengukuran Ω/CONTINUITY.', 'err');
            showSafetyModal('Sirkuit masih bertegangan. Matikan sistem (ignition OFF) dulu sebelum mengukur resistansi.');
            logEvent('SAFETY: pengukuran Ω diblokir saat sistem berenergi');
            return null;
        }
        S.safetyBlocked = false;
        S.safetyPendingMode = null;

        const reading = computeReading(true);
        const mode = S.mode;
        const now = Sim.simTimeMs || (window.Phase2 && window.Phase2._P2 ? window.Phase2._P2.simTime : 0);

        const entry = {
            test: practiceName() || MODES[mode].label,
            mode: mode,
            redProbe: S.probes.red,
            blackProbe: S.probes.black,
            value: reading.value,
            ol: reading.ol,
            unit: MODES[mode].unit,
            raw: reading.text,
            ok: reading.ok,
            feedback: reading.feedback,
            timestamp: now,
        };

        S.history.unshift(entry);
        if (S.history.length > 50) S.history.pop();

        // Worksheet (auto-add; user bisa clear)
        S.worksheet.push(entry);

        // Record untuk Phase 4 (diagnosis) — struktur tetap
        S.records.push({
            test: entry.test,
            redProbe: entry.redProbe,
            blackProbe: entry.blackProbe,
            value: entry.value,
            unit: entry.unit,
            timestamp: now,
            systemState: Phase2.getSystemState(),
            activeFaults: (Sim.activeFaults || []).slice(),
            ol: !!entry.ol,
        });
        if (S.records.length > 200) S.records.shift();

        // Skor
        S.stats.measurement += 1;
        S.stats.safety += (modeRequiresDeadCircuit() && !systemEnergized()) ? 1 : 1;
        S.stats.accuracy += (reading.ok || (mode !== 'CONT')) ? 1 : 0;

        if (S.sound && mode === 'CONT' && reading.ok) beep();

        setFeedback(reading.feedback || 'Terekam.', reading.verdict || 'ok');
        S.reading = reading;
        logEvent('Ukur ' + entry.test + ': ' + entry.raw + ' (' + entry.redProbe + '→' + entry.blackProbe + ')');

        render();
        checkPractice(entry);

        return entry;
    }

    function practiceName() {
        const idx = S.practiceIndex;
        if (idx >= 0 && PRACTICES[idx] && PRACTICES[idx].title) return PRACTICES[idx].title;
        return null;
    }

    /* ============================================================
       PRAKTIK TERBIMBING
       ============================================================ */
    function practiceConditionMet(p) {
        if (p.system === 'OFF') return Sim.ignitionState === 'OFF';
        if (p.system === 'ON') return Sim.ignitionState === 'ON';
        if (p.system === 'CRANKING') return Sim.starterState === 'CRANKING';
        return true;
    }

    function practiceValueOk(p, value) {
        if (value === null || value === undefined) return false;
        if (p.mode === 'CONT') return value <= p.max;
        return value >= p.min && value <= p.max;
    }

    function checkPractice(entry) {
        const idx = S.practiceIndex;
        if (idx < 0 || !PRACTICES[idx] || S.freeMode) return;

        const p = PRACTICES[idx];
        const modeOk = entry.mode === p.mode;
        const redOk = entry.redProbe === p.red;
        const blackOk = entry.blackProbe === p.black;
        const systemOk = practiceConditionMet(p);
        const valueOk = practiceValueOk(p, entry.value);

        // Update prosedur: langkah yang sudah benar
        let steps = 0;
        if (modeOk) steps += 1;
        if (redOk && blackOk) steps += 1;
        if (systemOk) steps += 1;
        if (valueOk) steps += 1;

        if (S.stats && S.stats.procedure < (S.practiceIndex + 1) * 4) {
            S.stats.procedure = Math.max(S.stats.procedure, (idx * 4) + steps);
        }

        if (modeOk && redOk && blackOk && systemOk && valueOk) {
            if (S.completedPractices.indexOf(p.id) < 0) S.completedPractices.push(p.id);
            S.stats.procedure += 4;
            S.stats.accuracy += 1;
            setFeedback('✔ Praktik "' + p.title + '" selesai!', 'ok');
            logEvent('Praktik selesai: ' + p.title);
            // lanjut otomatis ke praktik berikutnya
            if (idx < PRACTICES.length - 1) {
                S.practiceIndex = idx + 1;
            } else {
                S.practiceIndex = -1;
            }
            renderPractice();
        } else {
            if (!modeOk) setFeedback('Gunakan mode ' + p.mode + ' untuk praktik ini.', 'warn');
            else if (!(redOk && blackOk)) setFeedback('Pasang probe: RED = ' + (NODES[p.red] || p.red) + ', COM = ' + (NODES[p.black] || p.black) + '.', 'warn');
            else if (!systemOk) setFeedback('Setelah setting sistem: ' + p.system + '. ' + p.hint, 'warn');
            else if (!valueOk) setFeedback('Nilai di luar rentang target (' + p.min + '–' + p.max + ' ' + p.unit + '). ' + p.hint, 'warn');
        }
    }

    function startPractice(i) {
        if (i < 0 || i >= PRACTICES.length) return false;
        S.practiceIndex = i;
        S.freeMode = false;
        S.probes = { red: null, black: null };
        S.selectedProbe = 'red';
        renderPractice();
        renderProbesUI();
        setFeedback('Praktik: ' + PRACTICES[i].title + '. ' + PRACTICES[i].hint, 'ok');
        return true;
    }

    function nextPractice() {
        if (S.practiceIndex >= 0 && S.practiceIndex < PRACTICES.length - 1) {
            startPractice(S.practiceIndex + 1);
        } else {
            startPractice(0);
        }
    }

    function toggleFree() {
        S.freeMode = !S.freeMode;
        if (S.freeMode) { S.practiceIndex = -1; }
        renderPractice();
        setFeedback(S.freeMode ? 'FREE MODE: pengukuran bebas tanpa kunci langkah.' : 'Mode terbimbing aktif.', S.freeMode ? 'ok' : 'ok');
        return S.freeMode;
    }

    function setModeAndRender() {
        if (S.practiceIndex >= 0 && !S.freeMode && S.practiceIndex < PRACTICES.length - 1) {
            S.practiceIndex += 1;
        } else {
            S.practiceIndex = -1;
        }
        S.probes = { red: null, black: null };
        S.selectedProbe = 'red';
        renderPractice();
        renderProbesUI();
    }

    /* ============================================================
       MODE / OPSI
       ============================================================ */
    function setMode(m) {
        if (!MODES[m]) return false;
        S.mode = m;
        render();
        return true;
    }

    function toggleSound(on) { S.sound = !!on; return S.sound; }
    function setAutoRange(on) { S.autoRange = !!on; return S.autoRange; }

    function beep() {
        try {
            const ACtx = window.AudioContext || window.webkitAudioContext;
            if (typeof ACtx !== 'function') return;
            const ctx = new ACtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = 880;
            osc.type = 'square';
            gain.gain.value = 0.08;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.12);
        } catch (e) { /* audio tidak tersedia */ }
    }

    /* ============================================================
       LIVE PULSE (pembaruan tampilan saat lab terbuka)
       ============================================================ */
    function startPulse() {
        stopPulse();
        try {
            S.pulseId = setInterval(refreshReading, 200);
            if (S.pulseId && S.pulseId.unref) S.pulseId.unref();
        } catch (e) { S.pulseId = 0; }
    }
    function stopPulse() {
        if (S.pulseId) {
            try { clearInterval(S.pulseId); } catch (e) { }
            S.pulseId = 0;
        }
    }

    /* ============================================================
       READING REFRESH (live display, tanpa menyimpan history)
       ============================================================ */
    function refreshReading() {
        S.reading = computeReading(false);
        renderReading();
    }

    /* ============================================================
       KESELAMATAN MODAL
       ============================================================ */
    function showSafetyModal(msg) {
        const m = $('p3-safetyMsg');
        if (m) m.textContent = msg;
        const modal = $('p3-safetyModal');
        if (modal) modal.style.display = 'flex';
    }
    function hideSafetyModal() {
        const modal = $('p3-safetyModal');
        if (modal) modal.style.display = 'none';
    }
    function confirmSafety() {
        resetSimulation(); // matikan sistem (phase1)
        hideSafetyModal();
        const pending = S.safetyPendingMode;
        if (pending) {
            S.safetyBlocked = false;
            S.safetyPendingMode = null;
            S.mode = pending;
            setFeedback('Sistem dimatikan. Pengukuran dapat dilanjutkan.', 'ok');
            logEvent('SAFETY: sistem dimatikan, pengukuran dilanjutkan');
            measure();
        }
    }
    function cancelSafety() {
        hideSafetyModal();
        S.safetyBlocked = true;
        setFeedback('Batal. Matikan sistem (ignition OFF) sebelum Ω/CONTINUITY.', 'err');
    }
    function isSafetyBlocked() { return S.safetyBlocked; }

    /* ============================================================
       LAB OPEN / CLOSE / RESET
       ============================================================ */
    function toggleLab() {
        if (!S.labOpen) return openLab();
        return closeLab();
    }

    function openLab() {
        S.labOpen = true;
        const lab = $('p3-lab');
        if (lab) lab.style.display = 'block';
        const pts = document.querySelector('.p3-measure-points');
        if (pts) pts.style.display = 'block';
        if (document.body && document.body.classList) document.body.classList.add('p3-lab-open');
        buildNodeList();
        hookSVGDots();
        render();
        startPulse();
        logEvent('Virtual Multimeter Lab dibuka');
        return true;
    }

    function closeLab() {
        S.labOpen = false;
        const lab = $('p3-lab');
        if (lab) lab.style.display = 'none';
        const pts = document.querySelector('.p3-measure-points');
        if (pts) pts.style.display = 'none';
        if (document.body && document.body.classList) document.body.classList.remove('p3-lab-open');
        stopPulse();
        return false;
    }

    function resetMultimeter() {
        S.probes = { red: null, black: null };
        S.selectedProbe = 'red';
        S.history = [];
        S.worksheet = [];
        S.records = [];
        S.reading = null;
        S.safetyBlocked = false;
        S.safetyPendingMode = null;
        S.practiceIndex = -1;
        S.completedPractices = [];
        S.stats = { procedure: 0, measurement: 0, accuracy: 0, safety: 0 };
        S.safetyStrikes = 0;
        render();
        setFeedback('Multimeter di-reset. Mode V DC.', 'ok');
        logEvent('Multimeter di-reset');
    }

    /* ============================================================
       WORKSHEET
       ============================================================ */
    function clearWorksheet() {
        S.worksheet = [];
        renderWorksheet();
        setFeedback('Worksheet dikosongkan.', 'ok');
    }

    function exportWorksheet() {
        if (!S.worksheet.length) {
            setFeedback('Worksheet kosong — belum ada data untuk diekspor.', 'warn');
            logEvent('EXPORT ditolak: worksheet kosong');
            return false;
        }
        let csv = 'test,mode,red_probe,black_probe,value,unit,raw,ok,timestamp_ms\n';
        for (let i = 0; i < S.worksheet.length; i++) {
            const r = S.worksheet[i];
            csv += [r.test, r.mode, r.redProbe, r.blackProbe, (r.ol ? 'OL' : r.value), r.unit, r.raw, r.ok ? 'OK' : '', r.timestamp]
                .join(',') + '\n';
        }
        const filename = 'worksheet-multimeter.csv';
        try {
            if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                if (document.body && document.body.appendChild) document.body.appendChild(a);
                a.click();
                if (a.remove) a.remove();
            } else {
                console.log('Worksheet CSV export:', filename);
            }
        } catch (e) {
            console.log('Worksheet CSV export (fallback):', filename);
        }
        logEvent('Worksheet diekspor (' + S.worksheet.length + ' baris) CSV');
        return true;
    }

    function clearHistory() {
        S.history = [];
        renderHistory();
        setFeedback('Riwayat pengukuran dikosongkan.', 'ok');
    }

    /* ============================================================
       INFRA: node list + SVG dots + lines
       ============================================================ */
    function buildNodeList() {
        const host = $('p3-nodeList');
        if (!host) return;
        let html = '';
        Object.keys(NODES).forEach(name => {
            html += '<button class="mp-btn" type="button" data-node="' + name + '">' + NODES[name].label + '</button>';
        });
        host.innerHTML = html;
        const btns = host.querySelectorAll ? host.querySelectorAll('.mp-btn') : [];
        for (let i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', () => handlePoint(btns[i].getAttribute('data-node') || btns[i].dataset.node));
        }
    }

    function hookSVGDots() {
        if (!document.querySelectorAll) return;
        const dots = document.querySelectorAll('.p3-measure-points .mp-dot');
        for (let i = 0; i < dots.length; i++) {
            const d = dots[i];
            if (d._hooked) continue;
            d._hooked = true;
            d.addEventListener('click', () => {
                const nm = d.dataset.mp || d.getAttribute('data-mp');
                handlePoint(nm);
            });
        }
    }

    function nodeCoords(name, dotEl) {
        if (dotEl) {
            const cx = dotEl.getAttribute && dotEl.getAttribute('cx');
            const cy = dotEl.getAttribute && dotEl.getAttribute('cy');
            if (cx !== null && cx !== undefined && cx !== '' && cy !== null && cy !== undefined && cy !== '') {
                return { x: parseFloat(cx), y: parseFloat(cy) };
            }
        }
        const n = NODES[name];
        return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
    }

    function renderProbeLines() {
        const redLine = $('p3-redLine');
        const blackLine = $('p3-blackLine');
        const red = S.probes.red;
        const black = S.probes.black;
        const redDot = red ? findDot(red) : null;
        const blackDot = black ? findDot(black) : null;

        if (redLine && red) {
            const c = nodeCoords(red, redDot);
            redLine.setAttribute('x1', '900');
            redLine.setAttribute('y1', '40');
            redLine.setAttribute('x2', c.x);
            redLine.setAttribute('y2', c.y);
            redLine.style.display = 'block';
        } else if (redLine) {
            redLine.style.display = 'none';
        }
        if (blackLine && black) {
            const c = nodeCoords(black, blackDot);
            blackLine.setAttribute('x1', '900');
            blackLine.setAttribute('y1', '70');
            blackLine.setAttribute('x2', c.x);
            blackLine.setAttribute('y2', c.y);
            blackLine.style.display = 'block';
        } else if (blackLine) {
            blackLine.style.display = 'none';
        }
    }

    function findDot(name) {
        if (!document.querySelectorAll) return null;
        const dots = document.querySelectorAll('.p3-measure-points .mp-dot');
        for (let i = 0; i < dots.length; i++) {
            const d = dots[i];
            if ((d.dataset.mp || d.getAttribute('data-mp')) === name) return d;
        }
        return null;
    }

    function renderPointClasses() {
        if (!document.querySelectorAll) return;
        const dots = document.querySelectorAll('.p3-measure-points .mp-dot');
        for (let i = 0; i < dots.length; i++) {
            const d = dots[i];
            const nm = d.dataset.mp || d.getAttribute('data-mp');
            const has = d.classList && d.classList.contains;
            if (!has) continue;
            d.classList.toggle('attached-red', S.probes.red === nm);
            d.classList.toggle('attached-black', S.probes.black === nm);
        }
    }

    /* ============================================================
       RENDER
       ============================================================ */
    function render() {
        renderReading();
        renderProbesUI();
        renderProbeLines();
        renderPointClasses();
        renderResetBtn();
    }

    function renderReading() {
        const disp = $('p3-mm-reading');
        const unit = $('p3-mm-unit');
        const bar = $('p3-mm-bar');
        const r = S.reading;
        if (disp) disp.textContent = r && r.text ? r.text : '0.00';
        if (unit) unit.textContent = (r && r.unit) ? r.unit : MODES[S.mode].unit;
        if (bar) {
            bar.className = 'p3-mm-bar';
            const lvl = Math.round((r ? r.level : 0) * 100);
            if (bar.style && bar.style.setProperty) bar.style.setProperty('--lvl', lvl + '%');
            if (r && r.verdict === 'err') bar.classList.add('warn');
        }
    }

    function renderProbesUI() {
        updateProbeBtn('p3-redNode', 'red');
        updateProbeBtn('p3-blackNode', 'black');
        const redPick = $('p3-redPick');
        const blackPick = $('p3-blackPick');
        const setSel = (el, sel) => { if (el && el.classList && el.classList.toggle) el.classList.toggle('selected', sel); };
        setSel(redPick, S.selectedProbe === 'red');
        setSel(blackPick, S.selectedProbe === 'black');
    }

    function updateProbeBtn(nodeId, color) {
        const el = $(nodeId);
        if (!el) return;
        const node = S.probes[color];
        el.textContent = node ? (NODES[node] ? NODES[node].label : node) : '—';
    }

    function renderResetBtn() {
        const btn = $('p3-multi-btn');
        if (btn) { const lbl = (btn.querySelector && btn.querySelector('span')) || btn; lbl.textContent = S.labOpen ? 'MULTI ◀' : 'MULTI'; }
    }

    function renderHistory() {
        setList('p3-historyBody', S.history);
    }

    function setList(hostId, list) {
        const host = $(hostId);
        if (!host) return;
        if (!list || !list.length) {
            host.innerHTML = '<div class="hist-row">— belum ada pengukuran —</div>';
            return;
        }
        let html = '';
        for (let i = 0; i < list.length; i++) {
            const r = list[i];
            const stamp = Math.round(r.timestamp / 1000) + 's';
            html += '<div class="hist-row"><span>' + escapeHtml(r.test) + ' · ' + escapeHtml(r.raw) + '</span><span class="hist-when">' + stamp + '</span></div>';
        }
        host.innerHTML = html;
    }

    function renderWorksheet() {
        const host = $('p3-worksheetBody');
        if (!host) return;
        if (!S.worksheet.length) {
            host.innerHTML = '<div class="hist-row">— worksheet kosong —</div>';
            return;
        }
        let html = '<table class="worksheet-table"><thead><tr><th>Test</th><th>Probe R→B</th><th>Nilai</th><th>Waktu</th></tr></thead><tbody>';
        for (let i = 0; i < S.worksheet.length; i++) {
            const r = S.worksheet[i];
            html += '<tr><td>' + escapeHtml(r.test) + '</td><td>' + escapeHtml((r.redProbe || '') + ' → ' + (r.blackProbe || '')) + '</td>'
                + '<td>' + escapeHtml(r.raw) + '</td><td>' + Math.round(r.timestamp / 1000) + 's</td></tr>';
        }
        html += '</tbody></table>';
        host.innerHTML = html;
    }

    function renderPractice() {
        const host = $('p3-practiceList');
        const guided = $('p3-guided');
        if (host) {
            let html = '';
            for (let i = 0; i < PRACTICES.length; i++) {
                const p = PRACTICES[i];
                const done = S.completedPractices.indexOf(p.id) >= 0;
                const active = !S.freeMode && S.practiceIndex === i;
                html += '<button class="mp-btn' + (active ? ' attached' : '') + '" type="button" onclick="window.Phase3&&window.Phase3.startPractice(' + i + ')">'
                    + (done ? '✔ ' : '') + 'P' + (i + 1) + ' ' + p.title + '</button>';
            }
            host.innerHTML = html;
        }
        if (guided) {
            if (S.freeMode) { guided.innerHTML = '<div class="p3-guided-item">FREE MODE — pengukuran bebas.</div>'; return; }
            if (S.practiceIndex < 0) {
                guided.innerHTML = '<div class="p3-guided-item">Pilih praktik terbimbing di atas (P1–P8).</div>';
                return;
            }
            const p = PRACTICES[S.practiceIndex];
            guided.innerHTML = '<div class="p3-guided-item">'
                + '<strong>P' + (S.practiceIndex + 1) + ' · ' + p.title + '</strong><br>'
                + '<span>' + p.hint + '</span><br>'
                + '<em>Mode ' + p.mode + ' · RED→' + (NODES[p.red] ? NODES[p.red].label : p.red)
                + ' · COM→' + (NODES[p.black] ? NODES[p.black].label : p.black) + '</em>'
                + '</div>';
        }
    }

    function setFeedback(text, type) {
        const el = $('p3-feedback');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'p3-mm-feedback' + (type ? ' ' + type : '');
    }

    /* ============================================================
       LOG / HELPERS
       ============================================================ */
    function logEvent(msg) {
        if (window.Phase2 && typeof window.Phase2.logEvent === 'function') window.Phase2.logEvent(msg);
    }
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /* ============================================================
       SCORE API
       ============================================================ */
    function getScore() {
        const cap = (v) => clamp(Math.round(v), 0, 25);
        return {
            procedure: cap(S.stats.procedure),
            measurement: cap(S.stats.measurement * 5),
            accuracy: cap(S.stats.accuracy * 5),
            safety: cap(Math.max(0, 25 - S.safetyStrikes * 8)),
        };
    }

    /* ============================================================
       NODE HELPERS (API eksternal)
       ============================================================ */
    function getNodeVoltage(nodeName) { return Phase2.getVoltageAtNode(nodeName); }
    function getNodeState(nodeName) {
        const v = Phase2.getVoltageAtNode(nodeName);
        return { name: nodeName, voltage: v, energized: v > 0.5 };
    }
    function getMeasurementResult(test, redProbe, blackProbe) {
        const value = redProbe && blackProbe ? getExpectedValue(S.mode, redProbe, blackProbe) : null;
        return {
            test: test || 'MANUAL',
            mode: S.mode,
            redProbe: redProbe,
            blackProbe: blackProbe,
            value: value,
            ol: value === null,
            unit: MODES[S.mode].unit,
            text: redProbe && blackProbe ? formatValue(S.mode, value) : '—',
            ok: value !== null && (S.mode !== 'CONT' || value <= 10),
        };
    }

    /* ============================================================
       INIT + EXPORT
       ============================================================ */
    function init() {
        buildNodeList();
        hookSVGDots();
        render();
        setFeedback('Virtual Multimeter siap. Mode V DC.', 'ok');
        logEvent('Virtual Multimeter Lab (Phase 3) siap');
    }

    // Render ulang saat simulasi berubah (dipanggil setiap siklus lab terbuka)
    window.Phase3 = {
        // API utama
        active: true,
        setMode: setMode,
        selectProbe: selectProbe,
        attachProbe: attachProbe,
        measure: measure,
        getReading: () => S.reading,
        getNodeVoltage: getNodeVoltage,
        getNodeState: getNodeState,
        getExpectedValue: getExpectedValue,
        getMeasurementResult: getMeasurementResult,
        // lab
        toggleLab: toggleLab,
        openLab: openLab,
        closeLab: closeLab,
        resetMultimeter: resetMultimeter,
        // keselamatan
        isSafetyBlocked: isSafetyBlocked,
        confirmSafety: confirmSafety,
        cancelSafety: cancelSafety,
        // riwayat / worksheet
        clearHistory: clearHistory,
        clearWorksheet: clearWorksheet,
        exportWorksheet: exportWorksheet,
        getHistory: () => S.history.slice(),
        getWorksheet: () => S.worksheet.slice(),
        getRecords: () => S.records.slice(),
        // praktik & skor
        startPractice: startPractice,
        nextPractice: nextPractice,
        toggleFree: toggleFree,
        getPractices: () => PRACTICES.map((p, i) => ({ index: i, id: p.id, title: p.title, mode: p.mode, done: S.completedPractices.indexOf(p.id) >= 0 })),
        activePracticeIndex: () => S.practiceIndex,
        score: getScore,
        getScores: getScore,
        // opsi
        toggleSound: toggleSound,
        setAutoRange: setAutoRange,
        // state/test helpers
        state: () => S,
    };

    if (document.addEventListener) {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();