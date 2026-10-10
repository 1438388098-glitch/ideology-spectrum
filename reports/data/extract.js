// Evaluate the site's JS in a sandbox and dump canonical JSON.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SITE = path.join(__dirname, '..', '..', 'js');   // 站点 js 目录
const OUT = __dirname;
fs.mkdirSync(OUT, { recursive: true });

const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['axes.js', 'questions.js', 'ideologies.js']) {
  const code = fs.readFileSync(path.join(SITE, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}
const w = sandbox.window;

const questions = w.QUESTIONS;
const ideologies = w.IDEOLOGIES;
const axes = w.AXES;
const axisKeys = axes.map(a => a.key);

fs.writeFileSync(path.join(OUT, 'questions.json'), JSON.stringify(questions, null, 1), 'utf8');
fs.writeFileSync(path.join(OUT, 'ideologies.json'), JSON.stringify(ideologies, null, 1), 'utf8');
fs.writeFileSync(path.join(OUT, 'gov_profile.json'), JSON.stringify(w.GOV_PROFILE, null, 1), 'utf8');
fs.writeFileSync(path.join(OUT, 'axes.json'), JSON.stringify({ axes, axis_keys: axisKeys }, null, 1), 'utf8');

const themes = {};
for (const q of questions) themes[q.theme] = (themes[q.theme] || 0) + 1;
const oc = {};
for (const q of questions) oc[q.options.length] = (oc[q.options.length] || 0) + 1;

const maxAbs = {};
for (const k of axisKeys) maxAbs[k] = 0;
for (const q of questions) {
  for (const k of axisKeys) {
    let mx = 0;
    for (const o of q.options) {
      const v = o.scores && o.scores[k];
      if (typeof v === 'number') mx = Math.max(mx, Math.abs(v));
    }
    maxAbs[k] += mx;
  }
}

console.log('questions     :', questions.length);
console.log('total options :', questions.reduce((s, q) => s + q.options.length, 0));
console.log('option counts :', JSON.stringify(oc));
console.log('themes        :', JSON.stringify(themes));
console.log('axis_keys     :', axisKeys.join(','));
console.log('ideologies    :', ideologies.length);
console.log('ideo names    :', ideologies.map(d => d.nameEn).join(' | '));
console.log('denominators  :', JSON.stringify(maxAbs));
console.log('ideo fields   :', Object.keys(ideologies[0]).join(','));
console.log('gov axes      :', JSON.stringify(w.GOV_PROFILE.axes));
console.log('q1 stem       :', questions[0].stem);
console.log('q1 opt scores :', JSON.stringify(questions[0].options.map(o => o.scores.ECON)));