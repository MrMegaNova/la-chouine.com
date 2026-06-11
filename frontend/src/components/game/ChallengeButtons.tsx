import { useAuthStore } from '@/store/authStore';
import { useOnlineStore } from '@/store/onlineStore';
import type { Friend } from '@/api/client';
import type { Variant } from '@/game/types';

// Boutons de défi d'un ami (#45/#47) : amicale (défaut, sans Elo) ou classée.
// Grisés si l'ami est hors ligne ou déjà en partie (#46).
export function ChallengeButtons({ friend, variant }: { friend: Friend; variant: Variant }) {
  const { token } = useAuthStore();
  const challengeFriend = useOnlineStore(s => s.challengeFriend);
  const busy = useOnlineStore(s => s.outgoingChallenge !== null || s.status !== 'idle');

  if (!token) return null;
  const unavailable = !friend.online || friend.inGame;
  const disabled = unavailable || busy;
  const reason = friend.inGame ? `${friend.username} est en partie`
    : !friend.online ? `${friend.username} est hors ligne`
    : busy ? 'Un défi ou une partie est déjà en cours' : undefined;
  const dimmed = disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined;

  const defy = (rated: boolean) =>
    challengeFriend(friend.id, friend.username, variant, rated, token);

  return (
    <>
      <button
        className="btn btn--ghost btn--sm"
        disabled={disabled}
        style={dimmed}
        title={reason ?? 'Partie amicale — sans incidence sur le classement Elo'}
        onClick={() => defy(false)}
      >🤝 Amicale</button>
      <button
        className="btn btn--gold btn--sm"
        disabled={disabled}
        style={dimmed}
        title={reason ?? 'Partie classée — votre Elo est en jeu'}
        onClick={() => defy(true)}
      >⚔ Classée</button>
    </>
  );
}
