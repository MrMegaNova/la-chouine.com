// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api/client', () => ({
  authApi: {},
  usersApi: { invitation: vi.fn() },
}));

import { InviteFriend } from './InviteFriend';
import { usersApi } from '@/api/client';
import { useAuthStore } from '@/store/authStore';

const mocked = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const INVITE_URL = 'https://la-chouine.com/i/k7m3qx';
const DISPLAYED_URL = 'la-chouine.com/i/k7m3qx';

function stubNavigator(property: 'clipboard' | 'share', value: unknown) {
  Object.defineProperty(navigator, property, { configurable: true, value });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ token: 't', user: null });
  mocked(usersApi.invitation).mockResolvedValue({ ok: true, status: 200, data: { url: INVITE_URL, invitedCount: 0 } });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('<InviteFriend>', () => {
  it('affiche le lien et le copie', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    render(<InviteFriend />);
    expect(await screen.findByLabelText('Votre lien')).toHaveValue(DISPLAYED_URL);
    stubNavigator('clipboard', { writeText });

    await user.click(screen.getByRole('button', { name: 'Copier le lien' }));

    expect(writeText).toHaveBeenCalledWith(INVITE_URL);
    expect(await screen.findByText('Lien copié.')).toBeInTheDocument();
  });

  it('sélectionne le lien si le presse-papiers refuse', async () => {
    const user = userEvent.setup();
    render(<InviteFriend />);
    const input = await screen.findByLabelText<HTMLInputElement>('Votre lien');
    stubNavigator('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('refus')) });

    await user.click(screen.getByRole('button', { name: 'Copier le lien' }));

    expect(await screen.findByText(/Copie impossible/)).toBeInTheDocument();
    expect(input.selectionEnd).toBe(DISPLAYED_URL.length);
  });

  it('ne propose le partage que s’il existe', async () => {
    render(<InviteFriend />);
    await screen.findByLabelText('Votre lien');
    expect(screen.queryByRole('button', { name: 'Partager' })).not.toBeInTheDocument();
  });

  it('partage le lien, et une annulation ne signale rien', async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockRejectedValue(new DOMException('annulé', 'AbortError'));
    stubNavigator('share', share);
    render(<InviteFriend />);

    await user.click(await screen.findByRole('button', { name: 'Partager' }));

    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: INVITE_URL }));
    expect(screen.queryByText(/Partage impossible/)).not.toBeInTheDocument();
  });

  it('affiche le nombre d’invités inscrits', async () => {
    mocked(usersApi.invitation).mockResolvedValue({ ok: true, status: 200, data: { url: INVITE_URL, invitedCount: 2 } });
    render(<InviteFriend />);
    expect(await screen.findByText('2 amis invités inscrits')).toBeInTheDocument();
  });

  it('signale un lien indisponible', async () => {
    mocked(usersApi.invitation).mockResolvedValue({ ok: false, status: 500, data: {} });
    render(<InviteFriend />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible d\'obtenir votre lien');
  });
});
