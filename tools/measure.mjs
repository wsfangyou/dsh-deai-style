#!/usr/bin/env node
/**
 * dsh-deai-style 效果度量：把「有没有去 AI 味」从嘴上说变成数字。
 *
 * 量三个**可测代理指标**——它们正是检测器实际看的那几个量：
 *   1. 突发度 burstiness = 句长标准差 / 句长均值（人类写作高，AI 低）
 *   2. 套话密度 = 命中套话数 / 每千字（人类低，AI 高）
 *   3. 段长方差（人类段落长短不齐，AI 齐整）
 *
 * 套话表直接 import 自 lib/index.js —— 与插件注入的规则**同一个真源**，
 * 所以规则改了度量自动跟着改，不会各算各的。
 *
 * 用法：
 *   node tools/measure.mjs 原稿.md               # 单个文件
 *   node tools/measure.mjs 原稿.md 改后.md        # 对照，给出方向判定
 *
 * **这不是检测器判定。** 它只说明「你离人类文风更近/更远了」，不预测
 * 任何平台的 AI 检测结果；那类判定不可复现，也不该假装能测。
 */
import { readFileSync } from "node:fs";
import { TELLS_EN, TELLS_EN_PATTERNS, TELLS_ZH, TELLS_ZH_PATTERNS } from "../lib/index.js";

/** 句末标点（中英混排；句号后跟空格才算断句，避免误切小数与缩写）。 */
const SENTENCE_BREAK = /[。！？…；!?;]+|\.\s+/u;

/**
 * 粗略断句（代理指标不需要精确分词；限制见文件头）。
 *
 * @param text - 原文。
 * @returns 句子数组（去空白、去空串）。
 */
function splitSentences(text) {
	return text
		.split(SENTENCE_BREAK)
		.map((sentence) => sentence.replace(/^[\s>*#\-•\d.、）)]+/, "").replace(/\s+/g, ""))
		.filter((sentence) => sentence.length > 0);
}

/**
 * 拆段落（空行分段；markdown 列表行各自成段）。
 *
 * @param text - 原文。
 * @returns 段落数组。
 */
function splitParagraphs(text) {
	return text
		.split(/\n\s*\n/)
		.flatMap((block) => block.split("\n"))
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !/^#{1,6}\s*$/.test(line));
}

/**
 * 均值与总体标准差。
 *
 * @param values - 数值数组。
 * @returns 均值与标准差（空数组返回 0）。
 */
function stats(values) {
	if (values.length === 0) return { mean: 0, sd: 0 };
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
	return { mean, sd: Math.sqrt(variance) };
}

/**
 * 统计套话命中数（中英字面 + 中英句式模式）。
 *
 * @param text - 原文。
 * @returns 命中的具体词条列表。
 */
function countTells(text) {
	const lower = text.toLowerCase();
	const hits = [];
	for (const tell of TELLS_ZH) {
		const count = text.split(tell).length - 1;
		for (let i = 0; i < count; i += 1) hits.push(tell);
	}
	for (const tell of TELLS_EN) {
		const count = lower.split(tell.toLowerCase()).length - 1;
		for (let i = 0; i < count; i += 1) hits.push(tell);
	}
	for (const pattern of [...TELLS_ZH_PATTERNS, ...TELLS_EN_PATTERNS]) {
		const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
		for (const match of text.match(new RegExp(pattern.source, flags)) ?? []) hits.push(match.trim());
	}
	return hits;
}

/**
 * 度量一篇文本。
 *
 * @param path - 文件路径。
 * @returns 指标对象。
 */
function measure(path) {
	const text = readFileSync(path, "utf8");
	const sentences = splitSentences(text);
	const paragraphs = splitParagraphs(text);
	const chars = text.replace(/\s/g, "").length;
	const sentenceLens = sentences.map((sentence) => sentence.length);
	const paragraphLens = paragraphs.map((paragraph) => paragraph.replace(/\s/g, "").length);
	const sentence = stats(sentenceLens);
	const paragraph = stats(paragraphLens);
	const hits = countTells(text);
	return {
		path,
		chars,
		sentences: sentences.length,
		paragraphs: paragraphs.length,
		meanSentence: sentence.mean,
		sdSentence: sentence.sd,
		burstiness: sentence.mean > 0 ? sentence.sd / sentence.mean : 0,
		sdParagraph: paragraph.sd,
		tellHits: hits.length,
		tellDensity: chars > 0 ? (hits.length / chars) * 1000 : 0,
		topTells: [...new Set(hits)].slice(0, 8).map((tell) => (tell.length > 12 ? `${tell.slice(0, 12)}…` : tell))
	};
}

/**
 * 格式化一行指标。
 *
 * @param label - 行名。
 * @param value - 数值。
 * @param digits - 小数位。
 * @param suffix - 单位。
 * @returns 对齐后的文本。
 */
function row(label, value, digits, suffix = "") {
	return `  ${label.padEnd(14)}${value.toFixed(digits)}${suffix}`;
}

/**
 * 打印一份报告。
 *
 * @param m - 指标对象。
 * @returns 无。
 */
function report(m) {
	process.stdout.write(`\n${m.path}\n`);
	process.stdout.write(row("非空白字数", m.chars, 0) + "\n");
	process.stdout.write(row("段落 / 句子", m.paragraphs, 0) + " / " + m.sentences.toFixed(0) + "\n");
	process.stdout.write(row("平均句长", m.meanSentence, 1, " 字") + "\n");
	process.stdout.write(row("句长标准差", m.sdSentence, 1, " 字") + "\n");
	process.stdout.write(row("突发度", m.burstiness, 3) + "   ← 越高越像人\n");
	process.stdout.write(row("段长标准差", m.sdParagraph, 1, " 字") + "   ← 越高越不齐整\n");
	process.stdout.write(row("套话命中", m.tellHits, 0) + `  (${m.tellDensity.toFixed(2)}/千字)   ← 越低越好\n`);
	if (m.topTells.length > 0) process.stdout.write(`  主要套话：${m.topTells.join("、")}\n`);
}

/**
 * 按「方向是否正确」给一个标记。
 *
 * @param good - 方向是否朝向人类文风。
 * @returns 标记文本。
 */
function mark(good) {
	return good ? "✅" : "⚠️";
}

/**
 * 对照两份报告并给出方向判定。
 *
 * @param before - 改前指标。
 * @param after - 改后指标。
 * @returns 无。
 */
function compare(before, after) {
	/**
	 * 相对变化的可读化：**分母为 0 时相对变化没有定义**，此时报绝对值
	 * 而不是印一个 "+Infinity%"——那种输出等于没输出。
	 *
	 * @param from - 改前值。
	 * @param to - 改后值。
	 * @returns 变化描述。
	 */
	const delta = (from, to) => {
		if (from === 0) return to === 0 ? "0.0%" : `n/a（0 → ${to.toFixed(1)}）`;
		const pct = ((to - from) / from) * 100;
		return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
	};
	const burstGood = after.burstiness > before.burstiness;
	const tellsGood = after.tellDensity < before.tellDensity;
	const parasGood = after.sdParagraph > before.sdParagraph;
	process.stdout.write("\n── 对照 ──\n");
	process.stdout.write(`  突发度      ${delta(before.burstiness, after.burstiness)}   ${mark(burstGood)}\n`);
	process.stdout.write(`  套话密度    ${delta(before.tellDensity, after.tellDensity)}   ${mark(tellsGood)}\n`);
	process.stdout.write(`  段长方差    ${delta(before.sdParagraph, after.sdParagraph)}   ${mark(parasGood)}\n`);
	const allGood = burstGood && tellsGood && parasGood;
	process.stdout.write(
		allGood
			? "\n  方向全部正确：更起伏、套话更少、段落更不齐整。\n"
			: "\n  有指标没朝人类文风走——检查是否只做了清词、没动句长起伏。\n"
	);
}

const files = process.argv.slice(2);
if (files.length === 0) {
	process.stderr.write("用法：node tools/measure.mjs <原稿> [改后稿]\n");
	process.exit(2);
}
for (const file of files) report(measure(file));
if (files.length >= 2) compare(measure(files[0]), measure(files[1]));
process.stdout.write("\n注：这是文风代理指标，说明你离人类文风更近或更远，不是任何平台的检测判定。\n");
