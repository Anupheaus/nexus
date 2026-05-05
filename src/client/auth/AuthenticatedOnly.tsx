import { createComponent } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useAuthentication } from './useAuthentication';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

export const AuthenticatedOnly = createComponent('AuthenticatedOnly', ({ children, fallback = null }: Props) => {
  const { user } = useAuthentication();
  return user ? <>{children}</> : <>{fallback}</>;
});
