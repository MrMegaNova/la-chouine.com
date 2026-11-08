// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SocialLogin } from './SocialLogin';
import { oauthApi } from '@/api/client';

describe('<SocialLogin>', () => {
  it('n’affiche que les fournisseurs configurés, avec l’invitation', async () => {
    vi.spyOn(oauthApi, 'providers').mockResolvedValue({ ok: true, status: 200, data: { providers: ['facebook', 'google'] } });
    render(<SocialLogin invitation="k7m3qx" />);
    const google = await screen.findByRole('link', { name: 'Continuer avec Google' });
    expect(google).toHaveAttribute('href', '/api/auth/oauth/google?invitation=k7m3qx');
    expect(screen.getByRole('link', { name: 'Continuer avec Facebook' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continuer avec Apple' })).not.toBeInTheDocument();
  });

  it('aucun fournisseur : rien n’est affiché', async () => {
    const spy = vi.spyOn(oauthApi, 'providers').mockResolvedValue({ ok: true, status: 200, data: { providers: [] } });
    const { container } = render(<SocialLogin />);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
