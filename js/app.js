const TOTAL_MESAS = 15;
const KEY = 'rm_datos';      // datos persistentes (usuarios, mesas, historial)
const SES = 'rm_sesion';     // sesión de esta pestaña

const MENU = [
  { id: 1, nombre: 'Bandeja paisa', precio: 32000, cat: 'Platos fuertes' },
  { id: 2, nombre: 'Sancocho de gallina', precio: 28000, cat: 'Platos fuertes' },
  { id: 3, nombre: 'Churrasco', precio: 38000, cat: 'Platos fuertes' },
  { id: 4, nombre: 'Trucha al ajillo', precio: 34000, cat: 'Platos fuertes' },
  { id: 5, nombre: 'Empanadas (3 uds)', precio: 9000, cat: 'Entradas' },
  { id: 6, nombre: 'Patacones', precio: 11000, cat: 'Entradas' },
  { id: 7, nombre: 'Limonada de coco', precio: 9500, cat: 'Bebidas' },
  { id: 8, nombre: 'Jugo natural', precio: 7000, cat: 'Bebidas' },
  { id: 9, nombre: 'Gaseosa', precio: 4500, cat: 'Bebidas' },
  { id: 10, nombre: 'Tres leches', precio: 12000, cat: 'Postres' }
];

const TABS = {
  empleado: [['mesas', 'Mesas'], ['pedido', 'Tomar pedido'], ['pedidos', 'Pedidos Activos']],
  admin: [['mesas', 'Mesas'], ['pedidos', 'Pedidos Activos'], ['estadisticas', 'Estadísticas'], ['historial', 'Historial']]
};

/* ---------- Utilidades ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const moneda = (n) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
const plato = (id) => MENU.find((p) => p.id === id);
const nombreRol = (r) => (r === 'admin' ? 'Administrador' : 'Empleado');
// Hash simple solo para no guardar la clave en texto plano (no es seguridad real sin servidor)
const hash = (s) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(16); };

/* ---------- Datos ---------- */
const mesaVacia = (numero) => ({ numero, ocupada: false, desde: null, empleado: null, items: {} });

function cargar() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.mesas && d.usuarios && d.historial) return d;
  } catch (e) { /* datos corruptos o sin acceso: se parte de cero */ }
  return { usuarios: [], mesas: Array.from({ length: TOTAL_MESAS }, (_, i) => mesaVacia(i + 1)), historial: [] };
}
function guardar() {
  try { localStorage.setItem(KEY, JSON.stringify(datos)); } catch (e) { console.error(e); }
}
const totalMesa = (m) => Object.entries(m.items).reduce((s, [id, c]) => s + plato(+id).precio * c, 0);

let datos = cargar();
let sesion = null;
let mesaSel = 1;

/* ---------- Reloj ---------- */
function actualizarReloj() {
  const ahora = new Date();
  $('fecha').textContent = ahora.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  $('hora').textContent = ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
}
actualizarReloj();
setInterval(actualizarReloj, 1000);

/* ---------- Login / registro ---------- */
let rolElegido = 'empleado';
let modo = 'entrar';

function marcar(selector, el) {
  document.querySelectorAll(selector).forEach((b) => b.classList.toggle('activa', b === el));
}
document.querySelectorAll('.rol').forEach((b) => b.addEventListener('click', () => {
  rolElegido = b.dataset.rol; marcar('.rol', b);
}));
document.querySelectorAll('.modo-btn').forEach((b) => b.addEventListener('click', () => {
  modo = b.dataset.modo; marcar('.modo-btn', b);
  $('btn-enviar').textContent = modo === 'entrar' ? 'Ingresar' : 'Crear usuario';
  $('clave').autocomplete = modo === 'entrar' ? 'current-password' : 'new-password';
  $('error').textContent = '';
}));

$('form-login').addEventListener('submit', (e) => {
  e.preventDefault();
  const usuario = $('usuario').value.trim().toLowerCase();
  const clave = $('clave').value;
  const existente = datos.usuarios.find((u) => u.usuario === usuario);
  const error = (msg) => { $('error').textContent = msg; };

  if (modo === 'crear') {
    if (existente) return error('Ese usuario ya existe. Elige otro nombre.');
    const nuevo = { usuario, rol: rolElegido, clave: hash(usuario + clave) };
    datos.usuarios.push(nuevo);
    guardar();
    entrar(nuevo);
  } else {
    if (!existente || existente.clave !== hash(usuario + clave)) return error('Usuario o contraseña incorrectos.');
    if (existente.rol !== rolElegido) return error(`Este usuario es ${nombreRol(existente.rol).toLowerCase()}. Cambia el rol arriba.`);
    entrar(existente);
  }
});

function entrar(u) {
  sesion = u;
  sessionStorage.setItem(SES, u.usuario);
  $('pantalla-login').hidden = true;
  $('app').hidden = false;
  $('usuario-chip').textContent = `${u.usuario} · ${nombreRol(u.rol)}`;
  $('nav-tabs').innerHTML = TABS[u.rol].map(([v, t]) => `<button class="nav__tab" data-vista="${v}">${t}</button>`).join('') + '<span class="nav__indicador" aria-hidden="true"></span>';
  $('nav-tabs').classList.add('con-indicador');
  irA(TABS[u.rol][0][0], true);
  renderTodo();
}

$('btn-salir').addEventListener('click', () => {
  sessionStorage.removeItem(SES);
  location.reload();
});

/* ---------- Navegación ---------- */
function moverIndicador(sinAnimar) {
  const cont = $('nav-tabs');
  const ind = cont.querySelector('.nav__indicador');
  const tab = cont.querySelector('.nav__tab.activa');
  if (!ind || !tab) return;
  if (sinAnimar) ind.classList.add('sin-animar');
  ind.style.width = tab.offsetWidth + 'px';
  ind.style.height = tab.offsetHeight + 'px';
  ind.style.transform = `translate(${tab.offsetLeft}px, ${tab.offsetTop}px)`;
  if (sinAnimar) { void ind.offsetWidth; ind.classList.remove('sin-animar'); }
}
function irA(vista, sinAnimar) {
  document.querySelectorAll('.nav__tab').forEach((t) => t.classList.toggle('activa', t.dataset.vista === vista));
  document.querySelectorAll('.vista').forEach((v) => v.classList.toggle('activa', v.id === `vista-${vista}`));
  moverIndicador(sinAnimar);
}
window.addEventListener('resize', () => moverIndicador(true));
if (document.fonts) document.fonts.ready.then(() => moverIndicador(true));
$('nav-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.nav__tab');
  if (tab) irA(tab.dataset.vista);
});

/* ---------- Mesas ---------- */
function renderMesas() {
  const grid = $('grid-mesas');
  if (!grid.children.length) {
    datos.mesas.forEach((m, i) => {
      const b = document.createElement('button');
      if (sesion.rol === 'empleado') b.addEventListener('click', () => { mesaSel = i + 1; renderPedido(); irA('pedido'); });
      grid.appendChild(b);
    });
  }
  datos.mesas.forEach((m, i) => {
    const b = grid.children[i];
    b.className = `mesa ${m.ocupada ? 'mesa--ocupada' : 'mesa--libre'}${sesion.rol === 'admin' ? ' mesa--solo' : ''}`;
    b.innerHTML = `<span class="mesa__nombre">Mesa ${m.numero}</span>
      <span class="mesa__estado">${m.ocupada ? 'Ocupada · ' + moneda(totalMesa(m)) : 'Libre'}</span>` +
      (m.ocupada && sesion.rol === 'admin' ? `<span class="mesa__estado">${esc(m.empleado)}</span>` : '');
  });
}

function cerrarMesa(mesa) {
  const items = Object.entries(mesa.items).map(([id, cant]) => ({ nombre: plato(+id).nombre, precio: plato(+id).precio, cant }));
  if (items.length) {
    datos.historial.unshift({
      numero: mesa.numero, empleado: mesa.empleado, desde: mesa.desde,
      hasta: new Date().toISOString(), items, total: totalMesa(mesa)
    });
  }
  Object.assign(mesa, mesaVacia(mesa.numero));
  guardar();
  renderTodo();
}

/* ---------- Tomar pedido (empleado) ---------- */
function cambiarPlato(id, delta) {
  const mesa = datos.mesas[mesaSel - 1];
  if (!mesa.ocupada) {
    Object.assign(mesa, { ocupada: true, desde: new Date().toISOString(), empleado: sesion.usuario, items: {} });
  }
  mesa.items[id] = (mesa.items[id] || 0) + delta;
  if (mesa.items[id] <= 0) delete mesa.items[id];
  guardar();
  renderTodo();
}

function renderPedido() {
  if (sesion.rol !== 'empleado') return;
  const mesa = datos.mesas[mesaSel - 1];
  $('sel-mesa').innerHTML = datos.mesas.map((m) =>
    `<option value="${m.numero}" ${m.numero === mesaSel ? 'selected' : ''}>Mesa ${m.numero} — ${m.ocupada ? 'Ocupada' : 'Libre'}</option>`).join('');

  const cats = [...new Set(MENU.map((p) => p.cat))];
  if (!$('menu').children.length) { // el menú es fijo: no se recrea, así los botones conservan sus transiciones
    $('menu').innerHTML = cats.map((c) => `<h3>${c}</h3><div class="menu__grid">` +
    MENU.filter((p) => p.cat === c).map((p) =>
      `<button class="plato" data-id="${p.id}"><span>${p.nombre}</span><small>${moneda(p.precio)}</small></button>`).join('') +
    '</div>').join('');
  }

  const res = $('resumen');
  if (!res.firstElementChild) {
    res.innerHTML = `<h3></h3><div data-lineas></div>
      <p class="vacio" data-vacio>Aún no hay platos. Toca un plato del menú para agregarlo.</p>
      <div class="total"><span>Total</span><strong data-total></strong></div>
      <button class="btn" data-cerrar></button>`;
  }
  res.querySelector('h3').textContent = `Mesa ${mesa.numero}`;
  const lineas = res.querySelector('[data-lineas]');
  const ids = Object.keys(mesa.items);
  [...lineas.children].forEach((l) => { if (!(l.dataset.id in mesa.items)) l.remove(); });
  ids.forEach((id, idx) => {
    let l = lineas.querySelector(`[data-id="${id}"]`);
    if (!l) {
      l = document.createElement('div');
      l.className = 'linea';
      l.dataset.id = id;
      l.innerHTML = `<span></span><span><button class="mini" data-menos="${id}" aria-label="Quitar uno">−</button><button class="mini" data-mas="${id}" aria-label="Agregar uno">+</button></span>`;
    }
    if (lineas.children[idx] !== l) lineas.insertBefore(l, lineas.children[idx] || null);
    l.firstElementChild.textContent = `${mesa.items[id]} × ${plato(+id).nombre}`;
  });
  res.querySelector('[data-vacio]').hidden = ids.length > 0;
  res.querySelector('[data-total]').textContent = moneda(totalMesa(mesa));
  const cerrar = res.querySelector('[data-cerrar]');
  cerrar.hidden = !mesa.ocupada;
  cerrar.textContent = ids.length ? 'Cobrar y cerrar mesa' : 'Liberar mesa';
}

$('sel-mesa').addEventListener('change', (e) => { mesaSel = +e.target.value; renderPedido(); });
$('menu').addEventListener('click', (e) => {
  const b = e.target.closest('.plato');
  if (b) cambiarPlato(+b.dataset.id, 1);
});
$('resumen').addEventListener('click', (e) => {
  const mas = e.target.closest('[data-mas]');
  const menos = e.target.closest('[data-menos]');
  if (mas) cambiarPlato(+mas.dataset.mas, 1);
  else if (menos) cambiarPlato(+menos.dataset.menos, -1);
  else if (e.target.closest('[data-cerrar]')) cerrarMesa(datos.mesas[mesaSel - 1]);
});

/* ---------- Pedidos activos ---------- */
function renderPedidos() {
  const activas = datos.mesas.filter((m) => m.ocupada);
  const cont = $('lista-pedidos');
  if (!activas.length) {
    cont.innerHTML = '<p class="vacio">No hay mesas ocupadas.</p>';
    return;
  }
  cont.innerHTML = '';
  activas.forEach((m) => {
    const detalle = Object.entries(m.items).map(([id, c]) => `${c}× ${plato(+id).nombre}`).join(', ') || 'Sin platos aún';
    const fila = document.createElement('div');
    fila.className = 'item';
    fila.innerHTML = `
      <div><strong>Mesa ${m.numero}</strong> · ${moneda(totalMesa(m))}<br>
        <small>${esc(detalle)}</small><br><small>Desde las ${hora(m.desde)} · atiende ${esc(m.empleado)}</small></div>` +
      (sesion.rol === 'empleado' ? '<button class="btn-cobrar">Cobrar y cerrar</button>' : '');
    if (sesion.rol === 'empleado') fila.querySelector('button').addEventListener('click', () => cerrarMesa(m));
    cont.appendChild(fila);
  });
}

/* ---------- Historial (admin) ---------- */
function renderHistorial() {
  const cont = $('lista-historial');
  if (!datos.historial.length) {
    cont.innerHTML = '<p class="vacio">Aún no hay mesas cobradas.</p>';
    return;
  }
  cont.innerHTML = datos.historial.map((h) => `
    <div class="item">
      <div><strong>Mesa ${h.numero}</strong> · ${moneda(h.total)}<br>
        <small>${esc(h.items.map((i) => `${i.cant}× ${i.nombre}`).join(', '))}</small><br>
        <small>Atendió ${esc(h.empleado)}</small></div>
      <small>${hora(h.desde)} – ${hora(h.hasta)}</small>
    </div>`).join('');
}

/* ---------- Estadísticas (admin) ---------- */
function barras(filas, formato) {
  if (!filas.length) return '<p class="vacio">Sin datos todavía.</p>';
  const max = Math.max(...filas.map((f) => f[1]));
  return filas.map(([n, v]) => `
    <div class="barra"><div class="barra__top"><span>${esc(n)}</span><strong>${formato(v)}</strong></div>
    <div class="barra__fondo"><i style="width:${(v / max) * 100}%"></i></div></div>`).join('');
}

function renderStats() {
  const h = datos.historial;
  const ventas = h.reduce((s, x) => s + x.total, 0);
  const porPlato = {}, porEmpleado = {};
  h.forEach((x) => {
    x.items.forEach((i) => { porPlato[i.nombre] = (porPlato[i.nombre] || 0) + i.cant; });
    porEmpleado[x.empleado] = (porEmpleado[x.empleado] || 0) + x.total;
  });
  const orden = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const ocupadas = datos.mesas.filter((m) => m.ocupada).length;

  $('stats').innerHTML = `
    <div class="stats">
      <div class="stat"><small>Ventas totales</small><strong>${moneda(ventas)}</strong></div>
      <div class="stat"><small>Cuentas cobradas</small><strong>${h.length}</strong></div>
      <div class="stat"><small>Ticket promedio</small><strong>${moneda(h.length ? ventas / h.length : 0)}</strong></div>
      <div class="stat"><small>Mesas ocupadas</small><strong>${ocupadas} / ${TOTAL_MESAS}</strong></div>
    </div>
    <div class="paneles">
      <div class="panel"><h3>Platos más vendidos</h3>${barras(orden(porPlato).slice(0, 8), (v) => v + ' uds')}</div>
      <div class="panel"><h3>Ventas por empleado</h3>${barras(orden(porEmpleado), moneda)}</div>
    </div>`;
}

/* ---------- Render general ---------- */
function renderTodo() {
  if (!sesion) return;
  renderMesas();
  renderPedido();
  renderPedidos();
  if (sesion.rol === 'admin') { renderStats(); renderHistorial(); }
}

// Si el admin y un empleado están en pestañas del mismo navegador, se actualizan en vivo
window.addEventListener('storage', (e) => {
  if (e.key === KEY) { datos = cargar(); renderTodo(); }
});

/* ---------- Inicio ---------- */
const guardada = sessionStorage.getItem(SES);
const usuarioGuardado = datos.usuarios.find((u) => u.usuario === guardada);
if (usuarioGuardado) entrar(usuarioGuardado);
