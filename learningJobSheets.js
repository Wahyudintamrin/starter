/* ============================================================
   PHASE 5 — DATA: JOB SHEETS (10)
   ------------------------------------------------------------
   Job sheet adalah lembar kerja digital: tujuan, alat, keselamatan,
   langkah, hasil, pertanyaan, kriteria penilaian.
   ============================================================ */
'use strict';

const LEARNING_JOB_SHEETS = [
    {
        id: 'JS-001', moduleId: 'starter-basic', title: 'Pemeriksaan Battery',
        objective: 'Menentukan kondisi tegangan battery (GOOD / WEAK / DISCHARGED).',
        tools: ['Virtual Multimeter (V DC)'],
        safety: ['Pastikan multimeter pada mode V DC sebelum menyentuhkan probe.', 'Putuskan beban (ignition OFF) saat membaca tegangan diam.'],
        procedure: [
            'Set multimeter ke DC Voltage.',
            'Hubungkan probe merah ke battery positive.',
            'Hubungkan probe hitam ke battery negative.',
            'Catat tegangan diam (batteryPositive → batteryNegative).',
            'Tentukan kondisi: GOOD (≈12,6), WEAK (≈12,0), DISCHARGED (11,0).',
        ],
        expectedResult: { field: 'batteryPositive-batteryNegative', mode: 'V', normalRange: '11,0 – 12,7 V', normalValue: 12.6 },
        questions: [
            { q: 'Berapa tegangan diam battery yang Anda ukur?', expect: '12,0–12,7 V' },
            { q: 'Kesimpulan kondisi battery?', expect: 'GOOD / WEAK / DISCHARGED' },
        ],
        assessmentCriteria: ['Probe terpasang benar', 'Mode multimeter benar', 'Hasil tercatat', 'Kesimpulan sesuai data'],
    },
    {
        id: 'JS-002', moduleId: 'starter-circuit', title: 'Pemeriksaan Ignition Switch',
        objective: 'Memeriksa kontinuitas dan tegangan keluaran ignition switch.',
        tools: ['Virtual Multimeter (V DC, CONTINUITY)'],
        safety: ['Uji continuity hanya saat sistem mati.', 'Sistem berenergi memicu modal keselamatan — ikuti prosedur.'],
        procedure: [
            'Putar ignition ke ON.',
            'Ukur tegangan ignitionOutput terhadap batteryNegative (harus ≈ 12,6 V).',
            'Matikan sistem untuk menguji continuity antara ignitionInput dan ignitionOutput.',
            'Catat kondisi: kontak normal / terbuka.',
        ],
        expectedResult: { field: 'ignitionOutput-batteryNegative', mode: 'V', normalRange: '12,4 – 12,7 V saat ON', normalValue: 12.6 },
        questions: [
            { q: 'Tegangan keluaran ignition saat ON?', expect: '≈12,6 V' },
            { q: 'Kesimpulan ignition switch?', expect: 'Normal / rusak' },
        ],
        assessmentCriteria: ['Urutan prosedur benar', 'Pengukuran sesuai', 'Kesimpulan logis'],
    },
    {
        id: 'JS-003', moduleId: 'starter-circuit', title: 'Pemeriksaan Relay Starter',
        objective: 'Memeriksa kumparan relay (coil) dan fungsi kontak relay.',
        tools: ['Virtual Multimeter (OHM, V DC)'],
        safety: ['Pengukuran resistance hanya saat sistem mati.'],
        procedure: [
            'Matikan sistem.',
            'Ukur resistance coil relay (relayInput → relayGround), normal ≈ 3,2 Ω.',
            'Putar kunci ke START dan ukur relayInput (≈12,6 V) dan relayOutput (≈12,6 V bila kontak baik).',
            'Jika relayInput OK tetapi relayOutput 0 V saat relay klak → kontak relay terbuka.',
        ],
        expectedResult: { field: 'relayInput-relayGround', mode: 'OHM', normalRange: '2,8 – 3,6 Ω', normalValue: 3.2 },
        questions: [
            { q: 'Resistance coil relay yang diukur?', expect: '≈3,2 Ω' },
            { q: 'Apakah kontak relay menutup saat START?', expect: 'Ya / Tidak' },
        ],
        assessmentCriteria: ['Tidak mengukur OHM saat berenergi', 'Nilai coil benar', 'Penilaian kontak benar'],
    },
    {
        id: 'JS-004', moduleId: 'starter-circuit', title: 'Pemeriksaan Solenoid',
        objective: 'Memeriksa kumparan solenoid dan kontak utama.',
        tools: ['Virtual Multimeter (OHM, V DC)'],
        safety: ['Sistem mati untuk uji resistance.'],
        procedure: [
            'Matikan sistem.',
            'Ukur coil solenoid (solenoidControl → solenoidGround), normal ≈ 0,57 Ω.',
            'Putar kunci ke START: solenoidControl harus ≈12,6 V; pinion harus bergerak.',
            'Ukur solenoidMain saat cranking (≈ tegangan battery bila kontak utama baik).',
        ],
        expectedResult: { field: 'solenoidControl-solenoidGround', mode: 'OHM', normalRange: '0,4 – 0,8 Ω', normalValue: 0.57 },
        questions: [
            { q: 'Resistance coil solenoid?', expect: '≈0,57 Ω' },
            { q: 'Apakah pinion bergerak saat START?', expect: 'Ya / Tidak' },
        ],
        assessmentCriteria: ['Probe benar', 'Nilai coil sesuai', 'Analisis gerakan pinion'],
    },
    {
        id: 'JS-005', moduleId: 'starter-measurement', title: 'Voltage Drop Positive Cable',
        objective: 'Mengukur voltage drop pada kabel positif (battery → starter).',
        tools: ['Virtual Multimeter (V DROP)'],
        safety: ['Pengukuran drop dilakukan saat sistem berarus (cranking) — bukan mode OHM.'],
        procedure: [
            'Set multimeter ke mode V DROP.',
            'Probe merah → starterPositive; probe hitam → batteryPositive.',
            'Putar kunci ke START (cranking).',
            'Catat nilai drop. Normal < 0,5 V; > 0,5 V mengindikasikan hambatan tinggi.',
        ],
        expectedResult: { field: 'starterPositive-batteryPositive', mode: 'DROP', normalRange: '0,00 – 0,50 V', normalValue: 0.02 },
        questions: [
            { q: 'Nilai voltage drop positif?', expect: '< 0,5 V' },
            { q: 'Kesimpulan kabel positif?', expect: 'Normal / bermasalah' },
        ],
        assessmentCriteria: ['Mode DROP benar', 'Probe terbalik dicegah (red dekat battery)', 'Interpretasi drop benar'],
    },
    {
        id: 'JS-006', moduleId: 'starter-measurement', title: 'Voltage Drop Ground',
        objective: 'Mengukur voltage drop sisi ground (starter → battery negative).',
        tools: ['Virtual Multimeter (V DROP)'],
        safety: ['Pengukuran saat cranking menggunakan mode DROP.'],
        procedure: [
            'Set multimeter ke mode V DROP.',
            'Probe merah → starterGround; probe hitam → batteryNegative (atau chassis).',
            'Cranking dan catat nilai drop. Normal < 0,2 V.',
        ],
        expectedResult: { field: 'starterGround-batteryNegative', mode: 'DROP', normalRange: '0,00 – 0,20 V', normalValue: 0.01 },
        questions: [
            { q: 'Nilai voltage drop ground?', expect: '< 0,2 V' },
            { q: 'Kesimpulan ground?', expect: 'Normal / buruk' },
        ],
        assessmentCriteria: ['Probe benar', 'Nilai < 0,2 V dicapai', 'Kesimpulan logis'],
    },
    {
        id: 'JS-007', moduleId: 'starter-circuit', title: 'Pemeriksaan Starter Motor',
        objective: 'Memeriksa winding motor starter secara kontinuitas.',
        tools: ['Virtual Multimeter (OHM)'],
        safety: ['Sistem mati; tunggu sampai engine tidak berputar.'],
        procedure: [
            'Matikan sistem sepenuhnya.',
            'Ukur resistance stator/armature: starterPositive → starterHousing (normal ≈ 0,02 Ω).',
            'Jika hasil OL → winding terbuka (starter perlu diganti).',
        ],
        expectedResult: { field: 'starterPositive-starterHousing', mode: 'OHM', normalRange: '0,01 – 0,05 Ω', normalValue: 0.02 },
        questions: [
            { q: 'Resistance winding starter?', expect: '≈0,02 Ω atau OL' },
            { q: 'Kesimpulan motor starter?', expect: 'Normal / terbuka' },
        ],
        assessmentCriteria: ['Sistem mati saat OHM', 'Teknik probe benar', 'Membaca OL dengan benar'],
    },
    {
        id: 'JS-008', moduleId: 'starter-diagnosis', title: 'Diagnosis Starter Tidak Berputar',
        objective: 'Menentukan penyebab starter tidak berputar sama sekali.',
        tools: ['Virtual Multimeter', 'Diagnostic Lab (Phase 4)'],
        safety: ['Uji resistance hanya saat sistem mati.'],
        procedure: [
            'Ambil gejala: tidak ada bunyi relay? ada klik?',
            'Ukur battery diam (normal ≈ 12,6 V).',
            'Periksa jalur kontrol: fuse (continuity), ignition output, relayInput.',
            'Periksa relay (clak?), solenoid, kontak utama.',
            'Tentukan root cause; lakukan repair; verifikasi cranking.',
        ],
        expectedResult: { field: 'diagnosis', mode: 'CASE', normalRange: 'Diagnosis SUPPORTED oleh evidence', normalValue: null },
        questions: [
            { q: 'Diagnosis akhir?', expect: 'Komponen + jenis kerusakan' },
            { q: 'Bukti pengukuran yang mendukung?', expect: 'Minimal 2 pengukuran relevan' },
            { q: 'Hasil verifikasi?', expect: 'VERIFIED / FAILED' },
        ],
        assessmentCriteria: ['Inspeksi awal dilakukan', 'Pengukuran benar', 'Diagnosis didukung evidence', 'Repair + verifikasi'],
    },
    {
        id: 'JS-009', moduleId: 'starter-diagnosis', title: 'Diagnosis Starter Berputar Lambat',
        objective: 'Menentukan penyebab putaran starter yang lambat (slow crank).',
        tools: ['Virtual Multimeter', 'Diagnostic Lab (Phase 4)'],
        safety: ['Hati-hati saat mengukur saat cranking — mode V/DROP, bukan OHM.'],
        procedure: [
            'Catat gejala: starter lambat, lampu redup saat start.',
            'Ukur battery diam (12,0 / 12,6 / 11,0 V).',
            'Ukur battery & starter saat cranking (perhatikan sag).',
            'Periksa drop positif + ground (normal < 0,5 / 0,2 V).',
            'Kategorikan: battery lemah / terminal longgar / ground buruk / kabel positif tinggi.',
            'Repair + verifikasi.',
        ],
        expectedResult: { field: 'diagnosis', mode: 'CASE', normalRange: 'Diagnosis SUPPORTED oleh evidence', normalValue: null },
        questions: [
            { q: 'Tegangan battery diam?', expect: '12,6 / 12,0 / 11,0 V' },
            { q: 'Tegangan saat cranking?', expect: 'Catat nilai sag' },
            { q: 'Drop positif & ground?', expect: '< 0,5 V dan < 0,2 V' },
        ],
        assessmentCriteria: ['Pengukuran sag benar', 'Drop terukur', 'Root cause tepat', 'Verifikasi sukses'],
    },
    {
        id: 'JS-010', moduleId: 'starter-diagnosis', title: 'Diagnosis Kasus Akhir (Final Diagnostic Case)',
        objective: 'Mengerjakan kasus diagnosis acak dari awal hingga verifikasi, memakai seluruh prosedur learned.',
        tools: ['Virtual Multimeter', 'Diagnostic Lab (Phase 4)'],
        safety: ['Semua prosedur keselamatan berlaku.'],
        procedure: [
            'Mulai kasus diagnosis acak (NEW RANDOM CASE).',
            'Lakukan inspeksi awal dan catat gejala.',
            'Bangun hipotesis dan uji dengan pengukuran.',
            'Tentukan diagnosis (harus SUPPORTED).',
            'Lakukan repair yang benar.',
            'Verifikasi: cranking normal dan gejala hilang.',
        ],
        expectedResult: { field: 'diagnosis', mode: 'CASE', normalRange: 'Diagnosis CORRECT + verifikasi VERIFIED', normalValue: null },
        questions: [
            { q: 'Kasus yang dikerjakan?', expect: 'CASE_xxx' },
            { q: 'Diagnosis + bukti?', expect: 'Root cause + pengukuran pendukung' },
            { q: 'Verifikasi?', expect: 'VERIFIED' },
        ],
        assessmentCriteria: ['Alur lengkap', 'Evidence relevan', 'Diagnosis benar', 'Repair benar', 'Verifikasi sukses'],
    },
    {
        id: 'JS-011', moduleId: 'starter-measurement', title: 'Pengukuran Arus Cranking',
        objective: 'Mengukur arus yang ditarik motor starter saat cranking dengan amper/clamp virtual (A DC).',
        tools: ['Virtual Multimeter (A DC)'],
        safety: [
            'Ukur arus hanya saat cranking (rangkaian berarus).',
            'Gunakan mode A DC — jangan mode OHM/CONT saat sistem berenergi.',
            'Cranking maksimal ± 10 detik, lalu istirahat ± 30 detik.',
        ],
        procedure: [
            'Set multimeter ke mode A DC.',
            'Hubungkan probe pada jalur daya motor: starterPositive → starterHousing.',
            'Putar kunci ke START sehingga starter cranking.',
            'Catat arus cranking (normal ± 150–250 A untuk battery sehat).',
            'Bandingkan dengan tegangan battery: arus kecil + putaran lambat mengarah ke suplai lemah atau hambatan tinggi.',
        ],
        expectedResult: { field: 'starterPositive-starterHousing', mode: 'A', normalRange: '150 – 250 A', normalValue: 185 },
        questions: [
            { q: 'Berapa arus cranking yang Anda ukur?', expect: '±150–250 A' },
            { q: 'Apa artinya jika arus terlalu kecil saat cranking?', expect: 'Suplai lemah / hambatan tinggi / motor tidak menarik arus' },
            { q: 'Kesimpulan kondisi rangkaian daya?', expect: 'Normal / bermasalah' },
        ],
        assessmentCriteria: ['Mode A DC benar', 'Probe pada jalur daya', 'Nilai arus tercatat', 'Kesimpulan didukung data'],
    },
];

if (typeof window !== 'undefined') {
    window.LEARNING_JOB_SHEETS = LEARNING_JOB_SHEETS;
}