# Pasang Supabase untuk StarterLab (±15 menit)

Setelah langkah ini, data **sekolah, guru, siswa, kelas, tugas, nilai, dan progres belajar** tersimpan di
satu database Supabase dan sama di semua perangkat. Situs tetap di GitHub Pages.

## 1. Buat proyek Supabase
1. Masuk ke https://supabase.com → **New project**. Pilih region terdekat (mis. Singapore).
2. Simpan *database password* (tidak dipakai aplikasi, hanya untuk Anda).

## 2. Pasang skema
1. Di dashboard: **SQL Editor → New query**.
2. Tempel seluruh isi `supabase/schema.sql` → **Run**. Harus selesai tanpa error. Aman dijalankan ulang.
3. Skema membuat akun **Superadmin**: username `superadmin`, sandi awal `superadmin123`.
   Aplikasi **memaksa** menggantinya saat login pertama. **Lakukan segera**, jangan biarkan proyek terbuka
   dengan sandi awal.

## 3. Isi `config.js`
Di **Project Settings → API**, salin:
- **Project URL** → `url`
- **anon public** (berawalan `eyJ…`) atau **publishable key** (`sb_publishable_…`) → `anonKey`

```js
window.STARTERLAB_SUPABASE = { url: 'https://xxxx.supabase.co', anonKey: 'eyJ...' };
```
Kunci ini memang aman berada di kode publik. **Jangan pernah** memakai `service_role` / *secret key* di sini.

## 4. Unggah ke GitHub
Commit dan push seluruh isi folder (termasuk `cloud.js`, `config.js`, `supabase/`), tunggu GitHub Pages
selesai deploy.

## 5. Uji dua perangkat
1. Buka `/superadmin.html` di laptop → masuk, ganti sandi.
2. Buka `/login.html` di HP → **Daftar Sekolah** → kirim.
3. Di laptop, buka dashboard Superadmin → sekolah itu muncul (maks. ±20 detik) → **Setujui**.
4. Di HP, masuk sebagai admin sekolah yang baru. Tambah siswa. Di perangkat ketiga, siswa itu bisa login.

## Pengaturan yang bisa diubah (SQL Editor)
```sql
-- Guru yang mendaftar harus disetujui dulu (bawaan: langsung aktif)
update public.sl_settings set value = 'PENDING' where key = 'instructor_signup_status';
-- Batas pendaftaran publik per jam per alamat IP (bawaan 30)
update public.sl_settings set value = '60' where key = 'public_signups_per_hour';
-- Lupa sandi Superadmin: setel ulang (lalu wajib diganti saat masuk)
update public.sl_creds set pw_hash = extensions.crypt('sandi-sementara-1', extensions.gen_salt('bf', 10)),
  must_change = true, failed_count = 0, locked_until = null where username_lc = 'superadmin';
```

## Yang perlu Anda tahu
- **Proyek gratis Supabase "tidur"** setelah ±7 hari tanpa aktivitas. Login lalu gagal dengan pesan
  tidak dapat terhubung; buka dashboard Supabase dan klik *Restore* / *Resume project*.
- **Data lama di browser** (sebelum cloud) tidak otomatis diunggah, karena id lama bisa bentrok antar perangkat.
  Pada pembukaan pertama, data itu disimpan sebagai cadangan di localStorage
  (`starterSim_phase8_db_legacy_backup_v1`) dan aplikasi mulai bersih dari server.
- **Keluar (logout)** menghapus data sekolah/siswa dari browser itu (komputer lab dipakai bergantian).
  Jika saat itu offline dan ada perubahan belum terkirim, data lokal dipertahankan agar tidak hilang.
- **Nilai kuis/diagnosis dihitung di browser.** Server memastikan siswa hanya menulis pengumpulan miliknya
  di kelasnya, tetapi tidak dapat memverifikasi isi skor otomatis. Nilai dari guru (penilaian rubrik)
  tidak bisa dipalsukan siswa karena siswa tidak berhak menulis dokumen kelas/tugas.
- **Notifikasi dalam aplikasi** (mis. "Hasil penilaian tersedia") belum disinkronkan antar perangkat.
- Server Node (`server.js`, `backend/`) **tidak dipakai** pada mode ini dan boleh diabaikan.

## Menguji di Postgres lokal (opsional, untuk pengembang)
Tes `test/supabaseSql.test.js` dan `test/cloudClient.test.js` memakai Postgres sungguhan + `psql`:
```bash
createdb sltest
psql sltest -c "create schema extensions; create role anon nologin; create role authenticated nologin;
                grant usage on schema public, extensions to anon, authenticated;"
psql sltest -f supabase/schema.sql
export SL_PGURL="postgresql://localhost/sltest"
node test/supabaseSql.test.js      # aturan keamanan & otorisasi SQL (132 cek)
# buat ulang database kosong sebelum menjalankan tes berikutnya:
node test/cloudClient.test.js      # dua-tiga "perangkat" memakai authUI.js + cloud.js asli (46 cek)
```
Tanpa `SL_PGURL`, kedua tes dilewati.
