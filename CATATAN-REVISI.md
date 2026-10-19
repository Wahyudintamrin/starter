# StarterLab

> **Pahami. Ukur. Diagnosis.**  
> Platform Pembelajaran Sistem Kelistrikan Otomotif (sebelumnya: *StarterSim* / *Starter System Simulator*).

Modul pertama: Sistem Starter Kendaraan.

Web simulator interaktif **Sistem Starter Kendaraan** untuk pembelajaran otomotif (SMK, mahasiswa, guru, instruktur, teknisi pemula).

Konsep pembelajaran: **LIHAT → PELAJARI → OPERASIKAN → UKUR → ANALISIS → DIAGNOSIS → EVALUASI**

## Pembaruan: Learning Hub & 3D Lab

- `learningHub-data.js` — konten: 14 materi lengkap, 50 soal (5 kuis + ujian akhir 25 soal), 12 studi kasus diagnosis.
- `learningHub.js` — halaman Materi (baca per modul: **Paham / Lanjut / Kembali**), Praktik & Job Sheet (halaman lembar kerja tersendiri, nilai otomatis, cetak), Diagnosis (studi kasus: pemeriksaan → penyebab → pembahasan & skor), Evaluasi (soal berurutan A–D, pembahasan), Progres terpadu (materi + praktik + diagnosis + kuis, cetak laporan), dan menu **Panduan**.
- Progres tersimpan di `localStorage` (`starterHub_v1`) dan ditampilkan di Progres, Beranda, serta badge LEVEL di sidebar.
- 3D Lab: semua tombol VIEW / DISPLAY / MODE / SET berfungsi dengan status aktif; kunci kontak mini; tur Teaching; suara WebAudio; overlay debug; pemuat model asli `.glb` (lihat `models/README.txt`).

## Revisi 6: Tema Gelap

- **Tema terang/gelap**: tombol di footer sidebar (dan pojok kanan atas halaman login). Urutan: pilihan tersimpan (`localStorage`, kunci `starterLab_theme`) -> preferensi sistem (`prefers-color-scheme`) -> terang. `theme.js` dimuat di `<head>` agar tidak ada kedip saat halaman dibuka.
- Seluruh warna terang yang tadinya di-hardcode di `style.css` (latar putih/pastel, border, teks) kini memakai token `--color-*`; tema gelap cukup mendefinisikan ulang token di blok "TEMA GELAP" pada akhir `style.css`. Area yang memang gelap (3D Lab, panel instrumen) tidak diubah.
- Catatan: `three.min.js` sengaja tidak dimuat malas. Scene 3D dibangun saat `DOMContentLoaded` dan tes memeriksa tag-nya di `index.html`; memuat malas perlu mendesain ulang inisialisasi `visual3d.js`.

## Revisi 5: Poles Tampilan Lanjutan (poin 6-10)

- **Diagram Simulator**: label lebih besar dengan halo putih, warna kabel menurut fungsi (merah +, hitam massa, kuning sinyal), legenda lipat di bawah diagram, zoom di desktop (tombol, Ctrl + roda mouse).
- **3D Lab**: label kini mode **PILIHAN** (bawaan: hanya komponen terpilih / di-hover) -> **SEMUA** -> **OFF** lewat satu tombol di pojok kiri atas kanvas. Kontrol bawah dikelompokkan dalam tab Tampilan / Sistem / Mode / Pengaturan (id tombol tidak berubah).
- **Beranda**: kartu "Mulai dari sini / Lanjutkan belajar" berisi langkah berikutnya, Jalur Belajar berbentuk stepper horizontal, kartu menu lebih ringkas.
- **Mikro-interaksi**: bar progres terisi animatif, kartu muncul bertahap, tombol punya umpan tekan; semua mati bila `prefers-reduced-motion` atau "Kurangi gerak" aktif.
- **Gambar**: setiap foto komponen punya versi `.webp` (total 2,0 MB -> 233 KB). `DiagramPhotos` mencoba webp lebih dulu, lalu png/jpg sebagai cadangan; `.png` dipertahankan.

## Revisi 4: Poles Tampilan

- **Banner Mode Demo** kini strip tipis di atas halaman (bukan pil melayang yang menutupi konten) dan bisa ditutup (tombol x, berlaku per tab).
- **Header halaman seragam**: kicker (Utama / Pembelajaran / Referensi) + judul + subjudul di semua halaman; daftar Praktik selebar konten.
- **Skala tipografi** (`--fs-xs` 12px s.d. `--fs-xl` 28px) ditambahkan di akhir `style.css`.
- **Toolbar Simulator** dua baris: alat utama (MULTI, DIAG, Fault, Reset) + Aliran arus + Lainnya. "Kurangi gerak" dan SKEMA/FOTO pindah ke menu Lainnya. Di ponsel tombol utama berbentuk grid 4 kolom sehingga diagram tampak lebih cepat.
- **Keadaan kosong dashboard siswa**: berikon, tanpa garis putus-putus; kartu Nilai dan Notifikasi digabung saat keduanya kosong.

## Revisi: Kelola Data Guru/Siswa, Edit Kelas, dan Detail

**Dashboard Superadmin** (`/superadmin`) - tiga tab: *Sekolah & Pendaftaran*, *Data Guru*, *Data Siswa*.
- Kelola **semua** guru dan siswa lintas sekolah: tambah, edit (nama, username, email, NIS, sekolah, sandi baru, status, kelas), nonaktifkan/aktifkan, hapus (konfirmasi dua langkah), cari, dan filter per sekolah.
- Tombol **Detail**: profil, kelas, tugas & nilai, progres belajar, aktivitas (siswa); kelas yang diajar dan tugas menunggu nilai (guru).
- Bila server aktif, daftar pengguna dari server ikut dimuat, dan tambah/edit/status disinkronkan ke server (endpoint baru `PUT /api/v1/admin/users/:id`).

**Dashboard Guru** - bagian baru **Data Siswa - Sekolah Saya**.
- Hanya siswa dari **sekolah yang sama** (atau siswa di kelas yang diajar) yang tampil dan dapat dikelola; ditegakkan di fungsi `canManageUserData`, bukan hanya disembunyikan.
- Tambah siswa (sekolah otomatis = sekolah guru), edit data, nonaktifkan/aktifkan, atur kelas lewat checkbox, **Keluarkan** dari kelas (akun tetap ada), Detail.
- **Edit kelas**: tombol *Edit* di setiap kelas (nama, mata pelajaran, tahun ajaran, kode gabung aktif/nonaktif), *Arsipkan Kelas*, dan daftar *Kelas Diarsipkan* untuk mengaktifkan kembali.

**Perbaikan bug**
- Tombol *Detail* sebelumnya error karena memanggil `P8.analyticsRepository` (yang benar: `P8.repositories.analyticsRepository`), sehingga seluruh dashboard gagal dirender. Detail kini memakai builder baru.
- Pesan sukses/gagal di dashboard sebelumnya tidak pernah tampil; kini tampil di atas dashboard. Error render ditangkap dengan tombol *Segarkan*.
- Akun yang dinonaktifkan kini tidak bisa masuk walau server masih menganggapnya aktif.
- Server: `PATCH /admin/users/:id` memakai id yang salah (`users`), sehingga selalu 404. Sudah diperbaiki.

Tes baru: `node test/manage.test.js` (73 tes).

Catatan: perubahan oleh **guru** tersimpan di data lokal browser (seperti fitur kelas/tugas yang sudah ada). Hanya perubahan **Superadmin** yang disinkronkan ke server.

## Tanpa Data Contoh & Login Wajib

**Tidak ada data contoh.** Produk tidak membawa sekolah, guru, atau siswa contoh (juga tidak ada akun demo di halaman login). Satu-satunya akun awal adalah **Superadmin** (`/superadmin`, username `superadmin`; sandi awal `superadmin123` atau nilai env `SIM_SUPERADMIN_PASSWORD` - segera ganti/atur sendiri). Sekolah, guru, dan siswa dibuat oleh Superadmin (tab Sekolah/Guru/Siswa/Kelas) atau lewat pendaftaran di halaman login (*Daftar Sekolah*, lalu *Daftar* untuk guru/siswa). Data contoh versi lama yang sudah tersimpan di browser atau database server dibersihkan otomatis (hanya yang persis cocok id + nama aslinya; data nyata tidak disentuh).

**Kecuali: roster siswa SMKN 3 Makassar.** Dua data nyata yang diimpor otomatis (hanya bila berkas `data/roster.json` ada; paket ini hanya menyertakan `data/roster.example.json` sebagai contoh format, salin dan isi sebagai `roster.json`) dan bukan contoh: sekolah **SMKN 3 Makassar**, kelas **XI TKR 1**, beserta **36 akun siswa** dari berkas `data/Daftar Nama Siswa Kelas TKR 1 SMK Negeri 3 Makassar.xlsx` (lihat bagian "Data Siswa XI TKR 1" di bawah). Data contoh lama tetap dibersihkan; impor ini idempoten dan tidak menimpa.

## Data Siswa XI TKR 1 — SMKN 3 Makassar

- 36 siswa kelas **XI TKR 1 SMKN 3 Makassar** diimpor sebagai data siswa dari berkas `data/Daftar Nama Siswa Kelas TKR 1 SMK Negeri 3 Makassar.xlsx`: 1 organisasi, 1 kelas, 36 akun `STUDENT` (anggota kelas).
- **Username** dibuat otomatis dari nama (huruf kecil, tanpa spasi/tanda baca): contoh `Muh Asri` → `muhasri`; **sandi default** semua `siswa123/siswa123` (ubah segera bila dipakai sungguhan).
- **Server** (`backend/seed.js`, `ensureRoster`): dijalankan setiap kali server dinyalakan; idempoten, database lama ikut terisi, tidak menimpa, dan memakai sekolah/kelas yang sudah ada bila cocok namanya (tidak menduplikasi). **Klien** (`authUI.js`, `ensureMakassarRoster`): organisasi, kelas, dan 36 siswa dijamin ada di penyimpanan lokal sehingga kelas **XI TKR 1** dan siswanya tampil di dashboard Superadmin meski dibuka tanpa server.
- NIS/NISN tidak tersedia di berkas sumber, jadi dikosongkan (tidak mengarang).

**Daftar Sekolah** di halaman login hanya berisi: Nama sekolah, Alamat, Nama admin/PIC, Username admin, Password admin (min. 6). Tidak ada pilihan Jenis (otomatis "Sekolah"); pendaftaran ditinjau Superadmin.

**Login wajib setiap membuka link.**
- Link utama (`/`) membuka halaman login, bukan simulator. `index.html` dan `panduan.html` memakai gerbang di `<head>`: halaman disembunyikan dan langsung dialihkan ke `login.html` bila belum login.
- Sesi disimpan di `sessionStorage` (per tab): membuka link di tab/jendela baru atau setelah browser ditutup selalu meminta login; muat ulang di tab yang sama tetap masuk. Sesi lama di `localStorage` tidak berlaku.
- **Mode tamu dihapus**, diganti **Coba Demo** (tombol di halaman login): pratinjau tanpa akun, dibatasi 5 kali per browser, progres tidak disimpan, dan akun demo disembunyikan dari daftar pengguna. Banner demo di atas halaman bisa ditutup.
- Tes: `node test/gate.test.js`.

## 3D Lab: Seluruh Komponen Sistem Starter

Scene 3D kini menampilkan baterai, **fuse** (kotak fuse sendiri dengan sekering pisau), **kunci kontak** (panel + silinder + kunci yang berputar OFF/ON/START), **relay 4 kaki** (30, 86, 85, 87 berlabel), selenoid, motor starter, flywheel + ring gear, dan **mesin** (blok, oil pan, kepala silinder, tutup katup, bell housing, poros engkol, piston). Kabel mengikuti diagram: aki(+) -> fuse IN -> kunci kontak IN / relay kaki 30; kunci kontak OUT -> relay 86; relay 85 -> massa; relay 87 -> terminal S selenoid. Semua komponen baru punya label, info, dan masuk daftar komponen; tampilan cadangan 2D (tanpa WebGL) ikut diperbarui. Tes: `node test/lab3d.test.js`.

Catatan tes: data uji ada di `test/fixtures.js` (nama netral: Sekolah Uji, Guru Uji, Siswa Uji A/B/C) dan tidak ikut ke produk.

## Superadmin: Tambah & Kelola Semua Data

Dashboard Superadmin punya baris **Tambah cepat** (+ Sekolah, + Guru, + Siswa, + Kelas) dan empat tab: *Sekolah & Pendaftaran*, *Data Guru*, *Data Siswa*, *Data Kelas*.
- **Sekolah**: tambah (opsional sekaligus membuat akun admin sekolah), edit nama/jenis/alamat, ganti admin sekolah, nonaktifkan/aktifkan, hapus. Sekolah yang masih punya guru, siswa, atau kelas tidak bisa dihapus (gunakan Nonaktifkan).
- **Guru & Siswa**: tambah, edit, nonaktifkan, hapus, atur kelas, Detail (lihat revisi sebelumnya).
- **Kelas**: tambah untuk sekolah mana pun dan tentukan guru pengajar, edit, arsipkan/aktifkan, hapus (tugas, kiriman, dan keanggotaan siswa ikut dibersihkan).
- Semua aksi diperiksa di fungsi (hanya peran ADMIN), bukan hanya disembunyikan; hapus selalu meminta konfirmasi dua langkah.
- Tes: `node test/manage.test.js` (111 tes).

## Jaringan Kabel Sesuai Terminal Komponen

Diagram simulator kini memakai terminal nyata di setiap komponen (lingkaran kecil berlabel); setiap kabel berujung tepat di terminal, tidak lagi menembus ke tengah komponen.
- **Aki**: kutub (+) ke terminal 30 selenoid (kabel tebal) dan cabang ke fuse; kutub (-) ke bus massa.
- **Fuse**: IN dari aki, OUT ke kunci kontak dan ke relay kaki 30.
- **Kunci kontak**: IN dari fuse, OUT ke relay kaki 86.
- **Relay 4 kaki**: 30 (umpan + dari fuse), 86 (+ kumparan dari kunci kontak), 85 (- kumparan ke massa), 87 (keluaran kontak ke terminal 50 selenoid).
- **Selenoid**: 30 (aki), 50 (kontrol dari relay 87), C (ke motor starter), G (massa).
- **Motor starter**: terminal + dari terminal C selenoid, casing ke massa. **Massa**: bus massa menghubungkan aki (-), relay 85, selenoid G, casing starter, blok mesin, dan sasis.
- Kabel kaki 30 dan 87 menyala hanya saat kontak relay menutup; aliran arus (partikel) mengikuti jalur baru.
- Titik ukur multimeter kini tepat di terminal, dan ada titik baru **Relay Pin 30**. Model resistansi dan tegangan (`realtimeParameter.js`, `multimeter.js`) diperbarui: fuse -> kaki 30 -> kontak 30-87 -> kaki 87.
- Mode foto tetap menampilkan terminal dan kaki di atas foto komponen.
- Tes: `node test/wiring.test.js`.

## Foto Asli Komponen pada Diagram

Diagram simulator kini mendukung **foto asli** untuk aki, fuse, kunci kontak, relay, selenoid, motor starter, pinion, flywheel, dan mesin. Letakkan fotonya di folder `images/` dengan nama `aki`, `fuse`, `kunci-kontak`, `relay`, `selenoid`, `motor-starter`, `pinion`, `flywheel`, `mesin` (png/webp/jpg/jpeg). Detail ada di `images/README.txt`.
- Komponen tanpa foto tetap memakai gambar skema, jadi boleh diisi satu per satu.
- Tombol **SKEMA/FOTO** di toolbar mengganti tampilan.
- Animasi, titik status, label, klik komponen, fault, dan aliran arus tetap berfungsi. Foto flywheel ikut berputar saat cranking.
- Tes: `node test/photos.test.js`.

## Cara Menjalankan

Buka `index.html` langsung di browser (double-click), atau jalankan server lokal:

```bash
# Python
python -m http.server 8000
# lalu buka http://localhost:8000
```

Tidak ada backend, tidak ada dependency, tanpa library eksternal.

## Teknologi

- HTML5
- CSS3
- JavaScript ES6+
- SVG (diagram interaktif)
- LocalStorage (progress)

## Struktur Folder

```
/starter-simulator
├── index.html      # Struktur halaman, SVG diagram, kontrol, panel Phase 2+3+4+5
├── style.css       # Tema "Modern Automotive Dashboard" + gaya Phase 2+3+4+5
├── app.js          # State machine, logika, animasi, modul, API stubs
├── realtimeParameter.js       # Simulation loop, parameter realtime, gauges, grafik, log, API
├── multimeter.js       # Virtual multimeter, praktik pengukuran, worksheet, safety, skor
├── diagcases.js    # Phase 4: data 13 kasus, knowledge base, perbaikan, decision tree, config
├── diagnosticLab.js       # Phase 4: engine diagnosis + evidence engine + skor + UI lab
├── learningModules.js   # Phase 5: 5 modul pembelajaran + alur prasyarat + praktik
├── learningLessons.js   # Phase 5: 22 lesson/sections materi per modul
├── learningQuestions.js # Phase 5: 29 soal (6 tipe) + penjelasan
├── learningJobSheets.js # Phase 5: 10 job sheet (JS-001..JS-010)
├── learningAssessment.js       # Phase 5: Learning & Assessment engine + UI + storage + report
├── test/
│   ├── acceptance.test.js   # 39 test Phase 1
│   ├── realtimeParameter.test.js       # 71 test Phase 2
│   ├── multimeter.test.js       # 39 test Phase 3
│   ├── diagnosticLab.test.js       # 82 test Phase 4
│   └── learningAssessment.test.js       # 149 test Phase 5 (TESTS 01-10 + integritas data)
└── README.md
```

## Menjalankan Test

Tanpa browser, pakai Node (tanpa dependency):

```bash
node test/acceptance.test.js   # Phase 1: 39 test (harus pass)
node test/realtimeParameter.test.js       # Phase 2: 71 test (harus pass)
node test/multimeter.test.js       # Phase 3: 39 test (harus pass)
node test/diagnosticLab.test.js       # Phase 4: 82 test (harus pass)
node test/learningAssessment.test.js       # Phase 5: 149 test (harus pass)
```

Suites memakai `node:vm` + DOM mock minimal + `Math.random` deterministik, sehingga hasilnya stabil tanpa perlu browser.

## Fitur (Phase 1)

- Layout dashboard otomotif modern dan responsive
- Diagram SVG interaktif sistem starter (battery → fuse → ignition → relay → solenoid → starter motor → pinion → ring gear → engine)
- Ignition switch 3 posisi (OFF / ON / START)
- State machine dengan urutan realistis:
  `OFF → IGNITION_ON → RELAY_ACTIVE → SOLENOID_ACTIVE → PINION_ENGAGED → STARTER_CRANKING → ENGINE_RUNNING`
- Animasi armature, pinion, flywheel, dan kunci kontak
- Visualisasi aliran arus (toggle "Current Flow") terkait status sistem
- Panel instrumen realtime (battery voltage, starter current, starter RPM, engine RPM, status)
- Informasi komponen saat diklik
- Fault injection (10 kerusakan) yang memengaruhi perilaku sistem
- Materi (14 modul), Praktik, Diagnosis, Quiz, Progress (kerangka Phase 2-5)

## Fitur (Phase 2) — Parameter & Visualisasi Real-Time

- Simulation loop tunggal `requestAnimationFrame` (`realtimeParameter.js`) dengan smoothing lerp ramah frame-rate
- Model tegangan beban: `V_load = V_oc - I × R_internal`; tegangan turun (voltage sag) saat cranking
- Kondisi battery: GOOD (12,6 V), WEAK (12,0 V), DISCHARGED (11,0 V)
- Arus starter normal 150–250 A (basis 185 A), dikali faktor battery/mechanis/fault
- Gauge digital berbasis DOM: TACH (engine RPM), BATT (tegangan), CRANK (arus)
- Technical Data panel: tegangan tiap node circuit + voltage drop positif/ground
- Timeline starter (REST → IGN → RELAY → SOL → PINION → CRANK → RUN)
- Event log (timestamp `MM:SS`) dengan tombol CLEAR + event dari EventBus
- Data graph (canvas): battery voltage & starter current vs waktu (ring buffer 500 titik)
- Recording + **Export CSV** (REC / STOP / CSV)
- Aliran partikel arus berhenti di titik gangguan (fuse putus, kabel putus, relay/solenoid rusak)
- Label tegangan live pada kabel utama SVG + penanda "X" pada titik gangguan
- Mode BASIC/TECHNICAL via tombol toolbar; Debug panel (STATE, V, I, RPM, fault)
- Toggle **Reduce Motion** (mematikan animasi/transisi) + `prefers-reduced-motion`
- Responsive: panel menumpuk di layar kecil

## Fitur (Phase 3) — Virtual Multimeter & Praktik Pengukuran

- Lab multimeter virtual (tombol **MULTI**): tampilan digital V DC / A DC / Ω / CONTINUITY / V DROP
- Probe merah (RED) & hitam (COM): klik titik ukur pada diagram SVG atau daftar "Measurement Points"; urutan otomatis RED → COM
- Garis penghubung probe dari multimeter ke titik ukur + label titik
- 17 node pengukuran di `realtimeParameter.js` (`computeNodeVoltages` + `getVoltageAtNode`) sebagai satu sumber kebenaran
- **V DC**: tegangan node relative (termasuk polaritas terbalik → nilai negatif, node sama → 0 V)
- **A DC** (disiapkan): arus jalur starter / solenoid-control / relay-coil sesuai posisi probe
- **Ω**: model resistansi berbasis grafik (Dijkstra) dengan nilai realistis —
  fuse 0.02Ω (OL jika putus), relay coil 3.2Ω, solenoid coil 0.57Ω, starter winding 0.02Ω (OL jika motor rusak),
  kabel positif 0.01Ω (OL jika putus), ground normal 0.01Ω / poor 0.035Ω
- **CONTINUITY**: beep bila ≤10Ω (sound checkbox), menampilkan CONTINUITY / NO CONTINUITY
- **V DROP**: `calculateVoltageDrop` antar node (position/ground drop otomatis dihitung)
- **Safety rule**: pengukuran Ω/CONTINUITY saat sistem berenergi **diblokir** → modal
  `[MATIKAN SISTEM]` (reset + lanjut) / `[CANCEL]`; tercatat di event log + penalti skor safety
- Riwayat pengukuran (history, 50 entri), worksheet (auto-add), **Export CSV worksheet**
- **8 praktik terbimbing** (P1–P8): Battery Voltage, Ignition Switch Voltage, Relay Test,
  Solenoid Control Voltage, Starter Motor Voltage, Positive Voltage Drop, Ground Voltage Drop, Fuse Continuity
- FREE MODE untuk pengukuran bebas; skor 4 kategori: PROCEDURE / MEASUREMENT / ACCURACY / SAFETY (masing-masing /25)
- Feedback & assessment per pengukuran (mis. tegangan di bawah normal → indikasi baterai lemah)
- Live pulse (interval 200 ms hanya saat lab terbuka) membaca model `realtimeParameter.js` — satu sumber data simulasi
- Data tiap pengukuran tersimpan terstruktur untuk **Phase 4 (diagnosis)**

## Phase 3 &amp; 4 API

Tersedia lewat `window.Phase2` (dan stub `window.*` di `app.js` yang mendelegasikan ke Phase 2):

```javascript
Phase2.getSystemState()            // 'OFF' | 'STARTER_CRANKING' | 'ENGINE_RUNNING' ...
Phase2.getActiveFault()            // 'openFuse' | null ...
Phase2.getVoltageAtNode('starterPositive')
// node: batteryPositive, ignitionOutput, relayInput, relayOutput,
//       solenoidControl, starterPositive, starterGround, batteryNegative,
//       fuseInput, fuseOutput, ignitionInput, relayGround, solenoidMain,
//       solenoidGround, engineGround, chassisGround, starterHousing
Phase2.getCurrentAtPath('main')    // path: control | solenoid-control | main | starter
Phase2.calculateVoltageDrop('batteryPositive','starterPositive')
Phase2.getComponentState('starter') // { state, rpm, current, voltage, fault }
Phase2.logEvent('pesan')           // catat ke event log
```

Virtual Multimeter tersedia lewat `window.Phase3`:

```javascript
Phase3.setMode('V' | 'A' | 'OHM' | 'CONT' | 'DROP')
Phase3.attachProbe('red' | 'black', 'batteryPositive')  // pasang probe
Phase3.selectProbe('red' | 'black')                     // pilih probe yang akan ditempatkan
Phase3.measure()                          // snapshot pengukuran -> history + worksheet + records
Phase3.getReading()                       // { value, text, unit, ok, ol, level, feedback }
Phase3.getNodeVoltage('starterPositive')  // tegangan node saat ini
Phase3.getNodeState('fuseOutput')         // { name, voltage, energized }
Phase3.getExpectedValue('OHM','fuseInput','fuseOutput')
Phase3.getMeasurementResult('TEST','red','black')
Phase3.toggleLab() / openLab() / closeLab()
Phase3.resetMultimeter()
Phase3.isSafetyBlocked()
Phase3.confirmSafety() / cancelSafety()   // safety modal (Ω/CONT saat berenergi)
Phase3.getHistory() / getWorksheet() / getRecords() | clearHistory() / clearWorksheet()
Phase3.exportWorksheet()                  // CSV worksheet
Phase3.getPractices() / startPractice(i) / nextPractice() / toggleFree()
Phase3.score() / getScores()              // PROCEDURE / MEASUREMENT / ACCURACY / SAFETY (/25)
```

Data tiap pengukuran tersimpan di `Phase3.getRecords()` dalam struktur siap untuk **Phase 4 (diagnosis)**:
`{ test, redProbe, blackProbe, value, unit, timestamp, systemState, activeFaults, ol }`.

## Fitur (Phase 4) — Diagnostic &amp; Troubleshooting Lab

- Lab diagnosis + troubleshooting (tombol **DIAG** di toolbar simulator)
- 13 kasus kerusakan tersembunyi (CASE_001–CASE_013): weak battery, discharged battery,
  loose terminal, open fuse, ignition failure, relay coil open, relay contact open, solenoid open,
  solenoid main-contact, open positive cable, poor ground, starter motor failure,
  bonus `CASE_013` (relay contact open, medium) untuk diuji di test suite
- **Hidden fault tidak bocor**: fault disuntikkan via hook param langsung (`FAULTS[key].apply()` +
  set `Sim.*`), bukan melalui `Sim.activeFaults`, sehingga panel Fault / Phase 3 record tetap bersih.
  Khusus relay / solenoid / motor, `applyFault()` me-reset 5 hook: `terminalResistance`,
  `cableResistanceMult`, `relayFaultType`, `solenoidMainFail`, `pinionFail`
- Evidence engine berbasis **pengukuran nyata Phase 3** (satu sumber kebenaran):
  tiap hipotesis punya signature (mode, red→black, rentang, kondisi `during`)
  → verdict `SUPPORTED` (≥ threshold&nbsp;1/2), `NOT_SUPPORTED` (kontradiksi terbukti),
  `INSUFFICIENT` (bukti belum cukup), `INVALID` (fault type luar KB)
- Estimasi tegangan realistis: rest WEAK 12,0 V; crank battery 11,35 V; starter 11,20 V;
  arus cranking weak battery ≈130 A; relay contact-open → solenoid OFF, starter OFF,
  relayInput 12,6 V / relayOutput 0 V, coil 3,2 Ω
- Pembobotan hipotesis mdl: setiap pengukuran otomatis vs semua signature lainnya untuk
  menghitung kontradiksi (mendukung sub-hipotesis), filter `during` mencegah kontradiksi palsu
- Confidence: LOW / MEDIUM / HIGH (0/1/2+ signature cocok) → **CONFIRMED** setelah
  perbaikan yang benar diverifikasi (starter benar-benar cranking pasca-repair)
- Decision tree interaktif + **GUIDED** mode (langkah terbimbing otomatis) /
  **STANDARD** (tree manual) / **FREE** (bebas)
- Hipotesis + evaluasi, kirim diagnosis; repair (11 tindakan) + prosedur;
  **VERIFY REPAIR** = cranking ulang & observasi sehat (require engine berputar untuk kasus starter)
- Skor 100 poin: initialInspection / measurementProcedure / correctMeasurements /
  diagnosticReasoning / rootCause / repairProcedure / verification; penalti wrong hypothesis 6,
  wrong repair 7, no-verify 2, hints (1/2/3)
- Worksheet 9 kolom + **DIAGNOSTIC REPORT** otomatis; riwayat sesi tersimpan di
  localStorage (`phase4DiagnosticSessions`); activity log; panel DEBUG (toggle internal)

## Phase 4 API

```javascript
Phase4.startDiagnosticCase(caseId)       // caseId: 'CASE_005' | index | objek kasus (default: kasus pertama)
Phase4.startRandomCase(difficulty?)      // 'easy' | 'medium' | 'hard' | '' (acak)
Phase4.getCurrentCase() / getHiddenFault() // getHiddenFault: hanya di debug mode
Phase4.getSymptoms() / getDiagnosticState()
Phase4.resetDiagnosticCase()
Phase4.setMode('GUIDED' | 'STANDARD' | 'FREE') / getMode()
Phase4.createHypothesis(component, faultType)
Phase4.evaluateHypothesis(idOrIdx) / evaluateHypothesisByKey(component, faultType)
Phase4.getEvidence() / getMeasurementHistory()
Phase4.calculateDiagnosticConfidence(component?, faultType?)
Phase4.submitDiagnosis({ component, faultType })
Phase4.applyRepair(repairId) / verifyRepair()
Phase4.generateDiagnosticReport() / getDiagnosticScore()
Phase4.getActivityLog() / observeSystem(label) / useHint() / getSavedSessions()
Phase4.getTreeQuestion() / answerTree(optionLabel) / nextGuidedStep()
Phase4.fillWorkbook() / clearWorkbook() / renderReport()
Phase4.toggleLab() / openLab() / closeLab()
Phase4.setDebug(on) / getDebug()
```

## Fitur (Phase 5) — Learning &amp; Assessment System

- **Learning Lab** di halaman *Materi*: dashboard → daftar modul → lesson → praktik terbimbing
- **5 modul ber-prasyarat berantai** (`starter-basic` → `starter-circuit` → `starter-principles`
  → `starter-measurement` → `starter-diagnosis`); toggle OPEN ALL untuk mode instruktur/demo
- **22 lesson** dengan sections bertipe TEXT / LIST / STEPS / TABLE / INTERACTIVE (info komponen) /
  SIMULATOR_LINK (lompat ke simulator/multimeter/diagnosis); 5 learning objective per modul
  dengan status NOT_STARTED / IN_PROGRESS / PRACTICED / MASTERED
- **5 praktik terbimbing** otomatis tervalidasi oleh kondisi nyata simulasi:
  `pract-basic` (battery voltage 5 langkah), `pract-circuit` (rangkaian),
  `pract-sequence` (urutan 6 langkah, penilaian urutan), `pract-drop` (voltage drop 6 langkah),
  `pract-diag` (alur diagnosis lengkap 5 langkah, termasuk langkah repair)
- **Kuiz knowledge** (halaman *Evaluasi* / Assessment Center): pemilihan acak per modul,
  6 tipe soal — MULTIPLE_CHOICE, TRUE_FALSE, MULTIPLE_RESPONSE (partial credit),
  MATCHING (skor proporsional), ORDERING (penilaian urutan), SCENARIO; semua punya penjelasan;
  review jawaban + rekomendasi; hasil & rata-rata tersimpan
- **Practical assessment** berbasis **Diagnostic Engine Phase 4** (kasus tersembunyi):
  rubric 8 kriteria (safetyProcedure 10, measurementProcedure 15, measurementAccuracy 20,
  diagnosticReasoning 20, repairProcedure 10, verification 10, documentation 5,
  initialInspection 10) total **100**
- **Skor skill terpisah**: Knowledge (kuiz), Practical Skill (rubric + praktik), Diagnosis
  (skor Phase 4) — sesuai requirement §26
- **Progres otomatis** (halaman *Progres*): overall percent berbobot
  (modul 30%, lesson 30%, job sheet 20%, diagnosis 10%, assessment 10%), rekap modul/lesson/
  job sheet/kasus/kuiz, pelacakan objective, profil siswa, pencapaian, laporan + sertifikat
  (print-ready), data &amp; settings
- **7 achievement** (`FIRST_LESSON`, `FIRST_QUIZ`, `FIRST_MEASUREMENT`, `ELECTRICAL_ANALYST`,
  `TROUBLESHOOTER`, dll.) — dibuka otomatis oleh `checkAchievements()` pada setiap aktivitas
- **Job Sheet Digital** (halaman *Job Sheet*): 10 job sheet JS-001..JS-010; tujuan, alat,
  keselamatan, langkah, **pengukuran nyata Phase 3 otomatis disalin**, observasi + jawaban +
  kesimpulan (textarea), validasi kelengkapan, SIMPAN / TANDAI SELESAI / PRINT
- **Data &amp; storage**: prefix `p5` (semua key `p5*`), `APP_DATA_VERSION: 1`; backing &
  restore; **Export/Import JSON** (validasi `INVALID_JSON` / `NO_VERSION`); reset progres
  dengan konfirmasi
- **Konfigurasi** di `learningModules.js` → `LEARNING_CONFIG`: `assessmentSettings`,
  `practicalRubric`, `mastery`, `achievements`

## Phase 5 API

Tersedia lewat `window.Learning` (sama dengan `window.Phase5`):

```javascript
Learning.getModules() / getModule(id) / getObjectives(moduleId)
Learning.moduleProgress(id) / computeMastery(moduleId)
Learning.startModule(id) / openModule(id) / renderDashboard()
Learning.getLesson(id) / startLesson(id) / completeLesson(id) / openLesson(moduleId, lessonId)
Learning.practiceDefs() / getPractice(id) / getPracticeSteps(id)
Learning.startPractice(id) / checkPracticeStep(id, stepIndex) / checkAllSteps(id)
Learning.setPracticeSequence(id, order) / completePractice(id)
Learning.getJobSheets() / startJobSheet(id) / saveJobSheet(id, data) / completeJobSheet(id)
Learning.getJobSheetResult(id) / jobSheetValidation(id)
Learning.generateAssessment({ moduleId, questionCount, types })
Learning.startAssessment(opts) / activeSession() / answerQuestion(null, qIndex, answer)
Learning.finishAssessmentNow() / abortAssessment()
Learning.getAssessmentResults() / getReview(resultId) / assessmentAverage()
Learning.startPracticalAssessment(caseId) / computePracticalRubric() / completePracticalAssessment()
Learning.getDiagnosticHistory() / diagnosticsDoneCount()
Learning.computeOverallProgress() / checkAchievements() / getAchievements()
Learning.generateReport() / generateCertificate() / skillSummary()
Learning.exportData() / importData(json) / confirmReset() / requestReset()
Learning.renderAll() / renderDashboard() / renderProgressPage()
Learning.renderAssessmentCenter() / renderJobSheets() / renderModule(id)
```

`answerQuestion(null, qIndex, answer)` dengan session `null` memakai sesi aktif;
jawaban tipe data: `int` (MC/TF/SCENARIO), `array of int` (MR/MATCHING/ORDERING),
`null` = tidak menjawab (0 poin).

## State Machine

| State               | Relay | Solenoid | Pinion  | Starter | Engine   |
|---------------------|-------|----------|---------|---------|----------|
| OFF                 | OFF   | OFF      | DISENG  | OFF     | OFF      |
| IGNITION_ON         | OFF   | OFF      | DISENG  | OFF     | OFF      |
| RELAY_ACTIVE        | ACT   | OFF      | DISENG  | OFF     | OFF      |
| SOLENOID_ACTIVE     | ACT   | ACT      | DISENG  | OFF     | OFF      |
| PINION_ENGAGED      | ACT   | ACT      | ENGAGED | OFF     | OFF      |
| STARTER_CRANKING    | ACT   | ACT      | ENGAGED | CRANK   | CRANKING |
| ENGINE_RUNNING      | OFF   | OFF      | DISENG  | OFF     | RUNNING  |

## Parameter Simulasi

Di `app.js`, bagian `CONFIG`:

```javascript
CONFIG.battery.goodVoltage         // 12.6 V  (GOOD)
CONFIG.battery.weakVoltage         // 12.0 V  (WEAK)
CONFIG.battery.dischargedVoltage   // 11.0 V  (DISCHARGED)
CONFIG.battery.internalResistance  // 0.005 ohm (model V = Voc - I*R)
CONFIG.starter.baseCurrent         // 185 A basis arus cranking
CONFIG.starter.baseCrankingRPM     // 220 RPM
CONFIG.starter.relayCurrent        // 4 A (kumparan relay)
CONFIG.starter.solenoidCurrent     // 22 A (kumparan solenoid)
CONFIG.cable.resistance            // 0.0012 ohm (drop positif)
CONFIG.ground.resistance           // 0.0011 ohm normal
CONFIG.ground.poorResistance       // 0.0045 ohm saat poor ground
CONFIG.timings.relay               // delay antar state (ms)
CONFIG.starter.engineStartChance   // probabilitas engine start
```

Ubah nilai tersebut untuk mengubah perilaku simulasi. Nilai adalah **nilai simulasi pembelajaran**, bukan spesifikasi universal semua kendaraan.

## Menambah Fault Baru

1. Tambahkan entri di objek `FAULTS` pada `app.js`:

```javascript
myNewFault: {
    label: 'Nama Kerusakan',
    apply() { Sim.parameterBaru = true; },
    clear() { Sim.parameterBaru = false; },
    isActive() { return Sim.activeFaults.includes('myNewFault'); },
},
```

2. Tambahkan checkbox di `index.html` (panel Fault):
```html
<label class="fault-item"><input type="checkbox" class="fault-check" data-fault="myNewFault"> Nama Kerusakan</label>
```

3. Tambahkan logika pengaruh fault pada `handleStartRequest()` / `relayCondition()` / `updateSystemVisuals()`.

## Menambah Materi

Edit array `MATERI_MODULES` di `app.js`:

```javascript
{ id: 15, title: 'Judul', desc: 'Deskripsi', sim: 'simulator' }
```

## Menambah Quiz

Edit array `QUIZ_QUESTIONS` di `app.js`:

```javascript
{
    q: 'Pertanyaan?',
    options: ['A', 'B', 'C', 'D'],
    answer: 0,
    explain: 'Penjelasan jawaban.',
}
```

(`answer` adalah index 0-based dari array `options`.)

## Menambah Kasus Diagnosis

Edit array `DIAGNOSIS_CASES` di `app.js`. Setiap kasus memiliki checks (daftar pemeriksaan), hint bertingkat, dan `correctDiagnosisId`.

## Aksesibilitas

- Navigasi keyboard pada tombol ignition (Enter / Space)
- `aria-label` dan `role`
- `:focus-visible` outline
- `prefers-reduced-motion` didukung + toggle "Motion" (Phase 2)
- Status tidak hanya ditunjukkan warna (ada teks)

## Roadmap

- **Phase 2 ✅:** parameter realtime (V/I/RPM), voltage sag, gauges, timeline, event log, data graph, recording CSV, debug panel, mode BASIC/TECHNICAL, reduce motion, Phase 3 API
- **Phase 3 ✅:** virtual multimeter (V DC / A DC / Ω / CONTINUITY / V DROP), 17 node ukur, probe klik/daftar, safety rule, praktik terbimbing + free mode, worksheet + CSV, skor, record untuk Phase 4
- **Phase 4 ✅:** diagnostic &amp; troubleshooting lab — 13 kasus hidden fault, evidence engine berbasis pengukuran Phase 3, decision tree + mode GUIDED/STANDARD/FREE, repair + verifikasi, skor 100, worksheet + diagnostic report, riwayat sesi, 82 test
- **Phase 5 ✅:** Learning &amp; Assessment System — 5 modul, 22 lesson, 5 praktik terbimbing, 29 soal (6 tipe), 10 job sheet, practical assessment (rubric 100), progres otomatis, 7 achievement, export/import data, laporan &amp; sertifikat, 149 test (TESTS 01-10)
- **Phase 6:** cutaway, audio, mode guru

## Link login (portal terpisah)

| Pengguna | Link | Keterangan |
|---|---|---|
| Siswa & Guru | `http://127.0.0.1:8088/login` (atau `login.html`) | Menolak akun Superadmin |
| Superadmin | `http://127.0.0.1:8088/superadmin` (atau `superadmin.html`) | Hanya menerima akun Superadmin; tanpa tab Daftar/Tamu |

- Pemisahan ditegakkan di **server** (`POST /api/v1/auth/login` menerima field `portal`: `superadmin` atau `general`; error `WRONG_PORTAL` bila akun salah portal), bukan hanya disembunyikan di tampilan.
- Akun demo Superadmin tidak lagi ditampilkan di halaman login umum. **Ganti sandi bawaan sebelum dipakai sungguhan.**

## Identitas siswa di menu Progres

- Nama, kelas, sekolah, dan NIS di menu **Progres** (form hub dan *Student Profile*) otomatis mengikuti **akun yang sedang masuk** dan terkunci (read-only). Tamu tetap bisa mengisi manual.
- Data progres lokal dipisah **per akun**: bila siswa B login di browser yang sama, progres siswa A disimpan terpisah dan kembali utuh saat A login lagi.
- Login kini menunggu jawaban server sebelum pindah halaman, sehingga token sesi dan progres ke server tidak lagi hilang.
- Tes: `node test/portal.test.js`

## Konfigurasi Keamanan & Data (StarterLab)

- **Wajib ganti sandi bawaan.** Superadmin awal (`superadmin` / `superadmin123`) tidak bisa masuk ke aplikasi atau memakai endpoint admin sebelum sandi diganti (min. 8 karakter, tidak boleh sama dengan sandi bawaan). Layar ganti sandi muncul otomatis pada login pertama; server menegakkannya lewat `POST /api/v1/auth/change-password`. Database lama yang masih bersandi bawaan ditandai otomatis saat server dinyalakan. Jika sandi diatur lewat env `SIM_SUPERADMIN_PASSWORD`, penggantian tidak dipaksa.
- **Tanpa data siswa nyata di kode.** Daftar nama roster tidak lagi tertanam. Untuk mengimpor satu kelas, sediakan daftar nama di instalasi itu saja: server membaca `data/roster.json`, mode browser membaca `window.STARTERLAB_ROSTER` di `config.js` (lihat `data/roster.example.json`). Tanpa daftar, impor tidak melakukan apa pun.
- **Sandi akun roster**: atur lewat env `SIM_ROSTER_PASSWORD` (bawaan `siswa123` hanya untuk latihan; minta siswa menggantinya).
- Tes baru: `node test/firstlogin.test.js` (16 tes).

## Mode Demo

Halaman login memiliki tombol **Coba Demo** agar calon pengguna dapat melihat tampilan aplikasi tanpa mendaftar.
- **Batas 5 kali per perangkat/browser.** Hitungan bertambah setiap demo *dimulai* (muat ulang di tab yang sama tidak menambah). Setelah 5 kali, tombol nonaktif dan pengguna diarahkan untuk mendaftar.
- **Terisolasi.** Demo memakai akun siswa sementara yang tidak tampil di daftar pengguna/dashboard, tidak terhubung ke server, dan selalu mulai dari data bersih. Data belajar demo dibuang saat keluar, sedangkan data akun asli di browser yang sama tetap aman.
- **Fitur tulis dibatasi** (mis. bergabung ke kelas) dan banner "Mode Demo" tampil di dalam aplikasi.
- **Catatan:** penghitung tersimpan di browser (localStorage), jadi dapat diatur ulang dengan menghapus data situs atau memakai browser lain. Batas ini bersifat pembatas wajar, bukan kontrol keamanan. Ubah batas lewat konstanta `DEMO_MAX` di `authUI.js`.
- Tes: `node test/demo.test.js` (23 tes).

## Foto Asli di 3D Lab

Kunci kontak, fuse, dan relay di 3D Lab memakai foto asli dari `images/` (`kunci-kontak.png`, `fuse.png`, `relay.png`; latar transparan).
- Foto dipasang menghadap depan dengan ketebalan gelap di belakangnya, dan ujung kabel tepat berada di terminal pada foto (IN/OUT fuse, IN/OUT kunci kontak, kaki 30/85/86/87 relay).
- **Lampu status kecil** pada tiap komponen: relay hijau saat kontak menutup, fuse hijau/merah (putus), kunci kontak abu-abu (OFF) / kuning (ON) / hijau (START).
- Fokus kamera untuk ketiga komponen kini dari depan agar foto terlihat jelas.
- Foto dimuat saat aplikasi dibuka lewat server (`node server.js` atau server HTTP lain). Jika dibuka langsung dari `file://`, browser memblokir tekstur foto di WebGL, sehingga model 3D prosedural lama dipakai sebagai cadangan.
- Ganti foto dengan menimpa berkas di `images/` (rasio terminal pada `PHOTO.parts` di `visual3d.js` perlu disesuaikan bila bentuk foto berbeda).
- Tes: `node test/photo3d.test.js` (37 tes).

## Dashboard Guru: akun, siswa, kelas & tugas
- **Akun Saya**: guru mengubah nama sendiri dan sandi (wajib sandi lama, min. 8 karakter, konfirmasi sandi baru). Username tidak berubah.
- **Siswa**: guru mengedit nama, sandi (reset), email/NIS, status, dan kelas siswa di sekolahnya (tombol Edit pada Data Siswa, atau dari Detail siswa).
- **Kelas**: buat kelas, edit nama/mapel/tahun ajaran/kode gabung, arsipkan & aktifkan kembali.
- **Tugas**: buat tugas, lalu **Edit** (judul, kelas, jenis, konten, tenggat, KKM, percobaan, status Draft/Terbit/Arsip, dan siswa tertentu).
- **Tugas siswa**: pada Detail siswa, tiap tugas yang sudah dikirim punya tombol **Edit nilai** (koreksi nilai & umpan balik) dan **Buka ulang** (siswa dapat mengerjakan lagi tanpa menghabiskan percobaan).
- Server (opsional): `PUT /api/v1/me` dan `PUT /api/v1/teacher/students/:id` menyimpan perubahan akun agar login berikutnya konsisten.
- Tes: `node test/teacher.test.js` (27 tes).
