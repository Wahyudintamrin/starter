'use strict';
/* ============================================================================
   UJI RLS & TRIGGER skema Supabase StarterLab — dijalankan di Postgres ASLI.
   Tanpa dependensi npm: memakai biner PostgreSQL lokal (initdb/pg_ctl/psql).
     node rls.test.js                          -> membuat klaster Postgres sementara
     TEST_DATABASE_URL=postgres://... node rls.test.js
                                               -> memakai database KOSONG yang Anda sediakan
   Skema `auth` ditiru oleh mock_supabase.sql (auth.users, auth.uid()).
   ============================================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const HERE = __dirname;
const SCHEMA = fs.readFileSync(path.join(HERE, '..', 'schema.sql'), 'utf8');
const MOCK = fs.readFileSync(path.join(HERE, 'mock_supabase.sql'), 'utf8');

let passed = 0, failed = 0;
const failures = [];

/* ------------------------------ klaster sementara ------------------------------ */
let conn = null;     // {args:[...]}
let cluster = null;  // {dir, bin, asUser}

function findBin() {
    try { const b = execFileSync('pg_config', ['--bindir']).toString().trim(); if (b && fs.existsSync(path.join(b, 'initdb'))) return b; } catch (e) { /* lanjut */ }
    const base = '/usr/lib/postgresql';
    if (fs.existsSync(base)) {
        const vs = fs.readdirSync(base).sort((a, b) => Number(b) - Number(a));
        for (const v of vs) { const b = path.join(base, v, 'bin'); if (fs.existsSync(path.join(b, 'initdb'))) return b; }
    }
    return null;
}
function sh(cmd, args, asUser) {
    const r = (asUser && process.getuid && process.getuid() === 0)
        ? spawnSync('runuser', ['-u', asUser, '--', cmd, ...args], { encoding: 'utf8' })
        : spawnSync(cmd, args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(cmd + ' gagal: ' + (r.stderr || r.stdout));
    return r.stdout;
}
function startCluster() {
    if (process.env.TEST_DATABASE_URL) { conn = { args: ['-d', process.env.TEST_DATABASE_URL] }; return; }
    const bin = findBin();
    if (!bin) throw new Error('PostgreSQL lokal tidak ditemukan. Pasang postgresql atau set TEST_DATABASE_URL.');
    const root = process.getuid && process.getuid() === 0;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slpg-'));
    if (root) execFileSync('chown', ['postgres:postgres', dir]);
    const asUser = root ? 'postgres' : null;
    const data = path.join(dir, 'data');
    sh(path.join(bin, 'initdb'), ['-D', data, '--auth=trust', '-U', 'postgres', '-E', 'UTF8'], asUser);
    const port = '54329';
    sh(path.join(bin, 'pg_ctl'), ['-D', data, '-w', '-l', path.join(dir, 'log.txt'),
        '-o', `-c listen_addresses='' -c unix_socket_directories='${dir}' -p ${port}`, 'start'], asUser);
    cluster = { dir, bin, data, asUser };
    conn = { args: ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres'] };
}
function stopCluster() {
    if (!cluster) return;
    try { sh(path.join(cluster.bin, 'pg_ctl'), ['-D', cluster.data, '-m', 'immediate', 'stop'], cluster.asUser); } catch (e) { /* abaikan */ }
    try { fs.rmSync(cluster.dir, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
}

/* ------------------------------ eksekusi SQL ------------------------------ */
/* opts: {uid, role}  -> jalan sebagai role itu (default 'authenticated' bila uid ada); tanpa opts = superuser.
         commit:true  -> transaksi di-commit (data tetap). Bawaan: ROLLBACK, jadi tiap tes terisolasi. */
function run(sql, opts) {
    opts = opts || {};
    let pre = 'begin;\n';
    if (opts.uid || opts.role) {
        pre += `set local role ${opts.role || 'authenticated'};\n`;
        if (opts.uid) pre += `set local request.jwt.claim.sub = '${opts.uid}';\n`;
    }
    const full = pre + sql + '\n' + (opts.commit ? 'commit;' : 'rollback;') + '\n';
    const r = spawnSync('psql', [...conn.args, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: full, encoding: 'utf8' });
    return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function out(sql, opts) {
    const r = run(sql, opts);
    if (!r.ok) throw new Error('SQL gagal: ' + r.err.split('\n')[0]);
    const lines = r.out.split('\n').filter(Boolean);
    return lines.length ? lines[lines.length - 1] : '';
}
function fails(sql, opts, needle) {
    const r = run(sql, opts);
    if (r.ok) throw new Error('seharusnya GAGAL tetapi berhasil: ' + sql.replace(/\s+/g, ' ').slice(0, 90));
    /* trigger BEFORE berjalan sebelum WITH CHECK RLS, jadi penolakan bisa berupa GUARD_* atau 'row-level security' */
    const okNeedle = needle === 'row-level security' ? /row-level security|GUARD_/.test(r.err) : r.err.includes(needle);
    if (needle && !okNeedle) throw new Error('galat tidak sesuai (' + needle + '): ' + r.err.split('\n')[0]);
}
function eq(a, b, msg) { if (String(a) !== String(b)) throw new Error((msg || 'nilai') + ': dapat "' + a + '", harapan "' + b + '"'); }
function t(name, fn) {
    try { fn(); passed++; console.log('  ok   ' + name); }
    catch (e) { failed++; failures.push(name); console.log('  FAIL ' + name + '\n         ' + e.message); }
}

/* ------------------------------ data uji ------------------------------ */
const U = {
    ADM: '00000000-0000-4000-8000-000000000001',
    TA: '00000000-0000-4000-8000-000000000002',
    TB: '00000000-0000-4000-8000-000000000003',
    SA1: '00000000-0000-4000-8000-000000000004',
    SA2: '00000000-0000-4000-8000-000000000005',
    SB1: '00000000-0000-4000-8000-000000000006',
    SPA: '00000000-0000-4000-8000-000000000007'   // siswa sekolah A berstatus PENDING
};
function trusted(id, username, role, status, org, name) {
    const am = JSON.stringify({ trusted: true, role, status, org_id: org, name });
    return `insert into auth.users (id, email, raw_app_meta_data) values ('${id}', '${username}@starterlab.app', '${am}');`;
}
function setupData() {
    const sql = `
insert into public.entities (kind, id, data) values
 ('organizations','ORG_A','{"id":"ORG_A","name":"SMK A","type":"SCHOOL","status":"ACTIVE"}'),
 ('organizations','ORG_B','{"id":"ORG_B","name":"SMK B","type":"SCHOOL","status":"ACTIVE"}'),
 ('organizations','ORG_C','{"id":"ORG_C","name":"SMK C","type":"SCHOOL","status":"PENDING"}');
${trusted(U.TA, 'teacher.a', 'INSTRUCTOR', 'ACTIVE', 'ORG_A', 'Guru A')}
${trusted(U.TB, 'teacher.b', 'INSTRUCTOR', 'ACTIVE', 'ORG_B', 'Guru B')}
${trusted(U.SA1, 'siswa.a1', 'STUDENT', 'ACTIVE', 'ORG_A', 'Siswa A1')}
${trusted(U.SA2, 'siswa.a2', 'STUDENT', 'ACTIVE', 'ORG_A', 'Siswa A2')}
${trusted(U.SB1, 'siswa.b1', 'STUDENT', 'ACTIVE', 'ORG_B', 'Siswa B1')}
${trusted(U.SPA, 'siswa.pa', 'STUDENT', 'PENDING', 'ORG_A', 'Siswa PA')}
insert into auth.users (id, email) values ('${U.ADM}', 'admin@starterlab.app');   -- jalur tanpa jenis: PENDING dulu
select public.bootstrap_superadmin('admin');
insert into public.entities (kind, id, org_id, owner_id, data) values
 ('classes','CLASS_A1','ORG_A',null,'{"id":"CLASS_A1","organizationId":"ORG_A","name":"XI A","status":"ACTIVE","joinCode":"ABC123","joinEnabled":true,"joinExpiresAt":null,"studentIds":[],"instructorIds":["${U.TA}"]}'),
 ('classes','CLASS_B1','ORG_B',null,'{"id":"CLASS_B1","organizationId":"ORG_B","name":"XI B","status":"ACTIVE","joinCode":"BBB222","joinEnabled":true,"studentIds":[],"instructorIds":[]}'),
 ('assignments','ASG_A1','ORG_A',null,'{"id":"ASG_A1","classId":"CLASS_A1","organizationId":"ORG_A","status":"PUBLISHED"}'),
 ('assignments','ASG_A2','ORG_A',null,'{"id":"ASG_A2","classId":"CLASS_A1","organizationId":"ORG_A","status":"DRAFT"}'),
 ('submissions','SUB_A1','ORG_A','${U.SA1}','{"id":"SUB_A1","studentId":"${U.SA1}","classId":"CLASS_A1"}'),
 ('submissions','SUB_A2','ORG_A','${U.SA2}','{"id":"SUB_A2","studentId":"${U.SA2}","classId":"CLASS_A1"}'),
 ('submissions','SUB_B1','ORG_B','${U.SB1}','{"id":"SUB_B1","studentId":"${U.SB1}","classId":"CLASS_B1"}');
insert into public.user_data (user_id, key, value) values
 ('${U.SA1}','starterHub_v1','{"a":1}'), ('${U.SA2}','starterHub_v1','{"a":2}'), ('${U.SB1}','starterHub_v1','{"b":1}');
`;
    const r = run(sql, { commit: true });
    if (!r.ok) throw new Error('setup data gagal: ' + r.err);
}

const SA1 = { uid: U.SA1 }, SA2 = { uid: U.SA2 }, SB1 = { uid: U.SB1 }, SPA = { uid: U.SPA };
const TA = { uid: U.TA }, TB = { uid: U.TB }, ADM = { uid: U.ADM };
/* satu-satunya cara memeriksa efek samping: kembali jadi superuser di dalam transaksi yang sama */
const SU = 'reset role;\n';

function main() {
    startCluster();
    const r1 = run(MOCK, { commit: true }); if (!r1.ok) throw new Error('mock gagal: ' + r1.err);
    const r2 = run(SCHEMA, { commit: true }); if (!r2.ok) throw new Error('schema.sql gagal: ' + r2.err);

    console.log('\n[0] Idempotensi & setup');
    t('schema.sql dapat dijalankan ulang tanpa galat', () => { const r = run(SCHEMA, { commit: true }); if (!r.ok) throw new Error(r.err); });
    setupData();
    t('trigger pendaftaran membuat profiles + entities untuk akun tepercaya', () => {
        eq(out(`select count(*) from public.profiles;`), 7);
        eq(out(`select count(*) from public.entities where kind='users';`), 7);
    });
    t('bootstrap_superadmin menjadikan akun tanpa jenis sebagai ADMIN aktif', () => {
        eq(out(`select role||'/'||status from public.profiles where id='${U.ADM}';`), 'ADMIN/ACTIVE');
    });

    console.log('\n[1] Anon');
    t('anon tidak bisa SELECT entities', () => fails(`select count(*) from public.entities;`, { role: 'anon' }, 'permission denied'));
    t('anon tidak bisa SELECT profiles / user_data', () => {
        fails(`select count(*) from public.profiles;`, { role: 'anon' }, 'permission denied');
        fails(`select count(*) from public.user_data;`, { role: 'anon' }, 'permission denied');
    });
    t('anon tidak bisa INSERT entities', () => fails(`insert into public.entities (kind,id,data) values ('classes','X','{"id":"X"}');`, { role: 'anon' }, 'permission denied'));
    t('public_schools() hanya memuat sekolah ACTIVE', () => {
        eq(out(`select string_agg(name, ',' order by name) from public.public_schools();`, { role: 'anon' }), 'SMK A,SMK B');
    });
    t('anon tidak bisa memanggil bootstrap_superadmin / join_class', () => {
        fails(`select public.bootstrap_superadmin('admin');`, { role: 'anon' }, 'permission denied');
        fails(`select public.join_class('ABC123');`, { role: 'anon' }, 'permission denied');
    });
    t('authenticated tidak bisa memanggil bootstrap_superadmin', () => fails(`select public.bootstrap_superadmin('siswa.a1');`, SA1, 'permission denied'));
    t('app_config tidak terbaca klien', () => fails(`select * from public.app_config;`, SA1, 'permission denied'));

    console.log('\n[2] Siswa: batas baca');
    t('siswa hanya melihat kelas sekolahnya', () => eq(out(`select string_agg(id, ',' order by id) from public.entities where kind='classes';`, SA1), 'CLASS_A1'));
    t('siswa hanya melihat pengumpulan miliknya', () => eq(out(`select string_agg(id, ',' order by id) from public.entities where kind='submissions';`, SA1), 'SUB_A1'));
    t('siswa tidak melihat tugas DRAFT', () => eq(out(`select string_agg(id, ',' order by id) from public.entities where kind='assignments';`, SA1), 'ASG_A1'));
    t('siswa melihat dirinya + guru se-sekolah, bukan siswa lain', () => {
        eq(out(`select string_agg(id, ',' order by id) from public.entities where kind='users';`, SA1), [U.TA, U.SA1].sort().join(','));
    });
    t('siswa melihat sekolah ACTIVE saja', () => eq(out(`select string_agg(id, ',' order by id) from public.entities where kind='organizations';`, SA1), 'ORG_A,ORG_B'));
    t('siswa tidak bisa membaca user_data siswa lain', () => {
        eq(out(`select count(*) from public.user_data where user_id='${U.SA2}';`, SA1), 0);
        eq(out(`select count(*) from public.user_data;`, SA1), 1);
    });
    t('siswa hanya melihat profilnya sendiri', () => eq(out(`select count(*) from public.profiles;`, SA1), 1));
    t('siswa tidak bisa menulis profiles', () => fails(`update public.profiles set role='ADMIN' where id='${U.SA1}';`, SA1, 'permission denied'));

    console.log('\n[3] Siswa: tidak bisa menaikkan hak');
    const upd = (uid, patch) => `update public.entities set data = data || '${patch}' where kind='users' and id='${uid}';`;
    t('ubah role -> ditolak', () => fails(upd(U.SA1, '{"role":"ADMIN"}'), SA1, 'GUARD_IDENTITAS_BERUBAH'));
    t('ubah username -> ditolak', () => fails(upd(U.SA1, '{"username":"siswa.a2"}'), SA1, 'GUARD_IDENTITAS_BERUBAH'));
    t('ubah status -> ditolak', () => fails(upd(U.SA1, '{"status":"INACTIVE"}'), SA1, 'GUARD_STATUS_BERUBAH'));
    t('pindah sekolah -> ditolak', () => fails(upd(U.SA1, '{"organizationId":"ORG_B"}'), SA1, 'GUARD_ORG_BERUBAH'));
    t('ubah classIds langsung -> ditolak', () => fails(upd(U.SA1, '{"classIds":["CLASS_A1"]}'), SA1, 'GUARD_KELAS_BERUBAH'));
    t('tambah orgAdmin -> ditolak', () => fails(upd(U.SA1, '{"orgAdmin":true}'), SA1, 'GUARD_ORGADMIN_BERUBAH'));
    t('ubah nama sendiri -> boleh & tersinkron ke profiles', () => {
        eq(out(`with u as (${upd(U.SA1, '{"name":"Nama Baru"}').replace(';', '')} returning 1) select count(*) from u;`, SA1), 1);
        eq(out(`${upd(U.SA1, '{"name":"Nama Baru"}')} ${SU} select name from public.profiles where id='${U.SA1}';`, SA1), 'Nama Baru');
    });
    t('menulis baris users siswa lain -> 0 baris', () => eq(out(`with u as (${upd(U.SA2, '{"name":"x"}').replace(';', '')} returning 1) select count(*) from u;`, SA1), 0));
    t('siswa PENDING tidak bisa mengaktifkan diri (0 baris)', () => {
        eq(out(`with u as (${upd(U.SPA, '{"status":"ACTIVE"}').replace(';', '')} returning 1) select count(*) from u;`, SPA), 0);
        eq(out(`${SU} select status from public.profiles where id='${U.SPA}';`, SPA), 'PENDING');
    });
    t('siswa PENDING hanya melihat dirinya & sekolahnya', () => {
        eq(out(`select string_agg(kind||':'||id, ',' order by kind,id) from public.entities;`, SPA), `organizations:ORG_A,users:${U.SPA}`);
    });
    t('siswa tidak bisa INSERT users / organizations / classes', () => {
        fails(`insert into public.entities (kind,id,org_id,owner_id,data) values ('users','${U.SA1}x','ORG_A',null,'{"id":"${U.SA1}x","role":"ADMIN"}');`, SA1, 'row-level security');
        fails(`insert into public.entities (kind,id,data) values ('organizations','ORG_Z','{"id":"ORG_Z","status":"ACTIVE","name":"Z"}');`, SA1, 'row-level security');
        fails(`insert into public.entities (kind,id,org_id,data) values ('classes','CLASS_Z','ORG_A','{"id":"CLASS_Z","organizationId":"ORG_A"}');`, SA1, 'row-level security');
    });
    t('siswa tidak bisa mengubah kelas / sekolah / tugas (0 baris)', () => {
        eq(out(`with u as (update public.entities set data = data || '{"name":"x"}' where kind in ('classes','organizations','assignments') returning 1) select count(*) from u;`, SA1), 0);
    });

    console.log('\n[4] Siswa: pengumpulan');
    const subIns = (id, org, owner, studentId) => `insert into public.entities (kind,id,org_id,owner_id,data) values ('submissions','${id}','${org}','${owner}','{"id":"${id}","studentId":"${studentId}"}');`;
    t('siswa menulis pengumpulan milik sendiri -> boleh', () => out(subIns('SUB_NEW', 'ORG_A', U.SA1, U.SA1), SA1));
    t('siswa menulis atas nama siswa lain -> ditolak', () => fails(subIns('SUB_X', 'ORG_A', U.SA2, U.SA2), SA1, 'row-level security'));
    t('siswa menulis ke sekolah lain -> ditolak', () => fails(subIns('SUB_X', 'ORG_B', U.SA1, U.SA1), SA1, 'row-level security'));
    t('studentId tidak cocok dengan pemilik -> ditolak', () => fails(subIns('SUB_X', 'ORG_A', U.SA1, U.SA2), SA1, 'GUARD_SISWA_ID'));
    t('siswa tidak bisa mengubah pengumpulan siswa lain (0 baris)', () => {
        eq(out(`with u as (update public.entities set data = data || '{"score":100}' where id='SUB_A2' returning 1) select count(*) from u;`, SA1), 0);
    });
    t('siswa tidak bisa memindahkan kepemilikan', () => fails(`update public.entities set owner_id='${U.SA2}' where id='SUB_A1';`, SA1));

    console.log('\n[5] Guru');
    t('guru tidak melihat data sekolah lain', () => {
        eq(out(`select count(*) from public.entities where org_id='ORG_B' and kind <> 'organizations';`, TA), 0);
        eq(out(`select count(*) from public.entities where kind='users' and org_id='ORG_B';`, TA), 0);
    });
    t('guru melihat pengguna sekolahnya', () => eq(out(`select count(*) from public.entities where kind='users';`, TA), 4)); // TA, SA1, SA2, SPA
    t('guru tidak bisa mengubah kelas sekolah lain (0 baris)', () => {
        eq(out(`with u as (update public.entities set data = data || '{"name":"x"}' where id='CLASS_B1' returning 1) select count(*) from u;`, TA), 0);
    });
    t('guru tidak bisa INSERT kelas ke sekolah lain', () => {
        fails(`insert into public.entities (kind,id,org_id,data) values ('classes','CLASS_Z','ORG_B','{"id":"CLASS_Z","organizationId":"ORG_B"}');`, TA, 'row-level security');
    });
    t('guru INSERT kelas di sekolahnya -> boleh', () => {
        out(`insert into public.entities (kind,id,org_id,data) values ('classes','CLASS_A2','ORG_A','{"id":"CLASS_A2","organizationId":"ORG_A","name":"XI A2"}');`, TA);
    });
    t('org_id tidak cocok dengan organizationId -> ditolak', () => {
        fails(`insert into public.entities (kind,id,org_id,data) values ('classes','CLASS_Z','ORG_A','{"id":"CLASS_Z","organizationId":"ORG_B"}');`, TA, 'GUARD_ORG_TIDAK_COCOK');
    });
    t('guru tidak bisa memindahkan kelas ke sekolah lain', () => {
        fails(`update public.entities set org_id='ORG_B', data = data || '{"organizationId":"ORG_B"}' where id='CLASS_A1';`, TA);
    });
    t('guru TIDAK bisa INSERT baris users', () => {
        fails(`insert into public.entities (kind,id,org_id,owner_id,data) values ('users','${U.TA}z','ORG_A',null,'{"id":"${U.TA}z","role":"INSTRUCTOR"}');`, TA, 'row-level security');
    });
    t('guru TIDAK bisa INSERT organizations / mengubah organizations', () => {
        fails(`insert into public.entities (kind,id,data) values ('organizations','ORG_Z','{"id":"ORG_Z","name":"Z","status":"ACTIVE"}');`, TA, 'row-level security');
        eq(out(`with u as (update public.entities set data = data || '{"status":"REJECTED"}' where id='ORG_A' returning 1) select count(*) from u;`, TA), 0);
    });
    t('guru mengubah nama siswa se-sekolah -> boleh & tersinkron', () => {
        eq(out(`${upd(U.SA1, '{"name":"Dari Guru"}')} ${SU} select name from public.profiles where id='${U.SA1}';`, TA), 'Dari Guru');
    });
    t('guru menyetujui siswa PENDING -> profiles ACTIVE', () => {
        eq(out(`${upd(U.SPA, '{"status":"ACTIVE","approvedAt":1}')} ${SU} select status from public.profiles where id='${U.SPA}';`, TA), 'ACTIVE');
    });
    t('guru menonaktifkan lalu mengaktifkan siswa -> boleh', () => {
        eq(out(`${upd(U.SA2, '{"status":"INACTIVE"}')} ${SU} select status from public.profiles where id='${U.SA2}';`, TA), 'INACTIVE');
    });
    t('guru menurunkan ACTIVE -> PENDING -> ditolak', () => fails(upd(U.SA1, '{"status":"PENDING"}'), TA, 'GUARD_TRANSISI_STATUS'));
    t('guru tidak bisa mengubah role/username/sekolah siswa', () => {
        fails(upd(U.SA1, '{"role":"INSTRUCTOR"}'), TA, 'GUARD_IDENTITAS_BERUBAH');
        fails(upd(U.SA1, '{"username":"hack"}'), TA, 'GUARD_IDENTITAS_BERUBAH');
        fails(upd(U.SA1, '{"organizationId":"ORG_B"}'), TA, 'GUARD_ORG_BERUBAH');
    });
    t('guru tidak bisa memberi orgAdmin ke siswa', () => fails(upd(U.SA1, '{"orgAdmin":true}'), TA, 'GUARD_ORGADMIN_BERUBAH'));
    t('guru tidak bisa mengubah siswa sekolah lain / guru lain (0 baris)', () => {
        eq(out(`with u as (${upd(U.SB1, '{"name":"x"}').replace(';', '')} returning 1) select count(*) from u;`, TA), 0);
        eq(out(`with u as (${upd(U.TB, '{"name":"x"}').replace(';', '')} returning 1) select count(*) from u;`, TA), 0);
    });
    t('guru tidak bisa mengubah status dirinya sendiri', () => fails(upd(U.TA, '{"status":"INACTIVE"}'), TA, 'GUARD_STATUS_BERUBAH'));
    t('guru tidak bisa menetapkan pemilik dari sekolah lain', () => fails(subIns('SUB_X', 'ORG_A', U.SB1, U.SB1), TA, 'GUARD_OWNER_ORG'));
    t('guru membaca user_data siswa sekolahnya saja', () => {
        eq(out(`select count(*) from public.user_data;`, TA), 2);
        eq(out(`select count(*) from public.user_data where user_id='${U.SB1}';`, TA), 0);
        eq(out(`select count(*) from public.user_data;`, TB), 1);
    });
    t('guru tidak bisa menulis user_data siswa', () => fails(`insert into public.user_data (user_id,key,value) values ('${U.SA1}','k','v');`, TA, 'row-level security'));
    t('guru tidak bisa DELETE entities', () => eq(out(`with d as (delete from public.entities where id='CLASS_A1' returning 1) select count(*) from d;`, TA), 0));

    console.log('\n[6] join_class');
    const joined = `select public.join_class('abc123') ->> 'name';`;
    t('join_class: kode benar menambah siswa & classIds', () => {
        eq(out(joined, SA1), 'XI A');
        eq(out(`select public.join_class('abc123'); ${SU} select data->'studentIds' @> to_jsonb('${U.SA1}'::text) from public.entities where id='CLASS_A1';`, SA1), 't');
        eq(out(`select public.join_class('abc123'); ${SU} select data->'classIds' from public.entities where kind='users' and id='${U.SA1}';`, SA1), '["CLASS_A1"]');
    });
    t('join_class: idempoten (tanpa duplikat)', () => {
        eq(out(`select public.join_class('ABC123'); select public.join_class('ABC123'); ${SU} select jsonb_array_length(data->'studentIds') from public.entities where id='CLASS_A1';`, SA1), 1);
    });
    t('join_class: kode salah -> KODE_TIDAK_VALID', () => fails(`select public.join_class('NOPE99');`, SA1, 'KODE_TIDAK_VALID'));
    t('join_class: kode kelas sekolah lain -> KODE_TIDAK_VALID', () => fails(`select public.join_class('ABC123');`, SB1, 'KODE_TIDAK_VALID'));
    t('join_class: kode kedaluwarsa -> ditolak', () => {
        fails(`${SU} update public.entities set data = data || '{"joinExpiresAt":1}' where id='CLASS_A1'; set local role authenticated; select public.join_class('ABC123');`, SA1, 'KODE_TIDAK_VALID');
    });
    t('join_class: pendaftaran dimatikan -> ditolak', () => {
        fails(`${SU} update public.entities set data = data || '{"joinEnabled":false}' where id='CLASS_A1'; set local role authenticated; select public.join_class('ABC123');`, SA1, 'KODE_TIDAK_VALID');
    });
    t('join_class: guru / siswa PENDING ditolak', () => {
        fails(`select public.join_class('ABC123');`, TA, 'TIDAK_BERWENANG');
        fails(`select public.join_class('ABC123');`, SPA, 'TIDAK_BERWENANG');
    });
    t('join_class tidak membuka celah: classIds tetap tak bisa diubah langsung sesudahnya', () => {
        fails(`select public.join_class('ABC123'); ${upd(U.SA1, '{"classIds":["CLASS_A1","CLASS_B1"]}')}`, SA1, 'GUARD_KELAS_BERUBAH');
    });

    console.log('\n[7] Pendaftaran publik (trigger)');
    const signup = (email, meta) => `insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), '${email}', '${JSON.stringify(meta).replace(/'/g, "''")}');`;
    t('siswa publik -> profiles STUDENT/PENDING + entities PENDING registeredBy PUBLIC', () => {
        const s = signup('baru.siswa@starterlab.app', { kind: 'student', org_id: 'ORG_A', name: 'Siswa Baru', nis: '12345' });
        eq(out(`${s} select role||'/'||status||'/'||org_id from public.profiles where username='baru.siswa';`), 'STUDENT/PENDING/ORG_A');
        eq(out(`${s} select data->>'status'||'/'||(data->>'registeredBy')||'/'||(data->>'nis')||'/'||(data->>'organizationId') from public.entities e join public.profiles p on p.id::text=e.id where p.username='baru.siswa';`), 'PENDING/PUBLIC/12345/ORG_A');
    });
    t('siswa publik ke sekolah PENDING / tak ada -> SEKOLAH_TIDAK_AKTIF', () => {
        fails(signup('x.siswa1@starterlab.app', { kind: 'student', org_id: 'ORG_C', name: 'X' }), null, 'SEKOLAH_TIDAK_AKTIF');
        fails(signup('x.siswa2@starterlab.app', { kind: 'student', org_id: 'ORG_ZZZ', name: 'X' }), null, 'SEKOLAH_TIDAK_AKTIF');
        fails(signup('x.siswa3@starterlab.app', { kind: 'student', name: 'X' }), null, 'SEKOLAH_TIDAK_AKTIF');
    });
    t('metadata palsu (role ADMIN / trusted) diabaikan', () => {
        const s = signup('jahat@starterlab.app', { kind: 'student', org_id: 'ORG_A', name: 'Jahat', role: 'ADMIN', status: 'ACTIVE', trusted: true, app_role: 'ADMIN' });
        eq(out(`${s} select role||'/'||status from public.profiles where username='jahat';`), 'STUDENT/PENDING');
    });
    t('guru publik -> INSTRUCTOR/PENDING (menunggu Superadmin)', () => {
        eq(out(`${signup('guru.baru@starterlab.app', { kind: 'instructor', org_id: 'ORG_A', name: 'Guru Baru' })} select role||'/'||status from public.profiles where username='guru.baru';`), 'INSTRUCTOR/PENDING');
    });
    t('guru PENDING tidak bisa membaca/menulis apa pun selain dirinya', () => {
        const id = '00000000-0000-4000-8000-0000000000aa';
        const s = `insert into auth.users (id,email,raw_user_meta_data) values ('${id}','guru.pending@starterlab.app','{"kind":"instructor","org_id":"ORG_A","name":"GP"}');`;
        eq(out(`${s} set local role authenticated; set local request.jwt.claim.sub='${id}'; select count(*) from public.entities where kind not in ('users','organizations');`), 0);
        eq(out(`${s} set local role authenticated; set local request.jwt.claim.sub='${id}'; select count(*) from public.entities;`), 2);
        fails(`${s} set local role authenticated; set local request.jwt.claim.sub='${id}'; insert into public.entities (kind,id,org_id,data) values ('classes','CZ','ORG_A','{"id":"CZ","organizationId":"ORG_A"}');`, null, 'row-level security');
    });
    t('pendaftaran sekolah -> organisasi PENDING + admin INSTRUCTOR PENDING orgAdmin', () => {
        const s = signup('admin.baru@starterlab.app', { kind: 'school', school_name: 'SMK Baru', school_address: 'Jl. Baru', name: 'Admin Baru' });
        eq(out(`${s} select (data->>'status')||'/'||(data->>'name')||'/'||(data->'pendingAdmin'->>'username') from public.entities where kind='organizations' and data->>'name'='SMK Baru';`), 'PENDING/SMK Baru/admin.baru');
        eq(out(`${s} select p.role||'/'||p.status||'/'||(e.data->>'orgAdmin')||'/'||(p.org_id = o.id)::text from public.profiles p join public.entities e on e.kind='users' and e.id=p.id::text join public.entities o on o.kind='organizations' and o.data->>'name'='SMK Baru' where p.username='admin.baru';`), 'INSTRUCTOR/PENDING/true/true');
        eq(out(`${s} select org_id = id from public.entities where kind='organizations' and data->>'name'='SMK Baru';`), 't');
    });
    t('sekolah baru tidak muncul di public_schools sampai disetujui', () => {
        eq(out(`${signup('admin.baru@starterlab.app', { kind: 'school', school_name: 'SMK Baru', name: 'Admin Baru' })} select count(*) from public.public_schools() where name='SMK Baru';`), 0);
    });
    t('nama sekolah ganda (beda huruf) -> NAMA_SEKOLAH_SUDAH_ADA', () => {
        fails(signup('admin.dua@starterlab.app', { kind: 'school', school_name: 'smk a', name: 'Dua' }), null, 'NAMA_SEKOLAH_SUDAH_ADA');
    });
    t('username tidak valid / domain salah / duplikat ditolak', () => {
        fails(signup('ab@starterlab.app', { kind: 'student', org_id: 'ORG_A', name: 'X' }), null, 'USERNAME_TIDAK_VALID');
        fails(signup('bad name@starterlab.app', { kind: 'student', org_id: 'ORG_A', name: 'X' }), null, 'USERNAME_TIDAK_VALID');
        fails(signup('orang@gmail.com', { kind: 'student', org_id: 'ORG_A', name: 'X' }), null, 'EMAIL_DOMAIN_SALAH');
        fails(signup('Teacher.A@starterlab.app', { kind: 'student', org_id: 'ORG_A', name: 'X' }), null, 'USERNAME_DIPAKAI');
    });
    t('nama dibersihkan dari < > dan dipotong 100 karakter', () => {
        const s = signup('xss.user@starterlab.app', { kind: 'student', org_id: 'ORG_A', name: '<script>alert(1)</script>' + 'a'.repeat(200) });
        eq(out(`${s} select (name !~ '[<>]')::text || '/' || length(name) from public.profiles where username='xss.user';`), 'true/100');
    });
    t('register_precheck memberi kode galat yang jelas (bisa dipanggil anon)', () => {
        const pc = (a) => out(`select coalesce(public.register_precheck(${a}), 'OK');`, { role: 'anon' });
        eq(pc(`'student','siswa.a1',null,'ORG_A'`), 'USERNAME_DIPAKAI');
        eq(pc(`'student','ab',null,'ORG_A'`), 'USERNAME_TIDAK_VALID');
        eq(pc(`'student','orang.baru',null,'ORG_C'`), 'SEKOLAH_TIDAK_AKTIF');
        eq(pc(`'school','admin.x','SMK a',null`), 'NAMA_SEKOLAH_SUDAH_ADA');
        eq(pc(`'school','admin.x','SMK Z',null`), 'OK');
        eq(pc(`'student','orang.baru',null,'ORG_A'`), 'OK');
    });

    console.log('\n[8] user_data');
    t('siswa menulis & memperbarui blob miliknya', () => {
        eq(out(`insert into public.user_data (user_id,key,value) values ('${U.SA1}','p5Profile','{"x":1}') on conflict (user_id,key) do update set value=excluded.value; select count(*) from public.user_data;`, SA1), 2);
    });
    t('siswa tidak bisa menulis blob orang lain', () => fails(`insert into public.user_data (user_id,key,value) values ('${U.SA2}','k','v');`, SA1, 'row-level security'));
    t('kunci tidak valid ditolak', () => fails(`insert into public.user_data (user_id,key,value) values ('${U.SA1}','bad key!','v');`, SA1, 'check constraint'));
    t('siswa PENDING tidak bisa menulis user_data', () => fails(`insert into public.user_data (user_id,key,value) values ('${U.SPA}','k','v');`, SPA, 'row-level security'));
    t('updated_at diperbarui otomatis', () => {
        eq(out(`update public.user_data set value='{"a":9}' where user_id='${U.SA1}' and key='starterHub_v1'; select (updated_at >= now() - interval '1 minute')::text from public.user_data where user_id='${U.SA1}' and key='starterHub_v1';`, SA1), 'true');
    });

    console.log('\n[9] Superadmin');
    t('admin melihat semua entities & user_data', () => {
        const total = out(`select count(*) from public.entities;`);
        eq(out(`select count(*) from public.entities;`, ADM), total);
        eq(out(`select count(*) from public.user_data;`, ADM), 3);
        eq(out(`select count(*) from public.profiles;`, ADM), 7);
    });
    t('admin menonaktifkan akun -> profiles INACTIVE & akses hilang', () => {
        eq(out(`${upd(U.SA2, '{"status":"INACTIVE"}')} ${SU} select status from public.profiles where id='${U.SA2}';`, ADM), 'INACTIVE');
        const dis = `${SU} update public.profiles set status='INACTIVE' where id='${U.SA2}'; set local role authenticated;`;
        eq(out(`${dis} select count(*) from public.entities where kind='classes';`, SA2), 0);
        eq(out(`${dis} select count(*) from public.entities where kind='users';`, SA2), 1);
    });
    t('admin mengaktifkan sekolah & guru PENDING', () => {
        const id = '00000000-0000-4000-8000-0000000000bb';
        const s = `insert into auth.users (id,email,raw_user_meta_data) values ('${id}','admin.sek@starterlab.app','{"kind":"school","school_name":"SMK Nol","name":"AS"}');`;
        eq(out(`${SU} ${s} set local role authenticated; set local request.jwt.claim.sub='${U.ADM}';
            update public.entities set data = data || '{"status":"ACTIVE"}' where kind='organizations' and data->>'name'='SMK Nol';
            update public.entities set data = data || '{"status":"ACTIVE"}' where kind='users' and id='${id}';
            ${SU} select p.status from public.profiles p where p.id='${id}';`, ADM), 'ACTIVE');
    });
    t('admin boleh DELETE; guru/siswa tidak', () => {
        eq(out(`with d as (delete from public.entities where id='CLASS_B1' returning 1) select count(*) from d;`, ADM), 1);
    });
    t('profiles: admin melihat semua, guru hanya dirinya', () => {
        eq(out(`select count(*) from public.profiles;`, TA), 1);
    });

    console.log('\n[10] Pemaksaan kolom turunan');
    t('org_id baris users dipaksa mengikuti data.organizationId', () => {
        eq(out(`select org_id from public.entities where kind='users' and id='${U.SA1}';`), 'ORG_A');
    });
    t('org_id baris organizations dipaksa = id', () => {
        eq(out(`insert into public.entities (kind,id,org_id,data) values ('organizations','ORG_Q','ORG_Z','{"id":"ORG_Q","name":"Q","status":"PENDING"}'); select org_id from public.entities where id='ORG_Q';`), 'ORG_Q');
    });
    t('data.id harus sama dengan kolom id', () => fails(`insert into public.entities (kind,id,org_id,data) values ('classes','C1','ORG_A','{"id":"C2","organizationId":"ORG_A"}');`, TA, 'GUARD_ID_TIDAK_COCOK'));
    t('updated_at & updated_by diisi trigger', () => {
        eq(out(`update public.entities set data = data || '{"name":"ganti"}' where id='CLASS_A1'; select (updated_by = '${U.TA}')::text from public.entities where id='CLASS_A1';`, TA), 'true');
    });
}

try { main(); }
catch (e) { failed++; failures.push('(setup) ' + e.message); console.log('\nFATAL: ' + e.message); }
finally { stopCluster(); }

console.log(`\n${passed} lulus, ${failed} gagal`);
if (failed) { console.log('Gagal: ' + failures.join(' | ')); process.exit(1); }
