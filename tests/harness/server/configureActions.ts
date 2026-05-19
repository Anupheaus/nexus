import type { NexusServerAction } from '../../../src/server';
import { createServerActionHandler } from '../../../src/server';
import { useAuthentication } from '../../../src/server/providers/authentication';
import type { UserRecord } from '../common';
import { signIn, testEndpoint } from '../common';

export const actions: NexusServerAction[] = [
  createServerActionHandler(testEndpoint, async ({ foo }) => {
    return { bar: foo };
  }),
  createServerActionHandler(signIn, async () => {
    const { setUser } = useAuthentication<UserRecord>();
    setUser({ id: Math.uniqueId(), name: 'Tony Hales' });
    return true;
  }),
];
