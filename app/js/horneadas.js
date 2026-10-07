// ===== Horneadas (producción de tortas enteras) =====
// Hornear una torta es un evento de producción, no de venta: el trigger de
// la base descuenta los insumos de su receta y suma porciones_por_torta al
// stock de cada porción que la tenga como padre — acá solo insertamos y
// refrescamos productos/insumos.
function poblarSelectTortaHorneada(){
  const select = document.getElementById('selectTortaHorneada');
  const actual = select.value;
  const tortas = productosResumen.filter(p => p.tipo === 'Torta entera');
  select.innerHTML = tortas.length
    ? tortas.map(p => `<option value="${p.producto_id}">${p.nombre}</option>`).join('')
    : '<option value="">Cargá una torta entera primero</option>';
  if (actual && tortas.some(p => p.producto_id === actual)) select.value = actual;
}

async function loadHorneadas(){
  const { data, error } = await supabaseClient
    .from('horneadas')
    .select('*, productos(nombre)')
    .order('fecha', { ascending: false });
  if (error) { console.error(error); return; }
  horneadas = data || [];
  renderHorneadas();
}

function renderHorneadas(){
  const tbody = document.getElementById('listaHorneadas');
  tbody.innerHTML = horneadas.length ? horneadas.slice(0, 10).map(h => `<tr>
      <td>${h.fecha}</td>
      <td>${h.productos?.nombre ?? '—'}</td>
      <td class="num">${h.cantidad}</td>
      <td><button class="ghost" onclick="borrarHorneada('${h.id}')">Borrar</button></td>
    </tr>`).join('') : `<tr><td colspan="4" class="empty">Todavía no registraste ninguna horneada.</td></tr>`;
}

// Deshace una horneada cargada por error: el trigger devuelve los insumos
// descontados y resta las porciones que había sumado. Si ya se vendieron
// porciones de esa horneada, el trigger rechaza el borrado (quedaría el
// stock en negativo) — hay que corregir esas ventas primero.
window.borrarHorneada = async id => {
  if (!confirm('¿Borrar esta horneada? Se devuelven los insumos descontados y se resta el stock de porciones que generó.')) return;
  const { error } = await supabaseClient.from('horneadas').delete().eq('id', id);
  if (error) { alert('No se pudo borrar la horneada: ' + error.message); return; }
  await loadHorneadas();
  await loadProductosResumen();
  await loadInsumos();
};

document.getElementById('formHorneada').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const productoId = f.get('producto_id');
  if (!productoId) return;
  const { error } = await supabaseClient.from('horneadas').insert({
    fecha: f.get('fecha'),
    producto_id: productoId,
    cantidad: Number(f.get('cantidad'))
  });
  if (error) { alert('No se pudo registrar la horneada: ' + error.message); return; }
  await loadHorneadas();
  await loadProductosResumen();
  await loadInsumos();
  e.target.reset();
  e.target.querySelector('[name=cantidad]').value = 1;
  e.target.querySelector('[name=fecha]').value = todayStr();
});
document.getElementById('formHorneada').querySelector('[name=fecha]').value = todayStr();
