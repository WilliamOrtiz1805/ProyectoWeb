/* ==========================================================
   MFA con TOTP (RFC 6238) — sin dependencias.
   Usa la Web Crypto API del navegador (HMAC-SHA1 y SHA-256).
   Requiere contexto seguro: https:// o http://localhost
   ========================================================== */
(function (raiz) {
  const ALFABETO_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const ALFABETO_REC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I para no confundir al leer
  const PERIODO = 30;   // segundos que dura cada código
  const DIGITOS = 6;
  const VENTANA = 1;    // acepta el código anterior y el siguiente (relojes desfasados)

  const cripto = () => raiz.crypto || (typeof require === 'function' ? require('node:crypto').webcrypto : null);
  const disponible = () => !!(cripto() && cripto().subtle);

  const aleatorios = (n) => cripto().getRandomValues(new Uint8Array(n));

  /* ----- Base32 (el formato que esperan Google/Microsoft Authenticator) ----- */
  function base32Codificar(bytes) {
    let bits = 0, valor = 0, salida = '';
    for (const b of bytes) {
      valor = (valor << 8) | b; bits += 8;
      while (bits >= 5) { salida += ALFABETO_B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) salida += ALFABETO_B32[(valor << (5 - bits)) & 31];
    return salida;
  }
  function base32Decodificar(texto) {
    const limpio = texto.toUpperCase().replace(/[\s=-]/g, '');
    let bits = 0, valor = 0; const salida = [];
    for (const c of limpio) {
      const i = ALFABETO_B32.indexOf(c);
      if (i < 0) throw new Error('Clave base32 inválida');
      valor = (valor << 5) | i; bits += 5;
      if (bits >= 8) { salida.push((valor >>> (bits - 8)) & 255); bits -= 8; }
    }
    return new Uint8Array(salida);
  }

  /* ----- TOTP ----- */
  async function hotp(secretoB32, contador) {
    const llave = await cripto().subtle.importKey(
      'raw', base32Decodificar(secretoB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const buf = new ArrayBuffer(8);
    const vista = new DataView(buf);
    vista.setUint32(0, Math.floor(contador / 2 ** 32));
    vista.setUint32(4, contador >>> 0);
    const h = new Uint8Array(await cripto().subtle.sign('HMAC', llave, buf));
    const o = h[19] & 15;
    const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(n % 10 ** DIGITOS).padStart(DIGITOS, '0');
  }
  const pasoActual = (ms = Date.now()) => Math.floor(ms / 1000 / PERIODO);
  const totp = (secretoB32, ms = Date.now()) => hotp(secretoB32, pasoActual(ms));

  /**
   * Verifica un código. Devuelve el paso de tiempo aceptado, o null si es inválido.
   * `ultimoPaso` evita reutilizar un código ya usado (anti-repetición).
   */
  async function verificar(secretoB32, codigo, ultimoPaso = -1, ms = Date.now()) {
    const limpio = String(codigo).replace(/\s/g, '');
    if (!/^\d{6}$/.test(limpio)) return null;
    const base = pasoActual(ms);
    for (const d of [0, -1, 1].filter((x) => Math.abs(x) <= VENTANA)) {
      const paso = base + d;
      if (paso <= ultimoPaso) continue;
      if ((await hotp(secretoB32, paso)) === limpio) return paso;
    }
    return null;
  }

  const nuevoSecreto = () => base32Codificar(aleatorios(20)); // 160 bits

  // URI que leen las apps autenticadoras (se dibuja como QR)
  const uri = (secreto, usuario, emisor) =>
    `otpauth://totp/${encodeURIComponent(emisor)}:${encodeURIComponent(usuario)}` +
    `?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=${DIGITOS}&period=${PERIODO}`;

  /* ----- Códigos de recuperación (un solo uso) ----- */
  function codigosRecuperacion(cantidad = 8) {
    return Array.from({ length: cantidad }, () => {
      const b = aleatorios(10); // 256 es múltiplo de 32: sin sesgo
      const t = Array.from(b, (x) => ALFABETO_REC[x & 31]).join('');
      return `${t.slice(0, 5)}-${t.slice(5)}`;
    });
  }
  const normalizarRec = (c) => String(c).toUpperCase().replace(/[^A-Z0-9]/g, '');
  async function hashCodigo(codigo) {
    const datos = new TextEncoder().encode(normalizarRec(codigo));
    const h = new Uint8Array(await cripto().subtle.digest('SHA-256', datos));
    return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  const API = { disponible, nuevoSecreto, uri, totp, hotp, verificar, codigosRecuperacion, hashCodigo,
    base32Codificar, base32Decodificar, PERIODO };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else raiz.MFA = API;
})(typeof window !== 'undefined' ? window : globalThis);
