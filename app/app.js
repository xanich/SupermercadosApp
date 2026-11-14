import { config, VERSION } from './config.js';
import { crearStoreLocal, crearStoreSupabase } from './store.js';
import { TIENDAS, nombreTienda, asignar, repartirLista, tiendasDe, factorMenu, sumarRecetas, costeReceta, diasDesde, esAntiguo } from './compare.js';

const $ = (s) => document.querySelector(s);
const vista = $('#vista');
const hoja = $('#hoja');
const euro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const COLOR = { eroski: '#c8553d', bm: '#3b6ea8', dia: '#b8892b', carrefour: '#2b8a8a', halal: '#7b5ea7' };
// Búsqueda en la web de cada tienda (q ya va codificado).
const BUSQUEDA = {
  dia: (q) => `https://www.dia.es/search?q=${q}`,
  eroski: (q) => `https://supermercado.eroski.es/es/search/results/?q=${q}`,
  bm: (q) => `https://www.online.bmsupermercados.es/es/s/${q}?showProducts=true`,
  carrefour: (q) => `https://www.carrefour.es/?query=${q}`,
};
// Si ya hay un producto elegido con su dirección, se abre ese producto; si no, la búsqueda.
// La carnicería (Halal) no tiene web: devuelve null y no se muestra enlace.
const enlaceTienda = (t, consulta, e) => (/^https:\/\//.test(e?.url || '') ? e.url : BUSQUEDA[t]?.(encodeURIComponent(consulta)) ?? null);
const AUTO = new Set(['bm', 'eroski']); // tiendas cuyo precio puede leerse solo
const TABS = ['lista', 'cocina', 'precios', 'productos', 'compras', 'ajustes'];
const COCINA = [{ id: 'menu', nombre: 'Menú' }, { id: 'recetas', nombre: 'Recetas' }]; // «Cocina» junta las dos en una pestaña
const PASO_KG = 0.25;
const PASO_REC_KG = 0.05; // en recetas, de 50 en 50 g
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const COMIDAS = [
  { id: 'desayuno', nombre: 'Desayuno' },
  { id: 'comida', nombre: 'Comida' },
  { id: 'cena', nombre: 'Cena' },
];
const MODOS_PRECIO = [
  { id: 'lista', nombre: 'Lista' },
  { id: 'todos', nombre: 'Todos' },
  { id: 'receta', nombre: 'Receta' },
];
const INICIALES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// Quién usa este móvil ('p1' / 'p2'): se recuerda en el propio móvil, no se comparte.
const CLAVE_YO = 'super-yo';
const leerYo = () => {
  try {
    const v = localStorage.getItem(CLAVE_YO);
    return v === 'p1' || v === 'p2' ? v : null;
  } catch {
    return null;
  }
};
const guardarYo = (v) => {
  try {
    if (v) localStorage.setItem(CLAVE_YO, v);
    else localStorage.removeItem(CLAVE_YO);
  } catch {
    /* sin almacenamiento: se pregunta cada vez */
  }
};

let store;
const ui = {
  tab: 'lista', buscarProd: '', buscarAdd: '', buscarPrecio: '', preciosModo: 'lista', preciosReceta: null, pasados: new Set(), // pasados: días ya pasados a la lista (solo en este móvil)
  hoja: null, candidato: null, receta: null, buscarRec: '',
  yo: leerYo(), menuVer: 'mio', ni: null, ep: null, cocina: 'menu', le: null, compraAbierta: new Set(),
};

// ------------------------------------------------------------------ utilidades
const ingrediente = (id) => store.estado.ingredientes.find((i) => i.id === id);
const esPeso = (id) => ingrediente(id)?.modo === 'peso';
const cantidadInicial = (id) => (esPeso(id) ? 0.5 : 1);
const punto = (t) => `<span class="punto" style="background:${COLOR[t]}"></span>`;
const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, 'es');
const limpiar = (s) => esc(String(s ?? '').replace(/\(\s*\)/g, '').trim()); // quita paréntesis vacíos de los nombres

function fmtCantidad(modo, n) {
  if (modo === 'peso') return n < 1 ? `${Math.round(n * 1000)} g` : `${nf.format(n)} kg`;
  return nf.format(n);
}

function etiqueta(e, dias) {
  if (!e || e.precio == null) return '<span class="etq vieja">sin precio</span>';
  if (!e.actualizado) return '<span class="etq vieja">del Excel</span>';
  const d = diasDesde(e.actualizado);
  const txt = d <= 0 ? 'hoy' : `hace ${d} d`;
  const clases = ['etq'];
  if (d > dias) clases.push('vieja');
  else if (e.origen === 'auto') clases.push('auto');
  return `<span class="${clases.join(' ')}">${e.origen === 'auto' ? 'auto · ' : ''}${txt}</span>`;
}

function itemsLista() {
  const { ingredientes, lista } = store.estado;
  const por = Object.fromEntries(ingredientes.map((i) => [i.id, i]));
  return Object.entries(lista)
    .filter(([id]) => por[id])
    .map(([id, v]) => ({ id, nombre: por[id].nombre, consulta: por[id].consulta, modo: por[id].modo || 'unidad', carne: Boolean(por[id].carne), cantidad: Number(v.cantidad), hecho: v.hecho, tienda_compra: v.tienda_compra || null, precio_pagado: v.precio_pagado ?? null }))
    .sort(porNombre);
}

// ------------------------------------------------------------------ vistas
function vistaLogin() {
  return `<div class="cabecera"><h1>Entrar</h1></div>
    <div class="tarjeta"><div class="bloque">
      <p>Entra con tu correo y tu contraseña. Solo pueden entrar las personas autorizadas.</p>
      <p><input type="email" id="email" placeholder="correo@ejemplo.com" autocomplete="username"></p>
      <p><input type="password" id="clave" placeholder="Contraseña" autocomplete="current-password"></p>
      <p style="margin-top:12px"><button class="primario" data-acc="entrar">Entrar</button></p>
      <p id="msg" class="suave"></p>
    </div></div>`;
}

function vistaLista() {
  const { elecciones, ajustes } = store.estado;
  const items = itemsLista();
  const dias = Number(ajustes.diasCaducidad) || 7;
  const cab = `<div class="cabecera"><h1>Compra</h1><button class="primario" data-acc="abrirAdd">＋ Añadir</button></div>`;

  if (!items.length) {
    return cab + `<div class="vacio">
      <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 24h48l-4.5 26a5 5 0 0 1-4.9 4H17.4a5 5 0 0 1-4.9-4L8 24Z"/><path d="m22 24 7-14M42 24 35 10"/><path d="M24 33v12M32 33v12M40 33v12"/></svg>
      <h2>La lista está vacía</h2>
      <p>Añade lo que necesitáis esta semana y la app lo reparte entre tiendas según el precio.</p>
      <button class="primario" data-acc="abrirAdd">Añadir ingredientes</button></div>`;
  }

  const r = repartirLista(items, elecciones, ajustes.tiendas, Number(ajustes.ahorroMin) || 0);
  const antiguos = r.porTienda.flatMap((p) => p.items).filter((x) => esAntiguo(x.e, dias)).length + r.sinPrecio.length;
  const hechos = items.filter((i) => i.hecho).length;
  const ahorro = r.unica ? r.unica.total - r.total : 0;
  const pct = Math.round((hechos / items.length) * 100);

  let h = cab;
  h += `<section class="hero">
    <div class="etq-h">Total estimado</div>
    <div class="total-h">${euro.format(r.total)}</div>
    <div class="meta-h">${r.porTienda.length} ${r.porTienda.length === 1 ? 'tienda' : 'tiendas'} · ${items.length} ${items.length === 1 ? 'producto' : 'productos'}</div>
    ${ahorro > 0.005 ? `<div class="ahorro-h">Ahorras ${euro.format(ahorro)} frente a todo en ${nombreTienda(r.unica.t)}</div>` : ''}
    ${chipAhorroMin(ajustes, true)}
    <div class="progreso" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <div class="meta-h">${hechos} de ${items.length} comprados</div>
  </section>`;

  if (antiguos > 0) {
    h += `<div class="aviso"><span>${antiguos} ${antiguos === 1 ? 'precio sin actualizar' : 'precios sin actualizar'}</span>
      <button data-acc="ir" data-tab="precios" data-modo="lista">Actualizar</button></div>`;
  }

  if (r.evitadas.length) {
    const nombres = r.evitadas.map(nombreTienda).join(' y ');
    h += `<div class="aviso aviso-min"><span>Por el ahorro mínimo (${euro.format(Number(ajustes.ahorroMin))}) no hace falta ir a ${esc(nombres)}${r.extraPorMin > 0.005 ? `: pagas ${euro.format(r.extraPorMin)} más` : ''}.</span>
      <button data-acc="ir" data-tab="ajustes">Cambiar</button></div>`;
  }
  for (const p of r.porTienda) {
    h += `<section class="tarjeta"><div class="tienda-cab">${punto(p.t)}<h2>${nombreTienda(p.t)}</h2>
      <span class="suave">${p.items.length} ${p.items.length === 1 ? 'producto' : 'productos'}</span>
      <span class="total num">${euro.format(p.total)}</span></div>`;
    for (const x of p.items.sort(porNombre)) h += filaItem(x, x.coste, etiqueta(x.e, dias), detalleUnidad(x));
    h += '</section>';
  }
  if (r.sinPrecio.length) {
    h += `<section class="tarjeta"><div class="tienda-cab"><h2>Sin precio en las tiendas activas</h2></div>`;
    for (const x of r.sinPrecio) h += filaItem(x, null, '', '');
    h += '</section>';
  }
  if (hechos) {
    const tot = r.porTienda.flatMap((p) => p.items).filter((x) => x.hecho).reduce((s, x) => s + x.coste, 0);
    h += `<button class="primario ancho" data-acc="finalizarCompra">Compra finalizada · ${hechos} ${hechos === 1 ? 'producto' : 'productos'} · ${euro.format(tot)}</button>
      <p class="suave centro">Guarda lo marcado en Compras y lo quita de la lista. Lo que no esté marcado se queda para la próxima.</p>`;
  }
  h += `<p class="pie-lista">${hechos ? '<button data-acc="limpiar">Quitar lo comprado</button>' : ''}
    <button class="peligro" data-acc="vaciarLista">Vaciar lista</button></p>`;
  return h;
}

// Etiqueta que dice cuál es el ahorro mínimo por tienda y lleva a Ajustes para cambiarlo.
function chipAhorroMin(ajustes, enHero = false) {
  const min = Number(ajustes.ahorroMin) || 0;
  return `<button class="chip-min${enHero ? ' en-hero' : ''}" data-acc="ir" data-tab="ajustes" aria-label="Ahorro mínimo por tienda; cambiar en Ajustes">${min > 0 ? `Ahorro mín. por tienda: ${euro.format(min)}` : 'Ahorro mín. por tienda: desactivado'}</button>`;
}

function detalleUnidad(x) {
  if (x.modo === 'peso') return `<span class="num">${euro.format(x.e.precio)}/kg</span>`;
  return x.cantidad > 1 ? `<span class="num">${euro.format(x.e.precio)} c/u</span>` : '';
}

function filaItem(x, coste, etq, extra) {
  return `<div class="item ${x.hecho ? 'hecho' : ''}">
    <div class="check"><input class="redonda" type="checkbox" data-acc="hecho" data-id="${esc(x.id)}" ${x.hecho ? 'checked' : ''} aria-label="Comprado: ${esc(x.nombre)}"></div>
    <div><div class="nombre">${esc(x.nombre)}</div><div class="meta">${x.fijo ? '<span class="etq fijo">a mano</span>' : etq}${extra}</div></div>
    <div class="precio-fila num">${coste == null ? '' : euro.format(coste)}</div>
    <div class="controles">
      <div class="cantidad">
        <button data-acc="menos" data-id="${esc(x.id)}" aria-label="Menos">−</button>
        <button class="valor" data-acc="cant" data-id="${esc(x.id)}" aria-label="Cambiar cantidad">${fmtCantidad(x.modo, x.cantidad)}</button>
        <button data-acc="mas" data-id="${esc(x.id)}" aria-label="Más">+</button>
      </div>
      <button class="mini suave-b" data-acc="editarLinea" data-id="${esc(x.id)}" aria-label="Editar ${esc(x.nombre)}">Editar</button>
      <button class="mini suave-b peligro" data-acc="quitar" data-id="${esc(x.id)}" aria-label="Quitar ${esc(x.nombre)}">Quitar</button>
    </div>
  </div>`;
}

// Edad del precio en pocas letras, para las casillas de la tabla de precios.
function edadCorta(e) {
  if (!e || e.precio == null) return '—';
  if (!e.actualizado) return 'Excel';
  const d = diasDesde(e.actualizado);
  return d <= 0 ? 'hoy' : `${d} d`;
}

// Tarjeta con lo que cuesta la receta (cantidades tal como están escritas) en cada tienda y repartiendo.
function resumenCosteReceta(receta, items) {
  const { elecciones, ajustes } = store.estado;
  const c = costeReceta(items, elecciones, ajustes.tiendas, Number(ajustes.ahorroMin) || 0);
  const completas = c.porTienda.filter((x) => x.faltan === 0);
  const minimo = completas.length ? Math.min(...completas.map((x) => x.total)) : null;
  const falta = (n) => `faltan ${n} ${n === 1 ? 'precio' : 'precios'}`;
  const filas = c.porTienda.map((x) => {
    const sinNada = x.faltan === items.length;
    const mejor = x.faltan === 0 && x.total === minimo && completas.length > 1;
    return `<div class="coste-fila${mejor ? ' mejor' : ''}${x.faltan ? ' incompleto' : ''}">
      <span class="t">${punto(x.t)}${nombreTienda(x.t)}</span>
      <span class="num coste-imp">${sinNada ? '—' : euro.format(x.total)}</span>
      <span class="coste-nota">${x.faltan ? falta(x.faltan) : mejor ? 'la más barata' : ''}</span></div>`;
  }).join('');
  const r = c.repartido;
  const ahorro = r.faltan === 0 && minimo != null ? minimo - r.total : 0;
  const reparto = r.faltan
    ? `<span class="suave">${falta(r.faltan)}</span>`
    : `<strong class="num">${euro.format(r.total)}</strong>${ahorro > 0.005 ? ` <span class="suave">· ahorras ${euro.format(ahorro)} frente a la más barata</span>` : ''}`;
  return `<section class="tarjeta coste"><div class="bloque">
    <div class="bloque-cab"><h2>Coste de la receta</h2><span class="suave">para ${receta.personas === 1 ? '1 persona' : '2 personas'}</span></div>
    ${filas}
    <div class="coste-reparto"><span>Repartiendo entre tiendas</span><span>${reparto}</span></div>
    <p class="nota-min">${chipAhorroMin(ajustes)}</p>
  </div></section>`;
}

function vistaPrecios() {
  const { ingredientes, elecciones, ajustes } = store.estado;
  const dias = Number(ajustes.diasCaducidad) || 7;
  const tiendas = ajustes.tiendas;
  // Columnas de la tabla: las cadenas. Para la carne, Halal ocupa el sitio de Dia.
  const cab = tiendas.filter((t) => t !== 'halal');
  const celdasDe = (it) => {
    if (!it.carne) return tiendasDe(it, cab);
    const c = cab.map((t) => (t === 'dia' ? 'halal' : t)).filter((t) => t !== 'halal' || tiendas.includes('halal'));
    if (tiendas.includes('halal') && !c.includes('halal')) c.push('halal'); // Dia desactivada: Halal al final
    return c;
  };
  const modo = ui.preciosModo;
  const q = ui.buscarPrecio.trim().toLowerCase();
  const recetas = recetasOrdenadas();
  // Vista «Receta»: sus ingredientes (con la cantidad de la receta) y lo que cuesta.
  let receta = null;
  if (modo === 'receta') {
    receta = store.estado.recetas[ui.preciosReceta] || recetas[0] || null;
    ui.preciosReceta = receta?.id ?? null;
  }
  const itemsReceta = receta
    ? receta.ingredientes.flatMap((x) => {
      const i = ingrediente(x.ingrediente_id);
      return i ? [{ id: i.id, nombre: i.nombre, consulta: i.consulta, modo: i.modo || 'unidad', carne: Boolean(i.carne), cantidad: Number(x.cantidad) }] : [];
    })
    : [];
  const base = modo === 'receta'
    ? itemsReceta
    : modo === 'todos'
      ? ingredientes.map((i) => ({ id: i.id, nombre: i.nombre, consulta: i.consulta, modo: i.modo || 'unidad', carne: Boolean(i.carne) }))
      : itemsLista();
  const filas = base.filter((it) => !q || it.nombre.toLowerCase().includes(q)).sort(porNombre);
  const explica = {
    lista: 'Todo lo que hay en la lista de la compra.',
    todos: 'Todos los ingredientes, estén o no en la lista.',
    receta: 'Los ingredientes de una receta, sus precios y lo que cuesta.',
  }[modo];

  let h = `<div class="cabecera"><div><h1>Precios</h1><p class="suave">${explica}</p></div></div>
    <div class="segmentos" role="group" aria-label="Qué precios ver">${MODOS_PRECIO.map((m) =>
      `<button data-acc="modoPrecios" data-modo="${m.id}" aria-pressed="${m.id === modo}">${m.nombre}</button>`).join('')}</div>`;
  if (modo === 'receta') {
    if (!recetas.length) {
      return h + `<div class="vacio"><h2>Aún no hay recetas</h2><p>Crea una receta y aquí verás sus precios y lo que cuesta.</p>
        <button class="primario" data-acc="ir" data-tab="recetas">Ir a Recetas</button></div>`;
    }
    h += `<p><select data-acc="recetaPrecios" aria-label="Receta">${recetas.map((r) =>
      `<option value="${esc(r.id)}" ${r.id === receta.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select></p>`;
  }
  h += `<p><input type="search" id="buscarPrecio" data-acc="buscarPrecio" placeholder="Buscar ingrediente" value="${esc(ui.buscarPrecio)}" autocomplete="off"></p>
    <p class="suave">Escribe el precio y pasa a la siguiente casilla: se guarda solo. ↗ abre el producto en la web de la tienda. Los productos al peso van en €/kg.</p>`;
  if (receta && itemsReceta.length) h += resumenCosteReceta(receta, itemsReceta);
  if (modo === 'lista' && !itemsLista().length) {
    return h + `<div class="vacio"><p>La lista está vacía.</p><button data-acc="modoPrecios" data-modo="todos">Ver todos los ingredientes</button></div>`;
  }
  if (!filas.length) {
    return h + `<div class="vacio"><p>${q ? 'Sin resultados.' : 'No hay ingredientes que mostrar.'}</p></div>`;
  }

  const cols = Math.max(cab.length, ...filas.map((it) => celdasDe(it).length));
  h += `<section class="tarjeta tabla-precios" style="--cols:${cols}">
    <div class="tp-cab">${cab.map((t) => `<span>${punto(t)}${nombreTienda(t)}</span>`).join('')}</div>`;
  for (const it of filas) {
    const celdas = celdasDe(it);
    // Si las tiendas de la fila no coinciden con las columnas (carne: Halal en lugar de Dia), cada casilla dice cuál es.
    const rotular = celdas.some((t, i) => t !== cab[i]);
    const cant = modo === 'receta' ? ` <span class="tp-cant">${fmtCantidad(it.modo, it.cantidad)}</span>` : '';
    h += `<div class="tp-fila"><div class="tp-nombre">${esc(it.nombre)}${it.modo === 'peso' ? ' <span class="etq">€/kg</span>' : ''}${cant}</div><div class="tp-celdas">`;
    for (const t of celdas) {
      const e = elecciones[`${it.id}|${t}`];
      const enlace = enlaceTienda(t, it.consulta, e);
      const clases = ['tp-celda'];
      if (esAntiguo(e, dias)) clases.push('vieja');
      else if (e.origen === 'auto') clases.push('auto');
      h += `<div class="${clases.join(' ')}">${rotular ? `<span class="tp-tienda">${punto(t)}${nombreTienda(t)}</span>` : ''}
        <input type="text" inputmode="decimal" autocomplete="off" data-acc="precio" data-id="${esc(it.id)}" data-t="${t}"
          value="${e?.precio != null ? Number(e.precio).toFixed(2).replace('.', ',') : ''}" placeholder="—"
          aria-label="Precio de ${esc(it.nombre)} en ${nombreTienda(t)}${it.modo === 'peso' ? ' (€/kg)' : ''}">
        <span class="tp-info"><span>${edadCorta(e)}</span>${enlace ? `<a href="${esc(enlace)}" target="_blank" rel="noopener"
          data-acc="abrir" data-id="${esc(it.id)}" data-t="${t}" aria-label="Abrir ${esc(it.nombre)} en ${nombreTienda(t)}">↗</a>` : ''}</span></div>`;
    }
    h += '</div></div>';
  }
  return h + '</section>';
}

function vistaProductos() {
  const { ingredientes, elecciones, ajustes, candidatos } = store.estado;
  const dias = Number(ajustes.diasCaducidad) || 7;
  const q = ui.buscarProd.trim().toLowerCase();
  const lista = ingredientes.filter((i) => !q || i.nombre.toLowerCase().includes(q)).sort(porNombre);
  let h = `<div class="cabecera"><h1>Productos</h1><button class="primario" data-acc="nuevoIng">＋ Nuevo</button></div>
    <p class="suave">Elige qué producto compras en cada tienda. En BM y Eroski escoges de una lista y su precio se actualiza solo; en Dia, Carrefour y Halal lo anotas a mano. Activa «Al peso» en lo que compras por kilos y «Carne» en lo que compras en la carnicería (allí va Halal en lugar de Dia).</p>
    <p><input type="search" id="buscarProd" data-acc="buscarProd" placeholder="Buscar ingrediente" value="${esc(ui.buscarProd)}" autocomplete="off"></p>`;
  for (const ing of lista) {
    const peso = ing.modo === 'peso';
    h += `<section class="tarjeta"><div class="bloque"><div class="bloque-cab"><h2>${esc(ing.nombre)}</h2>
      <div class="interruptores">
        <label class="interruptor"><input type="checkbox" data-acc="carne" data-id="${esc(ing.id)}" ${ing.carne ? 'checked' : ''}> Carne</label>
        <label class="interruptor"><input type="checkbox" data-acc="peso" data-id="${esc(ing.id)}" ${peso ? 'checked' : ''}> Al peso</label>
      </div></div>`;
    for (const t of tiendasDe(ing, TIENDAS.map((x) => x.id))) {
      const e = elecciones[`${ing.id}|${t}`];
      const hayCand = candidatos?.ingredientes?.[ing.id]?.[t]?.length;
      h += `<div class="fila-prod"><div class="arriba"><span class="t">${punto(t)}${nombreTienda(t)}</span>
          ${AUTO.has(t) && hayCand ? `<button class="mini" data-acc="elegir" data-id="${esc(ing.id)}" data-t="${t}">Elegir</button>` : ''}
          <button class="mini suave-b" data-acc="nombre" data-id="${esc(ing.id)}" data-t="${t}">Editar</button></div>
        <div class="abajo">${e?.nombre ? limpiar(e.nombre) + ' · ' : ''}${e?.precio != null ? `<strong class="num">${euro.format(e.precio)}${peso ? '/kg' : ''}</strong> ` : '<span>sin precio </span>'}${etiqueta(e, dias)}</div></div>`;
    }
    h += '</div></section>';
  }
  return h;
}

const avisoTablas = () => (store.faltanTablas
  ? '<div class="aviso"><span>Falta crear las tablas de recetas y menú en Supabase: pega <strong>sql/schema.sql</strong> en el SQL Editor y pulsa Run.</span></div>'
  : '');

// "500 g pollo · 2 garbanzos"
function resumenIngredientes(receta) {
  return receta.ingredientes
    .map((x) => ({ ing: ingrediente(x.ingrediente_id), c: Number(x.cantidad) }))
    .filter((x) => x.ing)
    .sort((a, b) => a.ing.nombre.localeCompare(b.ing.nombre, 'es'))
    .map((x) => `${fmtCantidad(x.ing.modo, x.c)} ${esc(x.ing.nombre)}`)
    .join(' · ');
}

const recetasOrdenadas = () => Object.values(store.estado.recetas).sort(porNombre);

function vistaRecetas() {
  const { menu } = store.estado;
  const recetas = recetasOrdenadas();
  let h = `<div class="cabecera"><h1>Recetas</h1><button class="primario" data-acc="nuevaReceta">＋ Nueva</button></div>${avisoTablas()}`;
  if (!recetas.length) {
    return h + `<div class="vacio">
      <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 30h44v6a16 16 0 0 1-16 16H26a16 16 0 0 1-16-16v-6Z"/><path d="M6 30h52M24 22c0-4 3-4 3-8M32 22c0-4 3-4 3-8M40 22c0-4 3-4 3-8"/></svg>
      <h2>Aún no hay recetas</h2>
      <p>Una receta es un nombre y sus ingredientes con la cantidad que se compra. Luego podéis ponerlas en el menú de la semana.</p>
      <button class="primario" data-acc="nuevaReceta">Crear una receta</button></div>`;
  }
  for (const r of recetas) {
    const usos = Object.values(menu).filter((v) => v === r.id).length;
    h += `<section class="tarjeta"><div class="bloque">
      <div class="bloque-cab"><h2>${esc(r.nombre)}${r.personas === 1 ? ' <span class="etq">para 1</span>' : ''}</h2><button class="mini suave-b" data-acc="editarReceta" data-id="${esc(r.id)}">Editar</button></div>
      <p class="suave">${resumenIngredientes(r) || 'Sin ingredientes'}</p>
      <div class="pie-receta"><span class="suave">${usos ? `En el menú ${usos} ${usos === 1 ? 'vez' : 'veces'}` : 'No está en el menú'}</span>
        <button class="mini" data-acc="recetaALista" data-id="${esc(r.id)}">Añadir a la compra</button></div>
    </div></section>`;
  }
  return h;
}

const conDesayuno = () => store.estado.ajustes.desayuno !== false;
const comidasVisibles = () => COMIDAS.filter((c) => c.id !== 'desayuno' || conDesayuno());
const nombresP = () => {
  const n = store.estado.ajustes.nombres;
  return [n?.[0] || 'Persona 1', n?.[1] || 'Persona 2'];
};
const nombreP = (q) => nombresP()[q === 'p2' ? 1 : 0];
const esSeparada = (d, c) => `${d}|${c}|p1` in store.estado.menu || `${d}|${c}|p2` in store.estado.menu;

// Huecos del menú con receta que cuentan para la compra (si el desayuno está oculto, no cuenta).
const huecosMenu = () => {
  const visibles = new Set(comidasVisibles().map((c) => c.id));
  return Object.entries(store.estado.menu).flatMap(([k, rid]) => {
    const [dia, comida, quien] = k.split('|');
    const r = rid && store.estado.recetas[rid];
    if (!r || !visibles.has(comida)) return [];
    return [{ dia, comida, quien, receta_id: rid, factor: factorMenu(r.personas, quien) }];
  });
};

function selectorReceta(d, c, quien, etiqueta, recetas) {
  const actual = store.estado.menu[`${d}|${c.id}|${quien}`];
  return `<label class="linea-menu"><span>${esc(etiqueta)}</span>
    <select data-acc="menu" data-dia="${d}" data-comida="${c.id}" data-quien="${quien}" aria-label="${esc(c.nombre)} del ${DIAS[d].toLowerCase()}, ${esc(etiqueta)}">
      <option value="">—</option>
      ${recetas.map((r) => `<option value="${esc(r.id)}" ${r.id === actual ? 'selected' : ''}>${esc(r.nombre)}${r.personas === 1 ? ' (1 pers.)' : ''}</option>`).join('')}
    </select></label>`;
}

function bloqueComida(d, c, recetas, ver) {
  const sep = esSeparada(d, c.id);
  const boton = (valor, texto, activo) => `<button data-acc="modoComida" data-dia="${d}" data-comida="${c.id}" data-sep="${valor}" aria-pressed="${activo}">${texto}</button>`;
  let cuerpo;
  if (!sep) {
    cuerpo = selectorReceta(d, c, 'ambos', 'Los dos', recetas);
  } else {
    const quienes = ver === 'mio' ? [ui.yo] : ['p1', 'p2'];
    cuerpo = quienes.map((q) => selectorReceta(d, c, q, nombreP(q), recetas)).join('');
    if (ver === 'mio') {
      const otro = ui.yo === 'p1' ? 'p2' : 'p1';
      const r = store.estado.recetas[store.estado.menu[`${d}|${c.id}|${otro}`]];
      cuerpo += `<p class="suave otro-menu">${esc(nombreP(otro))}: ${r ? esc(r.nombre) : 'sin receta'}</p>`;
    }
  }
  return `<div class="comida-menu"><div class="cm-cab"><strong>${c.nombre}</strong>
    <div class="segmentos mini" role="group" aria-label="Cómo coméis: ${c.nombre}">${boton(0, 'Juntos', !sep)}${boton(1, 'Separados', sep)}</div></div>${cuerpo}</div>`;
}

function vistaMenu() {
  const { menu } = store.estado;
  const recetas = recetasOrdenadas();
  const hoy = (new Date().getDay() + 6) % 7;
  const todos = huecosMenu();
  const n = todos.length;
  const ver = ui.yo ? ui.menuVer : 'todos';
  let h = `<div class="cabecera"><div><h1>Menú</h1><p class="suave">${n ? `${n} ${n === 1 ? 'plato planificado' : 'platos planificados'}` : 'Elige una receta para cada comida'}</p></div>
    <label class="interruptor"><input type="checkbox" data-acc="desayuno" ${conDesayuno() ? 'checked' : ''}> Desayuno</label></div>${avisoTablas()}`;
  if (!ui.yo) {
    h += `<section class="tarjeta"><div class="bloque"><h2>¿Quién eres?</h2>
      <p class="suave">Así este móvil abre directamente tu menú. Se guarda solo en este móvil y se cambia en Ajustes.</p>
      <div class="quien">${['p1', 'p2'].map((q) => `<button class="primario" data-acc="soyYo" data-q="${q}">${esc(nombreP(q))}</button>`).join('')}</div></div></section>`;
  } else {
    h += `<div class="segmentos" role="group" aria-label="Qué menú ver">
      <button data-acc="verMenu" data-ver="mio" aria-pressed="${ver === 'mio'}">Mi menú · ${esc(nombreP(ui.yo))}</button>
      <button data-acc="verMenu" data-ver="todos" aria-pressed="${ver === 'todos'}">Los dos</button></div>`;
  }
  if (!recetas.length) {
    return h + `<div class="vacio"><h2>Primero, las recetas</h2><p>Crea alguna receta y después elígela aquí para cada día.</p>
      <button class="primario" data-acc="ir" data-tab="recetas">Ir a Recetas</button></div>`;
  }
  h += `<div class="acciones-menu"><button class="primario" data-acc="menuALista" ${n ? '' : 'disabled'}>Pasar todo</button>
    <button data-acc="vaciarMenu" ${Object.keys(menu).length ? '' : 'disabled'}>Vaciar semana</button></div>
    <p class="suave nota-menu">«Pasar todo» y «Pasar a la lista» suman el menú de los dos, lo veas como lo veas.</p>`;
  for (let d = 0; d < 7; d++) {
    const nDia = todos.filter((x) => Number(x.dia) === d).length;
    const pasado = ui.pasados.has(d);
    h += `<section class="tarjeta dia${d === hoy ? ' hoy' : ''}${d >= 5 ? ' finde' : ''}">
      <header class="dia-cab"><span class="dia-ini" aria-hidden="true">${INICIALES[d]}</span>
        <h2>${DIAS[d]}</h2>${d === hoy ? '<span class="etq-hoy">Hoy</span>' : ''}
        <button class="mini dia-pasar${pasado ? ' hecho' : ''}" data-acc="diaALista" data-dia="${d}" ${nDia ? '' : 'disabled'}>${pasado ? 'Pasado ✓' : 'Pasar a la lista'}</button></header>
      <div class="bloque">${comidasVisibles().map((c) => bloqueComida(d, c, recetas, ver)).join('')}</div></section>`;
  }
  return h;
}

// Menú y Recetas comparten pestaña: un selector arriba elige cuál se ve.
function vistaCocina() {
  const sel = `<div class="segmentos" role="group" aria-label="Menú o recetas">${COCINA.map((c) =>
    `<button data-acc="verCocina" data-ver="${c.id}" aria-pressed="${ui.cocina === c.id}">${c.nombre}</button>`).join('')}</div>`;
  return sel + (ui.cocina === 'recetas' ? vistaRecetas() : vistaMenu());
}

const redondear2 = (n) => Math.round(n * 100) / 100;
const fmtFecha = (iso) => new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

function vistaCompras() {
  const { compras } = store.estado;
  const orden = [...compras].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  let h = `<div class="cabecera"><div><h1>Compras</h1><p class="suave">Lo que habéis gastado en cada compra.</p></div></div>`;
  if (store.faltanCompras) {
    h += `<div class="aviso"><span>Falta la tabla de compras en Supabase: pega <code>sql/schema.sql</code> en el SQL Editor y pulsa Run.</span></div>`;
  }
  if (!orden.length) {
    return h + `<div class="vacio"><h2>Aún no hay compras</h2>
      <p>En la lista, marca lo que vayas metiendo en el carrito y pulsa «Compra finalizada». Aquí quedará el total de cada compra.</p>
      <button class="primario" data-acc="ir" data-tab="lista">Ir a la lista</button></div>`;
  }
  const meses = new Map();
  for (const c of orden) {
    const d = new Date(c.fecha);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = meses.get(k) || { nombre: d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }), n: 0, total: 0 };
    m.n++;
    m.total += Number(c.total) || 0;
    meses.set(k, m);
  }
  h += `<section class="tarjeta"><div class="bloque"><h2>Por meses</h2>${[...meses.values()].map((m) =>
    `<div class="coste-reparto"><span>${esc(m.nombre)} <span class="suave">· ${m.n} ${m.n === 1 ? 'compra' : 'compras'}</span></span><strong class="num">${euro.format(m.total)}</strong></div>`).join('')}</div></section>`;
  for (const c of orden) {
    const abierta = ui.compraAbierta.has(c.id);
    const tiendas = [...new Set(c.lineas.map((x) => x.tienda).filter(Boolean))];
    h += `<section class="tarjeta compra"><button class="compra-cab" data-acc="verCompra" data-id="${esc(c.id)}" aria-expanded="${abierta}">
      <span><strong>${esc(fmtFecha(c.fecha))}</strong><span class="suave compra-sub">${c.lineas.length} ${c.lineas.length === 1 ? 'producto' : 'productos'}${tiendas.length ? ` · ${tiendas.map((t) => esc(nombreTienda(t))).join(', ')}` : ''}</span></span>
      <span class="num compra-total">${euro.format(c.total)}</span></button>`;
    if (abierta) {
      const por = {};
      for (const x of c.lineas) (por[x.tienda || ''] ||= []).push(x);
      h += Object.entries(por).map(([t, ls]) => `<div class="compra-tienda"><div class="tienda-cab">${t ? punto(t) : ''}<h2>${t ? esc(nombreTienda(t)) : 'Sin precio'}</h2>
        <span class="total num">${euro.format(ls.reduce((s, x) => s + (Number(x.coste) || 0), 0))}</span></div>
        ${ls.sort(porNombre).map((x) => `<div class="compra-linea"><span>${esc(x.nombre)} <span class="suave">${fmtCantidad(x.modo, Number(x.cantidad))}</span></span>
          <span class="num">${x.coste ? euro.format(x.coste) : '—'}</span></div>`).join('')}</div>`).join('');
      h += `<p class="pie-lista"><button class="peligro" data-acc="borrarCompra" data-id="${esc(c.id)}">Borrar esta compra</button></p>`;
    }
    h += '</section>';
  }
  return h;
}

// Hoja para cambiar cuánto se compra, dónde y a qué precio una línea de la lista.
function abrirEditarLinea(id) {
  const { elecciones, ajustes } = store.estado;
  const items = itemsLista();
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const r = repartirLista(items, elecciones, ajustes.tiendas, Number(ajustes.ahorroMin) || 0);
  const actual = r.porTienda.flatMap((p) => p.items).find((x) => x.id === id);
  const tSel = it.tienda_compra || actual?.t || ajustes.tiendas[0];
  const precio = it.precio_pagado ?? actual?.e?.precio ?? elecciones[`${id}|${tSel}`]?.precio ?? null;
  const peso = it.modo === 'peso';
  ui.le = { id, auto: actual && !actual.fijo ? { t: actual.t, precio: actual.e.precio } : null };
  ui.hoja = 'linea';
  hoja.innerHTML = `<div class="hoja-int">
    <div class="hoja-cab"><h2>${esc(it.nombre)}</h2><button class="icono" data-acc="cerrar" aria-label="Cerrar">✕</button></div>
    <label class="campo"><span>${peso ? 'Gramos' : 'Unidades'}</span>
      <input type="text" inputmode="decimal" id="leCant" autocomplete="off" value="${peso ? Math.round(it.cantidad * 1000) : it.cantidad}"></label>
    <label class="campo"><span>Tienda donde lo compras</span>
      <select id="leTienda" data-acc="leTienda">${TIENDAS.map((t) => `<option value="${t.id}" ${t.id === tSel ? 'selected' : ''}>${t.nombre}</option>`).join('')}</select></label>
    <label class="campo"><span>Precio ${peso ? '(€/kg)' : '(€ por unidad)'}</span>
      <input type="text" inputmode="decimal" id="lePrecio" autocomplete="off" placeholder="Sin precio" value="${precio != null ? Number(precio).toFixed(2).replace('.', ',') : ''}"></label>
    <p class="suave">Si lo compras en otra tienda o a otro precio, se guarda solo para esta línea y no cambia los precios de Precios.</p>
    <button class="primario" data-acc="guardarLinea">Guardar</button>
    ${it.tienda_compra ? '<button data-acc="autoLinea">Volver al reparto automático</button>' : ''}
  </div>`;
  hoja.showModal();
}

function vistaAjustes() {
  const { ajustes } = store.estado;
  const local = store.modo === 'local';
  return `<div class="cabecera"><h1>Ajustes</h1></div>
    <section class="tarjeta">
      <div class="ajuste"><strong>Tiendas que usáis</strong>
        ${TIENDAS.map((t) => `<label class="linea"><span>${punto(t.id)} ${t.nombre}</span>
          <input class="redonda" type="checkbox" data-acc="tienda" data-id="${t.id}" ${ajustes.tiendas.includes(t.id) ? 'checked' : ''}></label>`).join('')}
        <p class="suave">Marca solo las que os queden cerca. Halal es la carnicería: solo se usa para los ingredientes marcados como «Carne», y para ellos sustituye a Dia.</p></div>
      <div class="ajuste"><strong>Quiénes sois</strong>
        ${[0, 1].map((i) => `<label class="linea"><span>Persona ${i + 1}</span>
          <input class="nombre-p" type="text" data-acc="nombresP" data-i="${i}" value="${esc(nombresP()[i])}" aria-label="Nombre de la persona ${i + 1}" autocomplete="off"></label>`).join('')}
        <p class="suave">Para el menú por persona. Este móvil es de:</p>
        <div class="segmentos">${['p1', 'p2'].map((q) => `<button data-acc="soyYo" data-q="${q}" aria-pressed="${ui.yo === q}">${esc(nombreP(q))}</button>`).join('')}</div></div>
      <div class="ajuste"><label class="linea"><strong>Ahorro mínimo por tienda</strong>
        <input class="corto" type="text" inputmode="decimal" data-acc="ahorro" value="${String(ajustes.ahorroMin).replace('.', ',')}" aria-label="Ahorro mínimo en euros"></label>
        <p class="suave">Si ir a una tienda ahorra menos de estos euros, esos productos pasan a otra tienda. Pon 0 para desactivarlo.</p></div>
      <div class="ajuste"><label class="linea"><strong>Precio antiguo a los (días)</strong>
        <input class="corto" type="text" inputmode="numeric" data-acc="dias" value="${ajustes.diasCaducidad}" aria-label="Días hasta considerar un precio antiguo"></label></div>
    </section>
    <section class="tarjeta"><div class="ajuste"><strong>Datos</strong>
      <p class="suave">${local ? 'Modo local: los datos están solo en este navegador. Para compartirlos entre móviles hay que configurar Supabase (ver README).' : 'Conectado a Supabase: los datos se comparten entre vuestros móviles.'}</p>
      ${local ? `<p><button data-acc="exportar">Descargar copia</button></p>
        <p><label class="suave">Restaurar copia: <input type="file" accept="application/json" data-acc="importar"></label></p>
        <p><button class="peligro" data-acc="reiniciar">Borrar todo y empezar de nuevo</button></p>`
      : '<p><button data-acc="salir">Cerrar sesión</button></p>'}
    </div></section>
    <p class="suave centro version">Versión ${esc(VERSION)}</p>`;
}

// ------------------------------------------------------------------ hojas inferiores
function abrirAdd() {
  ui.hoja = 'add';
  ui.buscarAdd = '';
  hoja.innerHTML = `<div class="hoja-int">
    <div class="hoja-cab"><h2>Añadir a la lista</h2><button class="icono" data-acc="cerrar" aria-label="Cerrar">✕</button></div>
    <input type="search" id="buscarAdd" data-acc="buscarAdd" placeholder="Buscar ingrediente" autocomplete="off">
    <div id="resAdd" class="hoja-lista"></div>
    <button class="primario" data-acc="cerrar">Listo</button></div>`;
  pintarAdd();
  hoja.showModal();
}

function pintarAdd() {
  const el = $('#resAdd');
  if (!el) return;
  const { ingredientes, lista } = store.estado;
  const q = ui.buscarAdd.trim().toLowerCase();
  const filas = ingredientes.filter((i) => !q || i.nombre.toLowerCase().includes(q)).sort(porNombre);
  el.innerHTML =
    filas
      .map((i) => `<button class="add-fila ${lista[i.id] ? 'en' : ''}" data-acc="toggleAdd" data-id="${esc(i.id)}">
        <span>${esc(i.nombre)} ${i.modo === 'peso' ? '<span class="etq kg">€/kg</span>' : ''}</span>
        <span class="marca">${lista[i.id] ? '✓' : ''}</span></button>`)
      .join('') || '<p class="suave">Sin resultados.</p>';
}

function abrirCandidatos(ingId, t) {
  const ing = ingrediente(ingId);
  const peso = ing.modo === 'peso';
  const cands = store.estado.candidatos?.ingredientes?.[ingId]?.[t] || [];
  ui.hoja = 'cand';
  ui.candidato = { ingId, t, cands };
  hoja.innerHTML = `<div class="hoja-int">
    <div class="hoja-cab"><div><h2>${esc(ing.nombre)}</h2><div class="suave">${nombreTienda(t)}${peso ? ' · se compra al peso' : ''}</div></div>
      <button class="icono" data-acc="cerrar" aria-label="Cerrar">✕</button></div>
    <div class="hoja-lista">${cands.map((c, k) => {
      const valido = !peso || (c.unidad === 'kg' && c.precio_unidad != null);
      const principal = peso && valido ? `${euro.format(c.precio_unidad)}/kg` : euro.format(c.precio);
      return `<div class="cand"><div class="n">${limpiar(c.nombre)}</div>
        <div class="suave num">${c.precio_unidad != null ? `${euro.format(c.precio_unidad)}/${c.unidad} · ` : ''}envase ${euro.format(c.precio)}${valido ? '' : ' · sin precio por kilo'}</div>
        <div class="p"><strong class="num">${principal}</strong>
          <button class="mini primario" data-acc="cand" data-i="${k}" ${valido ? '' : 'disabled'}>Elegir</button></div></div>`;
    }).join('') || '<p class="suave">No hay candidatos. Ejecuta «node scraper/run.mjs candidatos».</p>'}</div></div>`;
  hoja.showModal();
}

// Hoja «Nuevo ingrediente»: nombre, tipo y el precio de cada tienda, todo de una vez.
function abrirNuevoIng() {
  ui.ni = { nombre: '', peso: false, carne: false, precios: {} };
  ui.hoja = 'nuevo';
  hoja.innerHTML = `<div class="hoja-int">
    <div class="hoja-cab"><h2>Nuevo ingrediente</h2><button class="icono" data-acc="cerrar" aria-label="Cerrar">✕</button></div>
    <input type="text" id="niNombre" data-acc="niNombre" placeholder="Nombre, p. ej. kiwi" autocomplete="off">
    <div class="interruptores izq">
      <label class="interruptor"><input type="checkbox" data-acc="niCarne"> Carne</label>
      <label class="interruptor"><input type="checkbox" data-acc="niPeso"> Al peso</label></div>
    <div class="hoja-lista"><p class="suave" id="niAyuda"></p><div id="niTiendas"></div></div>
    <div class="hoja-pie"><button data-acc="cerrar">Cancelar</button><button class="primario" data-acc="crearIng">Crear ingrediente</button></div></div>`;
  pintarNi();
  hoja.showModal();
  $('#niNombre').focus();
}

function pintarNi() {
  const ni = ui.ni;
  const cont = $('#niTiendas');
  if (!ni || !cont) return;
  const u = ni.peso ? '€/kg' : '€';
  $('#niAyuda').textContent = `Los precios son opcionales y se pueden anotar después. ${ni.peso ? 'Al peso: el precio es por kilo. ' : ''}${ni.carne ? 'La carne se compra en Halal, no en Dia.' : ''}`;
  cont.innerHTML = tiendasDe({ carne: ni.carne }, TIENDAS.map((x) => x.id)).map((t) => `<div class="rec-fila ni-fila">
      <span class="n">${punto(t)}${nombreTienda(t)}</span>
      <span class="campo-precio"><input type="text" inputmode="decimal" autocomplete="off" data-acc="niPrecio" data-t="${t}" value="${esc(ni.precios[t] ?? '')}"
        placeholder="0,00" aria-label="Precio en ${nombreTienda(t)}"><span class="u">${u}</span></span></div>`).join('');
}

// Hoja «Editar producto»: nombre del producto de la tienda y su precio.
function abrirEditarProducto(id, t) {
  const ing = ingrediente(id);
  const e = store.estado.elecciones[`${id}|${t}`];
  const peso = ing.modo === 'peso';
  ui.ep = { id, t };
  ui.hoja = 'producto';
  hoja.innerHTML = `<div class="hoja-int">
    <div class="hoja-cab"><div><h2>${esc(ing.nombre)}</h2><div class="suave">${nombreTienda(t)}</div></div>
      <button class="icono" data-acc="cerrar" aria-label="Cerrar">✕</button></div>
    <label class="campo">Producto <span class="suave">(opcional, p. ej. «Leche Hacendado»)</span>
      <input type="text" id="epNombre" value="${esc(e?.nombre || '')}" autocomplete="off"></label>
    <label class="campo">Precio <span class="suave">(${peso ? '€ por kilo' : '€'})</span>
      <input type="text" id="epPrecio" inputmode="decimal" placeholder="0,00" value="${e?.precio != null ? Number(e.precio).toFixed(2).replace('.', ',') : ''}" autocomplete="off"></label>
    ${e?.origen === 'auto' ? '<p class="suave">Este precio se actualiza solo cada día. Si lo cambias a mano, dejará de actualizarse.</p>' : ''}
    <div class="hoja-pie"><button data-acc="cerrar">Cancelar</button><button class="primario" data-acc="guardarProducto">Guardar</button></div></div>`;
  hoja.showModal();
  $('#epPrecio').focus();
}

// Editor de recetas: se trabaja sobre un borrador (ui.receta) y se guarda al pulsar «Guardar».
function abrirReceta(id) {
  const r = id ? store.estado.recetas[id] : null;
  ui.receta = {
    id: r?.id || null,
    nombre: r?.nombre || '',
    personas: r?.personas === 1 ? 1 : 2,
    items: Object.fromEntries((r?.ingredientes || []).map((x) => [x.ingrediente_id, Number(x.cantidad)])),
  };
  ui.buscarRec = '';
  ui.hoja = 'receta';
  hoja.innerHTML = `<div class="hoja-int">
    <div class="hoja-cab"><h2>${r ? 'Editar receta' : 'Nueva receta'}</h2><button class="icono" data-acc="cerrar" aria-label="Cerrar">✕</button></div>
    <input type="text" id="recNombre" data-acc="recNombre" placeholder="Nombre, p. ej. Pollo al curry" value="${esc(ui.receta.nombre)}" autocomplete="off">
    <div class="segmentos" id="recPers" role="group" aria-label="Para cuántas personas es la receta"></div>
    <div class="hoja-lista">
      <div id="recItems"></div>
      <h3 class="sub-h">Añadir ingredientes</h3>
      <input type="search" id="buscarRec" data-acc="buscarRec" placeholder="Buscar o crear ingrediente" autocomplete="off">
      <div id="recRes"></div>
    </div>
    <div class="hoja-pie">${r ? '<button class="peligro" data-acc="borrarReceta">Borrar</button>' : '<span></span>'}
      <button class="primario" data-acc="guardarReceta">Guardar receta</button></div></div>`;
  pintarReceta();
  hoja.showModal();
  if (!r) $('#recNombre').focus();
}

function pintarReceta() {
  const items = $('#recItems');
  const res = $('#recRes');
  if (!items || !ui.receta) return;
  $('#recPers').innerHTML = [[2, 'Para 2 personas'], [1, 'Para 1 persona']]
    .map(([n, txt]) => `<button data-acc="recPersonas" data-n="${n}" aria-pressed="${ui.receta.personas === n}">${txt}</button>`).join('');
  const borr = ui.receta.items;
  const elegidos = Object.keys(borr).map(ingrediente).filter(Boolean).sort(porNombre);
  items.innerHTML = elegidos.length
    ? elegidos.map((i) => `<div class="rec-fila"><span class="n">${esc(i.nombre)}</span>
        <div class="cantidad">
          <button data-acc="recMenos" data-id="${esc(i.id)}" aria-label="Menos">−</button>
          <button class="valor" data-acc="recCant" data-id="${esc(i.id)}" aria-label="Cambiar cantidad">${fmtCantidad(i.modo, borr[i.id])}</button>
          <button data-acc="recMas" data-id="${esc(i.id)}" aria-label="Más">+</button>
        </div>
        <button class="icono" data-acc="recQuitar" data-id="${esc(i.id)}" aria-label="Quitar ${esc(i.nombre)}">✕</button></div>`).join('')
    : '<p class="suave">Aún no hay ingredientes. Búscalos abajo.</p>';

  const q = ui.buscarRec.trim();
  const ql = q.toLowerCase();
  const filas = store.estado.ingredientes.filter((i) => !(i.id in borr) && (!ql || i.nombre.toLowerCase().includes(ql))).sort(porNombre);
  const existe = store.estado.ingredientes.some((i) => i.nombre.toLowerCase() === ql);
  res.innerHTML = filas.map((i) => `<button class="add-fila" data-acc="recAdd" data-id="${esc(i.id)}">
      <span>${esc(i.nombre)} ${i.modo === 'peso' ? '<span class="etq kg">€/kg</span>' : ''}</span><span class="marca">＋</span></button>`).join('')
    + (q && !existe
      ? `<div class="crear-ing"><button data-acc="recCrear" data-modo="unidad">＋ Crear «${esc(q)}»</button>
         <button data-acc="recCrear" data-modo="peso">＋ Crear «${esc(q)}» al peso</button></div>`
      : '')
    || '<p class="suave">No quedan más ingredientes.</p>';
}

function cambiarCantReceta(id, sentido) {
  const peso = esPeso(id);
  const paso = peso ? PASO_REC_KG : 1;
  const actual = ui.receta.items[id] || paso;
  ui.receta.items[id] = Math.max(paso, Math.round((actual + sentido * paso) * 1000) / 1000);
  pintarReceta();
}

// Mensaje breve abajo de la pantalla.
let temporizadorAviso;
function avisar(texto) {
  let el = document.getElementById('toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = texto;
  el.classList.add('ver');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => el.classList.remove('ver'), 2800);
}

// ------------------------------------------------------------------ pintar
// Selector que vuelve a encontrar un campo tras repintar (para no perder el foco al escribir).
function selectorDe(el) {
  const d = el.dataset;
  return ['acc', 'id', 't', 'dia', 'comida', 'quien', 'i'].filter((k) => d[k] != null)
    .map((k) => `[data-${k}="${CSS.escape(d[k])}"]`).join('');
}

function render() {
  document.querySelectorAll('#pestanas button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
  if (store.necesitaLogin) {
    vista.innerHTML = vistaLogin();
    return;
  }
  const act = document.activeElement;
  const foco = act && vista.contains(act) && act.dataset.acc && !act.matches('select') // devolver el foco a un select reabre su lista en el móvil
    ? { sel: selectorDe(act), texto: act.matches('input[type=text], input[type=search]'), valor: act.value, ini: act.selectionStart, fin: act.selectionEnd }
    : null;
  const vistas = { lista: vistaLista, cocina: vistaCocina, precios: vistaPrecios, productos: vistaProductos, compras: vistaCompras, ajustes: vistaAjustes };
  vista.innerHTML = vistas[ui.tab]();
  if (foco) {
    const el = vista.querySelector(foco.sel);
    if (el) {
      if (foco.texto) el.value = foco.valor;
      el.focus({ preventScroll: true });
      if (foco.texto) try { el.setSelectionRange(foco.ini, foco.fin); } catch { /* algunos campos no lo admiten */ }
    }
  }
  if (hoja.open && ui.hoja === 'add') pintarAdd();
  if (hoja.open && ui.hoja === 'receta') pintarReceta();
}

function irA(tab) {
  if (tab === 'menu' || tab === 'recetas') { ui.cocina = tab; tab = 'cocina'; } // enlaces y avisos antiguos
  ui.tab = TABS.includes(tab) ? tab : 'lista';
  history.replaceState(null, '', `#${ui.tab}`);
  render();
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ eventos
async function accion(fn) {
  try {
    await fn();
  } catch (e) {
    alert(`No se pudo guardar: ${e.message || e}`);
  }
}

// Tocar fuera cierra la hoja, salvo en el editor de recetas (para no perder lo escrito sin querer).
hoja.addEventListener('click', (ev) => { if (ev.target === hoja && !['receta', 'nuevo'].includes(ui.hoja)) hoja.close(); });
hoja.addEventListener('close', () => {
  if (hoja.open) return; // evento tardío de una hoja anterior: ya se ha abierto otra y no hay que borrar su estado
  ui.hoja = null; ui.receta = null; ui.ni = null; ui.ep = null; ui.le = null;
});

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-acc], #pestanas button');
  if (!b) return;
  if (b.dataset.tab && !b.dataset.acc) return irA(b.dataset.tab);
  const { acc, id, t } = b.dataset;
  const { lista, elecciones } = store.estado;
  switch (acc) {
    case 'ir':
      if (b.dataset.modo) ui.preciosModo = b.dataset.modo;
      return irA(b.dataset.tab);
    case 'abrirAdd': return abrirAdd();
    case 'verCocina': ui.cocina = b.dataset.ver; return render();
    case 'verCompra':
      if (!ui.compraAbierta.delete(id)) ui.compraAbierta.add(id);
      return render();
    case 'borrarCompra': {
      if (!confirm('Se borrará esta compra del historial. ¿Seguro?')) return;
      return accion(async () => { await store.borrarCompra(id); avisar('Compra borrada'); });
    }
    case 'editarLinea': return abrirEditarLinea(id);
    case 'autoLinea':
      return accion(async () => {
        await store.setLista(ui.le.id, { tienda_compra: null, precio_pagado: null });
        hoja.close();
      });
    case 'guardarLinea': {
      const { id: lid, auto } = ui.le;
      const peso = esPeso(lid);
      const v = aNumero($('#leCant').value);
      if (!Number.isFinite(v) || v <= 0) return alert('Escribe una cantidad mayor que 0.');
      const textoP = $('#lePrecio').value.trim();
      const p = textoP === '' ? null : aNumero(textoP);
      if (p !== null && (!Number.isFinite(p) || p < 0)) return alert('Escribe un precio válido, por ejemplo 2,50.');
      const tienda = $('#leTienda').value;
      const cantidad = peso ? Math.round(v) / 1000 : Math.max(1, Math.round(v));
      // Si queda igual que el reparto automático, no se fija nada: la línea sigue el reparto.
      const igual = auto && auto.t === tienda && (p === null || Math.abs(p - auto.precio) < 0.005) && !lista[lid]?.tienda_compra;
      return accion(async () => {
        await store.setLista(lid, igual ? { cantidad } : { cantidad, tienda_compra: tienda, precio_pagado: p });
        hoja.close();
      });
    }
    case 'finalizarCompra': {
      const { elecciones: el0, ajustes } = store.estado;
      const items = itemsLista();
      const r = repartirLista(items, el0, ajustes.tiendas, Number(ajustes.ahorroMin) || 0);
      const hechos = new Set(items.filter((x) => x.hecho).map((x) => x.id));
      if (!hechos.size) return;
      const lineas = [];
      for (const p of r.porTienda) {
        for (const x of p.items) {
          if (hechos.has(x.id)) lineas.push({ ingrediente_id: x.id, nombre: x.nombre, modo: x.modo, cantidad: x.cantidad, tienda: p.t, precio: x.e.precio, coste: redondear2(x.coste) });
        }
      }
      for (const x of r.sinPrecio) {
        if (hechos.has(x.id)) lineas.push({ ingrediente_id: x.id, nombre: x.nombre, modo: x.modo, cantidad: x.cantidad, tienda: null, precio: null, coste: 0 });
      }
      const total = redondear2(lineas.reduce((s, x) => s + x.coste, 0));
      if (!confirm(`Guardar esta compra: ${lineas.length} ${lineas.length === 1 ? 'producto' : 'productos'}, ${euro.format(total)}.\nSe quitan de la lista; lo que no esté marcado se queda.`)) return;
      return accion(async () => {
        await store.finalizarCompra({ fecha: new Date().toISOString(), total, lineas }, [...hechos]);
        avisar(`Compra guardada: ${euro.format(total)}`);
      });
    }
    case 'cerrar': return hoja.close();
    case 'toggleAdd': return accion(() => store.setLista(id, lista[id] ? null : { cantidad: cantidadInicial(id) }));
    case 'quitar': return accion(() => store.setLista(id, null));
    case 'mas':
    case 'menos': {
      const peso = esPeso(id);
      const paso = peso ? PASO_KG : 1;
      const min = paso;
      const n = Math.max(min, Math.round(((Number(lista[id]?.cantidad) || min) + (acc === 'mas' ? paso : -paso)) * 1000) / 1000);
      return accion(() => store.setLista(id, { cantidad: n }));
    }
    case 'cant': {
      const peso = esPeso(id);
      const actual = Number(lista[id]?.cantidad) || 1;
      const txt = prompt(peso ? `Gramos de ${ingrediente(id).nombre}:` : `Unidades de ${ingrediente(id).nombre}:`, peso ? Math.round(actual * 1000) : actual);
      if (txt === null) return;
      const v = Number(String(txt).trim().replace(',', '.'));
      if (!Number.isFinite(v) || v <= 0) return alert('Escribe un número mayor que 0.');
      return accion(() => store.setLista(id, { cantidad: peso ? Math.round(v) / 1000 : Math.max(1, Math.round(v)) }));
    }
    case 'limpiar':
      return accion(async () => {
        for (const [k, v] of Object.entries(lista)) if (v.hecho) await store.setLista(k, null);
      });
    case 'vaciarLista': {
      const n = Object.keys(lista).length;
      if (!n) return avisar('La lista ya está vacía');
      if (!confirm(`Se quitarán los ${n} ${n === 1 ? 'producto' : 'productos'} de la lista, también en el móvil del otro. ¿Seguro?`)) return;
      return accion(async () => {
        await store.vaciarLista();
        avisar('Lista vaciada');
      });
    }
    case 'modoPrecios': ui.preciosModo = b.dataset.modo; return render();
    case 'nuevoIng': return abrirNuevoIng();
    case 'crearIng': {
      const ni = ui.ni;
      const nombre = ni.nombre.trim().replace(/\s+/g, ' ');
      if (!nombre) { $('#niNombre').focus(); return alert('Escribe el nombre del ingrediente.'); }
      if (store.estado.ingredientes.some((i) => i.nombre.toLowerCase() === nombre.toLowerCase())) {
        return alert(`Ya existe «${nombre}». Búscalo en la lista de Productos.`);
      }
      const precios = {};
      for (const [tienda, texto] of Object.entries(ni.precios)) {
        if (!String(texto).trim()) continue;
        const v = aNumero(texto);
        if (!Number.isFinite(v) || v < 0) return alert(`El precio de ${nombreTienda(tienda)} no es válido. Escribe algo como 2,50.`);
        precios[tienda] = v;
      }
      const permitidas = new Set(tiendasDe({ carne: ni.carne }, TIENDAS.map((x) => x.id)));
      return accion(async () => {
        const nuevo = await store.crearIngrediente(nombre, ni.peso ? 'peso' : 'unidad', ni.carne);
        for (const [tienda, v] of Object.entries(precios)) {
          if (!permitidas.has(tienda)) continue; // por si se cambió Carne después de escribir un precio
          await store.setEleccion(nuevo, tienda, { precio: v, precio_unidad: null, unidad: null, origen: 'manual' });
        }
        hoja.close();
        ui.buscarProd = nombre;
        render();
        avisar(`«${nombre}» creado`);
      });
    }
    case 'guardarProducto': {
      const { id: ingId, t: tienda } = ui.ep;
      const actual = elecciones[`${ingId}|${tienda}`];
      let nombre = $('#epNombre').value.trim();
      let textoPrecio = $('#epPrecio').value.trim();
      // Si en el nombre se ha escrito un número, casi seguro es el precio.
      if (nombre && !textoPrecio && /^\d+([.,]\d+)?\s*€?$/.test(nombre)) {
        if (confirm(`Has escrito «${nombre}» como nombre del producto. ¿Es el precio?`)) {
          textoPrecio = nombre.replace('€', '').trim();
          nombre = '';
        }
      }
      const precio = textoPrecio === '' ? null : aNumero(textoPrecio);
      if (precio !== null && (!Number.isFinite(precio) || precio < 0)) return alert('Escribe un precio válido, por ejemplo 2,50.');
      const cambios = {};
      const nombreAntes = actual?.nombre || '';
      if (nombre !== nombreAntes) cambios.nombre = nombre || null;
      const precioAntes = actual?.precio != null ? Number(actual.precio) : null;
      if (precio !== precioAntes) Object.assign(cambios, { precio, precio_unidad: null, unidad: null });
      if (!Object.keys(cambios).length) return hoja.close();
      // Tocar a mano un producto que se actualizaba solo lo pasa a manual (si no, el siguiente reparto lo pisaría).
      cambios.origen = actual?.origen === 'auto' ? 'manual' : actual?.origen || 'manual';
      hoja.close();
      return accion(() => store.setEleccion(ingId, tienda, cambios));
    }
    case 'soyYo':
      ui.yo = b.dataset.q;
      guardarYo(ui.yo);
      return render();
    case 'verMenu': ui.menuVer = b.dataset.ver; return render();
    case 'modoComida': {
      const dia = Number(b.dataset.dia);
      const comida = b.dataset.comida;
      const separar = b.dataset.sep === '1';
      if (separar === esSeparada(dia, comida)) return;
      const { menu } = store.estado;
      const a = menu[`${dia}|${comida}|p1`];
      const c = menu[`${dia}|${comida}|p2`];
      if (!separar && (a || c) && a !== c && !confirm('Si coméis juntos se quitan las dos recetas separadas de esta comida. ¿Seguir?')) return;
      ui.pasados.delete(dia);
      return accion(() => store.setModoComida(dia, comida, separar));
    }
    case 'recPersonas':
      ui.receta.personas = Number(b.dataset.n) === 1 ? 1 : 2;
      return pintarReceta();
    case 'nuevaReceta': return abrirReceta(null);
    case 'editarReceta': return abrirReceta(id);
    case 'recAdd':
      ui.receta.items[id] = esPeso(id) ? PASO_KG : 1;
      ui.buscarRec = '';
      $('#buscarRec').value = '';
      return pintarReceta();
    case 'recQuitar':
      delete ui.receta.items[id];
      return pintarReceta();
    case 'recMas': return cambiarCantReceta(id, 1);
    case 'recMenos': return cambiarCantReceta(id, -1);
    case 'recCant': {
      const peso = esPeso(id);
      const actual = ui.receta.items[id];
      const txt = prompt(peso ? `Gramos de ${ingrediente(id).nombre}:` : `Unidades de ${ingrediente(id).nombre}:`, peso ? Math.round(actual * 1000) : actual);
      if (txt === null) return;
      const v = aNumero(txt);
      if (!Number.isFinite(v) || v <= 0) return alert('Escribe un número mayor que 0.');
      ui.receta.items[id] = peso ? Math.round(v) / 1000 : Math.max(1, Math.round(v));
      return pintarReceta();
    }
    case 'recCrear': {
      const nombre = ui.buscarRec.trim();
      if (!nombre) return;
      const modo = b.dataset.modo;
      return accion(async () => {
        const nuevo = await store.crearIngrediente(nombre, modo);
        if (!ui.receta) return;
        ui.receta.items[nuevo] = modo === 'peso' ? PASO_KG : 1;
        ui.buscarRec = '';
        const campo = $('#buscarRec');
        if (campo) campo.value = '';
        pintarReceta();
      });
    }
    case 'guardarReceta': {
      const r = ui.receta;
      const nombre = r.nombre.trim();
      if (!nombre) { $('#recNombre').focus(); return alert('Ponle un nombre a la receta.'); }
      const ingredientes = Object.entries(r.items).map(([ingrediente_id, cantidad]) => ({ ingrediente_id, cantidad }));
      if (!ingredientes.length) return alert('Añade al menos un ingrediente.');
      return accion(async () => {
        await store.guardarReceta({ id: r.id, nombre, personas: r.personas, ingredientes });
        hoja.close();
        avisar(r.id ? 'Receta guardada' : `Receta «${nombre}» creada`);
      });
    }
    case 'borrarReceta': {
      const r = ui.receta;
      const usos = Object.values(store.estado.menu).filter((v) => v === r.id).length;
      if (!confirm(`¿Borrar «${r.nombre}»?${usos ? ` También se quitará del menú (${usos} ${usos === 1 ? 'vez' : 'veces'}).` : ''}`)) return;
      return accion(async () => {
        await store.borrarReceta(r.id);
        hoja.close();
        avisar('Receta borrada');
      });
    }
    case 'recetaALista': {
      const r = store.estado.recetas[id];
      return accion(async () => {
        await store.sumarLista(sumarRecetas([{ receta_id: id, factor: 1 }], store.estado.recetas, store.estado.ingredientes));
        avisar(`Ingredientes de «${r.nombre}» añadidos a la lista`);
      });
    }
    case 'menuALista': {
      const huecos = huecosMenu();
      const total = sumarRecetas(huecos, store.estado.recetas, store.estado.ingredientes);
      const n = Object.keys(total).length;
      if (!n) return;
      if (!confirm(`Se añadirán ${n} ${n === 1 ? 'ingrediente' : 'ingredientes'} de ${huecos.length} ${huecos.length === 1 ? 'plato' : 'platos'} del menú a la lista. Lo que ya esté en la lista se suma. ¿Seguir?`)) return;
      return accion(async () => {
        await store.sumarLista(total);
        huecos.forEach((x) => ui.pasados.add(Number(x.dia)));
        irA('lista');
        avisar('Menú pasado a la lista');
      });
    }
    case 'diaALista': {
      const d = Number(b.dataset.dia);
      const huecos = huecosMenu().filter((x) => Number(x.dia) === d);
      const total = sumarRecetas(huecos, store.estado.recetas, store.estado.ingredientes);
      if (!Object.keys(total).length) return;
      if (ui.pasados.has(d) && !confirm(`Ya pasaste el ${DIAS[d].toLowerCase()} a la lista. Si sigues, se suma otra vez. ¿Seguir?`)) return;
      return accion(async () => {
        await store.sumarLista(total);
        ui.pasados.add(d);
        render();
        avisar(`${DIAS[d]} pasado a la lista`);
      });
    }
    case 'vaciarMenu':
      if (!confirm('¿Quitar todas las recetas del menú de la semana? Las recetas no se borran.')) return;
      ui.pasados.clear();
      return accion(() => store.vaciarMenu());
    case 'elegir': return abrirCandidatos(id, t);
    case 'cand': {
      const { ingId, t: tienda, cands } = ui.candidato;
      const c = cands[Number(b.dataset.i)];
      const peso = esPeso(ingId);
      hoja.close();
      return accion(() => store.setEleccion(ingId, tienda, {
        nombre: c.nombre, ext_id: c.ext_id, url: c.url,
        precio: peso ? c.precio_unidad : c.precio,   // al peso: el precio guardado es €/kg
        precio_unidad: c.precio_unidad, unidad: c.unidad, origen: 'auto',
      }));
    }
    case 'nombre': return abrirEditarProducto(id, t);
    case 'exportar': {
      const url = URL.createObjectURL(new Blob([store.exportar()], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `compra-copia-${new Date().toISOString().slice(0, 10)}.json` });
      a.click();
      return URL.revokeObjectURL(url);
    }
    case 'reiniciar':
      if (confirm('Se borrarán la lista, los precios y los ajustes de este navegador. ¿Seguro?')) store.reiniciar();
      return;
    case 'salir': return accion(() => store.salir());
    case 'entrar': {
      const email = $('#email').value.trim();
      const clave = $('#clave').value;
      const msg = $('#msg');
      if (!email || !clave) return;
      msg.textContent = 'Entrando…';
      msg.className = 'suave';
      return store.entrar(email, clave).then(
        () => location.reload(),
        (e) => { msg.textContent = `No se pudo entrar: ${e.message}`; msg.className = 'error'; },
      );
    }
    case 'enviar': {
      const email = $('#email').value.trim();
      const msg = $('#msg');
      if (!email) return;
      return store.enviarEnlace(email).then(
        () => { msg.textContent = 'Listo. Revisa tu correo y abre el enlace en este mismo móvil.'; },
        (e) => { msg.textContent = `Error: ${e.message}`; msg.className = 'error'; },
      );
    }
  }
});

// Intro en la contraseña = pulsar «Entrar».
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.id === 'clave') document.querySelector('[data-acc=entrar]')?.click();
});

const aNumero = (texto) => Number(String(texto).trim().replace(',', '.'));

document.addEventListener('change', (ev) => {
  const el = ev.target;
  const { acc, id, t } = el.dataset;
  if (!acc) return;
  const { ajustes, lista } = store.estado;
  switch (acc) {
    case 'hecho': return accion(() => store.setLista(id, { hecho: el.checked }));
    case 'precio': {
      const texto = el.value.trim();
      const v = texto === '' ? null : aNumero(texto);
      if (v !== null && (!Number.isFinite(v) || v < 0)) {
        el.value = '';
        return alert('Escribe un precio válido, por ejemplo 2,50.');
      }
      return accion(() => store.setEleccion(id, t, { precio: v, precio_unidad: null, unidad: null, origen: 'manual' }));
    }
    case 'carne': return accion(() => store.setIngrediente(id, { carne: el.checked }));
    case 'peso': {
      const aPeso = el.checked;
      const ok = confirm(aPeso
        ? `«${ingrediente(id).nombre}» pasará a medirse en kilos. Los precios ya guardados no se convierten: revisa que estén en €/kg.`
        : `«${ingrediente(id).nombre}» pasará a medirse por unidades. Los precios ya guardados no se convierten: revisa que sean del envase.`);
      if (!ok) { el.checked = !aPeso; return; }
      return accion(async () => {
        await store.setIngrediente(id, { modo: aPeso ? 'peso' : 'unidad' });
        if (lista[id]) await store.setLista(id, { cantidad: aPeso ? 0.5 : 1 });
      });
    }
    case 'menu':
      ui.pasados.delete(Number(el.dataset.dia));
      return accion(() => store.setMenu(Number(el.dataset.dia), el.dataset.comida, el.dataset.quien, el.value || null));
    case 'recetaPrecios':
      ui.preciosReceta = el.value;
      return render();
    case 'leTienda': {
      const pr = store.estado.elecciones[`${ui.le.id}|${el.value}`]?.precio;
      $('#lePrecio').value = pr != null ? Number(pr).toFixed(2).replace('.', ',') : '';
      return;
    }
    case 'nombresP': {
      const i = Number(el.dataset.i);
      const nombres = nombresP();
      nombres[i] = el.value.trim().replace(/\s+/g, ' ') || `Persona ${i + 1}`;
      return accion(() => store.setAjuste('nombres', nombres));
    }
    case 'niCarne':
      ui.ni.carne = el.checked;
      return pintarNi();
    case 'niPeso':
      ui.ni.peso = el.checked;
      return pintarNi();
    case 'desayuno': return accion(() => store.setAjuste('desayuno', el.checked));
    case 'tienda': {
      const nuevas = TIENDAS.map((x) => x.id).filter((x) => (x === id ? el.checked : ajustes.tiendas.includes(x)));
      if (!nuevas.length) { el.checked = true; return alert('Hace falta al menos una tienda.'); }
      return accion(() => store.setAjuste('tiendas', nuevas));
    }
    case 'ahorro': {
      const v = aNumero(el.value || '0');
      if (!Number.isFinite(v) || v < 0) { el.value = String(ajustes.ahorroMin).replace('.', ','); return alert('Escribe un importe válido, por ejemplo 1,50.'); }
      return accion(() => store.setAjuste('ahorroMin', v));
    }
    case 'dias': {
      const v = Math.round(aNumero(el.value));
      if (!Number.isFinite(v) || v < 1) { el.value = ajustes.diasCaducidad; return alert('Escribe un número de días, por ejemplo 7.'); }
      return accion(() => store.setAjuste('diasCaducidad', v));
    }
    case 'importar': {
      const f = el.files[0];
      if (!f) return;
      return f.text().then((txt) => { store.importar(txt); alert('Copia restaurada.'); }, (e) => alert(`Archivo no válido: ${e.message}`));
    }
  }
});

// Los buscadores filtran al escribir.
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset.acc === 'buscarAdd') {
    ui.buscarAdd = el.value;
    return pintarAdd();
  }
  if (el.dataset.acc === 'niNombre') {
    ui.ni.nombre = el.value;
    return;
  }
  if (el.dataset.acc === 'niPrecio') {
    ui.ni.precios[el.dataset.t] = el.value;
    return;
  }
  if (el.dataset.acc === 'buscarRec') {
    ui.buscarRec = el.value;
    return pintarReceta();
  }
  if (el.dataset.acc === 'recNombre') {
    ui.receta.nombre = el.value;
    return;
  }
  if (el.dataset.acc === 'buscarProd' || el.dataset.acc === 'buscarPrecio') {
    ui[el.dataset.acc] = el.value;
    render(); // render() devuelve el foco al buscador
  }
});

// ------------------------------------------------------------------ arranque
(async function iniciar() {
  try {
    store = config.supabaseUrl ? await crearStoreSupabase(config) : await crearStoreLocal();
  } catch (e) {
    vista.innerHTML = `<div class="cabecera"><h1>No se pudo iniciar</h1></div><p class="error">${esc(e.message || e)}</p>`;
    return;
  }
  // Se repinta justo después del evento: así, al pasar de una casilla de precio a la siguiente,
  // el foco ya está en la nueva y render() puede devolvérselo.
  let pendiente = false;
  store.alCambiar(() => {
    if (pendiente) return;
    pendiente = true;
    setTimeout(() => { pendiente = false; render(); }, 0);
  });
  irA(location.hash.slice(1));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
