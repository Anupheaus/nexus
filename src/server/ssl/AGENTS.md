# ssl — SSL Server Creation

Creates the HTTPS (or plain HTTP) server used by `startServer`. Three modes, selected by `SSLConfig.mode`:

| Mode | Behaviour |
|------|-----------|
| `'self-signed'` (**default**, also when no `mode` is given) | Generates/loads a local root CA + wildcard server cert via `selfsigned-ca`, installing the CA in the OS trust store on first run. Falls back to plain HTTP if TLS setup fails. |
| `'provided'` | Uses externally-issued PEMs passed as `cert`/`key`/`ca` (contents, not paths) — e.g. a Let's Encrypt wildcard. No CA is generated or installed. A bad cert/key throws at startup rather than downgrading. |
| `'off'` | Plain HTTP — for deployments where a proxy (e.g. Cloudflare) terminates TLS in front. |

A bare `{ host }` (no `mode`) is treated as `'self-signed'`, so existing callers are unaffected.

## Files

| File | Purpose |
|------|---------|
| `ssl-models.ts` | `SSLConfig` union (`SelfSignedSSLConfig` \| `ProvidedSSLConfig` \| `OffSSLConfig`) + `CreateSSLServerOptions` |
| `createSSLServer.ts` | Async factory — builds the server per mode, returns it plus lifecycle controls |

## Usage

`createSSLServer` is used internally by `startServer` when `ssl` config is provided instead of an external `server`. It is not intended to be called directly by consumers.

```ts
// self-signed (default)
await createSSLServer({ ssl: { host: '*.example.com', certsPath: './certs' }, port: 3000, logger });

// provided cert (e.g. Let's Encrypt)
await createSSLServer({ ssl: { mode: 'provided', cert: pem, key: keyPem }, port: 443, logger });

// off — plain HTTP behind a TLS-terminating proxy
await createSSLServer({ ssl: { mode: 'off' }, port: 80, logger });

const { server, startListening, stopListening } = await createSSLServer({ ssl: { host: 'localhost' }, port: 3000, logger });
await startListening();
// later:
await stopListening();
```
