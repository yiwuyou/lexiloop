// Keep static paths so WeChat can identify cross-subpackage dependencies.
module.exports = {
  speech01: () => require.async('../speech01/ready.js'),
  speech02: () => require.async('../speech02/ready.js'),
  speech03: () => require.async('../speech03/ready.js'),
  speech04: () => require.async('../speech04/ready.js'),
  speech05: () => require.async('../speech05/ready.js'),
  speech06: () => require.async('../speech06/ready.js'),
  speech07: () => require.async('../speech07/ready.js'),
  speech08: () => require.async('../speech08/ready.js'),
  speech09: () => require.async('../speech09/ready.js'),
  speech10: () => require.async('../speech10/ready.js'),
  speech11: () => require.async('../speech11/ready.js'),
  speech12: () => require.async('../speech12/ready.js'),
};
