const assert = require('assert');
const clone = (value) => JSON.parse(JSON.stringify(value));
const values = {};
let page, write, share, modal, clipboard;
global.wx = {
  env: { USER_DATA_PATH: '/local' },
  getStorageSync: (key) => values[key] ? clone(values[key]) : '',
  setStorageSync: (key, value) => { values[key] = clone(value); },
  removeStorageSync: (key) => { delete values[key]; },
  getFileSystemManager: () => ({ writeFile: (options) => { write = options; } }),
  shareFileMessage: (options) => { share = options; },
  setClipboardData: (options) => { clipboard = options.data; options.success(); },
  showModal: (options) => { modal = options; },
  showToast() {},
};
global.Page = (definition) => { page = definition; };
require('../pages/progress/index');
page.data = clone(page.data);
page.setData = (data) => Object.assign(page.data, data);
page.refresh = () => {};
const store = require('../utils/store');
const state = store.getState();
state.cards['c-1-1'] = { seen: true, interval: 3, dueAt: 12345 };
store.saveState(state);
const original = clone(store.getState());
page.exportBackup();
assert.strictEqual(page.data.backupBusy, true);
assert.strictEqual(share, undefined, 'never share from async file callback');
const generated = JSON.parse(write.data);
assert.strictEqual(generated.appVersion, require('../utils/version'));
assert.deepStrictEqual(generated.state, original);
write.success();
assert.strictEqual(page.data.backupReady, true);
assert.strictEqual(share, undefined, 'wait for explicit send tap');
page.sendBackupFile();
assert.ok(share.filePath.endsWith('.json'));
share.fail({ errMsg: 'shareFileMessage:fail permission denied' });
assert.ok(page.data.backupStatus.includes('permission denied'));
assert.ok(!page.data.backupStatus.includes('取消'));
share.fail({ errMsg: 'shareFileMessage:fail cancel' });
assert.ok(page.data.backupStatus.includes('取消'));
page.copyBackupText();
assert.strictEqual(clipboard, write.data);
assert.deepStrictEqual(store.getState(), original);
page.restorePayload('truncated invalid data');
assert.strictEqual(modal.title, '无法恢复');
assert.deepStrictEqual(store.getState(), original);
page.restorePayload(clipboard);
modal.success({ confirm: false });
assert.deepStrictEqual(store.getState(), original);
page.restorePayload(clipboard);
modal.success({ confirm: true });
assert.deepStrictEqual(store.getState(), original);
assert.strictEqual(page.data.backupReady, false);
page.exportBackup();
write.fail({ errMsg: 'disk full' });
assert.ok(page.data.backupStatus.includes('disk full'));
page.copyBackupText();
assert.deepStrictEqual(JSON.parse(clipboard).state, original);
console.log('Backup generation, explicit share, failure/cancel distinction, copy fallback and confirmed restore passed.');
