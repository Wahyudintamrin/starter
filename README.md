# StarterLab — Panduan File & Cara Mengedit Manual

Platform pembelajaran sistem kelistrikan otomotif (modul pertama: **Sistem Starter**).
Dokumen ini menjelaskan **fungsi setiap file** dan **file mana yang diedit** untuk perubahan tertentu.
Riwayat perubahan lama (revisi 1–6) dipindahkan ke `CATATAN-REVISI.md`.

---

## 1. Menjalankan & Menguji

```bash
node server.js                         # buka http://127.0.0.1:8088  (otomatis ke halaman login)
node test/instructorPlatform.test.js   # jalankan satu suite tes (ganti nama file sesuai kebutuhan)
```

Kebutuhan: **Node.js 22.5+** (backend memakai `node:sqlite` bawaan, tanpa `npm install`).

| Variabel lingkungan | Fungsi | Bawaan |
|---|---|---|
| `SIM_PORT` | port server | `8088` |
| `SIM_HOST` | alamat bind | `127.0.0.1` |
| `SIM_DB` | lokasi file database SQLite | `data/startersim.sqlite` |
| `SIM_SUPERADMIN_PASSWORD` | sandi awal Superadmin | `superadmin123` (wajib diganti saat login pertama) |

Alamat penting: `/` dan `/login` = login Siswa/Guru, `/superadmin` = login Superadmin,
`/api/health` = cek server, `/api/panduan` = menu panduan teknis, `/api/v1/...` = REST API.

**Setelah mengedit file apa pun, jalankan tes yang terkait** (lihat bagian 6). Semua 21 suite lulus pada paket ini.

---

## 1b. Data bersama lintas perangkat (Supabase)

Bila situs dihosting statis (mis. GitHub Pages), `server.js` tidak berjalan dan data sekolah/guru/siswa
hanya ada di browser masing-masing perangkat. Untuk data bersama, pasang Supabase:
**lihat `supabase/README-SETUP.md`**. Ringkasnya: jalankan `supabase/schema.sql`, isi `window.STARTERLAB_SUPABASE`
di `config.js`. Berkas terkait: `cloud.js` (klien: login, sinkron dua arah, progres), `supabase/schema.sql`
(tabel tertutup + fungsi RPC dengan otorisasi per peran), `test/supabaseSql.test.js`, `test/cloudClient.test.js`.
Dengan `config.js` kosong, aplikasi berjalan seperti semula.

---

## 2. Penggantian Nama File (Phase → nama sesuai isi)

| Nama lama | Nama baru | Isi |
|---|---|---|
| `phase2.js` | **`realtimeParameter.js`** | Parameter & visualisasi real-time (gauge, grafik, log, simulation loop) |
| `phase3.js` | **`multimeter.js`** | Virtual multimeter & praktik pengukuran |
| `phase4.js` | **`diagnosticLab.js`** | Lab diagnosis & troubleshooting (engine + UI) |
| `phase5.js` | **`learningAssessment.js`** | Sistem belajar & asesmen (modul, job sheet, kuis, laporan) |
| `phase6.js` | **`visual3d.js`** | Visualisasi 3D, cutaway & simulasi mekanik |
| `diag7.js` | **`faultEngine.js`** | Mesin gangguan lanjutan (multi-fault, gejala, hipotesis, skenario) |
| `phase8.js` | **`instructorPlatform.js`** | Platform guru, kelas, RBAC, tugas, sinkronisasi cloud |
| `test/phase2.test.js` … `phase8.test.js` | `test/realtimeParameter.test.js`, `multimeter`, `diagnosticLab`, `learningAssessment`, `visual3d`, `faultEngine`, `instructorPlatform` | Tes untuk masing-masing modul di atas |
| `spec/phase8-step20/21/22.txt` | `spec/instructorPlatform-step20/21/22.txt` | Spesifikasi langkah platform guru |

Semua tag `<script>` di `index.html`, `login.html`, `superadmin.html`, `require()` di `server.js`,
serta rujukan di tes dan `panduan.html` sudah disesuaikan.

**Yang sengaja TIDAK diganti** (mengganti akan merusak data tersimpan atau memutus API):
- Objek global `window.Phase2` … `window.Phase8` (dipakai antarmodul dan tes).
- Kunci penyimpanan, mis. `starterSim_phase8_db_v1`, `phase4DiagnosticSessions` (data pengguna yang sudah tersimpan di browser).
- Nilai data seperti `source: 'phase5'` dan komentar judul "PHASE N" di dalam kode atau CSS.

---

## 3. Urutan Pemuatan Skrip (`index.html`) — JANGAN diubah urutannya

Modul saling bergantung lewat variabel global, jadi urutan ini wajib:

1. `theme.js` (di `<head>`, supaya tema terpasang sebelum halaman digambar)
2. `app.js` → `diagramPhotos.js` → `realtimeParameter.js` → `multimeter.js`
3. `diagcases.js` → `diagnosticLab.js`
4. `learningModules.js` → `learningLessons.js` → `learningQuestions.js` → `learningJobSheets.js` → `learningAssessment.js`
5. `three.min.js` → `visual3d.js` → `faultEngine.js`
6. `config.js` → `instructorPlatform.js`
7. `learningHub-data.js` → `progressApi.js` → `learningHub.js`
8. `authUI.js` → `mobile-ui.js`

`login.html` dan `superadmin.html` hanya memuat `theme.js`, `config.js`, `instructorPlatform.js`, `progressApi.js`, `authUI.js`.

---

## 4. Peta File

### 4.1 Halaman HTML

| File | Fungsi |
|---|---|
| `index.html` | Aplikasi utama (satu halaman, banyak `<section id="page-...">`): beranda, dashboard, simulator (SVG diagram + panel), 3D Lab, materi, praktik, diagnosis, evaluasi, progres, job sheet, panduan, tentang. Menu sidebar memakai `data-page="..."` dan `navigateTo('...')`. |
| `login.html` | Halaman masuk Siswa/Guru (memuat `<div id="au-login" data-portal="general">`; tampilannya dibuat `authUI.js`). |
| `superadmin.html` | Halaman masuk Superadmin (`data-portal="superadmin"`), lalu dashboard Superadmin. |
| `panduan.html` | Panduan teknis mandiri; tombolnya memanggil `POST /api/panduan` dan menampilkan perintah tes. |
| `favicon.svg` | Ikon tab browser. |

### 4.2 Tampilan

| File | Fungsi |
|---|---|
| `style.css` | **Satu-satunya stylesheet.** Berurutan: token desain (`--color-*`, `--fs-*`) → sidebar/layout → beranda → simulator & diagram SVG → panel kontrol/instrumen/komponen/gangguan → materi/praktik/diagnosis/kuis → responsif & aksesibilitas → blok per modul (real-time, multimeter, diagnosis lab, belajar, 3D Lab) → Learning Hub → Auth UI (login, dashboard) → penyempurnaan seluler → mode demo → **TEMA GELAP (paling akhir)**. Warna diubah lewat token `--color-*`; tema gelap cukup mendefinisikan ulang token di blok akhir. |
| `theme.js` | Tema terang/gelap: pilihan tersimpan (`starterLab_theme`) → preferensi sistem → terang. Menangani tombol `[data-theme-toggle]`. |
| `mobile-ui.js` | Penyempurnaan ponsel: menu sidebar, zoom/cubit diagram simulator, label tabel jadi kartu. |
| `fonts/` | Font Inter lokal (`inter-400/500/600/700/800.woff`), lisensi `LICENSE-Inter.txt`. Dimuat lewat `@font-face` di `style.css`. |

### 4.3 Inti simulasi

| File | Fungsi & bagian yang bisa diedit |
|---|---|
| `app.js` | Inti Phase 1. `CONFIG` (tegangan aki, arus starter, RPM, waktu relay/solenoid/pinion, resistansi kabel) → `SystemState` & `Sim` (state tunggal simulasi) → `EventBus` → `COMPONENTS` (teks info komponen) → `FAULTS` (definisi gangguan dasar) → navigasi (`navigateTo`) → kontrol kunci kontak → aliran arus → animasi SVG → injeksi gangguan → reset. Bagian `MATERI_MODULES`, `PRAKTIK_ITEMS`, `DIAGNOSIS_CASES`, `QUIZ_QUESTIONS` di akhir file adalah data awal Phase 1; halaman materi/praktik/diagnosis/kuis yang tampil kini dirender `learningHub.js` (kontainer `#materiGrid` bawaan disembunyikan). |
| `realtimeParameter.js` | Model tegangan beban (V = Voc − I×R), simulation loop tunggal `requestAnimationFrame`, gauge (tachometer/volt/ampere), panel data teknis & voltage drop, event log, grafik, rekaman + ekspor CSV, mode BASIC/TECHNICAL, "kurangi gerak". Menyediakan `window.Phase2` (`getVoltageAtNode`, `getCurrentAtPath`, `calculateVoltageDrop`, `getSystemState`, dst.) — **sumber kebenaran nilai ukur**. |
| `multimeter.js` | Multimeter virtual: mode V DC / OHM / CONTINUITY / V DROP, probe merah-hitam, 17+ titik ukur (`NODES`, termasuk koordinat SVG), model resistansi (Dijkstra), aturan keselamatan (OHM/CON saat berenergi diblokir), riwayat & worksheet (ekspor CSV), 8 praktik terbimbing (`PRACTICES`) + mode bebas + skor. `window.Phase3`. |
| `diagramPhotos.js` | Menempel foto asli komponen ke diagram SVG. `SLOTS` berisi posisi/ukuran tiap foto (`x,y,w,h`) dan nama file; mencoba `.webp` → `.png` → `.jpg`, jika tidak ada kembali ke gambar skema. |
| `visual3d.js` | 3D Lab (Three.js r128): pembaca state pusat, kinematika deterministik, registri komponen (`COMPONENTS`, ID wajib), jembatan ke multimeter/diagnosis, HUD, scene motor starter, label, orbit/zoom/pan, mode NORMAL/CUTAWAY/EXPLODED, pemuat model `.glb`, fallback 2D SVG bila WebGL tidak ada. Foto kunci kontak/fuse/relay diatur di `PHOTO.parts`. `window.Phase6`. |
| `three.min.js` | Library Three.js lokal. **Jangan diedit.** |
| `faultEngine.js` | Mesin gangguan lanjutan: multi-fault, tingkat keparahan, intermittent, progresif, interaksi antar-gangguan, mesin gejala (`SYMPTOM_DEFS`, matriks gejala→penyebab), hipotesis, bukti ukur (`FAULT_GROUPS`), katalog & generator skenario deterministik (PRNG berbenih), profil kendaraan. Tanpa `Math.random`; fault tersembunyi tidak bocor ke daftar publik. `window.Phase7` (atau `module.exports` di Node). |

### 4.4 Diagnosis

| File | Fungsi |
|---|---|
| `diagcases.js` | **Data murni** diagnosis: `DIAGNOSTIC_CONFIG` (ambang ukur, bobot skor), `DIAGNOSTIC_CASES` (kasus), `DIAGNOSTIC_KNOWLEDGE`, `REPAIR_ACTIONS`, `DIAGNOSTIC_TREE`. Edit di sini untuk menambah/mengubah kasus tanpa menyentuh logika. |
| `diagnosticLab.js` | Engine + UI lab diagnosis: injeksi gangguan tersembunyi, snapshot observasi, hipotesis, bukti & tingkat keyakinan, perbaikan + verifikasi, skor, laporan sesi, mode GUIDED/STANDARD/FREE. Membaca hasil ukur dari `multimeter.js`. `window.Phase4`. |

### 4.5 Pembelajaran & penilaian

| File | Fungsi |
|---|---|
| `learningModules.js` | `LEARNING_MODULES` (daftar modul & prasyarat) dan `LEARNING_PATH_LEVELS`. |
| `learningLessons.js` | `LEARNING_LESSONS` (isi pelajaran per modul) dan `LEARNING_COMPONENT_INFO`. |
| `learningQuestions.js` | `LEARNING_QUESTIONS` (bank soal + penjelasan) dan `LEARNING_CONFIG` (awalan penyimpanan, definisi pencapaian, pengaturan asesmen). |
| `learningJobSheets.js` | `LEARNING_JOB_SHEETS` (lembar kerja JS-001 dst.). |
| `learningAssessment.js` | Engine + UI pembelajaran: penyimpanan aman-galat, profil, progres, prasyarat modul, pelajaran, praktik, job sheet, mesin asesmen & penilaian praktik, pencapaian, laporan/sertifikat, impor/ekspor/reset. `window.Phase5` / `window.Learning`. Mengambil semua data dari lima file `learning*` di atas. |
| `learningHub-data.js` | Konten Learning Hub: `HUB_MATERI`, `HUB_QUESTIONS`, `HUB_QUIZZES` (+ `HUB_KKM` nilai lulus), `HUB_DIAG_TESTS/CAUSES/CASES` (studi kasus diagnosis). **Juga dibaca server** (`backend/content.js`) untuk mengisi tabel modul — jika mengubah ID/struktur, cek backend. |
| `learningHub.js` | UI halaman Beranda-belajar, Materi (baca per modul), Praktik/Job Sheet, Diagnosis kasus, Evaluasi/kuis, Progres terpadu, cetak laporan. Progres di `localStorage` (`starterHub_v1`). Routing `#/...`. `window.StarterHub`. |

### 4.6 Akun, kelas, dan platform

| File | Fungsi |
|---|---|
| `config.js` | Konfigurasi klien. `window.STARTERLAB_ROSTER = [...]` untuk impor daftar siswa (kosong = tidak ada impor). |
| `instructorPlatform.js` | Platform guru/kelas (berjalan di browser **dan** Node): peran & izin (`ROLES`, `PERMISSIONS`), organisasi/sekolah, kelas & kode gabung, tugas, pengumpulan, penilaian + rubrik, tinjauan sesi diagnosis, penyimpanan (memori/localStorage/IndexedDB), mode offline & antrean sinkronisasi, klien API (adapter mock/rest/graphql/firebase/supabase/custom), analitik, rekomendasi jalur belajar, monitor kesetaraan, ekspor portofolio & capaian. `window.Phase8`. `server.js` memakainya untuk `/api/panduan`. |
| `authUI.js` | UI login/pendaftaran, dashboard Siswa, Guru, dan Superadmin (kelola sekolah, guru, siswa, kelas, detail, nonaktifkan/hapus), mode demo, pemisahan data lokal per akun (`DATA_KEYS`), sesi tab (`sessionStorage`). `window.AuthUI`. |
| `progressApi.js` | Klien REST ke `/api/v1`. **Opsional**: bila server mati, aplikasi tetap penuh memakai `localStorage`. Token disimpan terpisah. `window.ProgressApi`. |

### 4.7 Server & backend (Node)

| File | Fungsi |
|---|---|
| `server.js` | Server HTTP tanpa dependensi: menyajikan file statis (dengan `safeJoin` anti-traversal), rute `/`, `/login`, `/superadmin`, `/api/health`, `/api/panduan`, dan meneruskan `/api/v1/...` ke `backend/api.js`. Dijaga ASCII murni. |
| `backend/db.js` | Koneksi SQLite + migrasi bertahap (organizations, users, classes, class_memberships, teacher_class_assignments, learning_modules, student_module_progress, learning_activity_events, assessment_attempts, simulator_sessions/attempts, teacher_feedback, audit_logs, sessions, migration_marks). |
| `backend/auth.js` | Hash sandi `scrypt`, sesi token 7 hari, pemeriksaan peran/RBAC di sisi server. |
| `backend/api.js` | Semua endpoint REST: `auth/*` (login, logout, change-password, me), `me`, `progress/*` (module, event, assessment, session, attempt, import, activity), `teacher/*`, `classes/*` (siswa, progres, modul, `progress.csv`), `students/*` (detail, feedback), `admin/stats`, `admin/users` (tambah, ubah, status). Tambah endpoint baru di blok `if/else` dispatcher pada `server.js` **dan** fungsinya di sini. |
| `backend/progress.js` | Logika pencatatan progres & penghitungan metrik dashboard guru (dari data tersimpan). |
| `backend/content.js` | Memuat daftar modul dari file data asli lewat `vm` sandbox ke tabel `learning_modules`. |
| `backend/seed.js` | Mengisi akun Superadmin + modul saat DB kosong; menandai sandi bawaan; impor `data/roster.json` bila ada. **Tidak ada data contoh.** |
| `data/roster.example.json` | Contoh format daftar nama siswa. Salin menjadi `data/roster.json` bila diperlukan. |
| `data/startersim.sqlite` | Dibuat otomatis saat server pertama berjalan (tidak ada di paket ini). |

### 4.8 Aset

| Folder | Isi |
|---|---|
| `images/` | Foto komponen (`aki`, `fuse`, `kunci-kontak`, `relay`, `selenoid`, `motor-starter`, `pinion`, `flywheel`, `mesin`) dalam `.png` dan `.webp`. Ganti foto dengan menimpa file bernama sama; lihat `images/README.txt`. |
| `models/` | Letakkan `starter-motor.glb` (opsional) untuk model 3D asli; lihat `models/README.txt`. |
| `spec/` | Catatan spesifikasi langkah 20–22 platform guru (acuan pengembangan, tidak dimuat aplikasi). |

---

## 5. "Saya ingin mengubah … → edit file ini"

| Tujuan | File |
|---|---|
| Nilai fisika simulasi (tegangan aki, arus, RPM, waktu) | `app.js` → `CONFIG` |
| Daftar/penjelasan gangguan dasar | `app.js` → `FAULTS`, `COMPONENTS` |
| Titik ukur multimeter, 8 praktik ukur | `multimeter.js` → `NODES`, `PRACTICES` |
| Gauge, grafik, log, perhitungan voltage drop | `realtimeParameter.js` |
| Menambah kasus diagnosis lab / ambang / bobot skor | `diagcases.js` |
| Tabel gejala→penyebab, skenario gangguan lanjutan | `faultEngine.js` |
| Materi baca, kuis, studi kasus Learning Hub | `learningHub-data.js` |
| Modul, pelajaran, soal, job sheet engine belajar | `learningModules.js`, `learningLessons.js`, `learningQuestions.js`, `learningJobSheets.js` |
| Nilai lulus (KKM) | `learningHub-data.js` → `HUB_KKM` |
| Tampilan 3D, label, kamera, foto di 3D | `visual3d.js` (`COMPONENTS`, `PHOTO`) |
| Foto/posisi komponen di diagram | `diagramPhotos.js` (`SLOTS`) + `images/` |
| Warna, font, tema gelap | `style.css` (token di awal, tema gelap di akhir) |
| Menu sidebar, teks halaman, kartu Beranda | `index.html` |
| Dashboard guru/siswa/Superadmin, formulir login | `authUI.js` (+ gaya di `style.css`) |
| Peran & izin, aturan tugas/rubrik/sinkronisasi | `instructorPlatform.js` |
| Endpoint server, validasi, tabel database | `backend/api.js`, `backend/db.js` (tambah migrasi baru, jangan ubah migrasi lama) |
| Sandi awal Superadmin, port, lokasi DB | variabel lingkungan (bagian 1) |
| Daftar siswa otomatis | `config.js` atau `data/roster.json` |

---

## 6. Peta Tes (`test/`)

Jalankan: `node test/<nama>.js`. Hasil akhir mencetak `RESULTS: N passed, 0 failed`.

| Tes | Menguji |
|---|---|
| `acceptance.test.js` | Inti `app.js` (Phase 1) |
| `realtimeParameter.test.js` | `realtimeParameter.js` |
| `multimeter.test.js` | `multimeter.js` |
| `diagnosticLab.test.js` | `diagcases.js` + `diagnosticLab.js` |
| `learningAssessment.test.js` | lima file `learning*` + `learningAssessment.js` |
| `visual3d.test.js` | `visual3d.js` (logika, registri, API) |
| `lab3d.test.js`, `photo3d.test.js` | Graf scene 3D (komponen, kabel, foto asli) tanpa WebGL |
| `faultEngine.test.js` | `faultEngine.js` |
| `instructorPlatform.test.js` | `instructorPlatform.js` (file ini berformat BOM + CRLF; pertahankan saat mengedit) |
| `hub.test.js` | `learningHub*.js` (Beranda, routing) |
| `wiring.test.js`, `photos.test.js` | Ujung kabel diagram; `diagramPhotos.js` |
| `a11y.test.js` | Aksesibilitas markup HTML |
| `backend.test.js`, `manage.test.js`, `teacher.test.js` | Backend: progres/RBAC, kelola data Superadmin, fitur guru |
| `gate.test.js`, `demo.test.js`, `firstlogin.test.js`, `portal.test.js` | Wajib login & tanpa data contoh; mode demo; ganti sandi pertama; portal & isolasi data per akun |
| `fixtures.js` | Data uji bersama (bukan data produk) |
| `check-html.js <file.html>`, `count-classes.js <file.html>` | Alat bantu: cek keseimbangan tag, hitung kelas |

---

## 7. Peringatan Saat Mengedit

- Jangan mengubah urutan `<script>` (bagian 3) dan jangan mengganti nama objek global `Phase2`…`Phase8`.
- Tes memeriksa isi teks tertentu (mis. `panduan.html` harus memuat `node test/instructorPlatform.test.js`; ada tes yang melarang `Math.random` di modul simulasi). Jalankan tes terkait setelah mengubah.
- Mengubah ID di `learningHub-data.js` berdampak ke tabel modul di backend dan ke progres yang sudah tersimpan.
- Data pengguna ada di `localStorage` browser (kunci `starterHub_v1`, `p5*`, `starterSim_*`) dan di `data/startersim.sqlite`; ubah nama kunci hanya bila siap kehilangan/memigrasi data lama.
- Cadangkan `data/startersim.sqlite` sebelum mengubah `backend/db.js`.
