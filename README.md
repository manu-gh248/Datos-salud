# Pulso — panel de salud del iPhone

Aplicación web que lee la exportación completa de la app **Salud** de Apple y la convierte en un panel interactivo con gráficas, tendencias e ideas: actividad, corazón, **sueño con fases**, **entrenamientos** y un explorador con todas las métricas del archivo.

**100 % local y privado**: todo se procesa con JavaScript en tu navegador. No hay servidor, ni analítica, ni subida de datos a ningún sitio.

## Cómo usarla

1. Abre `index.html` en el navegador (doble clic basta; no necesita servidor ni instalación).
2. En el iPhone: app **Salud** → tu foto de perfil → **«Exportar todos los datos de salud»**.
3. Pásate el `exportar.zip` al ordenador (AirDrop, iCloud Drive, correo…) y arrástralo a la página. También acepta el `export.xml` / `exportación.xml` suelto.
4. Explora: pestañas de **Resumen, Actividad, Corazón, Sueño, Entrenamientos, Tendencias y Explorador**, con rangos de 30/90 días, 6 meses, 1 año o todo el histórico.

¿Sin datos a mano? El botón **«Probar con datos de ejemplo»** genera un año de datos sintéticos para ver la app en acción.

> Consejo: si activas **GitHub Pages** en este repositorio (Settings → Pages → rama principal), tendrás la app disponible desde cualquier dispositivo, incluido el propio iPhone.

## Qué analiza

- **Actividad**: pasos, distancia, pisos, energía activa, minutos de ejercicio, tiempo de pie, luz de día…
- **Corazón**: FC diaria con banda mín–máx, FC en reposo, variabilidad (VFC/SDNN), VO₂ máx, recuperación, SpO₂, frecuencia respiratoria, tensión.
- **Sueño**: horas por noche apiladas por fase (profundo / ligero / REM / despierto), duración con media de 7 noches, hora de acostarse y su regularidad, sueño por día de la semana, eficiencia, temperatura de muñeca.
- **Entrenamientos**: sesiones por semana, tiempo por tipo de ejercicio, kcal, distancia, FC media y tabla de últimas sesiones.
- **Tendencias**: comparación automática de las últimas 4 semanas frente a las 4 anteriores y deriva a largo plazo por regresión (con señal de si el cambio es bueno o malo para cada métrica).
- **Explorador**: cualquier métrica presente en la exportación, aunque no esté en las listas anteriores, con su gráfica y su tabla.

## Detalles técnicos

- Un único `index.html` sin dependencias. El ZIP se abre con un lector propio (soporta ZIP64) y se descomprime con `DecompressionStream` nativo; el XML —que puede ocupar cientos de MB— se analiza **en streaming** agregando por día, sin cargar los registros en memoria.
- Los totales acumulativos (pasos, energía, distancia…) se **deduplican por fuente**: cuando iPhone y Apple Watch registran lo mismo, se toma la fuente con mayor total del día en lugar de sumar ambas.
- Para el sueño se elige por noche la fuente más completa (prioriza la que aporta fases) y cada noche se asigna a la mañana en que termina.
- Gráficas SVG propias con tooltip, media móvil de 7 días y **vista de tabla accesible** en cada tarjeta. Tema claro y oscuro automáticos.

Esta herramienta no ofrece consejo médico.
