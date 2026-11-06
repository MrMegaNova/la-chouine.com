// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SoundToggle } from './SoundToggle';
import { useSoundStore } from '@/store/soundStore';

beforeEach(() => { useSoundStore.setState({ muted: false }); localStorage.clear(); });

describe('<SoundToggle> (#155)', () => {
  it('coupe puis rétablit le son, et mémorise le choix', async () => {
    const user = userEvent.setup();
    render(<SoundToggle />);
    const button = screen.getByRole('button', { name: 'Couper le son' });
    expect(button).toHaveAttribute('aria-pressed', 'true');

    await user.click(button);
    expect(useSoundStore.getState().muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Activer le son' })).toHaveTextContent('Son coupé');
    expect(JSON.parse(localStorage.getItem('chouine-sound')!).state.muted).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Activer le son' }));
    expect(useSoundStore.getState().muted).toBe(false);
  });
});
