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

## Nota

Si la app muestra “No se pudo leer Firestore”, normalmente falta publicar reglas, activar Firestore o iniciar sesión con uno de los correos autorizados.
