const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function load(file) {
  const env = {
    module: { exports: {} }, HomePicture: {}, notlogin: {}, loggedin: {},
    uniCloud: { importObject: () => ({}) },
    uni: { getWindowInfo: () => ({ windowHeight: 800 }) },
    getResumeRefreshState: () => ({ seq: 0, level: 0, shouldRefresh: false })
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(root, 'utils/tab-bar.js'), 'utf8').replace('export function', 'function'), env);
  const script = fs.readFileSync(path.join(root, file), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/gm, '')
    .replace('export default', 'module.exports =');
  vm.runInContext(script, env);
  return env.module.exports;
}
for (const [file, expected] of [['pages/home/home.vue', 0], ['pages/category/category.vue', 1], ['pages/my/my.vue', 2]]) {
  test(file + ': 页面显示主动同步独立底栏，首次晚挂载与返回仍正确', async () => {
    const definition = load(file);
    const state = { selected: 0 };
    const bar = { setData: value => Object.assign(state, value) };
    const ticks = [];
    let mounted = false;
    const page = {
      ...definition.data(), ...definition.methods,
      $scope: { getTabBar: () => mounted ? bar : undefined },
      $nextTick: callback => ticks.push(callback),
      lastResumeSeqHandled: 0,
      refresh: async () => {}, loadHome: async () => {}
    };
    await definition.onShow.call(page);
    mounted = true;
    ticks.splice(0).forEach(callback => callback());
    assert.equal(state.selected, expected);
    state.selected = -1;
    definition.onReady.call(page);
    assert.equal(state.selected, expected);
    state.selected = -1;
    await definition.onShow.call(page); // 从详情返回或 switchTab 再次显示
    assert.equal(state.selected, expected);
  });
}
