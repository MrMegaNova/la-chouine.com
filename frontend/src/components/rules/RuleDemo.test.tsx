// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuleDemo } from './RuleDemo';
import { DEMO_OBLIGATIONS } from './demos';

describe('<RuleDemo> (#70)', () => {
  it('avance, recule et recommence, avec une légende annoncée', async () => {
    const user = userEvent.setup();
    render(<RuleDemo demo={DEMO_OBLIGATIONS} />);
    const total = DEMO_OBLIGATIONS.steps.length;

    expect(screen.getByText(`Étape 1 sur ${total}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Précédent/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Suivant/ }));
    expect(screen.getByText(`Étape 2 sur ${total}`)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /As de cœur \(jouable\)/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /7 de cœur \(interdite\)/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Précédent/ }));
    expect(screen.getByText(`Étape 1 sur ${total}`)).toBeInTheDocument();

    for (let i = 1; i < total; i++) await user.click(screen.getByRole('button', { name: /Suivant/ }));
    expect(screen.queryByRole('button', { name: /Suivant/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Revoir/ }));
    expect(screen.getByText(`Étape 1 sur ${total}`)).toBeInTheDocument();
  });

  it('met en valeur le texte entre doubles astérisques', () => {
    render(<RuleDemo demo={DEMO_OBLIGATIONS} />);
    expect(screen.getByText('épuisé', { selector: 'b' })).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });
});
