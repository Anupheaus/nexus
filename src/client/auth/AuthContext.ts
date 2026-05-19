import { createContext } from 'react';
import type { NexusAccount, NexusUser } from '../../common';
import type { DistributedState } from '@anupheaus/react-ui';

export interface AuthContextType {
  isValid: boolean;
  userState: DistributedState<NexusUser | undefined>;
  accountState: DistributedState<NexusAccount | undefined>;
  signOut(): Promise<void>;
  onPrf?: (userId: string, prfOutput: ArrayBuffer, accountId?: string) => void | Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  isValid: false,
  userState: undefined as unknown as DistributedState<NexusUser | undefined>,
  accountState: undefined as unknown as DistributedState<NexusAccount | undefined>,
  signOut: () => Promise.resolve(),
});
