# dsh-workspace-hide-empty

[English](README.md) | **中文**

侧栏「工作区」空栏目治理插件。把**全部会话都已归档**的非默认工作区行隐藏起来，默认工作区与尚未产生实际会话的新工作区始终保持可见。

- 版本：0.1.1
- 形态：**profile `link:` 挂载的独立插件**（宿主半为空实现，行为全部在浏览器半）
- 不改 `app.asar`、不改 vendor 包、不改 `workspace.json` 任何字段

---

## 一、行为规格

| # | 规则 | 判定 |
|---|---|---|
| R1 | 默认工作区始终显示 | `workspaceId === defaultWorkspaceId` → 永不隐藏 |
| R2 | 其他工作区最后一个可见会话被归档后隐藏；任一/任几会话取消归档后重新显示 | `实际会话数 > 0` 且 `可见会话数 === 0` → 隐藏 |
| R3 | 新创建、尚未产生第一个实际会话的工作区不受影响 | `实际会话数 === 0` → 永不隐藏 |

口径：

- **实际会话** = 会话头存在且 `blank !== true`（`blank` 是「新会话」占位）。
- **可见会话** = 内置侧栏在「隐藏已归档」视图下**真的会渲染**的会话，与内置 `sessionVisible(session, current, archived, "default")` 同构：
  - 已归档 → 不渲染；
  - `blank` 且**不是当前主视图会话** → 不渲染（内置只在它是当前会话时渲染那一行）；
  - 其余 → 渲染。
- **会话头缺失** 的 id 直接跳过 → 该工作区按"没有实际会话"处理 → 不隐藏。

> 已确认推论：新工作区建了第一个实际会话、随后又把它归档 → 该工作区隐藏（此时它已不属于"尚未产生第一个实际会话"）。

## 二、实现方式与生效范围

**实现方式**：浏览器端派生 + 行级 CSS 隐藏。

1. 数据来自官方客户端服务，不解析 DOM 文本：
   - `ctx.get('workspaces').list` → `items`（工作区与 `sessionIds`）、`archivedSessionIds`
   - `ctx.get('sessions').list` → `byId`（会话头，用于判 `blank`）
   - `ctx.get('workspaces').initializeDefault()` → 默认工作区 id（注册表已初始化时直接返回该实体，无副作用）
2. 计算出的隐藏集合写成一条 CSS 规则：
   ```css
   [data-row-key="workspace:<workspaceId>"]{display:none !important}
   ```
   内置侧栏每行都带 `data-row-key`（工作区行 `workspace:<id>`、会话行 `session:<id>`），因此重新渲染、虚拟化、拖拽都不影响。
3. 触发重算：两个快照 store 的 `subscribe` + `MutationObserver` + 2s 低频兜底轮询。
4. **显示归档的视图不隐藏**：只要屏幕上出现任意一条已归档会话行（说明当前是「全部对话（显示已归档）」或「仅显示已归档」），本插件整体不生效，把控制权还给内置筛选。

**生效范围**：仅当前 profile（默认 `desktop`）的 Web 侧栏「工作区」分组。不影响会话数据、不影响归档状态、不影响其它插件与右侧栏。

**fail-open 边界**（任何一条命中都不隐藏，只 `console.warn`）：

| 情形 | 结果 |
|---|---|
| 服务取不到 / 快照结构变了 | 不隐藏（`lastReason: services-unavailable`） |
| 已归档会话行在屏幕上 | 不隐藏（`lastReason: archived-view`） |
| 会话头缺失 | 不隐藏该工作区 |
| 默认工作区 id 取不到 | 退化为"创建时间最早的工作区"（`defaultSource: oldest-createdAt`），仍取不到则不豁免任何人 |
| 异常累计 | 累计 20 次异常自动 `teardown()`，回到内置行为 |

**急停**：控制台执行 `__dshWorkspaceHideEmpty.disable()`（写入 `localStorage['dsh-workspace-hide-empty:off']='1'`），恢复用 `.enable()`。无需卸载。

## 三、更新后仍然生效的机制

分三层，任何一层都不依赖 `app.asar`：

1. **挂载点在 profile，不在应用包内**
   插件以 `link:` 装在 `~/.dsh/profiles/<profile>/package.json`，包体复制到 `~/.dsh/plugins/dsh-workspace-hide-empty`（ASCII 路径，与工作区搬迁解耦）。DSH 升级只替换 `<DSH_INSTALL>\resources\app.asar` 与运行时，**不会覆盖 profile 清单、profile `node_modules` 与 `~/.dsh/plugins`**。
2. **浏览器半每次启动重新加载**
   页面启动时 Loader 按 `dsh.profile.bundles` 加载 `lib/client.js`，所以升级后新页面自动带上这段逻辑，不存在"旧补丁残留/失效"。
3. **契约漂移可被检测，且失效是 fail-open**
   插件依赖三处官方契约（行 `data-row-key`、两个快照 store 字段、`initializeDefault` 返回值）。升级后跑 `node scripts/check-contract.mjs`：
   - 全绿 → 行为继续生效；
   - 有红 → 插件自动 fail-open（不隐藏、不误藏），按报告的最小改动适配 `lib/client.js`，不必碰应用包。

> 与 `dsh-patch-sync` 的区别：那条路是"改 vendor 文件再回放"，上游重写会冲突跳过、同版本重装会丢记录；本插件**从不修改 vendor 文件**，只消费其 DOM 与数据契约，因此没有回放冲突面。

## 四、安装 / 卸载

```powershell
# 安装（复制到 ~/.dsh/plugins + 写 profile 的 link: 依赖 + 选中 bundle）
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1

# 只看会改什么，不落盘
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -WhatIf

# 卸载（保留 ~/.dsh/plugins 下的副本；加 -Purge 一并删除）
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1 [-Purge]
```

安装后**需要重启一次 DeepSeek Harness**（浏览器半在页面启动时加载）。脚本自动备份 `package.json`（`package.json.bak-hideempty-<时间戳>`）。

## 五、验证方式

### 1. 单元测试（判定逻辑，不依赖应用）

```powershell
node test/policy.test.mjs
```

10 条断言覆盖 R1 / R2 正反 / R3 / 已确认推论 / 缺头保守 / 真实形态。

> 注意：`node --test test/` 会 `spawn` 子进程，在本机沙箱下会 `EPERM`；直接跑测试文件即可，行为等价。

### 2. 升级后契约自检（每次 DSH 升级后跑一次）

```powershell
node scripts/check-contract.mjs
```

四项全 PASS 且退出码 0 ⇒ 插件依赖的 DOM 与数据契约都还在。任一项 FAIL ⇒ 插件已自动停手，按报告适配。

### 3. 页面内自检（应用内控制台）

```js
__dshWorkspaceHideEmpty.health()
// { ok: true, lastReason: 'ok', hidden: ['8d0fdaee-...'], defaultWorkspaceId: 'bbea4f57-...',
//   defaultSource: 'initializeDefault', subscribedStores: 2, errors: 0 }
```

`ok: true` 且 `hidden` 与预期一致即为生效；`defaultSource` 说明默认工作区是怎么认定的。

### 4. 功能验收（四条）

| 用例 | 预期 |
|---|---|
| 把某个非默认工作区最后一条可见会话归档 | 该工作区行消失 |
| 取消归档其中任意一条会话 | 该工作区行回来 |
| 默认工作区里所有会话都归档 | 该行仍在（R1） |
| 新建一个空工作区（尚未建会话） | 该行仍在（R3） |
| 侧栏切到「全部对话（显示已归档）」 | 所有工作区行都回来，已归档会话正常显示 |

## 六、已知边界

- 只处理**默认视图**（隐藏已归档）。其它两个筛选下不隐藏，这是刻意设计——用户显式要看归档内容时不该再藏行。
- 判定基于客户端快照；宿主推送与本地快照之间极短的窗口内可能多渲染一帧，随后自动收敛。
- 默认工作区 id 依赖 `workspace/initializeDefault` 的返回值；该接口在注册表已初始化时直接返回实体。若某版本改为不返回，插件退回"创建时间最早的工作区"并在 `defaultSource` 里明示。
- 隐藏是纯视觉：被隐藏的工作区仍可用「添加工作区」按目录重新选中（按路径复用既有注册），其会话在显示归档视图里完全可见。

## 七、修复记录

### 0.1.1（2026-11-06）：最后一个可见会话归档后不消失

**现象**：把「模拟：人生」工作区最后一个任务归档后，该栏目不自动隐藏；已经空掉的老工作区（如 `Desktop维护`）在页面加载时能正常隐藏。

**根因**：工作区里除已归档的真实会话外，还残留一个**从未使用的 blank 占位会话**（该会话日志只有 1 行 `type:"session"` 头、无任何对话）。内置侧栏在「隐藏已归档」视图下**不渲染非当前的 blank 占位**，于是该组被渲染成一个空行；而本插件当时的口径是"blank 也按可见处理，宁可少藏"，把它算成了可见会话 → `可见会话数 > 0` → 永不隐藏。规格（`scripts/hide-policy-sim.mjs`）本来就是对的，是实现侧口径漂移。

**修改点**（只改浏览器半，未触碰 CSS 隐藏方式、fail-open 红线与急停开关）：

| 位置 | 改动 |
|---|---|
| `lib/client.js` `decide()` | 可见性判定改为与内置 `sessionVisible(..., "default")` 同构：已归档不渲染；`blank` 且非当前会话不渲染；返回 `visible` 只统计真正会渲染的会话 |
| `lib/client.js` 新增 `mainSessionId(list)` | 与内置同名函数同构，取第一个 `retainedBy.mainView > 0` 的会话作为"当前会话" |
| `lib/client.js` `recompute()` | 把 `currentSessionId` 传给 `decide()` |
| `test/policy.test.mjs` | +3 条回归用例（残留 blank 必隐藏 / blank 为当前会话则保留 / 纯 blank 工作区仍属 R3） |
| `scripts/hide-policy-sim.mjs` | +2 条同源回归用例，锁定规格与实现一致 |

**生效**：重装插件副本后刷新页面即可（无数据迁移、无重启要求）。
