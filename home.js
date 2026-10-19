/*
 * DEXO PHONK PLAYER — home.js
 * ==========================================================
 * YANGI IMKONIYATLAR:
 *  • Zarba (bas) aniqlash — effektlar musiqa ritmiga mos ishlaydi:
 *    silkinish, chaqnash, glitch, zarba toʻlqini, zarralar, lazer nurlari
 *  • 4 xil vizualizer (Doira / Toʻlqin / Nuqta / Yulduz) + Avto rejim
 *  • 6 ta rang mavzusi (Kamalak — musiqa bilan oʻzgaradi)
 *  • Ovoz effektlari: Bas, Yuqori, Reverb, Distorsiya, Tezlik, 8D
 *    + tayyor sozlamalar (Bass Boost, Phonk Drive, Slowed+Reverb, Nightcore, 8D)
 *  • Pleylist: bir nechta musiqa, aralashtirish, takrorlash, drag & drop
 *  • Klaviatura tugmalari va telefon qulf ekranidagi boshqaruv
 *
 * ESKI TUZATISHLAR SAQLANDI:
 *  1) createMediaElementSource() — BIR MARTA yaratiladi
 *  2) src oʻzgartir → load → play tartibi
 *  3) crossOrigin ishlatilmaydi (local fayl)
 *  4) Video Blob → <a download> orqali saqlanadi
 * ==========================================================
 */

// ── SOZLAMALAR (localStorage da saqlanadi) ───────────────────
const STORE_KEY = 'dexo_phonk_player_v2';
const DEFAULTS = {
  theme: 'neon',
  mode: 'circle',          // circle | wave | dots | star | auto
  intensity: 1,
  fx: { shake: true, flash: true, glitch: true, wave: true, particles: true, laser: true },
  sound: { bass: 0, treble: 0, reverb: 0, drive: 0, speed: 1, d8: false },
  volume: 0.8,
  shuffle: false,
  repeat: 'off',           // off | all | one
};

function loadCfg() {
  const cfg = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(cfg)) {
        if (saved[k] === undefined) continue;
        if (typeof cfg[k] === 'object') Object.assign(cfg[k], saved[k]);
        else cfg[k] = saved[k];
      }
    }
  } catch (e) { /* localStorage ishlamasa — oddiy davom etamiz */ }
  return cfg;
}
const CFG = loadCfg();
function saveCfg() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(CFG)); } catch (e) {}
}

// ── GLOBAL STATE ─────────────────────────────────────────────
const S = {
  // Pleylist
  tracks: [],            // { name, title, artist, url }
  index: -1,
  history: [],
  trackName: '',
  trackUrl: '',
  isPlaying: false,
  muted: false,

  // AudioContext — faqat bitta, qayta yaratilmaydi
  audioCtx: null,
  analyser: null,
  gainNode: null,
  sourceNode: null,      // MediaElementSource — BITTA marta
  audioDestNode: null,   // recording uchun
  bassF: null, trebleF: null, shaper: null,
  dryGain: null, wetGain: null, convolver: null,
  panner: null, limiter: null, revOn: false,

  // Musiqa tahlili
  bass: 0, mid: 0, high: 0, energy: 0,
  bassAvg: 0, prevBass: 0, lastBeat: 0,
  beat: 0, flash: 0, shake: 0, laserBoost: 0,
  shx: 0, shy: 0,
  glitchUntil: 0, glitchOn: false, shaking: false,
  discAngle: 0, vizT: 0, laserAngle: 0,
  vizCur: 'circle', autoCount: 0,
  waveGain: 1, waveFlat: false,

  // Mavzu
  rainbow: false, hue: 280, lastThemeCss: 0,

  // Recording
  isRecording: false,
  mediaRecorder: null,
  chunks: [],
  recStart: 0,
  recTimerId: null,
  recCanvas: null,
  recCtx: null,
  recRafId: null,
};

// ── DOM ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const audio         = $('audio');
const playBtn       = $('playBtn');
const prevBtn       = $('prevBtn');
const nextBtn       = $('nextBtn');
const shuffleBtn    = $('shuffleBtn');
const repeatBtn     = $('repeatBtn');
const fileInput     = $('fileInput');
const progressBar   = $('progressBar');
const progressFill  = $('progressFill');
const progressThumb = $('progressThumb');
const curTimeEl     = $('currentTime');
const durEl         = $('duration');
const titleEl       = $('songTitle');
const artistEl      = $('songArtist');
const volSlider     = $('volumeSlider');
const volBtn        = $('volBtn');
const recordBtn     = $('recordBtn');
const saveVideoBtn  = $('saveVideoBtn');
const recIndicator  = $('recIndicator');
const recTimeEl     = $('recTime');
const toastEl       = $('toast');
const disc          = $('disc');
const discRing      = $('discRing');
const vizWrap       = $('vizWrap');
const vizCanvas     = $('vizCanvas');
const bgCanvas      = $('bgCanvas');
const loadedInfo    = $('loadedInfo');
const appTitle      = $('appTitle');
const phonkLabel    = $('phonkLabel');
const mBass         = $('mBass');
const mMid          = $('mMid');
const mHigh         = $('mHigh');
const playlistEl    = $('playlist');
const emptyListEl   = $('emptyList');
const listCountEl   = $('listCount');
const themeNameEl   = $('themeName');

const vizCtx = vizCanvas.getContext('2d');
const bgCtx  = bgCanvas.getContext('2d');

// Zarbada yonadigan disk nuri (faqat opacity oʻzgaradi — juda yengil)
const discGlow = document.createElement('div');
discGlow.className = 'disc-glow';
discRing.appendChild(discGlow);

// ── RANG MAVZULARI ───────────────────────────────────────────
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const css   = a => `rgb(${a[0]},${a[1]},${a[2]})`;
const rgba  = (a, al) => `rgba(${a[0]},${a[1]},${a[2]},${al})`;
const mixc  = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const f = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map(v => Math.round(v * 255));
}

const THEMES = {
  neon:   { name: 'Binafsha',        p: '#8b00ff', l: '#bf00ff', d: '#3a006b', s: '#00fff7', a: '#ff00aa', bg: '#06000f' },
  cyber:  { name: 'Moviy',           p: '#00a2ff', l: '#4dc3ff', d: '#00406b', s: '#00ffb3', a: '#7a5cff', bg: '#00060f' },
  blood:  { name: 'Qizil',           p: '#ff1744', l: '#ff5c7a', d: '#6b0018', s: '#ffb300', a: '#ff00aa', bg: '#0f0003' },
  toxic:  { name: 'Yashil',          p: '#00e676', l: '#5cff9d', d: '#006b30', s: '#e6ff00', a: '#00fff7', bg: '#000f05' },
  sunset: { name: 'Quyosh botishi',  p: '#ff6a00', l: '#ff9a3d', d: '#6b2a00', s: '#ff00aa', a: '#ffd000', bg: '#0f0600' },
  rainbow:{ name: 'Kamalak' },
};

// Joriy mavzu (massivlar [r,g,b]) — canvas va recording shu yerdan oladi
const T = { p: [139,0,255], l: [191,0,255], d: [58,0,107], s: [0,255,247], a: [255,0,170], bg: [6,0,15], m: [18,0,42] };

function setT(o) {
  T.p = o.p; T.l = o.l; T.d = o.d; T.s = o.s; T.a = o.a; T.bg = o.bg;
  T.m = mixc(T.d, T.bg, 0.65);
}
function pushThemeCss() {
  const st = document.documentElement.style;
  st.setProperty('--purple', css(T.p));
  st.setProperty('--purple-light', css(T.l));
  st.setProperty('--purple-dark', css(T.d));
  st.setProperty('--cyan', css(T.s));
  st.setProperty('--pink', css(T.a));
  st.setProperty('--bg', css(T.bg));
  st.setProperty('--mid', css(T.m));
  st.setProperty('--p-rgb', T.p.join(', '));
}
function buildRainbow() {
  const h = S.hue;
  setT({
    p: hsl2rgb(h, 1, 0.5), l: hsl2rgb(h, 1, 0.66), d: hsl2rgb(h, 1, 0.2),
    s: hsl2rgb(h + 160, 1, 0.55), a: hsl2rgb(h + 300, 1, 0.55), bg: hsl2rgb(h, 0.9, 0.035),
  });
}
function applyTheme(key) {
  if (!THEMES[key]) key = 'neon';
  CFG.theme = key;
  if (key === 'rainbow') {
    S.rainbow = true;
    buildRainbow();
  } else {
    S.rainbow = false;
    const t = THEMES[key];
    setT({ p: hex2rgb(t.p), l: hex2rgb(t.l), d: hex2rgb(t.d), s: hex2rgb(t.s), a: hex2rgb(t.a), bg: hex2rgb(t.bg) });
  }
  pushThemeCss();
  themeNameEl.textContent = THEMES[key].name;
  document.querySelectorAll('#themeChips .swatch').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === key));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', css(T.bg));
  saveCfg();
}

// ── CANVAS RESIZE ─────────────────────────────────────────────
// Fon effektlari yarim aniqlikda chiziladi — 4 barobar tezroq (bas paytida qotmaydi)
const BG_SCALE = 0.5;
let vizCX = 0, vizCY = 0;
// Vizualizer markazi har kadrda emas, faqat kerak boʻlganda oʻqiladi
function updateVizCenter() {
  const r = vizWrap.getBoundingClientRect();
  vizCX = r.left + r.width / 2 - S.shx;
  vizCY = r.top + r.height / 2 - S.shy;
}

// Kamida 2x — video yozishda vizualizer xira boʻlmasligi uchun
const DPR = Math.max(2, Math.min(window.devicePixelRatio || 1, 3));
let VS = 300; // vizualizer oʻlchami (CSS px)

function resizeAll() {
  VS = vizWrap.offsetWidth || 300;
  vizCanvas.width = vizCanvas.height = Math.round(VS * DPR);
  vizCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bgCanvas.width  = Math.round(window.innerWidth  * BG_SCALE);
  bgCanvas.height = Math.round(window.innerHeight * BG_SCALE);
  bgCtx.setTransform(BG_SCALE, 0, 0, BG_SCALE, 0, 0);
  updateVizCenter();
}
window.addEventListener('resize', resizeAll);
window.addEventListener('scroll', updateVizCenter, { passive: true });
window.addEventListener('load', updateVizCenter);
setInterval(updateVizCenter, 600);
resizeAll();

// ── MUSIQA TAHLILI (chastotalar, bas, zarba) ─────────────────
const NB = 64;                       // chastota guruhlari soni
const bands = new Float32Array(NB);  // silliqlangan 0..1
let freq = null, wave = null, edges = null;
let binBass = [2, 12], binMid = [13, 140], binHigh = [141, 700];

function initAnalyserData() {
  freq = new Uint8Array(S.analyser.frequencyBinCount);
  wave = new Uint8Array(S.analyser.fftSize);
  wave.fill(128);
  const binHz = (S.audioCtx.sampleRate / 2) / S.analyser.frequencyBinCount;
  const lo = Math.max(1.5, 40 / binHz);
  const hi = Math.min(16000 / binHz, freq.length - 3);
  edges = new Float32Array(NB + 1);
  for (let i = 0; i <= NB; i++) edges[i] = lo * Math.pow(hi / lo, i / NB);
  const b = hz => Math.max(1, Math.min(freq.length - 2, Math.round(hz / binHz)));
  binBass = [b(40),   b(250)];
  binMid  = [b(260),  b(3000)];
  binHigh = [b(3100), b(14000)];
}

function rangeAvg(a, b) {
  let s = 0, n = 0;
  for (let i = a; i <= b; i++) { s += freq[i]; n++; }
  return n ? s / n / 255 : 0;
}

function analyse(dt, now) {
  let bassRaw = 0, midRaw = 0, highRaw = 0;
  const live = S.analyser && S.isPlaying && freq;

  if (live) {
    S.analyser.getByteFrequencyData(freq);
    S.analyser.getByteTimeDomainData(wave);
    S.waveFlat = false;
    bassRaw = rangeAvg(binBass[0], binBass[1]);
    midRaw  = rangeAvg(binMid[0],  binMid[1]);
    highRaw = rangeAvg(binHigh[0], binHigh[1]);

    // Toʻlqin amplitudasini avto-sozlash (sokin musiqada ham koʻrinsin)
    let peak = 0;
    for (let i = 0; i < wave.length; i += 4) {
      const d = Math.abs(wave[i] - 128) / 128;
      if (d > peak) peak = d;
    }
    const target = Math.max(1, Math.min(3, 0.55 / Math.max(0.08, peak)));
    S.waveGain += (target - S.waveGain) * Math.min(1, dt * 3);
  } else if (!S.waveFlat && wave) {
    wave.fill(128);
    S.waveFlat = true;
  }

  // Chastota guruhlari
  for (let i = 0; i < NB; i++) {
    let v = 0;
    if (live) {
      const a = edges[i], b = edges[i + 1];
      const ia = Math.floor(a), ib = Math.max(ia + 1, Math.floor(b));
      if (ib - ia >= 2) {
        let s = 0;
        for (let k = ia; k < ib; k++) s += freq[k];
        v = s / (ib - ia);
      } else {
        const c = (a + b) / 2, f = Math.floor(c), fr = c - f;
        v = freq[f] * (1 - fr) + freq[f + 1] * fr;
      }
      v = (v / 255) * (0.75 + 0.7 * i / NB);
      v = Math.pow(Math.min(1, v), 1.5);
    }
    const rate = v > bands[i] ? 40 : 8;
    bands[i] += (v - bands[i]) * Math.min(1, dt * rate);
  }

  // Bas / oʻrta / yuqori (silliq)
  const sm = (cur, v) => cur + (v - cur) * Math.min(1, dt * (v > cur ? 30 : 7));
  S.bass = sm(S.bass, bassRaw);
  S.mid  = sm(S.mid,  midRaw);
  S.high = sm(S.high, highRaw);
  S.energy = S.bass * 0.6 + S.mid * 0.3 + S.high * 0.1;

  // Zarba (beat) aniqlash
  if (live) {
    S.bassAvg = S.bassAvg * 0.95 + bassRaw * 0.05;
    const thr = Math.max(0.38, S.bassAvg * 1.18);
    if (bassRaw > thr && bassRaw > S.prevBass + 0.015 && now - S.lastBeat > 170) {
      S.lastBeat = now;
      const str = Math.max(0.5, Math.min(1, 0.5 + (bassRaw - S.bassAvg) * 3.2));
      onBeat(str, now);
    }
    S.prevBass = bassRaw;
  } else {
    S.bassAvg *= 0.98;
    S.prevBass = 0;
  }
}

// ── EFFEKTLAR HOLATI ─────────────────────────────────────────
const rings  = [];   // zarba toʻlqinlari
const bursts = [];   // zarba zarralari
const ambient = Array.from({ length: 70 }, () => ({
  x: Math.random(), y: Math.random(),
  r: Math.random() * 1.8 + 0.5,
  vx: (Math.random() - 0.5) * 0.03,
  vy: (Math.random() - 0.5) * 0.03,
  a: Math.random() * 0.5 + 0.15,
  ph: Math.random() * 6.28,
}));

function onBeat(str, now) {
  const f = CFG.fx, I = CFG.intensity;
  S.beat = Math.max(S.beat, str);
  S.laserBoost = 1;

  if (f.wave) rings.push({ r: 0, a: 0.55 + 0.4 * str });
  if (rings.length > 8) rings.shift();

  if (f.particles) {
    const n = Math.round((7 + 11 * str) * I);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (0.35 + Math.random() * 0.9) * (0.7 + str * 0.6);
      const life = 0.7 + Math.random() * 0.7;
      bursts.push({
        x: Math.cos(ang) * 0.31, y: Math.sin(ang) * 0.31,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        t: 0, life, size: 1.2 + Math.random() * 2.6, c: Math.random() < 0.5 ? 0 : 1,
      });
    }
    if (bursts.length > 150) bursts.splice(0, bursts.length - 150);
  }

  if (f.flash) S.flash = Math.max(S.flash, str * I);
  if (f.shake) S.shake = Math.max(S.shake, str * I);
  if (f.glitch && str > 0.65) S.glitchUntil = now + 220;
  if (S.rainbow) S.hue = (S.hue + 22) % 360;
}

function stepFx(dt, now) {
  const I = CFG.intensity;
  S.beat       *= Math.exp(-dt * 6);
  S.flash      *= Math.exp(-dt * 8);
  S.shake      *= Math.exp(-dt * 10);
  S.laserBoost *= Math.exp(-dt * 3);
  S.vizT += dt;

  if (S.isPlaying) {
    S.discAngle += dt * (0.9 + S.energy * 3.5 + S.beat * 2.5) * CFG.sound.speed;
  }
  S.laserAngle += dt * (0.2 + 1.4 * S.laserBoost + S.high * 1.5);

  for (let i = rings.length - 1; i >= 0; i--) {
    rings[i].r += dt * 0.9;
    if (rings[i].r > 1.6) rings.splice(i, 1);
  }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const p = bursts[i];
    p.t += dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.985; p.vy *= 0.985;
    if (p.t >= p.life) bursts.splice(i, 1);
  }
  const sp = 1 + S.energy * 5 + S.beat * 4;
  for (const p of ambient) {
    p.x = (p.x + p.vx * dt * sp + 1) % 1;
    p.y = (p.y + p.vy * dt * sp + 1) % 1;
  }

  // Kamalak mavzusi
  if (S.rainbow) {
    S.hue = (S.hue + dt * (14 + S.energy * 50)) % 360;
    buildRainbow();
    if (now - S.lastThemeCss > 220) {
      S.lastThemeCss = now;
      pushThemeCss();
    }
  }
}

// ── EFFEKTLARNI CHIZISH (ekran va video uchun umumiy) ────────
// cx, cy — vizualizer markazi, u — vizualizer oʻlchami (px)
function drawFx(ctx, W, H, cx, cy, u) {
  const f = CFG.fx, I = CFG.intensity;
  const k = u / 320;

  // 1. Fon yorugʻligi
  const g = ctx.createRadialGradient(cx, cy, u * 0.1, cx, cy, Math.max(W, H) * 0.75);
  g.addColorStop(0, rgba(T.p, 0.16 + S.bass * 0.22 + S.beat * 0.1));
  g.addColorStop(1, rgba(T.bg, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 2. Lazer nurlari
  if (f.laser) {
    const a = Math.min(0.5, 0.05 + (S.high * 0.9 + S.laserBoost * 0.5 + S.bass * 0.2) * 0.22 * I);
    const len = Math.hypot(W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lg = ctx.createRadialGradient(cx, cy, u * 0.3, cx, cy, len * 0.7);
    lg.addColorStop(0, rgba(T.s, a));
    lg.addColorStop(1, rgba(T.s, 0));
    ctx.fillStyle = lg;
    const N = 7, wd = 0.045 + S.beat * 0.03;
    for (let i = 0; i < N; i++) {
      const ang = S.laserAngle + i * Math.PI * 2 / N;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang - wd) * len, cy + Math.sin(ang - wd) * len);
      ctx.lineTo(cx + Math.cos(ang + wd) * len, cy + Math.sin(ang + wd) * len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 3. Fon zarralari
  ctx.fillStyle = css(T.l);
  const tw = S.vizT * 2;
  for (const p of ambient) {
    ctx.globalAlpha = Math.min(1, p.a * (0.6 + S.energy * 0.9 + Math.sin(tw + p.ph) * 0.2));
    ctx.beginPath();
    ctx.arc(p.x * W, p.y * H, (p.r + S.beat * 1.2) * Math.max(0.8, k), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 4. Zarba toʻlqinlari
  if (f.wave) {
    for (const r of rings) {
      const life = 1 - r.r / 1.6;
      if (life <= 0) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, (0.3 + r.r) * u, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(T.l, r.a * life * Math.min(1.2, I));
      ctx.lineWidth = (0.5 + 3.5 * life) * Math.max(0.8, k);
      ctx.stroke();
    }
  }

  // 5. Zarba zarralari
  if (f.particles) {
    for (const p of bursts) {
      const life = 1 - p.t / p.life;
      ctx.fillStyle = rgba(p.c ? T.s : T.l, Math.min(1, life * 1.1));
      ctx.beginPath();
      ctx.arc(cx + p.x * u, cy + p.y * u, p.size * k * (0.5 + life * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 6. Chaqnash
  if (f.flash && S.flash > 0.01) {
    ctx.fillStyle = rgba(T.l, Math.min(0.5, S.flash * 0.35 * I));
    ctx.fillRect(0, 0, W, H);
  }
}

function drawBg() {
  const W = window.innerWidth, H = window.innerHeight;
  bgCtx.clearRect(0, 0, W, H);
  drawFx(bgCtx, W, H, vizCX + S.shx, vizCY + S.shy, VS);
}

// ── VIZUALIZER ────────────────────────────────────────────────
const MODES = ['circle', 'wave', 'dots', 'star'];
const MODE_NAMES = { circle: 'Doira', wave: 'Toʻlqin', dots: 'Nuqta', star: 'Yulduz', auto: 'Avto' };

// k-chi nuqta uchun chastota guruhi (chap-oʻng simmetriya, bas pastda)
const mirrorIdx = (k, N) => (k < N / 2 ? k : N - 1 - k);

// Qatlamli nur — shadowBlur dan bir necha barobar tez
function strokeGlow(ctx, col, lw, a) {
  ctx.strokeStyle = rgba(col, a * 0.14); ctx.lineWidth = lw + 10; ctx.stroke();
  ctx.strokeStyle = rgba(col, a * 0.30); ctx.lineWidth = lw + 4;  ctx.stroke();
  ctx.strokeStyle = rgba(col, a);        ctx.lineWidth = lw;      ctx.stroke();
}

function drawViz() {
  const W = VS, cx = W / 2, cy = W / 2;
  const R = W * 0.315, maxLen = W / 2 - R - 5;
  vizCtx.clearRect(0, 0, W, W);
  vizCtx.lineCap = 'round';
  vizCtx.lineJoin = 'round';

  switch (S.vizCur) {
    case 'wave': drawWave(cx, cy, R, maxLen); break;
    case 'dots': drawDots(cx, cy, R, maxLen); break;
    case 'star': drawStar(cx, cy, R, maxLen); break;
    default:     drawBars(cx, cy, R, maxLen);
  }

  // Asosiy halqa (hamma rejimda)
  vizCtx.beginPath();
  vizCtx.arc(cx, cy, R, 0, Math.PI * 2);
  strokeGlow(vizCtx, mixc(T.p, T.l, S.bass), 2 + S.bass * 4, 0.5 + S.bass * 0.5);
}

function drawBars(cx, cy, R, maxLen) {
  const N = 128;
  vizCtx.lineWidth = Math.max(2, (2 * Math.PI * R / N) * 0.55);
  for (let k = 0; k < N; k++) {
    const bi = mirrorIdx(k, N);
    const v = bands[bi];
    const ang = Math.PI / 2 + (k / N) * Math.PI * 2;
    const len = 2 + v * maxLen;
    const x1 = cx + Math.cos(ang) * (R + 2), y1 = cy + Math.sin(ang) * (R + 2);
    const x2 = cx + Math.cos(ang) * (R + 2 + len), y2 = cy + Math.sin(ang) * (R + 2 + len);
    vizCtx.beginPath();
    vizCtx.moveTo(x1, y1); vizCtx.lineTo(x2, y2);
    const bc = mixc(T.p, T.s, bi / NB);
    const lw = vizCtx.lineWidth;
    vizCtx.strokeStyle = rgba(bc, 0.12 + v * 0.1);
    vizCtx.lineWidth = lw * 2.4; vizCtx.stroke();
    vizCtx.strokeStyle = rgba(bc, 0.45 + v * 0.55);
    vizCtx.lineWidth = lw; vizCtx.stroke();
  }
}

function drawWave(cx, cy, R, maxLen) {
  const N = 180, amp = maxLen * 1.1 * Math.min(2.2, S.waveGain);
  const half = N / 2;
  const radiusAt = (k, mul) => {
    const m = mirrorIdx(k % N, N);
    const s = wave ? wave[Math.floor((m / half) * (wave.length / 2 - 1))] : 128;
    return R + 4 + ((s - 128) / 128) * amp * mul;
  };
  const path = (mul, rot) => {
    vizCtx.beginPath();
    for (let k = 0; k <= N; k++) {
      const ang = Math.PI / 2 + (k / N) * Math.PI * 2 + rot;
      const rad = radiusAt(k, mul);
      const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
      if (k === 0) vizCtx.moveTo(x, y); else vizCtx.lineTo(x, y);
    }
    vizCtx.closePath();
  };

  path(-0.7, 0);
  vizCtx.strokeStyle = rgba(T.s, 0.85);
  vizCtx.lineWidth = 1.5;
  vizCtx.stroke();

  path(1, 0);
  strokeGlow(vizCtx, T.l, 3, 1);
}

function drawDots(cx, cy, R, maxLen) {
  const rings3 = [
    { n: 44, col: T.l, off: 0 },
    { n: 52, col: T.s, off: 14 },
    { n: 60, col: T.a, off: 28 },
  ];
  rings3.forEach((rg, ri) => {
    const base = R + 6 + ri * maxLen * 0.32;
    const dir = ri % 2 ? -1 : 1;
    const rot = S.vizT * 0.22 * dir * (ri + 1) * 0.6;
    for (let k = 0; k < rg.n; k++) {
      const m = mirrorIdx(k, rg.n);
      const bi = Math.min(NB - 1, Math.floor(m / (rg.n / 2) * NB * 0.7) + rg.off);
      const v = bands[Math.min(NB - 1, bi)];
      const ang = rot + (k / rg.n) * Math.PI * 2;
      const rr = base + v * maxLen * 0.4;
      vizCtx.beginPath();
      vizCtx.arc(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, 1.3 + v * 3.6 + ri * 0.2, 0, Math.PI * 2);
      vizCtx.fillStyle = rgba(rg.col, 0.45 + v * 0.55);
      vizCtx.fill();
    }
  });
}

function drawStar(cx, cy, R, maxLen) {
  const N = 128;
  const path = (mul) => {
    vizCtx.beginPath();
    for (let k = 0; k <= N; k++) {
      const kk = k % N;
      const v = bands[mirrorIdx(kk, N)];
      const ang = Math.PI / 2 + (kk / N) * Math.PI * 2;
      const rad = R + 3 + v * maxLen * mul;
      const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
      if (k === 0) vizCtx.moveTo(x, y); else vizCtx.lineTo(x, y);
    }
    vizCtx.closePath();
  };

  path(1);
  const fg = vizCtx.createRadialGradient(cx, cy, R, cx, cy, R + maxLen);
  fg.addColorStop(0, rgba(T.p, 0.05));
  fg.addColorStop(1, rgba(T.l, 0.3));
  vizCtx.fillStyle = fg;
  vizCtx.fill();
  strokeGlow(vizCtx, T.l, 2, 1);

  path(0.45);
  vizCtx.strokeStyle = rgba(T.s, 0.9);
  vizCtx.lineWidth = 1.2;
  vizCtx.stroke();
}

function setMode(m) {
  if (m !== 'auto' && !MODES.includes(m)) m = 'circle';
  CFG.mode = m;
  S.autoCount = 0;
  if (m !== 'auto') S.vizCur = m;
  else if (!MODES.includes(S.vizCur)) S.vizCur = 'circle';
  document.querySelectorAll('#modeChips .chip').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === m));
  saveCfg();
}

// Avto rejim: har 14 soniyada keyingi vizualizer
setInterval(() => {
  if (CFG.mode !== 'auto' || !S.isPlaying) return;
  if (++S.autoCount >= 14) {
    S.autoCount = 0;
    S.vizCur = MODES[(MODES.indexOf(S.vizCur) + 1) % MODES.length];
  }
}, 1000);

// ── DOM YANGILASH (har kadrda) ───────────────────────────────
let _lastPct = -1, _lastSec = -1;

function updateDom(now, dt) {
  const I = CFG.intensity;

  // Disk: zarbada kattalashadi + aylanadi
  discRing.style.transform = `scale(${(1 + S.beat * 0.07 * Math.min(1.3, I)).toFixed(4)})`;
  disc.style.transform = `rotate(${S.discAngle.toFixed(3)}rad)`;
  discGlow.style.opacity = Math.min(1, S.beat).toFixed(3);

  // Silkinish
  if (CFG.fx.shake && S.shake > 0.03) {
    S.shx = (Math.random() - 0.5) * 14 * S.shake;
    S.shy = (Math.random() - 0.5) * 14 * S.shake;
    vizWrap.style.transform = `translate(${S.shx.toFixed(1)}px, ${S.shy.toFixed(1)}px)`;
    S.shaking = true;
  } else if (S.shaking) {
    S.shx = S.shy = 0;
    vizWrap.style.transform = '';
    S.shaking = false;
  }

  // Glitch
  const gl = CFG.fx.glitch && now < S.glitchUntil;
  if (gl !== S.glitchOn) {
    S.glitchOn = gl;
    [titleEl, phonkLabel, appTitle].forEach(el => el.classList.toggle('glitch', gl));
  }

  // Oʻlchagichlar
  mBass.style.transform = `scaleX(${Math.min(1, S.bass * 1.15).toFixed(3)})`;
  mMid.style.transform  = `scaleX(${Math.min(1, S.mid * 1.5).toFixed(3)})`;
  mHigh.style.transform = `scaleX(${Math.min(1, S.high * 2.4).toFixed(3)})`;

  // 8D ovoz
  if (S.panner && S.audioCtx) {
    const target = CFG.sound.d8 && S.isPlaying
      ? Math.sin(now / 1000 * Math.PI * 2 / 8) * 0.95 : 0;
    S.panner.pan.value = target;
  }

  // Progress (silliq)
  const pct = audio.duration && isFinite(audio.duration) ? audio.currentTime / audio.duration * 100 : 0;
  if (Math.abs(pct - _lastPct) > 0.02) {
    _lastPct = pct;
    progressFill.style.width = pct + '%';
    progressThumb.style.left = pct + '%';
  }
  const sec = Math.floor(audio.currentTime || 0);
  if (sec !== _lastSec) {
    _lastSec = sec;
    curTimeEl.textContent = fmt(audio.currentTime);
  }
}

// ── MAIN ANIMATION LOOP ───────────────────────────────────────
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;
  analyse(dt, now);
  stepFx(dt, now);
  updateDom(now, dt);
  drawBg();
  drawViz();
}
requestAnimationFrame(loop);

// ── OVOZ EFFEKTLARI ──────────────────────────────────────────
function makeImpulse(ctx, sec = 2.6, decay = 2.8) {
  const n = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return buf;
}

function makeDriveCurve(a) {
  const n = 2048, c = new Float32Array(n), g = 1 + a * 8;
  const comp = 1 / Math.pow(g, 0.45);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(g * x) * comp;
  }
  return c;
}

function setPitchLock(on) {
  audio.preservesPitch = on;
  audio.mozPreservesPitch = on;
  audio.webkitPreservesPitch = on;
}

function applyFx() {
  const s = CFG.sound;
  // Tezlik (Slowed / Nightcore): ohang ham oʻzgaradi
  setPitchLock(false);
  audio.defaultPlaybackRate = s.speed;
  audio.playbackRate = s.speed;

  if (!S.audioCtx) return;
  const t = S.audioCtx.currentTime;
  S.bassF.gain.setTargetAtTime(s.bass, t, 0.05);
  S.trebleF.gain.setTargetAtTime(s.treble, t, 0.05);
  const w = s.reverb / 100;
  if (w > 0 && !S.revOn) { S.shaper.connect(S.convolver); S.revOn = true; }
  else if (w === 0 && S.revOn) { S.shaper.disconnect(S.convolver); S.revOn = false; }
  S.shaper.oversample = s.drive > 0 ? '2x' : 'none';
  S.wetGain.gain.setTargetAtTime(w * 1.2, t, 0.08);
  S.dryGain.gain.setTargetAtTime(1 - w * 0.35, t, 0.08);
  S.shaper.curve = s.drive > 0 ? makeDriveCurve(s.drive / 100) : null;
  if (!s.d8 && S.panner) S.panner.pan.setTargetAtTime(0, t, 0.1);
}

const PRESETS = {
  normal:    { bass: 0,  treble: 0,  reverb: 0,  drive: 0,  speed: 1,    d8: false },
  bass:      { bass: 10, treble: 2,  reverb: 0,  drive: 8,  speed: 1,    d8: false },
  phonk:     { bass: 9,  treble: 1,  reverb: 12, drive: 35, speed: 1,    d8: false },
  slowed:    { bass: 4,  treble: -3, reverb: 55, drive: 0,  speed: 0.85, d8: false },
  nightcore: { bass: 2,  treble: 3,  reverb: 0,  drive: 0,  speed: 1.25, d8: false },
  d8:        { bass: 3,  treble: 0,  reverb: 20, drive: 0,  speed: 1,    d8: true  },
};
const PRESET_NAMES = {
  normal: 'Oddiy', bass: 'Bass Boost', phonk: 'Phonk Drive',
  slowed: 'Slowed + Reverb', nightcore: 'Nightcore', d8: '8D',
};

const SLIDERS = {
  bass:   { id: 'sBass',   fmt: v => (v > 0 ? '+' : '') + v + ' dB' },
  treble: { id: 'sTreble', fmt: v => (v > 0 ? '+' : '') + v + ' dB' },
  reverb: { id: 'sReverb', fmt: v => v + '%' },
  drive:  { id: 'sDrive',  fmt: v => v + '%' },
  speed:  { id: 'sSpeed',  fmt: v => (+v).toFixed(2) + 'x' },
};

function fillSlider(el) {
  const min = +el.min || 0, max = +el.max || 100;
  el.style.setProperty('--fill', ((el.value - min) / (max - min) * 100) + '%');
}

function syncSoundUI() {
  const s = CFG.sound;
  for (const key in SLIDERS) {
    const el = $(SLIDERS[key].id);
    el.value = s[key];
    fillSlider(el);
    $(SLIDERS[key].id + 'Val').textContent = SLIDERS[key].fmt(s[key]);
  }
  $('d8Toggle').checked = !!s.d8;
  // Qaysi tayyor sozlama mos kelishini aniqlash
  let found = null;
  for (const name in PRESETS) {
    const p = PRESETS[name];
    if (Object.keys(p).every(k => p[k] === s[k])) { found = name; break; }
  }
  document.querySelectorAll('#presetChips .chip').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === found));
}

for (const key in SLIDERS) {
  $(SLIDERS[key].id).addEventListener('input', e => {
    CFG.sound[key] = parseFloat(e.target.value);
    applyFx(); syncSoundUI(); saveCfg();
  });
}
$('d8Toggle').addEventListener('change', e => {
  CFG.sound.d8 = e.target.checked;
  applyFx(); syncSoundUI(); saveCfg();
});
$('presetChips').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  Object.assign(CFG.sound, PRESETS[b.dataset.preset]);
  applyFx(); syncSoundUI(); saveCfg();
  showToast('🎛 ' + PRESET_NAMES[b.dataset.preset]);
});
$('fxReset').addEventListener('click', () => {
  Object.assign(CFG.sound, PRESETS.normal);
  applyFx(); syncSoundUI(); saveCfg();
  showToast('↺ Ovoz asl holatga qaytdi');
});

// ── AUDIO CONTEXT SETUP (FAQAT 1 MARTA) ──────────────────────
// createMediaElementSource() — faqat 1 marta chaqirilishi kerak!
// Zanjir: source → bas → yuqori → distorsiya → (quruq + reverb) → 8D → limiter
//         → analyser → gain → speakers (+ recording)
function ensureAudioCtx() {
  if (S.audioCtx) {
    if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
    return;
  }

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  S.audioCtx = ctx;

  S.analyser = ctx.createAnalyser();
  S.analyser.fftSize = 2048;
  S.analyser.smoothingTimeConstant = 0.55;
  initAnalyserData();

  S.gainNode = ctx.createGain();
  S.gainNode.gain.value = S.muted ? 0 : CFG.volume;
  audio.volume = 1; // ovoz balandligi faqat gainNode orqali

  // SOURCE — BIR MARTA yaratiladi
  S.sourceNode = ctx.createMediaElementSource(audio);

  S.bassF = ctx.createBiquadFilter();
  S.bassF.type = 'lowshelf';  S.bassF.frequency.value = 110;
  S.trebleF = ctx.createBiquadFilter();
  S.trebleF.type = 'highshelf'; S.trebleF.frequency.value = 6500;

  S.shaper = ctx.createWaveShaper();
  S.shaper.oversample = '4x';

  S.dryGain = ctx.createGain();
  S.wetGain = ctx.createGain();
  S.convolver = ctx.createConvolver();
  S.convolver.buffer = makeImpulse(ctx);
  const fxOut = ctx.createGain();

  S.limiter = ctx.createDynamicsCompressor();
  S.limiter.threshold.value = -6;
  S.limiter.knee.value = 10;
  S.limiter.ratio.value = 6;
  S.limiter.attack.value = 0.005;
  S.limiter.release.value = 0.2;

  S.sourceNode.connect(S.bassF);
  S.bassF.connect(S.trebleF);
  S.trebleF.connect(S.shaper);
  S.shaper.connect(S.dryGain);   S.dryGain.connect(fxOut);
  // shaper → convolver ulanishi applyFx() da (faqat reverb yoqilganda)
  S.convolver.connect(S.wetGain); S.wetGain.connect(fxOut);

  let last = fxOut;
  if (ctx.createStereoPanner) {
    S.panner = ctx.createStereoPanner();
    last.connect(S.panner);
    last = S.panner;
  }
  last.connect(S.limiter);
  S.limiter.connect(S.analyser);
  S.analyser.connect(S.gainNode);
  S.gainNode.connect(ctx.destination);

  // Recording uchun audio stream
  S.audioDestNode = ctx.createMediaStreamDestination();
  S.gainNode.connect(S.audioDestNode);

  applyFx();
}

// ── PLEYLIST ──────────────────────────────────────────────────
function parseName(name) {
  const parts = name.split(' - ');
  if (parts.length >= 2) {
    return { artist: parts[0].trim().toUpperCase(), title: parts.slice(1).join(' - ').trim().toUpperCase() };
  }
  return { artist: 'DEXO PHONK', title: name.toUpperCase() };
}

function addFiles(fileList) {
  const files = Array.from(fileList).filter(f => !f.type || f.type.startsWith('audio/'));
  if (!files.length) { showToast('Audio fayl tanlang!'); return; }
  const first = S.tracks.length;
  files.forEach(f => {
    const name = f.name.replace(/\.[^.]+$/, '');
    const { title, artist } = parseName(name);
    S.tracks.push({ name, title, artist, url: URL.createObjectURL(f) });
  });
  renderPlaylist();
  loadTrack(first, true);
  if (files.length > 1) showToast(`🎵 ${files.length} ta musiqa qoʻshildi`);
}

function renderPlaylist() {
  playlistEl.textContent = '';
  S.tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'pl-item' + (i === S.index ? ' active' : '');
    li.dataset.i = i;

    const num = document.createElement('span');
    num.className = 'pl-num'; num.textContent = i + 1;

    const eq = document.createElement('span');
    eq.className = 'eq';
    for (let k = 0; k < 3; k++) eq.appendChild(document.createElement('i'));

    const text = document.createElement('div');
    text.className = 'pl-text';
    const nm = document.createElement('div');
    nm.className = 'pl-name'; nm.textContent = t.title;
    const ar = document.createElement('div');
    ar.className = 'pl-artist'; ar.textContent = t.artist;
    text.append(nm, ar);

    const del = document.createElement('button');
    del.className = 'pl-del'; del.title = 'Roʻyxatdan oʻchirish';
    del.dataset.del = i; del.textContent = '✕';

    li.append(num, eq, text, del);
    playlistEl.appendChild(li);
  });
  listCountEl.textContent = `${S.tracks.length} ta musiqa`;
  emptyListEl.classList.toggle('hide', S.tracks.length > 0);
}

playlistEl.addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); removeTrack(+del.dataset.del); return; }
  const li = e.target.closest('.pl-item');
  if (li) loadTrack(+li.dataset.i, true);
});

function removeTrack(i) {
  const t = S.tracks[i];
  if (!t) return;
  const wasCurrent = i === S.index;
  const wasPlaying = S.isPlaying;
  URL.revokeObjectURL(t.url);
  S.tracks.splice(i, 1);
  S.history = S.history.filter(h => h !== i).map(h => (h > i ? h - 1 : h));
  if (i < S.index) S.index--;
  if (wasCurrent) {
    if (!S.tracks.length) stopAll();
    else loadTrack(Math.min(i, S.tracks.length - 1), wasPlaying);
  }
  renderPlaylist();
  updateLoadedInfo();
}

$('clearList').addEventListener('click', () => {
  if (!S.tracks.length) return;
  S.tracks.forEach(t => URL.revokeObjectURL(t.url));
  S.tracks = [];
  stopAll();
  renderPlaylist();
  showToast('Roʻyxat tozalandi');
});

function stopAll() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  S.index = -1; S.trackUrl = ''; S.trackName = ''; S.history = [];
  titleEl.textContent = 'Musiqa tanlang...';
  artistEl.textContent = '---';
  durEl.textContent = '0:00';
  curTimeEl.textContent = '0:00';
  _lastPct = -1;
  loadedInfo.textContent = '';
  setPlaying(false);
}

function updateLoadedInfo() {
  loadedInfo.textContent = S.index >= 0
    ? `🎵 ${S.trackName}  (${S.index + 1}/${S.tracks.length})` : '';
}

function loadTrack(i, autoplay = true) {
  const t = S.tracks[i];
  if (!t) return;
  S.index = i;
  S.trackName = t.name;
  S.trackUrl = t.url;

  titleEl.textContent = t.title;
  artistEl.textContent = t.artist;
  updateLoadedInfo();
  renderPlaylist();

  // src oʻzgartir → load → play
  audio.pause();
  audio.src = t.url;
  audio.load();
  applyFx(); // load() tezlikni tiklab yuboradi — qayta qoʻyamiz

  // AudioContext faqat user gesture da yaratilishi mumkin
  try {
    ensureAudioCtx();
  } catch (err) {
    showToast('AudioContext xatosi: ' + err.message);
    return;
  }

  updateMediaSession(t);
  if (autoplay) playAudio();
}

function playAudio() {
  if (S.audioCtx && S.audioCtx.state === 'suspended') S.audioCtx.resume();
  return audio.play().catch(err => {
    console.error('play() xatosi:', err);
    showToast('Ijro xatosi! Qayta bosing.');
  });
}

function setPlaying(on) {
  S.isPlaying = on;
  playBtn.textContent = on ? '⏸' : '▶';
  document.body.classList.toggle('is-playing', on);
}

audio.addEventListener('play',  () => setPlaying(true));
audio.addEventListener('pause', () => setPlaying(false));
audio.addEventListener('error', () => {
  if (audio.getAttribute('src')) showToast('Fayl ochilmadi. Boshqa musiqani sinab koʻring.');
});

// ── KEYINGI / OLDINGI ────────────────────────────────────────
function nextIndex(auto) {
  const n = S.tracks.length;
  if (!n) return -1;
  if (CFG.shuffle && n > 1) {
    let r;
    do { r = Math.floor(Math.random() * n); } while (r === S.index);
    return r;
  }
  const i = S.index + 1;
  if (i >= n) return (CFG.repeat === 'all' || !auto) ? 0 : -1;
  return i;
}

function goNext(auto = false) {
  const n = nextIndex(auto);
  if (n === -1) return false;
  if (S.index >= 0) { S.history.push(S.index); if (S.history.length > 50) S.history.shift(); }
  loadTrack(n, true);
  return true;
}

function goPrev() {
  if (!S.tracks.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let p;
  if (S.history.length) p = S.history.pop();
  else p = (S.index - 1 + S.tracks.length) % S.tracks.length;
  loadTrack(p, true);
}

audio.addEventListener('ended', () => {
  if (CFG.repeat === 'one') { audio.currentTime = 0; playAudio(); return; }
  if (!goNext(true)) {
    audio.currentTime = 0;
    setPlaying(false);
  }
});

function togglePlay() {
  if (!S.trackUrl) { showToast('Avval musiqa tanlang!'); return; }
  if (S.isPlaying) audio.pause(); else playAudio();
}

playBtn.addEventListener('click', togglePlay);
prevBtn.addEventListener('click', goPrev);
nextBtn.addEventListener('click', () => {
  if (!S.tracks.length) { showToast('Avval musiqa tanlang!'); return; }
  if (S.tracks.length === 1) { audio.currentTime = 0; playAudio(); return; }
  goNext(false);
});

function syncModeButtons() {
  shuffleBtn.classList.toggle('on', CFG.shuffle);
  repeatBtn.classList.toggle('on', CFG.repeat !== 'off');
  repeatBtn.textContent = CFG.repeat === 'one' ? '🔂' : '🔁';
  repeatBtn.title = CFG.repeat === 'off' ? 'Takrorlash: oʻchiq'
    : CFG.repeat === 'all' ? 'Takrorlash: hammasi' : 'Takrorlash: bitta musiqa';
}
shuffleBtn.addEventListener('click', () => {
  CFG.shuffle = !CFG.shuffle;
  syncModeButtons(); saveCfg();
  showToast(CFG.shuffle ? '🔀 Aralashtirish yoqildi' : '🔀 Aralashtirish oʻchirildi');
});
repeatBtn.addEventListener('click', () => {
  CFG.repeat = CFG.repeat === 'off' ? 'all' : CFG.repeat === 'all' ? 'one' : 'off';
  syncModeButtons(); saveCfg();
  showToast(CFG.repeat === 'off' ? '🔁 Takrorlash oʻchiq'
    : CFG.repeat === 'all' ? '🔁 Hammasi takrorlanadi' : '🔂 Bitta musiqa takrorlanadi');
});

// ── FILE INPUT + DRAG & DROP ─────────────────────────────────
fileInput.addEventListener('change', e => {
  const files = e.target.files;
  if (!files || !files.length) return;
  addFiles(files);
  fileInput.value = '';
});

window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drag-over'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('drag-over'); });
window.addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('drag-over');
  if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

// Telefon qulf ekrani / quloqchin tugmalari
function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: 'DEXO PHONK' });
    navigator.mediaSession.setActionHandler('play', playAudio);
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', goPrev);
    navigator.mediaSession.setActionHandler('nexttrack', () => goNext(false));
  } catch (e) {}
}

// ── PROGRESS ──────────────────────────────────────────────────
audio.addEventListener('loadedmetadata', () => { durEl.textContent = fmt(audio.duration); });
audio.addEventListener('durationchange', () => { durEl.textContent = fmt(audio.duration); });

let seeking = false;
function seekTo(clientX) {
  if (!audio.duration || isNaN(audio.duration)) return;
  const rect = progressBar.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
}
progressBar.addEventListener('pointerdown', e => {
  seeking = true;
  try { progressBar.setPointerCapture(e.pointerId); } catch (err) {}
  seekTo(e.clientX);
});
progressBar.addEventListener('pointermove', e => { if (seeking) seekTo(e.clientX); });
['pointerup', 'pointercancel'].forEach(ev =>
  progressBar.addEventListener(ev, () => { seeking = false; }));

// ── VOLUME ────────────────────────────────────────────────────
function setVolume(v, silent) {
  CFG.volume = Math.max(0, Math.min(1, v));
  if (CFG.volume > 0) S.muted = false;
  const eff = S.muted ? 0 : CFG.volume;
  if (S.gainNode) { S.gainNode.gain.value = eff; audio.volume = 1; }
  else audio.volume = eff;
  volSlider.value = CFG.volume;
  fillSlider(volSlider);
  volBtn.textContent = eff === 0 ? '🔇' : eff < 0.5 ? '🔉' : '🔊';
  if (!silent) saveCfg();
}
volSlider.addEventListener('input', () => setVolume(parseFloat(volSlider.value)));
volBtn.addEventListener('click', toggleMute);
function toggleMute() {
  S.muted = !S.muted;
  setVolume(CFG.volume || 0.8, true);
  showToast(S.muted ? '🔇 Ovoz oʻchirildi' : '🔊 Ovoz yoqildi');
}

// ── PANEL: TABLAR, VIZUAL, EFFEKTLAR ─────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-body').forEach(b =>
      b.classList.toggle('active', b.id === 'tab-' + tab.dataset.tab));
  });
});

$('modeChips').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  setMode(b.dataset.mode);
  showToast('🎨 ' + MODE_NAMES[b.dataset.mode]);
});
$('themeChips').addEventListener('click', e => {
  const b = e.target.closest('[data-theme]');
  if (b) applyTheme(b.dataset.theme);
});

function syncFxChips() {
  document.querySelectorAll('#fxChips .chip').forEach(b =>
    b.classList.toggle('active', !!CFG.fx[b.dataset.fx]));
}
$('fxChips').addEventListener('click', e => {
  const b = e.target.closest('[data-fx]');
  if (!b) return;
  const key = b.dataset.fx;
  CFG.fx[key] = !CFG.fx[key];
  if (!CFG.fx[key]) {
    if (key === 'wave') rings.length = 0;
    if (key === 'particles') bursts.length = 0;
  }
  syncFxChips(); saveCfg();
});

const intensityEl = $('intensity');
function syncIntensity() {
  intensityEl.value = CFG.intensity;
  fillSlider(intensityEl);
  $('intensityVal').textContent = Math.round(CFG.intensity * 100) + '%';
}
intensityEl.addEventListener('input', () => {
  CFG.intensity = parseFloat(intensityEl.value);
  syncIntensity(); saveCfg();
});

// ── KLAVIATURA ───────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const el = e.target, tag = el.tagName;
  const isRange = tag === 'INPUT' && el.type === 'range';
  switch (e.code) {
    case 'Space':
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'LABEL') return;
      e.preventDefault(); togglePlay(); break;
    case 'ArrowRight':
      if (isRange) return;
      if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); break;
    case 'ArrowLeft':
      if (isRange) return;
      audio.currentTime = Math.max(0, audio.currentTime - 5); break;
    case 'ArrowUp':
      if (isRange) return;
      e.preventDefault(); setVolume(CFG.volume + 0.05); break;
    case 'ArrowDown':
      if (isRange) return;
      e.preventDefault(); setVolume(CFG.volume - 0.05); break;
    case 'KeyN': if (S.tracks.length > 1) goNext(false); break;
    case 'KeyP': goPrev(); break;
    case 'KeyM': toggleMute(); break;
  }
});

// ── VIDEO RECORDING ───────────────────────────────────────────
// Video oʻlchami: mantiqiy 480x854, haqiqiy 720x1280 (HD) — aniq va xira emas
const REC_W = 480, REC_H = 854, REC_SCALE = 1.5;

function rrect(RX, x, y, w, h, r) {
  RX.beginPath();
  if (RX.roundRect) RX.roundRect(x, y, w, h, r); else RX.rect(x, y, w, h);
}

async function startRecording() {
  if (!S.trackUrl)   { showToast('Avval musiqa tanlang!'); return; }
  if (!S.isPlaying)  { showToast('Avval musiqani ijro eting!'); return; }
  if (!S.audioCtx)   { showToast('AudioContext tayyor emas!'); return; }
  if (S.audioCtx.state==='suspended') await S.audioCtx.resume();

  // Offscreen canvas — 9:16 mobil format
  const RC = document.createElement('canvas');
  RC.width  = Math.round(REC_W * REC_SCALE);
  RC.height = Math.round(REC_H * REC_SCALE);
  S.recCanvas = RC;
  S.recCtx    = RC.getContext('2d');
  S.recCtx.scale(REC_SCALE, REC_SCALE);
  S.recCtx.imageSmoothingEnabled = true;
  S.recCtx.imageSmoothingQuality = 'high';

  // Video stream (canvas)
  let videoStream;
  try {
    videoStream = RC.captureStream(30);
  } catch(e) {
    showToast('Canvas stream ishlamadi: '+e.message);
    return;
  }

  // Audio stream
  const audioTracks = S.audioDestNode ? S.audioDestNode.stream.getAudioTracks() : [];

  // Combined stream
  const combined = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...audioTracks,
  ]);

  // Mime type
  const MIMES = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const mimeType = MIMES.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';

  S.chunks = [];

  try {
    S.mediaRecorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 192_000,
    });
  } catch(e) {
    showToast('MediaRecorder xatosi: '+e.message);
    return;
  }

  S.mediaRecorder.ondataavailable = ev => {
    if (ev.data && ev.data.size > 0) S.chunks.push(ev.data);
  };

  S.mediaRecorder.onstop = () => {
    if (!S.chunks.length) { showToast('Video ma\'lumot yo\'q!'); return; }

    const baseType = mimeType.split(';')[0];
    const blob    = new Blob(S.chunks, { type: baseType });
    const blobUrl = URL.createObjectURL(blob);
    const ext     = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const fname   = `phonk_video_${Date.now()}.${ext}`;

    // Yuklab olish
    const a = document.createElement('a');
    a.href     = blobUrl;
    a.download = fname;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 5000);

    S.chunks = [];
    showToast(ext === 'mp4'
      ? '✅ MP4 video saqlandi: ' + fname
      : '✅ Saqlandi: ' + fname + ' (bu brauzer MP4 yozmaydi, WebM)', 4500);
  };

  S.mediaRecorder.start(100); // har 100ms chunk
  S.isRecording = true;
  S.recStart    = Date.now();

  // UI
  recIndicator.classList.add('show');
  recordBtn.textContent = '⏹ To\'xtatish';
  recordBtn.classList.add('recording');
  saveVideoBtn.classList.add('active');

  // REC vaqt hisoblagich
  clearInterval(S.recTimerId);
  S.recTimerId = setInterval(() => {
    const sec = Math.floor((Date.now()-S.recStart)/1000);
    recTimeEl.textContent = 'REC ' + fmt(sec);
  }, 1000);

  // Render
  recRenderLoop();
  showToast('🔴 Video yozish boshlandi!');
}

function recRenderLoop(ts) {
  if (!S.isRecording || !S.recCtx) return;
  S.recRafId = requestAnimationFrame(recRenderLoop);
  // Video 30 fps — ekran 60 fps da ishlaganda ikki barobar kam yuk
  if (ts && S.recLast && ts - S.recLast < 30) return;
  S.recLast = ts || performance.now();

  const RC=S.recCanvas, RX=S.recCtx, W=REC_W, H=REC_H;

  // Vizualizer joylashuvi
  const vSize = 400, vX = (W - vSize) / 2, vY = (H - vSize) / 2 - 90;
  const cx = W / 2, cy = vY + vSize / 2;

  // 1. Fon + barcha effektlar (chaqnash, lazer, toʻlqin, zarralar)
  RX.fillStyle = css(T.bg);
  RX.fillRect(0, 0, W, H);
  drawFx(RX, W, H, cx, cy, vSize);

  // Silkinish videoda ham koʻrinadi
  const sk = vSize / VS;
  const ox = S.shx * sk, oy = S.shy * sk;

  // 2. Visualizer nusxasi (nur bilan)
  try {
    RX.drawImage(vizCanvas, vX + ox, vY + oy, vSize, vSize);
  } catch(e){}

  // 3. Disc (zarbada kattalashadi, vinil aylanadi)
  const ringR = vSize * 0.30 * (1 + S.beat * 0.07 * Math.min(1.3, CFG.intensity));
  const dcx = cx + ox, dcy = cy + oy;
  // Tashqi halqa
  const rg = RX.createRadialGradient(dcx - ringR*0.2, dcy - ringR*0.3, 0, dcx, dcy, ringR);
  rg.addColorStop(0, css(T.d)); rg.addColorStop(0.6, css(T.m)); rg.addColorStop(1, css(T.bg));
  RX.beginPath(); RX.arc(dcx, dcy, ringR, 0, Math.PI*2);
  RX.fillStyle = rg; RX.fill();
  RX.strokeStyle = rgba(T.p, 0.12 + S.beat * 0.3); RX.lineWidth = 18 + S.beat * 16; RX.stroke();
  strokeGlow(RX, T.p, 2.5, 1);
  // Vinil
  const discR = ringR * 0.81;
  const vg = RX.createRadialGradient(dcx - discR*0.2, dcy - discR*0.3, 0, dcx, dcy, discR);
  vg.addColorStop(0, css(T.m)); vg.addColorStop(1, css(T.bg));
  RX.beginPath(); RX.arc(dcx, dcy, discR, 0, Math.PI*2);
  RX.fillStyle = vg; RX.fill();
  RX.strokeStyle = rgba(T.p, 0.27); RX.lineWidth = 1.5; RX.stroke();
  // Vinil yaltirashi (aylanadi)
  RX.lineCap = 'round';
  for (let j = 0; j < 2; j++) {
    RX.beginPath();
    const a0 = S.discAngle + j * Math.PI;
    RX.arc(dcx, dcy, discR * 0.78, a0, a0 + 0.7);
    RX.strokeStyle = 'rgba(255,255,255,0.12)'; RX.lineWidth = 6; RX.stroke();
  }
  for (let j = 1; j <= 3; j++) {
    RX.beginPath(); RX.arc(dcx, dcy, discR * (0.5 + j * 0.13), 0, Math.PI*2);
    RX.strokeStyle = 'rgba(255,255,255,0.04)'; RX.lineWidth = 1; RX.stroke();
  }
  // Markaziy yorliq
  const inR = ringR * 0.4;
  RX.beginPath(); RX.arc(dcx, dcy, inR, 0, Math.PI*2);
  const cg = RX.createRadialGradient(dcx, dcy, 0, dcx, dcy, inR);
  cg.addColorStop(0, css(T.m)); cg.addColorStop(1, css(T.bg));
  RX.fillStyle = cg; RX.fill();
  RX.strokeStyle = css(T.p); RX.lineWidth = 2;
  strokeGlow(RX, T.p, 2, 1);
  // DEXO matn
  RX.textAlign = 'center';
  RX.font = `bold ${Math.round(inR * 0.4)}px Orbitron,monospace`;
  RX.fillStyle = css(T.l);
  RX.shadowColor = css(T.l); RX.shadowBlur = (10) * REC_SCALE;
  RX.fillText('DEXO', dcx, dcy + 3);
  RX.shadowBlur = 0;
  RX.font = `${Math.round(inR * 0.2)}px Rajdhani,sans-serif`;
  RX.fillStyle = css(T.s);
  RX.fillText('PHONK', dcx, dcy + inR * 0.4);

  // 4. PHONK label (glitch paytida siljiydi)
  const gOff = S.glitchOn ? (Math.random() - 0.5) * 8 : 0;
  RX.font = 'bold 30px Orbitron,monospace';
  if (S.glitchOn) {
    RX.fillStyle = css(T.a); RX.fillText('PHONK', W/2 + gOff + 3, vY + vSize + 32);
    RX.fillStyle = css(T.s); RX.fillText('PHONK', W/2 + gOff - 3, vY + vSize + 32);
  }
  RX.fillStyle = css(T.l);
  RX.shadowColor = css(T.p); RX.shadowBlur = (14) * REC_SCALE;
  RX.fillText('PHONK', W/2 + gOff, vY + vSize + 32);
  RX.shadowBlur = 0;

  // 5. Qo'shiq nomi
  RX.font = 'bold 14px Orbitron,monospace';
  RX.fillStyle = '#ffffff';
  const tname = (titleEl.textContent||'').substring(0,30);
  RX.fillText(tname, W/2, vY+vSize+65);

  // 6. Artist
  RX.font = '13px Rajdhani,sans-serif';
  RX.fillStyle = css(T.l);
  RX.fillText(artistEl.textContent||'', W/2, vY+vSize+86);

  // 7. Progress bar
  const pct = audio.duration ? audio.currentTime/audio.duration : 0;
  const bX=60, bY=vY+vSize+108, bW=W-120, bH=5;
  RX.fillStyle = rgba(T.p, 0.25);
  rrect(RX, bX, bY, bW, bH, 3); RX.fill();
  if (pct>0) {
    const pg=RX.createLinearGradient(bX,0,bX+bW,0);
    pg.addColorStop(0, css(T.p)); pg.addColorStop(1, css(T.s));
    RX.fillStyle=pg;
    rrect(RX, bX, bY, bW*pct, bH, 3); RX.fill();
    RX.beginPath(); RX.arc(bX+bW*pct,bY+bH/2,6,0,Math.PI*2);
    RX.fillStyle = css(T.s); RX.fill();
  }

  // 8. Vaqt
  RX.font='10px Orbitron,monospace'; RX.fillStyle = css(mixc(T.p, [255,255,255], 0.35));
  RX.textAlign='left';  RX.fillText(fmt(audio.currentTime), bX, bY+20);
  RX.textAlign='right'; RX.fillText(fmt(audio.duration||0), bX+bW, bY+20);
}

function stopRecording() {
  if (S.isRecording && S.mediaRecorder && S.mediaRecorder.state!=='inactive') {
    S.mediaRecorder.stop();
  }
  S.isRecording = false;
  cancelAnimationFrame(S.recRafId);
  clearInterval(S.recTimerId);

  recIndicator.classList.remove('show');
  recordBtn.textContent = '⭐ Video saqlash';
  recordBtn.classList.remove('recording');
  saveVideoBtn.classList.remove('active');

  showToast('⏹ To\'xtatildi, yuklanmoqda...', 4000);
}

recordBtn.addEventListener('click',   () => S.isRecording ? stopRecording() : startRecording());
saveVideoBtn.addEventListener('click', () => S.isRecording ? stopRecording() : startRecording());

// ── UTILS ─────────────────────────────────────────────────────
function fmt(sec) {
  if (!sec || isNaN(sec) || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec/60);
  const s = Math.floor(sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

let _toastTimer = null;
function showToast(msg, dur=3000) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toastEl.classList.remove('show'), dur);
}

// ── BOSHLANGʻICH HOLAT ────────────────────────────────────────
applyTheme(CFG.theme);
setMode(CFG.mode);
syncFxChips();
syncIntensity();
syncSoundUI();
syncModeButtons();
setVolume(CFG.volume, true);
applyFx();
renderPlaylist();
