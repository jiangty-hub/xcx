const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'utils/home-display.js'), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(source.replace('export function', 'function') + '\nmodule.exports = getFeaturedDishes', context);
const adapt = data => JSON.parse(JSON.stringify(context.module.exports(data)));
test('仅按确认的 ID 选择四道菜，兼容字符串、乱序分组，不修改原数据', () => {
  const rows = [[{ goods_id: 115, name: '甜品', image_src: 'https://example.test/115.jpg' }, { goods_id: 111 }], [{ goods_id: '113' }, { goods_id: 114 }, { goods_id: 112, name: '菜品112' }]];
  const before = JSON.stringify(rows);
  assert.deepEqual(adapt(rows).map(item => item.id), ['112', '113', '114', '115']);
  assert.equal(adapt(rows)[3].name, '甜品');
  assert.equal(JSON.stringify(rows), before);
});
test('缺记录不补大图，空数据和错误分组安全处理', () => {
  assert.deepEqual(adapt(null), []);
  assert.deepEqual(adapt([null, {}, [], [{ goods_id: 111 }, null]]), []);
  assert.deepEqual(adapt([[{ goods_id: 114 }]]).map(item => item.id), ['114']);
});
test('名称和图片兜底，数据库名称变化会反映到展示结果', () => {
  const rows = [[{ goods_id: 112, name: '  ', image_src: '' }]];
  assert.deepEqual(adapt(rows)[0], { id: '112', name: '菜品112', image: '/static/cover-default.png' });
  rows[0][0].name = ' 香煎土豆 ';
  assert.equal(adapt(rows)[0].name, '香煎土豆');
});
test('同 ID 重复记录不会重复生成卡片', () => {
  assert.equal(adapt([[{ goods_id: 112 }, { goods_id: '112' }]]).length, 1);
});

function setupTab(route) {
  let config;
  const calls = [];
  const pages = [{ route }];
  const runtime = {
    Component(value) { config = value; },
    getCurrentPages: () => pages,
    wx: { switchTab: opts => calls.push(opts), showToast: opts => calls.push(opts) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8'), runtime);
  const tab = { data: JSON.parse(JSON.stringify(config.data)), ...config.methods, setData(value) { Object.assign(this.data, value); } };
  return { tab, config, calls, pages };
}
test('首次进入和页面重新显示按实际路由同步底栏，不依赖点击高亮', () => {
  const { tab, config, pages } = setupTab('pages/category/category');
  config.lifetimes.attached.call(tab);
  assert.equal(tab.data.selected, 1);
  pages[0].route = 'pages/my/my';
  config.pageLifetimes.show.call(tab);
  assert.equal(tab.data.selected, 2);
});
test('底栏当前页不重复跳转，跳转中防连点，失败不会错误高亮', () => {
  const { tab, calls } = setupTab('pages/home/home');
  const click = index => tab.switchTab({ currentTarget: { dataset: { index } } });
  click(0);
  assert.equal(calls.length, 0);
  click(1); click(2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/pages/category/category');
  calls[0].fail(); calls[0].complete();
  assert.equal(tab.data.selected, 0);
  assert.equal(tab.switching, false);
  assert.equal(calls[1].title, '切换失败，请重试');
});
