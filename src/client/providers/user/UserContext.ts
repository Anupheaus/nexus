import { createContext } from 'react';
import type { SocketAPIUser } from '../../../common';
import type { DistributedState } from '@anupheaus/react-ui';

export interface UserContextType {
  isValid: boolean;
  userState: DistributedState<SocketAPIUser | undefined>;
  signOut(): Promise<void>;
  onPrf?: (userId: string, prfOutput: ArrayBuffer) => void;
}

export const UserContext = createContext<UserContextType>({
  isValid: false,
  userState: undefined as unknown as DistributedState<SocketAPIUser | undefined>,
  signOut: () => Promise.resolve(),
});
