/**
 * Get the first item that pass the test
 * by second argument function
 * 查看数组中第一个匹配的元素
 * @param {Array} list
 * @param {Function} f
 * @return {*}
 */
export function find (list, f) {
  return list.filter(f)[0]
}

/**
 * Deep copy the given object considering circular structure.
 * This function caches all nested objects and its copies.
 * If it detects circular structure, use cached copy to avoid infinite loop.
 * 深拷贝
 * @param {*} obj 传入的复制对象
 * @param {Array<Object>} cache 缓存
 * @return {*}
 */
export function deepCopy (obj, cache = []) {
  // just return if obj is immutable value
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  // if obj is hit, it is in circular structure
  // 对循环嵌套的情况进行处理
  const hit = find(cache, c => c.original === obj)
  if (hit) {
    return hit.copy
  }

  // 判断是对象还是数组
  const copy = Array.isArray(obj) ? [] : {}
  // put the copy into cache at first
  // because we want to refer it in recursive deepCopy
  cache.push({
    original: obj, // 保存原始的值
    copy // 保存复制的值
  })

  // 遍历循环数组或对象，继续取值
  Object.keys(obj).forEach(key => {
    copy[key] = deepCopy(obj[key], cache)
  })

  // 返回复制的值
  return copy
}

/**
 * forEach for object
 * 遍历对象
 */
export function forEachValue (obj, fn) {
  Object.keys(obj).forEach(key => fn(obj[key], key))
}

/**
 * 
 * @param {*} obj
 * 判断是否为对象，排除null 
 */

export function isObject (obj) {
  return obj !== null && typeof obj === 'object'
}

/**
 * 
 * @param {*} val
 * 判断是否为Promise对象 
 */

export function isPromise (val) {
  return val && typeof val.then === 'function'
}

/**
 * 断言
 * @param {*} condition 
 * @param {*} msg 
 */

export function assert (condition, msg) {
  if (!condition) throw new Error(`[vuex] ${msg}`)
}


/**
 * 保留原始参数的闭包函数
 * @param {*} fn 
 * @param {*} arg 
 */
export function partial (fn, arg) {
  return function () {
    return fn(arg)
  }
}
