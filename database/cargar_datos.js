// Carga database/generado/*.json en el Google Sheets (reemplaza los datos de cada hoja)
// y crea las hojas de resumen. Requiere haber corrido antes: python database/generar_datos.py
// Uso: node database/cargar_datos.js                    (todas las hojas + resúmenes)
//      node database/cargar_datos.js PROYECTOS FINANCIERO   (solo esas hojas)
const fs = require('fs');
const path = require('path');

const API = 'https://script.google.com/macros/s/AKfycbzb5C8fJMdjWuVP89eyu4Sl0YSfotxvwhxoQwXEl3x28AYSYoAQG3mCAI9YxhjrRXW9Yw/exec';
const TOKEN = process.env.CRM_TOKEN || 'API_SECRET';
// Pipeline primero: las fórmulas de Proyectos cuentan sus negocios
const ORDEN = ['PIPELINE', 'PROYECTOS', 'CLIENTES', 'FINANCIERO'];

async function post(body) {
  // Apps Script responde 302; fetch sigue la redirección con GET y trae el JSON
  const res = await fetch(API, { method: 'POST', body: JSON.stringify({ token: TOKEN, ...body }) });
  const data = JSON.parse(await res.text());
  if (data.error) throw new Error(data.error);
  return data.result;
}

(async () => {
  const pedidas = process.argv.slice(2).map(s => s.toUpperCase());
  for (const hoja of ORDEN.filter(h => !pedidas.length || pedidas.includes(h))) {
    const filas = JSON.parse(fs.readFileSync(path.join(__dirname, 'generado', hoja.toLowerCase() + '.json'), 'utf8'));
    const t = Date.now();
    const r = await post({ action: 'replaceRows', sheet: hoja, rows: filas });
    console.log(`${hoja}: ${r.count} filas en ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  if (!pedidas.length) console.log('Resúmenes:', (await post({ action: 'crearResumenes' })).join(', '));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
