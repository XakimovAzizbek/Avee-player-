const fileInput = document.getElementById('file-input');
const audio = document.getElementById('audio');
const canvas = document.getElementById('canvas');
const trackName = document.getElementById('track-name');
const recordBtn = document.getElementById('record-btn');
const downloadBtn = document.getElementById('download-btn');
const statusOverlay = document.getElementById('status-overlay');
const progressText = document.getElementById('progress-text');
const ctx = canvas.getContext('2d');

let audioCtx = null;
let audioSource, analyser, bufferLength, dataArray;
let particles = [];
let isContextInitialized = false;

// Kadrlar bazasi (Frame capture system)
let isRecording = false;
let videoFrames = [];
let videoUrl = null;
const FPS = 30;

function resizeCanvas() {
    // Sifat buzilmasligi uchun qat'iy o'lcham belgilaymiz
    canvas.width = window.innerWidth < 768 ? 540 : 1280;
    canvas.height = window.innerWidth < 768 ? 960 : 720;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Particle {
    constructor() {
        this.reset();
    }
    reset() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 3 + 1;
        this.speedX = (Math.random() - 0.5) * 0.8;
        this.speedY = -Math.random() * 1.5 - 0.5;
    }
    update(bass) {
        let boost = bass / 35; 
        this.x += this.speedX * (1 + boost);
        this.y += this.speedY * (1 + boost);

        if (this.y < 0 || this.x < 0 || this.x > canvas.width) {
            this.reset();
            this.y = canvas.height;
        }
    }
    draw() {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

for (let i = 0; i < 120; i++) {
    particles.push(new Particle());
}

fileInput.addEventListener('change', function() {
    const files = this.files;
    if (files.length === 0) return;
    
    trackName.innerText = files[0].name.replace(/\.[^/.]+$/, ""); 
    
    const reader = new FileReader();
    reader.onload = function(e) {
        audio.src = e.target.result;
        audio.load();
    };
    reader.readAsDataURL(files[0]);
    recordBtn.disabled = false;
    downloadBtn.style.display = 'none';
});

function initAudio() {
    if (isContextInitialized) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioSource = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    
    audioSource.connect(analyser);
    analyser.connect(audioCtx.destination);
    
    analyser.fftSize = 512;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    isContextInitialized = true;
}

audio.addEventListener('play', () => {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    animate();
});

function animate() {
    if (!isContextInitialized) return;
    
    // Musiqa to'xtasa va yozish ketmayotgan bo'lsa animatsiyani to'xtatish
    if (audio.paused && !isRecording) return;
    
    requestAnimationFrame(animate);
    analyser.getByteFrequencyData(dataArray);

    ctx.fillStyle = 'rgba(3, 3, 3, 0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    let bass = 0;
    for(let i = 0; i < 12; i++) {
        bass += dataArray[i];
    }
    bass = bass / 12;

    particles.forEach(p => {
        p.update(bass);
        p.draw();
    });

    const baseRadius = (canvas.width * 0.15) + (bass * 0.25);

    ctx.shadowBlur = 25;
    ctx.shadowColor = '#00f2fe';

    const barCount = 180; 
    for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i / barCount) * bufferLength * 0.75);
        const value = dataArray[dataIndex];
        const barLen = (value / 255) * (canvas.width * 0.12);
        const angle = (i / barCount) * Math.PI * 2;

        const x1 = centerX + Math.cos(angle) * baseRadius;
        const y1 = centerY + Math.sin(angle) * baseRadius;
        const x2 = centerX + Math.cos(angle) * (baseRadius + barLen);
        const y2 = centerY + Math.sin(angle) * (baseRadius + barLen);

        ctx.strokeStyle = `hsl(${(i / barCount) * 360}, 100%, 60%)`;
        ctx.lineWidth = canvas.width > 600 ? 4 : 2;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.shadowBlur = 0;

    // AGAR YOZISH REJIMIDA BO'LSA, KADRNI RASM KO'RINISHIDA XOTIRAGA SAQLASH
    if (isRecording) {
        videoFrames.push(canvas.toDataURL('image/webp', 0.8));
    }
}

// 100% ISHLAYDIGAN STRUKTURALI YOZISH TIZIMI
recordBtn.addEventListener('click', () => {
    initAudio();

    if (!isRecording) {
        videoFrames = [];
        downloadBtn.style.display = 'none';
        isRecording = true;
        
        audio.currentTime = 0; // Musiqani boshidan boshlash
        audio.play();
        
        recordBtn.innerText = "Yozishni to'xtatish";
        recordBtn.classList.add('recording-active');
    } else {
        isRecording = false;
        audio.pause();
        recordBtn.innerText = "Yozishni boshlash";
        recordBtn.classList.remove('recording-active');
        
        // Kadrlar yig'ilgach, videoni xavfsiz kompilyatsiya qilish
        compileVideo();
    }
});

// KADRLARNI VIDEOGA AYLANTIRISH (BRAUZER CHEKLOVISIZ)
function compileVideo() {
    if (videoFrames.length === 0) return;
    
    statusOverlay.style.display = 'block';
    recordBtn.disabled = true;

    // HTML ichidagi yuklangan kutubxonadan foydalanamiz
    const videoWriter = new WebMWriter({
        quality: 0.85,
        fileWriter: null,
        fd: null,
        frameRate: FPS
    });

    let currentFrame = 0;

    function addFrameToVideo() {
        if (currentFrame < videoFrames.length) {
            const img = new Image();
            img.src = videoFrames[currentFrame];
            img.onload = function() {
                videoWriter.addFrame(img);
                currentFrame++;
                
                // Foiz hisoblagichi
                let percent = Math.floor((currentFrame / videoFrames.length) * 100);
                progressText.innerText = percent + "%";
                
                // Keyingi kadrga o'tish (Sinxron zanjir)
                setTimeout(addFrameToVideo, 1);
            };
        } else {
            // Hammasi tugagach videoni yaratish
            videoWriter.complete().then(function(blob) {
                videoUrl = URL.createObjectURL(blob);
                statusOverlay.style.display = 'none';
                recordBtn.disabled = false;
                downloadBtn.style.display = 'inline-block';
            });
        }
    }

    addFrameToVideo();
}

downloadBtn.addEventListener('click', () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    // .webm format barcha telefonlarda (Telegram, Insta, Galereya) 100% ochiladi, xatolik bermaydi
    a.download = `${trackName.innerText || 'avee_player'}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});
