import { Fragment, useId, useState } from 'react';
import type { Card } from '@/game/types';
import { SUIT_SYMBOL } from '@/game/constants';
import { PlayingCard } from '@/components/game/PlayingCard';
import type { Demo } from './demos';

// Démonstration pas à pas d'une règle (#70) : de vraies cartes, une légende par
// étape, et des boutons pour avancer à son rythme. Pas de lecture automatique :
// le lecteur choisit quand passer à la suite.

const RANK_NAME: Record<string, string> = { A: 'As', R: 'Roi', D: 'Dame', V: 'Valet' };
const SUIT_NAME = { pique: 'pique', coeur: 'cœur', carreau: 'carreau', trefle: 'trèfle' } as const;

const cardName = (card: Card) => `${RANK_NAME[card.r] ?? card.r} de ${SUIT_NAME[card.s]}`;
const same = (a: Card, b: Card) => a.s === b.s && a.r === b.r;

/** « **gras** » → <b>gras</b>, le reste en texte simple. */
function Caption({ text }: { text: string }) {
  return (
    <>
      {text.split('**').map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

export function RuleDemo({ demo }: { demo: Demo }) {
  const [index, setIndex] = useState(0);
  const id = useId();
  const step = demo.steps[index];
  const last = demo.steps.length - 1;
  const isLegal = (card: Card) => !step.legal || step.legal.some(l => same(l, card));

  const handLabel = 'Main de Léa : ' + step.hand
    .map(card => `${cardName(card)}${step.legal ? (isLegal(card) ? ' (jouable)' : ' (interdite)') : ''}`)
    .join(', ');
  const trickLabel = step.trick.length
    ? 'Sur le tapis : ' + step.trick.map(t => `${t.by === 'opp' ? 'Marc' : 'Léa'} a joué ${cardName(t.card)}`).join(', ')
    : 'Tapis vide';

  return (
    <section className="rule-demo" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className="rule-demo__title">{demo.title}</h4>

      <div className="rule-demo__table">
        <div className="rule-demo__row" role="img" aria-label={`Marc : ${step.oppCards} cartes cachées`}>
          <span className="rule-demo__name">Marc</span>
          <div className="rule-demo__cards">
            {Array.from({ length: step.oppCards }, (_, i) => <PlayingCard key={i} back className="rule-demo__back" />)}
          </div>
        </div>

        <div className="rule-demo__middle">
          <div
            className="rule-demo__stock" role="img"
            aria-label={`${step.talon ? `Talon : ${step.talon} cartes` : 'Talon épuisé'}${step.turnUp ? `, retourne : ${cardName(step.turnUp)}` : ''}, atout ${SUIT_NAME[step.trump]}`}
          >
            {step.talon > 0
              ? <div className="rule-demo__talon"><PlayingCard back className="rule-demo__small" /><span className="rule-demo__count">{step.talon}</span></div>
              : <span className="rule-demo__empty">Talon épuisé</span>}
            {step.turnUp && <PlayingCard card={step.turnUp} trump className="rule-demo__small" />}
            <span className="rule-demo__trump">Atout {SUIT_SYMBOL[step.trump]}</span>
          </div>
          <div className="rule-demo__trick" role="img" aria-label={trickLabel}>
            {step.trick.map(t => (
              <div key={`${index}-${t.card.s}${t.card.r}`} className={`rule-demo__played rule-demo__played--${t.by}`}>
                <PlayingCard card={t.card} trump={t.card.s === step.trump} />
                <span className="rule-demo__who" aria-hidden="true">{t.by === 'opp' ? 'Marc' : 'Léa'}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rule-demo__row" role="img" aria-label={handLabel}>
          <span className="rule-demo__name">Léa</span>
          <div className="rule-demo__cards">
            {step.hand.map(card => (
              <PlayingCard
                key={`${card.s}${card.r}`}
                card={card}
                trump={card.s === step.trump}
                dim={!isLegal(card)}
                className={step.legal && isLegal(card) ? 'rule-demo__legal' : undefined}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="rule-demo__caption" aria-live="polite">
        <span className="rule-demo__step">Étape {index + 1} sur {demo.steps.length}</span>
        <Caption text={step.caption} />
      </p>

      <div className="rule-demo__controls">
        <button className="btn btn--ghost btn--tap" onClick={() => setIndex(i => i - 1)} disabled={index === 0}>
          ◀ Précédent
        </button>
        {index < last
          ? <button className="btn btn--gold btn--tap" onClick={() => setIndex(i => i + 1)}>Suivant ▶</button>
          : <button className="btn btn--ghost btn--tap" onClick={() => setIndex(0)}>↺ Revoir</button>}
      </div>
    </section>
  );
}
