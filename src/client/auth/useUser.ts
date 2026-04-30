import { useContext } from 'react';
import { UserContext } from './UserContext';
import type { SocketAPIUser } from '../../../common';
import { useDistributedState } from '@anupheaus/react-ui';

export function useUser<UserType extends SocketAPIUser>() {
  const { isValid, userState, signOut } = useContext(UserContext);
  const { getAndObserve, get: getUser } = useDistributedState<UserType | undefined>(userState);

  if (!isValid) throw new Error('useUser cannot be used at this location as the context is not available.');
  return {
    get user() { return getAndObserve(); },
    getUser,
    signOut,
  };
}
