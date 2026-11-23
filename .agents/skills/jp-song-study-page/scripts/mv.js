#!/usr/bin/env node
/**
 * 给 song.json 的导语挂一条 B 站视频链接（MV / 现场 / 完整版）。
 *
 *   node scripts/mv.js <song.json>                        # 只检索列候选，不写盘
 *   node scripts/mv.js <song.json> --write                # 取得分最高的一条写进 meta.lead
 *   node scripts/mv.js <song.json> --write --pick BV1xxx  # 指定 BV 号（仍会校验存在性）
 *   node scripts/mv.js <song.json> --query "螺旋 9Lana"    # 覆盖检索词
 *   node scripts/mv.js <song.json> --order click          # 排序：totalrank(默认)/click/pubdate/dm
 *   node scripts/mv.js <song.json> --limit 12 --pages 3   # 多列几条、多翻几页
 *
 * 流程：B 站搜索「歌名 + 作者」→ 按综合排序取前 20 条 →
 *       用「标题含歌名 / 含作者或 UP 名」过滤掉同名不同曲、翻唱、谱例、伴奏 →
 *       打分（官方 MV、播放量、时长、排名）→ 取最高分 → 写 meta.lead 里的链接。
 *
 * 为什么要过滤：综合排序第 1 条经常不是这首歌。实测 `again YUI` 第一条是王极的《Again》，
 * `brave heart 宮崎歩` 第一条是 NERDHEAD×西野カナ的另一首《BRAVE HEART》。
 *
 * 依赖：Node 18+（内置 fetch）。无需登录，脚本自己取 buvid3 并缓存 6 小时。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ---------- 参数 ---------- */

const args = process.argv.slice(2);
const flag = name => args.includes('--' + name);

let file = null;
let query = null;
let pick = null;
let limit = 8;
let order = 'totalrank';
let pages = 2;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--query') { query = args[++i]; continue; }
  if (a === '--pick') { pick = args[++i]; continue; }
  if (a === '--limit') { limit = Number(args[++i]) || 8; continue; }
  if (a === '--order') { order = args[++i] || 'totalrank'; continue; }
  if (a === '--pages') { pages = Math.min(3, Math.max(1, Number(args[++i]) || 2)); continue; }
  if (a.startsWith('--')) continue;
  if (!file) file = a;
}

const WRITE = flag('write');

if (!file) {
  console.error('用法：node scripts/mv.js <song.json> [--write] [--pick BV1xxx] [--query "歌名 作者"] [--order click] [--limit 8] [--pages 2]');
  process.exit(1);
}

/* ---------- 文本归一化 ---------- */

function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[!-/:-@[-`{-~、。・「」『』（）()【】\[\]…—–―~〜]/g, '');
}

/* 旧字体／异体字归一：B 站标题常写简体「宫崎步」，song.json 里是「宮崎歩」 */
const VARIANTS = {
  宮: '宫', 歩: '步', 髙: '高', 澤: '泽', 邊: '边', 邉: '边', 濱: '滨', 島: '岛',
  黒: '黑', 樹: '树', 藝: '艺', 龍: '龙', 竜: '龙', 劍: '剑', 會: '会', 師: '师',
  實: '实', 間: '间', 醫: '医', 寫: '写', 樂: '乐', 樣: '样', 應: '应', 場: '场',
  遊: '游', 氣: '气', 廣: '广', 鐵: '铁', 銀: '银', 畫: '画', 劇: '剧', 聲: '声',
  優: '优', 戰: '战', 鬪: '斗', 鬬: '斗', 剛: '刚', 劍: '剑', 對: '对', 從: '从',
};

function unify(s) {
  return String(s).replace(/[\u3400-\u9fff]/g, ch => VARIANTS[ch] || ch);
}

/* 命中即淘汰：翻唱、谱例、伴奏、教学、器材向二创、以及编曲不同的版本 */
const HARD = [
  'tab', '谱', '指弹', '口琴', '钢琴', '鋼琴', '小提琴', '萨克斯', '打击乐', '鼓谱',
  '伴奏', '和声伴奏', 'offvocal', 'カラオケ', 'karaoke', 'ニコカラ', 'ktv', '卡拉ok',
  '翻唱', 'cover', 'covered', '歌ってみた', '学唱', '空耳', '教学', '讲座', 'mmd', '手元', '演奏',
  '吹奏楽', '8d', 'nightcore', 'remix', 'dj', '纯音乐', '純音樂', '铃声', '计算器',
  '合集', 'reaction', '试听反应',
  'acoustic', 'アコースティック', 'アコギ', '弾き語り', 'アレンジ', 'arrange',
];

/* 命中扣分但不淘汰：形态与原曲不同（现场、TV size 等） */
const SOFT = ['live', 'ライブ', '现场', '現場', 'tvsize', 'tv size', 'short ver', '纯享'];

/* ASCII 关键词按词边界匹配（否则 ktv 会误伤 "MAD | AI修复" 这类标题） */
function hits(title, kw) {
  if (/^[a-z0-9 ]+$/.test(kw)) {
    const re = new RegExp('(^|[^a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i');
    return re.test(title);
  }
  return unify(norm(title)).includes(unify(norm(kw)));
}

/* UP 主名里出现这些，说明是官方/厂牌号，加分 */
const OFFICIAL_UP = [
  'official', '索尼音乐', 'universal', '华纳', 'jvc', '大家的音乐机', 'avex',
];

/* ---------- Cookie ---------- */

async function getCookie() {
  const cache = path.join(os.tmpdir(), 'jp-song-mv-cookie.json');
  try {
    const j = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (j.exp > Date.now() && j.cookie) return j.cookie;
  } catch { /* 过期或不存在，重新取 */ }

  const res = await fetch('https://www.bilibili.com/', { headers: { 'User-Agent': UA } });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];

  const jar = {};
  for (const c of raw) {
    for (const part of String(c).split(/,(?=\s*[A-Za-z_][\w]*=)/)) {
      const m = part.match(/^\s*([^=;,\s]+)=([^;]*)/);
      if (m) jar[m[1]] = m[2];
    }
  }
  if (!jar.buvid3) throw new Error('取不到 buvid3，B 站可能改了反爬策略；可手工用 --pick BVxxx');

  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  fs.writeFileSync(cache, JSON.stringify({ cookie, exp: Date.now() + 6 * 3600e3 }));
  return cookie;
}

/* ---------- B 站接口 ---------- */

async function search(keyword, cookie, page = 1, ord = 'totalrank') {
  const url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=video'
    + '&keyword=' + encodeURIComponent(keyword) + '&page=' + page + '&order=' + ord;

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: cookie },
  });
  const j = await res.json();

  if (j.code === -412) throw new Error('搜索接口 412（风控）。删掉 ' + path.join(os.tmpdir(), 'jp-song-mv-cookie.json') + ' 重试，或用 --pick 指定');
  if (j.code !== 0) throw new Error('搜索接口返回 code=' + j.code + ' ' + (j.message || ''));
  return (j.data && j.data.result) || [];
}

async function view(bvid, cookie) {
  const url = 'https://api.bilibili.com/x/web-interface/view?bvid=' + bvid;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: cookie || '' },
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error('视频 ' + bvid + ' 取不到：' + (j.message || j.code));
  return j.data;
}

/* ---------- 匹配与打分 ---------- */

function pickTitle(meta) {
  const l1 = String(meta.titleLine1 || '').trim();
  const l2 = String(meta.titleLine2 || '').trim();
  const cjk = /[\u3040-\u30ff\u4e00-\u9fff]/;
  if (!l2) return l1;
  if (!l1) return l2;
  if (cjk.test(l1) && !cjk.test(l2)) return l1;
  return l1 + ' ' + l2;
}

/* 单个汉字也算有效写法（如「恋」「螺旋」），拉丁字母至少两个字符 */
function usable(n) {
  return n && (n.length >= 2 || /[\u3040-\u30ff\u4e00-\u9fff]/.test(n));
}

/* 歌名的若干写法：主标题、副标题、拼起来，外加 meta.aliases。
   命中任意一个即算对上了歌名 */
function titleForms(meta) {
  const l1 = String(meta.titleLine1 || '').trim();
  const l2 = String(meta.titleLine2 || '').trim();
  const forms = new Set();
  for (const s of [l1, l2, l1 + l2, l1 + ' ' + l2]) {
    const n = unify(norm(s));
    if (usable(n)) forms.add(n);
  }
  for (const s of meta.aliases || []) {
    const n = unify(norm(s));
    if (usable(n)) forms.add(n);
  }
  return [...forms];
}

function artistForms(meta) {
  const raw = String(meta.artist || '').trim();
  const forms = new Set();
  if (!raw) return [];
  for (const part of [raw, ...raw.split(/[\/、,，&＆]|\s+feat\.?\s+/i)]) {
    const n = unify(norm(part));
    if (usable(n)) forms.add(n);
  }
  return [...forms];
}

function toSeconds(d) {
  const m = String(d || '').match(/^(\d+):(\d{1,2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function evaluate(r, rank, names, artists) {
  const title = String(r.title || '').replace(/<\/?em[^>]*>/g, '');
  const t = unify(norm(title));
  const au = unify(norm(r.author || ''));

  const hitName = names.some(n => t.includes(n));
  const hitArtist = artists.some(a => t.includes(a) || au.includes(a));
  const ownChannel = artists.some(a => au.includes(a));
  const badHits = HARD.filter(k => hits(title, k));
  const softHits = SOFT.filter(k => hits(title, k));
  const sec = toSeconds(r.duration);

  let s = 0;
  if (hitName) s += 8;
  else s -= 14;
  if (hitArtist) s += 5;
  if (ownChannel) s += 6;           // UP 本人/官方号，比标题里提到作者更可信
  s -= badHits.length * 9;
  s -= softHits.length * 4;

  if (/官方|official|主題歌|主题曲|主题歌|\bop\d?\b|\bed\d?\b/i.test(title)) s += 3;
  if (/\bmv\b|music video|\bpv\b/i.test(title)) s += 2;
  if (OFFICIAL_UP.some(k => au.includes(unify(norm(k))))) s += 2;

  s += Math.min(4, Math.log10(Math.max(1, Number(r.play) || 1)) - 2);
  if (sec && sec < 130) s -= 7;
  s += Math.max(0, 12 - rank) * 0.3;

  return { title, sec, s, hitName, hitArtist, badHits, softHits };
}

/* ---------- 写回 meta.lead ---------- */

function setLead(song, bvid) {
  const anchor = `<a href="https://www.bilibili.com/video/${bvid}/" target="_blank" rel="noopener noreferrer">B站 MV ↗</a>`;
  let lead = String(song.meta.lead || '');
  const re = /<a\b[^>]*bilibili\.com\/video\/[^>]*>[\s\S]*?<\/a>/i;

  if (re.test(lead)) lead = lead.replace(re, anchor);
  else lead = (lead.trim() ? lead.trim() + ' ' : '') + anchor;

  song.meta.lead = lead;
}

function fmtDur(sec) {
  return sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '--:--';
}

function fmtPlay(n) {
  n = Number(n) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万';
  return String(n);
}

/* ---------- 主流程 ---------- */

(async () => {
  const jsonPath = path.resolve(file);
  const song = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const meta = song.meta || {};
  const cookie = await getCookie();

  /* 指定 BV：只校验，不打分 */
  if (pick) {
    const v = await view(pick, cookie);
    console.log(`指定：${pick}｜${v.title}`);
    console.log(`      UP ${v.owner.name}｜${fmtDur(v.duration)}｜${fmtPlay(v.stat.view)} 播放`);
    if (!WRITE) {
      console.log('（未加 --write，不写盘）');
      return;
    }
    setLead(song, pick);
    fs.writeFileSync(jsonPath, JSON.stringify(song, null, 2) + '\n');
    console.log(`✓ meta.lead 已指向 ${pick}，重新 build 即可`);
    return;
  }

  const title = pickTitle(meta);
  if (!title) throw new Error('song.json 缺 meta.titleLine1，无法检索；可用 --query 指定检索词');

  const keyword = query || `${title} ${meta.artist || ''}`.trim();
  const names = titleForms(meta);
  const artists = artistForms(meta);

  console.log(`检索：「${keyword}」  （歌名 ${meta.titleLine1 || ''} ${meta.titleLine2 || ''}｜作者 ${meta.artist || '—'}｜排序 ${order}）`);

  let raw = [];
  for (let p = 1; p <= pages; p++) {
    const got = await search(keyword, cookie, p, order);
    if (!got.length) break;
    raw = raw.concat(got);
  }
  if (!raw.length) throw new Error('没有搜索结果，换个 --query 试试');

  const rows = raw.slice(0, 28).map((r, i) => {
    const e = evaluate(r, i + 1, names, artists);
    return Object.assign({ rank: i + 1, r }, e);
  });

  const ok = rows.filter(x => x.hitName && x.hitArtist && !x.badHits.length);

  for (const x of rows.slice(0, Math.max(limit, 6))) {
    const mark = ok.includes(x) ? '✓' : '✗';
    const why = x.badHits.length ? '含「' + x.badHits.join('/') + '」'
      : !x.hitName ? '歌名对不上'
        : !x.hitArtist ? '作者对不上' : '';
    const soft = x.softHits.length ? '  ~' + x.softHits.join('/') : '';
    console.log(`  ${mark} #${String(x.rank).padStart(2)}  ${x.s.toFixed(1).padStart(5)}  ${x.r.bvid}  ${fmtDur(x.sec).padStart(5)}  ${fmtPlay(x.r.play).padStart(8)}  ${x.title.slice(0, 52)}${why ? '  ← ' + why : ''}${soft}`);
  }
  console.log(`  （${raw.length} 条结果，${ok.length} 条通过校验；~ 表示编曲/形态与原曲不同，只是扣分）`);

  if (!ok.length) {
    throw new Error('没有一条同时对上歌名和作者。用 --query "歌名 作者" 换检索词，或 --pick BVxxx 手工指定');
  }

  const best = ok.sort((a, b) => b.s - a.s)[0];
  console.log(`\n选中：#${best.rank} ${best.r.bvid}｜${best.title}｜UP ${best.r.author}｜${fmtDur(best.sec)}｜${fmtPlay(best.r.play)} 播放`);

  if (!WRITE) {
    console.log('（未加 --write，不写盘；确认后加 --write，或 --write --pick BVxxx 换一条）');
    return;
  }

  setLead(song, best.r.bvid);
  fs.writeFileSync(jsonPath, JSON.stringify(song, null, 2) + '\n');
  console.log(`✓ meta.lead 已指向 ${best.r.bvid}，重新 build 即可`);
})().catch(err => {
  console.error('✗ ' + err.message);
  process.exit(1);
});
