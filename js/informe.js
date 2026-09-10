// ===========================================================================
// Informe para el médico
// Software ideado por Manuel Crespo y desarrollado junto a Claude Code.
// ===========================================================================
// Genera un archivo .html autocontenido con el análisis del periodo que haya
// en pantalla ya metido dentro: la misma app, las mismas gráficas, pero sin
// nombre, sin fecha de nacimiento y sin necesidad de internet para abrirlo.
//
// El archivo se arma aquí, en el navegador, leyendo los propios archivos de
// la app (nada sale del dispositivo) y se descarga como cualquier otro. Quien
// lo recibe solo tiene que abrirlo con doble clic: no carga nada de fuera.
// ===========================================================================

"use strict";

(() => {
  const boton = document.getElementById("informe");
  if (!boton) return;

  const FUENTES = ["P-Light", "P-Regular", "P-ExtraBold", "P-Black"];

  // ---------- lectura de los archivos de la propia app ----------
  async function texto(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("no se pudo leer " + url);
    return r.text();
  }
  async function base64(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("no se pudo leer " + url);
    const b = new Uint8Array(await r.arrayBuffer());
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ---------- recorte de los datos ----------
  // Se lleva solo el periodo elegido más un margen hacia atrás, para que las
  // comparaciones con el periodo anterior sigan teniendo con qué comparar.
  function inicioConMargen(ini, fin) {
    const dias = Math.round((new Date(fin) - new Date(ini)) / 86400000) + 1;
    const d = new Date(ini + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - dias - 7);
    return d.toISOString().slice(0, 10);
  }

  function filtraDias(obj, dentro) {
    const out = {};
    for (const f in obj) if (dentro(f)) out[f] = obj[f];
    return out;
  }

  // Los nombres de los dispositivos de Apple llevan el nombre de su dueño
  // ("iPhone de Manuel", "Manuel's Apple Watch"): aquí se quedan en el
  // aparato, que es lo único que importa para leer el informe.
  function fuenteAnonima(nombre) {
    return String(nombre)
      .replace(/\s+de\s+.*$/i, "")
      .replace(/^.*?[''`]s\s+/i, "")
      .trim() || "Dispositivo";
  }

  function recorta(datos, desde, hasta, edad) {
    const dentro = (f) => f >= desde && f <= hasta;

    const series = {};
    for (const tipo in datos.series) {
      const s = datos.series[tipo];
      const dias = filtraDias(s.dias, dentro);
      if (!Object.keys(dias).length) continue;
      const nueva = Object.assign({}, s, { dias });
      if (s.min) nueva.min = filtraDias(s.min, dentro);
      if (s.max) nueva.max = filtraDias(s.max, dentro);
      series[tipo] = nueva;
    }

    const meds = {};
    for (const nombre in datos.meds || {}) {
      const dias = filtraDias(datos.meds[nombre].dias, dentro);
      let total = 0;
      for (const f in dias) total += dias[f];
      if (total) meds[nombre] = { dias, total };
    }

    const meta = Object.assign({}, datos.meta, {
      nacimiento: null, // fuera: para el informe basta la edad
      edad: edad || null,
      fechaMin: datos.meta.fechaMin > desde ? datos.meta.fechaMin : desde,
      fechaMax: datos.meta.fechaMax < hasta ? datos.meta.fechaMax : hasta,
      fuentes: (datos.meta.fuentes || []).map((f) =>
        Array.isArray(f) ? [fuenteAnonima(f[0]), f[1]] : fuenteAnonima(f)
      ),
      generado: Date.now(),
    });

    return {
      meta,
      series,
      meds,
      sueno: filtraDias(datos.sueno, dentro),
      entrenos: datos.entrenos.filter((e) => dentro(e.fecha)),
    };
  }

  // ---------- montaje del archivo ----------
  const MEMORIA_SEGURA = `(function () {
  try {
    window.localStorage.setItem("__p", "1");
    window.localStorage.removeItem("__p");
    return;
  } catch (e) {}
  var caja = {};
  var falso = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(caja, k) ? caja[k] : null; },
    setItem: function (k, v) { caja[k] = String(v); },
    removeItem: function (k) { delete caja[k]; },
    clear: function () { caja = {}; },
    key: function (i) { var ks = Object.keys(caja); return i < ks.length ? ks[i] : null; },
  };
  Object.defineProperty(falso, "length", { get: function () { return Object.keys(caja).length; } });
  try {
    Object.defineProperty(window, "localStorage", { value: falso, configurable: true });
  } catch (e) {}
})();`;

  function nuevoScript(doc, codigo) {
    const s = doc.createElement("script");
    s.textContent = codigo;
    return s;
  }

  async function construye() {
    const desde = inicioConMargen(RANGO.ini, RANGO.fin);
    const paquete = {
      datos: recorta(DATOS, desde, RANGO.fin, edadUsuario()),
      // "Todo" viaja como fechas concretas: en el informe los datos ya vienen
      // recortados y ese atajo dejaría de significar lo mismo.
      rango: { dias: typeof RANGO.dias === "number" ? RANGO.dias : null, ini: RANGO.ini, fin: RANGO.fin },
    };

    const piezas = await Promise.all(
      [texto("index.html"), texto("assets/estilo.css"), texto("js/tema.js"), texto("js/salud.js")].concat(
        FUENTES.map((n) => base64("assets/fonts/" + n + ".woff2"))
      )
    );
    // Ni siquiera en los comentarios del código: el informe no lleva nombre.
    const AUTORIA = "Software ideado por Manuel Crespo y desarrollado junto a Claude Code.";
    const NEUTRA = "Software personal desarrollado junto a Claude Code.";
    const anonimo = (txt) => txt.split(AUTORIA).join(NEUTRA);
    const [html, css, jsTema, jsApp] = piezas.slice(0, 4).map(anonimo);
    const woff2 = piezas.slice(4);

    // Las fuentes viajan dentro del CSS: el archivo se ve igual sin internet.
    let cssInline = css;
    FUENTES.forEach((n, i) => {
      cssInline = cssInline.replace(
        'url("fonts/' + n + '.woff2")',
        'url("data:font/woff2;base64,' + woff2[i] + '")'
      );
    });

    const doc = new DOMParser().parseFromString(html, "text/html");

    const estilo = doc.createElement("style");
    estilo.textContent = cssInline;
    doc.querySelector('link[rel="stylesheet"]').replaceWith(estilo);

    // Fuera todo lo que en un informe no pinta nada: la zona de carga, los
    // botones de la app y los archivos externos.
    doc.querySelector("#cargador").remove();
    const acciones = doc.querySelector(".barra-datos .acciones");
    if (acciones) acciones.remove();
    doc.querySelectorAll("script[src]").forEach((s) => s.remove());

    // Abierto con doble clic (file://) hay navegadores, Safari entre ellos, que
    // prohíben la memoria del navegador y lanzan un error al tocarla. Con esto
    // el informe se abre igual: recuerda las cosas solo mientras está abierto.
    doc.head.insertBefore(nuevoScript(doc, MEMORIA_SEGURA), doc.head.firstChild);

    doc.title = "Informe de salud";
    doc.querySelector(".cabecera-pagina .eyebrow").textContent = "Informe de salud · documento anónimo";
    doc.querySelector(".cabecera-pagina h1").textContent = "Informe de salud";
    doc.querySelector(".cabecera-pagina .sub").textContent =
      "Análisis de los datos de la app Salud del iPhone correspondientes al periodo indicado más abajo. " +
      "El documento no contiene ningún dato identificativo y funciona sin conexión: todo lo que necesita " +
      "va dentro del propio archivo.";

    const json = JSON.stringify(paquete).replace(/</g, "\\u003c");
    doc.body.appendChild(nuevoScript(doc, "window.INFORME_SALUD=" + json + ";"));
    doc.body.appendChild(nuevoScript(doc, jsTema));
    doc.body.appendChild(nuevoScript(doc, jsApp));

    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  }

  // ---------- botón ----------
  function pesoLegible(bytes) {
    const mb = bytes / 1048576;
    return mb >= 1
      ? mb.toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " MB"
      : Math.round(bytes / 1024) + " KB";
  }

  boton.addEventListener("click", async () => {
    if (!DATOS || !RANGO.ini || !RANGO.fin) return;
    const original = boton.textContent;
    boton.disabled = true;
    boton.textContent = "Preparando el informe…";
    try {
      const salida = await construye();
      const blob = new Blob([salida], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "informe-salud-" + RANGO.ini + "_a_" + RANGO.fin + ".html";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      boton.textContent = "Informe descargado (" + pesoLegible(blob.size) + ")";
    } catch (e) {
      boton.textContent = "No se pudo generar el informe";
      console.error(e);
    }
    setTimeout(() => {
      boton.textContent = original;
      boton.disabled = false;
    }, 6000);
  });
})();
