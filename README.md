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

## Comparar listas

En **Mis listas → 🔍 Comparar listas** puedes escoger dos listas y ver qué le
falta a cada una frente a la otra, con casillas para agregar solo lo que
quieras. Compara por contenido (texto normalizado + emoji), no por id, y no
duplica lo que ya existe.

## Tests

```
node --test test/state.core.test.js
```

## Nota

Si la app muestra “No se pudo leer Firestore”, normalmente falta publicar reglas, activar Firestore o iniciar sesión con uno de los correos autorizados.
