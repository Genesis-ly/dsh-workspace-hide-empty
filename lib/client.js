/**
 * dsh-workspace-hide-empty —— 浏览器半。
 *
 * 目标行为（2026-11-06 与用户确认）：
 *   R1 默认工作区始终显示，无论其中是否有可见会话；
 *   R2 其他工作区：最后一个可见会话被归档后隐藏该行；任一/任几会话取消归档后重新显示；
 *   R3 新创建、尚未产生第一个实际会话的工作区不受隐藏影响。
 *
 * 为什么这样实现：
 *   内置侧栏（@deepseek-ai/dsh-client-ui-workspace）对每个已注册工作区**无条件**建组，
 *   只有「仅显示已归档」筛选会丢弃无可见成员的组，所以「组在、组内 0 行」必然渲染成一个
 *   只剩文件夹图标的空行。该包没有对外暴露可替换分组的插槽，直接改 app.asar 又会被
 *   每次升级覆盖，所以本插件走「profile link: 挂载 + 浏览器端按行隐藏」：
 *     - 数据来自官方服务（ctx.get('workspaces').list / ctx.get('sessions').list），不解析 DOM 文本；
 *     - 只给 `[data-row-key="workspace:<id>"]` 注入 display:none，不改任何 vendor 文件；
 *     - 判定为派生式：归档集变化 → 重新计算，天然满足 R2 的"重新显示"。
 *
 * 安全边界（全部 fail-open，宁可少藏也不误藏）：
 *   - 服务取不到 → 不隐藏；
 *   - 屏幕上已能看到归档会话（说明用户在「全部对话/仅显示已归档」视图）→ 整体不隐藏；
 *   - 会话头信息缺失 → 该工作区按"没有实际会话"处理 → 不隐藏；
 *   - localStorage 里 `dsh-workspace-hide-empty:off = 1` → 立即停用（免卸载的急停开关）。
 *
 * 升级稳定性：本文件位于 profile 以 link: 挂载的独立插件里，不在 app.asar / vendor 包内，
 * DSH 升级只替换 app.asar，不会覆盖它。升级后若内置侧栏的 DOM 契约发生变化，
 * scripts/check-contract.mjs 会静态报红，health() 也会暴露 lastReason。
 */

window.__ModuleLoader__.load({
	id: "dsh-workspace-hide-empty",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var NS = "dsh-workspace-hide-empty";
		var VERSION = "0.1.1";
		var STYLE_ID = "dsh-workspace-hide-empty-style";
		var ROW_PREFIX = "workspace:";
		var SESSION_PREFIX = "session:";
		var OFF_KEY = "dsh-workspace-hide-empty:off";
		var POLL_MS = 2000;
		var DEBOUNCE_MS = 24;

		var STATE = {
			started: false,
			ctx: undefined,
			observer: undefined,
			style: undefined,
			timer: undefined,
			pollTimer: undefined,
			disposers: [],
			subscribed: 0,
			defaultId: undefined,
			defaultSource: "pending",
			hidden: [],
			reasons: {},
			lastReason: "init",
			errors: 0,
			lastRunAt: 0,
		};

		function warn(message, error) {
			STATE.errors += 1;
			try {
				console.warn("[dsh-workspace-hide-empty] " + message, error);
			} catch {}
		}

		/**
		 * 当前主视图会话（内置侧栏用它决定「新会话」占位行是否渲染）。
		 * 与内置 client.js 的 mainSessionId(list) 同构：第一个 retainedBy.mainView > 0 的会话。
		 * @returns 会话 id，或 undefined。
		 */
		function mainSessionId(list) {
			try {
				var sessions = Object.values((list && list.byId) || {});
				for (var index = 0; index < sessions.length; index += 1) {
					var session = sessions[index];
					if (session === undefined || session === null) continue;
					var retained = session.retainedBy;
					if (retained !== undefined && retained !== null && (retained.mainView || 0) > 0) {
						return session.id;
					}
				}
			} catch (error) {
				warn("mainSessionId failed", error);
			}
			return undefined;
		}

		/**
		 * 纯函数：给定工作区列表、归档集、会话头、当前会话、默认工作区，算出该隐藏哪些工作区。
		 *
		 * 判定（与 docs/空工作区栏目-归档联动方案.md §7.2 一致）：
		 *   隐藏 ⇔ 不是默认工作区 && 存在至少一个实际会话 && 可见会话数为 0
		 * 其中：
		 *   - 实际会话 = 会话头存在且 !blank（blank 是「新会话」占位，不算实际会话）；
		 *   - 可见会话 = 内置侧栏在「隐藏已归档」视图下**真的会渲染**的会话，
		 *     即与内置 sessionVisible(session, current, archived, "default") 同构：
		 *       已归档            → 不渲染
		 *       blank 且非当前会话 → 不渲染
		 *       其余              → 渲染
		 *     （修正前这里把 blank 一律算作可见，导致「只剩一个未使用的占位会话」的工作区永远藏不掉。）
		 *   - 会话头缺失的 id 直接跳过（保守）。
		 *
		 * @returns {{hidden: string[], reasons: Record<string, string>}}
		 */
		function decide(input) {
			var items = (input && input.items) || [];
			var archived = input && input.archivedSessionIds;
			var archivedHas = function (id) {
				if (archived === undefined || archived === null) return false;
				return typeof archived.has === "function"
					? archived.has(id)
					: archived.indexOf(id) !== -1;
			};
			var byId = (input && input.sessionById) || {};
			var defaultId = input && input.defaultWorkspaceId;
			var currentId = input && input.currentSessionId;

			var hidden = [];
			var reasons = {};

			for (var index = 0; index < items.length; index += 1) {
				var workspace = items[index];
				if (!workspace || workspace.workspaceId === undefined) continue;
				var id = workspace.workspaceId;
				var members = workspace.sessionIds || [];
				var real = 0;
				var visible = 0;

				for (var member = 0; member < members.length; member += 1) {
					var sessionId = members[member];
					var summary = byId[sessionId];
					if (summary === undefined) continue; // 头信息缺失：保守跳过
					if (summary.blank !== true) real += 1;
					if (archivedHas(sessionId)) continue; // 已归档：内置侧栏不渲染
					if (summary.blank === true && sessionId !== currentId) continue; // 非当前的「新会话」占位：内置侧栏不渲染
					visible += 1;
				}

				if (id === defaultId) {
					reasons[id] = "default"; // R1
					continue;
				}
				if (real === 0) {
					reasons[id] = "never-used"; // R3（含只有 blank 占位的）
					continue;
				}
				if (visible > 0) {
					reasons[id] = "has-visible"; // R2 的"重新显示"
					continue;
				}

				reasons[id] = "hide";
				hidden.push(id);
			}

			return { hidden: hidden, reasons: reasons };
		}

		function disabledByUser() {
			try {
				return window.localStorage.getItem(OFF_KEY) === "1";
			} catch {
				return false;
			}
		}

		function snapshotOf(service, storeName) {
			try {
				if (!service) return undefined;
				var store = service[storeName];
				if (!store || typeof store.getSnapshot !== "function") return undefined;
				return store.getSnapshot();
			} catch (error) {
				warn("read " + storeName + " snapshot failed", error);
				return undefined;
			}
		}

		/** 屏幕上是否已经渲染了「已归档」会话行 → 说明当前是显示归档的视图，整体不隐藏。 */
		function archivedRowsOnScreen(archivedHas) {
			try {
				var rows = document.querySelectorAll('[data-row-key^="' + SESSION_PREFIX + '"]');
				for (var index = 0; index < rows.length; index += 1) {
					var raw = rows[index].getAttribute("data-row-key");
					if (raw === null) continue;
					if (archivedHas(raw.slice(SESSION_PREFIX.length))) return true;
				}
			} catch (error) {
				warn("scan session rows failed", error);
			}
			return false;
		}

		function ensureStyle() {
			if (STATE.style && STATE.style.isConnected) return STATE.style;
			var existing = document.getElementById(STYLE_ID);
			if (existing) {
				STATE.style = existing;
				return existing;
			}
			var style = document.createElement("style");
			style.id = STYLE_ID;
			style.setAttribute("data-plugin", NS);
			(document.head || document.documentElement).appendChild(style);
			STATE.style = style;
			return style;
		}

		/** 把隐藏清单写成 CSS 规则；只写变化时才更新，避免无谓的重排。 */
		function applyCss(hiddenIds) {
			try {
				var style = ensureStyle();
				var css = "";
				for (var index = 0; index < hiddenIds.length; index += 1) {
					css +=
						'[data-row-key="' +
						ROW_PREFIX +
						String(hiddenIds[index]).replace(/"/g, '\\"') +
						'"]{display:none !important}\n';
				}
				if (style.textContent !== css) style.textContent = css;
				document.documentElement.setAttribute(
					"data-dsh-workspace-hide-empty",
					hiddenIds.length > 0 ? String(hiddenIds.length) : "0",
				);
			} catch (error) {
				warn("apply css failed", error);
				if (STATE.errors > 20) teardown();
			}
		}

		function fallbackOldestDefault() {
			var snapshot = snapshotOf(STATE.ctx && STATE.ctx.get("workspaces"), "list");
			var items = (snapshot && snapshot.items) || [];
			var bestId = undefined;
			var bestAt = Infinity;
			for (var index = 0; index < items.length; index += 1) {
				var created = Date.parse(items[index] && items[index].createdAt);
				if (!Number.isFinite(created)) continue;
				if (created < bestAt) {
					bestAt = created;
					bestId = items[index].workspaceId;
				}
			}
			if (bestId !== undefined) {
				STATE.defaultId = bestId;
				STATE.defaultSource = "oldest-createdAt";
			} else {
				STATE.defaultSource = "unresolved";
			}
		}

		/**
		 * 取默认工作区 id。
		 * 注册表在 defaultWorkspaceId 已设置时直接返回该实体（无副作用），所以这里只在
		 * 已有工作区时调用一次；取不到就退回「创建时间最早的工作区」。
		 */
		function resolveDefault() {
			var service = STATE.ctx && STATE.ctx.get("workspaces");
			if (!service) {
				STATE.defaultSource = "no-service";
				return;
			}
			var snapshot = snapshotOf(service, "list");
			var items = (snapshot && snapshot.items) || [];
			if (items.length === 0) {
				STATE.defaultSource = "empty-registry";
				return;
			}
			if (STATE.defaultId !== undefined) return;
			if (typeof service.initializeDefault !== "function") {
				fallbackOldestDefault();
				return;
			}
			Promise.resolve(service.initializeDefault())
				.then(function (result) {
					var workspace = result && result.ok && result.value && result.value.workspace;
					if (workspace && workspace.workspaceId !== undefined) {
						STATE.defaultId = workspace.workspaceId;
						STATE.defaultSource = "initializeDefault";
					} else {
						fallbackOldestDefault();
					}
					schedule();
				})
				.catch(function (error) {
					warn("initializeDefault failed, falling back to oldest", error);
					fallbackOldestDefault();
					schedule();
				});
		}

		function recompute() {
			STATE.lastRunAt = Date.now();
			var ctx = STATE.ctx;
			if (!ctx) {
				STATE.lastReason = "no-context";
				return;
			}
			if (disabledByUser()) {
				STATE.lastReason = "disabled-by-user";
				STATE.hidden = [];
				applyCss([]);
				return;
			}

			var workspaces = ctx.get("workspaces");
			var sessions = ctx.get("sessions");
			var wsSnapshot = snapshotOf(workspaces, "list");
			var sessionSnapshot = snapshotOf(sessions, "list");
			if (wsSnapshot === undefined || sessionSnapshot === undefined) {
				STATE.lastReason = "services-unavailable";
				STATE.hidden = [];
				applyCss([]);
				return;
			}

			var archivedList = wsSnapshot.archivedSessionIds || [];
			var archivedSet = new Set(archivedList);
			var archivedHas = function (id) {
				return archivedSet.has(id);
			};

			if (archivedRowsOnScreen(archivedHas)) {
				STATE.lastReason = "archived-view";
				STATE.hidden = [];
				applyCss([]);
				return;
			}

			if (STATE.defaultId === undefined && STATE.defaultSource === "pending") resolveDefault();

			var result = decide({
				items: wsSnapshot.items,
				archivedSessionIds: archivedSet,
				sessionById: sessionSnapshot.byId,
				currentSessionId: mainSessionId(sessionSnapshot),
				defaultWorkspaceId: STATE.defaultId,
			});

			STATE.hidden = result.hidden;
			STATE.reasons = result.reasons;
			STATE.lastReason = "ok";
			applyCss(result.hidden);
		}

		function schedule() {
			if (STATE.timer !== undefined) return;
			STATE.timer = setTimeout(function () {
				STATE.timer = undefined;
				try {
					recompute();
				} catch (error) {
					warn("recompute failed", error);
				}
			}, DEBOUNCE_MS);
		}

		function subscribeStores() {
			var ctx = STATE.ctx;
			var stores = [snapshotStore(ctx.get("workspaces")), snapshotStore(ctx.get("sessions"))];
			for (var index = 0; index < stores.length; index += 1) {
				var store = stores[index];
				if (!store || typeof store.subscribe !== "function") continue;
				try {
					var disposer = store.subscribe(function () {
						schedule();
					});
					STATE.disposers.push(disposer);
					STATE.subscribed += 1;
				} catch (error) {
					warn("subscribe failed", error);
				}
			}
		}

		function snapshotStore(service) {
			return service && service.list && typeof service.list.subscribe === "function"
				? service.list
				: undefined;
		}

		function teardown() {
			try {
				if (STATE.observer) STATE.observer.disconnect();
			} catch {}
			for (var index = 0; index < STATE.disposers.length; index += 1) {
				try {
					var disposer = STATE.disposers[index];
					if (typeof disposer === "function") disposer();
					else if (disposer && typeof disposer.dispose === "function") disposer.dispose();
				} catch {}
			}
			STATE.disposers = [];
			if (STATE.pollTimer !== undefined) clearInterval(STATE.pollTimer);
			STATE.pollTimer = undefined;
			applyCss([]);
			STATE.started = false;
			STATE.lastReason = "torn-down";
		}

		function install() {
			if (STATE.started) return;
			STATE.started = true;

			STATE.observer = new MutationObserver(function () {
				schedule();
			});
			STATE.observer.observe(document.body, { childList: true, subtree: true });

			// 订阅失败时的兜底：低频轮询，代价是两次快照读取 + 一次 querySelectorAll。
			STATE.pollTimer = setInterval(function () {
				schedule();
			}, POLL_MS);

			recompute();
			warn("installed " + VERSION);
		}

		function apply(ctx) {
			try {
				if (typeof window === "undefined" || typeof document === "undefined") return;
				STATE.ctx = ctx;
				var start = function () {
					try {
						resolveDefault();
						subscribeStores();
						install();
						schedule();
					} catch (error) {
						warn("install failed", error);
					}
				};
				if (document.body) start();
				else setTimeout(start, 600);
			} catch (error) {
				warn("client init failed", error);
			}
		}

		/** 供页面内诊断：控制台执行 __dshWorkspaceHideEmpty.health()。 */
		function health() {
			return {
				plugin: NS,
				version: VERSION,
				ok: STATE.lastReason === "ok",
				started: STATE.started,
				lastReason: STATE.lastReason,
				hidden: STATE.hidden.slice(),
				reasons: Object.assign({}, STATE.reasons),
				defaultWorkspaceId: STATE.defaultId,
				defaultSource: STATE.defaultSource,
				subscribedStores: STATE.subscribed,
				errors: STATE.errors,
				lastRunAt: STATE.lastRunAt,
				killSwitch: OFF_KEY,
			};
		}

		function disable() {
			try {
				window.localStorage.setItem(OFF_KEY, "1");
			} catch {}
			recompute();
		}

		function enable() {
			try {
				window.localStorage.removeItem(OFF_KEY);
			} catch {}
			recompute();
		}

		try {
			window.__dshWorkspaceHideEmpty = {
				version: VERSION,
				health: health,
				recompute: function () {
					recompute();
					return health();
				},
				disable: disable,
				enable: enable,
				teardown: teardown,
			};
		} catch (error) {
			warn("expose diagnostics failed", error);
		}

		exports.NS = NS;
		exports.VERSION = VERSION;
		exports.inject = ["workspaces", "sessions"];
		exports.apply = apply;
		exports.decide = decide;
		return module.exports;
	},
});
