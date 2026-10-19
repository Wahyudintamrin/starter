/* ============================================================
   PHASE 5 — DATA: LEARNING MODULES & PRACTICES
   ------------------------------------------------------------
   Konten terpisah dari logika (CONTENT layer).
   Struktur ini sengaja dibuat ringan agar dapat dikembangkan
   tanpa mengubah engine / UI.
   ============================================================ */
'use strict';

const LEARNING_MODULES = [
    {
        id: 'starter-basic',
        level: 1,
        title: 'Pengenalan Sistem Starter',
        shortTitle: 'Dasar Sistem Starter',
        description: 'Mengenal fungsi sistem starter dan setiap komponen kelistrik-mekaniknya: battery, ignition switch, relay, solenoid, motor starter, pinion, ring gear, dan flywheel.',
        difficulty: 'BEGINNER',
        prerequisites: [],
        color: '#00d9ff',
        objectives: [
            { id: 'OBJ-01', text: 'Menjelaskan fungsi sistem starter' },
            { id: 'OBJ-02', text: 'Mengidentifikasi komponen sistem starter' },
            { id: 'OBJ-03', text: 'Menjelaskan fungsi battery, ignition switch, dan relay' },
            { id: 'OBJ-04', text: 'Menjelaskan fungsi solenoid, starter motor, dan pinion' },
            { id: 'OBJ-05', text: 'Menjelaskan fungsi ring gear dan flywheel' },
        ],
        lessons: ['l1-fungsi', 'l1-battery', 'l1-ignition', 'l1-relay', 'l1-solenoid', 'l1-motor', 'l1-pinion'],
        practices: ['pract-basic'],
        assessments: [
            { id: 'A-starter-basic', title: 'Kuis Dasar Sistem Starter', questionCount: 6, difficulty: 'EASY', types: ['MULTIPLE_CHOICE', 'TRUE_FALSE'] },
        ],
        jobSheets: ['JS-001'],
    },
    {
        id: 'starter-circuit',
        level: 2,
        title: 'Rangkaian Kelistrikan Starter',
        shortTitle: 'Rangkaian Kelistrikan',
        description: 'Memahami jalur arus pada rangkaian starter: battery → fuse → ignition → relay → solenoid → starter motor, serta ground dan positive cable.',
        difficulty: 'BEGINNER',
        prerequisites: ['starter-basic'],
        color: '#69f0ae',
        objectives: [
            { id: 'OBJ-11', text: 'Menggambarkan rangkaian kontrol starter' },
            { id: 'OBJ-12', text: 'Menggambarkan rangkaian utama starter' },
            { id: 'OBJ-13', text: 'Menjelaskan peran fuse dan relay dalam rangkaian' },
            { id: 'OBJ-14', text: 'Menjelaskan fungsi ground dan positive cable' },
        ],
        lessons: ['l2-battery-fuse', 'l2-kontrol', 'l2-utama', 'l2-ground'],
        practices: ['pract-circuit'],
        assessments: [
            { id: 'A-starter-circuit', title: 'Kuis Rangkaian Kelistrikan', questionCount: 6, difficulty: 'EASY', types: ['MULTIPLE_CHOICE', 'MULTIPLE_RESPONSE'] },
        ],
        jobSheets: ['JS-002', 'JS-003', 'JS-004', 'JS-007'],
    },
    {
        id: 'starter-principles',
        level: 3,
        title: 'Prinsip Kerja Sistem Starter',
        shortTitle: 'Prinsip Kerja',
        description: 'Mempelajari urutan kerja sistem starter dari ignition switch sampai crankshaft berputar, lewat lesson interaktif.',
        difficulty: 'BEGINNER',
        prerequisites: ['starter-circuit'],
        color: '#ffd740',
        objectives: [
            { id: 'OBJ-21', text: 'Menjelaskan urutan kerja sistem starter' },
            { id: 'OBJ-22', text: 'Menjelaskan peran setiap state (RELAY → SOLENOID → PINION → CRANK)' },
            { id: 'OBJ-23', text: 'Membandingkan kondisi normal vs gangguan pada tiap tahap' },
        ],
        lessons: ['l3-urutan', 'l3-interaktif'],
        practices: ['pract-sequence'],
        assessments: [
            { id: 'A-starter-principles', title: 'Kuis Prinsip Kerja', questionCount: 5, difficulty: 'MEDIUM', types: ['ORDERING', 'MULTIPLE_CHOICE'] },
        ],
        jobSheets: [],
    },
    {
        id: 'starter-measurement',
        level: 4,
        title: 'Pengukuran Sistem Starter',
        shortTitle: 'Pengukuran',
        description: 'Menggunakan Virtual Multimeter (Phase 3): tegangan, resistance, continuity, voltage drop, penempatan probe, dan keselamatan pengukuran.',
        difficulty: 'MEDIUM',
        prerequisites: ['starter-principles'],
        color: '#e040fb',
        objectives: [
            { id: 'OBJ-31', text: 'Melakukan pengukuran tegangan battery' },
            { id: 'OBJ-32', text: 'Melakukan uji resistance dan continuity' },
            { id: 'OBJ-33', text: 'Melakukan voltage drop test positif dan ground' },
            { id: 'OBJ-34', text: 'Menerapkan prosedur keselamatan pengukuran' },
        ],
        lessons: ['l4-multimeter', 'l4-tegangan', 'l4-resistance', 'l4-drop', 'l4-safety'],
        practices: ['pract-drop'],
        assessments: [
            { id: 'A-starter-measurement', title: 'Kuis Pengukuran', questionCount: 6, difficulty: 'MEDIUM', types: ['SCENARIO', 'MULTIPLE_CHOICE'] },
        ],
        jobSheets: ['JS-005', 'JS-006', 'JS-011'],
    },
    {
        id: 'starter-diagnosis',
        level: 5,
        title: 'Diagnosis Sistem Starter',
        shortTitle: 'Diagnosis',
        description: 'Menggunakan Diagnostic Engine Phase 4: gejala, inspeksi, hipotesis, pengukuran, evidence, diagnosis, repair, dan verifikasi.',
        difficulty: 'MEDIUM',
        prerequisites: ['starter-measurement'],
        color: '#ff5252',
        objectives: [
            { id: 'OBJ-41', text: 'Menganalisis gejala starter tidak berputar' },
            { id: 'OBJ-42', text: 'Menentukan hipotesis dan menguji dengan pengukuran' },
            { id: 'OBJ-43', text: 'Menentukan penyebab gangguan (root cause)' },
            { id: 'OBJ-44', text: 'Melakukan perbaikan dan verifikasi' },
        ],
        lessons: ['l5-gejala', 'l5-hipotesis', 'l5-diagnosis', 'l5-verifikasi'],
        practices: ['pract-diag'],
        assessments: [
            { id: 'A-starter-diagnosis', title: 'Kuis Diagnosis', questionCount: 6, difficulty: 'MEDIUM', types: ['SCENARIO', 'MULTIPLE_CHOICE', 'TRUE_FALSE'] },
        ],
        jobSheets: ['JS-008', 'JS-009', 'JS-010'],
    },
];

// Tampilkan modul-modul yang mengarah ke evaluasi penuh.
const LEARNING_PATH_LEVELS = [
    { level: 1, label: 'Basic Starter System' },
    { level: 2, label: 'Electrical Circuit' },
    { level: 3, label: 'Measurement' },
    { level: 4, label: 'Diagnosis' },
    { level: 5, label: 'Practical Assessment' },
];

if (typeof window !== 'undefined') {
    window.LEARNING_MODULES = LEARNING_MODULES;
    window.LEARNING_PATH_LEVELS = LEARNING_PATH_LEVELS;
}