'use strict';
/* SERVER LOKAL untuk membuka Simulator Starter (Phase 8 platform, deterministik).
   Zero-dependency: hanya modul bawaan Node (http/fs/path/url).
   ASCII murni (tanpa karakter non-ASCII) agar aman dibaca semua tool/editor.
---------------------------------------------------------------------------- */
var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = __dirname;
var PORT = Number(process.env.SIM_PORT || 8088);
var HOST = process.env.SIM_HOST || '127.0.0.1';

/* ---- Backend progres (node:sqlite, zero-dependency) ---- */
var dbFile = process.env.SIM_DB || path.join(ROOT, 'data', 'startersim.sqlite');
try {
    var DB_DIR = path.dirname(dbFile);
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
} catch (e) { /* read-only? */ }
var db = require('./backend/db').openDb(dbFile);
var seedMod = require('./backend/seed');
seedMod.seed(db);
seedMod.flagDefaultPasswords(db);
seedMod.ensureRoster(db);   /* no-op kecuali data/roster.json ada */
var service = require('./backend/api').api(db);

var MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.glb': 'model/gltf-binary',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif'
};

function safeJoin(base, target) {
    var clean = String(target || '').replace(/^[/\\]+/, '').replace(/[\\]+/g, '/');
    if (!clean || clean.indexOf('..') === 0 || clean.split('/').indexOf('..') !== -1) {
        return null;
    }
    var joined = path.join(base, clean);
    var resolved = path.resolve(joined);
    if (resolved.indexOf(path.resolve(base)) !== 0) {
        return null;
    }
    return resolved;
}

function toUtf8(obj) { return JSON.stringify(obj, null, 2); }

function runMenuPanduan(req, res) {
    var body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
        var actor = null;
        try {
            actor = (body && JSON.parse(body).actor) || null;
        } catch (e) { /* body kosong -> guest */ }
        var result;
        try {
            var P8 = require(path.join(ROOT, 'instructorPlatform.js'));
            var svc = P8.menuPanduanService;
            result = svc.drive({ actor: actor });

 /* handle RBAC error model: drive mengembalikan apiResult/apiError */
        } catch (err) {
            result = { success: false, error: { code: 'SERVER_ERROR', message: String(err && err.message) } };
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(toUtf8(result));
    });
}

function collectBody(req, cb) {
    var body = '';
    req.on('data', function (c) { body += c; if (body.length > 2 * 1024 * 1024) req.destroy(); });
    req.on('end', function () { cb(body); });
}

function handleApi(req, res, pathname) {
    var method = (req.method || 'GET').toUpperCase();
    if (pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, data: { status: 'ok', db: 'sqlite' } }));
        return true;
    }
    var re = new RegExp('^/api/v1/([^/?]+)(?:/([^/?]+))?(?:/([^/?]+))?(?:/(progress.csv))?');
    var seg = re.exec(pathname);
    if (!seg) return false;
    var m1 = seg[1] || '', m2 = seg[2] || '', m3 = seg[3] || '';
    var action = null;
    if (m1 === 'auth') {
        if (method === 'POST' && m2 === 'login') action = service.login;
        else if (method === 'POST' && m2 === 'logout') action = service.logout;
        else if (method === 'POST' && m2 === 'change-password') action = service.changePassword;
        else if (method === 'GET' && m2 === 'me') action = service.me;
        else action = 'none';
    } else if (m1 === 'me' && method === 'PUT') {
        action = service.updateMe;
    } else if (m1 === 'teacher' && m2 === 'students' && m3 && method === 'PUT') {
        action = service.teacherUpdateStudent;
    } else if (m1 === 'progress' && method === 'GET') {
        if (m2 === '') action = service.myProgress;
        else if (m2 === 'activity') action = service.myActivity;
        else action = 'none';
    } else if (m1 === 'progress' && method === 'POST') {
        if (m2 === 'module') action = service.recordModule;
        else if (m2 === 'event') action = service.recordEvent;
        else if (m2 === 'assessment') action = service.recordAssessment;
        else if (m2 === 'session') action = service.recordSession;
        else if (m2 === 'attempt') action = service.recordAttempt;
        else if (m2 === 'import') action = service.importLocal;
        else action = 'none';
    } else if (m1 === 'teacher' && method === 'GET' && m2 === 'classes') {
        action = service.teacherClasses;
    } else if (m1 === 'classes' && m2 === '' && method === 'POST') {
        action = service.createClass;
    } else if (m1 === 'classes' && m2 && m3 === 'students' && method === 'GET') {
        action = service.classStudents;
    } else if (m1 === 'classes' && m2 && m3 === 'students' && method === 'POST') {
        action = service.addStudentToClass;
    } else if (m1 === 'classes' && m2 && m3 === 'progress' && method === 'GET') {
        action = service.classProgress;
    } else if (m1 === 'classes' && m2 && m3 === 'modules' && method === 'GET') {
        action = service.classModules;
    } else if (m1 === 'classes' && m2 && m3 === 'progress.csv' && method === 'GET') {
        action = service.exportCsv;
    } else if (m1 === 'students' && m2 && m3 === '' && method === 'GET') {
        action = service.studentDetail;
    } else if (m1 === 'students' && m2 && m3 === 'feedback' && method === 'POST') {
        action = service.addFeedback;
    } else if (m1 === 'admin' && m2 === 'stats' && method === 'GET') {
        action = service.adminStats;
    } else if (m1 === 'admin' && m2 === 'users' && method === 'GET') {
        action = service.adminUsers;
    } else if (m1 === 'admin' && m2 === 'users' && method === 'POST') {
        action = service.adminCreateUser;
    } else if (m1 === 'admin' && m2 === 'users' && m3 && method === 'PATCH') {
        action = service.adminSetUserStatus;
    } else if (m1 === 'admin' && m2 === 'users' && m3 && method === 'PUT') {
        action = service.adminUpdateUser;
    } else {
        action = 'none';
    }
    if (!action || action === 'none') {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint tidak ada.' } }));
        return true;
    }
    collectBody(req, function (raw) {
        var parsed = null;
        if (raw && method !== 'GET') {
            try { parsed = JSON.parse(raw); } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: { code: 'BAD_JSON', message: 'Body harus JSON.' } }));
                return;
            }
        }
        try {
            action(req, res, parsed, { classId: m2, studentId: m2, userId: ((m1 === 'admin' || m1 === 'teacher') ? m3 : m2) });
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: { code: 'SERVER_ERROR', message: String(e && e.message) } }));
        }
    });
    return true;
}

var server = http.createServer(function (req, res) {
    var pathname;
    try {
        pathname = decodeURIComponent(new (require('url').URL)('http://x' + req.url).pathname);
    } catch (e) {
        pathname = '/';
    }
    if (pathname === '/api/panduan') {
        runMenuPanduan(req, res);
        return;
    }
    if (pathname.indexOf('/api') === 0) {
        if (handleApi(req, res, pathname)) return;
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint tidak ada.' } }));
        return;
    }
    if (pathname === '/' || pathname === '') {
        pathname = '/login.html';   /* link utama selalu membuka halaman login, bukan simulator */
    }
    /* link login terpisah: /superadmin untuk Superadmin, /login untuk Siswa/Guru */
    if (pathname === '/superadmin') pathname = '/superadmin.html';
    if (pathname === '/login') pathname = '/login.html';
    var filePath = safeJoin(ROOT, pathname);
    if (!filePath) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('FORBIDDEN: path di luar direktori simulator.');
        return;
    }
    fs.readFile(filePath, function (err, data) {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 - File tidak ditemukan di simulator.');
            return;
        }
        var ext = path.extname(filePath).toLowerCase();
        var type = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        res.end(data);
    });
});

server.listen(PORT, HOST, function () {
    console.log('==============================================');
    console.log('  SIMULATOR STARTER (Phase 8, deterministik)');
    console.log('  Buka di browser : http://127.0.0.1:' + PORT + '/');
    console.log('  Menu panduan    : http://127.0.0.1:' + PORT + '/api/panduan');
    console.log('  (Tekan Ctrl+C untuk menghentikan server)');
    console.log('==============================================');
});

process.on('SIGINT', function () {
    console.log('\nServer dihentikan.');
    process.exit(0);
});

