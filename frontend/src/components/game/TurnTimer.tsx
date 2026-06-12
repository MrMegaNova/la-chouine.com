import { useEffect, useState } from 'react';
import { useOnlineStore } from '@/store/onlineStore';

// Horloge de coup (#141) — visible des deux joueurs en partie classée. Le
// serveur pousse le temps restant à chaque snapshot ; on décompte localement
// entre deux (sans dépasser, le serveur reste la référence). Affiche qui joue,
// le temps restant, la réserve, et l'état « en pause » (adversaire déconnecté).
export function TurnTimer({ me, names }: { me: number; names: string[] }) {
  const clock = useOnlineStore(s => s.clock);
  const [, tick] = useState(0);

  // Re-rendu chaque 250 ms pour faire avancer le décompte local.
  useEffect(() => {
    if (!clock || clock.paused || clock.seat === null) return;
    const id = setInterval(() => tick(t => t + 1), 250);
    return () => clearInterval(id);
  }, [clock]);

  // Ancre le décompte sur l'instant de réception du snapshot.
  const [anchor, setAnchor] = useState<{ at: number; remaining: number } | null>(null);
  useEffect(() => {
    if (clock && clock.remainingMs !== null) setAnchor({ at: Date.now(), remaining: clock.remainingMs });
  }, [clock?.remainingMs, clock?.seat, clock?.paused]);

  if (!clock || clock.seat === null) return null;

  const remaining = clock.paused
    ? (clock.remainingMs ?? 0)
    : Math.max(0, (anchor?.remaining ?? clock.remainingMs ?? 0) - (Date.now() - (anchor?.at ?? Date.now())));
  const secs = Math.ceil(remaining / 1000);
  const mine = clock.seat === me;
  const low = !clock.paused && remaining <= 10_000;
  const reserve = Math.round((clock.reserveMs[clock.seat] ?? 0) / 1000);

  return (
    <div
      role="timer"
      aria-label={`Temps restant : ${secs} secondes`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '4px 12px', borderRadius: 20,
        border: `1px solid ${low ? 'var(--wine-2, #c0392b)' : 'var(--line)'}`,
        background: mine ? 'rgba(201,161,74,.14)' : 'rgba(247,240,223,.04)',
        fontSize: 13, color: 'var(--cream)',
      }}
    >
      {clock.paused ? (
        <span className="note" style={{ fontSize: 12.5 }}>⏸ En pause (adversaire déconnecté)</span>
      ) : (
        <>
          <span aria-hidden="true">⏱</span>
          <b style={{
            fontVariantNumeric: 'tabular-nums',
            color: low ? 'var(--wine-2, #e74c3c)' : 'var(--gold-soft)',
            minWidth: 28, textAlign: 'right',
          }}>{secs}s</b>
          <span className="note" style={{ fontSize: 12 }}>
            {mine ? 'à vous' : `${names[clock.seat] ?? 'adversaire'}`}
            {reserve > 0 ? ` · réserve ${reserve}s` : ''}
          </span>
        </>
      )}
    </div>
  );
}
