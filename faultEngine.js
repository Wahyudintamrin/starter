/* ============================================================
   PHASE 7 — ADVANCED FAULT ENGINE CORE (STEP 2–8)
   ------------------------------------------------------------
   Multi-Fault / Severity / Intermittent / Progressive / Interaction
   (STEP 2–6) + Symptom Engine v2 (STEP 7) + Hypothesis Engine
   (STEP 8) + Evidence Engine (STEP 9) + Scenario Engine (STEP 10)
   + Vehicle Profile (STEP 11) yang diperbesar DI ATAS arsitektur
   Phase 1–6, tanpa membangun simulation engine kedua (§78).

   Prinsip:
   - SATU central state: membaca/menulis field Sim.* yang sama
     dengan Phase 1–6 (batteryVoltage, groundCondition,
     terminalResistance, cableResistanceMult, relayFaultType,
     solenoidMainFail, starterMotorFault, dan dua modulator
     kontinu baru: Sim.groundResistanceMult & Sim.starterEfficiency).
   - Hidden fault protection (§52–53): scenario fault TIDAK ditulis ke daftar
     fault publik milik Phase 4 (diuji via regex bahwa cuplikan ini TIDAK
     memuat nama field fault publik itu).
   - DILARANG random() bawaan untuk nilai simulasi/measurement (§44) — diuji
     (regex) bahwa cuplikan ini TIDAK memanggilnya. Randomness HANYA pada
     intermittency RANDOM_SEEDED & scenario generation, keduanya via seeded
     PRNG (deterministik, §43).
   - Satu auto-loop (setInterval) paling banyak satu (§65).

   Load: setelah app.js (membutuhkan Sim sebagai global lexical).
   ============================================================ */
(function (root) {
    'use strict';

    var VERSION = 7;

    /* ---------------- helpers ---------------- */
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }
    function roundTo(v, p) { var m = Math.pow(10, p); return Math.round(v * m) / m; }

    /* ---------------- seeded PRNG (mulberry32) ---------------- */
    function makeSeeded(seed) {
        var s = (seed >>> 0) || 1;
        return function () {
            s = (s + 0x6D2B79F5) | 0;
            var t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /* ---------------- configurable parameters (§63) ----------------
       Nilai adalah parameter pembelajaran simulasi, BUKAN spesifikasi
       universal kendaraan (§64). Bisa dioverride via window.PHASE7_CONFIG.
    */
    var DEFAULT_CONFIG = {
        battery: {
            ocvGood: 12.6,           // V open-circuit baterai normal
            weakMin: 10.4,           // V saat weak battery severity 1
            deadFloor: 3.6,          // V mencapai lantai saat discharged severity 1
            ocvSlope: 9.0            // discharged: ocvGood - slope*severity
        },
        resistance: {
            terminalBase: 0.001,     // ohm dasar terminal longgar
            terminalPerS: 0.02,      // ohm per severity (max ~0.02)
            cableMultBase: 1,
            cableMultPerS: 4,        // pengembali cableResistanceMult max 5x
            groundMultPerS: 3,       // groundResistanceMult max 4x
            batteryResBase: 0.005,   // ohm (sama dengan CONFIG.battery.internalResistance)
            batteryResPerS: 0.004    // ohm peningkatan per severity
        },
        intermittent: {
            defaultActive: 1500,     // ms aktif
            defaultInactive: 3000,   // ms tidak aktif
            defaultTransitionProb: 0.2
        },
        progression: {
            defaultRate: 0.15,       // penambah severity per langkah
            defaultPer: 'attempt',
            maximumSeverity: 1.0
        },
        thresholds: {
            batteryWeakOn: 0.35,
            batteryDeadOn: 0.4,
            relayOn: 0.5,
            contactOn: 0.5,
            fuseOn: 0.6,
            cableOpenOn: 0.6,
            ignitionOn: 0.5,
            solenoidOn: 0.5,
            motorOn: 0.5,
            terminalLooseOn: 0.8
        },
        interactions: {
            minSeverity: 0.001,        // interaksi aktif hanya jika severity gabungan > ini
            inrushFactor: 0.8,         // weak battery + poor ground -> arus puncak
            cableStackFactor: 1.5,     // weak battery + cable -> tambahan cableResistanceMult
            terminalStack: 0.01        // loose terminal + relay -> tambahan terminalResistance (ohm)
        },
        symptoms: {
            ocvGood: 12.6,             // V acuan baterai normal (untuk skala gejala)
            ocvWeakFloor: 10.4,        // V dasar weak battery (severity 1)
            dropBaseline: 0.15,        // V voltage drop di atas ini mulai terhitung sebagai gejala
            dropScale: 1.4,            // (drop - baseline) / scale -> severity 0..1
            inrushBaseline: 185,       // A di atas arus normal mulai jadi inrush
            inrushScaleMax: 600,       // A cap severity 1
            crankNominal: 220,         // RPM nominal cranking
            batteryFactorFloor: 0.2    // batas bawaan faktor baterai (sama dgn app)
        },
        hypothesis: {
            likelyThreshold: 0.6,      // p >= ini -> LIKELY
            unlikelyThreshold: 0.22,   // p <= ini -> UNLIKELY
            confirmThreshold: 0.75,    // p >= ini + bukti mendukung -> CONFIRMED
            symptomSeverityWeight: 0.7,// bobot severity dlm skor hipotesis
            symptomConfidenceWeight: 0.3 // bobot confidence dlm skor hipotesis
        },
        tests: {
            ocvNormal: 12.4,           // V OCV di atas ini = normal
            ocvWeak: 12.0,             // V OCV di bawah ini = lemah pada uji OCV
            crankSevereFloor: 9.5,     // V cranking di bawah ini = parah
            crankNormalFloor: 10.5,    // V cranking di atas ini = normal
            dropLimit: 0.5,            // V voltage drop di atas ini = berlebih
            currentInrushMult: 1.35,   // arus > x normal = inrush
            currentDeadFloor: 40       // A di bawah ini saat cranking = motor tak menarik arus
        },
        scenario: {
            difficultyWeights: [0.4, 0.35, 0.25], // BEGINNER, INTERMEDIATE, ADVANCED
            environmentPool: ['NORMAL', 'COLD', 'HOT']
        }
    };

    /* ---------------- vehicle profiles (§14/§15, §63/§64) ----------------
       Tidak mengasumsikan semua kendaraan sama. Setiap profil memetakan
       karakteristik kendaraan ke node config yang dipakai symptom/tests/battery
       (semua tetap lewat CENTRAL engine yang sama). Nilai adalah parameter
       pembelajaran simulasi, BUKAN spesifikasi universal kendaraan.
    */
    var VEHICLE_PROFILES = [
        {
            id: 'TRAINER_A', label: 'Trainer A — Standard Trainer',
            battery: { nominalVoltage: 12, goodVoltage: 12.6 },
            starter: { baseRPM: 220, baseCurrent: 185, currentRange: [150, 250], gearRatio: 10 },
            electricalArchitecture: {
                relayPresent: true, solenoidControlType: 'RELAY_CONTROLLED',
                ignitionControl: 'KEY', groundArchitecture: 'FRAME_RETURN'
            },
            diagnosticThresholds: { batteryWeakOn: 0.35, contactOn: 0.5, motorOn: 0.5, solenoidOn: 0.5, fuseOn: 0.6 },
            configOverrides: {
                battery: { ocvGood: 12.6, weakMin: 10.4, deadFloor: 3.6, ocvSlope: 9.0 },
                symptoms: { ocvGood: 12.6, ocvWeakFloor: 10.4, inrushBaseline: 185, crankNominal: 220 },
                tests: { ocvNormal: 12.4, ocvWeak: 12.0, crankSevereFloor: 9.5, crankNormalFloor: 10.5,
                    dropLimit: 0.5, currentInrushMult: 1.35, currentDeadFloor: 40 }
            },
            caveats: 'Nilai parameter pembelajaran simulasi, BUKAN spesifikasi universal kendaraan.'
        },
        {
            id: 'TRAINER_B', label: 'Trainer B — Compact Utility',
            battery: { nominalVoltage: 12, goodVoltage: 12.4 },
            starter: { baseRPM: 230, baseCurrent: 150, currentRange: [120, 200], gearRatio: 11 },
            electricalArchitecture: {
                relayPresent: false, solenoidControlType: 'DIRECT_KEY',
                ignitionControl: 'KEY', groundArchitecture: 'BODY_RETURN'
            },
            diagnosticThresholds: { batteryWeakOn: 0.4, contactOn: 0.5, motorOn: 0.55, solenoidOn: 0.5, fuseOn: 0.6 },
            configOverrides: {
                battery: { ocvGood: 12.4, weakMin: 10.2, deadFloor: 3.8, ocvSlope: 8.6 },
                symptoms: { ocvGood: 12.4, ocvWeakFloor: 10.2, inrushBaseline: 150, crankNominal: 230 },
                tests: { ocvNormal: 12.2, ocvWeak: 11.8, crankSevereFloor: 9.0, crankNormalFloor: 10.2,
                    dropLimit: 0.6, currentInrushMult: 1.4, currentDeadFloor: 35 }
            },
            caveats: 'Nilai parameter pembelajaran simulasi, BUKAN spesifikasi universal kendaraan.'
        },
        {
            id: 'TRAINER_C', label: 'Trainer C — Heavy-Duty Cold Climate',
            battery: { nominalVoltage: 12, goodVoltage: 12.9 },
            starter: { baseRPM: 260, baseCurrent: 240, currentRange: [200, 320], gearRatio: 9 },
            electricalArchitecture: {
                relayPresent: true, solenoidControlType: 'RELAY_CONTROLLED',
                ignitionControl: 'KEY', groundArchitecture: 'FRAME_RETURN'
            },
            diagnosticThresholds: { batteryWeakOn: 0.3, contactOn: 0.45, motorOn: 0.5, solenoidOn: 0.5, fuseOn: 0.6 },
            configOverrides: {
                battery: { ocvGood: 12.9, weakMin: 10.8, deadFloor: 4.0, ocvSlope: 8.9 },
                symptoms: { ocvGood: 12.9, ocvWeakFloor: 10.8, inrushBaseline: 240, crankNominal: 260 },
                tests: { ocvNormal: 12.6, ocvWeak: 12.3, crankSevereFloor: 10.0, crankNormalFloor: 11.0,
                    dropLimit: 0.6, currentInrushMult: 1.3, currentDeadFloor: 50 }
            },
            caveats: 'Nilai parameter pembelajaran simulasi, BUKAN spesifikasi universal kendaraan.'
        }
    ];

    function findProfile(id) {
        for (var i = 0; i < VEHICLE_PROFILES.length; i++) {
            if (VEHICLE_PROFILES[i].id === id) return VEHICLE_PROFILES[i];
        }
        return null;
    }
    function activeProfileOverrides() {
        var p = findProfile(engine.vehicleProfileId);
        return p ? p.configOverrides : null;
    }
    function rebuildConfig() {
        var base = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        var ov = activeProfileOverrides();
        var merged = ov ? mergeDeep(base, ov) : base;
        merged = mergeDeep(merged, engine.userCustom || null);   // setConfig user menang atas default profil
        engine.config = merged;
        return engine.config;
    }
    function applyProfile(id, skipLayer) {
        var p = findProfile(id);
        if (!p) return { ok: false, error: 'UNKNOWN_PROFILE', id: id };
        engine.vehicleProfileId = id;
        rebuildConfig();
        if (engine.scenario) {
            engine.scenario.vehicleProfile = id;
            if (!skipLayer) applyLayer();
        }
        return { ok: true, id: id };
    }
    function getVehicleProfiles() {
        return VEHICLE_PROFILES.map(function (p) {
            return {
                id: p.id, label: p.label,
                battery: { nominalVoltage: p.battery.nominalVoltage, goodVoltage: p.battery.goodVoltage },
                starter: { baseRPM: p.starter.baseRPM, baseCurrent: p.starter.baseCurrent,
                    currentRange: p.starter.currentRange.slice(), gearRatio: p.starter.gearRatio },
                electricalArchitecture: (function () { var o = {}; for (var k in p.electricalArchitecture) if (Object.prototype.hasOwnProperty.call(p.electricalArchitecture, k)) o[k] = p.electricalArchitecture[k]; return o; })(),
                diagnosticThresholds: (function () { var o = {}; for (var k in p.diagnosticThresholds) if (Object.prototype.hasOwnProperty.call(p.diagnosticThresholds, k)) o[k] = p.diagnosticThresholds[k]; return o; })(),
                caveats: p.caveats
            };
        });
    }
    function getVehicleProfile(id) {
        var p = findProfile(id);
        return p ? getVehicleProfiles().filter(function (x) { return x.id === id; })[0] : null;
    }
    function setVehicleProfile(id) {
        return applyProfile(id, false);
    }
    function getActiveVehicleProfile() {
        var p = findProfile(engine.vehicleProfileId);
        return p ? { id: p.id, label: p.label, starterGearRatio: p.starter.gearRatio, caveats: p.caveats } : null;
    }

    /* ---------------- fault interaction definitions (§8) ----------------
       Fault -> Efek elektrikal -> Perilaku komponen -> Gejala sekunder -> Bukti.
       Pasangan fault yang hadir (enabled & windowActive) menghasilkan efek
       gabungan dan TIDAK mengganti efek primer tiap fault.
    */
    var INTERACTION_DEFS = [
        {
            id: 'INT_WEAK_GROUND',
            label: 'Weak Battery + Poor Ground',
            faults: ['FAULT_BATTERY_WEAK', 'FAULT_POOR_GROUND'],
            combine: 'amplify',
            secondarySymptoms: ['HIGH_INRUSH_CURRENT', 'LOW_ENGINE_CRANKING_SPEED'],
            diagnosticNotes: [
                'Tegangan cranking rendah SEMENTARA ground drop tinggi => dua penyebab: baterai lemah DAN ground buruk.'
            ],
            compute: function (states, sev, cfg) {
                return { starterCurrentMult: 1 + (cfg.interactions.inrushFactor || 0.8) * sev };
            }
        },
        {
            id: 'INT_BATTERY_CABLE',
            label: 'Weak Battery + High Positive Cable Resistance',
            faults: ['FAULT_BATTERY_WEAK', 'FAULT_HIGH_POSITIVE_RESISTANCE'],
            combine: 'sum',
            secondarySymptoms: ['HIGH_VOLTAGE_DROP_POSITIVE', 'LOW_CRANKING_VOLTAGE'],
            diagnosticNotes: [
                'Dua hambatan berantai memperbesar voltage drop sisi positif: baterai lemah + kabel positif resistif tinggi.'
            ],
            compute: function (states, sev, cfg) {
                var primaryMult = (states.FAULT_HIGH_POSITIVE_RESISTANCE ?
                    cfg.resistance.cableMultBase + cfg.resistance.cableMultPerS * states.FAULT_HIGH_POSITIVE_RESISTANCE.severity : 1);
                return { cableResistanceMult: primaryMult + (cfg.interactions.cableStackFactor || 1.5) * sev };
            }
        },
        {
            id: 'INT_MOTOR_GROUND_MASK',
            label: 'Starter Motor Failure + Poor Ground',
            faults: ['FAULT_STARTER_MOTOR', 'FAULT_POOR_GROUND'],
            combine: 'mask',
            secondarySymptoms: ['CLICK_OR_BUZZ_NO_CRANK'],
            diagnosticNotes: [
                'Motor starter sudah gagal total; bukti ground buruk tertutup (masked). Ukur resistansi ground saat daya mati.'
            ],
            compute: function () { return {}; }
        },
        {
            id: 'INT_LOOSE_RELAY',
            label: 'Loose Battery Terminal + Relay Failure',
            faults: ['FAULT_LOOSE_TERMINAL', 'FAULT_RELAY'],
            combine: 'amplify',
            secondarySymptoms: ['CONTACT_RESISTANCE_SIGNATURE'],
            diagnosticNotes: [
                'Dua titik kontak resistif (terminal baterai + kontak relay) saling menguatkan.'
            ],
            compute: function (states, sev, cfg) {
                var primary = (states.FAULT_LOOSE_TERMINAL ?
                    cfg.resistance.terminalBase + cfg.resistance.terminalPerS * states.FAULT_LOOSE_TERMINAL.severity : 0);
                return { terminalResistance: primary + (cfg.interactions.terminalStack || 0.01) * sev };
            }
        }
    ];

    /* ---------------- symptom matrix (§17) ----------------
       id -> label, category, derive (live dari Sim.*, tanpa menyentuh
       daftar fault publik), possibleCauses, measurements.
    */
    var SYMPTOM_DEFS = {
        SLOW_CRANK: {
            label: 'Cranking Lambat',
            category: 'crank',
            secondarySymptoms: ['LOW_ENGINE_CRANKING_SPEED'],
            measurements: ['RPM_TEST', 'BATTERY_LOAD_V', 'POSITIVE_DROP', 'GROUND_DROP'],
            possibleCauses: ['FAULT_BATTERY_WEAK', 'FAULT_POOR_GROUND', 'FAULT_HIGH_POSITIVE_RESISTANCE',
                'FAULT_STARTER_MOTOR', 'FAULT_MECHANICAL_STARTER', 'FAULT_LOOSE_TERMINAL'],
            derive: function (s, cfg) {
                if (s.starterState !== 'CRANKING') return null;
                var ocv = (cfg.symptoms.ocvGood != null ? cfg.symptoms.ocvGood : 12.6);
                var nom = (cfg.symptoms.crankNominal != null ? cfg.symptoms.crankNominal : 220);
                var bf = clamp((s.batteryVoltage || ocv) / ocv, (cfg.symptoms.batteryFactorFloor != null ? cfg.symptoms.batteryFactorFloor : 0.2), 1);
                var eff = s.starterEfficiency != null ? s.starterEfficiency : 1;
                var gm = s.groundCondition === 'POOR' ? Math.max(0.35, 1 - 0.2 * (s.groundResistanceMult || 1)) : 1;
                var tm = (s.looseTerminal && (s.terminalResistance || 0) > 0) ? 0.6 : 1;
                var target = nom * bf * eff * gm * tm;
                var obs = s.starterRPM != null ? s.starterRPM : 0;
                return { severity: clamp((target - obs) / (target || 1), 0, 1) };
            }
        },
        NO_CRANK: {
            label: 'Tidak Cranking',
            category: 'crank',
            secondarySymptoms: [],
            measurements: ['CONTINUITY_FUSE', 'CONTINUITY_CABLE', 'RELAY_COIL_TEST', 'MAIN_CONTACT_TEST'],
            possibleCauses: ['FAULT_BATTERY_DISCHARGED', 'FAULT_OPEN_CABLE', 'FAULT_OPEN_FUSE',
                'FAULT_IGNITION_SWITCH', 'FAULT_RELAY', 'FAULT_SOLENOID_CONTROL',
                'FAULT_SOLENOID_MAIN_CONTACT', 'FAULT_STARTER_MOTOR'],
            derive: function (s) {
                var hard = s.cableState === 'OPEN' || s.fuseState === 'OPEN' || s.starterMotorFault === true ||
                    s.solenoidFail === true || s.solenoidMainFail === true ||
                    s.relayFaultType === 'contactOpen' || s.ignitionFail === true ||
                    s.batteryCondition === 'DISCHARGED';
                return { severity: hard ? 1 : 0 };
            }
        },
        LOW_CRANKING_VOLTAGE: {
            label: 'Tegangan Cranking Rendah',
            category: 'electrical',
            secondarySymptoms: ['SLOW_CRANK'],
            measurements: ['BATTERY_V', 'STARTER_V', 'POSITIVE_DROP'],
            possibleCauses: ['FAULT_BATTERY_WEAK', 'FAULT_BATTERY_DISCHARGED',
                'FAULT_HIGH_POSITIVE_RESISTANCE', 'FAULT_LOOSE_TERMINAL', 'FAULT_OPEN_CABLE'],
            derive: function (s, cfg) {
                var ocv = (cfg.symptoms.ocvGood != null ? cfg.symptoms.ocvGood : 12.6);
                var floor = (cfg.symptoms.ocvWeakFloor != null ? cfg.symptoms.ocvWeakFloor : 10.4);
                return { severity: clamp((ocv - (s.batteryVoltage != null ? s.batteryVoltage : ocv)) / (ocv - floor), 0, 1) };
            }
        },
        HIGH_VOLTAGE_DROP_POSITIVE: {
            label: 'Drop Tegangan Sisi Positif Tinggi',
            category: 'electrical',
            secondarySymptoms: ['LOW_CRANKING_VOLTAGE'],
            measurements: ['POSITIVE_DROP', 'BATTERY_V', 'STARTER_V'],
            possibleCauses: ['FAULT_HIGH_POSITIVE_RESISTANCE', 'FAULT_LOOSE_TERMINAL', 'FAULT_OPEN_CABLE'],
            derive: function (s, cfg) {
                var base = (cfg.symptoms.dropBaseline != null ? cfg.symptoms.dropBaseline : 0.15);
                var scale = (cfg.symptoms.dropScale != null ? cfg.symptoms.dropScale : 1.4);
                return { severity: clamp(((s.voltageDropPositive || 0) - base) / scale, 0, 1) };
            }
        },
        GROUND_VOLTAGE_DROP: {
            label: 'Drop Tegangan Sisi Ground',
            category: 'electrical',
            secondarySymptoms: ['LOW_CRANKING_VOLTAGE'],
            measurements: ['GROUND_DROP', 'STARTER_V', 'BATTERY_V'],
            possibleCauses: ['FAULT_POOR_GROUND', 'FAULT_LOOSE_TERMINAL'],
            derive: function (s, cfg) {
                var base = (cfg.symptoms.dropBaseline != null ? cfg.symptoms.dropBaseline : 0.15);
                var scale = (cfg.symptoms.dropScale != null ? cfg.symptoms.dropScale : 1.4);
                return { severity: clamp(((s.voltageDropGround || 0) - base) / scale, 0, 1) };
            }
        },
        HIGH_INRUSH_CURRENT: {
            label: 'Arus Puncak Tinggi',
            category: 'electrical',
            secondarySymptoms: ['SLOW_CRANK'],
            measurements: ['CRANK_CURRENT', 'BATTERY_LOAD_V'],
            possibleCauses: ['FAULT_BATTERY_WEAK', 'FAULT_POOR_GROUND', 'FAULT_MECHANICAL_STARTER'],
            derive: function (s, cfg) {
                var base = (cfg.symptoms.inrushBaseline != null ? cfg.symptoms.inrushBaseline : 185);
                var cap = (cfg.symptoms.inrushScaleMax != null ? cfg.symptoms.inrushScaleMax : 600);
                var mult = s.starterCurrentMult != null ? s.starterCurrentMult : 1;
                var cur = (s.starterCurrent && s.starterCurrent > 0) ? s.starterCurrent : (mult > 1 ? base * mult : 0);
                return { severity: clamp((cur - base) / (cap - base), 0, 1) };
            }
        },
        INTERMITTENT_NO_CRANK: {
            label: 'Intermittent Tidak Cranking',
            category: 'crank',
            secondarySymptoms: ['NO_CRANK'],
            measurements: ['INTERMITTENT_TEST', 'CONTACT_RESISTANCE'],
            possibleCauses: ['FAULT_LOOSE_TERMINAL', 'FAULT_RELAY', 'FAULT_IGNITION_SWITCH', 'FAULT_SOLENOID_CONTROL'],
            derive: function (s) {
                var loose = (s.looseTerminal === true || (s.terminalResistance || 0) > 0.005);
                var relayIntermittent = s.relayFaultType === 'none' && s.relayFail === true;
                return { severity: (loose || relayIntermittent) ? 1 : 0 };
            }
        },
        CLICK_OR_BUZZ_NO_CRANK: {
            label: 'Klik/Berderu Tanpa Cranking',
            category: 'crank',
            secondarySymptoms: ['NO_CRANK'],
            measurements: ['RELAY_COIL_TEST', 'MAIN_CONTACT_TEST', 'SOLENOID_HOLD'],
            possibleCauses: ['FAULT_RELAY', 'FAULT_SOLENOID_CONTROL', 'FAULT_SOLENOID_MAIN_CONTACT', 'FAULT_STARTER_MOTOR'],
            derive: function (s) {
                var hard = s.relayFaultType === 'contactOpen' || s.solenoidMainFail === true ||
                    (s.solenoidFail === true && s.relayFaultType !== 'contactOpen');
                return { severity: hard ? 1 : 0 };
            }
        },
        OPEN_CIRCUIT: {
            label: 'Sirkuit Terbuka',
            category: 'electrical',
            secondarySymptoms: ['NO_CRANK'],
            measurements: ['CONTINUITY_FUSE', 'CONTINUITY_CABLE'],
            possibleCauses: ['FAULT_OPEN_CABLE', 'FAULT_OPEN_FUSE'],
            derive: function (s) {
                return { severity: (s.cableState === 'OPEN' || s.fuseState === 'OPEN') ? 1 : 0 };
            }
        },
        GRINDING: {
            label: 'Gerinda / Suara Abnormal',
            category: 'mechanical',
            secondarySymptoms: [],
            measurements: ['VISUAL_RING', 'PINION_GAP'],
            possibleCauses: ['FAULT_MECHANICAL_STARTER', 'FAULT_LOOSE_TERMINAL'],
            derive: function () { return null; }
        }
    };

    function mergeDeep(base, extra) {
        if (!extra || typeof extra !== 'object') return base;
        var out = {};
        for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
        for (var kk in extra) {
            if (!Object.prototype.hasOwnProperty.call(extra, kk)) continue;
            var bv = out[kk];
            var ev = extra[kk];
            if (bv && ev && typeof bv === 'object' && typeof ev === 'object' && !Array.isArray(bv) && !Array.isArray(ev)) {
                out[kk] = mergeDeep(bv, ev);
            } else {
                out[kk] = ev;
            }
        }
        return out;
    }

    /* ---------------- fault library ----------------
       priority: semakin KECIL -> diterapkan paling akhir (menang).
       apply(sim, sev, cfg): menulis field Sim.* saja.
    */
    var FAULTS_DEF = {
        FAULT_BATTERY_WEAK: {
            component: 'battery', faultType: 'WEAK', label: 'Weak Battery', priority: 2,
            symptoms: ['SLOW_CRANK', 'LOW_CRANKING_VOLTAGE'],
            apply: function (sim, sev, cfg) {
                sim.batteryVoltage = roundTo(lerp(cfg.battery.ocvGood, cfg.battery.weakMin, sev), 2);
                sim.batteryCondition = sev >= cfg.thresholds.batteryWeakOn ? 'WEAK' : 'GOOD';
                sim.batteryResistance = cfg.resistance.batteryResBase + cfg.resistance.batteryResPerS * sev;
            }
        },
        FAULT_BATTERY_DISCHARGED: {
            component: 'battery', faultType: 'DISCHARGED', label: 'Discharged Battery', priority: 1,
            symptoms: ['NO_CRANK', 'LOW_CRANKING_VOLTAGE'],
            apply: function (sim, sev, cfg) {
                sim.batteryVoltage = Math.max(0.5, roundTo(cfg.battery.ocvGood - cfg.battery.ocvSlope * sev, 2));
                sim.batteryCondition = sev >= cfg.thresholds.batteryDeadOn ? 'DISCHARGED' : 'WEAK';
            }
        },
        FAULT_LOOSE_TERMINAL: {
            component: 'battery', faultType: 'HIGH_RESISTANCE', label: 'Loose Battery Terminal', priority: 3,
            symptoms: ['INTERMITTENT_NO_CRANK', 'CONTACT_RESISTANCE'],
            apply: function (sim, sev, cfg) {
                sim.terminalResistance = roundTo(cfg.resistance.terminalBase + cfg.resistance.terminalPerS * sev, 4);
                sim.looseTerminal = sev >= cfg.thresholds.terminalLooseOn;
            }
        },
        FAULT_HIGH_POSITIVE_RESISTANCE: {
            component: 'positiveCable', faultType: 'HIGH_RESISTANCE', label: 'High Positive Cable Resistance', priority: 3,
            symptoms: ['SLOW_CRANK', 'HIGH_VOLTAGE_DROP_POSITIVE'],
            apply: function (sim, sev, cfg) {
                sim.cableState = 'GOOD';
                sim.cableResistanceMult = cfg.resistance.cableMultBase + cfg.resistance.cableMultPerS * sev;
            }
        },
        FAULT_OPEN_CABLE: {
            component: 'positiveCable', faultType: 'OPEN', label: 'Open Positive Cable', priority: 1,
            symptoms: ['NO_CRANK', 'OPEN_CIRCUIT'],
            apply: function (sim, sev, cfg) {
                if (sev >= cfg.thresholds.cableOpenOn) {
                    sim.cableState = 'OPEN';
                    sim.cableResistanceMult = 1;
                } else {
                    sim.cableState = 'GOOD';
                    sim.cableResistanceMult = cfg.resistance.cableMultBase + cfg.resistance.cableMultPerS * sev;
                }
            }
        },
        FAULT_OPEN_FUSE: {
            component: 'fuse', faultType: 'OPEN', label: 'Open Fuse', priority: 1,
            symptoms: ['NO_CRANK', 'OPEN_CIRCUIT'],
            apply: function (sim, sev, cfg) {
                sim.fuseState = sev >= cfg.thresholds.fuseOn ? 'OPEN' : 'GOOD';
            }
        },
        FAULT_IGNITION_SWITCH: {
            component: 'ignition', faultType: 'FAILURE', label: 'Ignition Switch Failure', priority: 1,
            symptoms: ['NO_CRANK', 'INTERMITTENT_NO_CRANK'],
            apply: function (sim, sev, cfg) { sim.ignitionFail = sev >= cfg.thresholds.ignitionOn; }
        },
        FAULT_RELAY: {
            component: 'starterRelay', faultType: 'CONTACT_OPEN', label: 'Starter Relay Failure', priority: 1,
            symptoms: ['NO_CRANK', 'RELAY_CLICK_NO_START'],
            apply: function (sim, sev, cfg) {
                sim.relayFaultType = sev >= cfg.thresholds.contactOn ? 'contactOpen' : 'none';
                sim.relayFail = false;
            }
        },
        FAULT_SOLENOID_CONTROL: {
            component: 'starterSolenoid', faultType: 'FAILURE', label: 'Solenoid Control Failure', priority: 1,
            symptoms: ['NO_CRANK'],
            apply: function (sim, sev, cfg) { sim.solenoidFail = sev >= cfg.thresholds.solenoidOn; }
        },
        FAULT_SOLENOID_MAIN_CONTACT: {
            component: 'starterSolenoid', faultType: 'MAIN_CONTACT', label: 'Solenoid Main Contact Failure', priority: 1,
            symptoms: ['CLICK_NO_CRANK', 'NO_CRANK'],
            apply: function (sim, sev, cfg) { sim.solenoidMainFail = sev >= cfg.thresholds.solenoidOn; }
        },
        FAULT_POOR_GROUND: {
            component: 'groundCable', faultType: 'HIGH_RESISTANCE', label: 'Poor Ground', priority: 2,
            symptoms: ['SLOW_CRANK', 'GROUND_VOLTAGE_DROP'],
            apply: function (sim, sev, cfg) {
                sim.groundCondition = 'POOR';
                sim.groundResistanceMult = 1 + cfg.resistance.groundMultPerS * sev;
            }
        },
        FAULT_STARTER_MOTOR: {
            component: 'starter', faultType: 'MOTOR_FAULT', label: 'Starter Motor Failure', priority: 1,
            symptoms: ['NO_CRANK', 'START_SOUND_ONLY'],
            apply: function (sim, sev, cfg) {
                sim.starterMotorFault = sev >= cfg.thresholds.motorOn;
                if (!sim.starterMotorFault) sim.starterEfficiency = roundTo(1 - 0.55 * sev, 3);
            }
        },
        FAULT_MECHANICAL_STARTER: {
            component: 'starter', faultType: 'MECHANICAL', label: 'Mechanical Starter Problem', priority: 1,
            symptoms: ['SLOW_CRANK', 'GRINDING'],
            apply: function (sim, sev, cfg) { sim.starterEfficiency = roundTo(Math.max(0.2, 1 - 0.7 * sev), 3); }
        }
    };

    /* ---------------- internals ---------------- */
    function simRef() {
        try { if (typeof window !== 'undefined' && window.Sim) return window.Sim; } catch (e) { /* noop */ }
        try { if (typeof Sim !== 'undefined') return Sim; } catch (e) { /* noop */ }
        return null;
    }

    function clearManaged() {
        var s = simRef();
        if (!s) return;
        var cfg = engine.config;
        s.batteryVoltage = cfg.battery.ocvGood;
        s.batteryCondition = 'GOOD';
        s.batteryResistance = cfg.resistance.batteryResBase;
        s.looseTerminal = false;
        s.terminalResistance = 0;
        s.cableResistanceMult = 1;
        s.cableState = 'GOOD';
        s.fuseState = 'GOOD';
        s.ignitionFail = false;
        s.relayFaultType = 'none';
        s.relayFail = false;
        s.solenoidFail = false;
        s.solenoidMainFail = false;
        s.groundCondition = 'GOOD';
        s.groundResistanceMult = 1;
        s.starterMotorFault = false;
        s.starterEfficiency = 1;
        s.starterCurrentMult = 1;
        s.pinionFail = false;
    }

    function normalizeIntermittent(ic) {
        if (!ic || typeof ic !== 'object') return null;
        return {
            mode: ic.mode || 'TIME_BASED',
            activeDuration: ic.activeDuration != null ? ic.activeDuration : DEFAULT_CONFIG.intermittent.defaultActive,
            inactiveDuration: ic.inactiveDuration != null ? ic.inactiveDuration : DEFAULT_CONFIG.intermittent.defaultInactive,
            transitionProbability: ic.transitionProbability != null ? ic.transitionProbability : DEFAULT_CONFIG.intermittent.defaultTransitionProb,
            activation: ic.activation || {},
            deactivation: ic.deactivation || {}
        };
    }

    function normalizeProgression(pr) {
        if (!pr || typeof pr !== 'object' || !pr.enabled) return null;
        return {
            enabled: !!pr.enabled,
            rate: pr.rate != null ? pr.rate : DEFAULT_CONFIG.progression.defaultRate,
            per: pr.per || DEFAULT_CONFIG.progression.defaultPer,
            maximumSeverity: pr.maximumSeverity != null ? pr.maximumSeverity : DEFAULT_CONFIG.progression.maximumSeverity
        };
    }

    function makeFaultState(fc) {
        var def = FAULTS_DEF[fc.id];
        if (!def) return null;
        var base = clamp(fc.severity != null ? fc.severity : 1, 0, 1);
        return {
            id: fc.id,
            component: def.component,
            faultType: def.faultType,
            label: def.label,
            baseSeverity: base,
            severity: base,
            probability: fc.probability != null ? clamp(fc.probability, 0, 1) : 1,
            enabled: fc.active !== false,
            intermittent: normalizeIntermittent(fc.intermittent),
            progressive: normalizeProgression(fc.progressive),
            conditions: fc.conditions || {},
            symptoms: fc.symptoms || def.symptoms,
            diagnosticTargets: fc.diagnosticTargets || [],
            repairOptions: fc.repairOptions || [],
            // runtime
            progressSteps: 0,
            windowActive: true,
            windowToggleCount: 0
        };
    }

    /* ---------------- engine state ---------------- */
    var engine = {
        config: null,
        userCustom: (typeof root !== 'undefined' && root.PHASE7_CONFIG) || null,
        vehicleProfileId: null,
        seed: 12345,
        rng: makeSeeded(12345),
        scenario: null,
        lastIgnition: null,
        autoTimer: null,
        autoDt: 500,
        lastTickAt: 0,
        activeInteractions: [],
        customScenarios: []
    };
    rebuildConfig();

    function resetEngineState() {
        stopAuto();
        engine.scenario = null;
        engine.lastIgnition = null;
        engine.lastTickAt = 0;
        engine.seed = 12345;
        engine.rng = makeSeeded(engine.seed);
        engine.activeInteractions = [];
        engine.customScenarios = [];
    }

    /* ---------------- interaction evaluation (§8) ---------------- */
    function roundManaged(key) {
        var prec = { terminalResistance: 4, cableResistanceMult: 3, starterCurrentMult: 3 }[key];
        return prec != null ? prec : 3;
    }

    function computeInteractions() {
        var list = [];
        if (!engine.scenario) return list;
        var byId = {};
        engine.scenario.faults.forEach(function (f) {
            if (!f.enabled || !f.windowActive) return;
            byId[f.id] = f;
        });
        var minSev = (engine.config.interactions && engine.config.interactions.minSeverity) != null ?
            engine.config.interactions.minSeverity : 0.001;
        INTERACTION_DEFS.forEach(function (ix) {
            var parts = ix.faults;
            var missing = false, sevSum = 0;
            for (var i = 0; i < parts.length; i++) {
                var p = byId[parts[i]];
                if (!p || p.severity <= minSev) { missing = true; break; }
                sevSum += p.severity;
            }
            if (missing) return;
            var sev = parts.length ? sevSum / parts.length : 0;
            if (sev <= minSev) return;
            var simChanges = ix.compute ? ix.compute(byId, sev, engine.config) : (ix.simChanges || {});
            list.push({
                id: ix.id,
                label: ix.label,
                faults: ix.faults.slice(),
                combine: ix.combine,
                severity: roundTo(sev, 3),
                secondarySymptoms: (ix.secondarySymptoms || []).slice(),
                diagnosticNotes: (ix.diagnosticNotes || []).slice(),
                simChanges: simChanges
            });
        });
        return list;
    }

    function applyInteractionEffects() {
        var s = simRef();
        if (!s) return;
        engine.activeInteractions.forEach(function (ix) {
            var ch = ix.simChanges || {};
            Object.keys(ch).forEach(function (key) {
                if (typeof s[key] === 'number') s[key] = roundTo(ch[key], roundManaged(key));
            });
        });
    }

    /* ---------------- apply layer (idempotent) ---------------- */
    function applyLayer() {
        var s = simRef();
        if (!s || !engine.scenario) return false;
        clearManaged();
        var ordered = engine.scenario.faults
            .filter(function (f) { return f.enabled; })
            .sort(function (a, b) {
                return (FAULTS_DEF[b.id] ? FAULTS_DEF[b.id].priority : 5) - (FAULTS_DEF[a.id] ? FAULTS_DEF[a.id].priority : 5);
            });
        ordered.forEach(function (st) {
            if (!st.windowActive) return;
            var def = FAULTS_DEF[st.id];
            if (def && def.apply) def.apply(s, st.severity, engine.config);
        });
        engine.activeInteractions = computeInteractions();
        applyInteractionEffects();
        return true;
    }

    /* ---------------- intermittent evaluation ---------------- */
    function evalIntermittency(st, sim, rng, cfg) {
        var ic = st.intermittent;
        if (!ic) return true;
        var sc = engine.scenario;
        switch (ic.mode) {
            case 'START_ATTEMPT_BASED': {
                var act = ic.activation.attemptNumber;
                var deact = ic.deactivation.attemptNumber;
                var n = sc ? sc.attemptCount : 0;
                if (act != null && n < act) return false;
                if (deact != null && n >= deact) return false;
                return true;
            }
            case 'CURRENT_BASED': {
                var up = ic.activation.currentAbove != null ? ic.activation.currentAbove : 180;
                var down = ic.deactivation.currentBelow != null ? ic.deactivation.currentBelow : 80;
                var cur = sim.starterCurrent || 0;
                if (cur >= up) return true;
                if (cur <= down) return false;
                return st.windowActive;
            }
            case 'RANDOM_SEEDED': {
                if (rng() < (ic.transitionProbability != null ? ic.transitionProbability : cfg.intermittent.defaultTransitionProb)) {
                    st.windowActive = !st.windowActive;
                }
                return st.windowActive;
            }
            case 'TIME_BASED':
            default: {
                var activeMs = ic.activeDuration != null ? ic.activeDuration : cfg.intermittent.defaultActive;
                var inactiveMs = ic.inactiveDuration != null ? ic.inactiveDuration : cfg.intermittent.defaultInactive;
                var cycle = activeMs + inactiveMs;
                var phase = sc ? (sc.elapsedMs % cycle) : 0;
                return phase < activeMs;
            }
        }
    }

    function recomputeSeverities() {
        var changed = false;
        var sc = engine.scenario;
        if (!sc) return false;
        sc.faults.forEach(function (st) {
            var pr = st.progressive;
            if (!pr || !pr.enabled) return;
            var next = clamp(st.baseSeverity + st.progressSteps * pr.rate, 0, pr.maximumSeverity);
            if (Math.abs(next - st.severity) > 0.0001) { st.severity = next; changed = true; }
        });
        return changed;
    }

    /* ---------------- tick: attempt detection + intermittency + progression ---------------- */
    function tick(dtMs) {
        var s = simRef();
        if (!s || !engine.scenario) return getScenarioState();
        var dt = dtMs || 16;
        engine.scenario.elapsedMs += dt;
        var changed = false;

        if (engine.lastIgnition != null && engine.lastIgnition !== 'START' && s.ignitionState === 'START') {
            engine.scenario.attemptCount += 1;
            engine.scenario.faults.forEach(function (st) {
                var pr = st.progressive;
                if (pr && pr.enabled && (pr.per === 'attempt' || pr.per === 'crankingMs')) st.progressSteps += 1;
                var ic = st.intermittent;
                if (ic && ic.mode === 'START_ATTEMPT_BASED') {
                    var act = ic.activation.attemptNumber;
                    var deact = ic.deactivation.attemptNumber;
                    var was = st.windowActive;
                    st.windowActive = (act == null || engine.scenario.attemptCount >= act) && (deact == null || engine.scenario.attemptCount < deact);
                    if (was !== st.windowActive) { st.windowToggleCount += 1; changed = true; }
                }
            });
        }
        engine.lastIgnition = s.ignitionState;

        engine.scenario.faults.forEach(function (st) {
            var ic = st.intermittent;
            if (!ic || ic.mode === 'START_ATTEMPT_BASED') return;
            var was = st.windowActive;
            st.windowActive = evalIntermittency(st, s, engine.rng, engine.config);
            if (was !== st.windowActive) { st.windowToggleCount += 1; changed = true; }
        });
        if (changed) applyLayer();

        engine.scenario.faults.forEach(function (st) {
            var pr = st.progressive;
            if (!pr || !pr.enabled) return;
            if (pr.per === 'timeMs') {
                if (st._acc == null) st._acc = 0;
                st._acc += dt;
                var steps = Math.floor(st._acc / (pr.stepMs || 1000));
                if (steps > st.progressSteps) st.progressSteps = steps;
            } else if (pr.per === 'crankingMs' && s.starterState === 'CRANKING') {
                if (st._crankAcc == null) st._crankAcc = 0;
                st._crankAcc += dt;
                var csteps = Math.floor(st._crankAcc / (pr.stepMs || 1000));
                if (csteps > st.progressSteps) st.progressSteps = csteps;
            }
        });
        if (recomputeSeverities()) applyLayer();
        return getScenarioState();
    }

    /* ---------------- scenario lifecycle ---------------- */
    function initDiagnosticSession(sc) {
        sc.hypotheses = [];
        sc.diagnosticPath = [];
        sc.testHistory = [];
        sc.testSeq = 0;
        sc.diagnosticPath.push({ step: 'START', at: nowTimeMs() });
    }
    function recordPathStep(step) {
        if (!engine.scenario) return;
        engine.scenario.diagnosticPath.push({ step: step, at: nowTimeMs() });
    }

    function installScenario(cfg) {
        resetEngineState();
        var c = cfg || {};
        engine.seed = c.seed != null ? c.seed : engine.seed;
        engine.rng = makeSeeded(engine.seed);
        engine.scenario = {
            id: c.id || ('SCENARIO_' + String(engine.seed)),
            vehicleProfile: c.vehicleProfile || 'TRAINER_A',
            complaint: c.complaint || '',
            difficulty: c.difficulty || 'BEGINNER',
            expectedSymptoms: (c.expectedSymptoms || []).slice(),
            environment: c.environment || null,
            attemptedAfterSeed: false,
            installedAt: nowTimeMs(),
            elapsedMs: 0,
            attemptCount: 0,
            crankingMs: 0,
            faults: []
        };
        initDiagnosticSession(engine.scenario);
        engine.scenario.vehicleProfile = c.vehicleProfile || engine.vehicleProfileId || 'TRAINER_A';
        if (engine.vehicleProfileId !== engine.scenario.vehicleProfile) {
            applyProfile(engine.scenario.vehicleProfile, true);
        }
        var list = c.faults || [];
        for (var i = 0; i < list.length; i++) {
            var st = makeFaultState(list[i]);
            if (st) engine.scenario.faults.push(st);
        }
        applyLayer();
        return getScenarioState();
    }

    function clearScenario() {
        resetEngineState();
        clearManaged();
        return null;
    }

    function getScenarioState() {
        var sc = engine.scenario;
        if (!sc) return null;
        return {
            id: sc.id,
            vehicleProfile: sc.vehicleProfile,
            complaint: sc.complaint,
            difficulty: sc.difficulty,
            seed: engine.seed,
            attemptCount: sc.attemptCount,
            elapsedMs: sc.elapsedMs,
            expectedSymptoms: sc.expectedSymptoms.slice(),
            environment: sc.environment ? { temperature: sc.environment.temperature, batteryCondition: sc.environment.batteryCondition } : null,
            faults: sc.faults.map(function (f) {
                return {
                    id: f.id,
                    label: f.label,
                    component: f.component,
                    faultType: f.faultType,
                    severity: roundTo(f.severity, 3),
                    baseSeverity: roundTo(f.baseSeverity, 3),
                    active: f.enabled,
                    windowActive: f.windowActive,
                    progressSteps: f.progressSteps,
                    windowToggleCount: f.windowToggleCount,
                    symptoms: f.symptoms.slice()
                };
            })
        };
    }

    /* ---------------- fault-level API (§70 core) ---------------- */
    function addFault(fc) {
        var st = makeFaultState(fc || {});
        if (!st) return { ok: false, error: 'unknownFault', id: fc && fc.id };
        if (!engine.scenario) {
            engine.scenario = {
                id: 'SCENARIO_' + String(engine.seed),
                vehicleProfile: 'TRAINER_A',
                complaint: '',
                difficulty: 'BEGINNER',
                expectedSymptoms: [],
                installedAt: nowTimeMs(),
                elapsedMs: 0,
                attemptCount: 0,
                crankingMs: 0,
                faults: []
            };
            initDiagnosticSession(engine.scenario);
        }
        engine.scenario.faults.push(st);
        applyLayer();
        return { ok: true, id: st.id, state: getFaultState(st.id) };
    }

    function removeFault(id) {
        if (!engine.scenario) return { ok: false };
        var before = engine.scenario.faults.length;
        engine.scenario.faults = engine.scenario.faults.filter(function (f) { return f.id !== id; });
        applyLayer();
        return { ok: before !== engine.scenario.faults.length, id: id };
    }

    function findState(id) {
        if (!engine.scenario) return null;
        for (var i = 0; i < engine.scenario.faults.length; i++) {
            if (engine.scenario.faults[i].id === id) return engine.scenario.faults[i];
        }
        return null;
    }

    function setFaultSeverity(id, sev) {
        var st = findState(id);
        if (!st) return { ok: false };
        st.baseSeverity = clamp(sev != null ? sev : 1, 0, 1);
        st.severity = clamp(st.baseSeverity + st.progressSteps * (st.progressive ? st.progressive.rate : 0), 0, st.progressive ? st.progressive.maximumSeverity : 1);
        applyLayer();
        return { ok: true, id: id, severity: st.severity };
    }

    function setIntermittentMode(id, config) {
        var st = findState(id);
        if (!st) return { ok: false };
        st.intermittent = normalizeIntermittent(config);
        st.windowActive = true;
        applyLayer();
        return { ok: true, id: id };
    }

    function setProgression(id, config) {
        var st = findState(id);
        if (!st) return { ok: false };
        st.progressive = normalizeProgression(config);
        applyLayer();
        return { ok: true, id: id };
    }

    function enableFault(id) {
        var st = findState(id);
        if (!st) return { ok: false };
        st.enabled = true;
        applyLayer();
        return { ok: true, id: id };
    }
    function disableFault(id) {
        var st = findState(id);
        if (!st) return { ok: false };
        st.enabled = false;
        applyLayer();
        return { ok: true, id: id };
    }

    function getFaultState(id) {
        var st = findState(id);
        if (!st) return null;
        return {
            id: st.id, label: st.label, component: st.component, faultType: st.faultType,
            severity: roundTo(st.severity, 3), baseSeverity: roundTo(st.baseSeverity, 3),
            active: st.enabled, windowActive: st.windowActive,
            progressSteps: st.progressSteps, windowToggleCount: st.windowToggleCount,
            intermittent: st.intermittent, progressive: st.progressive,
            symptoms: st.symptoms.slice()
        };
    }
    function getAllFaultStates() {
        if (!engine.scenario) return [];
        return engine.scenario.faults.map(function (f) { return getFaultState(f.id); });
    }

    /* ---------------- symptom engine (§16 + §17 + §8 secondary) ---------------- */
    function collectSymptomSources(map) {
        if (!engine.scenario) return;
        engine.scenario.faults.forEach(function (st) {
            if (!st.enabled || !st.windowActive) return;
            (st.symptoms || []).forEach(function (sym) {
                if (st.severity <= 0.001) return;
                if (!Object.prototype.hasOwnProperty.call(map, sym)) map[sym] = { severity: st.severity, causes: [] };
                else if (st.severity > map[sym].severity) map[sym].severity = st.severity;
                map[sym].causes.push(st.id);
            });
        });
        engine.activeInteractions.forEach(function (ix) {
            (ix.secondarySymptoms || []).forEach(function (sym) {
                if (!Object.prototype.hasOwnProperty.call(map, sym)) {
                    map[sym] = { severity: ix.severity, causes: ix.faults.slice() };
                } else {
                    if (ix.severity > map[sym].severity) map[sym].severity = ix.severity;
                    ix.faults.forEach(function (f) {
                        if (map[sym].causes.indexOf(f) < 0) map[sym].causes.push(f);
                    });
                }
            });
        });
    }

    // Live derivation: gejala diturunkan dari KONDISI Sim (physical), bukan dari
    // nama fault -> tetap aman utk hidden fault dan berfungsi utk fault Phase 4.
    function applyLiveSymptomDerivations(map, cfg) {
        var s = simRef();
        if (!s) return;
        Object.keys(SYMPTOM_DEFS).forEach(function (id) {
            var def = SYMPTOM_DEFS[id];
            if (!def.derive) return;
            var live = def.derive(s, cfg);
            if (!live || live.severity == null || live.severity <= 0.001) return;
            if (!Object.prototype.hasOwnProperty.call(map, id)) map[id] = { severity: 0, causes: [] };
            if (live.severity > map[id].severity) map[id].severity = live.severity;
            map[id]._live = true;
        });
    }

    function evaluateSymptoms() {
        var map = {};
        if (!engine.scenario) return [];
        collectSymptomSources(map);
        applyLiveSymptomDerivations(map, engine.config);
        return Object.keys(map).map(function (k) {
            var entry = map[k];
            var def = SYMPTOM_DEFS[k];
            var sev = clamp(entry.severity, 0, 1);
            var conf = 0.55 + sev * 0.3;
            if (entry._live) conf += 0.15;                       // bukti terukur menguatkan
            if (entry.causes && entry.causes.length >= 2) conf += 0.05;
            conf = Math.min(0.98, roundTo(conf, 2));
            return {
                id: k,
                label: def ? def.label : k,
                category: def ? def.category : 'generic',
                severity: roundTo(sev, 3),
                confidence: conf,
                causes: (entry.causes || []).slice(),
                live: !!entry._live,
                measurements: def && def.measurements ? def.measurements.slice() : [],
                secondarySymptoms: def && def.secondarySymptoms ? def.secondarySymptoms.slice() : []
            };
        });
    }
    function getActiveSymptoms() { return evaluateSymptoms(); }

    // Symptom matrix (§17): per gejala -> kemungkinan penyebab, secondary, measurements.
    function getSymptomMatrix() {
        return Object.keys(SYMPTOM_DEFS).map(function (id) {
            var d = SYMPTOM_DEFS[id];
            return {
                id: id,
                label: d.label,
                category: d.category,
                primarySymptoms: d.possibleCauses.slice(),
                secondarySymptoms: d.secondarySymptoms.slice(),
                measurements: d.measurements.slice(),
                possibleCauses: d.possibleCauses.slice(),
                liveDerived: typeof d.derive === 'function'
            };
        });
    }
    function getSymptom(id) {
        var d = SYMPTOM_DEFS[id];
        if (!d) return null;
        var live = d.derive ? d.derive(simRef(), engine.config) : null;
        return {
            id: id,
            label: d.label,
            category: d.category,
            possibleCauses: d.possibleCauses.slice(),
            secondarySymptoms: d.secondarySymptoms.slice(),
            measurements: d.measurements.slice(),
            liveSeverity: live && live.severity != null ? roundTo(live.severity, 3) : null
        };
    }
    function getPossibleCauses(symptomId) {
        var d = SYMPTOM_DEFS[symptomId];
        return d ? d.possibleCauses.slice() : [];
    }

    /* ---------------- hypothesis engine (§19 + alur §18) ---------------- */
    // Skor kandidat murni dari SYMPTOM MATRIX (§17 possibleCauses) — TIDAK
    // membaca penyebab aktual fault -> hipotesis tidak membocorkan jawaban.
    function computeCandidateScores() {
        var cfg = engine.config;
        var wSev = cfg.hypothesis.symptomSeverityWeight != null ? cfg.hypothesis.symptomSeverityWeight : 0.7;
        var wConf = cfg.hypothesis.symptomConfidenceWeight != null ? cfg.hypothesis.symptomConfidenceWeight : 0.3;
        var scores = {};
        var syms = getActiveSymptoms();
        syms.forEach(function (sym) {
            var s = sym.severity || 0;
            var c = sym.confidence != null ? sym.confidence : 0.5;
            var gain = s * wSev + s * c * wConf;
            getPossibleCauses(sym.id).forEach(function (fid) {
                scores[fid] = (scores[fid] || 0) + gain;
            });
        });
        return scores;
    }

    function probabilityOf(faultId, scores) {
        var sc = scores[faultId] || 0;
        return sc / (1 + sc);           // pemetaan monotonik deterministik 0..1
    }

    function statusFrom(prob, hyp) {
        var cfg = engine.config.hypothesis;
        var likely = cfg.likelyThreshold != null ? cfg.likelyThreshold : 0.6;
        var unlikely = cfg.unlikelyThreshold != null ? cfg.unlikelyThreshold : 0.22;
        var confirm = cfg.confirmThreshold != null ? cfg.confirmThreshold : 0.75;
        if (hyp.evidenceAgainst.length > 0) return 'REJECTED';
        if (hyp.evidenceFor.length >= 2 && prob >= confirm) return 'CONFIRMED';
        if (prob >= likely) return 'LIKELY';
        if (prob > 0 && prob <= unlikely) return 'UNLIKELY';
        if (hyp.evidenceFor.length === 0 && hyp.evidenceAgainst.length === 0 && prob === 0) return 'UNTESTED';
        return 'POSSIBLE';
    }

    function makeHypothesis(faultId, scores) {
        var def = FAULTS_DEF[faultId];
        var prob = probabilityOf(faultId, scores);
        var hyp = {
            id: 'HYP_' + String(engine.scenario.hypotheses.length + 1).padStart(3, '0'),
            faultId: faultId,
            component: def ? def.component : 'unknown',
            faultType: def ? def.faultType : 'UNKNOWN',
            label: def ? def.label : faultId,
            probability: roundTo(prob, 3),
            evidenceFor: [],
            evidenceAgainst: [],
            sourceSymptoms: [],
            status: 'UNKNOWN'
        };
        hyp.status = statusFrom(prob, hyp);
        return hyp;
    }

    function generateHypotheses() {
        if (!engine.scenario) return [];
        recordPathStep('OBSERVE_SYMPTOMS');
        var scores = computeCandidateScores();
        var existing = {};
        engine.scenario.hypotheses.forEach(function (h) { existing[h.faultId] = true; });
        Object.keys(scores).forEach(function (fid) {
            if (existing[fid]) return;
            engine.scenario.hypotheses.push(makeHypothesis(fid, scores));
        });
        engine.scenario.hypotheses.forEach(function (h) {
            var sc = scores[h.faultId] || 0;
            var p = h.probability;
            if (sc > 0) {
                p = probabilityOf(h.faultId, scores);
                h.probability = roundTo(p, 3);
            }
            h.status = statusFrom(roundTo(p, 3), h);
            h.sourceSymptoms = getActiveSymptoms()
                .filter(function (sym) { return getPossibleCauses(sym.id).indexOf(h.faultId) >= 0; })
                .map(function (sym) { return sym.id; });
        });
        engine.scenario.hypothesesGenerated = true;
        recordPathStep('GENERATE_HYPOTHESES');
        return getHypotheses();
    }

    function createHypothesis(input) {
        if (!engine.scenario) return { ok: false, error: 'NO_SCENARIO' };
        var fid = null;
        if (typeof input === 'string') {
            fid = FAULTS_DEF[input] ? input : null;
        } else if (input && input.faultId) {
            fid = FAULTS_DEF[input.faultId] ? input.faultId : null;
        } else if (input && input.component && input.faultType) {
            var c = input.component, f = input.faultType;
            Object.keys(FAULTS_DEF).forEach(function (id) {
                if (!fid && FAULTS_DEF[id].component === c && FAULTS_DEF[id].faultType === f) fid = id;
            });
        }
        if (!fid) return { ok: false, error: 'UNKNOWN_FAULT', input: input };
        var scores = computeCandidateScores();
        var hyp = makeHypothesis(fid, scores);
        hyp.sourceSymptoms = [];
        engine.scenario.hypotheses.push(hyp);
        recordPathStep('CREATE_HYPOTHESIS');
        return { ok: true, id: hyp.id, hypothesis: snapshotHypothesis(hyp) };
    }

    function findHypothesis(id) {
        if (!engine.scenario) return null;
        for (var i = 0; i < engine.scenario.hypotheses.length; i++) {
            if (engine.scenario.hypotheses[i].id === id) return engine.scenario.hypotheses[i];
        }
        return null;
    }

    function snapshotHypothesis(h) {
        return {
            id: h.id,
            faultId: h.faultId,
            component: h.component,
            faultType: h.faultType,
            label: h.label,
            probability: roundTo(h.probability, 3),
            status: h.status,
            evidenceFor: h.evidenceFor.slice(),
            evidenceAgainst: h.evidenceAgainst.slice(),
            sourceSymptoms: h.sourceSymptoms.slice()
        };
    }

    function evaluateHypothesis(id) {
        var hyp = findHypothesis(id);
        if (!hyp) return null;
        var scores = computeCandidateScores();
        hyp.probability = roundTo(probabilityOf(hyp.faultId, scores), 3);
        hyp.status = statusFrom(hyp.probability, hyp);
        recordPathStep('EVALUATE_HYPOTHESIS:' + hyp.faultId);
        return snapshotHypothesis(hyp);
    }

    // Hook bukti (STEP 9 akan mengisinya); SUPPORTING->for, CONTRADICTING->against,
    // NEUTRAL/INSUFFICIENT dicatat sbg netral (tidak menambah apa pun).
    function recordEvidence(id, evidence) {
        var hyp = findHypothesis(id);
        if (!hyp) return { ok: false, error: 'NO_HYPOTHESIS' };
        var ev = evidence || {};
        if (ev.verdict === 'CONTRADICTING') {
            hyp.evidenceAgainst.push({ test: ev.test || 'UNKNOWN', verdict: ev.verdict, note: ev.note || '' });
        } else if (ev.verdict === 'SUPPORTING') {
            hyp.evidenceFor.push({ test: ev.test || 'UNKNOWN', verdict: ev.verdict, note: ev.note || '' });
        }
        hyp.probability = roundTo(probabilityOf(hyp.faultId, computeCandidateScores()), 3);
        hyp.status = statusFrom(hyp.probability, hyp);
        recordPathStep('RECORD_EVIDENCE:' + hyp.faultId + ':' + ev.verdict);
        return { ok: true, id: id, hypothesis: snapshotHypothesis(hyp) };
    }

    function getHypotheses() {
        if (!engine.scenario) return [];
        return engine.scenario.hypotheses.map(snapshotHypothesis);
    }
    function getHypothesis(id) {
        var hyp = findHypothesis(id);
        return hyp ? snapshotHypothesis(hyp) : null;
    }
    function getRankedHypotheses() {
        var list = getHypotheses();
        list.sort(function (a, b) {
            if (b.probability !== a.probability) return b.probability - a.probability;
            return a.faultId < b.faultId ? -1 : 1;
        });
        return list;
    }
    function resetHypotheses() {
        if (!engine.scenario) return;
        engine.scenario.hypotheses = [];
        engine.scenario.hypothesesGenerated = false;
        recordPathStep('RESET_HYPOTHESES');
    }
    function getDiagnosticPath() {
        if (!engine.scenario) return [];
        return engine.scenario.diagnosticPath.slice();
    }

    /* ---------------- evidence engine (§20 + §21 + evaluateTest) ---------------- */
    // Setiap tes membaca nilai Sim LIVE (snapshot terukur) dan menafsirkannya utk
    // kelima area (Battery/Cable/Ground/Starter/Mechanical) sbg salah satu dari
    // SUPPORTING | CONTRADICTING | NEUTRAL | INSUFFICIENT. Interpretasi murni dari
    // fisika pengukuran — bukan dari fakta fault — jadi tidak membocorkan jawaban,
    // dan §20: "evidence tidak otomatis berarti baterai pasti rusak".
    var FAULT_GROUPS = {
        FAULT_BATTERY_WEAK: 'BATTERY', FAULT_BATTERY_DISCHARGED: 'BATTERY',
        FAULT_LOOSE_TERMINAL: 'CABLE', FAULT_HIGH_POSITIVE_RESISTANCE: 'CABLE',
        FAULT_OPEN_CABLE: 'CABLE', FAULT_OPEN_FUSE: 'CABLE',
        FAULT_POOR_GROUND: 'GROUND',
        FAULT_IGNITION_SWITCH: 'STARTER', FAULT_RELAY: 'STARTER',
        FAULT_SOLENOID_CONTROL: 'STARTER', FAULT_SOLENOID_MAIN_CONTACT: 'STARTER',
        FAULT_STARTER_MOTOR: 'STARTER', FAULT_MECHANICAL_STARTER: 'MECHANICAL'
    };
    function areasNeutral(note) {
        var areas = ['BATTERY', 'CABLE', 'GROUND', 'STARTER', 'MECHANICAL'];
        var out = [];
        for (var i = 0; i < areas.length; i++) {
            out.push({ candidate: areas[i], verdict: 'NEUTRAL', note: note });
        }
        return out;
    }
    function groupOfFault(fid) {
        if (FAULT_GROUPS[fid]) return FAULT_GROUPS[fid];
        var def = FAULTS_DEF[fid];
        if (!def) return null;
        if (def.component === 'battery') return 'BATTERY';
        if (def.component === 'positiveCable' || def.component === 'fuse') return 'CABLE';
        if (def.component === 'groundCable') return 'GROUND';
        if (def.component.indexOf('starter') === 0 || def.component.indexOf('ignition') === 0) return 'STARTER';
        return 'MECHANICAL';
    }

    var TEST_DEFS = [
        {
            id: 'TEST_OCV', name: 'Battery Open-Circuit Voltage', difficulty: 'EASY',
            diagnosticValue: 0.55, timeCost: 1, risk: 'LOW', context: 'IDLE',
            areas: ['BATTERY', 'CABLE', 'GROUND', 'STARTER', 'MECHANICAL'],
            kpi: ['batteryVoltage', 'batteryCondition'],
            interpret: function (sim, cfg) {
                var ocv = sim.batteryVoltage != null ? sim.batteryVoltage : cfg.battery.ocvGood;
                var t = cfg.tests;
                if (ocv >= t.ocvNormal) {
                    return [
                        { candidate: 'BATTERY', verdict: 'CONTRADICTING', note: 'Battery open-circuit voltage normal' },
                        { candidate: 'FAULT_BATTERY_WEAK', verdict: 'CONTRADICTING', note: 'OCV dalam band normal' },
                        { candidate: 'FAULT_BATTERY_DISCHARGED', verdict: 'CONTRADICTING', note: 'OCV dalam band normal' },
                        { candidate: 'CABLE', verdict: 'NEUTRAL', note: 'OCV tidak membuktikan kelistrikan kabel' },
                        { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'OCV tidak membuktikan kondisi ground' },
                        { candidate: 'STARTER', verdict: 'INSUFFICIENT', note: 'OCV tidak menguji beban starter' },
                        { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'OCV tidak menyentuh bagian mekanis' }
                    ];
                }
                if (ocv < t.ocvWeak) {
                    return [
                        { candidate: 'BATTERY', verdict: 'SUPPORTING', note: 'Battery voltage severely reduced' },
                        { candidate: 'FAULT_BATTERY_DISCHARGED', verdict: 'SUPPORTING', note: 'ocv jauh di bawah normal' },
                        { candidate: 'FAULT_BATTERY_WEAK', verdict: 'SUPPORTING', note: 'ocv di bawah normal' },
                        { candidate: 'CABLE', verdict: 'NEUTRAL', note: 'area kabel belum dinilai' },
                        { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'area ground belum dinilai' },
                        { candidate: 'STARTER', verdict: 'NEUTRAL', note: 'belum ada data arus/RPM' },
                        { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'perlu uji cranking' }
                    ];
                }
                return [
                    { candidate: 'BATTERY', verdict: 'SUPPORTING', note: 'Battery voltage slightly reduced' },
                    { candidate: 'FAULT_BATTERY_WEAK', verdict: 'SUPPORTING', note: 'ocv dalam band lemah' },
                    { candidate: 'FAULT_BATTERY_DISCHARGED', verdict: 'NEUTRAL', note: 'perlu uji beban' },
                    { candidate: 'CABLE', verdict: 'NEUTRAL', note: 'belum dinilai' },
                    { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'belum dinilai' },
                    { candidate: 'STARTER', verdict: 'NEUTRAL', note: 'belum ada data cranking' },
                    { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'perlu uji cranking' }
                ];
            }
        },
        {
            id: 'TEST_CRANKING_VOLTAGE', name: 'Cranking Voltage Test', difficulty: 'MEDIUM',
            diagnosticValue: 0.82, timeCost: 2, risk: 'LOW', context: 'CRANKING',
            areas: ['BATTERY', 'CABLE', 'GROUND', 'STARTER', 'MECHANICAL'],
            kpi: ['batteryVoltage', 'starterVoltage', 'starterRPM', 'starterState'],
            interpret: function (sim, cfg) {
                var ocv = sim.batteryVoltage != null ? sim.batteryVoltage : cfg.battery.ocvGood;
                var crankV = sim.starterVoltage != null ? sim.starterVoltage : sim.batteryVoltage;
                var t = cfg.tests;
                if (sim.starterState !== 'CRANKING') {
                    return [
                        { candidate: 'BATTERY', verdict: 'INSUFFICIENT', note: 'ukur saat cranking berlangsung' },
                        { candidate: 'CABLE', verdict: 'INSUFFICIENT', note: 'ukur saat cranking berlangsung' },
                        { candidate: 'GROUND', verdict: 'INSUFFICIENT', note: 'ukur saat cranking berlangsung' },
                        { candidate: 'STARTER', verdict: 'INSUFFICIENT', note: 'ukur saat cranking berlangsung' },
                        { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'ukur saat cranking berlangsung' }
                    ];
                }
                if (crankV >= t.crankNormalFloor) {
                    return [
                        { candidate: 'BATTERY', verdict: 'CONTRADICTING', note: 'cranking voltage normal — beban listrik sehat' },
                        { candidate: 'CABLE', verdict: 'CONTRADICTING', note: 'penurunan tegangan posisi tidak signifikan' },
                        { candidate: 'GROUND', verdict: 'CONTRADICTING', note: 'penurunan tegangan ground tidak signifikan' },
                        { candidate: 'STARTER', verdict: 'CONTRADICTING', note: 'starter menarik tegangan normal' },
                        { candidate: 'MECHANICAL', verdict: 'NEUTRAL', note: 'cranking voltage tidak menilai grinding/gesekan' }
                    ];
                }
                if (ocv >= t.ocvNormal && crankV < t.crankSevereFloor) {
                    // §20/§18: OCV normal + cranking parah -> BUKAN berarti baterai rusak
                    return [
                        { candidate: 'BATTERY', verdict: 'CONTRADICTING', note: 'Battery OCV normal, baterai bukan biang utama' },
                        { candidate: 'CABLE', verdict: 'SUPPORTING', note: 'drop besar saat beban -> ruas kabel/terminal suspect' },
                        { candidate: 'GROUND', verdict: 'SUPPORTING', note: 'grounding lemah menjadi kandidat' },
                        { candidate: 'STARTER', verdict: 'SUPPORTING', note: 'tekanan cranking rendah dgn baterai sehat -> sisi beban' },
                        { candidate: 'MECHANICAL', verdict: 'SUPPORTING', note: 'gesekan/kompresi tinggi memungkinkan' }
                    ];
                }
                return [
                    { candidate: 'BATTERY', verdict: 'SUPPORTING', note: 'tegangan cranking rendah mengikuti OCV rendah' },
                    { candidate: 'FAULT_BATTERY_WEAK', verdict: 'SUPPORTING', note: 'OCV dan cranking sama-sama lemah' },
                    { candidate: 'CABLE', verdict: 'NEUTRAL', note: 'perlu ukur drop terpisah untuk memastikan' },
                    { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'perlu ukur drop ground terpisah' },
                    { candidate: 'STARTER', verdict: 'INSUFFICIENT', note: 'belum terpetakan, lihat arus' },
                    { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'belum ada data mekanis' }
                ];
            }
        },
        {
            id: 'TEST_POSITIVE_DROP', name: 'Positive Cable Voltage Drop', difficulty: 'MEDIUM',
            diagnosticValue: 0.72, timeCost: 2, risk: 'LOW', context: 'CRANKING',
            areas: ['BATTERY', 'CABLE', 'GROUND', 'STARTER', 'MECHANICAL'],
            kpi: ['voltageDropPositive', 'cableResistanceMult', 'looseTerminal'],
            interpret: function (sim, cfg) {
                var drop = sim.voltageDropPositive != null ? sim.voltageDropPositive : 0;
                if ((sim.cableResistanceMult || 1) > 1.8) drop = Math.max(drop, 0.7);
                if (sim.looseTerminal) drop = Math.max(drop, 0.8);
                if (drop > cfg.tests.dropLimit) {
                    return [
                        { candidate: 'BATTERY', verdict: 'INSUFFICIENT', note: 'drop positif tidak menimpa baterai' },
                        { candidate: 'CABLE', verdict: 'SUPPORTING', note: 'positive side drop berlebih -> kabel/terminal' },
                        { candidate: 'FAULT_HIGH_POSITIVE_RESISTANCE', verdict: 'SUPPORTING', note: 'tahanan kabel positif tinggi' },
                        { candidate: 'FAULT_LOOSE_TERMINAL', verdict: 'SUPPORTING', note: 'terminal kendor merupakan kandidat' },
                        { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'drop ground perlu diukur terpisah' },
                        { candidate: 'STARTER', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'tidak relevan utk tes ini' }
                    ];
                }
                return [
                    { candidate: 'BATTERY', verdict: 'INSUFFICIENT', note: 'drop positif normal' },
                    { candidate: 'CABLE', verdict: 'CONTRADICTING', note: 'Positive voltage drop normal - ruas positif sehat' },
                    { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'perlu ukur drop ground' },
                    { candidate: 'STARTER', verdict: 'NEUTRAL', note: 'belum dinilai' },
                    { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'tidak relevan utk tes ini' }
                ];
            }
        },
        {
            id: 'TEST_GROUND_DROP', name: 'Ground Voltage Drop', difficulty: 'MEDIUM',
            diagnosticValue: 0.82, timeCost: 2, risk: 'LOW', context: 'CRANKING',
            areas: ['BATTERY', 'CABLE', 'GROUND', 'STARTER', 'MECHANICAL'],
            kpi: ['voltageDropGround', 'groundCondition', 'groundResistanceMult'],
            interpret: function (sim, cfg) {
                var drop = sim.voltageDropGround != null ? sim.voltageDropGround : 0;
                if (sim.groundCondition === 'POOR') drop = Math.max(drop, 0.7);
                if (drop > cfg.tests.dropLimit) {
                    return [
                        { candidate: 'BATTERY', verdict: 'INSUFFICIENT', note: 'ground drop tidak berkorelasi dgn baterai' },
                        { candidate: 'CABLE', verdict: 'NEUTRAL', note: 'drop ground terpisah dari sisi positif' },
                        { candidate: 'GROUND', verdict: 'SUPPORTING', note: 'ground voltage drop berlebih -> poor ground' },
                        { candidate: 'FAULT_POOR_GROUND', verdict: 'SUPPORTING', note: 'grounding resistif jadi kandidat utama' },
                        { candidate: 'STARTER', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'tidak relevan utk tes ini' }
                    ];
                }
                return [
                    { candidate: 'BATTERY', verdict: 'INSUFFICIENT', note: 'ground drop normal' },
                    { candidate: 'GROUND', verdict: 'CONTRADICTING', note: 'ground return sehat' },
                    { candidate: 'CABLE', verdict: 'NEUTRAL', note: 'perlu ukur drop positif' },
                    { candidate: 'STARTER', verdict: 'NEUTRAL', note: 'belum dinilai' },
                    { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'tidak relevan utk tes ini' }
                ];
            }
        },
        {
            id: 'TEST_STARTER_CURRENT', name: 'Starter Current Draw', difficulty: 'HARD',
            diagnosticValue: 0.74, timeCost: 3, risk: 'MEDIUM', context: 'CRANKING',
            areas: ['BATTERY', 'CABLE', 'GROUND', 'STARTER', 'MECHANICAL'],
            kpi: ['starterCurrent', 'starterCurrentMult', 'starterState'],
            interpret: function (sim, cfg) {
                var t = cfg.tests;
                var base = cfg.symptoms.inrushBaseline || cfg.tests.currentDeadFloor;
                var cur = sim.starterCurrent && sim.starterCurrent > 0
                    ? sim.starterCurrent
                    : ((sim.starterCurrentMult || 1) > 1 ? base * (sim.starterCurrentMult || 1) : 0);
                if (sim.starterState !== 'CRANKING' || cur <= 0) {
                    return areasNeutral('Tes arus perlu kondisi cranking aktif');
                }
                if (cur > base * t.currentInrushMult) {
                    return [
                        { candidate: 'BATTERY', verdict: 'NEUTRAL', note: 'arus tinggi tidak meruntuhkan baterai' },
                        { candidate: 'CABLE', verdict: 'NEUTRAL', note: 'arus tinggi malah menandakan distribusi jalan' },
                        { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'arus tinggi juga lewat ground' },
                        { candidate: 'STARTER', verdict: 'SUPPORTING', note: 'arus inrush berlebih -> starter/gesekan abnormal' },
                        { candidate: 'MECHANICAL', verdict: 'SUPPORTING', note: 'kompresi/brush membebani berlebih' }
                    ];
                }
                if (cur < t.currentDeadFloor) {
                    return [
                        { candidate: 'BATTERY', verdict: 'NEUTRAL', note: 'arus kecil bisa karena sisi beban gagal' },
                        { candidate: 'CABLE', verdict: 'SUPPORTING', note: 'tahanan tinggi membatasi arus' },
                        { candidate: 'GROUND', verdict: 'SUPPORTING', note: 'ground resistif membatasi arus' },
                        { candidate: 'STARTER', verdict: 'SUPPORTING', note: 'starter tidak menarik arus -> motor/contactor gagal' },
                        { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'data mekanis belum ada' }
                    ];
                }
                return areasNeutral('Arus dalam band normal');
            }
        },
        {
            id: 'TEST_STARTER_INSPECTION', name: 'Starter & Mechanical Inspection', difficulty: 'MEDIUM',
            diagnosticValue: 0.86, timeCost: 4, risk: 'LOW', context: 'SERVICE',
            areas: ['BATTERY', 'CABLE', 'GROUND', 'STARTER', 'MECHANICAL'],
            kpi: ['starterMotorFault', 'starterEfficiency', 'solenoidMainFail', 'relayFaultType', 'solenoidFail', 'ignitionFail'],
            interpret: function (sim, cfg) {
                if (sim.starterMotorFault === true) {
                    return [
                        { candidate: 'BATTERY', verdict: 'CONTRADICTING', note: 'starter mati bukan karena baterai' },
                        { candidate: 'CABLE', verdict: 'CONTRADICTING', note: 'kabel terbukti utuh di inspeksi' },
                        { candidate: 'GROUND', verdict: 'CONTRADICTING', note: 'ground terbukti utuh di inspeksi' },
                        { candidate: 'STARTER', verdict: 'SUPPORTING', note: 'motor starter gagal (winding/kontak)' },
                        { candidate: 'FAULT_STARTER_MOTOR', verdict: 'SUPPORTING', note: 'motor starter terbukti rusak' },
                        { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'inspeksi starter bukan ukur gesekan mesin' }
                    ];
                }
                if (sim.solenoidMainFail === true) {
                    return [
                        { candidate: 'BATTERY', verdict: 'CONTRADICTING', note: 'baterai sehat saat inspeksi' },
                        { candidate: 'FAULT_SOLENOID_MAIN_CONTACT', verdict: 'SUPPORTING', note: 'kontak utama solenoid tidak menutup' },
                        { candidate: 'STARTER', verdict: 'SUPPORTING', note: 'kegagalan kontak pada solenoid' },
                        { candidate: 'CABLE', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'tidak relevan' }
                    ];
                }
                if (sim.relayFaultType === 'contactOpen') {
                    return [
                        { candidate: 'FAULT_RELAY', verdict: 'SUPPORTING', note: 'relay 30-87 terbuka' },
                        { candidate: 'BATTERY', verdict: 'CONTRADICTING', note: 'baterai sehat saat inspeksi' },
                        { candidate: 'CABLE', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'STARTER', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'tidak relevan' }
                    ];
                }
                if (sim.starterEfficiency != null && sim.starterEfficiency < 0.8) {
                    return [
                        { candidate: 'MECHANICAL', verdict: 'SUPPORTING', note: 'efisiensi starter rendah -> gesekan/kompresi' },
                        { candidate: 'FAULT_MECHANICAL_STARTER', verdict: 'SUPPORTING', note: 'beban mekanis starter abnormal' },
                        { candidate: 'BATTERY', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'CABLE', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'STARTER', verdict: 'NEUTRAL', note: 'belum dinilai' }
                    ];
                }
                return [
                    { candidate: 'BATTERY', verdict: 'NEUTRAL', note: 'hasil inspeksi normal' },
                    { candidate: 'CABLE', verdict: 'NEUTRAL', note: 'hasil inspeksi normal' },
                    { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'hasil inspeksi normal' },
                    { candidate: 'STARTER', verdict: 'CONTRADICTING', note: 'starter tampak sehat, cari sisi lain' },
                    { candidate: 'MECHANICAL', verdict: 'NEUTRAL', note: 'hasil inspeksi normal' }
                ];
            }
        },
        {
            id: 'TEST_CONTINUITY', name: 'Continuity Check (cable/fuse)', difficulty: 'EASY',
            diagnosticValue: 0.6, timeCost: 1, risk: 'LOW', context: 'SERVICE',
            areas: ['BATTERY', 'CABLE', 'GROUND', 'STARTER', 'MECHANICAL'],
            kpi: ['cableState', 'fuseState'],
            interpret: function (sim, cfg) {
                if (sim.cableState === 'OPEN') {
                    return [
                        { candidate: 'CABLE', verdict: 'SUPPORTING', note: 'kabel positif putus' },
                        { candidate: 'FAULT_OPEN_CABLE', verdict: 'SUPPORTING', note: 'open circuit pada kabel positif' },
                        { candidate: 'BATTERY', verdict: 'CONTRADICTING', note: 'bukan masalah baterai' },
                        { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'STARTER', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'tidak relevan' }
                    ];
                }
                if (sim.fuseState === 'OPEN') {
                    return [
                        { candidate: 'CABLE', verdict: 'SUPPORTING', note: 'sekring putus' },
                        { candidate: 'FAULT_OPEN_FUSE', verdict: 'SUPPORTING', note: 'open circuit pada jalur kontrol' },
                        { candidate: 'BATTERY', verdict: 'CONTRADICTING', note: 'bukan masalah baterai' },
                        { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'STARTER', verdict: 'NEUTRAL', note: 'belum dinilai' },
                        { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'tidak relevan' }
                    ];
                }
                return [
                    { candidate: 'CABLE', verdict: 'CONTRADICTING', note: 'kontinuitas kabel/sekring utuh' },
                    { candidate: 'BATTERY', verdict: 'INSUFFICIENT', note: 'kontinuitas tidak menilai kapasitas baterai' },
                    { candidate: 'GROUND', verdict: 'NEUTRAL', note: 'belum dinilai' },
                    { candidate: 'STARTER', verdict: 'NEUTRAL', note: 'belum dinilai' },
                    { candidate: 'MECHANICAL', verdict: 'INSUFFICIENT', note: 'tidak relevan' }
                ];
            }
        }
    ];

    function testDef(id) {
        for (var i = 0; i < TEST_DEFS.length; i++) {
            if (TEST_DEFS[i].id === id) return TEST_DEFS[i];
        }
        return null;
    }
    function testSnapshot(def) {
        var snap = {};
        var sim = simRef();
        def.kpi.forEach(function (k) { snap[k] = sim[k]; });
        return snap;
    }
    function runTest(testId) {
        if (!engine.scenario) return { ok: false, error: 'NO_SCENARIO' };
        var def = testDef(testId);
        if (!def) return { ok: false, error: 'UNKNOWN_TEST', testId: testId };
        engine.scenario.testSeq = (engine.scenario.testSeq || 0) + 1;
        var measurements = testSnapshot(def);
        var evidence = def.interpret(simRef(), engine.config);
        var record = {
            seq: engine.scenario.testSeq,
            test: def.id,
            name: def.name,
            difficulty: def.difficulty,
            diagnosticValue: def.diagnosticValue,
            timeCost: def.timeCost,
            risk: def.risk,
            measurements: measurements,
            evidence: evidence,
            at: nowTimeMs()
        };
        engine.scenario.testHistory.push(record);
        recordPathStep('TEST:' + def.id);
        return { ok: true, test: def.id, measurements: measurements, evidence: evidence, lastRun: record };
    }

    // Pakai bukti hasil tes utk meng-update hipotesis (alur §18: test -> interpret -> update)
    function applyTestEvidence(hypId, testId) {
        var res = runTest(testId);
        if (!res.ok) return res;
        var hyp = findHypothesis(hypId);
        if (!hyp) return { ok: false, error: 'NO_HYPOTHESIS', testResult: res };
        var that = res.evidence.filter(function (e) { return e.candidate === hyp.faultId; });
        if (that.length === 0) {
            var grp = groupOfFault(hyp.faultId);
            that = res.evidence.filter(function (e) { return e.candidate === grp; });
        }
        var chosen = that.length ? that[0] : { verdict: 'NEUTRAL', note: 'tidak ada bukti spesifik utk hipotesis ini' };
        var rec = recordEvidence(hypId, { test: testId, verdict: chosen.verdict, note: chosen.note });
        if (!rec.ok) return rec;
        return { ok: true, id: hypId, verdict: chosen.verdict, note: chosen.note, hypothesis: rec.hypothesis, testResult: res };
    }
    function getDiagnosticEvidence() {
        if (!engine.scenario) return [];
        var out = [];
        engine.scenario.testHistory.forEach(function (rec) {
            rec.evidence.forEach(function (e) {
                out.push({
                    test: rec.test, seq: rec.seq, candidate: e.candidate,
                    verdict: e.verdict, note: e.note, at: rec.at
                });
            });
        });
        return out;
    }
    function getTestHistory() {
        if (!engine.scenario) return [];
        return engine.scenario.testHistory.map(function (rec) {
            return { seq: rec.seq, test: rec.test, name: rec.name, difficulty: rec.difficulty,
                diagnosticValue: rec.diagnosticValue, timeCost: rec.timeCost, risk: rec.risk,
                measurements: (function () { var o = {}; for (var k in rec.measurements) if (Object.prototype.hasOwnProperty.call(rec.measurements, k)) o[k] = rec.measurements[k]; return o; })(),
                at: rec.at };
        });
    }
    function listTestLibrary() {
        return TEST_DEFS.map(function (d) {
            return { id: d.id, name: d.name, difficulty: d.difficulty, diagnosticValue: d.diagnosticValue,
                timeCost: d.timeCost, risk: d.risk, context: d.context, areas: d.areas.slice() };
        });
    }
    function getTestDefinition(id) {
        var d = testDef(id);
        if (!d) return null;
        return { id: d.id, name: d.name, difficulty: d.difficulty, diagnosticValue: d.diagnosticValue,
            timeCost: d.timeCost, risk: d.risk, context: d.context, areas: d.areas.slice(), kpi: d.kpi.slice() };
    }
    function evaluateTest(testId) {
        return runTest(testId);
    }

    /* ---------------- scenario engine (§13/§15 + createScenario/loadScenario) ---------------- */
    // Katalog scenario terstruktur (jawaban fault TIDAK bocor ke listScenarios —
    // hanya meta pedagogis). loadScenario memasang fault tersembunyi ke engine.
    var DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];
    /* 20 CASES (§20 CASES / §31-32): 5 BEGINNER + 5 INTERMEDIATE +
       5 ADVANCED + 5 EXPERT. Difficulty berbasis faktor §32
       (jumlah fault, interaksi, ambiguitas, intermittency, progresi,
       panjang jalur diagnosis) — bukan sekadar jumlah klik. */
    var SCENARIO_DEFS = [
        /* ---- BEGINNER (5) ---- */
        {
            id: 'SC_WEAK_BATTERY', title: 'Weak Battery', skillFocus: 'battery',
            complaint: 'Starter cranks slowly, lights dim slightly',
            vehicleProfile: 'TRAINER_A', difficulty: 'BEGINNER',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [{ faultId: 'FAULT_BATTERY_WEAK', severity: 0.7 }],
            expectedSymptoms: ['LOW_CRANKING_VOLTAGE', 'SLOW_CRANK']
        },
        {
            id: 'SC_LOOSE_TERMINAL', title: 'Loose Battery Terminal', skillFocus: 'connection',
            complaint: 'Intermittent no crank, click when trying',
            vehicleProfile: 'TRAINER_A', difficulty: 'BEGINNER',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [{ faultId: 'FAULT_LOOSE_TERMINAL', severity: 0.9 }],
            expectedSymptoms: ['SLOW_CRANK', 'HIGH_VOLTAGE_DROP_POSITIVE', 'INTERMITTENT_NO_CRANK']
        },
        {
            id: 'SC_OPEN_FUSE', title: 'Open Fuse', skillFocus: 'power-feed',
            complaint: 'Nothing happens at key turn, dash lights still on',
            vehicleProfile: 'TRAINER_A', difficulty: 'BEGINNER',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [{ faultId: 'FAULT_OPEN_FUSE', severity: 0.9 }],
            expectedSymptoms: ['NO_CRANK', 'OPEN_CIRCUIT']
        },
        {
            id: 'SC_SOLENOID_CONTROL', title: 'Solenoid Control Failure', skillFocus: 'solenoid',
            complaint: 'Single click at key turn, no cranking',
            vehicleProfile: 'TRAINER_A', difficulty: 'BEGINNER',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [{ faultId: 'FAULT_SOLENOID_CONTROL', severity: 0.8 }],
            expectedSymptoms: ['NO_CRANK', 'CLICK_OR_BUZZ_NO_CRANK']
        },
        {
            id: 'SC_IGNITION_SWITCH', title: 'Ignition Switch Failure', skillFocus: 'ignition',
            complaint: 'No response at key turn, accessory circuit works',
            vehicleProfile: 'TRAINER_A', difficulty: 'BEGINNER',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [{ faultId: 'FAULT_IGNITION_SWITCH', severity: 0.8 }],
            expectedSymptoms: ['NO_CRANK', 'INTERMITTENT_NO_CRANK']
        },

        /* ---- INTERMEDIATE (5) ---- */
        {
            id: 'SC_POOR_GROUND', title: 'Poor Ground Return', skillFocus: 'ground',
            complaint: 'Starter sometimes does not crank',
            vehicleProfile: 'TRAINER_A', difficulty: 'INTERMEDIATE',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [{ faultId: 'FAULT_POOR_GROUND', severity: 0.7 }],
            expectedSymptoms: ['INTERMITTENT_NO_CRANK', 'GROUND_VOLTAGE_DROP', 'SLOW_CRANK']
        },
        {
            id: 'SC_OPEN_CABLE', title: 'Open Positive Cable', skillFocus: 'power-feed',
            complaint: 'Engine will not crank at all',
            vehicleProfile: 'TRAINER_A', difficulty: 'INTERMEDIATE',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [{ faultId: 'FAULT_OPEN_CABLE', severity: 1 }],
            expectedSymptoms: ['NO_CRANK', 'OPEN_CIRCUIT']
        },
        {
            id: 'SC_HIGH_RESISTANCE', title: 'High Positive Cable Resistance', skillFocus: 'power-feed',
            complaint: 'Cranking sluggish after heavy usage',
            vehicleProfile: 'TRAINER_A', difficulty: 'INTERMEDIATE',
            environment: { temperature: 'HOT', batteryCondition: 'NORMAL' },
            faults: [{ faultId: 'FAULT_HIGH_POSITIVE_RESISTANCE', severity: 0.7 }],
            expectedSymptoms: ['SLOW_CRANK', 'HIGH_VOLTAGE_DROP_POSITIVE']
        },
        {
            id: 'SC_RELAY', title: 'Starter Relay Stuck Open', skillFocus: 'relay',
            complaint: 'Click from relay but engine does not crank',
            vehicleProfile: 'TRAINER_A', difficulty: 'INTERMEDIATE',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [{ faultId: 'FAULT_RELAY', severity: 0.7 }],
            expectedSymptoms: ['NO_CRANK']
        },
        {
            id: 'SC_STARTER_MOTOR', title: 'Starter Motor Failure', skillFocus: 'starter',
            complaint: 'Strong click, then silence',
            vehicleProfile: 'TRAINER_A', difficulty: 'INTERMEDIATE',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [{ faultId: 'FAULT_STARTER_MOTOR', severity: 0.9 }],
            expectedSymptoms: ['NO_CRANK']
        },

        /* ---- ADVANCED (5) ---- */
        {
            id: 'SC_MULTI_WEAK_GROUND', title: 'Weak Battery + Poor Ground', skillFocus: 'multi-fault',
            complaint: 'Cranking very slow, battery tested normal-ish',
            vehicleProfile: 'TRAINER_A', difficulty: 'ADVANCED',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [
                { faultId: 'FAULT_BATTERY_WEAK', severity: 0.6 },
                { faultId: 'FAULT_POOR_GROUND', severity: 0.6 }
            ],
            expectedSymptoms: ['SLOW_CRANK', 'GROUND_VOLTAGE_DROP', 'HIGH_INRUSH_CURRENT']
        },
        {
            id: 'SC_INTERMITTENT_RELAY', title: 'Intermittent Starter Relay', skillFocus: 'intermittent',
            complaint: 'Click then start, sometimes no response',
            vehicleProfile: 'TRAINER_A', difficulty: 'ADVANCED',
            environment: { temperature: 'COLD', batteryCondition: 'NORMAL' },
            faults: [{
                faultId: 'FAULT_RELAY', severity: 0.8,
                intermittent: { mode: 'START_ATTEMPT_BASED', activeProb: 0.5 }
            }],
            expectedSymptoms: ['INTERMITTENT_NO_CRANK']
        },
        {
            id: 'SC_PROGRESSIVE_STARTER', title: 'Progressive Mechanical Drag', skillFocus: 'progressive',
            complaint: 'Cranking gets slower as car is driven',
            vehicleProfile: 'TRAINER_A', difficulty: 'ADVANCED',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [{
                faultId: 'FAULT_MECHANICAL_STARTER', severity: 0.3,
                progressive: { enabled: true, trigger: 'START_ATTEMPT', rate: 0.12 }
            }],
            expectedSymptoms: ['SLOW_CRANK', 'GRINDING']
        },
        {
            id: 'SC_MULTI_LOOSE_RELAY', title: 'Loose Terminal + Relay', skillFocus: 'multi-fault',
            complaint: 'Random clicking, sometimes starts',
            vehicleProfile: 'TRAINER_A', difficulty: 'ADVANCED',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [
                { faultId: 'FAULT_LOOSE_TERMINAL', severity: 0.7 },
                { faultId: 'FAULT_RELAY', severity: 0.6 }
            ],
            expectedSymptoms: ['INTERMITTENT_NO_CRANK',
                'SLOW_CRANK', 'HIGH_VOLTAGE_DROP_POSITIVE']
        },
        {
            id: 'SC_DISCHARGED_SYSTEM', title: 'Discharged Battery System', skillFocus: 'battery',
            complaint: 'Starter barely turns, interior lights nearly off',
            vehicleProfile: 'TRAINER_A', difficulty: 'ADVANCED',
            environment: { temperature: 'NORMAL', batteryCondition: 'WEAK' },
            faults: [{ faultId: 'FAULT_BATTERY_DISCHARGED', severity: 0.7 }],
            expectedSymptoms: ['NO_CRANK', 'LOW_CRANKING_VOLTAGE']
        },

        /* ---- EXPERT (5) ---- */
        {
            id: 'SC_TRIPLE_WEAK_GROUND_LOOSE', title: 'Weak Battery + Ground + Loose Terminal', skillFocus: 'multi-fault',
            complaint: 'Intermittent very slow cranking, sometimes just clicks',
            vehicleProfile: 'TRAINER_B', difficulty: 'EXPERT',
            environment: { temperature: 'COLD', batteryCondition: 'NORMAL' },
            faults: [
                { faultId: 'FAULT_BATTERY_WEAK', severity: 0.5 },
                { faultId: 'FAULT_POOR_GROUND', severity: 0.5 },
                { faultId: 'FAULT_LOOSE_TERMINAL', severity: 0.7 }
            ],
            expectedSymptoms: ['SLOW_CRANK', 'GROUND_VOLTAGE_DROP', 'HIGH_INRUSH_CURRENT',
                'LOW_CRANKING_VOLTAGE', 'INTERMITTENT_NO_CRANK', 'HIGH_VOLTAGE_DROP_POSITIVE']
        },
        {
            id: 'SC_INTERMITTENT_PROGRESSIVE_GROUND', title: 'Intermittent + Progressive Ground', skillFocus: 'intermittent+progressive',
            complaint: 'No crank at random moments, getting frequent over days',
            vehicleProfile: 'TRAINER_A', difficulty: 'EXPERT',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [{
                faultId: 'FAULT_POOR_GROUND', severity: 0.4,
                intermittent: { mode: 'TIME_BASED', activeDuration: 1500, inactiveDuration: 3000 },
                progressive: { enabled: true, trigger: 'START_ATTEMPT', rate: 0.1 }
            }],
            expectedSymptoms: ['INTERMITTENT_NO_CRANK', 'GROUND_VOLTAGE_DROP', 'SLOW_CRANK']
        },
        {
            id: 'SC_CABLE_AND_IGNITION', title: 'Cable Resistance + Ignition Switch', skillFocus: 'multi-fault',
            complaint: 'Dead then works after wiggling the key',
            vehicleProfile: 'TRAINER_B', difficulty: 'EXPERT',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [
                { faultId: 'FAULT_HIGH_POSITIVE_RESISTANCE', severity: 0.6 },
                { faultId: 'FAULT_IGNITION_SWITCH', severity: 0.7 }
            ],
            expectedSymptoms: ['SLOW_CRANK', 'HIGH_VOLTAGE_DROP_POSITIVE', 'INTERMITTENT_NO_CRANK']
        },
        {
            id: 'SC_GROUND_AND_STARTER', title: 'Ground + Degraded Starter Motor', skillFocus: 'differential-diagnosis',
            complaint: 'Cranking weak but battery and cable check out',
            vehicleProfile: 'TRAINER_C', difficulty: 'EXPERT',
            environment: { temperature: 'NORMAL', batteryCondition: 'NORMAL' },
            faults: [
                { faultId: 'FAULT_POOR_GROUND', severity: 0.6 },
                { faultId: 'FAULT_STARTER_MOTOR', severity: 0.5 }
            ],
            expectedSymptoms: ['SLOW_CRANK', 'GROUND_VOLTAGE_DROP', 'NO_CRANK']
        },
        {
            id: 'SC_QUAD_EXPERT', title: 'Quad-Fault Real-World Chain', skillFocus: 'diagnostic-chaining',
            complaint: 'Complex symptoms: slow, clicky, drop-prone on cold mornings',
            vehicleProfile: 'TRAINER_C', difficulty: 'EXPERT',
            environment: { temperature: 'COLD', batteryCondition: 'WEAK' },
            faults: [
                { faultId: 'FAULT_BATTERY_WEAK', severity: 0.4 },
                { faultId: 'FAULT_HIGH_POSITIVE_RESISTANCE', severity: 0.4 },
                { faultId: 'FAULT_POOR_GROUND', severity: 0.5 },
                { faultId: 'FAULT_LOOSE_TERMINAL', severity: 0.5 }
            ],
            expectedSymptoms: ['SLOW_CRANK', 'HIGH_VOLTAGE_DROP_POSITIVE', 'GROUND_VOLTAGE_DROP',
                'HIGH_INRUSH_CURRENT', 'INTERMITTENT_NO_CRANK', 'LOW_CRANKING_VOLTAGE']
        }
    ];

    // temuan gejala dari fault (deterministik, utk generateScenario + validasi)
    function symptomsForFault(fid) {
        var def = FAULTS_DEF[fid];
        if (!def) return [];
        return def.symptoms.slice();
    }

    function interactionForIds(a, b) {
        for (var i = 0; i < INTERACTION_DEFS.length; i++) {
            var fs = INTERACTION_DEFS[i].faults;
            if (fs.indexOf(a) >= 0 && fs.indexOf(b) >= 0) return INTERACTION_DEFS[i];
        }
        return null;
    }

    // Faktor difficulty §32 (bukan sekadar jumlah klik)
    function computeDifficultyFactors(s) {
        var f = s.faults || [];
        var fids = f.map(function (x) { return x.faultId || x.id; });
        var hasInteraction = false, i, j;
        for (i = 0; i < fids.length && !hasInteraction; i++) {
            for (j = i + 1; j < fids.length; j++) {
                if (interactionForIds(fids[i], fids[j])) { hasInteraction = true; break; }
            }
        }
        var intermittency = f.some(function (x) { return x.intermittent && x.intermittent.mode && x.intermittent.mode !== 'OFF'; });
        var progression = f.some(function (x) { return x.progressive && x.progressive.enabled; });
        var ambiguity = (s.expectedSymptoms || []).length;
        var measComplex = { BEGINNER: 1, INTERMEDIATE: 2, ADVANCED: 3, EXPERT: 4 }[s.difficulty] || 1;
        var pathLength = 2 + fids.length * 2 + (hasInteraction ? 1 : 0) +
            ((intermittency || progression) ? 1 : 0);
        return {
            faultCount: fids.length,
            hasInteraction: hasInteraction,
            intermittency: intermittency,
            progression: progression,
            ambiguity: ambiguity,
            measurementComplexity: measComplex,
            pathLength: pathLength
        };
    }

    // metadate katalog tanpa jawaban (no leak)
    function scenarioMeta(s) {
        return {
            id: s.id, title: s.title || s.id, complaint: s.complaint,
            vehicleProfile: s.vehicleProfile, difficulty: s.difficulty,
            environment: { temperature: s.environment.temperature, batteryCondition: s.environment.batteryCondition },
            expectedSymptoms: (s.expectedSymptoms || []).slice(),
            skillFocus: s.skillFocus || null,
            factors: computeDifficultyFactors(s)
        };
    }
    function listScenarios(filter) {
        var out = SCENARIO_DEFS.concat(engine.customScenarios || []);
        if (filter && filter.difficulty) {
            out = out.filter(function (s) { return s.difficulty === filter.difficulty; });
        }
        return out.map(scenarioMeta);
    }
    function findScenarioDef(id) {
        var i;
        for (i = 0; i < SCENARIO_DEFS.length; i++) if (SCENARIO_DEFS[i].id === id) return SCENARIO_DEFS[i];
        for (i = 0; i < (engine.customScenarios || []).length; i++) {
            if (engine.customScenarios[i].id === id) return engine.customScenarios[i];
        }
        return null;
    }
    function validateScenario(data) {
        var errors = [];
        var d = data || {};
        if (!d.id || typeof d.id !== 'string') errors.push('id wajib diisi');
        if (!d.complaint || typeof d.complaint !== 'string') errors.push('complaint wajib diisi');
        if (d.faults == null || d.faults.length === 0) errors.push('faults minimal 1');
        else {
            d.faults.forEach(function (f) {
                if (!f) { errors.push('entri faults tidak valid'); return; }
                var fid = f.faultId || f.id;
                if (!FAULTS_DEF[fid]) errors.push('fault tidak dikenal: ' + fid);
                if (f.severity != null && (f.severity < 0 || f.severity > 1)) errors.push('severity di luar 0..1: ' + fid);
            });
        }
        if (d.difficulty && DIFFICULTIES.indexOf(d.difficulty) < 0) errors.push('difficulty tidak dikenal');
        if (d.vehicleProfile && !/^[A-Z0-9_]+$/.test(d.vehicleProfile)) errors.push('vehicleProfile invalid');
        if (d.vehicleProfile && !findProfile(d.vehicleProfile)) errors.push('vehicleProfile tidak dikenal: ' + d.vehicleProfile);
        if (d.expectedSymptoms) {
            d.expectedSymptoms.forEach(function (s) {
                if (!SYMPTOM_DEFS[s]) errors.push('symptom tidak dikenal: ' + s);
            });
        }
        return { ok: errors.length === 0, errors: errors, data: d };
    }
    function installFromScenario(def) {
        var c = def || {};
        var faults = (c.faults || []).map(function (f) {
            return {
                id: f.faultId || f.id,
                severity: f.severity != null ? f.severity : 1,
                intermittent: f.intermittent,
                progressive: f.progressive
            };
        });
        return installScenario({
            id: c.id, vehicleProfile: c.vehicleProfile, complaint: c.complaint,
            difficulty: c.difficulty, expectedSymptoms: c.expectedSymptoms, environment: c.environment,
            faults: faults
        });
    }
    function loadScenario(id) {
        var def = findScenarioDef(id);
        if (!def) return { ok: false, error: 'UNKNOWN_SCENARIO', id: id };
        var state = installFromScenario(def);
        recordPathStep('LOAD_SCENARIO:' + id);
        return { ok: true, scenario: scenarioMeta(def), state: state };
    }
    function createScenario(data) {
        var v = validateScenario(data);
        if (!v.ok || !v.data || !v.data.id) {
            return { ok: false, error: 'INVALID_SCENARIO', errors: v.errors, data: data };
        }
        if (findScenarioDef(v.data.id)) return { ok: false, error: 'DUPLICATE_ID', id: v.data.id };
        v.data.title = v.data.title || v.data.complaint;
        v.data.skillFocus = v.data.skillFocus || 'custom';
        v.data.environment = v.data.environment || { temperature: 'NORMAL', batteryCondition: 'NORMAL' };
        v.data.vehicleProfile = v.data.vehicleProfile || 'TRAINER_A';
        v.data.difficulty = v.data.difficulty || 'INTERMEDIATE';
        if (!v.data.expectedSymptoms) {
            var syms = [];
            v.data.faults.forEach(function (f) {
                symptomsForFault(f.faultId || f.id).forEach(function (s) {
                    if (syms.indexOf(s) < 0) syms.push(s);
                });
            });
            v.data.expectedSymptoms = syms;
        }
        engine.customScenarios.push(v.data);
        return { ok: true, id: v.data.id, scenario: scenarioMeta(v.data) };
    }
    function getScenarioAnswer(id) {
        var def = findScenarioDef(id);
        if (!def) return null;
        return {
            id: def.id,
            faults: def.faults.map(function (f) { return { faultId: f.faultId || f.id, severity: f.severity }; }),
            expectedSymptoms: def.expectedSymptoms.slice(),
            difficulty: def.difficulty
        };
    }

    // Generator deterministik (mulberry32 seed lokal — tidak mengganggu RNG scenario)
    function pick(rng, arr) {
        return arr[Math.floor(rng() * arr.length) % arr.length];
    }
    function pickWeighted(rng, items, weights) {
        var total = 0, i;
        for (i = 0; i < weights.length; i++) total += weights[i];
        var r = rng() * total;
        for (i = 0; i < items.length; i++) {
            r -= weights[i];
            if (r <= 0) return items[i];
        }
        return items[items.length - 1];
    }
    function generateScenario(seed) {
        var s = seed != null ? seed : engine.seed;
        var g = makeSeeded(s);
        var cfg = engine.config.scenario;
        var diffTiers = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
        var diff = pickWeighted(g, diffTiers, cfg.difficultyWeights || [0.4, 0.35, 0.25]);
        var pools = {
            BEGINNER: ['FAULT_BATTERY_WEAK', 'FAULT_LOOSE_TERMINAL', 'FAULT_OPEN_FUSE', 'FAULT_SOLENOID_CONTROL'],
            INTERMEDIATE: ['FAULT_POOR_GROUND', 'FAULT_HIGH_POSITIVE_RESISTANCE', 'FAULT_RELAY',
                'FAULT_BATTERY_DISCHARGED', 'FAULT_SOLENOID_MAIN_CONTACT', 'FAULT_IGNITION_SWITCH',
                'FAULT_STARTER_MOTOR', 'FAULT_OPEN_CABLE'],
            ADVANCED: ['FAULT_MECHANICAL_STARTER', 'FAULT_SOLENOID_MAIN_CONTACT',
                'FAULT_BATTERY_WEAK', 'FAULT_POOR_GROUND', 'FAULT_RELAY']
        };
        var pool = pools[diff].slice();
        var count = diff === 'BEGINNER' ? 1 : (diff === 'INTERMEDIATE' ? (g() < 0.3 ? 2 : 1) : 2);
        var chosen = [];
        while (chosen.length < count && pool.length > 0) {
            var idx = Math.floor(g() * pool.length) % pool.length;
            chosen.push(pool.splice(idx, 1)[0]);
        }
        var faults = chosen.map(function (fid, i) {
            var f = { faultId: fid };
            if (diff === 'BEGINNER') {
                f.severity = roundTo(0.7 + 0.25 * g(), 2);
            } else if (diff === 'INTERMEDIATE') {
                f.severity = roundTo(0.4 + 0.45 * g(), 2);
            } else {
                f.severity = roundTo(i === 0 ? 0.7 + 0.2 * g() : 0.3 + 0.4 * g(), 2);
            }
            if (diff === 'ADVANCED' && g() < 0.35) {
                if (g() < 0.5) {
                    f.intermittent = { mode: 'START_ATTEMPT_BASED', activeProb: roundTo(0.3 + 0.4 * g(), 2) };
                } else {
                    f.progressive = { enabled: true, trigger: 'START_ATTEMPT', rate: roundTo(0.08 + 0.1 * g(), 2) };
                }
            }
            return f;
        });
        var complaintBank = {
            BEGINNER: ['Starter cranks slowly', 'Engine does not start', 'Starter is sluggish'],
            INTERMEDIATE: ['Starter sometimes does not crank', 'Click then no start', 'Cranking sounds weak'],
            ADVANCED: ['Cranking very slow, gets worse over time', 'Intermittent no response at key turn',
                'Battery seems fine but crank is weak']
        };
        var syms = [];
        faults.forEach(function (f) {
            symptomsForFault(f.faultId).forEach(function (s2) { if (syms.indexOf(s2) < 0) syms.push(s2); });
        });
        var temps = cfg.environmentPool || ['NORMAL', 'COLD', 'HOT'];
        var def = {
            id: 'SC_GEN_' + String(s),
            title: 'Generated ' + diff + ' scenario',
            complaint: pick(g, complaintBank[diff]),
            vehicleProfile: 'TRAINER_A',
            difficulty: diff,
            environment: {
                temperature: pick(g, temps),
                batteryCondition: 'NORMAL'
            },
            faults: faults,
            expectedSymptoms: syms,
            skillFocus: 'generated'
        };
        return def;
    }

    /* ---------------- interaction API (§8) ---------------- */
    function copyInteraction(ix) {
        return {
            id: ix.id, label: ix.label, faults: ix.faults.slice(), combine: ix.combine,
            severity: ix.severity, secondarySymptoms: ix.secondarySymptoms.slice(),
            diagnosticNotes: ix.diagnosticNotes.slice(),
            simChanges: (function () { var o = {}; for (var k in ix.simChanges) if (Object.prototype.hasOwnProperty.call(ix.simChanges, k)) o[k] = ix.simChanges[k]; return o; })()
        };
    }
    function getInteractions() {
        return engine.activeInteractions.map(copyInteraction);
    }
    function getInteraction(id) {
        for (var i = 0; i < engine.activeInteractions.length; i++) {
            if (engine.activeInteractions[i].id === id) return copyInteraction(engine.activeInteractions[i]);
        }
        return null;
    }

    /* ---------------- auto loop (maks 1 interval, §65) ---------------- */
    function startAuto(dtMs) {
        stopAuto();
        engine.autoDt = dtMs || 500;
        if (typeof setInterval !== 'undefined') {
            engine.autoTimer = setInterval(function () { tick(engine.autoDt); }, engine.autoDt);
        }
        return engine.autoTimer;
    }
    function stopAuto() {
        if (engine.autoTimer != null && typeof clearInterval !== 'undefined') {
            clearInterval(engine.autoTimer);
        }
        engine.autoTimer = null;
    }

    /* ---------------- misc ---------------- */
    function nowTimeMs() { return (typeof Date !== 'undefined' ? Date.now() : 0); }
    function listFaultLibrary() {
        return Object.keys(FAULTS_DEF).map(function (id) {
            return { id: id, label: FAULTS_DEF[id].label, component: FAULTS_DEF[id].component, faultType: FAULTS_DEF[id].faultType, symptoms: FAULTS_DEF[id].symptoms.slice() };
        });
    }

    /* ---------------- public API ---------------- */
    var api = {
        active: true,
        version: VERSION,
        step: '2-12',

        setConfig: function (c) {
            engine.userCustom = mergeDeep(engine.userCustom || {}, c || root.PHASE7_CONFIG || null);
            rebuildConfig();
            if (engine.scenario) applyLayer();
            return engine.config;
        },
        getConfig: function () { return engine.config; },

        setSeed: function (n) {
            engine.seed = n != null ? n : 12345;
            engine.rng = makeSeeded(engine.seed);
            return engine.seed;
        },

        installScenario: installScenario,
        clearScenario: clearScenario,
        getScenarioState: getScenarioState,

        addFault: addFault,
        removeFault: removeFault,
        enableFault: enableFault,
        disableFault: disableFault,
        setFaultSeverity: setFaultSeverity,
        setIntermittentMode: setIntermittentMode,
        setProgression: setProgression,

        getFaultState: getFaultState,
        getAllFaultStates: getAllFaultStates,
        getActiveSymptoms: getActiveSymptoms,
        evaluateSymptoms: evaluateSymptoms,
        getSymptomMatrix: getSymptomMatrix,
        getSymptom: getSymptom,
        getPossibleCauses: getPossibleCauses,
        getInteractions: getInteractions,
        getInteraction: getInteraction,

        generateHypotheses: generateHypotheses,
        createHypothesis: createHypothesis,
        evaluateHypothesis: evaluateHypothesis,
        recordEvidence: recordEvidence,
        getHypotheses: getHypotheses,
        getHypothesis: getHypothesis,
        getRankedHypotheses: getRankedHypotheses,
        resetHypotheses: resetHypotheses,
        getDiagnosticPath: getDiagnosticPath,
        evaluateTest: evaluateTest,
        runTest: runTest,
        applyTestEvidence: applyTestEvidence,
        getDiagnosticEvidence: getDiagnosticEvidence,
        getTestHistory: getTestHistory,
        listTestLibrary: listTestLibrary,
        getTestDefinition: getTestDefinition,
        listScenarios: listScenarios,
        loadScenario: loadScenario,
        createScenario: createScenario,
        validateScenario: validateScenario,
        getScenarioAnswer: getScenarioAnswer,
        generateScenario: generateScenario,
        getVehicleProfiles: getVehicleProfiles,
        getVehicleProfile: getVehicleProfile,
        setVehicleProfile: setVehicleProfile,
        getActiveVehicleProfile: getActiveVehicleProfile,

        listInteractionDefinitions: function () {
            return INTERACTION_DEFS.map(function (ix) {
                return { id: ix.id, label: ix.label, faults: ix.faults.slice(), combine: ix.combine, secondarySymptoms: ix.secondarySymptoms.slice() };
            });
        },

        tick: tick,
        startAuto: startAuto,
        stopAuto: stopAuto,

        listFaultLibrary: listFaultLibrary
    };

    if (typeof root !== 'undefined') root.Phase7 = api;
    else if (typeof window !== 'undefined') window.Phase7 = api;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));