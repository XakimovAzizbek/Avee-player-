/*
 * DEXO PHONK PLAYER — home.js
 * ==========================================================
 * ASOSIY XATOLAR TUZATILDI:
 *
 * 1) createMediaElementSource(audio) — bu faqat BIR MARTA
 *    chaqirilishi mumkin. Ikkinchi musiqa tanlaganda xatolik
 *    berardi. Endi AudioContext va source bitta marta yaratiladi,
 *    keyingi musiqalar uchun faqat audio.src o'zgartiriladi.
 *
 * 2) audio.play() ni await qilmasdan initAudio() keyin chaqirilardi.
 *    Endi to'g'ri tartib: src o'zgartir → load → play.
 *
 * 3) crossOrigin atributi olib tashlandi — local fayl uchun
 *    CORS kerak emas, lekin crossOrigin qo'yilsa xatolik beradi.
 *
 * 4) Video saqlash: Blob to'g'ri yaratiladi va <a download>
 *    orqali galereya/yuklamalar papkasiga saqlanadi.
 * ==========================================================
 */

// ── GLOBAL STATE ─────────────────────────────────────────────
const S = {
  trackName: '',
  trackUrl: '',
  isPlaying: false,

  // AudioContext — faqat bitta, qayta yaratilmaydi
  audioCtx: null,
  analyser: null,
  gainNode: null,
  sourceNode: null,      // MediaElementSource — BITTA marta
  audioDestNode: null,   // recording uchun

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
const audio         = document.getElementById('audio');
const playBtn       = document.getElementById('playBtn');
const prevBtn       = document.getElementById('prevBtn');
const nextBtn       = document.getElementById('nextBtn');
const fileInput     = document.getElementById('fileInput');
const progressBar   = document.getElementById('progressBar');
const progressFill  = document.getElementById('progressFill');
const progressThumb = document.getElementById('progressThumb');
const curTimeEl     = document.getElementById('currentTime');
const durEl         = document.getElementById('duration');
const titleEl       = document.getElementById('songTitle');
const artistEl      = document.getElementById('songArtist');
const volSlider     = document.getElementById('volumeSlider');
const recordBtn     = document.getElementById('recordBtn');
const saveVideoBtn  = document.getElementById('saveVideoBtn');
const recIndicator  = document.getElementById('recIndicator');
const recTimeEl     = document.getElementById('recTime');
const toastEl       = document.getElementById('toast');
const disc          = document.getElementById('disc');
const vizCanvas     = document.getElementById('vizCanvas');
const bgCanvas      = document.getElementById('bgCanvas');
const loadedInfo    = document.getElementById('loadedInfo');

const vizCtx = vizCanvas.getContext('2d');
const bgCtx  = bgCanvas.getContext('2d');

// ── CANVAS RESIZE ─────────────────────────────────────────────
function resizeAll() {
  const wrap = document.querySelector('.visualizer-wrap');
  vizCanvas.width  = wrap.offsetWidth  || 300;
  vizCanvas.height = wrap.offsetHeight || 300;
  bgCanvas.width   = window.innerWidth;
  bgCanvas.height  = window.innerHeight;
}
window.addEventListener('resize', resizeAll);
resizeAll();

// ── BACKGROUND PARTICLES ──────────────────────────────────────
const pts = Array.from({ length: 55 }, () => ({
  x:  Math.random() * window.innerWidth,
  y:  Math.random() * window.innerHeight,
  r:  Math.random() * 2 + 0.4,
  vx: (Math.random() - 0.5) * 0.35,
  vy: (Math.random() - 0.5) * 0.35,
  a:  Math.random() * 0.5 + 0.1,
}));

function drawBg(bass) {
  const W = window.innerWidth, H = window.innerHeight;
  bgCanvas.width = W; bgCanvas.height = H;
  const g = bgCtx.createRadialGradient(W/2,H/2,0, W/2,H/2,H*0.8);
  const inten = bass ? Math.min(1, bass/128) : 0;
  g.addColorStop(0, `rgba(80,0,150,${0.13 + inten*0.17})`);
  g.addColorStop(1, 'rgba(6,0,15,0)');
  bgCtx.fillStyle = g;
  bgCtx.fillRect(0,0,W,H);
  pts.forEach(p => {
    p.x = (p.x + p.vx + W) % W;
    p.y = (p.y + p.vy + H) % H;
    bgCtx.beginPath();
    bgCtx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    bgCtx.fillStyle = `rgba(180,100,255,${p.a})`;
    bgCtx.fill();
  });
}

// ── VISUALIZER ────────────────────────────────────────────────
function drawViz(data) {
  const W=vizCanvas.width, H=vizCanvas.height;
  vizCtx.clearRect(0,0,W,H);
  const cx=W/2, cy=H/2, r=Math.min(W,H)*0.36;

  if (!data) {
    vizCtx.beginPath();
    vizCtx.arc(cx,cy,r,0,Math.PI*2);
    vizCtx.strokeStyle='rgba(139,0,255,0.3)';
    vizCtx.lineWidth=1.5; vizCtx.stroke();
    return 0;
  }

  const bars = Math.min(data.length, 128);
  for (let i=0; i<bars; i++) {
    const v   = data[i] / 255;
    const ang = (i/bars) * Math.PI*2 - Math.PI/2;
    const bH  = v*r*0.9 + 2;
    const x1  = cx + Math.cos(ang)*(r+2);
    const y1  = cy + Math.sin(ang)*(r+2);
    const x2  = cx + Math.cos(ang)*(r+2+bH);
    const y2  = cy + Math.sin(ang)*(r+2+bH);
    vizCtx.beginPath();
    vizCtx.moveTo(x1,y1); vizCtx.lineTo(x2,y2);
    vizCtx.strokeStyle = `hsla(${260+v*80},100%,60%,${0.4+v*0.6})`;
    vizCtx.lineWidth = (W/bars) * 1.6;
    vizCtx.lineCap = 'round';
    vizCtx.stroke();
  }

  const bass = data[4] / 255;

  vizCtx.beginPath();
  vizCtx.arc(cx,cy,r,0,Math.PI*2);
  vizCtx.strokeStyle = `rgba(${150+bass*105},0,${200+bass*55},${0.5+bass*0.5})`;
  vizCtx.lineWidth = 2+bass*4;
  vizCtx.shadowColor='#bf00ff'; vizCtx.shadowBlur=10+bass*20;
  vizCtx.stroke(); vizCtx.shadowBlur=0;

  const t = r*0.55;
  vizCtx.beginPath();
  vizCtx.moveTo(cx, cy-t);
  vizCtx.lineTo(cx+t*0.866, cy+t*0.5);
  vizCtx.lineTo(cx-t*0.866, cy+t*0.5);
  vizCtx.closePath();
  const tg = vizCtx.createLinearGradient(cx-t,cy-t,cx+t,cy+t);
  tg.addColorStop(0,'#00fff7'); tg.addColorStop(0.5,'#ff00aa'); tg.addColorStop(1,'#00fff7');
  vizCtx.strokeStyle = tg;
  vizCtx.lineWidth = 1.5+bass*2;
  vizCtx.shadowColor='#00fff7'; vizCtx.shadowBlur=8+bass*12;
  vizCtx.stroke(); vizCtx.shadowBlur=0;

  return bass;
}

// ── MAIN ANIMATION LOOP ───────────────────────────────────────
function loop() {
  requestAnimationFrame(loop);
  let data=null, bass=0;
  if (S.analyser && S.isPlaying) {
    data = new Uint8Array(S.analyser.frequencyBinCount);
    S.analyser.getByteFrequencyData(data);
    bass = data[4];
  }
  drawBg(bass);
  drawViz(data);
}
loop();

// ── AUDIO CONTEXT SETUP (FAQAT 1 MARTA) ──────────────────────
// createMediaElementSource() — faqat 1 marta chaqirilishi kerak!
// Keyingi musiqa uchun faqat audio.src o'zgartiriladi.
function ensureAudioCtx() {
  if (S.audioCtx) {
    // Allaqachon yaratilgan — faqat resume
    if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
    return;
  }

  S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  S.analyser = S.audioCtx.createAnalyser();
  S.analyser.fftSize = 256;

  S.gainNode = S.audioCtx.createGain();
  S.gainNode.gain.value = parseFloat(volSlider.value);

  // SOURCE — BIR MARTA yaratiladi
  S.sourceNode = S.audioCtx.createMediaElementSource(audio);

  // Zanjir: source → analyser → gain → speakers
  S.sourceNode.connect(S.analyser);
  S.analyser.connect(S.gainNode);
  S.gainNode.connect(S.audioCtx.destination);

  // Recording uchun audio stream
  S.audioDestNode = S.audioCtx.createMediaStreamDestination();
  S.gainNode.connect(S.audioDestNode);
}

// ── FILE INPUT ────────────────────────────────────────────────
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  fileInput.value = '';

  // Eski URL ni tozalash
  if (S.trackUrl) URL.revokeObjectURL(S.trackUrl);

  S.trackName = file.name.replace(/\.[^.]+$/, '');
  S.trackUrl  = URL.createObjectURL(file);

  // Song info
  const parts = S.trackName.split(' - ');
  if (parts.length >= 2) {
    artistEl.textContent = parts[0].trim().toUpperCase();
    titleEl.textContent  = parts.slice(1).join(' - ').trim().toUpperCase();
  } else {
    titleEl.textContent  = S.trackName.toUpperCase();
    artistEl.textContent = 'DEXO PHONK';
  }
  loadedInfo.textContent = '🎵 ' + S.trackName;

  // Audio src o'zgartir va ijro et
  audio.pause();
  audio.src = S.trackUrl;
  audio.load();

  // AudioContext faqat user gesture da yaratilishi mumkin
  // Shuning uchun bu yerda yaratamiz (fayl tanlash = user gesture)
  try {
    ensureAudioCtx();
  } catch(err) {
    showToast('AudioContext xatosi: ' + err.message);
    return;
  }

  audio.play().then(() => {
    S.isPlaying = true;
    playBtn.textContent = '⏸';
    disc.classList.add('spinning');
  }).catch(err => {
    console.error('play() xatosi:', err);
    showToast('Musiqa ijrosida xato! Qayta bosing.');
  });
});

// ── PLAY / PAUSE ──────────────────────────────────────────────
playBtn.addEventListener('click', () => {
  if (!S.trackUrl) {
    showToast('Avval musiqa tanlang!');
    return;
  }

  if (S.audioCtx && S.audioCtx.state === 'suspended') {
    S.audioCtx.resume();
  }

  if (S.isPlaying) {
    audio.pause();
    S.isPlaying = false;
    playBtn.textContent = '▶';
    disc.classList.remove('spinning');
  } else {
    audio.play().then(() => {
      S.isPlaying = true;
      playBtn.textContent = '⏸';
      disc.classList.add('spinning');
    }).catch(err => {
      console.error(err);
      showToast('Ijro xatosi!');
    });
  }
});

// Prev — boshidan boshlash
prevBtn.addEventListener('click', () => {
  if (!S.trackUrl) return;
  audio.currentTime = 0;
  if (!S.isPlaying) {
    audio.play().then(() => {
      S.isPlaying=true; playBtn.textContent='⏸'; disc.classList.add('spinning');
    });
  }
});

// Next — boshidan boshlash (1 ta musiqa)
nextBtn.addEventListener('click', () => {
  if (!S.trackUrl) return;
  audio.currentTime = 0;
  if (!S.isPlaying) {
    audio.play().then(() => {
      S.isPlaying=true; playBtn.textContent='⏸'; disc.classList.add('spinning');
    });
  }
});

audio.addEventListener('ended', () => {
  S.isPlaying = false;
  audio.currentTime = 0;
  playBtn.textContent = '▶';
  disc.classList.remove('spinning');
});

// ── PROGRESS ──────────────────────────────────────────────────
audio.addEventListener('timeupdate', () => {
  if (!audio.duration || isNaN(audio.duration)) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  progressFill.style.width = pct + '%';
  progressThumb.style.left = pct + '%';
  curTimeEl.textContent = fmt(audio.currentTime);
});

audio.addEventListener('loadedmetadata', () => {
  durEl.textContent = fmt(audio.duration);
});

function seekTo(clientX) {
  if (!audio.duration || isNaN(audio.duration)) return;
  const rect = progressBar.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
}
progressBar.addEventListener('click', e => seekTo(e.clientX));
progressBar.addEventListener('touchstart', e => seekTo(e.touches[0].clientX), {passive:true});
progressBar.addEventListener('touchmove',  e => seekTo(e.touches[0].clientX), {passive:true});

// ── VOLUME ────────────────────────────────────────────────────
volSlider.addEventListener('input', () => {
  const v = parseFloat(volSlider.value);
  audio.volume = v;
  if (S.gainNode) S.gainNode.gain.value = v;
  volSlider.style.background =
    `linear-gradient(90deg,var(--purple) ${v*100}%,rgba(139,0,255,0.2) ${v*100}%)`;
});

// ── VIDEO RECORDING ───────────────────────────────────────────
async function startRecording() {
  if (!S.trackUrl)   { showToast('Avval musiqa tanlang!'); return; }
  if (!S.isPlaying)  { showToast('Avval musiqani ijro eting!'); return; }
  if (!S.audioCtx)   { showToast('AudioContext tayyor emas!'); return; }
  if (S.audioCtx.state==='suspended') await S.audioCtx.resume();

  // Offscreen canvas — 9:16 mobil format
  const RC = document.createElement('canvas');
  RC.width=480; RC.height=854;
  S.recCanvas = RC;
  S.recCtx    = RC.getContext('2d');

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
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const mimeType = MIMES.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';

  S.chunks = [];

  try {
    S.mediaRecorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
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

    const blob    = new Blob(S.chunks, { type: mimeType });
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
    showToast('✅ Video saqlandi: ' + fname, 4000);
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

function recRenderLoop() {
  if (!S.isRecording || !S.recCtx) return;
  S.recRafId = requestAnimationFrame(recRenderLoop);

  const RC=S.recCanvas, RX=S.recCtx, W=RC.width, H=RC.height;

  // 1. Qora fon
  RX.fillStyle = '#06000f';
  RX.fillRect(0,0,W,H);

  // 2. BG particles nusxasi
  try { RX.drawImage(bgCanvas, 0,0,W,H); } catch(e){}

  // 3. Visualizer nusxasi
  const vSize=280, vX=(W-vSize)/2, vY=(H-vSize)/2-80;
  try { RX.drawImage(vizCanvas, vX,vY,vSize,vSize); } catch(e){}

  // 4. Disc (doira + DEXO matn)
  const cx=W/2, cy=vY+vSize/2;
  // Tashqi doira
  RX.beginPath(); RX.arc(cx,cy,98,0,Math.PI*2);
  RX.strokeStyle='#8b00ff'; RX.lineWidth=2.5;
  RX.shadowColor='#8b00ff'; RX.shadowBlur=22;
  RX.stroke(); RX.shadowBlur=0;
  // Ichki doira fon
  RX.beginPath(); RX.arc(cx,cy,78,0,Math.PI*2);
  const dg=RX.createRadialGradient(cx,cy,0,cx,cy,78);
  dg.addColorStop(0,'#2a0050'); dg.addColorStop(1,'#06000f');
  RX.fillStyle=dg; RX.fill();
  // Markaziy doira
  RX.beginPath(); RX.arc(cx,cy,38,0,Math.PI*2);
  RX.strokeStyle='#8b00ff'; RX.lineWidth=2;
  RX.shadowColor='#8b00ff'; RX.shadowBlur=12; RX.stroke(); RX.shadowBlur=0;
  const cg=RX.createRadialGradient(cx,cy,0,cx,cy,38);
  cg.addColorStop(0,'#1a003a'); cg.addColorStop(1,'#06000f');
  RX.fillStyle=cg; RX.fill();
  // DEXO matn
  RX.textAlign='center';
  RX.font='bold 16px Orbitron,monospace';
  RX.fillStyle='#bf00ff';
  RX.shadowColor='#bf00ff'; RX.shadowBlur=10;
  RX.fillText('DEXO', cx, cy+3);
  RX.shadowBlur=0;
  RX.font='8px Rajdhani,sans-serif';
  RX.fillStyle='#00fff7';
  RX.fillText('PHONK', cx, cy+16);

  // 5. PHONK label
  RX.font='bold 30px Orbitron,monospace';
  RX.fillStyle='#bf00ff';
  RX.shadowColor='#8b00ff'; RX.shadowBlur=24;
  RX.fillText('PHONK', W/2, vY+vSize+32);
  RX.shadowBlur=0;

  // 6. Qo'shiq nomi
  RX.font='bold 14px Orbitron,monospace';
  RX.fillStyle='#ffffff';
  const tname = (titleEl.textContent||'').substring(0,30);
  RX.fillText(tname, W/2, vY+vSize+65);

  // 7. Artist
  RX.font='13px Rajdhani,sans-serif';
  RX.fillStyle='#bf00ff';
  RX.fillText(artistEl.textContent||'', W/2, vY+vSize+86);

  // 8. Progress bar
  const pct = audio.duration ? audio.currentTime/audio.duration : 0;
  const bX=60, bY=vY+vSize+108, bW=W-120, bH=5;
  RX.fillStyle='rgba(139,0,255,0.25)';
  RX.beginPath(); RX.roundRect(bX,bY,bW,bH,3); RX.fill();
  if (pct>0) {
    const pg=RX.createLinearGradient(bX,0,bX+bW,0);
    pg.addColorStop(0,'#8b00ff'); pg.addColorStop(1,'#00fff7');
    RX.fillStyle=pg;
    RX.beginPath(); RX.roundRect(bX,bY,bW*pct,bH,3); RX.fill();
    // Thumb
    RX.beginPath(); RX.arc(bX+bW*pct,bY+bH/2,6,0,Math.PI*2);
    RX.fillStyle='#00fff7'; RX.fill();
  }

  // 9. Vaqt
  RX.font='10px Orbitron,monospace'; RX.fillStyle='#9966cc';
  RX.textAlign='left';  RX.fillText(fmt(audio.currentTime), bX, bY+20);
  RX.textAlign='right'; RX.fillText(fmt(audio.duration||0), bX+bW, bY+20);

  // 10. REC badge
  const elap = Math.floor((Date.now()-S.recStart)/1000);
  RX.textAlign='right';
  RX.font='11px Orbitron,monospace';
  RX.fillStyle='red'; RX.shadowColor='red'; RX.shadowBlur=8;
  RX.fillText(`● REC ${fmt(elap)}`, W-16, 30);
  RX.shadowBlur=0;
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
