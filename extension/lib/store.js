// Recordings and their events in the extension's IndexedDB, shared by the service worker (which writes events as they
// arrive, so a worker restart loses nothing) and the panel and report pages (which read them). Everything stays in
// this browser; values are kept as captured and only redacted on the way out (see lib/run.js redactRun).

const DB = "aitd-recorder";
const VERSION = 1;
/** Recordings kept per site; older ones are deleted when a new one starts. */
export const KEEP_PER_SITE = 20;

let opening = null;
export function openDb(indexedDB = globalThis.indexedDB) {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const recordings = db.createObjectStore("recordings", { keyPath: "id" });
      recordings.createIndex("host", "host");
      const events = db.createObjectStore("events", { autoIncrement: true });
      events.createIndex("rec", "rec");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const finished = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

export async function putRecording(rec) {
  const db = await openDb();
  const tx = db.transaction("recordings", "readwrite");
  tx.objectStore("recordings").put(rec);
  await finished(tx);
  return rec;
}

export async function getRecording(id) {
  const db = await openDb();
  return (await done(db.transaction("recordings").objectStore("recordings").get(id))) ?? null;
}

/** All recordings, newest first. */
export async function listRecordings() {
  const db = await openDb();
  const all = await done(db.transaction("recordings").objectStore("recordings").getAll());
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

/** Adds events to a recording; each gets its recording's id and its order of arrival. */
export async function addEvents(rec, events) {
  if (!events.length) return;
  const db = await openDb();
  const tx = db.transaction("events", "readwrite");
  const store = tx.objectStore("events");
  for (const e of events) store.add({ ...e, rec });
  await finished(tx);
}

export async function getEvents(rec) {
  const db = await openDb();
  return done(db.transaction("events").objectStore("events").index("rec").getAll(IDBKeyRange.only(rec)));
}

export async function deleteRecording(rec) {
  const db = await openDb();
  const tx = db.transaction(["recordings", "events"], "readwrite");
  tx.objectStore("recordings").delete(rec);
  const index = tx.objectStore("events").index("rec");
  const keys = await done(index.getAllKeys(IDBKeyRange.only(rec)));
  for (const k of keys) tx.objectStore("events").delete(k);
  await finished(tx);
}

/** Deletes a site's oldest recordings beyond keep. */
export async function prune(host, keep = KEEP_PER_SITE) {
  const old = (await listRecordings()).filter((r) => r.host === host).slice(keep);
  for (const r of old) await deleteRecording(r.id);
  return old.length;
}
