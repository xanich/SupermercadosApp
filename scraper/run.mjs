// Uso:
//   node scraper/run.mjs candidatos   -> busca cada ingrediente en BM y Eroski y guarda data/candidatos.json
//                                        (para elegir una vez que producto concreto compras)
//   node scraper/run.mjs actualizar   -> refresca en Supabase el precio de los productos ya elegidos
//
// Variables de entorno:
//   OUT_DIR                      carpeta de salida de "candidatos" (por defecto ./data)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY   solo para "actualizar" (la clave service_role es SECRETA)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep, PAUSA_MS } from './lib.mjs';
import { buscarBM } from './bm.mjs';
import { buscarEroski } from './eroski.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUSCADORES = { bm: buscarBM, eroski: buscarEroski };

async function candidatos() {
  const ingredientes = JSON.parse(await readFile(join(RAIZ, 'data', 'ingredients.json'), 'utf8'));
  const salida = { generado: new Date().toISOString(), ingredientes: {} };
  for (const ing of ingredientes) {
    salida.ingredientes[ing.id] = {};
    for (const [tienda, buscar] of Object.entries(BUSCADORES)) {
      try {
        salida.ingredientes[ing.id][tienda] = await buscar(ing.consulta);
        console.log(`${ing.id} / ${tienda}: ${salida.ingredientes[ing.id][tienda].length} resultados`);
      } catch (e) {
        salida.ingredientes[ing.id][tienda] = [];
        console.warn(`${ing.id} / ${tienda}: ERROR ${e.message}`);
      }
      await sleep(PAUSA_MS);
    }
  }
  const dir = process.env.OUT_DIR || join(RAIZ, 'data');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'candidatos.json'), JSON.stringify(salida, null, 1), 'utf8');
  console.log('Guardado en', join(dir, 'candidatos.json'));
}

// ---------- actualizar (Supabase) ----------
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const sb = (ruta, opciones = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, {
    ...opciones,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...opciones.headers,
    },
  });

async function actualizar() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY');
  const res = await sb('elecciones?select=*&origen=eq.auto&tienda=in.(bm,eroski)', { headers: { Prefer: '' } });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const elecciones = await res.json();
  console.log(`${elecciones.length} productos automaticos que actualizar`);
  // Los ingredientes "al peso" guardan el precio en €/kg; el resto, el precio del envase.
  const rm = await sb('ingredientes?select=id,modo', { headers: { Prefer: '' } });
  const modos = rm.ok ? Object.fromEntries((await rm.json()).map((i) => [i.id, i.modo])) : {};
  let ok = 0;
  for (const e of elecciones) {
    try {
      // Se busca por el nombre guardado y se localiza el mismo producto por su id.
      const resultados = await BUSCADORES[e.tienda](e.nombre.replace(/\(.*?\)/g, '').trim(), 20);
      const nuevo = resultados.find((r) => r.ext_id === e.ext_id);
      if (!nuevo) throw new Error('producto no encontrado en la busqueda');
      const alPeso = modos[e.ingrediente_id] === 'peso';
      if (alPeso && !(nuevo.unidad === 'kg' && nuevo.precio_unidad != null)) throw new Error('el producto no tiene precio por kilo');
      const precio = alPeso ? nuevo.precio_unidad : nuevo.precio;
      const cambios = {
        precio,
        precio_unidad: nuevo.precio_unidad,
        unidad: nuevo.unidad,
        actualizado: new Date().toISOString(),
      };
      const r1 = await sb(`elecciones?id=eq.${e.id}`, { method: 'PATCH', body: JSON.stringify(cambios) });
      if (!r1.ok) throw new Error(`Supabase ${r1.status}: ${await r1.text()}`);
      await sb('historial', {
        method: 'POST',
        body: JSON.stringify({ ingrediente_id: e.ingrediente_id, tienda: e.tienda, precio, precio_unidad: nuevo.precio_unidad }),
      });
      ok++;
    } catch (err) {
      console.warn(`${e.ingrediente_id} / ${e.tienda}: ${err.message}`);
    }
    await sleep(PAUSA_MS);
  }
  console.log(`Actualizados ${ok} de ${elecciones.length}`);
}

// ---------- sembrar (Supabase, una sola vez) ----------
// Carga los 30 ingredientes y los precios del Excel como punto de partida (origen "excel").
// No pisa precios que ya existan.
async function sembrar() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY');
  const ings = JSON.parse(await readFile(join(RAIZ, 'data', 'ingredients.json'), 'utf8'));
  const enviar = async (ruta, filas, prefer) => {
    const r = await sb(ruta, { method: 'POST', headers: { Prefer: prefer }, body: JSON.stringify(filas) });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  };
  await enviar('ingredientes?on_conflict=id', ings.map(({ id, nombre, consulta, modo }) => ({ id, nombre, consulta, modo: modo || 'unidad' })), 'resolution=ignore-duplicates,return=minimal');
  const filas = ings.flatMap((i) =>
    Object.entries(i.precios_excel).filter(([, p]) => p != null)
      .map(([tienda, precio]) => ({ ingrediente_id: i.id, tienda, precio, origen: 'excel', actualizado: null })));
  await enviar('elecciones?on_conflict=ingrediente_id,tienda', filas, 'resolution=ignore-duplicates,return=minimal');
  console.log(`Cargados ${ings.length} ingredientes y ${filas.length} precios del Excel`);
}

const orden = process.argv[2];
if (orden === 'candidatos') await candidatos();
else if (orden === 'actualizar') await actualizar();
else if (orden === 'sembrar') await sembrar();
else console.log('Uso: node scraper/run.mjs candidatos | sembrar | actualizar');
