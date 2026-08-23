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

Los consejos enlazan estudios en webs externas. Eso es compatible con la regla:
son enlaces normales que abre el usuario si quiere, la página no carga nada de
fuera y no viaja ningún dato (van con `rel="noopener noreferrer"` y el
`Referrer-Policy: no-referrer` de `netlify.toml`).

## Despliegue (ya hecho, no crear otro sitio)

La app está publicada en https://datos-salud.netlify.app (proyecto Netlify
`datos-salud`, equipo ManuTEST). Tiene despliegue continuo desde GitHub
(`manu-gh248/Datos-salud`, rama por defecto): cada push publica solo, con una
clave de despliegue y un webhook ya configurados. No hace falta crear un
proyecto nuevo ni ejecutar `netlify init`. Para publicar a mano en un apuro:
`netlify deploy --prod --dir .`.

⚠ Al fusionar cualquier rama en la rama por defecto, el cambio sale en vivo.

## Arquitectura en dos líneas

`js/salud-worker.js` (Web Worker) lee el `export.zip` en streaming (lector
ZIP propio + `DecompressionStream`) y devuelve agregados diarios: series,
sueño por noches con fases, entrenos, medicación anotada y perfil (fecha de
nacimiento). `js/salud.js` pinta todo: gráficas SVG artesanas (barras,
líneas, apiladas, calendario de calor, ritmo de sueño, dispersión con
regresión), motor de hallazgos (comparaciones de grupos, correlaciones sobre
variaciones diarias para no confundir tendencias compartidas con relaciones,
efectos de medicación emparejados por cercanía temporal), comparativa con
hombres de la misma edad, motor de consejos personalizados con la fuente
científica enlazada en cada uno, récords y vista de tabla accesible en cada
tarjeta.

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
