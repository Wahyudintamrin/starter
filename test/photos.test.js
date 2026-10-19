/* PHOTOS TEST - foto asli komponen diagram (diagramPhotos.js) dengan DOM tiruan.
   Run: node test/photos.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.log('  FAIL: ' + m); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function el(tag, id, cls, kids) {
    const e = { tagName: tag, id: id || '', _cls: new Set((cls || '').split(' ').filter(Boolean)), attrs: {}, children: kids || [], parent: null, textContent: '', disabled: false, title: '' };
    e.classList = {
        add: (c) => e._cls.add(c), contains: (c) => e._cls.has(c),
        toggle: (c, on) => { if (on === undefined) on = !e._cls.has(c); on ? e._cls.add(c) : e._cls.delete(c); return on; }
    };
    e.setAttribute = (k, v) => { e.attrs[k] = String(v); if (k === 'class') String(v).split(' ').filter(Boolean).forEach((c) => e._cls.add(c)); };
    e.setAttributeNS = (ns, k, v) => { e.attrs[k] = String(v); };
    e.getAttribute = (k) => (k in e.attrs ? e.attrs[k] : null);
    e.insertBefore = (n) => { n.parent = e; e.children.unshift(n); return n; };
    e.querySelector = (sel) => {
        const c = sel.replace('.', '');
        const walk = (n) => { for (const k of n.children) { if (k.classList.contains(c)) return k; const r = walk(k); if (r) return r; } return null; };
        return walk(e);
    };
    return e;
}
function build() {
    const mk = (id, extra) => {
        const kids = [el('rect'), el('text'), el('circle', 'status-' + id, 'status-dot')].concat(extra || []);
        return el('g', 'comp-' + id, 'component', kids);
    };
    const flyGroup = el('g', 'flywheelGroup', '', [el('circle'), el('circle'), el('g', 'flywheelTeeth')]);
    const nodes = {};
    ['battery', 'fuse', 'ignition', 'relay', 'solenoid', 'starter', 'pinion', 'engine'].forEach((n) => { nodes[n] = mk(n); });
    nodes.flywheel = el('g', 'comp-flywheel', 'component', [flyGroup, el('text')]);
    const svg = el('svg', 'starterSVG');
    const btn = el('button', 'dgPhotoBtn');
    const byId = { starterSVG: svg, dgPhotoBtn: btn, flywheelGroup: flyGroup };
    Object.keys(nodes).forEach((k) => { byId['comp-' + k] = nodes[k]; });
    return { byId, nodes, svg, btn, flyGroup };
}
function boot(existing) {
    const dom = build();
    const ctx = {
        console, setTimeout, Object, Array, String,
        document: {
            readyState: 'complete', getElementById: (id) => dom.byId[id] || null,
            createElementNS: (ns, tag) => el(tag), addEventListener() {}
        },
        Image: function () {
            const self = this;
            Object.defineProperty(self, 'src', { set(u) { setTimeout(() => { (existing.indexOf(u) >= 0 ? self.onload : self.onerror)(); }, 0); } });
        }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'diagramPhotos.js'), 'utf8'), ctx);
    return { ctx, dom };
}

(async function () {
    console.log('PHOTOS TEST');
    const names = ['aki', 'fuse', 'kunci-kontak', 'relay', 'selenoid', 'motor-starter', 'pinion', 'flywheel', 'mesin'];
    const DP0 = boot([]).ctx.DiagramPhotos;
    assert(DP0.slots.map((s) => s.file).join() === names.join(), 'P1 sembilan komponen dipetakan ke nama file Indonesia sesuai permintaan');

    /* tanpa foto -> skema utuh */
    let t = boot([]);
    await wait(30);
    assert(t.ctx.DiagramPhotos.photoCount() === 0, 'P2 tanpa file foto -> tidak ada yang memakai foto');
    assert(!t.dom.nodes.battery.classList.contains('has-photo') && !t.dom.nodes.battery.children[0].classList.contains('dg-schem'), 'P3 gambar skema tetap utuh (fallback)');
    assert(t.dom.btn.disabled === true, 'P4 tombol FOTO/SKEMA nonaktif bila tidak ada foto');

    /* sebagian foto (aki .png, relay .webp, flywheel .jpg) */
    t = boot(['images/aki.png', 'images/relay.webp', 'images/flywheel.jpg']);
    await wait(60);
    const DP = t.ctx.DiagramPhotos;
    assert(DP.photoCount() === 3 && DP.status.battery === 'photo' && DP.status.relay === 'photo' && DP.status.flywheel === 'photo', 'P5 ekstensi png/webp/jpg dikenali');
    assert(DP.status.fuse === 'schema' && !t.dom.nodes.fuse.classList.contains('has-photo'), 'P6 komponen tanpa foto tetap skema (campuran boleh)');
    const bat = t.dom.nodes.battery;
    const img = bat.querySelector('.dg-photo');
    assert(img && img.attrs.href === 'images/aki.png' && img.attrs.width === '104', 'P7 elemen <image> dibuat dengan sumber & ukuran benar');
    assert(bat.children[0] === img, 'P8 foto diletakkan paling belakang (di bawah label & titik status)');
    assert(bat.children.filter((k) => k.tagName === 'rect').every((k) => k.classList.contains('dg-schem')), 'P9 bentuk skema ditandai agar bisa disembunyikan');
    assert(bat.children.filter((k) => k.tagName === 'text' || k.classList.contains('status-dot')).every((k) => !k.classList.contains('dg-schem')), 'P10 teks label & titik status TIDAK disembunyikan');
    const fly = t.dom.flyGroup;
    assert(fly.children[0].classList.contains('dg-photo') && t.dom.nodes.flywheel.querySelector('.dg-photo') === fly.children[0], 'P11 foto flywheel berada DI DALAM flywheelGroup (ikut berputar)');
    assert(fly.children.slice(1).every((k) => k.classList.contains('dg-schem')) && !fly.classList.contains('dg-schem'), 'P12 grup flywheel tidak disembunyikan, isinya skema saja');
    assert(t.dom.btn.disabled === false, 'P13 tombol aktif bila ada foto');

    /* idempoten + toggle */
    DP._apply(DP.slots[0], 'images/aki.png');
    assert(bat.children.filter((k) => k.classList.contains('dg-photo')).length === 1, 'P14 memuat ulang tidak menggandakan foto');
    assert(DP.toggle() === 'schema' && t.dom.svg.classList.contains('dg-schema-mode') && t.dom.btn.textContent === 'FOTO', 'P15 toggle -> mode skema');
    assert(DP.toggle() === 'photo' && !t.dom.svg.classList.contains('dg-schema-mode') && t.dom.btn.textContent === 'SKEMA', 'P16 toggle kembali ke mode foto');

    /* integrasi berkas */
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
    assert(html.indexOf('<script src="diagramPhotos.js"></script>') > html.indexOf('<script src="app.js"></script>'), 'P17 diagramPhotos.js dimuat setelah app.js');
    assert(html.indexOf('id="dgPhotoBtn"') >= 0, 'P18 tombol FOTO/SKEMA ada di toolbar');
    assert(css.indexOf('.component.has-photo .dg-schem { display: none; }') >= 0, 'P19 CSS menyembunyikan skema saat foto ada');
    assert(fs.existsSync(path.join(ROOT, 'images', 'README.txt')), 'P20 images/README.txt tersedia');
    ['ignKey', 'armatureGroup', 'flywheelGroup', 'fuseElement', 'engineStateLabel'].forEach((id) => assert(html.indexOf('id="' + id + '"') >= 0, 'P21 elemen animasi #' + id + ' tetap ada'));

    console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
    process.exit(failed ? 1 : 0);
})();
