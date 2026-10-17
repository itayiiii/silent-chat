// Silent Chat — the AI voice check "🧠 בינה מלאכותית" (runs in a Web Worker: new Worker('ai-worker.js')).
// CAM++ speaker embeddings (3D-Speaker, Apache-2.0) with onnxruntime-web (MIT), WebAssembly, one thread.
// Audio arrives from an AudioWorklet at the phone's rate; the worker keeps the last 2 s, resamples to 16 kHz,
// computes Kaldi-style fbank features (as kaldi-native-fbank / sherpa-onnx do) and returns a 512-number
// voice print. The main thread compares it with the registered voice (cosine similarity).
'use strict';
var SR = 16000, WIN = 400, HOP = 160, NFFT = 512, NMEL = 80, EPS = 1.1920929e-07;

// ---------------------------------------------------------------- FFT (radix 2, 512 points)
var fftRev = new Uint16Array(NFFT), fftCos = new Float64Array(NFFT / 2), fftSin = new Float64Array(NFFT / 2);
(function () {
  var bits = Math.log2(NFFT);
  for (var i = 0; i < NFFT; i++) {
    var r = 0;
    for (var b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
    fftRev[i] = r;
  }
  for (var k = 0; k < NFFT / 2; k++) { fftCos[k] = Math.cos(2 * Math.PI * k / NFFT); fftSin[k] = -Math.sin(2 * Math.PI * k / NFFT); }
})();
function fft(re, im) {
  for (var i = 0; i < NFFT; i++) {
    var j = fftRev[i];
    if (j > i) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (var size = 2; size <= NFFT; size <<= 1) {
    var half = size >> 1, step = NFFT / size;
    for (var s = 0; s < NFFT; s += size) {
      for (var k = 0; k < half; k++) {
        var c = fftCos[k * step], sn = fftSin[k * step], a = s + k, b2 = a + half;
        var tr = re[b2] * c - im[b2] * sn, ti = re[b2] * sn + im[b2] * c;
        re[b2] = re[a] - tr; im[b2] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

// ---------------------------------------------------------------- fbank (kaldi-native-fbank defaults)
var povey = new Float64Array(WIN);
for (var pi = 0; pi < WIN; pi++) povey[pi] = Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * pi / (WIN - 1)), 0.85);
function melOf(f) { return 1127 * Math.log(1 + f / 700); }
var melBank = (function () {
  var lo = melOf(20), hi = melOf(SR / 2), d = (hi - lo) / (NMEL + 1), bank = [];
  for (var m = 0; m < NMEL; m++) {
    var l = lo + m * d, c = lo + (m + 1) * d, r = lo + (m + 2) * d, first = -1, w = [];
    for (var k = 0; k < NFFT / 2; k++) {
      var mel = melOf(k * SR / NFFT), v = 0;
      if (mel > l && mel < r) v = mel <= c ? (mel - l) / (c - l) : (r - mel) / (r - c);
      if (v > 0) { if (first < 0) first = k; w.push(v); } else if (first >= 0) break;
    }
    bank.push({ first: first, w: w });
  }
  return bank;
})();
/** 16 kHz samples (-1..1) → { data: Float32Array(frames × 80), frames }, mean over the frames removed */
function fbank(x, keepMean) {
  var frames = x.length < WIN ? 0 : 1 + Math.floor((x.length - WIN) / HOP);
  var out = new Float32Array(frames * NMEL), re = new Float64Array(NFFT), im = new Float64Array(NFFT), fr = new Float64Array(WIN);
  for (var f = 0; f < frames; f++) {
    var o = f * HOP, mean = 0, i;
    for (i = 0; i < WIN; i++) { fr[i] = x[o + i]; mean += fr[i]; }
    mean /= WIN;
    for (i = 0; i < WIN; i++) fr[i] -= mean;                 // remove DC
    for (i = WIN - 1; i > 0; i--) fr[i] -= 0.97 * fr[i - 1];  // pre-emphasis
    fr[0] -= 0.97 * fr[0];
    for (i = 0; i < NFFT; i++) { re[i] = i < WIN ? fr[i] * povey[i] : 0; im[i] = 0; }
    fft(re, im);
    for (var m = 0; m < NMEL; m++) {
      var b = melBank[m], e = 0;
      for (var j = 0; j < b.w.length; j++) { var k = b.first + j; e += b.w[j] * (re[k] * re[k] + im[k] * im[k]); }
      out[f * NMEL + m] = Math.log(Math.max(e, EPS));
    }
  }
  for (var c = 0; !keepMean && c < NMEL; c++) {             // global mean (the model's feature_normalize_type)
    var s = 0;
    for (var g = 0; g < frames; g++) s += out[g * NMEL + c];
    s /= frames || 1;
    for (var h = 0; h < frames; h++) out[h * NMEL + c] -= s;
  }
  return { data: out, frames: frames };
}

// ---------------------------------------------------------------- resample any rate → 16 kHz (windowed sinc)
function resample(x, rate) {
  if (Math.abs(rate - SR) < 1) return x;
  var ratio = rate / SR, n = Math.floor(x.length / ratio), y = new Float32Array(n);
  var fc = 0.47 * SR / rate, W = Math.ceil(10 * ratio);
  for (var i = 0; i < n; i++) {
    var t = i * ratio, c = Math.floor(t), acc = 0, norm = 0;
    for (var k = c - W + 1; k <= c + W; k++) {
      if (k < 0 || k >= x.length) continue;
      var d = t - k, a = 2 * Math.PI * fc * d;
      var h = (d === 0 ? 1 : Math.sin(a) / a) * (0.42 + 0.5 * Math.cos(Math.PI * d / W) + 0.08 * Math.cos(2 * Math.PI * d / W));
      acc += x[k] * h; norm += h;
    }
    y[i] = norm ? acc / norm : 0;
  }
  return y;
}

// ---------------------------------------------------------------- the voice print
var session = null;
// (pauses are left in: CAM++ handles them, and cutting them out made the scores worse in a test)
async function embed(samples16k) {
  var fb = fbank(samples16k);
  if (fb.frames < 30) return null;                             // under 0.3 s: too short to say
  var out = await session.run({ x: new ort.Tensor('float32', fb.data, [1, fb.frames, NMEL]) });
  var e = out[session.outputNames[0]].data, n = 0, i;
  for (i = 0; i < e.length; i++) n += e[i] * e[i];
  n = Math.sqrt(n) || 1;
  var v = new Float32Array(e.length);
  for (i = 0; i < e.length; i++) v[i] = e[i] / n;
  return v;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fbank: fbank, resample: resample, embed: embed, setSession: function (s, o) { session = s; globalThis.ort = o; } };
} else {
  // ---------------------------------------------------------------- the worker
  var rate = 48000, ring = new Float32Array(48000 * 2), ringAt = 0, ringFull = false, enrollBuf = null, enrollLen = 0;
  var readyWaiters = [];
  function whenReady() { return session ? Promise.resolve() : new Promise(function (r) { readyWaiters.push(r); }); }
  function push(chunk) {
    for (var i = 0; i < chunk.length; i++) { ring[ringAt++] = chunk[i]; if (ringAt === ring.length) { ringAt = 0; ringFull = true; } }
    if (enrollBuf && enrollLen + chunk.length <= enrollBuf.length) { enrollBuf.set(chunk, enrollLen); enrollLen += chunk.length; }
  }
  function last(seconds) {
    var n = Math.min(Math.round(seconds * rate), ringFull ? ring.length : ringAt), out = new Float32Array(n);
    for (var i = 0; i < n; i++) out[i] = ring[(ringAt - n + i + ring.length) % ring.length];
    return out;
  }
  self.onmessage = async function (e) {
    var m = e.data || {};
    try {
      if (m.type === 'init') {
        // the runtime (≈14 MB) and the model (≈30 MB) download once and stay in the phone's cache storage
        var cache = null, loaded = 0, total = 0, lastReport = 0, fresh = false;   // fresh: something came from the internet
        try { cache = await caches.open(m.cache); } catch (er) { cache = null; }
        for (var nm in m.files) total += m.files[nm];
        var report = function (force) {
          var t = Date.now();
          if (force || t - lastReport > 150) { lastReport = t; self.postMessage({ type: 'progress', loaded: loaded, total: total, fresh: fresh }); }
        };
        var getFile = async function (name) {
          var url = m.base + name, hit = null;
          if (cache) { try { hit = await cache.match(url); } catch (er) { hit = null; } }
          if (hit) { var ab = await hit.arrayBuffer(); loaded += ab.byteLength; report(true); return new Uint8Array(ab); }
          fresh = true;
          var res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + name);
          var reader = res.body.getReader(), parts = [], n = 0;
          for (;;) {
            var r = await reader.read();
            if (r.done) break;
            parts.push(r.value); n += r.value.length; loaded += r.value.length; report(false);
          }
          var out = new Uint8Array(n), o = 0;
          for (var i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
          if (cache) { try { await cache.put(url, new Response(out)); } catch (er) { /* full or blocked: next time it downloads again */ } }
          return out;
        };
        var js = await getFile('ort.wasm.min.js');
        importScripts(URL.createObjectURL(new Blob([js], { type: 'text/javascript' })));
        var mjs = await getFile('ort-wasm-simd-threaded.mjs');
        var wasm = await getFile('ort-wasm-simd-threaded.wasm');
        var model = await getFile(m.model);
        report(true);
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([mjs], { type: 'text/javascript' })) };
        ort.env.wasm.wasmBinary = wasm;
        session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
        readyWaiters.splice(0).forEach(function (r) { r(); });
        self.postMessage({ type: 'ready' });
      } else if (m.type === 'port') {
        rate = m.rate || 48000;
        ring = new Float32Array(Math.round(rate * 2)); ringAt = 0; ringFull = false;
        m.port.onmessage = function (ev) { push(ev.data); };
      } else if (m.type === 'check') {
        if (!session) { self.postMessage({ type: 'skip', id: m.id }); return; }
        var t0 = Date.now(), v = await embed(resample(last(m.seconds || 1.2), rate));
        self.postMessage(v ? { type: 'emb', id: m.id, emb: v, ms: Date.now() - t0 } : { type: 'skip', id: m.id });
      } else if (m.type === 'enroll-start') {
        enrollBuf = new Float32Array(Math.round(rate * 8)); enrollLen = 0;
      } else if (m.type === 'enroll-cancel') {
        enrollBuf = null;
      } else if (m.type === 'enroll-stop') {
        var rec = enrollBuf ? enrollBuf.subarray(0, enrollLen) : new Float32Array(0);
        enrollBuf = null;
        await whenReady();
        var em = await embed(resample(rec, rate));
        self.postMessage(em ? { type: 'enrolled', id: m.id, emb: em, seconds: rec.length / rate } : { type: 'enroll-failed', id: m.id });
      }
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
    }
  };
}
