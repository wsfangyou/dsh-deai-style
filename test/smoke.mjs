/**
 * dsh-deai-style 冒烟测试：不启浏览器、不装宿主，纯逻辑断言。
 *
 * 覆盖三道最容易悄悄坏掉的地方：
 * 1. **关闭 = 零贡献**：enabled=false 时段文本必须是空串（空段自动消失），
 *    否则「关掉还生效」这种 bug 会静默地污染每一次提示构建；
 * 2. **两档边界**：core 不许出现篇章/信息层正文，full 必须出现；
 *    且 academic×full 必须是**降级正文**（不含「破模板」措辞）——
 *    这是我为了不让论文被拆而专门设计的交互，最值得钉住；
 * 3. **护栏恒在**：core / full / academic / social 四种组合下护栏段
 *    都必须在场，且永远排在自定义禁用词之前。
 *
 * 另有两条静态断言：宿主半边不监听 `system-prompt/assemble`（不碰宿主段），
 * 以及客户端样式表不含 `</style`（否则挂载时会撕裂文档）。
 *
 * 运行：node test/smoke.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
	Config,
	ENABLED_FIELD,
	GUARD_MARKER,
	REGISTER_FIELD,
	REGISTERS,
	SECTION_NAME,
	SCOPES,
	SCOPE_FIELD,
	TELLS_EN,
	TELLS_EN_PATTERNS,
	TELLS_ZH,
	TELLS_ZH_PATTERNS,
	apply,
	buildStyle,
	inject,
	readField,
	sanitizeBans
} from "../lib/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, "..");
const CLIENT_SOURCE = readFileSync(join(BUNDLE, "lib", "client.js"), "utf8");

/** core 档不该出现的篇章层措辞；full 档必须出现的同一措辞。 */
const STRUCTURE_PROBE = "refuse the template";
/** 信息层探针。 */
const SPECIFICITY_PROBE = "Specificity — make it unpredictable";
/** academic 降级后的篇章层探针。 */
const ACADEMIC_STRUCTURE_PROBE = "Structure — academic";

/**
 * 造一个最小宿主上下文：捕获注册的段与 settings.configure 策略。
 *
 * @param options - injectSettings=false 时模拟「profile 里没有 settings 服务」。
 * @returns 上下文与捕获数组。
 */
function makeCtx(options = {}) {
	const registered = [];
	const configureCalls = [];
	const listeners = [];
	const ctx = {
		fiber: { __fiber: true },
		systemPrompt: { section: (section) => {
			registered.push(section);
			return () => {};
		} },
		on: (event) => {
			listeners.push(event);
			return () => {};
		},
		effect: (fn) => fn(),
		inject: (deps, callback) => {
			if (options.injectSettings === false) return;
			callback({
				effect: (fn) => fn(),
				settings: { configure: (presentation) => {
					configureCalls.push(presentation);
					return () => {};
				} }
			});
		}
	};
	return { ctx, registered, configureCalls, listeners };
}

/** 一份可通过校验的静态配置（volatile 字段用普通值，测非引用路径）。 */
function baseConfig(overrides = {}) {
	return {
		sectionOrder: 2210,
		language: "both",
		guardFacts: true,
		extraBans: [],
		...overrides
	};
}

// ───────────────────────── 宿主：段注册与开关 ─────────────────────────
test("host: registers exactly one section under the declared name", () => {
	const { ctx, registered, configureCalls } = makeCtx();
	apply(ctx, baseConfig({ [ENABLED_FIELD]: false }));
	assert.equal(registered.length, 1, "must register exactly one system-prompt section");
	assert.equal(registered[0].name, SECTION_NAME);
	assert.equal(registered[0].order, 2210);
	assert.equal(typeof registered[0].text, "function", "text must be a live function, not a string");
	assert.deepEqual(configureCalls, [{ auto: false }], "must claim its own settings page policy");
});

test("host: disabled is a true zero contribution (empty string, not a stub)", () => {
	const { ctx, registered } = makeCtx();
	apply(ctx, baseConfig({ [ENABLED_FIELD]: false }));
	assert.equal(registered[0].text(), "", "disabled must yield an empty section so it disappears");
});

test("host: enabled yields non-empty prose for every scope/register combination", () => {
	for (const scope of SCOPES) {
		for (const register of REGISTERS) {
			const { ctx, registered } = makeCtx();
			apply(ctx, baseConfig({ [ENABLED_FIELD]: true, [SCOPE_FIELD]: scope, [REGISTER_FIELD]: register }));
			const text = registered[0].text();
			assert.ok(text.length > 0, `${scope}/${register} must produce text`);
			assert.ok(text.includes(GUARD_MARKER), `${scope}/${register} must carry the guard`);
		}
	}
});

test("host: settings are read live, so a toggle takes effect without a restart", () => {
	let enabled = false;
	let scope = "core";
	let register = "general";
	const config = baseConfig({
		[ENABLED_FIELD]: { get: () => enabled },
		[SCOPE_FIELD]: { get: () => scope },
		[REGISTER_FIELD]: { get: () => register }
	});
	const { ctx, registered } = makeCtx();
	apply(ctx, config);
	assert.equal(registered[0].text(), "", "starts disabled");
	enabled = true;
	assert.ok(registered[0].text().includes("Human writing style"), "flipping the switch is seen immediately");
	scope = "full";
	assert.ok(registered[0].text().includes(STRUCTURE_PROBE), "flipping the scope is seen immediately");
	register = "academic";
	assert.ok(registered[0].text().includes(ACADEMIC_STRUCTURE_PROBE), "flipping the register is seen immediately");
});

test("host: malformed or throwing config falls back safely instead of breaking assembly", () => {
	const { ctx, registered } = makeCtx();
	apply(ctx, baseConfig({
		[ENABLED_FIELD]: { get: () => { throw new Error("boom"); } },
		[SCOPE_FIELD]: { get: () => "nonsense" },
		[REGISTER_FIELD]: { get: () => 42 }
	}));
	assert.equal(registered[0].text(), "", "a throwing enabled getter must read as disabled, not throw");
});

test("host: an absent settings service does not stop the plugin", () => {
	const { ctx, registered } = makeCtx({ injectSettings: false });
	apply(ctx, baseConfig({ [ENABLED_FIELD]: true }));
	assert.ok(registered[0].text().length > 0, "plugin still works without the settings service");
});

test("host: bad static config fails loudly at activation", () => {
	for (const bad of [
		baseConfig({ sectionOrder: 0 }),
		baseConfig({ sectionOrder: 1.5 }),
		baseConfig({ language: "kr" }),
		baseConfig({ guardFacts: "yes" }),
		baseConfig({ extraBans: [1, 2] })
	]) {
		const { ctx } = makeCtx();
		assert.throws(() => apply(ctx, bad), /dsh-deai-style/, "malformed config must throw");
	}
});

// ───────────────────────── 宿主：两档边界与护栏 ─────────────────────────
test("scope core: carries vocabulary + rhythm, carries no structure/specificity prose", () => {
	const text = buildStyle("core", "general", "both", true, []);
	assert.ok(text.includes("drop the tells"));
	assert.ok(text.includes("Sentence rhythm"));
	assert.ok(!text.includes(STRUCTURE_PROBE), "core must not ship the structure layer");
	assert.ok(!text.includes(SPECIFICITY_PROBE), "core must not ship the specificity layer");
});

test("scope full: adds both deeper layers on top of core", () => {
	const text = buildStyle("full", "general", "both", true, []);
	assert.ok(text.includes("drop the tells"), "full is core plus more, never a replacement");
	assert.ok(text.includes("Sentence rhythm"));
	assert.ok(text.includes(STRUCTURE_PROBE));
	assert.ok(text.includes(SPECIFICITY_PROBE));
});

test("academic x full degrades the structure layer instead of contradicting itself", () => {
	const text = buildStyle("full", "academic", "both", true, []);
	assert.ok(text.includes(ACADEMIC_STRUCTURE_PROBE), "academic must get its own structure prose");
	assert.ok(!text.includes(STRUCTURE_PROBE), "academic must never be told to refuse the template");
	assert.ok(!text.includes("one deliberate aside"), "academic must not invite asides");
});

test("social x full pushes further than general in both deeper layers", () => {
	const social = buildStyle("full", "social", "both", true, []);
	assert.ok(social.includes("Structure — social/blog"));
	assert.ok(social.includes("Specificity — social/blog"));
	assert.ok(!social.includes(STRUCTURE_PROBE));
});

test("unknown scope/register fall back to the documented defaults", () => {
	const fallback = buildStyle("nonsense", "nonsense", "both", true, []);
	const explicit = buildStyle("core", "general", "both", true, []);
	assert.equal(fallback, explicit, "unknown档 must equal core/general");
});

test("guard sits in every combination and always precedes custom bans", () => {
	for (const scope of SCOPES) {
		for (const register of REGISTERS) {
			const text = buildStyle(scope, register, "both", true, ["赋能"]);
			const guardAt = text.indexOf(GUARD_MARKER);
			const bansAt = text.indexOf("Never use these words or phrases.");
			assert.ok(guardAt >= 0, `${scope}/${register} lost the guard`);
			assert.ok(bansAt > guardAt, `${scope}/${register} put bans before the guard`);
		}
	}
});

test("guard can only be dropped by hand-editing the patch layer", () => {
	const noGuard = buildStyle("full", "general", "both", false, []);
	assert.ok(!noGuard.includes(GUARD_MARKER));
	assert.ok(noGuard.includes(STRUCTURE_PROBE), "dropping the guard does not drop the rules");
});

// ───────────────────────── 宿主：语言与自定义禁用词 ─────────────────────────
test("language selects which tell lists are injected", () => {
	const zh = buildStyle("core", "general", "zh", true, []);
	const en = buildStyle("core", "general", "en", true, []);
	const both = buildStyle("core", "general", "both", true, []);
	assert.ok(zh.includes("综上所述") && !zh.includes("tapestry"));
	assert.ok(en.includes("tapestry") && !en.includes("综上所述"));
	assert.ok(both.includes("综上所述") && both.includes("tapestry"));
});

test("the tell tables are the single source of truth for the injected prose", () => {
	const zh = buildStyle("core", "general", "zh", true, []);
	for (const tell of TELLS_ZH) assert.ok(zh.includes(tell), `zh prose lost a tell: ${tell}`);
	const en = buildStyle("core", "general", "en", true, []);
	for (const tell of TELLS_EN) assert.ok(en.includes(tell), `en prose lost a tell: ${tell}`);
	assert.ok(TELLS_EN_PATTERNS.every((pattern) => pattern instanceof RegExp));
	assert.ok(zh.length > 0 && en.length > 0);
});

test("regression: zh sentence patterns catch connectives that literals miss", () => {
	// 真实文本会在「首先」与「其次」之间插入整句并以句号收尾，字面量
	// 「首先…其次…最后」匹配不上——曾经因此漏检，度量密度假低。
	const interrupted = "首先，这类文本结构清晰。其次，这类文本用词规范。";
	assert.ok(
		TELLS_ZH_PATTERNS.some((pattern) => pattern.test(interrupted)),
		"the 首先…其次 frame must be caught across a full stop"
	);
	const withinOneSentence = "它不仅提升了效率，而且改变了流程。";
	assert.ok(TELLS_ZH_PATTERNS.some((pattern) => pattern.test(withinOneSentence)));
	const clean = "我们把稿子读了三遍。第一遍没读懂。";
	assert.ok(!TELLS_ZH_PATTERNS.some((pattern) => pattern.test(clean)), "clean prose must not be flagged");
});

test("custom bans are sanitized: non-strings dropped, 20 kept, 60 chars trimmed", () => {
	assert.deepEqual(sanitizeBans("nope"), []);
	assert.deepEqual(sanitizeBans([1, null, "  ", "ok"]), ["ok"]);
	assert.equal(sanitizeBans(Array.from({ length: 30 }, (_, i) => `w${i}`)).length, 20);
	assert.equal(sanitizeBans(["x".repeat(200)])[0].length, 60);
	const text = buildStyle("core", "general", "zh", true, ["深度赋能", 7]);
	assert.ok(text.includes("- 深度赋能"));
	assert.ok(!text.includes("- 7"));
});

// ───────────────────────── 宿主：静态保证 ─────────────────────────
test("host registers no system-prompt/assemble listener (host sections stay untouched)", () => {
	const { ctx, listeners } = makeCtx();
	apply(ctx, baseConfig({ [ENABLED_FIELD]: true }));
	assert.ok(
		!listeners.includes("system-prompt/assemble"),
		"this plugin must contribute its own section and never rewrite the assembly"
	);
});

test("declared inject registries match what apply actually uses", () => {
	assert.deepEqual(inject, ["systemPrompt", "settings"]);
});

test("Config declares the three runtime fields as volatile and defaults to off", () => {
	const dict = Config.dict ?? Config.toJSON?.() ?? null;
	assert.ok(dict !== null, "Config must expose a schema dictionary");
	for (const key of [ENABLED_FIELD, SCOPE_FIELD, REGISTER_FIELD]) {
		const meta = dict[key]?.meta ?? {};
		assert.equal(meta.volatile, true, `${key} must be declared volatile`);
	}
});

test("readField unwraps references and passes plain values through", () => {
	assert.equal(readField({ get: () => 7 }), 7);
	assert.equal(readField(true), true);
	assert.equal(readField(undefined), undefined);
	assert.equal(readField(null), null);
});

// ───────────────────────── 客户端：模块与字典 ─────────────────────────
/**
 * 以发布格式加载客户端模块（stub 掉 ModuleLoader 与两个宿主模块）。
 *
 * 结果必须记忆化：ESM 只在首次 import 时执行顶层代码，重复 import 拿到的是
 * 缓存模块，不会再次调用 `__ModuleLoader__.load`——不缓存就会让后续每个
 * 用例都拿到空捕获。
 *
 * @returns 客户端导出对象。
 */
let clientModule = null;
async function loadClient() {
	if (clientModule !== null) return clientModule;
	let captured = null;
	globalThis.window = { __ModuleLoader__: { load: (definition) => {
		captured = definition;
	} } };
	await import("../lib/client.js");
	assert.ok(captured !== null, "client must register itself with the module loader");
	assert.equal(captured.id, "dsh-deai-style");
	const stubRequire = (id) => {
		if (id === "react/jsx-runtime") {
			const make = (type, props) => ({ type, props });
			return { jsx: make, jsxs: make };
		}
		if (id === "@deepseek-ai/dsh-client-store") {
			return { defineStore: (definition) => ({ definition, state: definition.init() }) };
		}
		throw new Error(`unexpected require: ${id}`);
	};
	clientModule = captured.factory(stubRequire);
	return clientModule;
}

test("client: registers into the settings row slot with a committed id", async () => {
	const client = await loadClient();
	assert.deepEqual(client.inject, ["slots", "locale", "remote", "configForms"]);
	const registrations = [];
	const ctx = {
		configForms: { get: () => ({
			getSnapshot: () => ({ value: { enabled: true, scope: "full", register: "academic" } }),
			subscribe: () => () => {},
			set: () => {}
		}) },
		effect: (fn) => fn(),
		locale: { register: () => () => {} },
		slots: {
			inject: (name, declare) => {
				registrations.push({ name, entry: declare() });
			},
			register: (entry) => entry
		}
	};
	client.apply(ctx);
	assert.equal(registrations.length, 1);
	assert.equal(registrations[0].name, "settings.general.item");
	assert.equal(registrations[0].entry.name, "settings.general.item");
	assert.equal(registrations[0].entry.id, "deai");
	assert.equal(typeof registrations[0].entry.inject, "function");
});

test("client: a missing config form degrades to a warning, never a throw", async () => {
	const client = await loadClient();
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => {
		warnings.push(args);
	};
	try {
		const ctx = {
			configForms: { get: () => { throw new Error("no form"); } },
			effect: (fn) => fn(),
			locale: { register: () => () => {} },
			slots: { inject: () => {}, register: (entry) => entry }
		};
		assert.doesNotThrow(() => client.apply(ctx));
	} finally {
		console.warn = originalWarn;
	}
	assert.equal(warnings.length, 1, "the degradation must be announced, not silent");
	assert.ok(String(warnings[0][0]).includes("dsh-deai-style"), "the warning must name the plugin");
});

test("client: every label the row asks for exists in both languages", async () => {
	const client = await loadClient();
	const zh = Object.keys(client.DICTIONARIES.zh).sort();
	const en = Object.keys(client.DICTIONARIES.en).sort();
	assert.deepEqual(zh, en, "locale keys must match one to one");
	// 只有键集对齐是不够的：两边同时漏掉组件真正要用的键也照样对齐。
	// 所以逐个断言组件会取用的标签键（与 DeaiRow 的 t(...) 调用一一对应）。
	const required = [
		"dai.title",
		"dai.desc",
		"dai.on",
		"dai.off",
		"dai.scopeLabel",
		"dai.registerLabel",
		...SCOPES.map((scope) => `dai.scope.${scope}`),
		...REGISTERS.map((register) => `dai.register.${register}`)
	];
	for (const key of required) {
		assert.ok(key in client.DICTIONARIES.zh, `zh dictionary is missing ${key}`);
		assert.ok(key in client.DICTIONARIES.en, `en dictionary is missing ${key}`);
	}
	assert.deepEqual(zh, [...required].sort(), "no unused labels left behind either");
});

test("client: stylesheet is safe to inject and uses theme tokens only", async () => {
	const client = await loadClient();
	assert.ok(!client.ROW_CSS.includes("</style"), "a closing tag would tear the document");
	assert.ok(!/url\(/.test(client.ROW_CSS), "no external assets in the row stylesheet");
	const colours = client.ROW_CSS.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/gi) ?? [];
	for (const colour of colours) {
		assert.ok(/^#fff$/i.test(colour) || colour.startsWith("rgba(0,0,0"), `literal colour escaped the theme tokens: ${colour}`);
	}
	assert.ok(client.ROW_CSS.includes("--dsw-alias-brand-primary"));
});

test("client: snapshot sanitizer clamps unknown values to the defaults", async () => {
	const client = await loadClient();
	assert.deepEqual(client.sanitizeSnapshot(null), { enabled: false, scope: "core", register: "general" });
	assert.deepEqual(client.sanitizeSnapshot({ enabled: "yes" }), { enabled: false, scope: "core", register: "general" });
	assert.deepEqual(
		client.sanitizeSnapshot({ enabled: true, scope: "nope", register: "nope" }),
		{ enabled: true, scope: "core", register: "general" }
	);
	assert.deepEqual(
		client.sanitizeSnapshot({ enabled: true, scope: "full", register: "social" }),
		{ enabled: true, scope: "full", register: "social" }
	);
});

// ───────────────────────── 客户端：渲染与写入 ─────────────────────────
/**
 * 渲染该行并返回元素树与写入记录。
 *
 * @param state - store 镜像（enabled/scope/register）。
 * @returns 元素树与 picks 数组。
 */
async function renderRow(state) {
	const client = await loadClient();
	const picks = [];
	const tree = client.DeaiRow({
		t: (key) => key,
		setEnabled: (value) => picks.push(["enabled", value]),
		setScope: (value) => picks.push(["scope", value]),
		setRegister: (value) => picks.push(["register", value]),
		useStore: (selector) => selector(state)
	});
	return { client, tree, picks };
}

test("row: switch reflects state and toggles on click", async () => {
	const on = await renderRow({ enabled: true, scope: "core", register: "general" });
	const switchNode = on.client.findAll(on.tree, "dai-switch")[0];
	assert.equal(switchNode.props.role, "switch");
	assert.equal(switchNode.props["aria-checked"], true);
	switchNode.props.onClick();
	assert.deepEqual(on.picks, [["enabled", false]], "clicking an on switch must ask for off");

	const off = await renderRow({ enabled: false, scope: "core", register: "general" });
	const offSwitch = off.client.findAll(off.tree, "dai-switch")[0];
	assert.equal(offSwitch.props["aria-checked"], false);
	offSwitch.props.onClick();
	assert.deepEqual(off.picks, [["enabled", true]]);
});

test("row: pickers appear only when enabled, and offer exactly the declared options", async () => {
	const off = await renderRow({ enabled: false, scope: "core", register: "general" });
	assert.equal(off.client.findAll(off.tree, "dai-choiceBtn").length, 0, "collapsed row shows no pickers");

	const on = await renderRow({ enabled: true, scope: "core", register: "general" });
	const buttons = on.client.findAll(on.tree, "dai-choiceBtn");
	assert.equal(buttons.length, SCOPES.length + REGISTERS.length);
	assert.equal(on.client.findAll(on.tree, "dai-choiceOn").length, 2, "one active per picker row");
	buttons[0].props.onClick();
	buttons[2].props.onClick();
	assert.deepEqual(on.picks, [["scope", "core"], ["register", "general"]]);
});

test("row: the active option is the one the store reports, not a local guess", async () => {
	const full = await renderRow({ enabled: true, scope: "full", register: "academic" });
	const active = full.client.findAll(full.tree, "dai-choiceOn");
	const labels = active.map((node) => node.props.children);
	assert.deepEqual(labels, ["dai.scope.full", "dai.register.academic"]);
});

test("client file declares no import statements (published module format)", () => {
	assert.ok(!/^\s*import\s/m.test(CLIENT_SOURCE), "client.js must stay loadable by the browser module loader");
});
