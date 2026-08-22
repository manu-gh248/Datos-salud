// Aplicación de análisis de Apple Salud. Todo se calcula y se pinta en el
// navegador a partir de los agregados que devuelve js/salud-worker.js; nada
// sale del dispositivo. Las gráficas son SVG a mano: barras finas con punta
// redondeada, líneas de 2px, rejilla de pelo, tooltip con cruz y vista de
// tabla en cada tarjeta.

"use strict";

// ---------- utilidades ----------
const $ = (sel, raiz) => (raiz || document).querySelector(sel);
const $$ = (sel, raiz) => [...(raiz || document).querySelectorAll(sel)];

const NF = {};
function fnum(v, dec = 0) {
  if (v == null || !isFinite(v)) return "–";
  const k = "d" + dec;
  if (!NF[k]) NF[k] = new Intl.NumberFormat("es-ES", { maximumFractionDigits: dec, minimumFractionDigits: 0 });
  return NF[k].format(v);
}
// Segundos → "7 h 42 m"
function fdur(seg) {
  if (seg == null || !isFinite(seg) || seg <= 0) return "–";
  const h = Math.floor(seg / 3600);
  const m = Math.round((seg % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} min`;
}
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function ffecha(f) {
  return f ? `${+f.slice(8, 10)} ${MESES[+f.slice(5, 7) - 1]}` : "";
}
function ffechaLarga(f) {
  return f ? `${+f.slice(8, 10)} ${MESES[+f.slice(5, 7) - 1]} ${f.slice(0, 4)}` : "–";
}
function sumaDias(f, n) {
  const d = new Date(f + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function listaFechas(ini, fin) {
  const out = [];
  for (let f = ini; f <= fin; f = sumaDias(f, 1)) out.push(f);
  return out;
}
function media(arr) {
  const v = arr.filter((x) => x != null && isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function suma(arr) {
  return arr.reduce((a, b) => a + (b || 0), 0);
}

// Nombres legibles de los tipos de entrenamiento de Apple.
const NOMBRES_ENTRENO = {
  Running: "Correr", Walking: "Caminar", Cycling: "Bici", Swimming: "Natación",
  FunctionalStrengthTraining: "Fuerza funcional", TraditionalStrengthTraining: "Pesas",
  HighIntensityIntervalTraining: "HIIT", Yoga: "Yoga", Pilates: "Pilates",
  CoreTraining: "Core", Elliptical: "Elíptica", Rowing: "Remo", Hiking: "Senderismo",
  StairClimbing: "Escaleras", CrossTraining: "Cross training", MixedCardio: "Cardio mixto",
  Soccer: "Fútbol", Basketball: "Baloncesto", Tennis: "Tenis", Padel: "Pádel",
  MartialArts: "Artes marciales", Boxing: "Boxeo", Dance: "Baile", Golf: "Golf",
  MindAndBody: "Cuerpo y mente", Cooldown: "Enfriamiento", Other: "Otro",
  SocietalGames: "Juegos", Racquetball: "Ráquetbol", Squash: "Squash",
};
function nombreEntreno(t) {
  return NOMBRES_ENTRENO[t] || t.replace(/([a-z])([A-Z])/g, "$1 $2");
}

// ---------- estado ----------
let DATOS = null; // resultado del worker
let RANGO = { dias: 90, ini: null, fin: null }; // filtro activo
let METRICA_EXPL = null; // métrica elegida en el explorador
const CLAVE_LS = "lement-salud-datos";

// ---------- tooltip único ----------
const tip = document.createElement("div");
tip.className = "viz-tip";
tip.hidden = true;
document.body.appendChild(tip);
function muestraTip(x, y, filas) {
  tip.replaceChildren();
  for (const f of filas) {
    const linea = document.createElement("div");
    linea.className = f.titulo ? "viz-tip-titulo" : "viz-tip-fila";
    if (f.color) {
      const sw = document.createElement("span");
      sw.className = "viz-tip-clave";
      sw.style.background = f.color;
      linea.appendChild(sw);
    }
    const val = document.createElement("strong");
    val.textContent = f.valor != null ? f.valor : "";
    const lab = document.createElement("span");
    lab.textContent = f.texto;
    if (f.titulo) linea.appendChild(lab);
    else {
      linea.appendChild(val);
      linea.appendChild(lab);
    }
    tip.appendChild(linea);
  }
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let px = x + 14,
    py = y - r.height - 10;
  if (px + r.width > innerWidth - 8) px = x - r.width - 14;
  if (py < 8) py = y + 16;
  tip.style.left = px + window.scrollX + "px";
  tip.style.top = py + window.scrollY + "px";
}
function ocultaTip() {
  tip.hidden = true;
}

// ---------- SVG ----------
const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs, hijos) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (hijos) for (const h of hijos) e.appendChild(h);
  return e;
}

// Escala Y con ticks limpios.
function escalaY(max, min = 0) {
  if (!(max > min)) max = min + 1;
  const span = max - min;
  const paso = Math.pow(10, Math.floor(Math.log10(span)));
  const cand = [paso / 4, paso / 2, paso, paso * 2, paso * 2.5, paso * 5].find((p) => span / p <= 5) || paso * 5;
  const y0 = Math.floor(min / cand) * cand;
  const y1 = Math.ceil(max / cand) * cand;
  const ticks = [];
  for (let v = y0; v <= y1 + cand / 1e6; v += cand) ticks.push(Math.round(v * 1000) / 1000);
  return { min: y0, max: y1, ticks };
}

const MARGEN = { arr: 12, der: 14, aba: 26, izq: 44 };

// Marco común: superficie, rejilla y ejes. Devuelve funciones de proyección.
function marco(svg, ancho, alto, ey, fechas, fmtTick, fmtX) {
  const w = ancho - MARGEN.izq - MARGEN.der;
  const h = alto - MARGEN.arr - MARGEN.aba;
  const X = (i) => MARGEN.izq + (fechas.length <= 1 ? w / 2 : (i / (fechas.length - 1)) * w);
  const Y = (v) => MARGEN.arr + h - ((v - ey.min) / (ey.max - ey.min || 1)) * h;
  for (const t of ey.ticks) {
    const y = Y(t);
    svg.appendChild(el("line", { x1: MARGEN.izq, x2: ancho - MARGEN.der, y1: y, y2: y, class: t === ey.min ? "viz-eje" : "viz-grid" }));
    const txt = el("text", { x: MARGEN.izq - 8, y: y + 3.5, class: "viz-tick", "text-anchor": "end" });
    txt.textContent = fmtTick ? fmtTick(t) : t >= 10000 ? fnum(t / 1000) + "k" : fnum(t, t < 10 && t % 1 ? 1 : 0);
    svg.appendChild(txt);
  }
  // Etiquetas X: unas pocas fechas repartidas (o todas, si son categorías).
  const nEt = Math.max(2, Math.min(fmtX ? 12 : 7, Math.floor(w / (fmtX ? 40 : 90))));
  const pasoX = Math.max(1, Math.round(fechas.length / nEt));
  for (let i = 0; i < fechas.length; i += pasoX) {
    const txt = el("text", { x: X(i), y: alto - 8, class: "viz-tick", "text-anchor": "middle" });
    txt.textContent = fmtX ? fmtX(fechas[i]) : ffecha(fechas[i]);
    svg.appendChild(txt);
  }
  return { X, Y, w, h };
}

function anchoDe(cont) {
  return Math.max(280, cont.clientWidth || cont.parentElement.clientWidth || 600);
}

// --- barras (una serie), con media móvil opcional ---
function graficaBarras(cont, fechas, valores, ops) {
  cont.replaceChildren();
  const ancho = anchoDe(cont),
    alto = ops.alto || 220;
  const svg = el("svg", { viewBox: `0 0 ${ancho} ${alto}`, width: "100%", height: alto, role: "img" });
  const vmax = Math.max(...valores.filter((v) => v != null), 1);
  const ey = escalaY(vmax * 1.05);
  const { X, Y, w, h } = marco(svg, ancho, alto, ey, fechas, ops.fmtTick, ops.fmtX);
  const paso = fechas.length > 1 ? w / (fechas.length - 1) : w;
  const barW = Math.max(2, Math.min(24, paso - 2));
  const r = Math.min(4, barW / 2);
  const base = Y(ey.min);

  const media7 = ops.media7 ? mediaMovil(valores, 7) : null;

  valores.forEach((v, i) => {
    if (v == null) return;
    const x = X(i) - barW / 2;
    const y = Y(v);
    const hb = Math.max(base - y, 1);
    let barra;
    if (hb > r && barW > 5) {
      barra = el("path", {
        d: `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${base} Z`,
      });
    } else {
      barra = el("rect", { x, y, width: barW, height: hb });
    }
    barra.setAttribute("class", "viz-barra");
    barra.style.fill = ops.color || "var(--s1)";
    svg.appendChild(barra);
  });

  if (media7) {
    svg.appendChild(trazaLinea(media7, X, Y, "var(--s1-linea)"));
  }

  // Etiqueta directa solo en el máximo (si cabe holgada sobre la barra).
  if (ops.etiquetaMax && barW >= 16) {
    let iMax = -1;
    valores.forEach((v, i) => {
      if (v != null && (iMax < 0 || v > valores[iMax])) iMax = i;
    });
    if (iMax >= 0) {
      const et = el("text", { x: X(iMax), y: Y(valores[iMax]) - 7, class: "viz-etiqueta", "text-anchor": "middle" });
      et.textContent = ops.formato ? ops.formato(valores[iMax]) : fnum(valores[iMax]);
      svg.appendChild(et);
    }
  }

  // Capa de interacción por columna (el blanco de golpe es la columna entera).
  capaColumnas(svg, fechas, X, paso, alto, (i, ev) => {
    const filas = [{ titulo: true, texto: ops.tituloX ? ops.tituloX(fechas[i]) : ffechaLarga(fechas[i]) }];
    filas.push({ valor: ops.formato ? ops.formato(valores[i]) : fnum(valores[i]), texto: " " + (ops.unidad || ""), color: ops.color || "var(--s1)" });
    if (media7 && media7[i] != null)
      filas.push({ valor: ops.formato ? ops.formato(media7[i]) : fnum(media7[i]), texto: " media 7 días", color: "var(--s1-linea)" });
    muestraTip(ev.clientX, ev.clientY, filas);
  });

  cont.appendChild(svg);
}

function mediaMovil(valores, n) {
  const out = valores.map(() => null);
  let sumaV = 0,
    cuenta = 0;
  const cola = [];
  valores.forEach((v, i) => {
    cola.push(v);
    if (v != null) {
      sumaV += v;
      cuenta++;
    }
    if (cola.length > n) {
      const q = cola.shift();
      if (q != null) {
        sumaV -= q;
        cuenta--;
      }
    }
    if (cuenta >= Math.min(3, n)) out[i] = sumaV / cuenta;
  });
  return out;
}

// La línea une los días con dato saltando los huecos (el peso, por ejemplo,
// no se mide a diario y aun así debe dibujar una línea continua).
function trazaLinea(valores, X, Y, color) {
  let d = "";
  let dentro = false;
  valores.forEach((v, i) => {
    if (v == null) return;
    d += (dentro ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1);
    dentro = true;
  });
  const p = el("path", { d, class: "viz-linea" });
  p.style.stroke = color;
  return p;
}

// --- líneas (una o varias series) con cruz vertical ---
function graficaLineas(cont, fechas, seriesArr, ops) {
  cont.replaceChildren();
  const ancho = anchoDe(cont),
    alto = ops.alto || 220;
  const svg = el("svg", { viewBox: `0 0 ${ancho} ${alto}`, width: "100%", height: alto, role: "img" });
  const todos = seriesArr.flatMap((s) => s.valores).filter((v) => v != null);
  if (!todos.length) return;
  let vmin = Math.min(...todos),
    vmax = Math.max(...todos);
  if (ops.desdeCero) vmin = 0;
  else {
    const holgura = (vmax - vmin) * 0.15 || vmax * 0.05 || 1;
    vmin = Math.max(0, vmin - holgura);
    vmax += holgura;
  }
  const ey = escalaY(vmax, vmin);
  const { X, Y } = marco(svg, ancho, alto, ey, fechas);

  const cruz = el("line", { y1: MARGEN.arr, y2: alto - MARGEN.aba, class: "viz-cruz" });
  cruz.style.display = "none";
  svg.appendChild(cruz);

  for (const s of seriesArr) {
    svg.appendChild(trazaLinea(s.valores, X, Y, s.color));
    // Con pocas medidas (peso, VO₂max…) se marca cada punto, con su anillo
    // del color de la superficie para que se lea sobre la línea.
    const nDatos = s.valores.filter((v) => v != null).length;
    if (nDatos <= 60 && seriesArr.length === 1) {
      s.valores.forEach((v, i) => {
        if (v == null) return;
        const dot = el("circle", { cx: X(i), cy: Y(v), r: 4, class: "viz-punto" });
        dot.style.fill = s.color;
        svg.appendChild(dot);
      });
    }
    // Punto y etiqueta directa en el último valor con dato.
    for (let i = s.valores.length - 1; i >= 0; i--) {
      if (s.valores[i] != null) {
        const dot = el("circle", { cx: X(i), cy: Y(s.valores[i]), r: 4, class: "viz-punto" });
        dot.style.fill = s.color;
        svg.appendChild(dot);
        const et = el("text", { x: Math.min(X(i), ancho - MARGEN.der - 4), y: Y(s.valores[i]) - 9, class: "viz-etiqueta", "text-anchor": "end" });
        et.textContent = ops.formato ? ops.formato(s.valores[i]) : fnum(s.valores[i], 1);
        svg.appendChild(et);
        break;
      }
    }
  }

  const paso = fechas.length > 1 ? (ancho - MARGEN.izq - MARGEN.der) / (fechas.length - 1) : 1;
  capaColumnas(svg, fechas, X, paso, alto, (i, ev) => {
    cruz.style.display = "";
    cruz.setAttribute("x1", X(i));
    cruz.setAttribute("x2", X(i));
    const filas = [{ titulo: true, texto: ffechaLarga(fechas[i]) }];
    for (const s of seriesArr)
      filas.push({
        valor: s.valores[i] != null ? (ops.formato ? ops.formato(s.valores[i]) : fnum(s.valores[i], 1)) : "–",
        texto: " " + s.nombre,
        color: s.color,
      });
    muestraTip(ev.clientX, ev.clientY, filas);
  }, () => (cruz.style.display = "none"));

  cont.appendChild(svg);
}

// --- barras apiladas ---
function graficaApilada(cont, fechas, capas, valores, ops) {
  // capas: [{clave, nombre, color}] de abajo arriba; valores: i → {clave: v}
  cont.replaceChildren();
  const ancho = anchoDe(cont),
    alto = ops.alto || 240;
  const svg = el("svg", { viewBox: `0 0 ${ancho} ${alto}`, width: "100%", height: alto, role: "img" });
  const totales = valores.map((d) => (d ? suma(capas.map((c) => d[c.clave] || 0)) : 0));
  const ey = escalaY(Math.max(...totales, 1) * 1.05);
  const { X, Y, w } = marco(svg, ancho, alto, ey, fechas, ops.formatoEjeY);
  const paso = fechas.length > 1 ? w / (fechas.length - 1) : w;
  const barW = Math.max(2, Math.min(24, paso - 2));
  const base = Y(ey.min);

  valores.forEach((d, i) => {
    if (!d) return;
    let acum = 0;
    const x = X(i) - barW / 2;
    capas.forEach((c, ci) => {
      const v = d[c.clave] || 0;
      if (v <= 0) return;
      const y1 = Y(acum + v);
      const y0 = Y(acum);
      // Hueco de 2px del color de la superficie entre segmentos.
      const hb = Math.max(y0 - y1 - (acum > 0 ? 2 : 0), 1);
      const seg = el("rect", { x, y: y1 + (acum > 0 ? 2 : 0), width: barW, height: hb, class: "viz-barra" });
      seg.style.fill = c.color;
      svg.appendChild(seg);
      acum += v;
    });
  });

  capaColumnas(svg, fechas, X, paso, alto, (i, ev) => {
    const d = valores[i];
    const filas = [{ titulo: true, texto: (ops.etiquetaX ? ops.etiquetaX(fechas[i]) : ffechaLarga(fechas[i])) }];
    if (d) {
      for (let ci = capas.length - 1; ci >= 0; ci--) {
        const c = capas[ci];
        if (d[c.clave]) filas.push({ valor: ops.formato ? ops.formato(d[c.clave]) : fnum(d[c.clave]), texto: " " + c.nombre, color: c.color });
      }
      if (ops.formatoTotal) filas.push({ valor: ops.formatoTotal(totales[i]), texto: " total" });
    } else filas.push({ valor: "–", texto: " sin datos" });
    muestraTip(ev.clientX, ev.clientY, filas);
  });

  cont.appendChild(svg);
}

// Capa de interacción compartida: una franja por columna, con el blanco de
// golpe más ancho que la marca; funciona con ratón, dedo y teclado.
function capaColumnas(svg, fechas, X, paso, alto, alEntrar, alSalir) {
  const g = el("g", {});
  const wHit = Math.max(paso, 10);
  fechas.forEach((f, i) => {
    const rect = el("rect", { x: X(i) - wHit / 2, y: 0, width: wHit, height: alto, fill: "transparent", tabindex: "-1" });
    rect.addEventListener("pointermove", (ev) => alEntrar(i, ev));
    rect.addEventListener("pointerleave", () => {
      ocultaTip();
      if (alSalir) alSalir();
    });
    g.appendChild(rect);
  });
  svg.addEventListener("pointerleave", () => {
    ocultaTip();
    if (alSalir) alSalir();
  });
  svg.appendChild(g);
}

// Sparkline de tarjeta: 12 puntos de la métrica en el rango.
function sparkline(valores) {
  const puntos = comprime(valores, 12).filter((v) => v.v != null);
  if (puntos.length < 3) return null;
  const w = 84,
    h = 26;
  const vs = puntos.map((p) => p.v);
  const min = Math.min(...vs),
    max = Math.max(...vs);
  const X = (i) => 2 + (i / (puntos.length - 1)) * (w - 4);
  const Y = (v) => 2 + (h - 4) * (1 - (v - min) / (max - min || 1));
  let d = "";
  puntos.forEach((p, i) => (d += (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(p.v).toFixed(1)));
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: "spark", "aria-hidden": "true" });
  const linea = el("path", { d, class: "spark-linea" });
  svg.appendChild(linea);
  const ult = puntos[puntos.length - 1];
  svg.appendChild(el("circle", { cx: X(puntos.length - 1), cy: Y(ult.v), r: 2.6, class: "spark-punto" }));
  return svg;
}
function comprime(valores, n) {
  if (valores.length <= n) return valores.map((v) => ({ v }));
  const out = [];
  const tam = valores.length / n;
  for (let i = 0; i < n; i++) {
    const trozo = valores.slice(Math.floor(i * tam), Math.floor((i + 1) * tam)).filter((v) => v != null);
    out.push({ v: trozo.length ? media(trozo) : null });
  }
  return out;
}

// ---------- vista de tabla (el gemelo accesible de cada gráfica) ----------
function botonTabla(tarjeta, cabeceras, filas) {
  let cont = $(".viz-tabla", tarjeta);
  let btn = $(".btn-tabla", tarjeta);
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-tabla";
    btn.textContent = "Ver tabla";
    $(".cab-tarjeta", tarjeta).appendChild(btn);
    cont = document.createElement("div");
    cont.className = "viz-tabla";
    cont.hidden = true;
    tarjeta.appendChild(cont);
    btn.addEventListener("click", () => {
      cont.hidden = !cont.hidden;
      btn.textContent = cont.hidden ? "Ver tabla" : "Ocultar tabla";
    });
  }
  cont.replaceChildren();
  const tabla = document.createElement("table");
  const trh = document.createElement("tr");
  for (const c of cabeceras) {
    const th = document.createElement("th");
    th.textContent = c;
    trh.appendChild(th);
  }
  tabla.appendChild(trh);
  for (const fila of filas) {
    const tr = document.createElement("tr");
    for (const celda of fila) {
      const td = document.createElement("td");
      td.textContent = celda != null ? String(celda) : "–";
      tr.appendChild(td);
    }
    tabla.appendChild(tr);
  }
  cont.appendChild(tabla);
}

function leyenda(tarjeta, items) {
  let ley = $(".viz-leyenda", tarjeta);
  if (!ley) {
    ley = document.createElement("div");
    ley.className = "viz-leyenda";
    $(".cab-tarjeta", tarjeta).after(ley);
  }
  ley.replaceChildren();
  for (const it of items) {
    const chip = document.createElement("span");
    chip.className = "viz-leyenda-item";
    const sw = document.createElement("span");
    sw.className = it.linea ? "viz-sw-linea" : "viz-sw";
    sw.style.background = it.color;
    chip.appendChild(sw);
    chip.appendChild(document.createTextNode(it.nombre));
    ley.appendChild(chip);
  }
}

// ---------- acceso a los datos ----------
function serie(tipo) {
  return DATOS && DATOS.series[tipo] ? DATOS.series[tipo] : null;
}
function valoresDe(tipo, fechas, sub) {
  const s = serie(tipo);
  if (!s) return fechas.map(() => null);
  const mapa = sub ? s[sub] : s.dias;
  return fechas.map((f) => (mapa && mapa[f] != null ? mapa[f] : null));
}
function fechasDelRango() {
  return listaFechas(RANGO.ini, RANGO.fin);
}
function rangoAnterior() {
  const n = listaFechas(RANGO.ini, RANGO.fin).length;
  const fin = sumaDias(RANGO.ini, -1);
  return listaFechas(sumaDias(fin, -(n - 1)), fin);
}

// Agrupa por semana (lunes) los pares fecha→valor.
function porSemana(fechas, valores, modo) {
  const grupos = new Map();
  fechas.forEach((f, i) => {
    if (valores[i] == null) return;
    const d = new Date(f + "T12:00:00Z");
    const lunes = sumaDias(f, -((d.getUTCDay() + 6) % 7));
    if (!grupos.has(lunes)) grupos.set(lunes, []);
    grupos.get(lunes).push(valores[i]);
  });
  const semanas = [...grupos.keys()].sort();
  return {
    fechas: semanas,
    valores: semanas.map((s) => (modo === "suma" ? suma(grupos.get(s)) : media(grupos.get(s)))),
  };
}

// ---------- carga del archivo ----------
function iniciaCarga() {
  const zona = $("#zona-carga");
  const input = $("#archivo");
  zona.addEventListener("click", () => input.click());
  zona.addEventListener("dragover", (e) => {
    e.preventDefault();
    zona.classList.add("sobre");
  });
  zona.addEventListener("dragleave", () => zona.classList.remove("sobre"));
  zona.addEventListener("drop", (e) => {
    e.preventDefault();
    zona.classList.remove("sobre");
    if (e.dataTransfer.files[0]) procesaArchivo(e.dataTransfer.files[0]);
  });
  input.addEventListener("change", () => {
    if (input.files[0]) procesaArchivo(input.files[0]);
  });
}

function procesaArchivo(file) {
  const barra = $("#progreso");
  const texto = $("#progreso-texto");
  $("#zona-carga").hidden = true;
  $("#cargando").hidden = false;
  $("#error-carga").hidden = true;

  const worker = new Worker("/js/salud-worker.js");
  worker.postMessage({ file });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.tipo === "progreso") {
      barra.style.width = m.pct + "%";
      texto.textContent = `Leyendo… ${fnum(m.registros)} registros`;
    } else if (m.tipo === "listo") {
      worker.terminate();
      if (!m.datos.meta.fechaMax) {
        muestraErrorCarga("El archivo no contiene registros de Apple Salud. ¿Seguro que es el export.zip de la app Salud?");
        return;
      }
      DATOS = m.datos;
      guardaLocal();
      arrancaApp();
    } else if (m.tipo === "error") {
      worker.terminate();
      muestraErrorCarga(m.mensaje);
    }
  };
  worker.onerror = (e) => {
    worker.terminate();
    muestraErrorCarga("No se pudo analizar el archivo: " + (e.message || "error desconocido"));
  };
}

function muestraErrorCarga(msg) {
  $("#cargando").hidden = true;
  $("#zona-carga").hidden = false;
  const err = $("#error-carga");
  err.textContent = msg;
  err.hidden = false;
}

function guardaLocal() {
  try {
    const json = JSON.stringify(DATOS);
    if (json.length < 4_500_000) localStorage.setItem(CLAVE_LS, json);
    else localStorage.removeItem(CLAVE_LS);
  } catch (e) {
    /* sin sitio: no pasa nada, simplemente no se recuerda */
  }
}

// ---------- arranque de la app ----------
function arrancaApp() {
  $("#cargador").hidden = true;
  $("#app").hidden = false;

  const meta = DATOS.meta;
  $("#resumen-datos").textContent =
    `${fnum(meta.nRegistros)} registros · del ${ffechaLarga(meta.fechaMin)} al ${ffechaLarga(meta.fechaMax)}` +
    (meta.fuentes.length ? ` · ${meta.fuentes.slice(0, 3).join(", ")}` : "");

  aplicaPreset(RANGO.dias || 90);
  $$("#filtros .preset").forEach((b) => {
    b.addEventListener("click", () => {
      $$("#filtros .preset").forEach((x) => x.classList.remove("activo"));
      b.classList.add("activo");
      if (b.dataset.dias === "todo") {
        RANGO = { dias: "todo", ini: DATOS.meta.fechaMin, fin: DATOS.meta.fechaMax };
        pintaFechasPersonalizadas();
        render();
      } else aplicaPreset(+b.dataset.dias);
    });
  });
  $("#f-ini").addEventListener("change", cambioManual);
  $("#f-fin").addEventListener("change", cambioManual);

  let timer;
  addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(render, 200);
  });
}

function aplicaPreset(dias) {
  const fin = DATOS.meta.fechaMax < hoyISO() ? DATOS.meta.fechaMax : hoyISO();
  RANGO = { dias, ini: sumaDias(fin, -(dias - 1)), fin };
  if (RANGO.ini < DATOS.meta.fechaMin) RANGO.ini = DATOS.meta.fechaMin;
  pintaFechasPersonalizadas();
  render();
}
function pintaFechasPersonalizadas() {
  $("#f-ini").value = RANGO.ini;
  $("#f-fin").value = RANGO.fin;
}
function cambioManual() {
  const ini = $("#f-ini").value,
    fin = $("#f-fin").value;
  if (!ini || !fin || ini > fin) return;
  RANGO = { dias: null, ini, fin };
  $$("#filtros .preset").forEach((x) => x.classList.remove("activo"));
  render();
}

// ---------- render general ----------
function render() {
  const fechas = fechasDelRango();
  renderKPIs(fechas);
  renderComparativa(fechas);
  renderPanorama(fechas);
  renderInteligencia(fechas);
  renderInesperados(fechas);
  renderMeds(fechas);
  renderConsejos(fechas);
  renderRecords(fechas);
  renderTendencias(fechas);
  renderActividad(fechas);
  renderSemanaTipo(fechas);
  renderCorazon(fechas);
  renderSueno(fechas);
  renderRitmo(fechas);
  renderEntrenos(fechas);
  renderPeso(fechas);
  renderExplorador(fechas);
}

// ---------- KPIs ----------
function renderKPIs(fechas) {
  const prev = rangoAnterior();
  const cont = $("#kpis");
  cont.replaceChildren();

  const defs = [
    { tipo: "HKQuantityTypeIdentifierStepCount", n: "Pasos al día", agg: "media", fmt: (v) => fnum(v), subeBien: true },
    { esSueno: true, n: "Sueño por noche", fmt: (v) => fdur(v), subeBien: true },
    { tipo: "HKQuantityTypeIdentifierRestingHeartRate", n: "FC en reposo", agg: "media", fmt: (v) => fnum(v, 0) + " ppm", subeBien: false },
    { tipo: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", n: "Variabilidad (HRV)", agg: "media", fmt: (v) => fnum(v, 0) + " ms", subeBien: true },
    { esEntrenos: true, n: "Entrenos por semana", fmt: (v) => fnum(v, 1), subeBien: true },
    { tipo: "HKQuantityTypeIdentifierActiveEnergyBurned", n: "Energía activa al día", agg: "media", fmt: (v) => fnum(v) + " kcal", subeBien: true },
    { tipo: "HKQuantityTypeIdentifierVO2Max", n: "VO₂ máx", agg: "media", fmt: (v) => fnum(v, 1), subeBien: true },
    { tipo: "HKQuantityTypeIdentifierBodyMass", n: "Peso", agg: "media", fmt: (v) => fnum(v, 1) + " kg", subeBien: null },
  ];

  for (const d of defs) {
    let ahora, antes, diarios;
    if (d.esSueno) {
      diarios = fechas.map((f) => (DATOS.sueno[f] ? DATOS.sueno[f].dormido : null));
      ahora = media(diarios);
      antes = media(prev.map((f) => (DATOS.sueno[f] ? DATOS.sueno[f].dormido : null)));
    } else if (d.esEntrenos) {
      const enRango = DATOS.entrenos.filter((e) => e.fecha >= RANGO.ini && e.fecha <= RANGO.fin);
      const enPrev = DATOS.entrenos.filter((e) => e.fecha >= prev[0] && e.fecha <= prev[prev.length - 1]);
      ahora = (enRango.length / fechas.length) * 7;
      antes = prev.length ? (enPrev.length / prev.length) * 7 : null;
      const porDia = new Map();
      enRango.forEach((e) => porDia.set(e.fecha, (porDia.get(e.fecha) || 0) + e.dur));
      diarios = fechas.map((f) => porDia.get(f) || 0);
      if (!enRango.length && !enPrev.length) continue;
    } else {
      if (!serie(d.tipo)) continue;
      diarios = valoresDe(d.tipo, fechas);
      ahora = media(diarios);
      antes = media(valoresDe(d.tipo, prev));
    }
    if (ahora == null) continue;

    const tarjeta = document.createElement("div");
    tarjeta.className = "kpi";
    const lab = document.createElement("div");
    lab.className = "kpi-etiqueta";
    lab.textContent = d.n;
    const val = document.createElement("div");
    val.className = "kpi-valor";
    val.textContent = d.fmt(ahora);
    tarjeta.appendChild(lab);
    tarjeta.appendChild(val);

    if (antes != null && antes !== 0) {
      const pct = ((ahora - antes) / Math.abs(antes)) * 100;
      if (isFinite(pct) && Math.abs(pct) >= 0.5) {
        const delta = document.createElement("div");
        const bien = d.subeBien == null ? null : pct >= 0 === d.subeBien;
        delta.className = "kpi-delta " + (bien == null ? "neutro" : bien ? "bueno" : "malo");
        delta.textContent = `${pct >= 0 ? "▲" : "▼"} ${fnum(Math.abs(pct), 1)} % vs periodo anterior`;
        tarjeta.appendChild(delta);
      }
    }
    const sp = sparkline(diarios);
    if (sp) tarjeta.appendChild(sp);
    cont.appendChild(tarjeta);
  }
}

// ---------- tendencias ----------
function renderTendencias(fechas) {
  const prev = rangoAnterior();
  const cont = $("#lista-tendencias");
  cont.replaceChildren();

  const candidatos = [
    { tipo: "HKQuantityTypeIdentifierStepCount", subeBien: true },
    { tipo: "HKQuantityTypeIdentifierActiveEnergyBurned", subeBien: true },
    { tipo: "HKQuantityTypeIdentifierAppleExerciseTime", subeBien: true },
    { tipo: "HKQuantityTypeIdentifierRestingHeartRate", subeBien: false },
    { tipo: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", subeBien: true },
    { tipo: "HKQuantityTypeIdentifierVO2Max", subeBien: true },
    { tipo: "HKQuantityTypeIdentifierRespiratoryRate", subeBien: null },
    { tipo: "HKQuantityTypeIdentifierOxygenSaturation", subeBien: true },
    { tipo: "HKQuantityTypeIdentifierBodyMass", subeBien: null },
    { tipo: "HKQuantityTypeIdentifierWalkingSpeed", subeBien: true },
    { esSueno: "dormido", nombre: "Sueño total", subeBien: true },
    { esSueno: "profundo", nombre: "Sueño profundo", subeBien: true },
    { esSueno: "rem", nombre: "Sueño REM", subeBien: true },
  ];

  const items = [];
  for (const c of candidatos) {
    let ahora, antes, nombre, fmt;
    if (c.esSueno) {
      ahora = media(fechas.map((f) => (DATOS.sueno[f] ? DATOS.sueno[f][c.esSueno] : null)));
      antes = media(prev.map((f) => (DATOS.sueno[f] ? DATOS.sueno[f][c.esSueno] : null)));
      nombre = c.nombre;
      fmt = fdur;
    } else {
      const s = serie(c.tipo);
      if (!s) continue;
      ahora = media(valoresDe(c.tipo, fechas));
      antes = media(valoresDe(c.tipo, prev));
      nombre = s.nombre;
      fmt = (v) => fnum(v, v < 10 ? 1 : 0) + (s.unidad ? " " + s.unidad : "");
    }
    if (ahora == null || antes == null || antes === 0) continue;
    const pct = ((ahora - antes) / Math.abs(antes)) * 100;
    if (!isFinite(pct) || Math.abs(pct) < 1) continue;
    items.push({ nombre, pct, ahora, antes, fmt, subeBien: c.subeBien });
  }
  items.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  $("#tendencias").hidden = !items.length;
  $("#tendencias-sub").textContent = `Comparado con los ${fechas.length} días anteriores al rango elegido.`;
  for (const it of items.slice(0, 8)) {
    const fila = document.createElement("div");
    const bien = it.subeBien == null ? null : it.pct >= 0 === it.subeBien;
    fila.className = "tendencia " + (bien == null ? "neutro" : bien ? "bueno" : "malo");
    const flecha = document.createElement("span");
    flecha.className = "tend-flecha";
    flecha.textContent = it.pct >= 0 ? "▲" : "▼";
    const cuerpo = document.createElement("div");
    const t1 = document.createElement("strong");
    t1.textContent = `${it.nombre}: ${it.pct >= 0 ? "+" : "−"}${fnum(Math.abs(it.pct), 1)} %`;
    const t2 = document.createElement("span");
    t2.className = "tend-detalle";
    t2.textContent = ` ${it.fmt(it.ahora)} de media, antes ${it.fmt(it.antes)}`;
    cuerpo.appendChild(t1);
    cuerpo.appendChild(t2);
    fila.appendChild(flecha);
    fila.appendChild(cuerpo);
    cont.appendChild(fila);
  }
}

// ---------- actividad ----------
function renderActividad(fechas) {
  const tarjeta = $("#c-pasos");
  const s = serie("HKQuantityTypeIdentifierStepCount");
  tarjeta.hidden = !s;
  if (!s) return;
  let f = fechas,
    v = valoresDe("HKQuantityTypeIdentifierStepCount", fechas).map((x) => x || 0),
    sub = "Pasos cada día y media móvil de 7 días.";
  if (fechas.length > 130) {
    const sem = porSemana(fechas, v, "media");
    f = sem.fechas;
    v = sem.valores;
    sub = "Media diaria de pasos por semana.";
  }
  $(".sub-tarjeta", tarjeta).textContent = sub;
  graficaBarras($(".viz", tarjeta), f, v, { unidad: "pasos", media7: fechas.length <= 130, formato: (x) => fnum(x) });
  botonTabla(tarjeta, ["Fecha", "Pasos"], f.map((x, i) => [ffechaLarga(x), fnum(v[i])]));
}

// ---------- corazón (dos gráficas hermanas, nunca doble eje) ----------
function renderCorazon(fechas) {
  const seccion = $("#s-corazon");
  const rep = serie("HKQuantityTypeIdentifierRestingHeartRate");
  const hrv = serie("HKQuantityTypeIdentifierHeartRateVariabilitySDNN");
  const fc = serie("HKQuantityTypeIdentifierHeartRate");
  seccion.hidden = !rep && !hrv && !fc;
  if (seccion.hidden) return;

  const t1 = $("#c-fcreposo");
  t1.hidden = !rep;
  if (rep) {
    const v = valoresDe("HKQuantityTypeIdentifierRestingHeartRate", fechas);
    graficaLineas($(".viz", t1), fechas, [{ nombre: "FC en reposo", color: "var(--s1)", valores: v }], { formato: (x) => fnum(x) });
    botonTabla(t1, ["Fecha", "FC en reposo (ppm)"], fechas.map((f, i) => [ffechaLarga(f), v[i] != null ? fnum(v[i]) : null]));
  }
  const t2 = $("#c-hrv");
  t2.hidden = !hrv;
  if (hrv) {
    const v = valoresDe("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", fechas);
    graficaLineas($(".viz", t2), fechas, [{ nombre: "HRV", color: "var(--s1)", valores: v }], { formato: (x) => fnum(x) });
    botonTabla(t2, ["Fecha", "HRV (ms)"], fechas.map((f, i) => [ffechaLarga(f), v[i] != null ? fnum(v[i]) : null]));
  }
  const t3 = $("#c-fcdia");
  t3.hidden = !fc || !fc.min;
  if (fc && fc.min) {
    const vMed = valoresDe("HKQuantityTypeIdentifierHeartRate", fechas);
    const vMin = valoresDe("HKQuantityTypeIdentifierHeartRate", fechas, "min");
    const vMax = valoresDe("HKQuantityTypeIdentifierHeartRate", fechas, "max");
    graficaLineas(
      $(".viz", t3),
      fechas,
      [
        { nombre: "Máxima", color: "var(--s2)", valores: vMax },
        { nombre: "Media", color: "var(--s1)", valores: vMed },
        { nombre: "Mínima", color: "var(--s3)", valores: vMin },
      ],
      { formato: (x) => fnum(x) }
    );
    leyenda(t3, [
      { nombre: "Máxima", color: "var(--s2)", linea: true },
      { nombre: "Media", color: "var(--s1)", linea: true },
      { nombre: "Mínima", color: "var(--s3)", linea: true },
    ]);
    botonTabla(
      t3,
      ["Fecha", "Mín", "Media", "Máx"],
      fechas.map((f, i) => [ffechaLarga(f), vMin[i], vMed[i] != null ? fnum(vMed[i]) : null, vMax[i]])
    );
  }
}

// ---------- sueño ----------
const CAPAS_SUENO = [
  { clave: "profundo", nombre: "Profundo", color: "var(--s1)" },
  { clave: "rem", nombre: "REM", color: "var(--s2)" },
  { clave: "ligero", nombre: "Ligero", color: "var(--s3)" },
  { clave: "despierto", nombre: "Despierto", color: "var(--s4)" },
];

function renderSueno(fechas) {
  const seccion = $("#s-sueno");
  const noches = fechas.filter((f) => DATOS.sueno[f]);
  seccion.hidden = !noches.length;
  if (!noches.length) return;

  // Tarjetitas de resumen.
  const dur = media(noches.map((f) => DATOS.sueno[f].dormido));
  const prof = media(noches.map((f) => DATOS.sueno[f].profundo));
  const remM = media(noches.map((f) => DATOS.sueno[f].rem));
  const efi = media(
    noches
      .map((f) => {
        const n = DATOS.sueno[f];
        return n.enCama > 0 ? Math.min(100, (n.dormido / n.enCama) * 100) : null;
      })
      .filter((x) => x != null)
  );
  const aMin = media(noches.map((f) => minutosDeHora(DATOS.sueno[f].inicio, true)).filter((x) => x != null));
  const dMin = media(noches.map((f) => minutosDeHora(DATOS.sueno[f].fin, false)).filter((x) => x != null));
  const kpis = [
    ["Dormido de media", fdur(dur)],
    ["Profundo", fdur(prof)],
    ["REM", fdur(remM)],
    ["Eficiencia", efi != null ? fnum(efi, 0) + " %" : "–"],
    ["Te acuestas sobre las", horaDeMinutos(aMin, true)],
    ["Te levantas sobre las", horaDeMinutos(dMin, false)],
  ];
  const cont = $("#kpis-sueno");
  cont.replaceChildren();
  for (const [lab, val] of kpis) {
    if (val === "–") continue;
    const div = document.createElement("div");
    div.className = "kpi kpi-mini";
    const l = document.createElement("div");
    l.className = "kpi-etiqueta";
    l.textContent = lab;
    const v = document.createElement("div");
    v.className = "kpi-valor";
    v.textContent = val;
    div.appendChild(l);
    div.appendChild(v);
    cont.appendChild(div);
  }

  const tarjeta = $("#c-sueno");
  const hayFases = noches.some((f) => DATOS.sueno[f].profundo + DATOS.sueno[f].rem > 0);
  const capas = hayFases ? CAPAS_SUENO : [{ clave: "dormido", nombre: "Dormido", color: "var(--s1)" }];

  // Las fases se pintan en horas para que el eje salga limpio (0, 2, 4, 6 h…).
  let f = fechas,
    valores,
    sub;
  const fmtH = (h) => fdur(h * 3600);
  const aHoras = (x) => {
    const n = DATOS.sueno[x];
    if (!n) return null;
    const d = {};
    for (const c of capas) d[c.clave] = (n[c.clave] || 0) / 3600;
    return d;
  };
  if (fechas.length > 130) {
    // Por semana: media de cada fase.
    const porFase = {};
    for (const c of capas) {
      const sem = porSemana(fechas, fechas.map((x) => (DATOS.sueno[x] ? DATOS.sueno[x][c.clave] / 3600 : null)), "media");
      porFase[c.clave] = sem;
      f = sem.fechas;
    }
    valores = f.map((x, i) => {
      const d = {};
      for (const c of capas) d[c.clave] = porFase[c.clave].valores[i] || 0;
      return suma(Object.values(d)) > 0 ? d : null;
    });
    sub = "Media por semana del tiempo en cada fase.";
  } else {
    valores = fechas.map(aHoras);
    sub = "Cada noche, tiempo en cada fase. La noche se apunta al día en que te despiertas.";
  }
  $(".sub-tarjeta", tarjeta).textContent = sub;
  if (capas.length > 1) leyenda(tarjeta, capas);
  graficaApilada($(".viz", tarjeta), f, capas, valores, {
    alto: 250,
    formato: fmtH,
    formatoTotal: fmtH,
    formatoEjeY: (v) => fnum(v, 0) + " h",
  });
  botonTabla(
    tarjeta,
    ["Noche", ...capas.map((c) => c.nombre), "Total"],
    f.map((x, i) => {
      const d = valores[i];
      return [ffechaLarga(x), ...capas.map((c) => (d ? fmtH(d[c.clave]) : null)), d ? fmtH(suma(capas.map((c) => d[c.clave] || 0))) : null];
    })
  );
}

// "2026-03-01 23:45" → minutos relativos para promediar horas de acostarse
// (las de después de medianoche cuentan como 24h+).
function minutosDeHora(s, esAcostarse) {
  if (!s) return null;
  const h = +s.slice(11, 13),
    m = +s.slice(14, 16);
  let min = h * 60 + m;
  if (esAcostarse && h < 12) min += 1440;
  return min;
}
function horaDeMinutos(min, esAcostarse) {
  if (min == null || !isFinite(min)) return "–";
  let m = Math.round(min) % 1440;
  const h = Math.floor(m / 60),
    mm = m % 60;
  return `${h}:${String(mm).padStart(2, "0")}`;
}

// ---------- entrenamientos ----------
function renderEntrenos(fechas) {
  const seccion = $("#s-entrenos");
  const lista = DATOS.entrenos.filter((e) => e.fecha >= RANGO.ini && e.fecha <= RANGO.fin);
  seccion.hidden = !lista.length;
  if (!lista.length) return;

  // Resumen.
  const totalMin = suma(lista.map((e) => e.dur));
  const kcal = suma(lista.map((e) => e.energia || 0));
  const km = suma(lista.map((e) => e.dist || 0));
  const semanas = Math.max(1, fechas.length / 7);
  const kpis = [
    ["Entrenamientos", fnum(lista.length)],
    ["Por semana", fnum(lista.length / semanas, 1)],
    ["Tiempo total", fdur(totalMin * 60)],
    ["Energía", kcal ? fnum(kcal) + " kcal" : "–"],
    ["Distancia", km ? fnum(km, 1) + " km" : "–"],
  ];
  const cont = $("#kpis-entrenos");
  cont.replaceChildren();
  for (const [lab, val] of kpis) {
    if (val === "–") continue;
    const div = document.createElement("div");
    div.className = "kpi kpi-mini";
    const l = document.createElement("div");
    l.className = "kpi-etiqueta";
    l.textContent = lab;
    const v = document.createElement("div");
    v.className = "kpi-valor";
    v.textContent = val;
    div.appendChild(l);
    div.appendChild(v);
    cont.appendChild(div);
  }

  // Minutos por semana apilados por tipo (los 4 más frecuentes + Otros).
  const porTipo = new Map();
  lista.forEach((e) => porTipo.set(e.tipo, (porTipo.get(e.tipo) || 0) + e.dur));
  const top = [...porTipo.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const principales = top.slice(0, 4);
  const hayOtros = top.length > 4;
  const colores = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
  const capas = principales.map((t, i) => ({ clave: t, nombre: nombreEntreno(t), color: colores[i] }));
  if (hayOtros) capas.push({ clave: "__otros", nombre: "Otros", color: "var(--otros)" });

  const grupos = new Map();
  lista.forEach((e) => {
    const d = new Date(e.fecha + "T12:00:00Z");
    const lunes = sumaDias(e.fecha, -((d.getUTCDay() + 6) % 7));
    if (!grupos.has(lunes)) grupos.set(lunes, {});
    const g = grupos.get(lunes);
    const clave = principales.includes(e.tipo) ? e.tipo : "__otros";
    g[clave] = (g[clave] || 0) + e.dur;
  });
  // Todas las semanas del rango, también las vacías.
  const d0 = new Date(RANGO.ini + "T12:00:00Z");
  const primerLunes = sumaDias(RANGO.ini, -((d0.getUTCDay() + 6) % 7));
  const semanasF = [];
  for (let s = primerLunes; s <= RANGO.fin; s = sumaDias(s, 7)) semanasF.push(s);
  const valores = semanasF.map((s) => grupos.get(s) || null);

  const tarjeta = $("#c-entrenos");
  leyenda(tarjeta, capas);
  graficaApilada($(".viz", tarjeta), semanasF, capas, valores, {
    alto: 240,
    formato: (v) => fnum(v) + " min",
    formatoTotal: (v) => fnum(v) + " min",
    etiquetaX: (s) => "Semana del " + ffechaLarga(s),
  });
  botonTabla(
    tarjeta,
    ["Semana", ...capas.map((c) => c.nombre)],
    semanasF.map((s, i) => ["Semana del " + ffechaLarga(s), ...capas.map((c) => (valores[i] && valores[i][c.clave] ? fnum(valores[i][c.clave]) + " min" : null))])
  );

  // Tabla de los últimos entrenamientos.
  const cuerpo = $("#tabla-entrenos tbody");
  cuerpo.replaceChildren();
  for (const e of [...lista].reverse().slice(0, 30)) {
    const tr = document.createElement("tr");
    const celdas = [
      ffechaLarga(e.fecha) + " " + e.hora,
      nombreEntreno(e.tipo),
      fnum(e.dur) + " min",
      e.energia ? fnum(e.energia) + " kcal" : "–",
      e.dist ? fnum(e.dist, 2) + " km" : "–",
      e.fc ? fnum(e.fc) + " ppm" : "–",
    ];
    for (const c of celdas) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    }
    cuerpo.appendChild(tr);
  }
}

// ---------- peso ----------
function renderPeso(fechas) {
  const tarjeta = $("#c-peso");
  const s = serie("HKQuantityTypeIdentifierBodyMass");
  const v = s ? valoresDe("HKQuantityTypeIdentifierBodyMass", fechas) : [];
  const hay = v.some((x) => x != null);
  tarjeta.hidden = !hay;
  if (!hay) return;
  graficaLineas($(".viz", tarjeta), fechas, [{ nombre: "Peso", color: "var(--s1)", valores: v }], { formato: (x) => fnum(x, 1) });
  botonTabla(tarjeta, ["Fecha", "Peso (kg)"], fechas.filter((f, i) => v[i] != null).map((f) => [ffechaLarga(f), fnum(v[fechas.indexOf(f)], 1)]));
}

// ---------- explorador ----------
function renderExplorador(fechas) {
  const sel = $("#sel-metrica");
  const tipos = Object.keys(DATOS.series).sort((a, b) => DATOS.series[a].nombre.localeCompare(DATOS.series[b].nombre, "es"));
  if (sel.options.length !== tipos.length) {
    sel.replaceChildren();
    for (const t of tipos) {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = DATOS.series[t].nombre + (DATOS.series[t].unidad ? ` (${DATOS.series[t].unidad})` : "");
      sel.appendChild(o);
    }
    sel.value = METRICA_EXPL && tipos.includes(METRICA_EXPL) ? METRICA_EXPL : tipos.includes("HKQuantityTypeIdentifierStepCount") ? "HKQuantityTypeIdentifierStepCount" : tipos[0];
    sel.onchange = () => {
      METRICA_EXPL = sel.value;
      renderExplorador(fechasDelRango());
    };
  }
  METRICA_EXPL = sel.value;
  const s = serie(METRICA_EXPL);
  if (!s) return;

  const v = valoresDe(METRICA_EXPL, fechas);
  const conDato = v.filter((x) => x != null);
  const tarjeta = $("#c-explorador");
  const dec = conDato.length && Math.max(...conDato) < 50 ? 1 : 0;
  const fmt = (x) => fnum(x, dec) + (s.unidad ? " " + s.unidad : "");

  // Estadísticas del rango + tendencia por regresión lineal simple.
  const stats = $("#stats-metrica");
  stats.replaceChildren();
  if (conDato.length) {
    const m = media(conDato);
    const idx = [];
    v.forEach((x, i) => {
      if (x != null) idx.push([i, x]);
    });
    let pendiente = null;
    if (idx.length > 4) {
      const n = idx.length;
      const mx = idx.reduce((a, p) => a + p[0], 0) / n;
      const my = idx.reduce((a, p) => a + p[1], 0) / n;
      const num = idx.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
      const den = idx.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
      if (den > 0) pendiente = (num / den) * 30; // por 30 días
    }
    const piezas = [
      ["Media", fmt(m)],
      ["Mínimo", fmt(Math.min(...conDato))],
      ["Máximo", fmt(Math.max(...conDato))],
      ["Días con dato", fnum(conDato.length)],
    ];
    if (pendiente != null && m) {
      const pct = (pendiente / m) * 100;
      if (isFinite(pct) && Math.abs(pct) >= 0.5) piezas.push(["Tendencia", `${pct >= 0 ? "+" : "−"}${fnum(Math.abs(pct), 1)} % cada 30 días`]);
    }
    for (const [lab, val] of piezas) {
      const div = document.createElement("div");
      div.className = "kpi kpi-mini";
      const l = document.createElement("div");
      l.className = "kpi-etiqueta";
      l.textContent = lab;
      const x = document.createElement("div");
      x.className = "kpi-valor";
      x.textContent = val;
      div.appendChild(l);
      div.appendChild(x);
      stats.appendChild(div);
    }
  }

  let f = fechas,
    vv = v,
    esSuma = s.agg === "suma";
  if (fechas.length > 130) {
    const sem = porSemana(fechas, v, esSuma ? "suma" : "media");
    f = sem.fechas;
    vv = sem.valores;
  }
  if (esSuma) graficaBarras($(".viz", tarjeta), f, vv.map((x) => x || 0), { unidad: s.unidad, formato: (x) => fnum(x, dec), media7: fechas.length <= 130 });
  else graficaLineas($(".viz", tarjeta), f, [{ nombre: s.nombre, color: "var(--s1)", valores: vv }], { formato: (x) => fnum(x, dec) });
  botonTabla(
    tarjeta,
    ["Fecha", s.nombre + (s.unidad ? ` (${s.unidad})` : "")],
    f.map((x, i) => [ffechaLarga(x), vv[i] != null ? fnum(vv[i], dec) : null]).filter((r) => r[1] != null)
  );
}

// ===========================================================================
// Tablas derivadas para los cruces de datos
// ===========================================================================

// Una fila por día del rango con todo alineado: la noche que TERMINA la
// mañana de ese día (el sueño con el que arrancas el día), el entreno del
// día, y las métricas del día.
function tablaDias(fechas) {
  const entrenoPorDia = new Map();
  for (const e of DATOS.entrenos) entrenoPorDia.set(e.fecha, (entrenoPorDia.get(e.fecha) || 0) + e.dur);
  const v = (tipo) => valoresDe(tipo, fechas);
  const pasos = v("HKQuantityTypeIdentifierStepCount"),
    energia = v("HKQuantityTypeIdentifierActiveEnergyBurned"),
    minEj = v("HKQuantityTypeIdentifierAppleExerciseTime"),
    fcRep = v("HKQuantityTypeIdentifierRestingHeartRate"),
    hrv = v("HKQuantityTypeIdentifierHeartRateVariabilitySDNN"),
    peso = v("HKQuantityTypeIdentifierBodyMass"),
    vo2 = v("HKQuantityTypeIdentifierVO2Max"),
    cafeina = v("HKQuantityTypeIdentifierDietaryCaffeine"),
    alcohol = v("HKQuantityTypeIdentifierNumberOfAlcoholicBeverages"),
    frecResp = v("HKQuantityTypeIdentifierRespiratoryRate"),
    spo2 = v("HKQuantityTypeIdentifierOxygenSaturation"),
    tempMuneca = v("HKQuantityTypeIdentifierAppleSleepingWristTemperature"),
    ruido = v("HKQuantityTypeIdentifierEnvironmentalAudioExposure"),
    luzDia = v("HKQuantityTypeIdentifierTimeInDaylight"),
    agua = v("HKQuantityTypeIdentifierDietaryWater");
  return fechas.map((f, i) => {
    const noche = DATOS.sueno[f] || null; // termina la mañana de f
    const dow = (new Date(f + "T12:00:00Z").getUTCDay() + 6) % 7; // 0 = lunes
    return {
      f,
      dow,
      finde: dow >= 5,
      pasos: pasos[i],
      energia: energia[i],
      minEj: minEj[i],
      fcReposo: fcRep[i],
      hrv: hrv[i],
      peso: peso[i],
      vo2: vo2[i],
      entrenoMin: entrenoPorDia.get(f) || 0,
      cafeina: cafeina[i],
      alcohol: alcohol[i],
      frecResp: frecResp[i],
      spo2: spo2[i],
      tempMuneca: tempMuneca[i],
      ruido: ruido[i],
      luzDia: luzDia[i],
      agua: agua[i],
      dormidoH: noche ? noche.dormido / 3600 : null,
      profundoH: noche ? noche.profundo / 3600 : null,
      remH: noche ? noche.rem / 3600 : null,
      eficiencia: noche && noche.enCama > 0 ? Math.min(100, (noche.dormido / noche.enCama) * 100) : null,
      acostarseH: noche && noche.inicio ? minutosDeHora(noche.inicio, true) / 60 : null,
    };
  });
}

// Una fila por noche del rango, con lo que pasó el día ANTERIOR (¿entrenó?,
// ¿cuánto caminó?) y lo que amaneció al día siguiente (HRV, FC en reposo).
function tablaNoches(fechas) {
  const entrenoPorDia = new Map();
  for (const e of DATOS.entrenos) entrenoPorDia.set(e.fecha, (entrenoPorDia.get(e.fecha) || 0) + e.dur);
  const noches = [];
  for (const f of fechas) {
    const n = DATOS.sueno[f];
    if (!n) continue;
    const ayer = sumaDias(f, -1);
    const sPasos = serie("HKQuantityTypeIdentifierStepCount");
    const sHrv = serie("HKQuantityTypeIdentifierHeartRateVariabilitySDNN");
    const sFc = serie("HKQuantityTypeIdentifierRestingHeartRate");
    const dowAyer = (new Date(ayer + "T12:00:00Z").getUTCDay() + 6) % 7;
    noches.push({
      f,
      visperaFinde: dowAyer === 4 || dowAyer === 5, // noche de viernes o sábado
      dormido: n.dormido,
      profundo: n.profundo,
      rem: n.rem,
      acostarse: n.inicio ? minutosDeHora(n.inicio, true) : null,
      levantarse: n.fin ? minutosDeHora(n.fin, false) + 1440 : null,
      entrenoAyer: entrenoPorDia.get(ayer) || 0,
      pasosAyer: sPasos && sPasos.dias[ayer] != null ? sPasos.dias[ayer] : null,
      hrvManana: sHrv && sHrv.dias[f] != null ? sHrv.dias[f] : null,
      fcManana: sFc && sFc.dias[f] != null ? sFc.dias[f] : null,
    });
  }
  return noches;
}

function mediana(arr) {
  const v = arr.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.floor(v.length / 2)];
}
function desviacion(arr) {
  const v = arr.filter((x) => x != null && isFinite(x));
  if (v.length < 3) return null;
  const m = media(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length);
}
// Compara la media de `valor` entre el grupo que cumple `cond` y el resto.
function comparaGrupos(filas, cond, valor) {
  const a = [],
    b = [];
  for (const it of filas) {
    const v = valor(it);
    if (v == null || !isFinite(v)) continue;
    (cond(it) ? a : b).push(v);
  }
  return { ma: media(a), mb: media(b), na: a.length, nb: b.length };
}
function pearson(pares) {
  const n = pares.length;
  if (n < 8) return null;
  const mx = media(pares.map((p) => p[0])),
    my = media(pares.map((p) => p[1]));
  let num = 0,
    dx = 0,
    dy = 0;
  for (const [x, y] of pares) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  if (!dx || !dy) return null;
  return { r: num / Math.sqrt(dx * dy), pendiente: num / dx, b0: my - (num / dx) * mx, n };
}
function horaTexto(min) {
  if (min == null) return "–";
  const m = Math.round(min) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
const DIAS_SEMANA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const DIAS_CORTOS = ["L", "M", "X", "J", "V", "S", "D"];

// ===========================================================================
// Motor de hallazgos: cruza los datos y redacta lo que encuentra
// ===========================================================================
function motorHallazgos(fechas) {
  const noches = tablaNoches(fechas);
  const dias = tablaDias(fechas);
  const H = [];
  const minGrupo = 5;

  // 1) Entrenar → sueño de esa noche
  let c = comparaGrupos(noches, (n) => n.entrenoAyer > 0, (n) => n.dormido);
  if (c.na >= minGrupo && c.nb >= minGrupo && Math.abs(c.ma - c.mb) >= 12 * 60) {
    const masMenos = c.ma > c.mb ? "más" : "menos";
    H.push({
      clase: c.ma > c.mb ? "bueno" : "malo",
      titulo: `Los días que entrenas duermes ${fdur(Math.abs(c.ma - c.mb))} ${masMenos} esa noche`,
      detalle: `${fdur(c.ma)} de media tras entrenar frente a ${fdur(c.mb)} cuando no (${c.na} noches con entreno).`,
    });
  }

  // 2) Entrenar → HRV de la mañana siguiente
  c = comparaGrupos(noches, (n) => n.entrenoAyer > 0, (n) => n.hrvManana);
  if (c.na >= minGrupo && c.nb >= minGrupo && c.mb) {
    const pct = ((c.ma - c.mb) / c.mb) * 100;
    if (Math.abs(pct) >= 4)
      H.push({
        clase: pct > 0 ? "bueno" : "malo",
        titulo: `La mañana después de entrenar tu HRV es un ${fnum(Math.abs(pct), 0)} % ${pct > 0 ? "más alta" : "más baja"}`,
        detalle: `${fnum(c.ma, 0)} ms frente a ${fnum(c.mb, 0)} ms. Una HRV alta suele indicar buena recuperación.`,
      });
  }

  // 3) Entrenar → FC en reposo de la mañana siguiente
  c = comparaGrupos(noches, (n) => n.entrenoAyer > 0, (n) => n.fcManana);
  if (c.na >= minGrupo && c.nb >= minGrupo && Math.abs(c.ma - c.mb) >= 1.2) {
    H.push({
      clase: c.ma < c.mb ? "bueno" : "malo",
      titulo: `Tras entrenar, tu corazón amanece ${fnum(Math.abs(c.ma - c.mb), 1)} ppm ${c.ma < c.mb ? "más tranquilo" : "más acelerado"}`,
      detalle: `FC en reposo de ${fnum(c.ma, 0)} ppm frente a ${fnum(c.mb, 0)} ppm los días sin entreno previo.`,
    });
  }

  // 4) Acostarse tarde → esa noche y la mañana siguiente
  const medAcost = mediana(noches.map((n) => n.acostarse));
  if (medAcost != null) {
    const tarde = (n) => n.acostarse != null && n.acostarse > medAcost + 30;
    c = comparaGrupos(noches, tarde, (n) => n.dormido);
    if (c.na >= minGrupo && c.nb >= minGrupo && Math.abs(c.ma - c.mb) >= 15 * 60) {
      H.push({
        clase: c.ma < c.mb ? "malo" : "neutro",
        titulo: `Cuando te acuestas después de las ${horaTexto(medAcost + 30)} duermes ${fdur(Math.abs(c.mb - c.ma))} ${c.ma < c.mb ? "menos" : "más"}`,
        detalle: `${fdur(c.ma)} frente a ${fdur(c.mb)} acostándote antes. Acostarse tarde no se recupera del todo por la mañana.`,
      });
    }
    c = comparaGrupos(noches, tarde, (n) => n.hrvManana);
    if (c.na >= minGrupo && c.nb >= minGrupo && c.mb) {
      const pct = ((c.ma - c.mb) / c.mb) * 100;
      if (pct <= -4)
        H.push({
          clase: "malo",
          titulo: `Acostarte tarde le pasa factura a tu HRV: un ${fnum(Math.abs(pct), 0)} % más baja al día siguiente`,
          detalle: `${fnum(c.ma, 0)} ms tras acostarte después de las ${horaTexto(medAcost + 30)}, frente a ${fnum(c.mb, 0)} ms.`,
        });
    }
  }

  // 5) Días de mucho movimiento → sueño de esa noche
  const conPasos = noches.filter((n) => n.pasosAyer != null);
  if (conPasos.length >= minGrupo * 3) {
    const orden = [...conPasos].sort((a, b) => a.pasosAyer - b.pasosAyer);
    const t = Math.floor(orden.length / 3);
    const bajo = orden.slice(0, t),
      alto = orden.slice(-t);
    const ma = media(alto.map((n) => n.dormido)),
      mb = media(bajo.map((n) => n.dormido));
    if (ma != null && mb != null && Math.abs(ma - mb) >= 12 * 60) {
      H.push({
        clase: ma > mb ? "bueno" : "neutro",
        titulo: `Tus días de más pasos acaban en ${fdur(Math.abs(ma - mb))} ${ma > mb ? "más" : "menos"} de sueño`,
        detalle: `El tercio de días con más pasos (≥ ${fnum(alto[0].pasosAyer)}) duerme ${fdur(ma)}; el tercio más sedentario, ${fdur(mb)}.`,
      });
    }
  }

  // 6) Noche corta → día siguiente
  const mDormido = media(noches.map((n) => n.dormido));
  if (mDormido != null) {
    const umbral = mDormido - 45 * 60;
    const cortas = new Set(noches.filter((n) => n.dormido < umbral).map((n) => n.f));
    c = comparaGrupos(dias, (d) => cortas.has(d.f), (d) => d.pasos);
    if (c.na >= minGrupo && c.nb >= minGrupo && c.mb) {
      const pct = ((c.ma - c.mb) / c.mb) * 100;
      if (Math.abs(pct) >= 6)
        H.push({
          clase: pct < 0 ? "malo" : "neutro",
          titulo: `Tras una noche corta (menos de ${fdur(umbral)}) te mueves un ${fnum(Math.abs(pct), 0)} % ${pct < 0 ? "menos" : "más"}`,
          detalle: `${fnum(c.ma)} pasos de media al día siguiente, frente a ${fnum(c.mb)} tras dormir bien.`,
        });
    }
  }

  // 7) Fin de semana: pasos y jetlag social
  c = comparaGrupos(dias, (d) => d.finde, (d) => d.pasos);
  if (c.na >= 4 && c.nb >= minGrupo && c.mb) {
    const pct = ((c.ma - c.mb) / c.mb) * 100;
    if (Math.abs(pct) >= 10)
      H.push({
        clase: "neutro",
        titulo: `El fin de semana te mueves un ${fnum(Math.abs(pct), 0)} % ${pct < 0 ? "menos" : "más"}`,
        detalle: `${fnum(c.ma)} pasos de media en finde frente a ${fnum(c.mb)} entre semana.`,
      });
  }
  c = comparaGrupos(noches, (n) => n.visperaFinde, (n) => n.acostarse);
  if (c.na >= 4 && c.nb >= minGrupo && c.ma != null && c.mb != null && c.ma - c.mb >= 25) {
    H.push({
      clase: "malo",
      titulo: `Jetlag social: las noches de viernes y sábado te acuestas ${fdur((c.ma - c.mb) * 60)} más tarde`,
      detalle: `Sobre las ${horaTexto(c.ma)} frente a las ${horaTexto(c.mb)} el resto de la semana. Ese vaivén desajusta el reloj interno.`,
    });
  }

  // 8) ¿Dormir más profundo va con mejor HRV? (correlación continua)
  const parHrv = noches.filter((n) => n.hrvManana != null && n.dormido != null).map((n) => [n.dormido / 3600, n.hrvManana]);
  const reg = pearson(parHrv);
  if (reg && Math.abs(reg.r) >= 0.35) {
    H.push({
      clase: reg.r > 0 ? "bueno" : "neutro",
      titulo: `Cuanto más duermes, ${reg.r > 0 ? "mejor" : "peor"} amanece tu HRV (r = ${fnum(reg.r, 2)})`,
      detalle: `Con tus ${reg.n} noches, cada hora extra de sueño va con ${fnum(Math.abs(reg.pendiente), 1)} ms ${reg.r > 0 ? "más" : "menos"} de HRV.`,
    });
  }

  // 9) Alcohol → esa noche y la mañana siguiente (si lo registras)
  const diasPorFecha = new Map(dias.map((d) => [d.f, d]));
  const conAlcoholAyer = (n) => {
    const d = diasPorFecha.get(sumaDias(n.f, -1));
    return d && d.alcohol != null && d.alcohol > 0;
  };
  const hayAlcohol = dias.some((d) => d.alcohol != null && d.alcohol > 0);
  if (hayAlcohol) {
    c = comparaGrupos(noches, conAlcoholAyer, (n) => n.profundo > 0 ? n.profundo : null);
    if (c.na >= 4 && c.nb >= minGrupo && c.mb && Math.abs(c.ma - c.mb) >= 8 * 60) {
      const pct = ((c.ma - c.mb) / c.mb) * 100;
      H.push({
        clase: pct < 0 ? "malo" : "neutro",
        titulo: `Las noches con alcohol tienen un ${fnum(Math.abs(pct), 0)} % ${pct < 0 ? "menos" : "más"} de sueño profundo`,
        detalle: `${fdur(c.ma)} frente a ${fdur(c.mb)} sin alcohol (${c.na} noches con registro de copas).`,
      });
    }
    c = comparaGrupos(noches, conAlcoholAyer, (n) => n.hrvManana);
    if (c.na >= 4 && c.nb >= minGrupo && c.mb) {
      const pct = ((c.ma - c.mb) / c.mb) * 100;
      if (pct <= -5)
        H.push({
          clase: "malo",
          titulo: `El alcohol se nota en tu HRV: un ${fnum(Math.abs(pct), 0)} % más baja a la mañana siguiente`,
          detalle: `${fnum(c.ma, 0)} ms frente a ${fnum(c.mb, 0)} ms las mañanas sin alcohol la víspera.`,
        });
    }
  }

  // 10) Cafeína alta → sueño de esa noche (si la registras)
  const conCaf = dias.filter((d) => d.cafeina != null);
  if (conCaf.length >= minGrupo * 3) {
    const medCaf = mediana(conCaf.map((d) => d.cafeina));
    const cafAltaAyer = (n) => {
      const d = diasPorFecha.get(sumaDias(n.f, -1));
      return d && d.cafeina != null && d.cafeina > medCaf;
    };
    c = comparaGrupos(noches, cafAltaAyer, (n) => (n.profundo > 0 ? n.profundo : null));
    if (c.na >= minGrupo && c.nb >= minGrupo && c.mb && Math.abs(c.ma - c.mb) >= 8 * 60) {
      const pct = ((c.ma - c.mb) / c.mb) * 100;
      H.push({
        clase: pct < 0 ? "malo" : "neutro",
        titulo: `Los días de más cafeína (> ${fnum(medCaf)} mg) duermes un ${fnum(Math.abs(pct), 0)} % ${pct < 0 ? "menos" : "más"} profundo`,
        detalle: `${fdur(c.ma)} de sueño profundo frente a ${fdur(c.mb)} los días de menos cafeína.`,
      });
    }
  }

  return H.slice(0, 10);
}

// ===========================================================================
// Patrones inesperados: barrido de correlaciones sobre variaciones diarias.
// Se correlacionan los CAMBIOS de un día a otro (no los niveles) para que dos
// métricas que simplemente mejoran a la vez durante meses no aparezcan como
// relacionadas; lo que sobrevive es acoplamiento real día a día.
// ===========================================================================
const METRICAS_SWEEP = [
  { c: "pasos", n: "los pasos", fam: "mov" },
  { c: "energia", n: "la energía activa", fam: "mov" },
  { c: "minEj", n: "los minutos de ejercicio", fam: "mov" },
  { c: "entrenoMin", n: "los minutos de entreno", fam: "mov" },
  { c: "dormidoH", n: "el sueño", fam: "sueno" },
  { c: "profundoH", n: "el sueño profundo", fam: "sueno" },
  { c: "remH", n: "el sueño REM", fam: "sueno" },
  { c: "eficiencia", n: "la eficiencia del sueño", fam: "sueno" },
  { c: "acostarseH", n: "la hora de acostarte", fam: "sueno" },
  { c: "fcReposo", n: "la FC en reposo", fam: "cardio" },
  { c: "hrv", n: "la HRV", fam: "cardio" },
  { c: "frecResp", n: "la frecuencia respiratoria nocturna", fam: "resp" },
  { c: "spo2", n: "el oxígeno en sangre", fam: "resp" },
  { c: "tempMuneca", n: "la temperatura nocturna de muñeca", fam: "temp" },
  { c: "ruido", n: "la exposición al ruido", fam: "ambiente" },
  { c: "luzDia", n: "el tiempo a la luz del día", fam: "luz" },
  { c: "agua", n: "el agua que bebes", fam: "dieta" },
  { c: "cafeina", n: "la cafeína", fam: "cafeina" },
  { c: "alcohol", n: "el alcohol", fam: "alcohol" },
  { c: "peso", n: "el peso", fam: "cuerpo" },
];
// Cruces que ya cubren los hallazgos dirigidos: no repetirlos aquí.
const CRUCES_YA_CONTADOS = new Set([
  "pasos|dormidoH", "entrenoMin|dormidoH", "entrenoMin|hrv", "entrenoMin|fcReposo",
  "acostarseH|dormidoH", "acostarseH|hrv", "dormidoH|hrv", "alcohol|profundoH",
  "alcohol|hrv", "cafeina|profundoH", "minEj|dormidoH", "energia|dormidoH",
]);

function patronesInesperados(fechas) {
  const dias = tablaDias(fechas);
  const disponibles = METRICAS_SWEEP.filter((m) => dias.filter((d) => d[m.c] != null).length >= 25);
  const resultados = [];
  const vistos = new Set();

  const diferencias = (clave, desplaza) => {
    // cambios día a día; con desplaza=1, el cambio de HOY contra el de MAÑANA
    const out = [];
    for (let i = 1; i < dias.length - desplaza; i++) {
      const a0 = dias[i - 1][clave],
        a1 = dias[i][clave];
      if (a0 == null || a1 == null) out.push(null);
      else out.push(a1 - a0);
    }
    return out;
  };

  for (let i = 0; i < disponibles.length; i++) {
    for (let j = 0; j < disponibles.length; j++) {
      if (i === j) continue;
      const mx = disponibles[i],
        my = disponibles[j];
      if (mx.fam === my.fam) continue;
      for (const lag of [0, 1]) {
        if (lag === 0 && j < i) continue; // sin lag el par es simétrico
        const claveOrden = [mx.c, my.c].sort().join("|");
        if (lag === 0 && CRUCES_YA_CONTADOS.has(claveOrden)) continue;
        if (lag === 1 && CRUCES_YA_CONTADOS.has(mx.c + "|" + my.c)) continue;
        const dx = diferencias(mx.c, lag);
        const dyBase = diferencias(my.c, 0);
        const pares = [];
        for (let k = 0; k < dx.length; k++) {
          const y = dyBase[k + lag];
          if (dx[k] != null && y != null) pares.push([dx[k], y]);
        }
        const reg = pearson(pares);
        if (!reg || pares.length < 20 || Math.abs(reg.r) < 0.35) continue;
        const claveVisto = claveOrden + "|" + lag;
        if (vistos.has(claveVisto)) continue;
        vistos.add(claveVisto);
        resultados.push({ mx, my, lag, r: reg.r, n: pares.length });
      }
    }
  }
  resultados.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return resultados.slice(0, 6);
}

function renderInesperados(fechas) {
  const tarjeta = $("#c-inesperados");
  const lista = $("#lista-inesperados");
  lista.replaceChildren();
  const patrones = patronesInesperados(fechas);
  if (!patrones.length) {
    const p = document.createElement("p");
    p.className = "sub-tarjeta";
    p.textContent =
      "Ningún cruce fuera de lo esperable supera el umbral (|r| ≥ 0,35 en variaciones diarias con al menos 20 días). Es la respuesta honesta: mejor ningún patrón que un patrón inventado.";
    lista.appendChild(p);
    return;
  }
  for (const pt of patrones) {
    const fila = document.createElement("div");
    fila.className = "hallazgo neutro";
    const icono = document.createElement("span");
    icono.className = "hallazgo-icono";
    icono.textContent = pt.r > 0 ? "⇅" : "⇵";
    const cuerpo = document.createElement("div");
    const t = document.createElement("strong");
    const sube = pt.r > 0 ? "también sube" : "baja";
    t.textContent =
      pt.lag === 0
        ? `Los días en que sube ${pt.mx.n}, ${sube} ${pt.my.n}`
        : `Cuando hoy sube ${pt.mx.n}, mañana ${sube} ${pt.my.n}`;
    const d = document.createElement("p");
    d.textContent = `r = ${fnum(pt.r, 2)} sobre las variaciones diarias de ${pt.n} días${pt.lag ? ", con un día de desfase" : ""}. Correlación, no causa: úsalo como pista para observarte.`;
    cuerpo.appendChild(t);
    cuerpo.appendChild(d);
    fila.appendChild(icono);
    fila.appendChild(cuerpo);
    lista.appendChild(fila);
  }
}

// ===========================================================================
// Medicamentos y suplementos: qué cambia los días que los tomas
// ===========================================================================

// Comparación emparejada: cada día con toma se compara solo con los días SIN
// toma de su entorno (±10 días). Si un medicamento se toma solo durante unas
// semanas, comparar contra todo el rango confundiría "la época" con "el
// efecto"; esto lo evita.
function efectoPareado(filas, cond, valor) {
  const difs = [];
  const bases = [];
  for (let i = 0; i < filas.length; i++) {
    if (!cond(filas[i])) continue;
    const v = valor(filas[i]);
    if (v == null || !isFinite(v)) continue;
    const ctrl = [];
    for (let k = Math.max(0, i - 10); k < Math.min(filas.length, i + 11); k++) {
      if (k === i || cond(filas[k])) continue;
      const w = valor(filas[k]);
      if (w != null && isFinite(w)) ctrl.push(w);
    }
    if (ctrl.length >= 3) {
      const b = media(ctrl);
      difs.push(v - b);
      bases.push(b);
    }
  }
  if (difs.length < 4) return null;
  return { d: media(difs), base: media(bases), n: difs.length };
}

function renderMeds(fechas) {
  const tarjeta = $("#c-meds");
  const lista = $("#lista-meds");
  lista.replaceChildren();
  const meds = DATOS.meds || {};
  const nombres = Object.keys(meds);
  tarjeta.hidden = !nombres.length;
  if (!nombres.length) return;

  const noches = tablaNoches(fechas);
  const dias = tablaDias(fechas);
  const minGrupo = 4;

  for (const nombre of nombres.sort((a, b) => meds[b].total - meds[a].total)) {
    const tomado = meds[nombre].dias;
    const tomadoEnRango = fechas.filter((f) => tomado[f]).length;
    if (tomadoEnRango < 3) continue;

    const bloque = document.createElement("div");
    bloque.className = "med-bloque";
    const cab = document.createElement("strong");
    cab.textContent = nombre;
    const sub = document.createElement("span");
    sub.className = "med-tomas";
    sub.textContent = ` · ${tomadoEnRango} días con toma en este rango`;
    bloque.appendChild(cab);
    bloque.appendChild(sub);

    const efectos = [];
    const tomadoAyer = (n) => !!tomado[sumaDias(n.f, -1)];
    // Sueño de la noche siguiente a la toma (comparación emparejada por cercanía)
    let c = efectoPareado(noches, tomadoAyer, (n) => n.dormido);
    if (c && c.n >= minGrupo && Math.abs(c.d) >= 15 * 60)
      efectos.push(`duermes ${fdur(Math.abs(c.d))} ${c.d > 0 ? "más" : "menos"} esa noche (${fdur(c.base + c.d)} frente a ${fdur(c.base)})`);
    c = efectoPareado(noches, tomadoAyer, (n) => (n.profundo > 0 ? n.profundo : null));
    if (c && c.n >= minGrupo && c.base && Math.abs(c.d / c.base) >= 0.12 && Math.abs(c.d) >= 6 * 60)
      efectos.push(`el sueño profundo ${c.d > 0 ? "sube" : "baja"} un ${fnum(Math.abs((c.d / c.base) * 100), 0)} %`);
    c = efectoPareado(noches, tomadoAyer, (n) => (n.rem > 0 ? n.rem : null));
    if (c && c.n >= minGrupo && c.base && Math.abs(c.d / c.base) >= 0.12 && Math.abs(c.d) >= 6 * 60)
      efectos.push(`el sueño REM ${c.d > 0 ? "sube" : "baja"} un ${fnum(Math.abs((c.d / c.base) * 100), 0)} %`);
    c = efectoPareado(noches, tomadoAyer, (n) => n.hrvManana);
    if (c && c.n >= minGrupo && c.base && Math.abs(c.d / c.base) >= 0.06)
      efectos.push(`la HRV amanece un ${fnum(Math.abs((c.d / c.base) * 100), 0)} % ${c.d > 0 ? "más alta" : "más baja"}`);
    c = efectoPareado(noches, tomadoAyer, (n) => n.fcManana);
    if (c && c.n >= minGrupo && Math.abs(c.d) >= 1.5)
      efectos.push(`la FC en reposo amanece ${fnum(Math.abs(c.d), 1)} ppm ${c.d > 0 ? "más alta" : "más baja"}`);
    c = efectoPareado(dias, (d) => !!tomado[d.f], (d) => d.pasos);
    if (c && c.n >= minGrupo && c.base && Math.abs(c.d / c.base) >= 0.1)
      efectos.push(`ese día te mueves un ${fnum(Math.abs((c.d / c.base) * 100), 0)} % ${c.d > 0 ? "más" : "menos"}`);

    const p = document.createElement("p");
    p.textContent = efectos.length
      ? `Comparando cada toma con tus días sin toma cercanos: ${efectos.join("; ")}.`
      : "Sin diferencias claras entre los días con y sin toma en este rango.";
    bloque.appendChild(p);
    // Si las tomas forman un solo bloque de fechas, avisar del sesgo de época.
    const fechasToma = fechas.filter((f) => tomado[f]);
    const tramo = listaFechas(fechasToma[0], fechasToma[fechasToma.length - 1]).length;
    if (efectos.length && tramo <= tomadoEnRango * 1.4 && tramo <= fechas.length * 0.6) {
      const aviso = document.createElement("p");
      aviso.className = "med-tomas";
      aviso.textContent = `Ojo: las tomas se concentran en una sola época (del ${ffechaLarga(fechasToma[0])} al ${ffechaLarga(fechasToma[fechasToma.length - 1])}); parte de la diferencia puede ser de esa época (alergia, estrés, estación…), no del propio medicamento.`;
      bloque.appendChild(aviso);
    }
    lista.appendChild(bloque);
  }

  if (!lista.children.length) {
    const p = document.createElement("p");
    p.className = "sub-tarjeta";
    p.textContent = "Hay medicación registrada, pero con muy pocas tomas dentro del rango elegido para comparar.";
    lista.appendChild(p);
  }
}

// ===========================================================================
// Consejos: reglas sencillas sobre tus propios números
// ===========================================================================
function motorConsejos(fechas) {
  const dias = tablaDias(fechas);
  const noches = tablaNoches(fechas);
  const C = [];

  const minSemana = media(dias.map((d) => d.minEj));
  if (minSemana != null) {
    const sem = minSemana * 7;
    if (sem < 150)
      C.push({ tipo: "accion", texto: `Estás en ${fnum(sem)} minutos de ejercicio a la semana; la OMS recomienda 150. Un paseo rápido de 20 minutos al día te deja en la meta.` });
    else C.push({ tipo: "ok", texto: `Cumples de sobra la recomendación de ejercicio de la OMS: ${fnum(sem)} minutos semanales (la meta son 150).` });
  }

  const mPasos = media(dias.map((d) => d.pasos));
  if (mPasos != null) {
    if (mPasos < 8000) C.push({ tipo: "accion", texto: `Tu media es de ${fnum(mPasos)} pasos al día. Subir hacia 8.000 tiene uno de los mejores retornos salud/esfuerzo que existen.` });
    else C.push({ tipo: "ok", texto: `${fnum(mPasos)} pasos al día de media: por encima del umbral de 8.000 asociado a menor mortalidad.` });
  }

  const mSueno = media(noches.map((n) => n.dormido));
  if (mSueno != null) {
    if (mSueno < 7 * 3600)
      C.push({ tipo: "accion", texto: `Duermes ${fdur(mSueno)} de media, por debajo de las 7 horas recomendadas. Adelantar la hora de acostarte ${fdur(7 * 3600 - mSueno)} bastaría.` });
    else C.push({ tipo: "ok", texto: `Duermes ${fdur(mSueno)} de media: dentro de las 7–9 horas recomendadas para un adulto.` });
  }

  const sd = desviacion(noches.map((n) => n.acostarse));
  if (sd != null) {
    if (sd > 45)
      C.push({ tipo: "accion", texto: `Tu hora de acostarte varía ±${fnum(sd, 0)} minutos. La regularidad importa casi tanto como la duración: intenta moverte en una ventana de media hora.` });
    else C.push({ tipo: "ok", texto: `Hora de acostarte estable (±${fnum(sd, 0)} min). La regularidad es de lo que más protege el sueño.` });
  }

  const mProf = media(noches.map((n) => (n.profundo > 0 ? n.profundo : null)));
  if (mProf != null && mSueno && mProf / mSueno < 0.12)
    C.push({ tipo: "accion", texto: `El sueño profundo es el ${fnum((mProf / mSueno) * 100, 0)} % del total (lo típico ronda el 13–23 %). El ejercicio regular y cenar pronto lo favorecen.` });

  // Tendencia de la FC en reposo dentro del rango
  const fcs = dias.map((d) => d.fcReposo);
  const idx = [];
  fcs.forEach((v, i) => {
    if (v != null) idx.push([i, v]);
  });
  const reg = pearson(idx);
  if (reg && idx.length > 20) {
    const cambio = reg.pendiente * (idx[idx.length - 1][0] - idx[0][0]);
    if (cambio <= -2) C.push({ tipo: "ok", texto: `Tu FC en reposo ha bajado ${fnum(Math.abs(cambio), 1)} ppm en este periodo: señal clásica de mejora de forma física.` });
    else if (cambio >= 2.5)
      C.push({ tipo: "accion", texto: `Tu FC en reposo ha subido ${fnum(cambio, 1)} ppm en este periodo. Estrés, poco sueño o exceso de carga pueden estar detrás; vigílala unos días.` });
  }

  return C.slice(0, 7);
}

// ===========================================================================
// Nuevas gráficas
// ===========================================================================

// --- calendario tipo mapa de calor (un año de un vistazo) ---
function graficaCalendario(cont, fechas, valores, ops) {
  cont.replaceChildren();
  const celdaMax = 17,
    hueco = 3,
    izq = 30,
    arriba = 18;
  // Semanas desde el lunes de la primera fecha.
  const d0 = new Date(fechas[0] + "T12:00:00Z");
  const primerLunes = sumaDias(fechas[0], -((d0.getUTCDay() + 6) % 7));
  const nSemanas = Math.ceil((listaFechas(primerLunes, fechas[fechas.length - 1]).length) / 7);
  const disponible = anchoDe(cont) - izq - 8;
  const celda = Math.max(9, Math.min(celdaMax, Math.floor(disponible / nSemanas) - hueco));
  const ancho = izq + nSemanas * (celda + hueco) + 4;
  const alto = arriba + 7 * (celda + hueco) + 6;
  const svg = el("svg", { viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "img" });

  // Umbrales por quintiles de los valores positivos.
  const positivos = valores.filter((v) => v != null && v > 0).sort((a, b) => a - b);
  const q = (p) => (positivos.length ? positivos[Math.min(positivos.length - 1, Math.floor(p * positivos.length))] : 0);
  const umbrales = [q(0.2), q(0.4), q(0.6), q(0.8)];
  const rampa = ["var(--r1)", "var(--r2)", "var(--r3)", "var(--r4)", "var(--r5)"];
  const colorDe = (v) => {
    if (v == null || v <= 0) return "var(--r0)";
    let k = 0;
    while (k < 4 && v > umbrales[k]) k++;
    return rampa[k];
  };

  const porFecha = new Map();
  fechas.forEach((f, i) => porFecha.set(f, valores[i]));

  // Etiquetas de fila (L, X, V).
  for (const [fila, txt] of [[0, "L"], [2, "X"], [4, "V"]]) {
    const t = el("text", { x: izq - 8, y: arriba + fila * (celda + hueco) + celda * 0.75, class: "viz-tick", "text-anchor": "end" });
    t.textContent = txt;
    svg.appendChild(t);
  }

  let mesAnterior = null;
  let f = primerLunes;
  for (let s = 0; s < nSemanas; s++) {
    const mes = +f.slice(5, 7);
    if (mes !== mesAnterior) {
      mesAnterior = mes;
      const t = el("text", { x: izq + s * (celda + hueco), y: 11, class: "viz-tick" });
      t.textContent = MESES[mes - 1];
      svg.appendChild(t);
    }
    for (let fila = 0; fila < 7; fila++) {
      if (porFecha.has(f)) {
        const v = porFecha.get(f);
        const rect = el("rect", {
          x: izq + s * (celda + hueco),
          y: arriba + fila * (celda + hueco),
          width: celda,
          height: celda,
          rx: 3,
          class: "cal-celda",
        });
        rect.style.fill = colorDe(v);
        const fecha = f;
        rect.addEventListener("pointermove", (ev) =>
          muestraTip(ev.clientX, ev.clientY, [
            { titulo: true, texto: ffechaLarga(fecha) + " (" + DIAS_SEMANA[fila] + ")" },
            { valor: v != null ? ops.formato(v) : "sin datos", texto: v != null ? " " + (ops.unidad || "") : "" },
          ])
        );
        rect.addEventListener("pointerleave", ocultaTip);
        svg.appendChild(rect);
      }
      f = sumaDias(f, 1);
    }
  }

  const envoltura = document.createElement("div");
  envoltura.style.overflowX = "auto";
  envoltura.appendChild(svg);
  cont.appendChild(envoltura);

  // Escala "menos → más".
  const escala = document.createElement("div");
  escala.className = "cal-escala";
  escala.appendChild(document.createTextNode("menos"));
  for (const c of rampa) {
    const s = document.createElement("span");
    s.className = "cal-sw";
    s.style.background = c;
    escala.appendChild(s);
  }
  escala.appendChild(document.createTextNode("más"));
  cont.appendChild(escala);
}

// --- ritmo de sueño: una banda por noche, de acostarse a levantarse ---
function graficaRitmoSueno(cont, noches) {
  cont.replaceChildren();
  const conHoras = noches.filter((n) => n.acostarse != null && n.levantarse != null && n.levantarse > n.acostarse);
  if (conHoras.length < 5) return false;
  const ancho = anchoDe(cont);
  const filaH = Math.max(3, Math.min(10, 440 / conHoras.length));
  const arriba = 22,
    aba = 24,
    izq = 58,
    der = 14;
  const alto = arriba + conHoras.length * filaH + aba;
  const svg = el("svg", { viewBox: `0 0 ${ancho} ${alto}`, width: "100%", height: alto, role: "img" });

  // Eje temporal ceñido a tus horas reales (redondeado a horas enteras).
  const t0 = Math.max(18 * 60, Math.floor((Math.min(...conHoras.map((n) => n.acostarse)) - 40) / 60) * 60);
  const t1 = Math.min(38 * 60, Math.ceil((Math.max(...conHoras.map((n) => n.levantarse)) + 40) / 60) * 60);
  const X = (min) => izq + ((Math.max(t0, Math.min(t1, min)) - t0) / (t1 - t0)) * (ancho - izq - der);
  const pasoH = t1 - t0 > 10 * 60 ? 120 : 60;
  for (let m = t0; m <= t1; m += pasoH) {
    const x = X(m);
    svg.appendChild(el("line", { x1: x, x2: x, y1: arriba, y2: alto - aba, class: "viz-grid" }));
    const t = el("text", { x, y: alto - 8, class: "viz-tick", "text-anchor": "middle" });
    t.textContent = ((m / 60) % 24) + ":00";
    svg.appendChild(t);
  }
  // Fechas de referencia en el lateral.
  const pasoFila = Math.max(1, Math.round(conHoras.length / 5));
  for (let i = 0; i < conHoras.length; i += pasoFila) {
    const t = el("text", { x: izq - 8, y: arriba + i * filaH + filaH, class: "viz-tick", "text-anchor": "end" });
    t.textContent = ffecha(conHoras[i].f);
    svg.appendChild(t);
  }

  // Medianas de acostarse y levantarse como referencia.
  const medA = mediana(conHoras.map((n) => n.acostarse));
  const medL = mediana(conHoras.map((n) => n.levantarse));
  for (const [med, texto] of [[medA, "sueles acostarte " + horaTexto(medA)], [medL, "levantarte " + horaTexto(medL)]]) {
    if (med == null) continue;
    const x = X(med);
    svg.appendChild(el("line", { x1: x, x2: x, y1: arriba - 4, y2: alto - aba, class: "viz-cruz" }));
    const t = el("text", { x: x + 4, y: arriba - 8, class: "viz-tick" });
    t.textContent = texto;
    svg.appendChild(t);
  }

  const gap = Math.max(0.8, filaH * 0.28);
  conHoras.forEach((n, i) => {
    const y = arriba + i * filaH;
    const banda = el("rect", {
      x: X(n.acostarse),
      y,
      width: Math.max(2, X(n.levantarse) - X(n.acostarse)),
      height: filaH - gap,
      rx: Math.min(2, (filaH - gap) / 2),
      class: "viz-barra",
    });
    banda.style.fill = n.visperaFinde ? "var(--s2)" : "var(--s1)";
    svg.appendChild(banda);
    // Blanco de golpe: la fila entera.
    const hit = el("rect", { x: 0, y, width: ancho, height: filaH, fill: "transparent" });
    hit.addEventListener("pointermove", (ev) =>
      muestraTip(ev.clientX, ev.clientY, [
        { titulo: true, texto: "Noche del " + ffechaLarga(sumaDias(n.f, -1)) + (n.visperaFinde ? " (víspera de festivo)" : "") },
        { valor: horaTexto(n.acostarse), texto: " te acostaste", color: n.visperaFinde ? "var(--s2)" : "var(--s1)" },
        { valor: horaTexto(n.levantarse), texto: " te levantaste" },
        { valor: fdur(n.dormido), texto: " dormido" },
      ])
    );
    hit.addEventListener("pointerleave", ocultaTip);
    svg.appendChild(hit);
  });

  cont.appendChild(svg);
  return true;
}

// --- dispersión con recta de regresión, para cruzar dos métricas ---
function graficaDispersion(cont, puntos, ops) {
  cont.replaceChildren();
  const ancho = anchoDe(cont),
    alto = ops.alto || 300;
  const svg = el("svg", { viewBox: `0 0 ${ancho} ${alto}`, width: "100%", height: alto, role: "img" });
  if (puntos.length < 5) {
    cont.textContent = "No hay suficientes días con las dos métricas a la vez en este rango.";
    return null;
  }
  const xs = puntos.map((p) => p.x),
    ys = puntos.map((p) => p.y);
  const ex = escalaY(Math.max(...xs), Math.min(...xs));
  const ey = escalaY(Math.max(...ys), Math.min(...ys));
  const izq = 52,
    der = 16,
    arriba = 12,
    aba = 30;
  const X = (v) => izq + ((v - ex.min) / (ex.max - ex.min || 1)) * (ancho - izq - der);
  const Y = (v) => arriba + (alto - arriba - aba) * (1 - (v - ey.min) / (ey.max - ey.min || 1));
  for (const t of ey.ticks) {
    svg.appendChild(el("line", { x1: izq, x2: ancho - der, y1: Y(t), y2: Y(t), class: t === ey.min ? "viz-eje" : "viz-grid" }));
    const txt = el("text", { x: izq - 8, y: Y(t) + 3.5, class: "viz-tick", "text-anchor": "end" });
    txt.textContent = ops.fmtY ? ops.fmtY(t) : fnum(t, 1);
    svg.appendChild(txt);
  }
  for (const t of ex.ticks) {
    const txt = el("text", { x: X(t), y: alto - 10, class: "viz-tick", "text-anchor": "middle" });
    txt.textContent = ops.fmtX ? ops.fmtX(t) : fnum(t, 1);
    svg.appendChild(txt);
  }

  const reg = pearson(puntos.map((p) => [p.x, p.y]));
  if (reg) {
    const y0 = reg.b0 + reg.pendiente * ex.min,
      y1 = reg.b0 + reg.pendiente * ex.max;
    const linea = el("line", { x1: X(ex.min), y1: Y(y0), x2: X(ex.max), y2: Y(y1), class: "viz-linea" });
    linea.style.stroke = "var(--s1-linea)";
    linea.style.opacity = "0.85";
    svg.appendChild(linea);
  }

  for (const p of puntos) {
    const dot = el("circle", { cx: X(p.x), cy: Y(p.y), r: 4.5, class: "viz-punto" });
    dot.style.fill = "var(--s1)";
    dot.style.fillOpacity = "0.8";
    svg.appendChild(dot);
  }
  // Blanco de golpe generoso por punto (24px), encima de todos los puntos.
  for (const p of puntos) {
    const hit = el("circle", { cx: X(p.x), cy: Y(p.y), r: 13, fill: "transparent" });
    hit.addEventListener("pointermove", (ev) =>
      muestraTip(ev.clientX, ev.clientY, [
        { titulo: true, texto: ffechaLarga(p.f) },
        { valor: ops.fmtXLargo ? ops.fmtXLargo(p.x) : fnum(p.x, 1), texto: " " + ops.nombreX, color: "var(--s1)" },
        { valor: ops.fmtYLargo ? ops.fmtYLargo(p.y) : fnum(p.y, 1), texto: " " + ops.nombreY },
      ])
    );
    hit.addEventListener("pointerleave", ocultaTip);
    svg.appendChild(hit);
  }

  cont.appendChild(svg);
  return reg;
}

// ===========================================================================
// Tú frente a la media: comparación con hombres de tu edad
// Rangos aproximados de la literatura (FC en reposo, SDNN, VO₂ máx de Cooper,
// pasos y sueño poblacionales). Orientativos, no clínicos.
// ===========================================================================
function decada(edad) {
  return Math.min(70, Math.max(20, Math.floor(edad / 10) * 10));
}
const REF_HRV = { 20: [[55, 90], [90, 140]], 30: [[48, 80], [80, 130]], 40: [[40, 68], [68, 120]], 50: [[34, 58], [58, 100]], 60: [[29, 50], [50, 90]], 70: [[25, 45], [45, 80]] };
const REF_VO2 = { 20: [[42, 46], [52, 60]], 30: [[40, 43], [49, 58]], 40: [[36, 40], [46, 55]], 50: [[33, 36], [42, 52]], 60: [[29, 32], [38, 48]], 70: [[26, 29], [35, 45]] };

function edadUsuario() {
  if (DATOS.meta && DATOS.meta.nacimiento) {
    const e = Math.floor((new Date(RANGO.fin) - new Date(DATOS.meta.nacimiento)) / 31557600000);
    if (e >= 18 && e <= 100) return e;
  }
  const g = parseInt(localStorage.getItem("lement-salud-edad") || "", 10);
  return g >= 18 && g <= 100 ? g : null;
}

function estadoDe(r) {
  const [t0, t1] = r.tipica;
  if (r.menorMejor) {
    if (r.valor < t0) return r.valor <= r.objetivo[1] ? "top" : "delante";
    return r.valor <= t1 ? "media" : "detras";
  }
  if (r.valor > t1) return r.valor >= r.objetivo[0] ? "top" : "delante";
  return r.valor >= t0 ? "media" : "detras";
}
const ETIQUETA_ESTADO = {
  top: ["★", "muy por encima de la media", "bueno"],
  delante: ["▲", "por delante de la media", "bueno"],
  media: ["●", "en la media", "neutro"],
  detras: ["▼", "margen de mejora", "malo"],
};

// Banda visual: escala de la métrica con la zona típica (gris), la zona
// objetivo (azul claro) y tu punto encima.
function bandaMetrica(cont, r) {
  const w = Math.max(220, cont.clientWidth || 300),
    h = 40;
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: h, "aria-hidden": "true" });
  const izq = 6,
    der = 6,
    y = 14,
    grosor = 8;
  const X = (v) => izq + ((Math.min(r.escala[1], Math.max(r.escala[0], v)) - r.escala[0]) / (r.escala[1] - r.escala[0])) * (w - izq - der);
  const track = el("rect", { x: izq, y, width: w - izq - der, height: grosor, rx: 4, class: "banda-pista" });
  svg.appendChild(track);
  const tip = el("rect", { x: X(r.tipica[0]), y, width: Math.max(2, X(r.tipica[1]) - X(r.tipica[0])), height: grosor, rx: 4, class: "banda-tipica" });
  svg.appendChild(tip);
  const obj = el("rect", { x: X(r.objetivo[0]), y, width: Math.max(2, X(r.objetivo[1]) - X(r.objetivo[0])), height: grosor, rx: 4, class: "banda-objetivo" });
  svg.appendChild(obj);
  // etiquetas bajo las zonas
  const et1 = el("text", { x: (X(r.tipica[0]) + X(r.tipica[1])) / 2, y: h - 4, class: "viz-tick", "text-anchor": "middle" });
  et1.textContent = "media";
  svg.appendChild(et1);
  const cxObj = (X(r.objetivo[0]) + X(r.objetivo[1])) / 2;
  if (Math.abs(cxObj - (X(r.tipica[0]) + X(r.tipica[1])) / 2) > 46) {
    const et2 = el("text", { x: cxObj, y: h - 4, class: "viz-tick", "text-anchor": "middle" });
    et2.textContent = "objetivo";
    svg.appendChild(et2);
  }
  const dot = el("circle", { cx: X(r.valor), cy: y + grosor / 2, r: 6, class: "banda-punto" });
  svg.appendChild(dot);
  cont.appendChild(svg);
}

function renderComparativa(fechas) {
  const tarjeta = $("#c-comparativa");
  const lista = $("#lista-comparativa");
  const resumen = $("#comparativa-resumen");
  const filaEdad = $("#fila-edad");
  lista.replaceChildren();

  const edad = edadUsuario();
  if (edad == null) {
    filaEdad.hidden = false;
    resumen.textContent = "Tu export no incluye la fecha de nacimiento. Dime tu edad y comparo tus números con los rangos típicos de hombres de tu edad.";
    return;
  }
  filaEdad.hidden = true;
  const dec = decada(edad);
  $("#comparativa-sub").textContent = `Con ${edad} años, tus medias del rango elegido frente a los rangos orientativos de hombres de tu edad. El punto azul eres tú.`;

  const dias = tablaDias(fechas);
  const noches = tablaNoches(fechas);
  const mFc = media(dias.map((d) => d.fcReposo));
  const mHrv = media(dias.map((d) => d.hrv));
  const vo2s = dias.map((d) => d.vo2).filter((v) => v != null);
  const mVo2 = vo2s.length ? vo2s[vo2s.length - 1] : null;
  const mPasos = media(dias.map((d) => d.pasos));
  const mSueno = media(noches.map((n) => n.dormido / 3600));
  const mEj = media(dias.map((d) => d.minEj));

  const filas = [];
  if (mFc != null)
    filas.push({
      nombre: "FC en reposo", valor: mFc, fmt: (v) => fnum(v, 0) + " ppm", menorMejor: true,
      escala: [40, 90], tipica: [64, 72], objetivo: [40, 58],
      frase: mFc < 72
        ? `El ralentí de tu motor. Girando a ${fnum(mFc, 0)} en parado ahorras unos ${fnum((72 - mFc) * 1440)} latidos al día respecto a una media alta: un corazón eficiente trabaja menos para lo mismo.`
        : `El ralentí de tu motor: en reposo gira alto (${fnum(mFc, 0)} ppm). El cardio suave y regular es lo que más lo baja; cada ppm menos son ~1.400 latidos ahorrados al día.`,
    });
  if (mHrv != null)
    filas.push({
      nombre: "Variabilidad (HRV)", valor: mHrv, fmt: (v) => fnum(v, 0) + " ms", menorMejor: false,
      escala: [15, REF_HRV[dec][1][1]], tipica: REF_HRV[dec][0], objetivo: REF_HRV[dec][1],
      frase: `La suspensión del coche: con más recorrido absorbe mejor los baches (estrés, entrenos, malas noches). Baja con la edad de forma natural, por eso tus ${fnum(mHrv, 0)} ms solo se comparan con tu franja de edad.`,
    });
  if (mVo2 != null)
    filas.push({
      nombre: "VO₂ máx", valor: mVo2, fmt: (v) => fnum(v, 1), menorMejor: false,
      escala: [22, REF_VO2[dec][1][1]], tipica: REF_VO2[dec][0], objetivo: REF_VO2[dec][1],
      frase: `La cilindrada de tu motor aeróbico, y uno de los predictores de longevidad más potentes que se conocen. Subirla pasa por intervalos y cuestas, no solo por rodar suave.`,
    });
  if (mPasos != null)
    filas.push({
      nombre: "Pasos al día", valor: mPasos, fmt: (v) => fnum(v), menorMejor: false,
      escala: [0, 16000], tipica: [5000, 6500], objetivo: [8000, 16000],
      frase: `La base de la pirámide: el movimiento de fondo del día pesa más que cualquier suplemento. La media poblacional ronda 5.000–6.500; a partir de 8.000 la curva de riesgo cae con fuerza.`,
    });
  if (mSueno != null)
    filas.push({
      nombre: "Sueño por noche", valor: mSueno, fmt: (v) => fdur(v * 3600), menorMejor: false,
      escala: [5, 10], tipica: [6.5, 7.2], objetivo: [7, 9],
      frase: `El presupuesto de la noche: con ${fdur(mSueno * 3600)} le estás dando al cuerpo su turno de mantenimiento. Las fases (abajo) son en qué se gasta ese presupuesto.`,
    });
  if (mEj != null)
    filas.push({
      nombre: "Ejercicio semanal", valor: mEj * 7, fmt: (v) => fnum(v) + " min", menorMejor: false,
      escala: [0, 500], tipica: [80, 150], objetivo: [300, 500],
      frase: `La dosis del medicamento más barato que existe: 150 min/semana es el umbral OMS y el beneficio sigue creciendo hasta ~300. Tú estás en ${fnum(mEj * 7)}.`,
    });

  let delante = 0,
    top = 0;
  const escalones = [];
  for (const r of filas) {
    const estado = estadoDe(r);
    if (estado === "top") {
      top++;
      delante++;
    } else if (estado === "delante") delante++;
    if (estado !== "top") {
      const objetivo = r.menorMejor ? r.objetivo[1] : r.objetivo[0];
      const distancia = Math.abs(objetivo - r.valor) / (r.escala[1] - r.escala[0]);
      // En minúscula salvo siglas (FC, VO₂…), y sin escalones que el redondeo vacía
      const nombre = r.nombre[1] === r.nombre[1].toLowerCase() ? r.nombre[0].toLowerCase() + r.nombre.slice(1) : r.nombre;
      if (r.fmt(r.valor) !== r.fmt(objetivo)) escalones.push({ texto: `${nombre}: de ${r.fmt(r.valor)} a ${r.fmt(objetivo)}`, distancia });
    }

    const fila = document.createElement("div");
    fila.className = "comp-fila";
    const info = document.createElement("div");
    const nom = document.createElement("strong");
    nom.textContent = r.nombre;
    const val = document.createElement("span");
    val.className = "comp-valor";
    val.textContent = " " + r.fmt(r.valor);
    const [icono, textoEstado, clase] = ETIQUETA_ESTADO[estado];
    const est = document.createElement("div");
    est.className = "comp-estado " + clase;
    est.textContent = `${icono} ${textoEstado}`;
    info.appendChild(nom);
    info.appendChild(val);
    info.appendChild(est);
    const banda = document.createElement("div");
    banda.className = "comp-banda";
    const frase = document.createElement("p");
    frase.className = "comp-frase";
    frase.textContent = r.frase;
    fila.appendChild(info);
    fila.appendChild(banda);
    fila.appendChild(frase);
    lista.appendChild(fila);
    bandaMetrica(banda, r);
  }

  if (!filas.length) {
    resumen.textContent = "No hay métricas comparables en este rango.";
    return;
  }
  escalones.sort((a, b) => a.distancia - b.distancia);
  let txt = `Estás por delante de la media típica en ${delante} de ${filas.length} métricas comparables` + (top ? `, y muy por encima en ${top}` : "") + ".";
  if (escalones.length)
    txt += ` Para tu objetivo de estar claramente mejor que la media, los escalones más a mano son ${escalones.slice(0, 3).map((e) => e.texto).join("; ")}.`;
  else txt += " Objetivo cumplido en todo lo medible: ahora toca mantenerlo.";
  resumen.textContent = txt;
}

// ===========================================================================
// Render de las secciones nuevas
// ===========================================================================

const METRICAS_PANORAMA = [
  { clave: "pasos", nombre: "Pasos", unidad: "pasos", formato: (v) => fnum(v) },
  { clave: "energia", nombre: "Energía activa", unidad: "kcal", formato: (v) => fnum(v) },
  { clave: "minEj", nombre: "Minutos de ejercicio", unidad: "min", formato: (v) => fnum(v) },
  { clave: "dormidoH", nombre: "Sueño", unidad: "", formato: (v) => fdur(v * 3600) },
];

function renderPanorama(fechas) {
  const tarjeta = $("#c-panorama");
  const sel = $("#sel-panorama");
  if (!sel.options.length) {
    for (const m of METRICAS_PANORAMA) {
      const o = document.createElement("option");
      o.value = m.clave;
      o.textContent = m.nombre;
      sel.appendChild(o);
    }
    sel.onchange = () => renderPanorama(fechasDelRango());
  }
  const met = METRICAS_PANORAMA.find((m) => m.clave === sel.value) || METRICAS_PANORAMA[0];
  const dias = tablaDias(fechas);
  const valores = dias.map((d) => d[met.clave]);
  const hay = valores.some((v) => v != null);
  tarjeta.hidden = !hay;
  if (!hay) return;
  $(".sub-tarjeta", tarjeta).textContent = `Cada celda es un día; cuanto más oscura, más ${met.nombre.toLowerCase()}. Pasa el cursor para ver el detalle.`;
  graficaCalendario($(".viz", tarjeta), fechas, valores, met);
  botonTabla(tarjeta, ["Fecha", met.nombre], fechas.map((f, i) => [ffechaLarga(f), valores[i] != null ? met.formato(valores[i]) : null]).filter((r) => r[1] != null));
}

const METRICAS_CRUCE = [
  { clave: "pasos", nombre: "Pasos del día", fmt: (v) => fnum(v), fmtEje: (v) => (v >= 10000 ? fnum(v / 1000) + "k" : fnum(v)) },
  { clave: "energia", nombre: "Energía activa (kcal)", fmt: (v) => fnum(v) },
  { clave: "minEj", nombre: "Minutos de ejercicio", fmt: (v) => fnum(v) },
  { clave: "entrenoMin", nombre: "Minutos de entreno", fmt: (v) => fnum(v) },
  { clave: "dormidoH", nombre: "Sueño de la noche anterior", fmt: (v) => fdur(v * 3600) },
  { clave: "profundoH", nombre: "Sueño profundo (noche anterior)", fmt: (v) => fdur(v * 3600) },
  { clave: "eficiencia", nombre: "Eficiencia del sueño (%)", fmt: (v) => fnum(v, 0) + " %" },
  { clave: "acostarseH", nombre: "Hora de acostarse", fmt: (v) => horaTexto(v * 60) },
  { clave: "fcReposo", nombre: "FC en reposo (ppm)", fmt: (v) => fnum(v, 0) },
  { clave: "hrv", nombre: "HRV (ms)", fmt: (v) => fnum(v, 0) },
  { clave: "peso", nombre: "Peso (kg)", fmt: (v) => fnum(v, 1) },
];

function renderInteligencia(fechas) {
  // Hallazgos
  const lista = $("#lista-hallazgos");
  lista.replaceChildren();
  const hallazgos = motorHallazgos(fechas);
  if (!hallazgos.length) {
    const p = document.createElement("p");
    p.className = "sub-tarjeta";
    p.textContent = "Con este rango no salen patrones sólidos. Prueba con 90 días o más: cuantos más días, más cruces se pueden hacer con garantías.";
    lista.appendChild(p);
  }
  for (const h of hallazgos) {
    const fila = document.createElement("div");
    fila.className = "hallazgo " + h.clase;
    const icono = document.createElement("span");
    icono.className = "hallazgo-icono";
    icono.textContent = h.clase === "bueno" ? "▲" : h.clase === "malo" ? "▼" : "●";
    const cuerpo = document.createElement("div");
    const t = document.createElement("strong");
    t.textContent = h.titulo;
    const d = document.createElement("p");
    d.textContent = h.detalle;
    cuerpo.appendChild(t);
    cuerpo.appendChild(d);
    fila.appendChild(icono);
    fila.appendChild(cuerpo);
    lista.appendChild(fila);
  }

  // Dispersión con selectores
  const selX = $("#sel-x"),
    selY = $("#sel-y");
  if (!selX.options.length) {
    for (const sel of [selX, selY])
      for (const m of METRICAS_CRUCE) {
        const o = document.createElement("option");
        o.value = m.clave;
        o.textContent = m.nombre;
        sel.appendChild(o);
      }
    selX.value = "pasos";
    selY.value = "dormidoH";
    selX.onchange = selY.onchange = () => renderInteligencia(fechasDelRango());
  }
  const mx = METRICAS_CRUCE.find((m) => m.clave === selX.value);
  const my = METRICAS_CRUCE.find((m) => m.clave === selY.value);
  const dias = tablaDias(fechas);
  const puntos = dias
    .filter((d) => d[mx.clave] != null && d[my.clave] != null)
    .map((d) => ({ f: d.f, x: d[mx.clave], y: d[my.clave] }));
  const tarjeta = $("#c-dispersion");
  const reg = graficaDispersion($(".viz", tarjeta), puntos, {
    nombreX: mx.nombre,
    nombreY: my.nombre,
    fmtX: mx.fmtEje || ((v) => fnum(v, v < 50 ? 1 : 0)),
    fmtY: (v) => fnum(v, v < 50 ? 1 : 0),
    fmtXLargo: mx.fmt,
    fmtYLargo: my.fmt,
  });
  const lectura = $("#lectura-dispersion");
  if (reg) {
    const fuerza = Math.abs(reg.r) >= 0.6 ? "fuerte" : Math.abs(reg.r) >= 0.35 ? "moderada" : Math.abs(reg.r) >= 0.15 ? "débil" : "prácticamente nula";
    lectura.textContent = `Relación ${fuerza} (r = ${fnum(reg.r, 2)}) sobre ${reg.n} días. Cada punto es un día del rango; la recta resume la tendencia. Correlación no implica causalidad.`;
  } else lectura.textContent = "";
  botonTabla(
    tarjeta,
    ["Fecha", mx.nombre, my.nombre],
    puntos.map((p) => [ffechaLarga(p.f), mx.fmt(p.x), my.fmt(p.y)])
  );
}

function renderSemanaTipo(fechas) {
  const dias = tablaDias(fechas);
  const seccion = $("#s-semana");
  const mediaPorDow = (clave) => {
    const g = [[], [], [], [], [], [], []];
    for (const d of dias) if (d[clave] != null) g[d.dow].push(d[clave]);
    return g.map((v) => (v.length ? media(v) : null));
  };
  const pasosDow = mediaPorDow("pasos");
  const suenoDow = mediaPorDow("dormidoH");
  const hayPasos = pasosDow.some((v) => v != null),
    haySueno = suenoDow.some((v) => v != null);
  seccion.hidden = !hayPasos && !haySueno;
  if (seccion.hidden) return;

  const idx = [0, 1, 2, 3, 4, 5, 6];
  const t1 = $("#c-semana-pasos");
  t1.hidden = !hayPasos;
  if (hayPasos) {
    graficaBarras($(".viz", t1), idx, pasosDow, {
      unidad: "pasos de media",
      formato: (v) => fnum(v),
      fmtX: (i) => DIAS_CORTOS[i],
      tituloX: (i) => DIAS_SEMANA[i][0].toUpperCase() + DIAS_SEMANA[i].slice(1),
      etiquetaMax: true,
      alto: 200,
    });
    botonTabla(t1, ["Día", "Pasos de media"], idx.map((i) => [DIAS_SEMANA[i], pasosDow[i] != null ? fnum(pasosDow[i]) : null]));
  }
  const t2 = $("#c-semana-sueno");
  t2.hidden = !haySueno;
  if (haySueno) {
    graficaBarras($(".viz", t2), idx, suenoDow, {
      unidad: "de media",
      formato: (v) => fdur(v * 3600),
      fmtTick: (v) => fnum(v, 0) + " h",
      fmtX: (i) => DIAS_CORTOS[i],
      tituloX: (i) => "Noche que acaba en " + DIAS_SEMANA[i],
      etiquetaMax: true,
      alto: 200,
    });
    botonTabla(t2, ["Amaneciendo en", "Sueño de media"], idx.map((i) => [DIAS_SEMANA[i], suenoDow[i] != null ? fdur(suenoDow[i] * 3600) : null]));
  }
}

function renderRitmo(fechas) {
  const tarjeta = $("#c-ritmo");
  const noches = tablaNoches(fechas);
  const ok = graficaRitmoSueno($(".viz", tarjeta), noches);
  tarjeta.hidden = !ok;
  if (!ok) return;
  leyenda(tarjeta, [
    { nombre: "Entre semana", color: "var(--s1)" },
    { nombre: "Noche de viernes o sábado", color: "var(--s2)" },
  ]);
  botonTabla(
    tarjeta,
    ["Noche del", "Te acostaste", "Te levantaste", "Dormido"],
    noches
      .filter((n) => n.acostarse != null)
      .map((n) => [ffechaLarga(sumaDias(n.f, -1)), horaTexto(n.acostarse), horaTexto(n.levantarse), fdur(n.dormido)])
  );
}

function renderRecords(fechas) {
  const dias = tablaDias(fechas);
  const noches = tablaNoches(fechas);
  const enRango = DATOS.entrenos.filter((e) => e.fecha >= RANGO.ini && e.fecha <= RANGO.fin);
  const cont = $("#lista-records");
  cont.replaceChildren();
  const R = [];
  const mejor = (arr, clave, cmp) => {
    let m = null;
    for (const x of arr) if (x[clave] != null && (m == null || cmp(x[clave], m[clave]))) m = x;
    return m;
  };
  const mPasos = mejor(dias, "pasos", (a, b) => a > b);
  if (mPasos) R.push(["Día con más pasos", fnum(mPasos.pasos), ffechaLarga(mPasos.f)]);
  const mNoche = mejor(noches, "dormido", (a, b) => a > b);
  if (mNoche) R.push(["Noche más larga", fdur(mNoche.dormido), "amaneciendo el " + ffechaLarga(mNoche.f)]);
  const mEnergia = mejor(dias, "energia", (a, b) => a > b);
  if (mEnergia) R.push(["Día más activo", fnum(mEnergia.energia) + " kcal", ffechaLarga(mEnergia.f)]);
  if (enRango.length) {
    const e = enRango.reduce((a, b) => (b.dur > a.dur ? b : a));
    R.push(["Entreno más largo", fnum(e.dur) + " min", nombreEntreno(e.tipo) + ", " + ffechaLarga(e.fecha)]);
  }
  const mFc = mejor(dias, "fcReposo", (a, b) => a < b);
  if (mFc) R.push(["FC en reposo más baja", fnum(mFc.fcReposo, 0) + " ppm", ffechaLarga(mFc.f)]);
  const mHrv = mejor(dias, "hrv", (a, b) => a > b);
  if (mHrv) R.push(["Mejor HRV", fnum(mHrv.hrv, 0) + " ms", ffechaLarga(mHrv.f)]);
  $("#s-records").hidden = !R.length;
  for (const [lab, val, cuando] of R) {
    const div = document.createElement("div");
    div.className = "kpi kpi-mini";
    const l = document.createElement("div");
    l.className = "kpi-etiqueta";
    l.textContent = lab;
    const v = document.createElement("div");
    v.className = "kpi-valor";
    v.textContent = val;
    const c = document.createElement("div");
    c.className = "record-fecha";
    c.textContent = cuando;
    div.appendChild(l);
    div.appendChild(v);
    div.appendChild(c);
    cont.appendChild(div);
  }
}

function renderConsejos(fechas) {
  const cont = $("#lista-consejos");
  cont.replaceChildren();
  const consejos = motorConsejos(fechas);
  $("#c-consejos").hidden = !consejos.length;
  for (const c of consejos) {
    const fila = document.createElement("div");
    fila.className = "consejo " + c.tipo;
    const icono = document.createElement("span");
    icono.className = "consejo-icono";
    icono.textContent = c.tipo === "ok" ? "✓" : "→";
    const p = document.createElement("p");
    p.textContent = c.texto;
    fila.appendChild(icono);
    fila.appendChild(p);
    cont.appendChild(fila);
  }
}

// ---------- arranque ----------
iniciaCarga();
$("#borrar").addEventListener("click", () => {
  localStorage.removeItem(CLAVE_LS);
  location.reload();
});
$("#otro-archivo").addEventListener("click", () => {
  $("#app").hidden = true;
  $("#cargador").hidden = false;
  $("#zona-carga").hidden = false;
  $("#cargando").hidden = true;
});
$("#edad-aplicar").addEventListener("click", () => {
  const e = parseInt($("#edad-manual").value, 10);
  if (e >= 18 && e <= 100) {
    try {
      localStorage.setItem("lement-salud-edad", String(e));
    } catch (err) {}
    renderComparativa(fechasDelRango());
  }
});

try {
  const guardado = localStorage.getItem(CLAVE_LS);
  if (guardado) {
    DATOS = JSON.parse(guardado);
    if (DATOS && DATOS.meta && DATOS.meta.fechaMax) arrancaApp();
    else DATOS = null;
  }
} catch (e) {
  DATOS = null;
}
