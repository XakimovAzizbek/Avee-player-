// ===== STATE =====
const state = {
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  isRecording: false,
  mediaRecorder: null,
  recordedChunks: [],
  audioCtx: null,
  analyser: null,
  source: null,
  animFrame: null,
  recordStart: null,
};

// ===== DOM =====
const audio       = document.getElementById('audio');
const playBtn     = document.getElementById('playBtn');
const prevBtn     = document.getElementById('prevBtn');
const nextBtn     = document.getElementById('nextBtn');
const fileInput   = document.getElementById('fileInput');
const progressBar = document.getElementById('progressBar');
const progressFill= document.getElementById('progressFill');
const progressThumb=document.getElementById('progressThumb');
const currentTimeEl=document.getElementById('currentTime');
const durationEl  = document.getElementById('duration');
const songTitle   = document.getElementById('songTitle');
const songArtist  = document.getElementById('songArtist');
const volumeSlider= document.getElementById('volumeSlider');
const playlistEl  = document.getElementById('playlist');
const recordBtn   = document.getElementById('recordBtn');
const recIndicator= document.getElementById('recIndicator');
const toast       = document.getElementById('toast');
const disc        = document.getElementById('disc');
const vizCanvas   = document.getElementById('vizCanvas');
const bgCanvas    = document.getElementById('bgCanvas');
const saveVideoBtn= document.getElementById('saveVideoBtn');

const vizCtx      = vizCanvas.getContext('2d');
const bgCtx       = bgCanvas.getContext('2d');

// ===== RESIZE =====
function resizeCanvases() {
  const wrap = document.querySelector('.visualizer-wrap');
  vizCanvas.width  = wrap.offsetWidth  || 320;
  vizCanvas.height = wrap.offsetHeight || 320;
  bgCanvas.width  = window.innerWidth;
  bgCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvases);
resizeCanvases();

// ===== BACKGROUND PARTICLES =====
const particles = Array.from({length: 60}, () => ({
  x: Math.random() * window.innerWidth,
  y: Math.random() * window.innerHeight,
  r: Math.random() * 2 + 0.5,
  vx: (Math.random() - 0.5) * 0.4,
  vy: (Math.random() - 0.5) * 0.4,
  alpha: Math.random() * 0.5 + 0.1,
}));

function drawBg(bass) {
  bgCanvas.width  = window.innerWidth;
  bgCanvas.height = window.innerHeight;
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

  // Subtle purple radial gradient
  const grd = bgCtx.createRadialGradient(
    bgCanvas.width/2, bgCanvas.height/2, 0,
    bgCanvas.width/2, bgCanvas.height/2, bgCanvas.height * 0.8
  );
  const intensity = bass ? Math.min(1, bass/128) : 0;
  grd.addColorStop(0, `rgba(80,0,150,${0.15 + intensity * 0.15})`);
  grd.addColorStop(1, 'rgba(6,0,15,0)');
  bgCtx.fillStyle = grd;
  bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

  // Particles
  particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = bgCanvas.width;
    if (p.x > bgCanvas.width) p.x = 0;
    if (p.y < 0) p.y = bgCanvas.height;
    if (p.y > bgCanvas.height) p.y = 0;

    bgCtx.beginPath();
    bgCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    bgCtx.fillStyle = `rgba(180,100,255,${p.alpha})`;
    bgCtx.fill();
  });
}

// ===== VISUALIZER =====
function drawVisualizer(dataArray) {
  const W = vizCanvas.width;
  const H = vizCanvas.height;
  vizCtx.clearRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) * 0.36;
  const bars   = dataArray ? Math.min(dataArray.length, 128) : 0;

  if (!dataArray || bars === 0) {
    // Idle ring
    vizCtx.beginPath();
    vizCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    vizCtx.strokeStyle = 'rgba(139,0,255,0.3)';
    vizCtx.lineWidth = 1.5;
    vizCtx.stroke();
    return;
  }

  // Draw bars around the circle
  for (let i = 0; i < bars; i++) {
    const val   = dataArray[i] / 255;
    const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
    const barH  = val * radius * 0.9 + 2;

    const x1 = cx + Math.cos(angle) * (radius + 2);
    const y1 = cy + Math.sin(angle) * (radius + 2);
    const x2 = cx + Math.cos(angle) * (radius + 2 + barH);
    const y2 = cy + Math.sin(angle) * (radius + 2 + barH);

    const hue = 260 + val * 80; // purple to pink
    const alpha = 0.4 + val * 0.6;
    vizCtx.beginPath();
    vizCtx.moveTo(x1, y1);
    vizCtx.lineTo(x2, y2);
    vizCtx.strokeStyle = `hsla(${hue},100%,60%,${alpha})`;
    vizCtx.lineWidth = (W / bars) * 1.6;
    vizCtx.lineCap = 'round';
    vizCtx.stroke();
  }

  // Outer glow ring
  vizCtx.beginPath();
  vizCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  const bass = dataArray[4] / 255;
  vizCtx.strokeStyle = `rgba(${150 + bass*105},0,${200 + bass*55},${0.5 + bass*0.5})`;
  vizCtx.lineWidth = 2 + bass * 4;
  vizCtx.shadowColor = '#bf00ff';
  vizCtx.shadowBlur  = 10 + bass * 20;
  vizCtx.stroke();
  vizCtx.shadowBlur  = 0;

  // Neon triangle
  const tri = radius * 0.55;
  vizCtx.beginPath();
  vizCtx.moveTo(cx,           cy - tri);
  vizCtx.lineTo(cx + tri*0.866, cy + tri*0.5);
  vizCtx.lineTo(cx - tri*0.866, cy + tri*0.5);
  vizCtx.closePath();
  const grad = vizCtx.createLinearGradient(cx-tri, cy-tri, cx+tri, cy+tri);
  grad.addColorStop(0,   '#00fff7');
  grad.addColorStop(0.5, '#ff00aa');
  grad.addColorStop(1,   '#00fff7');
  vizCtx.strokeStyle = grad;
  vizCtx.lineWidth   = 1.5 + bass * 2;
  vizCtx.shadowColor = '#00fff7';
  vizCtx.shadowBlur  = 8 + bass * 12;
  vizCtx.stroke();
  vizCtx.shadowBlur  = 0;

  return dataArray[4]; // bass
}

// ===== ANIMATION LOOP =====
function animate() {
  state.animFrame = requestAnimationFrame(animate);
  let dataArray = null;
  let bass = 0;

  if (state.analyser && state.isPlaying) {
    dataArray = new Uint8Array(state.analyser.frequencyBinCount);
    state.analyser.getByteFrequencyData(dataArray);
    bass = dataArray[4];
  }

  drawBg(bass);
  drawVisualizer(dataArray);
}
animate();

// ===== AUDIO CONTEXT SETUP =====
function setupAudioContext() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.source) {
    try { state.source.disconnect(); } catch(e) {}
  }
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 256;
  state.source = state.audioCtx.createMediaElementSource(audio);
  state.source.connect(state.analyser);
  state.analyser.connect(state.audioCtx.destination);
}

// ===== FILE LOADING =====
fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  state.playlist = files.map(f => ({
    file: f,
    name: f.name.replace(/\.[^.]+$/, ''),
    url: URL.createObjectURL(f),
    duration: '0:00',
  }));

  renderPlaylist();
  loadTrack(0);
  showToast(`${files.length} ta musiqa yuklandi!`);
});

// ===== PLAYLIST RENDER =====
function renderPlaylist() {
  playlistEl.innerHTML = '';
  state.playlist.forEach((track, i) => {
    const item = document.createElement('div');
    item.className = 'playlist-item' + (i === state.currentIndex ? ' active' : '');
    item.innerHTML = `
      <span class="pl-num">${i+1}</span>
      <span class="pl-title">${track.name}</span>
      <span class="pl-duration">${track.duration}</span>
    `;
    item.addEventListener('click', () => loadTrack(i));
    playlistEl.appendChild(item);
  });
}

// ===== LOAD TRACK =====
function loadTrack(index) {
  if (index < 0 || index >= state.playlist.length) return;
  state.currentIndex = index;

  const track = state.playlist[index];
  audio.src = track.url;
  audio.volume = volumeSlider.value;

  // Parse name: "Artist - Title" or just "Title"
  const parts = track.name.split(' - ');
  if (parts.length >= 2) {
    songArtist.textContent = parts[0].trim().toUpperCase();
    songTitle.textContent  = parts.slice(1).join(' - ').trim().toUpperCase();
  } else {
    songTitle.textContent  = track.name.toUpperCase();
    songArtist.textContent = 'DEXO PHONK';
  }

  renderPlaylist();
  playTrack();
}

// ===== PLAY / PAUSE =====
function playTrack() {
  if (!state.audioCtx) {
    try { setupAudioContext(); } catch(e) { console.warn(e); }
  } else if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }

  audio.play().then(() => {
    state.isPlaying = true;
    playBtn.innerHTML = '&#9646;&#9646;';
    disc.classList.add('spinning');
  }).catch(console.error);
}

function pauseTrack() {
  audio.pause();
  state.isPlaying = false;
  playBtn.innerHTML = '&#9654;';
  disc.classList.remove('spinning');
}

playBtn.addEventListener('click', () => {
  if (!state.playlist.length) {
    showToast("Avval musiqa tanlang!");
    return;
  }
  if (state.currentIndex === -1) { loadTrack(0); return; }
  state.isPlaying ? pauseTrack() : playTrack();
});

prevBtn.addEventListener('click', () => {
  if (!state.playlist.length) return;
  const idx = (state.currentIndex - 1 + state.playlist.length) % state.playlist.length;
  loadTrack(idx);
});

nextBtn.addEventListener('click', () => {
  if (!state.playlist.length) return;
  const idx = (state.currentIndex + 1) % state.playlist.length;
  loadTrack(idx);
});

audio.addEventListener('ended', () => {
  const idx = (state.currentIndex + 1) % state.playlist.length;
  loadTrack(idx);
});

// ===== PROGRESS =====
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  progressFill.style.width  = pct + '%';
  progressThumb.style.left  = pct + '%';
  currentTimeEl.textContent = formatTime(audio.currentTime);
});

audio.addEventListener('loadedmetadata', () => {
  durationEl.textContent = formatTime(audio.duration);
  if (state.playlist[state.currentIndex]) {
    state.playlist[state.currentIndex].duration = formatTime(audio.duration);
    renderPlaylist();
  }
});

progressBar.addEventListener('click', (e) => {
  const rect = progressBar.getBoundingClientRect();
  const pct  = (e.clientX - rect.left) / rect.width;
  audio.currentTime = pct * audio.duration;
});

// ===== VOLUME =====
volumeSlider.addEventListener('input', () => {
  audio.volume = volumeSlider.value;
  const pct = volumeSlider.value * 100;
  volumeSlider.style.background =
    `linear-gradient(90deg, var(--purple) ${pct}%, rgba(139,0,255,0.2) ${pct}%)`;
});

// ===== VIDEO RECORDING =====
// We capture the entire page as a video using canvas + MediaRecorder

async function startRecording() {
  if (!state.playlist.length || state.currentIndex === -1) {
    showToast("Avval musiqa tanlang!");
    return;
  }

  // Combine app canvas stream
  const appCanvas = document.createElement('canvas');
  appCanvas.width  = 480;
  appCanvas.height = 854;
  const appCtx = appCanvas.getContext('2d');

  // Audio stream
  let audioStream = null;
  try {
    if (!state.audioCtx) setupAudioContext();
    const dest = state.audioCtx.createMediaStreamDestination();
    state.analyser.connect(dest);
    audioStream = dest.stream;
  } catch(e) {
    console.warn('Audio stream error:', e);
  }

  // Canvas stream
  const canvasStream = appCanvas.captureStream(30);
  const tracks = [...canvasStream.getTracks()];
  if (audioStream) audioStream.getTracks().forEach(t => tracks.push(t));
  const combinedStream = new MediaStream(tracks);

  // Choose best mime
  const mimeTypes = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
  let mimeType = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';

  state.recordedChunks = [];
  try {
    state.mediaRecorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 4000000 });
  } catch(e) {
    showToast("Brauzer video yozishni qo'llab-quvvatlamaydi!");
    return;
  }

  state.mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) state.recordedChunks.push(e.data);
  };

  state.mediaRecorder.onstop = () => {
    const blob = new Blob(state.recordedChunks, { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    const ext  = mimeType.includes('mp4') ? 'mp4' : 'webm';
    a.download = `phonk_video_${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Video saqlandi! ✅");
  };

  state.mediaRecorder.start(100);
  state.isRecording = true;
  recIndicator.classList.add('show');
  recordBtn.textContent = '⏹ To\'xtatish';
  recordBtn.classList.add('recording');
  state.recordStart = Date.now();

  // Render loop for recording canvas
  const renderLoop = () => {
    if (!state.isRecording) return;

    appCtx.clearRect(0, 0, appCanvas.width, appCanvas.height);
    // Dark bg
    appCtx.fillStyle = '#06000f';
    appCtx.fillRect(0, 0, appCanvas.width, appCanvas.height);

    // Copy bgCanvas
    try { appCtx.drawImage(bgCanvas, 0, 0, appCanvas.width, appCanvas.height); } catch(e){}

    // Center visualizer
    const vizW = 320, vizH = 320;
    const vizX = (appCanvas.width  - vizW) / 2;
    const vizY = (appCanvas.height - vizH) / 2 - 60;
    try { appCtx.drawImage(vizCanvas, vizX, vizY, vizW, vizH); } catch(e){}

    // PHONK text
    appCtx.font = 'bold 32px Orbitron, monospace';
    appCtx.fillStyle = '#bf00ff';
    appCtx.shadowColor = '#8b00ff';
    appCtx.shadowBlur  = 20;
    appCtx.textAlign   = 'center';
    appCtx.fillText('PHONK', appCanvas.width/2, vizY + vizH + 10);
    appCtx.shadowBlur = 0;

    // Song title
    appCtx.font = 'bold 16px Orbitron, monospace';
    appCtx.fillStyle = '#ffffff';
    appCtx.fillText(
      (songTitle.textContent || '').substring(0, 32),
      appCanvas.width/2,
      vizY + vizH + 55
    );

    // Artist
    appCtx.font = '13px Rajdhani, sans-serif';
    appCtx.fillStyle = '#bf00ff';
    appCtx.fillText(songArtist.textContent || '', appCanvas.width/2, vizY + vizH + 78);

    // Progress bar
    const pct = audio.duration ? audio.currentTime / audio.duration : 0;
    const barX = 60, barY = vizY + vizH + 100, barW = appCanvas.width - 120, barH = 4;
    appCtx.fillStyle = 'rgba(139,0,255,0.25)';
    appCtx.roundRect(barX, barY, barW, barH, 2);
    appCtx.fill();
    const grad = appCtx.createLinearGradient(barX, 0, barX+barW, 0);
    grad.addColorStop(0, '#8b00ff');
    grad.addColorStop(1, '#00fff7');
    appCtx.fillStyle = grad;
    appCtx.fillStyle = grad;
    appCtx.roundRect(barX, barY, barW * pct, barH, 2);
    appCtx.fill();

    // Time
    appCtx.font = '11px Orbitron, monospace';
    appCtx.fillStyle = '#9966cc';
    appCtx.textAlign = 'left';
    appCtx.fillText(formatTime(audio.currentTime), barX, barY + 18);
    appCtx.textAlign = 'right';
    appCtx.fillText(formatTime(audio.duration||0), barX+barW, barY + 18);

    // REC badge
    const elapsed = Math.floor((Date.now() - state.recordStart) / 1000);
    appCtx.textAlign = 'right';
    appCtx.font = '12px Orbitron, monospace';
    appCtx.fillStyle = 'red';
    appCtx.fillText(`⏺ REC ${formatTime(elapsed)}`, appCanvas.width - 20, 30);

    requestAnimationFrame(renderLoop);
  };
  renderLoop();

  showToast("Video yozish boshlandi! 🔴");
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  state.isRecording = false;
  recIndicator.classList.remove('show');
  recordBtn.textContent = '⭐ Video saqlash';
  recordBtn.classList.remove('recording');
}

recordBtn.addEventListener('click', () => {
  state.isRecording ? stopRecording() : startRecording();
});

saveVideoBtn.addEventListener('click', () => {
  state.isRecording ? stopRecording() : startRecording();
});

// ===== UTILS =====
function formatTime(sec) {
  if (isNaN(sec) || sec === Infinity) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ===== IDLE ANIMATION =====
// Even without music, draw idle visualizer
(function idleAnimate() {
  if (!state.isPlaying) {
    drawBg(0);
    drawVisualizer(null);
  }
  setTimeout(idleAnimate, 100);
})();
