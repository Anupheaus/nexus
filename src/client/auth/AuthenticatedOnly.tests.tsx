import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Use vi.hoisted to define mocks before vi.mock is called (avoids hoisting issues)
const { mockUseAuthentication } = vi.hoisted(() => {
  return {
    mockUseAuthentication: vi.fn(),
  };
});

// createComponent is a passthrough in tests — avoids dual-React dispatcher conflict
vi.mock('@anupheaus/react-ui', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    createComponent: (_name: string, fn: unknown) => fn,
  };
});

// Mock useAuthentication so tests control auth state without a real provider
vi.mock('./useAuthentication', () => ({ useAuthentication: mockUseAuthentication }));

import { AuthenticatedOnly } from './AuthenticatedOnly';

describe('AuthenticatedOnly', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders children when user is authenticated', () => {
    mockUseAuthentication.mockReturnValue({ user: { id: '1', name: 'Alice' }, signIn: vi.fn(), signOut: vi.fn() });
    render(
      <AuthenticatedOnly>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(screen.queryByText('protected content')).not.toBeNull();
  });

  it('renders null when user is unauthenticated and no fallback provided', () => {
    mockUseAuthentication.mockReturnValue({ user: undefined, signIn: vi.fn(), signOut: vi.fn() });
    const { container } = render(
      <AuthenticatedOnly>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('protected content')).toBeNull();
  });

  it('renders fallback when user is unauthenticated', () => {
    mockUseAuthentication.mockReturnValue({ user: undefined, signIn: vi.fn(), signOut: vi.fn() });
    render(
      <AuthenticatedOnly fallback={<span>please sign in</span>}>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(screen.queryByText('please sign in')).not.toBeNull();
    expect(screen.queryByText('protected content')).toBeNull();
  });

  it('switches from fallback to children when user becomes authenticated', () => {
    mockUseAuthentication.mockReturnValue({ user: undefined, signIn: vi.fn(), signOut: vi.fn() });
    const { rerender } = render(
      <AuthenticatedOnly fallback={<span>please sign in</span>}>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(screen.queryByText('please sign in')).not.toBeNull();

    mockUseAuthentication.mockReturnValue({ user: { id: '1', name: 'Alice' }, signIn: vi.fn(), signOut: vi.fn() });
    rerender(
      <AuthenticatedOnly fallback={<span>please sign in</span>}>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(screen.queryByText('protected content')).not.toBeNull();
    expect(screen.queryByText('please sign in')).toBeNull();
  });
});
