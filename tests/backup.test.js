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
let diskSave;
wx.saveFileToDisk = options => { diskSave = options; };
const largeState = store.getState();
largeState.backupFixture = '中文学习记录 review result'.repeat(12000);
store.saveState(largeState);
page.exportBackup();
write.success();
assert.equal(page.data.backupToDisk, true);
assert.equal(page.data.backupHasFile, true);
assert.equal(diskSave, undefined, 'desktop export waits for a user tap before it opens the save dialog');
page.saveBackupFile();
assert.equal(diskSave.filePath, write.filePath, 'desktop saves the exact generated JSON file');
diskSave.fail({ errMsg: 'saveFileToDisk:fail cancel' });
assert.ok(page.data.backupStatus.includes('取消'));
diskSave.success();
assert.ok(page.data.backupStatus.includes('已保存到电脑'));
page.copyBackupText();
assert.ok(clipboard.length < write.data.length / 2, 'large clipboard backups use compressed text');
const packed = JSON.parse(clipboard);
assert.equal(packed.type, 'mem-vocab-backup-text');
assert.deepStrictEqual(JSON.parse(require('../utils/sync-codec').unpack(packed.packed)).state, largeState);
packed.packed.checksum = '0';
page.restorePayload(JSON.stringify(packed));
assert.equal(modal.title, '无法恢复');
assert.deepStrictEqual(store.getState(), largeState);
page.restorePayload(clipboard);
assert.equal(modal.title, '恢复学习记录？');
modal.success({ confirm: true });
assert.deepStrictEqual(store.getState(), largeState);
console.log('Backup generation, explicit share, failure/cancel distinction, copy fallback and confirmed restore passed.');
