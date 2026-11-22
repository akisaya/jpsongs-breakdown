---
name: jp-song-study-page
description: 把一首日文歌做成单文件、可离线打开的歌词精读页：逐句注音拆解、核心词汇表（可勾选掌握度）、语法图谱、难度档标注；可选完整歌词、听说训练、歌词粘贴标注器、填空测验、七天计划。内容写进一份 song.json，用自带脚本按「模板 + 数据」编译成 HTML，换歌只需换数据。
agent_created: true
---

# 日语歌词精读页 · 模板化流水线

**换歌 = 换一份 song.json**。页面、样式、交互、校验脚本都不动，产物是单文件 HTML，零依赖、双击即开、离线可用。

| 要什么 | 看哪里 |
|---|---|
| 字段怎么写 | `references/song-schema.md` |
| 内容怎么选、怎么写 | `references/editorial-guide.md` |
| 模板侧的坑 | `references/pitfalls.md` |
| 完整范例（22 卡 / 61 词 / 16 语法 / 12 题） | `examples/brave-heart.song.json`——**只看结构，别当起点** |
| 起步骨架（6 卡 / 20 词，8 板块齐全） | `examples/_skeleton.song.json` |

## 用户一句话进来，默认这么接

用户通常只会说一句「做一首《Butterfly》的学习页」。这句话要能直接开工，所以下面这些值有明确默认，**不要反问一堆**：

| 项目 | 默认 | 用户怎么说会改 |
|---|---|---|
| 板块 | **4 块**：map / lines / vocab / grammar | 「要测验」「要七天计划」→ 写对应板块的数据；要关掉某块才写 `modules.* = false` |
| 难度 | 页面标「N3 上下」这类**大致档位**，不写成 JLPT 等级判定 | 「N4」「N2」→ 调 `vocab[].lv` 分布与语法条难度，同时改 `meta.level` |
| 输出 | **当前工作目录**下的 `<slug>/{index.html,<slug>.song.json}` | 给了路径就用给的；同名文件存在时先问 |
| 配色 | 奶油纸底 + 橙/青 | 「换个蓝色系」→ 改 `assets/base.css` 顶部的 `--orange` / `--teal` |
| 封面 | **排版式封面**（纯 CSS，随歌名自动生成） | 「用我的封面图」→ 图片路径写进 `meta.cover`，build 自动内联 |
| 卡片量 | 16–24 张 | 「做细一点」→ 24+；「一页就够」→ 12 左右 |

**必须先确认的三种情况**（其余都自己判断）：

1. 歌名有重名（同名不同曲），或演唱者/出处对不上。
2. 找不到权威歌词来源，或两个来源差异大到影响讲解。
3. 这首歌明显不适合（饶舌、方言、通篇拟声词）——直接说"这首做不出教学价值"，并给替代建议。

**做完要主动报**：用了哪些板块、共几张卡/几个词/几条语法、文件路径、有没有收录完整歌词，以及**当前目录若有合集页（`index.html` 里的 `SONGS` 数组），有没有同步追加这条新歌**。

## 30 秒上手

```bash
SKILL=.agents/skills/jp-song-study-page

# 1. 从骨架起步
cp $SKILL/examples/_skeleton.song.json <slug>/<slug>.song.json

# 2. 只校验，不产出（改 JSON 时反复跑）
node $SKILL/scripts/build.js --check <slug>/<slug>.song.json

# 3. 出页面
node $SKILL/scripts/build.js <slug>/<slug>.song.json <slug>/index.html

# 4. 验收（无头 Chrome：交互 + 多断点溢出 + 截图）
node $SKILL/scripts/check.js <slug>/index.html --shots
```

`check.js` 依赖 `playwright-core`：`node_modules` 不入库，**首次使用先在技能目录 `npm i`**。
缺依赖时会自动降级为静态检查并提示。

### 目录约定

一首歌一个目录，数据源自包含：

```
<songs-root>/
├── index.html                 ← 合集索引页（可选）
├── brave-heart/
│   ├── index.html             ← 构建产物
│   └── brave-heart.song.json  ← 数据源
└── again/
    ├── index.html
    └── again.song.json
```

**有合集页时，新歌出页后还要多做一步**：在根 `index.html` 的 `SONGS` 数组里追加一条
（slug / href / kicker / work / title / artist / year / level / tone / desc / scale），否则新歌不会出现在合集页上。
`slug` 必须与 `meta.slug` 一字不差（合集页靠它读 `jss.<slug>.mastery`）；`href` 要写全 `./<slug>/index.html`。
`tone` 取 `teal` 或 `rust`，同色系别连排。没有合集页就跳过，并在 `meta.backHref` 写 `""` 关掉顶栏「‹ 合集」。

## 板块开关

页面共 9 个板块：核心四块 `map` / `lines` / `vocab` / `grammar` 永远保留，
另外五块 `lyrics` / `listen` / `studio` / `quiz` / `plan` 可选。

`lyrics` 是唯一**可以不写数据**的（没写就自动裁掉，不留空板块）；其余四块一旦开着就必须有数据，
缺数据会被校验拦下。要关掉某块，在 `modules` 里写 `false`，并把 `song.json` 里对应数据一并删掉。
完整规则与 `extends` 继承见 `references/song-schema.md`。

## 流程（顺序不要跳）

| # | 做什么 | 细节在哪 |
|---|---|---|
| 0 | **判断值不值得做**：适合中低速、咬字清晰、副歌有重复句式；饶舌、大量方言古语、满篇拟声词做不出教学 | editorial「选句」开头 |
| 1 | **核歌词（只核，不抄）**：至少两个来源交叉核对；记下作词 / 作曲编曲 / 演唱 / 年份出处；核完不要留在笔记或中间稿里。要不要进页面，由 `lyrics` 板块单独决定 | — |
| 2 | **切段落**：听 2–3 遍标 Aメロ / Bメロ / サビ 的时间点，每段给一个功能词，写进 `segments` 与 `map.blocks` | schema「segments」「map」 |
| 3 | **抽卡** 16–24 张：一句一个语法点，优先挑语法挤在一起的句子 | editorial「选句」「卡片」 |
| 4 | **词表** 50–70：按歌词出现顺序排，`lv` 给保守值 | editorial「词表」 |
| 5 | **语法** 12–16：`form` 写完整接续，`warn` 写会错在哪 | editorial「语法条」 |
| 6 | **测验** 8–12 题：唯一解优先 | editorial「出题」（关掉 quiz 就整段跳过） |
| 7 | **写文案**：`map.why` 四条理由、`steps` 三步，每首重写；页面上没有的板块不要提 | editorial「文案」 |
| 8 | **构建 + 验收** | 命令见上、清单见下 |

口径不要在这里猜：内容标准全在 `references/editorial-guide.md`，字段全在 `references/song-schema.md`。

## 验收（必须全绿）

- [ ] 静态：无未替换占位符、关键容器齐全
- [ ] **板块数与 `modules` 配置一致，章节编号连续（01…0N），导航项数 == 板块数**
- [ ] 控制台无错误
- [ ] 顶部数据条项数正确、数值非 0
- [ ] 段落筛选能筛出子集
- [ ] 掌握度点击后进度变化
- [ ] 答题后正确项高亮 + 解析出现（仅当开了 quiz）
- [ ] 粘贴歌词能标注出词（仅当开了 studio）
- [ ] 计划勾选生效（仅当开了 plan）
- [ ] 390 / 768 / 1024 / 1440 四个宽度无横向溢出

再人工扫一遍 `preview/` 里的截图：重点看**注音有没有串行**、**长句有没有在小屏把词拆断**。

## 版权底线

- **默认不主动加**完整歌词；用户明确要，才做 `lyrics` 板块。
- 加了就在 `footer.note` 写全作词 / 作曲 / 演唱，并注明「仅供学习参考，请勿用于商业用途」，
  句式模板见 `editorial-guide.md` 的版权一节。
- 页面要挂公开域名（GitHub Pages、个人站）时**先提醒用户**：公开传播和个人本地学习不是一回事，选择权交给用户。
- 封面**不要主动去图站抓官方图**；用户自己提供才用，并内联进页面。

## 改模板时

只改 `assets/base.css`（样式）与 `assets/render.js`（交互），**不要在生成的 index.html 上改**，下次 build 会覆盖。
媒体查询顺序、内联 `flex-grow`、`1fr` 隐式最小宽这类模板侧的坑见 `references/pitfalls.md`。

## 维护

本技能是项目级，真实文件在仓库根 `.agents/skills/jp-song-study-page/`；WorkBuddy 只扫 `.workbuddy/skills/`，
靠相对软链 `.workbuddy/skills/jp-song-study-page → ../../.agents/skills/jp-song-study-page` 接入
（断链会被静默跳过、不报错）。换到别的项目复用：整目录复制过去，再重建同样的软链。

```
assets/template.html   页面骨架，{{占位符}} 由 build 填充
assets/base.css        全部样式（改配色只动这里）
assets/render.js       渲染逻辑（改交互只动这里）
scripts/build.js       JSON → HTML，含字段校验
scripts/check.js       无头浏览器验收
```
