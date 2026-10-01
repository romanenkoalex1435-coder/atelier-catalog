/* Crumpled-paper backdrop: facet + crease relief computed in a fragment shader,
   lit by a point light that follows the cursor (or the scroll on touch screens). */
const canvas = document.querySelector('#paper');
const gl = canvas?.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });

if (gl) {
  const vertex = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
  const fragment = `
precision highp float;
uniform vec2 uRes; uniform float uDpr; uniform vec2 uOff; uniform vec3 uLight; uniform vec3 uBase; uniform float uAmt;
vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453123); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
vec2 worley(vec2 x, out vec2 id){
  vec2 n = floor(x), f = fract(x); float f1 = 9., f2 = 9.; id = vec2(0.);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 r = g + h22(n + g) - f; float d = mix(dot(r, r), (abs(r.x) + abs(r.y)) * (abs(r.x) + abs(r.y)), .6);
    if (d < f1) { f2 = f1; f1 = d; id = n + g; } else if (d < f2) { f2 = d; }
  }
  return vec2(sqrt(f1), sqrt(f2));
}
void main(){
  vec2 s = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 p = s + uOff;
  mat2 R = mat2(.82, .57, -.57, .82);
  vec2 w = (R * p) / vec2(330., 190.); w += .35 * vec2(vn(w * 1.4), vn(w * 1.4 + 19.));
  vec2 id1; vec2 a = worley(w, id1); vec2 g1 = (h22(id1 + 3.1) - .5) * 2.;
  mat2 R2 = mat2(.34, -.94, .94, .34);
  vec2 q = (R2 * p) / vec2(150., 85.) + vec2(31., 7.); q += .3 * vec2(vn(q * 1.6 + 5.), vn(q * 1.6 + 41.));
  vec2 id2; vec2 b = worley(q, id2); vec2 g2 = (h22(id2 + 8.7) - .5) * 2.;
  mat2 R3 = mat2(.96, -.28, .28, .96);
  vec2 q3 = (R3 * p) / vec2(70., 44.) + vec2(11., 53.); q3 += .25 * vec2(vn(q3 * 2.1 + 3.), vn(q3 * 2.1 + 29.));
  vec2 id3; vec2 c3 = worley(q3, id3); vec2 g4 = (h22(id3 + 5.3) - .5) * 2.;
  vec2 u = p / 15.; float e = .5;
  vec2 g3 = vec2(vn(u + vec2(e, 0.)) - vn(u - vec2(e, 0.)), vn(u + vec2(0., e)) - vn(u - vec2(0., e)));
  vec2 grad = (g1 * .6 + g2 * .42 + g4 * .3 + g3 * .22) * uAmt;
  vec3 N = normalize(vec3(-grad, 1.));
  float c1 = 1. - smoothstep(0., .022, a.y - a.x);
  float c2 = 1. - smoothstep(0., .03, b.y - b.x);
  float c3b = 1. - smoothstep(0., .04, c3.y - c3.x);
  float ao = 1. - .06 * c1 - .05 * c2 - .035 * c3b;
  vec3 L = normalize(vec3(uLight.xy - s, uLight.z));
  float ratio = dot(N, L) / L.z;
  float shade = clamp(.95 + (ratio - 1.) * .27, .68, 1.1);
  vec3 col = uBase * 1.05 * shade * ao;
  col *= 1. + .08 * smoothstep(1100., 0., length(uLight.xy - s));
  vec3 H = normalize(L + vec3(0., 0., 1.));
  col += pow(max(dot(N, H), 0.), 46.) * .09;
  // aging: yellowed stains, darkened edges, sparse foxing
  float st = vn(p / 560. + 3.) * .55 + vn(p / 210. + 9.) * .3 + vn(p / 70. + 1.) * .15;
  col = mix(col, col * vec3(.94, .85, .66), smoothstep(.46, .84, st) * .8);
  vec2 uv = s / (uRes / uDpr);
  float vg = length((uv - .5) * vec2(1., .92));
  col *= 1. - .14 * smoothstep(.4, 1., vg);
  col = mix(col, col * vec3(.9, .78, .58), smoothstep(.55, 1.05, vg) * .38);
  vec2 cell = floor(p / 3.);
  float speck = step(.9988, h21(cell)) * (.45 + .55 * h21(cell + 7.));
  col = mix(col, vec3(.46, .3, .15), speck * .55);
  col *= .985 + .03 * h21(gl_FragCoord.xy);
  gl_FragColor = vec4(col, 1.);
}`;
  const compile = (type, src) => { const shader = gl.createShader(type); gl.shaderSource(shader, src); gl.compileShader(shader); return shader; };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = name => gl.getUniformLocation(program, name);
    const uni = { res: u('uRes'), dpr: u('uDpr'), off: u('uOff'), light: u('uLight'), base: u('uBase'), amt: u('uAmt') };

    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const fine = matchMedia('(hover: hover) and (pointer: fine)');
    const hex = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    const base = /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) : [.85, .81, .73];
    let dpr = 1, width = 0, height = 0;
    const light = { x: 0, y: 0 }, target = { x: 0, y: 0 };
    let raf = 0;

    const resize = () => {
      dpr = fine.matches ? Math.min(window.devicePixelRatio || 1, 1.5) : .8;   // phones: lower render scale, the paper is soft anyway
      width = innerWidth; height = innerHeight;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (!light.x) { target.x = light.x = width * .28; target.y = light.y = height * .16; }
      draw();
    };

    function draw() {
      gl.uniform2f(uni.res, canvas.width, canvas.height);
      gl.uniform1f(uni.dpr, dpr);
      gl.uniform2f(uni.off, 0, reduce.matches ? 0 : scrollY * .18);   // paper sits behind the page: slower than content
      gl.uniform3f(uni.light, light.x, light.y, Math.max(520, Math.max(width, height) * .75));
      gl.uniform3f(uni.base, base[0], base[1], base[2]);
      gl.uniform1f(uni.amt, .52);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame() {
      raf = 0;
      light.x += (target.x - light.x) * .12;
      light.y += (target.y - light.y) * .12;
      draw();
      if (Math.abs(target.x - light.x) + Math.abs(target.y - light.y) > .6) raf = requestAnimationFrame(frame);
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(frame); };

    if (!reduce.matches) {
      addEventListener('pointermove', event => { if (event.pointerType !== 'mouse') return; target.x = event.clientX; target.y = event.clientY; schedule(); }, { passive: true });
      addEventListener('scroll', () => {
        if (!fine.matches) target.y = height * .16 + (scrollY % (height * 1.2)) * .35;
        schedule();
      }, { passive: true });
    }
    addEventListener('resize', resize);
    resize();
    requestAnimationFrame(() => canvas.classList.add('ready'));
  }
}
