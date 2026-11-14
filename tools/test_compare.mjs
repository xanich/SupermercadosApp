import assert from 'node:assert/strict';
import { asignar, tiendasDe, factorMenu, sumarRecetas } from '../app/compare.js';

const e = (precio, extra = {}) => ({ precio, precio_unidad: null, unidad: null, ...extra });
const el = {
  'a|eroski': e(2.0), 'a|dia': e(1.5), 'a|bm': e(3.0),
  'b|eroski': e(4.0), 'b|dia': e(3.9), 'b|bm': e(6.0),
  'c|bm': e(2.0),                                   // solo BM lo tiene
  'd|eroski': e(1.0, { precio_unidad: 2.5, unidad: 'kg' }), // envase pequeño
  'd|dia': e(1.8, { precio_unidad: 1.8, unidad: 'kg' }),    // envase grande, mas barato por kg
};
const items = (...ids) => ids.map((id) => ({ id, cantidad: 1 }));

// 1) Sin umbral: cada producto va a su tienda mas barata.
let r = asignar(items('a', 'b', 'c'), el, ['eroski', 'dia', 'bm'], 0);
const donde = (r, id) => r.porTienda.find((p) => p.items.some((x) => x.id === id)).t;
assert.equal(donde(r, 'a'), 'dia');
assert.equal(donde(r, 'b'), 'dia');
assert.equal(donde(r, 'c'), 'bm');
assert.equal(r.total, 1.5 + 3.9 + 2.0);

// 2) Con umbral 0,5 €: Dia solo ahorra 0,5+0,1 = 0,60 → se mantiene; con 1 € se descarta.
r = asignar(items('a', 'b', 'c'), el, ['eroski', 'dia', 'bm'], 0.5);
assert.equal(donde(r, 'a'), 'dia');
r = asignar(items('a', 'b', 'c'), el, ['eroski', 'dia', 'bm'], 1);
assert.equal(donde(r, 'a'), 'eroski');
assert.equal(donde(r, 'c'), 'bm'); // BM no se puede descartar: es la unica opcion de 'c'

// 3) Comparacion por precio por kg cuando hay datos para todas las opciones.
r = asignar(items('d'), el, ['eroski', 'dia'], 0);
assert.equal(donde(r, 'd'), 'dia');

// 4) Ingrediente sin ningun precio.
r = asignar(items('zzz'), el, ['eroski', 'dia'], 0);
assert.equal(r.sinPrecio.length, 1);

// 5) Ahorro frente a la mejor tienda unica.
r = asignar(items('a', 'b'), el, ['eroski', 'dia', 'bm'], 0);
assert.equal(r.unica.t, 'dia');
// 6) Productos al peso: el precio es €/kg y la cantidad son kilos (300 g a 10 €/kg = 3 €).
const pesoEl = { 'p|eroski': e(10, { precio_unidad: 10, unidad: 'kg' }), 'p|dia': e(12) };
r = asignar([{ id: 'p', cantidad: 0.3 }], pesoEl, ['eroski', 'dia'], 0);
assert.equal(donde(r, 'p'), 'eroski');
assert.ok(Math.abs(r.total - 3) < 1e-9);
assert.ok(Math.abs(r.unica.total - 3) < 1e-9);
// 7) Carne: no se compra en Dia, va a Halal. El resto de ingredientes nunca va a Halal.
const carneEl = {
  'm|dia': e(5), 'm|halal': e(9), 'm|eroski': e(12),   // Dia es más barato pero no tiene carnicería
  'n|halal': e(1), 'n|eroski': e(3),                   // no es carne: Halal no cuenta
};
const lista7 = [{ id: 'm', cantidad: 1, carne: true }, { id: 'n', cantidad: 1 }];
r = asignar(lista7, carneEl, ['eroski', 'dia', 'halal'], 0);
assert.equal(donde(r, 'm'), 'halal');
assert.equal(donde(r, 'n'), 'eroski');
assert.equal(r.total, 9 + 3);
assert.deepEqual(r.unica, { t: 'eroski', total: 15 }); // Halal y Dia no sirven para toda la lista
// Con Halal desactivada, la carne va a la mejor tienda restante (nunca a Dia).
r = asignar(lista7, carneEl, ['eroski', 'dia'], 0);
assert.equal(donde(r, 'm'), 'eroski');
assert.deepEqual(tiendasDe({ carne: true }, ['eroski', 'dia', 'halal']), ['eroski', 'halal']);
assert.deepEqual(tiendasDe({ carne: false }, ['eroski', 'dia', 'halal']), ['eroski', 'dia']);
// 8) Menú por persona: recetas para 2 (como las actuales) y alguna para 1.
assert.equal(factorMenu(2, 'ambos'), 1);
assert.equal(factorMenu(2, 'p1'), 0.5);
assert.equal(factorMenu(1, 'ambos'), 2);
assert.equal(factorMenu(1, 'p2'), 1);
assert.equal(factorMenu(undefined, 'ambos'), 1); // sin dato: se entiende para 2
const recs = {
  pollo: { ingredientes: [{ ingrediente_id: 'pechuga', cantidad: 0.6 }, { ingrediente_id: 'arroz', cantidad: 1 }] },
  uno: { ingredientes: [{ ingrediente_id: 'arroz', cantidad: 1 }] },
};
const ings = [{ id: 'pechuga', modo: 'peso' }, { id: 'arroz', modo: 'unidad' }];
// Juntos pollo (0,6 kg + 1) + pollo separado de uno (0,3 kg + 0,5 → sube a 2 en total con el otro arroz)
let t = sumarRecetas([{ receta_id: 'pollo', factor: 1 }, { receta_id: 'pollo', factor: 0.5 }], recs, ings);
assert.equal(t.pechuga, 0.9);
assert.equal(t.arroz, 2); // 1 + 0,5 = 1,5 → 2 (no se compra media unidad)
// Cada uno su receta "para 1": 1 + 1 = 2
t = sumarRecetas([{ receta_id: 'uno', factor: 1 }, { receta_id: 'uno', factor: 1 }], recs, ings);
assert.equal(t.arroz, 2);
// Una receta que ya no existe no suma nada
assert.deepEqual(sumarRecetas([{ receta_id: 'borrada', factor: 1 }], recs, ings), {});
console.log('compare.js: todas las pruebas OK');
