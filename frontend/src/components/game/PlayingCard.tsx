import type React from 'react';
import type { Card } from '@/game/types';
import { SUIT_SYMBOL } from '@/game/constants';

interface Props {
  card?: Card;
  back?: boolean;
  trump?: boolean;
  selected?: boolean;
  playable?: boolean;
  dim?: boolean;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

const OWL_SVG = (
  <svg className="playing-card__owl" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M32 6c-9 0-15 5-16 13-4 2-6 6-6 11 0 12 9 22 22 22s22-10 22-22c0-5-2-9-6-11C47 11 41 6 32 6Z"
      fill="#0e251c" stroke="#c9a14a" strokeWidth="2" />
    <circle cx="23" cy="28" r="7" fill="#1a3a2c" stroke="#c9a14a" strokeWidth="1.5" />
    <circle cx="41" cy="28" r="7" fill="#1a3a2c" stroke="#c9a14a" strokeWidth="1.5" />
    <circle cx="23" cy="28" r="2.6" fill="#c9a14a" />
    <circle cx="41" cy="28" r="2.6" fill="#c9a14a" />
    <path d="M32 32l-3 5h6l-3-5Z" fill="#c9a14a" />
  </svg>
);

export function PlayingCard({
  card,
  back = false,
  trump = false,
  selected = false,
  playable = false,
  dim = false,
  size,
  className = '',
  style: styleProp,
  onClick,
}: Props) {
  const isRed = card && (card.s === 'coeur' || card.s === 'carreau');

  const classes = [
    'playing-card',
    back     && 'playing-card--back',
    isRed    && 'playing-card--red',
    trump    && 'playing-card--trump',
    selected && 'playing-card--selected',
    playable && 'playing-card--playable',
    dim      && 'playing-card--dim',
    className,
  ].filter(Boolean).join(' ');

  const sizeStyle = size ? { ['--w' as string]: `${size}px` } : undefined;
  const style = sizeStyle || styleProp ? { ...sizeStyle, ...styleProp } : undefined;

  if (back) {
    return (
      <div className={classes} style={style} onClick={onClick} aria-hidden="true">
        {OWL_SVG}
      </div>
    );
  }

  if (!card) return null;
  const sym = SUIT_SYMBOL[card.s];

  return (
    <div
      className={classes}
      style={style}
      onClick={playable ? onClick : undefined}
      role={playable ? 'button' : undefined}
      aria-label={playable ? `Jouer ${card.r}${sym}` : undefined}
    >
      <div className="playing-card__corner playing-card__corner--tl">
        <span className="playing-card__rank">{card.r}</span>
        <span className="playing-card__suit-corner">{sym}</span>
      </div>
      <div className="playing-card__pip">{sym}</div>
      <div className="playing-card__corner playing-card__corner--br">
        <span className="playing-card__rank">{card.r}</span>
        <span className="playing-card__suit-corner">{sym}</span>
      </div>
    </div>
  );
}
