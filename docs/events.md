# Events (server push)

Events are **one-way messages** from the server to the client. There is no typed request/response pair on the wire beyond the payload you define.

## Contract

```ts
import { defineEvent } from '@anupheaus/nexus/common';

export const notify = defineEvent<{ message: string }>('notify');
```

## Server: emit to the current connection

Inside a handler running under the socket’s async context:

```ts
import { useEvent } from '@anupheaus/nexus/server';

const emitNotify = useEvent(notify);
emitNotify({ message: 'Hello' });
```

`useEvent` returns a function that targets the **current** connected client for this invocation.

## Client: subscribe

```ts
const { onNotify } = useEvent(notify);
onNotify(({ message }) => {
  console.log(message);
});
```

The pattern mirrors other hooks: obtain a registrar (`onNotify`), then pass your listener.

## Wire format

Event name pattern: `socket-api.events.{eventName}`.

## Related

- [Contracts](./contracts.md)
- [Client guide](./client-guide.md)
