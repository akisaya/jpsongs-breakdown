# 日文歌歌词拆解

把一首日文歌做成**一整页可以照着学**的歌词精读页：逐句注音拆解、核心词汇表（可勾选掌握度）、语法图谱、难度档标注。
每首歌是一个自包含目录，产物是**单文件 HTML**——零依赖、双击即开、离线可用、手机上也能看。

根目录的 [`index.html`](./index.html) 是合集页：可搜索、按歌手筛选、自动分页的曲目卡片 + 汇总统计 + 各曲掌握进度。
合集页和 [`SONGS.md`](./SONGS.md) 都由各曲 `song.json` 自动生成。新增歌曲只需填写 `meta.catalog` 并运行 `npm run build`；默认按 `meta.catalog.order` 展示，未设置 order 的新歌会排到末尾。歌手数量、筛选选项、分页、规模统计和 SEO 描述会一起更新。
**合作曲 / feat. 曲要在 `meta.catalog.artists` 写 `['A', 'B']`**：统计与筛选按它拆分计到每位歌手头上，卡面上仍显示 `meta.artist` 的完整署名（如 `DAOKO × 米津玄師`）。只写 `meta.artist` 的话，这首只会算给署名串里的第一个人。
`artists` 里**只放真正演唱的人**：作词作曲、制作人、角色名都不写（`samfree feat. 巡音ルカ` → 只列 `巡音ルカ`；`千石撫子（CV: 花澤香菜）` → 只列 `花澤香菜`）。
**当前收录了哪几首、各自什么规模，见 [`SONGS.md`](./SONGS.md)。**

## 目录结构

```
.
├── README.md                           本文件：怎么加一首新歌
├── package.json                        全站构建入口
├── SONGS.md                            曲目清单（自动生成）
├── index.html                          合集索引页（自动生成）
├── scripts/build-site.js               song.json → 首页 + SONGS.md
├── scripts/optimize-covers.js          封面 → webp（首页缩略图、详情页内联图）
├── scripts/check-site.js               汇总过期、搜索筛选与响应式检查
├── site/index.template.html            首页模板与交互源码
├── <slug>/                             一首歌一个目录
│   ├── index.html                      构建产物（不要手改，重跑 build 会覆盖）
│   ├── covers/cover.jpg                官方封面原图（cover.js 生成，800px）
│   ├── covers/cover.webp               720px webp，详情页内联这张
│   ├── covers/thumb.webp               320px webp，合集页卡片用
│   ├── covers/thumb.jpg                320px jpg，不支持 webp 时兜底
│   └── <slug>.song.json                数据源，页面全部内容都在这里
└── .agents/skills/jp-song-study-page/  生成器技能
    ├── SKILL.md                        技能说明（给 Agent 看的工作流）
    ├── assets/                         模板 HTML / CSS / 渲染脚本
    ├── scripts/build.js                song.json → index.html，含字段校验
    ├── scripts/check.js                无头浏览器验收（交互 + 溢出 + 截图）
    ├── scripts/cover.js                检索并处理官方封面（iTunes → 800px 方图）
    ├── examples/                       骨架与完整范例
    └── references/                     字段字典、内容口径、坑表
```

`.workbuddy/skills/jp-song-study-page` 是指向该目录的相对软链——WorkBuddy 只扫 `.workbuddy/skills/`，靠它装载技能。

## 环境

- Node.js 18+
- `playwright-core` 只有跑 `check.js` 时才需要（约 14M，不入库）：

```bash
cd .agents/skills/jp-song-study-page && npm i
```

不装也能用，`check.js` 会自动降级为静态检查。

## 图片与加载

每首歌的封面有四个文件，各管一段：

| 文件 | 规格 | 谁在用 |
|---|---|---|
| `covers/cover.jpg` | 800×800（`cover.js` 抓来的原图） | 原始素材，换图从这里改 |
| `covers/cover.webp` | 720×720 q80 | 详情页 `build.js` 内联成 base64（显示最大 368px） |
| `covers/thumb.webp` | 320×320 q78 | 首页卡片（显示 128px / 窄屏 98px） |
| `covers/thumb.jpg` | 320×320 | 首页卡片兜底，浏览器不支持 webp 时用 |

`npm run build` 会先跑 `scripts/optimize-covers.js` 补齐缺失或过期的 webp，再生成首页。手工加图后单独跑 `npm run build:covers`（`--force` 强制重编码）。

首页的两处提速，改模板时不要弄丢：

- **首屏 4 张 preload**：卡片是 JS 注入的，不预载的话图片请求得等 HTML 下载 + 解析 + 执行完才发出，在慢网络上等于白白多一个 RTT。链接由 `build-site.js` 生成，写在 `<head>` 里。
- **`<picture>` + `display:contents`**：webp 优先、jpg 兜底。`.cov--img picture{display:contents}` 让 `<picture>` 不生成盒子，`<img>` 的百分比尺寸才能正常解析到 `.cov` 上。

## 加一首新歌

### 方式一：让 Agent 做（推荐）

用支持技能的客户端（WorkBuddy 等）把本仓库作为工作目录打开，说一句：

> 做一首《Butterfly》的学习页

技能会自己走完：判断值不值得做 → 交叉核对歌词 → 切段落 → 抽卡 → 词表 → 语法 → 填写首页 `meta.catalog` → 构建 → 验收 → 运行站点汇总。
默认收录完整歌词，无需额外确认。歌名、歌手和出处对得上后，按默认位置或你指定的目录输出；只有明确说「不要完整歌词」时才省略。

### 方式二：手动

```bash
SKILL=.agents/skills/jp-song-study-page
SLUG=butterfly

mkdir -p $SLUG
cp $SKILL/examples/_skeleton.song.json $SLUG/$SLUG.song.json   # 6 卡 / 20 词的骨架

# 先填 meta，再填 lines / vocab / grammar
node $SKILL/scripts/cover.js $SLUG/$SLUG.song.json              # 官方封面 → covers/cover.jpg + webp，并写回 meta.cover
node $SKILL/scripts/build.js --check --strict-lines $SLUG/$SLUG.song.json
node $SKILL/scripts/build.js --strict-lines $SLUG/$SLUG.song.json $SLUG/index.html
node $SKILL/scripts/check.js $SLUG/index.html --shots          # 交互 + 四档断点溢出 + 截图
npm run build                                                   # 首页 + SONGS.md
```

产物是 `$SLUG/index.html`，截图在 `preview/`（已 gitignore，看完可删）。

## song.json 怎么写

一份 song.json 就是一个页面。**六个默认必填**：`meta` / `sec` / `lyrics` / `lines` / `vocab` / `grammar`；
完整歌词默认收录；正文固定结束于语法图谱，每条语法附 2–3 个注音例句和中文译文。

`lines` 是逐句精读：每张卡的 `jp` 必须是 `lyrics.blocks[].lines` 中的一条完整原文，
去掉注音、忽略空白后要完全一致。不能把词、半句或跨行拼接当作逐句卡；`--strict-lines` 会拦截这类错误。
精读卡数量按歌曲难度和有教学价值的不同歌词行调整，复杂歌曲应多选值得讲解的句子；每卡结合句子解释结构与语感，避免凑数和重复。

默认缺少完整歌词会构建失败。只有用户明确要求不要全文时，才写 `"modules": {"lyrics": false}`。

| 想查什么 | 看哪里 |
|---|---|
| 每个字段长什么样、有哪些默认值 | [references/song-schema.md](./.agents/skills/jp-song-study-page/references/song-schema.md) |
| 选句标准、词汇分级、语法例句、文案要求 | [references/editorial-guide.md](./.agents/skills/jp-song-study-page/references/editorial-guide.md) |
| 最小可跑骨架 | [examples/_skeleton.song.json](./.agents/skills/jp-song-study-page/examples/_skeleton.song.json) |
| 完整范例（22 卡 / 61 词 / 16 语法） | [examples/brave-heart.song.json](./.agents/skills/jp-song-study-page/examples/brave-heart.song.json) |

两条最容易踩的规则：

- **`meta.slug` 全站唯一**。页面用它给 localStorage 加前缀（`jss.<slug>.mastery`），重复了掌握度会串歌。
- **目录名和 slug 可以是两个东西**（比如目录 `again/`、slug `again-yui`）。站点构建器始终使用 `meta.slug`，合集页进度条因此会和单曲页共用同一个 localStorage 命名空间。

## 收尾：生成站点汇总

在 `song.json` 的 `meta` 中加入合集卡片信息：

```json
"catalog": {
  "order": 43,
  "work": "Digimon",
  "source": "数码宝贝 · OP · 1999",
  "tone": "teal",
  "description": "两句话说明这首为什么值得逐句拆开听。",
  "title": ["butterfly"],
  "documentTitle": "butterfly",
  "artists": ["和田光司"]
}
```

其中 `work`、`source`、`tone`、`description` 必填；`title`、`documentTitle`、`kicker`、`artists` 只在需要覆盖默认展示时填写。`order` 控制合集顺序，不写时会排在现有曲目之后。卡片链接、封面、歌手、年份、难度和各项数量都由构建器自动推导。

修改后运行：

```bash
npm run build
npm run check
```

`npm run build` 会重新生成根 `index.html` 和 `SONGS.md`；`npm run check` 会在生成物过期时失败。`npm run check:browser` 还会用无头 Chrome 检查搜索、歌手筛选、分页和 390/768/1024/1440 四档横向溢出。不要手改这两个生成文件。

仓库使用 GitHub Pages 的「Deploy from a branch」模式（`main` / 根目录），推送后会直接发布已提交的静态文件。仓库不配置站点检查 CI，也不会自动运行 `npm run build`；新增或修改歌曲时必须由 Agent 在本地生成、校验并提交 `index.html` 与 `SONGS.md`。

## 验收

`--strict-lines` 会先检查每张逐句卡都对应完整歌词行、没有重复卡，并核对「逐句精读」相关文案。`check.js` 会自动检查：板块数与导航项一致、章节编号连续、数据条数值非 0、假名与中文显示切换、掌握度、
每条语法的例句数量与展开显示、正文结束位置、390/768/1024/1440 四档无横向溢出。

人工只需要看两点：`preview/` 截图里的**注音有没有串行**、**长句有没有在小屏被拆断**。

模板不要求判断曲式或填写时间轴。完整歌词按来源的换行与空行写入 `lyrics.blocks[].lines`，页面自动显示「段落 01 / 02…」；精读卡不需要段落分类，默认全部展示。

## 常见问题

**`✗ 站点汇总校验未通过`**
按提示补齐对应 `meta.catalog` 字段，再运行 `npm run build`。

**`✗ 模板里有数据没提供的占位符：{{sec.xxx.*}}`**
按提示的 key 补齐字段。完整歌词默认必填；只有明确要求省略全文时，才设置 `"modules": {"lyrics": false}`。

**`check.js` 报找不到 playwright-core**
到 `.agents/skills/jp-song-study-page` 下 `npm i`。

**页面顶栏「‹ 合集」点了没反应**
`meta.backHref` 默认指向 `../index.html`；歌不在 `<slug>/index.html` 这层时，显式写相对路径，或写 `""` 关掉。

**合集页上看不到新歌 / 没有进度条**
新歌必须先填写 `meta.catalog` 并运行 `npm run build`；进度条要求 `meta.slug` 与单曲页一致。

**WorkBuddy 里看不到这个技能**
软链断了。`ls -l .workbuddy/skills/` 若显示红字，重建：

```bash
ln -s ../../.agents/skills/jp-song-study-page .workbuddy/skills/jp-song-study-page
```

**手机/平板上点词朗读没声音**
用的是浏览器 `speechSynthesis`，需要系统装有日语语音包（iOS 要在「设置 → 辅助功能 → 朗读内容」里先下载日语）。

## 版权

页面是个人日语学习用途的歌词解析作品。收录完整歌词时，`footer.note` 要写全作词 / 作曲 / 演唱，
并注明「仅供学习参考，请勿用于商业用途」。

封面由 `scripts/cover.js` 从 iTunes 自动取官方图。个人学习项目直接用即可；这个仓库挂着 Pages，公开托管属于再分发，
介意的话把 `meta.cover` 清空、删掉 `covers/`，页面会自动回到排版式封面。
