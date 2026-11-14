// Logica del comparador (sin dependencias del navegador, para poder probarla en Node).

export const TIENDAS = [
  { id: 'eroski', nombre: 'Eroski' },
  { id: 'bm', nombre: 'BM' },
  { id: 'dia', nombre: 'Dia' },
  { id: 'carrefour', nombre: 'Carrefour' },
];

export const nombreTienda = (id) => TIENDAS.find((t) => t.id === id)?.nombre ?? id;

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
 * items: [{id, cantidad}] · elecciones: {'ingrediente|tienda': {...}} · tiendas: ids activos
 * ahorroMin: si una tienda ahorra menos de esto (en €) respecto a la siguiente mejor opcion,
 * se descarta y sus productos pasan a otras tiendas (no compensa el viaje).
 */
export function asignar(items, elecciones, tiendas, ahorroMin = 0) {
  let activas = [...tiendas];

  const calcular = (act) => {
    const por = {};
    const sin = [];
    for (const it of items) {
      const ops = opciones(it.id, elecciones, act);
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
    const costes = items.map((it) => elecciones[`${it.id}|${t}`]?.precio);
    if (items.length && costes.every((c) => c != null)) {
      const suma = costes.reduce((s, c, i) => s + c * items[i].cantidad, 0);
      if (!unica || suma < unica.total) unica = { t, total: suma };
    }
  }
  return { porTienda, sinPrecio: r.sin, total, unica };
}

export function diasDesde(iso, ahora = Date.now()) {
  if (!iso) return null;
  return Math.floor((ahora - new Date(iso).getTime()) / 86400000);
}

export const esAntiguo = (e, maxDias) => !e || e.precio == null || e.actualizado == null || diasDesde(e.actualizado) > maxDias;
