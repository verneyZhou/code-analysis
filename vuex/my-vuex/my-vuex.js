
/**
 * 手写vuex 常规版
 * @阿沐
 * 2021-03-12
 */



let Vue = null;

// install vuex
function install(_Vue) {
    if (Vue !== _Vue) Vue = _Vue; // 防止重复注册
    Vue.mixin({ // 混入，通过这样在每一个Vue组件中进行混入，就能让每一个组件都能访问到this.$store
        beforeCreate() {
            let opts = this.$options;
            // console.log('====$options',opts);
            if (opts.store) { // 根组件
                this.$store = typeof opts.store === 'function' ? opts.store() : opts.store; // 兼容函数类型
            } else if (opts.parent && opts.parent.$store) { // 是子组件，则王上一级父组件找store
                this.$store = opts.parent.$store;
            }
        }
    });
}

// 定义Store类
class Store {
    constructor(options = {}) {
        console.log('====store options', options);
        if (!Vue && window.Vue) { // 若Vue为安装，则调用install进行安装
            install(window.Vue);
        }

        const {
            plugins = [],
            strict = false,
            // state = {},
            // getters = {},
            // mutations = {},
            // actions = {}
        } = options;
        this.strict = strict; // 设置严格模式
        this._committing = false; // 提交状态

        this._mutations = {};
        this._actions = {};
        this._getters = {};
        this._modulesNamespaceMap = {}; // 存储定义了命名空间的模块
        this._localGettersCache = {}; // 本地缓存getters

        this._module = new ModuleCollection(options); // 生成ModuleCollection实例
        const state = this._module.root.state; // 获取根模块下的state
        const store = this;

       

        // 注册模块
        installModule(this, [], this._module.root);

        // 注册vm
        resetVM(this, state);

        // 插件注入
        plugins.forEach(plugin => plugin(store));
        

        // commit、dispatch封装
        const {commit, dispatch} = this;
        this.commit = function boundCommit(type, payload) {
            return commit.call(store, type, payload);
        };
        this.dispatch = function boundDispatch(type, payload) {
            return dispatch.call(store, type, payload);
        };
        
    }

    // 提交commit方法
    commit(type, payload) {

        this._withCommit(() => {
            this._mutations[type].forEach(handler => handler(payload));
        });
        
    };


    // dispatch方法
    dispatch(type, payload) {
        const entry = this._actions[type];
        const result = entry.length > 1 ? Promise.all(entry.map(handler => handler(payload))) : entry[0](payload);
        return new Promise((resolve, reject) => { // 异步函数，返回Promise
            result.then(res => {
                resolve(res);
            }).catch(err => {
                reject(err);
            });
        });
    }

    // get state
    get state() {
        console.log(this._vm);
        return this._vm && this._vm.$data.$$state;
    }


    // 
    _withCommit(cb) {
        const commiting = this._committing;
        this._committing = true;
        cb();
        this._committing = commiting;
    }
}


/**
 * 
 * @param {*} store store实例对象
 * @param {*} path 路径
 * @param {*} module 当前模块
 */
function installModule(store, path, module) {
    let isRoot = !path.length;
    let namespace = store._module.getNamespaced(path); // 获取模块名称 例：first/second/
    if (module.namespaced) store._modulesNamespaceMap[namespace] = module; // 存贮当前模块

    if (!isRoot) { // 子模块，实现state的注册：添加到其父模块的state上
        const parent = store._module.getModule(path.slice(0, -1));
        let modulename = path.slice(-1); // ['a','b','c'] => 'c'
        Vue.set(parent.state, modulename, module.state); // 实现响应式
    }

    // 设置当前模块 context 属性，并缓存当前模块传入数据
    const local = module.context = makeLocalContext(store, path, namespace);


    // 遍历注册传入的mutations
    console.log('====module._module.mutations',module._module);
    forEachValue(module._module.mutations, (key, handler) => {
        let type = namespace + key; // 'first/second/mutation'
        registerMutation(store, local, type, handler);
    });

    // 遍历注册传入的actions
    forEachValue(module._module.actions, (key, action) => {
        let type = action.root ? key : namespace + key;
        const handler = action.handler || action;
        registerAction(store, local, type, handler);
    });

    // 遍历注册传入的getters
    forEachValue(module._module.getters, (key, handler) => {
        let type = namespace + key; // 'first/second/mutation'
        registerGetter(store, local, type, handler);
    });

    // 遍历子模块，递归注册
    forEachValue(module._children, (key, childModule) => {
        installModule(store, path.concat(key), childModule);
    });


}

/**
 * 设置模块上下文
 * @param {*} store store实例
 * @param {*} path 路径
 * @param {*} namespace 名称 例：module1/moduleA/
 */
function makeLocalContext(store, path, namespace) {
    const local = {
        // 
        commit: !namespace ? store.commit : function(type, payload, opts) {
            let _type = type;
            if (!opts || !opts.root) { // 没有声明root
                _type = namespace + _type;
            }
            return store.commit(_type, payload);
        },
        dispatch: !namespace ? store.dispatch : function(type, payload, opts) {
            let _type = type;
            if (!opts || !opts.root) {
                _type = namespace + _type;
            }
            return store.dispatch(_type, payload);
        }
    };

    // 添加 getters、state
    // defineProperties: 定义或修改多个属性
    Object.defineProperties(local, {
        getters: {
            get: !namespace ? () => store.getters : () => makeLocalGetters(store, namespace) //  Getter must be a function
        },
        state: {
            get: () => { return path.reduce((state, key) => state[key], store.state);}
        }
    });

    return local;
} 

// 本地缓存 getters
// store.getters['first/second/getter'] => store._localGettersCache['first/second/'].getter
function makeLocalGetters(store, namespace) { // namespace: first/second/
    if (!store._localGettersCache[namespace]) { // 未缓存
        const getterProxy = {};
        let len = namespace.length;
        Object.keys(store.getters).forEach(type => { // first/second/getter
            if (type.slice(0, len) !== namespace) return; // 不匹配
            // 获取getter名称：'first/second/getter'.slice('first/second/'.length) = getter
            const _name = type.slice(len);

            // 添加代理
            Object.defineProperty(getterProxy, _name, {
                get: () => store.getters[type],
                enumerable: true // 可枚举
            });
        });

        store._localGettersCache[namespace] = getterProxy; // 缓存到本地
    }

    return store._localGettersCache[namespace];
}


// mutations注册
function registerMutation(store, local, type, handler) {
    const entry = store._mutations[type] || (store._mutations[type] = []);
    entry.push(function wrappedHandler(payload) {
        handler.call(store, local.state, payload);
    });
}

// actions注册
function registerAction(store, local, type, handler) {
    const entry = store._actions[type] || (store._actions[type] = []);
    entry.push(function wrappedActionHandler(payload) {

        /**切记：入参最好就这样传, 不要单拎出来，不然会报错!!! */
        let res = handler.call(store, {
            dispatch: local.dispatch,
            commit: local.commit,
            getters: local.getters,
            state: local.state,
            rootGetters: store.getters, // root 
            rootState: store.state
        }, payload); // 添加 _actions，并传入 _store
        // 异步处理
        if (!isPromise(res)) res = Promise.resolve(res);
        return res;
    });
}

//getters注册
function registerGetter(store, local, type, handler) {
    if (store._getters[type]) return; // 已注册
    store._getters[type] = function wrappedHandler() {
        return handler(
            local.state, // local state
            local.getters, // local getters
            store.state, // root state
            store.getters // root getters
        ); // 传入参数
    };
}




function resetVM(store, state) {
    const oldVm = store._vm;

    store.getters = {};
    const computed = {};
    const getters = store._getters;
    forEachValue(getters, (key, handler) => {
        // computed[key] = handler(store); // *****不要直接这样用！！！****
        computed[key] = partial(handler, store); // 循环注册过的store._getters，并新建computed对象存贮
        Object.defineProperty(store.getters, key, { // 同时为store.getters添加属性，通过this.$store.getters可以访问
            get: () => store._vm[key],
            enumerable: true
        });
    });
    // 将store中的state设置为响应式的，将getters和state交给vm托管
    // state 就实现了响应式，getters 实现了类似 computed 的功能
    store._vm = new Vue({
        data: {
            $$state: state // store.state 等于 store._vm.data.$$state
        },
        computed // store._getters 等于 store._vm.computed
    });

    // 开启严格模式
    if (store.strict) {
        store._vm.$watch( // 监听 state的改变
            function() {return this._data.$$state;}, // 监听对象
            () => {
                if (!store._committing) console.error('do not mutate vuex store state outside mutation handlers.');
            },
            {deep: true, sync: true}
        );
    }


    // 销毁旧的 _vm, 减少内存占用
    if (oldVm) Vue.$nextTick(() => oldVm.$destroy());
}



/**
 * 定义ModuleCollection类 模块依赖收集
 * 递归注册所有模块
 * 添加 root 属性，指向根模块
 */
class ModuleCollection {
    constructor(rootModule) {
        this.register([], rootModule);
    }

    // 注册模块
    register(path, rawModule) {
        const module = new Module(rawModule);
        if (!path.length) { // 根模块
            this.root = module; // 获取根模块
        } else { // 子模块：将则添加到它的父模块下
            const parent = this.getModule(path.slice(0, -1));
            parent.appendChild(path[path.length - 1], module);
        }

        if (rawModule.modules) { // 有嵌套子模块，递归回调
            forEachValue(rawModule.modules, (key, childModule) => {
                this.register(path.concat(key), childModule);
            });                        
        }
    }

    // 根据路径获取模块
    getModule(path) {
        return path.reduce((module, key) => {
            return module.getChild(key);
        }, this.root);
    }

    // 根据路径获取名称：['second', 'third']，返回 second/third/
    getNamespaced(path) {
        let module = this.root; // 初始化module,默认根模块
        return path.reduce((namespace, key) => {
            module = module.getChild(key);
            return `${namespace}${module.namespaced ? `${key}/` : ''}`;
        }, '');

    }
}

/**
 * 定义 Module 类
 * 添加 _module、_children、state 三个属性
 */
class Module {
    constructor(module) {
        this._module = module;
        this._children = {}; // 保存子模块
        const state = module.state;
        this.state = typeof state === 'function' ? state() : state; // 获取state
    }
    // 判断是否有命名空间
    get namespaced() {
        return !!this._module.namespaced;
    }

    // 获取子模块
    getChild(key) {
        return this._children[key];
    }

    // 添加子模块
    appendChild(key, module) {
        this._children[key] = module;
    }
}


// 导出
export default {
    install,
    Store,

};




/**
 * 封装工具函数
 */

// 遍历对象，统一执行回调
function forEachValue(obj, cb) {
    Object.keys(obj).forEach(key => cb(key, obj[key]));
}

// 判断是否是异步函数
function isPromise (val) {
    return val && typeof val.then === 'function';
}

export function partial(fn, payload) {
    // return fn(payload); // 这样会提示：Getter is missing for computed property "xxxx".
    return function () {
        return fn(payload);
    };
}