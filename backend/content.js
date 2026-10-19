'use strict';
/* ============================================================================
   KONTEN STARTERSIM -> TABEL learning_modules
   ----------------------------------------------------------------------------
   Memuat daftar modul/content yang BENAR-BENAR ada di aplikasi dari file data
   asli (HUB_MATERI, HUB_QUIZZES, LEARNING_JOB_SHEETS, HUB_DIAG_CASES) via vm
   sandbox. Tidak mengarang konten baru.
   ============================================================================ */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');

function loadGlobals(file, names) {
    var sandbox = { window: {}, console: console, Date: Date, Math: Math };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    var out = {};
    names.forEach(function (n) { out[n] = sandbox[n] || null; });
    return out;
}

function contentSnapshot() {
    var hub = loadGlobals(path.join(ROOT, 'learningHub-data.js'),
        ['HUB_MATERI', 'HUB_QUIZZES', 'HUB_DIAG_CASES', 'HUB_KKM']);
    var js = loadGlobals(path.join(ROOT, 'learningJobSheets.js'), ['LEARNING_JOB_SHEETS']);
    /* 14 materi: id angka 1..14 dengan urutan yang diberikan data */
    var materi = (hub.HUB_MATERI || []).map(function (m, i) {
        return { id: 'mod-' + m.id, code: 'M' + m.id, type: 'MATERI', title: m.title, seq: i + 1, required: 1, competency: null, criteria: null };
    });
    var jobs = (js.LEARNING_JOB_SHEETS || []).map(function (j, i) {
        return { id: 'mod-' + j.id, code: j.id, type: 'JOB_SHEET', title: j.title, seq: 100 + i + 1, required: 1, competency: null, criteria: null };
    });
    var cases = (hub.HUB_DIAG_CASES || []).map(function (c, i) {
        return { id: 'mod-' + c.id, code: c.id, type: 'KASUS_DIAGNOSIS', title: c.judul || c.title || c.nama || c.id, seq: 200 + i + 1, required: 1, competency: null, criteria: null };
    });
    var quizzes = (hub.HUB_QUIZZES || []).map(function (q, i) {
        return { id: 'mod-' + q.id, code: q.id, type: 'KUIS', title: q.title, seq: 300 + i + 1, required: 1, competency: null, criteria: null };
    });
    return { materi: materi, jobs: jobs, cases: cases, quizzes: quizzes, kkm: hub.HUB_KKM };
}

function moduleRows() {
    var s = contentSnapshot();
    return [].concat(s.materi, s.jobs, s.cases, s.quizzes);
}

module.exports = { contentSnapshot: contentSnapshot, moduleRows: moduleRows };