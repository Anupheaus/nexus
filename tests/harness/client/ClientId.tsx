import { createComponent, Flex } from '@anupheaus/react-ui';
import { useNexus } from '../../../src/client';

export const ClientId = createComponent('ClientId', () => {
  const { clientId } = useNexus();
  return <Flex disableGrow>Client ID:&nbsp;{clientId}</Flex>;
});