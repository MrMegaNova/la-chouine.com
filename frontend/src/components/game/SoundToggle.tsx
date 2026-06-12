import { useEffect, useRef, useState } from 'react';
import { useSoundStore } from '@/store/soundStore';
import { playSound, unlockAudio } from '@/sound/sounds';

// Réglage audio en partie (#155) : bouton son qui ouvre un petit panneau (muet
// + volume). Réglages persistés ; toute interaction déverrouille le contexte
// audio (mobile).
export function SoundToggle() {
  const { muted, volume, toggleMuted, setVolume } = useSoundStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Ferme le panneau au clic extérieur / Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className="btn btn--ghost btn--sm"
        aria-label="Réglages du son"
        aria-expanded={open}
        title={muted ? 'Son coupé' : 'Son activé'}
        onClick={() => { unlockAudio(); setOpen(o => !o); }}
      >
        {muted ? '🔇' : '🔊'}
      </button>

      {open && (
        <span
          style={{
            position: 'absolute', top: '115%', right: 0, zIndex: 30,
            background: '#102a20', border: '1px solid var(--gold)', borderRadius: 12,
            padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 180,
          }}
        >
          <button
            className={`btn btn--sm ${muted ? 'btn--gold' : 'btn--ghost'}`}
            aria-pressed={muted}
            onClick={() => { unlockAudio(); toggleMuted(); if (muted) playSound('play'); }}
          >
            {muted ? '🔇 Son coupé — réactiver' : '🔊 Couper le son'}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, opacity: muted ? 0.5 : 1 }}>
            Volume
            <input
              type="range" min={0} max={1} step={0.05} value={volume} disabled={muted}
              aria-label="Volume des effets sonores"
              onChange={e => { unlockAudio(); setVolume(Number(e.target.value)); }}
              onMouseUp={() => !muted && playSound('play')}
              style={{ flex: 1 }}
            />
          </label>
        </span>
      )}
    </span>
  );
}
