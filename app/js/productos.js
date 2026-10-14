// ===== Productos y recetas =====
// costo_receta y margen se leen directo de vw_producto_costos (los calcula la
// base, no hay que recalcular nada acá) — excepto para un producto que
// todavía no existe (ver recetaDraft más abajo), donde no hay fila en la
// vista todavía y el costo se calcula en el cliente a partir del borrador.
async function loadProductosResumen(){
  const { data, error } = await supabaseClient.from('vw_producto_costos').select('*').order('nombre');
  if (error) { console.error(error); return; }
  productosResumen = data || [];
  renderProductosResumen();
  poblarListaCategorias();
  poblarSelectProductosVenta();
  poblarSelectProductoPadre();
  poblarSelectTortaHorneada();
  renderRecetaResumen();
  actualizarPrecioSugerido();
  renderResumen();
}

// Sugerencias de categoría ya usadas (ej. "Matilda", "Vainilla") para no
// terminar con variantes de tipeo ("Chocolate" vs "chocolate") que romperían
// el agrupado de la tabla de abajo.
function poblarListaCategorias(){
  const categorias = [...new Set(productosResumen.map(p => (p.categoria || '').trim()).filter(Boolean))].sort();
  document.getElementById('listaCategorias').innerHTML = categorias.map(c => `<option value="${c}">`).join('');
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

// La tabla ya no es una lista plana: se agrupa por categoría (ej. todas las
// variantes/tamaños de "Matilda" juntas) para que no se mezcle todo — los
// productos sin categoría quedan en un grupo al final.
function renderProductosResumen(){
  const tbody = document.getElementById('listaProductos');
  const hayTortas = productosResumen.some(p => p.tipo === 'Torta entera');
  document.getElementById('panelHorneada').style.display = hayTortas ? 'block' : 'none';

  if (!productosResumen.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">Sin productos cargados todavía.</td></tr>`;
    return;
  }

  const grupos = new Map();
  for (const p of productosResumen) {
    const cat = (p.categoria || '').trim() || 'Sin categoría';
    if (!grupos.has(cat)) grupos.set(cat, []);
    grupos.get(cat).push(p);
  }
  const categoriasOrdenadas = [...grupos.keys()].sort((a, b) => {
    if (a === 'Sin categoría') return 1;
    if (b === 'Sin categoría') return -1;
    return a.localeCompare(b);
  });

  tbody.innerHTML = categoriasOrdenadas.map(cat =>
    `<tr class="grupo-categoria"><td colspan="8">${cat}</td></tr>` + grupos.get(cat).map(filaProducto).join('')
  ).join('');
}

function filaProducto(p){
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
    <td><button class="ghost" onclick="editarProducto('${p.producto_id}')">Editar</button></td>
    <td><button class="ghost" onclick="duplicarProducto('${p.producto_id}')">Duplicar</button></td>
    <td><button class="ghost" onclick="borrarProducto('${p.producto_id}')">Borrar</button></td>
  </tr>`;
}

// Los campos de "torta madre" solo tienen sentido para tipo 'Porción', y el
// bloque de receta/precio sugerido no tiene sentido si la porción ya deriva
// su costo de una torta madre (no tiene receta propia).
function actualizarCamposPorcion(){
  const esPorcion = document.getElementById('selectTipoProducto').value === 'Porción';
  document.getElementById('campoProductoPadre').style.display = esPorcion ? '' : 'none';
  document.getElementById('campoPorciones').style.display = esPorcion ? '' : 'none';
  document.getElementById('notaPorcionPadre').style.display = esPorcion ? '' : 'none';
  actualizarVisibilidadReceta();
}
document.getElementById('selectTipoProducto').addEventListener('change', actualizarCamposPorcion);
document.getElementById('selectProductoPadre').addEventListener('change', actualizarVisibilidadReceta);

function actualizarVisibilidadReceta(){
  const esPorcion = document.getElementById('selectTipoProducto').value === 'Porción';
  const tienePadre = !!document.getElementById('selectProductoPadre').value;
  const ocultar = esPorcion && tienePadre;
  document.getElementById('bloqueReceta').style.display = ocultar ? 'none' : '';
  document.getElementById('campoPrecioSugerido').style.display = ocultar ? 'none' : '';
}

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
    categoria: f.get('categoria') || null,
    precio_venta: Number(f.get('precio_venta')),
    producto_padre_id: productoPadreId,
    porciones_por_torta: productoPadreId ? Number(f.get('porciones_por_torta')) : null
  };

  if (productoEditandoId) {
    const { error } = await supabaseClient.from('productos').update(payload).eq('id', productoEditandoId);
    if (error) { alert('No se pudo guardar el producto: ' + error.message); return; }
  } else {
    // Alta: el producto se crea junto con la receta que se fue armando en el
    // borrador (recetaDraft) — así no hace falta guardar el producto primero
    // y después abrir otra pantalla para cargarle la receta.
    const { data: nuevo, error } = await supabaseClient.from('productos').insert(payload).select().single();
    if (error) { alert('No se pudo guardar el producto: ' + error.message); return; }
    if (recetaDraft.length) {
      const items = recetaDraft.map(r => ({
        producto_id: nuevo.id,
        insumo_id: r.insumo_id,
        cantidad_necesaria: r.cantidad_necesaria
      }));
      const { error: errReceta } = await supabaseClient.from('receta_items').insert(items);
      if (errReceta) alert('El producto se creó, pero no se pudo guardar la receta: ' + errReceta.message);
    }
  }
  await loadProductosResumen();
  cancelarEdicionProducto();
});

// Carga el producto en el form de arriba para editarlo completo (nombre,
// tipo, categoría, precio, el vínculo con la torta madre si lo tiene) y trae
// su receta real para poder agregarle/editarle/quitarle insumos ahí mismo.
window.editarProducto = async id => {
  const p = productosResumen.find(x => x.producto_id === id);
  if (!p) return;
  productoEditandoId = id;
  const form = document.getElementById('formProducto');
  form.nombre.value = p.nombre;
  form.tipo.value = p.tipo;
  form.categoria.value = p.categoria || '';
  form.precio_venta.value = p.precio_venta;
  actualizarCamposPorcion();
  form.producto_padre_id.value = p.producto_padre_id || '';
  form.porciones_por_torta.value = p.porciones_por_torta || '';
  actualizarVisibilidadReceta();
  document.getElementById('tituloFormProducto').textContent = 'Editar producto';
  document.getElementById('btnGuardarProducto').textContent = 'Guardar cambios';
  document.getElementById('btnCancelarEdicionProducto').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await loadReceta();
};

// Costo de receta del producto que se está armando ahora mismo: si se está
// editando uno que ya existe, el costo real (vw_producto_costos); si es uno
// nuevo todavía sin guardar, la suma del borrador (recetaDraft).
function costoRecetaActual(){
  if (productoEditandoId) {
    const p = productosResumen.find(x => x.producto_id === productoEditandoId);
    return p ? Number(p.costo_receta) : 0;
  }
  return recetaDraft.reduce((suma, r) => {
    const insumo = insumos.find(i => i.id === r.insumo_id);
    return suma + Number(r.cantidad_necesaria) * Number(insumo?.costo_unitario || 0);
  }, 0);
}

// Precio sugerido = costo de receta + el % de margen que se quiera aplicar
// (por defecto 100%, osea duplicar el costo) — ya se calcula al armar la
// receta de un producto nuevo, no solo al editar uno existente. Solo rellena
// el campo del form si se toca "Usar $X", el usuario decide si lo deja así o
// lo ajusta antes de guardar.
function actualizarPrecioSugerido(){
  const costo = costoRecetaActual();
  const margenPct = Number(document.getElementById('inputMargenDeseado').value) || 0;
  const sugerido = costo * (1 + margenPct / 100);
  document.getElementById('valorPrecioSugerido').textContent = sugerido.toFixed(0);
}
document.getElementById('inputMargenDeseado').addEventListener('input', actualizarPrecioSugerido);
document.getElementById('inputPrecioVenta').addEventListener('input', renderRecetaResumen);

document.getElementById('btnUsarPrecioSugerido').addEventListener('click', () => {
  const costo = costoRecetaActual();
  const margenPct = Number(document.getElementById('inputMargenDeseado').value) || 0;
  const sugerido = costo * (1 + margenPct / 100);
  document.getElementById('inputPrecioVenta').value = Math.round(sugerido);
  renderRecetaResumen();
});

function cancelarEdicionProducto(){
  productoEditandoId = null;
  recetaActual = [];
  recetaDraft = [];
  document.getElementById('formProducto').reset();
  actualizarCamposPorcion();
  document.getElementById('tituloFormProducto').textContent = 'Agregar producto';
  document.getElementById('btnGuardarProducto').textContent = 'Guardar';
  document.getElementById('btnCancelarEdicionProducto').style.display = 'none';
  cancelarEdicionItemReceta();
  renderRecetaUI();
}
document.getElementById('btnCancelarEdicionProducto').addEventListener('click', cancelarEdicionProducto);

// Copia un producto (tipo, categoría, precio, y si tiene, el vínculo con su
// torta madre) junto con toda su receta propia — así una torta que ya
// armaste no hay que volver a cargarla insumo por insumo cada vez que
// necesitás una variante o repetir el registro.
window.duplicarProducto = async id => {
  const p = productosResumen.find(x => x.producto_id === id);
  if (!p) return;
  const nombre = prompt('Nombre del producto duplicado:', p.nombre + ' (copia)');
  if (nombre === null) return;

  const { data: nuevo, error } = await supabaseClient.from('productos').insert({
    nombre,
    tipo: p.tipo,
    categoria: p.categoria,
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
  if (productoEditandoId === id) cancelarEdicionProducto();
  await loadProductosResumen();
};

// ===== Receta (de arriba, fusionada con el alta/edición de producto) =====
// recetaActual: ítems reales (desde la base) de un producto que ya existe y
// se está editando. recetaDraft: ítems de un producto todavía sin guardar
// (solo en memoria, se insertan junto con el producto al tocar "Guardar").
let recetaActual = [];
let recetaDraft = [];

async function loadReceta(){
  const { data, error } = await supabaseClient
    .from('receta_items')
    .select('*, insumos(nombre, unidad, costo_unitario)')
    .eq('producto_id', productoEditandoId)
    .order('created_at');
  if (error) { console.error(error); return; }
  recetaActual = data || [];
  renderRecetaUI();
}

function renderRecetaUI(){
  if (productoEditandoId) renderReceta(); else renderRecetaDraft();
  renderRecetaResumen();
  actualizarPrecioSugerido();
}

function renderReceta(){
  const tbody = document.getElementById('listaReceta');
  tbody.innerHTML = recetaActual.length ? recetaActual.map(r => {
    const costoParcial = Number(r.cantidad_necesaria) * Number(r.insumos?.costo_unitario || 0);
    return `<tr>
      <td>${r.insumos?.nombre ?? '—'}</td>
      <td class="num">${r.cantidad_necesaria} ${r.insumos?.unidad ?? ''}</td>
      <td class="num">${fmt(costoParcial)}</td>
      <td><button type="button" class="ghost" onclick="editarItemReceta('${r.id}')">Editar</button></td>
      <td><button type="button" class="ghost" onclick="borrarRecetaItem('${r.id}')">Quitar</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" class="empty">Todavía no tiene insumos en la receta.</td></tr>`;
}

function renderRecetaDraft(){
  const tbody = document.getElementById('listaReceta');
  tbody.innerHTML = recetaDraft.length ? recetaDraft.map((r, idx) => {
    const insumo = insumos.find(i => i.id === r.insumo_id);
    const costoParcial = Number(r.cantidad_necesaria) * Number(insumo?.costo_unitario || 0);
    return `<tr>
      <td>${insumo?.nombre ?? '—'}</td>
      <td class="num">${r.cantidad_necesaria} ${insumo?.unidad ?? ''}</td>
      <td class="num">${fmt(costoParcial)}</td>
      <td><button type="button" class="ghost" onclick="editarItemRecetaDraft(${idx})">Editar</button></td>
      <td><button type="button" class="ghost" onclick="quitarItemRecetaDraft(${idx})">Quitar</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" class="empty">Todavía no agregaste insumos a la receta.</td></tr>`;
}

function renderRecetaResumen(){
  const div = document.getElementById('recetaResumen');
  const costo = costoRecetaActual();
  const precioVenta = Number(document.getElementById('inputPrecioVenta').value) || 0;
  const margen = precioVenta - costo;
  const margenNeg = margen < 0;
  div.innerHTML = `
    <span>Precio de venta: <b>${fmt(precioVenta)}</b></span>
    <span>Costo de receta: <b>${fmt(costo)}</b></span>
    <span>Margen: <b class="${margenNeg ? 'neg' : ''}">${fmt(margen)}</b></span>
  `;
}

// Precarga insumo + cantidad en el form de abajo para corregir un error de
// tipeo — antes la única forma de "editar" un ítem era reagregar a ciegas el
// mismo insumo (funciona porque hace upsert, pero no era obvio ni mostraba
// el valor actual para corregirlo).
window.editarItemReceta = id => {
  const r = recetaActual.find(x => x.id === id);
  if (!r) return;
  precargarFormReceta(r.insumo_id, r.cantidad_necesaria);
};

window.editarItemRecetaDraft = idx => {
  const r = recetaDraft[idx];
  if (!r) return;
  precargarFormReceta(r.insumo_id, r.cantidad_necesaria);
};

function precargarFormReceta(insumoId, cantidad){
  document.getElementById('selectInsumoReceta').value = insumoId;
  document.getElementById('inputCantidadReceta').value = cantidad;
  document.getElementById('btnAgregarReceta').textContent = 'Guardar cambio';
  document.getElementById('btnCancelarEdicionItemReceta').style.display = '';
  document.getElementById('formReceta').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelarEdicionItemReceta(){
  document.getElementById('formReceta').reset();
  document.getElementById('btnAgregarReceta').textContent = 'Agregar a la receta';
  document.getElementById('btnCancelarEdicionItemReceta').style.display = 'none';
}
document.getElementById('btnCancelarEdicionItemReceta').addEventListener('click', cancelarEdicionItemReceta);

document.getElementById('formReceta').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const insumoId = f.get('insumo_id');
  const cantidad = Number(f.get('cantidad_necesaria'));
  if (!insumoId) return;

  if (productoEditandoId) {
    // Producto ya existente: cada cambio se guarda directo en la base (como
    // antes) — si el insumo ya está en la receta, corrige su cantidad en vez
    // de duplicarlo.
    const existente = recetaActual.find(r => r.insumo_id === insumoId);
    if (existente) {
      await supabaseClient.from('receta_items').update({ cantidad_necesaria: cantidad }).eq('id', existente.id);
    } else {
      await supabaseClient.from('receta_items').insert({
        producto_id: productoEditandoId,
        insumo_id: insumoId,
        cantidad_necesaria: cantidad
      });
    }
    await loadReceta();
    await loadProductosResumen();
  } else {
    // Producto todavía sin guardar: el ítem solo se guarda en el borrador en
    // memoria, se inserta junto con el producto al tocar "Guardar".
    const existente = recetaDraft.find(r => r.insumo_id === insumoId);
    if (existente) existente.cantidad_necesaria = cantidad;
    else recetaDraft.push({ insumo_id: insumoId, cantidad_necesaria: cantidad });
    renderRecetaUI();
  }
  cancelarEdicionItemReceta();
});

window.borrarRecetaItem = async id => {
  await supabaseClient.from('receta_items').delete().eq('id', id);
  await loadReceta();
  await loadProductosResumen();
};

window.quitarItemRecetaDraft = idx => {
  recetaDraft.splice(idx, 1);
  renderRecetaUI();
};

actualizarCamposPorcion();
renderRecetaUI();
