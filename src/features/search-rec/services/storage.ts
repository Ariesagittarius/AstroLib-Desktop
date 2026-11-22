import type { AcademicChunk } from '../types/candidate.ts';
import { quantizeToInt8, dequantizeFromInt8 } from '../core/vector/quantizer.ts';

const DB_NAME = 'astrolib_embeddings_db';
const DB_VERSION = 1;
const STORE_NAME = 'book_vectors';

export interface StoredBookVectors {
  bookId: string;
  dim: number;
  format: 'int8' | 'float32';
  count: number;

  scales: number[];
  int8Data: ArrayBuffer;
  chunks: AcademicChunk[];
  updatedAt: string;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'bookId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveBookVectorsToLocal(record: StoredBookVectors): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function loadBookVectorsFromLocal(bookId: string): Promise<StoredBookVectors | null> {
  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(bookId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function parseEmbeddingsBinary(buffer: ArrayBuffer): {
  dim: number;
  format: 'int8' | 'float32';
  count: number;
  int8Vectors?: Array<{ scale: number; data: Int8Array }>;
  float32Vectors?: Float32Array[];
} {
  const dataView = new DataView(buffer);

  const m0 = String.fromCharCode(dataView.getUint8(0));
  const m1 = String.fromCharCode(dataView.getUint8(1));
  const m2 = String.fromCharCode(dataView.getUint8(2));
  const m3 = String.fromCharCode(dataView.getUint8(3));
  if (m0 !== 'A' || m1 !== 'B' || m2 !== 'P' || m3 !== '1') {
    throw new Error('无效的 ABP 向量文件魔数');
  }

  const formatCode = dataView.getUint8(4);
  const format: 'int8' | 'float32' = formatCode === 1 ? 'int8' : 'float32';
  const dim = dataView.getUint16(5, true);
  const count = dataView.getUint32(7, true);

  let offset = 11;

  if (format === 'int8') {
    const int8Vectors: Array<{ scale: number; data: Int8Array }> = [];
    for (let i = 0; i < count; i++) {
      const scale = dataView.getFloat32(offset, true);
      offset += 4;
      const data = new Int8Array(buffer, offset, dim);
      offset += dim;
      int8Vectors.push({ scale, data });
    }
    return { dim, format, count, int8Vectors };
  } else {
    const float32Vectors: Float32Array[] = [];
    for (let i = 0; i < count; i++) {
      const data = new Float32Array(buffer, offset, dim);
      offset += dim * 4;
      float32Vectors.push(data);
    }
    return { dim, format, count, float32Vectors };
  }
}

export function serializeEmbeddingsBinary(
  vectors: Float32Array[],
  format: 'int8' | 'float32' = 'int8',
): { buffer: Buffer | ArrayBuffer; dim: number; count: number } {
  const count = vectors.length;
  const dim = count > 0 ? vectors[0].length : 0;

  const headerSize = 11;
  const bodySize = format === 'int8' ? count * (4 + dim) : count * (dim * 4);
  const totalSize = headerSize + bodySize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  view.setUint8(0, 'A'.charCodeAt(0));
  view.setUint8(1, 'B'.charCodeAt(0));
  view.setUint8(2, 'P'.charCodeAt(0));
  view.setUint8(3, '1'.charCodeAt(0));
  view.setUint8(4, format === 'int8' ? 1 : 4);
  view.setUint16(5, dim, true);
  view.setUint32(7, count, true);

  let offset = headerSize;

  if (format === 'int8') {
    for (const v of vectors) {
      const q = quantizeToInt8(v);
      view.setFloat32(offset, q.scale, true);
      offset += 4;
      const int8Slice = new Int8Array(buffer, offset, dim);
      int8Slice.set(q.data);
      offset += dim;
    }
  } else {
    for (const v of vectors) {
      const floatSlice = new Float32Array(buffer, offset, dim);
      floatSlice.set(v);
      offset += dim * 4;
    }
  }

  return { buffer, dim, count };
}
