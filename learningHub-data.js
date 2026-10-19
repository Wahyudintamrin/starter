/* ============================================================
   LEARNING HUB — DATA KONTEN
   ------------------------------------------------------------
   1. HUB_MATERI      : 14 modul materi lengkap (dibuka di halaman baca)
   2. HUB_QUIZZES     : 5 kuis per kelompok materi + ujian akhir
   3. HUB_DIAG_TESTS  : katalog pemeriksaan untuk studi kasus diagnosis
   4. HUB_DIAG_CAUSES : daftar kemungkinan penyebab
   5. HUB_DIAG_CASES  : 12 studi kasus yang bisa didiagnosis
   Nilai acuan mengikuti nilai simulasi pada aplikasi ini; selalu
   cocokkan dengan buku manual kendaraan saat praktik nyata.
   ============================================================ */
'use strict';

/* ============================================================
   1. MATERI
   ============================================================ */
var HUB_MATERI = [
    {
        id: 1, title: 'Pengertian Sistem Starter', desc: 'Memahami konsep dasar sistem starter pada kendaraan.',
        durasi: 8, tingkat: 'Dasar',
        tujuan: ['Menjelaskan pengertian sistem starter.', 'Menjelaskan mengapa mesin membutuhkan sistem starter.', 'Menyebutkan jenis motor starter yang umum dipakai.'],
        bagian: [
            { judul: 'Apa itu sistem starter?', teks: 'Sistem starter adalah gabungan rangkaian kelistrikan dan mekanisme yang bertugas memutar poros engkol (crankshaft) mesin pada saat mesin akan dihidupkan. Mesin pembakaran dalam tidak dapat hidup sendiri dari keadaan diam, karena langkah hisap dan kompresi pertama harus terjadi lebih dulu sebelum terjadi pembakaran. Putaran awal inilah yang disediakan oleh motor starter.' },
            { judul: 'Mengapa dibutuhkan?', teks: 'Agar campuran udara-bahan bakar dapat terhisap, dikompresi, lalu terbakar, crankshaft harus diputar dengan kecepatan minimum tertentu. Untuk mesin bensin kecepatan cranking umumnya sekitar 150–250 rpm, sedangkan mesin diesel memerlukan putaran lebih tinggi karena mengandalkan panas kompresi.',
              poin: ['Mesin bensin: ± 150–250 rpm saat cranking.', 'Mesin diesel: ± 200–300 rpm dan torsi lebih besar.', 'Proses cranking normal hanya berlangsung beberapa detik.'] },
            { judul: 'Jenis motor starter', tabel: { kepala: ['Jenis', 'Ciri utama', 'Contoh pemakaian'], baris: [
                ['Konvensional (direct drive)', 'Pinion berada langsung pada poros armatur, digeser tuas solenoid', 'Kendaraan lama, mesin kecil'],
                ['Reduksi (reduction)', 'Ada roda gigi reduksi; motor kecil berputar cepat, torsi besar', 'Mobil penumpang modern'],
                ['Planetary', 'Memakai roda gigi planet di dalam motor; ringan dan ringkas', 'Mobil modern, mesin diesel kecil'] ] } },
            { judul: 'Sumber energi', teks: 'Sistem starter bekerja dengan arus searah (DC) 12 V dari battery. Saat cranking, motor starter dapat menarik arus 100–250 A pada mobil penumpang bensin, bahkan lebih pada mesin diesel. Karena itu kondisi battery dan kabel sangat menentukan kinerja starter.' }
        ],
        penting: ['Sistem starter hanya bekerja sesaat ketika kunci diputar ke START.', 'Arus starter sangat besar sehingga kabel dan sambungan harus prima.', 'Setelah mesin hidup, starter harus segera berhenti dan pinion terlepas.'],
        aksi: [{ label: 'Coba urutan kerja di Simulator', page: 'simulator' }, { label: 'Lihat motor starter di 3D Lab', page: '3d', focus: 'starterHousing' }],
        cek: { q: 'Tugas utama sistem starter adalah …', opsi: ['Mengisi ulang battery', 'Memutar crankshaft saat mesin akan dihidupkan', 'Menyalakan busi', 'Mengatur putaran idle'], jawab: 1, bahas: 'Sistem starter memutar crankshaft sampai mesin dapat melakukan pembakaran sendiri.' }
    },
    {
        id: 2, title: 'Fungsi Sistem Starter', desc: 'Peran sistem starter dalam memutar crankshaft saat starting.',
        durasi: 7, tingkat: 'Dasar',
        tujuan: ['Menjelaskan fungsi sistem starter secara berurutan.', 'Menjelaskan perlindungan yang ada pada sistem starter.'],
        bagian: [
            { judul: 'Fungsi utama', poin: [
                'Mengubah energi listrik battery menjadi energi mekanik (putaran).',
                'Memutar flywheel melalui pinion dan ring gear sampai mesin hidup.',
                'Melepas hubungan pinion dari ring gear setelah mesin hidup.',
                'Menyalurkan arus besar hanya ketika dibutuhkan, dikendalikan arus kecil dari kunci kontak.'] },
            { judul: 'Pengendalian arus besar dengan arus kecil', teks: 'Kunci kontak tidak dirancang untuk mengalirkan ratusan ampere. Karena itu dipakai relay dan solenoid: arus kecil (beberapa ampere) dari kunci kontak menggerakkan kontak besar di dalam solenoid yang kemudian menyalurkan arus besar ke motor. Prinsip ini melindungi kunci kontak dan kabel kecil di dasbor.' },
            { judul: 'Perlindungan sistem', poin: [
                'Fuse melindungi rangkaian kontrol dari hubung singkat.',
                'Overrunning clutch mencegah armatur diputar terlalu cepat oleh mesin yang sudah hidup.',
                'Saklar netral / kopling (inhibitor) mencegah mesin distarter saat gigi masuk.',
                'Batas waktu cranking: maksimal ± 10 detik, lalu istirahat ± 30 detik agar motor tidak panas.'] }
        ],
        penting: ['Arus kecil mengendalikan arus besar melalui relay & solenoid.', 'Starter tidak boleh dioperasikan terus-menerus.'],
        aksi: [{ label: 'Lihat aliran arus di Simulator', page: 'simulator' }],
        cek: { q: 'Mengapa kunci kontak tidak langsung mengalirkan arus ke motor starter?', opsi: ['Agar battery cepat penuh', 'Karena arus motor starter sangat besar sehingga dipakai relay/solenoid', 'Supaya lampu dasbor menyala', 'Karena motor starter memakai arus AC'], jawab: 1, bahas: 'Arus motor starter ratusan ampere; kunci kontak hanya mengendalikan arus kecil ke relay/solenoid.' }
    },
    {
        id: 3, title: 'Komponen Sistem Starter', desc: 'Komponen kelistrikan dan mekanis pada sistem starter.',
        durasi: 10, tingkat: 'Dasar',
        tujuan: ['Mengidentifikasi komponen sistem starter.', 'Menjelaskan fungsi masing-masing komponen.'],
        bagian: [
            { judul: 'Komponen kelistrikan', tabel: { kepala: ['Komponen', 'Fungsi'], baris: [
                ['Battery', 'Sumber listrik DC 12 V; menyuplai arus besar saat cranking.'],
                ['Fuse / fusible link', 'Pengaman rangkaian dari arus berlebih atau hubung singkat.'],
                ['Kunci kontak (ignition switch)', 'Memberi sinyal START (terminal ST) ke relay/solenoid.'],
                ['Relay starter', 'Saklar elektromagnetik: arus kecil kunci kontak mengalirkan arus ke solenoid.'],
                ['Solenoid (magnetic switch)', 'Mendorong pinion dan menutup kontak utama ke motor.'],
                ['Kabel positif & kabel massa', 'Jalur arus besar dari battery ke motor dan kembali ke battery.'] ] } },
            { judul: 'Komponen pada motor starter', tabel: { kepala: ['Komponen', 'Fungsi'], baris: [
                ['Yoke & pole core', 'Rumah motor dan inti kutub tempat field coil.'],
                ['Field coil', 'Menghasilkan medan magnet stator.'],
                ['Armatur', 'Bagian berputar berisi lilitan; menghasilkan torsi.'],
                ['Komutator', 'Segmen tembaga yang membalik arah arus pada lilitan armatur.'],
                ['Sikat (brush)', 'Menyalurkan arus dari bagian diam ke komutator yang berputar.'],
                ['Tuas penggeser (shift lever)', 'Meneruskan gerakan plunger ke kopling & pinion.'],
                ['Overrunning clutch', 'Kopling satu arah antara armatur dan pinion.'],
                ['Pinion gear', 'Gigi kecil yang berkaitan dengan ring gear.'] ] } },
            { judul: 'Komponen mekanis mesin', poin: ['Ring gear: gigi besar di keliling flywheel.', 'Flywheel: roda gila di ujung crankshaft.', 'Crankshaft: poros yang mengubah gerak putar menjadi gerak naik-turun piston.'] }
        ],
        penting: ['Bagian listrik: battery → fuse → kunci kontak → relay → solenoid → motor.', 'Bagian mekanis: armatur → kopling → pinion → ring gear → crankshaft.'],
        aksi: [{ label: 'Kenali setiap komponen di 3D Lab', page: '3d', focus: 'starterSolenoid' }],
        cek: { q: 'Komponen yang menyalurkan arus dari bagian diam ke komutator yang berputar adalah …', opsi: ['Field coil', 'Sikat (brush)', 'Pinion', 'Yoke'], jawab: 1, bahas: 'Sikat karbon menekan komutator sehingga arus dapat masuk ke lilitan armatur yang berputar.' }
    },
    {
        id: 4, title: 'Prinsip Kerja', desc: 'Alur kerja dari battery hingga engine menyala.',
        durasi: 10, tingkat: 'Dasar',
        tujuan: ['Menjelaskan urutan kerja sistem starter dari kunci ON hingga mesin hidup.', 'Menjelaskan kondisi solenoid pada setiap tahap.'],
        bagian: [
            { judul: 'Urutan kerja', langkah: [
                'Kunci ON: rangkaian siap, belum ada arus ke solenoid.',
                'Kunci START: arus kontrol mengalir ke kumparan relay → kontak relay menutup.',
                'Arus dari relay masuk terminal 50 solenoid → kumparan pull-in dan hold-in menghasilkan magnet.',
                'Plunger tertarik → tuas mendorong pinion maju berkaitan dengan ring gear.',
                'Plat kontak menghubungkan terminal 30 dan C → arus besar mengalir ke motor.',
                'Motor berputar → pinion memutar ring gear → crankshaft berputar (cranking).',
                'Mesin hidup → kunci dilepas ke ON → magnet hilang → pegas mengembalikan plunger, pinion mundur.'] },
            { judul: 'Tiga tahap kerja solenoid', tabel: { kepala: ['Tahap', 'Pull-in coil', 'Hold-in coil', 'Kontak utama'], baris: [
                ['Menarik (START ditekan)', 'Aktif', 'Aktif', 'Terbuka → mulai menutup'],
                ['Menahan (cranking)', 'Tidak dialiri (kedua ujung bertegangan sama)', 'Aktif', 'Tertutup'],
                ['Kembali (kunci dilepas)', 'Arus berbalik, medan saling meniadakan', 'Melemah', 'Terbuka, pinion mundur'] ] } },
            { judul: 'Kenapa pull-in mati saat cranking?', teks: 'Pull-in coil dipasang antara terminal 50 dan terminal C. Begitu kontak utama menutup, terminal C mendapat tegangan battery sehingga kedua ujung pull-in bertegangan sama. Akibatnya tidak ada arus pada pull-in, dan hanya hold-in yang menahan plunger. Cara ini menghemat arus dan mencegah kumparan panas.' }
        ],
        penting: ['Urutan: RELAY → SOLENOID → PINION → CRANK → RUN.', 'Pull-in membantu menarik, hold-in menahan.'],
        aksi: [{ label: 'Amati tahap REST → RUN di Simulator', page: 'simulator' }, { label: 'Lihat gerakan plunger & pinion di 3D', page: '3d', focus: 'shiftLever' }],
        cek: { q: 'Saat kontak utama solenoid sudah menutup, kumparan yang tetap bekerja adalah …', opsi: ['Pull-in coil', 'Hold-in coil', 'Field coil saja', 'Tidak ada'], jawab: 1, bahas: 'Pull-in tidak dialiri karena kedua ujungnya bertegangan sama; hold-in menahan plunger.' }
    },
    {
        id: 5, title: 'Rangkaian Kelistrikan', desc: 'Baca dan pahami rangkaian kelistrikan sistem starter.',
        durasi: 10, tingkat: 'Menengah',
        tujuan: ['Membedakan rangkaian kontrol dan rangkaian daya.', 'Menelusuri jalur arus pada diagram sistem starter.'],
        bagian: [
            { judul: 'Dua rangkaian dalam sistem starter', tabel: { kepala: ['Rangkaian', 'Jalur', 'Besar arus'], baris: [
                ['Kontrol', 'Battery (+) → fuse → kunci kontak ST → relay (85-86) → massa', '< 1 A'],
                ['Kontrol solenoid', 'Battery (+) → relay (30-87) → terminal 50 solenoid → kumparan → massa', '± 10–40 A sesaat'],
                ['Daya (utama)', 'Battery (+) → kabel besar → terminal 30 → kontak utama → terminal C → motor → massa → battery (−)', '100–250 A'] ] } },
            { judul: 'Penamaan terminal', poin: ['Terminal 30 / B: dari positif battery.', 'Terminal 50 / S / ST: sinyal start dari kunci kontak atau relay.', 'Terminal C / M: keluaran ke motor (field coil).', 'Relay: 85 & 86 = kumparan; 30 & 87 = kontak.'] },
            { judul: 'Jalur massa', teks: 'Arus kembali ke battery melalui badan motor starter → blok mesin → kabel massa → terminal negatif battery. Jalur massa sama pentingnya dengan jalur positif; sambungan massa yang kotor menyebabkan starter lemah sama seperti kabel positif yang buruk.' }
        ],
        penting: ['Rangkaian kontrol = arus kecil, rangkaian daya = arus besar.', 'Arus harus kembali ke battery melalui massa.'],
        aksi: [{ label: 'Aktifkan Aliran Arus di Simulator', page: 'simulator' }],
        cek: { q: 'Terminal solenoid yang menerima sinyal dari relay/kunci kontak adalah …', opsi: ['Terminal 30', 'Terminal 50', 'Terminal C', 'Terminal 87'], jawab: 1, bahas: 'Terminal 50 (S/ST) adalah terminal sinyal start pada solenoid.' }
    },
    {
        id: 6, title: 'Battery', desc: 'Sumber listrik utama dan pemeriksaannya.',
        durasi: 9, tingkat: 'Dasar',
        tujuan: ['Menentukan kondisi battery dari tegangan diam.', 'Menjelaskan uji tegangan saat cranking.'],
        bagian: [
            { judul: 'Peran battery', teks: 'Battery menyimpan energi kimia dan melepaskannya sebagai listrik DC. Pada saat cranking battery harus mampu memberi arus ratusan ampere tanpa tegangannya turun terlalu jauh. Kemampuan ini dinyatakan dengan CCA (Cold Cranking Amps).' },
            { judul: 'Kondisi berdasarkan tegangan diam', tabel: { kepala: ['Tegangan diam', 'Perkiraan kondisi isi'], baris: [
                ['≥ 12,6 V', '± 100% (penuh)'], ['± 12,4 V', '± 75%'], ['± 12,2 V', '± 50% — perlu diisi'], ['± 12,0 V', '± 25% — lemah'], ['< 11,9 V', 'Kosong (discharged)'] ] } },
            { judul: 'Uji saat cranking', teks: 'Ukur tegangan battery ketika starter bekerja. Battery sehat masih menahan tegangan di atas ± 9,6 V selama cranking. Tegangan yang turun jauh di bawah itu menandakan battery lemah atau ada beban berlebih (motor starter macet/hubung singkat).' },
            { judul: 'Pemeriksaan visual', poin: ['Terminal kencang dan bersih dari korosi (serbuk putih/hijau).', 'Rumah battery tidak retak/menggembung.', 'Kabel tidak terkelupas, klem tidak longgar.'] }
        ],
        penting: ['Tegangan diam 12,6 V = penuh.', 'Saat cranking tegangan tidak boleh di bawah ± 9,6 V.', 'Korosi terminal menambah hambatan.'],
        aksi: [{ label: 'Kerjakan Job Sheet Pemeriksaan Battery', page: 'jobsheet', jobsheet: 'JS-001' }],
        cek: { q: 'Battery menunjukkan 12,2 V saat diam. Kondisinya kira-kira …', opsi: ['Penuh', '± 50%, perlu diisi', 'Rusak total', 'Kelebihan muatan'], jawab: 1, bahas: '12,2 V ≈ 50% kapasitas, sebaiknya diisi sebelum diuji lebih lanjut.' }
    },
    {
        id: 7, title: 'Starter Relay', desc: 'Fungsi relay dan gejala kerusakannya.',
        durasi: 8, tingkat: 'Menengah',
        tujuan: ['Menjelaskan cara kerja relay starter.', 'Memeriksa relay dengan multimeter.'],
        bagian: [
            { judul: 'Cara kerja relay', teks: 'Relay terdiri dari kumparan dan kontak. Ketika kumparan (terminal 85-86) dialiri arus dari kunci kontak, timbul medan magnet yang menarik kontak sehingga terminal 30 terhubung ke 87. Arus dari 87 lalu diteruskan ke terminal 50 solenoid.' },
            { judul: 'Pemeriksaan relay', langkah: ['Lepas relay dari soket.', 'Ukur tahanan kumparan 85-86 (lihat spesifikasi; di simulator ± 3,2 Ω). OL berarti kumparan putus.', 'Ukur kontinuitas 30-87: harus OL saat relay tidak diberi tegangan.', 'Beri 12 V ke 85-86: harus terdengar klik dan 30-87 tersambung (≈ 0 Ω).'] },
            { judul: 'Gejala relay rusak', poin: ['Tidak ada bunyi klik relay saat START.', 'Tegangan masuk relay ada, tetapi keluaran (87) 0 V.', 'Starter kadang bekerja kadang tidak (kontak terbakar).'] }
        ],
        penting: ['85-86 kumparan, 30-87 kontak.', 'Uji tahanan selalu saat rangkaian tidak bertegangan.'],
        aksi: [{ label: 'Kerjakan Job Sheet Relay', page: 'jobsheet', jobsheet: 'JS-003' }, { label: 'Lihat relay di 3D Lab', page: '3d', focus: 'starterRelay' }],
        cek: { q: 'Relay mendapat 12 V di terminal masuk saat START tetapi terminal 87 tetap 0 V dan tidak ada klik. Kemungkinan …', opsi: ['Battery lemah', 'Relay rusak', 'Ring gear aus', 'Kabel massa korosi'], jawab: 1, bahas: 'Masukan ada tetapi keluaran tidak ada → relay tidak bekerja (kumparan putus/kontak rusak).' }
    },
    {
        id: 8, title: 'Starter Solenoid', desc: 'Kontaktor elektromagnetik dan cara kerjanya.',
        durasi: 10, tingkat: 'Menengah',
        tujuan: ['Menjelaskan konstruksi solenoid.', 'Melakukan uji pull-in, hold-in, dan return.'],
        bagian: [
            { judul: 'Konstruksi', poin: ['Kumparan pull-in (kawat tebal, sedikit lilitan) antara terminal 50 dan C.', 'Kumparan hold-in (kawat halus, banyak lilitan) antara terminal 50 dan massa.', 'Plunger: inti besi yang bergerak dan menggerakkan tuas.', 'Plat kontak & terminal 30/C: saklar arus besar.', 'Pegas pengembali: mengembalikan plunger saat magnet hilang.'] },
            { judul: 'Uji solenoid (bench test)', tabel: { kepala: ['Uji', 'Cara', 'Hasil normal'], baris: [
                ['Pull-in', 'Battery (+) ke terminal 50, (−) ke terminal C & body', 'Pinion terdorong keluar'],
                ['Hold-in', 'Lepas kabel dari terminal C saat pinion keluar', 'Pinion tetap di luar'],
                ['Return', 'Lepas kabel dari body', 'Pinion kembali ke dalam dengan cepat'] ] } },
            { judul: 'Gejala kerusakan', poin: ['Satu bunyi klik keras, motor tidak berputar → kontak utama aus/terbakar.', 'Bunyi tek-tek-tek cepat → hold-in putus atau tegangan battery drop.', 'Tidak ada bunyi sama sekali, terminal 50 bertegangan → kumparan putus.'] }
        ],
        penting: ['Pull-in menarik, hold-in menahan.', 'Klik tunggal tanpa putaran: periksa kontak utama.'],
        aksi: [{ label: 'Kerjakan Job Sheet Solenoid', page: 'jobsheet', jobsheet: 'JS-004' }, { label: 'Lihat isi solenoid (cutaway) di 3D', page: '3d', focus: 'starterSolenoid' }],
        cek: { q: 'Terdengar bunyi “tek-tek-tek” cepat saat START dengan battery penuh. Kemungkinan penyebab …', opsi: ['Hold-in coil putus', 'Fuse putus', 'Ring gear aus', 'Kunci kontak rusak'], jawab: 0, bahas: 'Tanpa hold-in, plunger tertarik lalu lepas berulang ketika pull-in tidak dialiri.' }
    },
    {
        id: 9, title: 'Starter Motor', desc: 'Motor DC dan komponen internalnya.',
        durasi: 10, tingkat: 'Menengah',
        tujuan: ['Menjelaskan prinsip motor DC seri.', 'Memeriksa armatur, field coil, dan sikat.'],
        bagian: [
            { judul: 'Prinsip motor DC', teks: 'Penghantar berarus yang berada di dalam medan magnet akan mendapat gaya (kaidah tangan kiri Fleming). Lilitan armatur yang dialiri arus berada di antara kutub-kutub field coil sehingga timbul torsi. Komutator membalik arah arus setiap setengah putaran agar torsi tetap searah.' },
            { judul: 'Mengapa motor seri?', teks: 'Field coil dan armatur dihubung seri sehingga arus yang sama melewati keduanya. Motor seri menghasilkan torsi sangat besar pada putaran rendah — tepat untuk memutar mesin dari kondisi diam.' },
            { judul: 'Pemeriksaan komponen', tabel: { kepala: ['Komponen', 'Pemeriksaan', 'Normal'], baris: [
                ['Armatur', 'Kontinuitas antar segmen komutator', 'Tersambung (≈ 0 Ω)'],
                ['Armatur', 'Isolasi komutator ke inti', 'Tidak tersambung (OL)'],
                ['Field coil', 'Kontinuitas terminal C ke sikat positif', 'Tersambung'],
                ['Sikat', 'Panjang sikat', '≥ batas minimum (mis. 8,5 mm)'],
                ['Komutator', 'Kedalaman mika & keausan', 'Tidak cacat/terbakar'] ] } },
            { judul: 'Uji tanpa beban (no-load test)', teks: 'Motor dijalankan di meja uji dengan amperemeter. Hasil normal: putaran tinggi dengan arus relatif kecil (lihat spesifikasi, mis. ± 50–90 A). Arus besar + putaran rendah menunjukkan armatur hubung singkat atau bantalan seret.' }
        ],
        penting: ['Motor starter = motor DC seri bertorsi besar.', 'Sikat aus = arus tidak sampai ke armatur.'],
        aksi: [{ label: 'Kerjakan Job Sheet Motor Starter', page: 'jobsheet', jobsheet: 'JS-007' }, { label: 'Lihat armatur & sikat di 3D (cutaway)', page: '3d', focus: 'starterArmature' }],
        cek: { q: 'Fungsi komutator pada motor starter adalah …', opsi: ['Menghasilkan medan magnet', 'Membalik arah arus pada lilitan armatur agar torsi searah', 'Menyambung pinion ke ring gear', 'Menyimpan energi'], jawab: 1, bahas: 'Komutator membalik arah arus setiap setengah putaran.' }
    },
    {
        id: 10, title: 'Pinion Gear', desc: 'Gigi pinion dan mekanisme engagement.',
        durasi: 8, tingkat: 'Menengah',
        tujuan: ['Menjelaskan proses engagement pinion.', 'Menjelaskan fungsi overrunning clutch.'],
        bagian: [
            { judul: 'Engagement', teks: 'Saat plunger tertarik, ujung atas tuas ikut tertarik dan ujung bawah (garpu) mendorong kopling serta pinion maju sepanjang spline poros. Spline berbentuk heliks membantu pinion berputar sedikit sehingga mudah masuk ke celah gigi ring gear.' },
            { judul: 'Overrunning clutch', teks: 'Kopling satu arah berisi roller dan pegas. Saat armatur memutar pinion, roller terjepit sehingga putaran diteruskan. Ketika mesin hidup dan ring gear memutar pinion lebih cepat, roller bergeser ke ruang lebar sehingga pinion berputar bebas dan armatur terlindung dari putaran berlebih.' },
            { judul: 'Gejala kerusakan', poin: ['Motor berdengung tinggi tetapi mesin tidak berputar → kopling slip.', 'Bunyi gemeretak/gerinda → gigi pinion atau ring gear aus.', 'Pinion tidak mau kembali → spline kotor/pegas lemah.'] }
        ],
        penting: ['Pinion harus bisa diputar bebas satu arah dan terkunci arah sebaliknya.', 'Rasio pinion 10 gigi : ring gear ± 150 gigi ≈ 1 : 15.'],
        aksi: [{ label: 'Lihat pinion & kopling di 3D', page: '3d', focus: 'overrunningClutch' }],
        cek: { q: 'Motor starter berputar kencang (berdengung) tetapi mesin tidak ikut berputar. Komponen yang dicurigai …', opsi: ['Overrunning clutch slip', 'Fuse putus', 'Relay rusak', 'Battery penuh'], jawab: 0, bahas: 'Motor berputar tetapi tenaga tidak sampai ke ring gear → kopling satu arah slip.' }
    },
    {
        id: 11, title: 'Flywheel', desc: 'Ring gear dan perannya dalam starting.',
        durasi: 6, tingkat: 'Dasar',
        tujuan: ['Menjelaskan fungsi flywheel dan ring gear.', 'Menghitung perbandingan gigi pinion-ring gear.'],
        bagian: [
            { judul: 'Flywheel & ring gear', teks: 'Flywheel (roda gila) terpasang di ujung crankshaft untuk menyimpan energi putar agar putaran mesin halus. Di sekelilingnya terpasang ring gear yang dipres panas. Ring gear inilah yang menerima putaran dari pinion saat starting.' },
            { judul: 'Perbandingan gigi', teks: 'Jika pinion 10 gigi dan ring gear 150 gigi, perbandingannya 150 : 10 = 15 : 1. Artinya motor harus berputar 15 kali untuk memutar crankshaft satu kali, tetapi torsi pada crankshaft menjadi ± 15 kali lebih besar (dikurangi rugi-rugi).',
              poin: ['Motor 3.000 rpm ÷ 15 = 200 rpm cranking.', 'Torsi motor 8 N·m × 15 ≈ 120 N·m di crankshaft.'] },
            { judul: 'Keausan ring gear', teks: 'Mesin cenderung berhenti pada posisi yang sama sehingga hanya beberapa bagian ring gear yang sering terkena pinion. Bagian ini bisa aus atau gompal sehingga timbul bunyi gerinda dan starter kadang tidak mampu memutar mesin.' }
        ],
        penting: ['Rasio gigi besar = torsi besar, putaran turun.', 'Keausan ring gear sering terjadi di titik tertentu.'],
        aksi: [{ label: 'Lihat ring gear di 3D', page: '3d', focus: 'ringGear' }],
        cek: { q: 'Pinion 10 gigi dan ring gear 150 gigi. Jika motor berputar 3.000 rpm, putaran crankshaft …', opsi: ['20 rpm', '200 rpm', '300 rpm', '3.000 rpm'], jawab: 1, bahas: '3.000 ÷ (150/10) = 3.000 ÷ 15 = 200 rpm.' }
    },
    {
        id: 12, title: 'Pemeriksaan Sistem Starter', desc: 'Prosedur pemeriksaan komponen sistem starter.',
        durasi: 10, tingkat: 'Menengah',
        tujuan: ['Menerapkan urutan pemeriksaan yang sistematis.', 'Menerapkan K3 saat memeriksa sistem starter.'],
        bagian: [
            { judul: 'Keselamatan kerja (K3)', poin: ['Pastikan transmisi di posisi P/N dan rem parkir aktif.', 'Lepas kabel negatif battery sebelum membongkar starter.', 'Jangan mengukur tahanan (Ω) pada rangkaian bertegangan.', 'Jauhkan tangan dari bagian berputar saat cranking.', 'Cranking maksimal ± 10 detik, istirahat ± 30 detik.'] },
            { judul: 'Urutan pemeriksaan', langkah: ['Tanyakan keluhan & amati gejala (bunyi, lampu redup, putaran).', 'Periksa battery: tegangan diam dan saat cranking.', 'Periksa sambungan: terminal, kabel positif, kabel massa.', 'Periksa rangkaian kontrol: fuse, kunci kontak, relay, terminal 50.', 'Periksa rangkaian daya: voltage drop sisi positif dan massa.', 'Periksa motor starter & komponen mekanis.', 'Perbaiki, lalu verifikasi ulang.'] },
            { judul: 'Alat ukur', tabel: { kepala: ['Alat', 'Kegunaan'], baris: [['Multimeter (V, Ω)', 'Tegangan, tahanan, kontinuitas, voltage drop'], ['Clamp meter DC', 'Arus cranking tanpa memutus kabel'], ['Battery tester', 'Uji beban / CCA battery'], ['Test lamp', 'Cek cepat ada tidaknya tegangan']] } }
        ],
        penting: ['Mulai dari yang paling mudah dan paling sering rusak: battery dan sambungan.', 'Setiap kesimpulan harus didukung hasil ukur.'],
        aksi: [{ label: 'Buka daftar Job Sheet', page: 'jobsheet' }, { label: 'Pakai multimeter di Simulator', page: 'simulator' }],
        cek: { q: 'Langkah pertama yang paling tepat saat starter tidak bekerja adalah …', opsi: ['Langsung mengganti motor starter', 'Memeriksa battery dan sambungannya', 'Membongkar ring gear', 'Mengganti kunci kontak'], jawab: 1, bahas: 'Battery dan sambungan paling sering bermasalah dan paling mudah diperiksa.' }
    },
    {
        id: 13, title: 'Voltage Drop', desc: 'Konsep voltage drop dan penerapannya.',
        durasi: 9, tingkat: 'Lanjutan',
        tujuan: ['Menjelaskan konsep voltage drop.', 'Mengukur voltage drop sisi positif dan massa.'],
        bagian: [
            { judul: 'Konsep', teks: 'Voltage drop adalah tegangan yang “hilang” pada kabel, sambungan, atau kontak karena hambatan. Menurut hukum Ohm, V = I × R. Pada arus starter 200 A, hambatan sambungan hanya 0,005 Ω sudah menimbulkan drop 1 V — cukup untuk membuat starter lemah.' },
            { judul: 'Cara mengukur', langkah: ['Set multimeter ke DC volt (rentang 2 V atau 20 V).', 'Sisi positif: probe merah di terminal (+) battery (pada kutubnya), probe hitam di terminal 30 starter.', 'Sisi massa: probe merah di body starter, probe hitam di terminal (−) battery.', 'Lakukan cranking (cegah mesin hidup) lalu baca nilai.'] },
            { judul: 'Batas normal', tabel: { kepala: ['Jalur', 'Batas maksimum'], baris: [['Sisi positif (battery → terminal 30)', '≤ 0,5 V'], ['Sisi massa (body starter → battery −)', '≤ 0,2 V'], ['Satu sambungan', '≤ 0,1 V']] } },
            { judul: 'Mengapa harus saat cranking?', teks: 'Voltage drop hanya muncul bila ada arus. Saat rangkaian tanpa arus, kabel yang buruk sekalipun bisa terbaca 0 V. Karena itu pengukuran harus dilakukan saat starter menarik arus.' }
        ],
        penting: ['Ukur saat ada arus (cranking).', 'Positif ≤ 0,5 V, massa ≤ 0,2 V.'],
        aksi: [{ label: 'Job Sheet Voltage Drop Positif', page: 'jobsheet', jobsheet: 'JS-005' }, { label: 'Job Sheet Voltage Drop Massa', page: 'jobsheet', jobsheet: 'JS-006' }],
        cek: { q: 'Hasil voltage drop sisi massa 1,1 V saat cranking. Artinya …', opsi: ['Normal', 'Hambatan jalur massa terlalu besar', 'Battery penuh', 'Relay rusak'], jawab: 1, bahas: 'Batas sisi massa ± 0,2 V; 1,1 V menunjukkan sambungan massa buruk.' }
    },
    {
        id: 14, title: 'Troubleshooting', desc: 'Langkah-langkah diagnosa kerusakan.',
        durasi: 12, tingkat: 'Lanjutan',
        tujuan: ['Menganalisis gejala kerusakan sistem starter.', 'Menentukan penyebab berdasarkan bukti pengukuran.'],
        bagian: [
            { judul: 'Alur diagnosis', langkah: ['Verifikasi keluhan: coba sendiri dan amati.', 'Kelompokkan gejala (lihat tabel).', 'Buat dugaan (hipotesis) penyebab.', 'Uji dugaan dengan pengukuran yang paling relevan.', 'Tentukan akar masalah (root cause).', 'Perbaiki dan verifikasi bahwa gejala hilang.'] },
            { judul: 'Tabel gejala & kemungkinan penyebab', tabel: { kepala: ['Gejala', 'Kemungkinan penyebab', 'Pemeriksaan utama'], baris: [
                ['Tidak ada bunyi sama sekali', 'Fuse, kunci kontak, relay, saklar netral, kabel terminal 50', 'Tegangan terminal 50 saat START'],
                ['Satu klik keras, tidak berputar', 'Kontak utama solenoid, motor (sikat), battery sangat lemah', 'Tegangan terminal C saat START'],
                ['Klik berulang cepat', 'Battery lemah, terminal longgar, hold-in putus', 'Tegangan battery saat cranking'],
                ['Berputar lambat', 'Battery lemah, voltage drop tinggi, motor seret', 'Voltage drop & arus cranking'],
                ['Motor berdengung, mesin diam', 'Overrunning clutch slip, pinion tidak maju', 'Uji kopling satu arah'],
                ['Bunyi gerinda', 'Gigi pinion / ring gear aus', 'Inspeksi visual gigi'] ] } },
            { judul: 'Kebiasaan teknisi yang baik', poin: ['Jangan menebak — buktikan dengan pengukuran.', 'Catat setiap hasil pengukuran.', 'Ganti komponen hanya bila terbukti rusak.', 'Selalu verifikasi setelah perbaikan.'] }
        ],
        penting: ['Gejala → hipotesis → pengukuran → kesimpulan → perbaikan → verifikasi.'],
        aksi: [{ label: 'Kerjakan Studi Kasus Diagnosis', page: 'diagnosis' }],
        cek: { q: 'Starter mengeluarkan satu bunyi klik keras dan tidak berputar, battery 12,6 V, terminal C 0 V saat START. Penyebab paling mungkin …', opsi: ['Kontak utama solenoid aus', 'Fuse putus', 'Battery penuh', 'Ring gear aus'], jawab: 0, bahas: 'Plunger bergerak (klik) tetapi tegangan tidak keluar ke terminal C → kontak utama solenoid.' }
    }
];

/* ============================================================
   2. BANK SOAL & KUIS (pilihan ganda, urutan opsi tetap A–D)
   ============================================================ */
var HUB_QUESTIONS = {
    k1: [
        { q: 'Sistem starter berfungsi untuk …', o: ['Mengisi battery saat mesin hidup', 'Memutar crankshaft saat mesin akan dihidupkan', 'Menyalakan lampu kendaraan', 'Mengatur campuran bahan bakar'], a: 1, e: 'Sistem starter memutar crankshaft sampai mesin dapat hidup sendiri.' },
        { q: 'Putaran cranking mesin bensin pada umumnya sekitar …', o: ['20–50 rpm', '150–250 rpm', '1.000–1.500 rpm', '3.000 rpm'], a: 1, e: 'Mesin bensin membutuhkan sekitar 150–250 rpm agar dapat hidup.' },
        { q: 'Tegangan kerja sistem starter mobil penumpang adalah …', o: ['6 V AC', '12 V DC', '24 V AC', '220 V AC'], a: 1, e: 'Mobil penumpang memakai sistem 12 V DC dari battery.' },
        { q: 'Komponen yang berfungsi sebagai sumber listrik sistem starter adalah …', o: ['Alternator', 'Battery', 'Relay', 'Solenoid'], a: 1, e: 'Saat mesin mati, satu-satunya sumber listrik adalah battery.' },
        { q: 'Jenis motor starter yang menggunakan roda gigi tambahan agar motor kecil menghasilkan torsi besar adalah …', o: ['Konvensional', 'Reduksi', 'Motor AC', 'Motor stepper'], a: 1, e: 'Starter tipe reduksi memakai roda gigi reduksi.' },
        { q: 'Komponen yang memberikan sinyal START ke relay adalah …', o: ['Kunci kontak (ignition switch)', 'Field coil', 'Ring gear', 'Komutator'], a: 0, e: 'Terminal ST kunci kontak memberi sinyal start.' },
        { q: 'Gigi besar di keliling flywheel disebut …', o: ['Pinion', 'Ring gear', 'Spline', 'Planet gear'], a: 1, e: 'Ring gear dipasang di keliling flywheel.' },
        { q: 'Kunci kontak tidak langsung mengalirkan arus ke motor starter karena …', o: ['Arus motor starter sangat besar', 'Motor starter memakai arus AC', 'Agar battery cepat penuh', 'Motor starter tidak memerlukan arus'], a: 0, e: 'Arus ratusan ampere dikendalikan lewat relay/solenoid.' },
        { q: 'Batas waktu cranking yang dianjurkan dalam satu kali percobaan adalah …', o: ['± 1 detik', '± 10 detik', '± 60 detik', 'Tidak dibatasi'], a: 1, e: 'Cranking maksimal ± 10 detik untuk mencegah motor panas.' },
        { q: 'Komponen yang mencegah armatur diputar terlalu cepat oleh mesin yang sudah hidup adalah …', o: ['Fuse', 'Overrunning clutch', 'Hold-in coil', 'Field coil'], a: 1, e: 'Kopling satu arah membebaskan pinion setelah mesin hidup.' }
    ],
    k2: [
        { q: 'Urutan kerja sistem starter yang benar adalah …', o: ['Relay → solenoid → pinion → cranking', 'Pinion → relay → solenoid → cranking', 'Solenoid → battery → relay → pinion', 'Cranking → pinion → relay → solenoid'], a: 0, e: 'Relay aktif dahulu, lalu solenoid mendorong pinion, kemudian motor memutar mesin.' },
        { q: 'Kumparan solenoid yang dihubungkan antara terminal 50 dan terminal C adalah …', o: ['Hold-in coil', 'Pull-in coil', 'Field coil', 'Coil relay'], a: 1, e: 'Pull-in coil berada antara terminal 50 dan C.' },
        { q: 'Saat kontak utama tertutup, pull-in coil tidak dialiri arus karena …', o: ['Putus', 'Kedua ujungnya bertegangan sama', 'Dilepas oleh relay', 'Terbakar'], a: 1, e: 'Terminal 50 dan C sama-sama bertegangan battery.' },
        { q: 'Terminal relay yang terhubung ke kumparan adalah …', o: ['30 dan 87', '85 dan 86', '30 dan 50', '50 dan C'], a: 1, e: '85 dan 86 adalah terminal kumparan relay.' },
        { q: 'Terminal 30 pada solenoid terhubung ke …', o: ['Positif battery', 'Kunci kontak', 'Field coil', 'Massa'], a: 0, e: 'Terminal 30/B menerima arus besar dari battery.' },
        { q: 'Rangkaian yang mengalirkan arus kecil untuk menggerakkan relay disebut rangkaian …', o: ['Daya', 'Kontrol', 'Pengisian', 'Penerangan'], a: 1, e: 'Rangkaian kontrol mengalirkan arus kecil.' },
        { q: 'Setelah mesin hidup dan kunci dilepas ke ON, plunger kembali karena …', o: ['Pegas pengembali', 'Arus pull-in bertambah', 'Battery habis', 'Pinion terkunci'], a: 0, e: 'Magnet hilang sehingga pegas mengembalikan plunger.' },
        { q: 'Jalur arus besar kembali ke battery melalui …', o: ['Kunci kontak', 'Badan starter → blok mesin → kabel massa', 'Relay 85', 'Fuse'], a: 1, e: 'Arus kembali melalui jalur massa.' },
        { q: 'Pada tahap “menahan” (cranking), kumparan yang aktif adalah …', o: ['Pull-in saja', 'Hold-in', 'Keduanya mati', 'Coil relay saja'], a: 1, e: 'Hanya hold-in yang menahan plunger.' },
        { q: 'Terminal C (M) pada solenoid terhubung ke …', o: ['Positif battery', 'Field coil motor starter', 'Kunci kontak', 'Relay 86'], a: 1, e: 'Terminal C menyalurkan arus ke motor (field coil).' }
    ],
    k3: [
        { q: 'Battery menunjukkan 12,6 V tanpa beban. Kondisinya …', o: ['Kosong', 'Setengah', 'Penuh', 'Rusak'], a: 2, e: '12,6 V menandakan battery penuh.' },
        { q: 'Saat cranking, tegangan battery yang sehat sebaiknya tidak turun di bawah …', o: ['± 12,6 V', '± 9,6 V', '± 6 V', '± 3 V'], a: 1, e: 'Batas umum tegangan saat cranking ± 9,6 V.' },
        { q: 'Serbuk putih kehijauan pada terminal battery menunjukkan …', o: ['Battery baru', 'Korosi yang menambah hambatan', 'Elektrolit penuh', 'Normal'], a: 1, e: 'Korosi menambah hambatan sambungan.' },
        { q: 'Uji tahanan kumparan relay dilakukan saat …', o: ['Relay sedang bekerja', 'Rangkaian tidak bertegangan', 'Mesin hidup', 'Cranking'], a: 1, e: 'Uji Ω hanya saat rangkaian tidak bertegangan.' },
        { q: 'Relay mendapat tegangan masuk tetapi keluaran 0 V dan tidak ada klik. Kesimpulan …', o: ['Relay rusak', 'Battery penuh', 'Motor starter rusak', 'Ring gear aus'], a: 0, e: 'Masukan ada, keluaran tidak ada → relay tidak bekerja.' },
        { q: 'Uji pull-in solenoid dinyatakan baik bila …', o: ['Pinion terdorong keluar', 'Pinion diam', 'Motor berputar', 'Fuse putus'], a: 0, e: 'Pull-in yang baik menarik plunger sehingga pinion keluar.' },
        { q: 'Bunyi “tek-tek-tek” cepat saat START dengan battery penuh kemungkinan disebabkan …', o: ['Hold-in coil putus', 'Field coil putus', 'Ring gear aus', 'Kunci kontak rusak'], a: 0, e: 'Tanpa hold-in, plunger tertarik-lepas berulang.' },
        { q: 'Satu bunyi klik keras tanpa putaran dengan battery baik umumnya menandakan …', o: ['Kontak utama solenoid aus', 'Relay rusak', 'Fuse putus', 'Kunci kontak rusak'], a: 0, e: 'Plunger bergerak tetapi kontak utama tidak menyalurkan arus.' },
        { q: 'CCA pada battery menyatakan …', o: ['Kapasitas pengisian', 'Kemampuan memberi arus besar saat dingin', 'Tegangan maksimum', 'Berat battery'], a: 1, e: 'Cold Cranking Amps = kemampuan arus starting.' },
        { q: 'Uji return solenoid dinyatakan baik bila …', o: ['Pinion kembali cepat saat kabel body dilepas', 'Pinion tetap di luar', 'Motor berputar', 'Solenoid panas'], a: 0, e: 'Pegas harus mengembalikan plunger dan pinion.' }
    ],
    k4: [
        { q: 'Motor starter umumnya menggunakan jenis motor …', o: ['DC seri', 'AC induksi', 'Stepper', 'DC shunt kecil'], a: 0, e: 'Motor DC seri menghasilkan torsi besar pada putaran rendah.' },
        { q: 'Komutator berfungsi untuk …', o: ['Membalik arah arus pada lilitan armatur', 'Menyimpan energi', 'Menghasilkan medan stator', 'Mengunci pinion'], a: 0, e: 'Komutator menjaga torsi tetap searah.' },
        { q: 'Sikat karbon yang aus melewati batas menyebabkan …', o: ['Motor berputar lebih cepat', 'Arus tidak sampai ke armatur, motor lemah/mati', 'Battery cepat penuh', 'Pinion terkunci'], a: 1, e: 'Kontak sikat-komutator buruk memutus aliran arus.' },
        { q: 'Uji isolasi armatur (komutator ke inti) normal bila hasilnya …', o: ['0 Ω', 'OL / tidak tersambung', '12 V', '200 A'], a: 1, e: 'Komutator harus terisolasi dari inti armatur.' },
        { q: 'Motor starter berdengung kencang tetapi mesin tidak berputar. Penyebabnya …', o: ['Overrunning clutch slip', 'Fuse putus', 'Relay rusak', 'Battery penuh'], a: 0, e: 'Tenaga motor tidak diteruskan ke pinion.' },
        { q: 'Spline heliks pada poros armatur membantu …', o: ['Pinion mudah masuk ke celah gigi ring gear', 'Mendinginkan motor', 'Mengurangi arus', 'Mengunci komutator'], a: 0, e: 'Spline heliks memutar pinion sedikit saat bergeser.' },
        { q: 'Pinion 10 gigi dan ring gear 150 gigi memiliki perbandingan …', o: ['1 : 1', '1 : 10', '1 : 15', '15 : 150'], a: 2, e: '150 ÷ 10 = 15.' },
        { q: 'Motor berputar 3.000 rpm dengan rasio 15 : 1. Putaran crankshaft …', o: ['45.000 rpm', '200 rpm', '150 rpm', '15 rpm'], a: 1, e: '3.000 ÷ 15 = 200 rpm.' },
        { q: 'Bunyi gerinda saat starting menandakan kemungkinan …', o: ['Gigi pinion/ring gear aus', 'Battery penuh', 'Fuse baru', 'Kunci kontak baik'], a: 0, e: 'Gigi aus menimbulkan bunyi gerinda.' },
        { q: 'Uji tanpa beban (no-load test) menunjukkan arus sangat besar dan putaran rendah. Kemungkinan …', o: ['Armatur hubung singkat atau bantalan seret', 'Motor sangat baik', 'Sikat terlalu panjang', 'Battery lemah'], a: 0, e: 'Arus besar + putaran rendah = beban internal/short.' }
    ],
    k5: [
        { q: 'Voltage drop diukur saat …', o: ['Rangkaian tanpa arus', 'Cranking (ada arus)', 'Mesin mati dan battery dilepas', 'Kapan saja hasilnya sama'], a: 1, e: 'Voltage drop hanya muncul bila ada arus.' },
        { q: 'Batas voltage drop sisi positif (battery → terminal 30) adalah …', o: ['≤ 0,5 V', '≤ 2 V', '≤ 5 V', '≤ 9,6 V'], a: 0, e: 'Batas sisi positif ± 0,5 V.' },
        { q: 'Batas voltage drop sisi massa adalah …', o: ['≤ 0,2 V', '≤ 1,5 V', '≤ 3 V', '≤ 12 V'], a: 0, e: 'Batas sisi massa ± 0,2 V.' },
        { q: 'Hambatan sambungan 0,005 Ω dialiri 200 A menimbulkan drop …', o: ['0,1 V', '1 V', '10 V', '0,01 V'], a: 1, e: 'V = I × R = 200 × 0,005 = 1 V.' },
        { q: 'Langkah pertama troubleshooting yang benar adalah …', o: ['Mengganti motor starter', 'Memverifikasi keluhan dan mengamati gejala', 'Membongkar mesin', 'Mengganti battery'], a: 1, e: 'Mulai dari verifikasi keluhan.' },
        { q: 'Gejala tidak ada bunyi sama sekali saat START, pemeriksaan utama yang tepat adalah …', o: ['Tegangan terminal 50 saat START', 'Ring gear', 'Voltage drop massa', 'Uji tanpa beban'], a: 0, e: 'Tidak ada bunyi → sinyal kontrol belum sampai ke solenoid.' },
        { q: 'Pengukuran tahanan (Ω) TIDAK boleh dilakukan saat …', o: ['Rangkaian bertegangan', 'Relay dilepas', 'Battery dilepas', 'Komponen di meja uji'], a: 0, e: 'Multimeter mode Ω dapat rusak dan hasilnya salah.' },
        { q: 'Untuk mengukur arus cranking tanpa memutus kabel digunakan …', o: ['Test lamp', 'Clamp meter DC', 'Hydrometer', 'Feeler gauge'], a: 1, e: 'Clamp meter DC mengukur arus lewat medan magnet kabel.' },
        { q: 'Setelah perbaikan, langkah terakhir adalah …', o: ['Langsung menyerahkan kendaraan', 'Verifikasi bahwa gejala sudah hilang', 'Mengganti semua komponen', 'Mencabut fuse'], a: 1, e: 'Verifikasi memastikan perbaikan berhasil.' },
        { q: 'Starter lambat, battery 12,6 V, voltage drop massa 1,2 V. Tindakan yang tepat …', o: ['Ganti battery', 'Bersihkan/kencangkan atau ganti kabel massa', 'Ganti relay', 'Ganti kunci kontak'], a: 1, e: 'Drop massa tinggi → perbaiki jalur massa.' }
    ]
};

var HUB_QUIZZES = [
    { id: 'k1', title: 'Kuis 1 — Dasar & Komponen', modul: 'Modul 1–3', desc: 'Pengertian, fungsi, dan komponen sistem starter.', durasi: 10, bank: ['k1'] },
    { id: 'k2', title: 'Kuis 2 — Prinsip Kerja & Rangkaian', modul: 'Modul 4–5', desc: 'Urutan kerja, solenoid, dan rangkaian kelistrikan.', durasi: 10, bank: ['k2'] },
    { id: 'k3', title: 'Kuis 3 — Battery, Relay & Solenoid', modul: 'Modul 6–8', desc: 'Pemeriksaan battery, relay, dan solenoid.', durasi: 10, bank: ['k3'] },
    { id: 'k4', title: 'Kuis 4 — Motor, Pinion & Flywheel', modul: 'Modul 9–11', desc: 'Motor DC, kopling satu arah, pinion, ring gear.', durasi: 10, bank: ['k4'] },
    { id: 'k5', title: 'Kuis 5 — Pemeriksaan & Troubleshooting', modul: 'Modul 12–14', desc: 'Voltage drop, prosedur pemeriksaan, dan diagnosis.', durasi: 10, bank: ['k5'] },
    { id: 'final', title: 'Ujian Akhir Sistem Starter', modul: 'Semua modul', desc: '25 soal gabungan dari seluruh materi.', durasi: 30, bank: ['k1', 'k2', 'k3', 'k4', 'k5'], pick: 5 }
];
var HUB_KKM = 75;

/* ============================================================
   3. DIAGNOSIS — KATALOG PEMERIKSAAN
   s: ok | warn | bad | info
   ============================================================ */
var HUB_DIAG_TESTS = [
    { id: 'vis',      grup: 'Pengamatan', nama: 'Inspeksi visual battery, terminal & kabel', alat: 'Mata, senter', normal: { v: 'Terminal kencang & bersih, kabel utuh', s: 'ok' } },
    { id: 'sound',    grup: 'Pengamatan', nama: 'Dengarkan bunyi saat kunci START', alat: 'Pendengaran', normal: { v: 'Klik relay, solenoid “jeglek”, motor berputar normal', s: 'ok' } },
    { id: 'lamp',     grup: 'Pengamatan', nama: 'Amati lampu kepala/dasbor saat START', alat: 'Pengamatan', normal: { v: 'Sedikit meredup sesaat lalu normal', s: 'ok' } },
    { id: 'rpm',      grup: 'Pengamatan', nama: 'Kecepatan putaran cranking', alat: 'Tachometer / scan tool', normal: { v: '± 200 rpm', s: 'ok' } },
    { id: 'bat_ocv',  grup: 'Battery', nama: 'Tegangan battery diam', alat: 'Multimeter V DC', normal: { v: '12,6 V', s: 'ok' } },
    { id: 'bat_crank',grup: 'Battery', nama: 'Tegangan battery saat cranking', alat: 'Multimeter V DC', normal: { v: '10,4 V', s: 'ok' } },
    { id: 'fuse',     grup: 'Rangkaian kontrol', nama: 'Kontinuitas fuse starter', alat: 'Multimeter Ω (sistem OFF)', normal: { v: '0,1 Ω (tersambung)', s: 'ok' } },
    { id: 'ign_st',   grup: 'Rangkaian kontrol', nama: 'Tegangan keluar kunci kontak (ST) saat START', alat: 'Multimeter V DC', normal: { v: '12,3 V', s: 'ok' } },
    { id: 'relay_in', grup: 'Rangkaian kontrol', nama: 'Tegangan kumparan relay (86) saat START', alat: 'Multimeter V DC', normal: { v: '12,2 V', s: 'ok' } },
    { id: 'relay_out',grup: 'Rangkaian kontrol', nama: 'Tegangan keluaran relay (87) saat START', alat: 'Multimeter V DC', normal: { v: '12,1 V', s: 'ok' } },
    { id: 't50',      grup: 'Solenoid & motor', nama: 'Tegangan terminal 50 solenoid saat START', alat: 'Multimeter V DC', normal: { v: '11,8 V', s: 'ok' } },
    { id: 't30',      grup: 'Solenoid & motor', nama: 'Tegangan terminal 30 solenoid saat START', alat: 'Multimeter V DC', normal: { v: '10,2 V', s: 'ok' } },
    { id: 'tc',       grup: 'Solenoid & motor', nama: 'Tegangan terminal C (ke motor) saat START', alat: 'Multimeter V DC', normal: { v: '10,0 V', s: 'ok' } },
    { id: 'amp',      grup: 'Solenoid & motor', nama: 'Arus cranking', alat: 'Clamp meter DC', normal: { v: '160 A', s: 'ok' } },
    { id: 'vd_pos',   grup: 'Voltage drop', nama: 'Voltage drop sisi positif (battery + → terminal 30)', alat: 'Multimeter V DC, saat cranking', normal: { v: '0,2 V', s: 'ok' } },
    { id: 'vd_gnd',   grup: 'Voltage drop', nama: 'Voltage drop sisi massa (body starter → battery −)', alat: 'Multimeter V DC, saat cranking', normal: { v: '0,1 V', s: 'ok' } },
    { id: 'bench',    grup: 'Bongkar / meja uji', nama: 'Uji tanpa beban motor starter (bench test)', alat: 'Meja uji + clamp meter', normal: { v: 'Berputar halus ± 5.000 rpm, arus 60 A', s: 'ok' } },
    { id: 'sol_test', grup: 'Bongkar / meja uji', nama: 'Uji pull-in / hold-in / return solenoid', alat: 'Battery + kabel jumper', normal: { v: 'Pull-in OK, hold-in OK, return OK', s: 'ok' } },
    { id: 'clutch',   grup: 'Bongkar / meja uji', nama: 'Uji kopling satu arah (putar pinion dengan tangan)', alat: 'Tangan', normal: { v: 'Terkunci satu arah, bebas arah sebaliknya', s: 'ok' } },
    { id: 'gear',     grup: 'Bongkar / meja uji', nama: 'Inspeksi gigi pinion & ring gear', alat: 'Senter, cermin inspeksi', normal: { v: 'Gigi utuh, tidak aus/gompal', s: 'ok' } }
];

var HUB_DIAG_CAUSES = [
    { id: 'bat_weak',  label: 'Battery lemah / soak' },
    { id: 'bat_term',  label: 'Terminal battery longgar / korosi' },
    { id: 'fuse',      label: 'Fuse starter putus' },
    { id: 'ign',       label: 'Kontak ST kunci kontak rusak' },
    { id: 'relay',     label: 'Relay starter rusak' },
    { id: 'sol_main',  label: 'Kontak utama (plat kontak) solenoid aus/terbakar' },
    { id: 'sol_hold',  label: 'Kumparan hold-in solenoid putus' },
    { id: 'pos_cable', label: 'Kabel positif utama berhambatan tinggi' },
    { id: 'ground',    label: 'Kabel / sambungan massa buruk' },
    { id: 'brush',     label: 'Sikat karbon motor starter aus' },
    { id: 'armature',  label: 'Armatur hubung singkat / bantalan seret' },
    { id: 'clutch',    label: 'Overrunning clutch slip' },
    { id: 'ring',      label: 'Gigi ring gear / pinion aus' }
];

/* ============================================================
   5. STUDI KASUS DIAGNOSIS
   hasil: override hasil pemeriksaan (selain itu = normal)
   kunci: pemeriksaan yang menjadi bukti utama
   simFault: kunci FAULTS di app.js untuk mencoba gejala di Simulator
   ============================================================ */
var HUB_DIAG_CASES = [
    {
        id: 'DG-01', judul: 'Starter berputar sangat lambat di pagi hari', tingkat: 'Mudah',
        kendaraan: 'Toyota Avanza 1.3 bensin, 2012', keluhan: 'Setiap pagi mesin sulit hidup. Starter berputar berat dan pelan, lalu kadang hanya bunyi “tek”.',
        gejala: ['Starter berputar lambat', 'Lampu dasbor meredup kuat saat START', 'Battery sudah berumur ± 3 tahun'],
        hasil: {
            bat_ocv: { v: '11,9 V', s: 'bad', n: 'Di bawah 12,2 V → isi battery rendah.' },
            bat_crank: { v: '8,4 V', s: 'bad', n: 'Turun jauh di bawah 9,6 V.' },
            lamp: { v: 'Lampu meredup sangat kuat, hampir padam', s: 'bad' },
            sound: { v: 'Motor berputar berat dan pelan, akhirnya klik', s: 'warn' },
            rpm: { v: '± 80 rpm', s: 'bad' },
            amp: { v: '120 A', s: 'warn', n: 'Arus kecil karena tegangan rendah.' },
            t30: { v: '8,2 V', s: 'warn' }, tc: { v: '8,0 V', s: 'warn' }, t50: { v: '8,3 V', s: 'warn' },
            vd_pos: { v: '0,2 V', s: 'ok' }, vd_gnd: { v: '0,1 V', s: 'ok' }
        },
        jawab: 'bat_weak', kunci: ['bat_ocv', 'bat_crank'], simFault: 'weakBattery',
        petunjuk: ['Gejala lambat + lampu sangat redup biasanya berhubungan dengan sumber listrik.', 'Bandingkan tegangan battery diam dengan tabel kondisi isi battery.', 'Voltage drop normal → kabel bukan penyebab; fokus ke battery.'],
        bahas: 'Tegangan diam 11,9 V dan turun ke 8,4 V saat cranking menunjukkan battery tidak mampu memberi arus. Voltage drop normal sehingga kabel tidak bermasalah.',
        perbaikan: ['Isi ulang battery dengan charger.', 'Lakukan uji beban (load test/CCA).', 'Ganti battery bila gagal uji beban.', 'Verifikasi: tegangan cranking > 9,6 V dan putaran normal.']
    },
    {
        id: 'DG-02', judul: 'Hanya bunyi klik, kadang bisa hidup setelah kabel digoyang', tingkat: 'Mudah',
        kendaraan: 'Honda Jazz 1.5, 2009', keluhan: 'Saat START hanya “klik”. Setelah kabel battery digoyang-goyang, kadang bisa hidup.',
        gejala: ['Bunyi klik tanpa putaran', 'Intermiten', 'Battery baru 6 bulan'],
        hasil: {
            vis: { v: 'Terminal (+) berkerak putih kehijauan, klem bisa digoyang', s: 'bad' },
            bat_ocv: { v: '12,6 V', s: 'ok' },
            bat_crank: { v: '12,3 V', s: 'warn', n: 'Hampir tidak turun → arus tidak mengalir ke starter.' },
            sound: { v: 'Klik solenoid, motor tidak berputar', s: 'bad' },
            lamp: { v: 'Lampu padam sesaat saat START', s: 'bad' },
            t30: { v: '4,1 V (berfluktuasi)', s: 'bad' }, tc: { v: '3,8 V', s: 'bad' },
            vd_pos: { v: '7,9 V', s: 'bad', n: 'Hambatan sangat besar di sisi positif.' },
            amp: { v: '20–40 A berubah-ubah', s: 'bad' }, rpm: { v: '0 rpm', s: 'bad' }
        },
        jawab: 'bat_term', kunci: ['vis', 'vd_pos'], simFault: 'looseTerminal',
        petunjuk: ['Keluhan membaik saat kabel digoyang → curigai sambungan.', 'Battery penuh tetapi tegangan di terminal 30 rendah.', 'Ukur voltage drop dari kutub battery ke terminal 30.'],
        bahas: 'Battery penuh (12,6 V) tetapi tegangan di terminal 30 hanya ± 4 V saat START. Voltage drop sisi positif 7,9 V, dan inspeksi menemukan korosi pada terminal (+). Hambatan sambungan menghalangi arus.',
        perbaikan: ['Lepas terminal (−) lalu (+).', 'Bersihkan kutub dan klem dengan sikat kawat & air soda.', 'Kencangkan klem, oles grease pelindung.', 'Verifikasi voltage drop < 0,5 V.']
    },
    {
        id: 'DG-03', judul: 'Tidak ada respons sama sekali saat START', tingkat: 'Mudah',
        kendaraan: 'Suzuki Ertiga 1.4, 2016', keluhan: 'Lampu dasbor menyala normal, tetapi saat kunci diputar ke START tidak ada bunyi apa pun.',
        gejala: ['Tidak ada bunyi relay maupun solenoid', 'Lampu & klakson normal'],
        hasil: {
            sound: { v: 'Sunyi, tidak ada klik relay maupun solenoid', s: 'bad' },
            lamp: { v: 'Lampu tidak meredup sama sekali', s: 'info' },
            fuse: { v: 'OL (terbuka)', s: 'bad', n: 'Elemen fuse putus.' },
            ign_st: { v: '0 V', s: 'bad' }, relay_in: { v: '0 V', s: 'bad' }, relay_out: { v: '0 V', s: 'bad' },
            t50: { v: '0 V', s: 'bad' }, t30: { v: '12,6 V', s: 'ok' }, tc: { v: '0 V', s: 'info' },
            bat_crank: { v: '12,6 V (tidak ada beban)', s: 'info' }, amp: { v: '0 A', s: 'bad' }, rpm: { v: '0 rpm', s: 'bad' },
            vd_pos: { v: '0,0 V (tidak ada arus)', s: 'info' }, vd_gnd: { v: '0,0 V (tidak ada arus)', s: 'info' }
        },
        jawab: 'fuse', kunci: ['fuse', 't50'], simFault: 'openFuse',
        petunjuk: ['Tidak ada bunyi relay → sinyal kontrol belum sampai.', 'Telusuri dari awal rangkaian kontrol.', 'Uji kontinuitas fuse dengan sistem OFF.'],
        bahas: 'Terminal 50 dan masukan relay 0 V, sedangkan battery normal. Fuse terukur OL sehingga arus kontrol tidak mengalir ke kunci kontak dan relay.',
        perbaikan: ['Cari penyebab fuse putus (cek hubung singkat kabel).', 'Ganti fuse dengan ampere yang sama.', 'Verifikasi: relay klik dan starter bekerja.']
    },
    {
        id: 'DG-04', judul: 'Lampu ON normal, tetapi START tidak ada reaksi', tingkat: 'Sedang',
        kendaraan: 'Daihatsu Xenia 1.0, 2008', keluhan: 'Kadang harus memutar kunci berkali-kali. Sekarang sama sekali tidak bisa START.',
        gejala: ['Tidak ada bunyi', 'Kunci terasa longgar di posisi START', 'Fuse sudah dicek pemilik'],
        hasil: {
            sound: { v: 'Sunyi', s: 'bad' },
            fuse: { v: '0,1 Ω (baik)', s: 'ok' },
            ign_st: { v: '0 V (posisi ON: 12,6 V di terminal IG)', s: 'bad', n: 'Masukan B+ kunci ada, keluaran ST tidak ada.' },
            relay_in: { v: '0 V', s: 'bad' }, relay_out: { v: '0 V', s: 'bad' }, t50: { v: '0 V', s: 'bad' },
            bat_crank: { v: '12,6 V (tidak ada beban)', s: 'info' }, amp: { v: '0 A', s: 'bad' }, rpm: { v: '0 rpm', s: 'bad' },
            vd_pos: { v: '0,0 V (tidak ada arus)', s: 'info' }, vd_gnd: { v: '0,0 V (tidak ada arus)', s: 'info' }
        },
        jawab: 'ign', kunci: ['fuse', 'ign_st'], simFault: 'ignitionFailure',
        petunjuk: ['Fuse baik tetapi relay tidak menerima tegangan.', 'Ukur keluaran terminal ST kunci kontak saat START.', 'Bandingkan dengan keluaran posisi ON.'],
        bahas: 'Fuse baik dan kunci menerima B+ (posisi ON normal), tetapi terminal ST tetap 0 V saat START. Kontak ST di dalam kunci kontak aus.',
        perbaikan: ['Lepas kabel negatif battery.', 'Ganti kontak/rumah kunci kontak.', 'Verifikasi tegangan ST ± 12 V saat START.']
    },
    {
        id: 'DG-05', judul: 'Relay tidak berbunyi, kunci kontak normal', tingkat: 'Sedang',
        kendaraan: 'Mitsubishi L300 2.5 diesel, 2015', keluhan: 'Tidak bisa START. Montir sebelumnya sudah mengganti fuse, masalah tetap ada.',
        gejala: ['Tidak ada klik relay', 'Fuse baru', 'Battery baru'],
        hasil: {
            sound: { v: 'Sunyi, tidak ada klik relay', s: 'bad' },
            fuse: { v: '0,1 Ω (baik)', s: 'ok' }, ign_st: { v: '12,3 V', s: 'ok' },
            relay_in: { v: '12,2 V', s: 'ok' },
            relay_out: { v: '0 V', s: 'bad', n: 'Masukan ada, keluaran tidak ada.' },
            t50: { v: '0 V', s: 'bad' },
            bat_crank: { v: '12,6 V (tidak ada beban)', s: 'info' }, amp: { v: '0 A', s: 'bad' }, rpm: { v: '0 rpm', s: 'bad' },
            vd_pos: { v: '0,0 V (tidak ada arus)', s: 'info' }, vd_gnd: { v: '0,0 V (tidak ada arus)', s: 'info' }
        },
        jawab: 'relay', kunci: ['relay_in', 'relay_out'], simFault: 'relayFailure',
        petunjuk: ['Sinyal dari kunci kontak sudah ada.', 'Bandingkan tegangan masuk dan keluar relay.'],
        bahas: 'Relay menerima 12,2 V di kumparan tetapi keluaran 87 tetap 0 V dan tidak terdengar klik. Kumparan relay putus atau kontaknya rusak.',
        perbaikan: ['Lepas relay, ukur tahanan kumparan (OL = putus).', 'Ganti relay dengan tipe yang sama.', 'Verifikasi: klik relay dan terminal 50 ± 12 V.']
    },
    {
        id: 'DG-06', judul: 'Satu klik keras, motor tidak berputar', tingkat: 'Sedang',
        kendaraan: 'Toyota Kijang Innova 2.0, 2010', keluhan: 'Saat START terdengar “jeglek” keras sekali, lalu diam. Lampu tidak meredup.',
        gejala: ['Satu klik keras', 'Lampu tidak meredup', 'Battery 12,6 V'],
        hasil: {
            sound: { v: 'Satu klik keras dari solenoid, motor diam', s: 'bad' },
            lamp: { v: 'Lampu tidak meredup', s: 'warn', n: 'Tidak ada arus besar yang mengalir.' },
            bat_ocv: { v: '12,6 V', s: 'ok' }, bat_crank: { v: '12,5 V', s: 'warn' },
            t50: { v: '11,9 V', s: 'ok' }, t30: { v: '12,5 V', s: 'ok' },
            tc: { v: '0 V', s: 'bad', n: 'Tegangan tidak keluar dari kontak utama.' },
            amp: { v: '8 A (hanya kumparan solenoid)', s: 'bad' }, rpm: { v: '0 rpm', s: 'bad' },
            vd_pos: { v: '0,0 V (arus kecil)', s: 'info' },
            sol_test: { v: 'Pull-in OK, hold-in OK, return OK; kontak utama tidak menyambung', s: 'bad' },
            bench: { v: 'Motor berputar normal bila diberi arus langsung ke terminal C', s: 'ok' }
        },
        jawab: 'sol_main', kunci: ['t30', 'tc'], simFault: 'solenoidFailure',
        petunjuk: ['Klik keras berarti plunger bergerak.', 'Bandingkan tegangan terminal 30 dan C saat START.'],
        bahas: 'Plunger bekerja (klik) dan terminal 30 bertegangan 12,5 V, tetapi terminal C 0 V. Arus besar tidak melewati kontak utama karena plat kontak aus/terbakar.',
        perbaikan: ['Bongkar solenoid, periksa plat & baut kontak.', 'Ganti kit kontak atau solenoid.', 'Verifikasi: terminal C ± 10 V dan motor berputar.']
    },
    {
        id: 'DG-07', judul: 'Bunyi “tek-tek-tek” cepat dengan battery penuh', tingkat: 'Sulit',
        kendaraan: 'Nissan Grand Livina 1.5, 2013', keluhan: 'Saat START terdengar tek-tek-tek cepat seperti senapan mesin. Battery baru diganti tetapi tetap sama.',
        gejala: ['Klik berulang cepat', 'Battery baru', 'Terminal sudah dibersihkan'],
        hasil: {
            sound: { v: 'Klik berulang sangat cepat dari solenoid', s: 'bad' },
            vis: { v: 'Terminal bersih & kencang', s: 'ok' },
            bat_ocv: { v: '12,7 V', s: 'ok' }, bat_crank: { v: '12,0–12,6 V berfluktuasi', s: 'warn' },
            t50: { v: '11,9 V stabil', s: 'ok' }, tc: { v: '0–10 V berkedip', s: 'warn' },
            vd_pos: { v: '0,2 V', s: 'ok' }, vd_gnd: { v: '0,1 V', s: 'ok' },
            amp: { v: 'Melonjak-lonjak 0–150 A', s: 'warn' }, rpm: { v: '0–20 rpm tersendat', s: 'bad' },
            sol_test: { v: 'Pull-in OK, HOLD-IN GAGAL (pinion langsung kembali), return OK', s: 'bad' }
        },
        jawab: 'sol_hold', kunci: ['bat_ocv', 'sol_test'], simFault: null,
        petunjuk: ['Battery penuh dan sambungan baik → masalah bukan di suplai.', 'Ingat: saat kontak utama menutup, hanya hold-in yang menahan plunger.', 'Lakukan uji pull-in, hold-in, return.'],
        bahas: 'Battery dan voltage drop normal, tetapi uji hold-in gagal. Saat kontak utama menutup pull-in tidak dialiri, sehingga tanpa hold-in plunger terlepas, kontak membuka, pull-in aktif lagi — berulang cepat.',
        perbaikan: ['Ganti solenoid (kumparan tidak dapat diperbaiki).', 'Uji ulang pull-in/hold-in/return.', 'Verifikasi cranking stabil.']
    },
    {
        id: 'DG-08', judul: 'Starter lambat padahal battery baru', tingkat: 'Sedang',
        kendaraan: 'Toyota Rush 1.5, 2014', keluhan: 'Setelah ganti battery baru, starter masih terasa berat dan lambat, terutama saat mesin panas.',
        gejala: ['Putaran starter lambat', 'Battery baru', 'Lampu tidak terlalu redup'],
        hasil: {
            bat_ocv: { v: '12,7 V', s: 'ok' }, bat_crank: { v: '11,4 V', s: 'warn', n: 'Battery hampir tidak terbebani — arus tertahan di tempat lain.' },
            lamp: { v: 'Sedikit meredup', s: 'info' }, sound: { v: 'Motor berputar berat', s: 'warn' },
            rpm: { v: '± 100 rpm', s: 'bad' }, amp: { v: '90 A', s: 'warn' },
            vd_pos: { v: '0,2 V', s: 'ok' },
            vd_gnd: { v: '1,4 V', s: 'bad', n: 'Jauh di atas batas 0,2 V.' },
            vis: { v: 'Kabel massa mesin–bodi berkarat di baut dudukan', s: 'bad' },
            t30: { v: '11,2 V', s: 'ok' }, tc: { v: '11,0 V', s: 'ok' }
        },
        jawab: 'ground', kunci: ['vd_pos', 'vd_gnd'], simFault: 'poorGround',
        petunjuk: ['Battery baru dan tegangannya tetap tinggi saat cranking → arus kecil.', 'Ukur voltage drop di kedua sisi: positif dan massa.'],
        bahas: 'Voltage drop massa 1,4 V (batas 0,2 V) sedangkan sisi positif normal. Hambatan pada kabel massa membatasi arus sehingga starter lemah.',
        perbaikan: ['Lepas, bersihkan, dan kencangkan kabel massa mesin & bodi.', 'Ganti kabel massa bila serabut korosi.', 'Verifikasi drop massa < 0,2 V.']
    },
    {
        id: 'DG-09', judul: 'Klik dan terminal motor bertegangan, tetapi motor diam', tingkat: 'Sulit',
        kendaraan: 'Isuzu Panther 2.5 diesel, 2005', keluhan: 'Starter diam, hanya klik. Kadang bisa berputar setelah body starter dipukul pelan.',
        gejala: ['Klik tanpa putaran', 'Kadang bisa setelah body diketuk', 'Starter belum pernah diservis'],
        hasil: {
            sound: { v: 'Klik solenoid, motor tidak berputar', s: 'bad' },
            bat_ocv: { v: '12,6 V', s: 'ok' }, bat_crank: { v: '12,4 V', s: 'warn' },
            lamp: { v: 'Lampu tidak meredup', s: 'warn' },
            t50: { v: '11,9 V', s: 'ok' }, t30: { v: '12,4 V', s: 'ok' },
            tc: { v: '12,3 V', s: 'warn', n: 'Tegangan sampai ke motor, tetapi tidak ada arus.' },
            amp: { v: '0 A', s: 'bad' }, rpm: { v: '0 rpm', s: 'bad' },
            vd_pos: { v: '0,0 V (tidak ada arus)', s: 'info' },
            bench: { v: 'Tidak berputar; panjang sikat 5 mm (batas 8,5 mm)', s: 'bad' },
            sol_test: { v: 'Pull-in, hold-in, return OK', s: 'ok' }
        },
        jawab: 'brush', kunci: ['tc', 'bench'], simFault: 'starterMotorFailure',
        petunjuk: ['Tegangan sudah sampai terminal C → kontak utama solenoid bekerja.', 'Tegangan ada tetapi arus 0 A berarti rangkaian di dalam motor terbuka.', 'Lakukan bench test dan ukur panjang sikat.'],
        bahas: 'Terminal C mendapat 12,3 V tetapi arus 0 A — rangkaian di dalam motor terbuka. Bench test menunjukkan sikat karbon aus (5 mm < 8,5 mm) sehingga tidak menekan komutator.',
        perbaikan: ['Bongkar motor starter.', 'Ganti sikat & pegas sikat; bersihkan komutator.', 'Uji tanpa beban, lalu pasang dan verifikasi.']
    },
    {
        id: 'DG-10', judul: 'Motor berdengung kencang, mesin tidak berputar', tingkat: 'Sedang',
        kendaraan: 'Honda Brio 1.2, 2018', keluhan: 'Saat START terdengar suara “nging” tinggi seperti bor, tetapi mesin tidak ikut berputar.',
        gejala: ['Suara dengung tinggi', 'Mesin diam', 'Battery baik'],
        hasil: {
            sound: { v: 'Dengung tinggi motor berputar bebas', s: 'bad' },
            bat_ocv: { v: '12,6 V', s: 'ok' }, bat_crank: { v: '11,8 V', s: 'info' },
            amp: { v: '55 A', s: 'warn', n: 'Arus rendah seperti motor tanpa beban.' },
            rpm: { v: 'Mesin 0 rpm', s: 'bad' },
            bench: { v: 'Motor berputar normal', s: 'ok' },
            clutch: { v: 'Pinion dapat berputar bebas KEDUA arah', s: 'bad' },
            gear: { v: 'Gigi pinion & ring gear baik', s: 'ok' },
            sol_test: { v: 'Pull-in, hold-in, return OK', s: 'ok' }
        },
        jawab: 'clutch', kunci: ['amp', 'clutch'], simFault: null,
        petunjuk: ['Motor berputar — listrik sudah sampai.', 'Arus rendah = motor tidak terbebani mesin.', 'Uji pinion dengan tangan: harus terkunci satu arah.'],
        bahas: 'Motor berputar dengan arus rendah (tanpa beban) dan pinion bisa diputar bebas ke dua arah. Roller kopling satu arah aus/slip sehingga torsi tidak diteruskan ke ring gear.',
        perbaikan: ['Ganti overrunning clutch (beserta pinion).', 'Lumasi spline poros armatur.', 'Verifikasi: pinion terkunci satu arah dan mesin berputar.']
    },
    {
        id: 'DG-11', judul: 'Bunyi gerinda dan kadang starter macet', tingkat: 'Sedang',
        kendaraan: 'Suzuki Carry 1.5, 2017', keluhan: 'Kadang terdengar bunyi “krrrk” keras saat START dan mesin tidak berputar. Dicoba lagi bisa hidup.',
        gejala: ['Bunyi gerinda', 'Intermiten', 'Kadang normal'],
        hasil: {
            sound: { v: 'Bunyi gerinda logam saat pinion masuk', s: 'bad' },
            bat_ocv: { v: '12,6 V', s: 'ok' }, bat_crank: { v: '10,3 V', s: 'ok' },
            amp: { v: '170 A (saat bisa berputar)', s: 'ok' },
            vd_pos: { v: '0,2 V', s: 'ok' }, vd_gnd: { v: '0,1 V', s: 'ok' },
            clutch: { v: 'Terkunci satu arah dengan baik', s: 'ok' },
            gear: { v: 'Beberapa gigi ring gear aus/gompal di satu sektor', s: 'bad' },
            bench: { v: 'Motor normal', s: 'ok' }
        },
        jawab: 'ring', kunci: ['sound', 'gear'], simFault: null,
        petunjuk: ['Listrik normal → fokus ke bagian mekanis.', 'Bunyi gerinda terjadi saat gigi bertemu.', 'Periksa gigi ring gear melalui lubang inspeksi.'],
        bahas: 'Pengukuran listrik normal dan kopling baik. Inspeksi menemukan gigi ring gear gompal di satu sektor — mesin sering berhenti di posisi yang sama sehingga pinion selalu mengenai gigi yang rusak.',
        perbaikan: ['Ganti ring gear (atau flywheel/drive plate).', 'Periksa dan ganti pinion bila ikut aus.', 'Verifikasi tidak ada bunyi gerinda.']
    },
    {
        id: 'DG-12', judul: 'Starter lambat, kabel positif terasa panas', tingkat: 'Sulit',
        kendaraan: 'Toyota Hilux 2.4 diesel, 2016', keluhan: 'Starter lemah. Setelah beberapa kali mencoba, kabel besar dari battery ke starter terasa panas.',
        gejala: ['Putaran lambat', 'Kabel positif panas', 'Battery baru'],
        hasil: {
            bat_ocv: { v: '12,7 V', s: 'ok' }, bat_crank: { v: '11,3 V', s: 'warn' },
            rpm: { v: '± 110 rpm', s: 'bad' }, amp: { v: '140 A', s: 'warn' },
            vd_pos: { v: '1,8 V', s: 'bad', n: 'Jauh di atas batas 0,5 V.' },
            vd_gnd: { v: '0,1 V', s: 'ok' },
            vis: { v: 'Isolasi kabel positif retak dekat manifold, serabut kehitaman', s: 'bad' },
            t30: { v: '9,5 V', s: 'warn' }, tc: { v: '9,3 V', s: 'warn' }
        },
        jawab: 'pos_cable', kunci: ['vd_pos', 'vd_gnd'], simFault: null,
        petunjuk: ['Kabel panas = ada hambatan yang mengubah listrik menjadi panas.', 'Ukur voltage drop sisi positif dan massa, lalu bandingkan.'],
        bahas: 'Voltage drop sisi positif 1,8 V sedangkan sisi massa normal. Serabut kabel positif teroksidasi sehingga hambatannya tinggi dan kabel panas.',
        perbaikan: ['Ganti kabel positif utama dengan ukuran penampang yang sama.', 'Pastikan sepatu kabel dipres dengan benar.', 'Verifikasi drop positif < 0,5 V.']
    }
];

if (typeof window !== 'undefined') {
    window.HUB_MATERI = HUB_MATERI;
    window.HUB_QUESTIONS = HUB_QUESTIONS;
    window.HUB_QUIZZES = HUB_QUIZZES;
    window.HUB_KKM = HUB_KKM;
    window.HUB_DIAG_TESTS = HUB_DIAG_TESTS;
    window.HUB_DIAG_CAUSES = HUB_DIAG_CAUSES;
    window.HUB_DIAG_CASES = HUB_DIAG_CASES;
}
