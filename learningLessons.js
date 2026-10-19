/* ============================================================
   PHASE 5 — DATA: LESSONS (Lesson Viewer content)
   ------------------------------------------------------------
   Jenis section:
     TEXT | LIST | STEPS | TABLE | INTERACTIVE | SIMULATOR_LINK
   ============================================================ */
'use strict';

const LEARNING_LESSONS = [
    /* ---------- MODULE 1 : DASAR ---------- */
    {
        id: 'l1-fungsi', moduleId: 'starter-basic', title: 'Fungsi Sistem Starter', estMinutes: 5,
        objectives: ['OBJ-01', 'OBJ-02'],
        sections: [
            { type: 'TEXT', content: 'Sistem starter berfungsi mengubah energi listrik dari battery menjadi energi mekanik untuk memutar crankshaft agar mesin dapat memulai proses pembakaran. Karena hanya bekerja sesaat (beberapa detik), sistem starter menarik arus sangat besar (150–250 A).' },
            { type: 'LIST', items: ['Memutar crankshaft saat starting', 'Menggerakkan flywheel lewat pinion gear', 'Otomatis lepas setelah engine berputar sendiri'] },
            { type: 'SIMULATOR_LINK', label: 'COBA DI SIMULATOR', target: 'simulator', detail: 'Operasikan ignition OFF → ON → START dan amati urutan kerja komponen.' },
        ],
    },
    {
        id: 'l1-battery', moduleId: 'starter-basic', title: 'Battery', estMinutes: 5,
        objectives: ['OBJ-02', 'OBJ-03'],
        sections: [
            { type: 'TEXT', content: 'Battery adalah sumber listrik utama sistem starter. Battery sehat kira-kira 12,6 V saat diam, ±12,0 V dalam kondisi lemah (WEAK), dan 11,0 V jika hampir kosong (DISCHARGED).' },
            { type: 'TABLE', headers: ['Kondisi', 'Tegangan diam', 'Perilaku saat start'], rows: [['GOOD', '≈ 12,6 V', 'Starter berputar normal & engine start'], ['WEAK', '≈ 12,0 V', 'Starter berputar lambat'], ['DISCHARGED', '≈ 11,0 V', 'Starter sangat lambat / tidak berputar']] },
            { type: 'INTERACTIVE', component: 'battery', prompt: 'Klik komponen battery pada simulator untuk melihat informasinya, lalu ukur tegangannya dengan MULTI (V DC).' },
        ],
    },
    {
        id: 'l1-ignition', moduleId: 'starter-basic', title: 'Ignition Switch', estMinutes: 4,
        objectives: ['OBJ-02', 'OBJ-03'],
        sections: [
            { type: 'TEXT', content: 'Ignition switch adalah saklar tiga posisi: OFF, ON (acc/ignition), dan START. Arus kecil dari ignition switch memicu relay saat kunci diputar ke START.' },
            { type: 'STEPS', items: ['OFF — seluruh sistem mati', 'ON — dashboard menyala, kontrol siap', 'START — relay aktif, starter bekerja (posisi spring-return)'] },
            { type: 'SIMULATOR_LINK', label: 'COBA DI SIMULATOR', target: 'simulator', detail: 'Putar kunci dan amati state: OFF → IGNITION_ON → START_REQUEST → RELAY_ACTIVE.' },
        ],
    },
    {
        id: 'l1-relay', moduleId: 'starter-basic', title: 'Starter Relay', estMinutes: 4,
        objectives: ['OBJ-03'],
        sections: [
            { type: 'TEXT', content: 'Relay adalah saklar elektromagnetik. Arus kecil dari ignition switch menggerakkan kumparan relay; kontak relay kemudian menghubungkan arus besar dari battery ke kumparan solenoid.' },
            { type: 'TEXT', content: 'Gejala relay rusak (kumparan putus / kontak terbuka): relay tidak mengklik dan starter tidak bekerja sama sekali meskipun kunci di START.' },
        ],
    },
    {
        id: 'l1-solenoid', moduleId: 'starter-basic', title: 'Solenoid (Kontaktor)', estMinutes: 5,
        objectives: ['OBJ-02', 'OBJ-04'],
        sections: [
            { type: 'TEXT', content: 'Solenoid melakukan dua tugas: (1) mendorong pinion agar menyambung ke ring gear, dan (2) menutup kontak utama sehingga arus besar mengalir dari battery ke motor starter.' },
            { type: 'LIST', items: ['Kumparan tarik (pull-in) — menarik pinion', 'Kumparan tahan (hold-in) — menahan pinion tetap bersambung', 'Kontak utama — jalur arus 150–250 A ke motor starter'] },
        ],
    },
    {
        id: 'l1-motor', moduleId: 'starter-basic', title: 'Starter Motor', estMinutes: 5,
        objectives: ['OBJ-04'],
        sections: [
            { type: 'TEXT', content: 'Starter motor adalah motor listrik DC yang menghasilkan putaran armature ber-torsi tinggi. Putarannya diteruskan melalui pinion gear ke ring gear flywheel.' },
            { type: 'TEXT', content: 'Gangguan kumparan motor (open winding) menyebabkan starter tidak berputar walaupun kontrol dan solenoid normal. Uji dengan OHM: hambatan winding harus sangat kecil, bukan OL.' },
            { type: 'SIMULATOR_LINK', label: 'UJI MOTOR', target: 'multimeter', detail: 'Gunakan MULTI mode OHM untuk memeriksa winding starter.' },
        ],
    },
    {
        id: 'l1-pinion', moduleId: 'starter-basic', title: 'Pinion, Ring Gear & Flywheel', estMinutes: 5,
        objectives: ['OBJ-04', 'OBJ-05'],
        sections: [
            { type: 'TEXT', content: 'Pinion gear adalah roda gigi kecil pada poros starter yang didorong solenoid untuk menyambung ke ring gear pada flywheel. Flywheel meneruskan putaran ke crankshaft mesin.' },
            { type: 'TEXT', content: 'Bantalan/overrunning clutch memungkinkan pinion bebas setelah engine menyala, mencegah motor starter rusak akibat putaran mesin yang jauh lebih cepat.' },
            { type: 'INTERACTIVE', component: 'startersvg', prompt: 'Buka halaman Simulator, klik komponen starter dan flywheel untuk melihat animasi pinion engagement.' },
        ],
    },

    /* ---------- MODULE 2 : RANGKAIAN ---------- */
    {
        id: 'l2-battery-fuse', moduleId: 'starter-circuit', title: 'Battery & Fuse', estMinutes: 5,
        objectives: ['OBJ-11', 'OBJ-13'],
        sections: [
            { type: 'TEXT', content: 'Dari battery positif, aliran listrik menuju jalur kontrol melalui fuse. Fuse melindungi rangkaian kontrol dari arus berlebih. Fuse putus (OPEN) memutus jalan ke ignition switch sehingga starter tidak bekerja.' },
            { type: 'TABLE', headers: ['Node', 'Fungsi'], rows: [['batteryPositive', 'Kutub positif battery'], ['fuseInput', 'Masuk fuse'], ['fuseOutput', 'Keluaran fuse setelah proteksi']] },
        ],
    },
    {
        id: 'l2-kontrol', moduleId: 'starter-circuit', title: 'Rangkaian Kontrol', estMinutes: 6,
        objectives: ['OBJ-11', 'OBJ-13'],
        sections: [
            { type: 'STEPS', items: ['batteryPositive → fuse', 'fuse → ignitionInput (kunci kontak)', 'ignitionOutput → relayInput (kumparan relay)', 'relay output → solenoidControl (kumparan solenoid)'] },
            { type: 'TEXT', content: 'Rangkaian kontrol mengalirkan arus kecil (relay ±4 A, solenoid ±22 A). Karena arus kecil, kabelnya tipis dan dilindungi fuse.' },
            { type: 'SIMULATOR_LINK', label: 'LIHAT DI TEKNICAL PANEL', target: 'simulator', detail: 'Buka panel TECH untuk melihat tegangan di tiap node rangkaian.' },
        ],
    },
    {
        id: 'l2-utama', moduleId: 'starter-circuit', title: 'Rangkaian Utama (Arus Besar)', estMinutes: 6,
        objectives: ['OBJ-12', 'OBJ-13'],
        sections: [
            { type: 'TEXT', content: 'Rangkaian utama membawa arus 150–250 A: battery positif → kabel positif tebal → kontak utama solenoid → motor starter → ground. Kabel utamanya tebal karena arus sangat besar.' },
            { type: 'TABLE', headers: ['Node', 'Fungsi'], rows: [['starterPositive', 'Titik masuk motor starter'], ['solenoidMain', 'Kontak utama keluaran solenoid'], ['starterGround', 'Kembali ke battery negative']] },
        ],
    },
    {
        id: 'l2-ground', moduleId: 'starter-circuit', title: 'Ground & Positive Cable', estMinutes: 5,
        objectives: ['OBJ-12', 'OBJ-14'],
        sections: [
            { type: 'TEXT', content: 'Arus starter melewati copper strap ke blok mesin kemudian kembali ke battery melalui kabel massa (ground). Hambatan pada ground (poor ground) menurunkan arus dan membuat starter berputar lambat.' },
            { type: 'TEXT', content: 'Simak: hambatan kabel positif normal 0,01 Ω; ground normal 0,01 Ω / poor 0,035 Ω. Voltage drop total positif + ground yang normal di bawah 0,5 V.' },
        ],
    },

    /* ---------- MODULE 3 : PRINSIP KERJA ---------- */
    {
        id: 'l3-urutan', moduleId: 'starter-principles', title: 'Urutan Kerja Sistem Starter', estMinutes: 7,
        objectives: ['OBJ-21', 'OBJ-22'],
        sections: [
            { type: 'STEPS', items: ['Ignition: kunci diputar ke START', 'Relay: kontak menutup, mengalirkan arus ke solenoid', 'Solenoid: pinion terdorong menyambung ke ring gear', 'Pinion engagement: pinion terhubung ke flywheel', 'Starter motor: armature berputar, flywheel ikut berputar', 'Crankshaft: mesin mulai berputar → pembakaran', 'Engine running: kunci kembali ke ON/IGNITION, pinion lepas'] },
            { type: 'TABLE', headers: ['State', 'Relay', 'Solenoid', 'Pinion', 'Starter'], rows: [
                ['IGNITION_ON', 'OFF', 'OFF', 'DISENGAGED', 'OFF'],
                ['RELAY_ACTIVE', 'ACTIVE', 'OFF', 'DISENGAGED', 'OFF'],
                ['SOLENOID_ACTIVE', 'ACTIVE', 'ACTIVE', 'DISENGAGED', 'OFF'],
                ['PINION_ENGAGED', 'ACTIVE', 'ACTIVE', 'ENGAGED', 'OFF'],
                ['STARTER_CRANKING', 'ACTIVE', 'ACTIVE', 'ENGAGED', 'CRANKING'],
                ['ENGINE_RUNNING', 'OFF', 'OFF', 'DISENGAGED', 'OFF'],
            ]},
            { type: 'SIMULATOR_LINK', label: 'LIHAT DI SIMULATOR', target: 'simulator', detail: 'Aktifkan Timeline untuk mengamati setiap state berikut waktunya.' },
        ],
    },
    {
        id: 'l3-interaktif', moduleId: 'starter-principles', title: 'Lesson Interaktif: Klik Komponen', estMinutes: 6,
        objectives: ['OBJ-22', 'OBJ-23'],
        sections: [
            { type: 'INTERACTIVE', component: 'starter', prompt: 'Klik komponen sesuai urutan kerja untuk mempelajari fungsinya satu per satu (interactive lesson).', components: ['battery', 'ignition', 'relay', 'solenoid', 'starter', 'pinion'] },
            { type: 'TEXT', content: 'Urutan yang benar: ignition → relay → solenoid → pinion → starter motor → flywheel → crankshaft. Putuskan sebuah mata rantai ini → starter gagal bekerja.' },
        ],
    },

    /* ---------- MODULE 4 : PENGUKURAN ---------- */
    {
        id: 'l4-multimeter', moduleId: 'starter-measurement', title: 'Mengenal Virtual Multimeter', estMinutes: 5,
        objectives: ['OBJ-31'],
        sections: [
            { type: 'TEXT', content: 'Virtual Multimeter (tombol MULTI di toolbar simulator) menyediakan mode V DC, A DC, Ω, CONTINUITY, dan V DROP. Probe merah (RED) dan hitam (COM) ditempatkan pada 17 titik ukur pada diagram SVG.' },
            { type: 'LIST', items: ['Klik titik ukur pada diagram atau daftar Measurement Points', 'Urutan penempatan otomatis RED → COM', 'Tekan MEASURE untuk menyimpan hasil ke history & worksheet'] },
            { type: 'SIMULATOR_LINK', label: 'BUKA MULTIMETER', target: 'multimeter', detail: 'Multimeter akan terbuka otomatis pada halaman Simulator.' },
        ],
    },
    {
        id: 'l4-tegangan', moduleId: 'starter-measurement', title: 'Pengukuran Tegangan', estMinutes: 5,
        objectives: ['OBJ-31'],
        sections: [
            { type: 'STEPS', items: ['Atur mode V DC', 'Probe merah → batteryPositive', 'Probe hitam → batteryNegative', 'Tekan MEASURE dan catat hasil (≈12,6 V)'] },
            { type: 'TEXT', content: 'Saat cranking, tegangan battery turun (voltage sag). Battery lemah: battery ≈11,35 V dan terminal starter ≈11,2 V.' },
            { type: 'SIMULATOR_LINK', label: 'PRAKTIKKAN PENGUKURAN TEGANGAN', target: 'multimeter', detail: 'Ukur battery saat diam, lalu saat kunci di START.' },
        ],
    },
    {
        id: 'l4-resistance', moduleId: 'starter-measurement', title: 'Resistance & Continuity', estMinutes: 6,
        objectives: ['OBJ-32'],
        sections: [
            { type: 'TEXT', content: 'Mode Ω mengukur hambatan; mode CONTINUITY berbunyi jika hambatan ≤10 Ω. Contoh nilai: fuse 0,02 Ω (OL jika putus), relay coil 3,2 Ω, solenoid coil 0,57 Ω, winding starter 0,02 Ω (OL jika motor terbuka).' },
            { type: 'TEXT', content: 'PENTING (keselamatan): sistem harus MATI saat mengukur Ω/CONTINUITY. Simulator memblokir pengukuran resistance jika sistem berenergi — ikuti modal keselamatan.' },
            { type: 'SIMULATOR_LINK', label: 'UJI CONTINUITY FUSE', target: 'multimeter', detail: 'Cek continuity fuse dengan probe fuseInput → fuseOutput.' },
        ],
    },
    {
        id: 'l4-drop', moduleId: 'starter-measurement', title: 'Voltage Drop', estMinutes: 6,
        objectives: ['OBJ-33'],
        sections: [
            { type: 'TEXT', content: 'Voltage drop mengukur kehilangan tegangan pada kabel/terminal saat arus mengalir. Nilai normal positif < 0,5 V dan ground < 0,2 V. Drop tinggi = hambatan berlebih (terminal longgar, kabel korosi).' },
            { type: 'STEPS', items: ['Atur mode V DROP', 'Probe merah → titik paling dekat battery (mis. starterPositive)', 'Probe hitam → titik lebih jauh (batteryPositive)', 'Baca drop saat cranking'] },
            { type: 'SIMULATOR_LINK', label: 'PRAKTIKKAN VOLTAGE DROP', target: 'multimeter', detail: 'Lakukan voltage drop test positif dan ground.' },
        ],
    },
    {
        id: 'l4-safety', moduleId: 'starter-measurement', title: 'Keselamatan Pengukuran', estMinutes: 4,
        objectives: ['OBJ-34'],
        sections: [
            { type: 'LIST', items: ['Matikan sistem sebelum uji resistance/continuity', 'Pilih mode yang tepat sebelum menyentuhkan probe', 'Amankan probe agar tidak bersentuhan antar kabel', 'Jangan mengukur saat kunci di START kecuali memang prosedurnya'] },
            { type: 'TEXT', content: 'Simulator memblokir Ω/CONT saat sistem berenergi dan menampilkan modal peringatan — terbiasa dengan itu menanamkan kebiasaan aman di dunia nyata.' },
        ],
    },

    /* ---------- MODULE 5 : DIAGNOSIS ---------- */
    {
        id: 'l5-gejala', moduleId: 'starter-diagnosis', title: 'Gejala & Inspeksi Awal', estMinutes: 5,
        objectives: ['OBJ-41'],
        sections: [
            { type: 'TEXT', content: 'Diagnosis dimulai dari gejala (symptom), mis. "starter tidak berputar", "berputar lambat", "ada klik tapi tidak cranking". Setiap gejala mempersempit kemungkinan penyebab.' },
            { type: 'TABLE', headers: ['Gejala', 'Area yang dicurigai'], rows: [
                ['Tidak berputar, tidak ada klik', 'Battery/fuse/ignition/relay/kabel kontrol'],
                ['Klik tapi tidak cranking', 'Battery lemah, kontak utama solenoid, kabel utama, motor'],
                ['Berputar lambat', 'Battery lemah, ground buruk, kabel positif berresistansi tinggi'],
                ['Cranking normal tapi mesin tidak nyala', 'Bukan area starter'],
            ]},
            { type: 'SIMULATOR_LINK', label: 'BUKA DIAGNOSTIC LAB', target: 'diagnosis', detail: 'Mulai kasus dan lakukan inspeksi awal.' },
        ],
    },
    {
        id: 'l5-hipotesis', moduleId: 'starter-diagnosis', title: 'Hipotesis & Evidence', estMinutes: 6,
        objectives: ['OBJ-42'],
        sections: [
            { type: 'TEXT', content: 'Buat hipotesis (dugaan komponen + jenis kerusakan), lalu UJI dengan pengukuran. Pengukuran yang mendukung → SUPPORTED; pengukuran yang bertentangan → NOT SUPPORTED; belum cukup → INSUFFICIENT.' },
            { type: 'TEXT', content: 'Contoh: hipotesis "baterai lemah" diuji dengan mengukur battery saat diam (≈12,0 V) dan saat cranking (≈11,35 V) serta arus cranking (≈130 A).' },
        ],
    },
    {
        id: 'l5-diagnosis', moduleId: 'starter-diagnosis', title: 'Diagnosis & Repair', estMinutes: 6,
        objectives: ['OBJ-43'],
        sections: [
            { type: 'STEPS', items: ['Kumpulkan semua pengukuran relevan', 'Tinjau evidence tiap hipotesis', 'Kirim diagnosis (komponen + jenis kerusakan)', 'Pilih repair sesuai akar masalah'] },
            { type: 'TEXT', content: 'Diagnosis yang dikirim harus didukung evidence (verdict SUPPORTED). Repair yang salah tidak menghilangkan fault — akan terlihat saat verifikasi gagal.' },
        ],
    },
    {
        id: 'l5-verifikasi', moduleId: 'starter-diagnosis', title: 'Verifikasi Perbaikan', estMinutes: 5,
        objectives: ['OBJ-44'],
        sections: [
            { type: 'TEXT', content: 'Setelah repair, verifikasi dengan menghidupkan kembali sistem: starter harus benar-benar cranking (dan untuk kasus motor/pinion, engine harus berputar). Verifikasi juga menaikkan confidence menjadi CONFIRMED.' },
            { type: 'TEXT', content: 'Dokumentasikan: ukur ulang battery saat diam (harus kembali ≈12,6 V) sebagai bukti pemulihan.' },
            { type: 'SIMULATOR_LINK', label: 'PRAKTIKKAN DIAGNOSIS', target: 'diagnosis', detail: 'Selesaikan sebuah kasus ke tahap verifikasi.' },
        ],
    },
];

// Info singkat komponen untuk lesson interaktif (§8).
const LEARNING_COMPONENT_INFO = {
    battery: { label: 'Battery', info: 'Sumber listrik utama (≈12,6 V saat sehat, 150–250 A saat cranking).' },
    ignition: { label: 'Ignition Switch', info: 'Saklar 3 posisi (OFF/ON/START) yang mengalirkan arus kecil ke relay.' },
    relay: { label: 'Starter Relay', info: 'Saklar elektromagnetik yang meneruskan arus besar ke solenoid (coil 3,2 Ω).' },
    solenoid: { label: 'Solenoid', info: 'Mendorong pinion ke ring gear dan menutup kontak utama (coil 0,57 Ω).' },
    starter: { label: 'Starter Motor', info: 'Motor DC ber-torsi tinggi (winding 0,02 Ω); rotary output lewat pinion.' },
    pinion: { label: 'Pinion Gear', info: 'Gigi kecil yang menyambung putaran starter ke ring gear flywheel.' },
    flywheel: { label: 'Flywheel / Ring Gear', info: 'Roda gila dengan ring gear; meneruskan putaran ke crankshaft.' },
    fuse: { label: 'Fuse', info: 'Proteksi rangkaian kontrol (0,02 Ω; OL bila putus).' },
    startersvg: { label: 'Simulator Starter', info: 'Diagram SVG interaktif; klik komponen untuk info + animasi' },
};

if (typeof window !== 'undefined') {
    window.LEARNING_LESSONS = LEARNING_LESSONS;
    window.LEARNING_COMPONENT_INFO = LEARNING_COMPONENT_INFO;
}