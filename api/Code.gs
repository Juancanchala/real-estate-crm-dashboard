// ============================================================
// CRM INMOBILIARIO — WEB APP API
// D'LOGIA | Expone datos del Sheets como JSON
// ID Spreadsheet: 15HKpbKzJ3XkEj6zPZZZDOsLFGpnQoyvOQV93UNQNFko
// ============================================================

const SS_ID = "15HKpbKzJ3XkEj6zPZZZDOsLFGpnQoyvOQV93UNQNFko";

const SHEETS = {
  PROYECTOS:  "🏠 Proyectos",
  CLIENTES:   "👥 Clientes",
  PIPELINE:   "📋 Pipeline Comercial",
  FINANCIERO: "💰 Financiero",
};

// Hojas de resumen: cada una es UNA fórmula QUERY sobre los datos, así que se
// recalculan solas cuando cambia un negocio, un cliente o un pago.
const RESUMENES = {
  VENTAS: {
    hoja: "📊 Resumen Ventas",
    titulo: "RESUMEN DE VENTAS — negocios ganados por mes, proyecto y asesor (fórmula, no editar)",
    rango: `'${SHEETS.PIPELINE}'!A3:L`,
    consulta: "select year(J), month(J)+1, C, E, count(A), sum(G) where F = 'Ganado' and J is not null group by year(J), month(J)+1, C, E order by year(J), month(J)+1, C, E label year(J) 'Año', month(J)+1 'Mes', C 'Proyecto', E 'Asesor', count(A) 'Ventas', sum(G) 'Valor'"
  },
  EMBUDO: {
    hoja: "📊 Resumen Embudo",
    titulo: "RESUMEN DEL PROCESO DE VENTA — negocios por proyecto y etapa (fórmula, no editar)",
    rango: `'${SHEETS.PIPELINE}'!A3:L`,
    consulta: "select C, F, count(A), sum(G), avg(K) where A is not null group by C, F label C 'Proyecto', F 'Etapa', count(A) 'Negocios', sum(G) 'Valor', avg(K) 'DiasPromedio'"
  },
  CARTERA: {
    hoja: "📊 Resumen Cartera",
    titulo: "RESUMEN DE CARTERA — por estado, proyecto y concepto (fórmula, no editar)",
    rango: `'${SHEETS.FINANCIERO}'!A3:K`,
    consulta: "select J, C, D, count(A), sum(E), sum(F), sum(G) where A is not null group by J, C, D label J 'Estado', C 'Proyecto', D 'Concepto', count(A) 'Pagos', sum(E) 'ValorTotal', sum(F) 'Pagado', sum(G) 'Pendiente'"
  },
  PROSPECTOS: {
    hoja: "📊 Resumen Prospectos",
    titulo: "RESUMEN DE PROSPECTOS — por fuente y estado (fórmula, no editar)",
    rango: `'${SHEETS.CLIENTES}'!A3:L`,
    consulta: "select G, count(A) where A is not null group by G pivot I label G 'Fuente'"
  },
};

// ============================================================
// PUNTO DE ENTRADA — GET Request
// ============================================================
function doGet(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    // ?fresh=1 ignora la caché (botón "Actualizar")
    const fresco = e && e.parameter && e.parameter.fresh;
    let json = fresco ? null : leerCache();
    if (!json) {
      const ss = SpreadsheetApp.openById(SS_ID);
      // Cada hoja se lee una sola vez; los KPIs se calculan sobre lo ya leído
      const data = {
        proyectos:  getProyectos(ss),
        clientes:   getClientes(ss),
        pipeline:   getPipeline(ss),
        financiero: getFinanciero(ss),
      };
      data.kpis = calcularKPIs(data);
      data.resumen = getResumenes(ss);
      data.timestamp = new Date().toLocaleString("es-CO");
      json = JSON.stringify(data);
      guardarCache(json);
    }
    output.setContent(json);
  } catch (err) {
    output.setContent(JSON.stringify({ error: err.message }));
  }

  return output;
}

// ============================================================
// CACHÉ — armar la respuesta toma varios segundos con miles de filas.
// Se guarda comprimida por 5 min y se borra con cada escritura (doPost).
// CacheService admite máx. 100 KB por clave, por eso va en trozos.
// ============================================================
const CACHE_SEG = 300;
const CACHE_TROZO = 90000;

function guardarCache(json) {
  try {
    const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json, "application/json")).getBytes());
    const trozos = {};
    let n = 0;
    for (let i = 0; i < b64.length; i += CACHE_TROZO) trozos["api_" + n++] = b64.slice(i, i + CACHE_TROZO);
    trozos.api_n = String(n);
    CacheService.getScriptCache().putAll(trozos, CACHE_SEG);
  } catch (err) { /* sin caché la API sigue funcionando */ }
}

function leerCache() {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get("api_n"));
    if (!n) return null;
    const claves = Array.from({ length: n }, (_, i) => "api_" + i);
    const t = cache.getAll(claves);
    if (claves.some(k => !t[k])) return null;
    const bytes = Utilities.base64Decode(claves.map(k => t[k]).join(""));
    return Utilities.ungzip(Utilities.newBlob(bytes, "application/x-gzip")).getDataAsString();
  } catch (err) { return null; }
}

function borrarCache() {
  try { CacheService.getScriptCache().remove("api_n"); } catch (err) {}
}

// ============================================================
// PUNTO DE ENTRADA — POST Request (escritura autenticada)
// Requiere que exista una Script Property "API_SECRET" configurada en
// Extensions > Apps Script > ⚙ Project Settings > Script Properties.
// Nunca pongas el valor del secreto directamente en este archivo.
// ============================================================
function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    const body = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty("API_SECRET");

    if (!secret) {
      throw new Error("API_SECRET no configurado en Script Properties");
    }
    if (body.token !== secret) {
      output.setContent(JSON.stringify({ error: "No autorizado" }));
      return output;
    }

    const ss = SpreadsheetApp.openById(SS_ID);
    let result;

    if (body.action === "appendRows") {
      result = appendRows(ss, body.sheet, body.rows);
    } else if (body.action === "replaceRows") {
      result = replaceRows(ss, body.sheet, body.rows);
    } else if (body.action === "updateCells") {
      result = updateCells(ss, body.sheet, body.updates);
    } else if (body.action === "crearResumenes") {
      result = crearResumenes(ss);
    } else {
      throw new Error("Acción no reconocida: " + body.action);
    }

    borrarCache(); // la próxima lectura trae los datos nuevos
    output.setContent(JSON.stringify({ ok: true, result }));
  } catch (err) {
    output.setContent(JSON.stringify({ error: err.message }));
  }

  return output;
}

// Convierte strings "YYYY-MM-DD" a Date real; deja el resto igual.
// Al mediodía y no a medianoche: si la zona horaria del script y la del Sheets
// difieren unas horas, a medianoche la celda quedaría con el día anterior.
function coerceValue(v) {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return new Date(v + "T12:00:00");
  }
  return v;
}

// Agrega filas al final de los datos existentes de una hoja.
// body: { action:"appendRows", sheet:"PIPELINE", rows:[[...],[...]] }
function appendRows(ss, sheetKey, rows) {
  const sheet = ss.getSheetByName(SHEETS[sheetKey]);
  if (!sheet) throw new Error("Hoja no encontrada: " + sheetKey);
  if (!rows || !rows.length) throw new Error("rows vacío");

  const startRow = sheet.getLastRow() + 1;
  const coerced = rows.map(row => row.map(coerceValue));
  sheet.getRange(startRow, 1, coerced.length, coerced[0].length).setValues(coerced);
  return { sheet: sheetKey, startRow, count: coerced.length };
}

// Borra todos los datos existentes desde la fila 3 en adelante y escribe
// las filas nuevas en su lugar (resincroniza la hoja completa).
// body: { action:"replaceRows", sheet:"PIPELINE", rows:[[...],[...]] }
function replaceRows(ss, sheetKey, rows) {
  const sheet = ss.getSheetByName(SHEETS[sheetKey]);
  if (!sheet) throw new Error("Hoja no encontrada: " + sheetKey);
  if (!rows || !rows.length) throw new Error("rows vacío");

  const lastRow = sheet.getLastRow();
  if (lastRow >= 3) {
    sheet.getRange(3, 1, lastRow - 2, sheet.getLastColumn()).clearContent();
  }
  const coerced = rows.map(row => row.map(coerceValue));
  sheet.getRange(3, 1, coerced.length, coerced[0].length).setValues(coerced);
  return { sheet: sheetKey, count: coerced.length };
}

// Actualiza celdas puntuales de una hoja.
// body: { action:"updateCells", sheet:"PROYECTOS", updates:[{row:3,col:7,value:90}, ...] }
function updateCells(ss, sheetKey, updates) {
  const sheet = ss.getSheetByName(SHEETS[sheetKey]);
  if (!sheet) throw new Error("Hoja no encontrada: " + sheetKey);
  if (!updates || !updates.length) throw new Error("updates vacío");

  updates.forEach(u => sheet.getRange(u.row, u.col).setValue(coerceValue(u.value)));
  return { sheet: sheetKey, count: updates.length };
}

// Crea (o rehace) las hojas de resumen con su fórmula. Se puede repetir sin riesgo.
// body: { action:"crearResumenes" }
function crearResumenes(ss) {
  const sep = separadorFormulas(ss);
  return Object.values(RESUMENES).map(r => {
    const sheet = ss.getSheetByName(r.hoja) || ss.insertSheet(r.hoja);
    sheet.clear();
    sheet.getRange(1, 1).setValue(r.titulo).setFontWeight("bold");
    sheet.getRange(2, 1).setFormula(`=QUERY(${r.rango}${sep}"${r.consulta}"${sep}0)`);
    sheet.getRange(2, 1, 1, 10).setFontWeight("bold");
    sheet.setFrozenRows(2);
    // Aviso al editar a mano: el contenido sale de la fórmula
    sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
    sheet.protect().setDescription("Resumen automático (fórmula)").setWarningOnly(true);
    return r.hoja;
  });
}

// Con configuración regional de coma decimal (ej. Colombia) los argumentos de
// las fórmulas se separan con ";" y con "," dan #ERROR!. Se prueba en una celda libre.
function separadorFormulas(ss) {
  const hoja = ss.getSheetByName(SHEETS.PROYECTOS);
  const celda = hoja.getRange(1, hoja.getMaxColumns());
  const previo = celda.getFormula() || celda.getValue();
  celda.setFormula("=SUM(1,2)");
  SpreadsheetApp.flush();
  const sep = celda.getDisplayValue() === "3" ? "," : ";";
  celda.setValue(previo);
  return sep;
}

// ============================================================
// LECTURA
// ============================================================
// Filas de datos desde la fila 3 hasta la última con contenido (sin límite fijo)
function leerFilas(ss, nombreHoja, columnas) {
  const sheet = ss.getSheetByName(nombreHoja);
  const ultima = sheet.getLastRow();
  if (ultima < 3) return [];
  return sheet.getRange(3, 1, ultima - 2, columnas).getValues().filter(r => r[0] !== "");
}

// Mismo formato que toLocaleDateString("es-CO") ("5/1/2025"), pero mucho más rápido
function fecha(v) {
  return v instanceof Date ? `${v.getDate()}/${v.getMonth() + 1}/${v.getFullYear()}` : (v || "");
}

function getProyectos(ss) {
  return leerFilas(ss, SHEETS.PROYECTOS, 11).map(r => ({
    id:          r[0],
    nombre:      r[1],
    tipo:        r[2],
    ciudad:      r[3],
    sector:      r[4],
    total:       r[5],
    vendidas:    r[6],
    reservadas:  r[7],
    disponibles: r[8],
    precioM2:    r[9],
    estado:      r[10],
    pctVendido:  r[5] > 0 ? Math.round((r[6] / r[5]) * 100) : 0
  }));
}

// Teléfono, email y observaciones se quedan en la hoja: la app no los usa y
// con miles de prospectos son la mayor parte del peso de la respuesta.
function getClientes(ss) {
  return leerFilas(ss, SHEETS.CLIENTES, 11).map(r => ({
    id:              r[0],
    nombre:          r[1],
    ciudad:          r[4],
    proyectoInteres: r[5],
    fuente:          r[6],
    asesor:          r[7],
    estado:          r[8],
    fechaContacto:   fecha(r[9]),
    fechaSeguimiento:fecha(r[10])
  }));
}

function getPipeline(ss) {
  return leerFilas(ss, SHEETS.PIPELINE, 12).map(r => ({
    id:           r[0],
    cliente:      r[1],
    proyecto:     r[2],
    unidad:       r[3],
    asesor:       r[4],
    etapa:        r[5],
    valor:        r[6],
    probabilidad: r[7],
    fechaApertura:fecha(r[8]),
    fechaCierre:  fecha(r[9]),
    diasEtapa:    r[10],
    observacion:  r[11]
  }));
}

function getFinanciero(ss) {
  return leerFilas(ss, SHEETS.FINANCIERO, 11).map(r => ({
    id:              r[0],
    cliente:         r[1],
    proyecto:        r[2],
    concepto:        r[3],
    valorTotal:      r[4],
    valorPagado:     r[5],
    valorPendiente:  r[6],
    pctAvance:       r[4] > 0 ? Math.round((r[5] / r[4]) * 100) : 0,
    fechaCompromiso: fecha(r[8]),
    estadoPago:      r[9],
    asesor:          r[10]
  }));
}

// Cada resumen como lista de objetos con los encabezados de la fila 2
function getResumenes(ss) {
  const out = {};
  Object.entries(RESUMENES).forEach(([clave, r]) => {
    const sheet = ss.getSheetByName(r.hoja);
    if (!sheet || sheet.getLastRow() < 3) { out[clave.toLowerCase()] = []; return; }
    const valores = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    const enc = valores[0];
    out[clave.toLowerCase()] = valores.slice(1).filter(f => f[0] !== "").map(f => {
      const o = {};
      enc.forEach((h, i) => { if (h !== "") o[h] = f[i] === "" ? 0 : f[i]; });
      return o;
    });
  });
  return out;
}

// ============================================================
// KPIs CONSOLIDADOS (sobre los datos ya leídos en doGet)
// ============================================================
function calcularKPIs(d) {
  const { proyectos, clientes, pipeline, financiero } = d;

  // Proyectos
  const totalUnidades   = proyectos.reduce((s, r) => s + r.total, 0);
  const totalVendidas   = proyectos.reduce((s, r) => s + r.vendidas, 0);
  const totalReservadas = proyectos.reduce((s, r) => s + r.reservadas, 0);
  const totalDisponibles= proyectos.reduce((s, r) => s + r.disponibles, 0);

  // Clientes: "activo" = todavía en proceso (ni compró ni se descartó)
  const totalLeads    = clientes.length;
  const leadsActivos  = clientes.filter(c => c.estado !== "Perdido" && c.estado !== "Ganado").length;
  const leadsGanados  = clientes.filter(c => c.estado === "Ganado").length;
  const tasaConversion= totalLeads > 0 ? Math.round((leadsGanados / totalLeads) * 100) : 0;

  // Fuentes
  const fuenteMap = {};
  clientes.forEach(c => { fuenteMap[c.fuente] = (fuenteMap[c.fuente] || 0) + 1; });
  const porFuente = Object.entries(fuenteMap)
    .map(([fuente, count]) => ({ fuente, count, pct: Math.round(count / totalLeads * 100) }))
    .sort((a, b) => b.count - a.count);

  // Proceso de venta
  const etapas = ["Prospección","Contacto Inicial","Visita Inmueble",
                  "Propuesta Económica","Negociación","Cierre","Ganado","Perdido"];
  const porEtapa = etapas.map(e => {
    const items = pipeline.filter(p => p.etapa === e);
    return { etapa: e, count: items.length, valor: items.reduce((s, p) => s + p.valor, 0) };
  });
  const valorPipelineTotal = pipeline.reduce((s, p) => s + p.valor, 0);

  // Asesores
  const asesorMap = {};
  pipeline.forEach(p => {
    if (!asesorMap[p.asesor]) asesorMap[p.asesor] = { ganados: 0, total: 0, valor: 0 };
    asesorMap[p.asesor].total++;
    asesorMap[p.asesor].valor += p.valor;
    if (p.etapa === "Ganado") asesorMap[p.asesor].ganados++;
  });
  const topAsesores = Object.entries(asesorMap)
    .map(([nombre, x]) => ({ nombre, ...x }))
    .sort((a, b) => b.ganados - a.ganados);

  // Financiero
  const totalCobrado   = financiero.reduce((s, f) => s + f.valorPagado, 0);
  const totalPendiente = financiero.reduce((s, f) => s + f.valorPendiente, 0);
  const enMora         = financiero.filter(f => f.estadoPago === "En mora").length;

  return {
    totalUnidades, totalVendidas, totalReservadas, totalDisponibles,
    pctVendido: totalUnidades > 0 ? Math.round(totalVendidas / totalUnidades * 100) : 0,
    totalLeads, leadsActivos, leadsGanados, tasaConversion,
    valorPipelineTotal, porEtapa, topAsesores, porFuente,
    totalCobrado, totalPendiente, enMora
  };
}
