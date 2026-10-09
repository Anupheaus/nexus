# Actions (RPC)

> How to register and call request/response actions in both directions, and how errors surface.
>
> Status: accepted · Version 1

Actions are request/response channels over Socket.IO acknowledgements. The same contract serves either direction; what differs is which side registers the handler.

## Client to server

Server: `createServerActionHandler(getUser, async ({ id }) => ({ name: 'Alice', email: 'alice@example.com' }))`.

Client: `const { getUser, useGetUser } = useAction(getUser)` — `getUser` is the imperative call, `useGetUser` the reactive one returning `{ response, isLoading, error }`.

## Server to client

Inside an action or subscription handler, the server imports `useAction` from `@anupheaus/nexus/server` and awaits it: `const askClient = useAction(confirmClose); const answer = await askClient({ saveDraft: true });`

The client registers exactly one handler for that contract: `useServerActionHandler(confirmClose)(req => ({ confirmed: true }))`. A second registration throws. The client's return value resolves the server's promise, and an array stays an array.

## Errors

Prefer throwing from server handlers for exceptional cases so the library can map failures consistently; the client treats server `{ error }` style responses as failures.

Wire name: `nexus.actions.{actionName}`, where `actionName` is the string passed to `defineAction(...)('actionName')`.
