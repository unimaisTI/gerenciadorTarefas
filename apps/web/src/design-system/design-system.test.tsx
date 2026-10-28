import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Field } from './Field';
import { IconButton } from './IconButton';
import { Input } from './Input';
import { SidebarNav } from './SidebarNav';

describe('design system', () => {
  it('IconButton expõe o rótulo como nome acessível', () => {
    render(<IconButton label="Notificações">x</IconButton>);
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument();
  });

  it('Field associa rótulo ao campo e anuncia o erro', () => {
    render(
      <Field label="Prazo" error="Informe uma data válida." required>
        <Input invalid />
      </Field>,
    );
    expect(screen.getByLabelText(/Prazo/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Informe uma data válida.');
  });

  it('SidebarNav marca a rota atual com aria-current', () => {
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <SidebarNav
              items={[
                { to: '/', label: 'Início', end: true },
                { to: '/chamados', label: 'Meus chamados' },
              ]}
            />
          ),
        },
      ],
      { initialEntries: ['/chamados'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('link', { name: 'Meus chamados' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current');
  });
});
