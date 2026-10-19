/* Konfigurasi StarterLab (sisi klien).
   Isi daftar nama siswa HANYA pada instalasi milik kelas yang bersangkutan, mis.
   window.STARTERLAB_ROSTER = ['Nama Siswa 1', 'Nama Siswa 2'];
   Dikosongkan: tidak ada impor otomatis. (Server membaca data/roster.json dengan format larik nama.) */
window.STARTERLAB_ROSTER = [];

/* ---- Supabase (data bersama lintas perangkat) ----
   Isi dua nilai dari Supabase: Project Settings -> API.
     url     : "Project URL"            mis. https://abcdefgh.supabase.co
     anonKey : "anon public" (JWT, berawalan eyJ...) ATAU "publishable key" (sb_publishable_...)
   Kunci ini MEMANG aman berada di kode publik; yang melindungi data adalah aturan di supabase/schema.sql.
   JANGAN PERNAH menaruh "service_role" / "secret" key di sini.
   Dikosongkan: aplikasi berjalan seperti semula (data hanya di browser masing-masing). */
window.STARTERLAB_SUPABASE = { url: 'https://vctknalkhapvlgymiosa.supabase.co', anonKey: 'sb_publishable_xlOCxSISJ6C71Sqa8FPQuw_DXtXxLhq' };
