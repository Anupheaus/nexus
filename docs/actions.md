# Actions (RPC)

Actions are **request/response** channels built on Socket.IO acknowledgements. The same `defineAction` contract can represent **client → server** or **server → client** calls; the transport direction is determined by which side registers the handler and which side invokes.

## Client → server

**Server:** register with `createServerActionHandler(contract, handler)`.

```ts
createServerActionHandler(getUser, async ({ id }) => {
  return { name: 'Alice', email: 'alice@example.com' };
});
```

**Client:** `useAction(contract)` exposes imperative and reactive call paths.

```ts
const { getUser, useGetUser } = useAction(getUser);
await getUser({ id: '1' });
const { response, isLoading, error } = useGetUser({ id: '1' });
```

## Server → client

**Server:** inside an action or subscription handler (with socket context), import **`useAction`** from **`@anupheaus/nexus/server`** and call the returned async function.

```ts
const askClient = useAction(confirmClose);
const answer = await askClient({ saveDraft: true });
```

**Client:** register exactly **one** `useServerActionHandler(contract)` for that action in the React tree. A second registration throws.

```ts
useServerActionHandler(confirmClose)((req) => ({ confirmed: true }));
```

The client handler’s return value becomes the Promise resolution on the server. If the client responds with an **array**, it remains an array (no accidental unwrapping).

## Errors

Handlers may throw or return error-shaped payloads depending on internal conventions; the client `useAction` path treats server `{ error }` style responses as failures. Prefer throwing from server handlers for exceptional cases so the library can map them consistently.

## Wire format

Event name pattern: `nexus.actions.{actionName}` where `actionName` is the string passed to `defineAction(...)('actionName')`.

## Related

- [Contracts](./contracts.md) — defining actions
- [Server guide](./server-guide.md) / [Client guide](./client-guide.md) — end-to-end setup
