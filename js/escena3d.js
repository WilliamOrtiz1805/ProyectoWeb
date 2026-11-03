/* ==========================================================
   Fondo 3D del acceso: muro de cubos en WebGL2, sin librerías.
   Sustituye al visor de Spline, que congelaba la página más de
   10 segundos en cada visita. Todos los cubos se dibujan en una
   sola llamada, así que el trabajo por cuadro es mínimo.
   Si WebGL no está disponible, queda el fondo estático de CSS.
   ========================================================== */
(function () {
  const contenedor = document.getElementById('login-escena');
  if (!contenedor) return;   // la sesión ya estaba abierta

  const ANCHO_MAX = 1100;    // píxeles de ancho que se dibujan como máximo
  const FPS_MINIMO = 25;
  const FILAS_VISIBLES = 7;  // alto de la pantalla, en cubos
  const CAMPO = 38 * Math.PI / 180;
  const CERCA = 0.5, LEJOS = 80;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'low-power' });
  if (!gl) return;

  const VERTICES = `#version 300 es
    layout(location=0) in vec3 aPos;
    layout(location=1) in vec3 aNormal;
    layout(location=2) in vec2 aCelda;
    uniform float uT, uFuerza, uDist;
    uniform vec2 uRaton, uCam, uProy, uClip;
    out vec3 vNormal, vLocal, vMundo;
    out float vCerca, vVeta;

    float azar(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      float ola = sin(aCelda.x * .42 + uT * .35) * .5
                + sin(aCelda.y * .57 - uT * .27) * .5
                + sin((aCelda.x + aCelda.y) * .23 + uT * .19) * .6;
      float d = distance(aCelda, uRaton);
      float cerca = exp(-d * d / 7.) * uFuerza;
      float alto = ola * .32 + (azar(aCelda) - .5) * 1.05 + cerca * .85;
      vec3 p = vec3(aCelda + aPos.xy * .992, aPos.z * 3. + alto);
      vNormal = aNormal;
      vLocal = aPos;
      vMundo = p;
      vCerca = cerca;
      // Vetas de luz verde que recorren el muro despacio
      vVeta = smoothstep(.985, 1., sin(aCelda.x * .37 + aCelda.y * .53 - uT * .3 + azar(aCelda) * 6.28));
      vec3 v = p - vec3(uCam, uDist);
      gl_Position = vec4(v.x * uProy.x, v.y * uProy.y, v.z * uClip.x + uClip.y, -v.z);
    }`;

  const FRAGMENTOS = `#version 300 es
    precision mediump float;
    in vec3 vNormal, vLocal, vMundo;
    in float vCerca, vVeta;
    uniform vec2 uFoco;
    out vec4 color;
    const vec3 VERDE = vec3(.09, .91, .07);

    void main() {
      // Foco amplio desde arriba a la izquierda: el centro del muro cae casi a negro
      vec2 q = vMundo.xy - uFoco;
      float foco = .1 + .9 * exp(-dot(q, q) / 34.);
      vec3 luz = normalize(vec3(-.5, .62, .6));
      float difusa = max(dot(vNormal, luz), 0.);
      vec3 base = vec3(.37, .39, .41) * (.1 + difusa * 1.15) * foco;

      if (vNormal.z > .5) {
        // Superficie metálica: degradado en la cara y filo fino azulado
        float borde = smoothstep(.478, .5, max(abs(vLocal.x), abs(vLocal.y)));
        base *= .86 + (vLocal.y - vLocal.x) * .26;
        base += vec3(.05, .07, .09) * borde * (.25 + foco);
        base += VERDE * borde * vCerca * .1;
      } else {
        // Laterales: se apagan hacia el fondo y dejan salir algún destello verde
        float fondo = clamp(-vLocal.z, 0., 1.);
        base *= 1. - fondo * .9;
        base += VERDE * (vVeta * .85 + vCerca * .16) * (1. - fondo) * (1. - fondo);
      }
      color = vec4(base * (.8 + vMundo.z * .2), 1.);
    }`;

  function compilar(tipo, fuente) {
    const s = gl.createShader(tipo);
    gl.shaderSource(s, fuente);
    gl.compileShader(s);
    return s;
  }
  const programa = gl.createProgram();
  gl.attachShader(programa, compilar(gl.VERTEX_SHADER, VERTICES));
  gl.attachShader(programa, compilar(gl.FRAGMENT_SHADER, FRAGMENTOS));
  gl.linkProgram(programa);
  if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) {
    console.error('escena3d', gl.getProgramInfoLog(programa));
    return;
  }
  gl.useProgram(programa);
  const u = {};
  ['uT', 'uFuerza', 'uDist', 'uRaton', 'uCam', 'uProy', 'uClip', 'uFoco'].forEach((n) => { u[n] = gl.getUniformLocation(programa, n); });

  /* Cubo: cara frontal en z = 0 y laterales hacia atrás. No hace falta la cara trasera. */
  const CARAS = [
    [[-.5, -.5, 0], [.5, -.5, 0], [.5, .5, 0], [-.5, .5, 0], [0, 0, 1]],
    [[.5, -.5, 0], [.5, -.5, -1], [.5, .5, -1], [.5, .5, 0], [1, 0, 0]],
    [[-.5, -.5, -1], [-.5, -.5, 0], [-.5, .5, 0], [-.5, .5, -1], [-1, 0, 0]],
    [[-.5, .5, 0], [.5, .5, 0], [.5, .5, -1], [-.5, .5, -1], [0, 1, 0]],
    [[-.5, -.5, -1], [.5, -.5, -1], [.5, -.5, 0], [-.5, -.5, 0], [0, -1, 0]]
  ];
  const malla = [];
  CARAS.forEach(([a, b, c, d, n]) => [a, b, c, a, c, d].forEach((v) => malla.push(...v, ...n)));
  const VERTICES_CUBO = malla.length / 6;

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(malla), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  const bufCeldas = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bufCeldas);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.clearColor(.02, .022, .024, 1);

  const distancia = (FILAS_VISIBLES / 2) / Math.tan(CAMPO / 2);
  gl.uniform1f(u.uDist, distancia);
  gl.uniform2f(u.uClip, (LEJOS + CERCA) / (CERCA - LEJOS), 2 * LEJOS * CERCA / (CERCA - LEJOS));

  let cubos = 0, aspecto = 1, calidad = 1;

  function ajustar() {
    const ancho = contenedor.clientWidth || innerWidth, alto = contenedor.clientHeight || innerHeight;
    const escala = Math.min(1, ANCHO_MAX / (ancho * devicePixelRatio)) * devicePixelRatio * calidad;
    canvas.width = Math.max(1, Math.round(ancho * escala));
    canvas.height = Math.max(1, Math.round(alto * escala));
    gl.viewport(0, 0, canvas.width, canvas.height);
    aspecto = ancho / alto;
    const f = 1 / Math.tan(CAMPO / 2);
    gl.uniform2f(u.uProy, f / aspecto, f);
    gl.uniform2f(u.uFoco, -FILAS_VISIBLES * aspecto * .42, FILAS_VISIBLES * .42);

    // Con margen, para que la perspectiva y el movimiento no dejen huecos en los bordes
    const medioX = Math.ceil(FILAS_VISIBLES * aspecto / 2) + 3, medioY = Math.ceil(FILAS_VISIBLES / 2) + 3;
    const celdas = [];
    for (let y = -medioY; y <= medioY; y++) for (let x = -medioX; x <= medioX; x++) celdas.push(x, y);
    cubos = celdas.length / 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCeldas);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(celdas), gl.STATIC_DRAW);
  }

  /* Ratón: el texto deja pasar los clics, así que se escucha en toda la ventana */
  const raton = { x: 0, y: 0, ultimo: -1e9 };
  const suave = { x: 2, y: 0, fuerza: 0 };
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    raton.x = (e.clientX / innerWidth - .5) * FILAS_VISIBLES * aspecto;
    raton.y = (.5 - e.clientY / innerHeight) * FILAS_VISIBLES;
    raton.ultimo = performance.now();
  }, { passive: true });

  function dibujar(t) {
    const seg = t / 1000;
    // Sin ratón (o en táctil), el brillo pasea solo por el muro
    const activo = t - raton.ultimo < 3000;
    const destinoX = activo ? raton.x : Math.sin(seg * .23) * FILAS_VISIBLES * aspecto * .35;
    const destinoY = activo ? raton.y : Math.sin(seg * .31 + 1) * FILAS_VISIBLES * .3;
    suave.x += (destinoX - suave.x) * .06;
    suave.y += (destinoY - suave.y) * .06;
    suave.fuerza += ((activo ? 1 : .55) - suave.fuerza) * .03;

    gl.uniform1f(u.uT, seg);
    gl.uniform1f(u.uFuerza, suave.fuerza);
    gl.uniform2f(u.uRaton, suave.x, suave.y);
    gl.uniform2f(u.uCam, suave.x * .035, suave.y * .035);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, VERTICES_CUBO, cubos);
  }

  /* Bucle: se detiene al iniciar sesión. Si un equipo no llega a 25 FPS,
     primero baja la resolución y, si sigue lento, deja la imagen quieta. */
  let cuadrosMedidos = 0, inicioMedida = 0, detenida = false;

  function vigilar(t) {
    if (document.hidden) { inicioMedida = 0; return; }
    if (!inicioMedida) { inicioMedida = t; cuadrosMedidos = 0; return; }
    cuadrosMedidos++;
    if (t - inicioMedida < 2500) return;
    const fps = cuadrosMedidos * 1000 / (t - inicioMedida);
    inicioMedida = 0;
    if (fps >= FPS_MINIMO) return;
    if (calidad === 1) { calidad = .5; ajustar(); } else detenida = true;
  }

  function cuadro(t) {
    if (!canvas.isConnected) {   // ya inició sesión: libera la GPU
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return;
    }
    dibujar(t);
    vigilar(t);
    if (!detenida) requestAnimationFrame(cuadro);
  }

  canvas.addEventListener('webglcontextlost', () => { detenida = true; canvas.remove(); });
  contenedor.appendChild(canvas);
  ajustar();
  new ResizeObserver(() => { ajustar(); if (detenida) dibujar(performance.now()); }).observe(contenedor);

  // Con movimiento reducido se muestra un solo cuadro quieto
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    detenida = true;
    suave.fuerza = .55;
    dibujar(20000);
  } else {
    requestAnimationFrame(cuadro);
  }
  requestAnimationFrame(() => canvas.classList.add('lista'));
})();
