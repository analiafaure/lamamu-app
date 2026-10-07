// ===== Reposición de stock =====
// El trigger suma cantidad, actualiza costo_unitario y crea el gasto — acá
// solo insertamos. No hay botón de borrar: no existe un trigger que revierta
// el stock/costo que ya se aplicó, así que el historial queda como registro
// fijo (igual que un movimiento contable ya asentado).
async function loadReposiciones(){
  const { data, error } = await supabaseClient
    .from('reposiciones')
    .select('*, insumos(nombre, unidad)')
    .order('fecha', { ascending: false });
  if (error) { console.error(error); return; }
  reposiciones = data || [];
  renderReposiciones();
}

function renderReposiciones(){
  const tbody = document.getElementById('listaReposiciones');
  tbody.innerHTML = reposiciones.length ? reposiciones.map(r => `<tr>
      <td>${r.fecha}</td>
      <td>${r.insumos?.nombre ?? '—'}</td>
      <td class="num">${r.cantidad} ${r.insumos?.unidad ?? ''}</td>
      <td class="num">${fmt(r.costo_unitario)}</td>
      <td class="num">${fmt(r.monto_total)}</td>
    </tr>`).join('') : `<tr><td colspan="5" class="empty">Sin reposiciones cargadas.</td></tr>`;
}

// Mismo criterio que en Insumos: se carga cantidad comprada + costo total
// pagado, no el costo por unidad — se divide uno por otro solo.
function actualizarPreviewCostoReposicion(){
  const cantidad = Number(document.getElementById('cantidadReposicion').value);
  const costoTotal = Number(document.getElementById('costoTotalReposicion').value);
  const insumoId = document.getElementById('selectInsumoReposicion').value;
  const insumo = insumos.find(i => i.id === insumoId);
  const preview = document.getElementById('previewCostoReposicion');
  if (cantidad > 0 && costoTotal > 0 && insumo) {
    preview.textContent = `= ${fmt(costoTotal / cantidad)} por ${insumo.unidad}`;
  } else {
    preview.textContent = '';
  }
}
document.getElementById('cantidadReposicion').addEventListener('input', actualizarPreviewCostoReposicion);
document.getElementById('costoTotalReposicion').addEventListener('input', actualizarPreviewCostoReposicion);
document.getElementById('selectInsumoReposicion').addEventListener('change', actualizarPreviewCostoReposicion);

document.getElementById('formReposicion').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const insumoId = f.get('insumo_id');
  if (!insumoId) return;
  const cantidad = Number(f.get('cantidad'));
  const costoTotal = Number(f.get('costoTotal'));
  const { error } = await supabaseClient.from('reposiciones').insert({
    fecha: f.get('fecha'),
    insumo_id: insumoId,
    cantidad,
    costo_unitario: cantidad > 0 ? costoTotal / cantidad : 0
  });
  if (error) { alert('No se pudo registrar la reposición: ' + error.message); return; }
  await loadReposiciones();
  await loadInsumos();
  await loadProductosResumen(); // el costo_unitario nuevo cambia costo_receta/margen
  await loadGastos(); // el trigger generó el gasto de "Reposición de ..." solo
  e.target.reset();
  e.target.querySelector('[name=fecha]').value = todayStr();
  document.getElementById('previewCostoReposicion').textContent = '';
});

document.getElementById('formReposicion').querySelector('[name=fecha]').value = todayStr();
