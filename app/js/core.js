// ===== Core: utilidades, estado compartido, auth, navegación =====
// Se carga primero — el resto de los archivos (resumen.js, insumos.js,
// productos.js, horneadas.js, ventas.js, reposicion.js, gastos.js) usan
// estas funciones/variables. Todos son <script> clásicos (no módulos), así
// que comparten el mismo scope global del documento — no hace falta
// import/export, alcanza con el orden de los <script src> en index.html
// (este archivo va primero) más el `init()` final que se llama recién
// cuando ya cargaron todos.
const fmt = n => '$' + Number(n||0).toLocaleString('es-AR', {minimumFractionDigits:0, maximumFractionDigits:0});
const todayStr = () => new Date().toISOString().slice(0, 10);
const esteMes = fecha => {
  const d = new Date(fecha + 'T00:00:00');
  const n = new Date();
  return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
};

let supabaseClient, currentUser = null;
let insumos = [];
let productosResumen = [];
let ventas = [];
let reposiciones = [];
let gastos = [];
let horneadas = [];

function init(){
  if (SUPABASE_URL.includes('TU-PROYECTO') || SUPABASE_ANON_KEY.includes('TU-ANON-KEY')) {
    document.getElementById('configWarning').style.display = 'block';
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    if (currentUser) { showApp(); loadInsumos(); loadProductosResumen(); loadVentas(); loadReposiciones(); loadGastos(); loadHorneadas(); loadVisitasLanding(); }
    else showLogin();
  });

  document.querySelectorAll('nav.tabs button[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  document.getElementById('loginBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const msg = document.getElementById('loginMsg');
    if (!email) return;
    document.getElementById('loginBtn').disabled = true;
    const { error } = await supabaseClient.auth.signInWithOtp({ email });
    document.getElementById('loginBtn').disabled = false;
    msg.className = 'login-msg' + (error ? ' error' : '');
    msg.textContent = error ? error.message : 'Listo, revisá tu mail y tocá el link para entrar.';
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
  });
}

function showLogin(){
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appRoot').style.display = 'none';
}
function showApp(){
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'flex';
}
