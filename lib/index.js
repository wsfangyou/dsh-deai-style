/**
 * dsh-deai-style 宿主半边：「去 AI 味」（人类文风）的**服务端执行者**。
 *
 * 核心论点：所谓「AI 味」不是修辞毛病，是**统计指纹**——低困惑度
 * （用词可预测）、低突发度（句长太匀）、套话密度高、结构模板化。
 * 检测器读的就是这四个量，所以规则也照着这四个量写。
 *
 * 成因归因（设计出发点）：
 * - D1 用词可预测 → 套话表 + 偏好朴素词        → 词汇层
 * - D2 句长太匀（burstiness 低）→ 长短句强交错  → 句法层
 * - D3 结构模板化 → 拒绝总分总/对仗小标题       → 篇章层（full）
 * - D4 通篇抽象概括 → 具体名词/数字/限定条件     → 信息层（full）
 *
 * 机制（全部构建期现读，改设置无需重启）：
 * 1. Config 导出 `enabled`/`scope`/`register` 三个 `.volatile()` 运行时
 *    字段（0.2.0 设置模型）——段落正文每次构建经 `config.<field>.get()`
 *    活读；enabled=false → 段文本为空串（空段自动消失，零贡献）；
 * 2. 注册系统提示段 `deai-style:human-voice`（order 可配，默认 2210）
 *    按 scope 组装两档：core（词汇+句法）/ full（+篇章+信息）；
 * 3. 护栏段恒在（**地基，不是层**）：只改表达，不改事实/数字/引用/术语/
 *    结论；绝不为「像人」而增删信息或编造细节。core 与 full 都带。
 *
 * 文体与档位的交互（这是本插件唯一需要小心的地方）：
 * `academic`（学术）与 `full`（破结构）天然冲突——论文的小标题与逻辑
 * 链不能拆。因此 full 档下的「篇章层/信息层」按 register **换用不同
 * 正文**，而不是在通用正文后面加一句「仅取其中两条」：后者会让模型
 * 同时读到互相打架的两组指令。core 档下 register 只贡献一段短注记。
 *
 * 安全边界：
 * - 只注册自己的段，**不监听 `system-prompt/assemble`**、不改宿主段；
 * - 护栏段尾注恒在：任务专属指令、安全规则、真实性永远优先；
 * - 默认 enabled=false：不开启就零影响（段文本为空串）。
 *
 * 关键 API 约定（0.2.0 设置模型，与 dsh-code-flow/dsh-think-guard 一致）：
 * - 运行时字段在导出的 Config 上 `.volatile()` 声明，apply 收到配置引用，
 *   读走 `config.<field>.get()` 活读；
 * - 本插件自带设置页行 → `settings.configure({auto:false}, ctx.fiber)`
 *   登记页面策略；ctx.inject 回调**异步**执行，apply 时绝不同步断言；
 * - systemPrompt.section 的 text 是**函数**，每次提示构建调用 → 设置改动
 *   下一次回复即生效。
 *
 * @module dsh-deai-style
 */
import z from "@deepseek-ai/schemastery";

/** Cordis 插件名（诊断用；与 cordis.patch.yml 的 id 一致）。 */
const name = "deai-style";

/** 设置命名空间（须为小写连字符形态；与 lib/client.js 共用）。 */
const SETTINGS_NAMESPACE = "deai-style";

/** 持久化字段：总开关（默认 false = 零影响）。 */
const ENABLED_FIELD = "enabled";

/** 持久化字段：覆盖档（core = 词汇+句法 / full = 再加篇章+信息）。 */
const SCOPE_FIELD = "scope";

/** 持久化字段：文体档。 */
const REGISTER_FIELD = "register";

/** 覆盖档（顺序即界面按钮顺序）。 */
const SCOPES = ["core", "full"];

/** 文体档（顺序即界面按钮顺序）。 */
const REGISTERS = ["general", "academic", "social"];

/** 语言档（静态配置：注入哪一套套话表）。 */
const LANGUAGES = ["both", "zh", "en"];

/** 段落名（systemPrompt.section 注册名）。 */
const SECTION_NAME = "deai-style:human-voice";

/** 护栏段落名（仅供测试/诊断引用；护栏内嵌于同一段，不单独注册）。 */
const GUARD_MARKER = "## Guard (deai-style)";

/** bundle 可配项：volatile = 设置页可热写（表单模型），其余 = 补丁层静态配置。 */
const Config = z.object({
	/** 运行时开关：总开关（默认关 = 零影响）。 */
	[ENABLED_FIELD]: z.boolean().default(false).volatile(),
	/** 运行时档位：覆盖档（默认 core）。 */
	[SCOPE_FIELD]: z.union(SCOPES.map((scope) => z.const(scope))).default("core").volatile(),
	/** 运行时档位：文体档（默认 general）。 */
	[REGISTER_FIELD]: z.union(REGISTERS.map((register) => z.const(register))).default("general").volatile(),
	/** 文风段 order（有限正整数，越大越靠后）。 */
	sectionOrder: z.number().default(2210),
	/** 注入哪一套套话表（both/zh/en）。 */
	language: z.union(LANGUAGES.map((value) => z.const(value))).default("both"),
	/** 事实护栏（**恒在**；false 需手改补丁层，且意味着允许为文风改动内容）。 */
	guardFacts: z.boolean().default(true),
	/** 追加自定义禁用词/句（构建时净化：≤20 条、每条 ≤60 字）。 */
	extraBans: z.array(z.string()).default([])
});

/** 文风段头部（所有档位共用）。 */
const HEADER = [
	"## Human writing style (user-enabled)",
	"",
	"Write prose the way a person does, not the way a language model averages. The target is the statistical fingerprint a detector reads — sentence-length variation, unpredictable word choice, uneven structure, concrete detail — not surface decoration."
].join("\n");

/**
 * 中文套话表（**唯一真源**）：规则正文由它拼出，测量工具也读它。
 * 两处共用一份，才不会出现「规则改了、度量还按老表算」的漂移。
 */
const TELLS_ZH = [
	"值得注意的是",
	"综上所述",
	"总而言之",
	"首先…其次…最后",
	"在当今社会",
	"随着…的发展",
	"赋能",
	"打造",
	"全方位",
	"深度赋能",
	"助力",
	"彰显",
	"众所周知",
	"无疑",
	"极大地",
	"起到了…的作用",
	"让我们一起来"
];

/** 英文套话表（固定短语；与 TELLS_ZH 同为核心真源）。 */
const TELLS_EN = [
	"delve",
	"tapestry",
	"landscape",
	"testament to",
	"pivotal",
	"crucial",
	"robust",
	"leverage",
	"seamless",
	"underscore",
	"in today's fast-paced world",
	"let's dive in",
	"when it comes to"
];

/**
 * 中文套话的句式模式：这些套话在实际文本里会被插入内容打断，写成固定短语
 * 就会**漏检**（「首先，……。其次，……」匹配不上字面量「首先…其次…最后」），
 * 于是度量出来的密度假低。规则正文仍用字面量表达，度量另用模式。
 */
const TELLS_ZH_PATTERNS = [
	/首先[，,][\s\S]{0,80}?其次/u,
	/不仅[^。！？]{0,30}?而且/u
];

/** 英文套话的句式模式（不能写成固定短语的那几条）。 */
const TELLS_EN_PATTERNS = [
	/\bit'?s not just\b[^.!?]{1,60}?\bit'?s\b/i
];

/** 词汇层：套话表 + 朴素用词偏好（由上面两张表拼出，不另写一份）。 */
function buildLexicon(language) {
	const blocks = [];
	if (language !== "en") {
		blocks.push([
			"**Vocabulary — drop the tells (Chinese).** Delete stock connectives and filler no one writes on purpose. Never write: ",
			TELLS_ZH.join("、"),
			"。"
		].join(""));
	}
	if (language !== "zh") {
		blocks.push([
			"**Vocabulary — drop the tells (English).** Delete stock connectives and filler no one writes on purpose. Never write: ",
			TELLS_EN.join(", "),
			". Also cut em-dash pile-ups and colon-led lists used as rhythm rather than meaning, and break the \"it's not just X, it's Y\" frame; prefer the plain verb (use, help, show) over the inflated one (leverage, facilitate, demonstrate)."
		].join(""));
	}
	return blocks.join("\n\n");
}

/** 句法层：突发度（本插件最强的杠杆）。 */
const SYNTAX = [
	"**Sentence rhythm — the strongest lever.** Human prose has high burstiness: sentence length swings hard and unpredictably.",
	"- Alternate very short and long. A five-word sentence next to a sixty-word one is normal, not a mistake.",
	"- Break parallel triples: two items, or four, or an uneven list — not three matching clauses.",
	"- Vary paragraph length; do not give every paragraph the same shape.",
	"- Opening a sentence with a conjunction (And, But, 但, 所以) or with a fragment is fine.",
	"- Stop when the point is made. Not every sentence needs a subordinate clause."
].join("\n");

/** 篇章层：按文体换用不同正文（避免通用正文与文体注记互相打架）。 */
const STRUCTURE_LAYER = {
	general: [
		"**Structure — refuse the template.**",
		"- Do not run thesis → three balanced supports → summary. Let the shape follow the content.",
		"- Do not open every paragraph with a topic sentence and close it with a wrap-up.",
		"- End when the argument ends. No forced uplift, no closing restatement.",
		"- If you use headings, make them unequal in length and phrasing rather than a matched set of noun phrases.",
		"- Uneven information density is human: one idea takes three sentences, another half of one."
	].join("\n"),
	academic: [
		"**Structure — academic.** Keep the genre's spine: sections, headings, logical order, citation apparatus and terminology stay exactly as they are. Take only these two from the structure rules: do not force an uplifting ending, and do not make every paragraph the same length. Add no asides, no first-person colour, and no rhetorical flourish."
	].join("\n"),
	social: [
		"**Structure — social/blog.** Push further than general prose: short paragraphs, one-line paragraphs, sentence fragments, direct address, a question to the reader. Colloquial connectives are welcome."
	].join("\n")
};

/** 信息层：按文体换用不同正文（治困惑度）。 */
const SPECIFICITY_LAYER = {
	general: [
		"**Specificity — make it unpredictable.**",
		"- Concrete nouns, real numbers, dates, places, named things. Abstraction is where models live.",
		"- Add limiting conditions (\"under X\", \"for Y\"), because a real writer knows the edges.",
		"- Keep judgment and first-person stance where the register allows it.",
		"- One deliberate aside is worth more than a paragraph of even summary."
	].join("\n"),
	academic: [
		"**Specificity — academic.** State limiting conditions, scope and concrete figures wherever the content supports them, and name the specific case rather than the general category. Do not add asides, personal colour or invented illustrative detail: for this register, specificity means precision, never embellishment."
	].join("\n"),
	social: [
		"**Specificity — social/blog.** Say the plainly opinionated thing; give one concrete personal-flavoured detail where it is honestly available; prefer the specific example over the general claim."
	].join("\n")
};

/** core 档下的文体注记（full 档由上面两层各自承担，不重复）。 */
const CORE_REGISTER_NOTE = {
	general: "",
	academic: [
		"**Register — academic.** The vocabulary and rhythm rules apply in full; keep terminology, hedging, citation apparatus and section structure untouched. Add no asides and no first-person colour."
	].join("\n"),
	social: [
		"**Register — social/blog.** The vocabulary and rhythm rules apply in full; short paragraphs, fragments, direct address and colloquial connectives are welcome."
	].join("\n")
};

/** 护栏段（**地基，恒在**）：只改表达，不改内容。 */
const GUARD = [
	GUARD_MARKER,
	"",
	"This block changes HOW you write, never WHAT you write. Facts, numbers, dates, citations, quotations, terminology, technical claims and conclusions stay exactly as they are. Never add, remove, soften or reorder information in order to sound more human; never invent a detail, statistic, name or source to break up the rhythm. If natural prose and factual fidelity ever conflict, fidelity wins. Task-specific instructions, safety rules and truthfulness outrank this block."
].join("\n");

/**
 * 净化自定义禁用词（配置层）：非字符串剔除、trim、每条 ≤60 字、至多20条。
 *
 * @param bans - 原始 extraBans。
 * @returns 可安全内嵌的禁用词列表。
 */
function sanitizeBans(bans) {
	if (!Array.isArray(bans)) return [];
	return bans
		.filter((item) => typeof item === "string" && item.trim().length > 0)
		.slice(0, 20)
		.map((item) => item.trim().slice(0, 60));
}

/**
 * 按档位组装文风段正文。
 *
 * 块序：HEADER → 词汇 → 句法 →（full：篇章+信息｜core：文体注记）
 *      → 护栏 → 自定义禁用词。空块自动跳过（空段不产出空行）。
 *
 * @param scope - core / full（未知值回落 core）。
 * @param register - general / academic / social（未知值回落 general）。
 * @param language - both / zh / en（未知值回落 both）。
 * @param guardFacts - 是否携带护栏段（默认 true；false 只在手改补丁层时出现）。
 * @param extraBans - 自定义禁用词（会净化）。
 * @returns 模型向文风文本（可能为空串之外的非空文本）。
 */
function buildStyle(scope, register, language, guardFacts, extraBans) {
	const scopeKey = SCOPES.includes(scope) ? scope : "core";
	const registerKey = REGISTERS.includes(register) ? register : "general";
	const blocks = [HEADER, buildLexicon(language), SYNTAX];
	if (scopeKey === "full") {
		blocks.push(STRUCTURE_LAYER[registerKey], SPECIFICITY_LAYER[registerKey]);
	} else {
		const note = CORE_REGISTER_NOTE[registerKey];
		if (note.length > 0) blocks.push(note);
	}
	if (guardFacts !== false) blocks.push(GUARD);
	const bans = sanitizeBans(extraBans);
	if (bans.length > 0) {
		blocks.push(["**Never use these words or phrases.**", ...bans.map((item) => `- ${item}`)].join("\n"));
	}
	return blocks.filter((block) => typeof block === "string" && block.length > 0).join("\n\n");
}

/**
 * 配置引用活读（0.2.0 volatile 字段）：引用形态返回 `.get()` 的当前活值，
 * 非引用（缺失/畸形/未声明）原样返回，由调用方安全判定。
 *
 * @param value - config 字段（引用或普通值）。
 * @returns 当前活值。
 */
function readField(value) {
	return value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
}

/**
 * 插件主体：页面策略登记 + 文风段。
 *
 * @param ctx - cordis 上下文（模块级 inject 声明了 systemPrompt/settings）。
 * @param config - 经 Config 校验的配置（volatile 字段为活引用）。
 * @throws {Error} 配置畸形时启动即失败（配置要响亮地错）。
 */
function apply(ctx, config) {
	const resolved = config;
	if (!Number.isInteger(resolved?.sectionOrder) || resolved.sectionOrder < 1) {
		throw new Error("dsh-deai-style: sectionOrder must be a positive integer");
	}
	if (!LANGUAGES.includes(resolved.language)) {
		throw new Error("dsh-deai-style: language must be one of " + LANGUAGES.join("/"));
	}
	if (typeof resolved.guardFacts !== "boolean") {
		throw new Error("dsh-deai-style: guardFacts must be a boolean");
	}
	if (!Array.isArray(resolved.extraBans) || resolved.extraBans.some((item) => typeof item !== "string")) {
		throw new Error("dsh-deai-style: extraBans must be an array of strings");
	}

	/** 自带行页面策略：本插件自带设置行 → 抑制自动生成的表单面（0.2.0 契约）。 */
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
	});

	/** enabled 现读（每次提示构建一次；缺失/畸形/取用抛错一律安全回落 false）。 */
	const enabledNow = () => {
		try {
			return readField(resolved?.[ENABLED_FIELD]) === true;
		} catch {
			return false;
		}
	};
	/** scope 现读（未知值回落 core 双保险）。 */
	const scopeNow = () => {
		try {
			const scope = readField(resolved?.[SCOPE_FIELD]);
			return SCOPES.includes(scope) ? scope : "core";
		} catch {
			return "core";
		}
	};
	/** register 现读（未知值回落 general 双保险）。 */
	const registerNow = () => {
		try {
			const register = readField(resolved?.[REGISTER_FIELD]);
			return REGISTERS.includes(register) ? register : "general";
		} catch {
			return "general";
		}
	};

	// ── 机制：文风段（构建期现读，改设置下一次回复即生效；关闭 = 空串 = 空段消失） ──
	ctx.systemPrompt.section({
		name: SECTION_NAME,
		order: resolved.sectionOrder,
		text: () => {
			if (!enabledNow()) return "";
			return buildStyle(scopeNow(), registerNow(), resolved.language, resolved.guardFacts, resolved.extraBans);
		}
	});
}

/** Registries this plugin contributes to. */
const inject = ["systemPrompt", "settings"];

export {
	CORE_REGISTER_NOTE,
	Config,
	ENABLED_FIELD,
	GUARD,
	GUARD_MARKER,
	HEADER,
	LANGUAGES,
	REGISTERS,
	REGISTER_FIELD,
	SECTION_NAME,
	SETTINGS_NAMESPACE,
	SCOPES,
	SCOPE_FIELD,
	SPECIFICITY_LAYER,
	STRUCTURE_LAYER,
	SYNTAX,
	TELLS_EN,
	TELLS_EN_PATTERNS,
	TELLS_ZH,
	TELLS_ZH_PATTERNS,
	apply,
	buildLexicon,
	buildStyle,
	inject,
	name,
	readField,
	sanitizeBans
};
