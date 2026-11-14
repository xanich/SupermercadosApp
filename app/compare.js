// Logica del comparador (sin dependencias del navegador, para poder probarla en Node).

export const TIENDAS = [
  { id: 'eroski', nombre: 'Eroski' },
  { id: 'bm', nombre: 'BM' },
  { id: 'dia', nombre: 'Dia' },
  { id: 'carrefour', nombre: 'Carrefour' },
  { id: 'halal', nombre: 'Halal' }, // carnicería cercana: solo para los ingredientes marcados como carne
];

export const nombreTienda = (id) => TIENDAS.find((t) => t.id === id)?.nombre ?? id;

/**
 * Tiendas donde se puede comprar un ingrediente, de entre las activas.
 * La carne no se compra en Dia (no tiene carnicería): allí va Halal, en el mismo sitio de la lista.
 * El resto de ingredientes nunca usa Halal.
 */
export function tiendasDe(ing, activas) {
  if (ing?.carne) return activas.filter((t) => t !== 'dia');
  return activas.filter((t) => t !== 'halal');
}

const opciones = (ing, elecciones, activas) =>
  activas
    .map((t) => ({ t, e: elecciones[`${ing}|${t}`] }))
    .filter((o) => o.e && o.e.precio != null);

// Si todas las opciones traen precio por kg/litro con la misma unidad, se comparan por eso
// (asi un envase grande y uno pequeño son comparables). Si no, se compara el precio del envase.
function clave(ops) {
  const porUnidad = ops.every((o) => o.e.precio_unidad != null && o.e.unidad === ops[0].e.unidad);
  return (o) => (porUnidad ? o.e.precio_unidad : o.e.precio);
}

const mejor = (ops) => {
  const k = clave(ops);
  return ops.reduce((a, b) => (k(b) < k(a) ? b : a));
};

/**
 * Reparte los ingredientes entre tiendas segun el precio.
 * items: [{id, cantidad, carne?}] · elecciones: {'ingrediente|tienda': {...}} · tiendas: ids activos
 * ahorroMin: si una tienda ahorra menos de esto (en €) respecto a la siguiente mejor opcion,
 * se descarta y sus productos pasan a otras tiendas (no compensa el viaje).
 */
export function asignar(items, elecciones, tiendas, ahorroMin = 0) {
  let activas = [...tiendas];

  const calcular = (act) => {
    const por = {};
    const sin = [];
    for (const it of items) {
      const ops = opciones(it.id, elecciones, tiendasDe(it, act));
      if (!ops.length) {
        sin.push(it);
        continue;
      }
      const m = mejor(ops);
      const alternativas = ops.filter((o) => o.t !== m.t).map((o) => o.e.precio * it.cantidad);
      (por[m.t] ||= []).push({
        ...it,
        t: m.t,
        e: m.e,
        coste: m.e.precio * it.cantidad,
        alternativa: alternativas.length ? Math.min(...alternativas) : Infinity,
      });
    }
    return { por, sin };
  };

  let r = calcular(activas);
  while (ahorroMin > 0 && activas.length > 1) {
    let peor = null;
    let peorAhorro = Infinity;
    for (const [t, lista] of Object.entries(r.por)) {
      // Nunca negativo: si se eligio por precio por kg, el envase puede costar mas y aun asi compensar.
      const ahorro = lista.reduce((s, x) => s + Math.max(0, x.alternativa - x.coste), 0);
      if (ahorro < ahorroMin && ahorro < peorAhorro) {
        peor = t;
        peorAhorro = ahorro;
      }
    }
    if (!peor) break;
    activas = activas.filter((t) => t !== peor);
    r = calcular(activas);
  }

  const porTienda = Object.entries(r.por)
    .map(([t, lista]) => ({ t, items: lista, total: lista.reduce((s, x) => s + x.coste, 0) }))
    .sort((a, b) => b.total - a.total);
  const total = porTienda.reduce((s, x) => s + x.total, 0);

  // Mejor tienda unica que pueda surtir toda la lista, para medir cuanto se ahorra repartiendo.
  let unica = null;
  for (const t of tiendas) {
    // Una tienda sirve para toda la lista solo si todos los ingredientes se pueden comprar en ella.
    const costes = items.map((it) => (tiendasDe(it, [t]).length ? elecciones[`${it.id}|${t}`]?.precio : null));
    if (items.length && costes.every((c) => c != null)) {
      const suma = costes.reduce((s, c, i) => s + c * items[i].cantidad, 0);
      if (!unica || suma < unica.total) unica = { t, total: suma };
    }
  }
  return { porTienda, sinPrecio: r.sin, total, unica };
}

/**
 * Cuanto cuesta una receta (sus ingredientes y cantidades tal como están escritas).
 * items: [{id, cantidad, carne?}] · activas: ids de tiendas activas · ahorroMin: como en asignar().
 * - porTienda: una entrada por cadena (la carne usa Halal en el sitio de Dia, como en la tabla de precios):
 *   total de lo que tiene precio y cuántos ingredientes no lo tienen en esa tienda (faltan).
 * - repartido: lo que cuesta repartiendo entre tiendas con la misma lógica que la lista.
 */
export function costeReceta(items, elecciones, activas, ahorroMin = 0) {
  const porTienda = activas.filter((t) => t !== 'halal').map((slot) => {
    let total = 0;
    let faltan = 0;
    for (const it of items) {
      const t = it.carne && slot === 'dia' ? 'halal' : slot;
      const precio = tiendasDe(it, activas).includes(t) ? elecciones[`${it.id}|${t}`]?.precio : null;
      if (precio == null) faltan++;
      else total += precio * it.cantidad;
    }
    return { t: slot, total, faltan };
  });
  const r = asignar(items, elecciones, activas, ahorroMin);
  return { porTienda, repartido: { total: r.total, faltan: r.sinPrecio.length } };
}

/**
 * Cuanto de una receta hay que comprar para un hueco del menú.
 * La cantidad escrita en la receta es para `personas` (1 o 2). Si comen los dos juntos ('ambos') hacen
 * falta 2 raciones; si cada uno come la suya ('p1' / 'p2'), 1 ración.
 * Receta para 2: juntos ×1, separados ×0,5. Receta para 1: juntos ×2, separados ×1.
 */
export const factorMenu = (personas, quien) => (quien === 'ambos' ? 2 : 1) / (Number(personas) === 1 ? 1 : 2);

/**
 * Suma los ingredientes de varias recetas.
 * partes: [{ receta_id, factor }] · recetas: { id: { ingredientes: [{ingrediente_id, cantidad}] } }
 * ingredientes: [{ id, modo }] → { ingrediente_id: cantidad }
 * Los productos por unidades se redondean hacia arriba (no se compra media lata); los de peso, a gramos.
 */
export function sumarRecetas(partes, recetas, ingredientes) {
  const modo = Object.fromEntries(ingredientes.map((i) => [i.id, i.modo]));
  const total = {};
  for (const { receta_id, factor } of partes) {
    for (const x of recetas[receta_id]?.ingredientes || []) {
      total[x.ingrediente_id] = (total[x.ingrediente_id] || 0) + Number(x.cantidad) * factor;
    }
  }
  for (const [id, n] of Object.entries(total)) {
    total[id] = modo[id] === 'peso' ? Math.round(n * 1000) / 1000 : Math.ceil(n - 1e-9);
  }
  return total;
}

export function diasDesde(iso, ahora = Date.now()) {
  if (!iso) return null;
  return Math.floor((ahora - new Date(iso).getTime()) / 86400000);
}

export const esAntiguo = (e, maxDias) => !e || e.precio == null || e.actualizado == null || diasDesde(e.actualizado) > maxDias;
