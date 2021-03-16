import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert, partial } from './util'

// 声明Vue变量
let Vue // bind on install

export class Store {
  // 构造函数
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731
    // 判断是否已安装Vue
    // 若未安装Vue,但Vue已经挂载在window上，自动调用install方法进行安装
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    // __DEV__ 是webpack.config.js定义的全局环境变量，有值则为开发环境
    if (__DEV__) {
      // 断言
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`) // Vue如果未安装，则提示必须先调用Vue.use(Vuex)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`) // 必须提供Promise
      assert(this instanceof Store, `store must be called with the new operator.`) // 必须使用new操作符调用Store函数。
    }

    const {
      plugins = [],
      strict = false
    } = options // 生成Store类的入参

    // store internal state
    this._committing = false  // 表示提交的状态，当通过mutations方法改变state时，该状态为true，state值改变完后，该状态变为false; 在严格模式下会监听state值的改变，当改变时，_committing为false时，会发出警告，即表明state值的改变不是经过mutations的
    this._actions = Object.create(null)  // // 用于记录所有存在的actions方法名称（包括全局的和命名空间内的，且允许重复定义）
    this._actionSubscribers = []  // 存放actions方法订阅的回调函数
    this._mutations = Object.create(null) // 用于记录所有存在的的mutations方法名称（包括全局的和命名空间内的，且允许重复定义）
    this._wrappedGetters = Object.create(null)  // 收集所有模块包装后的的getters（包括全局的和命名空间内的，但不允许重复定义）
    this._modules = new ModuleCollection(options) // 根据传入的options配置，注册各个模块，此时只是注册、建立好了各个模块的关系，已经定义了各个模块的state状态，但getters、mutations等方法暂未注册
    this._modulesNamespaceMap = Object.create(null) // 存储定义了命名空间的模块
    this._subscribers = []  // 存放mutations方法订阅的回调
    this._watcherVM = new Vue()  // 用于监听state、getters，用于响应式地监测一个 getter 方法的返回值
    this._makeLocalGettersCache = Object.create(null)  // getters的本地缓存

    // bind commit and dispatch to self
    const store = this
    // 将 dispatch 和 commit 方法绑定到 Store 的实例上，避免后续使用dispatch或commit时改变了this指向
    // 这段代码首先对 Store 实例上的 dispatch 和 commit 方法进行了一层包装，即通过 call 将这两个方法的作用对象指向当前的 Store 实例，这样就能防止后续我们操作时，出现 this.$store.dispatch.call(obj, 1) 类似的情况而报错
    const { dispatch, commit } = this
    this.dispatch = function boundDispatch (type, payload) {
      // 这里会将dispath和commit方法的this指针绑定为store
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    // 判断store是否为严格模式。true: 所有的state都必须经过mutations来改变
    // this.strict 是用于判断是否是严格模式。因为 vuex 中，建议所有的 state 变量的变化都必须经过 mutations 方法，因为这样才能被 devtool 所记录下来，所以在严格模式下，未经过 mutations 而直接改变了 state 的值，开发环境下会发出警告⚠️
    this.strict = strict

    // 将根模块的state赋值给state变量
    const state = this._modules.root.state

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    // 1. 从根模块开始，递归注册各个模块的信息
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    // 2. 注册vm
    resetStoreVM(this, state)

    // apply plugins
    // 3. 插件的注入
    // 首先就是遍历创建 Store 类时传入的参数 Plugins ，依次调用传入的插件函数（当然一般我们都没有传入，所以 Plugins 默认是空数组）
    plugins.forEach(plugin => plugin(this))

    const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
    if (useDevtools) {
      // 然后就是调用 devtoolPlugin 方法啦，根据导入的路径我们去到相应的文件
      devtoolPlugin(this)
    }
  }

  // 定义了一个 get 函数，访问state，可以很清楚地看到，当我们访问 store.state 时，就是去访问 store._vm.data.$$state
  get state () {
    return this._vm._data.$$state
  }

  set state (v) {
    if (__DEV__) {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  // 定义commit方法
  /**
   * @param {*} _type 事件名称
   * @param {*} _payload 载荷
   * @param {*} _options 参数
   * 从上面注册过的内部属性对象里依据参数拿到对应的mutations，然后通过_withCommit提交包装的回调函数即可，同时使用内部api subscribe进行状态修改追踪订阅。
   */
  commit (_type, _payload, _options) {
    // check object-style commit
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options) // 整合参数

    /**
     * // 专用修改state方法，其他修改state方法均是非法修改
     * 在处理完参数以后，根据 type 从 store._mutations 上获取到 entry ，前面分析过了，mutations 方法是以数组形式存储的，所以可能有多个方法。然后在 _withCommit 方法中遍历 entry 依次执行 mutations 方法，这是因为 Vuex 规定 state 的改变都要通过 mutations 方法，store._committing 这个属性就是用来判断当前是否处于调用 mutations 方法的，当 state 值改变时，会先去判断 store._committing 是否为 true ，若不为 true ，则表示 state 的值改变没有经过 mutations 方法，于是会打印警告⚠️ 信息
     */
    const mutation = { type, payload }
    const entry = this._mutations[type] // 查找_mutations上是否有对应的方法
    if (!entry) { // 查找不到则不执行任何操作
      if (__DEV__) {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    // 若有相应的方法，则执行
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })

    // _subscribers 存放mutations的订阅回调
    this._subscribers
      .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe: 浅复制，以防止订阅者同步调用unsubscribe时迭代器失效
      .forEach(sub => sub(mutation, this.state))

    if (
      __DEV__ &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  /** 与上面的commit类似，只是这里是异步函数，需要用Promise作异步处理
   * 通过参数拿到对应注册的actions，然后promise.all执行回调，回调里则是进行commit提交。
   */
  dispatch (_type, _payload) {
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload) // 整合参数

    const action = { type, payload }
    const entry = this._actions[type] // 查找_actions上是否有对应的方法
    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    try {
      this._actionSubscribers // _actionSubscribers 存放 actions 的订阅回调
        .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (__DEV__) {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }

    // 其中变量 result ，先判断 entry 的长度，若大于1，则表示有多个异步方法，所以用 Promise.all 进行包裹 ; 否则直接执行 entry[0]
    const result = entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)

    // 返回Promise异步函数
    return new Promise((resolve, reject) => {
      result.then(res => {
        try {
          this._actionSubscribers // actions的订阅回调函数
            .filter(sub => sub.after)
            .forEach(sub => sub.after(action, this.state))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in after action subscribers: `)
            console.error(e)
          }
        }
        resolve(res)
      }, error => {
        try {
          this._actionSubscribers
            .filter(sub => sub.error)
            .forEach(sub => sub.error(action, this.state, error))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in error action subscribers: `)
            console.error(e)
          }
        }
        reject(error)
      })
    })
  }

  subscribe (fn, options) {
    return genericSubscribe(fn, this._subscribers, options)
  }

  subscribeAction (fn, options) {
    const subs = typeof fn === 'function' ? { before: fn } : fn
    return genericSubscribe(subs, this._actionSubscribers, options)
  }

  watch (getter, cb, options) {
    if (__DEV__) {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  // 在store._committing = true 的状态下更新一下state
  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  // 注册模块
  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    this._modules.register(path, rawModule)
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...
    resetStoreVM(this, this.state)
  }

  // 卸载模块
  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path)
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

  hasModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    return this._modules.isRegistered(path)
  }

  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  /**  
   * 这个内部api是每次提交状态修改的核心源码，其逻辑很简单，在每次执行状态修改的时候，保证内部属性_committing为true，而这个属性的默认初始值为false。
   * 这样在追踪状态变化的时候，如果_committing不为true，那么认为这次的修改是不正确的。
   */
  _withCommit (fn) {
    const committing = this._committing // 这个变量其实在刚才内部变量初始化的时候赋值为 false
    this._committing = true
    fn()
    this._committing = committing
  }
}

function genericSubscribe (fn, subs, options) {
  if (subs.indexOf(fn) < 0) {
    options && options.prepend
      ? subs.unshift(fn)
      : subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

// 重置store，即注册模块、生成vm等操作
// 将所有的状态都清空，然后重新执行一边 installModule 和 resetStoreVM ，这一般在模块结构变化以后调用，例如某个模块被卸载
function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

// 初始化vm
/**
 * 核心内容是store._vm这样一个内部变量，本质上将注册后的state和getters作为新的数据源实例化一个Vue对象传递给store._vm，并且删除旧的store._vm；
 * 与此同时，定义store.getters.xxx=store._vm[xxx]，从而完成使用getters的正确姿势。
 * state的使用是由store内部提供了一个api，调用这个api返回store._vm.data.$$state.xxx，在更新store._vm之后，就可以访问这个模块的state。
 */
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm

  // bind store public getters
  store.getters = {} // 在实例store上设置getters对象
  // reset local getters cache
  store._makeLocalGettersCache = Object.create(null) // 清空本地缓存
  const wrappedGetters = store._wrappedGetters
  const computed = {}

  // 循环所有处理过的getters，并新建computed对象进行存储，通过Object.defineProperty方法为getters对象建立属性，使得我们通过this.$store.getters.xxxgetter能够访问到该getters
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    // direct inline function use will lead to closure preserving oldVm.
    // using partial to return function with only arguments preserved in closure environment.
    computed[key] = partial(fn, store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  // 暂时将Vue设为静默模式，避免报出用户加载的某些插件触发的警告
  Vue.config.silent = true
  /**
   * 这个方法里主要做的就是生成一个 Vue 的实例 _vm ，然后将 store._wrappedGetters 里的 getters 以及 store.state 交给一个 _vm 托管，即将 store.state 赋值给 _vm.data.$$state ;
   * 将store._wrappedGetters 通过转化后赋值给 _vm.computed ，这样一来，state 就实现了响应式，getters 实现了类似 computed 的功能
   */
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  // 开启严格模式
  if (store.strict) {
    enableStrictMode(store)
  }

  // 因为生成了新的 _vm ，所以最后通过 oldVm.$destory() 将旧的 _vm 给销毁掉了
  // 值得注意的是，其将 store.getters 的操作放在了这个方法里，是因为我们后续访问某个 getters 时，访问的其实是 _vm.computed 中的内容。
  // 因此，通过 Object.defineProperty 对 store.getters 进行了处理
  // 若不是初始化过程执行的该方法，将旧的组件state设置为null，强制更新所有监听者(watchers)，待更新生效，DOM更新完成后，执行vm组件的destroy方法进行销毁，减少内存的占用
  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}

/**
 * 注册完善各个模块内的信息
 * @param {*} store store实例对象
 * @param {*} rootState state属性
 * @param {*} path 模块路径
 * @param {*} module 模块
 * @param {*} hot 
 */
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length // 是否为根模块

  /**
   * const namespace = store._modules.getNamespace(path) 是将路径 path 作为参数， 调用 ModuleCollection 类实例上的 getNamespace 方法来获取当前注册对象的命名空间的
   * 获取当前模块的命名空间，path传入['second', 'third']，返回 second/third/
   */
  const namespace = store._modules.getNamespace(path)

  // register in namespace map
  // 如果当前模块设置了namespaced 或 继承了父模块的namespaced，则在modulesNamespaceMap中存储一下当前模块
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && __DEV__) { // 重复校验
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module // 存储当前模块
  }

  // set state
  // 如果不是根模块，将当前模块的state注册到其父模块的state上
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1)) // 获取当前path父模块的state
    const moduleName = path[path.length - 1] // 当前模块名称
    // 更改state
    store._withCommit(() => {
      if (__DEV__) {
        if (moduleName in parentState) { // 如果父模块中已经存在当前模块名称，则报错提示
          console.warn(
            `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
          )
        }
      }
    
      /**
       * Vue.set: 向响应式对象中添加一个 property，并确保这个新 property 同样是响应式的，且触发视图更新。
       * 将当前模块的state注册在父模块的state上，并且是响应式的
       * 调用了 Vue 的 set 方法将当前模块的 state 响应式地添加到了父模块的 state 上，
       * 这是因为在之后我们会看到 state 会被放到一个新的 Vue 实例的 data 中，所以这里不得不使用 Vue 的 set 方法来响应式地添加
       * 同样的，从这段代码中我们也可以知道了为什么平时在获取子模块上 state 的属性时，是通过 this.$store.state.ModuleA.name 这样的形式来获取的了
       */
      Vue.set(parentState, moduleName, module.state)
    })
  }

  /**
   * 设置当前模块的上下文context
   * 这行代码也可以说是非常核心的一段代码了，它根据命名空间为每个模块创建了一个属于该模块调用的上下文，并将该上下文赋值了给了该模块的 context 属性
   */
  const local = module.context = makeLocalContext(store, namespace, path)

  // 遍历，注册所有mutations
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key  // 例如：first/second/mutations1
    registerMutation(store, namespacedType, mutation, local)
  })

  // 注册模块的所有actions
  module.forEachAction((action, key) => {

     /**
     * actions有两种写法：
     * 
     * actions: {
     *    AsyncAdd (context, payload) {...},   // 第一种写法
     *    AsyncDelete: {                       // 第二种写法
     *      root: true,
     *      handler: (context, payload) {...}
     *    } 
     * }
     */

    const type = action.root ? key : namespace + key  // 判断是否需要在命名空间里注册一个全局的action
    const handler = action.handler || action // 获取actions对应的函数
    registerAction(store, type, handler, local)
  })

  // 注册模块的所有getters
  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  // 递归注册子模块
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 * 获取上下文
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === '' // 是否设置了命名空间

  // local 这个变量存储的就是一个模块的上下文,若设置了命名空间则创建一个本地的commit、dispatch方法，否则将使用全局的store
  const local = {
    /**
     * 先来看其第一个属性 dispatch ，当该模块没有设置命名空间时，调用该上下文的 dispatch 方法时会直接调用 sotre.dispatch ，即调用了根模块的 dispatch 方法 ; 
     * 而存在命名空间时，会先判断相应的命名空间，以此来决定调用哪个 dispatch 方法
     */
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options) // 整合入参，兼容传值方式
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) { // 判断调用 dispatch 方法时有没有传入第三个参数 {root: true} ，若有则表示调用全局根模块上对应的的 dispatch 方法
        type = namespace + type
        if (__DEV__ && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    // 大致判断逻辑同上
    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) { // 若传入了第三个参数设置了root:true，则派发的是全局上对应的的mutations方法
        type = namespace + type
        if (__DEV__ && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
   /**
   * 然后最后通过 Object.defineProperties 方法对 local 的 getters 属性和 state 属性设置了一层获取代理，等后续对其访问时，才会进行处理。
   * 例如，访问 getters 属性时，先判断是否存在命名空间，若没有，则直接返回 store.getters ; 否则的话，根据命名空间创建一个本地的 getters 缓存，根据这个缓存来获取对应的 getters
   * 如：this.$store.
   */
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  /**
 * 
 *当存在命名空间时访问 local.getters ，首先会去 store._makeLocalGettersCache 查找是否有对应的 getters 缓存;
 * 若无命令空间，则创建一个 gettersProxy ，在 store.getters 上找到对应的 getters ，然后用 Object.defineProperty 对 gettersProxy 做一层处理;
 * 即当访问 local.getters.func 时，相当于访问了 store.getters['first/func'] ，这样做一层缓存，下一次访问该 getters 时，就不会重新遍历 store.getters 了 ; 若有缓存，则直接从缓存中获取
 */

  return local
}

// 创建本地的getters缓存
function makeLocalGetters (store, namespace) {
  // 若缓存中没有指定的getters，则创建一个新的getters缓存到__makeLocalGettersCache中
  if (!store._makeLocalGettersCache[namespace]) {
    const gettersProxy = {}
    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
      // skip if the target getter is not match this namespace
      // 如果store.getters中没有与namespace匹配的getters，则不进行任何操作
      if (type.slice(0, splitPos) !== namespace) return

      // extract local getter type
      // 获取本地getters名称 ?
      const localType = type.slice(splitPos)

      // Add a port to the getters proxy.
      // Define as getter property because
      // we do not want to evaluate the getters in this time.
      // 对getters添加一层代理
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })

    // 把代理过的getters缓存到本地
    store._makeLocalGettersCache[namespace] = gettersProxy
  }

  return store._makeLocalGettersCache[namespace]
}

// 注册mutation
function registerMutation (store, type, handler, local) {
  // 首先根据我们传入的 type 也就是上面的 namespacedType 去 store._mutations 寻找是否有入口 entry ，若有则直接获取 ; 否则就创建一个空数组用于存储 mutations 方法
  const entry = store._mutations[type] || (store._mutations[type] = [])
  // 在获取到 entry 以后，将当前的 mutations 方法添加到 entry 末尾进行存储。其中 mutations 接收的参数有两个，即 上下文中的 state 和 我们传入的参数 payload
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload) // store是this指向，
  })

  /**
   * 从这段代码我们可以看出，整个 store 实例的所有 mutations 方法都是存储在 store._mutations 中的，并且是以键值对的形式存放的，例如：
   * store._mutations = {
        'mutations1': [function handler() {...}],
        'ModuleA/mutations2': [function handler() {...}, function handler() {...}],
        'ModuleA/ModuleB/mutations2': [function handler() {...}]
      }
   */
}


// 注册action
/**
 * 
 * 与 mutations 类似，先从 store._actions 获取入口 entry ，然后将当前的 actions 进行包装处理后添加到 entry 的末尾。 
 * actions 方法接收两个参数，即 context 和我们传入的参数 payload ，其中 context 是一个对象，里面包含了 dispatch 、commit 、getters 、state 、rootGetters 、rootState ，
 * 前4个都是在当前模块的上下文中调用的，后2个是在全局上调用的
 */
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = []) // 通过store._actions 记录所有注册的actions
  // 接收两个参数：context（包含了上下文中的dispatch方法、commit方法、getters方法、state）、传入的参数payload
  entry.push(function wrappedActionHandler (payload) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload)

    /**
     * 最后对于 actions 的返回值还做了一层处理，因为 actions 规定是处理异步任务的，所以我们肯定希望其值是一个 promise 对象，这样方便后续的操作。
     * 所以这里对 actions 方法的返回值做了一个判断，如果本身就是 promise 对象，那么就直接返回 ；
     * 若不是，则包装一层 promise 对象，并将返回值 res 作为参数返回给 .then
     */
    if (!isPromise(res)) {  // 若返回值不是一个promise对象，则包装一层promise，并将返回值作为then的参数
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

// 注册getter
/**
 * 这里发现 getters 并不像 mutations 和 actions 一样去获取一个 entry ，而是直接查看 store._wrappedGetters[type] 是否有对应的 getters ，若有，则不再重复记录 ; 
 * 否则将 getters 包装一下存在 sotre._wrappedGetters 中，其中经过包装后的 getters 接收4个参数，即 state 、getters 、rootState 、rootGetters ，
 * 前2个分别表示当前上下文中的 state 和 getters ，后2个分别表示根模块的 state 和 getters
 */
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) { // 若记录过getters了，则不再重复记录
    if (__DEV__) {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }

  // 在store._wrappedGetters中记录getters
  // getters 是不能重名的，并且前一个命名的不会被后一个命名的所覆盖
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

// 开启严格模式：监听state的改变
// 当state改变的时候，store._committing如果为false则不是通过_withCommit触发的，一律报错
function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (__DEV__) {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}

// 获取嵌套子模块的state
// 例：传入state为根模块的rootState, path为['module1','moduleA'],则返回rootState.module1.moduleA
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}

// 整合对象，参数处理
/**
 * 
 * 使用过 Vuex 的应该都知道，commit 有两种提交方式：
 * // 第一种提交方式
      this.$store.commit('func', {num:1})

      // 第二种提交方式
      this.$store.commit({
        type: 'func',
        num: 1
      })
    其先对第一个参数进行判断是否为对象，是的话就当作对象提交风格处理，否则的话就直接返回
 */
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (__DEV__) {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}


// 安装Vue，初始化vuex
// 当我们调用 Vue.use(vuex) 时，调用这个方法
export function install (_Vue) {
  if (Vue && _Vue === Vue) { // 先判断 Vue是否已安装，如果已安装，则提示
    if (__DEV__) {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue // 如果Vue未安装，则将传入的_Vue赋给Vue，并调用 applyMixin 方法，初始化Vuex；现在移步到 ./mixin.js 文件：
  applyMixin(Vue)
}
