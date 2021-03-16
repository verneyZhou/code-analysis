import Vue from 'vue';
// import Vuex from './my-vuex'; // 手写常规版本
import Vuex from './my-vuex-mini'; // 手写极简版本


Vue.use(Vuex);

const store = new Vuex.Store({
    strict: true,
    state: {
        level: 'root',
        num: 1,
    },
    getters: {
        doubleCount: (state, getters) => {
            return state.num * 2;
        }
    },
    mutations: {
        changeNum(state, payload) {
            state.num = payload.num;
        },
    },
    actions: {
        changeFn({state, commit, dispatch}, payload) {
            commit('changeNum', payload);
        },
        updateName({state, commit, dispatch}, payload) {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    let name = 'new_name';
                    resolve(name);
                }, 1000);
            });
        }
    },
    modules: {
        'secondModuleA': {
            namespaced: true,
            state: {
                level: 'second',
                num: 2,
                name: 'second_module'
            },
            getters: {
                doubleCount: (state, getters) => {
                    return state.num * 2;
                },               
            },
            mutations: {
                changeName(state, payload) {
                    state.name = payload.name;
                },
                changeName(state, payload) {
                    state.name = payload.name + '_v1123';
                },
            },
            actions: {
                updateName({state, commit, dispatch}, payload) {
                    return new Promise((resolve, reject) => {
                        console.log('====promise');
                        setTimeout(() => {
                            let name = 'new_name';
                            resolve(name);
                        }, 1000);
                    });
                },
                updateName({state, commit, dispatch}, payload) {
                    state.name = 'new_name_1234567';
                }
            },
            modules: {
                'thirdModuleA': {
                    namespaced: true,
                    state: {
                        level: 'three',
                        name: 'three_module',
                        title: 'three_title'
                    },
                    getters: {
                    },
                    mutations: {
                        changeTitle(state, payload) {
                            state.title = payload.title;
                        },
                    },
                    actions: {
        
                    },
                }
            }
        }
    }
});

var app = new Vue({
    store,
    el: '#app',
    render: h => h(App)
});