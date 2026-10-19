/* WIRING TEST - jaringan kabel diagram harus berujung tepat di terminal komponen.
   Relay 4 kaki (30, 86, 85, 87) masing-masing tersambung ke jaringan kelistrikan.
   Run: node test/wiring.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.log('  FAIL: ' + m); } }

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const svg = html.slice(html.indexOf('<svg id="starterSVG"'), html.indexOf('</svg>', html.indexOf('<!-- Phase 3: Measurement points')));
const key = (x, y) => x + ',' + y;

/* terminal, junction, simbol massa */
const terms = {};
(svg.match(/<circle class="dg-term terminal"[^>]*>/g) || []).forEach((t) => {
    const cx = t.match(/cx="([\d.]+)"/)[1], cy = t.match(/cy="([\d.]+)"/)[1];
    terms[key(cx, cy)] = true;
});
const junctions = {};
const jg = svg.match(/<g class="junctions"[\s\S]*?<\/g>/)[0];
(jg.match(/<circle[^>]*>/g) || []).forEach((t) => { junctions[key(t.match(/cx="([\d.]+)"/)[1], t.match(/cy="([\d.]+)"/)[1])] = true; });
const groundSym = { '880,460': true };

/* kabel: titik awal & akhir */
const wires = {};
(svg.match(/<path id="wire-[^"]+"[^>]*>/g) || []).forEach((t) => {
    const id = t.match(/id="([^"]+)"/)[1];
    const cls = t.match(/class="([^"]+)"/)[1];
    const d = t.match(/ d="([^"]+)"/)[1];
    const pts = (d.match(/-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/g) || []).map((p) => p.trim().split(/\s+/));
    wires[id] = { cls, start: key(pts[0][0], pts[0][1]), end: key(pts[pts.length - 1][0], pts[pts.length - 1][1]) };
});
const anchored = (k) => !!(terms[k] || junctions[k] || groundSym[k]);

console.log('WIRING TEST');
const ids = Object.keys(wires);
assert(ids.length >= 12, 'W1 jaringan kabel lengkap (' + ids.length + ' kabel)');
ids.forEach((id) => {
    assert(anchored(wires[id].start), 'W2 awal ' + id + ' tepat di terminal/junction (' + wires[id].start + ')');
    assert(anchored(wires[id].end), 'W3 akhir ' + id + ' tepat di terminal/junction (' + wires[id].end + ')');
});

/* relay 4 kaki */
const relayG = svg.slice(svg.indexOf('id="comp-relay"'), svg.indexOf('id="comp-solenoid"'));
const pins = (relayG.match(/<circle class="dg-term terminal"[^>]*>/g) || []).map((t) => key(t.match(/cx="([\d.]+)"/)[1], t.match(/cy="([\d.]+)"/)[1]));
assert(pins.length === 4, 'R1 relay memiliki tepat 4 kaki/terminal (' + pins.length + ')');
['30', '85', '86', '87'].forEach((n) => assert(new RegExp('>' + n + '</text>').test(relayG), 'R2 label kaki ' + n + ' ada'));
const usedBy = (pin) => ids.filter((id) => wires[id].start === pin || wires[id].end === pin);
pins.forEach((p) => assert(usedBy(p).length >= 1, 'R3 kaki di ' + p + ' tersambung ke kabel: ' + usedBy(p).join(',')));
assert(wires['wire-fuse-relay'].end === '445,310' && wires['wire-fuse-relay'].start === '200,220', 'R4 kaki 30 <- keluaran fuse (junction)');
assert(wires['wire-ign-relay'].end === '420,335' && wires['wire-ign-relay'].start === '360,268', 'R5 kaki 86 <- keluaran kunci kontak');
assert(wires['wire-ground-relay'].start === '445,380' && /ground-wire/.test(wires['wire-ground-relay'].cls), 'R6 kaki 85 -> jaringan massa');
assert(wires['wire-relay-solenoid'].start === '500,335' && wires['wire-relay-solenoid'].end === '585,300', 'R7 kaki 87 -> terminal 50 selenoid');
assert(new Set(pins.map((p) => usedBy(p).join())).size === 4, 'R8 setiap kaki memakai kabel yang berbeda (tidak ada kaki digabung)');

/* hubungan antar komponen */
assert(wires['wire-bat-solenoid'].start === '142,100' && wires['wire-bat-solenoid'].end === '645,245', 'C1 kabel utama: kutub (+) aki -> terminal 30 selenoid');
assert(wires['wire-solenoid-starter'].start === '655,305' && wires['wire-solenoid-starter'].end === '700,330', 'C2 terminal C selenoid -> terminal + motor starter');
assert(wires['wire-ground-bat'].start === '88,100' && wires['wire-ground-bat'].end === '770,460', 'C3 kutub (-) aki -> bus massa -> blok mesin');
assert(wires['wire-ground-starter'].start === '700,400' && wires['wire-ground-solenoid'].start === '625,325', 'C4 casing starter & massa selenoid ke bus massa');
assert(wires['wire-bat-fuse'].end === '200,170' && wires['wire-fuse-ign'].start === '200,200' && wires['wire-fuse-ign'].end === '300,268', 'C5 aki -> fuse -> kunci kontak lewat terminal IN/OUT');

/* titik ukur multimeter tepat di terminal & sinkron dengan model phase3 */
const dots = {};
(svg.match(/<circle id="mp-[^"]+"[^>]*>/g) || []).forEach((t) => {
    dots[t.match(/data-mp="([^"]+)"/)[1]] = key(t.match(/cx="([\d.]+)"/)[1], t.match(/cy="([\d.]+)"/)[1]);
});
Object.keys(dots).forEach((n) => {
    if (n === 'starterHousing') return; /* badan starter, bukan terminal kabel */
    assert(terms[dots[n]], 'M1 titik ukur ' + n + ' tepat di terminal (' + dots[n] + ')');
});
assert(dots.relayFeed === '445,310', 'M2 titik ukur baru kaki 30 (relayFeed) ada');
const p3 = fs.readFileSync(path.join(ROOT, 'multimeter.js'), 'utf8');
Object.keys(dots).forEach((n) => {
    const m = p3.match(new RegExp(n + ':\\s*\\{[^}]*x:\\s*(\\d+),\\s*y:\\s*(\\d+)'));
    assert(m && key(m[1], m[2]) === dots[n], 'M3 koordinat NODES phase3 untuk ' + n + ' sama dengan titik di diagram');
});
assert(/add\('fuseOutput', 'relayFeed'/.test(p3) && /add\('relayFeed', 'relayOutput'/.test(p3), 'M4 model resistansi: fuse -> kaki 30 -> kontak 30-87 -> kaki 87');
assert(/'relayfeed': V\.relayFeed/.test(fs.readFileSync(path.join(ROOT, 'realtimeParameter.js'), 'utf8')), 'M5 model tegangan phase2 mengenal relayFeed');

/* animasi & status */
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
assert(/\.relay-feed-wire/.test(app) && /\.relay-out-wire/.test(app), 'A1 app.js menyalakan kabel kaki 30 & 87 hanya saat kontak relay menutup');
['seg-control', 'seg-main', 'seg-solenoid-control', 'seg-starter'].forEach((id) => assert(svg.indexOf('id="' + id + '"') >= 0, 'A2 segmen arus ' + id + ' ada'));
const partPaths = (svg.match(/animateMotion[^>]*path="([^"]+)"/g) || []).map((t) => t.match(/path="([^"]+)"/)[1]);
assert(partPaths.length === 8, 'A4 delapan partikel arus mengikuti jalur baru (' + partPaths.length + ')');
['M 200 220 L 445 220 L 445 310', 'M 445 380 L 445 460', 'M 500 335 L 540 335 L 540 300 L 585 300'].forEach((p) => assert(partPaths.indexOf(p) >= 0, 'A5 partikel pada jalur relay: ' + p));
['status-battery', 'status-fuse', 'status-ignition', 'status-relay', 'status-solenoid', 'status-starter', 'status-engine', 'fuseElement', 'ignKey', 'relayCoil', 'solenoidPlunger', 'armatureGroup', 'flywheelGroup', 'pinionGroup']
    .forEach((id) => assert(svg.indexOf('id="' + id + '"') >= 0, 'A6 elemen animasi/status #' + id + ' tetap ada'));
const photos = fs.readFileSync(path.join(ROOT, 'diagramPhotos.js'), 'utf8');
assert(/dg-term/.test(photos), 'A7 mode foto menjaga terminal & kaki tetap terlihat');

console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed ? 1 : 0);
