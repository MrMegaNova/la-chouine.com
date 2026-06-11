// Pastille de présence d'un ami (#46) : en partie, en ligne ou hors ligne.
// Les données viennent de GET /api/friends (amis acceptés uniquement).
export function PresenceDot({ online, inGame }: { online: boolean; inGame: boolean }) {
  const label = inGame ? 'En partie' : online ? 'En ligne' : 'Hors ligne';
  return (
    <span
      title={label}
      aria-label={label}
      style={{ fontSize: 11, marginRight: 6, verticalAlign: 'middle' }}
    >
      {inGame ? '🎴' : online ? '🟢' : '⚪'}
    </span>
  );
}
