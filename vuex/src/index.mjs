
// es6 module打包入口

import Vuex from '../dist/vuex.common.js'

const {
  Store,
  install,
  version,
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers,
  createLogger
} = Vuex

export {
  Vuex as default,
  Store,
  install,
  version,
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers,
  createLogger
}
