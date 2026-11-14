// Eroski (supermercado online). La busqueda devuelve HTML; cada producto lleva un
// atributo data-metrics con JSON (nombre, id y precio), que es mas estable que el diseno.
import { pedir, precioUnidad, quitarDuplicados } from './lib.mjs';

const BASE = 'https://supermercado.eroski.es/es/search/results/?q=';

const desescapar = (s) =>
  s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export async function buscarEroski(consulta, max = 8) {
  const html = await pedir(BASE + encodeURIComponent(consulta));
  const lista = [];
  const re = /class="product-title-link" data-metrics="([^"]+)" href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const item = JSON.parse(desescapar(m[1])).ecommerce.items[0];
      if (typeof item.price !== 'number') continue;
      lista.push({
        tienda: 'eroski',
        ext_id: String(item.item_id),
        nombre: item.item_name,
        url: m[2].replace(':443', ''),
        precio: item.price,
        ...precioUnidad(item.price, item.item_name),
      });
    } catch {
      /* bloque raro: se ignora */
    }
  }
  return quitarDuplicados(lista).slice(0, max);
}
