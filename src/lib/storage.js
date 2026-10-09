/**
 * 本地存储层：
 * - IndexedDB：存放 PDF 原始文件（Blob）+ AI 结果缓存（翻译/解读）
 * - localStorage：存放设置、阅读进度、笔记、生词本、聊天记录
 * 不使用任何后端数据库。
 */

const DB_NAME = 'ai-reader';
const DB_VERSION = 1;
const STORE_FILES = 'files';
const STORE_CACHE = 'cache';

const LS = {
  SETTINGS: 'aireader.provider',
  PROGRESS: 'aireader.progress',
  NOTES: 'aireader.notes',
  VOCAB: 'aireader.vocab',
  CHAT_PREFIX: 'aireader.chat.',
};

let dbPromise = null;

/**
 * 打开（或创建）IndexedDB。
 * @returns {Promise<IDBDatabase>} 数据库实例
 */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

/**
 * 通用事务执行器。
 * @param {string} storeName store 名称
 * @param {'readonly'|'readwrite'} mode 事务模式
 * @param {(store: IDBObjectStore) => IDBRequest|void} work 具体操作
 * @returns {Promise<any>} 请求结果
 */
async function withStore(storeName, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = work(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB 事务失败'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务被中止'));
  });
}

/* ---------------------------------- 文件 ---------------------------------- */

/**
 * 保存（或更新）PDF 文件记录。
 * @param {object} record 文件记录 {id,name,size,type,blob,addedAt,lastPage,pageCount}
 * @returns {Promise<void>} 无返回值
 */
export async function savePdfFile(record) {
  await withStore(STORE_FILES, 'readwrite', (store) => store.put(record));
}

/**
 * 读取 PDF 文件记录（含 Blob）。
 * @param {string} id 文件 id
 * @returns {Promise<object|null>} 文件记录
 */
export async function getPdfFile(id) {
  const res = await withStore(STORE_FILES, 'readonly', (store) => store.get(id));
  return res || null;
}

/**
 * 列出全部 PDF 文件记录（按加入时间倒序）。
 * @returns {Promise<Array<object>>} 文件列表
 */
export async function listPdfFiles() {
  const res = await withStore(STORE_FILES, 'readonly', (store) => store.getAll());
  const list = Array.isArray(res) ? res : [];
  return list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

/**
 * 删除 PDF 文件记录。
 * @param {string} id 文件 id
 * @returns {Promise<void>} 无返回值
 */
export async function deletePdfFile(id) {
  await withStore(STORE_FILES, 'readwrite', (store) => store.delete(id));
}

/* ---------------------------------- 缓存 ---------------------------------- */

/**
 * 写入 AI 结果缓存。
 * @param {string} key 缓存键
 * @param {any} value 缓存值
 * @returns {Promise<void>} 无返回值
 */
export async function putCache(key, value) {
  await withStore(STORE_CACHE, 'readwrite', (store) =>
    store.put({ key, value, updatedAt: Date.now() })
  );
}

/**
 * 读取 AI 结果缓存。
 * @param {string} key 缓存键
 * @returns {Promise<any|null>} 缓存值
 */
export async function getCache(key) {
  const res = await withStore(STORE_CACHE, 'readonly', (store) => store.get(key));
  return res ? res.value : null;
}

/**
 * 列出全部缓存键。
 * @returns {Promise<Array<string>>} 键数组
 */
export async function listCacheKeys() {
  const res = await withStore(STORE_CACHE, 'readonly', (store) => store.getAllKeys());
  return Array.isArray(res) ? res : [];
}

/**
 * 删除指定键的缓存。
 * @param {string} key 缓存键
 * @returns {Promise<void>} 无返回值
 */
export async function deleteCache(key) {
  await withStore(STORE_CACHE, 'readwrite', (store) => store.delete(key));
}

/**
 * 清空某个文件的全部 AI 缓存。
 * @param {string} fileId 文件 id
 * @returns {Promise<number>} 清掉的条数
 */
export async function clearCacheForFile(fileId) {
  const keys = await listCacheKeys();
  const prefix = `${fileId}:`;
  const targets = keys.filter((k) => typeof k === 'string' && k.startsWith(prefix));
  for (const key of targets) {
    await deleteCache(key);
  }
  return targets.length;
}

/**
 * 清空全部 AI 缓存。
 * @returns {Promise<void>} 无返回值
 */
export async function clearAllCache() {
  await withStore(STORE_CACHE, 'readwrite', (store) => store.clear());
}

/* ------------------------------- localStorage ------------------------------ */

/**
 * 读取 localStorage 中的 JSON。
 * @param {string} key 键
 * @param {any} fallback 默认值
 * @returns {any} 解析结果
 */
export function lsGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

/**
 * 写入 localStorage（JSON 序列化）。
 * @param {string} key 键
 * @param {any} value 值
 * @returns {void}
 */
export function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    /* 超出配额时忽略 */
  }
}

/**
 * 删除 localStorage 键。
 * @param {string} key 键
 * @returns {void}
 */
export function lsRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    /* 忽略 */
  }
}

/* --------------------------------- 设置 ---------------------------------- */

/**
 * 读取 AI 模型设置。
 * @returns {object} 设置对象
 */
export function getSettings() {
  return lsGet(LS.SETTINGS, null) || null;
}

/**
 * 保存 AI 模型设置。
 * @param {object} settings 设置对象
 * @returns {void}
 */
export function setSettings(settings) {
  lsSet(LS.SETTINGS, settings);
}

/* --------------------------------- 进度 ---------------------------------- */

/**
 * 读取全部阅读进度映射。
 * @returns {Record<string, number>} {fileId: page}
 */
export function getAllProgress() {
  return lsGet(LS.PROGRESS, {}) || {};
}

/**
 * 读取单个文件的阅读进度。
 * @param {string} fileId 文件 id
 * @returns {number} 页码
 */
export function getProgress(fileId) {
  const map = getAllProgress();
  return Number(map[fileId]) || 1;
}

/**
 * 保存单个文件的阅读进度。
 * @param {string} fileId 文件 id
 * @param {number} page 页码
 * @returns {void}
 */
export function setProgress(fileId, page) {
  const map = getAllProgress();
  map[fileId] = page;
  lsSet(LS.PROGRESS, map);
}

/**
 * 删除单个文件的阅读进度。
 * @param {string} fileId 文件 id
 * @returns {void}
 */
export function removeProgress(fileId) {
  const map = getAllProgress();
  delete map[fileId];
  lsSet(LS.PROGRESS, map);
}

/* --------------------------------- 笔记 ---------------------------------- */

/**
 * 读取全部笔记。
 * @returns {Array<object>} 笔记列表
 */
export function getNotes() {
  const list = lsGet(LS.NOTES, []);
  return Array.isArray(list) ? list : [];
}

/**
 * 保存全部笔记。
 * @param {Array<object>} list 笔记列表
 * @returns {void}
 */
export function setNotes(list) {
  lsSet(LS.NOTES, Array.isArray(list) ? list : []);
}

/* -------------------------------- 生词本 --------------------------------- */

/**
 * 读取生词本。
 * @returns {Array<object>} 生词列表
 */
export function getVocab() {
  const list = lsGet(LS.VOCAB, []);
  return Array.isArray(list) ? list : [];
}

/**
 * 保存生词本。
 * @param {Array<object>} list 生词列表
 * @returns {void}
 */
export function setVocab(list) {
  lsSet(LS.VOCAB, Array.isArray(list) ? list : []);
}

/* -------------------------------- 聊天记录 -------------------------------- */

/**
 * 读取某文件的聊天记录。
 * @param {string} fileId 文件 id
 * @returns {Array<object>} 消息列表
 */
export function getChat(fileId) {
  const list = lsGet(`${LS.CHAT_PREFIX}${fileId}`, []);
  return Array.isArray(list) ? list : [];
}

/**
 * 保存某文件的聊天记录。
 * @param {string} fileId 文件 id
 * @param {Array<object>} messages 消息列表
 * @returns {void}
 */
export function setChat(fileId, messages) {
  lsSet(`${LS.CHAT_PREFIX}${fileId}`, Array.isArray(messages) ? messages : []);
}

export { LS };
