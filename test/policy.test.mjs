/**
 * decide() 单测：不加载浏览器，只验证三条规则的判定逻辑。
 * 运行：node --test test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'

// 以最小桩模拟浏览器，把 ModuleLoader 的 factory 取出来。
let mod
globalThis.window = {
  __ModuleLoader__: {
    load: (spec) => {
      mod = spec.factory(() => {
        throw new Error('require is not available in tests')
      })
    },
  },
}
await import('../lib/client.js')
const decide = mod.decide

const visibleIds = (result) =>
  result.hidden.length === 0 ? [] : result.hidden.slice()

const ids = (workspaces, hidden) =>
  workspaces.map((w) => w.workspaceId).filter((id) => hidden.includes(id))

function makeSessions(list) {
  const byId = {}
  for (const s of list) byId[s.id] = { blank: s.blank === true }
  return byId
}

test('R1: default workspace stays visible even with zero visible sessions', () => {
  const workspaces = [
    { workspaceId: 'ws-default', sessionIds: ['a', 'b'] },
  ]
  const result = decide({
    items: workspaces,
    archivedSessionIds: new Set(['a', 'b']),
    sessionById: makeSessions([{ id: 'a' }, { id: 'b' }]),
    defaultWorkspaceId: 'ws-default',
  })
  assert.deepEqual(result.hidden, [])
  assert.equal(result.reasons['ws-default'], 'default')
})

test('R2: non-default workspace hides once every session is archived', () => {
  const workspaces = [{ workspaceId: 'ws-x', sessionIds: ['c', 'd'] }]
  const result = decide({
    items: workspaces,
    archivedSessionIds: new Set(['c', 'd']),
    sessionById: makeSessions([{ id: 'c' }, { id: 'd' }]),
    defaultWorkspaceId: 'ws-default',
  })
  assert.deepEqual(ids(workspaces, result.hidden), ['ws-x'])
  assert.equal(result.reasons['ws-x'], 'hide')
})

test('R2 reverse: unarchiving any one session restores the workspace', () => {
  const workspaces = [{ workspaceId: 'ws-x', sessionIds: ['c', 'd'] }]
  const result = decide({
    items: workspaces,
    archivedSessionIds: new Set(['c']),
    sessionById: makeSessions([{ id: 'c' }, { id: 'd' }]),
    defaultWorkspaceId: 'ws-default',
  })
  assert.deepEqual(result.hidden, [])
  assert.equal(result.reasons['ws-x'], 'has-visible')
})

test('R3: a never-used workspace stays visible', () => {
  const workspaces = [{ workspaceId: 'ws-new', sessionIds: [] }]
  const result = decide({
    items: workspaces,
    archivedSessionIds: new Set(),
    sessionById: {},
    defaultWorkspaceId: 'ws-default',
  })
  assert.deepEqual(result.hidden, [])
  assert.equal(result.reasons['ws-new'], 'never-used')
})

test('R3: a workspace holding only a blank placeholder stays visible', () => {
  const workspaces = [{ workspaceId: 'ws-new', sessionIds: ['blank-1'] }]
  const result = decide({
    items: workspaces,
    archivedSessionIds: new Set(),
    sessionById: makeSessions([{ id: 'blank-1', blank: true }]),
    defaultWorkspaceId: 'ws-default',
  })
  assert.deepEqual(result.hidden, [])
  assert.equal(result.reasons['ws-new'], 'never-used')
})

test('R3 confirmed inference: first real session archived -> hidden', () => {
  const workspaces = [{ workspaceId: 'ws-new', sessionIds: ['real-1'] }]
  const result = decide({
    items: workspaces,
    archivedSessionIds: new Set(['real-1']),
    sessionById: makeSessions([{ id: 'real-1' }]),
    defaultWorkspaceId: 'ws-default',
  })
  assert.deepEqual(result.hidden, ['ws-new'])
})

// 回归：2026-11-06「模拟人生」现场。
// 工作区里有 1 个真实会话（已归档）+ 1 个从未使用的 blank 占位（未归档）。
// 内置侧栏在「隐藏已归档」下不渲染非当前的 blank 占位 → 该组渲染成空行；
// 修复前把 blank 一律算作可见，导致该行永远藏不掉。
test('regression: archived real session + leftover blank (not current) -> hidden', () => {
  const workspaces = [{ workspaceId: 'ws-sim', sessionIds: ['real-1', 'blank-1'] }]
  const result = decide({
    items: workspaces,
    archivedSessionIds: new Set(['real-1']),
    sessionById: makeSessions([{ id: 'real-1' }, { id: 'blank-1', blank: true }]),
    currentSessionId: 'some-other-session',
    defaultWorkspaceId: 'ws-default',
  })
  assert.deepEqual(result.hidden, ['ws-sim'])
})

test('a blank placeholder that IS the current session keeps the row', () => {
  const workspaces = [{ workspaceId: 'ws-sim', sessionIds: ['real-1', 'blank-1'] }]
  const result = decide({
    items: workspaces,
    archivedSessionIds: new Set(['real-1']),
    sessionById: makeSessions([{ id: 'real-1' }, { id: 'blank-1', blank: true }]),
    currentSessionId: 'blank-1',
    defaultWorkspaceId: 'ws-default',
  })
  assert.deepEqual(result.hidden, [])
  assert.equal(result.reasons['ws-sim'], 'has-visible')
})

test('a never-used workspace with only a non-current blank still stays visible', () => {
  const workspaces = [{ workspaceId: 'ws-new', sessionIds: ['blank-1'] }]
  const result = decide({
    items: workspaces,
    archivedSessionIds: new Set(),
    sessionById: makeSessions([{ id: 'blank-1', blank: true }]),
    currentSessionId: undefined,
    defaultWorkspaceId: 'ws-default',
  })
  assert.deepEqual(result.hidden, [])
  assert.equal(result.reasons['ws-new'], 'never-used')
})

test('missing session headers never cause hiding', () => {
  const workspaces = [{ workspaceId: 'ws-x', sessionIds: ['ghost'] }]
  const result = decide({
    items: workspaces,
    archivedSessionIds: new Set(['ghost']),
    sessionById: {},
    defaultWorkspaceId: 'ws-default',
  })
  assert.deepEqual(result.hidden, [])
  assert.equal(result.reasons['ws-x'], 'never-used')
})

test('unresolved default: nothing is exempt, others still follow R2', () => {
  const workspaces = [
    { workspaceId: 'ws-a', sessionIds: ['a'] },
    { workspaceId: 'ws-b', sessionIds: ['b'] },
  ]
  const result = decide({
    items: workspaces,
    archivedSessionIds: new Set(['a']),
    sessionById: makeSessions([{ id: 'a' }, { id: 'b' }]),
    defaultWorkspaceId: undefined,
  })
  assert.deepEqual(result.hidden, ['ws-a'])
})

test('real shape: only the fully archived non-default workspace hides', () => {
  const workspaces = [
    { workspaceId: 'ws-work', sessionIds: ['s-work'] },
    { workspaceId: 'ws-desk', sessionIds: ['s-desk'] },
    { workspaceId: 'ws-sim', sessionIds: ['s-sim1', 's-sim2'] },
    { workspaceId: 'ws-default', sessionIds: ['s-def1', 's-def2'] },
  ]
  const result = decide({
    items: workspaces,
    archivedSessionIds: new Set(['s-desk', 's-def1', 's-def2']),
    sessionById: makeSessions([
      { id: 's-work' },
      { id: 's-desk' },
      { id: 's-sim1' },
      { id: 's-sim2' },
      { id: 's-def1' },
      { id: 's-def2' },
    ]),
    defaultWorkspaceId: 'ws-default',
  })
  assert.deepEqual(result.hidden, ['ws-desk'])
})

test('empty input is a no-op', () => {
  const result = decide({ items: [], archivedSessionIds: new Set(), sessionById: {} })
  assert.deepEqual(result.hidden, [])
})
