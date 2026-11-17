import type { IDBEntry, IDBStoreOperations, IDBWrapper, TransactionMode } from "./types.ts"

/**
 * Wraps an `IDBRequest` into a Promise and notifies `onError` on failure.
 */
function promisifyRequest<R>(request: IDBRequest<R>, onError?: (error: Error) => void): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      const error = request.error ?? new Error("IndexedDB request failed")
      onError?.(error)
      reject(error)
    }
  })
}

/**
 * Waits for an `IDBTransaction` to complete or fail.
 */
function waitForTransaction(
  tx: IDBTransaction,
  getFallbackError?: () => Error | null,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () =>
      reject(tx.error ?? getFallbackError?.() ?? new Error("IndexedDB transaction aborted"))
    tx.onerror = (event) => {
      const targetError = (event.target as IDBRequest | null)?.error ?? null
      reject(
        tx.error ??
          targetError ??
          getFallbackError?.() ??
          new Error("IndexedDB transaction failed"),
      )
    }
  })
}

/**
 * Creates an {@link IDBStoreOperations} implementation bound to an active `IDBTransaction`.
 */
function createTransactionOps<TTableName extends string>(
  tx: IDBTransaction,
  onError: (error: Error) => void,
): IDBStoreOperations<TTableName> {
  return {
    async get<T>(table: TTableName, key: IDBValidKey): Promise<T | undefined> {
      const store = tx.objectStore(table)
      return promisifyRequest<T | undefined>(store.get(key), onError)
    },

    async getAll<T>(table: TTableName): Promise<T[]> {
      const store = tx.objectStore(table)
      return promisifyRequest<T[]>(store.getAll() as IDBRequest<T[]>, onError)
    },

    async getAllKeys(table: TTableName): Promise<IDBValidKey[]> {
      const store = tx.objectStore(table)
      return promisifyRequest<IDBValidKey[]>(store.getAllKeys(), onError)
    },

    async add<T>(table: TTableName, key: IDBValidKey, value: T): Promise<IDBValidKey> {
      const store = tx.objectStore(table)
      return promisifyRequest<IDBValidKey>(store.add(value, key), onError)
    },

    async put<T>(table: TTableName, key: IDBValidKey, value: T): Promise<IDBValidKey> {
      const store = tx.objectStore(table)
      return promisifyRequest<IDBValidKey>(store.put(value, key), onError)
    },

    async delete(table: TTableName, key: IDBValidKey): Promise<void> {
      const store = tx.objectStore(table)
      await promisifyRequest(store.delete(key), onError)
    },

    async clear(table: TTableName): Promise<void> {
      const store = tx.objectStore(table)
      await promisifyRequest(store.clear(), onError)
    },

    async bulkGet<T>(table: TTableName, keys: readonly IDBValidKey[]): Promise<(T | undefined)[]> {
      if (keys.length === 0) return []
      const store = tx.objectStore(table)
      return Promise.all(
        keys.map((key) => promisifyRequest<T | undefined>(store.get(key), onError)),
      )
    },

    async bulkAdd<T>(table: TTableName, entries: readonly IDBEntry<T>[]): Promise<IDBValidKey[]> {
      if (entries.length === 0) return []
      const store = tx.objectStore(table)
      return Promise.all(
        entries.map(({ key, value }) =>
          promisifyRequest<IDBValidKey>(store.add(value, key), onError),
        ),
      )
    },

    async bulkPut<T>(table: TTableName, entries: readonly IDBEntry<T>[]): Promise<IDBValidKey[]> {
      if (entries.length === 0) return []
      const store = tx.objectStore(table)
      return Promise.all(
        entries.map(({ key, value }) =>
          promisifyRequest<IDBValidKey>(store.put(value, key), onError),
        ),
      )
    },

    async bulkDelete(table: TTableName, keys: readonly IDBValidKey[]): Promise<void> {
      if (keys.length === 0) return
      const store = tx.objectStore(table)
      await Promise.all(keys.map((key) => promisifyRequest(store.delete(key), onError)))
    },
  }
}

/**
 * Concrete IndexedDB wrapper implementing {@link IDBWrapper} using explicit out-of-line keys.
 */
export class IndexedDBWrapper<const TTableName extends string> implements IDBWrapper<TTableName> {
  private readonly dbName: string
  private readonly version: number
  private readonly tables: readonly TTableName[]
  private dbPromise: Promise<IDBDatabase> | null = null

  /**
   * @param dbName Name of the IndexedDB database.
   * @param tables List of object store names managed by this instance.
   * @param version Schema version passed to `indexedDB.open`. Defaults to `1`.
   */
  constructor(dbName: string, tables: readonly TTableName[], version = 1) {
    this.dbName = dbName
    this.tables = [...tables]
    this.version = version
  }

  /**
   * Opens the database connection lazily and caches it.
   */
  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version)
      let settled = false

      request.onupgradeneeded = () => {
        const db = request.result
        for (const table of this.tables) {
          if (!db.objectStoreNames.contains(table)) {
            db.createObjectStore(table)
          }
        }
      }

      request.onsuccess = () => {
        const db = request.result
        if (settled) {
          db.close()
          return
        }
        settled = true
        db.onversionchange = () => {
          db.close()
          this.dbPromise = null
        }
        db.onclose = () => {
          this.dbPromise = null
        }
        resolve(db)
      }

      request.onerror = () => {
        if (settled) return
        settled = true
        this.dbPromise = null
        reject(request.error ?? new Error("Failed to open IndexedDB"))
      }

      request.onblocked = () => {
        if (settled) return
        settled = true
        this.dbPromise = null
        reject(new Error("IndexedDB open request was blocked"))
      }
    })

    return this.dbPromise
  }

  /**
   * Closes the cached database connection if open.
   */
  async close(): Promise<void> {
    const pending = this.dbPromise
    if (!pending) return
    const db = await pending
    db.close()
    if (this.dbPromise === pending) {
      this.dbPromise = null
    }
  }

  /**
   * Executes a transaction with lifecycle cleanup and error preservation.
   */
  private async runTransaction<R>(
    storeNames: TTableName | readonly TTableName[],
    mode: TransactionMode,
    fn: (ops: IDBStoreOperations<TTableName>) => Promise<R>,
  ): Promise<R> {
    const db = await this.open()
    const tx = db.transaction(typeof storeNames === "string" ? storeNames : [...storeNames], mode)
    let firstRequestError: Error | null = null
    const recordError = (error: Error) => {
      firstRequestError ??= error
    }
    const completion = waitForTransaction(tx, () => firstRequestError)
    completion.catch(() => {})
    const ops = createTransactionOps<TTableName>(tx, recordError)

    try {
      const result = await fn(ops)
      await completion
      return result
    } catch (error) {
      try {
        tx.abort()
      } catch {
        // Ignore if the transaction is already inactive or aborted.
      }
      await completion.catch(() => {})
      throw error
    }
  }

  /** @inheritdoc */
  get<T>(table: TTableName, key: IDBValidKey): Promise<T | undefined> {
    return this.runTransaction(table, "readonly", (ops) => ops.get<T>(table, key))
  }

  /** @inheritdoc */
  getAll<T>(table: TTableName): Promise<T[]> {
    return this.runTransaction(table, "readonly", (ops) => ops.getAll<T>(table))
  }

  /** @inheritdoc */
  getAllKeys(table: TTableName): Promise<IDBValidKey[]> {
    return this.runTransaction(table, "readonly", (ops) => ops.getAllKeys(table))
  }

  /** @inheritdoc */
  add<T>(table: TTableName, key: IDBValidKey, value: T): Promise<IDBValidKey> {
    return this.runTransaction(table, "readwrite", (ops) => ops.add<T>(table, key, value))
  }

  /** @inheritdoc */
  put<T>(table: TTableName, key: IDBValidKey, value: T): Promise<IDBValidKey> {
    return this.runTransaction(table, "readwrite", (ops) => ops.put<T>(table, key, value))
  }

  /** @inheritdoc */
  delete(table: TTableName, key: IDBValidKey): Promise<void> {
    return this.runTransaction(table, "readwrite", (ops) => ops.delete(table, key))
  }

  /** @inheritdoc */
  clear(table: TTableName): Promise<void> {
    return this.runTransaction(table, "readwrite", (ops) => ops.clear(table))
  }

  /** @inheritdoc */
  bulkGet<T>(table: TTableName, keys: readonly IDBValidKey[]): Promise<(T | undefined)[]> {
    return this.runTransaction(table, "readonly", (ops) => ops.bulkGet<T>(table, keys))
  }

  /** @inheritdoc */
  bulkAdd<T>(table: TTableName, entries: readonly IDBEntry<T>[]): Promise<IDBValidKey[]> {
    return this.runTransaction(table, "readwrite", (ops) => ops.bulkAdd<T>(table, entries))
  }

  /** @inheritdoc */
  bulkPut<T>(table: TTableName, entries: readonly IDBEntry<T>[]): Promise<IDBValidKey[]> {
    return this.runTransaction(table, "readwrite", (ops) => ops.bulkPut<T>(table, entries))
  }

  /** @inheritdoc */
  bulkDelete(table: TTableName, keys: readonly IDBValidKey[]): Promise<void> {
    return this.runTransaction(table, "readwrite", (ops) => ops.bulkDelete(table, keys))
  }

  /** @inheritdoc */
  transaction<R>(
    fn: (tx: IDBStoreOperations<TTableName>) => Promise<R>,
    mode: TransactionMode = "readwrite",
  ): Promise<R> {
    return this.runTransaction(this.tables, mode, fn)
  }
}
