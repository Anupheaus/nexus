import { Button, createComponent, Flex, useBound } from '@anupheaus/react-ui';
import { useAction, useAuthentication } from '../../../src/client';
import type { UserRecord } from '../common';
import { signIn as signInAction } from '../common';

export const UserTest = createComponent('UserTest', () => {
  const { user, signOut } = useAuthentication<UserRecord>();
  const { signIn } = useAction(signInAction);

  const doSignIn = useBound(async () => {
    if (!await signIn({ email: 'email', password: 'password' })) {
      // eslint-disable-next-line no-console
      console.error('Failed to sign in');
    } else {
      // eslint-disable-next-line no-console
      console.log('Signed in');
    }
  });
  return (
    <Flex disableGrow gap={'fields'} isVertical>
      User: {user?.name} ({user?.id})
      <Flex disableGrow gap={'fields'}>
        <Button onClick={doSignIn}>Sign In</Button>
        <Button onClick={signOut}>Sign Out</Button>
      </Flex>
    </Flex>
  );
});
