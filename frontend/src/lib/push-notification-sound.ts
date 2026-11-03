const MIN_PLAYBACK_GAP_MS = 900;

let sharedAudioContext: AudioContext | null = null;
let lastPlaybackAt = 0;

function resolveAudioContextConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  const audioWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };

  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

function getAudioContext() {
  const AudioContextConstructor = resolveAudioContextConstructor();

  if (!AudioContextConstructor) {
    return null;
  }

  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextConstructor();
  }

  return sharedAudioContext;
}

export async function primePushNotificationSound() {
  const audioContext = getAudioContext();

  if (!audioContext) {
    return false;
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return audioContext.state === "running";
}

function scheduleTone(
  audioContext: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  gainAmount: number,
) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  oscillator.detune.setValueAtTime(-4, startAt);

  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(gainAmount, startAt + 0.018);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.03);
}

export async function playPushNotificationSound() {
  const audioContext = getAudioContext();

  if (!audioContext) {
    return;
  }

  const now = performance.now();
  if (now - lastPlaybackAt < MIN_PLAYBACK_GAP_MS) {
    return;
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  if (audioContext.state !== "running") {
    return;
  }

  lastPlaybackAt = now;

  const baseTime = audioContext.currentTime + 0.01;
  scheduleTone(audioContext, 659.25, baseTime, 0.18, 0.055);
  scheduleTone(audioContext, 830.61, baseTime + 0.11, 0.16, 0.045);
  scheduleTone(audioContext, 987.77, baseTime + 0.22, 0.22, 0.04);
}
