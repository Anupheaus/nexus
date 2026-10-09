# APIs

The contracts nexus exposes: actions, events and subscriptions, with their wire names.

## Docs

- [Actions (RPC)](actions.md): How to register and call request/response actions in both directions, and how errors surface.
- [Contracts: defineAction, defineEvent, defineSubscription](contracts.md): defineAction, defineEvent and defineSubscription: the three typed contracts and the wire names they produce.
- [Events (server push)](events.md): Server-pushed one-way events: how the server emits to the current connection and the client subscribes.
- [Subscriptions (streaming)](subscriptions.md): Streaming subscriptions: subscribe, push updates with update(), unsubscribe, and the initial response rule.
