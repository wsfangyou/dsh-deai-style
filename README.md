# dsh-deai-style

DSH 的「去 AI 味」插件：让模型写文章时按**人类写作的统计特征**输出，而不是按语言模型的平均值输出。带设置页开关，默认关闭（关闭 = 零影响）。

## 先说实话

**这个插件不承诺任何平台的 AI 检测结果。** Turnitin 之类的检测器是闭源商业分类器，拿不到判定接口、无法复现、也无法测试；任何「保证检测不出」的说法都是骗人的。

插件做的是可验证的那一半：**降低文本的统计可检测性特征**——低困惑度、低突发度（句长太匀）、套话密度高、结构模板化。这四个量是「AI 味」的物理本体。改进了多少，`tools/measure.mjs` 会给你数字。

如果稿子要交给学校或期刊，规矩以你所在机构为准。

## 它治什么

| 层 | 治什么指标 | 手法 | 在哪档 |
|---|---|---|---|
| 词汇层 | 套话密度、用词可预测性 | 套话表（中英各一张）+ 偏好朴素动词 | core |
| 句法层 | **突发度**（最强杠杆） | 句长剧烈起伏、拆三段排比、允许短句与碎片 | core |
| 篇章层 | 结构模板化 | 破总分总、结尾不强行升华、小标题不对仗 | full |
| 信息层 | 困惑度 | 具体名词、数字、限定条件、判断句 | full |
| **护栏** | **防失真** | 只改表达，不改事实/数字/引用/术语/结论 | **恒在** |

护栏是**地基，不是层**：它在 core 和 full 里都在，且永远排在自定义禁用词之前。套话没清干净只是「还有 AI 味」，事实被改掉是「稿子废了」——这两件事不该由同一个旋钮控制。

## 设置页

设置 → 通用 → 「去 AI 味（人类文风）」：

```
去 AI 味                                              [ ●——]
  覆盖   [ 核心 ] [ 全量 ]
  文体   [ 通用 ] [ 学术 ] [ 随笔 ]
```

- **覆盖 `core`**：词汇层 + 句法层。治最能测的两个指标（套话密度、突发度）。
- **覆盖 `full`**：core **加上**篇章层与信息层。是加，不是换——两档共享同一套词表与句法规则，不会各自漂移。
- **文体**：`general` / `academic` / `social`。决定 full 档下篇章与信息层用哪一套正文。

开关关着时两排按钮不渲染。

### 学术档为什么特殊

`academic`（学术）与 `full`（破结构）天然冲突——论文的小标题、逻辑链、引用体例是不能拆的。所以 full 档下的篇章层/信息层**按文体换用不同正文**，而不是在通用正文后面加一句「仅取其中两条」：后者会让模型同时读到互相打架的两组指令。

学术档只从篇章层取两条（不强行升华、段落不等长），从信息层取两条（限定条件、具体数字），并明确禁止闲笔与个人视角。

## 配置

运行时字段（设置页可热写，落在 profile 的 `cordis.patch.yml` 覆盖层）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 总开关。**关闭 = 段文本为空串 = 空段消失 = 零贡献** |
| `scope` | `core` | `core` / `full` |
| `register` | `general` | `general` / `academic` / `social` |

静态字段（改 `cordis.patch.yml`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `sectionOrder` | `2210` | 段落位置。夹在 think-guard(2200) 与 memory-vault(2300) 之间，避开撞序 |
| `language` | `both` | `both` / `zh` / `en`：注入哪一套套话表 |
| `guardFacts` | `true` | 事实护栏。**恒在**；关掉意味着允许模型为文风改动内容 |
| `extraBans` | `[]` | 自定义禁用词（构建时净化：≤20 条、每条 ≤60 字） |

## 机制

```
apply(ctx, config)
 ├─ ctx.inject(['settings'], …)          → settings.configure({auto:false})：本插件自带设置行
 └─ ctx.systemPrompt.section({           → 段名 deai-style:human-voice, order 2210
      name, order,
      text: () => enabledNow() ? buildStyle(...) : ""
    })
```

`text` 是**函数**，每次提示组装都会调用，`enabled`/`scope`/`register` 经 `.volatile()` 引用活读 → **改设置下一次回复即生效，不用重启**。

**不监听 `system-prompt/assemble`**：本插件只贡献自己的段，绝不改写宿主装配。冒烟测试以行为断言钉住这一点（不是查源码文本——注释里提到过事件名，那种断言会误报）。

## 验证

```powershell
cd F:\DSH-work\去ai化写作\dsh-deai-style
node test/smoke.mjs                                        # 31 项断言
node tools/measure.mjs test/fixtures/before.md test/fixtures/after.md
```

冒烟覆盖三道最容易悄悄坏掉的地方：关闭必须真的零贡献（空串）、两档边界、护栏在四种组合下恒在。另有回归断言钉住「首先…其次…」跨句号必须能被句式模式抓到（字面量匹配不上，曾因此漏检）。

`tools/measure.mjs` 量三个**代理指标**（突发度、套话密度、段长方差），套话表直接 import 自 `lib/index.js` —— 与插件注入的规则**同一个真源**，规则改了度量自动跟着改。

样本实测（`test/fixtures/`）：

| 指标 | before（AI 味） | after（人味） |
|---|---|---|
| 突发度（越高越好） | 0.167 | 0.858 |
| 套话密度 /千字（越低越好） | 38.63 | 0.00 |
| 段长标准差（越高越好） | 0.0 | 33.9 |

**这不是检测器判定**，只说明文风向哪边走。

### 装机后的三条验证（已执行）

从 profile 目录按包名导入，走的就是 Host 的解析路径：

```powershell
cd F:\DSH-Desktop\dsh-home\profiles\web
node --input-type=module -e "const m = await import('dsh-deai-style'); console.log(typeof m.apply, JSON.stringify(m.inject), new m.Config({}).sectionOrder)"
```

| 验证 | 结果 |
|---|---|
| `dsh --profile web --dump-config` | 退出码 0，输出含 `# == dsh-deai-style` 行与 resolve 后的 config |
| Host 模块经 profile junction 导入 | 导出 `apply` / `Config` / `inject`；`new Config({})` 得 `sectionOrder=2210`、`guardFacts=true` |
| volatile 字段形态 | `enabled`/`scope`/`register` 均为带 `.get()` 与 `cosmokit.volatile.write` 符号的**活引用**（正是 `readField` 处理的形态） |
| Client 产物 | 经同一个 junction 加载，向模块加载器注册 id `dsh-deai-style`，factory 为函数 |

**仍未验证（需要你的眼睛）**：设置页里那一行的**视觉呈现**。本会话没有浏览器控制，也没有 `cordis_inspect_query` 工具，所以「行长得对不对、开关点着顺不顺手」只能由你在页面上确认。

## 安装

bundle 目录：`F:\DSH-work\去ai化写作\dsh-deai-style\`

已装入 profile `web`，方式是（与同机其他本地插件家族一致）：

1. `dsh-deai-style\node_modules\@deepseek-ai\{cordis,dsh-system-prompt,schemastery}` → junction 到 `dsh-home\profiles\node_modules\@deepseek-ai\`（依赖解析）
2. `dsh-home\profiles\web\node_modules\dsh-deai-style` → junction 到本目录
3. `dsh-home\profiles\web\package.json` 的 `dsh.profile.bundles` 加入 `dsh-deai-style`

`package.json` 的备份是 `package.json.bak-before-dsh-deai-style`。

**踩过的坑：profile 的 package.json 不能被写入 BOM。** 首次安装用 PowerShell `Set-Content -Encoding UTF8` 重写该文件，它加了 UTF-8 BOM，于是 `JSON.parse` 失败、DSH 读不了自己的 profile（`dsh --dump-config` 报 `SyntaxError: Unexpected token ''`）。正确写法是无 BOM 编码：

```powershell
[System.IO.File]::WriteAllText($pkgPath, $text, (New-Object System.Text.UTF8Encoding($false)))
```

装完必须验「DSH 自己还能不能组合」，而不只是看清单里有没有那个名字：

```powershell
dsh --profile web --dump-config        # 退出码 0，且输出里出现 `# == dsh-deai-style` 行
```

**注意**：本目录位于工作区，而依赖是 junction 到工作区外的共享包。移动本目录会让依赖链接失效；那时重建那三个 junction 即可。

## 已知边界

- **提示词层有天花板**：模型对文风指令的遵守是概率性的，不保证每段达标。这正是 `tools/measure.mjs` 存在的理由——用数字看，而不是靠感觉。
- **token 成本**：开启时每轮 +core 约 600 字 / +full 约 1.5 KB；关闭 = 0。
- **套话表把禁用词也带进了上下文**，理论上会略微抬高它们的出现概率；用「Never write」措辞压制，实践中净效果仍是显著下降（见样本实测）。
- **路径含中文**：插件目录名 `去ai化写作` 含非 ASCII，Node ESM 与 junction 均正常（冒烟已在此路径下跑通）。

---

## 许可

[MIT](LICENSE)

> 本仓库不含 `node_modules`：依赖由 DSH profile 的扁平层解析。克隆后走设置页「导入插件…」选中本目录，或手动复制到 `<数据目录>/profiles/web/node_modules/`，再把包名加进该 profile `package.json` 的 `dsh.profile.bundles`。

