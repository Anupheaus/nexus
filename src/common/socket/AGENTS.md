# common/socket — Custom Socket.IO Parser

Replaces the default Socket.IO JSON codec with one that handles JavaScript types that plain JSON cannot represent.

## Why this exists

The wire format between client and server must faithfully round-trip `Date`, `Map`, `Set`, `BigInt`, `undefined`, and other non-JSON primitives. This parser intercepts every packet before encoding and after decoding to convert these types transparently.

## Files

| File | Purpose |
|------|---------|
| `SocketIOParser.ts` | Drop-in replacement for `socket.io-parser`. Wraps the default encoder/decoder and calls `deconstruct`/`reconstruct` on every packet payload. |
| `deconstruct.ts` | Recursively walks an object and replaces non-JSON types with tagged plain-object representations (`{ __type: 'Date', value: '...' }` etc.). |
| `reconstruct.ts` | Inverse of `deconstruct` — restores tagged representations back to their original types. |

## Usage

The parser is wired in automatically by `createClientSocket` (client) and `createServerSocket` (server). You do not need to reference it directly.
