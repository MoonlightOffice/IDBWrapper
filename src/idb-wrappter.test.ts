import { describe, expect, test } from "vitest"
import { IndexedDBWrapper } from "./idb-wrappter.ts"
import type { IDBEntry, TransactionMode } from "./types.ts"

interface User {
  id: string
  name: string
}

interface Order {
  id: string
  userId: string
  amount: number
}

type TableName = "users" | "orders"

function deleteDatabase(dbName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error("Failed to delete test database"))
    req.onblocked = () => reject(new Error(`deleteDatabase("${dbName}") was blocked`))
  })
}

describe("IndexedDBWrapper", () => {
  interface In {
    initialUsers?: IDBEntry<User>[]
    initialOrders?: IDBEntry<Order>[]
    op: (db: IndexedDBWrapper<TableName>, reopened: IndexedDBWrapper<TableName>) => Promise<unknown>
  }

  interface Want {
    result?: unknown
    errorName?: string
    errorMessage?: string
    users?: User[]
    orders?: Order[]
  }

  const alice: User = { id: "u1", name: "Alice" }
  const bob: User = { id: "u2", name: "Bob" }
  const charlie: User = { id: "u3", name: "Charlie" }
  const order1: Order = { id: "o1", userId: "u1", amount: 500 }

  const tests: { name: string; in: In; want: Want }[] = [
    {
      name: "get missing key; returns undefined",
      in: {
        op: (db) => db.get<User>("users", "missing"),
      },
      want: { result: undefined, users: [] },
    },
    {
      name: "add record and read from reopened instance; persists record",
      in: {
        op: async (db, reopened) => {
          const key = await db.add<User>("users", "u1", alice)
          const loaded = await reopened.get<User>("users", key)
          return { key, loaded }
        },
      },
      want: { result: { key: "u1", loaded: alice }, users: [alice] },
    },
    {
      name: "add duplicate key; rejects with ConstraintError and preserves existing record",
      in: {
        initialUsers: [{ key: "u1", value: alice }],
        op: (db) => db.add<User>("users", "u1", { id: "u1", name: "Impostor" }),
      },
      want: { errorName: "ConstraintError", users: [alice] },
    },
    {
      name: "put existing key; overwrites existing record",
      in: {
        initialUsers: [{ key: "u1", value: alice }],
        op: (db) => db.put<User>("users", "u1", { id: "u1", name: "Alice Updated" }),
      },
      want: {
        result: "u1",
        users: [{ id: "u1", name: "Alice Updated" }],
      },
    },
    {
      name: "getAll and getAllKeys on populated table; returns all records and keys",
      in: {
        initialUsers: [
          { key: "u1", value: alice },
          { key: "u2", value: bob },
        ],
        op: async (db) => ({
          records: await db.getAll<User>("users"),
          keys: await db.getAllKeys("users"),
        }),
      },
      want: {
        result: { records: [alice, bob], keys: ["u1", "u2"] },
        users: [alice, bob],
      },
    },
    {
      name: "delete one key; removes only target record",
      in: {
        initialUsers: [
          { key: "u1", value: alice },
          { key: "u2", value: bob },
        ],
        op: (db) => db.delete("users", "u1"),
      },
      want: { users: [bob] },
    },
    {
      name: "clear table; removes all records",
      in: {
        initialUsers: [
          { key: "u1", value: alice },
          { key: "u2", value: bob },
        ],
        op: (db) => db.clear("users"),
      },
      want: { users: [] },
    },
    {
      name: "bulkGet with existing and missing keys; preserves order with undefined for missing",
      in: {
        initialUsers: [
          { key: "u1", value: alice },
          { key: "u2", value: bob },
        ],
        op: (db) => db.bulkGet<User>("users", ["u2", "missing", "u1"]),
      },
      want: {
        result: [bob, undefined, alice],
        users: [alice, bob],
      },
    },
    {
      name: "bulk operations with empty arrays; completes as no-op",
      in: {
        initialUsers: [{ key: "u1", value: alice }],
        op: async (db) => ({
          get: await db.bulkGet<User>("users", []),
          add: await db.bulkAdd<User>("users", []),
          put: await db.bulkPut<User>("users", []),
          del: await db.bulkDelete("users", []),
        }),
      },
      want: {
        result: { get: [], add: [], put: [], del: undefined },
        users: [alice],
      },
    },
    {
      name: "bulkAdd with one duplicate key; aborts with ConstraintError and rolls back entire batch",
      in: {
        initialUsers: [{ key: "u1", value: alice }],
        op: (db) =>
          db.bulkAdd<User>("users", [
            { key: "u2", value: bob },
            { key: "u1", value: alice },
          ]),
      },
      want: { errorName: "ConstraintError", users: [alice] },
    },
    {
      name: "bulkPut with new and existing keys; inserts and updates all",
      in: {
        initialUsers: [{ key: "u1", value: alice }],
        op: (db) =>
          db.bulkPut<User>("users", [
            { key: "u1", value: { id: "u1", name: "Alice v2" } },
            { key: "u2", value: bob },
          ]),
      },
      want: {
        result: ["u1", "u2"],
        users: [{ id: "u1", name: "Alice v2" }, bob],
      },
    },
    {
      name: "bulkDelete multiple keys; deletes specified keys only",
      in: {
        initialUsers: [
          { key: "u1", value: alice },
          { key: "u2", value: bob },
          { key: "u3", value: charlie },
        ],
        op: (db) => db.bulkDelete("users", ["u1", "u3"]),
      },
      want: { users: [bob] },
    },
    {
      name: "transaction across two tables succeeding; commits changes to both tables",
      in: {
        initialUsers: [{ key: "u1", value: alice }],
        op: (db) =>
          db.transaction(async (tx) => {
            await tx.put<User>("users", "u1", { id: "u1", name: "Alice Ordered" })
            return tx.add<Order>("orders", "o1", order1)
          }),
      },
      want: {
        result: "o1",
        users: [{ id: "u1", name: "Alice Ordered" }],
        orders: [order1],
      },
    },
    {
      name: "transaction throwing midway across two tables; aborts and rolls back both tables",
      in: {
        initialUsers: [{ key: "u1", value: alice }],
        initialOrders: [],
        op: (db) =>
          db.transaction(async (tx) => {
            await tx.put<User>("users", "u1", { id: "u1", name: "Should Rollback" })
            await tx.add<Order>("orders", "o1", order1)
            throw new Error("boom")
          }),
      },
      want: {
        errorMessage: "boom",
        users: [alice],
        orders: [],
      },
    },
    {
      name: "transaction swallowing ConstraintError; aborts commit and preserves ConstraintError cause",
      in: {
        initialUsers: [{ key: "u1", value: alice }],
        op: (db) =>
          db.transaction(async (tx) => {
            await tx.put<User>("users", "u1", { id: "u1", name: "Should Rollback" })
            try {
              await tx.add<User>("users", "u1", alice)
            } catch {
              // Swallowing request error still causes IDB transaction abort
            }
          }),
      },
      want: {
        errorName: "ConstraintError",
        users: [alice],
      },
    },
    {
      name: "transaction in readonly mode attempting write; rejects with ReadOnlyError without modifying data",
      in: {
        initialUsers: [{ key: "u1", value: alice }],
        op: (db) => {
          const mode: TransactionMode = "readonly"
          return db.transaction(
            (tx) => tx.put<User>("users", "u1", { id: "u1", name: "Blocked" }),
            mode,
          )
        },
      },
      want: {
        errorName: "ReadOnlyError",
        users: [alice],
      },
    },
    {
      name: "close and reuse wrapper; reopens connection and completes subsequent operations",
      in: {
        initialUsers: [{ key: "u1", value: alice }],
        op: async (db) => {
          await db.close()
          return db.get<User>("users", "u1")
        },
      },
      want: {
        result: alice,
        users: [alice],
      },
    },
  ]

  for (const tt of tests) {
    test(tt.name, async () => {
      await using cleanup = new AsyncDisposableStack()
      const dbName = `test-idb-${crypto.randomUUID()}`
      const db = new IndexedDBWrapper(dbName, ["users", "orders"])
      const reopened = new IndexedDBWrapper(dbName, ["users", "orders"])
      cleanup.defer(async () => {
        await db.close()
        await reopened.close()
        await deleteDatabase(dbName)
      })

      if (tt.in.initialUsers?.length) {
        await db.bulkAdd("users", tt.in.initialUsers)
      }
      if (tt.in.initialOrders?.length) {
        await db.bulkAdd("orders", tt.in.initialOrders)
      }

      if (tt.want.errorName !== undefined || tt.want.errorMessage !== undefined) {
        let caught: unknown
        try {
          await tt.in.op(db, reopened)
        } catch (error) {
          caught = error
        }
        expect(caught).toBeInstanceOf(Error)
        if (tt.want.errorName !== undefined) {
          expect((caught as Error).name).toBe(tt.want.errorName)
        }
        if (tt.want.errorMessage !== undefined) {
          expect((caught as Error).message).toBe(tt.want.errorMessage)
        }
      } else {
        const actual = await tt.in.op(db, reopened)
        if ("result" in tt.want) {
          expect(actual).toEqual(tt.want.result)
        }
      }

      if (tt.want.users !== undefined) {
        expect(await reopened.getAll<User>("users")).toEqual(tt.want.users)
      }
      if (tt.want.orders !== undefined) {
        expect(await reopened.getAll<Order>("orders")).toEqual(tt.want.orders)
      }
    })
  }

  test("version upgrade adding new table; preserves existing table and creates new table", async () => {
    await using cleanup = new AsyncDisposableStack()
    const dbName = `test-idb-${crypto.randomUUID()}`
    cleanup.defer(() => deleteDatabase(dbName))

    const v1 = new IndexedDBWrapper(dbName, ["logs"], 1)
    cleanup.defer(() => v1.close())

    await v1.add("logs", "l1", { msg: "first" })
    await v1.close()

    const v2 = new IndexedDBWrapper(dbName, ["logs", "items"], 2)
    cleanup.defer(() => v2.close())

    await v2.add("items", ["t1", "i1"], { qty: 3 })
    expect(await v2.get("logs", "l1")).toEqual({ msg: "first" })
    expect(await v2.get("items", ["t1", "i1"])).toEqual({ qty: 3 })
  })

  test("blocked version upgrade; rejects without leaking an unclosed connection", async () => {
    await using cleanup = new AsyncDisposableStack()
    const dbName = `test-idb-${crypto.randomUUID()}`
    const v1 = new IndexedDBWrapper(dbName, ["users"], 1)
    cleanup.defer(() => v1.close())

    await v1.getAll("users")
    const v2 = new IndexedDBWrapper(dbName, ["users", "orders"], 2)
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    cleanup.defer(() => raw.close())

    await expect(v2.getAll("users")).rejects.toThrow(/blocked/)
    raw.close()
    await v1.close()
    await new Promise((r) => setTimeout(r, 20))
    await deleteDatabase(dbName)
  })
})
