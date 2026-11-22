import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LibraryClient } from '../../src/features/library/core/library-client';

describe('LibraryClient Adapter', () => {
  let client: LibraryClient;
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as any).window;

  beforeEach(() => {
    client = new LibraryClient();
    (globalThis as any).window = {};
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).window = originalWindow;
    vi.restoreAllMocks();
  });

  it('correctly detects electron environment based on window.astrolib', () => {
    expect(client.isElectron()).toBe(false);

    (globalThis as any).window = { astrolib: {} };
    expect(client.isElectron()).toBe(true);
  });

  it('fetches entities via HTTP when bridge is absent', async () => {
    const mockEntities = [{ id: 'book:test', kind: 'book', title: 'Test Book' }];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ entities: mockEntities }),
    } as any);

    const entities = await client.getEntities();
    expect(entities).toEqual(mockEntities);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/library/entities');
  });

  it('fetches entities via window.astrolib bridge when present', async () => {
    const mockEntities = [{ id: 'book:bridge', kind: 'book', title: 'Bridge Book' }];
    (globalThis as any).window = {
      astrolib: {
        getLibraryEntities: vi.fn().mockResolvedValue(mockEntities),
      },
    };

    const entities = await client.getEntities();
    expect(entities).toEqual(mockEntities);
    expect((globalThis as any).window.astrolib.getLibraryEntities).toHaveBeenCalled();
  });

  it('creates custom shelf via HTTP or bridge', async () => {
    const mockShelf = { id: 'shelf-1', name: 'Algebra', itemCount: 0, createdAt: 1000 };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ shelf: mockShelf }),
    } as any);

    const created = await client.createShelf('Algebra');
    expect(created).toEqual(mockShelf);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/library/shelves', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Algebra' }),
    }));

    await expect(client.createShelf('   ')).rejects.toThrow('Shelf name cannot be empty');

    (globalThis as any).window = {
      astrolib: {
        createLibraryShelf: vi.fn().mockResolvedValue(mockShelf),
      },
    };
    const bridgeCreated = await client.createShelf('Algebra');
    expect(bridgeCreated).toEqual(mockShelf);
    expect((globalThis as any).window.astrolib.createLibraryShelf).toHaveBeenCalledWith('Algebra');
  });

  it('installs ABP packages via HTTP upload or bridge', async () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as any);

    await client.installAbp(buffer);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/library/upload-abp', expect.objectContaining({
      method: 'POST',
      body: buffer,
    }));

    const mockInstall = vi.fn().mockResolvedValue(undefined);
    (globalThis as any).window = {
      astrolib: {
        installBookFromAbp: mockInstall,
      },
    };

    await client.installAbp(buffer);
    expect(mockInstall).toHaveBeenCalledWith(buffer);
  });

  it('handles official catalog acquisition and remote installation', async () => {
    const mockCatalog = {
      sourceUrl: 'https://example.com/catalog.json',
      releaseTag: 'v0.0.4',
      books: [{ id: 'math', title: 'Math Book', packFileName: 'math.abp' }],
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/abp-packs/catalog.json') {
        return Promise.resolve({
          ok: true,
          json: async () => mockCatalog,
        } as any);
      }
      if (url === '/abp-packs/math.abp') {
        return Promise.resolve({
          ok: true,
          arrayBuffer: async () => new Uint8Array([10, 20]).buffer,
        } as any);
      }
      if (url === '/api/library/upload-abp') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as any);
      }
      return Promise.reject(new Error('Unknown URL: ' + url));
    });

    const catalog = await client.fetchOfficialCatalog();
    expect(catalog.releaseTag).toBe('v0.0.4');

    await client.installOfficialBook(mockCatalog.books[0]);
    expect(globalThis.fetch).toHaveBeenCalledWith('/abp-packs/math.abp');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/library/upload-abp', expect.anything());
  });
});
