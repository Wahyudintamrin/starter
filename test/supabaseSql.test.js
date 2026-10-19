'use strict';
/* ============================================================
   SUPABASE SQL TEST — menguji supabase/schema.sql pada Postgres sungguhan.
   Dijalankan sebagai peran `anon` (sama seperti browser lewat PostgREST).
   Butuh Postgres + psql. Tanpa itu tes ini dilewati (lulus tanpa menguji).

     SL_PGURL="postgresql://postgres@/sltest?host=/tmp/slpg&port=54329" node test/supabaseSql.test.js

   Database tes harus kosong, dengan skema extensions + peran anon/authenticated
   (lihat supabase/README-SETUP.md bagian "Menguji di Postgres lokal").
   Run: node test/supabaseSql.test.js
   ============================================================ */
const { execFileSync } = require('child_process');
const URL = process.env.SL_PGURL;
if (!URL) { console.log('SUPABASE SQL TEST dilewati (SL_PGURL tidak diatur)\n=== RESULTS: 0 passed, 0 failed ==='); process.exit(0); }

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.log('  FAIL: ' + msg); } }

const J = (o) => ({ __t: 'jsonb', v: JSON.stringify(o) });
const T = (s) => ({ __t: 'timestamptz', v: s });
function lit(a) {
    if (a === null || a === undefined) return 'NULL';
    if (typeof a === 'object' && a.__t) return '$q$' + a.v + '$q$::' + a.__t;
    if (typeof a === 'number') return String(a);
    return '$q$' + String(a) + '$q$';
}
function sql(stmt, role) {
    const out = execFileSync('psql', [URL, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', (role ? 'set role ' + role + '; ' : '') + stmt],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim();
}
function rpc(fn, args) {
    const out = sql('select public.' + fn + '(' + (args || []).map(lit).join(', ') + ')', 'anon');
    return JSON.parse(out);
}
function admin(stmt) { return sql(stmt); }
function fails(stmt) { try { sql(stmt, 'anon'); return false; } catch (e) { return String(e.stderr || e.message); } }

function login(u, p, portal) { return rpc('sl_login', [u, p, portal || 'general']); }
function doc(kind, id, data, pw) { const c = { kind, id, data: Object.assign({ id }, data) }; if (pw) c.password = pw; return c; }
function push(tok, changes) { return rpc('sl_push', [tok, J(changes)]); }
function pull(tok, since) { return rpc('sl_pull', [tok, since ? T(since) : null]); }
const ids = (r) => r.docs.map((d) => d.kind + ':' + d.id).sort();
function rejected(r, kind, id) { return (r.rejected || []).filter((x) => x.kind === kind && x.id === id)[0]; }
function accepted(r, kind, id) { return (r.accepted || []).some((x) => x.kind === kind && x.id === id); }

/* ------------------------------------------------------------------ */
console.log('== 1. Tabel tertutup untuk browser (peran anon)');
['sl_docs', 'sl_creds', 'sl_sessions', 'sl_pending_creds', 'sl_progress', 'sl_settings'].forEach((t) => {
    assert(/permission denied/.test(fails('select * from public.' + t) || ''), 'anon tidak boleh membaca ' + t);
});
assert(/permission denied/.test(fails("insert into public.sl_docs(kind,id,data) values ('users','X','{}')") || ''), 'anon tidak boleh menulis sl_docs');
assert(/permission denied/.test(fails("select public.sl_auth('x')") || ''), 'fungsi internal sl_auth tertutup');
assert(/permission denied/.test(fails("select public.sl_check_write('{}'::jsonb,'users','x',null,false)") || ''), 'fungsi internal sl_check_write tertutup');

console.log('== 2. Superadmin awal & portal');
const sa0 = login('superadmin', 'salah', 'superadmin');
assert(sa0.ok === false && sa0.code === 'AUTH_FAILED', 'sandi salah ditolak');
assert(login('superadmin', 'superadmin123', 'general').code === 'WRONG_PORTAL', 'Superadmin tidak bisa masuk lewat portal umum');
const sa = login('SuperAdmin', 'superadmin123', 'superadmin');
assert(sa.ok && sa.token && sa.mustChange === true, 'Superadmin masuk, wajib ganti sandi (username tak peka huruf besar)');
assert(!('passwordHash' in sa.user) && !('salt' in sa.user), 'user tidak membawa hash');
assert(rpc('sl_change_password', [sa.token, 'bukan', 'sandibaru1']).code === 'BAD_PASSWORD', 'ganti sandi: sandi lama salah');
assert(rpc('sl_change_password', [sa.token, 'superadmin123', 'abc']).code === 'VALIDATION', 'ganti sandi: terlalu pendek');
assert(rpc('sl_change_password', [sa.token, 'superadmin123', 'SandiBaru#1']).ok === true, 'ganti sandi berhasil');
assert(login('superadmin', 'superadmin123', 'superadmin').ok === false, 'sandi lama tidak berlaku');
const SA = login('superadmin', 'SandiBaru#1', 'superadmin');
assert(SA.ok && SA.mustChange === false, 'masuk dengan sandi baru, tidak wajib ganti lagi');

console.log('== 3. Daftar sekolah publik & persetujuan');
assert(rpc('sl_list_schools').length === 0, 'belum ada sekolah aktif');
const rs = rpc('sl_register_school', ['SMK Uji 1', 'Jl. Uji', 'Admin Uji', 'admin1', 'rahasia1']);
assert(rs.ok === true, 'daftar sekolah publik');
assert(rpc('sl_register_school', ['smk uji 1', '', 'X', 'adminx', 'rahasia1']).code === 'DUPLICATE', 'nama sekolah ganda ditolak (tak peka huruf)');
assert(rpc('sl_register_school', ['SMK Lain', '', 'X', 'ADMIN1', 'rahasia1']).code === 'DUPLICATE', 'username admin dipesan ditolak');
assert(rpc('sl_register_school', ['SMK Lain', '', 'X', 'adminx', 'abc']).code === 'VALIDATION', 'sandi admin pendek ditolak');
assert(login('admin1', 'rahasia1').ok === false, 'admin sekolah belum bisa login sebelum disetujui');
const p1 = pull(SA.token);
const orgDoc = p1.docs.filter((d) => d.kind === 'organizations')[0];
assert(orgDoc && orgDoc.data.status === 'PENDING' && orgDoc.data.pendingAdmin.username === 'admin1', 'Superadmin melihat sekolah PENDING');
assert(!('passwordHash' in orgDoc.data.pendingAdmin), 'pendingAdmin tanpa hash');
const ORG1 = orgDoc.id;
assert(login('x', 'y').ok === false, 'login ngawur ditolak');

/* Superadmin menyetujui sekolah: buat user admin (tanpa sandi, sandi diambil dari pendaftaran) */
const approve = push(SA.token, [
    doc('users', 'USER_ADM1', { role: 'INSTRUCTOR', name: 'Admin Uji', username: 'admin1', organizationId: ORG1, status: 'ACTIVE', orgAdmin: true, classIds: [] }),
    doc('organizations', ORG1, Object.assign({}, orgDoc.data, { status: 'ACTIVE', adminUserId: 'USER_ADM1', pendingAdmin: undefined }))
]);
assert(accepted(approve, 'users', 'USER_ADM1') && accepted(approve, 'organizations', ORG1), 'Superadmin menyetujui sekolah + admin');
const A1 = login('admin1', 'rahasia1');
assert(A1.ok && A1.user.orgAdmin === true, 'admin sekolah login dengan sandi saat pendaftaran');
assert(rpc('sl_list_schools').length === 1 && rpc('sl_list_schools')[0].name === 'SMK Uji 1', 'sekolah aktif muncul di daftar publik');

console.log('== 4. Pendaftaran publik siswa/guru');
const rsA = rpc('sl_register_user', ['STUDENT', 'Siswa A', 'sisA', 'a@x.id', 'passA123', ORG1]);
assert(rsA.ok && rsA.status === 'PENDING', 'siswa mendaftar -> PENDING');
assert(login('sisA', 'passA123').code === 'ACCOUNT_PENDING', 'siswa PENDING tidak bisa login');
assert(rpc('sl_register_user', ['STUDENT', 'Dup', 'SISA', '', 'passA123', ORG1]).code === 'DUPLICATE', 'username ganda (tak peka huruf)');
assert(rpc('sl_register_user', ['STUDENT', 'X', 'sisx', '', 'passA123', 'ORG_NOPE']).ok === false, 'sekolah tidak ada ditolak');
assert(rpc('sl_register_user', ['ADMIN', 'X', 'sisy', '', 'passA123', ORG1]).ok === false, 'tidak bisa mendaftar sebagai ADMIN');
const rsT = rpc('sl_register_user', ['INSTRUCTOR', 'Guru B', 'guruB', '', 'guruB123', ORG1]);
assert(rsT.ok && rsT.status === 'ACTIVE', 'guru mendaftar -> ACTIVE (pengaturan bawaan)');
const T1 = login('guruB', 'guruB123');
assert(T1.ok && T1.user.role === 'INSTRUCTOR', 'guru langsung login');
admin("update public.sl_settings set value='PENDING' where key='instructor_signup_status'");
assert(rpc('sl_register_user', ['INSTRUCTOR', 'Guru C', 'guruC', '', 'guruC123', ORG1]).status === 'PENDING', 'pengaturan PENDING berlaku untuk guru');
admin("update public.sl_settings set value='ACTIVE' where key='instructor_signup_status'");

console.log('== 5. Admin sekolah mengelola siswa & kelas');
let pA1 = pull(A1.token);
const sisA = pA1.docs.filter((d) => d.kind === 'users' && d.data.username === 'sisA')[0];
assert(!!sisA, 'admin sekolah melihat siswa PENDING di sekolahnya');
const ap = push(A1.token, [doc('users', sisA.id, Object.assign({}, sisA.data, { status: 'ACTIVE' }))]);
assert(accepted(ap, 'users', sisA.id), 'admin sekolah menyetujui siswa');
const SA1 = login('sisA', 'passA123');
assert(SA1.ok && SA1.user.role === 'STUDENT', 'siswa login setelah disetujui');

const mk = push(A1.token, [
    doc('users', 'USER_S2', { role: 'STUDENT', name: 'Siswa B', username: 'sisB', organizationId: ORG1, status: 'ACTIVE', classIds: [], nis: '1' }, 'passB123'),
    doc('classes', 'CLASS_1', { name: 'XI TKR 1', organizationId: ORG1, status: 'ACTIVE', studentIds: [sisA.id], instructorIds: ['USER_ADM1'], joinCode: 'KODE-1', joinEnabled: true }),
    doc('assignments', 'ASG_1', { classId: 'CLASS_1', organizationId: ORG1, title: 'Tugas 1', status: 'PUBLISHED', studentIds: [] }),
    doc('assignments', 'ASG_DRAFT', { classId: 'CLASS_1', organizationId: ORG1, title: 'Draf', status: 'DRAFT', studentIds: [] }),
    doc('assignments', 'ASG_TARGET', { classId: 'CLASS_1', organizationId: ORG1, title: 'Khusus B', status: 'PUBLISHED', studentIds: ['USER_S2'] })
]);
assert(['USER_S2', 'CLASS_1', 'ASG_1', 'ASG_DRAFT', 'ASG_TARGET'].every((x, i) => accepted(mk, ['users', 'classes', 'assignments', 'assignments', 'assignments'][i], x)), 'admin sekolah membuat siswa, kelas, tugas');
assert(login('sisB', 'passB123').ok === true, 'siswa buatan guru bisa login dengan sandi yang diberikan');
assert(push(A1.token, [doc('users', 'USER_S3', { role: 'STUDENT', name: 'Dup', username: 'SISB', organizationId: ORG1, status: 'ACTIVE', classIds: [] }, 'x123456')]).rejected[0].reason === 'USERNAME_TAKEN', 'username ganda ditolak server (tak peka huruf)');
assert(push(A1.token, [doc('users', 'USER_S4', { role: 'STUDENT', name: 'Pending', username: 'rsv', organizationId: ORG1, status: 'ACTIVE', classIds: [] }, 'x123456')]).ok, 'push lain tetap jalan');

console.log('== 6. Hak baca siswa');
const SB = login('sisB', 'passB123');
const pSA = pull(SA1.token);
assert(ids(pSA).includes('classes:CLASS_1'), 'siswa A melihat kelasnya');
assert(ids(pSA).includes('assignments:ASG_1'), 'siswa A melihat tugas terbit');
assert(!ids(pSA).includes('assignments:ASG_DRAFT'), 'siswa tidak melihat tugas DRAFT');
assert(!ids(pSA).includes('assignments:ASG_TARGET'), 'siswa tidak melihat tugas yang ditujukan ke siswa lain');
assert(!ids(pSA).includes('users:USER_S2'), 'siswa tidak melihat siswa lain');
assert(ids(pSA).includes('users:' + sisA.id) && ids(pSA).includes('users:USER_ADM1'), 'siswa melihat dirinya & guru sekolahnya');
assert(ids(pSA).includes('organizations:' + ORG1), 'siswa melihat sekolahnya');
assert(JSON.stringify(pSA).indexOf('passwordHash') < 0, 'tidak ada passwordHash di respons pull');
assert(pSA.docs.every((d) => d.kind !== 'users' || d.data.status === 'ACTIVE' || d.id === sisA.id), 'status user lain aman');

console.log('== 7. Siswa tidak boleh menaikkan hak');
const own = pSA.docs.filter((d) => d.id === sisA.id)[0].data;
['role', 'status', 'organizationId', 'orgAdmin', 'username', 'classIds'].forEach((f) => {
    const nd = Object.assign({}, own); nd[f] = f === 'classIds' ? ['CLASS_X'] : f === 'orgAdmin' ? true : f === 'role' ? 'ADMIN' : 'ORG_LAIN';
    const r = push(SA1.token, [doc('users', sisA.id, nd)]);
    assert(rejected(r, 'users', sisA.id) && /FORBIDDEN/.test(rejected(r, 'users', sisA.id).reason), 'siswa tidak boleh ubah ' + f);
});
assert(accepted(push(SA1.token, [doc('users', sisA.id, Object.assign({}, own, { name: 'Siswa A Baru' }))]), 'users', sisA.id), 'siswa boleh ubah namanya');
assert(rejected(push(SA1.token, [doc('classes', 'CLASS_1', { name: 'Diretas', organizationId: ORG1, studentIds: [] })]), 'classes', 'CLASS_1'), 'siswa tidak boleh menulis kelas');
assert(rejected(push(SA1.token, [doc('assignments', 'ASG_1', { classId: 'CLASS_1', title: 'x' })]), 'assignments', 'ASG_1'), 'siswa tidak boleh menulis tugas');
assert(rejected(push(SA1.token, [{ kind: 'users', id: sisA.id, delete: true }]), 'users', sisA.id), 'siswa tidak boleh menghapus akunnya');
assert(rejected(push(SA1.token, [doc('users', 'USER_NEW', { role: 'STUDENT', name: 'x', username: 'xx', organizationId: ORG1, status: 'ACTIVE' })]), 'users', 'USER_NEW'), 'siswa tidak boleh membuat akun');

console.log('== 8. Pengumpulan tugas');
const sub = push(SA1.token, [doc('submissions', 'SUB_1', { assignmentId: 'ASG_1', classId: 'CLASS_1', studentId: sisA.id, status: 'SUBMITTED', score: null })]);
assert(accepted(sub, 'submissions', 'SUB_1'), 'siswa mengumpulkan tugasnya');
assert(rejected(push(SA1.token, [doc('submissions', 'SUB_X', { assignmentId: 'ASG_1', classId: 'CLASS_1', studentId: 'USER_S2', status: 'SUBMITTED' })]), 'submissions', 'SUB_X'), 'siswa tidak boleh menulis tugas atas nama siswa lain');
assert(rejected(push(SB.token, [doc('submissions', 'SUB_B', { assignmentId: 'ASG_1', classId: 'CLASS_1', studentId: 'USER_S2', status: 'SUBMITTED' })]), 'submissions', 'SUB_B').reason === 'NOT_IN_CLASS', 'siswa di luar kelas tidak boleh mengumpulkan');
assert(rejected(push(SB.token, [doc('submissions', 'SUB_1', { assignmentId: 'ASG_1', classId: 'CLASS_1', studentId: 'USER_S2', status: 'GRADED', score: 100 })]), 'submissions', 'SUB_1'), 'siswa lain tidak boleh menimpa pengumpulan orang');
assert(!ids(pull(SB.token)).includes('submissions:SUB_1'), 'siswa lain tidak melihat pengumpulan orang');
assert(ids(pull(A1.token)).includes('submissions:SUB_1'), 'guru melihat pengumpulan siswa');
const gr = push(A1.token, [doc('submissions', 'SUB_1', { assignmentId: 'ASG_1', classId: 'CLASS_1', studentId: sisA.id, status: 'GRADED', score: 88, feedback: 'bagus', gradedBy: 'USER_ADM1' })]);
assert(accepted(gr, 'submissions', 'SUB_1'), 'guru menilai');
assert(pull(SA1.token).docs.filter((d) => d.id === 'SUB_1')[0].data.score === 88, 'siswa melihat nilainya');

console.log('== 9. Gabung kelas lewat kode (server)');
const joinFail = rpc('sl_join_class', [SB.token, 'SALAH']);
assert(joinFail.ok === false && joinFail.code === 'NOT_FOUND', 'kode salah ditolak');
const jn = rpc('sl_join_class', [SB.token, 'KODE-1']);
assert(jn.ok && jn.alreadyJoined === false && jn.className === 'XI TKR 1', 'siswa B bergabung');
assert(rpc('sl_join_class', [SB.token, 'KODE-1']).alreadyJoined === true, 'gabung ulang -> alreadyJoined');
assert(ids(pull(SB.token)).includes('classes:CLASS_1'), 'setelah gabung, siswa B melihat kelas');
assert(ids(pull(SB.token)).includes('assignments:ASG_TARGET'), 'siswa B melihat tugas yang ditujukan kepadanya');
assert(rpc('sl_join_class', [A1.token, 'KODE-1']).code === 'FORBIDDEN', 'guru tidak bisa gabung kelas dengan kode');
const clsPulled = pull(A1.token).docs.filter((d) => d.id === 'CLASS_1')[0].data;
assert(clsPulled.studentIds.length === 2 && clsPulled.studentIds.includes('USER_S2'), 'guru melihat anggota kelas bertambah');
assert(pull(A1.token).docs.filter((d) => d.id === 'USER_S2')[0].data.classIds.includes('CLASS_1'), 'user.classIds ikut diperbarui');

console.log('== 10. Isolasi antar sekolah');
rpc('sl_register_school', ['SMK Uji 2', '', 'Admin Dua', 'admin2', 'rahasia2']);
const org2doc = pull(SA.token).docs.filter((d) => d.kind === 'organizations' && d.data.name === 'SMK Uji 2')[0];
const ORG2 = org2doc.id;
push(SA.token, [
    doc('users', 'USER_ADM2', { role: 'INSTRUCTOR', name: 'Admin Dua', username: 'admin2', organizationId: ORG2, status: 'ACTIVE', orgAdmin: true, classIds: [] }),
    doc('organizations', ORG2, Object.assign({}, org2doc.data, { status: 'ACTIVE', adminUserId: 'USER_ADM2', pendingAdmin: undefined }))
]);
const A2 = login('admin2', 'rahasia2');
assert(A2.ok, 'admin sekolah 2 login');
const p2 = pull(A2.token);
assert(!ids(p2).some((x) => /CLASS_1|SUB_1|USER_S2|ASG_1/.test(x) || x === 'users:' + sisA.id), 'sekolah 2 tidak melihat data sekolah 1');
assert(ids(p2).includes('organizations:' + ORG1), 'organisasi aktif tetap terlihat (nama sekolah)');
assert(rejected(push(A2.token, [doc('classes', 'CLASS_1', { name: 'Curian', organizationId: ORG2, studentIds: [] })]), 'classes', 'CLASS_1'), 'tidak bisa menimpa kelas sekolah lain');
assert(rejected(push(A2.token, [doc('classes', 'CLASS_9', { name: 'Curian', organizationId: ORG1, studentIds: [] })]), 'classes', 'CLASS_9'), 'tidak bisa membuat kelas atas nama sekolah lain');
assert(rejected(push(A2.token, [doc('users', 'USER_S2', { role: 'STUDENT', name: 'Culik', username: 'sisB', organizationId: ORG2, status: 'ACTIVE' })]), 'users', 'USER_S2'), 'tidak bisa memindahkan siswa sekolah lain');
assert(rejected(push(A2.token, [{ kind: 'users', id: 'USER_S2', delete: true }]), 'users', 'USER_S2'), 'tidak bisa menghapus siswa sekolah lain');
assert(rejected(push(A2.token, [doc('assignments', 'ASG_X', { classId: 'CLASS_1', organizationId: ORG2, title: 'x', status: 'PUBLISHED' })]), 'assignments', 'ASG_X'), 'tidak bisa membuat tugas di kelas sekolah lain');
assert(rejected(push(A2.token, [doc('organizations', ORG1, { name: 'Diambil alih', status: 'ACTIVE' })]), 'organizations', ORG1), 'tidak bisa mengubah organisasi lain');
assert(rpc('sl_join_class', [login('admin2', 'rahasia2').token, 'KODE-1']).ok === false, 'bukan siswa');
rpc('sl_register_user', ['STUDENT', 'Siswa Dua', 'sis2', '', 'pass2123', ORG2]);
push(A2.token, [doc('users', 'USER_Z', { role: 'STUDENT', name: 'Z', username: 'sisz', organizationId: ORG2, status: 'ACTIVE', classIds: [] }, 'zzzzzz1')]);
assert(rpc('sl_join_class', [login('sisz', 'zzzzzz1').token, 'KODE-1']).code === 'WRONG_ORG', 'kode kelas sekolah lain ditolak');

console.log('== 11. Batas wewenang guru');
const own1 = pull(A1.token).docs.filter((d) => d.id === 'USER_ADM1')[0].data;
assert(rejected(push(A1.token, [doc('users', 'USER_EVIL', { role: 'ADMIN', name: 'x', username: 'evil', organizationId: ORG1, status: 'ACTIVE' }, 'abcdef1')]), 'users', 'USER_EVIL'), 'guru tidak bisa membuat ADMIN');
assert(rejected(push(A1.token, [doc('users', 'USER_ADM1', Object.assign({}, own1, { role: 'ADMIN' }))]), 'users', 'USER_ADM1'), 'guru tidak bisa menaikkan dirinya jadi ADMIN');
assert(rejected(push(A1.token, [doc('users', 'USER_ADM1', Object.assign({}, own1, { organizationId: ORG2 }))]), 'users', 'USER_ADM1'), 'guru tidak bisa pindah sekolah sendiri');
assert(rejected(push(A1.token, [doc('organizations', ORG1, Object.assign({}, pull(A1.token).docs.filter((d) => d.id === ORG1)[0].data, { status: 'REJECTED' }))]), 'organizations', ORG1), 'guru tidak bisa mengubah status sekolah');
const guruBdoc = pull(A1.token).docs.filter((d) => d.kind === 'users' && d.data.username === 'guruB')[0];
assert(accepted(push(A1.token, [doc('users', guruBdoc.id, Object.assign({}, guruBdoc.data, { name: 'Guru B (diubah admin)' }))]), 'users', guruBdoc.id), 'admin sekolah boleh mengubah guru sekolahnya');
const guruBpull = pull(T1.token);
const guruBown = guruBpull.docs.filter((d) => d.id === guruBdoc.id)[0].data;
assert(rejected(push(T1.token, [doc('users', 'USER_ADM1', Object.assign({}, own1, { name: 'Dibajak' }))]), 'users', 'USER_ADM1'), 'guru biasa tidak boleh mengubah guru lain');
assert(rejected(push(T1.token, [doc('users', guruBdoc.id, Object.assign({}, guruBown, { orgAdmin: true }))]), 'users', guruBdoc.id), 'guru biasa tidak bisa menjadikan dirinya admin sekolah');
assert(accepted(push(T1.token, [doc('users', 'USER_S2', Object.assign({}, pull(T1.token).docs.filter((d) => d.id === 'USER_S2')[0].data, { name: 'Siswa B (guru)' }))]), 'users', 'USER_S2'), 'guru biasa boleh mengelola siswa');
assert(rejected(push(T1.token, [doc('users', 'USER_ADM1', Object.assign({}, own1, { status: 'INACTIVE' }))]), 'users', 'USER_ADM1'), 'guru tidak bisa menonaktifkan admin sekolah');

console.log('== 12. Sinkron bertahap & hapus');
const cur = pull(A1.token).now;
assert(pull(A1.token, cur).docs.length === 0, 'tanpa perubahan -> pull kosong');
push(SA1.token, [doc('submissions', 'SUB_2', { assignmentId: 'ASG_1', classId: 'CLASS_1', studentId: sisA.id, status: 'IN_PROGRESS' })]);
const inc = pull(A1.token, cur);
assert(ids(inc).length === 1 && ids(inc)[0] === 'submissions:SUB_2', 'pull bertahap hanya membawa yang berubah');
const delr = push(A1.token, [{ kind: 'submissions', id: 'SUB_2', delete: true }]);
assert(accepted(delr, 'submissions', 'SUB_2'), 'guru menghapus pengumpulan');
const tomb = pull(A1.token, cur).docs.filter((d) => d.id === 'SUB_2')[0];
assert(tomb && tomb.deleted === true && tomb.data === null, 'penghapusan terkirim sebagai tombstone');
assert(!ids(pull(A1.token)).includes('submissions:SUB_2'), 'pull penuh tidak memuat dokumen terhapus');

console.log('== 13. Ganti username, reset sandi, hapus akun');
const sb = pull(A1.token).docs.filter((d) => d.id === 'USER_S2')[0].data;
const rn = push(A1.token, [doc('users', 'USER_S2', Object.assign({}, sb, { username: 'sisB2' }), 'baru1234')]);
assert(accepted(rn, 'users', 'USER_S2'), 'ganti username + reset sandi');
assert(login('sisB', 'passB123').ok === false && login('sisB', 'baru1234').ok === false, 'username lama tidak berlaku');
assert(login('sisB2', 'passB123').ok === false, 'sandi lama tidak berlaku');
assert(login('sisB2', 'baru1234').ok === true, 'username + sandi baru berlaku');
const oldTok = login('sisB2', 'baru1234').token;
assert(accepted(push(A1.token, [doc('users', 'USER_S2', Object.assign({}, sb, { username: 'sisB2', status: 'INACTIVE' }))]), 'users', 'USER_S2'), 'menonaktifkan siswa');
assert(rpc('sl_me', [oldTok]).ok === false, 'sesi siswa yang dinonaktifkan langsung tidak berlaku');
assert(login('sisB2', 'baru1234').code === 'ACCOUNT_DISABLED', 'login siswa nonaktif ditolak');
assert(accepted(push(A1.token, [{ kind: 'users', id: 'USER_S2', delete: true }]), 'users', 'USER_S2'), 'menghapus akun');
assert(login('sisB2', 'baru1234').ok === false, 'akun terhapus tidak bisa login');
assert(rpc('sl_register_user', ['STUDENT', 'Pakai ulang', 'sisB2', '', 'passA123', ORG1]).ok === true, 'username akun terhapus bisa dipakai lagi');

console.log('== 14. Kunci akun & sesi');
rpc('sl_register_user', ['INSTRUCTOR', 'Guru Kunci', 'gkunci', '', 'benar123', ORG1]);
for (let i = 0; i < 8; i++) login('gkunci', 'salah' + i);
assert(login('gkunci', 'benar123').code === 'LOCKED', 'akun terkunci setelah 8 kegagalan');
admin("update public.sl_creds set locked_until = null where username_lc='gkunci'");
assert(login('gkunci', 'benar123').ok === true, 'bisa masuk lagi setelah kunci berakhir');
const lt = login('gkunci', 'benar123').token;
assert(rpc('sl_logout', [lt]).ok && rpc('sl_me', [lt]).ok === false, 'logout mencabut token');
assert(rpc('sl_pull', ['x'.repeat(40)]).code === 'AUTH_REQUIRED', 'token palsu ditolak');
admin("update public.sl_sessions set expires_at = now() - interval '1 minute' where user_id = (select user_id from public.sl_creds where username_lc='gkunci')");
assert(rpc('sl_pull', [login('gkunci', 'benar123').token]).ok === true, 'sesi baru valid');

console.log('== 15. Progres belajar');
assert(rpc('sl_progress_put', [SA1.token, J({ starterHub_v1: '{"a":1}' })]).ok, 'simpan progres siswa');
assert(JSON.parse(JSON.stringify(rpc('sl_progress_get', [SA1.token]).data)).starterHub_v1 === '{"a":1}', 'ambil progres sendiri');
assert(rpc('sl_progress_get', [SB.token]).data === null || rpc('sl_progress_get', [SB.token]).ok === false, 'progres siswa lain tidak bocor');
const po = rpc('sl_progress_org', [A1.token]);
assert(po.ok && po.rows.length === 1 && po.rows[0].username === 'sisA', 'guru melihat progres siswa sekolahnya');
assert(rpc('sl_progress_org', [login('admin2', 'rahasia2').token]).rows.length === 0, 'guru sekolah lain tidak melihat progres');
assert(rpc('sl_progress_org', [SA1.token]).code === 'FORBIDDEN', 'siswa tidak boleh melihat progres kelas');
assert(rpc('sl_progress_put', [SA1.token, J([1])]).ok === false, 'progres harus berupa objek');

console.log('== 16. Superadmin');
const pAll = pull(SA.token);
assert(pAll.docs.filter((d) => d.kind === 'users').length >= 5 && pAll.docs.filter((d) => d.kind === 'organizations').length === 2, 'Superadmin melihat semua sekolah dan pengguna');
assert(accepted(push(SA.token, [doc('users', 'USER_Q', { role: 'STUDENT', name: 'Q', username: 'qq', organizationId: ORG2, status: 'ACTIVE', classIds: [] }, 'qqqqqq1')]), 'users', 'USER_Q'), 'Superadmin membuat siswa di sekolah mana pun');
assert(rpc('sl_change_password', [SA.token, 'SandiBaru#1', 'SandiBaru#2']).ok, 'Superadmin ganti sandi sendiri');
assert(accepted(push(SA.token, [doc('users', 'USER_Q', { role: 'STUDENT', name: 'Q', username: 'qq', organizationId: ORG2, status: 'ACTIVE', classIds: [] }, 'reset123')]), 'users', 'USER_Q') && login('qq', 'reset123').ok, 'Superadmin mereset sandi');

console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed ? 1 : 0);
