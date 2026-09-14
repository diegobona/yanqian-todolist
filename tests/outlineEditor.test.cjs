const test = require('node:test');
const assert = require('node:assert/strict');
const {
  insertBulletLine,
  indentLines,
  removeBulletPrefix
} = require('../src/utils/outlineEditor');

test('Enter adds a deletable square and preserves the current hierarchy', () => {
  assert.deepEqual(insertBulletLine('主题', 2, 2), {
    value: '主题\n▪ ', selectionStart: 5, selectionEnd: 5, changed: true
  });
  assert.deepEqual(insertBulletLine('主题\n  ▪ 子项', 9, 9), {
    value: '主题\n  ▪ 子项\n  ▪ ', selectionStart: 14, selectionEnd: 14, changed: true
  });
  assert.deepEqual(removeBulletPrefix('主题\n  ▪ 子项', 7, 7), {
    value: '主题\n  子项', selectionStart: 5, selectionEnd: 5, changed: true
  });
});

test('Tab and Shift+Tab adjust one or several selected lines by one level', () => {
  assert.deepEqual(indentLines('主题\n▪ 子项', 7, 7, false), {
    value: '主题\n  ▪ 子项', selectionStart: 9, selectionEnd: 9, changed: true
  });
  assert.deepEqual(indentLines('▪ 一\n▪ 二', 0, 7, false).value, '  ▪ 一\n  ▪ 二');
  assert.deepEqual(indentLines('主题\n  ▪ 子项', 9, 9, true), {
    value: '主题\n▪ 子项', selectionStart: 7, selectionEnd: 7, changed: true
  });
  assert.equal(indentLines('主题\n▪ 子项', 7, 7, true).changed, false);
});
