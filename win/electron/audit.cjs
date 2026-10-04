// ============================================================
// Audit — 审计日志（V2.2 步骤⑦）
// 所有 LLM 调用与工具执行事件追加写入 userData/audit-log.jsonl。
// 记录永不包含 API Key / 完整 prompt（只含元数据与参数摘要）。
// ============================================================

const fs = require('fs');
const path = require('path');

let _file = null;

function init({ userDataPath }) {
  try { fs.mkdirSync(userDataPath, { recursive: true }); } catch { /* 已存在 */ }
  _file = path.join(userDataPath, 'audit-log.jsonl');
}

function append(event) {
  if (!_file) return false;
  const entry = { ts: new Date().toISOString(), ...event };
  try {
    fs.appendFileSync(_file, JSON.stringify(entry) + '\n', 'utf8');
    return true;
  } catch {
    return false; // 审计失败不阻塞主流程，但返回 false 供调用方记录
  }
}

/** 读取最近 n 条（调试/展示用） */
function tail(n = 50) {
  if (!_file || !fs.existsSync(_file)) return [];
  try {
    const lines = fs.readFileSync(_file, 'utf8').trim().split('\n');
    return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  } catch {
    return [];
  }
}

module.exports = { init, append, tail };
