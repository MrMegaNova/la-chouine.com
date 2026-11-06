// Effets sonores du jeu (#155).
//  • cartes (donne, carte posée, pioche, pli ramassé) : enregistrements Kenney
//    « Casino Audio » (CC0, voir kenney/LICENSE.txt), plusieurs variantes tirées
//    au hasard pour éviter la répétition ;
//  • annonce (« feutre ») et fin de match (« fanfare ») : sons générés.
// Tout est défensif : sans Web Audio, ou si un fichier ne se charge pas, le jeu
// continue en silence. Rien n'est créé avant le premier geste du joueur
// (politique d'autoplay des navigateurs, iPhone compris).

import { useSoundStore } from '@/store/soundStore';
import place1 from './kenney/card-place-1.mp3';
import place2 from './kenney/card-place-2.mp3';
import place3 from './kenney/card-place-3.mp3';
import place4 from './kenney/card-place-4.mp3';
import slide1 from './kenney/card-slide-1.mp3';
import slide2 from './kenney/card-slide-2.mp3';
import slide3 from './kenney/card-slide-3.mp3';
import slide4 from './kenney/card-slide-4.mp3';
import slide5 from './kenney/card-slide-5.mp3';
import slide6 from './kenney/card-slide-6.mp3';
import slide7 from './kenney/card-slide-7.mp3';
import slide8 from './kenney/card-slide-8.mp3';
import shove1 from './kenney/card-shove-1.mp3';
import shove2 from './kenney/card-shove-2.mp3';
import shove3 from './kenney/card-shove-3.mp3';
import shove4 from './kenney/card-shove-4.mp3';

export type SoundName = 'deal' | 'play' | 'draw' | 'collect' | 'announce' | 'win' | 'lose';

const PLACE = [place1, place2, place3, place4];
const SLIDE = [slide1, slide2, slide3, slide4, slide5, slide6, slide7, slide8];
const SHOVE = [shove1, shove2, shove3, shove4];
const VOLUME = 0.6;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

/**
 * À appeler sur un geste du joueur (clic, toucher) : crée ou réveille le
 * contexte audio. Sans geste, les navigateurs gardent le son bloqué.
 */
export function unlockAudio(): void {
  if (useSoundStore.getState().muted) return;
  const c = audioContext();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

function load(url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (!p) {
    const c = audioContext();
    p = !c ? Promise.resolve(null) : fetch(url)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(url))))
      .then(b => new Promise<AudioBuffer>((ok, ko) => c.decodeAudioData(b, ok, ko)))
      .catch(() => null);
    buffers.set(url, p);
  }
  return p;
}

/** Précharge les enregistrements (à l'ouverture de la table de jeu). */
export function preloadSounds(): void {
  if (!audioContext()) return;
  for (const url of [...PLACE, ...SLIDE, ...SHOVE]) load(url);
}

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

function sample(url: string, at = 0, gain = 1) {
  load(url).then(buf => {
    // Le son a pu être coupé pendant le chargement du fichier.
    if (!buf || !ctx || !master || useSoundStore.getState().muted) return;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buf;
    g.gain.value = gain;
    src.connect(g).connect(master);
    src.start(ctx.currentTime + at);
  }).catch(() => {});
}

interface Note {
  at?: number; freq: number; dur: number; type?: OscillatorType; gain: number;
  attack?: number; slide?: number; filter?: [number, number];
}

function tone({ at = 0, freq, dur, type = 'sine', gain, attack = 0.005, slide, filter }: Note) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + at;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(gain, t + attack);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  out.connect(master);
  let dest: AudioNode = out;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filter[0], t);
    f.frequency.exponentialRampToValueAtTime(filter[1], t + dur);
    f.connect(out);
    dest = f;
  }
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  o.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const C4 = 261.63, E4 = 329.63, F4 = 349.23, Fs4 = 369.99, G4 = 392, C5 = 523.25, E5 = 659.25, A5 = 880, E6 = 1318.5;
const brass = (at: number, freq: number, dur: number, gain = 0.12, slide?: number) =>
  tone({ at, freq, dur, type: 'sawtooth', gain, attack: 0.03, filter: [900, 2400], slide });

const PLAYERS: Record<SoundName, () => void> = {
  deal: () => { for (let i = 0; i < 5; i++) sample(pick(SLIDE), i * 0.12, 0.8); },
  play: () => sample(pick(PLACE)),
  draw: () => sample(pick(SLIDE)),
  collect: () => sample(pick(SHOVE)),
  // « Feutre » : deux notes douces.
  announce: () => { tone({ freq: A5, dur: 0.35, gain: 0.12 }); tone({ at: 0.12, freq: E6, dur: 0.45, gain: 0.1 }); },
  // « Fanfare » : petite fanfare pour la victoire…
  win: () => {
    brass(0, C4, 0.12); brass(0.13, C4, 0.12); brass(0.26, C4, 0.12);
    brass(0.4, G4, 0.5); brass(0.4, E5 / 2, 0.5, 0.08);
    brass(0.95, C5, 0.8, 0.11); brass(0.95, E5, 0.8, 0.07);
  },
  // … et « wah-wah » de trombone pour la défaite.
  lose: () => { brass(0, G4, 0.35, 0.12, Fs4); brass(0.4, F4, 0.35, 0.12, E4); brass(0.8, E4, 0.9, 0.12, C4 * 0.94); },
};

/** Joue un son, sauf si le joueur a coupé le son. Ne lève jamais d'erreur. */
export function playSound(name: SoundName, delay = 0): void {
  if (useSoundStore.getState().muted) return;
  try {
    const c = audioContext();
    if (!c || c.state === 'closed') return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    if (delay > 0) {
      setTimeout(() => {
        if (useSoundStore.getState().muted) return; // coupé entre-temps
        try { PLAYERS[name](); } catch { /* silence */ }
      }, delay);
    }
    else PLAYERS[name]();
  } catch {
    // Le son n'est qu'un plus : on n'interrompt jamais le jeu.
  }
}
