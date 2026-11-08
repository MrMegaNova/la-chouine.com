import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '@/store/gameStore';
import { EndOfMatchPrompt } from './EndOfMatchPrompt';
import type { GameState, HandResult as HandResultType } from '@/game/types';

interface Props {
  result: HandResultType;
  game: GameState;
  onNext: () => void;
  token: string | null;
  userId: string | null;
  // En PvP online, la progression (main suivante / rejouer / accueil) passe par
  // le serveur via ces callbacks. Sinon, comportement local (store).
  online?: {
    nextHand: () => void;
    rematch: () => void;
    home: () => void;
  };
}

function initials(n: string): string {
  return n.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').slice(0, 2).toUpperCase();
}

export function HandResult({ result, game, onNext, token, userId, online }: Props) {
  const { newHand, quitGame, startGame, recordMatchEnd } = useGameStore();
  const navigate = useNavigate();
  const matchOver = result.matchWinner !== null;

  // Match local terminé (#290) : enregistré une seule fois, dès l'affichage du
  // résultat, quel que soit le bouton choisi ensuite. Sans compte, la partie est
  // gardée dans le navigateur jusqu'à la connexion.
  useEffect(() => {
    if (!online && matchOver) void recordMatchEnd(token, userId);
  }, [online, matchOver, recordMatchEnd, token, userId]);

  // Online : l'enregistrement classé (Elo) est déjà fait côté serveur ; la main
  // suivante n'est distribuée qu'une fois les deux joueurs prêts (le serveur
  // pousse alors le nouvel état, qui efface ce résultat).
  const handleNext = online ? online.nextHand : () => { onNext(); newHand(); };
  const handleRematch = online ? online.rematch : () => { onNext(); startGame(game.opts); };
  const handleHome = online ? online.home : () => { onNext(); quitGame(); };
  const handleAccount = (tab: 'inscription' | 'connexion') => {
    onNext();
    quitGame();
    navigate(tab === 'inscription' ? '/connexion?onglet=inscription' : '/connexion');
  };

  const { winner, forced, matchWinner, cp, ann, der, tot } = result;

  const playerRows = game.names.map((name, p) => (
    <div key={p} className="list-row">
      <div className="list-row__avatar">{winner === p ? '🏆' : initials(name)}</div>
      <div className="list-row__meta">
        <b className="list-row__name">{name}</b>
        <span className="list-row__sub">
          {cp[p]} pts cartes
          {ann[p] > 0 && ` · +${ann[p]} annonces`}
          {der === p && ' · +10 der'}
        </span>
      </div>
      <div className="list-row__actions">
        <div className="score-pill"><b>{tot[p]}</b></div>
      </div>
    </div>
  ));

  const scoreDisplay = game.names.map((name, i) => (
    <div key={i} className="score-pill">
      <span>{name}</span>
      <b>{game.scores[i]}</b>
    </div>
  ));

  let headline: React.ReactNode;
  if (matchWinner !== null) {
    headline = (
      <>
        <div className="endbig win">{game.names[matchWinner]} gagne&nbsp;!</div>
        <p className="section-sub" style={{ textAlign: 'center' }}>Match terminé</p>
      </>
    );
  } else if (forced) {
    headline = (
      <>
        <div className="endbig win">Chouine&nbsp;!</div>
        <p className="section-sub" style={{ textAlign: 'center' }}>
          {game.names[winner]} remporte le coup d'office.
        </p>
      </>
    );
  } else if (winner < 0) {
    headline = (
      <>
        <div className="endbig">Égalité</div>
        <p className="section-sub" style={{ textAlign: 'center' }}>Coup nul — même donneur.</p>
      </>
    );
  } else {
    headline = (
      <>
        <p className="section-sub" style={{ textAlign: 'center', marginBottom: 6 }}>Coup remporté par</p>
        <div className="endbig win">{game.names[winner]}</div>
      </>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(5,12,8,.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, zIndex: 20 }}>
      <div style={{ width: 'min(520px,100%)', maxHeight: '90vh', overflow: 'auto', borderRadius: 20, border: '1px solid var(--gold)', background: '#102a20', padding: 30 }}>
        {headline}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}>
          {scoreDisplay}
        </div>
        <div className="list" style={{ marginBottom: 18 }}>{playerRows}</div>
        {matchOver && !online && (
          <EndOfMatchPrompt token={token} won={matchWinner === 0} onAccount={handleAccount} />
        )}
        {matchWinner !== null ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn--gold" style={{ flex: 1 }} onClick={handleRematch}>Rejouer</button>
            <button className="btn btn--ghost" style={{ flex: 1 }} onClick={handleHome}>Accueil</button>
          </div>
        ) : (
          <button className="btn btn--gold btn--full" onClick={handleNext}>Coup suivant →</button>
        )}
      </div>
    </div>
  );
}
