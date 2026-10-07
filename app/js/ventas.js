// ===== Ventas =====
// El trigger de la base descuenta el stock según la receta del producto — acá
// solo hace falta insertar y refrescar insumos para que se vea el nuevo stock.
function poblarSelectProductosVenta(){
  const select = document.getElementById('selectProductoVenta');
  const actual = select.value;
  select.innerHTML = productosResumen.length
    ? productosResumen.map(p => `<option value="${p.producto_id}" data-precio="${p.precio_venta}" data-derivada="${!!p.producto_padre_id}" data-stock="${p.stock_porciones}">${p.nombre}</option>`).join('')
    : '<option value="">Cargá un producto primero</option>';
  if (actual && productosResumen.some(p => p.producto_id === actual)) select.value = actual;
  mostrarStockPorcionVenta();
}

// Si el producto elegido es una porción derivada de una torta, muestra
// cuántas quedan disponibles (la venta la rechaza la base si te pasás).
function mostrarStockPorcionVenta(){
  const opt = document.getElementById('selectProductoVenta').selectedOptions[0];
  const nota = document.getElementById('stockPorcionVenta');
  if (opt?.dataset.derivada === 'true') {
    nota.style.display = '';
    nota.textContent = `Porciones disponibles de esta torta: ${opt.dataset.stock}`;
  } else {
    nota.style.display = 'none';
  }
}

document.getElementById('selectProductoVenta').addEventListener('change', e => {
  const opt = e.target.selectedOptions[0];
  const precio = opt?.dataset.precio;
  if (precio) document.getElementById('formVenta').querySelector('[name=precio_unitario]').value = precio;
  mostrarStockPorcionVenta();
});

async function loadVentas(){
  const { data, error } = await supabaseClient
    .from('ventas')
    .select('*, productos(nombre)')
    .order('fecha', { ascending: false });
  if (error) { console.error(error); return; }
  ventas = data || [];
  renderVentas();
  renderResumen();
}

function renderVentas(){
  const tbody = document.getElementById('listaVentas');
  tbody.innerHTML = ventas.length ? ventas.map(v => `<tr>
      <td>${v.fecha}</td>
      <td>${v.productos?.nombre ?? '—'}</td>
      <td class="num">${v.cantidad}</td>
      <td class="num">${fmt(v.precio_unitario)}</td>
      <td class="num">${fmt(v.cantidad * v.precio_unitario)}</td>
      <td><button class="ghost" onclick="borrarVenta('${v.id}')">Borrar</button></td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">Sin ventas cargadas.</td></tr>`;
}

document.getElementById('formVenta').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const productoId = f.get('producto_id');
  if (!productoId) return;
  const { error } = await supabaseClient.from('ventas').insert({
    fecha: f.get('fecha'),
    producto_id: productoId,
    cantidad: Number(f.get('cantidad')),
    precio_unitario: Number(f.get('precio_unitario'))
  });
  if (error) { alert('No se pudo registrar la venta: ' + error.message); return; }
  await loadVentas();
  await loadInsumos();
  e.target.reset();
  e.target.querySelector('[name=fecha]').value = todayStr();
  await loadProductosResumen();
});

window.borrarVenta = async id => {
  const { error } = await supabaseClient.from('ventas').delete().eq('id', id);
  if (error) { alert('No se pudo borrar la venta: ' + error.message); return; }
  await loadVentas();
  await loadInsumos();
  await loadProductosResumen();
};

document.getElementById('formVenta').querySelector('[name=fecha]').value = todayStr();
