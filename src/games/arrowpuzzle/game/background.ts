import { Theme, hexToRgb } from "./theme";

const VERT = `attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

// Port of Resources/Shaders/Background.shader: gradient, glowing grid with a sweeping scan band,
// twinkling stars, CRT scanlines and a vignette.
const FRAG = `
#extension GL_OES_standard_derivatives : enable
precision mediump float;
varying vec2 uv;
uniform vec3 uTop, uBottom, uGrid, uAccent;
uniform float uGridA, uAspect, uScale, uTime, uPulse, uPixel;
uniform vec2 uOffset;

float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main(){
  vec3 col = mix(uBottom, uTop, smoothstep(0.0, 1.0, uv.y));
  vec2 c = (uv - 0.5) * vec2(uAspect, 1.0);
  float r = length(c);
  col += uAccent * (0.06 + 0.04 * uPulse) * exp(-r * r * 7.0);

  vec2 g = vec2(uv.x * uAspect, uv.y) * uScale + uOffset;
  vec2 gd = abs(fract(g) - 0.5);
  float lineDist = min(0.5 - gd.x, 0.5 - gd.y);
  vec2 fw = fwidth(g);
  float gridLine = 1.0 - smoothstep(0.0, 1.5 * max(fw.x, fw.y), lineDist);
  float node = 1.0 - smoothstep(0.0, 3.0 * max(fw.x, fw.y), length(0.5 - gd));

  float bd = (uv.y - fract(uTime * 0.07)) * 9.0;
  float band = exp(-bd * bd);
  float fade = 1.0 - smoothstep(0.25, 0.85, r);
  col += uGrid * uGridA * (gridLine * (0.7 + 2.5 * band) + node * 1.5) * fade;

  vec2 sp = vec2(uv.x * uAspect, uv.y) * 70.0 + uOffset * 0.3;
  float h = hash21(floor(sp));
  float star = step(0.975, h) * (0.5 + 0.5 * sin(uTime * (1.5 + h * 3.0) + h * 60.0));
  star *= smoothstep(0.18, 0.0, length(fract(sp) - 0.5));
  col += star * 0.35 * mix(uGrid, uAccent, fract(h * 13.0));

  col *= 0.95 + 0.05 * sin(gl_FragCoord.y / uPixel * 3.14159);
  col *= 1.0 - smoothstep(0.35, 1.0, r) * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Full-screen animated backdrop on its own canvas behind the Phaser board. Falls back to a CSS gradient. */
export class Background {
  private gl: WebGLRenderingContext | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private pulse = 0;
  private offset: [number, number] = [0, 0];
  private theme: Theme | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl || !gl.getExtension("OES_standard_derivatives")) return;
    const prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(sh)); return; }
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["uTop", "uBottom", "uGrid", "uAccent", "uGridA", "uAspect", "uScale", "uTime", "uPulse", "uPixel", "uOffset"])
      this.u[n] = gl.getUniformLocation(prog, n);
    this.gl = gl;
  }

  applyTheme(theme: Theme) {
    this.theme = theme;
    this.canvas.style.background = `linear-gradient(${theme.bgTop}, ${theme.bgBottom})`;
    const gl = this.gl;
    if (!gl) return;
    gl.uniform3fv(this.u.uTop, hexToRgb(theme.bgTop));
    gl.uniform3fv(this.u.uBottom, hexToRgb(theme.bgBottom));
    gl.uniform3fv(this.u.uGrid, theme.grid.slice(0, 3));
    gl.uniform1f(this.u.uGridA, theme.grid[3]);
    gl.uniform3fv(this.u.uAccent, hexToRgb(theme.accent2));
  }

  doPulse() { this.pulse = 1; }

  /** Camera position in board cells, for a little parallax. */
  setOffset(x: number, y: number) { this.offset = [x * 0.15, y * 0.15]; }

  render(timeSeconds: number, dt: number) {
    const gl = this.gl;
    if (!gl || !this.theme) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    this.pulse = Math.max(0, this.pulse - dt * 1.2);
    gl.uniform1f(this.u.uAspect, w / h);
    gl.uniform1f(this.u.uScale, 12);
    gl.uniform1f(this.u.uTime, timeSeconds);
    gl.uniform1f(this.u.uPulse, this.pulse);
    gl.uniform1f(this.u.uPixel, dpr);
    gl.uniform2fv(this.u.uOffset, this.offset);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
