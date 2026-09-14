/* =============================================================================
   Las tres versiones tienen que ir sincronizadas.

   Por qué existe este test: el botón "Comparar listas" no hacía nada porque
   el navegador servía el index.html nuevo con el src/app.js viejo. Un fallo
   mudo, sin error en consola. La app ya detecta la mezcla y se repara, pero
   eso solo funciona si los números están bien puestos — y eso es justo lo
   que uno olvida al desplegar. Este test lo revisa por nosotros.

   Correr con:  node --test test/
============================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function buildDeclarado() {
  const html = read('index.html').match(/<meta name="app-build" content="(\d+)"/);
  assert.ok(html, 'falta <meta name="app-build"> en index.html');
  return html[1];
}

test('index.html, app.js y sw.js declaran la misma versión de build', () => {
  const build = buildDeclarado();
  const app = read('src/app.js').match(/const APP_BUILD = '(\d+)'/);
  const sw = read('sw.js').match(/const BUILD = '(\d+)'/);

  assert.ok(app, 'falta APP_BUILD en src/app.js');
  assert.ok(sw, 'falta BUILD en sw.js');

  assert.equal(app[1], build, `APP_BUILD (${app[1]}) debe ser igual al build del HTML (${build})`);
  assert.equal(sw[1], build, `BUILD de sw.js (${sw[1]}) debe ser igual al build del HTML (${build})`);
});

test('las URLs de código llevan la versión del build', () => {
  /* Esto es lo que hace imposible el bug: si el HTML pide app.js?v=8, una
     caché vieja no tiene esa URL y el navegador está obligado a ir a la red.
     Olvidar subir el ?v= al desplegar reabre el problema, así que se revisa. */
  const build = buildDeclarado();
  const html = read('index.html');
  const app = read('src/app.js');

  assert.match(
    html,
    new RegExp(`src="\\./src/app\\.js\\?v=${build}"`),
    `index.html debe cargar ./src/app.js?v=${build}`
  );
  assert.match(
    html,
    new RegExp(`href="\\./styles/main\\.css\\?v=${build}"`),
    `index.html debe cargar ./styles/main.css?v=${build}`
  );
  assert.match(
    app,
    new RegExp(`from '\\./state\\.core\\.js\\?v=${build}'`),
    `src/app.js debe importar ./state.core.js?v=${build}`
  );
});

test('el service worker precachea las mismas URLs que pide el HTML', () => {
  const sw = read('sw.js');

  assert.ok(sw.includes("'./index.html'"), './index.html debe estar en APP_SHELL');

  // Con versión, y construidas desde BUILD para que no se puedan desfasar.
  ['app.js', 'state.core.js'].forEach(file => {
    assert.ok(
      sw.includes(`./src/${file}?v=\${BUILD}`),
      `./src/${file} debe estar en APP_SHELL con ?v=\${BUILD}`
    );
  });
  assert.ok(
    sw.includes('./styles/main.css?v=\${BUILD}'),
    './styles/main.css debe estar en APP_SHELL con ?v=\${BUILD}'
  );
});
