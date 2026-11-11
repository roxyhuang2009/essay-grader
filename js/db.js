// ============================================================
// 資料庫：用瀏覽器內建的 IndexedDB 存每一篇作文
// （照片很大，localStorage 放不下，所以用 IndexedDB）
// ============================================================

const DB_NAME = 'essay-grader';
const STORE = 'essays';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('subject', 'subject');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function listEssays(subject) {
  const all = await tx('readonly', (s) => s.getAll());
  return all
    .filter((e) => !subject || e.subject === subject)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getEssay(id) {
  return tx('readonly', (s) => s.get(id));
}

export async function saveEssay(essay) {
  essay.updatedAt = Date.now();
  await tx('readwrite', (s) => s.put(essay));
  return essay;
}

export async function deleteEssay(id) {
  await tx('readwrite', (s) => s.delete(id));
}

export function newEssay(subject, title) {
  const now = Date.now();
  return {
    id: (crypto.randomUUID && crypto.randomUUID()) || `e${now}${Math.random().toString(16).slice(2)}`,
    subject,
    title,
    createdAt: now,
    updatedAt: now,
    essayImages: [], // dataURL 陣列
    topicImages: [],
    note: '',
    status: 'draft', // draft | grading | done | error
    error: '',
    result: null,
    gradedAt: null,
    tierUsed: null,
    myNotes: '',
    chat: [], // { role: 'user' | 'assistant', content, ts }
  };
}

export async function exportAll() {
  const all = await tx('readonly', (s) => s.getAll());
  return { app: 'essay-grader', version: 1, exportedAt: new Date().toISOString(), essays: all };
}

export async function importAll(data) {
  if (!data || !Array.isArray(data.essays)) throw new Error('檔案格式不正確');
  let count = 0;
  for (const e of data.essays) {
    if (!e.id || !e.subject) continue;
    await tx('readwrite', (s) => s.put(e));
    count++;
  }
  return count;
}
