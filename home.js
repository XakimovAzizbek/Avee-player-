const fileInput = document.getElementById('file-input');
const audio = document.getElementById('audio');
const canvas = document.getElementById('canvas');
const trackName = document.getElementById('track-name');
const recordBtn = document.getElementById('record-btn');
const ctx = canvas.getContext('2d');

let audioCtx = null;
let audioSource, analyser, bufferLength, dataArray, audioDestination;
let particles = [];
let isContextInitialized = false;

// Yozib olish (Recorder) o'zgaruvchilari
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Zarralar (Particles) klassi
class Particle {
    constructor() {
        this.reset();
    }
    reset() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 2 + 0.5;
        this.speedX = (Math.random() - 0.5) * 0.5;
        this.speedY = -Math.random() * 0.8 - 0.2;
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

for (let i = 0; i < 100; i++) {
    particles.push(new Particle());
}

// Fayl yuklanganda
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
    recordBtn.disabled = false; // Musiqa yuklangach yozish tugmasini faollashtirish
});

// Audio tizimini yozib olish oqimi bilan birga sozlash
function initAudio() {
    if (isContextInitialized) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audio.crossOrigin = "anonymous"; 
    
    audioSource = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    
    // Audio oqimini yozib olish uchun maxsus manzil yaratamiz
    audioDestination = audioCtx.createMediaStreamDestination();
    
    // Ovozni ham karnayga (destination), ham yozuvchiga (audioDestination) yuboramiz
    audioSource.connect(analyser);
    analyser.connect(audioCtx.destination);
    audioSource.connect(audioDestination);
    
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
    if (!isContextInitialized || (audio.paused && !isRecording)) return;
    
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

    const baseRadius = 110 + (bass * 0.25);

    ctx.shadowBlur = 20;
    ctx.shadowColor = '#00f2fe';

    const barCount = 160; 
    for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i / barCount) * bufferLength * 0.75);
        const value = dataArray[dataIndex];
        const barLen = (value / 255) * 110;
        const angle = (i / barCount) * Math.PI * 2;

        const x1 = centerX + Math.cos(angle) * baseRadius;
        const y1 = centerY + Math.sin(angle) * baseRadius;
        const x2 = centerX + Math.cos(angle) * (baseRadius + barLen);
        const y2 = centerY + Math.sin(angle) * (baseRadius + barLen);

        ctx.strokeStyle = `hsl(${(i / barCount) * 360}, 100%, 60%)`;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.shadowBlur = 0;
}

// VIDEO VA AUDIO YOLG'ALIKDA YOZIB OLISH FUNKSIYASI
recordBtn.addEventListener('click', () => {
    initAudio(); // Kafolatlash uchun

    if (!isRecording) {
        // Yozishni boshlash
        recordedChunks = [];
        
        // Canvasdan video oqimini olish (30 FPS tezlikda)
        const canvasStream = canvas.captureStream(30);
        
        // Audio oqimini olish
        const audioStream = audioDestination.stream;
        
        // Video va Audioni bitta oqimga birlashtirish
        const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioStream.getAudioTracks()
        ]);

        // Brauzer qo'llab-quvvatlaydigan formatni aniqlash
        let options = { mimeType: 'video/webm;codecs=vp9,opus' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = { mimeType: 'video/webm;codecs=vp8,opus' };
        }

        mediaRecorder = new MediaRecorder(combinedStream, options);

        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };

        // Yozuv tugagach avtomatik yuklab olish mantiqi
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            
            // Yuklab olish uchun vaqtinchalik havola yaratish
            const a = document.createElement('a');
            a.href = url;
            a.download = `${trackName.innerText || 'visualizer_video'}.mp4`;
            document.body.appendChild(a);
            a.click();
            
            // Tozalash
            setTimeout(() => {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }, 100);
        };

        // Yozishni boshlash va musiqani qo'yish
        mediaRecorder.start();
        audio.play();
        
        isRecording = true;
        recordBtn.innerText = "Yozishni to'xtatish";
        recordBtn.classList.add('recording-active');
    } else {
        // Yozishni to'xtatish
        mediaRecorder.stop();
        audio.pause();
        
        isRecording = false;
        recordBtn.innerText = "Yozishni boshlash";
        recordBtn.classList.remove('recording-active');
    }
});
