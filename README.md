# IDBWrapper

A lightweight, type-safe IndexedDB wrapper for TypeScript with explicit `(key, value)` operations and callback-based transactions.

## Installation

Install directly from GitHub with `bun` or `npm`:

```bash
bun add git+https://github.com/MoonlightOffice/IDBWrapper#v2
```

```bash
npm install git+https://github.com/MoonlightOffice/IDBWrapper#v2
```

Or add it to your `package.json`:

```json
{
  "dependencies": {
    "idbwrapper": "git+https://github.com/MoonlightOffice/IDBWrapper#v2"
  }
}
```

## Quick Start

```ts
import { IndexedDBWrapper } from "idbwrapper"

interface User {
  name: string
}

interface Order {
  userId: string
  total: number
}

// Table names are inferred as literal types ("users" | "orders")
const db = new IndexedDBWrapper("my-app", ["users", "orders"])

// Single CRUD operations
await db.add<User>("users", "u1", { name: "Alice" })
await db.put<User>("users", "u1", { name: "Alice Updated" })
const user = await db.get<User>("users", "u1")
const keys = await db.getAllKeys("users")
await db.delete("users", "u1")

// Bulk operations
await db.bulkPut<User>("users", [
  { key: "u1", value: { name: "Alice" } },
  { key: "u2", value: { name: "Bob" } },
])
const users = await db.bulkGet<User>("users", ["u1", "u2", "missing"])
// => [{ name: "Alice" }, { name: "Bob" }, undefined]

// Multi-table transaction (defaults to "readwrite"; rolls back on error)
await db.transaction(async (tx) => {
  const existing = await tx.get<User>("users", "u1")
  if (!existing) throw new Error("User not found")

  await tx.add<Order>("orders", "o1", { userId: "u1", total: 1200 })
})
```

## API

- **Single**: `get`, `getAll`, `getAllKeys`, `add`, `put`, `delete`, `clear`
- **Bulk**: `bulkGet`, `bulkAdd`, `bulkPut`, `bulkDelete`
- **Transaction**: `transaction(fn, mode?)` (`mode` defaults to `"readwrite"`; pass `"readonly"` for read-only transactions)
- **Lifecycle**: `close()` (optional; only needed when explicitly closing connections before deleting the database or in tests)

## Notes

- **Explicit out-of-line keys**: All object stores are created without `keyPath` or `autoIncrement`, and every write requires an explicit key. Do not use this wrapper on pre-existing stores created with `keyPath`.
- **No non-IndexedDB `await` inside `transaction`**: IndexedDB auto-commits a transaction when control returns to the event loop without pending IDB requests. Keep `tx` callbacks limited to `tx.*` calls and synchronous logic.
