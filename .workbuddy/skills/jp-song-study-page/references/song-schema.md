# song.json 字段字典

一份 `song.json` 就是一个页面。顶层 15 个键，除 `meta` / `sec` / `lines` / `vocab` / `grammar` / `quiz` 外都有默认值。

```bash
node scripts/build.js --check song.json   # 改的时候反复跑这个
```

## 骨架

```json
{
  "extends": "另一份.json",   // 可选：继承母版，只写差异
  "modules": { "quiz": false, "plan": false },  // 可选：关掉某些板块

  "meta":   { ... },          // 必填
  "stats":  [ 3–4 项 ],       // 顶部数据条
  "cta":    { ... },          // 两个按钮
  "nav":    [ 8 项 ],         // 章节导航
  "segments": [ 4 项 ],       // 段落（筛选按钮 + 卡片配色）
  "map":    { ... },          // 学习地图
  "steps":  [ 3 项 ],
  "sec":    { map, lines, vocab, grammar, listen, studio, quiz, plan },  // 必填
  "lines":  [ 卡片 ],          // 必填
  "vocab":  [ 词 ],            // 必填
  "grammar":[ 语法 ],          // 必填
  "listen": [ 6 张卡 ],        // 可选（modules.listen）
  "studio": { "placeholder": "..." },
  "quiz":   [ 题 ],            // 可选（modules.quiz）
  "plan":   { "days": [...], "note": "..." },  // 可选（modules.plan）
  "footer": { "title", "note", "meta": [3 行] }
}
```

## modules（可选）

控制 8 个板块的开关。**核心四块 `map / lines / vocab / grammar` 不能关**（build 会报错）。

```json
"modules": { "listen": false, "studio": false, "quiz": false, "plan": false }
```

`build.js` 在生成阶段就把对应 `<section>` 从 HTML 里裁掉；导航项、章节编号、顶部数据条项数会自动跟随，不需要改模板。

## extends（可选）

```json
{ "extends": "brave-heart.song.json", "modules": { "quiz": false } }
```

- 路径**相对于当前文件**，最多 5 层。
- 合并规则：对象递归合并，**数组整体替换**（所以要改 `stats` 就得写全数组）。
- 典型用法：母版写全量内容，lite 版只写 `modules` / `stats` / `cta` / `steps` 的差异。

---

## meta（必填）

| 字段 | 说明 |
|---|---|
| `slug` | **必须每首歌不同**。用于 localStorage 命名空间，重复会导致掌握度串歌。小写短横线，如 `brave-heart` |
| `pageTitle` | `<title>` 全文 |
| `description` | meta description，120 字内 |
| `kicker` | 标题上方那行小字，格式「作品名 · Insert Song · 年份」 |
| `titleLine1` / `titleLine2` | 大标题拆两行。只有一行时 `titleLine2` 给 `""` |
| `artist` | 演唱者 |
| `subtitle` | 通常 `歌詞精読` |
| `level` | `N3` 这类等级标 |
| `lead` | **允许 HTML**。首屏导语，一到两句，说清"为什么拿这首入门" |
| `badges` | 4 个徽章。**第一个**会渲染成等级色（橙色），其余是圆点样式 |
| `discLabel` / `discSub` | CD 中心的字，通常年份 + `single`；同时作为排版封面的年份 |
| `cover` | 首屏封面，三种写法见下。**不填 = 排版式封面** |
| `coverTag` | 排版封面左上角的小字，默认 `Single` |
| `coverAlt` | 图片封面的 alt，不填则用「歌名 封面」 |

### 封面（meta.cover）

首屏默认渲染一张**排版式封面**（纯 CSS + 文字，无图片文件）：深青底、数码网格、歌名用衬线斜体，顶部 `SINGLE / 年份`，底部 `歌詞精読 / N3`。信息全部来自 `meta`，换歌自动变。

| 写法 | 效果 |
|---|---|
| 不填 | 排版式封面（推荐，零文件、零版权风险） |
| `"disc"` | 回到旧版的 CD 唱片图形 |
| `"covers/xxx.jpg"` | 图片封面。相对路径**相对于该 song.json**，build 时自动转 base64 内联，产物仍是单文件 |
| `"https://..."` | 外链图片（不内联，页面需要联网） |

图片建议：正方形，≥600×600，压到 300KB 以内（超过 600KB 会告警）。`build.js` 会自动识别 jpg / png / webp / gif / svg，并读取实际像素尺寸，两种情况会给出提醒：

- **不是正方形**（宽高比偏离 1 超过 6%）——页面按方形 `object-fit: cover` 裁切，会切掉长边两侧，提醒你确认主体居中；
- **短边 < 600px**——页面上会放大到约 378px 显示，清晰度不够。

用官方原封面时注意两点：图片需**自己持有**（购买的数字专辑、CD 扫描、自己的截图），不要直接把网上转载图打进页面；页面底部 `footer.note` 的版权句要保留。

## stats

3–4 项，`label` 是文案，数字由脚本按 `key` 自动填。项数会决定数据条的列数。

```json
"stats": [
  {"key":"lines","label":"精 读 句 数"},
  {"key":"vocab","label":"核 心 词 汇"},
  {"key":"grammar","label":"语 法 点"},
  {"key":"quiz","label":"填 空 练 习","module":"quiz"}
]
```

- `key` 只能是 `lines / vocab / grammar / quiz`（脚本里有对应取数逻辑）。
- `module` 可选：写了就跟随该板块开关，板块关掉时这一项自动不显示。所以**关掉 quiz 时不用手工删掉第 4 项**。
- 项数可以是 1–4 任意值；窄屏 2 列，奇数个时最后一项自动跨两列。

## cta

```json
"cta": { "primary": "开始逐句精读", "secondary": "先看语法图谱", "secondaryHref": "#grammar" }
```

`secondaryHref` 必须指向页面上真实存在的锚点。**关掉 studio 后不能再写 `#studio`**（build 不校验这个，但点了会没反应）。

## segments

```json
"segments": [
  {"key":"a","label":"Aメロ"},
  {"key":"b","label":"Bメロ"},
  {"key":"s","label":"サビ"},
  {"key":"c","label":"大サビ"}
]
```

- `key` 只用 `a / b / s / c`——卡片左侧竖条和结构图色块的颜色是按 key 写死在 CSS 里的（青 / 橙 / 玫红 / 蓝）。
- 段落少于 4 个就删掉多余项，不要改 key 名。
- `lines[].sec` 必须是这里的某个 key。

## map

> 章节本身的编号/标题/日文小标/导语统一放在 `sec.map` 里，**不要**在 `map` 里再写一遍。

| 字段 | 说明 |
|---|---|
| `whyTitle` / `whySub` | 左卡标题与副标 |
| `why` | 4 条 `{t, d}`，说明"为什么适合 N3" |
| `structTitle` / `structHint` | 右卡标题与提示 |
| `blocks` | 结构图色块，见下 |
| `legend` | 图例，4 项 `{tone, label}`，tone 取 `a/b/s/c` |
| `tip` | **允许 HTML**。结构图下方的"记位置技巧" |

`blocks[]`：

```json
{"label":"Aメロ①","role":"铺陈","time":"0:32","key":"a","tone":"a","weight":28}
```

- `weight` = 该段秒数，决定色块宽度比例（不用精确，相对值对就行）。
- `time` 显示在色块底部。
- `role` 是功能词，2–4 字：铺陈 / 推进 / 爆发 / 转折 / 加速 / 重复 / 收束。

## steps

```json
"steps": [{"k":"STEP 01","t":"先听，别查词","d":"..."}]
```

固定 3 条：听 → 读 → 测。

## sec（必填）

8 个章节的标题区，字段统一 `num / title / jp / lead`：

```
sec.map / sec.lines / sec.vocab / sec.grammar / sec.listen / sec.studio / sec.quiz / sec.plan
```

`num` 从 `01` 顺排到 `08`。`jp` 用平假名写章节名的读法，全角空格分词。

## lines（必填，16–24 张）

| 字段 | 说明 |
|---|---|
| `sec` | 段落 key |
| `jp` | 原文 + `漢字[かな]` 注音 |
| `tr` | 中文 |
| `words` | `[[汉字, 假名, 中文], ...]`，2–4 组 |
| `g` | **允许 HTML**（`<b>` 包句型）。语法说明 |
| `n` | 语感 / 唱法备注，纯文本。**不要重复 g** |

注音只标汉字，假名和助词不标。括号必须是半角 `[ ]`。

## vocab（必填，50–70）

```json
{"k":"逃げる","r":"にげる","p":"動I","cn":"逃跑；逃避","lv":"N4"}
```

- `p` 词性：`名 / 動I / 動II / 動III / 形I / 形II / 副 / 代 / 名/形II`。
- `lv` 只能是 `N1`–`N5`，给保守值。
- **`k` 同时是歌词标注器的匹配键**。标注器会额外匹配动词/形容词词干（`逃げる→逃げ`、`冷たい→冷た`），所以 k 必须写辞书形，不要写歌词里的活用形。

## grammar（必填，12–16）

```json
{"p":"〜にしか〜ない","sub":"唯一限定","form":"名詞 ＋ にしか ＋ 否定形",
 "mean":"只有…才…","eg":"君にしかできないコトがある","warn":"..."}
```

`eg` 放歌里的原句（不带注音），`warn` 写易错点。

## listen（可选，`modules.listen`）

6 张卡：`{"tag":"長音","t":"标题","d":"说明","ex":"例子"}`。`ex` **允许 HTML**（高亮用 `<span class="hl-o">` / `<span class="hl-t">`）。

## quiz（可选，`modules.quiz`，8–12）

```json
{"q":"一瞬あ【】ば できるから","opts":["れ","る","り","ら"],"a":"れ","why":"..."}
```

- `q` 里**必须有且只有一个 `【】`**，渲染成下划线空格。
- `a` 必须是 `opts` 里的某一项（字符串完全相等）。
- 选项 4 个。运行时自动打乱，作者侧仍要打散正确答案的位置。

## plan（可选，`modules.plan`）

```json
"plan": {
  "days": [{"d":"Day 1","t":"拆结构，别查词","p":"...","m":"20 分钟"}],
  "note": "七天之后..."
}
```

7 天。`m` 是时长文案。

## footer

```json
"footer": {
  "title": "brave heart",
  "note": "版权句，见 SKILL.md",
  "meta": ["DIGIMON ADVENTURE", "歌詞精読ノート", "JLPT N3"]
}
```

`meta` 是数组，渲染成右对齐的三行。

---

## 渲染约定（改 render.js 时看）

- `{{a.b.c}}` 由 build.js 用点路径取值；数组值默认 `join('<br>')`；缺字段直接构建失败。
- 富文本字段（`meta.lead`、`map.tip`、`lines[].g`、`lines[].n`、`listen[].ex`）**原样插入**，不转义——作者要自己保证只有安全标签。
- 其余字段一律 `escapeHtml`。
- 卡片与词的渲染顺序完全按数组顺序，不做排序。
