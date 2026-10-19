/* ============================================================================
   StarterLab Cloud — klien Supabase (tanpa dependensi, cocok untuk GitHub Pages)
   ----------------------------------------------------------------------------
   Aktif HANYA bila config.js mengisi window.STARTERLAB_SUPABASE = { url, anonKey }.
   Bila kosong, modul ini tidak melakukan apa pun dan aplikasi berjalan seperti
   semula (data di browser masing-masing).

   Tugas modul:
   1. Memanggil fungsi RPC sl_* di Supabase (lihat supabase/schema.sql).
   2. Menyinkronkan database platform (sekolah, guru, siswa, kelas, tugas, ...)
      yang di klien ada di objek `db` (localStorage), dua arah:
        - push : perubahan lokal dikirim (diff terhadap keadaan terakhir di server)
        - pull : perubahan server digabung ke lokal (server menang, kecuali ada
                 perubahan lokal yang belum terkirim)
   3. Menyinkronkan progres belajar per akun (kunci localStorage DATA_KEYS).
   4. Menampilkan bilah peringatan saat offline.
   Sandi TIDAK pernah disimpan atau dihitung hash-nya di browser untuk server:
   sandi polos dikirim lewat HTTPS ke fungsi server yang menyimpannya sebagai bcrypt.
   ============================================================================ */
(function (G) {
    'use strict';

    var CFG = (G && G.STARTERLAB_SUPABASE) || {};
    var URL_BASE = String(CFG.url || '').trim().replace(/\/+$/, '');
    var API_KEY = String(CFG.anonKey || '').trim();
    var ON = !!(URL_BASE && API_KEY);

    var KINDS = ['organizations', 'users', 'classes', 'assignments', 'submissions',
        'courses', 'contents', 'caseRefs', 'rubrics', 'achievements', 'assessments'];
    var K_TOKEN = 'starterLab_cloud_token_v1';       /* sessionStorage: per tab, sama seperti sesi login */
    var K_SYNCED = 'starterLab_cloud_synced_v1';     /* localStorage: {kind:{id:hash}} keadaan terakhir di server */
    var K_META = 'starterLab_cloud_meta_v1';         /* localStorage: {owner, cursor} */
    var K_PMETA = 'starterLab_cloud_progress_v1';    /* localStorage: {owner, hash} progres terakhir tersinkron */
    var POLL_MS = 20000, PROGRESS_MS = 4000, OVERLAP_MS = 10000, CHUNK = 150;

    var REASON_TEXT = {
        FORBIDDEN: 'tidak diizinkan', FORBIDDEN_ORG: 'data milik sekolah lain', FORBIDDEN_ROLE: 'peran tidak diizinkan',
        FORBIDDEN_FIELD: 'bagian data ini tidak boleh diubah', FORBIDDEN_OWNER: 'bukan milik Anda', NOT_IN_CLASS: 'Anda bukan anggota kelas ini',
        USERNAME_TAKEN: 'username sudah dipakai', USERNAME_RESERVED: 'username sedang dipesan pendaftaran sekolah',
        USERNAME_REQUIRED: 'username wajib diisi', TOO_LARGE: 'data terlalu besar', NO_ORG: 'akun belum terhubung ke sekolah',
        BAD_KIND: 'jenis data tidak dikenal', BAD_DATA: 'data tidak valid', ID_MISMATCH: 'id tidak cocok'
    };

    /* ---------------- util ---------------- */
    function ls() { try { return G.localStorage || null; } catch (e) { return null; } }
    function ss() { try { return G.sessionStorage || null; } catch (e) { return null; } }
    function jget(store, k, fb) { try { var v = store && store.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
    function jset(store, k, v) { try { if (store) store.setItem(k, JSON.stringify(v)); } catch (e) { /* kuota/mode privat */ } }
    function jdel(store, k) { try { if (store) store.removeItem(k); } catch (e) { } }

    /* JSON kanonik (kunci terurut) agar perbandingan tidak terpengaruh urutan kunci jsonb. */
    function canon(v) {
        if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
        if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
        return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
            .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    }
    function fnv(s) {
        var h = 2166136261;
        for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return (h >>> 0).toString(36) + ':' + s.length;
    }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function strip(rec) {
        var c = {};
        Object.keys(rec).forEach(function (k) { if (k !== 'passwordHash' && k !== 'salt') c[k] = rec[k]; });
        if (c.pendingAdmin && typeof c.pendingAdmin === 'object') {
            var pa = {};
            Object.keys(c.pendingAdmin).forEach(function (k) { if (k !== 'passwordHash' && k !== 'salt') pa[k] = c.pendingAdmin[k]; });
            c.pendingAdmin = pa;
        }
        return c;
    }

    /* ---------------- HTTP ---------------- */
    function headers() {
        var h = { 'Content-Type': 'application/json', 'apikey': API_KEY };
        if (/^eyJ/.test(API_KEY)) h['Authorization'] = 'Bearer ' + API_KEY;   /* kunci anon lama berbentuk JWT; kunci sb_publishable_ hanya lewat header apikey */
        return h;
    }
    /* Hasil: {ok, status, data, offline, message}. ok=true berarti HTTP 2xx. */
    function http(fn, args) {
        if (!ON || typeof G.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, offline: true, message: 'Cloud tidak aktif.' });
        return G.fetch(URL_BASE + '/rest/v1/rpc/' + fn, { method: 'POST', headers: headers(), body: JSON.stringify(args || {}) })
            .then(function (r) {
                return r.text().then(function (txt) {
                    var json = null;
                    try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = null; }
                    if (r.ok) return { ok: true, status: r.status, data: json };
                    var m = (json && (json.message || json.hint || json.error)) || ('HTTP ' + r.status);
                    if (r.status === 404 || (json && json.code === 'PGRST202')) m = 'Skema Supabase belum dipasang (fungsi ' + fn + ' tidak ditemukan). Jalankan supabase/schema.sql.';
                    else if (r.status === 401 || r.status === 403) m = 'Kunci Supabase ditolak. Periksa url dan anonKey di config.js.';
                    return { ok: false, status: r.status, message: m, data: json };
                });
            }, function () { return { ok: false, status: 0, offline: true, message: 'Tidak dapat terhubung ke server. Periksa koneksi internet. (Proyek Supabase gratis otomatis tidur setelah tidak dipakai lama; buka dashboard Supabase untuk membangunkannya.)' }; });
    }
    function norm(res) {   /* ke bentuk {ok, code, message, ...data} */
        if (!res.ok) return { ok: false, code: res.offline ? 'OFFLINE' : 'HTTP_' + res.status, message: res.message, offline: !!res.offline };
        var d = res.data || {};
        if (d.ok === false) return Object.assign({ message: d.message || d.code || 'Gagal.' }, d);
        return d;
    }

    /* ---------------- token ---------------- */
    var memToken = null;
    function token() { var s = ss(); try { return (s && s.getItem(K_TOKEN)) || memToken; } catch (e) { return memToken; } }
    function setToken(t) {
        memToken = t || null;
        var s = ss(); try { if (s) { if (t) s.setItem(K_TOKEN, t); else s.removeItem(K_TOKEN); } } catch (e) { }
    }

    /* ---------------- status & bilah offline ---------------- */
    var status = { state: 'idle', pending: 0, lastSyncAt: null, lastError: null };
    function bar() {
        var d = G.document; if (!d || !d.body || !d.createElement) return null;
        var el = d.getElementById && d.getElementById('sl-cloud-bar');
        if (el) return el;
        el = d.createElement('div');
        if (!el || !el.setAttribute) return null;
        el.id = 'sl-cloud-bar';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:8px 16px;font:600 13px/1.4 system-ui,sans-serif;'
            + 'text-align:center;background:#7a4b00;color:#fff;display:none';
        try { d.body.appendChild(el); } catch (e) { return null; }
        return el;
    }
    function setStatus(state, err) {
        status.state = state; status.lastError = err || null;
        try {
            var b = bar();
            if (b) {
                if (state === 'offline') { b.textContent = 'Tidak terhubung ke server. Perubahan akan dikirim otomatis saat koneksi kembali' + (status.pending ? ' (' + status.pending + ' tertunda).' : '.'); b.style.display = 'block'; }
                else if (state === 'error') { b.textContent = 'Sinkronisasi bermasalah: ' + (err || 'kesalahan tidak dikenal'); b.style.display = 'block'; }
                else b.style.display = 'none';
            }
            if (G.dispatchEvent && typeof G.CustomEvent === 'function') G.dispatchEvent(new G.CustomEvent('starter:cloud-status', { detail: status }));
        } catch (e) { /* tampilan opsional */ }
    }

    /* ---------------- mesin sinkron ---------------- */
    var ctx = null;                          /* diisi attach() */
    var synced = jget(ls(), K_SYNCED, {});   /* {kind:{id:hash}} */
    var meta = jget(ls(), K_META, {});       /* {owner, cursor} */
    var plain = {};                          /* salt -> sandi polos (sementara, hanya di memori) */
    var dead = {};                           /* 'kind:id' -> hash yang ditolak server */
    var pulling = null, pushing = null, pushAgain = false, pushTimer = null, pollTimer = null, progTimer = null;
    var started = false, tickN = 0, pendingBlob;

    function saveSynced() { jset(ls(), K_SYNCED, synced); }
    function saveMeta() { jset(ls(), K_META, meta); }
    function store(kind) { var db = ctx.getDb(); return db[kind] || (db[kind] = {}); }

    function computeChanges() {
        var out = [];
        if (!ctx) return out;
        KINDS.forEach(function (kind) {
            var st = store(kind), syn = synced[kind] || (synced[kind] = {});
            Object.keys(st).forEach(function (id) {
                var rec = st[id];
                if (!rec || rec.isDemo) return;
                var d = strip(rec), h = fnv(canon(d));
                var pw = (kind === 'users' && rec.salt && plain[rec.salt]) ? plain[rec.salt] : null;
                if (syn[id] === h && !pw) return;
                if (dead[kind + ':' + id] === h && !pw) return;
                out.push({ kind: kind, id: id, data: d, password: pw, h: h, salt: pw ? rec.salt : null });
            });
            Object.keys(syn).forEach(function (id) {
                if (!st[id]) out.push({ kind: kind, id: id, del: true });
            });
        });
        return out;
    }
    function dirtyMap() { var m = {}; computeChanges().forEach(function (c) { m[c.kind + ':' + c.id] = true; }); return m; }

    function applyPull(d, revert) {
        var changed = false, dirty = dirtyMap(), seen = {};
        (d.docs || []).forEach(function (x) {
            var kind = x.kind, id = x.id, key = kind + ':' + id;
            if (KINDS.indexOf(kind) < 0) return;
            seen[key] = true;
            var st = store(kind), syn = synced[kind] || (synced[kind] = {});
            if (x.deleted) {
                if (!dirty[key] || revert[key]) { if (st[id]) { delete st[id]; changed = true; } delete syn[id]; }
                return;
            }
            if (dirty[key] && !revert[key]) return;              /* perubahan lokal belum terkirim: lokal menang */
            var local = st[id], rec = clone(x.data);
            if (kind === 'users' && local) {
                if (local.passwordHash) rec.passwordHash = local.passwordHash;
                if (local.salt) rec.salt = local.salt;
            }
            if (!local || canon(strip(local)) !== canon(strip(rec))) { st[id] = rec; changed = true; }
            syn[id] = fnv(canon(strip(rec)));
            delete dead[key];
        });
        if (d.full) {   /* pull penuh: buang salinan lokal yang sudah tidak terlihat/ada di server */
            KINDS.forEach(function (kind) {
                var st = store(kind), syn = synced[kind] || (synced[kind] = {});
                Object.keys(st).forEach(function (id) {
                    var key = kind + ':' + id;
                    if (seen[key] || (dirty[key] && !revert[key]) || (st[id] && st[id].isDemo)) return;
                    delete st[id]; delete syn[id]; changed = true;
                });
                Object.keys(syn).forEach(function (id) { if (!seen[kind + ':' + id] && !st[id]) delete syn[id]; });
            });
        }
        saveSynced();
        return changed;
    }

    function authLost() {
        setToken(null); stop();
        try { if (ctx && ctx.onAuthLost) ctx.onAuthLost(); } catch (e) { }
    }

    function doPull(full, revert) {
        var since = (!full && meta.cursor) ? meta.cursor : null;
        return http('sl_pull', { p_token: token(), p_since: since }).then(function (res) {
            if (!res.ok) { setStatus(res.offline ? 'offline' : 'error', res.message); return false; }
            var d = res.data || {};
            if (d.ok === false) { if (d.code === 'AUTH_REQUIRED') authLost(); else setStatus('error', d.code); return false; }
            if (d.me && meta.owner && meta.owner !== d.me.id) {   /* pengaman: data lokal milik akun lain -> bersihkan lalu ambil penuh */
                resetLocal();
                return doPull(true, {});
            }
            var changed = applyPull(d, revert || {});
            try { meta.cursor = new Date(new Date(d.now).getTime() - OVERLAP_MS).toISOString(); } catch (e) { meta.cursor = null; }
            if (d.me) meta.owner = d.me.id;
            saveMeta();
            status.lastSyncAt = Date.now();
            setStatus('ok');
            if (changed) { try { ctx.persistLocal(); ctx.onRemoteChange(); } catch (e) { } }
            return true;
        });
    }
    function pull(full, revert) {
        if (!ON || !ctx || !token()) return Promise.resolve(false);
        if (pulling) return pulling;
        pulling = doPull(full, revert).then(function (v) { pulling = null; return v; },
            function (e) { pulling = null; setStatus('error', String(e && e.message || e)); return false; });
        return pulling;
    }

    function chunkPush(list, rejectedAll) {
        if (!list.length) return Promise.resolve(true);
        var part = list.slice(0, CHUNK), rest = list.slice(CHUNK);
        var payload = part.map(function (c) {
            return c.del ? { kind: c.kind, id: c.id, delete: true }
                : { kind: c.kind, id: c.id, data: c.data, password: c.password || undefined };
        });
        return http('sl_push', { p_token: token(), p_changes: payload }).then(function (res) {
            if (!res.ok) { setStatus(res.offline ? 'offline' : 'error', res.message); return false; }
            var d = res.data || {};
            if (d.ok === false) { if (d.code === 'AUTH_REQUIRED') authLost(); else setStatus('error', d.code); return false; }
            var byKey = {};
            part.forEach(function (c) { byKey[c.kind + ':' + c.id] = c; });
            (d.accepted || []).forEach(function (a) {
                var c = byKey[a.kind + ':' + a.id]; if (!c) return;
                var syn = synced[a.kind] || (synced[a.kind] = {});
                if (c.del) delete syn[a.id]; else syn[a.id] = c.h;
                if (c.salt) delete plain[c.salt];
            });
            (d.rejected || []).forEach(function (r) {
                var c = byKey[r.kind + ':' + r.id]; if (!c) return;
                var key = r.kind + ':' + r.id;
                if (c.h) dead[key] = c.h;
                if (c.salt) delete plain[c.salt];
                rejectedAll.push({ kind: r.kind, id: r.id, reason: r.reason, text: REASON_TEXT[r.reason] || r.reason, del: !!c.del, existed: !!((synced[r.kind] || {})[r.id]) });
            });
            saveSynced();
            return chunkPush(rest, rejectedAll);
        });
    }

    function push() {
        if (!ON || !ctx || !token()) return Promise.resolve(false);
        if (pushing) { pushAgain = true; return pushing; }
        var list = computeChanges();
        status.pending = list.length;
        if (!list.length) return Promise.resolve(true);
        var rejected = [];
        pushing = chunkPush(list, rejected).then(function (ok) {
            pushing = null;
            status.pending = computeChanges().length;
            if (ok) setStatus('ok');
            if (rejected.length) handleRejected(rejected);
            if (pushAgain) { pushAgain = false; schedulePush(50); }
            return ok;
        }, function (e) { pushing = null; setStatus('error', String(e && e.message || e)); return false; });
        return pushing;
    }

    /* Perubahan yang ditolak server dikembalikan ke keadaan server, lalu pengguna diberi tahu. */
    function handleRejected(rej) {
        var revert = {}, needPull = false;
        rej.forEach(function (r) {
            var key = r.kind + ':' + r.id;
            if (!r.existed && !r.del) { var st = store(r.kind); if (st[r.id]) delete st[r.id]; delete dead[key]; }   /* dokumen baru yang ditolak: buang */
            else { revert[key] = true; needPull = true; }
        });
        try { ctx.persistLocal(); } catch (e) { }
        var done = needPull ? pull(true, revert) : Promise.resolve(true);
        done.then(function () {
            try { ctx.onRemoteChange(); } catch (e) { }
            try { if (ctx.onReject) ctx.onReject(rej); } catch (e) { }   /* terakhir: pesan tidak tertimpa render ulang */
        });
    }

    function schedulePush(ms) {
        if (!ON || !ctx || !token()) return;
        if (pushTimer) clearTimeout(pushTimer);
        var hasPw = false;
        for (var k in plain) { if (Object.prototype.hasOwnProperty.call(plain, k)) { hasPw = true; break; } }
        pushTimer = setTimeout(function () { pushTimer = null; push(); }, typeof ms === 'number' ? ms : (hasPw ? 30 : 700));
    }

    function resetLocal() {
        synced = {}; meta = {}; dead = {}; plain = {};
        jdel(ls(), K_SYNCED); jdel(ls(), K_META); jdel(ls(), K_PMETA);
        if (ctx && ctx.clearDb) ctx.clearDb();
    }

    /* ---------------- progres belajar ---------------- */
    function readBlob() {
        var o = {}, st = ls(); if (!st || !ctx) return o;
        (ctx.dataKeys || []).forEach(function (k) { try { var v = st.getItem(k); if (v != null) o[k] = v; } catch (e) { } });
        return o;
    }
    function writeBlob(blob) {
        var st = ls(); if (!st || !ctx) return;
        (ctx.dataKeys || []).forEach(function (k) { try { st.removeItem(k); } catch (e) { } });
        Object.keys(blob || {}).forEach(function (k) {
            if ((ctx.dataKeys || []).indexOf(k) >= 0 && typeof blob[k] === 'string') { try { st.setItem(k, blob[k]); } catch (e) { } }
        });
    }
    function hashBlob(b) { return fnv(canon(b)); }

    function prefetchProgress() {
        pendingBlob = undefined;
        return http('sl_progress_get', { p_token: token() }).then(function (res) {
            var n = norm(res);
            pendingBlob = (n.ok !== false && n.data && typeof n.data === 'object') ? n.data : null;
            return pendingBlob;
        });
    }
    /* Dipanggil setelah data pemilik lokal ditukar (switchDataOwner) saat login. */
    function applyProgress(owner) {
        if (pendingBlob === undefined || !ctx) return;
        var srv = pendingBlob; pendingBlob = undefined;
        var local = readBlob(), lh = hashBlob(local), pm = jget(ls(), K_PMETA, null);
        var localEmpty = Object.keys(local).length === 0, before = !!(pm && pm.owner === owner), changed = before && pm.hash !== lh;
        var hasSrv = !!(srv && Object.keys(srv).length);
        if (hasSrv && (localEmpty || (before && !changed) || !before)) {
            if (!localEmpty && !before) { try { ls().setItem('starterLab_progress_backup_' + owner, JSON.stringify(local)); } catch (e) { } }
            writeBlob(srv);
            jset(ls(), K_PMETA, { owner: owner, hash: hashBlob(readBlob()) });
        } else {
            jset(ls(), K_PMETA, { owner: owner, hash: hasSrv ? pm && pm.hash : '' });   /* lokal menang: watcher akan mengirimnya */
        }
    }
    function progressTick() {
        if (!ON || !ctx || !token() || !ctx.currentOwner) return Promise.resolve(true);
        var owner = ctx.currentOwner(); if (!owner) return Promise.resolve(true);
        var blob = readBlob(), h = hashBlob(blob), pm = jget(ls(), K_PMETA, null);
        if (pm && pm.owner === owner && pm.hash === h) return Promise.resolve(true);
        if (Object.keys(blob).length === 0 && !pm) return Promise.resolve(true);
        return http('sl_progress_put', { p_token: token(), p_data: blob }).then(function (res) {
            var n = norm(res);
            if (n.ok !== false && res.ok) { jset(ls(), K_PMETA, { owner: owner, hash: h }); return true; }
            if (n.code === 'AUTH_REQUIRED') authLost();
            return false;
        });
    }
    /* Guru/Superadmin: salin progres siswa ke 'stash' lokal agar dashboard dapat membacanya. */
    function pullOrgProgress() {
        if (!ON || !ctx || !token() || !ctx.stashWrite) return Promise.resolve(false);
        return http('sl_progress_org', { p_token: token() }).then(function (res) {
            var n = norm(res);
            if (!res.ok || n.ok === false || !Array.isArray(n.rows)) return false;
            var any = false;
            n.rows.forEach(function (r) { try { if (ctx.stashWrite(r.username, r.data)) any = true; } catch (e) { } });
            if (any) { try { ctx.onRemoteChange(); } catch (e) { } }
            return any;
        });
    }

    /* ---------------- siklus hidup ---------------- */
    function tick() {
        var d = G.document;
        if (d && d.visibilityState === 'hidden') return;
        tickN++;
        pull(false).then(function () { return push(); }).then(function () {
            var me = ctx && ctx.currentRole && ctx.currentRole();
            if ((me === 'INSTRUCTOR' || me === 'ADMIN') && tickN % 3 === 1) pullOrgProgress();
        });
    }
    function start() {
        if (!ON || !ctx || !token() || started) return Promise.resolve(false);
        started = true;
        var first = pull(!meta.cursor).then(function () { return push(); }).then(function () {
            var role = ctx.currentRole && ctx.currentRole();
            if (role === 'INSTRUCTOR' || role === 'ADMIN') return pullOrgProgress();
        });
        pollTimer = setInterval(tick, POLL_MS);
        progTimer = setInterval(progressTick, PROGRESS_MS);
        try {
            if (G.addEventListener) {
                G.addEventListener('online', tick);
                G.addEventListener('focus', tick);
            }
            if (G.document && G.document.addEventListener) G.document.addEventListener('visibilitychange', tick);
        } catch (e) { }
        return first;
    }
    function stop() {
        started = false;
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (progTimer) { clearInterval(progTimer); progTimer = null; }
        if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    }
    function withTimeout(p, ms) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(false); }, ms); })]); }

    /* ---------------- API publik ---------------- */
    var Cloud = {
        enabled: function () { return ON; },
        token: token,
        hasToken: function () { return !!token(); },
        status: function () { return status; },

        attach: function (c) { ctx = c; },
        start: start,
        stop: stop,
        pull: function (full) { return pull(!!full); },
        push: push,
        schedulePush: schedulePush,
        pullOrgProgress: pullOrgProgress,
        notePlain: function (salt, pw) { if (ON && salt && pw) plain[salt] = pw; },
        resetLocal: resetLocal,

        listSchools: function () {
            return http('sl_list_schools', {}).then(function (res) { return res.ok && Array.isArray(res.data) ? res.data : null; });
        },
        login: function (username, password, portal) {
            return http('sl_login', { p_username: username, p_password: password, p_portal: portal || 'general' }).then(function (res) {
                var n = norm(res);
                if (n.ok === false) return n;
                if (meta.owner && n.user && meta.owner !== n.user.id) resetLocal();   /* browser dipakai akun lain: bersihkan data lokal */
                setToken(n.token);
                return { ok: true, user: n.user, mustChange: !!n.mustChange };
            });
        },
        /* Kirim perubahan yang tertunda, lalu cabut token. flushed=false bila gagal terkirim (data lokal dipertahankan). */
        logout: function () {
            var t = token();
            stop();
            if (!t) return Promise.resolve({ flushed: true });
            var flush = ctx ? withTimeout(Promise.resolve().then(function () { return Promise.all([progressTick(), push()]).then(function (r) { return r[0] !== false && r[1] !== false; }); }), 6000) : Promise.resolve(true);
            return flush.then(function (ok) {
                var pend = ctx ? computeChanges().length : 0;
                var flushed = ok !== false && pend === 0;
                return http('sl_logout', { p_token: t }).then(function () {
                    setToken(null);
                    if (flushed) { resetLocal(); if (ctx && ctx.wipeLocal) { try { ctx.wipeLocal(); } catch (e) { } } }
                    setStatus('idle');
                    return { flushed: flushed };
                });
            });
        },
        clearToken: function () { setToken(null); stop(); },
        me: function () { return http('sl_me', { p_token: token() }).then(norm); },
        changePassword: function (oldPw, newPw) {
            return http('sl_change_password', { p_token: token(), p_old: oldPw, p_new: newPw }).then(norm);
        },
        registerUser: function (role, name, username, email, password, orgId) {
            return http('sl_register_user', { p_role: role, p_name: name, p_username: username, p_email: email || null, p_password: password, p_org_id: orgId }).then(norm);
        },
        registerSchool: function (name, address, adminName, adminUsername, adminPassword) {
            return http('sl_register_school', { p_name: name, p_address: address || '', p_admin_name: adminName, p_admin_username: adminUsername, p_admin_password: adminPassword }).then(norm);
        },
        joinClass: function (code) {
            return http('sl_join_class', { p_token: token(), p_code: code }).then(norm).then(function (n) {
                if (n.ok === false && n.code === 'AUTH_REQUIRED') authLost();
                return n;
            });
        },
        prefetchProgress: prefetchProgress,
        applyProgress: applyProgress,

        _test: { canon: canon, fnv: fnv, computeChanges: computeChanges, applyPull: applyPull, strip: strip, tick: tick, progressTick: progressTick }
    };

    G.StarterCloud = Cloud;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
