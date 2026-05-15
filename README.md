# Control de Apps Compartidas

App instalable para administrar cuentas compartidas, pagos mensuales, adelantos y recordatorios por WhatsApp.

## Modo local

Abre `index.html` en el navegador. Si `supabase-config.js` no tiene credenciales reales, la app guarda todo en `localStorage`.

## Sincronizar con Supabase

1. Crea un proyecto en Supabase.
2. Abre el editor SQL y ejecuta el contenido de `database.sql`.
3. Copia tu Project URL y tu anon public key.
4. Pega esos valores en `supabase-config.js`.
5. Publica la carpeta como sitio web. Puede ser en Netlify, Vercel, Cloudflare Pages, GitHub Pages o un hosting propio.

## Instalar como app

Cuando la app esté publicada con HTTPS:

- Windows: abrir en Microsoft Edge o Chrome y elegir instalar app.
- Android: abrir en Chrome y elegir instalar app o agregar a pantalla principal.
- iPhone/iPad: abrir en Safari, tocar compartir y elegir agregar a pantalla de inicio.

## Seguridad

El `database.sql` deja reglas abiertas para que puedas probar rápido. Para uso real con datos privados, conviene agregar login y políticas por usuario antes de compartir el enlace con otras personas.
