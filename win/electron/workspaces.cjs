// ============================================================
// Workspaces — 工作区管理（V2.2 步骤⑧）
// 把"当前操作哪个项目"正式注册为资源：Git 等文件类工具绑定工作区路径。
// 存储于 userData/workspaces.json。
// ============================================================

const fs = require('fs');
const path = require('path');

let _file = null;
let _cache = null;

function init({ userDataPath }) {
  _file = path.join(userDataPath, 'workspaces.json');
  _load();
}

function _load() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(_file, 'utf8'));
  } catch {
    _cache = { version: 1, workspaces: [], activeId: null };
  }
  if (!_cache.workspaces) _cache.workspaces = [];
  return _cache;
}

function _save() {
  const tmp = _file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(_cache, null, 2), 'utf8');
  fs.renameSync(tmp, _file);
}

function list() {
  return _load().workspaces;
}

function getActive() {
  const store = _load();
  return store.workspaces.find((w) => w.id === store.activeId) || null;
}

function setActive(id) {
  const store = _load();
  if (!store.workspaces.find((w) => w.id === id)) throw new Error('工作区不存在');
  store.activeId = id;
  _save();
  return true;
}

/** 注册工作区：路径必须真实存在且为目录 */
function add({ name, path: wsPath }) {
  if (!name || !wsPath) throw new Error('name 与 path 必填');
  if (name.length > 60 || wsPath.length > 300) throw new Error('名称或路径超出长度限制');
  const stat = fs.existsSync(wsPath) && fs.statSync(wsPath);
  if (!stat || !stat.isDirectory()) throw new Error('路径不存在或不是目录');
  const store = _load();
  const id = 'ws_' + Date.now().toString(36);
  store.workspaces.push({ id, name, path: wsPath, permission: 'read' });
  if (!store.activeId) store.activeId = id;
  _save();
  return { id, name, path: wsPath, permission: 'read' };
}

function remove(id) {
  const store = _load();
  store.workspaces = store.workspaces.filter((w) => w.id !== id);
  if (store.activeId === id) store.activeId = store.workspaces[0] ? store.workspaces[0].id : null;
  _save();
  return true;
}

/** 解析活动工作区路径（Git 工具的 cwd 绑定用）；无注册工作区返回 null */
function resolveActivePath() {
  const w = getActive();
  return w ? w.path : null;
}

module.exports = { init, list, add, remove, setActive, getActive, resolveActivePath };
