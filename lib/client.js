/**
 * dsh-deai-style 浏览器半边（手写发布格式，无构建步骤）：
 * 设置 → 通用 → 「去 AI 味（人类文风）」行。
 *
 * 一个**切换开关**（enabled）+ 展开后的**覆盖档**（core/full）与
 * **文体档**（general/academic/social）。外观与状态由**渲染结果**驱动
 * （快照 → 属性）——无本地 React state；点击先本地镜像即时反馈、再
 * scope.set 持久化，订阅回声收敛。改动立即生效（宿主文风段每次提示
 * 构建现读，无需重启）。
 *
 * 文案字典 zh/en 键集必须对齐（smoke 交叉核对）。
 *
 * @module dsh-deai-style/client
 */
window.__ModuleLoader__.load({
	id: "dsh-deai-style",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let jsx_runtime = require("react/jsx-runtime");
		let client_store = require("@deepseek-ai/dsh-client-store");
		const { jsx, jsxs } = jsx_runtime;

		/** 设置页文案字典命名空间（locale 注册 + 槽位描述同一字符串）。 */
		const SETTINGS_NS = "settings.deai-style";
		/** 宿主配置表单入口 id（= cordis.patch.yml 的 id，与宿主 SETTINGS_NAMESPACE 一致）。 */
		const THEME_NS = "deai-style";
		/** 持久化字段：总开关。 */
		const ENABLED_FIELD = "enabled";
		/** 持久化字段：覆盖档。 */
		const SCOPE_FIELD = "scope";
		/** 持久化字段：文体档。 */
		const REGISTER_FIELD = "register";
		/** 覆盖档（与宿主一致；顺序即按钮顺序）。 */
		const SCOPES = ["core", "full"];
		/** 文体档（与宿主一致；顺序即按钮顺序）。 */
		const REGISTERS = ["general", "academic", "social"];

		/** `settings.deai-style` 字典（zh 键集为唯一真源，en 须对齐）。 */
		const zh = {
			"dai.title": "去 AI 味（人类文风）",
			"dai.desc": "按人类写作的统计特征输出：清套话、打散句长起伏、降低结构模板化与用词可预测性。事实、数字与引用不被改写",
			"dai.on": "已开启",
			"dai.off": "已关闭",
			"dai.scopeLabel": "覆盖",
			"dai.scope.core": "核心",
			"dai.scope.full": "全量",
			"dai.registerLabel": "文体",
			"dai.register.general": "通用",
			"dai.register.academic": "学术",
			"dai.register.social": "随笔"
		};
		const en = {
			"dai.title": "De-AI style (human voice)",
			"dai.desc": "Writes to the statistical fingerprint of human prose: drop stock phrases, vary sentence length hard, reduce structural templating and lexical predictability. Facts, numbers and citations are left untouched",
			"dai.on": "On",
			"dai.off": "Off",
			"dai.scopeLabel": "Coverage",
			"dai.scope.core": "Core",
			"dai.scope.full": "Full",
			"dai.registerLabel": "Register",
			"dai.register.general": "General",
			"dai.register.academic": "Academic",
			"dai.register.social": "Social"
		};

		/** 行样式（纯类名，挂载一次；不含 `</style`）。 */
		const ROW_CSS = [
			".dai-group{border-bottom:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:16px 0;display:flex}",
			".dai-text{flex-direction:column;gap:4px;display:flex}",
			".dai-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
			".dai-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}",
			".dai-switchRow{align-items:center;gap:10px;display:flex}",
			".dai-switch{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:40px;height:22px;border-radius:11px;position:relative;cursor:pointer;padding:0;background:var(--dsw-alias-bg-layer-2);transition:background .15s ease,border-color .15s ease}",
			".dai-switchOn{background:var(--dsw-alias-brand-primary);border-color:transparent}",
			".dai-knob{position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.35)}",
			".dai-switchOn .dai-knob{left:20px}",
			".dai-state{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}",
			".dai-choiceRow{align-items:center;gap:6px;flex-wrap:wrap;display:flex}",
			".dai-choiceLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;min-width:28px}",
			".dai-choiceBtn{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);transition:background .15s ease,color .15s ease}",
			".dai-choiceOn{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}"
		].join("");

		/** 行样式挂载（防重复；无 document 的运行时直接跳过）。 */
		function installRowStyles() {
			if (typeof document === "undefined") return;
			const tagId = "dsh-deai-style/row.css";
			if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-deai-style";
			tag.dataset.pluginCss = tagId;
			tag.textContent = ROW_CSS;
			document.head.appendChild(tag);
		}

		/**
		 * 快照净化：把任意外部快照收敛为安全镜像（未知档位回落默认）。
		 *
		 * @param raw - settings 快照值。
		 * @returns 净化后的镜像。
		 */
		function sanitizeSnapshot(raw) {
			const source = raw !== null && typeof raw === "object" ? raw : {};
			return {
				enabled: source[ENABLED_FIELD] === true,
				scope: SCOPES.includes(source[SCOPE_FIELD]) ? source[SCOPE_FIELD] : "core",
				register: REGISTERS.includes(source[REGISTER_FIELD]) ? source[REGISTER_FIELD] : "general"
			};
		}

		/**
		 * 行 store：镜像宿主快照（enabled+scope+register），插件的 adopt/setter 是唯一写入方。
		 *
		 * @returns store 句柄（与 dsh-code-flow/dsh-mode-switch 行 store 同构）。
		 */
		function createRowStore() {
			return client_store.defineStore({
				init: () => ({ enabled: false, scope: "core", register: "general", revision: -1 }),
				actions: { sync: (d, enabled, scope, register, revision) => {
					if (revision <= d.revision) return;
					d.enabled = enabled;
					d.scope = scope;
					d.register = register;
					d.revision = revision;
				} }
			});
		}

		/**
		 * 一排档位按钮（无本地 state；选中态来自渲染）。
		 *
		 * @param label - 行首标签文案。
		 * @param values - 档位值列表。
		 * @param active - 当前值。
		 * @param render - 值 → 文案。
		 * @param onPick - 值 → 写入回调。
		 * @returns 行元素树。
		 */
		function choiceRow(label, values, active, render, onPick) {
			return jsxs("div", {
				className: "dai-choiceRow",
				children: [
					jsx("span", { className: "dai-choiceLabel", children: label }),
					...values.map((value) => jsx("button", {
						type: "button",
						"aria-pressed": active === value,
						className: "dai-choiceBtn" + (active === value ? " dai-choiceOn" : ""),
						onClick: () => {
							onPick(value);
						},
						children: render(value)
					}, value))
				]
			});
		}

		/**
		 * 去 AI 味行：标题 + 说明 + 切换开关 + 状态文案；开启后追加
		 * 覆盖档与文体档两排按钮。全程无本地 state：外观来自渲染。
		 *
		 * @param props - 槽位组合注入的 props（t/setEnabled/setScope/setRegister/useStore）。
		 * @returns 行元素树。
		 */
		function DeaiRow({ t, setEnabled, setScope, setRegister, useStore }) {
			const enabled = useStore((s) => s.enabled);
			const scope = useStore((s) => s.scope);
			const register = useStore((s) => s.register);
			const children = [
				jsxs("div", {
					className: "dai-text",
					key: "text",
					children: [
						jsx("div", { className: "dai-title", children: t("dai.title") }),
						jsx("div", { className: "dai-desc", children: t("dai.desc") })
					]
				}),
				jsxs("div", {
					className: "dai-switchRow",
					key: "switch",
					children: [
						jsx("button", {
							type: "button",
							role: "switch",
							"aria-checked": enabled === true,
							"aria-label": t("dai.title"),
							className: "dai-switch" + (enabled === true ? " dai-switchOn" : ""),
							onClick: () => {
								setEnabled(enabled !== true);
							},
							children: [jsx("span", { className: "dai-knob" })]
						}),
						jsx("span", { className: "dai-state", children: enabled === true ? t("dai.on") : t("dai.off") })
					]
				})
			];
			if (enabled === true) {
				children.push(jsx("div", {
					key: "scope",
					children: choiceRow(t("dai.scopeLabel"), SCOPES, scope, (value) => t("dai.scope." + value), setScope)
				}));
				children.push(jsx("div", {
					key: "register",
					children: choiceRow(t("dai.registerLabel"), REGISTERS, register, (value) => t("dai.register." + value), setRegister)
				}));
			}
			return jsxs("div", { className: "dai-group", children });
		}

		/** 必需服务：槽位/文案，配置表单（configForms = 0.2.0 设置模型；remote 携带转发的失效通知）。 */
		const inject = ["slots", "locale", "remote", "configForms"];

		/**
		 * 客户端插件主体：挂行样式、绑定配置表单（启动采用 + 订阅实时
		 * 采用）、注册字典与设置行。
		 *
		 * @param ctx - 客户端 cordis 上下文。
		 */
		function apply(ctx) {
			installRowStyles();
			let scope;
			try {
				scope = ctx.configForms.get(THEME_NS);
			} catch (error) {
				console.warn("[dsh-deai-style] config form unavailable:", error);
				return;
			}
			const store = createRowStore();
			let bound;
			let revision = 0;
			let current = { enabled: false, scope: "core", register: "general" };

			const syncStores = () => {
				bound?.sync(current.enabled, current.scope, current.register, revision);
			};
			/** 采用持久化快照（不回写；畸形值安全化）。 */
			const adopt = () => {
				let raw;
				try {
					raw = typeof scope.getSnapshot === "function" ? scope.getSnapshot().value : typeof scope.get === "function" ? scope.get() : void 0;
				} catch {
					raw = void 0;
				}
				const next = sanitizeSnapshot(raw);
				if (next.enabled === current.enabled && next.scope === current.scope && next.register === current.register) return;
				current = next;
				revision += 1;
				syncStores();
			};
			ctx.effect(() => scope.subscribe(() => {
				adopt();
			}), "dsh-deai-style: settings adoption");
			adopt();

			ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), "dsh-deai-style: dictionaries");

			const injected = (actions) => {
				bound = actions;
				syncStores();
				return {
					/** 开关：本地镜像先翻（即时反馈），再持久化；订阅回声收敛。无变化则零写入。 */
					setEnabled: (value) => {
						const next = value === true;
						if (next === current.enabled) return;
						current.enabled = next;
						revision += 1;
						syncStores();
						scope.set(ENABLED_FIELD, next);
					},
					/** 覆盖档：非法值回落 core；无变化则零写入。 */
					setScope: (value) => {
						const next = SCOPES.includes(value) ? value : "core";
						if (next === current.scope) return;
						current.scope = next;
						revision += 1;
						syncStores();
						scope.set(SCOPE_FIELD, next);
					},
					/** 文体档：非法值回落 general；无变化则零写入。 */
					setRegister: (value) => {
						const next = REGISTERS.includes(value) ? value : "general";
						if (next === current.register) return;
						current.register = next;
						revision += 1;
						syncStores();
						scope.set(REGISTER_FIELD, next);
					}
				};
			};
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "deai",
				order: 17,
				store,
				locale: SETTINGS_NS,
				inject: injected
			}, DeaiRow));
		}

		/** 遍历元素树找带目标 className 的节点（测试与结构内省用）。 */
		function findAll(node, className) {
			const found = [];
			const visit = (current) => {
				if (current === null || typeof current !== "object") return;
				const classValue = current.props?.className;
				if (typeof classValue === "string" && classValue.split(" ").includes(className)) found.push(current);
				const children = current.props?.children;
				if (Array.isArray(children)) children.forEach(visit);
				else visit(children);
			};
			visit(node);
			return found;
		}

		exports.DICTIONARIES = { zh, en };
		exports.ENABLED_FIELD = ENABLED_FIELD;
		exports.REGISTERS = REGISTERS;
		exports.REGISTER_FIELD = REGISTER_FIELD;
		exports.ROW_CSS = ROW_CSS;
		exports.SCOPES = SCOPES;
		exports.SCOPE_FIELD = SCOPE_FIELD;
		exports.SETTINGS_NS = SETTINGS_NS;
		exports.DeaiRow = DeaiRow;
		exports.apply = apply;
		exports.choiceRow = choiceRow;
		exports.findAll = findAll;
		exports.inject = inject;
		exports.sanitizeSnapshot = sanitizeSnapshot;
		return module.exports;
	}
});
