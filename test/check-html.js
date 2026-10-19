const fs = require('fs');
const h = fs.readFileSync(process.argv[2], 'utf8');
const tags = h.match(/<(\/)?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g) || [];
const stack = [];
let err = null;
const voidTags = new Set(['meta','link','input','br','hr','img','circle','line','rect','path','ellipse','polygon','polyline','stop','use','feGaussianBlur','feMerge','feMergeNode','marker','pattern','animateMotion','text','tspan']);
for (const t of tags) {
    const m = t.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/);
    const name = m[1];
    if (t.startsWith('</')) {
        if (voidTags.has(name)) continue;
        const top = stack.pop();
        if (top !== name) { err = 'Mismatch: expected </' + top + '> got </' + name + '>'; break; }
    } else if (!t.endsWith('/>') && !voidTags.has(name)) {
        stack.push(name);
    }
}
if (!err && stack.length) err = 'Unclosed: ' + stack.join(',');
console.log(err || 'HTML tags balanced (' + tags.length + ' tags)');