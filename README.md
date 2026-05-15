# Control de Apps Compartidas

App instalable para administrar cuentas compartidas, pagos mensuales, adelantos y recordatorios por WhatsApp.

## Modo local

Abre `index.html` en el navegador. Si `supabase-config.js` no tiene credenciales reales, la app guarda todo en `localStorage`.

## Sincronizar con Supabase

1. Crea un proyecto en Supabase.
2. En `database.sql`, cambia `tu-correo@example.com` y `otro-usuario@example.com` por los dos correos que podran usar la app.
3. Abre el editor SQL y ejecuta el contenido de `database.sql`.
4. Copia tu Project URL y tu anon public key.
5. Pega esos valores en `supabase-config.js`.
6. Publica la carpeta como sitio web. Puede ser en Netlify, Vercel, Cloudflare Pages, GitHub Pages o un hosting propio.

## Login

La app usa Supabase Auth con correo y contrasena. Cada usuario debe crear su acceso con uno de los correos autorizados en `app_members`.

Aunque alguien cree una cuenta con otro correo, las politicas de la base de datos no le permitiran leer ni modificar `accounts` o `people`.

## Instalar como app

Cuando la app este publicada con HTTPS:

- Windows: abrir en Microsoft Edge o Chrome y elegir instalar app.
- Android: abrir en Chrome y elegir instalar app o agregar a pantalla principal.
- iPhone/iPad: abrir en Safari, tocar compartir y elegir agregar a pantalla de inicio.

## Seguridad

El acceso queda protegido por Row Level Security. Solo los correos listados en `public.app_members` pueden ver o modificar los datos.
