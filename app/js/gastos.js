// ===== Gastos =====
// Se embebe reposiciones(id) para poder marcar los gastos que se generaron
// solos desde una reposición — esos no se pueden borrar (la FK de
// reposiciones.gasto_id no tiene on delete cascade, así que el borrado
// falla con un error claro si se intenta).
async function loadGastos(){
  const { data, error } = await supabaseClient
    .from('gastos')
    .select('*, reposiciones(id)')
    .order('fecha', { ascending: false });
  if (error) { console.error(error); return; }
  gastos = data || [];
  renderGastos();
  renderResumen();
}

function renderGastos(){
  const tbody = document.getElementById('listaGastos');
  tbody.innerHTML = gastos.length ? gastos.map(g => {
    const esAutomatico = g.reposiciones && g.reposiciones.length > 0;
    return `<tr>
      <td>${g.fecha}</td>
      <td>${g.descripcion} ${esAutomatico ? '<span class="tag">reposición</span>' : ''}</td>
      <td><span class="tag">${g.categoria}</span></td>
      <td class="num">${fmt(g.monto)}</td>
      <td>${esAutomatico ? '' : `<button class="ghost" onclick="borrarGasto('${g.id}')">Borrar</button>`}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" class="empty">Sin gastos cargados.</td></tr>`;
}

document.getElementById('formGasto').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  await supabaseClient.from('gastos').insert({
    fecha: f.get('fecha'),
    descripcion: f.get('descripcion'),
    categoria: f.get('categoria'),
    monto: Number(f.get('monto'))
  });
  await loadGastos();
  e.target.reset();
  e.target.querySelector('[name=fecha]').value = todayStr();
});

window.borrarGasto = async id => {
  const { error } = await supabaseClient.from('gastos').delete().eq('id', id);
  if (error) { alert('No se pudo borrar: ' + error.message + '\n(Puede ser un gasto generado por una reposición)'); return; }
  await loadGastos();
};

document.getElementById('formGasto').querySelector('[name=fecha]').value = todayStr();
