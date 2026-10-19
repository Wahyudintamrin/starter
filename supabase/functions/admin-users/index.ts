// Edge Function `admin-users` — membuat / mengubah / menghapus akun atas nama Superadmin atau guru.
// Perlu service role karena membuat akun Auth dan mengubah sandi orang lain.
//
// POST JSON dengan header  Authorization: Bearer <JWT pemanggil>
//   { action: 'create', username, password, name, role: 'STUDENT'|'INSTRUCTOR', organizationId, nis?, email? }
//   { action: 'update', id, name?, username?, password?, email?, nis?, status? }
//   { action: 'delete', id }
// Balasan: { ok: true, data: {...} }  atau  { ok: false, error: { code, message } }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (otomatis ada di Supabase), EMAIL_DOMAIN (opsional,
//      bawaan starterlab.app — HARUS sama dengan public.app_config.email_domain).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const EMAIL_DOMAIN = (Deno.env.get("EMAIL_DOMAIN") ?? "starterlab.app").toLowerCase();

const CORS: Record<string, string> = {
  // Batasi ke domain GitHub Pages Anda bila perlu, mis. "https://nama.github.io"
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

class Fail extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}
const okReply = (data: unknown) => reply(200, { ok: true, data });
const failReply = (status: number, code: string, message: string) =>
  reply(status, { ok: false, error: { code, message } });

// ---------------------------------------------------------------- validasi
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const NIS_RE = /^[0-9A-Za-z./-]{0,30}$/;
const STATUSES = ["ACTIVE", "PENDING", "INACTIVE", "REJECTED"];

function str(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new Fail(400, "VALIDASI", "Isian harus berupa teks.");
  // buang karakter kontrol dan < >
  // deno-lint-ignore no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, "").trim();
  return s.length > max ? s.slice(0, max) : s;
}
function username(v: unknown): string {
  const u = String(v ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(u)) {
    throw new Fail(400, "USERNAME_TIDAK_VALID", "Username 3-30 karakter: huruf kecil, angka, titik, garis bawah, atau strip.");
  }
  return u;
}
function password(v: unknown): string {
  if (typeof v !== "string" || v.length < 6 || v.length > 72) {
    throw new Fail(400, "SANDI_TIDAK_VALID", "Sandi 6-72 karakter.");
  }
  return v;
}
function contactEmail(v: unknown): string | null {
  const s = str(v, 120);
  if (!s) return null;
  if (!/^[^@\s]+@[^@\s]+$/.test(s)) throw new Fail(400, "EMAIL_TIDAK_VALID", "Format email tidak valid.");
  return s;
}
function nis(v: unknown): string | null {
  const s = str(v, 30);
  if (!s) return null;
  if (!NIS_RE.test(s)) throw new Fail(400, "NIS_TIDAK_VALID", "NIS hanya boleh huruf, angka, titik, garis miring, atau strip.");
  return s;
}
const emailOf = (u: string) => `${u}@${EMAIL_DOMAIN}`;

// ---------------------------------------------------------------- akses data
type Profile = { id: string; username: string; role: string; status: string; org_id: string | null; name: string };

async function profileById(id: string): Promise<Profile | null> {
  const { data, error } = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}
async function usernameTaken(u: string, exceptId?: string): Promise<boolean> {
  const { data, error } = await admin.from("profiles").select("id").ilike("username", u).limit(1);
  if (error) throw error;
  return (data ?? []).some((r: { id: string }) => r.id !== exceptId);
}
async function orgIsActive(orgId: string): Promise<boolean> {
  const { data, error } = await admin.from("entities").select("data,deleted")
    .eq("kind", "organizations").eq("id", orgId).maybeSingle();
  if (error) throw error;
  return !!data && !data.deleted && data.data?.status === "ACTIVE";
}
async function userRow(id: string) {
  const { data, error } = await admin.from("entities").select("*").eq("kind", "users").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as { data: Record<string, unknown>; org_id: string | null } | null;
}

// ---------------------------------------------------------------- aksi
async function createUser(caller: Profile, b: Record<string, unknown>) {
  const role = String(b.role ?? "");
  if (role !== "STUDENT" && role !== "INSTRUCTOR") throw new Fail(400, "PERAN_TIDAK_VALID", "Peran harus STUDENT atau INSTRUCTOR.");
  const uname = username(b.username);
  const pw = password(b.password);
  const name = str(b.name, 100);
  if (!name) throw new Fail(400, "NAMA_WAJIB", "Nama lengkap wajib diisi.");
  const nisVal = role === "STUDENT" ? nis(b.nis) : null;
  const email = contactEmail(b.email);

  let orgId: string | null;
  if (caller.role === "ADMIN") {
    orgId = str(b.organizationId, 64);
  } else if (caller.role === "INSTRUCTOR") {
    if (role !== "STUDENT") throw new Fail(403, "TIDAK_BERWENANG", "Guru hanya boleh menambah siswa.");
    orgId = caller.org_id; // abaikan kiriman klien
  } else {
    throw new Fail(403, "TIDAK_BERWENANG", "Anda tidak berwenang menambah pengguna.");
  }
  if (!orgId) throw new Fail(400, "SEKOLAH_WAJIB", "Sekolah wajib dipilih.");
  if (!(await orgIsActive(orgId))) throw new Fail(400, "SEKOLAH_TIDAK_AKTIF", "Sekolah tidak ditemukan atau belum aktif.");
  if (await usernameTaken(uname)) throw new Fail(409, "USERNAME_DIPAKAI", `Username "${uname}" sudah dipakai.`);

  const { data, error } = await admin.auth.admin.createUser({
    email: emailOf(uname),
    password: pw,
    email_confirm: true,
    app_metadata: {
      trusted: true, role, status: "ACTIVE", org_id: orgId, name, nis: nisVal, email, created_by: caller.id,
    },
  });
  if (error || !data?.user) {
    const m = (error?.message ?? "").toLowerCase();
    if (m.includes("already") || m.includes("registered") || error?.status === 422) {
      throw new Fail(409, "USERNAME_DIPAKAI", `Username "${uname}" sudah dipakai.`);
    }
    throw error ?? new Error("createUser gagal");
  }
  return { id: data.user.id };
}

async function updateUser(caller: Profile, b: Record<string, unknown>) {
  const id = String(b.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Fail(400, "ID_TIDAK_VALID", "ID pengguna tidak valid.");
  const target = await profileById(id);
  if (!target) throw new Fail(404, "TIDAK_DITEMUKAN", "Pengguna tidak ditemukan.");
  if (target.role === "ADMIN") throw new Fail(403, "TIDAK_BERWENANG", "Akun Superadmin tidak dapat diubah lewat fungsi ini.");

  const isAdmin = caller.role === "ADMIN";
  if (!isAdmin) {
    if (caller.role !== "INSTRUCTOR" || target.role !== "STUDENT" || target.org_id !== caller.org_id) {
      throw new Fail(403, "TIDAK_BERWENANG", "Anda tidak berwenang mengubah pengguna ini.");
    }
    for (const k of ["username", "email", "status"]) {
      if (b[k] !== undefined) throw new Fail(403, "TIDAK_BERWENANG", `Guru tidak boleh mengubah ${k}.`);
    }
  }

  const authPatch: Record<string, unknown> = {};
  const profPatch: Record<string, unknown> = {};
  const dataPatch: Record<string, unknown> = {};

  if (b.name !== undefined) {
    const n = str(b.name, 100);
    if (!n) throw new Fail(400, "NAMA_WAJIB", "Nama lengkap wajib diisi.");
    profPatch.name = n; dataPatch.name = n;
  }
  if (b.nis !== undefined && target.role === "STUDENT") dataPatch.nis = nis(b.nis);
  if (b.password !== undefined && b.password !== null && b.password !== "") authPatch.password = password(b.password);
  if (b.email !== undefined) dataPatch.email = contactEmail(b.email);
  if (b.username !== undefined) {
    const u = username(b.username);
    if (u !== target.username.toLowerCase()) {
      if (await usernameTaken(u, id)) throw new Fail(409, "USERNAME_DIPAKAI", `Username "${u}" sudah dipakai.`);
      authPatch.email = emailOf(u); authPatch.email_confirm = true;
      profPatch.username = u; dataPatch.username = u;
    }
  }
  if (b.status !== undefined) {
    let s = String(b.status).toUpperCase();
    if (s === "DISABLED") s = "INACTIVE";
    if (!STATUSES.includes(s)) throw new Fail(400, "STATUS_TIDAK_VALID", "Status tidak valid.");
    profPatch.status = s; dataPatch.status = s;
    // akun nonaktif juga tidak boleh masuk sama sekali
    authPatch.ban_duration = s === "ACTIVE" || s === "PENDING" ? "none" : "876000h";
  }
  if (b.organizationId !== undefined && isAdmin) {
    const o = str(b.organizationId, 64);
    if (o !== target.org_id) {
      if (o && !(await orgIsActive(o))) throw new Fail(400, "SEKOLAH_TIDAK_AKTIF", "Sekolah tidak ditemukan atau belum aktif.");
      profPatch.org_id = o; dataPatch.organizationId = o;
    }
  }

  if (Object.keys(authPatch).length) {
    const { error } = await admin.auth.admin.updateUserById(id, authPatch);
    if (error) {
      if ((error.message ?? "").toLowerCase().includes("already")) throw new Fail(409, "USERNAME_DIPAKAI", "Username sudah dipakai.");
      throw error;
    }
  }
  if (Object.keys(profPatch).length) {
    const { error } = await admin.from("profiles").update(profPatch).eq("id", id);
    if (error) throw error;
  }
  if (Object.keys(dataPatch).length) {
    const row = await userRow(id);
    if (row) {
      const merged = { ...row.data, ...dataPatch };
      const { error } = await admin.from("entities").update({ data: merged }).eq("kind", "users").eq("id", id);
      if (error) throw error;
    }
  }
  return { id };
}

async function deleteUser(caller: Profile, b: Record<string, unknown>) {
  if (caller.role !== "ADMIN") throw new Fail(403, "TIDAK_BERWENANG", "Hanya Superadmin yang dapat menghapus akun.");
  const id = String(b.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Fail(400, "ID_TIDAK_VALID", "ID pengguna tidak valid.");
  if (id === caller.id) throw new Fail(403, "TIDAK_BERWENANG", "Tidak dapat menghapus akun sendiri.");
  const target = await profileById(id);
  if (!target) throw new Fail(404, "TIDAK_DITEMUKAN", "Pengguna tidak ditemukan.");
  if (target.role === "ADMIN") throw new Fail(403, "TIDAK_BERWENANG", "Akun Superadmin tidak dapat dihapus.");

  // tandai baris milik pengguna sebagai terhapus (tombstone) agar perangkat lain ikut menghapus
  const a = await admin.from("entities").update({ deleted: true }).eq("kind", "users").eq("id", id);
  if (a.error) throw a.error;
  const b2 = await admin.from("entities").update({ deleted: true }).eq("owner_id", id);
  if (b2.error) throw b2.error;
  const { error } = await admin.auth.admin.deleteUser(id); // cascade: profiles, user_data
  if (error) throw error;
  return { id };
}

// ---------------------------------------------------------------- server
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return failReply(405, "METODE_TIDAK_DIDUKUNG", "Gunakan POST.");
  if (!SUPABASE_URL || !SERVICE_KEY) return failReply(500, "KONFIGURASI", "Fungsi belum dikonfigurasi.");

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return failReply(401, "BELUM_MASUK", "Silakan masuk terlebih dahulu.");
    const { data: u, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !u?.user) return failReply(401, "BELUM_MASUK", "Sesi tidak valid atau sudah berakhir.");
    const caller = await profileById(u.user.id);
    if (!caller || caller.status !== "ACTIVE") return failReply(403, "TIDAK_BERWENANG", "Akun Anda tidak aktif.");

    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("bentuk");
    } catch {
      return failReply(400, "VALIDASI", "Isi permintaan harus berupa JSON.");
    }

    switch (body.action) {
      case "create": return okReply(await createUser(caller, body));
      case "update": return okReply(await updateUser(caller, body));
      case "delete": return okReply(await deleteUser(caller, body));
      default: return failReply(400, "AKSI_TIDAK_DIKENAL", "Aksi tidak dikenal.");
    }
  } catch (e) {
    if (e instanceof Fail) return failReply(e.status, e.code, e.message);
    console.error("admin-users:", e instanceof Error ? e.message : String(e)); // tanpa stack ke klien
    return failReply(500, "GALAT_SERVER", "Terjadi kesalahan di server.");
  }
});
