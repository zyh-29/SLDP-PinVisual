/**
 * Browser version of cue.ts: a short tone, rising when listening starts and falling when it stops (and a buzz on
 * phones that can). No words: they would be heard by the microphone, and talk over a screen reader.
 */
let audio: AudioContext | null = null;

export function listeningCue(kind: 'start' | 'stop') {
  try {
    navigator.vibrate?.(kind === 'start' ? 40 : 20);
  } catch {
    // No vibration here.
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const [from, to] = kind === 'start' ? [660, 990] : [990, 660];
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.linearRampToValueAtTime(to, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  } catch {
    // No sound here: the button's label still says whether it is listening.
  }
}
