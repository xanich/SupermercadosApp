import { config } from './config.js';
import { crearStoreLocal, crearStoreSupabase } from './store.js';
import { TIENDAS, nombreTienda, asignar, tiendasDe, diasDesde, esAntiguo } from './compare.js';

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
const TABS = ['lista', 'menu', 'recetas', 'precios', 'productos', 'ajustes'];
const PASO_KG = 0.25;
const PASO_REC_KG = 0.05; // en recetas, de 50 en 50 g
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const COMIDAS = [
  { id: 'desayuno', nombre: 'Desayuno' },
  { id: 'comida', nombre: 'Comida' },
  { id: 'cena', nombre: 'Cena' },
];
const MODOS_PRECIO = [
  { id: 'antiguos', nombre: 'Antiguos' },
  { id: 'lista', nombre: 'Lista' },
  { id: 'todos', nombre: 'Todos' },
];

let store;
const ui = {
  tab: 'lista', buscarProd: '', buscarAdd: '', buscarPrecio: '', preciosModo: 'antiguos',
  hoja: null, candidato: null, receta: null, buscarRec: '',
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
    .map(([id, v]) => ({ id, nombre: por[id].nombre, consulta: por[id].consulta, modo: por[id].modo || 'unidad', carne: Boolean(por[id].carne), cantidad: Number(v.cantidad), hecho: v.hecho }))
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

  const r = asignar(items, elecciones, ajustes.tiendas, Number(ajustes.ahorroMin) || 0);
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
    <div class="progreso" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <div class="meta-h">${hechos} de ${items.length} comprados</div>
  </section>`;

  if (antiguos > 0) {
    h += `<div class="aviso"><span>${antiguos} ${antiguos === 1 ? 'precio sin actualizar' : 'precios sin actualizar'}</span>
      <button data-acc="ir" data-tab="precios">Actualizar</button></div>`;
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
  if (hechos) h += '<p style="text-align:center"><button data-acc="limpiar">Quitar lo comprado</button></p>';
  return h;
}

function detalleUnidad(x) {
  if (x.modo === 'peso') return `<span class="num">${euro.format(x.e.precio)}/kg</span>`;
  return x.cantidad > 1 ? `<span class="num">${euro.format(x.e.precio)} c/u</span>` : '';
}

function filaItem(x, coste, etq, extra) {
  return `<div class="item ${x.hecho ? 'hecho' : ''}">
    <div class="check"><input class="redonda" type="checkbox" data-acc="hecho" data-id="${esc(x.id)}" ${x.hecho ? 'checked' : ''} aria-label="Comprado: ${esc(x.nombre)}"></div>
    <div><div class="nombre">${esc(x.nombre)}</div><div class="meta">${etq}${extra}</div></div>
    <div class="precio-fila num">${coste == null ? '' : euro.format(coste)}</div>
    <div class="controles">
      <div class="cantidad">
        <button data-acc="menos" data-id="${esc(x.id)}" aria-label="Menos">−</button>
        <button class="valor" data-acc="cant" data-id="${esc(x.id)}" aria-label="Cambiar cantidad">${fmtCantidad(x.modo, x.cantidad)}</button>
        <button data-acc="mas" data-id="${esc(x.id)}" aria-label="Más">+</button>
      </div>
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
  let base = modo === 'todos'
    ? ingredientes.map((i) => ({ id: i.id, nombre: i.nombre, consulta: i.consulta, modo: i.modo || 'unidad', carne: Boolean(i.carne) }))
    : itemsLista();
  if (modo === 'antiguos') base = base.filter((it) => celdasDe(it).some((t) => esAntiguo(elecciones[`${it.id}|${t}`], dias)));
  const filas = base.filter((it) => !q || it.nombre.toLowerCase().includes(q)).sort(porNombre);
  const explica = {
    antiguos: `Lo de tu lista con algún precio de más de ${dias} días.`,
    lista: 'Todo lo que hay en la lista de la compra.',
    todos: 'Todos los ingredientes, estén o no en la lista.',
  }[modo];

  let h = `<div class="cabecera"><div><h1>Precios</h1><p class="suave">${explica}</p></div></div>
    <div class="segmentos" role="group" aria-label="Qué precios ver">${MODOS_PRECIO.map((m) =>
      `<button data-acc="modoPrecios" data-modo="${m.id}" aria-pressed="${m.id === modo}">${m.nombre}</button>`).join('')}</div>
    <p><input type="search" id="buscarPrecio" data-acc="buscarPrecio" placeholder="Buscar ingrediente" value="${esc(ui.buscarPrecio)}" autocomplete="off"></p>
    <p class="suave">Escribe el precio y pasa a la siguiente casilla: se guarda solo. ↗ abre el producto en la web de la tienda. Los productos al peso van en €/kg.</p>`;
  if (modo !== 'todos' && !itemsLista().length) {
    return h + `<div class="vacio"><p>La lista está vacía.</p><button data-acc="modoPrecios" data-modo="todos">Ver todos los ingredientes</button></div>`;
  }
  if (!filas.length) {
    if (q) return h + '<div class="vacio"><p>Sin resultados.</p></div>';
    return h + `<div class="vacio"><h2>Todo al día</h2><p>Los precios de tu lista están actualizados.</p>
      <button data-acc="modoPrecios" data-modo="todos">Ver todos los ingredientes</button></div>`;
  }

  const cols = Math.max(cab.length, ...filas.map((it) => celdasDe(it).length));
  h += `<section class="tarjeta tabla-precios" style="--cols:${cols}">
    <div class="tp-cab">${cab.map((t) => `<span>${punto(t)}${nombreTienda(t)}</span>`).join('')}</div>`;
  for (const it of filas) {
    const celdas = celdasDe(it);
    // Si las tiendas de la fila no coinciden con las columnas (carne: Halal en lugar de Dia), cada casilla dice cuál es.
    const rotular = celdas.some((t, i) => t !== cab[i]);
    h += `<div class="tp-fila"><div class="tp-nombre">${esc(it.nombre)}${it.modo === 'peso' ? ' <span class="etq">€/kg</span>' : ''}</div><div class="tp-celdas">`;
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
      <div class="bloque-cab"><h2>${esc(r.nombre)}</h2><button class="mini suave-b" data-acc="editarReceta" data-id="${esc(r.id)}">Editar</button></div>
      <p class="suave">${resumenIngredientes(r) || 'Sin ingredientes'}</p>
      <div class="pie-receta"><span class="suave">${usos ? `En el menú ${usos} ${usos === 1 ? 'vez' : 'veces'}` : 'No está en el menú'}</span>
        <button class="mini" data-acc="recetaALista" data-id="${esc(r.id)}">Añadir a la compra</button></div>
    </div></section>`;
  }
  return h;
}

const conDesayuno = () => store.estado.ajustes.desayuno !== false;
const comidasVisibles = () => COMIDAS.filter((c) => c.id !== 'desayuno' || conDesayuno());
// Huecos del menú que se ven (si el desayuno está oculto, no cuenta).
const huecosMenu = () => {
  const visibles = new Set(comidasVisibles().map((c) => c.id));
  return Object.entries(store.estado.menu)
    .filter(([k, rid]) => visibles.has(k.split('|')[1]) && store.estado.recetas[rid]);
};

function vistaMenu() {
  const { menu } = store.estado;
  const recetas = recetasOrdenadas();
  const hoy = (new Date().getDay() + 6) % 7;
  const n = huecosMenu().length;
  let h = `<div class="cabecera"><div><h1>Menú</h1><p class="suave">${n ? `${n} ${n === 1 ? 'comida planificada' : 'comidas planificadas'}` : 'Elige una receta para cada comida'}</p></div>
    <label class="interruptor"><input type="checkbox" data-acc="desayuno" ${conDesayuno() ? 'checked' : ''}> Desayuno</label></div>${avisoTablas()}`;
  if (!recetas.length) {
    return h + `<div class="vacio"><h2>Primero, las recetas</h2><p>Crea alguna receta y después elígela aquí para cada día.</p>
      <button class="primario" data-acc="ir" data-tab="recetas">Ir a Recetas</button></div>`;
  }
  h += `<div class="acciones-menu"><button class="primario" data-acc="menuALista" ${n ? '' : 'disabled'}>Pasar a la lista</button>
    <button data-acc="vaciarMenu" ${Object.keys(menu).length ? '' : 'disabled'}>Vaciar semana</button></div>`;
  for (let d = 0; d < 7; d++) {
    h += `<section class="tarjeta${d === hoy ? ' hoy' : ''}"><div class="bloque">
      <div class="bloque-cab"><h2>${DIAS[d]}</h2>${d === hoy ? '<span class="etq auto">hoy</span>' : ''}</div>`;
    for (const c of comidasVisibles()) {
      const actual = menu[`${d}|${c.id}`];
      h += `<label class="linea-menu"><span>${c.nombre}</span>
        <select data-acc="menu" data-dia="${d}" data-comida="${c.id}" aria-label="${c.nombre} del ${DIAS[d].toLowerCase()}">
          <option value="">—</option>
          ${recetas.map((r) => `<option value="${esc(r.id)}" ${r.id === actual ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}
        </select></label>`;
    }
    h += '</div></section>';
  }
  return h;
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
    </div></section>`;
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

// Editor de recetas: se trabaja sobre un borrador (ui.receta) y se guarda al pulsar «Guardar».
function abrirReceta(id) {
  const r = id ? store.estado.recetas[id] : null;
  ui.receta = {
    id: r?.id || null,
    nombre: r?.nombre || '',
    items: Object.fromEntries((r?.ingredientes || []).map((x) => [x.ingrediente_id, Number(x.cantidad)])),
  };
  ui.buscarRec = '';
  ui.hoja = 'receta';
  hoja.innerHTML = `<div class="hoja-int">
    <div class="hoja-cab"><h2>${r ? 'Editar receta' : 'Nueva receta'}</h2><button class="icono" data-acc="cerrar" aria-label="Cerrar">✕</button></div>
    <input type="text" id="recNombre" data-acc="recNombre" placeholder="Nombre, p. ej. Pollo al curry" value="${esc(ui.receta.nombre)}" autocomplete="off">
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

// Suma los ingredientes de varias recetas: { ingrediente_id: cantidad }
function totalRecetas(ids) {
  const total = {};
  for (const rid of ids) {
    for (const x of store.estado.recetas[rid]?.ingredientes || []) {
      total[x.ingrediente_id] = (total[x.ingrediente_id] || 0) + Number(x.cantidad);
    }
  }
  return total;
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
  return ['acc', 'id', 't', 'dia', 'comida'].filter((k) => d[k] != null)
    .map((k) => `[data-${k}="${CSS.escape(d[k])}"]`).join('');
}

function render() {
  document.querySelectorAll('#pestanas button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
  if (store.necesitaLogin) {
    vista.innerHTML = vistaLogin();
    return;
  }
  const act = document.activeElement;
  const foco = act && vista.contains(act) && act.dataset.acc
    ? { sel: selectorDe(act), texto: act.matches('input[type=text], input[type=search]'), valor: act.value, ini: act.selectionStart, fin: act.selectionEnd }
    : null;
  const vistas = { lista: vistaLista, menu: vistaMenu, recetas: vistaRecetas, precios: vistaPrecios, productos: vistaProductos, ajustes: vistaAjustes };
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
hoja.addEventListener('click', (ev) => { if (ev.target === hoja && ui.hoja !== 'receta') hoja.close(); });
hoja.addEventListener('close', () => { ui.hoja = null; ui.receta = null; });

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-acc], #pestanas button');
  if (!b) return;
  if (b.dataset.tab && !b.dataset.acc) return irA(b.dataset.tab);
  const { acc, id, t } = b.dataset;
  const { lista, elecciones } = store.estado;
  switch (acc) {
    case 'ir': return irA(b.dataset.tab);
    case 'abrirAdd': return abrirAdd();
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
    case 'modoPrecios': ui.preciosModo = b.dataset.modo; return render();
    case 'nuevoIng': {
      const nombre = prompt('Nombre del ingrediente nuevo (después puedes marcar «Al peso» y anotar sus precios):');
      if (!nombre || !nombre.trim()) return;
      return accion(async () => {
        await store.crearIngrediente(nombre, 'unidad');
        ui.buscarProd = nombre.trim();
        render();
      });
    }
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
        await store.guardarReceta({ id: r.id, nombre, ingredientes });
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
        await store.sumarLista(totalRecetas([id]));
        avisar(`Ingredientes de «${r.nombre}» añadidos a la lista`);
      });
    }
    case 'menuALista': {
      const huecos = huecosMenu();
      const total = totalRecetas(huecos.map(([, rid]) => rid));
      const n = Object.keys(total).length;
      if (!n) return;
      if (!confirm(`Se añadirán ${n} ${n === 1 ? 'ingrediente' : 'ingredientes'} de ${huecos.length} ${huecos.length === 1 ? 'comida' : 'comidas'} a la lista. Lo que ya esté en la lista se suma. ¿Seguir?`)) return;
      return accion(async () => {
        await store.sumarLista(total);
        irA('lista');
        avisar('Menú pasado a la lista');
      });
    }
    case 'vaciarMenu':
      if (!confirm('¿Quitar todas las recetas del menú de la semana? Las recetas no se borran.')) return;
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
    case 'nombre': {
      const actual = elecciones[`${id}|${t}`];
      const nuevo = prompt(`Producto de ${ingrediente(id).nombre} en ${nombreTienda(t)}:`, actual?.nombre || '');
      if (nuevo === null) return;
      return accion(() => store.setEleccion(id, t, { nombre: nuevo.trim() || null, origen: actual?.origen === 'auto' ? 'manual' : actual?.origen || 'manual' }));
    }
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
    case 'menu': return accion(() => store.setMenu(Number(el.dataset.dia), el.dataset.comida, el.value || null));
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
  ui.tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'lista';
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
