const DB_NAME = 'smashpool-browser';
const DB_VERSION = 1;
const STORE_NAME = 'app';
const STATE_KEY = 'tournament-state';
const FALLBACK_KEY = 'smashpool:tournament-state';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open browser database'));
  });
}

export async function loadStoredState() {
  try {
    const db = await openDb();
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  } catch (error) {
    console.warn('IndexedDB load failed; using localStorage fallback.', error);
    try {
      const raw = localStorage.getItem(FALLBACK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}

export async function saveStoredState(state) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(state, STATE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Browser storage transaction aborted'));
    });
    db.close();
    return { ok: true, storage: 'indexeddb' };
  } catch (error) {
    console.warn('IndexedDB save failed; using localStorage fallback.', error);
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
    return { ok: true, storage: 'localstorage' };
  }
}
