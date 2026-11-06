import { useSoundStore } from '@/store/soundStore';
import { unlockAudio } from '@/sound/sounds';

// Bouton son de la table de jeu (#155) : coupe ou rétablit tous les effets
// sonores ; le choix est mémorisé.
export function SoundToggle() {
  const muted = useSoundStore(s => s.muted);
  const toggleMuted = useSoundStore(s => s.toggleMuted);
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      aria-pressed={!muted}
      aria-label={muted ? 'Activer le son' : 'Couper le son'}
      onClick={() => { toggleMuted(); unlockAudio(); }}
    >
      <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span> {muted ? 'Son coupé' : 'Son'}
    </button>
  );
}
