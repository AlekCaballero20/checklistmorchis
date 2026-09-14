# Maleta · Checklist Firebase

Checklist compartido para Alek y Cata con Firebase Auth + Firestore.

## Qué cambió

- La app ya no guarda el estado en `localStorage`.
- Ahora usa Google Auth.
- Solo pueden entrar:
  - alekcaballeromusic@gmail.com
  - catalina.medina.leal@gmail.com
- Las listas e ítems se guardan en Firestore en el documento:
  - `apps/maleta-checklist`
- Incluye `firestore.rules` para cerrar el acceso a esos dos correos.

## Pasos en Firebase

1. En Firebase Authentication, activa el proveedor **Google**.
2. En Firestore Database, crea la base de datos si aún no existe.
3. Publica el archivo `firestore.rules` desde Firebase Console o con Firebase CLI.
4. Sube el proyecto a GitHub Pages o al hosting que uses.

## Cómo funciona el guardado (por qué ya no se desmarcan los ítems)

- Cada cambio sube un contador de ediciones locales (`localEditSeq`).
- Mientras ese contador no coincida con lo último confirmado, **la pantalla
  manda**: ningún snapshot de Firestore la sobrescribe. Antes el eco del
  propio guardado llegaba con datos de un segundo atrás y desmarcaba lo que
  se había marcado después.
- Si llegan cambios de la otra persona mientras editas, se muestran cuando
  termina el guardado, no encima de lo que estás tocando.
- Marcar un ítem repinta solo esa fila y el progreso, no la lista completa.
- El debounce es de 600 ms con un tope de 3 s: una ráfaga larga de toques
  igual se guarda, no se queda esperando para siempre.
- Al fusionar por edición concurrente gana la intención local, así desmarcar
  un ítem sí se respeta (antes el marcado era pegajoso).

## Borrados que no reviven (tumbas)

Fusionar "sin perder nada" no distingue entre *no lo tenía* y *lo borré*, así
que un ítem borrado reaparecía si la otra persona guardaba con el ítem
todavía presente.

- Cada borrado (ítem, lista, reemplazar una lista, importar encima) deja una
  tumba en `state.deleted`: `{ id, kind, at }`.
- `mergeStates` une las tumbas de los dos lados **antes** de sanear, y
  `sanitizeState` no deja volver nada que tenga tumba.
- El orden importa: si las tumbas se aplicaran después, un id duplicado ya
  habría sido renombrado por el saneamiento y su tumba no lo reconocería.
  Por eso `commitState` fusiona con el payload remoto **en crudo**.
- La tumba es por id, así que volver a agregar el mismo texto sí funciona:
  el ítem nuevo tiene id nuevo.
- Importar un respaldo **sí puede resucitar**: `clearTombstones` perdona las
  tumbas de lo que trae el archivo. Si no, el plan B quedaría inservible
  justo cuando se necesita.
- Se podan solas: 60 días o 400 tumbas, la más reciente gana.

⚠️ `firestore.rules` cambió (acepta y acota el campo `deleted`). Hay que
**publicar las reglas** para que el campo no quede sin validar.

## Comparar listas

En **Mis listas → 🔍 Comparar listas** puedes escoger dos listas y ver qué le
falta a cada una frente a la otra, con casillas para agregar solo lo que
quieras. Compara por contenido (texto normalizado + emoji), no por id, y no
duplica lo que ya existe.

## Versiones y despliegue (leer antes de subir cambios)

El "botón que no hacía nada" fue esto: el service worker servía el
`index.html` **nuevo** con el `src/app.js` **viejo**. Un botón nuevo en el HTML
sin el código que lo escucha, sin error en consola. Tres capas lo evitan:

1. **URLs versionadas**: el HTML pide `app.js?v=N` y `main.css?v=N`, y `app.js`
   importa `state.core.js?v=N`. Una caché vieja no tiene esa URL, así que el
   navegador está obligado a traerla de la red. Es lo que hace la mezcla
   estructuralmente imposible.
2. **El código va por red primero** (`sw.js`), con revalidación y un tope de
   3,5 s antes de tirar de caché. Offline sigue funcionando.
3. **Autorreparación**: `app.js` compara su `APP_BUILD` con el meta del HTML.
   Si no coinciden, limpia cachés y recarga **una vez**; si sigue mal, avisa en
   vez de entrar en un ciclo de recargas.

Para desplegar, subir la versión con el script (toca los seis sitios de una):

```
node scripts/bump-build.mjs        # sube al siguiente número
node scripts/bump-build.mjs --check  # solo verifica que estén sincronizados
node --test test/*.test.js         # test/version.test.js falla si algo quedó desfasado
```

La primera apertura después de un despliegue puede necesitar **abrir la app dos
veces** si el aparato venía con una versión anterior a la 8 (el service worker
viejo es el que manda en esa recarga). De la 8 en adelante, una sola.

## Tests

```
node --test test/*.test.js
```

## Nota

Si la app muestra “No se pudo leer Firestore”, normalmente falta publicar reglas, activar Firestore o iniciar sesión con uno de los correos autorizados.
