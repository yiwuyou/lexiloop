// Configure the global iOS session as well as each player. Instance-only
// obeyMuteSwitch is insufficient on some WeChat/iOS combinations.
let configured = false;
function configure() {
  if (configured || !wx.setInnerAudioOption) return;
  wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true,
    success() { configured = true; }, fail() { configured = false; } });
}
function create() {
  configure();
  const audio = wx.createInnerAudioContext();
  audio.obeyMuteSwitch = false;
  audio.volume = 1;
  return audio;
}
module.exports = { configure, create };
