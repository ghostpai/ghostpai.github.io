// Φ scorer, after Sec. III of the paper. Reads a paired command log (cmd_* columns, t_cmd timestamps,
// chunk_start flags) and scores every chunk against a human reference (μ, Σ) from ref_*.json.
// Term order everywhere: [R, fracEbw, p99v, p99a, min_invk, seamv].
const D2R = Math.PI / 180;
export const TERMS = ['R', 'fracEbw', 'p99v', 'p99a', 'min_invk', 'seamv'];

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const rows = lines.slice(1).map(l => { const v = l.split(','); const o = {}; head.forEach((h, i) => { o[h] = +v[i]; }); return o; });
  return { head, rows };
}

export function toEpisode({ head, rows }, opts = {}) {
  // opts.trim: seconds cut from the start of the log (to align it with a clip)
  if (opts.trim > 0) { const tCut = rows[0].t_cmd + opts.trim; rows = rows.filter(r => r.t_cmd >= tCut); }
  // opts.cut: keep only the first `cut` seconds (the paired clip ends there)
  if (opts.cut > 0) { const tEnd = rows[0].t_cmd + opts.cut; rows = rows.filter(r => r.t_cmd <= tEnd); }
  // nominal control period T: median command interval of the whole log (inference pauses and doubled ticks are rare enough not to move it)
  const dtsAll = []; for (let i = 1; i < rows.length; i++) dtsAll.push(rows[i].t_cmd - rows[i - 1].t_cmd);
  dtsAll.sort((a, b) => a - b);
  const T = dtsAll.length ? dtsAll[Math.floor(dtsAll.length / 2)] : 1 / 30;
  // two commands logged less than 0.4 T apart are one tick: the loop catching up after an inference pause, not a motion.
  // Keep the first (it carries the chunk's first action and the boundary flag), drop the second.
  const notes = []; const kept = []; let doubled = 0;
  for (const r of rows) {
    const last = kept[kept.length - 1];
    if (last && r.t_cmd - last.t_cmd < 0.4 * T) { if (r.chunk_start === 1) last.chunk_start = 1; doubled++; continue; }
    kept.push({ ...r });
  }
  rows = kept;
  if (doubled) notes.push(doubled + ' doubled ticks merged');
  const joints = head.filter(h => h.startsWith('cmd_')).map(h => h.slice(4));
  const t = rows.map(r => r.t_cmd);
  const raw = rows.map(r => joints.map(j => r['cmd_' + j]));
  // rollout logs are in degrees, the replay logs in radians: decide per file
  const inRad = Math.max(...raw.map(r => Math.max(...r.map(Math.abs)))) <= 2 * Math.PI;
  const qDeg = inRad ? raw.map(r => r.map(x => x / D2R)) : raw;
  const q = inRad ? raw : raw.map(r => r.map(x => x * D2R));
  const starts = [];
  rows.forEach((r, i) => { if (r.chunk_start === 1 && (i === 0 || rows[i - 1].chunk_start !== 1)) starts.push(i); });
  if (!starts.length || starts[0] !== 0) starts.unshift(0);
  let chunks = starts.map((s, k) => ({ start: s, end: k + 1 < starts.length ? starts[k + 1] : rows.length }));
  // chunk markers a few ticks apart are one boundary (request and arrival of the same chunk on an asynchronous runner):
  // an interior segment shorter than a quarter of the typical chunk joins the chunk before it; a trailing partial chunk is not scored.
  const lens = chunks.map(c => c.end - c.start).sort((a, b) => a - b);
  const minLen = Math.max(4, Math.round(0.25 * lens[Math.floor(lens.length / 2)]));
  const merged = []; let joined = 0;
  chunks.forEach((c, k) => {
    const short = c.end - c.start < minLen, lastOne = k === chunks.length - 1;
    if (short && lastOne && merged.length) { notes.push('trailing partial chunk of ' + (c.end - c.start) + ' ticks not scored'); return; }
    if (short && merged.length) { merged[merged.length - 1].end = c.end; joined++; return; }
    merged.push({ ...c });
  });
  if (merged.length > 1 && merged[0].end - merged[0].start < minLen) { merged[1].start = merged[0].start; merged.shift(); joined++; }
  if (joined) notes.push(joined + ' short segments joined');
  chunks = merged;
  const t0 = t[0];
  return { joints, t, q, qDeg, chunks, T, t0, duration: t[t.length - 1] - t0, units: inRad ? 'rad' : 'deg', notes };
}

// first moment the commanded pose leaves its starting pose by more than `deg` on any joint
export function motionStart(ep, deg = 3) {
  const lim = deg * D2R, q0 = ep.q[0];
  for (let i = 1; i < ep.q.length; i++) if (ep.q[i].some((x, j) => Math.abs(x - q0[j]) > lim)) return ep.t[i] - ep.t0;
  return 0;
}

const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
function pct(arr, p) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}

// eq. (3): finite differences on the measured timestamps, midpoint times for the accelerations
function derivatives(ep, c) {
  const { q, t } = ep, v = [], tv = [];
  for (let i = c.start; i < c.end - 1; i++) {
    const dt = t[i + 1] - t[i];
    if (dt <= 0) continue;
    v.push(q[i + 1].map((x, j) => (x - q[i][j]) / dt));
    tv.push((t[i] + t[i + 1]) / 2);
  }
  const a = [];
  for (let i = 0; i < v.length - 1; i++) {
    const dt = tv[i + 1] - tv[i];
    if (dt <= 0) continue;
    a.push(v[i + 1].map((x, j) => (x - v[i][j]) / dt));
  }
  return { v, a };
}

function chunkTerms(ep, c, prev, ref) {
  const { v, a } = derivatives(ep, c);
  const absV = v.flat().map(Math.abs), absA = a.flat().map(Math.abs);
  const R = ep.T * mean(absA) / (mean(absV) || 1e-9);                 // III-B a
  const p99v = pct(absV, 0.99), p99a = pct(absA, 0.99);               // III-B c
  let eHi = 0, eTot = 0;                                              // III-B b: energy above f_bw,j
  const N = c.end - c.start;
  for (let j = 0; j < ep.joints.length; j++) {
    const x = []; for (let i = c.start; i < c.end; i++) x.push(ep.q[i][j]);
    const m = mean(x);
    for (let k = 1; k <= Math.floor(N / 2); k++) {
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) { const ang = 2 * Math.PI * k * i / N; re += (x[i] - m) * Math.cos(ang); im -= (x[i] - m) * Math.sin(ang); }
      const e = re * re + im * im;
      eTot += e; if (k / (N * ep.T) > ref.fbw[j]) eHi += e;
    }
  }
  const fracEbw = eTot > 0 ? eHi / eTot : 0;
  let seamv = null;                                                   // eq. (1)
  if (prev) {
    seamv = 0;
    for (let j = 0; j < ep.joints.length; j++) {
      const g = Math.abs(ep.q[c.start][j] - ep.q[prev.end - 1][j]);
      seamv = Math.max(seamv, 2 * Math.PI * ref.fbw[j] * g / ref.qpeak[j]);
    }
  }
  return { R, fracEbw, p99v, p99a, seamv };
}

function invert(M) {
  const n = M.length, A = M.map((r, i) => [...r, ...M.map((_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    const d = A[i][i]; for (let j = 0; j < 2 * n; j++) A[i][j] /= d;
    for (let r = 0; r < n; r++) if (r !== i) { const f = A[r][i]; for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[i][j]; }
  }
  return A.map(r => r.slice(n));
}

// eq. (2) plus the signed attribution (x_i − μ_i) z_i, which sums exactly to Φ²
export function scoreEpisode(ep, ref) {
  const Sinv = invert(ref.sigma), sd = ref.sigma.map((r, i) => Math.sqrt(r[i]));
  const chunks = ep.chunks.map((c, k) => {
    const tm = chunkTerms(ep, c, k ? ep.chunks[k - 1] : null, ref);
    const flags = ['min_invk: no Jacobian in the browser, reference mean substituted'];
    if (tm.seamv == null) flags.push('first chunk has no seam, reference mean substituted');
    const x = [tm.R, tm.fracEbw, tm.p99v, tm.p99a, ref.mu[4], tm.seamv == null ? ref.mu[5] : tm.seamv];
    const d = x.map((xi, i) => xi - ref.mu[i]);
    const z = Sinv.map(row => row.reduce((s, m, j) => s + m * d[j], 0));
    const shares = d.map((di, i) => di * z[i]);
    const phi = Math.sqrt(Math.max(shares.reduce((s, v) => s + v, 0), 0));
    return { index: k, start: c.start, end: c.end, tStart: ep.t[c.start] - ep.t0, tEnd: ep.t[c.end - 1] - ep.t0, x, phi, shares, std: d.map((di, i) => di / sd[i]), flags, pass: phi <= ref.dpass, measured: [true, true, true, true, false, tm.seamv != null] };
  });
  const phis = chunks.map(c => c.phi);
  return { chunks, phiMax: Math.max(...phis), phiBad: Math.cbrt(mean(phis.map(p => p ** 3))), phiMean: mean(phis) };
}
