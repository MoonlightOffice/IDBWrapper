/**
 * Access mode for an IndexedDB transaction.
 * - `"readonly"`: Allows concurrent read transactions on the same object stores.
 * - `"readwrite"`: Serializes access to the involved object stores across transactions.
 */
export type TransactionMode = "readonly" | "readwrite"

/**
 * Explicit key-value entry used by bulk write operations.
 */
export interface IDBEntry<T> {
  key: IDBValidKey
  value: T
}

/**
 * Store operations shared by standalone calls and transaction callbacks.
 */
export interface IDBStoreOperations<TTableName extends string> {
  /**
   * Retrieves a single record by key.
   * Returns `undefined` if no matching record exists.
   */
  get<T>(table: TTableName, key: IDBValidKey): Promise<T | undefined>

  /**
   * Retrieves all records in the table.
   */
  getAll<T>(table: TTableName): Promise<T[]>

  /**
   * Retrieves all keys in the table.
   */
  getAllKeys(table: TTableName): Promise<IDBValidKey[]>

  /**
   * Inserts a new record under the specified key.
   * Fails if a record with the same key already exists.
   *
   * @returns The key of the inserted record.
   */
  add<T>(table: TTableName, key: IDBValidKey, value: T): Promise<IDBValidKey>

  /**
   * Inserts or updates a record under the specified key (upsert).
   *
   * @returns The key of the stored record.
   */
  put<T>(table: TTableName, key: IDBValidKey, value: T): Promise<IDBValidKey>

  /**
   * Deletes the record matching the specified key.
   */
  delete(table: TTableName, key: IDBValidKey): Promise<void>

  /**
   * Deletes all records in the table.
   */
  clear(table: TTableName): Promise<void>

  /**
   * Retrieves multiple records matching the given keys.
   * The returned array preserves the order and length of `keys`, with `undefined` for missing entries.
   */
  bulkGet<T>(table: TTableName, keys: readonly IDBValidKey[]): Promise<(T | undefined)[]>

  /**
   * Inserts multiple new records with explicit keys.
   * Fails and aborts the transaction if any key already exists.
   *
   * @returns Keys of the inserted records.
   */
  bulkAdd<T>(table: TTableName, entries: readonly IDBEntry<T>[]): Promise<IDBValidKey[]>

  /**
   * Inserts or updates multiple records with explicit keys (upsert).
   *
   * @returns Keys of the stored records.
   */
  bulkPut<T>(table: TTableName, entries: readonly IDBEntry<T>[]): Promise<IDBValidKey[]>

  /**
   * Deletes multiple records matching the given keys.
   */
  bulkDelete(table: TTableName, keys: readonly IDBValidKey[]): Promise<void>
}

/**
 * Public interface for the IndexedDB wrapper.
 * Database name, version, and table list are expected to be provided to the implementation constructor.
 */
export interface IDBWrapper<TTableName extends string> extends IDBStoreOperations<TTableName> {
  /**
   * Starts a transaction spanning all registered tables and executes the callback.
   * Aborts the transaction if the callback throws or rejects.
   *
   * Note: IndexedDB auto-commits a transaction when control returns to the event loop
   * without active IDB requests. Do not `await` non-IndexedDB asynchronous operations
   * (such as `fetch` or timers) inside `fn`.
   *
   * @param fn Callback receiving a transaction-scoped `IDBStoreOperations` instance.
   * @param mode Transaction access mode. Defaults to `"readwrite"`.
   */
  transaction<R>(
    fn: (tx: IDBStoreOperations<TTableName>) => Promise<R>,
    mode?: TransactionMode,
  ): Promise<R>
}
