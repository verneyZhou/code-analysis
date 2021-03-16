import Module from './module'
import { assert, forEachValue } from '../util'

// ModuleCollection 类的工作就是将保留原来的模块关系，将每个模块封装到一个 Module 类中
// Store中调用：this._modules = new ModuleCollection(options)
export default class ModuleCollection {
  /**
   * rawRootModules为传入的options
   * const options = {
   *    state: {...},
   *    getters: {...},
   *    mutations: {...},
   *    actions: {...},
   *    modules: {
   *        module1: {..., moduleA:{...}},
   *        module2: {..., moduleB:{...}}
   *    }
   * }
   */
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    // 注册
    // 前两个参数分别为：[] 、rawRootModule ，此时肯定是从根模块开始注册的，所以 path 里无内容，并且 rawRootModule 指向的是根模块
    this.register([], rawRootModule, false)
  }

  // 根据路径顺序，从根模块开始递归获取到我们准备添加新的模块的父模块
  // 根据传入的 path 路径，获取到我们想要的 Module 类
  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key) // 获取子模块，例：['son1','son2','son3']，根据嵌套关系，找到son3模块
    }, this.root)
  }

  // 获取模块的命名空间
  /**
  * 根据模块是否有命名空间来设定一个路径名称
  * 例如：A为父模块，B为子模块，C为子孙模块
  * 1. 若B模块命名空间为second,C模块未设定命名空间时; C模块继承了B模块的命名空间，为 second/
  * 2. 若B模块未设定命名空间, C模块命名空间为third; 则此时B模块继承的是A模块的命名空间，而C模块的命名空间路径为 third/
  * 3. 若B模块和C模块命名分别为second,third;则path传['second', 'third']，返回 second/third/
  */
  getNamespace (path) {
    let module = this.root // 默认先取根模块
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  // 更新模块
  update (rawRootModule) {
    // 直接调用更新函数
    update([], this.root, rawRootModule)
  }

  /**
   * 
   * @param {*} path 表示模块嵌套关系， 例：['module1', 'moduleA']
   * @param {*} rawModule 传入的模块对象
   * @param {*} runtime 表示程序运行时
   */
  // 递归注册模块
  register (path, rawModule, runtime = true) {
    if (__DEV__) { // 入参格式判断
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime) // 初始化一个新模块
    if (path.length === 0) { // 通过 if(path.length === 0) 判断是否为根模块，是的话就将 this.root 指向 Module
      this.root = newModule
    } else { // 子模块
      // 取父级路径：[1,2,3].slice(0,-1) = [1,2]
      // 
      const parent = this.get(path.slice(0, -1)) // 获取该模块的父模块
      parent.addChild(path[path.length - 1], newModule) // 将该模块添加到它的父模块上
    }

    // register nested modules
    // 有嵌套模块，继续注册
    if (rawModule.modules) {
       /**
       *  1. 遍历所有的子模块，并进行注册;
       *  2. 在path中存储除了根模块以外所有子模块的名称
       * 例：根模块下modules为: {
       *      moduleA:{state:{...}, getters:{...}, mutations:{...}, actions: {...}, modules: {...}},
       *      moduleB:{...}
       * }
       * 执行forEachValue后，会对modules下的每一个模块进行遍历，以moduleA为例，rawChildModule就是moduleA模块的内容，key就是'moduleA'，moduleA的注册就是 this.register(['moduleA'], rawModule.modules.moduleA, runtime)
       *  */ 
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  // 卸载
  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    const child = parent.getChild(key)

    if (!child) {
      if (__DEV__) {
        console.warn(
          `[vuex] trying to unregister module '${key}', which is ` +
          `not registered`
        )
      }
      return
    }

    if (!child.runtime) {
      return
    }

    parent.removeChild(key)
  }

  // 判断是否已注册
  isRegistered (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]

    if (parent) {
      return parent.hasChild(key) // 判断其父模块是否有这个子模块
    }

    return false
  }
}

// 更新函数
/**
 * 
 * @param {*} path ['module1', 'moduleA', ...]
 * @param {*} targetModule 根模块
 * @param {*} newModule 当前模块
 */
function update (path, targetModule, newModule) {
  if (__DEV__) {
    assertRawModule(path, newModule) // 判断当前模块参数格式是否正确
  }

  // update target module
  targetModule.update(newModule)

  // update nested modules
  if (newModule.modules) { // 更新嵌入的子模块
    for (const key in newModule.modules) {
      if (!targetModule.getChild(key)) {
        if (__DEV__) {
          console.warn(
            `[vuex] trying to add a new module '${key}' on hot reloading, ` +
            'manual reload is needed'
          )
        }
        return
      }
      update(
        path.concat(key),
        targetModule.getChild(key),
        newModule.modules[key]
      )
    }
  }
}


/**
 * 格式判断
 */
// 判断是否是function
const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}

// 判断是否是object
const objectAssert = {
  assert: value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}

// 格式标准定义
const assertTypes = {
  getters: functionAssert,
  mutations: functionAssert,
  actions: objectAssert
}

// 模块格式判断：判断传入的getters,mutations,actions是否格式正确
function assertRawModule (path, rawModule) {
  Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return

    const assertOptions = assertTypes[key]

    // 循环遍历传入的getters,mutations,actions对象
    // 如actions中传入clearToken方法：actions: { clearToken({dispatch, commit}){...} }
    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value), // 判断clearToken类型
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}

// 格式报错提示
/** 
 *  例：path: [], key: 'actions', type: 'clearToken', value: ({dispatch, commit}) {...}, expected: 'function or object with "handler" function'
 * return 'actions should be function or object with "handler" function but "actions.cleaToken" is  "({dispatch, commit}) {...}"'
 * */ 
function makeAssertionMessage (path, key, type, value, expected) {
  let buf = `${key} should be ${expected} but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`
  return buf
}
