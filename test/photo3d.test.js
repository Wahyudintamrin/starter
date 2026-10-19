/* PHOTO3D TEST - kunci kontak, fuse, relay memakai foto asli (mode http).
   Three.js dijalankan di Node (tanpa WebGL): hanya graf scene dibangun & diperiksa.
   Run: node test/photo3d.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.log('  FAIL: ' + m); } }

const src = fs.readFileSync(path.join(ROOT, 'visual3d.js'), 'utf8');
const cut = src.lastIndexOf('})();');
const hooked = src.slice(0, cut) + "\n    G.__scene = { build: function () { sceneObj = new THREE.Scene(); buildSceneGraph(); return { photoWorld: photoWorld, PHOTO: PHOTO, pick: pickables, anchors: anchors, cables: G3D.cables, G3D: G3D, scene: sceneObj, COMPONENTS: COMPONENTS, REQUIRED: REQUIRED_IDS, ids: getComponentIdsIncludingHelpers() }; } };\n" + src.slice(cut);

const ctx = { console, setTimeout, clearTimeout, Math, Date, JSON, Object, Array, String, Number, RegExp, Promise, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Float64Array, ArrayBuffer, Map, Set, Symbol, WeakMap, isFinite, isNaN, parseFloat, parseInt };
ctx.window = ctx; ctx.globalThis = ctx; ctx.location = { protocol: 'http:' };
ctx.document = { createElement: () => ({ getContext: () => null, style: {}, appendChild() {}, addEventListener() {}, setAttribute() {} }), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: { appendChild() {} } };
ctx.navigator = { userAgent: 'node' }; ctx.requestAnimationFrame = () => 0; ctx.addEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'three.min.js'), 'utf8'), ctx);
vm.runInContext(hooked, ctx);
const T = ctx.THREE;

console.log('PHOTO3D TEST');
const r = ctx.__scene.build();
assert(r.PHOTO.on === true, 'P0 mode foto aktif saat dibuka lewat http');

/* grup & foto */
const names = { relayBox: 'relayBoxPhoto', fuseBox: 'fuseBoxPhoto', ignitionSwitch: 'ignitionSwitchPhoto' };
const box = {};
Object.keys(names).forEach((n) => {
    const g = r.scene.getObjectByName(n);
    assert(!!g, 'P1 grup ' + n + ' ada');
    assert(!!r.scene.getObjectByName(names[n]), 'P2 bidang foto untuk ' + n + ' ada');
    g.updateMatrixWorld(true); box[n] = new T.Box3().setFromObject(g);
    assert(box[n].min.y >= -2.64, 'P3 ' + n + ' berdiri di lantai');
});
['relayBox', 'fuseBox', 'ignitionSwitch'].forEach((a, i, arr) => arr.slice(i + 1).forEach((b) => assert(!box[a].intersectsBox(box[b]), 'P4 ' + a + ' tidak bertumpuk dengan ' + b)));
const bat = r.scene.getObjectByName('battery'); bat.updateMatrixWorld(true);
const bb = new T.Box3().setFromObject(bat);
Object.keys(names).forEach((n) => assert(!bb.intersectsBox(box[n]), 'P5 ' + n + ' tidak bertumpuk dengan baterai'));

/* komponen tetap dapat diklik */
const cnt = {}; r.pick.forEach((m) => { cnt[m.userData.componentId] = (cnt[m.userData.componentId] || 0) + 1; });
assert(cnt.starterRelay > 0 && cnt.fuse > 0 && cnt.ignitionSwitch > 0, 'P6 relay, fuse, kunci kontak tetap dapat diklik');

/* ujung kabel tepat di terminal pada foto */
const E = (c) => [c.curve.getPoint(0), c.curve.getPoint(1)];
const near = (p, q, d) => p.distanceTo(new T.Vector3(q[0], q[1], q[2])) <= (d || 0.05);
const has = (a, b) => r.cables.some((c) => { const e = E(c); return (near(e[0], a) && near(e[1], b)) || (near(e[0], b) && near(e[1], a)); });
const W = r.photoWorld;
assert(has([-1.97, -1.65, 1.5], W('fuse', 'IN')), 'W1 aki (+) -> fuse IN (terminal foto)');
assert(has(W('fuse', 'OUT'), W('ign', 'IN')), 'W2 fuse OUT -> kunci kontak IN');
assert(has(W('fuse', 'OUT'), W('relay', '30')), 'W3 fuse OUT -> relay kaki 30');
assert(has(W('ign', 'OUT'), W('relay', '86')), 'W4 kunci kontak OUT -> relay kaki 86');
assert(r.cables.some((c) => near(E(c)[0], W('relay', '85'))), 'W5 relay kaki 85 -> massa');
assert(r.cables.some((c) => near(E(c)[0], W('relay', '87')) && near(E(c)[1], [-0.26, 0.6, 0.0], 0.12)), 'W6 relay kaki 87 -> terminal S solenoid');

/* terminal berada pada bidang foto (tidak melayang jauh) */
const inside = (b, p, pad) => p[0] >= b.min.x - pad && p[0] <= b.max.x + pad && p[1] >= b.min.y - pad && p[1] <= b.max.y + pad && p[2] >= b.min.z - pad && p[2] <= b.max.z + pad;
assert(inside(box.fuseBox, W('fuse', 'IN'), 0.05) && inside(box.fuseBox, W('fuse', 'OUT'), 0.05), 'T1 terminal fuse di dalam kotak fuse');
assert(inside(box.ignitionSwitch, W('ign', 'IN'), 0.05) && inside(box.ignitionSwitch, W('ign', 'OUT'), 0.05), 'T2 terminal kunci kontak di dalam kotak kunci');
assert(['30', '85', '86', '87'].every((n) => inside(box.relayBox, W('relay', n), 0.05)), 'T3 keempat kaki relay di dalam kotak relay');

/* label terminal tetap lengkap */
['30', '85', '86', '87'].forEach((n) => assert(!!r.anchors['m:relay' + n] && /Kaki/.test(r.anchors['m:relay' + n].text), 'L1 label kaki relay ' + n));
assert(['m:ignIN', 'm:ignOUT', 'm:fuseIn', 'm:fuseOut', 'ignitionSwitch', 'fuse', 'starterRelay'].every((k) => !!r.anchors[k]), 'L2 label terminal & komponen utama ada');

/* animasi: kunci & lampu status */
assert(!!r.G3D.ignKey && typeof r.G3D.ignKey.rotation.z === 'number', 'A1 ignKey tetap ada untuk animasi posisi kunci');
assert(r.G3D.leds && r.G3D.leds.relay && r.G3D.leds.fuse && r.G3D.leds.ign, 'A2 lampu status relay, fuse, dan kunci kontak ada');

/* foto asli benar-benar ada di folder images */
['fuse', 'relay', 'kunci-kontak'].forEach((f) => assert(fs.existsSync(path.join(ROOT, 'images', f + '.png')), 'F1 foto images/' + f + '.png tersedia'));

/* mode file:// memakai model cadangan (tanpa foto) */
const ctx2 = Object.assign({}, ctx, { location: { protocol: 'file:' } });
vm.createContext(ctx2); ctx2.window = ctx2; ctx2.globalThis = ctx2;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'three.min.js'), 'utf8'), ctx2);
vm.runInContext(hooked, ctx2);
const r2 = ctx2.__scene.build();
assert(r2.PHOTO.on === false && !r2.scene.getObjectByName('relayBoxPhoto') && !!r2.scene.getObjectByName('relayBox'), 'C1 dari file:// dipakai model prosedural cadangan');

console.log('=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed ? 1 : 0);
