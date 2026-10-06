module.exports = function copyWord(event) {
  const word = String(event.currentTarget.dataset.word || '').trim();
  if (!word) return;
  wx.setClipboardData({
    data: word,
    fail() { wx.showToast({ title: '复制失败，请重试', icon: 'none' }); },
  });
};
