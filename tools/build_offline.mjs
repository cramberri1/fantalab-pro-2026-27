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
  const bound = new Map();
  const resolveImports = (source, importer) => source.replace(/^import\s+\{\s*([\w$,\s]+)\s*\}\s+from\s+['"]\.\/([\w.-]+)['"];\s*/gm,
    (_, imports, path) => {
      const dependency = bound.get(path);
      const names = imports.split(',').map(name => name.trim()).filter(Boolean);
      if (!dependency || names.some(name => !dependency.names.has(name))) {
        throw new Error('Import non incorporabile in ' + importer + ' da ' + path + '.');
      }
      return 'const { ' + names.join(', ') + ' } = ' + dependency.namespace + ';\n\n';
    });
  const declarations = modules.map(({ path, namespace, source }) => {
    const names = [];
    const body = resolveImports(source, path).replace(/^export (const|(?:async )?function) ([A-Za-z_$][\w$]*)/gm, (_, type, name) => {
      names.push(name);
      return `${type} ${name}`;
    });
    bound.set(path, { namespace, names: new Set(names) });
    if (/^\s*(import|export)\s/m.test(body)) {
      throw new Error(`Il bundler supporta soltanto gli export nominali in ${path}.`);
    }
    return `const ${namespace} = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();`;
  });
  const entry = resolveImports(app, 'app.js');
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

const [html, css, icon, model, rosterImport, marketImport, market, calendar, matchModel, lineupDrag, lineupContext, lineupComparison,
  manualAvailability, fixtureDifficulty, lineupSuggestion, lineupPerformance, officialVotes, officialVoteModel, officialVoteStorage, app, real, demo, history] = await Promise.all([
  read('index.html'), read('styles.css'), embedAsset('assets/mark.svg'), read('js/model.js'),
  read('js/roster-import.js'), read('js/market-import.js'), read('js/market.js'), read('js/calendar.js'), read('js/match-model.js'),
  read('js/lineup-drag.js'), read('js/lineup-context.js'), read('js/lineup-comparison.js'), read('js/manual-availability.js'),
  read('js/fixture-difficulty.js'), read('js/lineup-suggestion.js'), read('js/lineup-performance.js'), read('js/official-votes.js'),
  read('js/official-vote-model.js'), read('js/official-vote-storage.js'), read('js/app.js'),
  read('data/serie-a-2026-27.json'), read('data/demo.json'),
  read('data/serie-a-2025-26.json').catch(error => { if (error.code === 'ENOENT') return null; throw error; })
]);
const styles = await inlineStyles(css);
const views = await Promise.all([
  ['view-panoramica.js', 'FantaLabViewPanoramica'],
  ['view-match.js', 'FantaLabViewMatch'],
  ['view-giocatori.js', 'FantaLabViewGiocatori'],
  ['view-analisi.js', 'FantaLabViewAnalisi'],
  ['view-rosa.js', 'FantaLabViewRosa'],
  ['view-mercato.js', 'FantaLabViewMercato'],
  ['view-simulazione.js', 'FantaLabViewSimulazione'],
  ['view-rendimento.js', 'FantaLabViewRendimento'],
  ['view-fonti.js', 'FantaLabViewFonti']
].map(async ([path, namespace]) => ({ path, namespace, source: await read(`js/${path}`) })));
const modules = [
  ...views,
  { path: 'official-vote-model.js', namespace: 'FantaLabOfficialVoteModel', source: officialVoteModel },
  { path: 'model.js', namespace: 'FantaLabModel', source: model },
  { path: 'roster-import.js', namespace: 'FantaLabRosterImport', source: rosterImport },
  { path: 'market-import.js', namespace: 'FantaLabMarketImport', source: marketImport },
  { path: 'official-votes.js', namespace: 'FantaLabOfficialVotes', source: officialVotes },
  { path: 'official-vote-storage.js', namespace: 'FantaLabOfficialVoteStorage', source: officialVoteStorage },
  { path: 'market.js', namespace: 'FantaLabMarket', source: market },
  { path: 'calendar.js', namespace: 'FantaLabCalendar', source: calendar },
  { path: 'lineup-drag.js', namespace: 'FantaLabLineupDrag', source: lineupDrag },
  { path: 'lineup-context.js', namespace: 'FantaLabLineupContext', source: lineupContext },
  { path: 'lineup-comparison.js', namespace: 'FantaLabLineupComparison', source: lineupComparison },
  { path: 'manual-availability.js', namespace: 'FantaLabManualAvailability', source: manualAvailability },
  { path: 'fixture-difficulty.js', namespace: 'FantaLabFixtureDifficulty', source: fixtureDifficulty },
  { path: 'lineup-suggestion.js', namespace: 'FantaLabLineupSuggestion', source: lineupSuggestion },
  { path: 'lineup-performance.js', namespace: 'FantaLabLineupPerformance', source: lineupPerformance },
  { path: 'match-model.js', namespace: 'FantaLabMatchModel', source: matchModel }
];
const scripts = [inlineData(real, 'real'), inlineData(demo, 'demo'),
  ...(history ? [inlineData(history, 'real', '2025/26', 'history')] : []),
  `<script type="module">\n${inlineModules(app, modules)}\n</script>`];
const withIcon = replaceRequired(html, /(<link rel="icon" href=")assets\/mark\.svg(")/, (_, start, end) => start + icon + end);
const offlineHtml = withIcon.replace(/^\s*<link rel="(?:manifest|apple-touch-icon)"[^>]+>$/gm, '');
const withStyles = replaceRequired(offlineHtml, /<link rel="stylesheet" href="styles\.css">/, () => `<style>\n${styles}\n</style>`);
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
