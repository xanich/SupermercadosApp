// Utilidades comunes del lector de precios. Sin dependencias (Node 18+).
//
// USO RESPONSABLE: este proyecto es personal. Se consulta como mucho una vez al dia,
// con pocas peticiones y una pausa entre ellas. No se evaden protecciones anti-bot:
// si una web responde 403/captcha, se anota el error y se deja el precio manual.

export const UA = 'AppSupermercados-personal/0.1 (uso personal, 1 consulta al dia)';
export const PAUSA_MS = 1500;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pedir(url, { json = false } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9', Accept: json ? 'application/json' : 'text/html' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return json ? res.json() : res.text();
}

/** Lee "400 g", "1,5 litros", "pack 2x125 g"... y devuelve {cantidad, unidad:'kg'|'l'|null}. */
export function parseTamano(nombre) {
  const t = nombre.toLowerCase().replace(',', '.');
  const m = t.match(/(?:(\d+)\s*x\s*)?(\d+(?:\.\d+)?)\s*(kg|g|gr|litros?|l|ml|cl)\b/);
  if (!m) return { cantidad: null, unidad: null };
  const n = m[1] ? Number(m[1]) : 1;
  let q = Number(m[2]) * n;
  let u = m[3];
  if (u === 'g' || u === 'gr') { q /= 1000; u = 'kg'; }
  else if (u === 'ml') { q /= 1000; u = 'l'; }
  else if (u === 'cl') { q /= 100; u = 'l'; }
  else if (u.startsWith('litro')) u = 'l';
  return { cantidad: q, unidad: u };
}

/** Precio por kg o por litro a partir del precio del envase y su nombre. */
export function precioUnidad(precio, nombre) {
  const { cantidad, unidad } = parseTamano(nombre);
  if (!cantidad) return { precio_unidad: null, unidad: null };
  return { precio_unidad: Math.round((precio / cantidad) * 100) / 100, unidad };
}

export function quitarDuplicados(lista) {
  const vistos = new Set();
  return lista.filter((p) => (vistos.has(p.ext_id) ? false : vistos.add(p.ext_id)));
}
