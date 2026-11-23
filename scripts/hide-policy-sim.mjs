/**
 * 空工作区隐藏策略：可执行规格（与补丁同构的判定式）。
 *
 * 用途：在没有改动 DSH 的前提下，证明「三条规则」在边界条件下成立。
 * 运行：node scripts/hide-policy-sim.mjs        （退出码 0 = 全部断言通过）
 *
 * 规则（2026-11-06 用户确认）：
 *   R1 默认工作区始终显示，无论是否有可见会话。
 *   R2 其他工作区：最后一个可见会话被归档后隐藏；任一/任几会话取消归档后重新显示。
 *   R3 新创建、尚未产生第一个实际会话的工作区不受隐藏影响。
 */

/** 与 @deepseek-ai/dsh-client-ui-workspace/lib/client.js 的 sessionVisible 同构。 */
function sessionVisible(session, current, archived, archivedFilter) {
  if (session.blank) return session.id === current;
  switch (archivedFilter) {
    case 'default': return !archived.has(session.id);
    case 'show': return true;
    case 'only': return archived.has(session.id);
    default: throw new Error(`unknown archivedFilter: ${archivedFilter}`);
  }
}

/**
 * 与 groupByWorkspace 同构的分组推导，叠加隐藏策略。
 * 返回 { groups, hidden }：hidden 为被隐藏的工作区数（用于可选的提示行）。
 */
function groupByWorkspace(list, workspaces, archived, archivedFilter, current, policy) {
  const groups = [];
  let hidden = 0;

  for (const workspace of workspaces) {
    const members = [];
    let realMembers = 0; // 「实际会话」：非 blank 占位

    for (const id of workspace.sessionIds) {
      const summary = list.byId[id];
      if (summary === undefined) continue; // 头信息缺失 → 保守：不计入任何一侧
      if (!summary.blank) realMembers++;
      if (!sessionVisible(summary, current, archived, archivedFilter)) continue;
      members.push(summary);
    }

    // 现状逻辑：仅「仅显示已归档」会丢弃无可见成员的组
    if (archivedFilter === 'only' && members.length === 0) continue;

    // 新增：默认视图下隐藏「全归档」工作区
    const hide = policy.hideEmptyWorkspaces
      && archivedFilter === 'default'
      && members.length === 0          // 没有任何可见会话
      && realMembers > 0               // R3：曾经有过实际会话才可能被隐藏
      && workspace.workspaceId !== policy.defaultWorkspaceId; // R1：默认工作区豁免

    if (hide) { hidden++; continue; }
    groups.push({
      key: workspace.workspaceId,
      title: workspace.title,
      sessionCount: members.length,
      neverUsed: realMembers === 0,
    });
  }

  return { groups, hidden };
}

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

function makeList(sessions) {
  return { byId: Object.fromEntries(sessions.map((s) => [s.id, s])) };
}

const results = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, ok, actual, expected });
}

const policy = { hideEmptyWorkspaces: true, defaultWorkspaceId: 'ws-default' };
const visibleIds = (r) => r.groups.map((g) => g.key);

// 1) R1：默认工作区全部归档 → 仍然显示
{
  const list = makeList([{ id: 'a', blank: false }, { id: 'b', blank: false }]);
  const ws = [{ workspaceId: 'ws-default', title: 'default-workspace', sessionIds: ['a', 'b'] }];
  const r = groupByWorkspace(list, ws, new Set(['a', 'b']), 'default', undefined, policy);
  check('R1 default workspace fully archived stays visible', visibleIds(r), ['ws-default']);
  check('R1 default workspace counts 0 visible sessions', r.groups[0].sessionCount, 0);
}

// 2) R2：非默认工作区全部归档 → 隐藏
{
  const list = makeList([{ id: 'c', blank: false }, { id: 'd', blank: false }]);
  const ws = [{ workspaceId: 'ws-x', title: 'X', sessionIds: ['c', 'd'] }];
  const r = groupByWorkspace(list, ws, new Set(['c', 'd']), 'default', undefined, policy);
  check('R2 non-default workspace fully archived hides', visibleIds(r), []);
  check('R2 hidden counter increments', r.hidden, 1);
}

// 3) R2 反向：取消归档其中一个 → 重新显示
{
  const list = makeList([{ id: 'c', blank: false }, { id: 'd', blank: false }]);
  const ws = [{ workspaceId: 'ws-x', title: 'X', sessionIds: ['c', 'd'] }];
  const r = groupByWorkspace(list, ws, new Set(['c']), 'default', undefined, policy);
  check('R2 unarchiving one session restores the workspace', visibleIds(r), ['ws-x']);
  check('R2 restored workspace shows the visible session', r.groups[0].sessionCount, 1);
}

// 4) R3：从未使用（sessionIds 为空）→ 显示
{
  const list = makeList([]);
  const ws = [{ workspaceId: 'ws-new', title: 'New', sessionIds: [] }];
  const r = groupByWorkspace(list, ws, new Set(), 'default', undefined, policy);
  check('R3 never-used workspace stays visible', visibleIds(r), ['ws-new']);
}

// 5) R3：只有占位 blank 会话 → 显示（blank 不算实际会话）
{
  const list = makeList([{ id: 'blank-1', blank: true }]);
  const ws = [{ workspaceId: 'ws-new', title: 'New', sessionIds: ['blank-1'] }];
  const r = groupByWorkspace(list, ws, new Set(), 'default', 'other-session', policy);
  check('R3 workspace with only a blank session stays visible', visibleIds(r), ['ws-new']);
}

// 6) 显示已归档筛选：全部回来
{
  const list = makeList([{ id: 'c', blank: false }]);
  const ws = [{ workspaceId: 'ws-x', title: 'X', sessionIds: ['c'] }];
  const r = groupByWorkspace(list, ws, new Set(['c']), 'show', undefined, policy);
  check('filter=show re-reveals fully archived workspace', visibleIds(r), ['ws-x']);
}

// 7) 仅显示已归档：沿用现状（无可见成员的组本来就丢）
{
  const list = makeList([{ id: 'c', blank: false }, { id: 'e', blank: false }]);
  const ws = [{ workspaceId: 'ws-x', title: 'X', sessionIds: ['c', 'e'] }];
  const r = groupByWorkspace(list, ws, new Set(['c']), 'only', undefined, policy);
  check('filter=only keeps group with archived member', visibleIds(r), ['ws-x']);
  const r2 = groupByWorkspace(list, ws, new Set(), 'only', undefined, policy);
  check('filter=only drops group with no archived member', visibleIds(r2), []);
}

// 8) 头信息缺失：保守显示（不因数据不全而藏起来）
{
  const list = makeList([]); // id 都不在投影里
  const ws = [{ workspaceId: 'ws-x', title: 'X', sessionIds: ['ghost'] }];
  const r = groupByWorkspace(list, ws, new Set(['ghost']), 'default', undefined, policy);
  check('unknown session header does not cause hiding', visibleIds(r), ['ws-x']);
}

// 9) 策略关闭时行为回到现状
{
  const list = makeList([{ id: 'c', blank: false }]);
  const ws = [{ workspaceId: 'ws-x', title: 'X', sessionIds: ['c'] }];
  const r = groupByWorkspace(list, ws, new Set(['c']), 'default', undefined, { ...policy, hideEmptyWorkspaces: false });
  check('policy off restores legacy behavior', visibleIds(r), ['ws-x']);
}

// 10) 混合：用户本机的真实形态（5 个工作区，2 个全归档，其中 1 个是默认）
{
  const list = makeList([
    { id: 's-work', blank: false },
    { id: 's-desk', blank: false },
    { id: 's-sim1', blank: false }, { id: 's-sim2', blank: false },
    { id: 's-def1', blank: false }, { id: 's-def2', blank: false },
  ]);
  const ws = [
    { workspaceId: 'ws-work', title: 'Work', sessionIds: ['s-work'] },
    { workspaceId: 'ws-desk', title: 'Desktop', sessionIds: ['s-desk'] },
    { workspaceId: 'ws-sim', title: 'Sim', sessionIds: ['s-sim1', 's-sim2'] },
    { workspaceId: 'ws-default', title: 'default-workspace', sessionIds: ['s-def1', 's-def2'] },
  ];
  const archived = new Set(['s-desk', 's-def1', 's-def2']);
  const r = groupByWorkspace(list, ws, archived, 'default', undefined, policy);
  check('real shape: Work/Sim/default visible, Desktop hidden',
    visibleIds(r), ['ws-work', 'ws-sim', 'ws-default']);
  check('real shape: exactly one hidden', r.hidden, 1);
}

// 11) 回归：真实会话已归档 + 残留一个非当前的 blank 占位 → 仍然隐藏
//     （2026-11-06「模拟人生」现场；缺陷出在实现把 blank 一律当可见，规格本身是对的）
{
  const list = makeList([{ id: 'real-1', blank: false }, { id: 'blank-1', blank: true }]);
  const ws = [{ workspaceId: 'ws-sim', title: 'Sim', sessionIds: ['real-1', 'blank-1'] }];
  const r = groupByWorkspace(list, ws, new Set(['real-1']), 'default', undefined, policy);
  check('regression: leftover non-current blank does not keep the row', visibleIds(r), []);
}

// 12) 回归反向：同一个 blank 占位就是当前会话 → 行必须保留
{
  const list = makeList([{ id: 'real-1', blank: false }, { id: 'blank-1', blank: true }]);
  const ws = [{ workspaceId: 'ws-sim', title: 'Sim', sessionIds: ['real-1', 'blank-1'] }];
  const r = groupByWorkspace(list, ws, new Set(['real-1']), 'default', 'blank-1', policy);
  check('regression: current blank keeps the row', visibleIds(r), ['ws-sim']);
}

// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}` + (r.ok ? '' : `\n      expected=${JSON.stringify(r.expected)}\n      actual  =${JSON.stringify(r.actual)}`));
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
