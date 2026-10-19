'use strict';
/* Tema terang / gelap. Dimuat di <head> agar tema terpasang sebelum halaman digambar (tanpa kedip).
   Urutan: pilihan tersimpan (localStorage) -> preferensi sistem (prefers-color-scheme) -> terang. */
(function (G) {
    var KEY = 'starterLab_theme';
    var doc = G.document, root = doc.documentElement;
    function saved() { try { var v = G.localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch (e) { return null; } }
    function system() { try { return G.matchMedia && G.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'light'; } }
    function current() { return saved() || system(); }
    function paint(t) {
        root.setAttribute('data-theme', t);
        root.style.colorScheme = t;
        var m = doc.querySelector('meta[name="theme-color"]');
        if (m) m.setAttribute('content', t === 'dark' ? '#0B1520' : '#14283F');
        var bs = doc.querySelectorAll('[data-theme-toggle]');
        for (var i = 0; i < bs.length; i++) {
            bs[i].setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
            bs[i].setAttribute('title', t === 'dark' ? 'Beralih ke tema terang' : 'Beralih ke tema gelap');
            var lab = bs[i].querySelector('.theme-label'); if (lab) lab.textContent = t === 'dark' ? 'Tema gelap' : 'Tema terang';
        }
    }
    function set(t) { try { G.localStorage.setItem(KEY, t); } catch (e) { /* mode privat */ } paint(t); return t; }
    function toggle() { return set(current() === 'dark' ? 'light' : 'dark'); }
    paint(current());
    doc.addEventListener('DOMContentLoaded', function () {
        paint(current());
        doc.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('[data-theme-toggle]');
            if (b) toggle();
        });
    });
    try { G.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (!saved()) paint(system()); }); } catch (e) { /* peramban lama */ }
    G.StarterTheme = { get: current, set: set, toggle: toggle };
})(window);
