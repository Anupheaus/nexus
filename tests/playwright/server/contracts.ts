import { defineAction, defineEvent, defineSubscription } from '../../../src/common';

/** Echo the supplied value back — used to verify imperative and reactive action calls. */
export const echoAction = defineAction<{ value: string }, string>()('echo', { isPublic: true });

/** Always throws — used to verify error propagation to the client. */
export const errorAction = defineAction<void, void>()('error', { isPublic: true });

/** Causes the server to emit a `testEvent` to the requesting client. */
export const triggerEventAction = defineAction<{ message: string }, void>()('triggerEvent', { isPublic: true });

/** Server-push event carrying an arbitrary message string. */
export const testEvent = defineEvent<{ message: string }>('testEvent');

/** Emits an incrementing integer every 200 ms until unsubscribed. */
export const counterSubscription = defineSubscription<void, number>()('counter', { isPublic: true });

/** Responds with a greeting via a REST GET endpoint — used to verify REST-only fallback mode. */
export const helloRestAction = defineAction<{ name: string }, { greeting: string }>()('helloRest', {
  isPublic: true,
  rest: { method: 'GET', url: '/test/hello/:name' },
});
