// ============================================================
// Secrets — 主进程安全存储（V2.2 步骤③）
// API Key 只存在于主进程：safeStorage(DPAPI) 加密后落盘 userData/secrets.json
// 渲染层永远只持有 agentId，不持有明文/密文。
// safeStorage 不可用时降级为前缀标记的 base64（能力降级，如实标注）。
// ============================================================

const fs = require('fs');
const path = require('path');

let _file = null;
let _safeStorage = null;
let _cache = null; // { version, secrets: { agentId: cipherB64 } }

function _load() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(_file, 'utf8'));
  } catch {
    _cache = { version: 1, secrets: {} };
  }
  if (!_cache.secrets) _cache.secrets = {};
  return _cache;
}

function _save() {
  const tmp = _file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(_cache, null, 2), 'utf8');
  fs.renameSync(tmp, _file);
}

/** 应用就绪后调用一次 */
function init({ userDataPath, safeStorage }) {
  _file = path.join(userDataPath, 'secrets.json');
  _safeStorage = safeStorage;
  _load();
}

function _encrypt(plain) {
  if (_safeStorage && _safeStorage.isEncryptionAvailable()) {
    return _safeStorage.encryptString(plain).toString('base64');
  }
  // 降级：无法使用系统加密时如实标记（不冒充已加密）
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64');
}

function _decrypt(stored) {
  if (stored.startsWith('plain:')) {
    return Buffer.from(stored.slice(6), 'base64').toString('utf8');
  }
  return _safeStorage.decryptString(Buffer.from(stored, 'base64'));
}

function setSecret(agentId, plain) {
  if (!agentId || typeof plain !== 'string' || plain.length === 0) {
    throw new Error('setSecret: agentId 与非空 key 必填');
  }
  if (plain.length > 500) throw new Error('key 长度超出限制');
  const store = _load();
  store.secrets[agentId] = _encrypt(plain);
  _save();
  return true;
}

function getSecret(agentId) {
  const store = _load();
  const stored = store.secrets[agentId];
  if (!stored) return null;
  try {
    return _decrypt(stored);
  } catch {
    return null; // 解密失败（如系统用户变更）→ 视为未配置
  }
}

function deleteSecret(agentId) {
  const store = _load();
  if (store.secrets[agentId]) {
    delete store.secrets[agentId];
    _save();
  }
  return true;
}

/** 只返回 agentId 列表，不返回任何密钥内容 */
function listSecrets() {
  return Object.keys(_load().secrets);
}

function hasSecret(agentId) {
  return Boolean(_load().secrets[agentId]);
}

module.exports = { init, setSecret, getSecret, deleteSecret, listSecrets, hasSecret };
