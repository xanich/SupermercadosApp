import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { asignar, tiendasDe, factorMenu, sumarRecetas, costeReceta, repartirLista } from '../app/compare.js';

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
// 9) Coste de una receta por tienda: pollo (carne, 0,5 kg) + arroz (1 ud) + sal (1 ud).
const elR = {
  'pollo|eroski': e(8), 'pollo|halal': e(7), 'pollo|dia': e(1),   // Dia no cuenta para la carne
  'arroz|eroski': e(2), 'arroz|dia': e(1.5), 'arroz|halal': e(0.1), // Halal no cuenta para el arroz
  'sal|eroski': e(1),                                              // solo Eroski tiene sal
};
const itemsR = [{ id: 'pollo', cantidad: 0.5, carne: true }, { id: 'arroz', cantidad: 1 }, { id: 'sal', cantidad: 1 }];
let c = costeReceta(itemsR, elR, ['eroski', 'dia', 'halal'], 0);
const de = (t) => c.porTienda.find((x) => x.t === t);
assert.deepEqual(c.porTienda.map((x) => x.t), ['eroski', 'dia']); // una columna por cadena; Halal va en la de Dia
assert.ok(Math.abs(de('eroski').total - (4 + 2 + 1)) < 1e-9);
assert.equal(de('eroski').faltan, 0);
// En la columna de Dia: la carne se cuenta en Halal (0,5×7), el arroz en Dia (1,5) y a la sal le falta el precio.
assert.ok(Math.abs(de('dia').total - (3.5 + 1.5)) < 1e-9);
assert.equal(de('dia').faltan, 1);
// Repartido: pollo en Halal (3,5) + arroz en Dia (1,5) + sal en Eroski (1) = 6
assert.ok(Math.abs(c.repartido.total - 6) < 1e-9);
assert.equal(c.repartido.faltan, 0);
// Con Halal desactivada la carne no se puede comprar en la columna de Dia.
c = costeReceta(itemsR, elR, ['eroski', 'dia'], 0);
assert.equal(de('dia').faltan, 2); // pollo y sal

// Lineas fijadas a mano: tienda y precio propios; el resto sigue el reparto automatico.
{
  const its = [{ id: 'a', cantidad: 2 }, { id: 'b', cantidad: 1, tienda_compra: 'bm', precio_pagado: 5 }, { id: 'c', cantidad: 1, tienda_compra: 'eroski' }];
  const rf = repartirLista(its, el, ['eroski', 'dia', 'bm'], 0);
  const it = (id) => rf.porTienda.flatMap((p) => p.items).find((x) => x.id === id);
  assert.equal(it('a').t, 'dia');                    // libre: la mas barata
  assert.equal(it('b').t, 'bm');                     // fijada: tienda y precio elegidos (5 en lugar de 3,9)
  assert.equal(it('b').coste, 5);
  assert.equal(it('b').fijo, true);
  assert.deepEqual(rf.sinPrecio.map((x) => x.id), ['c']); // c no tiene precio en Eroski
  assert.ok(Math.abs(rf.total - (2 * 1.5 + 5)) < 1e-9);
  // Tienda evitada por el ahorro minimo: con 1 EUR no se va a Dia y se explica.
  const rm = repartirLista(items('a', 'b', 'c'), el, ['eroski', 'dia', 'bm'], 1);
  assert.deepEqual(rm.evitadas, ['dia']);
  assert.ok(rm.extraPorMin > 0);
}

// La version del service worker (cache) debe coincidir con la de config.js.
{
  const v = /VERSION = '([^']+)'/.exec(readFileSync(new URL('../app/config.js', import.meta.url), 'utf8'))[1];
  assert.match(readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8'), new RegExp(`CACHE = 'compra-${v.replaceAll('.', '\.')}'`));
}
console.log('compare.js: todas las pruebas OK');
