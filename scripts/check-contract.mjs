#!/usr/bin/env node
/**
 * 升级后契约自检：确认本插件依赖的内置侧栏契约仍然存在。
 *
 * 本插件不修改 app.asar，但它依赖三处官方契约：
 *   1. 工作区行渲染出 `data-row-key="workspace:<workspaceId>"`
 *   2. 会话行渲染出 `data-row-key="session:<sessionId>"`
 *   3. 客户端工作区/会话模型提供 items / archivedSessionIds / byId / initializeDefault
 * DSH 每次升级都可能改动这些字符串或结构。升级后跑一次本脚本：
 *   - 全绿  → 插件行为应当继续生效；
 *   - 有红  → 插件会自动 fail-open（不隐藏、不误藏），需要按报告适配。
 *
 * 用法：
 *   node scripts/check-contract.mjs [app.asar 路径]
 * 退出码：0 = 契约完好；1 = 有契约缺失。
 */
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_ASAR = process.env.DSH_ASAR
  || (process.env.DSH_ROOT ? path.join(process.env.DSH_ROOT, 'resources', 'app.asar') : '')
const asarPath = process.argv[2] || DEFAULT_ASAR
if (!asarPath) {
  console.error('Pass the app.asar path as argv[2], or set DSH_ASAR / DSH_ROOT.')
  process.exit(2)
}

function readAsar(filePath) {
  const fd = fs.openSync(filePath, 'r')
  const head = Buffer.alloc(16)
  fs.readSync(fd, head, 0, 16, 0)
  const headerSize = head.readUInt32LE(12)
  const headerBuf = Buffer.alloc(headerSize)
  fs.readSync(fd, headerBuf, 0, headerSize, 16)
  const header = JSON.parse(headerBuf.toString('utf8'))
  const base = 16 + headerSize
  return { fd, header, base }
}

function walk(node, prefix, out) {
  for (const [name, value] of Object.entries(node.files || {})) {
    const entryPath = `${prefix}/${name}`
    if (value.files) walk(value, entryPath, out)
    else out.set(entryPath, value)
  }
  return out
}

const { fd, header, base } = readAsar(asarPath)
const entries = walk(header, '', new Map())

function readEntry(entryPath) {
  const meta = entries.get(entryPath)
  if (!meta || meta.offset === undefined || meta.size === undefined) return undefined
  const offset = Number(meta.offset)
  const size = Number(meta.size)
  const buf = Buffer.alloc(size)
  fs.readSync(fd, buf, 0, size, base + offset)
  return buf.toString('utf8')
}

const checks = [
  {
    id: 'workspace-row-key',
    file: '/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js',
    needles: ['data-row-key', 'workspace:${group.key}', 'session:${node.id}'],
    why: '侧栏行必须带 data-row-key="workspace:<id>" / "session:<id>"，插件靠它定位行',
  },
  {
    id: 'workspace-grouping',
    file: '/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js',
    needles: ['groupByWorkspace', 'archivedSessionIds', 'archivedFilter'],
    why: '分组推导与归档筛选仍是同一套数据源',
  },
  {
    id: 'workspace-client-model',
    file: '/dsh/node_modules/@deepseek-ai/dsh-api-workspace-controller/lib/types/client/model.js',
    needles: ['initializeDefault', 'archivedSessionIds', 'buildSnapshot', 'items'],
    why: '插件用它读 items / archivedSessionIds，并取默认工作区 id',
  },
  {
    id: 'session-client-model',
    file: '/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js',
    needles: ['byId', 'blankBit'],
    why: '插件用它读会话头（判 blank 占位、算可见会话数）',
  },
]

let failed = 0
const rows = []
for (const check of checks) {
  const text = readEntry(check.file)
  if (text === undefined) {
    failed += 1
    rows.push([check.id, 'FAIL', 'file missing: ' + check.file, check.why])
    continue
  }
  const missing = check.needles.filter((needle) => !text.includes(needle))
  if (missing.length > 0) {
    failed += 1
    rows.push([check.id, 'FAIL', 'missing: ' + missing.join(', '), check.why])
  } else {
    rows.push([check.id, 'PASS', `${text.length} bytes`, check.why])
  }
}
fs.closeSync(fd)

console.log(`asar: ${asarPath}\n`)
for (const [id, status, detail, why] of rows) {
  console.log(`${status.padEnd(4)}  ${id.padEnd(24)}  ${detail}`)
  console.log(`      └ ${why}`)
}
console.log(
  failed === 0
    ? '\n契约完好：插件依赖的 DOM 与数据契约都还在。'
    : `\n有 ${failed} 项契约缺失：插件会 fail-open（不隐藏），请按上面缺失项适配 lib/client.js。`,
)
process.exit(failed === 0 ? 0 : 1)
