import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// createComponent is a passthrough in tests — avoids dual-React dispatcher conflict
vi.mock('@anupheaus/react-ui', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    createComponent: (_name: string, fn: unknown) => fn,
  };
});

// Mock useUser so tests control auth state without a real provider
const mockUseUser = vi.fn();
vi.mock('./useUser', () => ({ useUser: mockUseUser }));

import { AuthenticatedOnly } from './AuthenticatedOnly';

describe('AuthenticatedOnly', () => {
  it('renders children when user is authenticated', () => {
    mockUseUser.mockReturnValue({ user: { id: '1', name: 'Alice' }, getUser: vi.fn(), signOut: vi.fn() });
    render(
      <AuthenticatedOnly>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(screen.queryByText('protected content')).not.toBeNull();
  });

  it('renders null when user is unauthenticated and no fallback provided', () => {
    mockUseUser.mockReturnValue({ user: undefined, getUser: vi.fn(), signOut: vi.fn() });
    const { container } = render(
      <AuthenticatedOnly>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('protected content')).toBeNull();
  });

  it('renders fallback when user is unauthenticated', () => {
    mockUseUser.mockReturnValue({ user: undefined, getUser: vi.fn(), signOut: vi.fn() });
    render(
      <AuthenticatedOnly fallback={<span>please sign in</span>}>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(screen.queryByText('please sign in')).not.toBeNull();
    expect(screen.queryByText('protected content')).toBeNull();
  });

  it('switches from fallback to children when user becomes authenticated', () => {
    mockUseUser.mockReturnValue({ user: undefined, getUser: vi.fn(), signOut: vi.fn() });
    const { rerender } = render(
      <AuthenticatedOnly fallback={<span>please sign in</span>}>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(screen.queryByText('please sign in')).not.toBeNull();

    mockUseUser.mockReturnValue({ user: { id: '1', name: 'Alice' }, getUser: vi.fn(), signOut: vi.fn() });
    rerender(
      <AuthenticatedOnly fallback={<span>please sign in</span>}>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(screen.queryByText('protected content')).not.toBeNull();
    expect(screen.queryByText('please sign in')).toBeNull();
  });
});
