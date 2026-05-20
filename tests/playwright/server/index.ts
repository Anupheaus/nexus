import http from 'http';
import { startServer, createServerActionHandler, createServerSubscription, useEvent } from '../../../src/server';
import { echoAction, errorAction, triggerEventAction, testEvent, counterSubscription, helloRestAction } from './contracts';

// Prevent unhandled rejections from crashing the test server process.
process.on('unhandledRejection', (reason) => {
  console.warn('Unhandled rejection (server kept alive):', reason);
});

const server = http.createServer();

startServer({
  name: 'test',
  server,
  actions: [
    createServerActionHandler(echoAction, async ({ value }) => value),
    createServerActionHandler(errorAction, async () => { throw new Error('intentional error'); }),
    createServerActionHandler(triggerEventAction, async ({ message }) => {
      const emit = useEvent(testEvent);
      await emit({ message });
    }),
    createServerActionHandler(helloRestAction, async ({ name }) => ({ greeting: `Hello, ${name}!` })),
  ],
  subscriptions: [
    createServerSubscription(counterSubscription, async ({ update, onUnsubscribe }) => {
      let count = 0;
      let active = true;
      const interval = setInterval(() => {
        if (!active) return;
        update(count++);
      }, 200);
      onUnsubscribe(() => { active = false; clearInterval(interval); });
      return count;
    }),
  ],
}).then(() => {
  server.listen(3010, () => {
    console.log('Playwright test server running on port 3010');
  });
});
