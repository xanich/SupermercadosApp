import { config } from './config.js';
import { crearStoreLocal, crearStoreSupabase } from './store.js';
import { TIENDAS, nombreTienda, asignar, diasDesde, esAntiguo } from './compare.js';

const $ = (s) => document.querySelector(s);
const vista = $('#vista');
const hoja = $('#hoja');
const euro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const COLOR = { eroski: '#c8553d', bm: '#3b6ea8', dia: '#b8892b', carrefour: '#2b8a8a' };
const BUSQUEDA = {
  dia: 'https://www.dia.es/search?q=',
  eroski: 'https://supermercado.eroski.es/es/search/results/?q=',
  bm: 'https://www.online.bmsupermercados.es/es/search?q=',
  carrefour: 'https://www.carrefour.es/?query=',
};
const AUTO = new Set(['bm', 'eroski']); // tiendas cuyo precio puede leerse solo
const TABS = ['lista', 'precios', 'productos', 'ajustes'];
const PASO_KG = 0.25;

let store;
const ui = { tab: 'lista', buscarProd: '', buscarAdd: '', verTodos: false, hoja: null, candidato: null };

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
    .map(([id, v]) => ({ id, nombre: por[id].nombre, consulta: por[id].consulta, modo: por[id].modo || 'unidad', cantidad: Number(v.cantidad), hecho: v.hecho }))
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

function vistaPrecios() {
  const { elecciones, ajustes } = store.estado;
  const dias = Number(ajustes.diasCaducidad) || 7;
  const items = itemsLista();
  const filas = items.filter((it) => ui.verTodos || ajustes.tiendas.some((t) => esAntiguo(elecciones[`${it.id}|${t}`], dias)));
  let h = `<div class="cabecera"><div><h1>Precios</h1>
      <p class="suave">Solo lo de tu lista con precio de más de ${dias} días.</p></div></div>
    <p class="suave">Pulsa «Abrir» para ver el precio en la web de la tienda y escríbelo aquí. Los productos al peso van en €/kg.</p>
    <p><button class="suave-b" data-acc="verTodos">${ui.verTodos ? 'Ver solo los antiguos' : 'Ver todos los de la lista'}</button></p>`;
  if (!items.length) return h + '<div class="vacio"><p>Añade primero ingredientes a la lista.</p></div>';
  if (!filas.length) return h + '<div class="vacio"><h2>Todo al día</h2><p>Los precios de tu lista están actualizados.</p></div>';
  for (const it of filas) {
    const u = it.modo === 'peso' ? '€/kg' : '€';
    h += `<section class="tarjeta"><div class="bloque"><div class="bloque-cab"><h2>${esc(it.nombre)}</h2>${it.modo === 'peso' ? '<span class="etq">al peso</span>' : ''}</div>`;
    for (const t of ajustes.tiendas) {
      const e = elecciones[`${it.id}|${t}`];
      h += `<div class="fila-tienda">
        <span class="t">${punto(t)}${nombreTienda(t)}</span>
        <span class="campo-precio"><input type="text" inputmode="decimal" autocomplete="off" data-acc="precio" data-id="${esc(it.id)}" data-t="${t}"
          value="${e?.precio != null ? Number(e.precio).toFixed(2).replace('.', ',') : ''}" placeholder="0,00" aria-label="Precio en ${nombreTienda(t)}"><span class="u">${u}</span></span>
        <span class="sub">${etiqueta(e, dias)}<a href="${BUSQUEDA[t]}${encodeURIComponent(it.consulta)}" target="_blank" rel="noopener">Abrir ↗</a></span>
      </div>`;
    }
    h += '</div></section>';
  }
  return h;
}

function vistaProductos() {
  const { ingredientes, elecciones, ajustes, candidatos } = store.estado;
  const dias = Number(ajustes.diasCaducidad) || 7;
  const q = ui.buscarProd.trim().toLowerCase();
  const lista = ingredientes.filter((i) => !q || i.nombre.toLowerCase().includes(q)).sort(porNombre);
  let h = `<div class="cabecera"><h1>Productos</h1></div>
    <p class="suave">Elige qué producto compras en cada tienda. En BM y Eroski escoges de una lista y su precio se actualiza solo; en Dia y Carrefour lo anotas a mano. Activa «Al peso» en lo que compras por kilos.</p>
    <p><input type="search" id="buscarProd" data-acc="buscarProd" placeholder="Buscar ingrediente" value="${esc(ui.buscarProd)}" autocomplete="off"></p>`;
  for (const ing of lista) {
    const peso = ing.modo === 'peso';
    h += `<section class="tarjeta"><div class="bloque"><div class="bloque-cab"><h2>${esc(ing.nombre)}</h2>
      <label class="interruptor"><input type="checkbox" data-acc="peso" data-id="${esc(ing.id)}" ${peso ? 'checked' : ''}> Al peso</label></div>`;
    for (const t of TIENDAS.map((x) => x.id)) {
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

function vistaAjustes() {
  const { ajustes } = store.estado;
  const local = store.modo === 'local';
  return `<div class="cabecera"><h1>Ajustes</h1></div>
    <section class="tarjeta">
      <div class="ajuste"><strong>Tiendas que usáis</strong>
        ${TIENDAS.map((t) => `<label class="linea"><span>${punto(t.id)} ${t.nombre}</span>
          <input class="redonda" type="checkbox" data-acc="tienda" data-id="${t.id}" ${ajustes.tiendas.includes(t.id) ? 'checked' : ''}></label>`).join('')}
        <p class="suave">Marca solo las que os queden cerca.</p></div>
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

// ------------------------------------------------------------------ pintar
function render() {
  document.querySelectorAll('#pestanas button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
  if (store.necesitaLogin) {
    vista.innerHTML = vistaLogin();
    return;
  }
  const vistas = { lista: vistaLista, precios: vistaPrecios, productos: vistaProductos, ajustes: vistaAjustes };
  vista.innerHTML = vistas[ui.tab]();
  if (hoja.open && ui.hoja === 'add') pintarAdd();
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

hoja.addEventListener('click', (ev) => { if (ev.target === hoja) hoja.close(); });
hoja.addEventListener('close', () => { ui.hoja = null; });

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
    case 'verTodos': ui.verTodos = !ui.verTodos; return render();
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
  if (el.dataset.acc === 'buscarProd') {
    ui.buscarProd = el.value;
    const pos = el.selectionStart;
    render();
    const nuevo = document.getElementById('buscarProd');
    nuevo.focus();
    nuevo.setSelectionRange(pos, pos);
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
  store.alCambiar(render);
  ui.tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'lista';
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
