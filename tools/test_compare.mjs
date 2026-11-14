import assert from 'node:assert/strict';
import { asignar, tiendasDe } from '../app/compare.js';

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
console.log('compare.js: todas las pruebas OK');
