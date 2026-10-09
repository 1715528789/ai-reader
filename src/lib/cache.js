/**
 * 页面级 AI 结果缓存（内存 LRU + IndexedDB 持久化）+ 预取调度工具。
 * 目标：同一页不重复请求；用户翻到下一页时翻译可能已经就绪。
 */
import { getCache, putCache, deleteCache, listCacheKeys } from './storage';

/** 内存缓存上限条数，超出后按插入顺序淘汰最早的一半。 */
const MAX_MEMORY_ENTRIES = 400;

const memory = new Map();
const inflight = new Map();
const controllers = new Map();

/**
 * 生成缓存键。
 * @param {string} fileId 文件 id
 * @param {number} page 页码
 * @param {string} kind 任务类型（translate / insight / explain）
 * @param {string} lang 目标语言
 * @param {string} extra 额外标识（如划词文本）
 * @returns {string} 缓存键
 */
export function cacheKey(fileId, page, kind, lang = 'zh-CN', extra = '') {
  return `${fileId}:${page}:${kind}:${lang}${extra ? `:${extra}` : ''}`;
}

/**
 * 淘汰内存缓存（保留最近的一半）。
 * @returns {void}
 */
function evict() {
  if (memory.size <= MAX_MEMORY_ENTRIES) return;
  const keys = Array.from(memory.keys());
  const dropCount = Math.ceil(keys.length / 2);
  for (let i = 0; i < dropCount; i += 1) {
    memory.delete(keys[i]);
  }
}

/**
 * 读取缓存（内存优先，其次 IndexedDB）。
 * @param {string} key 缓存键
 * @returns {Promise<any|null>} 缓存值
 */
export async function getCached(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const persisted = await getCache(key);
    if (persisted !== null && persisted !== undefined) {
      memory.set(key, persisted);
      evict();
      return persisted;
    }
  } catch (err) {
    /* 读取失败按未命中处理 */
  }
  return null;
}

/**
 * 同步读取内存缓存（用于首帧快速命中判断）。
 * @param {string} key 缓存键
 * @returns {any|null} 缓存值
 */
export function peekCached(key) {
  return memory.has(key) ? memory.get(key) : null;
}

/**
 * 写入缓存（内存 + 可选 IndexedDB）。
 * @param {string} key 缓存键
 * @param {any} value 缓存值
 * @param {object} options 选项
 * @param {boolean} [options.persist] 是否持久化到 IndexedDB（空结果可只放内存）
 * @returns {Promise<void>} 无返回值
 */
export async function setCached(key, value, options = {}) {
  const { persist = true } = options;
  memory.set(key, value);
  evict();
  if (!persist) return;
  try {
    await putCache(key, value);
  } catch (err) {
    /* 持久化失败不影响内存缓存 */
  }
}

/**
 * 删除一条缓存。
 * @param {string} key 缓存键
 * @returns {Promise<void>} 无返回值
 */
export async function removeCached(key) {
  memory.delete(key);
  try {
    await deleteCache(key);
  } catch (err) {
    /* 忽略 */
  }
}

/**
 * 清空某个文件的全部缓存（内存 + IndexedDB）。
 * @param {string} fileId 文件 id
 * @returns {Promise<void>} 无返回值
 */
export async function clearFileCache(fileId) {
  const prefix = `${fileId}:`;
  for (const key of Array.from(memory.keys())) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  try {
    const keys = await listCacheKeys();
    for (const key of keys) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        await deleteCache(key);
      }
    }
  } catch (err) {
    /* 忽略 */
  }
}

/**
 * 注册一个在途请求（避免同键并发重复请求）。
 * @param {string} key 缓存键
 * @param {Promise<any>} promise 请求 Promise
 * @param {AbortController} controller 控制器
 * @returns {void}
 */
export function registerInflight(key, promise, controller) {
  inflight.set(key, promise);
  if (controller) controllers.set(key, controller);
}

/**
 * 获取在途请求 Promise。
 * @param {string} key 缓存键
 * @returns {Promise<any>|null} Promise 或 null
 */
export function getInflight(key) {
  return inflight.get(key) || null;
}

/**
 * 注销在途请求。
 * @param {string} key 缓存键
 * @returns {void}
 */
export function releaseInflight(key) {
  inflight.delete(key);
  controllers.delete(key);
}

/**
 * 取消指定键的在途请求。
 * @param {string} key 缓存键
 * @returns {void}
 */
export function abortInflight(key) {
  const controller = controllers.get(key);
  if (controller) {
    try {
      controller.abort();
    } catch (err) {
      /* 忽略 */
    }
  }
  releaseInflight(key);
}

/**
 * 取消某页的全部在途请求（翻页/切文件时调用）。
 * @param {string} fileId 文件 id
 * @param {number} page 页码
 * @returns {void}
 */
export function abortPageInflight(fileId, page) {
  const prefix = `${fileId}:${page}:`;
  for (const key of Array.from(controllers.keys())) {
    if (key.startsWith(prefix)) abortInflight(key);
  }
}

/**
 * 取消某文件的全部在途请求。
 * @param {string} fileId 文件 id
 * @returns {void}
 */
export function abortFileInflight(fileId) {
  const prefix = `${fileId}:`;
  for (const key of Array.from(controllers.keys())) {
    if (key.startsWith(prefix)) abortInflight(key);
  }
}

/**
 * 串行任务队列（用于后台预取，避免一次性并发打满 API）。
 */
export class SerialQueue {
  /**
   * 构造队列。
   * @param {number} concurrency 并发数（默认 1，串行）
   */
  constructor(concurrency = 1) {
    this.concurrency = concurrency;
    this.active = 0;
    this.queue = [];
  }

  /**
   * 入队一个任务。
   * @param {() => Promise<any>} task 任务函数
   * @returns {Promise<any>} 任务结果
   */
  push(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.next();
    });
  }

  /**
   * 尝试执行下一个任务。
   * @returns {void}
   */
  next() {
    if (this.active >= this.concurrency || this.queue.length === 0) return;
    const item = this.queue.shift();
    this.active += 1;
    Promise.resolve()
      .then(() => item.task())
      .then(item.resolve, item.reject)
      .finally(() => {
        this.active -= 1;
        this.next();
      });
  }
}
