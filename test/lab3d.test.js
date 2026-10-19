/* LAB3D TEST - scene 3D membangun SEMUA komponen sistem starter dan kabelnya.
   Three.js dijalankan di Node (tanpa WebGL): hanya graf scene dibangun & diperiksa.
   Run: node test/lab3d.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.log('  FAIL: ' + m); } }

const src = fs.readFileSync(path.join(ROOT, 'visual3d.js'), 'utf8');
const cut = src.lastIndexOf('})();');
const hooked = src.slice(0, cut) + "\n    G.__scene = { build: function () { sceneObj = new THREE.Scene(); buildSceneGraph(); return { pick: pickables, anchors: anchors, cables: G3D.cables, G3D: G3D, scene: sceneObj, COMPONENTS: COMPONENTS, REQUIRED: REQUIRED_IDS, ids: getComponentIdsIncludingHelpers() }; } };\n" + src.slice(cut);

const ctx = { console, setTimeout, clearTimeout, Math, Date, JSON, Object, Array, String, Number, RegExp, Promise, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Float64Array, ArrayBuffer, Map, Set, Symbol, WeakMap, isFinite, isNaN, parseFloat, parseInt };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { createElement: () => ({ getContext: () => null, style: {}, appendChild() {}, addEventListener() {}, setAttribute() {} }), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: { appendChild() {} } };
ctx.navigator = { userAgent: 'node' }; ctx.requestAnimationFrame = () => 0; ctx.addEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'three.min.js'), 'utf8'), ctx);
vm.runInContext(hooked, ctx);
const T = ctx.THREE;

console.log('LAB3D TEST');
const r = ctx.__scene.build();
const count = {};
r.pick.forEach((m) => { count[m.userData.componentId] = (count[m.userData.componentId] || 0) + 1; });

/* 8 komponen yang diminta */
const WANT = {
    'Baterai': 'battery', 'Fuse': 'fuse', 'Kunci kontak': 'ignitionSwitch', 'Relay': 'starterRelay',
    'Selenoid': 'starterSolenoid', 'Motor starter': 'starterHousing', 'Fly wheel': 'flywheel', 'Mesin': 'engineBlock'
};
Object.keys(WANT).forEach((n) => {
    assert(count[WANT[n]] > 0, 'K1 ' + n + ' ada di scene 3D (' + (count[WANT[n]] || 0) + ' bagian dapat diklik)');
    assert(r.COMPONENTS[WANT[n]] && r.COMPONENTS[WANT[n]].label, 'K2 ' + n + ' punya info/label untuk panel komponen');
    assert(r.ids.indexOf(WANT[n]) >= 0, 'K3 ' + n + ' muncul di daftar komponen lab 3D');
    assert(r.REQUIRED.indexOf(WANT[n]) >= 0 || WANT[n] === 'starterHousing', 'K4 ' + n + ' terdaftar sebagai komponen wajib');
});
assert(Object.keys(count).every((k) => r.COMPONENTS[k]), 'K5 setiap bagian yang dapat diklik punya info komponen');
assert(r.REQUIRED.every((k) => r.COMPONENTS[k]), 'K6 semua ID wajib punya info');

/* grup & kotak batas: tidak saling bertumpuk */
const names = ['battery', 'fuseBox', 'ignitionSwitch', 'relayBox', 'starterMotor', 'engine'];
const box = {};
names.forEach((n) => {
    const o = r.scene.getObjectByName(n);
    assert(!!o, 'G1 grup 3D "' + n + '" ada');
    if (o) { o.updateMatrixWorld(true); box[n] = new T.Box3().setFromObject(o); }
});
const small = ['battery', 'fuseBox', 'ignitionSwitch', 'relayBox'];
for (let i = 0; i < small.length; i++) for (let j = i + 1; j < small.length; j++) {
    assert(!box[small[i]].intersectsBox(box[small[j]]), 'G2 ' + small[i] + ' tidak bertumpuk dengan ' + small[j]);
}
['battery', 'fuseBox', 'ignitionSwitch', 'relayBox'].forEach((n) => assert(box[n].min.y >= -2.64, 'G4 ' + n + ' berdiri di lantai (tidak tenggelam)'));
const whole = new T.Box3(); names.forEach((n) => box[n] && whole.union(box[n]));
const FULL = { target: [0.2, -0.55, -0.4], dist: 11.2 };
const size = whole.getSize(new T.Vector3());
assert(size.length() / 2 < FULL.dist * 0.75, 'G5 preset FULL cukup jauh untuk memuat seluruh sistem (radius ' + (size.length() / 2).toFixed(1) + ' < jarak ' + FULL.dist + ')');

/* rangkaian kabel sesuai diagram */
assert(r.cables.length >= 9, 'W1 kabel lengkap (' + r.cables.length + ' kabel)');
function endpoints(c) { return [c.curve.getPoint(0), c.curve.getPoint(1)]; }
const near = (p, q, d) => p.distanceTo(new T.Vector3(q[0], q[1], q[2])) <= (d || 0.12);
const has = (a, b) => r.cables.some((c) => { const e = endpoints(c); return (near(e[0], a) && near(e[1], b)) || (near(e[0], b) && near(e[1], a)); });
const P = { bPlus: [-1.97, -1.69, 1.5], fuseIn: [-1.94, -2.34, 2.45], fuseOut: [-1.66, -2.34, 2.45], ignIn: [-0.65, -1.82, 2.36], ignOut: [-0.35, -1.82, 2.36], r30: [-1.14, -1.98, 1.43], r87: [-1.02, -1.98, 1.43], r86: [-1.14, -1.98, 1.57], r85: [-1.02, -1.98, 1.57] };
assert(has(P.bPlus, P.fuseIn), 'W2 aki (+) -> fuse IN');
assert(has(P.fuseOut, P.ignIn), 'W3 fuse OUT -> kunci kontak IN');
assert(has(P.fuseOut, P.r30), 'W4 fuse OUT -> relay kaki 30');
assert(has(P.ignOut, P.r86), 'W5 kunci kontak OUT -> relay kaki 86');
assert(r.cables.some((c) => near(endpoints(c)[0], P.r85, 0.12)), 'W6 relay kaki 85 -> massa');
assert(r.cables.some((c) => near(endpoints(c)[0], P.r87, 0.12) && near(endpoints(c)[1], [-0.26, 0.6, 0.0], 0.12)), 'W7 relay kaki 87 -> terminal S (50) selenoid');
/* terminal fisik berada di dekat ujung kabel */
function worldCenter(name) { const o = r.scene.getObjectByName(name); o.updateMatrixWorld(true); return new T.Box3().setFromObject(o); }
const fb = worldCenter('fuseBox'), ig = worldCenter('ignitionSwitch'), rb = worldCenter('relayBox');
const inside = (b, p, pad) => p[0] >= b.min.x - pad && p[0] <= b.max.x + pad && p[1] >= b.min.y - pad && p[1] <= b.max.y + pad && p[2] >= b.min.z - pad && p[2] <= b.max.z + pad;
assert(inside(fb, P.fuseIn, 0.1) && inside(fb, P.fuseOut, 0.1), 'W8 ujung kabel fuse berada di kotak fuse');
assert(inside(ig, P.ignIn, 0.1) && inside(ig, P.ignOut, 0.1), 'W9 ujung kabel kunci kontak berada di panel kunci kontak');
assert([P.r30, P.r87, P.r86, P.r85].every((p) => inside(rb, p, 0.1)), 'W10 keempat kaki relay berada di kotak relay');

/* relay 4 kaki + label */
['30', '85', '86', '87'].forEach((n) => assert(!!r.anchors['m:relay' + n] && /Kaki/.test(r.anchors['m:relay' + n].text), 'R1 label kaki relay ' + n));
assert(!!r.anchors.ignitionSwitch && !!r.anchors.fuse && !!r.anchors.battery && !!r.anchors.starterRelay && !!r.anchors.starterSolenoid, 'R2 label utama komponen ada');
assert(!!r.anchors['m:ignIN'] && !!r.anchors['m:ignOUT'] && !!r.anchors['m:fuseIn'] && !!r.anchors['m:fuseOut'], 'R3 label terminal fuse & kunci kontak');

/* kunci kontak dapat berputar */
assert(!!r.G3D.ignKey && typeof r.G3D.ignKey.rotation.z === 'number', 'I1 kunci pada kunci kontak dapat diputar (animasi OFF/ON/START)');
const p6 = fs.readFileSync(path.join(ROOT, 'visual3d.js'), 'utf8');
assert(/ipos === 'START' \? -1\.45/.test(p6) && /ipos === 'ON' \? -0\.72/.test(p6), 'I2 sudut kunci mengikuti posisi OFF/ON/START');

/* mesin tampak utuh */
const eng = r.scene.getObjectByName('engine'); const parts = [];
eng.traverse((o) => { if (o.isMesh && o.userData.componentId === 'engineBlock') parts.push(o); });
assert(parts.length >= 6, 'E1 mesin terdiri dari blok, oil pan, kepala silinder, tutup katup, bell housing (' + parts.length + ' bagian)');
const blockMat = parts.filter((m) => m.material && m.material.transparent).map((m) => m.material.opacity);
assert(blockMat.every((o) => o >= 0.25), 'E2 blok mesin cukup terlihat (opasitas >= 0.25)');

/* fallback 2D memuat komponen baru */
assert(/data-cid="ignitionSwitch"/.test(p6) && /data-cid="engineBlock"/.test(p6), 'F1 tampilan cadangan 2D juga memuat kunci kontak & mesin');
assert(/var h = 480, w = 820/.test(p6), 'F2 kanvas 2D cukup tinggi agar flywheel & mesin tidak terpotong');

console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed ? 1 : 0);
