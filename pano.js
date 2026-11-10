/* A 360° room viewer: draws an equirectangular panorama around the viewer with WebGL, at the image's full sharpness.
   Two panoramas can be loaded at once so a walk from room to room cross-fades between them while the camera moves. */

const VERT = `attribute vec2 p; varying vec2 v; void main() { v = p; gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `precision highp float;
varying vec2 v;
uniform sampler2D a, b;
uniform float mixB, aspect, tanHalf, yawA, yawB, pitch;
uniform mat3 rot;
const float PI = 3.14159265;
vec4 sample(sampler2D t, vec3 d, float yaw0) {
  float lon = atan(d.x, -d.z) + yaw0;
  float lat = asin(clamp(d.y, -1.0, 1.0));
  return texture2D(t, vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI));
}
void main() {
  vec3 d = normalize(rot * vec3(v.x * tanHalf * aspect, v.y * tanHalf, -1.0));
  vec4 c = sample(a, d, yawA);
  if (mixB > 0.0) c = mix(c, sample(b, d, yawB), mixB);
  gl_FragColor = c;
}`;

const DEG = Math.PI / 180;

export class Pano {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = Object.fromEntries(['a', 'b', 'mixB', 'aspect', 'tanHalf', 'yawA', 'yawB', 'pitch', 'rot'].map(n => [n, gl.getUniformLocation(prog, n)]));
    gl.uniform1i(this.u.a, 0);
    gl.uniform1i(this.u.b, 1);
    this.tex = [this.texture(), this.texture()];
    this.yaw = 0; this.pitch = 0; this.fov = 75; // degrees: where you look, and how wide
    this.yawA = 0; this.yawB = 0; this.mixB = 0;
    this.cache = new Map();
    this.resize();
  }

  texture() {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([17, 24, 50]));
    return t;
  }

  // Fetch and decode a panorama once; later requests reuse it.
  load(url) {
    if (!this.cache.has(url)) {
      this.cache.set(url, new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      }));
    }
    return this.cache.get(url);
  }

  upload(slot, img) {
    const gl = this.gl;
    gl.activeTexture(slot ? gl.TEXTURE1 : gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[slot]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
  }

  // Show a panorama straight away (slot A).
  async show(url, northYaw = 0) {
    this.upload(0, await this.load(url));
    this.yawA = northYaw * DEG;
    this.mixB = 0;
    this.draw();
  }

  // Put the next room in slot B, ready to fade in over the current one.
  async stage(url, northYaw = 0) {
    this.upload(1, await this.load(url));
    this.yawB = northYaw * DEG;
  }

  // Once B has fully faded in, it becomes A.
  swap() {
    [this.tex[0], this.tex[1]] = [this.tex[1], this.tex[0]];
    this.yawA = this.yawB;
    this.mixB = 0;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex[0]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex[1]);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.draw();
  }

  // Vertical field of view in radians: `fov` is the horizontal angle on a landscape screen and the vertical one on a tall screen.
  vfov() {
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const f = this.fov * DEG;
    return aspect >= 1 ? 2 * Math.atan(Math.tan(f / 2) / aspect) : f;
  }

  draw() {
    const gl = this.gl, c = this.canvas;
    if (!c.width) return;
    gl.viewport(0, 0, c.width, c.height);
    const cy = Math.cos(this.yaw * DEG), sy = Math.sin(this.yaw * DEG), cp = Math.cos(this.pitch * DEG), sp = Math.sin(this.pitch * DEG);
    // Turn right by yaw, then tilt up by pitch (column-major for GLSL).
    gl.uniformMatrix3fv(this.u.rot, false, new Float32Array([cy, 0, sy, -sy * sp, cp, cy * sp, -sy * cp, -sp, cy * cp]));
    gl.uniform1f(this.u.aspect, c.width / c.height);
    gl.uniform1f(this.u.tanHalf, Math.tan(this.vfov() / 2));
    gl.uniform1f(this.u.yawA, this.yawA);
    gl.uniform1f(this.u.yawB, this.yawB);
    gl.uniform1f(this.u.mixB, this.mixB);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Where a direction in the room (degrees, in the panorama's own frame) lands on screen, or null when it's behind you.
  project(yawDeg, pitchDeg) {
    const yaw = yawDeg * DEG - this.yawA, p = pitchDeg * DEG;
    const d = [Math.sin(yaw) * Math.cos(p), Math.sin(p), -Math.cos(yaw) * Math.cos(p)];
    const cy = Math.cos(this.yaw * DEG), sy = Math.sin(this.yaw * DEG), cp = Math.cos(this.pitch * DEG), sp = Math.sin(this.pitch * DEG);
    // Into camera space: undo the turn, then the tilt.
    const x1 = cy * d[0] + sy * d[2], z1 = -sy * d[0] + cy * d[2];
    const y2 = cp * d[1] + sp * z1, z2 = cp * z1 - sp * d[1];
    if (z2 >= -0.05) return null;
    const t = Math.tan(this.vfov() / 2), w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { x: w / 2 + (x1 / -z2) / (t * w / h) * w / 2, y: h / 2 - (y2 / -z2) / t * h / 2 };
  }
}
