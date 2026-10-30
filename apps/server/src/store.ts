import type { Firestore } from 'firebase-admin/firestore';
export interface Transaction {
  get<T>(path: string): Promise<T | undefined>;
  list<T>(collectionPath: string): Promise<T[]>;
  set<T extends object>(path: string, value: T): void;
  delete(path: string): void;
}
export interface Store {
  run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
}
export class FirestoreStore implements Store {
  constructor(private db: Firestore) {}
  run<T>(fn: (tx: Transaction) => Promise<T>) {
    return this.db.runTransaction((tx) =>
      fn({
        get: async <V>(path: string) =>
          (await tx.get(this.db.doc(path))).data() as V | undefined,
        list: async <V>(path: string) =>
          (await tx.get(this.db.collection(path))).docs.map((d) => d.data() as V),
        set: (path, value) => {
          tx.set(this.db.doc(path), value);
        },
        delete: (path) => tx.delete(this.db.doc(path)),
      }),
    );
  }
}
/** Serialized, isolated transactions for deterministic tests. Never used by production. */
export class MemoryStore implements Store {
  private data = new Map<string, object>();
  private queue: Promise<unknown> = Promise.resolve();
  run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const copy = new Map(
        [...this.data].map(([k, v]) => [k, structuredClone(v)]),
      );
      const value = await fn({
        get: async <V>(path: string) =>
          structuredClone(copy.get(path)) as V | undefined,
        list: async <V>(path: string) => {
          const prefix = `${path}/`;
          return [...copy]
            .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .map(([, value]) => structuredClone(value) as V);
        },
        set: (path, value) => {
          copy.set(path, structuredClone(value));
        },
        delete: (path) => {
          copy.delete(path);
        },
      });
      this.data = copy;
      return value;
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
