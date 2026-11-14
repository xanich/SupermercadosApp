// Almacenamiento: modo local (localStorage, para probar) o Supabase (compartido entre moviles).
import { TIENDAS } from './compare.js';

const AJUSTES_INICIALES = {
  tiendas: TIENDAS.map((t) => t.id),
  ahorroMin: 1.5,
  diasCaducidad: 7,
};

const ahora = () => new Date().toISOString();

async function cargarJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function crearBase(modo) {
  const oyentes = [];
  const store = {
    modo,
    estado: { ingredientes: [], elecciones: {}, lista: {}, ajustes: { ...AJUSTES_INICIALES }, candidatos: null },
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
    e.ajustes = { ...AJUSTES_INICIALES, ...guardado.ajustes };
  } else {
    const ings = (await cargarJson('../data/ingredients.json')) || [];
    e.ingredientes = ings.map(({ id, nombre, consulta, modo }) => ({ id, nombre, consulta, modo: modo || 'unidad' }));
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
      const { ingredientes, elecciones, lista, ajustes } = e;
      localStorage.setItem(CLAVE, JSON.stringify({ ingredientes, elecciones, lista, ajustes }));
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
  s.exportar = () => JSON.stringify({ ...e, candidatos: undefined }, null, 1);
  s.importar = (texto) => {
    const d = JSON.parse(texto);
    Object.assign(e, { ingredientes: d.ingredientes, elecciones: d.elecciones, lista: d.lista });
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
    e.lista = Object.fromEntries(lis.data.map((x) => [x.ingrediente_id, { cantidad: x.cantidad, hecho: x.hecho }]));
    e.ajustes = { ...AJUSTES_INICIALES, ...Object.fromEntries(aju.data.map((x) => [x.clave, x.valor])) };
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

  const { data } = await sb.auth.getSession();
  if (!data.session) {
    s.necesitaLogin = true;
    return s;
  }
  await recargar();
  sb.channel('cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lista' }, recargar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'elecciones' }, recargar)
    .subscribe();
  return s;
}
