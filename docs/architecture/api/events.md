# Events (server push)

> Server-pushed one-way events: how the server emits to the current connection and the client subscribes.
>
> Status: accepted · Version 1

Events are one-way messages from the server to the client, with a payload and no request/response pair.

```ts
import { defineEvent } from '@anupheaus/nexus/common';
export const notify = defineEvent<{ message: string }>('notify');
```

## Server: emit to the current connection

Inside a handler running under the socket's async context, `useEvent` returns a function targeting the client for this invocation:

```ts
import { useEvent } from '@anupheaus/nexus/server';
const emitNotify = useEvent(notify);
emitNotify({ message: 'Hello' });
```

## Client: subscribe

The hook returns a registrar, then you pass a listener:

```ts
const { onNotify } = useEvent(notify);
onNotify(({ message }) => console.log(message));
```

Wire name: `nexus.events.{eventName}`.
