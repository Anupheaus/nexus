import { describe, expect, it } from 'vitest';
import { resolvePostAuthUrl } from './postAuthUrl';

// Where a web Google sign-in may return the browser. postAuthUrl comes from whoever built the sign-in link, so anything
// off this site (or off an origin the app allows) is refused: otherwise the link is an open redirect that ends, signed
// in, on a page of the attacker's choosing.

const config = { redirectUri: 'https://app.example/api/google/callback', allowedPostAuthOrigins: ['https://tenant.example'] };

describe('resolvePostAuthUrl', () => {
  it.each([
    ['a path on this site', '/settings?tab=2', '/settings?tab=2'],
    ['the site root', '/', '/'],
    ['a page on the callback\'s own origin', 'https://app.example/home', 'https://app.example/home'],
    ['a page on an origin the app allows', 'https://tenant.example/x', 'https://tenant.example/x'],
  ])('allows %s', (_label, postAuthUrl, expected) => {
    expect(resolvePostAuthUrl(postAuthUrl, config)).toBe(expected);
  });

  it.each([
    ['another site', 'https://evil.example/phish'],
    ['another site on a lookalike subdomain', 'https://app.example.evil.example/'],
    ['the allowed host over another port', 'https://tenant.example:8443/'],
    ['a protocol-relative URL (another host)', '//evil.example/'],
    ['a backslash path browsers read as another host', '/\\evil.example'],
    ['a path with a tab browsers strip into //', '/\t/evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,hi'],
    ['something that is not a URL', 'not a url'],
    ['an empty string', ''],
    ['an object', { $ne: null }],
  ])('refuses %s', (_label, postAuthUrl) => {
    expect(resolvePostAuthUrl(postAuthUrl, config)).toBeUndefined();
  });

  it('allows only the callback\'s own origin when the app names no others', () => {
    expect([
      resolvePostAuthUrl('https://app.example/a', { redirectUri: config.redirectUri }),
      resolvePostAuthUrl('https://tenant.example/a', { redirectUri: config.redirectUri }),
    ]).toEqual(['https://app.example/a', undefined]);
  });
});
