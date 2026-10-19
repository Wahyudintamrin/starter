/* ============================================================
   PHASE 4 — CASE DATA / KNOWLEDGE BASE / REPAIR DATA
   ------------------------------------------------------------
   Data murni (tanpa logika). Engine + UI berada di diagnosticLab.js.
   Nilai threshold di bawah adalah nilai simulasi-proyek ini,
   bukan spesifikasi universal kendaraan (lihat Phase 3 docs).
   ============================================================ */
'use strict';

/* ---------- Signature helper (ringkas) ---------- */
// A signature adalah "bukti pengukuran" yang mendukung diagnosis tertentu.
// { mode, red, black, during, min, max, ol, label, note }
const _S = (mode, red, black, min, max, during) => ({
    mode, red, black, min, max,
    during: during || '*',
    ol: false,
});
const _OL = (mode, red, black, during, label, note) => ({
    mode, red, black, ol: true,
    during: during || '*',
    label: label || '',
    note: note || '',
});

window.DIAGNOSTIC_CONFIG = {
    // Threshold pengukuran (simulation-specific).
    batteryGood: 12.6,
    batteryLow: 12.0,
    dropMaxNormal: 0.5,
    dropWarn: 0.35,
    ohmContinuityMax: 10,

    // Ambang kepercayaan (evidence-based).
    confidenceCounts: { LOW: 0, MEDIUM: 1, HIGH: 2 },

    // Bobot skor (persen).
    scoring: {
        initialInspection: 10,
        measurementProcedure: 20,
        correctMeasurements: 20,
        diagnosticReasoning: 20,
        rootCause: 15,
        repairProcedure: 10,
        verification: 5,
    },

    // Penalty (angka poin yang dikurangi dari bobot terkait).
    penalties: {
        wrongHypothesis: 6,        // kesimpulan salah
        incorrectProbe: 2,         // pemasangan probe tidak tepat
        energizedResistance: 4,    // tes Ω saat sistem berenergi
        skippedMeasurement: 3,     // melewatkan pengukuran yang dibutuhkan
        wrongRepair: 7,            // penggantian komponen acak / salah
        repairNoVerify: 2,         // repair tanpa verifikasi
        repeatedTest: 1,           // pengulangan tes tidak perlu
    },

    // Level hint mengurangi skor (poin).
    hints: { 1: 1, 2: 2, 3: 3 },

    storageKey: 'phase4DiagnosticSessions',
    debugMode: false,               // DEBUG MODE OFF secara default
};

/* ============================================================
   KNOWLEDGE BASE
   ------------------------------------------------------------
   DIAGNOSTIC_KNOWLEDGE[component][faultType] =
   { label, componentLabel, faultTypeLabel, repairId,
     faultKey, params (opsional), tests, signature, observation, hints }
   ============================================================ */
const DIAGNOSTIC_KNOWLEDGE = {

    battery: {
        WEAK: {
            label: 'Weak Battery / Baterai Lemah',
            componentLabel: 'Battery',
            faultTypeLabel: 'WEAK',
            repairId: 'REPLACE_BATTERY',
            faultKey: 'weakBattery',
            params: null,
            tests: ['batteryVoltage', 'crankingVoltage', 'starterCurrent', 'starterRPM'],
            signature: [
                _S('V', 'batteryPositive', 'batteryNegative', 11.95, 12.05),
                _S('V', 'batteryPositive', 'batteryNegative', 11.25, 11.45, ['STARTER_CRANKING', 'PINION_ENGAGED']),
                _S('V', 'starterPositive', 'batteryNegative', 11.10, 11.30, ['STARTER_CRANKING', 'PINION_ENGAGED']),
                _S('A', 'batteryPositive', 'batteryNegative', 115, 145, ['STARTER_CRANKING', 'PINION_ENGAGED']),
            ],
            observation: [
                { field: 'starter', expect: 'CRANKING' },
                { field: 'starterRPM', max: 199 },
            ],
            hints: {
                1: 'Periksa sumber listrik terlebih dahulu.',
                2: 'Ukur tegangan antara battery positive dan battery negative saat kondisi diam, lalu saat cranking.',
                3: 'Bandingkan tegangan battery saat diam (~12.0V) dengan saat cranking (sangat turun). Starter RPM juga rendah.',
            },
        },
        DISCHARGED: {
            label: 'Discharged Battery / Baterai Discharged',
            componentLabel: 'Battery',
            faultTypeLabel: 'DISCHARGED',
            repairId: 'CHARGE_BATTERY',
            faultKey: 'dischargedBattery',
            params: null,
            tests: ['batteryVoltage', 'starterCurrent'],
            signature: [
                _S('V', 'batteryPositive', 'batteryNegative', 10.9, 11.1),
                _S('V', 'batteryPositive', 'batteryNegative', 10.9, 11.1, ['STARTER_CRANKING', 'PINION_ENGAGED', 'SOLENOID_ACTIVE', 'START_REQUEST']),
            ],
            observation: [
                { field: 'relay', expect: 'OFF' },
                { field: 'starter', expect: 'OFF' },
            ],
            hints: {
                1: 'Periksa tegangan battery dalam keadaan diam.',
                2: 'Ukur battery positive → battery negative tanpa beban.',
                3: 'Battery di bawah 11.5V tidak mampu mensuplai arus cranking; bandingkan dengan battery dalam kondisi normal (12.6V).',
            },
        },
    },

    terminal: {
        HIGH_RESISTANCE: {
            label: 'Loose / Corroded Battery Terminal',
            componentLabel: 'Battery Terminal',
            faultTypeLabel: 'HIGH_RESISTANCE',
            repairId: 'TIGHTEN_BATTERY_TERMINAL',
            faultKey: null,
            params: { terminalResistance: 0.01 },
            tests: ['batteryVoltage', 'crankingVoltage', 'starterRPM', 'terminalResistance'],
            signature: [
                _S('V', 'batteryPositive', 'batteryNegative', 12.45, 12.7),
                _S('V', 'batteryPositive', 'batteryNegative', 10.5, 10.8, ['STARTER_CRANKING', 'PINION_ENGAGED']),
                _S('V', 'starterPositive', 'batteryNegative', 10.4, 10.65, ['STARTER_CRANKING', 'PINION_ENGAGED']),
                _S('A', 'batteryPositive', 'batteryNegative', 115, 145, ['STARTER_CRANKING', 'PINION_ENGAGED']),
                _S('OHM', 'batteryPositive', 'fuseInput', 0.008, 0.02),
            ],
            observation: [
                { field: 'starter', expect: 'CRANKING' },
                { field: 'starterRPM', max: 199 },
                { field: 'batteryPositive', max: 10.8 },
            ],
            hints: {
                1: 'Battery tampak normal saat diam tetapi turun drastis saat dibebani.',
                2: 'Ukur tegangan battery saat cranking dan bandingkan resistansi battery+ → fuse input.',
                3: 'Terminal longgar/korosi membuat voltage drop besar pada koneksi battery sehingga starter berputar lambat.',
            },
        },
    },

    fuse: {
        OPEN: {
            label: 'Open Control Fuse',
            componentLabel: 'Fuse',
            faultTypeLabel: 'OPEN',
            repairId: 'REPLACE_FUSE',
            faultKey: 'openFuse',
            params: null,
            tests: ['fuseInputVoltage', 'fuseOutputVoltage', 'fuseContinuity'],
            signature: [
                _S('V', 'fuseInput', 'batteryNegative', 12.45, 12.7),
                _S('V', 'fuseOutput', 'batteryNegative', -0.01, 0.01),
                _OL('CONT', 'fuseInput', 'fuseOutput'),
            ],
            observation: [
                { field: 'relay', expect: 'OFF' },
                { field: 'starter', expect: 'OFF' },
            ],
            hints: {
                1: 'Rangkaian kontrol tidak mendapat daya sama sekali.',
                2: 'Ukur tegangan di fuse input dan fuse output, lalu uji kontinuitas fuse.',
                3: 'Jika fuse input ada tegangan tetapi output 0V dan tidak ada kontinuitas, kemungkinan fuse terbuka.',
            },
        },
    },

    ignition: {
        OPEN: {
            label: 'Ignition Switch Failure',
            componentLabel: 'Ignition Switch',
            faultTypeLabel: 'OPEN',
            repairId: 'REPAIR_IGNITION_SWITCH',
            faultKey: 'ignitionFailure',
            params: null,
            tests: ['ignitionInputVoltage', 'ignitionOutputVoltage', 'ignitionContinuity'],
            signature: [
                _S('V', 'ignitionInput', 'batteryNegative', 12.45, 12.7),
                _S('V', 'ignitionOutput', 'batteryNegative', -0.01, 0.01),
                _OL('CONT', 'ignitionInput', 'ignitionOutput'),
            ],
            observation: [
                { field: 'relay', expect: 'OFF' },
                { field: 'starter', expect: 'OFF' },
            ],
            hints: {
                1: 'Periksa rangkaian kontrol dari battery sampai relay.',
                2: 'Ukur tegangan di input dan output ignition switch saat posisi START.',
                3: 'Jika input ada tegangan tetapi output 0V (dan tanpa kontinuitas), ignition switch tidak meneruskan sinyal START.',
            },
        },
    },

    relay: {
        OPEN_COIL: {
            label: 'Starter Relay — Coil Open',
            componentLabel: 'Starter Relay',
            faultTypeLabel: 'OPEN_COIL',
            repairId: 'REPLACE_RELAY',
            faultKey: 'relayFailure',
            params: null,
            tests: ['relayCoilResistance', 'relayInputVoltage'],
            signature: [
                _S('V', 'relayInput', 'batteryNegative', 12.45, 12.7, ['START_REQUEST', 'IGNITION_ON']),
                _OL('OHM', 'relayInput', 'relayGround'),
                _OL('CONT', 'relayInput', 'relayOutput'),
            ],
            observation: [
                { field: 'relay', expect: 'OFF' },
                { field: 'starter', expect: 'OFF' },
            ],
            hints: {
                1: 'Klik relay adalah indikasi relay mendapat sinyal dan bekerja.',
                2: 'Ukur resistansi kumparan relay (relay input → relay coil −) setelah sistem dimatikan.',
                3: 'Jika resistansi kumparan OL (putus), relay tidak dapat mengaktifkan kontak 30-87.',
            },
        },
        CONTACT_OPEN: {
            label: 'Starter Relay — Contact Open',
            componentLabel: 'Starter Relay',
            faultTypeLabel: 'CONTACT_OPEN',
            repairId: 'REPLACE_RELAY',
            faultKey: null,
            params: { relayFaultType: 'contactOpen' },
            tests: ['relayCoilResistance', 'relayOutputVoltage', 'relayContactResistance'],
            signature: [
                _S('V', 'relayInput', 'batteryNegative', 12.45, 12.7, ['START_REQUEST', 'RELAY_ACTIVE']),
                _S('V', 'relayOutput', 'batteryNegative', -0.01, 0.01, ['START_REQUEST', 'RELAY_ACTIVE']),
                _S('OHM', 'relayInput', 'relayGround', 2.8, 3.6),
            ],
            observation: [
                { field: 'relay', expect: 'ACTIVE' },
                { field: 'solenoid', expect: 'OFF' },
            ],
            hints: {
                1: 'Relay berbunyi klik tetapi solenoid tidak bekerja.',
                2: 'Ukur tegangan relay output saat START dan ukur kumparan + kontak relay.',
                3: 'Kumparan relay baik (≈3.2Ω) tetapi kontak 30-87 tidak tertutup → relay rusak bagian kontak.',
            },
        },
    },

    solenoid: {
        CONTROL_OPEN: {
            label: 'Solenoid Control Failure',
            componentLabel: 'Solenoid',
            faultTypeLabel: 'CONTROL_OPEN',
            repairId: 'REPLACE_SOLENOID',
            faultKey: 'solenoidFailure',
            params: null,
            tests: ['relayOutputVoltage', 'solenoidControlVoltage', 'solenoidCoilResistance'],
            signature: [
                _S('V', 'relayOutput', 'batteryNegative', 12.45, 12.7, ['START_REQUEST', 'RELAY_ACTIVE']),
                _S('V', 'solenoidControl', 'batteryNegative', -0.01, 0.01, ['START_REQUEST', 'RELAY_ACTIVE', 'SOLENOID_ACTIVE']),
                _OL('OHM', 'solenoidControl', 'solenoidGround'),
            ],
            observation: [
                { field: 'relay', expect: 'ACTIVE' },
                { field: 'solenoid', expect: 'OFF' },
                { field: 'starter', expect: 'OFF' },
            ],
            hints: {
                1: 'Relay bekerja (klik) tetapi solenoid tidak aktif.',
                2: 'Bandingkan tegangan relay output (harus ada) dengan solenoid control.',
                3: 'Jika relay output bertegangan tetapi solenoid control 0V (dan kumparan solenoid putus), solenoid/gulungan kontrol yang rusak.',
            },
        },
        MAIN_CONTACT_OPEN: {
            label: 'Solenoid Main Contact Failure',
            componentLabel: 'Solenoid',
            faultTypeLabel: 'MAIN_CONTACT_OPEN',
            repairId: 'REPLACE_SOLENOID',
            faultKey: null,
            params: { solenoidMainFail: true },
            tests: ['solenoidMainVoltage', 'starterTerminalVoltage', 'mainContactResistance'],
            signature: [
                _S('V', 'solenoidMain', 'batteryNegative', 12.45, 12.7, ['START_REQUEST', 'SOLENOID_ACTIVE', 'PINION_ENGAGED']),
                _S('V', 'starterPositive', 'batteryNegative', -0.01, 0.01, ['SOLENOID_ACTIVE', 'PINION_ENGAGED', 'STARTER_CRANKING']),
                _OL('OHM', 'solenoidMain', 'batteryPositive'),
            ],
            observation: [
                { field: 'solenoid', expect: 'ACTIVE' },
                { field: 'pinionEngaged', expect: true },
                { field: 'starter', expect: 'OFF' },
            ],
            hints: {
                1: 'Solenoid aktif dan pinion terkait, tetapi starter tidak berputar.',
                2: 'Bandingkan tegangan solenoid main (input) dengan starter M (output) saat START.',
                3: 'Input bertegangan tetapi output 0V → kontak utama solenoid tidak menutup, arus tidak sampai ke motor starter.',
            },
        },
    },

    positiveCable: {
        HIGH_RESISTANCE: {
            label: 'High Positive-Side Voltage Drop',
            componentLabel: 'Positive Cable',
            faultTypeLabel: 'HIGH_RESISTANCE',
            repairId: 'REPAIR_POSITIVE_CABLE',
            faultKey: null,
            params: { cableResistanceMult: 5 },
            tests: ['batteryVoltage', 'crankingVoltage', 'positiveDrop'],
            signature: [
                _S('V', 'batteryPositive', 'batteryNegative', 12.45, 12.7),
                _S('V', 'batteryPositive', 'batteryNegative', 11.5, 11.8, ['STARTER_CRANKING', 'PINION_ENGAGED']),
                _S('V', 'starterPositive', 'batteryNegative', 10.45, 10.7, ['STARTER_CRANKING', 'PINION_ENGAGED']),
                _S('DROP', 'batteryPositive', 'starterPositive', 1.0, 1.25, ['STARTER_CRANKING', 'PINION_ENGAGED']),
                _S('A', 'batteryPositive', 'batteryNegative', 170, 200, ['STARTER_CRANKING', 'PINION_ENGAGED']),
            ],
            observation: [
                { field: 'starter', expect: 'CRANKING' },
                { field: 'starterRPM', min: 200 },
                { field: 'batteryPositive', min: 11.5 },
            ],
            hints: {
                1: 'Battery terlihat normal tetapi starter lambat.',
                2: 'Lakukan voltage drop test: battery positive → starter M saat cranking.',
                3: 'Jika tegangan battery tetap baik tetapi tegangan di starter M rendah, ada tahanan tinggi pada kabel positif.',
            },
        },
    },

    ground: {
        HIGH_RESISTANCE: {
            label: 'Poor Ground Connection',
            componentLabel: 'Ground',
            faultTypeLabel: 'HIGH_RESISTANCE',
            repairId: 'REPAIR_GROUND_CABLE',
            faultKey: 'poorGround',
            params: null,
            tests: ['groundDrop', 'batteryVoltage'],
            signature: [
                _S('V', 'batteryPositive', 'batteryNegative', 12.45, 12.7),
                _S('DROP', 'starterGround', 'batteryNegative', 0.65, 0.9, ['STARTER_CRANKING', 'PINION_ENGAGED']),
                _S('V', 'starterGround', 'batteryNegative', 0.65, 0.9, ['STARTER_CRANKING', 'PINION_ENGAGED']),
                _S('A', 'batteryPositive', 'batteryNegative', 150, 185, ['STARTER_CRANKING', 'PINION_ENGAGED']),
            ],
            observation: [
                { field: 'starter', expect: 'CRANKING' },
                { field: 'starterRPM', max: 199 },
            ],
            hints: {
                1: 'Periksa jalur ground dari starter ke battery.',
                2: 'Ukur voltage drop antara starter housing / starter ground dan battery negative saat cranking.',
                3: 'Voltage drop ground di atas 0.5V menunjukkan tahanan tinggi pada sambungan ground.',
            },
        },
    },

    starterMotor: {
        OPEN_WINDING: {
            label: 'Starter Motor Failure',
            componentLabel: 'Starter Motor',
            faultTypeLabel: 'OPEN_WINDING',
            repairId: 'REPLACE_STARTER_MOTOR',
            faultKey: 'starterMotorFailure',
            params: null,
            tests: ['starterVoltage', 'starterWindingResistance', 'batteryVoltage'],
            signature: [
                _S('V', 'batteryPositive', 'batteryNegative', 12.45, 12.7, ['SOLENOID_ACTIVE', 'PINION_ENGAGED', 'STARTER_CRANKING']),
                _S('V', 'starterPositive', 'batteryNegative', 12.45, 12.7, ['SOLENOID_ACTIVE', 'PINION_ENGAGED', 'STARTER_CRANKING']),
                _OL('OHM', 'starterHousing', 'starterPositive'),
            ],
            observation: [
                { field: 'solenoid', expect: 'ACTIVE' },
                { field: 'pinionEngaged', expect: true },
                { field: 'starter', expect: 'OFF' },
            ],
            hints: {
                1: 'Tegangan sampai ke starter tetapi starter tidak berputar.',
                2: 'Ukur tegangan di starter M saat START, lalu uji resistansi gulungan setelah sistem dimatikan.',
                3: 'Jika semua tegangan sampai ke starter normal dan ground baik tetapi resistansi gulungan OL, motor starter yang rusak.',
            },
        },
    },

    pinion: {
        NO_ENGAGE: {
            label: 'Pinion Failure (Mechanical)',
            componentLabel: 'Pinion / Mechanical',
            faultTypeLabel: 'NO_ENGAGE',
            repairId: 'REPAIR_MECHANICAL_ENGAGEMENT',
            faultKey: null,
            params: { pinionFail: true },
            tests: ['batteryVoltage', 'starterCurrent', 'starterRPM'],
            signature: [
                _S('V', 'batteryPositive', 'batteryNegative', 12.45, 12.7),
                _S('V', 'starterPositive', 'batteryNegative', 11.3, 11.6, ['STARTER_CRANKING', 'PINION_ENGAGED']),
                _S('A', 'batteryPositive', 'batteryNegative', 170, 200, ['STARTER_CRANKING', 'PINION_ENGAGED']),
            ],
            observation: [
                { field: 'starter', expect: 'CRANKING' },
                { field: 'pinionEngaged', expect: false },
                { field: 'engine', expect: 'OFF' },
            ],
            hints: {
                1: 'Gangguan bersifat mekanis: listrik normal, putaran tidak tersalur.',
                2: 'Amati apakah pinion terkait dengan ring gear saat starter berputar.',
                3: 'Starter berputar normal (tegangan/arus normal) tetapi engine tidak ikut berputar → masalah engage pinion/ring gear.',
            },
        },
    },
};

/* ============================================================
   REPAIR ACTIONS
   ============================================================ */
const REPAIR_ACTIONS = [
    {
        id: 'REPLACE_BATTERY',
        label: 'Replace Battery',
        description: 'Mengganti battery dengan battery kondisi baik.',
        correctFor: ['battery:WEAK'],
        procedures: [
            'Putar ignition OFF dan lepaskan kunci.',
            'Lepas terminal battery negatif terlebih dahulu.',
            'Lepas terminal battery positif.',
            'Angkat battery dan pasang battery pengganti yang baik.',
            'Pasang terminal positif lalu negatif.',
            'Uji starting ulang.',
        ],
    },
    {
        id: 'CHARGE_BATTERY',
        label: 'Charge Battery',
        description: 'Mengisi ulang battery dengan battery charger.',
        correctFor: ['battery:DISCHARGED'],
        procedures: [
            'Putar ignition OFF.',
            'Lepas battery dari kendaraan (atau gunakan pengisi baterai catu daya tetap).',
            'Sambungkan klem charger sesuai polaritas.',
            'Isi hingga tegangan mencapai 12.6V.',
            'Pasang kembali battery.',
        ],
    },
    {
        id: 'TIGHTEN_BATTERY_TERMINAL',
        label: 'Tighten Battery Terminal',
        description: 'Membersihkan dan mengencangkan terminal battery.',
        correctFor: ['terminal:HIGH_RESISTANCE'],
        procedures: [
            'Putar ignition OFF dan lepas kunci.',
            'Lepas terminal negatif terlebih dahulu.',
            'Bersihkan terminal dan lug dari korosi.',
            'Kencangkan kembali terminal dengan kuat.',
            'Pasang kembali terminal negatif.',
        ],
    },
    {
        id: 'REPLACE_FUSE',
        label: 'Replace Fuse',
        description: 'Mengganti fuse rangkaian kontrol yang terbuka.',
        correctFor: ['fuse:OPEN'],
        procedures: [
            'Putar ignition OFF.',
            'Lepas fuse yang terbuka.',
            'Pasang fuse baru dengan rating yang sama.',
            'Periksa kontinuitas fuse baru.',
        ],
    },
    {
        id: 'REPAIR_IGNITION_SWITCH',
        label: 'Repair Ignition Switch',
        description: 'Memperbaiki / mengganti ignition switch.',
        correctFor: ['ignition:OPEN'],
        procedures: [
            'Putar ignition OFF dan lepaskan kunci.',
            'Lepas konektor ignition switch.',
            'Periksa kontak B→ST.',
            'Ganti ignition switch jika perlu.',
            'Pasang kembali konektor.',
        ],
    },
    {
        id: 'REPLACE_RELAY',
        label: 'Replace Starter Relay',
        description: 'Mengganti relay starter yang rusak (kumparan atau kontak).',
        correctFor: ['relay:OPEN_COIL', 'relay:CONTACT_OPEN'],
        procedures: [
            'Putar ignition OFF.',
            'Lepas relay dari soketnya.',
            'Uji kumparan (85-86) dan kontak (30-87) relay lama.',
            'Pasang relay pengganti yang baik.',
            'Uji klik relay saat START.',
        ],
    },
    {
        id: 'REPLACE_SOLENOID',
        label: 'Replace Solenoid',
        description: 'Mengganti solenoid (kontrol / kontak utama).',
        correctFor: ['solenoid:CONTROL_OPEN', 'solenoid:MAIN_CONTACT_OPEN'],
        procedures: [
            'Putar ignition OFF dan lepas kunci.',
            'Lepas baterai untuk keamanan.',
            'Lepas kabel dari terminal solenoid.',
            'Lepas solenoid dari starter.',
            'Pasang solenoid baru.',
            'Pasang kembali kabel dan baterai.',
        ],
    },
    {
        id: 'REPAIR_POSITIVE_CABLE',
        label: 'Repair Positive Cable',
        description: 'Memperbaiki / mengganti kabel positif dengan koneksi tahanan rendah.',
        correctFor: ['positiveCable:HIGH_RESISTANCE'],
        procedures: [
            'Putar ignition OFF.',
            'Lepas battery.',
            'Periksa kabel positif dari battery ke solenoid/starter.',
            'Perbaiki atau ganti kabel yang korosi/longgar.',
            'Pasang kembali dan uji voltage drop.',
        ],
    },
    {
        id: 'REPAIR_GROUND_CABLE',
        label: 'Repair Ground Cable',
        description: 'Membersihkan dan mengencangkan sambungan ground.',
        correctFor: ['ground:HIGH_RESISTANCE'],
        procedures: [
            'Putar ignition OFF.',
            'Lepas kabel ground dari battery dan bodi.',
            'Bersihkan titik sambungan ground dari karat.',
            'Kencangkan kembali sambungan ground.',
            'Uji voltage drop ground saat starting.',
        ],
    },
    {
        id: 'REPLACE_STARTER_MOTOR',
        label: 'Replace Starter Motor',
        description: 'Mengganti motor starter yang rusak.',
        correctFor: ['starterMotor:OPEN_WINDING'],
        procedures: [
            'Putar ignition OFF dan lepas kunci.',
            'Lepas battery (terminal negatif dahulu).',
            'Lepas kabel dari terminal starter.',
            'Lepas baut dudukan starter.',
            'Tarik starter dan pasang starter baru.',
            'Pasang kembali kabel, baut, dan battery.',
        ],
    },
    {
        id: 'REPAIR_MECHANICAL_ENGAGEMENT',
        label: 'Repair Mechanical Engagement',
        description: 'Memperbaiki mekanisme pinion/ring gear.',
        correctFor: ['pinion:NO_ENGAGE'],
        procedures: [
            'Putar ignition OFF dan lepas kunci.',
            'Lepas starter dari mesin.',
            'Periksa pinion starter dan ring gear flywheel.',
            'Perbaiki / ganti komponen penggerak pinion.',
            'Pasang kembali starter dan uji engaging.',
        ],
    },
];

/* ============================================================
   13 KASUS DIAGNOSIS (12 wajib sesuai prompt + 1 bonus)
   ============================================================ */
const DIAGNOSTIC_CASES = [

    {
        id: 'CASE_001',
        title: 'Starter Berputar Lambat',
        difficulty: 'BEGINNER',
        customerComplaint: 'Saat kunci diputar ke START, starter berputar sangat lambat dan engine hampir tidak mau hidup.',
        initialCondition: 'Battery terbaca normal (12.6V) saat diam, lampu dashboard meredup saat START.',
        symptom: { type: 'SLOW_CRANK', description: 'Starter berputar lambat; lampu dashboard redup ketika START.' },
        hiddenFault: { component: 'battery', faultType: 'WEAK', severity: 'MEDIUM' },
        expectedDiagnosis: { component: 'battery', faultType: 'WEAK' },
        repairableBy: 'REPLACE_BATTERY',
        diagnosticTargets: ['batteryVoltage', 'crankingVoltage', 'starterCurrent', 'starterRPM'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
    {
        id: 'CASE_002',
        title: 'Battery Discharged — Starter Tidak Mampu Berputar',
        difficulty: 'BEGINNER',
        customerComplaint: 'Starter sama sekali tidak mampu berputar; semua aksesoris ikut mati.',
        initialCondition: 'Battery dalam kondisi sangat lemah, tegangan sangat rendah.',
        symptom: { type: 'NO_CRANK', description: 'Starter tidak mampu berputar. Bunyi target/relay lemah atau tidak ada.' },
        hiddenFault: { component: 'battery', faultType: 'DISCHARGED', severity: 'CRITICAL' },
        expectedDiagnosis: { component: 'battery', faultType: 'DISCHARGED' },
        repairableBy: 'CHARGE_BATTERY',
        diagnosticTargets: ['batteryVoltage', 'starterCurrent'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
    {
        id: 'CASE_003',
        title: 'Terminal Battery Longgar / Korosi',
        difficulty: 'INTERMEDIATE',
        customerComplaint: 'Starter kadang berputar lambat dan kadang gagal total (intermittent).',
        initialCondition: 'Battery terbaca 12.6V saat diam, tetapi voltage drop pada koneksi terminal tinggi.',
        symptom: { type: 'INTERMITTENT_CRANK', description: 'Starter intermittent / tidak stabil; voltage drop tinggi pada koneksi terminal.' },
        hiddenFault: { component: 'terminal', faultType: 'HIGH_RESISTANCE', severity: 'HIGH' },
        expectedDiagnosis: { component: 'terminal', faultType: 'HIGH_RESISTANCE' },
        repairableBy: 'TIGHTEN_BATTERY_TERMINAL',
        diagnosticTargets: ['batteryVoltage', 'crankingVoltage', 'starterRPM', 'terminalResistance'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
    {
        id: 'CASE_004',
        title: 'Fuse Rangkaian Kontrol Terbuka',
        difficulty: 'BEGINNER',
        customerComplaint: 'Starter tidak merespons sama sekali saat kunci diputar ke START.',
        initialCondition: 'Fuse pada rangkaian kontrol terbuka.',
        symptom: { type: 'NO_CRANK', description: 'Starter tidak merespons. Tidak ada bunyi relay.' },
        hiddenFault: { component: 'fuse', faultType: 'OPEN', severity: 'CRITICAL' },
        expectedDiagnosis: { component: 'fuse', faultType: 'OPEN' },
        repairableBy: 'REPLACE_FUSE',
        diagnosticTargets: ['fuseInputVoltage', 'fuseOutputVoltage', 'fuseContinuity'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
    {
        id: 'CASE_005',
        title: 'Ignition Switch Tidak Meneruskan START',
        difficulty: 'BEGINNER',
        customerComplaint: 'Saat START tidak ada aktivasi relay sama sekali.',
        initialCondition: 'Ignition switch gagal meneruskan sinyal START ke rangkaian kontrol.',
        symptom: { type: 'NO_CRANK', description: 'Saat START tidak ada aktivasi relay.' },
        hiddenFault: { component: 'ignition', faultType: 'OPEN', severity: 'CRITICAL' },
        expectedDiagnosis: { component: 'ignition', faultType: 'OPEN' },
        repairableBy: 'REPAIR_IGNITION_SWITCH',
        diagnosticTargets: ['ignitionInputVoltage', 'ignitionOutputVoltage', 'ignitionContinuity'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
    {
        id: 'CASE_006',
        title: 'Starter Relay — Kumparan Terbuka',
        difficulty: 'BEGINNER',
        customerComplaint: 'Ignition switch bekerja, tetapi relay tidak mengaktifkan rangkaian starter.',
        initialCondition: 'Kumparan relay putus sehingga relay tidak pernah mengklik.',
        symptom: { type: 'NO_CRANK', description: 'Ignition switch bekerja; relay tidak mengaktifkan starter circuit.' },
        hiddenFault: { component: 'relay', faultType: 'OPEN_COIL', severity: 'HIGH' },
        expectedDiagnosis: { component: 'relay', faultType: 'OPEN_COIL' },
        repairableBy: 'REPLACE_RELAY',
        diagnosticTargets: ['relayCoilResistance', 'relayInputVoltage'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
    {
        id: 'CASE_007',
        title: 'Solenoid Control Tidak Mendapat Kontrol',
        difficulty: 'INTERMEDIATE',
        customerComplaint: 'Relay berbunyi klik, tetapi solenoid tidak aktif.',
        initialCondition: 'Relay bekerja normal, tetapi kontrol/gulungan solenoid bermasalah.',
        symptom: { type: 'NO_CRANK', description: 'Relay bekerja; solenoid tidak aktif.' },
        hiddenFault: { component: 'solenoid', faultType: 'CONTROL_OPEN', severity: 'HIGH' },
        expectedDiagnosis: { component: 'solenoid', faultType: 'CONTROL_OPEN' },
        repairableBy: 'REPLACE_SOLENOID',
        diagnosticTargets: ['relayOutputVoltage', 'solenoidControlVoltage', 'solenoidCoilResistance'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
    {
        id: 'CASE_008',
        title: 'Solenoid Main Contact Tidak Menutup',
        difficulty: 'INTERMEDIATE',
        customerComplaint: 'Solenoid mendapat control voltage dan berbunyi, tetapi starter tetap tidak berputar.',
        initialCondition: 'Kontak utama solenoid tidak menutup sehingga arus tidak sampai ke motor starter.',
        symptom: { type: 'NO_CRANK', description: 'Solenoid mendapat control voltage; starter tetap tidak berputar.' },
        hiddenFault: { component: 'solenoid', faultType: 'MAIN_CONTACT_OPEN', severity: 'HIGH' },
        expectedDiagnosis: { component: 'solenoid', faultType: 'MAIN_CONTACT_OPEN' },
        repairableBy: 'REPLACE_SOLENOID',
        diagnosticTargets: ['solenoidMainVoltage', 'starterTerminalVoltage', 'mainContactResistance'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
    {
        id: 'CASE_009',
        title: 'Voltage Drop Positif Terlalu Tinggi',
        difficulty: 'INTERMEDIATE',
        customerComplaint: 'Starter berputar lambat padahal battery tampak normal.',
        initialCondition: 'Kabel positif memiliki tahanan tinggi sehingga voltage drop positif besar.',
        symptom: { type: 'SLOW_CRANK', description: 'Starter lambat; battery terlihat normal.' },
        hiddenFault: { component: 'positiveCable', faultType: 'HIGH_RESISTANCE', severity: 'HIGH' },
        expectedDiagnosis: { component: 'positiveCable', faultType: 'HIGH_RESISTANCE' },
        repairableBy: 'REPAIR_POSITIVE_CABLE',
        diagnosticTargets: ['batteryVoltage', 'crankingVoltage', 'positiveDrop'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
    {
        id: 'CASE_010',
        title: 'Koneksi Ground Buruk',
        difficulty: 'INTERMEDIATE',
        customerComplaint: 'Starter berputar lambat / tidak stabil.',
        initialCondition: 'Titik sambungan ground korosi/longgar dengan tahanan tinggi.',
        symptom: { type: 'SLOW_CRANK', description: 'Starter lambat / tidak stabil.' },
        hiddenFault: { component: 'ground', faultType: 'HIGH_RESISTANCE', severity: 'HIGH' },
        expectedDiagnosis: { component: 'ground', faultType: 'HIGH_RESISTANCE' },
        repairableBy: 'REPAIR_GROUND_CABLE',
        diagnosticTargets: ['groundDrop', 'batteryVoltage'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
    {
        id: 'CASE_011',
        title: 'Motor Starter Rusak',
        difficulty: 'INTERMEDIATE',
        customerComplaint: 'Tegangan sampai ke starter dan ground baik, tetapi starter tidak bekerja.',
        initialCondition: 'Gulungan motor starter terbuka/internal rusak.',
        symptom: { type: 'NO_CRANK', description: 'Voltage sampai starter; ground baik; starter tidak bekerja.' },
        hiddenFault: { component: 'starterMotor', faultType: 'OPEN_WINDING', severity: 'CRITICAL' },
        expectedDiagnosis: { component: 'starterMotor', faultType: 'OPEN_WINDING' },
        repairableBy: 'REPLACE_STARTER_MOTOR',
        diagnosticTargets: ['starterVoltage', 'starterWindingResistance', 'batteryVoltage'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
    {
        id: 'CASE_012',
        title: 'Pinion Gagal Berkait (Masalah Mekanis)',
        difficulty: 'INTERMEDIATE',
        customerComplaint: 'Starter motor berputar kencang tetapi engine tidak ikut berputar.',
        initialCondition: 'Masalah mekanis: pinion tidak terkait dengan ring gear.',
        symptom: { type: 'NO_CRANK', description: 'Starter motor berputar tetapi flywheel tidak ikut berputar.' },
        hiddenFault: { component: 'pinion', faultType: 'NO_ENGAGE', severity: 'HIGH' },
        expectedDiagnosis: { component: 'pinion', faultType: 'NO_ENGAGE' },
        repairableBy: 'REPAIR_MECHANICAL_ENGAGEMENT',
        diagnosticTargets: ['batteryVoltage', 'starterCurrent', 'starterRPM'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
    {
        id: 'CASE_013',
        title: 'Starter Relay — Kontak Terbuka (Bonus)',
        difficulty: 'INTERMEDIATE',
        customerComplaint: 'Relay berbunyi klik tetapi solenoid tidak bekerja.',
        initialCondition: 'Kumparan relay baik, tetapi kontak 30-87 tidak menutup.',
        symptom: { type: 'NO_CRANK', description: 'Relay click, tapi tidak ada output ke solenoid.' },
        hiddenFault: { component: 'relay', faultType: 'CONTACT_OPEN', severity: 'HIGH' },
        expectedDiagnosis: { component: 'relay', faultType: 'CONTACT_OPEN' },
        repairableBy: 'REPLACE_RELAY',
        diagnosticTargets: ['relayCoilResistance', 'relayOutputVoltage', 'relayContactResistance'],
        guided: ['Observe the symptom', 'Check battery condition', 'Measure battery voltage', 'Check ignition circuit', 'Check starter relay', 'Check solenoid', 'Check voltage drop', 'Determine root cause'],
    },
];

/* ============================================================
   DIAGNOSTIC TREE (logika decision tree) — data
   Engine traversal ada di diagnosticLab.js (bukan sekadar gambar).
   ============================================================ */
const DIAGNOSTIC_TREE = {
    root: 'Q1',
    nodes: {
        Q1: {
            id: 'Q1',
            question: 'Apakah starter berputar saat START?',
            options: [
                { label: 'Tidak', next: 'Q2', hint: 'Lanjut ke pemeriksaan sumber listrik.' },
                { label: 'Ya', next: 'Q7', hint: '' },
            ],
        },
        Q2: {
            id: 'Q2',
            question: 'Apakah tegangan battery mencukupi (≥12.0V saat diam)?',
            options: [
                { label: 'Tidak', next: 'BATTERY', hint: 'Periksa battery lebih lanjut (weak/discharged).' },
                { label: 'Ya', next: 'Q3', hint: '' },
            ],
        },
        Q3: {
            id: 'Q3',
            question: 'Apakah sinyal START diterima ignition switch (keluar dari ignition output)?',
            options: [
                { label: 'Tidak', next: 'IGNITION', hint: 'Periksa ignition switch / fuse.' },
                { label: 'Ya', next: 'Q4', hint: '' },
            ],
        },
        Q4: {
            id: 'Q4',
            question: 'Apakah relay teraktivasi (berbunyi klik)?',
            options: [
                { label: 'Tidak', next: 'RELAY', hint: 'Periksa relay dan rangkaian kontrolnya.' },
                { label: 'Ya', next: 'Q5', hint: '' },
            ],
        },
        Q5: {
            id: 'Q5',
            question: 'Apakah tegangan kontrol solenoid (solenoid control) tersedia?',
            options: [
                { label: 'Tidak', next: 'CONTROL_CIRCUIT', hint: 'Periksa kontak relay / kabel ke solenoid.' },
                { label: 'Ya', next: 'Q6', hint: '' },
            ],
        },
        Q6: {
            id: 'Q6',
            question: 'Apakah tegangan di terminal starter (starter M) mencukupi saat START?',
            options: [
                { label: 'Tidak', next: 'CABLE_SOLENOID', hint: 'Periksa kabel positif / kontak utama solenoid.' },
                { label: 'Ya', next: 'Q6B', hint: '' },
            ],
        },
        Q6B: {
            id: 'Q6B',
            question: 'Apakah voltage drop ground dapat diterima (≤0.5V)?',
            options: [
                { label: 'Tidak', next: 'GROUND', hint: 'Periksa sambungan ground / kabel ground.' },
                { label: 'Ya', next: 'STARTER', hint: 'Kemungkinan masalah pada motor starter itu sendiri.' },
            ],
        },
        Q7: {
            id: 'Q7',
            question: 'Apakah engine ikut berputar (cranking) secara normal?',
            options: [
                { label: 'Tidak', next: 'MECHANICAL', hint: 'Masalah mekanis: pinion / ring gear.' },
                { label: 'Ya', next: 'OK', hint: 'Sistem starter dalam kondisi normal.' },
            ],
        },
        // Terminal (leaf) node untuk hasil diagnosis.
        BATTERY: { id: 'BATTERY', question: 'Diagnosis awal: gangguan pada battery.', leaf: true },
        IGNITION: { id: 'IGNITION', question: 'Diagnosis awal: gangguan pada ignition switch / fuse.', leaf: true },
        RELAY: { id: 'RELAY', question: 'Diagnosis awal: gangguan pada starter relay.', leaf: true },
        CONTROL_CIRCUIT: { id: 'CONTROL_CIRCUIT', question: 'Diagnosis awal: gangguan pada rangkaian kontrol solenoid.', leaf: true },
        CABLE_SOLENOID: { id: 'CABLE_SOLENOID', question: 'Diagnosis awal: gangguan pada kabel positif / kontak utama solenoid.', leaf: true },
        GROUND: { id: 'GROUND', question: 'Diagnosis awal: gangguan pada jalur ground.', leaf: true },
        STARTER: { id: 'STARTER', question: 'Diagnosis awal: gangguan pada motor starter.', leaf: true },
        MECHANICAL: { id: 'MECHANICAL', question: 'Diagnosis awal: masalah mekanis pinion / engagement.', leaf: true },
        OK: { id: 'OK', question: 'Sistem starter normal.', leaf: true },
    },
};

/* ---------- Hubungan leaf tree → kemungkinan fault ---------- */
const DIAGNOSTIC_TREE_LEAF_FAULTS = {
    BATTERY: ['battery:WEAK', 'battery:DISCHARGED'],
    IGNITION: ['ignition:OPEN', 'fuse:OPEN'],
    RELAY: ['relay:OPEN_COIL', 'relay:CONTACT_OPEN'],
    CONTROL_CIRCUIT: ['solenoid:CONTROL_OPEN'],
    CABLE_SOLENOID: ['solenoid:MAIN_CONTACT_OPEN', 'positiveCable:HIGH_RESISTANCE'],
    GROUND: ['ground:HIGH_RESISTANCE'],
    STARTER: ['starterMotor:OPEN_WINDING'],
    MECHANICAL: ['pinion:NO_ENGAGE'],
    OK: [],
};

/* ---------- Ekspor ---------- */
window.DIAGNOSTIC_CASES = DIAGNOSTIC_CASES;
window.DIAGNOSTIC_KNOWLEDGE = DIAGNOSTIC_KNOWLEDGE;
window.REPAIR_ACTIONS = REPAIR_ACTIONS;
window.DIAGNOSTIC_TREE = DIAGNOSTIC_TREE;
window.DIAGNOSTIC_TREE_LEAF_FAULTS = DIAGNOSTIC_TREE_LEAF_FAULTS;

/* Indeks cepat byId */
const _CASE_INDEX = {};
DIAGNOSTIC_CASES.forEach(c => { _CASE_INDEX[c.id] = c; });
if (!window.DIAGNOSTIC_CASE_INDEX) {
    Object.defineProperty(window, 'DIAGNOSTIC_CASE_INDEX', { value: _CASE_INDEX, enumerable: true });
}