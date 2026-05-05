import { createContext } from 'react';
import type { SocketAPIAccount, SocketAPIUser } from '../../common';
import type { DistributedState } from '@anupheaus/react-ui';

export interface AuthContextType {
  isValid: boolean;
  userState: DistributedState<SocketAPIUser | undefined>;
  accountState: DistributedState<SocketAPIAccount | undefined>;
  signOut(): Promise<void>;
  onPrf?: (userId: string, prfOutput: ArrayBuffer, accountId?: string) => void | Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  isValid: false,
  userState: undefined as unknown as DistributedState<SocketAPIUser | undefined>,
  accountState: undefined as unknown as DistributedState<SocketAPIAccount | undefined>,
  signOut: () => Promise.resolve(),
});
