-- =============================================================================
-- StarterLab — skema Supabase (jalankan SEKALI di SQL Editor)
-- =============================================================================
-- Prinsip keamanan:
--   * Semua tabel TERTUTUP: RLS aktif tanpa policy + hak akses dicabut dari anon/authenticated.
--     Browser TIDAK bisa membaca/menulis tabel langsung, hanya memanggil fungsi sl_* di bawah.
--   * Sandi disimpan sebagai bcrypt (pgcrypto) di server. Hash FNV lama di browser tidak dipakai.
--   * Otorisasi per peran (Superadmin / Guru / Siswa) ditegakkan di fungsi sl_check_write
--     dan sl_visible, bukan di antarmuka.
--   * Token sesi acak 256-bit; yang disimpan hanya hash SHA-256-nya.
-- Aman dijalankan ulang (idempotent): tidak menghapus data yang sudah ada.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. TABEL
-- ---------------------------------------------------------------------------
create table if not exists public.sl_docs (
  kind       text not null,
  id         text not null,
  org_id     text,
  owner_id   text,
  data       jsonb not null,
  deleted    boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (kind, id),
  constraint sl_docs_kind_chk check (kind in
    ('users','organizations','classes','assignments','submissions','courses','contents',
     'caseRefs','rubrics','achievements','assessments'))
);
create index if not exists sl_docs_updated_idx on public.sl_docs (updated_at);
create index if not exists sl_docs_org_idx     on public.sl_docs (org_id, kind);
create index if not exists sl_docs_owner_idx   on public.sl_docs (owner_id, kind);
-- username unik tanpa membedakan huruf besar/kecil (di antara akun yang belum dihapus)
create unique index if not exists sl_docs_username_uq
  on public.sl_docs ((lower(data->>'username'))) where kind = 'users' and not deleted;

create table if not exists public.sl_creds (
  user_id      text primary key,
  username_lc  text not null unique,
  pw_hash      text not null,
  must_change  boolean not null default false,
  failed_count int not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);

-- sandi admin sekolah yang mendaftar tetapi sekolahnya belum disetujui Superadmin
create table if not exists public.sl_pending_creds (
  username_lc text primary key,
  org_id      text,
  pw_hash     text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.sl_sessions (
  token_hash text primary key,
  user_id    text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sl_sessions_user_idx on public.sl_sessions (user_id);

create table if not exists public.sl_progress (
  user_id    text primary key,
  org_id     text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists sl_progress_org_idx on public.sl_progress (org_id);

create table if not exists public.sl_settings (
  key   text primary key,
  value text not null
);
-- ACTIVE  : guru yang mendaftar langsung aktif (perilaku aplikasi lama)
-- PENDING : guru harus disetujui dulu (lebih aman; ubah dengan:
--           update public.sl_settings set value='PENDING' where key='instructor_signup_status';)
insert into public.sl_settings (key, value) values ('instructor_signup_status', 'ACTIVE')
  on conflict (key) do nothing;
insert into public.sl_settings (key, value) values ('public_signups_per_hour', '30')
  on conflict (key) do nothing;

create table if not exists public.sl_rate (
  id     bigserial primary key,
  bucket text not null,
  at     timestamptz not null default now()
);
create index if not exists sl_rate_idx on public.sl_rate (bucket, at);

-- ---------------------------------------------------------------------------
-- 2. FUNGSI INTERNAL (tidak bisa dipanggil dari browser)
-- ---------------------------------------------------------------------------
create or replace function public.sl_strip(p jsonb) returns jsonb
language sql immutable as $$
  select case
    when jsonb_exists(p, 'pendingAdmin') and jsonb_typeof(p->'pendingAdmin') = 'object'
      then jsonb_set(p - 'passwordHash' - 'salt', '{pendingAdmin}', (p->'pendingAdmin') - 'passwordHash' - 'salt')
    else p - 'passwordHash' - 'salt'
  end
$$;

create or replace function public.sl_org_of(p_kind text, p_id text, p_data jsonb) returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare v text;
begin
  if p_kind = 'organizations' then return p_id; end if;
  if p_kind in ('assignments', 'submissions') then
    select d.org_id into v from sl_docs d
      where d.kind = 'classes' and d.id = p_data->>'classId' and not d.deleted;
    if v is not null then return v; end if;
    if p_kind = 'submissions' then
      select d.org_id into v from sl_docs d
        where d.kind = 'users' and d.id = p_data->>'studentId' and not d.deleted;
      if v is not null then return v; end if;
    end if;
  end if;
  if p_kind in ('achievements', 'assessments') then
    select d.org_id into v from sl_docs d
      where d.kind = 'users' and d.id = coalesce(p_data->>'studentId', p_data->>'userId') and not d.deleted;
    if v is not null then return v; end if;
  end if;
  return nullif(p_data->>'organizationId', '');
end $$;

create or replace function public.sl_owner_of(p_kind text, p_id text, p_data jsonb) returns text
language sql immutable as $$
  select case p_kind
    when 'users' then p_id
    when 'submissions' then p_data->>'studentId'
    when 'achievements' then coalesce(p_data->>'studentId', p_data->>'userId')
    when 'assessments' then coalesce(p_data->>'studentId', p_data->>'userId')
    else p_data->>'createdBy'
  end
$$;

-- Mengembalikan {id, role, org, orgAdmin, username} untuk token yang valid, selain itu null.
create or replace function public.sl_auth(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s record; u record;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into s from sl_sessions
    where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now();
  if not found then return null; end if;
  select d.data, d.org_id into u from sl_docs d
    where d.kind = 'users' and d.id = s.user_id and not d.deleted;
  if not found or coalesce(u.data->>'status', '') <> 'ACTIVE' then return null; end if;
  return jsonb_build_object(
    'id', s.user_id, 'role', u.data->>'role', 'org', u.org_id,
    'orgAdmin', coalesce(u.data->>'orgAdmin', 'false') = 'true',
    'username', u.data->>'username');
end $$;

-- Pembatas laju per alamat IP (header x-forwarded-for dari PostgREST).
create or replace function public.sl_throttle(p_bucket text, p_limit int, p_window interval) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare h text; ip text; n int;
begin
  begin
    h := nullif(current_setting('request.headers', true), '');
    ip := coalesce(nullif(btrim(split_part(coalesce((h::jsonb)->>'x-forwarded-for', ''), ',', 1)), ''), 'unknown');
  exception when others then ip := 'unknown';
  end;
  delete from sl_rate where at < now() - interval '1 day';
  select count(*) into n from sl_rate where bucket = p_bucket || ':' || ip and at > now() - p_window;
  if n >= p_limit then return false; end if;
  insert into sl_rate (bucket) values (p_bucket || ':' || ip);
  return true;
end $$;

-- Boleh tidaknya sebuah dokumen dilihat oleh pengguna (dipakai sl_pull).
create or replace function public.sl_visible(a jsonb, d sl_docs) returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  r text := a->>'role'; uid text := a->>'id'; org text := a->>'org';
begin
  if r = 'ADMIN' then return true; end if;
  if r = 'INSTRUCTOR' then
    return d.org_id = org
        or (d.kind = 'organizations' and d.data->>'status' = 'ACTIVE')
        or (d.org_id is null and d.kind in ('courses','contents','caseRefs','rubrics'))
        or (d.kind = 'users' and d.id = uid);
  end if;
  if r = 'STUDENT' then
    if d.kind = 'users' then
      return d.id = uid or (d.org_id = org and d.data->>'role' = 'INSTRUCTOR' and d.data->>'status' = 'ACTIVE');
    elsif d.kind = 'organizations' then
      return d.id = org;
    elsif d.kind = 'classes' then
      return jsonb_typeof(d.data->'studentIds') = 'array' and jsonb_exists(d.data->'studentIds', uid);
    elsif d.kind = 'assignments' then
      return d.org_id = org
        and coalesce(d.data->>'status', 'PUBLISHED') <> 'DRAFT'
        and exists (select 1 from sl_docs c where c.kind = 'classes' and c.id = d.data->>'classId'
                      and not c.deleted and jsonb_typeof(c.data->'studentIds') = 'array'
                      and jsonb_exists(c.data->'studentIds', uid))
        and (jsonb_typeof(d.data->'studentIds') is distinct from 'array'
             or jsonb_array_length(d.data->'studentIds') = 0
             or jsonb_exists(d.data->'studentIds', uid));
    elsif d.kind in ('submissions', 'achievements', 'assessments') then
      return d.owner_id = uid;
    else
      return d.org_id is null;
    end if;
  end if;
  return false;
end $$;

-- Aturan tulis. Mengembalikan null bila diizinkan, selain itu kode alasan penolakan.
create or replace function public.sl_check_write(a jsonb, p_kind text, p_id text, p_new jsonb, p_delete boolean)
returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  r text := a->>'role'; uid text := a->>'id'; org text := a->>'org';
  oadm boolean := coalesce((a->>'orgAdmin')::boolean, false);
  o sl_docs%rowtype; have_old boolean;
  new_org text; new_owner text; old_role text; new_role text; k text;
  globals text[] := array['courses','contents','caseRefs','rubrics'];
begin
  select * into o from sl_docs where kind = p_kind and id = p_id;
  have_old := found;
  if r = 'ADMIN' then return null; end if;
  if not p_delete then
    if p_new->>'id' is not null and p_new->>'id' <> p_id then return 'ID_MISMATCH'; end if;
    new_org := sl_org_of(p_kind, p_id, p_new);
    new_owner := sl_owner_of(p_kind, p_id, p_new);
  end if;

  if r = 'INSTRUCTOR' then
    if org is null then return 'NO_ORG'; end if;

    if p_kind = 'organizations' then
      if p_delete or p_id <> org or not have_old then return 'FORBIDDEN'; end if;
      if (p_new->>'status') is distinct from (o.data->>'status')
         or (p_new->>'adminUserId') is distinct from (o.data->>'adminUserId') then
        return 'FORBIDDEN_FIELD';
      end if;
      return null;

    elsif p_kind = 'users' then
      if have_old and o.org_id is distinct from org then return 'FORBIDDEN_ORG'; end if;
      if not p_delete then
        new_role := p_new->>'role';
        if new_role is null or new_role not in ('STUDENT', 'INSTRUCTOR') then return 'FORBIDDEN_ROLE'; end if;
        if new_org is distinct from org then return 'FORBIDDEN_ORG'; end if;
        if have_old and (o.data->>'role') is distinct from new_role then return 'FORBIDDEN_ROLE'; end if;
      end if;
      old_role := case when have_old then o.data->>'role' else coalesce(p_new->>'role', '') end;
      if p_id = uid then
        if not have_old or p_delete then return 'FORBIDDEN'; end if;
        foreach k in array array['role','organizationId','orgAdmin','status','username'] loop
          if (p_new->>k) is distinct from (o.data->>k) then return 'FORBIDDEN_FIELD'; end if;
        end loop;
        return null;
      end if;
      if old_role = 'INSTRUCTOR' and not oadm then return 'FORBIDDEN'; end if;
      if not p_delete and not oadm
         and coalesce(p_new->>'orgAdmin', 'false') <> coalesce(case when have_old then o.data->>'orgAdmin' end, 'false') then
        return 'FORBIDDEN_FIELD';
      end if;
      return null;

    else
      if have_old and o.org_id is distinct from org then
        if not (p_kind = any (globals) and o.org_id is null and o.owner_id = uid) then return 'FORBIDDEN_ORG'; end if;
      end if;
      if not p_delete then
        if p_kind = any (globals) then
          if new_org is not null and new_org <> org then return 'FORBIDDEN_ORG'; end if;
        elsif new_org is distinct from org then
          return 'FORBIDDEN_ORG';
        end if;
      end if;
      return null;
    end if;
  end if;

  if r = 'STUDENT' then
    if p_kind = 'users' then
      if p_delete or p_id <> uid or not have_old then return 'FORBIDDEN'; end if;
      foreach k in array array['role','organizationId','orgAdmin','status','username','classIds'] loop
        if (p_new->k) is distinct from (o.data->k) then return 'FORBIDDEN_FIELD'; end if;
      end loop;
      return null;
    elsif p_kind in ('submissions', 'achievements', 'assessments') then
      if p_delete then return 'FORBIDDEN'; end if;
      if new_owner is distinct from uid then return 'FORBIDDEN_OWNER'; end if;
      if have_old and o.owner_id is distinct from uid then return 'FORBIDDEN_OWNER'; end if;
      if p_kind = 'submissions' then
        if not exists (select 1 from sl_docs c where c.kind = 'classes' and c.id = p_new->>'classId'
                         and not c.deleted and jsonb_typeof(c.data->'studentIds') = 'array'
                         and jsonb_exists(c.data->'studentIds', uid)) then
          return 'NOT_IN_CLASS';
        end if;
      end if;
      return null;
    end if;
    return 'FORBIDDEN';
  end if;
  return 'FORBIDDEN';
end $$;

-- Menerapkan satu perubahan yang sudah lolos sl_check_write. Melempar error bila gagal.
create or replace function public.sl_apply(a jsonb, p_kind text, p_id text, p_new jsonb, p_delete boolean, p_pw text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  uname text; cr sl_creds%rowtype; pc sl_pending_creds%rowtype;
  v_org text; v_owner text;
begin
  if p_delete then
    update sl_docs set deleted = true, updated_at = clock_timestamp() where kind = p_kind and id = p_id;
    if p_kind = 'users' then
      delete from sl_creds where user_id = p_id;
      delete from sl_sessions where user_id = p_id;
      delete from sl_progress where user_id = p_id;
    end if;
    return;
  end if;

  v_org := sl_org_of(p_kind, p_id, p_new);
  v_owner := sl_owner_of(p_kind, p_id, p_new);
  insert into sl_docs (kind, id, org_id, owner_id, data, deleted, updated_at)
    values (p_kind, p_id, v_org, v_owner, p_new, false, clock_timestamp())
    on conflict (kind, id) do update
      set org_id = excluded.org_id, owner_id = excluded.owner_id, data = excluded.data,
          deleted = false, updated_at = clock_timestamp();

  if p_kind = 'users' then
    uname := lower(btrim(coalesce(p_new->>'username', '')));
    if uname = '' then raise exception 'USERNAME_REQUIRED'; end if;
    if (a->>'role') <> 'ADMIN'
       and exists (select 1 from sl_pending_creds where username_lc = uname) then
      raise exception 'USERNAME_RESERVED';
    end if;
    select * into cr from sl_creds where user_id = p_id;
    if found then
      if cr.username_lc <> uname then
        update sl_creds set username_lc = uname where user_id = p_id;
      end if;
      if p_pw is not null and length(p_pw) >= 6 and p_id <> (a->>'id') then
        update sl_creds
          set pw_hash = crypt(p_pw, gen_salt('bf', 10)), must_change = false,
              failed_count = 0, locked_until = null, updated_at = now()
          where user_id = p_id;
      end if;
    else
      if p_pw is not null and length(p_pw) >= 6 then
        insert into sl_creds (user_id, username_lc, pw_hash)
          values (p_id, uname, crypt(p_pw, gen_salt('bf', 10)));
      else
        select * into pc from sl_pending_creds where username_lc = uname;
        if found then
          insert into sl_creds (user_id, username_lc, pw_hash) values (p_id, uname, pc.pw_hash);
          delete from sl_pending_creds where username_lc = uname;
        end if;
      end if;
    end if;
    if coalesce(p_new->>'status', '') <> 'ACTIVE' then
      delete from sl_sessions where user_id = p_id;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. FUNGSI PUBLIK (dipanggil browser lewat /rest/v1/rpc/<nama>)
-- ---------------------------------------------------------------------------
create or replace function public.sl_list_schools() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'name', d.data->>'name', 'type', d.data->>'type', 'address', d.data->>'address')
           order by d.data->>'name'), '[]'::jsonb)
  from sl_docs d
  where d.kind = 'organizations' and not d.deleted and d.data->>'status' = 'ACTIVE'
$$;

create or replace function public.sl_login(p_username text, p_password text, p_portal text default 'general')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  cr sl_creds%rowtype; u jsonb; tok text; fails int;
begin
  if not sl_throttle('login', 120, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'message', 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
  end if;
  select * into cr from sl_creds where username_lc = lower(btrim(coalesce(p_username, '')));
  if not found then
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10));   -- samakan waktu respons
    return jsonb_build_object('ok', false, 'code', 'AUTH_FAILED', 'message', 'Username atau sandi salah.');
  end if;
  if cr.locked_until is not null and cr.locked_until > now() then
    return jsonb_build_object('ok', false, 'code', 'LOCKED', 'message', 'Akun terkunci sementara karena terlalu banyak percobaan. Coba lagi dalam beberapa menit.');
  end if;
  if crypt(coalesce(p_password, ''), cr.pw_hash) <> cr.pw_hash then
    fails := cr.failed_count + 1;
    update sl_creds
      set failed_count = case when fails >= 8 then 0 else fails end,
          locked_until = case when fails >= 8 then now() + interval '5 minutes' else null end
      where user_id = cr.user_id;
    return jsonb_build_object('ok', false, 'code', 'AUTH_FAILED', 'message', 'Username atau sandi salah.');
  end if;
  select d.data into u from sl_docs d where d.kind = 'users' and d.id = cr.user_id and not d.deleted;
  if u is null then
    return jsonb_build_object('ok', false, 'code', 'AUTH_FAILED', 'message', 'Username atau sandi salah.');
  end if;
  if u->>'status' = 'PENDING' then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_PENDING', 'message', 'Akun menunggu persetujuan admin sekolah.');
  end if;
  if u->>'status' <> 'ACTIVE' then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_DISABLED', 'message', 'Akun sedang dinonaktifkan. Hubungi guru atau Superadmin.');
  end if;
  if (p_portal = 'superadmin') <> (u->>'role' = 'ADMIN') then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PORTAL',
      'message', case when p_portal = 'superadmin'
                      then 'Akun ini bukan Superadmin. Gunakan halaman login Siswa/Guru.'
                      else 'Akun Superadmin masuk lewat halaman login khusus Superadmin.' end);
  end if;
  update sl_creds set failed_count = 0, locked_until = null where user_id = cr.user_id;
  delete from sl_sessions where expires_at < now();
  tok := encode(gen_random_bytes(32), 'hex');
  insert into sl_sessions (token_hash, user_id, expires_at)
    values (encode(digest(tok, 'sha256'), 'hex'), cr.user_id, now() + interval '12 hours');
  return jsonb_build_object('ok', true, 'token', tok, 'user', sl_strip(u), 'mustChange', cr.must_change);
end $$;

create or replace function public.sl_logout(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from sl_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sl_me(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb := sl_auth(p_token); u jsonb; mc boolean;
begin
  if a is null then return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED'); end if;
  select d.data into u from sl_docs d where d.kind = 'users' and d.id = a->>'id';
  select must_change into mc from sl_creds where user_id = a->>'id';
  return jsonb_build_object('ok', true, 'user', sl_strip(u), 'mustChange', coalesce(mc, false));
end $$;

create or replace function public.sl_change_password(p_token text, p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb := sl_auth(p_token); cr sl_creds%rowtype;
begin
  if a is null then return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Sesi berakhir. Silakan masuk lagi.'); end if;
  if p_new is null or length(p_new) < 6 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Sandi baru minimal 6 karakter.');
  end if;
  select * into cr from sl_creds where user_id = a->>'id';
  if not found or crypt(coalesce(p_old, ''), cr.pw_hash) <> cr.pw_hash then
    return jsonb_build_object('ok', false, 'code', 'BAD_PASSWORD', 'message', 'Sandi saat ini salah.');
  end if;
  update sl_creds
    set pw_hash = crypt(p_new, gen_salt('bf', 10)), must_change = false, updated_at = now()
    where user_id = cr.user_id;
  return jsonb_build_object('ok', true);
end $$;

-- Pendaftaran publik ---------------------------------------------------------
create or replace function public.sl_username_free(p_username text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select not exists (select 1 from sl_creds where username_lc = lower(btrim(p_username)))
     and not exists (select 1 from sl_pending_creds where username_lc = lower(btrim(p_username)))
     and not exists (select 1 from sl_docs where kind = 'users' and not deleted
                       and lower(data->>'username') = lower(btrim(p_username)))
$$;

create or replace function public.sl_register_user(
  p_role text, p_name text, p_username text, p_email text, p_password text, p_org_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  lim int; org_doc jsonb; uid text; st text; now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  doc jsonb; uname text := btrim(coalesce(p_username, ''));
begin
  if p_role not in ('STUDENT', 'INSTRUCTOR') then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Peran tidak diizinkan untuk pendaftaran mandiri.');
  end if;
  select coalesce(nullif(value, '')::int, 30) into lim from sl_settings where key = 'public_signups_per_hour';
  if not sl_throttle('signup', coalesce(lim, 30), interval '1 hour') then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'message', 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.');
  end if;
  if btrim(coalesce(p_name, '')) = '' then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Nama wajib diisi.'); end if;
  if uname = '' or length(uname) > 50 then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Username wajib diisi (maks. 50 karakter).'); end if;
  if p_password is null or length(p_password) < 6 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Sandi minimal 6 karakter.');
  end if;
  select d.data into org_doc from sl_docs d where d.kind = 'organizations' and d.id = p_org_id and not d.deleted;
  if org_doc is null or org_doc->>'status' <> 'ACTIVE' then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Sekolah tidak aktif.');
  end if;
  if not sl_username_free(uname) then
    return jsonb_build_object('ok', false, 'code', 'DUPLICATE', 'message', 'Username sudah dipakai.');
  end if;
  if p_role = 'STUDENT' then
    st := 'PENDING';
  else
    select coalesce(value, 'ACTIVE') into st from sl_settings where key = 'instructor_signup_status';
    if st not in ('ACTIVE', 'PENDING') then st := 'ACTIVE'; end if;
  end if;
  uid := 'USER_' || encode(gen_random_bytes(6), 'hex');
  doc := jsonb_build_object(
    'id', uid, 'role', p_role, 'name', left(btrim(p_name), 100), 'username', uname,
    'email', nullif(btrim(coalesce(p_email, '')), ''), 'organizationId', p_org_id,
    'classIds', '[]'::jsonb, 'status', st, 'createdAt', now_ms, 'updatedAt', now_ms);
  if p_role = 'STUDENT' then
    doc := doc || jsonb_build_object('requestedAt', now_ms, 'registeredBy', 'PUBLIC');
  end if;
  insert into sl_docs (kind, id, org_id, owner_id, data) values ('users', uid, p_org_id, uid, doc);
  insert into sl_creds (user_id, username_lc, pw_hash)
    values (uid, lower(uname), crypt(p_password, gen_salt('bf', 10)));
  return jsonb_build_object('ok', true, 'status', st, 'orgName', org_doc->>'name');
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'DUPLICATE', 'message', 'Username sudah dipakai.');
end $$;

create or replace function public.sl_register_school(
  p_name text, p_address text, p_admin_name text, p_admin_username text, p_admin_password text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  lim int; oid text; now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  auname text := btrim(coalesce(p_admin_username, ''));
begin
  select coalesce(nullif(value, '')::int, 30) into lim from sl_settings where key = 'public_signups_per_hour';
  if not sl_throttle('signup', coalesce(lim, 30), interval '1 hour') then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'message', 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.');
  end if;
  if btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_admin_name, '')) = '' or auname = '' then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Nama sekolah, nama admin, dan username admin wajib diisi.');
  end if;
  if p_admin_password is null or length(p_admin_password) < 6 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Sandi admin minimal 6 karakter.');
  end if;
  if exists (select 1 from sl_docs where kind = 'organizations' and not deleted
               and lower(data->>'name') = lower(btrim(p_name))
               and data->>'status' in ('ACTIVE', 'PENDING')) then
    return jsonb_build_object('ok', false, 'code', 'DUPLICATE', 'message', 'Nama sekolah sudah terdaftar.');
  end if;
  if not sl_username_free(auname) then
    return jsonb_build_object('ok', false, 'code', 'DUPLICATE', 'message', 'Username admin sudah dipakai.');
  end if;
  oid := 'ORG_' || encode(gen_random_bytes(6), 'hex');
  insert into sl_docs (kind, id, org_id, owner_id, data) values ('organizations', oid, oid, null,
    jsonb_build_object('id', oid, 'name', left(btrim(p_name), 150), 'type', 'SCHOOL',
      'address', left(btrim(coalesce(p_address, '')), 300), 'status', 'PENDING', 'createdBy', 'PUBLIC',
      'pendingAdmin', jsonb_build_object('name', left(btrim(p_admin_name), 100), 'username', auname, 'email', null),
      'createdAt', now_ms, 'updatedAt', now_ms));
  insert into sl_pending_creds (username_lc, org_id, pw_hash)
    values (lower(auname), oid, crypt(p_admin_password, gen_salt('bf', 10)));
  return jsonb_build_object('ok', true);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'DUPLICATE', 'message', 'Username admin sudah dipakai.');
end $$;

-- Gabung kelas lewat kode (dilakukan di server agar siswa tidak bisa menulis dokumen kelas) ---
create or replace function public.sl_join_class(p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a jsonb := sl_auth(p_token); c sl_docs%rowtype; now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  already boolean; u sl_docs%rowtype;
begin
  if a is null then return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Sesi berakhir. Silakan masuk lagi.'); end if;
  if a->>'role' <> 'STUDENT' then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Hanya siswa yang dapat bergabung dengan kode.'); end if;
  if not sl_throttle('join', 40, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'message', 'Terlalu banyak percobaan. Coba lagi nanti.');
  end if;
  select * into c from sl_docs d
    where d.kind = 'classes' and not d.deleted
      and d.data->>'joinCode' = btrim(coalesce(p_code, ''))
      and coalesce(d.data->>'joinEnabled', 'false') = 'true'
      and coalesce(d.data->>'status', 'ACTIVE') = 'ACTIVE'
      and (coalesce(d.data->>'joinExpiresAt', '') = ''
           or d.data->>'joinExpiresAt' !~ '^[0-9]+$'
           or (d.data->>'joinExpiresAt')::bigint > now_ms)
    order by (d.org_id is not distinct from (a->>'org')) desc
    limit 1;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Kode tidak valid atau sudah dinonaktifkan.'); end if;
  if c.org_id is distinct from (a->>'org') then
    return jsonb_build_object('ok', false, 'code', 'WRONG_ORG', 'message', 'Kode ini milik sekolah lain.');
  end if;
  already := jsonb_typeof(c.data->'studentIds') = 'array' and jsonb_exists(c.data->'studentIds', a->>'id');
  if not already then
    update sl_docs
      set data = jsonb_set(data, '{studentIds}', coalesce(data->'studentIds', '[]'::jsonb) || to_jsonb(a->>'id'))
                 || jsonb_build_object('updatedAt', now_ms),
          updated_at = clock_timestamp()
      where kind = 'classes' and id = c.id;
    select * into u from sl_docs where kind = 'users' and id = a->>'id';
    update sl_docs
      set data = case when jsonb_typeof(data->'classIds') = 'array' and jsonb_exists(data->'classIds', c.id)
                      then data
                      else jsonb_set(data, '{classIds}', coalesce(data->'classIds', '[]'::jsonb) || to_jsonb(c.id)) end
                 || jsonb_build_object('updatedAt', now_ms),
          updated_at = clock_timestamp()
      where kind = 'users' and id = a->>'id';
  end if;
  return jsonb_build_object('ok', true, 'classId', c.id, 'className', c.data->>'name', 'alreadyJoined', already);
end $$;

-- Sinkronisasi ---------------------------------------------------------------
create or replace function public.sl_pull(p_token text, p_since timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a jsonb := sl_auth(p_token); t0 timestamptz := clock_timestamp(); docs jsonb;
begin
  if a is null then return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', d.kind, 'id', d.id, 'deleted', d.deleted, 'at', d.updated_at,
           'data', case when d.deleted then null else sl_strip(d.data) end) order by d.updated_at), '[]'::jsonb)
    into docs
    from sl_docs d
    where (case when p_since is null then not d.deleted else d.updated_at > p_since end)
      and sl_visible(a, d);
  return jsonb_build_object('ok', true, 'docs', docs, 'now', t0, 'full', p_since is null, 'me', a);
end $$;

create or replace function public.sl_push(p_token text, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a jsonb := sl_auth(p_token); c jsonb; k text; i text; d jsonb; pw text; del boolean; reason text;
  acc jsonb := '[]'::jsonb; rej jsonb := '[]'::jsonb;
  kinds text[] := array['users','organizations','classes','assignments','submissions','courses','contents',
                        'caseRefs','rubrics','achievements','assessments'];
begin
  if a is null then return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED'); end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  if jsonb_array_length(p_changes) > 500 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY');
  end if;
  for c in select value from jsonb_array_elements(p_changes) loop
    k := c->>'kind'; i := c->>'id'; pw := nullif(c->>'password', '');
    del := coalesce((c->>'delete')::boolean, false);
    if k is null or i is null or not (k = any (kinds)) or length(i) > 100 then
      rej := rej || jsonb_build_object('kind', k, 'id', i, 'reason', 'BAD_KIND'); continue;
    end if;
    if not del then
      if jsonb_typeof(c->'data') <> 'object' then
        rej := rej || jsonb_build_object('kind', k, 'id', i, 'reason', 'BAD_DATA'); continue;
      end if;
      d := sl_strip(c->'data');
      if length(d::text) > 200000 then
        rej := rej || jsonb_build_object('kind', k, 'id', i, 'reason', 'TOO_LARGE'); continue;
      end if;
    else
      d := null;
    end if;
    reason := sl_check_write(a, k, i, d, del);
    if reason is not null then
      rej := rej || jsonb_build_object('kind', k, 'id', i, 'reason', reason); continue;
    end if;
    begin
      perform sl_apply(a, k, i, d, del, pw);
      acc := acc || jsonb_build_object('kind', k, 'id', i);
    exception
      when unique_violation then
        rej := rej || jsonb_build_object('kind', k, 'id', i, 'reason', 'USERNAME_TAKEN');
      when others then
        rej := rej || jsonb_build_object('kind', k, 'id', i, 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok', true, 'accepted', acc, 'rejected', rej, 'now', clock_timestamp());
end $$;

-- Progres belajar (blob localStorage per akun) --------------------------------
create or replace function public.sl_progress_put(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb := sl_auth(p_token);
begin
  if a is null then return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST'); end if;
  if length(p_data::text) > 1500000 then return jsonb_build_object('ok', false, 'code', 'TOO_LARGE'); end if;
  insert into sl_progress (user_id, org_id, data, updated_at)
    values (a->>'id', a->>'org', p_data, clock_timestamp())
    on conflict (user_id) do update
      set data = excluded.data, org_id = excluded.org_id, updated_at = clock_timestamp();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sl_progress_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb := sl_auth(p_token); r sl_progress%rowtype;
begin
  if a is null then return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED'); end if;
  select * into r from sl_progress where user_id = a->>'id';
  return jsonb_build_object('ok', true, 'data', case when found then r.data else null end);
end $$;

-- Guru/Superadmin: progres siswa di sekolahnya
create or replace function public.sl_progress_org(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb := sl_auth(p_token); rows jsonb;
begin
  if a is null then return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED'); end if;
  if a->>'role' not in ('INSTRUCTOR', 'ADMIN') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('userId', p.user_id, 'username', u.data->>'username', 'data', p.data)), '[]'::jsonb)
    into rows
    from sl_progress p
    join sl_docs u on u.kind = 'users' and u.id = p.user_id and not u.deleted
    where u.data->>'role' = 'STUDENT'
      and (a->>'role' = 'ADMIN' or p.org_id = a->>'org');
  return jsonb_build_object('ok', true, 'rows', rows);
end $$;

-- ---------------------------------------------------------------------------
-- 4. HAK AKSES: tabel tertutup, hanya fungsi publik yang boleh dipanggil
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sl_docs','sl_creds','sl_pending_creds','sl_sessions','sl_progress','sl_settings','sl_rate'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
    revoke all on all sequences in schema public from authenticated;
  end if;
end $$;

-- cabut semua, lalu buka hanya fungsi publik
revoke all on function
  public.sl_strip(jsonb), public.sl_org_of(text, text, jsonb), public.sl_owner_of(text, text, jsonb),
  public.sl_auth(text), public.sl_throttle(text, int, interval), public.sl_visible(jsonb, sl_docs),
  public.sl_check_write(jsonb, text, text, jsonb, boolean),
  public.sl_apply(jsonb, text, text, jsonb, boolean, text), public.sl_username_free(text)
  from public;

revoke all on function
  public.sl_list_schools(), public.sl_login(text, text, text), public.sl_logout(text), public.sl_me(text),
  public.sl_change_password(text, text, text),
  public.sl_register_user(text, text, text, text, text, text),
  public.sl_register_school(text, text, text, text, text),
  public.sl_join_class(text, text), public.sl_pull(text, timestamptz), public.sl_push(text, jsonb),
  public.sl_progress_put(text, jsonb), public.sl_progress_get(text), public.sl_progress_org(text)
  from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function
      public.sl_list_schools(), public.sl_login(text, text, text), public.sl_logout(text), public.sl_me(text),
      public.sl_change_password(text, text, text),
      public.sl_register_user(text, text, text, text, text, text),
      public.sl_register_school(text, text, text, text, text),
      public.sl_join_class(text, text), public.sl_pull(text, timestamptz), public.sl_push(text, jsonb),
      public.sl_progress_put(text, jsonb), public.sl_progress_get(text), public.sl_progress_org(text)
      to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function
      public.sl_list_schools(), public.sl_login(text, text, text), public.sl_logout(text), public.sl_me(text),
      public.sl_change_password(text, text, text),
      public.sl_register_user(text, text, text, text, text, text),
      public.sl_register_school(text, text, text, text, text),
      public.sl_join_class(text, text), public.sl_pull(text, timestamptz), public.sl_push(text, jsonb),
      public.sl_progress_put(text, jsonb), public.sl_progress_get(text), public.sl_progress_org(text)
      to authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. AKUN SUPERADMIN AWAL
-- ---------------------------------------------------------------------------
-- Username: superadmin   Sandi awal: superadmin123  (WAJIB diganti saat login pertama;
-- aplikasi akan memaksanya). Ganti sandi awal di bawah ini SEBELUM menjalankan bila ingin.
do $$
declare ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not exists (select 1 from public.sl_docs where kind = 'users' and id = 'USER_SUPERADMIN') then
    insert into public.sl_docs (kind, id, org_id, owner_id, data) values ('users', 'USER_SUPERADMIN', null, 'USER_SUPERADMIN',
      jsonb_build_object('id', 'USER_SUPERADMIN', 'role', 'ADMIN', 'name', 'Superadmin', 'username', 'superadmin',
        'email', null, 'organizationId', null, 'classIds', '[]'::jsonb, 'status', 'ACTIVE',
        'createdAt', ms, 'updatedAt', ms));
    insert into public.sl_creds (user_id, username_lc, pw_hash, must_change)
      values ('USER_SUPERADMIN', 'superadmin', extensions.crypt('superadmin123', extensions.gen_salt('bf', 10)), true);
  end if;
end $$;
