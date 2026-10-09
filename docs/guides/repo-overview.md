# nexus — repo overview

> What @anupheaus/nexus is, what it depends on, and who reads its docs.
>
> Status: accepted · Version 1

## What it is

The real-time typed API library (`@anupheaus/nexus`) on Socket.IO: actions, events, subscriptions and their React hooks.

## Depends on

`common` and `react-ui`.

## Who depends on it

`vision`. Changing an action or event contract, or a hook's shape, opens vision's docs in the same change.

## Notes

Socket and connection behaviour that applications tune — timeouts, disconnect reasons — belongs in the application's own docs, not here.
