/* ==========================================================
   Código de verificación por correo con EmailJS (API REST).
   El código se genera con crypto.getRandomValues, se guarda solo
   su hash SHA-256 en memoria, caduca a los 5 minutos y es de un solo uso.
   Límite conocido: sin servidor, la comprobación ocurre en el navegador.
   Sirve como demostración; en producción se verificaría en un servidor.
   ========================================================== */
(function (raiz) {
  // La clave pública de EmailJS está hecha para ir en el navegador.
  // Protección real: en EmailJS > Account > Security, permitir solo tu dominio.
  const CONFIG = {
    servicio: 'service_08710kb',
    plantilla: 'template_8gb43hm',
    clavePublica: 's9IGNNqxr_Hwarpzn',
    url: 'https://api.emailjs.com/api/v1.0/email/send'
  };
  const MINUTOS = 5;          // vida del código
  const ESPERA_REENVIO = 60;  // segundos entre envíos, para no gastar la cuota
  const MAX_INTENTOS = 5;     // intentos por código antes de tener que pedir otro
  const PATRON = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  let pendiente = null;       // { usuario, hash, expira, intentos }
  let ultimoEnvio = 0;

  async function sha256(texto) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
    return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  // 6 dígitos sin sesgo: se descartan los valores que no reparten parejo entre 0 y 999999
  function nuevoCodigo() {
    const limite = 4294967296 - (4294967296 % 1000000);
    const buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limite);
    return String(buf[0] % 1000000).padStart(6, '0');
  }

  const valido = (correo) => PATRON.test(String(correo).trim());

  // maria.lopez@gmail.com -> ma*******z@gmail.com
  function ocultar(correo) {
    const [nombre, dominio] = String(correo).split('@');
    if (!dominio) return correo;
    const visibles = nombre.length <= 3 ? 1 : 2;
    return nombre.slice(0, visibles) + '*'.repeat(Math.max(nombre.length - visibles - 1, 1)) + (nombre.length > 3 ? nombre.slice(-1) : '') + '@' + dominio;
  }

  const segundosParaReenviar = () => Math.max(0, Math.ceil((ultimoEnvio + ESPERA_REENVIO * 1000 - Date.now()) / 1000));

  async function enviar(usuario, correo) {
    if (!valido(correo)) throw new Error('CORREO');
    if (segundosParaReenviar() > 0) throw new Error('ESPERA');
    const codigo = nuevoCodigo();
    ultimoEnvio = Date.now();
    let resp;
    try {
      resp = await fetch(CONFIG.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: CONFIG.servicio,
          template_id: CONFIG.plantilla,
          user_id: CONFIG.clavePublica,
          template_params: { to_email: correo.trim(), usuario, codigo, minutos: String(MINUTOS) }
        })
      });
    } catch (e) {
      ultimoEnvio = 0;   // sin conexión: se puede reintentar enseguida
      throw new Error('RED');
    }
    if (!resp.ok) {
      ultimoEnvio = 0;
      const detalle = await resp.text().catch(() => '');
      console.error('EmailJS', resp.status, detalle);
      throw new Error(resp.status === 429 ? 'LIMITE' : 'SERVICIO');
    }
    pendiente = { usuario, hash: await sha256(codigo), expira: Date.now() + MINUTOS * 60000, intentos: 0 };
  }

  // Devuelve 'ok' | 'incorrecto' | 'caducado' | 'agotado' | 'sin-codigo'
  async function verificar(usuario, entrada) {
    if (!pendiente || pendiente.usuario !== usuario) return 'sin-codigo';
    if (Date.now() > pendiente.expira) { pendiente = null; return 'caducado'; }
    const limpio = String(entrada).replace(/\D/g, '');
    if (limpio.length === 6 && await sha256(limpio) === pendiente.hash) {
      pendiente = null;   // un solo uso
      return 'ok';
    }
    if (++pendiente.intentos >= MAX_INTENTOS) { pendiente = null; return 'agotado'; }
    return 'incorrecto';
  }

  const limpiar = () => { pendiente = null; };

  raiz.CORREO = { enviar, verificar, limpiar, valido, ocultar, segundosParaReenviar, MINUTOS, MAX_INTENTOS };
})(window);
