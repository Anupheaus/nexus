import { describe, expect, it } from 'vitest';
import { createAsyncContext } from './createAsyncContext';
import { optional, required } from './types';
import { wrap as wrapEmpty } from './socketApiContext';

describe('createAsyncContext', () => {
  it('empty schema exposes wrap only', () => {
    const { wrap } = createAsyncContext({});
    const req = {};
    const seen = wrap(req, () => wrap(req, () => 'inner')())();
    expect(seen).toBe('inner');
  });

  it('wrap(scopeSelector, delegate): lookup object from args; parent chain captured at registration', () => {
    const { useTag, setTag, wrap } = createAsyncContext({
      tag: optional(),
    });
    const outer = { name: 'outer' };
    wrap(outer, () => {
      setTag('from-outer');
      type Arg = { scope: typeof outer; n: number };
      const handler = wrap(
        (arg: Arg) => arg.scope,
        (_arg: Arg) => useTag(),
      );
      expect(handler({ scope: outer, n: 1 })).toBe('from-outer');
    })();
  });

  it('wrap(scopeSelector, delegate): throws if selector returns non-object', () => {
    const { wrap } = createAsyncContext({});
    const badSelector = (): object => null as unknown as object;
    const handler = wrap(badSelector, () => 'ok');
    expect(() => handler()).toThrow(/scopeSelector return value/);
  });

  it('global required: set then use; missing throws', () => {
    const { useDb, setDb } = createAsyncContext({
      db: required(),
    });
    expect(() => useDb()).toThrow(/required value "db"/);
    setDb({ id: 1 });
    expect(useDb()).toEqual({ id: 1 });
  });

  it('global optional returns undefined when unset', () => {
    const { useFlag, setFlag } = createAsyncContext({
      flag: optional(),
    });
    expect(useFlag()).toBeUndefined();
    setFlag(true);
    expect(useFlag()).toBe(true);
  });

  it('scoped: set/use inside wrap(lookupObject)', () => {
    const { useClient, setClient, wrap } = createAsyncContext({
      client: optional(),
    });
    const socket = { id: 's1' };
    wrap(socket, () => {
      setClient(socket);
      expect(useClient()).toBe(socket);
    })();
    expect(useClient()).toBeUndefined();
  });

  it('set scoped key without chain writes global fallback', () => {
    const { useClient, setClient, wrap } = createAsyncContext({
      client: optional(),
    });
    const sock = { id: 's' };
    setClient(sock as never);
    expect(useClient()).toBe(sock);
    wrap({}, () => {
      expect(useClient()).toBe(sock);
    })();
  });

  it('nested wrap: outer value visible inside inner when inner has no override', () => {
    const { useTag, setTag, wrap } = createAsyncContext({
      tag: optional(),
    });
    const outer = { n: 'outer' };
    const inner = { n: 'inner' };
    wrap(outer, () => {
      setTag('from-outer');
      const proxied = wrap(inner, () => useTag());
      expect(proxied()).toBe('from-outer');
    })();
  });

  it('nested wrap: inner scoped value shadows outer', () => {
    const { useTag, setTag, wrap } = createAsyncContext({
      tag: optional(),
    });
    const outer = {};
    const inner = {};
    wrap(outer, () => {
      setTag('outer');
      const proxied = wrap(inner, () => {
        setTag('inner');
        return useTag();
      });
      expect(proxied()).toBe('inner');
      expect(useTag()).toBe('outer');
    })();
  });

  it('wrap captures extendedChain at registration; deferred call restores ALS', () => {
    const { useClient, setClient, wrap } = createAsyncContext({
      client: optional(),
    });
    const socket = { id: 'sock' };
    const handler = wrap(socket, () =>
      wrap(socket, (_x: number) => {
        return useClient() as { id: string } | undefined;
      }),
    )();
    // Outside any ALS:
    expect(handler(1)).toBeUndefined();
    wrap(socket, () => {
      setClient(socket);
    })();
    expect(handler(2)).toBe(socket);
  });

  it('scoped required throws after full chain walk', () => {
    const { useX, wrap } = createAsyncContext({
      x: required(),
    });
    const a = {};
    const b = {};
    expect(() => wrap(a, () => wrap(b, () => useX())())()).toThrow(/required value "x"/);
  });

  it('scoped optional returns undefined when missing', () => {
    const { useX, wrap } = createAsyncContext({
      x: optional(),
    });
    const a = {};
    expect(wrap(a, () => useX())()).toBeUndefined();
  });

  it('global fallback for scoped key after chain miss', () => {
    const { useK, setK, wrap } = createAsyncContext({
      k: optional(),
    });
    setK('global');
    const req = {};
    expect(wrap(req, () => useK())()).toBe('global');
  });
});

describe('integration-style (Koa-ish)', () => {
  it('wrap(req) establishes scope for per-request hooks', () => {
    const { useReq, setReq, wrap } = createAsyncContext({
      req: optional(),
    });
    const fakeReq = { url: '/api' };
    wrap(fakeReq, () => {
      setReq(fakeReq);
      expect(useReq()).toBe(fakeReq);
    })();
  });
});

describe('three-level scope: global → connection → request', () => {
  it('global value visible at all levels unless overridden', () => {
    const { useVal, setVal, wrap } = createAsyncContext({ val: optional<string>() });
    const connection = {};
    const request = {};

    setVal('global');

    wrap(connection, () => {
      expect(useVal()).toBe('global'); // visible at connection level

      wrap(request, () => {
        expect(useVal()).toBe('global'); // visible at request level
      })();
    })();
  });

  it('connection value visible at request level but not outside connection scope', () => {
    const { useVal, setVal, wrap } = createAsyncContext({ val: optional<string>() });
    const connection = {};
    const request = {};

    wrap(connection, () => {
      setVal('connection');
      expect(useVal()).toBe('connection');

      wrap(request, () => {
        expect(useVal()).toBe('connection'); // inherited from connection scope
      })();
    })();

    expect(useVal()).toBeUndefined(); // not visible outside connection scope
  });

  it('request value shadows connection value but does not modify it', () => {
    const { useVal, setVal, wrap } = createAsyncContext({ val: optional<string>() });
    const connection = {};
    const request = {};

    wrap(connection, () => {
      setVal('connection');

      wrap(request, () => {
        setVal('request');
        expect(useVal()).toBe('request'); // request shadows connection
      })();

      expect(useVal()).toBe('connection'); // connection value unchanged after request exits
    })();
  });

  it('connection value shadows global but does not modify it', () => {
    const { useVal, setVal, wrap } = createAsyncContext({ val: optional<string>() });
    const connection = {};
    const request = {};

    setVal('global');

    wrap(connection, () => {
      setVal('connection');
      expect(useVal()).toBe('connection'); // shadows global

      wrap(request, () => {
        expect(useVal()).toBe('connection'); // still connection, not global
      })();
    })();

    expect(useVal()).toBe('global'); // global value unchanged
  });

  it('two concurrent connections do not share scoped values', () => {
    const { useVal, setVal, wrap } = createAsyncContext({ val: optional<string>() });
    const connA = {};
    const connB = {};

    wrap(connA, () => setVal('A'))();
    wrap(connB, () => setVal('B'))();

    expect(wrap(connA, () => useVal())()).toBe('A');
    expect(wrap(connB, () => useVal())()).toBe('B');
  });
});

describe('socketApiContext', () => {
  it('propagates chain for nested wrap', () => {
    const a = {};
    const b = {};
    wrapEmpty(a, () => {
      wrapEmpty(b, () => {
        const w = wrapEmpty(
          { leaf: true },
          () => 'leaf',
        );
        expect(w()).toBe('leaf');
      })();
    })();
  });
});
