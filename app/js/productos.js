// ===== Productos y recetas =====
// costo_receta y margen se leen directo de vw_producto_costos (los calcula la
// base, no hay que recalcular nada acá).
async function loadProductosResumen(){
  const { data, error } = await supabaseClient.from('vw_producto_costos').select('*').order('nombre');
  if (error) { console.error(error); return; }
  productosResumen = data || [];
  renderProductosResumen();
  poblarSelectProductosVenta();
  poblarSelectProductoPadre();
  poblarSelectTortaHorneada();
  if (productoSeleccionadoId) renderRecetaResumen();
  renderResumen();
}

// Tortas enteras disponibles como "padre" para una porción — se repuebla
// cada vez que cambian los productos, preservando la selección si sigue
// existiendo.
function poblarSelectProductoPadre(){
  const select = document.getElementById('selectProductoPadre');
  const actual = select.value;
  const tortas = productosResumen.filter(p => p.tipo === 'Torta entera');
  select.innerHTML = '<option value="">No — esta porción tiene receta propia</option>' +
    tortas.map(p => `<option value="${p.producto_id}">${p.nombre}</option>`).join('');
  if (actual && tortas.some(p => p.producto_id === actual)) select.value = actual;
}

function renderProductosResumen(){
  const tbody = document.getElementById('listaProductos');
  const hayTortas = productosResumen.some(p => p.tipo === 'Torta entera');
  document.getElementById('panelHorneada').style.display = hayTortas ? 'block' : 'none';

  tbody.innerHTML = productosResumen.length ? productosResumen.map(p => {
    const margenNeg = Number(p.margen) < 0;
    const esPorcionDerivada = !!p.producto_padre_id;
    let nombreCelda = esPorcionDerivada
      ? `${p.nombre}<br><span class="tag">de: ${p.producto_padre_nombre} ÷ ${p.porciones_por_torta}</span>`
      : p.nombre;
    // Stock de porciones ya cortadas y disponibles para vender (solo aplica
    // a porciones derivadas de una torta — ver horneadas).
    if (esPorcionDerivada) {
      const stock = Number(p.stock_porciones);
      nombreCelda += `<br><span class="tag${stock <= 0 ? ' low' : ''}">Disponibles: ${stock}</span>`;
    }
    return `<tr>
      <td>${nombreCelda}</td>
      <td><span class="tag">${p.tipo}</span></td>
      <td class="num">${fmt(p.precio_venta)}</td>
      <td class="num">${fmt(p.costo_receta)}</td>
      <td class="num${margenNeg ? ' neg' : ''}">${fmt(p.margen)}</td>
      <td>${esPorcionDerivada ? '' : `<button class="ghost" onclick="abrirReceta('${p.producto_id}')">Receta</button>`}</td>
      <td><button class="ghost" onclick="editarProducto('${p.producto_id}')">Editar</button></td>
      <td><button class="ghost" onclick="duplicarProducto('${p.producto_id}')">Duplicar</button></td>
      <td><button class="ghost" onclick="borrarProducto('${p.producto_id}')">Borrar</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="9" class="empty">Sin productos cargados todavía.</td></tr>`;
}

// Los campos de "torta madre" solo tienen sentido para tipo 'Porción'.
function actualizarCamposPorcion(){
  const esPorcion = document.getElementById('selectTipoProducto').value === 'Porción';
  document.getElementById('campoProductoPadre').style.display = esPorcion ? '' : 'none';
  document.getElementById('campoPorciones').style.display = esPorcion ? '' : 'none';
  document.getElementById('notaPorcionPadre').style.display = esPorcion ? '' : 'none';
}
document.getElementById('selectTipoProducto').addEventListener('change', actualizarCamposPorcion);
actualizarCamposPorcion();

// Si hay un id acá, el form de arriba está editando ese producto en vez de
// crear uno nuevo — ver editarProducto()/cancelarEdicionProducto().
let productoEditandoId = null;

document.getElementById('formProducto').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const productoPadreId = f.get('producto_padre_id') || null;
  const payload = {
    nombre: f.get('nombre'),
    tipo: f.get('tipo'),
    precio_venta: Number(f.get('precio_venta')),
    producto_padre_id: productoPadreId,
    porciones_por_torta: productoPadreId ? Number(f.get('porciones_por_torta')) : null
  };
  const { error } = productoEditandoId
    ? await supabaseClient.from('productos').update(payload).eq('id', productoEditandoId)
    : await supabaseClient.from('productos').insert(payload);
  if (error) { alert('No se pudo guardar el producto: ' + error.message); return; }
  await loadProductosResumen();
  cancelarEdicionProducto();
});

// Carga el producto en el form de arriba para editarlo completo (nombre,
// tipo, precio, y el vínculo con la torta madre si lo tiene) — antes solo se
// podía cambiar nombre/precio por prompt(), y el tipo no se podía tocar.
window.editarProducto = id => {
  const p = productosResumen.find(x => x.producto_id === id);
  if (!p) return;
  productoEditandoId = id;
  const form = document.getElementById('formProducto');
  form.nombre.value = p.nombre;
  form.tipo.value = p.tipo;
  form.precio_venta.value = p.precio_venta;
  actualizarCamposPorcion();
  form.producto_padre_id.value = p.producto_padre_id || '';
  form.porciones_por_torta.value = p.porciones_por_torta || '';
  document.getElementById('tituloFormProducto').textContent = 'Editar producto';
  document.getElementById('btnGuardarProducto').textContent = 'Guardar cambios';
  document.getElementById('btnCancelarEdicionProducto').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function cancelarEdicionProducto(){
  productoEditandoId = null;
  document.getElementById('formProducto').reset();
  actualizarCamposPorcion();
  document.getElementById('tituloFormProducto').textContent = 'Agregar producto';
  document.getElementById('btnGuardarProducto').textContent = 'Guardar';
  document.getElementById('btnCancelarEdicionProducto').style.display = 'none';
}
document.getElementById('btnCancelarEdicionProducto').addEventListener('click', cancelarEdicionProducto);

// Copia un producto (tipo, precio, y si tiene, el vínculo con su torta
// madre) junto con toda su receta propia — así una torta que ya armaste no
// hay que volver a cargarla insumo por insumo cada vez que necesitás una
// variante o repetir el registro.
window.duplicarProducto = async id => {
  const p = productosResumen.find(x => x.producto_id === id);
  if (!p) return;
  const nombre = prompt('Nombre del producto duplicado:', p.nombre + ' (copia)');
  if (nombre === null) return;

  const { data: nuevo, error } = await supabaseClient.from('productos').insert({
    nombre,
    tipo: p.tipo,
    precio_venta: Number(p.precio_venta),
    producto_padre_id: p.producto_padre_id,
    porciones_por_torta: p.porciones_por_torta
  }).select().single();
  if (error) { alert('No se pudo duplicar: ' + error.message); return; }

  const { data: recetaOriginal, error: errReceta } = await supabaseClient
    .from('receta_items')
    .select('insumo_id, cantidad_necesaria')
    .eq('producto_id', id);
  if (errReceta) { alert('El producto se duplicó, pero no se pudo copiar la receta: ' + errReceta.message); }
  else if (recetaOriginal?.length) {
    const copiaReceta = recetaOriginal.map(r => ({
      producto_id: nuevo.id,
      insumo_id: r.insumo_id,
      cantidad_necesaria: r.cantidad_necesaria
    }));
    const { error: errCopia } = await supabaseClient.from('receta_items').insert(copiaReceta);
    if (errCopia) alert('El producto se duplicó, pero no se pudo copiar la receta: ' + errCopia.message);
  }

  await loadProductosResumen();
};

window.borrarProducto = async id => {
  const { error } = await supabaseClient.from('productos').delete().eq('id', id);
  if (error) { alert('No se pudo borrar: ' + error.message + '\n(Puede tener ventas registradas)'); return; }
  if (productoSeleccionadoId === id) cerrarReceta();
  if (productoEditandoId === id) cancelarEdicionProducto();
  await loadProductosResumen();
};

window.abrirReceta = async id => {
  productoSeleccionadoId = id;
  const p = productosResumen.find(x => x.producto_id === id);
  document.getElementById('recetaProductoNombre').textContent = p ? p.nombre : '';
  document.getElementById('panelReceta').style.display = 'block';
  document.getElementById('panelReceta').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  await loadReceta();
};

function cerrarReceta(){
  productoSeleccionadoId = null;
  document.getElementById('panelReceta').style.display = 'none';
}

let recetaActual = [];

async function loadReceta(){
  const { data, error } = await supabaseClient
    .from('receta_items')
    .select('*, insumos(nombre, unidad, costo_unitario)')
    .eq('producto_id', productoSeleccionadoId)
    .order('created_at');
  if (error) { console.error(error); return; }
  recetaActual = data || [];
  renderReceta();
  renderRecetaResumen();
}

function renderReceta(){
  const tbody = document.getElementById('listaReceta');
  tbody.innerHTML = recetaActual.length ? recetaActual.map(r => {
    const costoParcial = Number(r.cantidad_necesaria) * Number(r.insumos?.costo_unitario || 0);
    return `<tr>
      <td>${r.insumos?.nombre ?? '—'}</td>
      <td class="num">${r.cantidad_necesaria} ${r.insumos?.unidad ?? ''}</td>
      <td class="num">${fmt(costoParcial)}</td>
      <td><button class="ghost" onclick="borrarRecetaItem('${r.id}')">Quitar</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="4" class="empty">Todavía no tiene insumos en la receta.</td></tr>`;
}

function renderRecetaResumen(){
  const p = productosResumen.find(x => x.producto_id === productoSeleccionadoId);
  const div = document.getElementById('recetaResumen');
  if (!p) { div.innerHTML = ''; return; }
  const margenNeg = Number(p.margen) < 0;
  div.innerHTML = `
    <span>Precio de venta: <b>${fmt(p.precio_venta)}</b></span>
    <span>Costo de receta: <b>${fmt(p.costo_receta)}</b></span>
    <span>Margen: <b class="${margenNeg ? 'neg' : ''}">${fmt(p.margen)}</b></span>
  `;
}

document.getElementById('formReceta').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const insumoId = f.get('insumo_id');
  const cantidad = Number(f.get('cantidad_necesaria'));
  const existente = recetaActual.find(r => r.insumo_id === insumoId);
  if (existente) {
    await supabaseClient.from('receta_items').update({ cantidad_necesaria: cantidad }).eq('id', existente.id);
  } else {
    await supabaseClient.from('receta_items').insert({
      producto_id: productoSeleccionadoId,
      insumo_id: insumoId,
      cantidad_necesaria: cantidad
    });
  }
  await loadReceta();
  await loadProductosResumen();
  e.target.reset();
});

window.borrarRecetaItem = async id => {
  await supabaseClient.from('receta_items').delete().eq('id', id);
  await loadReceta();
  await loadProductosResumen();
};
