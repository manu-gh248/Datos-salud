# Contexto para Claude Code

App web personal de análisis de Apple Salud del usuario (Manuel). Sitio
estático puro (sin build, sin dependencias, sin backend): `index.html` +
`js/` + `assets/`. Este repositorio (`manu-gh248/Datos-salud`) es su único
hogar: no tiene ninguna relación con la web de venta del Test LeMent ni debe
mezclarse con ella.

## Regla de oro

Los datos de salud NUNCA deben salir del navegador. Nada de funciones de
servidor, analítica, peticiones externas ni CDNs: cualquier cambio debe
mantener el sitio 100 % estático y autocontenido. El `X-Robots-Tag: noindex`
de `netlify.toml` debe conservarse: es una herramienta personal.

## Tarea pendiente si la app aún no está desplegada

Crear un proyecto de Netlify propio para este repositorio:

1. `netlify login` (o comprobar `netlify status`)
2. Desde la raíz del proyecto: `netlify init` → «Create & configure a new
   project» → equipo del usuario → nombre p. ej. `datos-salud` → build
   command vacío, publish directory `.`
   - `netlify init` sobre el clon deja despliegue continuo configurado; sin
     remoto, `netlify deploy --prod --dir .` publica a mano.
3. Verificar que la URL resultante carga y pedir al usuario que pruebe con su
   `export.zip` real.
4. Opcional, si el usuario lo pide: dominio propio en Netlify → Domain
   settings, con el CNAME correspondiente en su DNS.

GitHub Pages también valdría (Settings → Pages → esta rama), pero Netlify es
lo acordado con el usuario.

## Arquitectura en dos líneas

`js/salud-worker.js` (Web Worker) lee el `export.zip` en streaming (lector
ZIP propio + `DecompressionStream`) y devuelve agregados diarios: series,
sueño por noches con fases, entrenos, medicación anotada y perfil (fecha de
nacimiento). `js/salud.js` pinta todo: gráficas SVG artesanas (barras,
líneas, apiladas, calendario de calor, ritmo de sueño, dispersión con
regresión), motor de hallazgos (comparaciones de grupos, correlaciones sobre
variaciones diarias para no confundir tendencias compartidas con relaciones,
efectos de medicación emparejados por cercanía temporal), comparativa con
hombres de la misma edad, consejos, récords y vista de tabla accesible en
cada tarjeta.

## Historial

En el primer commit de este repositorio vive «Pulso», una versión anterior
de la app en un solo `index.html`, hecha en otra sesión. Se sustituyó por
esta versión; si algo de aquella interesa (p. ej. su botón de datos de
ejemplo), está en el historial de git.

## Probar en local

Cualquier servidor estático sirve (`python3 -m http.server`). El worker no
funciona abriendo `index.html` con file:// — hace falta http. Probar con un
export real o generar uno sintético con el formato de Apple
(`<Record type="HKQuantityTypeIdentifier..."/>`, `<Workout>`, sueño
`HKCategoryValueSleepAnalysis*`, medicación `MedicationDoseEvent` con
`MetadataEntry`).
