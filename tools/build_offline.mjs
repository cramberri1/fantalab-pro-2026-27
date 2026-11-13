import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const mediaTypes = {
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2'
};

function read(path) {
  return readFile(resolve(project, path), 'utf8');
}

async function embedAsset(path) {
  const assets = resolve(project, 'assets');
  const file = resolve(project, path);
  const type = mediaTypes[extname(file).toLowerCase()];
  if (!file.startsWith(assets + sep) || !type) throw new Error(`Asset non supportato: ${path}`);
  return `data:${type};base64,${(await readFile(file)).toString('base64')}`;
}

async function inlineStyles(css) {
  for (const match of [...css.matchAll(/url\(\s*(?:'([^']+)'|"([^"]+)"|([^\s)]+))\s*\)/g)]) {
    const path = match[1] ?? match[2] ?? match[3];
    if (path.startsWith('data:') || path.startsWith('#')) continue;
    css = css.replace(match[0], `url('${await embedAsset(path)}')`);
  }
  if (/<\/style\b/i.test(css) || /@import\b/.test(css)) throw new Error('Foglio di stile non incorporabile.');
  return css;
}

function inlineModules(app, modules) {
  let entry = app;
  const declarations = modules.map(({ path, namespace, source }) => {
    const names = [];
    const body = source.replace(/^export (const|function) ([A-Za-z_$][\w$]*)/gm, (_, type, name) => {
      names.push(name);
      return `${type} ${name}`;
    });
    const dependency = path.replaceAll('.', '\\.');
    const importPattern = new RegExp(`^import \\{\\s*([\\w$,\\s]+)\\s*\\} from ['"]\\.\\/${dependency}['"];\\s*`, 'm');
    entry = replaceRequired(entry, importPattern, (_, bindings) => {
      if (bindings.split(',').map(binding => binding.trim()).filter(Boolean).some(name => !names.includes(name))) {
        throw new Error(`L’app importa un simbolo assente da ${path}.`);
      }
      return `const { ${bindings.trim()} } = ${namespace};\n\n`;
    });
    if (/^\s*(import|export)\s/m.test(body)) {
      throw new Error(`Il bundler supporta soltanto gli export nominali in ${path}.`);
    }
    return `const ${namespace} = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();`;
  });
  if (/^\s*(import|export)\s/m.test(entry)) {
    throw new Error('L’app contiene un import o export non incorporato.');
  }
  const code = [...declarations, entry].join('\n\n');
  if (code.includes('<!--')) throw new Error('Commento HTML in un modulo JavaScript.');
  return code.replace(/<\/script/gi, match => match.replace('/', '\\/'));
}

function inlineData(source, mode, season = '2026/27', id = mode) {
  const data = JSON.parse(source);
  if (data.mode !== mode || data.season !== season || data.schemaVersion !== 1) {
    throw new Error(`Snapshot ${mode} incompatibile.`);
  }
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/json" id="data-${id}">${json}</script>`;
}

function replaceRequired(value, pattern, replacement) {
  if (!pattern.test(value)) throw new Error(`Elemento richiesto nel sorgente: ${pattern}`);
  return value.replace(pattern, replacement);
}

const [html, css, icon, model, rosterImport, marketImport, market, calendar, matchModel, lineupDrag, app, real, demo, history] = await Promise.all([
  read('index.html'), read('styles.css'), embedAsset('assets/mark.svg'), read('js/model.js'),
  read('js/roster-import.js'), read('js/market-import.js'), read('js/market.js'), read('js/calendar.js'), read('js/match-model.js'), read('js/lineup-drag.js'), read('js/app.js'),
  read('data/serie-a-2026-27.json'), read('data/demo.json'),
  read('data/serie-a-2025-26.json').catch(error => { if (error.code === 'ENOENT') return null; throw error; })
]);
const styles = await inlineStyles(css);
const modules = [
  { path: 'model.js', namespace: 'FantaLabModel', source: model },
  { path: 'roster-import.js', namespace: 'FantaLabRosterImport', source: rosterImport },
  { path: 'market-import.js', namespace: 'FantaLabMarketImport', source: marketImport },
  { path: 'market.js', namespace: 'FantaLabMarket', source: market },
  { path: 'calendar.js', namespace: 'FantaLabCalendar', source: calendar },
  { path: 'lineup-drag.js', namespace: 'FantaLabLineupDrag', source: lineupDrag },
  { path: 'match-model.js', namespace: 'FantaLabMatchModel',
    source: replaceRequired(matchModel, /^import \{ fixtureCalendarDay \} from '\.\/calendar\.js';/m,
      'const { fixtureCalendarDay } = FantaLabCalendar;') }
];
const scripts = [inlineData(real, 'real'), inlineData(demo, 'demo'),
  ...(history ? [inlineData(history, 'real', '2025/26', 'history')] : []),
  `<script type="module">\n${inlineModules(app, modules)}\n</script>`];
const withIcon = replaceRequired(html, /(<link rel="icon" href=")assets\/mark\.svg(")/, (_, start, end) => start + icon + end);
const withStyles = replaceRequired(withIcon, /<link rel="stylesheet" href="styles\.css">/, () => `<style>\n${styles}\n</style>`);
const output = replaceRequired(withStyles, /<script type="module" src="js\/app\.js"><\/script>/, () => scripts.join('\n  '));
const destination = resolve(process.argv[2] ?? resolve(project, '..', 'FantaLab-Pro.html'));
const temporary = `${destination}.${randomUUID()}.tmp`;
await mkdir(dirname(destination), { recursive: true });
try {
  await writeFile(temporary, output, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, destination);
} finally {
  await rm(temporary, { force: true });
}
console.log(`HTML autonomo creato. ${destination}`);
