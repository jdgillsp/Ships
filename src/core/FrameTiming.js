// One asynchronous query around the render callback separates scene work
// from browser scheduling. CPU and GPU overlap, so use the larger duration.
const MAX_PENDING = 6;
const RESULT_TIMEOUT_MS = 500;

export class FrameTiming {
  constructor(gl, extension, now = () => performance.now()) {
    this.gl = gl; this.ext = extension; this.now = now;
    this.pending = []; this.active = null; this.latest = null;
    this.generation = 0; this.tracking = false; this.cpuMs = 0;
    this.unreliable = false; this.failed = false;
  }

  reset() {
    for (const sample of this.pending) this.gl.deleteQuery(sample.query);
    this.pending.length = 0; this.latest = null; this.cpuMs = 0;
    this.generation++; this.failed = false;
    // End an in-progress query normally before deleting it. Its old generation
    // prevents resize/rebuild work from entering the controller.
  }

  collect() {
    if (!this.ext) return;
    const gl = this.gl;
    this.unreliable = gl.isContextLost() || !!gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    if (this.unreliable) { this.reset(); return; }
    while (this.pending.length) {
      const sample = this.pending[0];
      if (!gl.getQueryParameter(sample.query, gl.QUERY_RESULT_AVAILABLE)) break;
      const gpuMs = gl.getQueryParameter(sample.query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(sample.query); this.pending.shift();
      if (sample.generation === this.generation && Number.isFinite(gpuMs) && gpuMs >= 0) {
        this.latest = { gpuMs, at: sample.at }; this.failed = false;
      } else this.failed = true;
    }
  }

  begin(enabled) {
    if (!enabled) {
      if (this.tracking) this.reset();
      this.tracking = false;
      return;
    }
    this.tracking = true;
    this.collect();
    this.startedAt = this.now(); this.startedGeneration = this.generation;
    const gl = this.gl;
    if (!this.ext || this.unreliable || this.pending.length >= MAX_PENDING || this.active) return;
    // Per-pass profiling uses the same GL target and cannot be nested.
    if (gl.getQuery(this.ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return;
    const query = gl.createQuery();
    if (!query) { this.failed = true; return; }
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { query, generation: this.generation, at: this.startedAt };
  }

  end() {
    if (!this.tracking) return;
    this.cpuMs = this.startedGeneration === this.generation ? Math.max(0, this.now() - this.startedAt) : 0;
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    if (this.active.generation === this.generation) this.pending.push(this.active);
    else this.gl.deleteQuery(this.active.query);
    this.active = null;
  }

  workMs(frameMs) {
    if (!this.tracking || !this.ext || this.unreliable || this.failed) return frameMs;
    const now = this.now();
    if (this.latest)
      return now - this.latest.at <= RESULT_TIMEOUT_MS ? Math.max(.01, this.cpuMs, this.latest.gpuMs) : frameMs;
    const oldest = this.pending[0] || this.active;
    return oldest && now - oldest.at < RESULT_TIMEOUT_MS ? null : frameMs;
  }
}
