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
  superadmin: [['usuarios', 'Usuarios']],
  empleado: [['mesas', 'Mesas'], ['pedido', 'Tomar pedido'], ['pedidos', 'Pedidos Activos']],
  admin: [['mesas', 'Mesas'], ['pedidos', 'Pedidos Activos'], ['estadisticas', 'Estadísticas'], ['historial', 'Historial']]
};

/* ---------- Utilidades ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const moneda = (n) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
const plato = (id) => MENU.find((p) => p.id === id);
const NOMBRES_ROL = { superadmin: 'Super-administrador', admin: 'Administrador', empleado: 'Empleado' };
const nombreRol = (r) => NOMBRES_ROL[r] || 'Empleado';
const ROLES = Object.keys(NOMBRES_ROL);
const PATRON_USUARIO = /^[a-z0-9._-]{3,20}$/;
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

/* ---------- Inicio de sesión ---------- */
// Ya no hay registro público: las cuentas las crea el super-administrador.
// Solo si no existe ninguno (primer uso) se muestra la configuración inicial.
const hayAdminSup = () => datos.usuarios.some((u) => u.rol === 'superadmin');

function configurarLogin() {
  const inicial = !hayAdminSup();
  $('login-sub').textContent = inicial
    ? 'Configuración inicial: crea el primer super-administrador. Desde su panel podrás crear y administrar las demás cuentas.'
    : 'Inicia sesión para continuar';
  $('lbl-clave2').hidden = !inicial;
  $('clave2').required = inicial;
  $('clave').minLength = inicial ? 8 : 4;
  $('clave').autocomplete = inicial ? 'new-password' : 'current-password';
  $('btn-enviar').textContent = inicial ? 'Crear super-administrador' : 'Ingresar';
  $('btn-restaurar').hidden = !inicial;
}

$('form-login').addEventListener('submit', (e) => {
  e.preventDefault();
  const usuario = $('usuario').value.trim().toLowerCase();
  const clave = $('clave').value;
  const error = (msg) => { $('error').textContent = msg; };

  if (!hayAdminSup()) {   // configuración inicial
    if (!PATRON_USUARIO.test(usuario)) return error('Usuario de 3 a 20 caracteres: minúsculas, números, punto, guion o guion bajo.');
    if (clave.length < 8) return error('La contraseña debe tener al menos 8 caracteres.');
    if (clave !== $('clave2').value) return error('Las contraseñas no coinciden.');
    if (datos.usuarios.some((u) => u.usuario === usuario)) return error('Ese usuario ya existe. Elige otro nombre.');
    datos.usuarios.push({ usuario, rol: 'superadmin', clave: hash(usuario + clave), creado: new Date().toISOString() });
    guardar();
    $('clave2').value = '';
    iniciarMFA(usuario);
    return;
  }
  const existente = datos.usuarios.find((u) => u.usuario === usuario);
  if (!existente || existente.clave !== hash(usuario + clave)) return error('Usuario o contraseña incorrectos.');
  iniciarMFA(existente.usuario);
});

/* ---------- Verificación en dos pasos (TOTP) ---------- */
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;
let mfaUsuario = null;      // usuario que ya pasó la contraseña (aún sin sesión)
let mfaSecretoTemp = null;  // secreto nuevo: solo se guarda si confirma su primer código
let mfaCodigosTemp = null;  // códigos de recuperación recién generados
let mfaModoRec = false;     // false = código de la app, true = código de recuperación
let mfaMetodo = 'totp';     // 'totp' (app autenticadora) o 'correo' (código por email)
let mfaCorreoTemp = null;   // correo que se está confirmando al activar el método por correo
let relojReenvio = null;

const mfaUsuarioObj = () => datos.usuarios.find((u) => u.usuario === mfaUsuario);
const mfaError = (msg) => { $('mfa-error').textContent = msg; };

function mostrarPaso(paso) {
  $('paso-credenciales').hidden = paso !== 'credenciales';
  $('paso-mfa').hidden = paso !== 'mfa';
  $('paso-clave').hidden = paso !== 'clave';
}
function mfaPantalla({ titulo, texto, elegir = false, correo = false, activar = false, form = false, recuperacion = false, alternar = false }) {
  $('mfa-titulo').textContent = titulo;
  $('mfa-texto').textContent = texto;
  $('mfa-elegir').hidden = !elegir;
  $('form-correo').hidden = !correo;
  $('mfa-activar').hidden = !activar;
  $('form-mfa').hidden = !form;
  $('mfa-recuperacion').hidden = !recuperacion;
  $('mfa-alternar').hidden = !alternar;
  $('mfa-volver').hidden = recuperacion;   // en la pantalla de códigos no se puede volver sin guardarlos
  mfaError('');
}
function mfaModo(recuperacion) {
  mfaModoRec = recuperacion;
  const inp = $('mfa-codigo');
  inp.value = '';
  inp.inputMode = recuperacion ? 'text' : 'numeric';
  inp.placeholder = recuperacion ? 'XXXXX-XXXXX' : '000000';
  inp.autocapitalize = recuperacion ? 'characters' : 'off';
  $('mfa-etiqueta').textContent = recuperacion ? 'Código de recuperación' : 'Código de 6 dígitos';
  $('mfa-alternar').textContent = recuperacion
    ? (mfaMetodo === 'correo' ? 'Usar el código del correo' : 'Usar el código de mi app')
    : 'Usar un código de recuperación';
  $('mfa-reenviar').hidden = recuperacion || mfaMetodo !== 'correo';
  mfaError('');
}

async function iniciarMFA(nombre) {
  if (!MFA.disponible()) {
    $('error').textContent = 'Este navegador bloquea el cifrado en esta dirección. Abre la página con https:// o localhost.';
    return;
  }
  mfaUsuario = nombre;
  $('clave').value = '';
  $('error').textContent = '';
  mostrarPaso('mfa');
  const u = mfaUsuarioObj();
  if (u.mfa && u.mfa.activo) {
    mfaMetodo = u.mfa.metodo === 'correo' ? 'correo' : 'totp';   // las cuentas antiguas no tienen método: son TOTP
    if (mfaMetodo === 'correo') return pedirCodigoCorreo(u.correo, false);
    mfaPantalla({ titulo: 'Verificación en dos pasos', texto: 'Escribe el código de 6 dígitos de tu app autenticadora.', form: true, alternar: true });
    mfaModo(false);
    $('mfa-codigo').focus();
  } else {
    mfaPantalla({ titulo: 'Activa la verificación en dos pasos', texto: '¿Cómo quieres confirmar que eres tú cada vez que entres?', elegir: true });
    $('elegir-correo').focus();
  }
}

/* ---------- Segundo paso por correo (EmailJS) ---------- */
$('elegir-app').addEventListener('click', () => { mfaMetodo = 'totp'; activarMFA(); });
$('elegir-correo').addEventListener('click', () => {
  mfaMetodo = 'correo';
  mfaPantalla({ titulo: 'Código por correo', texto: 'Escribe el correo donde quieres recibir los códigos. Te enviaremos uno ahora para confirmarlo.', correo: true });
  $('correo-error').textContent = '';
  $('mfa-correo').value = mfaUsuarioObj().correo || '';
  $('mfa-correo').focus();
});
$('form-correo').addEventListener('submit', (e) => {
  e.preventDefault();
  const correo = $('mfa-correo').value.trim().toLowerCase();
  if (!CORREO.valido(correo)) { $('correo-error').textContent = 'Escribe un correo válido.'; return; }
  pedirCodigoCorreo(correo, true);
});

const MENSAJES_CORREO = {
  ESPERA: () => `Espera ${CORREO.segundosParaReenviar()} s para pedir otro código.`,
  RED: () => 'Sin conexión. Revisa tu internet e inténtalo de nuevo.',
  LIMITE: () => 'Se enviaron demasiados correos. Espera un momento e inténtalo de nuevo.',
  SERVICIO: () => 'No se pudo enviar el correo. Inténtalo más tarde o usa un código de recuperación.',
  CORREO: () => 'Esta cuenta no tiene un correo válido. Pide al super-administrador que reinicie tu MFA.'
};

// activando = true: se confirma un correo nuevo; false: inicio de sesión normal
async function pedirCodigoCorreo(correo, activando) {
  mfaCorreoTemp = activando ? correo : null;
  const destino = CORREO.ocultar(correo || '');
  const btn = activando ? $('correo-enviar') : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    await CORREO.enviar(mfaUsuario, correo || '');
    mfaPantalla({
      titulo: activando ? 'Confirma tu correo' : 'Verificación en dos pasos',
      texto: `Enviamos un código de 6 dígitos a ${destino}. Caduca en ${CORREO.MINUTOS} minutos. Revisa también la carpeta de spam.`,
      form: true, alternar: !activando
    });
    mfaModo(false);
    $('mfa-enviar').textContent = activando ? 'Confirmar y continuar' : 'Verificar';
    iniciarReenvio();
    $('mfa-codigo').focus();
  } catch (err) {
    const msg = (MENSAJES_CORREO[err.message] || MENSAJES_CORREO.SERVICIO)();
    if (activando) { $('correo-error').textContent = msg; return; }
    // Al entrar, si el envío falla se muestra igual el formulario: queda el código de recuperación
    mfaPantalla({ titulo: 'Verificación en dos pasos', texto: `Tus códigos llegan a ${destino}.`, form: true, alternar: true });
    mfaModo(false);
    $('mfa-enviar').textContent = 'Verificar';
    iniciarReenvio();
    mfaError(msg);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar código'; }
  }
}

// El botón de reenviar muestra la cuenta atrás y se activa al llegar a cero
function iniciarReenvio() {
  clearInterval(relojReenvio);
  const b = $('mfa-reenviar');
  const pintar = () => {
    const s = CORREO.segundosParaReenviar();
    b.disabled = s > 0;
    b.textContent = s > 0 ? `Reenviar código (${s} s)` : 'Reenviar código';
    if (!s) clearInterval(relojReenvio);
  };
  pintar();
  relojReenvio = setInterval(pintar, 1000);
}
$('mfa-reenviar').addEventListener('click', () => {
  const correo = mfaCorreoTemp || (mfaUsuarioObj() || {}).correo;
  pedirCodigoCorreo(correo, !!mfaCorreoTemp);
});

function activarMFA() {
  mfaSecretoTemp = MFA.nuevoSecreto();
  mfaPantalla({
    titulo: 'Activa la verificación en dos pasos',
    texto: 'Escanea el QR con Google Authenticator, Microsoft Authenticator o Authy y escribe el código que muestre.',
    activar: true, form: true
  });
  mfaModo(false);
  $('mfa-clave').textContent = mfaSecretoTemp.match(/.{1,4}/g).join(' ').replace(/^(\S+ \S+ \S+ \S+) /, '$1\n'); // dos filas de 4 grupos
  try {
    const qr = qrcode(0, 'M');
    qr.addData(MFA.uri(mfaSecretoTemp, mfaUsuario, 'Restaurant Manager'));
    qr.make();
    $('mfa-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (e) {
    $('mfa-qr').textContent = 'No se pudo dibujar el QR. Usa la clave de abajo.';
  }
  $('mfa-enviar').textContent = 'Activar y continuar';
  $('mfa-codigo').focus();
}

function mostrarRecuperacion(codigos) {
  mfaCodigosTemp = codigos;
  mfaPantalla({
    titulo: 'Guarda tus códigos de recuperación',
    texto: 'Cada código sirve una sola vez si pierdes el celular. No se volverán a mostrar.',
    recuperacion: true
  });
  $('mfa-codigos').innerHTML = codigos.map((c) => `<li>${c}</li>`).join('');
}

$('mfa-alternar').addEventListener('click', () => { mfaModo(!mfaModoRec); $('mfa-codigo').focus(); });
$('mfa-volver').addEventListener('click', () => {
  mfaSecretoTemp = null; mfaUsuario = null; mfaCorreoTemp = null;
  CORREO.limpiar();
  clearInterval(relojReenvio);
  mostrarPaso('credenciales');
});
$('mfa-copiar').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(mfaCodigosTemp.join('\n')); $('mfa-copiar').textContent = '¡Copiado!'; }
  catch (e) { $('mfa-copiar').textContent = 'No se pudo copiar'; }
});
$('mfa-descargar').addEventListener('click', () => {
  const texto = `Restaurant Manager — códigos de recuperación de ${mfaUsuario}\n(cada uno sirve una sola vez)\n\n${mfaCodigosTemp.join('\n')}\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }));
  a.download = `recuperacion-${mfaUsuario}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('mfa-continuar').addEventListener('click', () => {
  const u = mfaUsuarioObj();
  mfaCodigosTemp = null;
  if (u) finalizarAcceso(u);
});

$('form-mfa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const entrada = $('mfa-codigo').value;
  const btn = $('mfa-enviar');
  btn.disabled = true;
  try {
    /* A2) Activación por correo: el código confirma que el correo es suyo */
    if (mfaCorreoTemp) {
      const r = await CORREO.verificar(mfaUsuario, entrada);
      if (r !== 'ok') {
        $('mfa-codigo').value = '';
        return mfaError({
          incorrecto: 'Código incorrecto. Revisa el correo e inténtalo de nuevo.',
          caducado: 'El código caducó. Pide uno nuevo con "Reenviar código".',
          agotado: 'Demasiados intentos con este código. Pide uno nuevo.',
          'sin-codigo': 'Pide un código con "Reenviar código".'
        }[r]);
      }
      const codigos = MFA.codigosRecuperacion();
      const hashes = await Promise.all(codigos.map(MFA.hashCodigo));
      const u = mfaUsuarioObj();
      u.correo = mfaCorreoTemp;
      u.mfa = { activo: true, metodo: 'correo', recuperacion: hashes, intentos: 0, bloqueadoHasta: 0 };
      mfaCorreoTemp = null;
      clearInterval(relojReenvio);
      guardar();
      return mostrarRecuperacion(codigos);
    }

    /* A) Activación: el primer código confirma que la app quedó bien configurada */
    if (mfaSecretoTemp) {
      const paso = await MFA.verificar(mfaSecretoTemp, entrada, -1);
      if (paso === null) return mfaError('Código incorrecto. Revisa que la hora de tu celular sea automática e inténtalo de nuevo.');
      const codigos = MFA.codigosRecuperacion();
      const hashes = await Promise.all(codigos.map(MFA.hashCodigo));
      const u = mfaUsuarioObj();   // se busca de nuevo: otra pestaña pudo recargar los datos
      u.mfa = { activo: true, metodo: 'totp', secreto: mfaSecretoTemp, recuperacion: hashes, ultimoPaso: paso, intentos: 0, bloqueadoHasta: 0 };
      mfaSecretoTemp = null;
      guardar();
      return mostrarRecuperacion(codigos);
    }

    /* B) Inicio de sesión */
    let u = mfaUsuarioObj();
    const ahora = Date.now();
    if (ahora < u.mfa.bloqueadoHasta) {
      return mfaError(`Demasiados intentos. Espera ${Math.ceil((u.mfa.bloqueadoHasta - ahora) / 60000)} min.`);
    }
    let pasoOk = null, indiceRec = -1, resCorreo = null;
    if (mfaModoRec) {
      indiceRec = u.mfa.recuperacion.indexOf(await MFA.hashCodigo(entrada));
    } else if (mfaMetodo === 'correo') {
      resCorreo = await CORREO.verificar(u.usuario, entrada);
    } else {
      pasoOk = await MFA.verificar(u.mfa.secreto, entrada, u.mfa.ultimoPaso);
    }
    u = mfaUsuarioObj();
    const m = u.mfa;
    const correcto = mfaModoRec ? indiceRec >= 0 : mfaMetodo === 'correo' ? resCorreo === 'ok' : pasoOk !== null;

    if (!correcto) {
      m.intentos = (m.intentos || 0) + 1;
      let msg = `Código incorrecto. Te quedan ${MAX_INTENTOS - m.intentos} intentos.`;
      if (resCorreo === 'caducado') msg = 'El código caducó. Pide uno nuevo con "Reenviar código".';
      if (resCorreo === 'agotado' || resCorreo === 'sin-codigo') msg = 'Pide un código nuevo con "Reenviar código".';
      if (m.intentos >= MAX_INTENTOS) {
        m.intentos = 0;
        m.bloqueadoHasta = Date.now() + BLOQUEO_MS;
        msg = 'Demasiados intentos. Cuenta bloqueada por 5 minutos.';
      }
      guardar();
      $('mfa-codigo').value = '';
      return mfaError(msg);
    }

    m.intentos = 0;
    m.bloqueadoHasta = 0;
    if (mfaModoRec) m.recuperacion.splice(indiceRec, 1); else if (mfaMetodo === 'totp') m.ultimoPaso = pasoOk;
    guardar();
    clearInterval(relojReenvio);
    finalizarAcceso(u);
    if (mfaModoRec) setTimeout(() => alert(`Usaste un código de recuperación. Te quedan ${m.recuperacion.length}.`), 300);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Contraseña temporal: se cambia en el primer ingreso ---------- */
function finalizarAcceso(u) {
  if (!u.cambiarClave) return entrar(u);
  mfaUsuario = u.usuario;
  $('clave-error').textContent = '';
  $('nclave').value = ''; $('nclave2').value = '';
  mostrarPaso('clave');
  $('nclave').focus();
}
$('form-clave').addEventListener('submit', (e) => {
  e.preventDefault();
  const u = mfaUsuarioObj();
  if (!u) return;
  const n1 = $('nclave').value, n2 = $('nclave2').value;
  const err = (m) => { $('clave-error').textContent = m; };
  if (n1.length < 8) return err('Mínimo 8 caracteres.');
  if (n1 !== n2) return err('Las contraseñas no coinciden.');
  if (hash(u.usuario + n1) === u.clave) return err('La nueva contraseña debe ser distinta de la temporal.');
  u.clave = hash(u.usuario + n1);
  delete u.cambiarClave;
  guardar();
  $('nclave').value = ''; $('nclave2').value = '';
  entrar(u);
});

function entrar(u) {
  sesion = u;
  sessionStorage.setItem(SES, u.usuario);
  $('pantalla-login').hidden = true;
  $('app').hidden = false;
  $('login-escena')?.remove();   // la escena 3D ya no se ve: se quita para liberar la GPU
  const tema = document.querySelector('meta[name="theme-color"]');
  if (tema) tema.content = '#141414';
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

/* ---------- Diálogo reutilizable ---------- */
// Devuelve: null si se cancela; true si se confirma sin campo; el texto escrito si hay campo.
function dialogo({ titulo, texto = '', etiqueta = null, tipo = 'text', valor = '', repetir = false,
                   ok = 'Confirmar', peligro = false, cancelar = true, validar = null }) {
  return new Promise((resolve) => {
    const dlg = $('dialogo'), form = $('dialogo-form'), inp = $('dialogo-input'), inp2 = $('dialogo-input2');
    const err = $('dialogo-error'), btnOk = $('dialogo-ok'), btnNo = $('dialogo-cancelar');
    $('dialogo-titulo').textContent = titulo;
    $('dialogo-texto').textContent = texto;
    $('dialogo-etiqueta').textContent = etiqueta || '';
    $('dialogo-campo').hidden = !etiqueta;
    $('dialogo-campo2').hidden = !(etiqueta && repetir);
    inp.type = tipo; inp.value = valor; inp2.value = '';
    err.textContent = '';
    btnOk.textContent = ok;
    btnOk.classList.toggle('btn-dialogo--peligro', peligro);
    btnNo.hidden = !cancelar;
    let ocupado = false;
    const cerrar = (r) => {
      form.onsubmit = null; btnNo.onclick = null; dlg.oncancel = null;
      if (dlg.open) dlg.close();
      resolve(r);
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (ocupado) return;
      const v = inp.value;
      let msg = null;
      if (etiqueta && repetir && v !== inp2.value) msg = 'Las contraseñas no coinciden.';
      if (!msg && validar) {
        ocupado = true; btnOk.disabled = true;
        try { msg = await validar(v); } finally { ocupado = false; btnOk.disabled = false; }
      }
      if (msg) { err.textContent = msg; return; }
      cerrar(etiqueta ? v : true);
    };
    btnNo.onclick = () => cerrar(null);
    dlg.oncancel = (e) => { e.preventDefault(); cerrar(cancelar ? null : true); };   // tecla Esc
    dlg.showModal();
    if (etiqueta) inp.focus(); else btnOk.focus();
  });
}
const aviso = (titulo, texto) => dialogo({ titulo, texto, ok: 'Entendido', cancelar: false });

/* ---------- Super-administrador: usuarios ---------- */
function claveAleatoria(n = 12) {
  const alf = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const limite = 256 - (256 % alf.length);   // descarta bytes que sesgarían el resultado
  const salida = [];
  while (salida.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < limite && salida.length < n) salida.push(alf[b % alf.length]);
    }
  }
  return salida.join('');
}
const descargar = (texto, nombre, tipo) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
  a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

function renderUsuarios() {
  $('lista-usuarios').innerHTML = datos.usuarios.map((u) => {
    const yo = u.usuario === sesion.usuario;
    const n = esc(u.usuario);
    const mfaOk = !!(u.mfa && u.mfa.activo);
    const metodo = mfaOk ? (u.mfa.metodo === 'correo' ? 'MFA por correo' : 'MFA con app') : 'MFA pendiente';
    const acciones = yo ? '<small>Tu cuenta</small>' : `
      <div class="acciones-fila">
        <button type="button" class="btn-sec btn-sec--sm" data-accion="clave" data-usuario="${n}">Reiniciar contraseña</button>
        <button type="button" class="btn-sec btn-sec--sm" data-accion="mfa" data-usuario="${n}">Reiniciar MFA</button>
        <button type="button" class="btn-peligro btn-sec--sm" data-accion="eliminar" data-usuario="${n}">Eliminar</button>
      </div>`;
    return `<div class="item item--usuario">
      <div class="usuario__info"><strong>${n}</strong>
        <span class="etiqueta etiqueta--${u.rol}">${nombreRol(u.rol)}</span>
        <span class="etiqueta ${mfaOk ? 'etiqueta--ok' : 'etiqueta--aviso'}">${metodo}</span>
        ${u.cambiarClave ? '<span class="etiqueta etiqueta--aviso">Contraseña temporal</span>' : ''}
        ${u.correo ? `<br><small>${esc(u.correo)}</small>` : ''}
        ${u.creado ? `<br><small>Creado el ${new Date(u.creado).toLocaleDateString('es-CO')}</small>` : ''}
      </div>${acciones}</div>`;
  }).join('');
}

$('nu-generar').addEventListener('click', () => { $('nu-clave').value = claveAleatoria(); $('nu-clave').focus(); });

$('form-nuevo').addEventListener('submit', (e) => {
  e.preventDefault();
  const usuario = $('nu-usuario').value.trim().toLowerCase();
  const clave = $('nu-clave').value;
  const rol = $('nu-rol').value;
  const correo = $('nu-correo').value.trim().toLowerCase();
  const err = (m) => { $('nu-error').textContent = m; };
  if (correo && !CORREO.valido(correo)) return err('El correo no es válido.');
  if (!PATRON_USUARIO.test(usuario)) return err('Usuario de 3 a 20 caracteres: minúsculas, números, punto, guion o guion bajo.');
  if (clave.length < 8) return err('La contraseña temporal debe tener al menos 8 caracteres.');
  if (!ROLES.includes(rol)) return err('Rol no válido.');
  if (datos.usuarios.some((u) => u.usuario === usuario)) return err('Ese usuario ya existe.');
  datos.usuarios.push({ usuario, rol, clave: hash(usuario + clave), cambiarClave: true, creado: new Date().toISOString(), ...(correo && { correo }) });
  guardar();
  $('form-nuevo').reset();
  err('');
  renderUsuarios();
  aviso('Usuario creado', `Entrégale a ${usuario} esta contraseña temporal por un canal seguro: ${clave}\n\nDeberá cambiarla y activar su verificación en dos pasos en el primer ingreso.`);
});

$('lista-usuarios').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-accion]');
  if (!b) return;
  const nombre = b.dataset.usuario, accion = b.dataset.accion;
  if (nombre === sesion.usuario) return;   // nadie administra su propia cuenta desde aquí
  const buscar = () => datos.usuarios.find((u) => u.usuario === nombre);   // se busca otra vez tras cada diálogo
  if (!buscar()) return;

  if (accion === 'eliminar') {
    const ok = await dialogo({ titulo: `Eliminar a ${nombre}`, ok: 'Eliminar', peligro: true,
      texto: 'Se borra la cuenta y esa persona ya no podrá entrar. Solo se puede deshacer restaurando una copia de seguridad.' });
    if (!ok || !buscar()) return;
    datos.usuarios = datos.usuarios.filter((u) => u.usuario !== nombre);
  } else if (accion === 'mfa') {
    const ok = await dialogo({ titulo: `Reiniciar el MFA de ${nombre}`, ok: 'Reiniciar',
      texto: 'Se borra su verificación en dos pasos y tendrá que activarla de nuevo (por correo o con un QR nuevo). Quien conozca su contraseña podría registrar su propio dispositivo: si sospechas de la cuenta, reinicia también la contraseña.' });
    const u = buscar();
    if (!ok || !u) return;
    u.mfa = null;
  } else if (accion === 'clave') {
    const nueva = await dialogo({ titulo: `Reiniciar la contraseña de ${nombre}`, ok: 'Reiniciar', etiqueta: 'Contraseña temporal', valor: claveAleatoria(),
      texto: 'Se asigna esta contraseña temporal. La persona deberá cambiarla al entrar. Entrégasela por un canal seguro.',
      validar: (v) => (v.length < 8 ? 'Mínimo 8 caracteres.' : null) });
    const u = buscar();
    if (!nueva || !u) return;
    u.clave = hash(nombre + nueva);
    u.cambiarClave = true;
  }
  guardar();
  renderUsuarios();
});

/* ---------- Copias de seguridad (cifradas) ---------- */
function validarCopia(d) {
  const ok = d && Array.isArray(d.usuarios) && Array.isArray(d.mesas) && Array.isArray(d.historial)
    && d.mesas.length === TOTAL_MESAS
    && d.mesas.every((m) => m && Number.isInteger(m.numero) && m.items && typeof m.items === 'object')
    && d.usuarios.every((u) => u && typeof u.usuario === 'string' && typeof u.clave === 'string' && ROLES.includes(u.rol))
    && new Set(d.usuarios.map((u) => u.usuario)).size === d.usuarios.length
    && d.usuarios.some((u) => u.rol === 'superadmin');
  if (!ok) throw new Error('ESTRUCTURA');
  return { usuarios: d.usuarios, mesas: d.mesas, historial: d.historial };
}

$('btn-exportar').addEventListener('click', async () => {
  const clave = await dialogo({ titulo: 'Exportar copia de seguridad', ok: 'Exportar', etiqueta: 'Contraseña de la copia', tipo: 'password', repetir: true,
    texto: 'Se guarda un archivo cifrado con usuarios, mesas e historial. Elige una contraseña para protegerlo: si la olvidas, la copia no se puede abrir.',
    validar: (v) => (v.length < 8 ? 'Mínimo 8 caracteres.' : null) });
  if (!clave) return;
  try {
    const texto = await RESPALDO.cifrar({ usuarios: datos.usuarios, mesas: datos.mesas, historial: datos.historial }, clave);
    descargar(texto, `restaurant-manager-copia-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  } catch (e) {
    aviso('No se pudo exportar', 'El navegador bloqueó el cifrado. Abre la página con https:// o localhost.');
  }
});

// El selector de archivos se abre directamente desde el clic (los navegadores móviles lo exigen)
const elegirCopia = () => { $('archivo-copia').value = ''; $('archivo-copia').click(); };
$('btn-importar').addEventListener('click', elegirCopia);
$('btn-restaurar').addEventListener('click', elegirCopia);

$('archivo-copia').addEventListener('change', async (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  if (archivo.size > 20 * 1024 * 1024) return aviso('Archivo demasiado grande', 'Esto no parece una copia de Restaurant Manager.');
  const texto = await archivo.text();
  const reemplaza = !!sesion || datos.usuarios.length > 0;
  let nuevos = null;
  const clave = await dialogo({ titulo: 'Restaurar copia de seguridad', ok: 'Restaurar', peligro: reemplaza, etiqueta: 'Contraseña de la copia', tipo: 'password',
    texto: reemplaza
      ? 'ATENCIÓN: se reemplazarán TODOS los datos actuales (usuarios, mesas e historial) por los de la copia.'
      : 'Escribe la contraseña con la que se protegió la copia.',
    validar: async (v) => {
      try { nuevos = validarCopia(await RESPALDO.descifrar(texto, v)); return null; }
      catch (err) { return err.message === 'CLAVE' ? 'Contraseña incorrecta o archivo dañado.' : 'El archivo no es una copia válida de Restaurant Manager.'; }
    } });
  if (!clave || !nuevos) return;
  datos = nuevos;
  guardar();
  const yo = sesion && datos.usuarios.find((u) => u.usuario === sesion.usuario && u.rol === 'superadmin');
  if (yo) { sesion = yo; renderTodo(); aviso('Copia restaurada', 'Los datos se restauraron correctamente.'); }
  else { sessionStorage.removeItem(SES); location.reload(); }
});

/* ---------- Render general ---------- */
function renderTodo() {
  if (!sesion) return;
  if (sesion.rol === 'superadmin') { renderUsuarios(); return; }
  renderMesas();
  renderPedido();
  renderPedidos();
  if (sesion.rol === 'admin') { renderStats(); renderHistorial(); }
}

// Si varias pestañas del mismo navegador están abiertas, se actualizan en vivo.
// Si el super-administrador elimina la cuenta de alguien con la sesión abierta, esa sesión se cierra.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY && e.key !== null) return;
  datos = cargar();
  if (sesion) {
    const vigente = datos.usuarios.find((u) => u.usuario === sesion.usuario);
    if (!vigente || vigente.rol !== sesion.rol) { sessionStorage.removeItem(SES); location.reload(); return; }
    renderTodo();
  } else if (!$('paso-credenciales').hidden) {
    configurarLogin();
  }
});

/* ---------- Inicio ---------- */
configurarLogin();
const guardada = sessionStorage.getItem(SES);
const usuarioGuardado = datos.usuarios.find((u) => u.usuario === guardada);
if (usuarioGuardado) entrar(usuarioGuardado);
