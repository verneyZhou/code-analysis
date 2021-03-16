export default function (Vue) {
  const version = Number(Vue.version.split('.')[0]) // 首先判断Vue版本号

  if (version >= 2) { // 2.x版本直接通过全局混入Vue.mixin的方式在beforeCreate生命周期里执行vuexInit方法
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // override init and inject vuex init procedure  注入vuex初始化流程
    // for 1.x backwards compatibility.  1.x版本向后兼容
    const _init = Vue.prototype._init // Vue原型上挂载_init方法来进行初始化
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options) // 执行_init()方法
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   * vuex初始化
   * 将vuex混入到$options中
   * 通过 Vue.minxin 方法做了一个全局的混入，在每个组件 beforeCreate 生命周期时会调用 vuexInit 方法，该方法处理得非常巧妙，首先获取当前组件的 $options ，判断当前组件的 $options 上是否有 sotre ，若有则将 store 赋值给当前组件，即 this.$store ，这个一般是判断根组件的，因为只有在初始化 Vue 实例的时候我们才手动传入了 store ; 若 $options 上没有 store ，则代表当前不是根组件，所以我们就去父组件上获取，并赋值给当前组件，即当前组件也可以通过 this.$store 访问到 store 实例了，这样一层一层传递下去，实现所有组件都有$store属性，这样我们就可以在任何组件中通过this.$store访问到store
   */

  function vuexInit () {
    // 获取当前组件的 $options，$options为当我们new Vue({...})初始化时传入的参数
    const options = this.$options
    // store injection
    // 若当前组件的$options上已存在store，一般是root节点，则将$options.store赋值给this.$store（一般是用于根组件的）
    if (options.store) {
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    // 当前组件的$options上没有store，则获取父组件上的$store，即$options.parent.$store，并将其赋值给this.$store（一般用于子组件）
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store
    }
  }
}
