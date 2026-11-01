/* ==========================================================
   Copias de seguridad cifradas.
   Contraseña -> PBKDF2-SHA256 (250.000 iteraciones) -> clave AES-256-GCM.
   GCM además detecta si el archivo fue alterado o si la contraseña es errónea.
   ========================================================== */
(function (raiz) {
  const FORMATO = 'restaurant-manager-copia';
  const ITERACIONES = 250000;
  const MAX_ITERACIONES = 2000000;  // tope: un archivo ajeno no debe poder colgar el navegador

  const cripto = () => raiz.crypto || (typeof require === 'function' ? require('node:crypto').webcrypto : null);
  const aleatorios = (n) => cripto().getRandomValues(new Uint8Array(n));

  function aB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const deB64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

  async function derivar(clave, sal, iteraciones) {
    const base = await cripto().subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
    return cripto().subtle.deriveKey(
      { name: 'PBKDF2', salt: sal, iterations: iteraciones, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function cifrar(objeto, clave) {
    const sal = aleatorios(16), iv = aleatorios(12);
    const llave = await derivar(clave, sal, ITERACIONES);
    const datos = new TextEncoder().encode(JSON.stringify(objeto));
    const cifrado = new Uint8Array(await cripto().subtle.encrypt({ name: 'AES-GCM', iv }, llave, datos));
    return JSON.stringify({
      formato: FORMATO, version: 1, kdf: 'PBKDF2-SHA256', iteraciones: ITERACIONES,
      cifrado: 'AES-256-GCM', sal: aB64(sal), iv: aB64(iv), datos: aB64(cifrado)
    });
  }

  // Lanza Error('FORMATO') si no es una copia válida, o Error('CLAVE') si la contraseña no abre el archivo
  async function descifrar(texto, clave) {
    let c;
    try { c = JSON.parse(texto); } catch (e) { throw new Error('FORMATO'); }
    if (!c || c.formato !== FORMATO || c.version !== 1 || !Number.isInteger(c.iteraciones) ||
        c.iteraciones < 1 || c.iteraciones > MAX_ITERACIONES) throw new Error('FORMATO');
    let sal, iv, datos;
    try { sal = deB64(c.sal); iv = deB64(c.iv); datos = deB64(c.datos); } catch (e) { throw new Error('FORMATO'); }
    let plano;
    try {
      const llave = await derivar(clave, sal, c.iteraciones);
      plano = await cripto().subtle.decrypt({ name: 'AES-GCM', iv }, llave, datos);
    } catch (e) { throw new Error('CLAVE'); }
    try { return JSON.parse(new TextDecoder().decode(plano)); } catch (e) { throw new Error('FORMATO'); }
  }

  const API = { cifrar, descifrar, FORMATO };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else raiz.RESPALDO = API;
})(typeof window !== 'undefined' ? window : globalThis);
