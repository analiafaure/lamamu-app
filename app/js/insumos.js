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

// Si hay un id acá, el form de arriba está editando ese insumo en vez de
// crear uno nuevo — ver editarInsumo()/cancelarEdicionInsumo().
let insumoEditandoId = null;

document.getElementById('formInsumo').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const nombre = f.get('nombre');
  const unidad = f.get('unidad');
  const cantidad = Number(f.get('cantidad'));
  const costoTotal = Number(f.get('costoTotal'));
  const stockMinimo = Number(f.get('minimo') || 0);

  if (insumoEditandoId) {
    // Editar: corrige los datos tal cual quedaron en el form. A propósito NO
    // pasa por reposiciones — es una corrección, no una compra nueva, así
    // que no tiene que generar un gasto cada vez que se ajusta algo.
    const { error } = await supabaseClient.from('insumos').update({
      nombre,
      unidad,
      cantidad,
      costo_unitario: cantidad > 0 ? costoTotal / cantidad : 0,
      stock_minimo: stockMinimo
    }).eq('id', insumoEditandoId);
    if (error) { alert('No se pudo guardar: ' + error.message); return; }
  } else {
    // Alta: esto SÍ es una compra real (cantidad inicial + lo que se pagó),
    // así que tiene que generar un gasto — igual que una reposición. Se crea
    // el insumo en 0 y, si cargaron cantidad/costo, se registra como una
    // reposición: el trigger de reposiciones ya suma el stock, fija el
    // costo_unitario y crea el gasto "Reposición de ..." solo (ver
    // supabase-schema-v2) — antes este alta no generaba ningún gasto, que
    // era un agujero real en los números.
    const { data: nuevo, error } = await supabaseClient.from('insumos').insert({
      nombre, unidad, cantidad: 0, costo_unitario: 0, stock_minimo: stockMinimo
    }).select().single();
    if (error) { alert('No se pudo guardar: ' + error.message); return; }

    if (cantidad > 0 && costoTotal > 0) {
      const { error: errRepo } = await supabaseClient.from('reposiciones').insert({
        fecha: todayStr(),
        insumo_id: nuevo.id,
        cantidad,
        costo_unitario: costoTotal / cantidad
      });
      if (errRepo) alert('El insumo se creó, pero no se pudo registrar la compra inicial como gasto: ' + errRepo.message);
      else await loadGastos();
    }
  }

  await loadInsumos();
  cancelarEdicionInsumo();
});

// Carga el insumo en el form de arriba para editarlo completo (nombre,
// unidad, stock mínimo, cantidad, costo) — antes solo se podía cambiar
// cantidad/costo por prompt(), y no se podía tocar nombre/unidad/mínimo.
window.editarInsumo = id => {
  const i = insumos.find(x => x.id === id);
  if (!i) return;
  insumoEditandoId = id;
  const form = document.getElementById('formInsumo');
  form.nombre.value = i.nombre;
  form.unidad.value = i.unidad;
  form.cantidad.value = i.cantidad;
  form.costoTotal.value = Number((i.cantidad * i.costo_unitario).toFixed(2));
  form.minimo.value = i.stock_minimo;
  actualizarPreviewCostoInsumo();
  document.getElementById('tituloFormInsumo').textContent = 'Editar insumo';
  document.getElementById('btnGuardarInsumo').textContent = 'Guardar cambios';
  document.getElementById('btnCancelarEdicionInsumo').style.display = '';
  document.getElementById('notaEdicionInsumo').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function cancelarEdicionInsumo(){
  insumoEditandoId = null;
  document.getElementById('formInsumo').reset();
  document.getElementById('previewCostoInsumo').textContent = '';
  document.getElementById('tituloFormInsumo').textContent = 'Agregar insumo';
  document.getElementById('btnGuardarInsumo').textContent = 'Guardar';
  document.getElementById('btnCancelarEdicionInsumo').style.display = 'none';
  document.getElementById('notaEdicionInsumo').style.display = 'none';
}
document.getElementById('btnCancelarEdicionInsumo').addEventListener('click', cancelarEdicionInsumo);

window.borrarInsumo = async id => {
  const { error } = await supabaseClient.from('insumos').delete().eq('id', id);
  if (error) { alert('No se pudo borrar: ' + error.message + '\n(Puede estar usado en una receta)'); return; }
  if (insumoEditandoId === id) cancelarEdicionInsumo();
  await loadInsumos();
};
