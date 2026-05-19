# AuthenticatedOnly Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `AuthenticatedOnly` React component that renders its children only when the user is authenticated, and renders an optional fallback otherwise.

**Architecture:** A thin wrapper in `src/client/providers/user/` that calls the existing `useUser()` hook to observe auth state reactively, gates on user truthiness, and is exported from the client entry point alongside other user-facing APIs.

**Tech Stack:** React, Vitest, `@testing-library/react`, `createComponent` from `@anupheaus/react-ui`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/client/providers/user/AuthenticatedOnly.tsx` | The gate component |
| Create | `src/client/providers/user/AuthenticatedOnly.tests.tsx` | Unit tests |
| Modify | `src/client/providers/user/index.ts` | Export `AuthenticatedOnly` |
| Modify | `src/client/index.ts` | Re-export `AuthenticatedOnly` |

---

### Task 1: Write failing tests for `AuthenticatedOnly`

**Files:**
- Create: `src/client/providers/user/AuthenticatedOnly.tests.tsx`

- [ ] **Step 1: Write the test file**

```tsx
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
    expect(screen.getByText('protected content')).toBeDefined();
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
    expect(screen.getByText('please sign in')).toBeDefined();
    expect(screen.queryByText('protected content')).toBeNull();
  });

  it('switches from fallback to children when user becomes authenticated', async () => {
    mockUseUser.mockReturnValue({ user: undefined, getUser: vi.fn(), signOut: vi.fn() });
    const { rerender } = render(
      <AuthenticatedOnly fallback={<span>please sign in</span>}>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(screen.getByText('please sign in')).toBeDefined();

    mockUseUser.mockReturnValue({ user: { id: '1', name: 'Alice' }, getUser: vi.fn(), signOut: vi.fn() });
    rerender(
      <AuthenticatedOnly fallback={<span>please sign in</span>}>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(screen.getByText('protected content')).toBeDefined();
    expect(screen.queryByText('please sign in')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm -C C:/code/personal/socket-api test src/client/providers/user/AuthenticatedOnly.tests.tsx
```

Expected: FAIL — `Cannot find module './AuthenticatedOnly'`

---

### Task 2: Implement `AuthenticatedOnly`

**Files:**
- Create: `src/client/providers/user/AuthenticatedOnly.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { createComponent } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useUser } from './useUser';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

export const AuthenticatedOnly = createComponent('AuthenticatedOnly', ({ children, fallback = null }: Props) => {
  const { user } = useUser();
  return user ? <>{children}</> : <>{fallback}</>;
});
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
pnpm -C C:/code/personal/socket-api test src/client/providers/user/AuthenticatedOnly.tests.tsx
```

Expected: All 4 tests PASS

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/providers/user/AuthenticatedOnly.tsx src/client/providers/user/AuthenticatedOnly.tests.tsx
git -C C:/code/personal/socket-api commit -m "feat: add AuthenticatedOnly component"
```

---

### Task 3: Wire up exports

**Files:**
- Modify: `src/client/providers/user/index.ts`
- Modify: `src/client/index.ts`

- [ ] **Step 1: Add export to `src/client/providers/user/index.ts`**

Current contents:
```ts
// // export * from './UserProvider';
export * from './useUser';
```

New contents:
```ts
// // export * from './UserProvider';
export * from './useUser';
export * from './AuthenticatedOnly';
```

- [ ] **Step 2: Add re-export to `src/client/index.ts`**

Current contents:
```ts
export * from './Nexus';
export * from './hooks';
export { useUser, useSocket as useNexus } from './providers';
export type { NexusUser } from '../common';
export { defineAuthentication } from './auth/defineAuthentication';
export { useAuthentication } from './hooks/useAuthentication';
export type { ClientUseAuthResult } from './hooks/useAuthentication';
```

New contents:
```ts
export * from './Nexus';
export * from './hooks';
export { useUser, useSocket as useNexus } from './providers';
export { AuthenticatedOnly } from './providers/user/AuthenticatedOnly';
export type { NexusUser } from '../common';
export { defineAuthentication } from './auth/defineAuthentication';
export { useAuthentication } from './hooks/useAuthentication';
export type { ClientUseAuthResult } from './hooks/useAuthentication';
```

- [ ] **Step 3: Run full test suite to confirm nothing is broken**

```bash
pnpm -C C:/code/personal/socket-api test
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/providers/user/index.ts src/client/index.ts
git -C C:/code/personal/socket-api commit -m "feat: export AuthenticatedOnly from client entry point"
```
