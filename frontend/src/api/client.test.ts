import { afterEach, describe, expect, it, vi } from 'vitest';
import { authApi } from './client';

// Le client API doit borner chaque requête dans le temps (#131) : un backend
// muet ne doit pas laisser l'UI en chargement infini.

describe('apiCall — timeout & erreurs réseau', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });

  it('succès : renvoie ok/status/data du serveur', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ token: 't', id: '1', username: 'a' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    const res = await authApi.login('a', 'b');
    expect(res).toEqual({ ok: true, status: 200, data: { token: 't', id: '1', username: 'a' } });
  });

  it('serveur injoignable : { ok:false, status:0, error:"Serveur indisponible." }', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    const res = await authApi.login('a', 'b');
    expect(res).toEqual({ ok: false, status: 0, data: { error: 'Serveur indisponible.' } });
  });

  it('délai dépassé : le signal de timeout rejette → { error:"Délai dépassé." }', async () => {
    // `AbortSignal.timeout` rejette le fetch avec une DOMException `TimeoutError` :
    // on la simule pour vérifier que ce cas est distingué d'un échec réseau.
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }) as typeof fetch;
    const res = await authApi.login('a', 'b');
    expect(res).toEqual({ ok: false, status: 0, data: { error: 'Délai dépassé.' } });
  });

  it('passe bien un signal de timeout à fetch', async () => {
    const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    globalThis.fetch = spy as typeof fetch;
    await authApi.login('a', 'b');
    const init = spy.mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
