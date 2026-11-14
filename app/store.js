// Almacenamiento: modo local (localStorage, para probar) o Supabase (compartido entre moviles).
import { TIENDAS } from './compare.js';

const AJUSTES_INICIALES = {
  tiendas: TIENDAS.map((t) => t.id),
  ahorroMin: 1.5,
  diasCaducidad: 7,
  nombres: ['Persona 1', 'Persona 2'], // quienes comparten la compra (menús por persona)
};

const ahora = () => new Date().toISOString();

// 'Pechuga de Pollo' -> 'pechuga-de-pollo'
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
const idLibre = (base, usados) => {
  let id = base;
  for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;
  return id;
};

// Datos de un ingrediente nuevo (o null si ya existe uno con ese nombre: se devuelve su id).
function prepararIngrediente(e, nombre, modo, carne = false) {
  const limpio = String(nombre).trim().replace(/\s+/g, ' ');
  if (!limpio) throw new Error('Falta el nombre del ingrediente.');
  const igual = e.ingredientes.find((i) => i.nombre.toLowerCase() === limpio.toLowerCase());
  if (igual) return { existente: igual.id };
  const id = idLibre(slug(limpio), new Set(e.ingredientes.map((i) => i.id)));
  return { fila: { id, nombre: limpio, consulta: limpio, modo: modo === 'peso' ? 'peso' : 'unidad', carne: Boolean(carne) } };
}

// Suma cantidades a la lista: { ingrediente_id: cantidad } -> filas nuevas de la lista.
function filasSumadas(e, cantidades) {
  return Object.entries(cantidades)
    .filter(([id, n]) => n > 0 && e.ingredientes.some((i) => i.id === id))
    .map(([id, n]) => ({
      ingrediente_id: id,
      cantidad: Math.round(((Number(e.lista[id]?.cantidad) || 0) + n) * 1000) / 1000,
      hecho: false,
    }));
}

// Fecha y lineas nuevas de una compra editada; el total sale siempre de sumar las lineas.
function datosCompra(c, { fecha, lineas }) {
  const nuevas = lineas || c.lineas;
  const total = Math.round(nuevas.reduce((s, x) => s + (Number(x.coste) || 0), 0) * 100) / 100;
  return { fecha: fecha || c.fecha, lineas: nuevas, total };
}

async function cargarJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// Copias antiguas guardaban el menú como 'dia|comida': pasan a 'dia|comida|ambos'.
function normalizarMenu(menu) {
  return Object.fromEntries(Object.entries(menu || {}).map(([k, v]) => [k.split('|').length === 2 ? `${k}|ambos` : k, v]));
}

// Filas del menú de un hueco al cambiar entre juntos y separados. Si la receta es la misma
// para los dos se conserva, para que la compra salga igual.
function huecoCambiado(menu, dia, comida, separado) {
  const k = (q) => `${dia}|${comida}|${q}`;
  if (separado) {
    const r = menu[k('ambos')] ?? null;
    return { p1: r, p2: r };
  }
  const a = menu[k('p1')] ?? null;
  const b = menu[k('p2')] ?? null;
  return { ambos: a && a === b ? a : null };
}

function crearBase(modo) {
  const oyentes = [];
  const store = {
    modo,
    // recetas: { id: { id, nombre, ingredientes: [{ ingrediente_id, cantidad }] } }
    // menu: { 'dia|comida|quien': receta_id | null }  (dia 0 = lunes ... 6 = domingo; comida: desayuno|comida|cena;
    //   quien: 'ambos' = una receta para los dos, 'p1' / 'p2' = cada persona la suya. Si un hueco tiene p1/p2 es "separado".)
    estado: { ingredientes: [], elecciones: {}, lista: {}, ajustes: { ...AJUSTES_INICIALES }, candidatos: null, recetas: {}, menu: {}, compras: [] },
    faltanTablas: false,
    faltanCompras: false, // sin tabla `compras` en Supabase (falta ejecutar schema.sql)
    necesitaLogin: false,
    alCambiar: (f) => oyentes.push(f),
    avisar: () => oyentes.forEach((f) => f()),
  };
  return store;
}

// ---------------------------------------------------------------- modo local
const CLAVE = 'super-v1';

export async function crearStoreLocal() {
  const s = crearBase('local');
  const e = s.estado;
  e.candidatos = await cargarJson('../data/candidatos.json');

  let guardado = null;
  try {
    guardado = JSON.parse(localStorage.getItem(CLAVE));
  } catch {
    /* sin almacenamiento: se trabaja en memoria */
  }
  if (guardado) {
    Object.assign(e, { ingredientes: guardado.ingredientes, elecciones: guardado.elecciones, lista: guardado.lista });
    e.recetas = guardado.recetas || {};
    e.menu = normalizarMenu(guardado.menu);
    e.compras = guardado.compras || [];
    e.ajustes = { ...AJUSTES_INICIALES, ...guardado.ajustes };
  } else {
    const ings = (await cargarJson('../data/ingredients.json')) || [];
    e.ingredientes = ings.map(({ id, nombre, consulta, modo, carne }) => ({ id, nombre, consulta, modo: modo || 'unidad', carne: Boolean(carne) }));
    for (const ing of ings) {
      for (const [t, precio] of Object.entries(ing.precios_excel || {})) {
        if (precio == null) continue;
        e.elecciones[`${ing.id}|${t}`] = {
          ingrediente_id: ing.id, tienda: t, nombre: null, ext_id: null, url: null,
          precio, precio_unidad: null, unidad: null, actualizado: null, origen: 'excel',
        };
      }
    }
  }

  // Copias guardadas antes de existir el modo "al peso": se rellena desde el archivo de datos.
  if (e.ingredientes.some((i) => !i.modo)) {
    const base = (await cargarJson('../data/ingredients.json')) || [];
    const modos = Object.fromEntries(base.map((i) => [i.id, i.modo]));
    e.ingredientes.forEach((i) => { i.modo = i.modo || modos[i.id] || 'unidad'; });
  }

  const guardar = () => {
    try {
      const { ingredientes, elecciones, lista, ajustes, recetas, menu, compras } = e;
      localStorage.setItem(CLAVE, JSON.stringify({ ingredientes, elecciones, lista, ajustes, recetas, menu, compras }));
    } catch {
      /* ignorar */
    }
    s.avisar();
  };

  s.setEleccion = async (ing, tienda, cambios) => {
    const k = `${ing}|${tienda}`;
    e.elecciones[k] = { ingrediente_id: ing, tienda, nombre: null, ext_id: null, url: null, precio: null,
      precio_unidad: null, unidad: null, origen: 'manual', ...e.elecciones[k], ...cambios, actualizado: ahora() };
    guardar();
  };
  s.setLista = async (ing, cambios) => {
    if (cambios === null) delete e.lista[ing];
    else e.lista[ing] = { cantidad: 1, hecho: false, ...e.lista[ing], ...cambios };
    guardar();
  };
  s.setAjuste = async (clave, valor) => {
    e.ajustes[clave] = valor;
    guardar();
  };
  s.setIngrediente = async (id, cambios) => {
    const ing = e.ingredientes.find((i) => i.id === id);
    if (ing) Object.assign(ing, cambios);
    guardar();
  };
  s.crearIngrediente = async (nombre, modo, carne) => {
    const { existente, fila } = prepararIngrediente(e, nombre, modo, carne);
    if (existente) return existente;
    e.ingredientes.push(fila);
    guardar();
    return fila.id;
  };
  s.sumarLista = async (cantidades) => {
    for (const f of filasSumadas(e, cantidades)) e.lista[f.ingrediente_id] = { ...e.lista[f.ingrediente_id], cantidad: f.cantidad, hecho: false };
    guardar();
  };
  s.guardarReceta = async ({ id, nombre, personas, ingredientes }) => {
    const rid = id || idLibre(slug(nombre), new Set(Object.keys(e.recetas)));
    e.recetas[rid] = { id: rid, nombre, personas: Number(personas) === 1 ? 1 : 2, ingredientes };
    guardar();
    return rid;
  };
  s.borrarReceta = async (id) => {
    delete e.recetas[id];
    for (const [k, v] of Object.entries(e.menu)) {
      if (v !== id) continue;
      if (k.endsWith('|ambos')) delete e.menu[k];
      else e.menu[k] = null; // el hueco separado sigue, sin receta
    }
    guardar();
  };
  s.setMenu = async (dia, comida, quien, recetaId) => {
    const k = `${dia}|${comida}|${quien}`;
    if (recetaId || quien !== 'ambos') e.menu[k] = recetaId || null;
    else delete e.menu[k];
    guardar();
  };
  s.setModoComida = async (dia, comida, separado) => {
    const nuevo = huecoCambiado(e.menu, dia, comida, separado);
    for (const q of ['ambos', 'p1', 'p2']) delete e.menu[`${dia}|${comida}|${q}`];
    for (const [q, r] of Object.entries(nuevo)) if (separado || r) e.menu[`${dia}|${comida}|${q}`] = r;
    guardar();
  };
  s.vaciarMenu = async () => {
    e.menu = {};
    guardar();
  };
  s.vaciarLista = async () => {
    e.lista = {};
    guardar();
  };
  s.finalizarCompra = async ({ fecha, total, lineas }, ids) => {
    e.compras.push({ id: `c${Date.now().toString(36)}`, fecha: fecha || ahora(), total, lineas });
    for (const id of ids) delete e.lista[id];
    guardar();
  };
  s.borrarCompra = async (id) => {
    e.compras = e.compras.filter((c) => c.id !== id);
    guardar();
  };
  // Cambia la fecha y/o las lineas de una compra; el total siempre es la suma de las lineas.
  s.editarCompra = async (id, { fecha, lineas }) => {
    const c = e.compras.find((x) => x.id === id);
    if (!c) throw new Error('No se encuentra la compra.');
    Object.assign(c, datosCompra(c, { fecha, lineas }));
    guardar();
  };
  s.exportar = () => JSON.stringify({ ...e, candidatos: undefined }, null, 1);
  s.importar = (texto) => {
    const d = JSON.parse(texto);
    Object.assign(e, { ingredientes: d.ingredientes, elecciones: d.elecciones, lista: d.lista, recetas: d.recetas || {}, menu: normalizarMenu(d.menu), compras: d.compras || [] });
    e.ajustes = { ...AJUSTES_INICIALES, ...d.ajustes };
    guardar();
  };
  s.reiniciar = () => {
    try {
      localStorage.removeItem(CLAVE);
    } catch {
      /* ignorar */
    }
    location.reload();
  };
  return s;
}

// ------------------------------------------------------------------ Supabase
// OJO: esta parte no se ha podido probar contra un proyecto real. Ver README.
export async function crearStoreSupabase(config) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const sb = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const s = crearBase('supabase');
  const e = s.estado;
  e.candidatos = await cargarJson('../data/candidatos.json');

  s.enviarEnlace = async (email) => {
    // Siempre la carpeta de la app (p. ej. http://localhost:8000/app/), sin index.html, ?consultas ni #hash,
    // para que coincida exactamente con la lista de "Redirect URLs" de Supabase.
    const destino = new URL('./', location.href).href;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: destino } });
    if (error) throw error;
  };
  // Entrada con correo y contraseña: no envia ningun email (el envio de Supabase esta muy limitado).
  s.entrar = async (email, password) => {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };
  s.salir = async () => {
    await sb.auth.signOut();
    location.reload();
  };

  const recargar = async () => {
    const [ing, ele, lis, aju] = await Promise.all([
      sb.from('ingredientes').select('*').order('nombre'),
      sb.from('elecciones').select('*'),
      sb.from('lista').select('*'),
      sb.from('ajustes').select('*'),
    ]);
    for (const r of [ing, ele, lis, aju]) if (r.error) throw r.error;
    e.ingredientes = ing.data;
    e.elecciones = Object.fromEntries(ele.data.map((x) => [`${x.ingrediente_id}|${x.tienda}`, x]));
    e.lista = Object.fromEntries(lis.data.map((x) => [x.ingrediente_id, {
      cantidad: x.cantidad, hecho: x.hecho,
      // Solo si la base ya tiene esas columnas (si no, no se mandan al guardar y la lista sigue funcionando).
      ...('tienda_compra' in x ? { tienda_compra: x.tienda_compra ?? null } : {}),
      ...('precio_pagado' in x ? { precio_pagado: x.precio_pagado == null ? null : Number(x.precio_pagado) } : {}),
    }]));
    e.ajustes = { ...AJUSTES_INICIALES, ...Object.fromEntries(aju.data.map((x) => [x.clave, x.valor])) };

    // Recetas y menu: si sus tablas aun no existen (falta ejecutar schema.sql), el resto sigue funcionando.
    const [rec, rin, men] = await Promise.all([
      sb.from('recetas').select('*'),
      sb.from('receta_ingredientes').select('*'),
      sb.from('menu').select('*'),
    ]);
    s.faltanTablas = Boolean(rec.error || rin.error || men.error);
    if (s.faltanTablas) {
      e.recetas = {};
      e.menu = {};
    } else {
      e.recetas = Object.fromEntries(rec.data.map((r) => [r.id, { id: r.id, nombre: r.nombre, personas: Number(r.personas) === 1 ? 1 : 2, ingredientes: [] }]));
      for (const x of rin.data) e.recetas[x.receta_id]?.ingredientes.push({ ingrediente_id: x.ingrediente_id, cantidad: Number(x.cantidad) });
      e.menu = Object.fromEntries(men.data.map((x) => [`${x.dia}|${x.comida}|${x.quien || 'ambos'}`, x.receta_id ?? null]));
    }
    // Compras terminadas: si la tabla aun no existe, el resto sigue funcionando.
    const com = await sb.from('compras').select('*').order('fecha', { ascending: false });
    s.faltanCompras = Boolean(com.error);
    e.compras = com.error ? [] : com.data.map((x) => ({ id: x.id, fecha: x.fecha, total: Number(x.total), lineas: x.lineas || [] }));
    s.avisar();
  };
  s.recargar = recargar;

  s.setEleccion = async (ing, tienda, cambios) => {
    const k = `${ing}|${tienda}`;
    const fila = { ...e.elecciones[k], ...cambios, ingrediente_id: ing, tienda, actualizado: ahora() };
    delete fila.id;
    if (!('origen' in fila)) fila.origen = 'manual';
    const { error } = await sb.from('elecciones').upsert(fila, { onConflict: 'ingrediente_id,tienda' });
    if (error) throw error;
    await recargar();
  };
  s.setLista = async (ing, cambios) => {
    const r =
      cambios === null
        ? await sb.from('lista').delete().eq('ingrediente_id', ing)
        : await sb.from('lista').upsert({ cantidad: 1, hecho: false, ...e.lista[ing], ...cambios, ingrediente_id: ing });
    if (r.error) throw r.error;
    await recargar();
  };
  s.setAjuste = async (clave, valor) => {
    const { error } = await sb.from('ajustes').upsert({ clave, valor });
    if (error) throw error;
    await recargar();
  };
  s.setIngrediente = async (id, cambios) => {
    const { error } = await sb.from('ingredientes').update(cambios).eq('id', id);
    if (error) throw error;
    await recargar();
  };
  const comprobarTablas = () => {
    if (s.faltanTablas) throw new Error('Faltan las tablas de recetas en Supabase: ejecuta sql/schema.sql (ver README).');
  };
  s.crearIngrediente = async (nombre, modo, carne) => {
    const { existente, fila } = prepararIngrediente(e, nombre, modo, carne);
    if (existente) return existente;
    const { error } = await sb.from('ingredientes').insert(fila);
    if (error) throw error;
    await recargar();
    return fila.id;
  };
  s.sumarLista = async (cantidades) => {
    const filas = filasSumadas(e, cantidades);
    if (!filas.length) return;
    const { error } = await sb.from('lista').upsert(filas);
    if (error) throw error;
    await recargar();
  };
  s.guardarReceta = async ({ id, nombre, personas, ingredientes }) => {
    comprobarTablas();
    const rid = id || `${slug(nombre)}-${Date.now().toString(36)}`;
    const r1 = await sb.from('recetas').upsert({ id: rid, nombre, personas: Number(personas) === 1 ? 1 : 2 });
    if (r1.error) throw r1.error;
    const r2 = await sb.from('receta_ingredientes').delete().eq('receta_id', rid);
    if (r2.error) throw r2.error;
    if (ingredientes.length) {
      const r3 = await sb.from('receta_ingredientes').insert(ingredientes.map((x) => ({ ...x, receta_id: rid })));
      if (r3.error) throw r3.error;
    }
    await recargar();
    return rid;
  };
  s.borrarReceta = async (id) => {
    comprobarTablas();
    const { error } = await sb.from('recetas').delete().eq('id', id); // borra tambien sus ingredientes y su sitio en el menu
    if (error) throw error;
    await recargar();
  };
  s.setMenu = async (dia, comida, quien, recetaId) => {
    comprobarTablas();
    const r = recetaId || quien !== 'ambos'
      ? await sb.from('menu').upsert({ dia, comida, quien, receta_id: recetaId || null }, { onConflict: 'dia,comida,quien' })
      : await sb.from('menu').delete().eq('dia', dia).eq('comida', comida).eq('quien', quien);
    if (r.error) throw r.error;
    await recargar();
  };
  s.setModoComida = async (dia, comida, separado) => {
    comprobarTablas();
    const nuevo = huecoCambiado(e.menu, dia, comida, separado);
    const del = await sb.from('menu').delete().eq('dia', dia).eq('comida', comida);
    if (del.error) throw del.error;
    const filas = Object.entries(nuevo)
      .filter(([, r]) => separado || r)
      .map(([quien, r]) => ({ dia, comida, quien, receta_id: r }));
    if (filas.length) {
      const ins = await sb.from('menu').upsert(filas, { onConflict: 'dia,comida,quien' });
      if (ins.error) throw ins.error;
    }
    await recargar();
  };
  s.vaciarLista = async () => {
    const { error } = await sb.from('lista').delete().neq('ingrediente_id', '');
    if (error) throw error;
    await recargar();
  };
  const comprobarCompras = () => {
    if (s.faltanCompras) throw new Error('Falta la tabla de compras en Supabase: ejecuta sql/schema.sql (ver README).');
  };
  s.finalizarCompra = async ({ fecha, total, lineas }, ids) => {
    comprobarCompras();
    const ins = await sb.from('compras').insert({ fecha: fecha || ahora(), total, lineas });
    if (ins.error) throw ins.error;
    if (ids.length) {
      const del = await sb.from('lista').delete().in('ingrediente_id', ids);
      if (del.error) throw del.error;
    }
    await recargar();
  };
  s.editarCompra = async (id, { fecha, lineas }) => {
    comprobarCompras();
    const c = e.compras.find((x) => x.id === id);
    if (!c) throw new Error('No se encuentra la compra.');
    const { error } = await sb.from('compras').update(datosCompra(c, { fecha, lineas })).eq('id', id);
    if (error) throw error;
    await recargar();
  };
  s.borrarCompra = async (id) => {
    comprobarCompras();
    const { error } = await sb.from('compras').delete().eq('id', id);
    if (error) throw error;
    await recargar();
  };
  s.vaciarMenu = async () => {
    comprobarTablas();
    const { error } = await sb.from('menu').delete().gte('dia', 0);
    if (error) throw error;
    await recargar();
  };

  const { data } = await sb.auth.getSession();
  if (!data.session) {
    s.necesitaLogin = true;
    return s;
  }
  await recargar();
  sb.channel('cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lista' }, recargar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'elecciones' }, recargar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredientes' }, recargar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'recetas' }, recargar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'receta_ingredientes' }, recargar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'menu' }, recargar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'compras' }, recargar)
    .subscribe();
  return s;
}
