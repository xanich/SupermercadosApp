// BM Supermercados (tienda online). Devuelve JSON, no hace falta interpretar HTML.
import { pedir, quitarDuplicados } from './lib.mjs';

const BASE = 'https://www.online.bmsupermercados.es/api/rest/V1.0/catalog/product';

const UNIDADES = { KILO: 'kg', LITRO: 'l' };

export async function buscarBM(consulta, max = 8) {
  const url = `${BASE}?q=${encodeURIComponent(consulta)}&showRecommendations=false&page=1`;
  const datos = await pedir(url, { json: true });
  const lista = (datos.products || []).map((p) => {
    const pd = p.productData || {};
    const pr = p.priceData || {};
    const valor = pr.prices?.[0]?.value || {};
    const unidad = UNIDADES[pr.unitPriceUnitType] || null;
    const marca = (pd.brand?.name || '').trim();
    return {
      tienda: 'bm',
      ext_id: String(p.code),
      nombre: [pd.name, marca && marca !== 'BM' ? `(${marca})` : ''].filter(Boolean).join(' '),
      url: pd.url || null,
      precio: valor.centAmount ?? null,
      precio_unidad: unidad ? valor.centUnitAmount ?? null : null,
      unidad,
    };
  });
  return quitarDuplicados(lista.filter((p) => p.precio != null)).slice(0, max);
}
