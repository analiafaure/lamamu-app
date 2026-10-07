// ===== Insumos =====
async function loadInsumos(){
  const { data, error } = await supabaseClient.from('insumos').select('*').order('nombre');
  if (error) { console.error(error); return; }
  insumos = data || [];
  renderInsumos();
  poblarSelectsInsumos();
  renderResumen();
}

// Selects que dependen de la lista de insumos (receta y reposición) — se
// repueblan cada vez que loadInsumos() trae datos frescos.
function poblarSelectsInsumos(){
  const opciones = insumos.length
    ? insumos.map(i => `<option value="${i.id}">${i.nombre} (${i.unidad})</option>`).join('')
    : '';
  document.getElementById('selectInsumoReceta').innerHTML = opciones;
  document.getElementById('selectInsumoReposicion').innerHTML = opciones;
}

function renderInsumos(){
  const tbody = document.getElementById('listaInsumos');
  tbody.innerHTML = insumos.length ? insumos.map(i => {
    const low = Number(i.stock_minimo) > 0 && Number(i.cantidad) <= Number(i.stock_minimo);
    return `<tr>
      <td>${i.nombre} ${low ? '<span class="tag low">bajo</span>' : ''}</td>
      <td class="num">${i.cantidad} ${i.unidad}</td>
      <td class="num">${fmt(i.costo_unitario)}</td>
      <td class="num">${fmt(i.cantidad * i.costo_unitario)}</td>
      <td><button class="ghost" onclick="editarInsumo('${i.id}')">Editar</button></td>
      <td><button class="ghost" onclick="borrarInsumo('${i.id}')">Borrar</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="6" class="empty">Sin insumos cargados todavía.</td></tr>`;
}

// Se carga cantidad + lo que pagaste en total (no el costo por unidad, para
// no tener que calcularlo a mano) — el costo_unitario que se guarda sale de
// dividir uno por otro.
function actualizarPreviewCostoInsumo(){
  const cantidad = Number(document.getElementById('cantidadInsumo').value);
  const costoTotal = Number(document.getElementById('costoTotalInsumo').value);
  const unidad = document.getElementById('formInsumo').querySelector('[name=unidad]').value;
  const preview = document.getElementById('previewCostoInsumo');
  if (cantidad > 0 && costoTotal > 0) {
    preview.textContent = `= ${fmt(costoTotal / cantidad)} por ${unidad}`;
  } else {
    preview.textContent = '';
  }
}
document.getElementById('cantidadInsumo').addEventListener('input', actualizarPreviewCostoInsumo);
document.getElementById('costoTotalInsumo').addEventListener('input', actualizarPreviewCostoInsumo);
document.getElementById('formInsumo').querySelector('[name=unidad]').addEventListener('change', actualizarPreviewCostoInsumo);

document.getElementById('formInsumo').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const nombre = f.get('nombre');
  const cantidad = Number(f.get('cantidad'));
  const costoTotal = Number(f.get('costoTotal'));
  const existente = insumos.find(i => i.nombre.toLowerCase() === nombre.toLowerCase());
  const data = {
    nombre,
    cantidad,
    unidad: f.get('unidad'),
    costo_unitario: cantidad > 0 ? costoTotal / cantidad : 0,
    stock_minimo: Number(f.get('minimo') || 0)
  };
  if (existente) {
    await supabaseClient.from('insumos').update(data).eq('id', existente.id);
  } else {
    await supabaseClient.from('insumos').insert(data);
  }
  await loadInsumos();
  e.target.reset();
  document.getElementById('previewCostoInsumo').textContent = '';
});

window.borrarInsumo = async id => {
  const { error } = await supabaseClient.from('insumos').delete().eq('id', id);
  if (error) { alert('No se pudo borrar: ' + error.message + '\n(Puede estar usado en una receta)'); return; }
  await loadInsumos();
};

window.editarInsumo = async id => {
  const i = insumos.find(x => x.id === id);
  if (!i) return;
  const cant = prompt('Nueva cantidad de "' + i.nombre + '" (' + i.unidad + '):', i.cantidad);
  if (cant === null) return;
  const costo = prompt('Nuevo costo unitario de "' + i.nombre + '":', i.costo_unitario);
  if (costo === null) return;
  await supabaseClient.from('insumos').update({ cantidad: Number(cant), costo_unitario: Number(costo) }).eq('id', id);
  await loadInsumos();
};
