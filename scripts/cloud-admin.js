// Uses the official, already authenticated CloudBase CLI. Never reads or logs credentials.
const { spawnSync } = require('child_process');
const path = require('path');
const envId = require('../cloudbaserc.json').envId;
const cli = process.env.LEXILOOP_TCB_CLI;
if (!cli) throw new Error('Set LEXILOOP_TCB_CLI to the official tcb entry point');
function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) throw new Error(`CloudBase command failed (${result.status})`);
}
function api(action, body) { run(['api', 'tcb', action, '--body', JSON.stringify({ EnvId: envId, ...body }), '--json']); }
const action = process.argv[2];
if (action === 'inspect') {
  run(['env', 'list', '--json']);
  api('ListTables', { MgoLimit: 100, MgoOffset: 0 });
} else if (action === 'create') {
  for (const name of ['lexiloop_sync', 'lexiloop_snapshots']) {
    api('CreateTable', { TableName: name, PermissionInfo: { EnvId: envId, AclTag: 'ADMINONLY' } });
    api('DescribeTable', { TableName: name });
  }
} else if (action === 'permissions') {
  api('DescribeResourcePermission', { ResourceType: 'collection', Resources: ['lexiloop_sync', 'lexiloop_snapshots'] });
} else if (action === 'lock') {
  for (const name of ['lexiloop_sync', 'lexiloop_snapshots']) api('ModifyResourcePermission', { ResourceType: 'collection', Resource: name, Permission: 'ADMINONLY' });
} else if (action === 'health') {
  run(['fn', 'invoke', 'lexiloop-sync', '--data', JSON.stringify({ action: 'health' }), '--json']);
  run(['fn', 'invoke', 'lexiloop-sync', '--data', JSON.stringify({ protocol: 1, action: 'status', device: 'deploy-check' }), '--json']);
} else throw new Error('Supported operations: inspect, create, permissions, lock, health');
