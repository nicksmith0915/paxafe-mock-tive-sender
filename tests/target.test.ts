import { describe, expect, it } from 'vitest';

import { allowedTargetHosts, checkTarget } from '@/lib/target';

const API_HOST = 'paxafe-integration-api-five.vercel.app';

describe('allowedTargetHosts', () => {
  it('allows only the deployed API in production', () => {
    expect(allowedTargetHosts({ NODE_ENV: 'production' })).toEqual([API_HOST]);
  });

  it('adds loopback hosts outside production for local development', () => {
    expect(allowedTargetHosts({ NODE_ENV: 'development' })).toEqual(
      expect.arrayContaining([API_HOST, 'localhost', '127.0.0.1']),
    );
  });

  it('replaces the default entirely when configured', () => {
    expect(allowedTargetHosts({ NODE_ENV: 'production', ALLOWED_TARGET_HOSTS: ' Staging.Example.com , api.example.com ' }))
      .toEqual(['staging.example.com', 'api.example.com']);
  });

  it('ignores an empty configuration rather than allowing nothing', () => {
    expect(allowedTargetHosts({ NODE_ENV: 'production', ALLOWED_TARGET_HOSTS: ' , ' })).toEqual([API_HOST]);
  });
});

describe('checkTarget', () => {
  const production = [API_HOST];

  it('accepts the Integration API', () => {
    expect(checkTarget(`https://${API_HOST}/api/webhook/tive`, production)).toMatchObject({ ok: true });
  });

  it.each([
    ['an arbitrary internet host', 'https://example.com/anything'],
    ['a lookalike subdomain', `https://${API_HOST}.attacker.example/api`],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data'],
    ['loopback in production', 'http://localhost:3000/api/webhook/tive'],
  ])('refuses %s', (_label, url) => {
    expect(checkTarget(url, production)).toMatchObject({ ok: false });
  });

  it('answers a disallowed host with 403 and names what is allowed', () => {
    expect(checkTarget('https://example.com/', production)).toMatchObject({
      ok: false,
      status: 403,
      reason: expect.stringContaining(API_HOST),
    });
  });

  it('refuses plain http to a remote host, which would expose the API key', () => {
    expect(checkTarget(`http://${API_HOST}/api/webhook/tive`, production)).toMatchObject({ ok: false, status: 400 });
  });

  it('accepts plain http to loopback when loopback is allowed', () => {
    expect(checkTarget('http://localhost:3000/api/webhook/tive', ['localhost'])).toMatchObject({ ok: true });
  });

  it('refuses credentials embedded in the URL', () => {
    expect(checkTarget(`https://user:pass@${API_HOST}/`, production)).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses something that is not a URL', () => {
    expect(checkTarget('not a url', production)).toMatchObject({ ok: false, status: 400 });
  });
});
