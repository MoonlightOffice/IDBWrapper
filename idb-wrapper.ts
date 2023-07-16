interface IDBWrapper {
	/**
	 * Close database connection. It's safe to call this function even when the connection is already closed.
	 */
	close: () => void;

	/**
	 * Get data of the key from the specified store.
	 * 
	 * @param store Object store's name
	 * @param key The key of the data
	 * @returns The data of the key. Returns null if the key doesn't exist or an error occurs.
	 */
	get: (store: string, key: IDBValidKey) => Promise<any>;

	/**
	 * Get all keys of the object store.
	 * 
	 * @param store Object store's name
	 * @return All keys in the object store
	 */
	getAllKeys(store: string): Promise<IDBValidKey[]>;

	/**
	 * Check if the specified key exists in the store.
	 * 
	 * @param store Object store's name
	 * @param key The key of your interest
	 * @return true if it exists, false otherwise
	 */
	isKeyExist(store: string, key: IDBValidKey): Promise<boolean>;

	/**
	 * Save the data in the given store. Overwrite data if the key already exists.
	 * 
	 * @param store Object store's name
	 * @param key The key of the data
	 * @param value The data you want to save
	 * @returns true if successful, false otherwise
	 */
	put: (store: string, key: IDBValidKey, value: any) => Promise<boolean>;

	/**
	 * Delete the data of the key.
	 * 
	 * @param store Object store's name
	 * @param key The key of your interest
	 * @returns true if successful, false otherwise
	 */
	delete: (store: string, key: IDBValidKey) => Promise<boolean>;
}

export interface IDBWrapperConfig {
	dbname: string;
	version: number;
	stores: string[];
}

/**
 * Return the IDBWrapper instance which has the connection to specified database.
 * Throws an error if something went wrong.
 * 
 * @param config IndexedDB config
 * @returns IDBWrapper instance
 */
export async function newIDBWrapper(config: IDBWrapperConfig): Promise<IDBWrapper> {
	const instance = await IDBWrapperImpl.connect(config);
	return instance;
}

/**
 * 
 * @param name The name of the database you want to delete
 * @returns true if successfull, false otherwise
 */
export async function deleteDatabase(name: string): Promise<boolean> {
	return new Promise((resolve) => {
		const req = indexedDB.deleteDatabase(name);

		req.onsuccess = (_) => resolve(true);
		req.onerror = (_) => resolve(false);
	});
}

class IDBWrapperImpl implements IDBWrapper {
	idbdatabase: IDBDatabase | undefined;

	constructor() {}

	static async connect(config: IDBWrapperConfig): Promise<IDBWrapperImpl> {
		const instance = new IDBWrapperImpl();

		instance.idbdatabase = await new Promise<IDBDatabase>((resolve, reject) => {
			const openRequest = indexedDB.open(config.dbname, config.version);

			openRequest.onsuccess = (e: Event) => {
				const idb = (e.target as IDBOpenDBRequest).result;
				resolve(idb);
			};

			openRequest.onerror = (_) => reject('Failed to open IndexedDB');

			openRequest.onupgradeneeded = (e: Event) => {
				const idb = (e.target as IDBOpenDBRequest).result;

				// Delete all object stores
				for (const s of idb.objectStoreNames) {
					idb.deleteObjectStore(s);
				}

				// Create given object stores
				for (const s of config.stores) {
					idb.createObjectStore(s, { keyPath: 'key' });
				}
			};
		});

		return instance;
	}

	close() {
		this.idbdatabase?.close();
	}

	async getAllKeys(store: string): Promise<IDBValidKey[]> {
		return new Promise((resolve, _) => {
			const objStore = this.idbdatabase!.transaction([store], 'readonly').objectStore(store);
			const keysRequest = objStore.getAllKeys();

			keysRequest.onsuccess = (_) => resolve(keysRequest.result);
			keysRequest.onerror = (_) => resolve([]);
		});
	}

	async isKeyExist(store: string, key: IDBValidKey): Promise<boolean> {
		if (!this.idbdatabase?.objectStoreNames.contains(store)) {
			return false;
		}

		const keys = await this.getAllKeys(store);

		if (keys.includes(key)) {
			return true;
		}

		return false;
	}

	async get(store: string, key: IDBValidKey): Promise<any> {
		return new Promise(async (resolve) => {
			const exist = await this.isKeyExist(store, key);
			if (!exist) {
				resolve(null);
				return;
			}

			const objStore = this.idbdatabase!.transaction([store], 'readonly').objectStore(store);
			const getRequest = objStore.get(key);

			getRequest.onsuccess = (_) => resolve(getRequest.result['value']);
			getRequest.onerror = (_) => resolve(null);
		});
	}

	async put(store: string, key: IDBValidKey, value: any): Promise<boolean> {
		return new Promise(async (resolve) => {
			const objStore = this.idbdatabase!.transaction([store], 'readwrite').objectStore(store);
			const putRequest = objStore.put({ key: key, value: value });

			putRequest.onsuccess = (_) => resolve(true);
			putRequest.onerror = (_) => resolve(false);
		});
	}

	async delete(store: string, key: IDBValidKey): Promise<boolean> {
		return new Promise((resolve) => {
			const objStore = this.idbdatabase!.transaction([store], 'readwrite').objectStore(store);
			const deleteRequest = objStore.delete(key);

			deleteRequest.onsuccess = (_) => resolve(true);
			deleteRequest.onerror = (_) => resolve(false);
		});
	}
}
