/**
 * The MVP streak flame drawn by a WebGL fragment shader: real fire motion
 * (tongues rising and tearing off, wings waving outward, embers) kept to the
 * silhouette of the flame art. The two masks (flame-glow: the whole flame,
 * flame-core: its white-hot heart) give the shape; animated fractal noise
 * displaces and erodes it every frame, and the tier's palette colours it by
 * heat. One small canvas per card, paused while off-screen; with reduced
 * motion a single still frame is drawn.
 *
 * The masks are imported `?inline` (data URLs): the packaged app loads its
 * pages from file://, where WebGL may not read file:// images. When WebGL
 * is missing or fails, `onFail` lets the caller draw the CSS flame instead.
 */
import { useEffect, useRef } from 'react'
import flameGlow from '@/assets/frames/flame-glow.webp?inline'
import flameCore from '@/assets/frames/flame-core.webp?inline'
import { hexToRgb01, type FlamePalette } from '@/lib/awardFlame'

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  // Image space: (0,0) top-left, y down, like the masks.
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAGMENT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uShape;
uniform sampler2D uHeart;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uLight;
uniform vec3 uCore;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = vUv;
  float t = uTime;
  float cx = uv.x - 0.5;
  // 0 on the body, 1 on the wings.
  float wing = smoothstep(0.1, 0.24, abs(cx));
  // Higher up the body, the more the fire moves.
  float rise = clamp((0.85 - uv.y) / 0.85, 0.0, 1.0);

  // Body: noise scrolling upward, warped by a second noise (licking tongues).
  vec2 pb = vec2(uv.x * 7.0, uv.y * 5.0 + t * 2.2);
  float warp = fbm(pb * 0.7 + vec2(0.0, t * 0.6));
  float nb = fbm(pb + vec2(warp * 1.6, 0.0));
  // Wings: noise streaming outward from the centre, waving up and down.
  vec2 pw = vec2(abs(cx) * 9.0 - t * 1.8, uv.y * 10.0 + sin(t * 1.3 + abs(cx) * 12.0) * 0.6);
  float nw = fbm(pw);
  float n = mix(nb, nw, wing);

  vec2 disp = mix(
    vec2((nb - 0.5) * 0.07 * (0.35 + rise), (nb - 0.45) * 0.09 * rise),
    vec2((nw - 0.5) * 0.02, (nw - 0.5) * 0.07 + sin(t * 2.1 + abs(cx) * 18.0) * 0.012 * abs(cx) * 2.0),
    wing);

  float shape = texture2D(uShape, uv + disp).a;
  // Erosion: the noise eats into the edges and the tips, so flames tear off.
  float heat = shape * smoothstep(0.18, 0.62, n * 0.85 + shape * 0.55 - rise * 0.12);
  heat *= 0.75 + 0.5 * n;
  float heart = texture2D(uHeart, uv + disp * 0.5).a * smoothstep(0.25, 0.7, nb + 0.15);

  vec3 col = mix(uDeep, uMid, smoothstep(0.03, 0.45, heat));
  col = mix(col, uLight, smoothstep(0.75, 1.15, heat) * 0.85);
  col = mix(col, uCore, clamp(heart * 0.9, 0.0, 0.9));
  float alpha = clamp(heat * 1.25 + heart * 0.5, 0.0, 1.0);

  // Embers rising from the body and drifting.
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float life = fract(t * (0.22 + hash(vec2(fi, 3.0)) * 0.18) + hash(vec2(fi, 7.0)));
    vec2 ep = vec2(0.5 + (hash(vec2(fi, 1.0)) - 0.5) * 0.16 + sin(t * 1.7 + fi * 2.3) * 0.025 * life,
                   0.62 - life * 0.62);
    vec2 d = (uv - ep) * vec2(1.55, 1.0);
    float e = smoothstep(0.012, 0.0, length(d)) * (1.0 - life) * smoothstep(0.0, 0.1, life);
    col = mix(col, uLight, clamp(e * 1.5, 0.0, 1.0) * (1.0 - alpha * 0.5));
    alpha = max(alpha, e);
  }

  gl_FragColor = vec4(col * alpha, alpha);
}`

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)
  if (!s) throw new Error('shader')
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile')
  return s
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('flame mask'))
    img.src = src
  })
}

function texture(gl: WebGLRenderingContext, unit: number, img: HTMLImageElement): void {
  const tex = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
}

export function FlameShader({ palette, speed, onFail }: { palette: FlamePalette; speed: number; onFail: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read by the render loop, so a tier change recolours without a new context.
  const live = useRef({ palette, speed })
  live.current = { palette, speed }
  const failRef = useRef(onFail)
  failRef.current = onFail

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let gl: WebGLRenderingContext | null = null
    let raf = 0
    let disposed = false
    let visible = true
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const start = performance.now() - Math.random() * 10_000 // cards don't flicker in sync

    const fail = () => {
      if (!disposed) failRef.current()
    }

    try {
      gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false })
    } catch {
      gl = null
    }
    if (!gl) {
      fail()
      return
    }
    const g = gl

    let uniforms: Record<string, WebGLUniformLocation | null> = {}
    const setup = async () => {
      const [shape, heart] = await Promise.all([loadImage(flameGlow), loadImage(flameCore)])
      if (disposed) return
      const prog = g.createProgram()
      if (!prog) throw new Error('program')
      g.attachShader(prog, compile(g, g.VERTEX_SHADER, VERTEX))
      g.attachShader(prog, compile(g, g.FRAGMENT_SHADER, FRAGMENT))
      g.linkProgram(prog)
      if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog) ?? 'link')
      g.useProgram(prog)
      const buf = g.createBuffer()
      g.bindBuffer(g.ARRAY_BUFFER, buf)
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW)
      const loc = g.getAttribLocation(prog, 'aPos')
      g.enableVertexAttribArray(loc)
      g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0)
      texture(g, 0, shape)
      texture(g, 1, heart)
      for (const u of ['uShape', 'uHeart', 'uTime', 'uDeep', 'uMid', 'uLight', 'uCore']) uniforms[u] = g.getUniformLocation(prog, u)
      g.uniform1i(uniforms.uShape, 0)
      g.uniform1i(uniforms.uHeart, 1)
      if (g.getError() !== g.NO_ERROR) throw new Error('webgl')
    }

    const resize = () => {
      // Headroom for the tier scale (up to 1.22) and the tilt: drawn at 1.5× the layout size.
      const dpr = Math.min((window.devicePixelRatio || 1) * 1.5, 3)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      g.viewport(0, 0, canvas.width, canvas.height)
    }

    const draw = (now: number) => {
      const { palette: p, speed: s } = live.current
      resize()
      g.uniform1f(uniforms.uTime, ((now - start) / 1000) / s)
      g.uniform3fv(uniforms.uDeep, hexToRgb01(p.deep))
      g.uniform3fv(uniforms.uMid, hexToRgb01(p.mid))
      g.uniform3fv(uniforms.uLight, hexToRgb01(p.light))
      g.uniform3fv(uniforms.uCore, hexToRgb01(p.core))
      g.clearColor(0, 0, 0, 0)
      g.clear(g.COLOR_BUFFER_BIT)
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
    }

    const loop = (now: number) => {
      if (disposed) return
      if (visible) draw(now)
      raf = requestAnimationFrame(loop)
    }

    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true })
      : null
    io?.observe(canvas)
    const onLost = (e: Event) => {
      e.preventDefault()
      fail()
    }
    canvas.addEventListener('webglcontextlost', onLost)

    setup()
      .then(() => {
        if (disposed) return
        if (reduced) draw(start + 1300)
        else raf = requestAnimationFrame(loop)
      })
      .catch(fail)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      io?.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      uniforms = {}
      // Give the context back now: browsers cap how many can live at once.
      g.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
}
