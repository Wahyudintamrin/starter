/* ============================================================
   A11Y TEST — pemeriksaan statis aksesibilitas markup
   Memeriksa index.html / login.html tanpa DOM (murni Node).
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.log('  FAIL: ' + msg); } }
function count(text, re) { return (text.match(re) || []).length; }

const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const login = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

console.log('A11Y TEST — aksesibilitas markup');

/* kartu Beranda dapat diakses keyboard */
assert(count(index, /class="beranda-card" role="button" tabindex="0"/g) === 6, '6 kartu Beranda punya role="button" + tabindex="0"');
assert(count(index, /onkeydown="cardKey\(/g) === 6, '6 kartu Beranda punya handler keyboard');
assert(/window\.cardKey\s*=/.test(app), 'app.js mengekspos window.cardKey');

/* ikon dekoratif disembunyikan dari screen reader */
assert(count(index, /<svg aria-hidden="true" focusable="false" width="20" height="20"/g) === 12, '12 ikon navigasi aria-hidden');
assert(count(index, /<div class="card-icon [a-z]+-icon" aria-hidden="true">/g) === 6, '6 ikon kartu aria-hidden');
assert(/<svg aria-hidden="true" focusable="false" width="32" height="32"/.test(index), 'logo aria-hidden');

/* struktur heading */
assert(/<h1>Simulator Sistem Starter<\/h1>/.test(index), 'halaman Simulator punya <h1>');
assert(!/<h2>Simulator Sistem Starter<\/h2>/.test(index), 'tidak ada lagi <h2> Simulator (heading hilang)');
assert(/<h1[^>]*>/.test(login), 'login.html punya <h1>');
assert(/class="sr-only"/.test(login), 'login.html memakai teks sr-only');
const superadminPage = fs.readFileSync(path.join(ROOT, 'superadmin.html'), 'utf8');
assert(/<h1[^>]*>/.test(superadminPage), 'superadmin.html punya <h1>');
assert(/class="sr-only"/.test(superadminPage), 'superadmin.html memakai teks sr-only');

/* tombol ikon punya nama aksesibel */
const closeTimes = index.match(/<button class="btn-close"[^>]*>&times;<\/button>/g) || [];
assert(closeTimes.length >= 2, 'ditemukan tombol tutup &times;');
assert(closeTimes.every(b => /aria-label=/.test(b)), 'semua tombol tutup &times; punya aria-label');

/* panduan singkat simulator (mode terbimbing untuk pemula) */
assert(/<details class="sim-guide"/.test(index), 'simulator punya panduan singkat (details.sim-guide)');
assert(/Panduan singkat — mulailah di sini/.test(index), 'summary panduan singkat ada');
const guideLi = (index.match(/<details class="sim-guide"[\s\S]*?<\/details>/) || [''])[0];
assert(count(guideLi, /<li>/g) === 4, 'panduan singkat memuat 4 langkah');
assert(count(index, /class="tb-more"/g) === 1, 'toolbar memilah fitur lanjutan dalam menu "Lainnya"');
assert(count(index, /onclick="toggleFaultPanel\(\)" title="/g) === 1, 'tombol Fault punya tooltip jelas');
assert(count(index, /onclick="resetSimulation\(\)" title="/g) >= 2, 'tombol Reset (toolbar & panel) punya tooltip jelas');

console.log('=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed ? 1 : 0);
