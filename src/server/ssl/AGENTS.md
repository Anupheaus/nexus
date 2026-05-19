# ssl — SSL Server Creation

Creates a self-signed SSL (HTTPS) server for local and development use. Falls back to plain HTTP if SSL certificate creation fails.

## Files

| File | Purpose |
|------|---------|
| `ssl-models.ts` | `SSLConfig` interface |
| `createSSLServer.ts` | Async factory — generates/loads self-signed certs via `selfsigned-ca`, returns server + lifecycle controls |

## Usage

`createSSLServer` is used internally by `startServer` when `ssl` config is provided instead of an external `server`. It is not intended to be called directly by consumers.

```ts
const { server, startListening, stopListening } = await createSSLServer({
  host: 'localhost',
  port: 3000,
  certsPath: './certs',
  logger,
});
// attach handlers to server, then:
await startListening();
// later:
await stopListening();
```
