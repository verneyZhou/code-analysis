
/**
 * 手写vuex 极简版
 * @阿沐
 * 2021-03-15
 */


let Vue;

// install
function install(_Vue) {
    if (Vue !== _Vue) Vue = _Vue; // 防止重复注册
    Vue.mixin({ // 混入，通过这样在每一个Vue组件中进行混入，就能让每一个组件都能访问到this.$store
        beforeCreate() {
            let opts = this.$options;
            // console.log('====$options',opts);
            if (opts.store) { // 根组件
                this.$store = opts.store; // 兼容函数类型
            } else { // 是子组件，则王上一级父组件找store
                this.$store = opts.parent && opts.parent.$store;
            }
        }
    });
}

// Store
class Store {
    constructor(options = {}) {
        const {
            state = {},
            getters = {},
            mutations = {},
            actions = {}
        } = options;

        // 绑定state
        this._vm = new Vue({
            data() {
                return {
                    $$state: state 
                };
            }
        });

        // 绑定getters
        this.getters = {};
        Object.keys(getters).forEach(key => {
            Object.defineProperty(this.getters, key, { // 响应式绑定getters
                get: () => getters[key](this.state)
            });
        });

        // 定义commit
        this._mutations = mutations;
        this.commit = (type, payload) => {
            this._mutations[type](this.state, payload); // 传入state
        };

        // 定义dispatch
        this._actions = actions;
        this.dispatch = (type, payload) => {
            this._actions[type](this, payload); // 传入当前store
        };
    }

    // 定义state
    get state() {
        return this._vm && this._vm.$data.$$state;
    }
}

export default {
    install,
    Store
};