const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
fs.copyFileSync(path.join(root, 'utils/sync-model.js'), path.join(root, 'cloudfunctions/lexiloop-sync/model.generated.js'));
fs.copyFileSync(path.join(root, 'utils/time-ledger.js'), path.join(root, 'cloudfunctions/lexiloop-sync/time-ledger.js'));
console.log('Built identical client/server sync protocol.');
