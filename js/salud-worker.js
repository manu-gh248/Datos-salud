// ===========================================================================
// Tu salud, en claro
// Software ideado por Manuel Crespo y desarrollado junto a Claude Code.
// Herramienta personal: los datos de salud no salen nunca del navegador.
// ===========================================================================
// Worker de análisis del export de Apple Salud. Recibe el archivo (export.zip
// o export.xml), lo lee en streaming y devuelve agregados diarios. Todo ocurre
// en el navegador: ningún dato sale del dispositivo.
//
// El XML de Apple puede superar el gigabyte, así que nunca se carga entero:
// del zip se extrae solo la entrada del XML descomprimiendo con
// DecompressionStream, y el texto se recorre por trozos buscando los elementos
// <Record>, <Workout> y <ActivitySummary>.

"use strict";

// ---------------------------------------------------------------------------
// Catálogo de tipos. `agg` decide cómo se agrega el día:
//   suma  → total diario (y con varios aparatos, el que más registró: iPhone y
//           Watch cuentan los mismos pasos, sumarlos los duplicaría)
//   media → media diaria de todas las muestras
//   ultimo→ última muestra del día (peso, VO₂max…)
// Los tipos fuera del catálogo también se guardan (media) para el explorador.
const TIPOS = {
  HKQuantityTypeIdentifierStepCount: { n: "Pasos", u: "pasos", agg: "suma" },
  HKQuantityTypeIdentifierDistanceWalkingRunning: { n: "Distancia a pie", u: "km", agg: "suma" },
  HKQuantityTypeIdentifierDistanceCycling: { n: "Distancia en bici", u: "km", agg: "suma" },
  HKQuantityTypeIdentifierDistanceSwimming: { n: "Distancia nadando", u: "km", agg: "suma" },
  HKQuantityTypeIdentifierFlightsClimbed: { n: "Pisos subidos", u: "pisos", agg: "suma" },
  HKQuantityTypeIdentifierActiveEnergyBurned: { n: "Energía activa", u: "kcal", agg: "suma" },
  HKQuantityTypeIdentifierBasalEnergyBurned: { n: "Energía basal", u: "kcal", agg: "suma" },
  HKQuantityTypeIdentifierAppleExerciseTime: { n: "Minutos de ejercicio", u: "min", agg: "suma" },
  HKQuantityTypeIdentifierAppleStandTime: { n: "Minutos de pie", u: "min", agg: "suma" },
  HKQuantityTypeIdentifierHeartRate: { n: "Frecuencia cardiaca", u: "ppm", agg: "media", extremos: true },
  HKQuantityTypeIdentifierRestingHeartRate: { n: "FC en reposo", u: "ppm", agg: "media" },
  HKQuantityTypeIdentifierWalkingHeartRateAverage: { n: "FC media caminando", u: "ppm", agg: "media" },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { n: "Variabilidad (HRV)", u: "ms", agg: "media" },
  HKQuantityTypeIdentifierHeartRateRecoveryOneMinute: { n: "Recuperación FC 1 min", u: "ppm", agg: "media" },
  HKQuantityTypeIdentifierVO2Max: { n: "VO₂ máx", u: "ml/kg·min", agg: "ultimo" },
  HKQuantityTypeIdentifierRespiratoryRate: { n: "Frecuencia respiratoria", u: "rpm", agg: "media" },
  HKQuantityTypeIdentifierOxygenSaturation: { n: "Oxígeno en sangre", u: "%", agg: "media", pct: true },
  HKQuantityTypeIdentifierBodyMass: { n: "Peso", u: "kg", agg: "ultimo" },
  HKQuantityTypeIdentifierBodyMassIndex: { n: "IMC", u: "", agg: "ultimo" },
  HKQuantityTypeIdentifierBodyFatPercentage: { n: "Grasa corporal", u: "%", agg: "ultimo", pct: true },
  HKQuantityTypeIdentifierLeanBodyMass: { n: "Masa magra", u: "kg", agg: "ultimo" },
  HKQuantityTypeIdentifierBloodPressureSystolic: { n: "Tensión sistólica", u: "mmHg", agg: "media" },
  HKQuantityTypeIdentifierBloodPressureDiastolic: { n: "Tensión diastólica", u: "mmHg", agg: "media" },
  HKQuantityTypeIdentifierBloodGlucose: { n: "Glucosa", u: "mg/dL", agg: "media" },
  HKQuantityTypeIdentifierBodyTemperature: { n: "Temperatura corporal", u: "°C", agg: "media" },
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: { n: "Temperatura de muñeca (sueño)", u: "°C", agg: "media" },
  HKQuantityTypeIdentifierEnvironmentalAudioExposure: { n: "Exposición al ruido", u: "dB", agg: "media" },
  HKQuantityTypeIdentifierHeadphoneAudioExposure: { n: "Ruido en auriculares", u: "dB", agg: "media" },
  HKQuantityTypeIdentifierWalkingSpeed: { n: "Velocidad al caminar", u: "km/h", agg: "media" },
  HKQuantityTypeIdentifierWalkingStepLength: { n: "Longitud de zancada", u: "cm", agg: "media" },
  HKQuantityTypeIdentifierWalkingAsymmetryPercentage: { n: "Asimetría al caminar", u: "%", agg: "media", pct: true },
  HKQuantityTypeIdentifierWalkingDoubleSupportPercentage: { n: "Doble apoyo al caminar", u: "%", agg: "media", pct: true },
  HKQuantityTypeIdentifierAppleWalkingSteadiness: { n: "Estabilidad al caminar", u: "%", agg: "media", pct: true },
  HKQuantityTypeIdentifierSixMinuteWalkTestDistance: { n: "Test 6 min caminando", u: "m", agg: "ultimo" },
  HKQuantityTypeIdentifierStairAscentSpeed: { n: "Velocidad subiendo escaleras", u: "m/s", agg: "media" },
  HKQuantityTypeIdentifierStairDescentSpeed: { n: "Velocidad bajando escaleras", u: "m/s", agg: "media" },
  HKQuantityTypeIdentifierDietaryWater: { n: "Agua", u: "ml", agg: "suma" },
  HKQuantityTypeIdentifierDietaryEnergyConsumed: { n: "Calorías ingeridas", u: "kcal", agg: "suma" },
  HKQuantityTypeIdentifierDietaryCaffeine: { n: "Cafeína", u: "mg", agg: "suma" },
  HKQuantityTypeIdentifierNumberOfAlcoholicBeverages: { n: "Bebidas alcohólicas", u: "copas", agg: "suma" },
  HKQuantityTypeIdentifierNumberOfTimesFallen: { n: "Caídas", u: "veces", agg: "suma" },
  HKQuantityTypeIdentifierSwimmingStrokeCount: { n: "Brazadas", u: "brazadas", agg: "suma" },
  HKQuantityTypeIdentifierPhysicalEffort: { n: "Esfuerzo físico", u: "kcal/h·kg", agg: "media" },
  HKQuantityTypeIdentifierTimeInDaylight: { n: "Tiempo a la luz del día", u: "min", agg: "suma" },
  HKQuantityTypeIdentifierRunningSpeed: { n: "Velocidad corriendo", u: "km/h", agg: "media" },
  HKQuantityTypeIdentifierRunningPower: { n: "Potencia corriendo", u: "W", agg: "media" },
  HKQuantityTypeIdentifierRunningVerticalOscillation: { n: "Oscilación vertical", u: "cm", agg: "media" },
  HKQuantityTypeIdentifierRunningGroundContactTime: { n: "Contacto con el suelo", u: "ms", agg: "media" },
  HKQuantityTypeIdentifierRunningStrideLength: { n: "Zancada corriendo", u: "m", agg: "media" },
  HKQuantityTypeIdentifierCyclingPower: { n: "Potencia en bici", u: "W", agg: "media" },
  HKQuantityTypeIdentifierCyclingCadence: { n: "Cadencia en bici", u: "rpm", agg: "media" },
};

// Valores del registro de sueño → fase. Las claves antiguas (iOS ≤ 15) solo
// distinguen "dormido"; desde iOS 16 llegan las fases.
const FASES_SUENO = {
  HKCategoryValueSleepAnalysisInBed: "enCama",
  HKCategoryValueSleepAnalysisAsleep: "dormido",
  HKCategoryValueSleepAnalysisAsleepUnspecified: "dormido",
  HKCategoryValueSleepAnalysisAsleepCore: "ligero",
  HKCategoryValueSleepAnalysisAsleepDeep: "profundo",
  HKCategoryValueSleepAnalysisAsleepREM: "rem",
  HKCategoryValueSleepAnalysisAwake: "despierto",
};

// Conversión de unidades a las del catálogo.
const CONV = {
  mi: { f: 1.60934, u: "km" },
  m: { f: 0.001, u: "km" },
  lb: { f: 0.453592, u: "kg" },
  st: { f: 6.35029, u: "kg" },
  "mi/hr": { f: 1.60934, u: "km/h" },
  "m/s→km/h": { f: 3.6, u: "km/h" },
  kJ: { f: 0.239006, u: "kcal" },
  Cal: { f: 1, u: "kcal" },
  cal: { f: 0.001, u: "kcal" },
  degF: { f: 0, u: "°C" }, // caso especial más abajo
  "fl_oz_us": { f: 29.5735, u: "ml" },
  L: { f: 1000, u: "ml" },
};

const dec = new TextDecoder("utf-8");

// ---------- Estado de agregación ----------
let perfil; // del elemento <Me>: nacimiento y sexo
let series; // clave tipo → { dias: Map(fecha → acumulado) }
let sueno; // Map(nocheFecha → Map(fuente → fases))
let entrenos;
let meds; // nombre → Map(fecha → tomas)
let pulso; // casilla de 30 s → [min, max, suma, n] (se descarta al terminar)
let pulsoRecortado; // true si el export traía tanto pulso que hubo que cortar
let inventarioTipos; // type= de cada <Record> → cuántos
let inventarioElementos; // elementos del XML que no son Record/Workout/Me → cuántos
let fuentes;
let nRegistros;
let fechaMin, fechaMax;
let hoy; // tope: nada puede haber pasado todavía en el futuro
let descartadasFuturo, descartadasAntiguas;

function reinicia() {
  perfil = {};
  series = new Map();
  sueno = new Map();
  entrenos = [];
  meds = new Map();
  pulso = new Map();
  pulsoRecortado = false;
  inventarioTipos = new Map();
  inventarioElementos = new Map();
  fuentes = new Map();
  nRegistros = 0;
  fechaMin = "9999";
  fechaMax = "0000";
  const d = new Date();
  hoy = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  descartadasFuturo = 0;
  descartadasAntiguas = 0;
}

// Extrae el valor de un atributo del texto de una etiqueta. Mucho más rápido
// que un regex global con millones de registros.
function atributo(tag, nombre) {
  const marca = nombre + '="';
  const i = tag.indexOf(marca);
  if (i < 0) return null;
  const j = tag.indexOf('"', i + marca.length);
  if (j < 0) return null;
  return tag.slice(i + marca.length, j);
}

function desescapa(t) {
  if (t.indexOf("&") < 0) return t;
  return t
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

// "2026-03-01 07:45:12 +0100" → fecha local del aparato tal y como se anotó.
function fechaDe(s) {
  return s ? s.slice(0, 10) : null;
}
// Algún aparato con la hora mal puesta cuela registros con fecha futura (o de
// los años 70). Se descartan: si no, estiran el periodo y dejan la app
// diciendo que tienes datos hasta 2028.
function fechaCreible(f) {
  if (!f) return false;
  if (f > hoy) {
    descartadasFuturo++;
    return false;
  }
  if (f < "2007-01-01") {
    descartadasAntiguas++;
    return false;
  }
  return true;
}
function horaDe(s) {
  return s ? +s.slice(11, 13) : 0;
}
// Milisegundos absolutos (con zona) para duraciones.
function msDe(s) {
  if (!s) return NaN;
  // 2026-03-01 07:45:12 +0100 → 2026-03-01T07:45:12+01:00
  const iso = s.slice(0, 10) + "T" + s.slice(11, 19) + s.slice(19).replace(" ", "").replace(/(\d\d)(\d\d)$/, "$1:$2");
  return Date.parse(iso);
}
function diaSiguiente(f) {
  const d = new Date(f + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function anotaFuente(nombre) {
  if (!nombre) return;
  fuentes.set(nombre, (fuentes.get(nombre) || 0) + 1);
}

function normaliza(valor, unidad, def) {
  if (unidad === "degF") return { v: ((valor - 32) * 5) / 9, u: "°C" };
  const c = CONV[unidad];
  if (c && c.f) return { v: valor * c.f, u: c.u };
  if (unidad === "m/s" && def && def.u === "km/h") return { v: valor * 3.6, u: "km/h" };
  if (unidad === "m" && def && def.u === "cm") return { v: valor * 100, u: "cm" };
  return { v: valor, u: unidad || (def ? def.u : "") };
}

function procesaRecord(tag, cuerpo) {
  const tipo = atributo(tag, "type");
  if (!tipo) return;
  nRegistros++;
  inventarioTipos.set(tipo, (inventarioTipos.get(tipo) || 0) + 1);

  if (tipo === "HKCategoryTypeIdentifierSleepAnalysis") return procesaSueno(tag);
  if (tipo === "HKCategoryTypeIdentifierMindfulSession") return procesaMindful(tag);
  if (/medication/i.test(tipo)) return procesaMedicacion(tag, cuerpo);
  if (tipo.indexOf("HKCategoryTypeIdentifier") === 0) return; // resto de categorías: sin valor numérico útil

  const bruto = parseFloat(atributo(tag, "value"));
  if (!isFinite(bruto)) return;
  const inicio = atributo(tag, "startDate");
  const fecha = fechaDe(inicio);
  if (!fechaCreible(fecha)) return;

  const def = TIPOS[tipo];
  let { v, u } = normaliza(bruto, atributo(tag, "unit"), def);
  if (def && def.pct && v <= 1) v *= 100;

  const fuente = atributo(tag, "sourceName");
  anotaFuente(fuente);
  if (fecha < fechaMin) fechaMin = fecha;
  if (fecha > fechaMax) fechaMax = fecha;

  if (tipo === "HKQuantityTypeIdentifierHeartRate") anotaPulso(inicio, v);

  let s = series.get(tipo);
  if (!s) {
    s = { unidad: def ? def.u : u, dias: new Map() };
    series.set(tipo, s);
  }
  let d = s.dias.get(fecha);
  if (!d) {
    d = { sum: 0, n: 0, min: Infinity, max: -Infinity, last: v, porFuente: null };
    s.dias.set(fecha, d);
  }
  d.sum += v;
  d.n++;
  if (v < d.min) d.min = v;
  if (v > d.max) d.max = v;
  d.last = v;
  if (def && def.agg === "suma") {
    // Suma por fuente para quedarnos luego con la que más registró (evita
    // contar dos veces los pasos de iPhone + Watch).
    if (!d.porFuente) d.porFuente = new Map();
    const clave = fuente || "?";
    d.porFuente.set(clave, (d.porFuente.get(clave) || 0) + v);
  }
}

function procesaSueno(tag) {
  const valor = atributo(tag, "value");
  const fase = FASES_SUENO[valor] || "dormido";
  const inicio = atributo(tag, "startDate");
  const fin = atributo(tag, "endDate");
  const ms = msDe(fin) - msDe(inicio);
  if (!(ms > 0)) return;
  const fecha = fechaDe(inicio);
  // La noche se etiqueta con el día en que uno se despierta: lo que empieza
  // después de mediodía cuenta para el día siguiente.
  const noche = horaDe(inicio) >= 12 ? diaSiguiente(fecha) : fecha;
  if (!fechaCreible(noche)) return;
  const fuente = atributo(tag, "sourceName") || "?";
  anotaFuente(fuente);
  if (noche < fechaMin) fechaMin = noche;
  if (noche > fechaMax) fechaMax = noche;

  let porFuente = sueno.get(noche);
  if (!porFuente) {
    porFuente = new Map();
    sueno.set(noche, porFuente);
  }
  let f = porFuente.get(fuente);
  if (!f) {
    f = { enCama: 0, dormido: 0, ligero: 0, profundo: 0, rem: 0, despierto: 0, inicio: null, fin: null };
    porFuente.set(fuente, f);
  }
  f[fase] += ms / 1000;
  if (fase !== "despierto" && fase !== "enCama") {
    if (!f.inicio || inicio < f.inicio) f.inicio = inicio.slice(0, 16);
    if (!f.fin || fin > f.fin) f.fin = fin.slice(0, 16);
  }
}

// Tomas de medicamentos y suplementos (la función Medicamentos de iOS 16+).
// El nombre viaja en un MetadataEntry; el formato exacto varía con la versión
// de iOS, así que se busca con manga ancha cualquier clave que suene a nombre.
function procesaMedicacion(tag, cuerpo) {
  const inicio = atributo(tag, "startDate");
  const fecha = fechaDe(inicio);
  if (!fechaCreible(fecha)) return;
  let nombre = null;
  let omitida = false;
  for (const clave of ["medicationName", "name", "displayName", "nombre", "HKMedicationName", "value"]) {
    const v = atributo(tag, clave);
    if (v && !/^HK/.test(v) && !/^\d/.test(v)) {
      nombre = v;
      break;
    }
  }
  const estado = atributo(tag, "logStatus") || atributo(tag, "status") || "";
  if (/skip|omit|notTaken|snooze/i.test(estado)) return;
  if (cuerpo) {
    const re = /<MetadataEntry\s+key="([^"]*)"\s+value="([^"]*)"/g;
    let m;
    while ((m = re.exec(cuerpo))) {
      const clave = m[1],
        valor = m[2];
      if (/skip|omit|notTaken/i.test(valor)) omitida = true;
      if (!nombre && /name|nombre|display/i.test(clave) && valor && !/^HK/.test(valor)) nombre = valor;
    }
  }
  // El estado "no tomada" también puede venir como value="2" del propio Record
  // (HKMedicationDoseEventLogStatus): sin certeza, se cuenta solo lo tomado.
  if (omitida) return;
  if (!nombre) nombre = "Medicación (sin nombre en el export)";
  nombre = desescapa(nombre);
  anotaFuente(atributo(tag, "sourceName"));
  if (fecha < fechaMin) fechaMin = fecha;
  if (fecha > fechaMax) fechaMax = fecha;
  let porDia = meds.get(nombre);
  if (!porDia) {
    porDia = new Map();
    meds.set(nombre, porDia);
  }
  porDia.set(fecha, (porDia.get(fecha) || 0) + 1);
}

function procesaMindful(tag) {
  const inicio = atributo(tag, "startDate");
  const fin = atributo(tag, "endDate");
  const min = (msDe(fin) - msDe(inicio)) / 60000;
  if (!(min > 0)) return;
  const fecha = fechaDe(inicio);
  let s = series.get("MindfulSession");
  if (!s) {
    s = { unidad: "min", dias: new Map() };
    series.set("MindfulSession", s);
  }
  let d = s.dias.get(fecha);
  if (!d) {
    d = { sum: 0, n: 0, min: Infinity, max: -Infinity, last: min, porFuente: null };
    s.dias.set(fecha, d);
  }
  d.sum += min;
  d.n++;
}

function procesaWorkout(apertura, cuerpo) {
  const tipo = atributo(apertura, "workoutActivityType") || "";
  const inicio = atributo(apertura, "startDate");
  const fin = atributo(apertura, "endDate");
  if (!inicio) return;
  nRegistros++;
  anotaFuente(atributo(apertura, "sourceName"));

  let dur = parseFloat(atributo(apertura, "duration"));
  const durU = atributo(apertura, "durationUnit");
  if (isFinite(dur)) {
    if (durU === "s" || durU === "sec") dur /= 60;
    else if (durU === "hr") dur *= 60;
  } else {
    dur = (msDe(fin) - msDe(inicio)) / 60000;
  }

  // Antes de iOS 16 la energía y la distancia venían como atributos; ahora
  // viajan en <WorkoutStatistics> dentro del elemento.
  let energia = parseFloat(atributo(apertura, "totalEnergyBurned"));
  let dist = parseFloat(atributo(apertura, "totalDistance"));
  if (isFinite(dist)) {
    const du = atributo(apertura, "totalDistanceUnit");
    if (du === "mi") dist *= 1.60934;
    else if (du === "m") dist /= 1000;
  }
  let fcMedia = NaN;
  let desde = 0;
  for (;;) {
    const i = cuerpo.indexOf("<WorkoutStatistics ", desde);
    if (i < 0) break;
    const j = cuerpo.indexOf(">", i);
    if (j < 0) break;
    const st = cuerpo.slice(i, j);
    desde = j;
    const t = atributo(st, "type") || "";
    if (t === "HKQuantityTypeIdentifierActiveEnergyBurned") {
      const v = parseFloat(atributo(st, "sum"));
      if (isFinite(v)) energia = atributo(st, "unit") === "kJ" ? v * 0.239006 : v;
    } else if (t.indexOf("Distance") >= 0) {
      let v = parseFloat(atributo(st, "sum"));
      if (isFinite(v)) {
        const u = atributo(st, "unit");
        if (u === "mi") v *= 1.60934;
        else if (u === "m") v /= 1000;
        dist = isFinite(dist) ? dist + v : v;
      }
    } else if (t === "HKQuantityTypeIdentifierHeartRate") {
      const v = parseFloat(atributo(st, "average"));
      if (isFinite(v)) fcMedia = v;
    }
  }

  const fecha = fechaDe(inicio);
  if (!fechaCreible(fecha)) return;
  if (fecha < fechaMin) fechaMin = fecha;
  if (fecha > fechaMax) fechaMax = fecha;
  entrenos.push({
    tipo: tipo.replace("HKWorkoutActivityType", ""),
    fecha,
    hora: inicio.slice(11, 16),
    inicio,
    fin,
    dur: Math.round(dur * 10) / 10,
    energia: isFinite(energia) ? Math.round(energia) : null,
    dist: isFinite(dist) ? Math.round(dist * 100) / 100 : null,
    fc: isFinite(fcMedia) ? Math.round(fcMedia) : null,
  });
}

// ---------- Recorrido del texto ----------
// Mantiene un resto entre trozos y extrae los elementos completos.
let resto = "";

function procesaTexto(trozo, final) {
  let t = resto + trozo;
  let pos = 0;
  const n = t.length;
  for (;;) {
    const i = t.indexOf("<", pos);
    if (i < 0) {
      pos = n;
      break;
    }
    // ¿Qué elemento empieza aquí?
    if (t.startsWith("<Record ", i)) {
      const cierre = t.indexOf(">", i);
      if (cierre < 0) break;
      let cuerpo = "";
      let finElem = cierre + 1;
      if (t[cierre - 1] !== "/") {
        // Con hijos (<MetadataEntry>…): saltar hasta </Record>
        const fin = t.indexOf("</Record>", cierre);
        if (fin < 0) break;
        cuerpo = t.slice(cierre + 1, fin);
        finElem = fin + 9;
      }
      procesaRecord(t.slice(i, cierre), cuerpo);
      pos = finElem;
    } else if (t.startsWith("<Workout ", i)) {
      const cierre = t.indexOf(">", i);
      if (cierre < 0) break;
      let cuerpo = "";
      let finElem = cierre + 1;
      if (t[cierre - 1] !== "/") {
        const fin = t.indexOf("</Workout>", cierre);
        if (fin < 0) break;
        cuerpo = t.slice(cierre + 1, fin);
        finElem = fin + 10;
      }
      procesaWorkout(t.slice(i, cierre), cuerpo);
      pos = finElem;
    } else if (t.startsWith("<Me ", i)) {
      const cierre = t.indexOf(">", i);
      if (cierre < 0) break;
      const tag = t.slice(i, cierre);
      perfil.nacimiento = atributo(tag, "HKCharacteristicTypeIdentifierDateOfBirth");
      perfil.sexo = atributo(tag, "HKCharacteristicTypeIdentifierBiologicalSex");
      pos = cierre + 1;
    } else {
      // Etiqueta cortada por el final del trozo: se deja para el siguiente,
      // empezando por su "<" (si no, el elemento se perdía entero).
      if (t.indexOf(">", i) < 0 && !final) {
        pos = i;
        break;
      }
      const m = /^<([A-Za-z][\w.:-]*)/.exec(t.slice(i, i + 80));
      if (m) {
        const nombre = m[1];
        inventarioElementos.set(nombre, (inventarioElementos.get(nombre) || 0) + 1);
        // La app de Medicamentos puede exportarse con su propio elemento
        // (cambia según la versión de iOS): se acepta cualquiera que suene a
        // medicación en vez de darlo por perdido.
        if (/medic/i.test(nombre)) {
          const cierre = t.indexOf(">", i);
          if (cierre < 0) break;
          let cuerpo = "";
          let finElem = cierre + 1;
          if (t[cierre - 1] !== "/") {
            const etiquetaFin = "</" + nombre + ">";
            const fin = t.indexOf(etiquetaFin, cierre);
            if (fin < 0) break;
            cuerpo = t.slice(cierre + 1, fin);
            finElem = fin + etiquetaFin.length;
          }
          nRegistros++;
          procesaMedicacion(t.slice(i, cierre), cuerpo);
          pos = finElem;
          continue;
        }
      }
      // Elemento que no interesa: saltar al siguiente "<"
      pos = i + 1;
    }
  }
  resto = final ? "" : t.slice(Math.max(pos, n - 2_000_000));
  if (resto.length > 8_000_000) resto = resto.slice(-2_000_000); // válvula de seguridad
}

// ---------- Perfil de esfuerzo de cada entrenamiento ----------
// El pulso llega como miles de registros sueltos repartidos por el día. Para
// saber si una sesión fue continua o por intervalos hay que reconstruir la
// curva de pulso DENTRO de cada entreno, así que se van guardando los latidos
// en casillas de 30 segundos (mucho más ligero que guardar cada muestra) y al
// terminar de leer el archivo se recorta la parte que cae en cada sesión.

const TOPE_CASILLAS = 3_000_000; // válvula de seguridad para exports enormes

// La musculación sube y baja el pulso entre series, así que por la curva
// parecería cardio por intervalos. No lo es: va en su propia categoría, igual
// que el trabajo de movilidad.
const TIPOS_MUSCULACION = ["TraditionalStrengthTraining", "FunctionalStrengthTraining", "CoreTraining"];
const TIPOS_MOVILIDAD = ["Yoga", "Pilates", "MindAndBody", "Flexibility", "Cooldown", "PreparationAndRecovery", "Barre", "TaiChi"];

// Clave entera y creciente a partir de la hora local: "2026-08-22 07:31:05".
function casillaDe(s) {
  if (!s) return NaN;
  const y = +s.slice(0, 4),
    mo = +s.slice(5, 7),
    d = +s.slice(8, 10),
    h = +s.slice(11, 13),
    mi = +s.slice(14, 16),
    se = +s.slice(17, 19);
  if (!isFinite(y) || !isFinite(mi)) return NaN;
  return ((((y * 12 + mo) * 32 + d) * 24 + h) * 60 + mi) * 2 + (se >= 30 ? 1 : 0);
}

function anotaPulso(inicio, valor) {
  const k = casillaDe(inicio);
  if (!isFinite(k)) return;
  const c = pulso.get(k);
  if (c) {
    if (valor < c[0]) c[0] = valor;
    if (valor > c[1]) c[1] = valor;
    c[2] += valor;
    c[3]++;
  } else {
    if (pulso.size >= TOPE_CASILLAS) {
      pulsoRecortado = true;
      return;
    }
    pulso.set(k, [valor, valor, valor, 1]);
  }
}

// Media móvil corta: quita el ruido latido a latido sin borrar los picos.
function suaviza(v, n) {
  const out = [];
  for (let i = 0; i < v.length; i++) {
    let s = 0,
      c = 0;
    for (let j = Math.max(0, i - n); j <= Math.min(v.length - 1, i + n); j++) {
      s += v[j];
      c++;
    }
    out.push(s / c);
  }
  return out;
}

function percentil(orden, p) {
  if (!orden.length) return null;
  const i = Math.min(orden.length - 1, Math.max(0, Math.round((orden.length - 1) * p)));
  return orden[i];
}

// Cuenta subidas y bajadas de verdad: cada vez que el pulso sube por encima
// de un umbral alto y luego baja por debajo de uno bajo, es una repetición.
function cuentaOscilaciones(v, alto, bajo) {
  let n = 0,
    estado = v[0] >= alto ? "arriba" : "abajo";
  for (const x of v) {
    if (estado === "abajo" && x >= alto) {
      estado = "arriba";
      n++;
    } else if (estado === "arriba" && x <= bajo) {
      estado = "abajo";
    }
  }
  return n;
}

// Recorta la curva a 40 puntos para poder dibujarla sin engordar el guardado.
function comprimeCurva(v, n) {
  if (v.length <= n) return v.map((x) => Math.round(x));
  const out = [];
  const tam = v.length / n;
  for (let i = 0; i < n; i++) {
    const trozo = v.slice(Math.floor(i * tam), Math.floor((i + 1) * tam));
    out.push(Math.round(trozo.reduce((a, b) => a + b, 0) / trozo.length));
  }
  return out;
}

// Calcula el perfil de cada entreno con las casillas de pulso ya recogidas.
function perfilaEntrenos() {
  for (const e of entrenos) {
    if (TIPOS_MUSCULACION.includes(e.tipo)) e.perfil = "musculacion";
    else if (TIPOS_MOVILIDAD.includes(e.tipo)) e.perfil = "movilidad";
  }
  if (!pulso.size || !entrenos.length) return null;
  const claves = [...pulso.keys()].sort((a, b) => a - b);

  // Pulso máximo de referencia: el más alto que se repite de verdad (el
  // percentil 99,5 de las casillas), no un pico suelto de una lectura mala.
  const maximos = claves.map((k) => pulso.get(k)[1]).sort((a, b) => a - b);
  const fcMaxRef = percentil(maximos, 0.995) || 0;

  const busca = (k) => {
    let lo = 0,
      hi = claves.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (claves[m] < k) lo = m + 1;
      else hi = m;
    }
    return lo;
  };

  for (const e of entrenos) {
    const k0 = casillaDe(e.inicio),
      k1 = casillaDe(e.fin);
    if (!isFinite(k0) || !isFinite(k1)) continue;
    const desde = busca(k0),
      hasta = busca(k1 + 1);
    const medias = [];
    let min = Infinity,
      max = -Infinity;
    for (let i = desde; i < hasta; i++) {
      const c = pulso.get(claves[i]);
      medias.push(c[2] / c[3]);
      if (c[0] < min) min = c[0];
      if (c[1] > max) max = c[1];
    }
    // Con menos de tres minutos de pulso no se puede afirmar nada.
    if (medias.length < 6) {
      e.perfil = TIPOS_MUSCULACION.includes(e.tipo) ? "musculacion" : TIPOS_MOVILIDAD.includes(e.tipo) ? "movilidad" : "sinPulso";
      continue;
    }

    const suave = suaviza(medias, 1); // ventana de 90 s
    const orden = [...suave].sort((a, b) => a - b);
    const p10 = percentil(orden, 0.1),
      p90 = percentil(orden, 0.9);
    const amplitud = p90 - p10;
    const mediaFC = suave.reduce((a, b) => a + b, 0) / suave.length;
    // Umbrales sacados de la propia sesión: se cuenta una repetición cuando
    // el pulso sube a la zona alta de SU rango y luego vuelve a la baja.
    // Para contar una repetición hace falta un vaivén de verdad (al menos
    // una docena de pulsaciones), no el temblor normal de un ritmo sostenido.
    const alto = p10 + Math.max(12, amplitud * 0.6),
      bajo = p10 + Math.max(6, amplitud * 0.3);
    const oscilaciones = amplitud >= 15 ? cuentaOscilaciones(suave, alto, bajo) : 0;
    const pctMax = fcMaxRef ? (mediaFC / fcMaxRef) * 100 : null;

    let perfil;
    if (TIPOS_MUSCULACION.includes(e.tipo)) perfil = "musculacion";
    else if (TIPOS_MOVILIDAD.includes(e.tipo)) perfil = "movilidad";
    else if (oscilaciones >= 3 && amplitud >= 15) perfil = "intervalos";
    else if (e.tipo === "HighIntensityIntervalTraining" && amplitud >= 12) perfil = "intervalos";
    else if (amplitud >= 25 && oscilaciones >= 2) perfil = "intervalos";
    else if (pctMax != null && pctMax >= 78) perfil = "continuoFuerte";
    else perfil = "continuoSuave";

    e.perfil = perfil;
    e.fcMin = Math.round(min);
    e.fcMax = Math.round(max);
    e.fcAmplitud = Math.round(amplitud);
    e.oscilaciones = oscilaciones;
    e.pctMax = pctMax != null ? Math.round(pctMax) : null;
    e.curva = comprimeCurva(suave, 40);
    if (!e.fc) e.fc = Math.round(mediaFC);
  }
  return { fcMaxRef: Math.round(fcMaxRef), recortado: pulsoRecortado };
}

// ---------- Resultado ----------
function resultado() {
  const seriesOut = {};
  for (const [tipo, s] of series) {
    const def = TIPOS[tipo];
    const agg = def ? def.agg : "media";
    const dias = {};
    for (const [fecha, d] of s.dias) {
      let v;
      if (agg === "suma") {
        if (d.porFuente && d.porFuente.size > 1) {
          v = 0;
          for (const x of d.porFuente.values()) if (x > v) v = x;
        } else v = d.sum;
      } else if (agg === "ultimo") v = d.last;
      else v = d.sum / d.n;
      dias[fecha] = Math.round(v * 100) / 100;
    }
    const nombre = def
      ? def.n
      : tipo
          .replace(/^HK(Quantity|Category)TypeIdentifier/, "")
          .replace(/([a-z])([A-Z])/g, "$1 $2");
    seriesOut[tipo] = { nombre, unidad: def ? def.u : s.unidad, agg, dias };
    if (def && def.extremos) {
      const diasMin = {},
        diasMax = {};
      for (const [fecha, d] of s.dias) {
        diasMin[fecha] = Math.round(d.min);
        diasMax[fecha] = Math.round(d.max);
      }
      seriesOut[tipo].min = diasMin;
      seriesOut[tipo].max = diasMax;
    }
  }

  // Sueño: por noche, la fuente que más sueño registró (el Watch gana al
  // iPhone; sumar fuentes duplicaría las horas).
  const suenoOut = {};
  for (const [noche, porFuente] of sueno) {
    let mejor = null,
      mejorTotal = -1;
    for (const f of porFuente.values()) {
      const total = f.profundo + f.ligero + f.rem + f.dormido;
      if (total > mejorTotal) {
        mejorTotal = total;
        mejor = f;
      }
    }
    if (!mejor || mejorTotal <= 0) continue;
    const conFases = mejor.profundo + mejor.ligero + mejor.rem > 0;
    suenoOut[noche] = {
      dormido: Math.round(conFases ? mejor.profundo + mejor.ligero + mejor.rem : mejor.dormido),
      profundo: Math.round(mejor.profundo),
      ligero: Math.round(mejor.ligero),
      rem: Math.round(mejor.rem),
      despierto: Math.round(mejor.despierto),
      enCama: Math.round(Math.max(...[...porFuente.values()].map((f) => f.enCama))),
      inicio: mejor.inicio,
      fin: mejor.fin,
    };
  }

  const pulsoInfo = perfilaEntrenos();
  pulso = new Map(); // ya no hace falta: fuera de memoria
  entrenos.sort((a, b) => (a.fecha + a.hora < b.fecha + b.hora ? -1 : 1));

  // Medicación: se guarda todo lo anotado; ya avisa la tarjeta cuando hay
  // tan pocas tomas que no da para comparar nada.
  const medsOut = {};
  for (const [nombre, porDia] of meds) {
    const dias = {};
    for (const [f, n] of porDia) dias[f] = n;
    medsOut[nombre] = { dias, total: [...porDia.values()].reduce((a, b) => a + b, 0) };
  }

  return {
    meds: medsOut,
    meta: {
      nacimiento: perfil.nacimiento || null,
      sexo: perfil.sexo || null,
      fechaMin: fechaMin === "9999" ? null : fechaMin,
      fechaMax: fechaMax === "0000" ? null : fechaMax,
      nRegistros,
      fuentes: [...fuentes.entries()].sort((a, b) => b[1] - a[1]),
      descartadas: { futuro: descartadasFuturo, antiguas: descartadasAntiguas },
      fcMaxRef: pulsoInfo ? pulsoInfo.fcMaxRef : null,
      pulsoRecortado: pulsoInfo ? pulsoInfo.recortado : false,
      inventario: {
        tipos: [...inventarioTipos.entries()].sort((a, b) => b[1] - a[1]),
        elementos: [...inventarioElementos.entries()].sort((a, b) => b[1] - a[1]),
      },
      generado: Date.now(),
    },
    series: seriesOut,
    sueno: suenoOut,
    entrenos,
  };
}

// ---------- Lectura del ZIP (mínima, con DecompressionStream) ----------
async function trozoDe(file, ini, len) {
  return new Uint8Array(await file.slice(ini, ini + len).arrayBuffer());
}
const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u64 = (b, i) => u32(b, i) + u32(b, i + 4) * 4294967296;

async function entradasZip(file) {
  // Fin de directorio central: firma 0x06054b50 en los últimos 64 KB.
  const cola = await trozoDe(file, Math.max(0, file.size - 66000), Math.min(file.size, 66000));
  let eocd = -1;
  for (let i = cola.length - 22; i >= 0; i--) {
    if (cola[i] === 0x50 && cola[i + 1] === 0x4b && cola[i + 2] === 0x05 && cola[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("No parece un archivo ZIP válido.");
  let nEntradas = u16(cola, eocd + 10);
  let dirTam = u32(cola, eocd + 12);
  let dirIni = u32(cola, eocd + 16);
  if (dirIni === 0xffffffff || nEntradas === 0xffff) {
    // ZIP64: el localizador está justo antes del EOCD.
    const loc = eocd - 20;
    if (loc >= 0 && u32(cola, loc) === 0x07064b50) {
      const eocd64Off = u64(cola, loc + 8);
      const b = await trozoDe(file, eocd64Off, 56);
      if (u32(b, 0) === 0x06064b50) {
        nEntradas = u64(b, 32);
        dirTam = u64(b, 40);
        dirIni = u64(b, 48);
      }
    }
  }
  const dir = await trozoDe(file, dirIni, dirTam);
  const entradas = [];
  let p = 0;
  for (let k = 0; k < nEntradas && p + 46 <= dir.length; k++) {
    if (u32(dir, p) !== 0x02014b50) break;
    const metodo = u16(dir, p + 10);
    let compTam = u32(dir, p + 20);
    let tam = u32(dir, p + 24);
    const nombreLen = u16(dir, p + 28);
    const extraLen = u16(dir, p + 30);
    const comentLen = u16(dir, p + 32);
    let offset = u32(dir, p + 42);
    const nombre = dec.decode(dir.subarray(p + 46, p + 46 + nombreLen));
    // Campo extra ZIP64 cuando algún valor desborda.
    if (compTam === 0xffffffff || tam === 0xffffffff || offset === 0xffffffff) {
      let q = p + 46 + nombreLen;
      const finExtra = q + extraLen;
      while (q + 4 <= finExtra) {
        const id = u16(dir, q);
        const len = u16(dir, q + 2);
        if (id === 1) {
          let r = q + 4;
          if (tam === 0xffffffff) {
            tam = u64(dir, r);
            r += 8;
          }
          if (compTam === 0xffffffff) {
            compTam = u64(dir, r);
            r += 8;
          }
          if (offset === 0xffffffff) offset = u64(dir, r);
          break;
        }
        q += 4 + len;
      }
    }
    entradas.push({ nombre, metodo, compTam, tam, offset });
    p += 46 + nombreLen + extraLen + comentLen;
  }
  return entradas;
}

async function flujoDeEntrada(file, e) {
  // Cabecera local: el nombre y el extra locales pueden diferir en longitud.
  const cab = await trozoDe(file, e.offset, 30);
  if (u32(cab, 0) !== 0x04034b50) throw new Error("Entrada ZIP corrupta.");
  const ini = e.offset + 30 + u16(cab, 26) + u16(cab, 28);
  const bruto = file.slice(ini, ini + e.compTam).stream();
  if (e.metodo === 0) return bruto; // almacenado sin comprimir
  if (e.metodo === 8) {
    if (typeof DecompressionStream === "undefined")
      throw new Error("Tu navegador no puede descomprimir el ZIP. Descomprímelo tú y carga el archivo export.xml.");
    return bruto.pipeThrough(new DecompressionStream("deflate-raw"));
  }
  throw new Error("Método de compresión no soportado. Descomprime el ZIP y carga el XML.");
}

// ---------- Bucle principal ----------
async function analiza(file) {
  reinicia();
  resto = "";

  let flujo;
  const esZip = /\.zip$/i.test(file.name) || (await trozoDe(file, 0, 4)).join(",") === "80,75,3,4";
  if (esZip) {
    const entradas = await entradasZip(file);
    // El XML de datos es la entrada .xml más grande que no sea el CDA clínico.
    const candidatas = entradas.filter(
      (e) => /\.xml$/i.test(e.nombre) && !/cda/i.test(e.nombre) && e.compTam > 0
    );
    if (!candidatas.length) throw new Error("El ZIP no contiene el XML de Apple Salud (export.xml).");
    candidatas.sort((a, b) => b.compTam - a.compTam);
    const entrada = candidatas[0];
    flujo = await flujoDeEntrada(file, entrada);
    // El progreso se mide sobre el tamaño comprimido: se estima con la
    // proporción descomprimida si se conoce.
    entradaTam = entrada.tam || entrada.compTam * 8;
  } else {
    flujo = file.stream();
    entradaTam = file.size;
  }

  const lector = flujo.getReader();
  let leidos = 0;
  let ultimoAviso = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    leidos += value.byteLength;
    procesaTexto(dec.decode(value, { stream: true }), false);
    if (leidos - ultimoAviso > 8_000_000) {
      ultimoAviso = leidos;
      postMessage({ tipo: "progreso", pct: Math.min(99, Math.round((leidos / entradaTam) * 100)), registros: nRegistros });
    }
  }
  procesaTexto(dec.decode(), true);
  return resultado();
}

let entradaTam = 1;

onmessage = async (ev) => {
  try {
    const res = await analiza(ev.data.file);
    postMessage({ tipo: "listo", datos: res });
  } catch (err) {
    postMessage({ tipo: "error", mensaje: err && err.message ? err.message : String(err) });
  }
};
