// ===== Resumen =====
// Todo sale de lo que ya está cargado en memoria (ventas, gastos, insumos,
// productosResumen) — no pega ninguna query propia. Se llama de nuevo cada
// vez que cualquiera de esos cuatro termina de cargar o cambia.
function renderResumen(){
  const vMes = ventas.filter(v => esteMes(v.fecha));
  const gMes = gastos.filter(g => esteMes(g.fecha));
  const totalVentas = vMes.reduce((a, v) => a + Number(v.cantidad) * Number(v.precio_unitario), 0);
  const totalGastos = gMes.reduce((a, g) => a + Number(g.monto), 0);
  const ganancia = totalVentas - totalGastos;

  document.getElementById('statVentasMes').textContent = fmt(totalVentas);
  document.getElementById('statGastosMes').textContent = fmt(totalGastos);
  document.getElementById('statGanancia').textContent = fmt(ganancia);
  document.getElementById('statGananciaBox').className = 'stat ' + (ganancia >= 0 ? 'good' : 'bad');

  const low = insumos.filter(i => Number(i.stock_minimo) > 0 && Number(i.cantidad) <= Number(i.stock_minimo));
  document.getElementById('lowStockList').innerHTML = low.length
    ? low.map(i => `<span class="tag low">${i.nombre}: ${i.cantidad} ${i.unidad}</span> `).join(' ')
    : '<div class="empty">Ningún insumo por debajo del mínimo.</div>';

  const ranking = [...productosResumen].sort((a, b) => Number(b.margen) - Number(a.margen));
  document.getElementById('rankingProductos').innerHTML = ranking.length
    ? ranking.map(p => {
        const margenNeg = Number(p.margen) < 0;
        const pct = Number(p.precio_venta) > 0 ? Math.round(Number(p.margen) / Number(p.precio_venta) * 100) + '%' : '—';
        return `<tr>
          <td>${p.nombre}</td>
          <td class="num${margenNeg ? ' neg' : ''}">${fmt(p.margen)}</td>
          <td class="num${margenNeg ? ' neg' : ''}">${pct}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="3" class="empty">Todavía no hay productos cargados.</td></tr>`;

  const ult = ventas.slice(0, 6);
  document.getElementById('ultimasVentas').innerHTML = ult.length
    ? ult.map(v => `<tr>
        <td>${v.fecha}</td>
        <td>${v.productos?.nombre ?? '—'}</td>
        <td class="num">${v.cantidad}</td>
        <td class="num">${fmt(v.cantidad * v.precio_unitario)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" class="empty">Todavía no cargaste ventas.</td></tr>`;
}

// ===== Visitas a la landing =====
// Solo lectura acá — la landing (landing/index.html) es la que inserta una
// fila por cada carga de página. Este número es privado: no se muestra en
// la landing pública, solo acá adentro (logueada).
async function loadVisitasLanding(){
  const { count, error } = await supabaseClient
    .from('visitas_landing')
    .select('*', { count: 'exact', head: true });
  if (error) { console.error(error); return; }
  document.getElementById('statVisitas').textContent = Number(count ?? 0).toLocaleString('es-AR');
}
