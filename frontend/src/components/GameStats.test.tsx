// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameStats } from './GameStats';

const stats = (local: { wins: number; losses: number; plays: number }) => ({
  wins: 3, losses: 1, plays: 4, local,
});

describe('<GameStats> (#279)', () => {
  it('sépare les résultats établis par le serveur des résultats déclarés', () => {
    render(<GameStats stats={stats({ wins: 7, losses: 2, plays: 9 })} />);

    const online = screen.getByRole('heading', { name: 'Parties en ligne' }).parentElement!;
    expect(screen.getByText('Résultats établis par le serveur.')).toBeInTheDocument();
    expect(online).toHaveTextContent('75%');

    expect(screen.getByRole('heading', { name: 'Contre l’ordinateur et en local' })).toBeInTheDocument();
    expect(screen.getByText('Résultats déclarés par le navigateur, non vérifiés.')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('le taux de réussite ignore les résultats déclarés', () => {
    render(<GameStats stats={{ wins: 0, losses: 1, plays: 1, local: { wins: 50, losses: 0, plays: 50 } }} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('sans partie locale : pas de section vide', () => {
    render(<GameStats stats={stats({ wins: 0, losses: 0, plays: 0 })} />);
    expect(screen.queryByRole('heading', { name: 'Contre l’ordinateur et en local' })).not.toBeInTheDocument();
  });
});
