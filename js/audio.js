let audioCtx = null;
function initAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }

export function playClick() {
  initAudio();
  if(audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine'; osc.frequency.setValueAtTime(600, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.1);
  gain.gain.setValueAtTime(0.1, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
  osc.connect(gain); gain.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + 0.1);
}

export function playSuccess() {
  initAudio();
  if(audioCtx.state === 'suspended') audioCtx.resume();
  [523.25, 783.99].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle'; osc.frequency.value = freq;
    const startTime = audioCtx.currentTime + (i * 0.15);
    gain.gain.setValueAtTime(0, startTime); gain.gain.linearRampToValueAtTime(0.2, startTime + 0.05); gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.5);
    osc.connect(gain); gain.connect(audioCtx.destination); osc.start(startTime); osc.stop(startTime + 0.5);
  });
}