# 给导语挂 B 站视频链接（MV / 现场 / 完整版）

链接写在 `meta.lead` 末尾，模板直接当 HTML 渲染，所以只认这一种写法：

```html
<a href="https://www.bilibili.com/video/BVxxxxxxxxxx/" target="_blank" rel="noopener noreferrer">B站 MV ↗</a>
```

**不要手工试 BV 号**——同名不同曲、翻唱、谱例、AMV 混在一起，凭印象填十有八九是错的。
用 `scripts/mv.js`，它搜完会打分并把候选打出来。

## 跑一条命令

```bash
SKILL=.agents/skills/jp-song-study-page

# 只看候选，不写盘（默认行为）
node $SKILL/scripts/mv.js <slug>/<slug>.song.json

# 确认后写入 meta.lead，再重新 build
node $SKILL/scripts/mv.js <slug>/<slug>.song.json --write
node $SKILL/scripts/build.js --strict-lines <slug>/<slug>.song.json <slug>/index.html
```

| 参数 | 作用 |
|---|---|
| `--write` | 把选中那条写进 `meta.lead`；不加则只打印 |
| `--pick BV1xxx` | 指定 BV 号（仍会调接口校验存在性、打印标题时长） |
| `--query "歌名 作者"` | 覆盖检索词，默认取 `meta.titleLine1/2 + meta.artist` |
| `--order totalrank\|click\|pubdate\|dm` | 排序方式，默认综合排序 `totalrank`；候选太杂时试 `click` |
| `--limit N` | 打印前 N 条，默认 8 |
| `--pages N` | 翻几页（1–3，默认 2）。官方那条常掉到第 2 页 |

## 它怎么选

1. 用「歌名 + 作者」调 B 站 `search/type`，取 2 页共 40 条，按综合排序编号。
2. **过滤**：标题必须含歌名（主标题 / 副标题 / 拼起来 / `meta.aliases` 任一），且含作者或 UP 名是作者本人。
3. **淘汰**：命中 `tab / 谱 / 指弹 / 伴奏 / カラオケ / KTV / 翻唱 / cover / 教学 / MMD / 8D / remix / acoustic / 弾き語り / arrange` 等。
4. **打分**：对上歌名 +8、对上作者 +5、UP 是作者本人 +6、厂牌号 +2、官方/主题曲 +3、MV +2；播放量取对数最多 +4；时长 <2:10 扣 7（切片）；排名越靠前微加分。
5. 取得分最高的一条，写进 `meta.lead`（已有链接就替换，没有就追加在末尾）。

**为什么不能直接取第 1 条**（实测）：

| 检索词 | 综合排序第 1 条 | 实际是 |
|---|---|---|
| `again YUI` | 《Again》-王极 | 中文歌，跟 YUI 无关 |
| `brave heart 宮崎歩` | 【NERDHEAD×西野加奈】BRAVE HEART | 另一首歌 |
| `残酷な天使 高橋洋子` | 【中森明菜】残酷な天使のテーゼ | 翻唱 |
| `Lemon 米津玄師` | 百万豪装录音棚试听 | 试听，不是 MV |
| `THERE IS A REASON 鈴木このみ` | 鈴木木乃美 - Love is MY RAIL | 另一首歌 |

所以「排名最靠前」要理解成 **过滤之后最靠前的那条**，不是原始第 1 条。

## 挑不出来的情况

| 现象 | 原因 | 怎么解 |
|---|---|---|
| `0 条通过校验` | 歌名单字（如「恋」）或作者是中文昵称（`鈴木このみ` 常写作「铃木木乃美」） | 加 `--query "歌名 歌手"`，或在 `meta.aliases` 里补写法 |
| 命中的是另一首歌 | 标题里有同名词 | `meta.aliases` 加区分词（如 `螺旋 RASEN`），或直接 `--pick` |
| 官方那条没出现 | B 站排序每次都在变 | `--pages 3` 或 `--order click` 再跑一次 |
| `code=-412` / 风控 | cookie 失效 | 删掉 `$TMPDIR/jp-song-mv-cookie.json` 重跑；脚本每次自动取 `buvid3`，缓存 6 小时 |
| 选中的是现场版 | 没有官方 MV，只剩 Live | 可接受；若坚持录音室版，`--pick` 指到「录音棚 / Hi-Res」那条 |

## `meta.aliases`（可选字段）

给检索用的别名数组，不影响页面渲染，也不参与构建校验。适合补：中文译名、罗马字、繁体/简体差异、常见误写。

```json
"meta": {
  "artist": "鈴木このみ",
  "aliases": ["铃木木乃美", "THERE IS A REASON", "NGNL0"]
}
```

脚本自带常见异体字归一（`宮/宫`、`歩/步`、`師/师`、`澤/泽`、`龍/龙` 等），
所以 `宫崎步` 能匹配上 `宮崎歩`；但**中文昵称**（铃木木乃美）和**英文缩写**（NGNL0）归一不了，得靠 aliases。

## 选片的质量判据

脚本只能排除明显不对的，最后还得看一眼：

- **播放量**：几百到几千的基本是搬运、切片或 AMV；十万以上通常没大问题。
- **时长**：明显短于原曲 → 剪辑；明显长很多 → 带解说或合集。
- **UP 名**：作者本人号（`星野源`、`宇多田光`、`9Lana_official`）、厂牌号（`索尼音乐中国`、`JVC_Music`）、
  平台音乐号（`大家的音乐机`）优先；个人搬运次之。
- **标题关键词**：`官方 MV / Official Video / 主題歌` 可信；`MAD / AMV / 纯享 / 试听 / 4K修复` 是二创或重制。

## 验收

```bash
# 页面上确实只有一条视频链接，且 href 正确
grep -o 'bilibili.com/video/BV[a-zA-Z0-9]*' <slug>/<slug>.song.json
```

改完记得 `build.js` 重建，导语里的链接在首屏，`check.js` 的截图能直接看到。
