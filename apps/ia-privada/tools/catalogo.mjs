// El catálogo de hardware (:::catalogo en content/herramientas/catalogo.md): una tabla filtrable de GPUs y equipos con
// lo que importa para servir un LLM, armada en el build desde los archivos de datos. Ningún número se escribe a mano:
//   content/datos/gpus.json     especificaciones, renta y precio de compra de cada GPU o equipo (copia de Sensei)
//   content/datos/equipos.json  servidores completos con su precio publicado; cada uno apunta a una GPU de gpus.json
// Cada precio lleva su fecha y su fuente. La tabla se lee igual sin JavaScript; app.js le pone los filtros y el orden.
import { esc } from './md.mjs';

const SEG = { 'centro-de-datos': 'Centro de datos', workstation: 'Workstation', escritorio: 'Escritorio' };
const fmt = (n, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const dominio = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'fuente'; } };
// la renta más barata por GPU y hora, de las que cobran la GPU con su máquina
export const rentaMin = (g) => (g.nube || []).filter((n) => n.usd_gpu_hora && !n.gpu_cobrada_aparte).sort((a, b) => a.usd_gpu_hora - b.usd_gpu_hora)[0] || null;

// El techo de decode de referencia: Llama 3.1 8B en INT4 de AWQ, 5.73 GB de pesos (la cuenta de «¿Cabe en la GPU?»).
const PESOS_REF = 5.73;

export function validarDatos(gpus, equipos) {
  const e = [], ids = new Set(gpus.gpus.map((g) => g.id));
  for (const g of gpus.gpus) {
    for (const k of ['id', 'nombre', 'fabricante', 'segmento', 'vram_gb', 'ancho_banda_gbs']) if (g[k] === undefined || g[k] === null) e.push(`gpus.json ${g.id}: falta «${k}»`);
    if (!SEG[g.segmento]) e.push(`gpus.json ${g.id}: segmento «${g.segmento}» no es ${Object.keys(SEG).join(', ')}`);
    if (!g.fuente?.url || !g.fuente?.consultado) e.push(`gpus.json ${g.id}: la especificación necesita fuente con url y fecha`);
    if (typeof g.compra_usd === 'number' && (!g.compra_detalle?.fuente?.url || !g.compra_detalle?.fuente?.consultado)) e.push(`gpus.json ${g.id}: el precio de compra necesita compra_detalle.fuente con url y fecha`);
  }
  for (const s of equipos.servidores || []) {
    if (!ids.has(s.gpu_id)) e.push(`equipos.json ${s.id}: gpu_id «${s.gpu_id}» no está en gpus.json`);
    if (typeof s.compra_usd !== 'number' || !s.fuente?.url || !s.fuente?.consultado) e.push(`equipos.json ${s.id}: necesita compra_usd y fuente con url y fecha`);
  }
  return e;
}

const celda = (v, txt, extra = '') => `<td data-v="${v === null || v === undefined ? '' : v}"${extra}>${v === null || v === undefined ? '<span class="cat-nd">—</span>' : txt}</td>`;
const fuenteCorta = (f) => (f?.url ? `<a class="cat-src" href="${esc(f.url)}" rel="noopener" target="_blank">${esc(dominio(f.url))} · ${esc(f.consultado || '')}</a>` : '');

export function dibujarCatalogo(gpus, equipos, inline) {
  const filas = gpus.gpus.map((g) => {
    const r = rentaMin(g), compra = typeof g.compra_usd === 'number' ? g.compra_usd : null;
    const techo = g.ancho_banda_gbs ? g.ancho_banda_gbs / PESOS_REF : null;
    const vramMil = compra ? g.vram_gb / (compra / 1000) : null;
    const texto = `${g.nombre} ${g.fabricante} ${g.arquitectura || ''} ${g.memoria || ''}`.toLowerCase();
    return `<tr data-fab="${esc(g.fabricante)}" data-seg="${esc(g.segmento)}" data-vram="${g.vram_gb}" data-precio="${compra ? 1 : 0}" data-texto="${esc(texto)}">
<th scope="row" data-v="${esc(g.nombre)}"><span class="cat-n">${esc(g.nombre)}</span><span class="cat-s">${esc(g.fabricante)} · ${esc(SEG[g.segmento])}${g.anio ? ` · ${g.anio}` : ''}</span><a class="cat-src" href="${esc(g.fuente.url)}" rel="noopener" target="_blank">especificaciones · ${esc(g.fuente.consultado)}</a></th>
${celda(g.vram_gb, `${fmt(g.vram_gb)} GB<span class="cat-s">${esc(g.memoria || '')}</span>`)}
${celda(g.ancho_banda_gbs, `${fmt(g.ancho_banda_gbs)} GB/s`)}
${celda(g.potencia_w, g.potencia_w ? `${fmt(g.potencia_w)} W` : '')}
${celda(g.fp16_tflops_denso, g.fp16_tflops_denso ? fmt(g.fp16_tflops_denso, g.fp16_tflops_denso < 100 ? 1 : 0) : '')}
${celda(g.fp8_tflops_denso, g.fp8_tflops_denso ? fmt(g.fp8_tflops_denso, 0) : '')}
${celda(techo === null ? null : Math.round(techo), techo === null ? '' : fmt(techo))}
${celda(compra, compra ? `US$${fmt(compra)}${fuenteCorta(g.compra_detalle?.fuente)}` : '')}
${celda(vramMil === null ? null : Number(vramMil.toFixed(2)), vramMil === null ? '' : fmt(vramMil, 1))}
${celda(r ? r.usd_gpu_hora : null, r ? `US$${fmt(r.usd_gpu_hora, 2)}<span class="cat-s">${esc(r.proveedor)}</span>${fuenteCorta(r.fuente)}` : '')}
</tr>`;
  }).join('\n');
  const fabs = [...new Set(gpus.gpus.map((g) => g.fabricante))];
  const segs = Object.keys(SEG).filter((s) => gpus.gpus.some((g) => g.segmento === s));
  const chips = (nombre, ops) => `<div class="cat-chips" role="group" aria-label="${esc(nombre)}"><button type="button" class="cat-chip is-on" data-f="${esc(nombre)}" data-val="">Todos</button>${ops.map(([v, t]) => `<button type="button" class="cat-chip" data-f="${esc(nombre)}" data-val="${esc(v)}">${esc(t)}</button>`).join('')}</div>`;
  const filtros = `<div class="cat-filtros">
${chips('fab', fabs.map((f) => [f, f]))}
${chips('seg', segs.map((s) => [s, SEG[s]]))}
<div class="cat-fila"><label class="cat-campo"><span>VRAM mínima</span><select data-f="vram"><option value="0">Cualquiera</option>${[24, 48, 80, 128, 192].map((v) => `<option value="${v}">${v} GB o más</option>`).join('')}</select></label>
<label class="cat-campo cat-campo--check"><input type="checkbox" data-f="precio"> <span>Solo con precio de compra</span></label>
<label class="cat-campo cat-campo--buscar"><span>Buscar</span><input type="search" data-f="texto" placeholder="H100, Apple, GDDR7…" autocomplete="off"></label></div>
<p class="cat-cuenta" aria-live="polite"><b data-cat-n>${gpus.gpus.length}</b> de ${gpus.gpus.length} equipos</p>
</div>`;
  const cols = [['GPU o equipo', 'texto'], ['VRAM', 'num'], ['Ancho de banda', 'num'], ['Consumo máximo', 'num'], ['FP16 denso, TFLOPS', 'num'], ['FP8 denso, TFLOPS', 'num'], ['Techo de decode, 8B en INT4, tokens/s', 'num'], ['Compra de referencia', 'num'], ['GB de VRAM por US$1,000', 'num'], ['Renta más barata por hora', 'num']];
  const tabla = `<div class="cat-scroll" tabindex="0" role="region" aria-label="Tabla de GPUs y equipos"><table class="cat-tabla"><thead><tr>${cols.map(([t, tipo], k) => `<th scope="col"><button type="button" class="cat-orden" data-col="${k}" data-tipo="${tipo}">${esc(t)}<span aria-hidden="true" class="cat-flecha"></span></button></th>`).join('')}</tr></thead><tbody>${filas}</tbody></table></div>`;
  // los servidores completos y las notas de cada precio
  const srv = (equipos.servidores || []).map((s) => {
    const g = gpus.gpus.find((y) => y.id === s.gpu_id);
    return `<tr><th scope="row"><span class="cat-n">${esc(s.nombre)}</span><span class="cat-s">${s.gpus} × ${esc(g.nombre)}</span></th><td>${fmt(s.gpus * g.vram_gb)} GB</td><td>${s.potencia_w ? `${fmt(s.potencia_w)} W` : '<span class="cat-nd">—</span>'}</td><td>US$${fmt(s.compra_usd)}${fuenteCorta(s.fuente)}</td><td>US$${fmt(Math.round(s.compra_usd / s.gpus))}</td></tr>`;
  }).join('');
  const servidores = srv ? `<h3 class="cat-h">Servidores completos con precio publicado</h3><div class="cat-scroll" tabindex="0" role="region" aria-label="Servidores completos"><table class="cat-tabla cat-tabla--srv"><thead><tr><th scope="col">Servidor</th><th scope="col">VRAM en total</th><th scope="col">Consumo máximo</th><th scope="col">Precio</th><th scope="col">Por GPU, con todo</th></tr></thead><tbody>${srv}</tbody></table></div>` : '';
  const notas = gpus.gpus.filter((g) => g.compra_detalle?.descripcion).map((g) => `<li><b>${esc(g.nombre)}.</b> ${inline(g.compra_detalle.descripcion)} ${fuenteCorta(g.compra_detalle.fuente)}</li>`)
    .concat((equipos.servidores || []).filter((s) => s.descripcion).map((s) => `<li><b>${esc(s.nombre)}.</b> ${inline(s.descripcion)} ${fuenteCorta(s.fuente)}</li>`)).join('');
  return `<figure class="cat" data-catalogo>
<figcaption class="calc__head"><span class="calc__icon" aria-hidden="true">▦</span><span class="calc__title">Catálogo de hardware</span><span class="calc__tag">${gpus.gpus.length} equipos</span></figcaption>
${filtros}${tabla}${servidores}
<details class="cat-notas"><summary>De dónde sale cada precio de compra</summary><ul>${notas}</ul></details>
<p class="cx-pie">Especificaciones: hoja de datos del fabricante, con los picos sin sparsity. Precios en US$ sin impuestos, del día que dice cada uno: los de compra suben y bajan mucho. Toca un encabezado para ordenar. Los datos salen de gpus.json, el mismo archivo que usan las calculadoras y Sensei (actualizado ${esc(gpus.actualizado)}).</p>
</figure>`;
}
