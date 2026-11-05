import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useGameStore } from '@/store/gameStore';
import { useOnlineStore } from '@/store/onlineStore';
import type { Difficulty, GameOpts, Variant } from '@/game/types';

export interface AiSettings {
  variant: Variant;
  playerCount: 2 | 3 | 4;
  diff: Difficulty;
  target: 3 | 5;
}

// Réglages du lancement en un clic (#253), aussi présélectionnés sur /jouer.
export const DEFAULT_AI_SETTINGS: AiSettings = {
  variant: 'classic',
  playerCount: 2,
  diff: 'normal',
  target: 3,
};

// Lancement d'une partie locale, partagé entre l'accueil et /jouer.
export function useGameLauncher() {
  const user = useAuthStore(s => s.user);
  const navigate = useNavigate();

  const launch = (opts: GameOpts) => {
    // Après un retour navigateur, la page repasse sous la table de jeu et ses
    // boutons restent atteignables au clavier : ne jamais écraser la partie en
    // cours. Une partie locale est rejointe, une partie en ligne reste à l'écran.
    if (useOnlineStore.getState().status !== 'idle') return;
    const { game, startGame } = useGameStore.getState();
    if (!game) startGame(opts);
    navigate('/jeu');
  };

  const startAI = ({ variant, playerCount, diff, target }: AiSettings = DEFAULT_AI_SETTINGS) => {
    const names = [user?.username ?? 'Vous'];
    for (let i = 1; i < playerCount; i++)
      names.push(playerCount > 2 ? `Ordinateur ${i}` : 'Ordinateur');
    launch({ mode: 'ai', variant, playerCount, diff, target, names });
  };

  return { launch, startAI };
}
