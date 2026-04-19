import { createComponent, Flex } from '@anupheaus/react-ui';
import { useSocketAPI } from '../../../src/client';

export const ClientId = createComponent('ClientId', () => {
  const { clientId } = useSocketAPI();
  return <Flex disableGrow>Client ID:&nbsp;{clientId}</Flex>;
});