# StarterLab — sisi server Supabase

Isi folder ini: `schema.sql` (tabel + RLS + trigger + RPC), `functions/admin-users` (Edge Function),
`test/` (uji RLS di Postgres asli).

## Urutan pemasangan

1. **Buat proyek** di supabase.com. Catat *Project URL* dan *anon public key*
   (Project Settings → API). **Jangan** menaruh `service_role` key di frontend/GitHub.
2. **Atur Auth** (Authentication → Providers → Email / Sign In-Up):
   - Matikan **Confirm email** (akun memakai email palsu `username@starterlab.app`, tidak ada kotak masuk).
   - Biarkan pendaftaran email aktif (siswa/guru/sekolah mendaftar lewat `signUp`); semua pendaftaran publik
     berstatus **PENDING** sampai disetujui. Matikan provider lain (Google dsb.) bila tidak dipakai.
   - Authentication → Rate Limits: turunkan batas *sign-ups* dan *sign-ins* per jam per IP (mis. 20–30)
     agar pendaftaran massal/tebak sandi sulit. Aktifkan CAPTCHA (hCaptcha/Turnstile) bila sekolah Anda rawan spam.
   - Panjang sandi minimum: 6 (sesuai aplikasi).
3. **Jalankan `schema.sql`** di SQL Editor (seluruh isi berkas, boleh diulang). Bila Anda mengganti domain
   email palsu, ubah juga `update public.app_config set value = '...' where key = 'email_domain';`
   serta `EMAIL_DOMAIN` di langkah 5 dan di `config.js` klien — ketiganya harus sama.
4. **Buat Superadmin pertama**: Authentication → Users → *Add user* → email `superadmin@starterlab.app`
   + sandi kuat, centang *Auto Confirm User*. Lalu di SQL Editor:
   ```sql
   select public.bootstrap_superadmin('superadmin');
   ```
   (Sandi bawaan `superadmin123` dari versi lama TIDAK dipakai lagi.)
5. **Deploy Edge Function** (Supabase CLI):
   ```bash
   supabase login
   supabase link --project-ref <ref-proyek>
   supabase secrets set EMAIL_DOMAIN=starterlab.app      # SUPABASE_URL & service role sudah otomatis
   supabase functions deploy admin-users
   ```
   JWT diverifikasi di gateway (bawaan) dan sekali lagi di dalam fungsi. Batasi CORS
   (`Access-Control-Allow-Origin` di `index.ts`) ke domain GitHub Pages Anda.
6. Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di `config.js` klien.

## Kontrak ringkas untuk klien

- Login: `POST /auth/v1/token?grant_type=password` dengan `email = <username>@<domain>`.
- Pendaftaran publik: `POST /auth/v1/signup` dengan `data` (user_metadata):
  `{kind:'student'|'instructor'|'school', name, org_id, nis, email, school_name, school_address}`.
  Panggil dulu RPC `register_precheck(p_kind, p_username, p_school_name, p_org_id)` — GoTrue menyamarkan
  pesan trigger menjadi "Database error saving new user"; precheck mengembalikan kode jelas
  (`USERNAME_DIPAKAI`, `USERNAME_TIDAK_VALID`, `SEKOLAH_TIDAK_AKTIF`, `NAMA_SEKOLAH_SUDAH_ADA`, ...) atau `null`.
- Daftar sekolah untuk formulir: RPC `public_schools()` (tanpa login).
- Data aplikasi: tabel `entities (kind, id, org_id, owner_id, data, deleted, updated_at)`. Gunakan
  `deleted = true`, bukan DELETE. Tarik perubahan dengan `updated_at > cursor` **dikurangi jendela tumpang-tindih
  (mis. 2 menit)** karena `updated_at` diisi saat baris ditulis, bukan saat transaksi commit.
- Progres belajar: tabel `user_data (user_id, key, value)`.
- Gabung kelas lewat kode: RPC `join_class(p_code)` (siswa tidak boleh menulis kelas langsung).
- Akun oleh Superadmin/guru: Edge Function `admin-users` (`create` / `update` / `delete`).

## Aturan penting (ditegakkan di database, bukan di UI)

- Pendaftaran publik **tidak pernah** menghasilkan ADMIN, dan selalu `PENDING`.
- Guru hanya menulis data sekolahnya; guru **tidak** bisa membuat baris `users`/`organizations`.
- Siswa tidak bisa mengubah role/username/status/sekolah/classIds dirinya sendiri.
- Guru hanya boleh transisi status siswa: PENDING→ACTIVE/REJECTED dan ACTIVE↔INACTIVE.
- Status/sekolah/nama di `entities` (kind `users`) otomatis disalin ke `profiles` (dipakai RLS).

## Menjalankan uji

```bash
cd supabase/test
node rls.test.js                                  # klaster Postgres sementara (perlu postgresql terpasang)
TEST_DATABASE_URL=postgres://... node rls.test.js # atau database KOSONG milik Anda
```
Uji memakai Postgres asli lewat `psql` dan tiruan skema `auth` (`mock_supabase.sql`). Edge Function
belum teruji otomatis (butuh Deno + proyek Supabase).
