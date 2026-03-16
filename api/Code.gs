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

// ============================================================
// PUNTO DE ENTRADA — GET Request
// ============================================================
function doGet(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    const ss = SpreadsheetApp.openById(SS_ID);
    const data = {
      proyectos:  getProyectos(ss),
      clientes:   getClientes(ss),
      pipeline:   getPipeline(ss),
      financiero: getFinanciero(ss),
      kpis:       calcularKPIs(ss),
      timestamp:  new Date().toLocaleString("es-CO")
    };
    output.setContent(JSON.stringify(data));
  } catch (err) {
    output.setContent(JSON.stringify({ error: err.message }));
  }

  return output;
}

// ============================================================
// PROYECTOS
// ============================================================
function getProyectos(ss) {
  const sheet = ss.getSheetByName(SHEETS.PROYECTOS);
  const rows  = sheet.getRange("A3:K30").getValues().filter(r => r[0] !== "");
  return rows.map(r => ({
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

// ============================================================
// CLIENTES
// ============================================================
function getClientes(ss) {
  const sheet = ss.getSheetByName(SHEETS.CLIENTES);
  const rows  = sheet.getRange("A3:L200").getValues().filter(r => r[0] !== "");
  return rows.map(r => ({
    id:              r[0],
    nombre:          r[1],
    telefono:        r[2],
    email:           r[3],
    ciudad:          r[4],
    proyectoInteres: r[5],
    fuente:          r[6],
    asesor:          r[7],
    estado:          r[8],
    fechaContacto:   r[9] ? new Date(r[9]).toLocaleDateString("es-CO") : "",
    fechaSeguimiento:r[10] ? new Date(r[10]).toLocaleDateString("es-CO") : "",
    observaciones:   r[11]
  }));
}

// ============================================================
// PIPELINE
// ============================================================
function getPipeline(ss) {
  const sheet = ss.getSheetByName(SHEETS.PIPELINE);
  const rows  = sheet.getRange("A3:L200").getValues().filter(r => r[0] !== "");
  return rows.map(r => ({
    id:           r[0],
    cliente:      r[1],
    proyecto:     r[2],
    unidad:       r[3],
    asesor:       r[4],
    etapa:        r[5],
    valor:        r[6],
    probabilidad: r[7],
    fechaApertura:r[8] ? new Date(r[8]).toLocaleDateString("es-CO") : "",
    fechaCierre:  r[9] ? new Date(r[9]).toLocaleDateString("es-CO") : "",
    diasEtapa:    r[10],
    observacion:  r[11]
  }));
}

// ============================================================
// FINANCIERO
// ============================================================
function getFinanciero(ss) {
  const sheet = ss.getSheetByName(SHEETS.FINANCIERO);
  const rows  = sheet.getRange("A3:K200").getValues().filter(r => r[0] !== "");
  return rows.map(r => ({
    id:              r[0],
    cliente:         r[1],
    proyecto:        r[2],
    concepto:        r[3],
    valorTotal:      r[4],
    valorPagado:     r[5],
    valorPendiente:  r[6],
    pctAvance:       r[4] > 0 ? Math.round((r[5] / r[4]) * 100) : 0,
    fechaCompromiso: r[8] ? new Date(r[8]).toLocaleDateString("es-CO") : "",
    estadoPago:      r[9],
    asesor:          r[10]
  }));
}

// ============================================================
// KPIs CONSOLIDADOS
// ============================================================
function calcularKPIs(ss) {
  const proyectos  = getProyectos(ss);
  const clientes   = getClientes(ss);
  const pipeline   = getPipeline(ss);
  const financiero = getFinanciero(ss);

  // Proyectos
  const totalUnidades   = proyectos.reduce((s, r) => s + r.total, 0);
  const totalVendidas   = proyectos.reduce((s, r) => s + r.vendidas, 0);
  const totalReservadas = proyectos.reduce((s, r) => s + r.reservadas, 0);
  const totalDisponibles= proyectos.reduce((s, r) => s + r.disponibles, 0);

  // Clientes
  const totalLeads    = clientes.length;
  const leadsActivos  = clientes.filter(c => c.estado !== "Perdido").length;
  const leadsGanados  = clientes.filter(c => c.estado === "Ganado").length;
  const tasaConversion= totalLeads > 0 ? Math.round((leadsGanados / totalLeads) * 100) : 0;

  // Fuentes
  const fuenteMap = {};
  clientes.forEach(c => { fuenteMap[c.fuente] = (fuenteMap[c.fuente] || 0) + 1; });
  const porFuente = Object.entries(fuenteMap)
    .map(([fuente, count]) => ({ fuente, count, pct: Math.round(count / totalLeads * 100) }))
    .sort((a, b) => b.count - a.count);

  // Pipeline
  const etapas = ["Prospección","Contacto Inicial","Visita Inmueble",
                  "Propuesta Económica","Negociación","Cierre","Ganado","Perdido"];
  const porEtapa = etapas.map(e => ({
    etapa: e,
    count: pipeline.filter(p => p.etapa === e).length,
    valor: pipeline.filter(p => p.etapa === e).reduce((s, p) => s + p.valor, 0)
  }));
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
    .map(([nombre, d]) => ({ nombre, ...d }))
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