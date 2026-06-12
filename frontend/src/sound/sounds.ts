import { useSoundStore } from '@/store/soundStore';

// Effets sonores du jeu (#155) — synthétisés via la Web Audio API : aucun
// fichier à charger ni à licencier. Tout est défensif : si l'audio n'est pas
// disponible ou échoue, on ne fait rien (jamais bloquant pour le jeu).

export type SoundName = 'deal' | 'play' | 'trick' | 'win' | 'lose';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
  }
  // Le contexte démarre « suspended » tant qu'aucun geste utilisateur n'a eu
  // lieu ; les sons sont déclenchés par des actions de jeu (post-clic) → resume.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Déverrouille l'audio dès la première interaction (utile sur mobile/iOS).
export function unlockAudio() {
  audio();
}

// Court bruit blanc (pour les « frottements » de cartes).
function noiseBurst(ac: AudioContext, master: number, t: number, {
  dur = 0.09, freq = 1800, q = 0.8, gain = 0.5,
}: { dur?: number; freq?: number; q?: number; gain?: number }) {
  const frames = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src = ac.createBufferSource();
  src.buffer = buffer;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ac.createGain();
  const peak = gain * master;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// Note pure avec enveloppe douce (pour victoire/défaite).
function tone(ac: AudioContext, master: number, t: number, {
  freq, dur = 0.16, gain = 0.3, type = 'sine', glideTo,
}: { freq: number; dur?: number; gain?: number; type?: OscillatorType; glideTo?: number }) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  const g = ac.createGain();
  const peak = gain * master;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function playSound(name: SoundName) {
  const { muted, volume } = useSoundStore.getState();
  if (muted || volume <= 0) return;
  const ac = audio();
  if (!ac) return;
  const m = volume;
  const t = ac.currentTime;

  try {
    switch (name) {
      case 'play': // carte posée sur le tapis : « slap » mat
        noiseBurst(ac, m, t, { dur: 0.08, freq: 1700, q: 0.7, gain: 0.55 });
        break;
      case 'deal': // distribution : petite rafale de cartes
        for (let i = 0; i < 4; i++) {
          noiseBurst(ac, m, t + i * 0.07, { dur: 0.06, freq: 2000 + i * 120, q: 0.9, gain: 0.32 });
        }
        break;
      case 'trick': // pli ramassé / pioche : frottement plus grave et doux
        noiseBurst(ac, m, t, { dur: 0.14, freq: 900, q: 0.5, gain: 0.4 });
        break;
      case 'win': // arpège majeur ascendant
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          tone(ac, m, t + i * 0.12, { freq: f, dur: 0.2, gain: 0.26, type: 'triangle' }));
        break;
      case 'lose': // descente mineure, plus sourde
        [392, 329.63, 261.63].forEach((f, i) =>
          tone(ac, m, t + i * 0.16, { freq: f, dur: 0.26, gain: 0.24, type: 'sine' }));
        break;
    }
  } catch {
    /* audio non bloquant */
  }
}
