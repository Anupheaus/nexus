import { useState } from 'react';
import { Button, createComponent, createStyles, Flex } from '@anupheaus/react-ui';
import { useNexus } from '../../../src/client';

const useStyles = createStyles({
  connectionStatus: {
    borderRadius: 8,
    '&.socket-connected': {
      backgroundColor: 'green',
    },
    '&.socket-disconnected': {
      backgroundColor: 'red',
    },
  },
});

export const ConnectionTest = createComponent('ConnectionTest', () => {
  const { css, join } = useStyles();
  const { onConnectionStateChanged, connect, disconnect } = useNexus();
  const [isConnected, setIsConnected] = useState(false);
  onConnectionStateChanged((newIsConnected: boolean) => setIsConnected(newIsConnected));

  return (
    <Flex gap={'fields'} disableGrow>
      <Flex className={join(css.connectionStatus, isConnected ? 'socket-connected' : 'socket-disconnected')} />
      <Button onClick={disconnect}>Disconnect</Button>
      <Button onClick={connect}>Reconnect</Button>
    </Flex>
  );
});