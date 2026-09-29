import { TestBed } from '@angular/core/testing';
import { VersionCheckService } from './version-check.service';

describe('VersionCheckService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [VersionCheckService] });
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  function jsonResponse(body: unknown, ok = true): Response {
    return { ok, json: () => Promise.resolve(body) } as Response;
  }

  it('capture la version courante sans signaler de mise à jour', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ version: 'v1' }));
    const service = TestBed.inject(VersionCheckService);

    service.start();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(service.updateAvailable()).toBe(false);
  });

  it('signale une mise à jour disponible quand la version change', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ version: 'v1' }));
    const service = TestBed.inject(VersionCheckService);
    service.start();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValueOnce(jsonResponse({ version: 'v2' }));
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(service.updateAvailable()).toBe(true);
  });

  it('ne signale rien tant que la version ne change pas', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ version: 'v1' }));
    const service = TestBed.inject(VersionCheckService);
    service.start();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(service.updateAvailable()).toBe(false);
  });

  it('ignore silencieusement une absence de fichier de version', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false));
    const service = TestBed.inject(VersionCheckService);

    service.start();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(service.updateAvailable()).toBe(false);
  });

  it('recharge la page sur demande', () => {
    const service = TestBed.inject(VersionCheckService);
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload }, writable: true });

    service.reload();

    expect(reload).toHaveBeenCalled();
  });
});
