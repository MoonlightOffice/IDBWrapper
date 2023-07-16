# IDBWrapper
IDBWrapper is a simple and lightweight IndexedDB wrapper written in TypeScript. It is distributed as a single file module.

### Sample Usage
```TypeScript
// Connect to IndexedDB
import { newIDBWrapper, type IDBWrapperConfig } from './idb-wrapper';

const idbConfig: IDBWrapperConfig = {
	dbname: 'storage',
	stores: ['pokemon', 'video'],
	version: 1
};

const storage = await newIDBWrapper(idbConfig);

// Close db connection
storage.close();
```

```TypeScript
/* PUT */

// JSON object
const jsonObject = {
	name: 'Bulbasaur', 
	type: ['Grass', 'Poison']
};
const ok = await storage.put('pokemon', 1, jsonObject);
if (!ok) {
	console.error("Failed to put data");
	return;
}

// Blob data
const someLargeData = new Blob([])
const ok = await storage.put('video', 'video-id-1', someLargeData);
if (!ok) {
	console.error("Failed to put data");
	return;
}
```

```TypeScript
/* GET */

const dataBlob: Blob = await storage.get('video', 'video-id-1');
if (poke1 === null) {
	console.error("Failed to put data");
	return;
}
console.log(`The size of the data is ${dataBlob.size}`);
```

```TypeScript
/* DELETE */

const ok = await storage.delete('video', 'video-id-1');
if (!ok) {
	console.error("Failed to delete data");
	return;
}
```