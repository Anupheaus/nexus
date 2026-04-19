import { createComponent, Dialogs, Flex } from '@anupheaus/react-ui';
import { ConnectionTest } from './ConnectionTest';
import { ClientId } from './ClientId';
import { SocketAPI } from '../../../src/client';
import { UserTest } from './UserTest';

export const App = createComponent('App', () => {
  return (
    <Dialogs>
      <SocketAPI name="test">
        <Flex gap={'fields'} isVertical disableGrow width={400}>
          <ClientId />
          <ConnectionTest />
          <UserTest />
        </Flex>
      </SocketAPI>
    </Dialogs>
  );
});
