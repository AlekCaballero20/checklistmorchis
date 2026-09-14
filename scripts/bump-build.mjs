#!/usr/bin/env node
/* =============================================================================
   Maleta · scripts/bump-build.mjs
   Sube el número de build en TODOS los sitios a la vez.

   Existe porque la versión vive en cinco lugares (el meta del HTML, las URLs
   del JS y del CSS, APP_BUILD en app.js y BUILD en sw.js) y olvidar uno solo
   reabre el bug del "botón que no hace nada": HTML de un despliegue con JS de
   otro. Un humano olvidando un número es cuestión de tiempo; un script, no.

   Uso:
     node scripts/bump-build.mjs          -> sube al siguiente número
     node scripts/bump-build.mjs 12       -> pone exactamente el 12
     node scripts/bump-build.mjs --check  -> solo informa, no escribe
============================================================================= */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(join(ROOT, file), 'utf8');
const write = (file, content) => writeFileSync(join(ROOT, file), content);

/* Cada sitio donde vive la versión. Si algún día se agrega otro archivo de
   código, va acá y no en la memoria de nadie. */
const SPOTS = [
  { file: 'index.html', find: /(<meta name="app-build" content=")(\d+)(")/, label: 'meta app-build' },
  { file: 'index.html', find: /(href="\.\/styles\/main\.css\?v=)(\d+)(")/, label: 'URL del CSS' },
  { file: 'index.html', find: /(src="\.\/src\/app\.js\?v=)(\d+)(")/, label: 'URL del JS' },
  { file: 'src/app.js', find: /(from '\.\/state\.core\.js\?v=)(\d+)(')/, label: 'import de state.core.js' },
  { file: 'src/app.js', find: /(const APP_BUILD = ')(\d+)(')/, label: 'APP_BUILD' },
  { file: 'sw.js', find: /(const BUILD = ')(\d+)(')/, label: 'BUILD del service worker' }
];

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const explicit = args.find(arg => /^\d+$/.test(arg));

const found = SPOTS.map(spot => {
  const match = read(spot.file).match(spot.find);
  if (!match) {
    console.error(`✖ No se encontró ${spot.label} en ${spot.file}. Revisa el patrón.`);
    process.exit(1);
  }
  return { ...spot, current: match[2] };
});

const versions = [...new Set(found.map(spot => spot.current))];

if (versions.length > 1) {
  console.error('✖ Las versiones están desfasadas (esto rompe la app en silencio):');
  found.forEach(spot => console.error(`    ${spot.current.padStart(4)}  ${spot.label} (${spot.file})`));
} else {
  console.log(`Build actual: ${versions[0]}`);
}

if (checkOnly) {
  process.exit(versions.length > 1 ? 1 : 0);
}

const next = explicit || String(Math.max(...found.map(s => Number(s.current))) + 1);

const edited = new Map();
found.forEach(spot => {
  const source = edited.get(spot.file) ?? read(spot.file);
  edited.set(spot.file, source.replace(spot.find, `$1${next}$3`));
});

edited.forEach((content, file) => write(file, content));

console.log(`✔ Build ${next} escrito en ${edited.size} archivos (${found.length} sitios).`);
console.log('  Verifica con: node --test test/*.test.js');
