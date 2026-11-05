// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Achievements } from './Achievements';

const unlocked = [
  { code: 'chouine-faite', unlockedAt: '2026-01-01T00:00:00Z', verified: true },
  { code: 'gagnant', unlockedAt: '2026-01-01T00:00:00Z', verified: false },
];

describe('<Achievements> (#279)', () => {
  it('profil propre : le badge non vérifié reste obtenu et signalé', () => {
    render(<Achievements unlocked={unlocked} />);

    expect(screen.getByText(/\(2\//)).toBeInTheDocument();
    expect(screen.getByText('Gagnant').parentElement).toHaveTextContent('Non vérifié');
    expect(screen.getByText('Chouine !').parentElement).not.toHaveTextContent('Non vérifié');
    expect(screen.getByText(/Les badges de victoires se gagnent en ligne/)).toBeInTheDocument();
  });

  it('profil public : annonce que seules les parties en ligne comptent', () => {
    render(<Achievements unlocked={[unlocked[0]]} publicView />);

    expect(screen.getByText(/\(1\//)).toBeInTheDocument();
    expect(screen.getByText('Seuls les badges établis par des parties en ligne apparaissent ici.')).toBeInTheDocument();
    expect(screen.queryByText('Non vérifié')).not.toBeInTheDocument();
  });
});
