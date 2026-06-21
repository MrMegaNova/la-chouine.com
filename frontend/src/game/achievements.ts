// Catalogue des badges (#217) — miroir de `backend/src/services/achievements.js`.
// Le backend reste l'autorité (attribution + déblocage) ; ce fichier ne sert qu'à
// l'AFFICHAGE (libellé, description, icône, ordre). Garder les CODES synchronisés.

export interface AchievementDef {
  code: string;
  label: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // Assiduité
  { code: 'premiere-partie',   label: 'Première partie',    description: 'Jouer votre toute première partie.',      icon: '🎴' },
  { code: 'habitue',           label: 'Habitué',            description: 'Jouer 10 parties.',                       icon: '🃏' },
  { code: 'pilier',            label: 'Pilier',             description: 'Jouer 50 parties.',                       icon: '🛡️' },
  { code: 'veteran',           label: 'Vétéran',            description: 'Jouer 100 parties.',                      icon: '🏛️' },
  { code: 'legende',           label: 'Légende',            description: 'Jouer 500 parties.',                      icon: '👑' },
  // Performance
  { code: 'premiere-victoire', label: 'Première victoire',  description: 'Remporter votre première partie.',        icon: '🥇' },
  { code: 'gagnant',           label: 'Gagnant',            description: 'Remporter 10 parties.',                   icon: '🏆' },
  { code: 'champion',          label: 'Champion',           description: 'Remporter 100 parties.',                  icon: '🌟' },
  // Classement
  { code: 'classe-1600',       label: 'Classé 1600',        description: 'Atteindre 1600 d’Elo dans une variante.',  icon: '📈' },
  { code: 'expert-1800',       label: 'Expert 1800',        description: 'Atteindre 1800 d’Elo dans une variante.',  icon: '⚔️' },
  { code: 'maitre-2000',       label: 'Maître 2000',        description: 'Atteindre 2000 d’Elo dans une variante.',  icon: '💎' },
  // Variantes
  { code: 'ambidextre',        label: 'Ambidextre',         description: 'Gagner au moins une partie en Classique ET en Mondoubleau.', icon: '🔄' },
  // Jours de jeu
  { code: 'joueur-weekend',    label: 'Joueur du week-end', description: 'Jouer une partie un samedi ou un dimanche.', icon: '🌅' },
  { code: 'jour-ferie',        label: 'Jour férié',         description: 'Jouer une partie un jour férié.',          icon: '🎉' },
  { code: 'assidu',            label: 'Assidu',             description: 'Jouer 3 jours consécutifs.',               icon: '🔥' },
  // Faits de jeu (PvP)
  { code: 'partie-blanche',    label: 'Partie blanche',     description: 'Gagner une partie classée sans que l’adversaire ne remporte une manche.', icon: '⬜' },
  { code: 'chouine-faite',     label: 'Chouine !',          description: 'Réaliser une chouine en partie classée.', icon: '🦉' },
];
