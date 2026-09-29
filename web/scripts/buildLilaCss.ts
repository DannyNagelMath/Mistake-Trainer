// buildLilaCss.ts: compiles the three stylesheets that Lichess's analysis page loads, into public/lila/css,
// and copies the fonts and images they use into public/lila.
// Run from web: npx tsx scripts/buildLilaCss.ts <path to your lila clone>
// The lila clone should be checked out at the reference commit, 27ffc8b.
// Source in lila: ui/.build/src/sass.ts (buildColorWrap, and the options in SASS_ARGS).
// lila compiles with sasso 0.18.0, which has no Windows build. At 27ffc8b, plain Sass 1.105.0
// produces byte-identical CSS. lila then runs Lightning CSS, which rewrites newer syntax such as
// @media (width >= 800px) for old browsers; current browsers don't need it, so we skip it.
//
// The whole of lila is large. This fetches only the reference commit, and only the files used here
// (from the folder that contains lichess_project):
//   git init lila; cd lila
//   git remote add origin https://github.com/lichess-org/lila.git
//   git sparse-checkout set --no-cone /ui/ /public/font/*.woff2 /public/piece/cburnett/ /public/images/board/brown.png /public/images/loader/
//   git fetch --depth 1 --filter=blob:none origin 27ffc8b5f296d180e7a648d6bfdad27eef3f86a2
//   git checkout FETCH_HEAD
// (In Git Bash, put MSYS_NO_PATHCONV=1 before the sparse-checkout command, or it turns /ui/ into a Windows path.)

import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as sass from 'sass';

const lila = process.argv[2]; // argv[0] is node and argv[1] is this script
if (!lila) throw new Error('Usage: npx tsx scripts/buildLilaCss.ts <path to lila>');

// Step 1, like lila's buildColorWrap. lila's SCSS uses names like $c-bg, which its build generates:
// for each CSS variable --c-something declared in ui/lib/css/theme/_theme.*.scss, it writes the line
// "$c-something: var(--c-something);" into ui/lib/css/theme/gen/_wrap.scss.
const themeDir = join(lila, 'ui', 'lib', 'css', 'theme');
const names = new Set<string>();
for (const file of readdirSync(themeDir)) {
  if (!file.startsWith('_') || !file.endsWith('.scss') || !file.includes('theme.')) continue;
  for (const line of readFileSync(join(themeDir, file), 'utf8').split('\n')) {
    if (!line.includes('--c-')) continue;
    const commentIndex = line.indexOf('//');
    if (commentIndex !== -1 && commentIndex < line.indexOf(':')) continue; // commented out
    names.add(line.split(':')[0].trim().replace('--', ''));
  }
}
const wrap = [...names].sort().map(name => `$${name}: var(--${name});`).join('\n') + '\n';
mkdirSync(join(themeDir, 'gen'), { recursive: true });
writeFileSync(join(themeDir, 'gen', '_wrap.scss'), wrap); // lila's .gitignore already ignores gen/
console.log(`_wrap.scss: ${names.size} variables`);

// Step 2: compile the three stylesheets from the <head> of Lichess's analysis page.
const sources = [
  'ui/lib/css/build/lib.theme.all.scss',
  'ui/site/css/build/site.scss',
  'ui/analyse/css/build/analyse.round.scss',
];
const outDir = join('public', 'lila', 'css');
mkdirSync(outDir, { recursive: true });
for (const source of sources) {
  const result = sass.compile(join(lila, source), {
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin'], // the warnings lila's build also silences
  });
  const outFile = join(outDir, basename(source, '.scss') + '.css'); // e.g. public/lila/css/site.css
  writeFileSync(outFile, result.css + '\n');
  console.log(`${outFile}: ${statSync(outFile).size} bytes`);
}

// Step 3: copy the files the CSS refers to as url(../something), so ../font/storm.woff2 in
// public/lila/css/site.css finds public/lila/font/storm.woff2. Also the lichess icon font and the
// piece images, which lila's page adds in the <head> rather than in the CSS (see index.html).
// Only lila's default board (brown) and piece set (cburnett); the CSS names the other boards too,
// but the browser only downloads the one it uses.
const assets = [
  'font', // text fonts, the lichess icon font, and the chess-figurine font
  'piece/cburnett',
  'images/board/brown.png',
  'images/loader', // the spinner
];
for (const asset of assets) {
  cpSync(join(lila, 'public', asset), join('public', 'lila', asset), {
    recursive: true,
    filter: src => !/\.(sfd|ttf)$/.test(src), // skip font sources, if the clone has them
  });
  console.log(`public/lila/${asset}: copied`);
}