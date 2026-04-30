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
