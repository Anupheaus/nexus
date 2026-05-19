import { createComponent, Dialogs, Flex } from '@anupheaus/react-ui';
import { ConnectionTest } from './ConnectionTest';
import { ClientId } from './ClientId';
import { Nexus } from '../../../src/client';
import { UserTest } from './UserTest';

export const App = createComponent('App', () => {
  return (
    <Dialogs>
      <Nexus name="test">
        <Flex gap={'fields'} isVertical disableGrow width={400}>
          <ClientId />
          <ConnectionTest />
          <UserTest />
        </Flex>
      </Nexus>
    </Dialogs>
  );
});
