# Tu salud, en claro

Aplicación web personal que analiza el export completo de la app Salud del
iPhone (`export.zip`): actividad, corazón, sueño por fases, entrenamientos,
peso, medicación y suplementos. Compara con la media de hombres de tu edad,
cruza métricas buscando patrones (esperados e inesperados), propone qué
hacer con la evidencia citada al lado y lo explica todo con ejemplos
aplicados a tus datos.

## Privacidad, por diseño

Todo el análisis ocurre en el navegador, dentro de un Web Worker: el ZIP se
descomprime con `DecompressionStream` y el XML se recorre en streaming, así
que aguanta exports de cientos de MB. **No hay servidor que reciba nada**: el
sitio es estático puro (este repo se publica tal cual, sin build ni
funciones). Los agregados se guardan en `localStorage` para no recargar el
archivo cada vez; «Borrar mis datos» los elimina.

## Estructura

- `index.html` — la aplicación (interfaz y estilos propios de la página)
- `js/salud.js` — gráficas SVG, motor de hallazgos y comparativas
- `js/salud-worker.js` — worker de análisis del export (ZIP/XML en streaming)
- `js/tema.js` + `assets/` — tema claro/oscuro, tipografía y estilos base
- `netlify.toml` — cabeceras (noindex, sin funciones)

## Cómo se usa

En el iPhone: Salud → tu foto → «Exportar todos los datos de salud». Pásate
el `export.zip` al Mac (AirDrop) y arrástralo a la página. Sin descomprimir.

## Consejos con fuente

La tarjeta «Qué puedes hacer» no da consejos genéricos: cada uno se dispara
por tus propios números (VO₂ máx frente a tu edad, minutos de fuerza a la
semana, regularidad de la hora de acostarte, tu HRV las noches que bebes…) y
enlaza el trabajo en el que se apoya. Solo se citan guías oficiales,
revisiones sistemáticas y cohortes grandes; los divulgadores aparecen cuando
lo que aportan es el protocolo práctico.

## Despliegue

Publicada en Netlify (proyecto `datos-salud`) con despliegue continuo desde
este repositorio: cada push a la rama por defecto se publica solo. Sin
comando de build, directorio raíz.
