#!/usr/bin/env node
/**
 * 给 song.json 的导语挂一条 B 站视频链接（MV / 现场 / 完整版）。
 *
 *   node scripts/mv.js <song.json>                      # 检索并对照：现有链接 vs 前 5 条候选
 *   node scripts/mv.js <song.json> --write --only-missing  # 只在没有链接时写（新歌用这个）
 *   node scripts/mv.js <song.json> --write --force      # 明确覆盖现有链接
 *   node scripts/mv.js <song.json> --pick BV1xxx         # 指定 BV（仍会校验存在性）
 *   node scripts/mv.js <song.json> --top 10 --order click  # 多看几条 / 换排序
 *   node scripts/mv.js --audit <songs-root>              # 只校验全部现有链接，不搜索
 *   node scripts/mv.js --backtest <songs-root>           # 用现有链接当答案，回测本脚本的命中率
 *
 * 三个设计原则：
 *
 * 1. **现有链接优先。** meta.lead 里已有 bilibili 链接时，默认只校验、只对照，
 *    绝不覆盖——这些链接多数是作者手工挑过的，脚本没有资格静默改掉。
 *    要覆盖必须显式 `--force`。
 *
 * 2. **宁可多给候选，也不要静默选错。** 命中率再高也有选错的时候，所以默认打印前五名，
 *    每条附上「为什么」。人只要扫一眼就能拍板，比盲信第一名快。
 *
 * 3. **权重是从作者已确认的链接里标定出来的，不是拍脑袋。** 当前标定集为仓库内 42 首
 *    已确认链接：首选一致 25 首（60%），前 3 条覆盖 30 首（71%），前 5 条 32 首（76%）。
 *    同一批链接上，改造前的脚本是 13/42（31%）首选一致、17/42（40%）前 3 条。
 *    新增歌曲或手工调整链接后，用 `--backtest` 复跑一次，就能看到新的一致率。
 *
 * 选片逻辑（分数 = log10 播放量 + 加权特征）：
 *   标题对上歌名是**入场券**（或 UP 是作者本人号），之后由这些特征决定名次——
 *   作者名出现在标题 +2、UP 是作者本人号 +0.7、厂牌号 +0.5、MV/PV +0.4、
 *   中日字幕 +0.4、同作者其它曲目也选过的 UP +0.2、4K/无损 +0.2、现场 +0.2、
 *   只对上歌名片段 −1.2、中文译名近似 −0.5、标题里压根没歌名 −2、短于 2:30 −3、长于 8:00 −1。
 *   淘汰项只剩「内容根本不是这首歌」的那类：伴奏 / カラオケ / 翻唱 / 教学 / 演奏 / 谱例 /
 *   合集 / MMD / 8D / remix 等。**现场、acoustic、MAD、AI 修复不再淘汰**——
 *   作者的 42 条链接里有 10 条是现场、2 条是 MAD、1 条是 acoustic 版。
 *
 * 依赖：Node 18+（内置 fetch）。搜索走 wbi 签名接口（旧的 /x/web-interface/search/type
 * 会被风控 412），无需登录。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ---------- 参数 ---------- */

const args = process.argv.slice(2);
const flag = name => args.includes('--' + name);

const WRITE = flag('write');
const FORCE = flag('force');
const ONLY_MISSING = flag('only-missing');
const AUDIT = flag('audit');
const BACKTEST = flag('backtest');
const NO_CACHE = flag('no-cache');

let target = null;
let query = null;
let pick = null;
let dumpFile = null;
let topN = 5;
let order = 'totalrank';
let pages = 2;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--query') { query = args[++i]; continue; }
  if (a === '--pick') { pick = args[++i]; continue; }
  if (a === '--top') { topN = Math.max(1, Number(args[++i]) || 3); continue; }
  if (a === '--order') { order = args[++i] || 'totalrank'; continue; }
  if (a === '--pages') { pages = Math.min(3, Math.max(1, Number(args[++i]) || 2)); continue; }
  if (a === '--dump') { dumpFile = args[++i]; continue; }
  if (a === '--audit' || a === '--backtest') { target = args[++i] || target; continue; }
  if (a.startsWith('--')) continue;
  if (!target) target = a;
}

if (!target) {
  console.error(`用法：
  node scripts/mv.js <song.json>                    检索并对照现有链接
  node scripts/mv.js <song.json> --write --only-missing
  node scripts/mv.js <song.json> --write --force [--pick BV1xxx]
  node scripts/mv.js --audit <songs-root>           校验全部现有链接
  node scripts/mv.js --backtest <songs-root>        回测命中率`);
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
  宮: '宫', 歩: '步', 髙: '高', 澤: '泽', 沢: '泽', 邊: '边', 邉: '边', 濱: '滨', 島: '岛',
  黒: '黑', 樹: '树', 藝: '艺', 龍: '龙', 竜: '龙', 劍: '剑', 會: '会', 師: '师',
  實: '实', 間: '间', 醫: '医', 寫: '写', 樂: '乐', 樣: '样', 應: '应', 場: '场',
  遊: '游', 氣: '气', 廣: '广', 鐵: '铁', 銀: '银', 畫: '画', 劇: '剧', 聲: '声',
  優: '优', 戰: '战', 鬪: '斗', 鬬: '斗', 剛: '刚', 對: '对', 從: '从', 説: '说',
  涙: '泪', 戀: '恋', 愛: '爱', 終: '终', 駆: '驱', 駈: '驱', 僕: '仆', 殘: '残',
  紅: '红', 蓮: '莲', 華: '华', 滅: '灭', 懺: '忏', 悔: '悔', 録: '录', 勲: '勋',
  桜: '樱', 櫻: '樱', 藥: '药', 轉: '转', 讀: '读', 聴: '听', 聽: '听', 顔: '颜',
  髪: '发', 橋: '桥', 絵: '绘', 點: '点', 縣: '县', 齒: '齿', 齢: '龄', 齡: '龄',
};

function unify(s) { return String(s).replace(/[\u3400-\u9fff]/g, ch => VARIANTS[ch] || ch); }
const N = s => unify(norm(s));

function lcs(a, b) {
  if (!a || !b) return 0;
  let prev = new Array(b.length + 1).fill(0);
  const cur = new Array(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : 0;
      if (cur[j] > best) best = cur[j];
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
    cur.fill(0);
  }
  return best;
}

/* 中文译名和原题差一两个字（「直到世界尽头」vs「直到世界的尽头」），按最长公共子序列比例近似 */
function lcsRatio(a, b) { const l = lcs(a, b); return l ? (2 * l) / (a.length + b.length) : 0; }

/* 标题里常有前缀（「【4K】TV动画《…》OP2」），整串比会把正确答案压到阈值以下。
   这里按目标长度滑窗取最像的一段，只用于长度 ≥4 的歌名 */
function bestWindowRatio(name, text) {
  if (name.length < 4 || text.length < name.length) return 0;
  let best = 0;
  for (let i = 0; i + name.length <= text.length; i++) {
    const r = lcsRatio(name, text.slice(i, i + name.length));
    if (r > best) best = r;
    if (best > 0.95) break;
  }
  return best;
}

/* 命中即淘汰：内容根本不是这首歌本身。
   注意「现场 / acoustic / MAD / AI 修复 / TV size」都不在这里——那是同一首歌的不同形态 */
const VETO = [
  'tab', '谱', '指弹', '口琴', '钢琴', '鋼琴', '小提琴', '萨克斯', '打击乐', '鼓谱',
  '伴奏', '和声伴奏', 'offvocal', 'カラオケ', 'karaoke', 'ニコカラ', 'ktv', '卡拉ok',
  '翻唱', 'cover', 'covered', 'カバー', '歌ってみた', '学唱', '空耳', '教学',
  '讲座', '講座', '解説', 'mmd', '踊ってみた', '振付', '演奏', '吹奏楽', '弾いてみた',
  '8d', 'nightcore', 'remix', 'dj', '纯音乐', '純音樂', '铃声', '计算器',
  '合集', 'reaction', '试听反应',
  '笛', '箫', '二胡', '古筝', '琵琶', '弦乐', '弦楽', '四重奏', '八音盒', 'オルゴール',
  '吉他', '贝斯', 'bass', 'ギター', 'ベース', '三味線', '箏',
];

/* 只在打分里轻微提醒：形态与原曲不同 */
const SOFT = ['live', 'ライブ', '现场', '現場', 'tvsize', 'tv size', 'short ver', '纯享', 'acoustic', 'アコースティック', '弾き語り', 'アレンジ', 'arrange', 'mad', 'amv', '修复', '4k', '8k'];

/* ASCII 关键词按词边界匹配（否则 ktv 会误伤 "MAD | AI修复" 这类标题） */
function hits(title, kw) {
  if (/^[a-z0-9 ]+$/.test(kw)) {
    const re = new RegExp('(^|[^a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i');
    return re.test(title);
  }
  return N(title).includes(N(kw));
}

const TRAIT = {
  sub: /中字|中日|字幕|双语|双語|chinese ?sub|翻譯|翻译/i,
  hq: /4k|8k|1080|高清|高画质|画质|hires|hi-res|无损|無損|修复|60fps|hdr|杜比|dolby|remaster|重制|音质/i,
  live: /现场|現場|\blive\b|ライブ|演唱会|演唱會|concert|\btour\b|万人|神级|核爆/i,
  mv: /\bmv\b|music video|\bpv\b|official video/i,
};

/* 厂牌 / 平台号：不是作者本人，但可信度接近 */
const LABEL_UP = ['official', '索尼音乐', 'sony', 'universal', '华纳', 'warner', 'jvc', '大家的音乐机', 'avex', '网易云音乐', '环球音乐'];

/* ---------- 打分权重（由 42 首已确认链接标定，见文件头） ---------- */

const W = {
  artistInTitle: 2.0,   // 标题里写了作者名
  ownChannel: 0.7,      // UP 就是作者本人号
  labelChannel: 0.5,    // 厂牌/平台号
  mv: 0.4,              // MV / PV / Official Video
  sub: 0.4,             // 中日字幕
  upPrior: 0.2,         // 同作者其它曲目也选过这个 UP（会随手工调整自动更新）
  work: 0.2,            // 标题里出现作品名（番名/剧名）
  hq: 0.2,              // 4K / Hi-Res / 修复
  live: 0.2,            // 现场
  shortCut: -3,         // 短于 2:30，多半是切片
  longCut: -1,          // 长于 8:00，多半带解说或合集
  weakName: -1.2,       // 只对上歌名的某个片段（「brave」之于《brave heart》）
  fuzzyName: -0.5,      // 只靠中文译名模糊对上，降一档
  noName: -2,           // 标题里压根没写歌名，只靠「作者本人号」兜底进来的
};

/* 调参钩子：MV_W='{"upPrior":0.2}' node scripts/mv.js --backtest . */
if (process.env.MV_W) {
  try { Object.assign(W, JSON.parse(process.env.MV_W)); }
  catch { console.error('⚠ MV_W 不是合法 JSON，忽略'); }
}

/* ---------- HTTP ---------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const CACHE_DIR = path.join(os.tmpdir(), 'jp-song-mv-cache');

function cached(key, ttlMs, fn) {
  if (NO_CACHE) return fn();
  try {
    const f = path.join(CACHE_DIR, crypto.createHash('md5').update(key).digest('hex') + '.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Date.now() - j.t < ttlMs) return Promise.resolve(j.v);
  } catch { /* 没有缓存 */ }
  return fn().then(v => {
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(path.join(CACHE_DIR, crypto.createHash('md5').update(key).digest('hex') + '.json'), JSON.stringify({ t: Date.now(), v })); } catch { /* 写不进去就算了 */ }
    return v;
  });
}

/* wbi 签名：不签名的话 /x/web-interface/search/type 会被风控返回 412 */
const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
let mixinKey = null;

async function getMixinKey() {
  if (mixinKey) return mixinKey;
  const r = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' } });
  const j = await r.json();
  if (!j.data || !j.data.wbi_img) throw new Error('取不到 wbi key，B 站可能改了接口；可手工用 --pick BVxxx');
  const raw = j.data.wbi_img.img_url.split('/').pop().split('.')[0] + j.data.wbi_img.sub_url.split('/').pop().split('.')[0];
  mixinKey = MIXIN_TAB.map(n => raw[n]).join('').slice(0, 32);
  return mixinKey;
}

async function signedUrl(base, params) {
  const key = await getMixinKey();
  const p = Object.assign({}, params, { wts: Math.floor(Date.now() / 1000) });
  const q = Object.keys(p).sort()
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(p[k]).replace(/[!'()*]/g, '')))
    .join('&');
  return base + '?' + q + '&w_rid=' + crypto.createHash('md5').update(q + key).digest('hex');
}

async function search(keyword, page = 1, ord = 'totalrank') {
  const fetchOnce = async () => {
    const url = await signedUrl('https://api.bilibili.com/x/web-interface/wbi/search/type', {
      search_type: 'video', keyword, page, page_size: 30, order: ord,
    });
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com' } });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch { /* 风控会返回 HTML */ }
    if (!j) throw Object.assign(new Error('风控页'), { retry: true });
    if (j.code === -412) throw Object.assign(new Error('412 风控'), { retry: true });
    if (j.code !== 0) throw new Error('搜索接口 code=' + j.code + ' ' + (j.message || ''));
    return (j.data && j.data.result) || [];
  };

  return cached('search|' + ord + '|' + page + '|' + keyword, 12 * 3600e3, async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetchOnce();
        await sleep(700);
        return res;
      } catch (e) {
        if (!e.retry) throw e;
        mixinKey = null;
        await sleep(6000 * (attempt + 1));
      }
    }
    throw new Error('搜索连续被风控，稍后重试或手工 --pick BVxxx');
  });
}

async function view(bvid) {
  return cached('view|' + bvid, 7 * 24 * 3600e3, async () => {
    const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid, {
      headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
    });
    const j = await r.json();
    if (j.code !== 0) throw new Error('视频 ' + bvid + ' 取不到：' + (j.message || j.code));
    return j.data;
  });
}

/* ---------- 歌名 / 作者的各种写法 ---------- */

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
const usable = n => n && (n.length >= 2 || /[\u3040-\u30ff\u4e00-\u9fff]/.test(n));

function titleForms(meta) {
  const l1 = String(meta.titleLine1 || '').trim();
  const l2 = String(meta.titleLine2 || '').trim();
  const set = new Set();
  for (const s of [l1, l2, l1 + l2, l1 + ' ' + l2]) {
    const n = N(s);
    if (usable(n)) set.add(n);
  }
  for (const s of meta.aliases || []) {
    const n = N(s);
    if (usable(n)) set.add(n);
  }
  return [...set];
}

/* 强写法：整首标题拼起来，以及够长的单段标题 / 别名。
   「brave + heart」里的「brave」只有 5 个字母，不算强匹配——不然 YOASOBI《The Brave》也会混进来；
   但「正解 + SEIKAI」里的「正解」够长，要算，否则标题只写中文时对不上 */
function strongForms(meta) {
  const l1 = String(meta.titleLine1 || '').trim();
  const l2 = String(meta.titleLine2 || '').trim();
  const set = new Set();
  const full = N(l1 + l2);
  if (full && (/[\u3040-\u30ff\u4e00-\u9fff]/.test(full) || full.length >= 5)) set.add(full);
  for (const part of [l1, l2]) {
    const n = N(part);
    if (!n || n === full) continue;
    if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(n) ? n.length >= 2 : n.length >= 6) set.add(n);
  }
  for (const s of meta.aliases || []) {
    const n = N(s);
    if (usable(n)) set.add(n);
  }
  return [...set];
}

function artistForms(meta) {
  const raw = String(meta.artist || '').trim();
  const set = new Set();
  if (!raw) return [];
  for (const part of [raw, ...raw.split(/[\/、,，&＆×]|\s+feat\.?\s+/i), ...raw.split(/\s+from\s+/i)]) {
    const n = N(part);
    if (usable(n)) set.add(n);
  }
  for (const s of meta.aliases || []) {
    const n = N(s);
    if (usable(n)) set.add(n);
  }
  return [...set];
}

/* 检索词：歌名+作者 / 歌名+官方MV / 歌名 / 中文译名 / 歌名+译名
   最后两条是为「标题里只有中文译名」的稿子准备的——只搜日文原题，它们根本不会出现 */
function queriesOf(meta) {
  const t = pickTitle(meta);
  const a = String(meta.artist || '').trim();
  const out = [];
  const push = q => {
    const s = String(q || '').replace(/\s+/g, ' ').trim();
    if (s && !out.includes(s)) out.push(s);
  };
  push(`${t} ${a}`);
  push(`${t} 官方 MV`);
  push(t);
  /* 只要中文译名（带假名的是日文写法，单独检索没有意义，还会把池子搅浑） */
  const cn = (meta.aliases || [])
    .map(s => String(s).trim())
    .filter(s => s && s !== t && s.length <= 12 && /[\u4e00-\u9fff]/.test(s) && !/[\u3040-\u30ff]/.test(s));
  if (cn[0]) push(cn[0]);
  if (cn[0]) push(`${t} ${cn[0]}`);
  return out.slice(0, 5);
}

/* ---------- 特征 ---------- */

function toSec(d) {
  if (typeof d === 'number') return d;
  const m = String(d || '').match(/^(\d+):(\d{1,2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function features(r, meta, upPrior) {
  const title = String(r.title || '').replace(/<\/?em[^>]*>/g, '');
  const t = N(title);
  const au = N(r.author || '');
  const names = titleForms(meta);
  const strong = strongForms(meta);
  const artists = artistForms(meta);
  const work = N((meta.catalog && meta.catalog.work) || '');

  const nameStrong = strong.some(n => t.includes(n));
  const nameWeak = !nameStrong && names.some(n => t.includes(n));
  const ratio = Math.max(0, ...names.map(n => Math.max(lcsRatio(n, t), bestWindowRatio(n, t))));
  const fuzzyName = !nameStrong && !nameWeak && ratio >= 0.62;
  const artistInTitle = artists.some(a => t.includes(a));
  const ownChannel = artists.some(a => au.includes(a));
  const labelChannel = LABEL_UP.some(k => au.includes(N(k)));
  const workHit = !!work && t.includes(work);
  const veto = VETO.filter(k => hits(title, k));
  const sec = toSec(r.duration);
  const play = Math.max(1, Number(r.play) || 1);

  let s = Math.log10(play);
  if (artistInTitle) s += W.artistInTitle;
  if (ownChannel) s += W.ownChannel;
  if (labelChannel) s += W.labelChannel;
  if (TRAIT.mv.test(title)) s += W.mv;
  if (TRAIT.sub.test(title)) s += W.sub;
  if (TRAIT.hq.test(title)) s += W.hq;
  if (TRAIT.live.test(title)) s += W.live;
  if (workHit) s += W.work;
  if (nameWeak) s += W.weakName;
  if (fuzzyName) s += W.fuzzyName;
  if (!nameStrong && !nameWeak && !fuzzyName) s += W.noName;
  if (upPrior) s += W.upPrior * Math.min(3, upPrior);
  if (sec && sec < 150) s += W.shortCut;
  if (sec > 480) s += W.longCut;

  return {
    title, sec, play, s, veto, nameStrong, nameWeak, fuzzyName, artistInTitle, ownChannel, labelChannel, workHit,
    tags: [
      ownChannel ? '作者本人号' : labelChannel ? '厂牌号' : null,
      artistInTitle ? '标题含作者' : null,
      TRAIT.mv.test(title) ? 'MV' : null,
      TRAIT.sub.test(title) ? '中字' : null,
      TRAIT.hq.test(title) ? '高画质' : null,
      TRAIT.live.test(title) ? '现场' : null,
      upPrior ? '你选过这个 UP' : null,
      nameWeak ? '只对上歌名片段' : null,
      fuzzyName ? '中文译名近似' : null,
      !nameStrong && !nameWeak && !fuzzyName ? '标题没写歌名' : null,
      sec && sec < 150 ? '偏短' : null,
      sec > 480 ? '偏长' : null,
    ].filter(Boolean),
  };
}

/* 入场券：标题对上歌名，或者「作者自己的号 + 标题里有作者」。
   单靠 UP 是作者本人号不够——同一位歌手的其它投稿会混进来 */
function passesGate(f) { return f.nameStrong || f.nameWeak || f.fuzzyName || (f.ownChannel && f.artistInTitle); }

/* ---------- UP 先验：从仓库里其它曲目的现有链接学 ---------- */

async function buildUpPrior(meta, selfPath) {
  const root = path.dirname(path.dirname(path.resolve(selfPath)));
  const self = path.resolve(selfPath);
  const dirs = (() => {
    try { return fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return []; }
  })();

  const artist = N(meta.artist || '');
  const counts = {};
  for (const d of dirs) {
    const p = path.join(root, d.name, d.name + '.song.json');
    if (path.resolve(p) === self || !fs.existsSync(p)) continue;
    let other;
    try { other = JSON.parse(fs.readFileSync(p, 'utf8')).meta || {}; } catch { continue; }
    const bv = (String(other.lead || '').match(/video\/([A-Za-z0-9]+)/) || [])[1];
    if (!bv) continue;
    let v;
    try { v = await view(bv); } catch { continue; }
    const up = String((v.owner && v.owner.name) || '').trim();
    if (!up) continue;
    // 同作者的权重更高：同一位歌手的其它曲目最说明口味
    const sameArtist = artist && N(other.artist || '').includes(artist);
    counts[up] = (counts[up] || 0) + (sameArtist ? 3 : 1);
  }
  return counts;
}

/* ---------- 检索 ---------- */

async function buildPool(meta) {
  const queries = query ? [query] : queriesOf(meta);
  const seen = new Map();

  for (const q of queries) {
    for (let p = 1; p <= pages; p++) {
      let got;
      try { got = await search(q, p, order); } catch (e) { if (p === 1) throw e; break; }
      if (!got.length) break;
      got.forEach((r, i) => {
        if (!seen.has(r.bvid)) seen.set(r.bvid, Object.assign({}, r, { _rank: (p - 1) * 30 + i + 1, _q: q }));
      });
    }
  }
  // 再补一遍按播放量排序：作者偏好的高播放原稿经常在综合排序里排不上号
  if (!query && order === 'totalrank') {
    try {
      const got = await search(queries[0], 1, 'click');
      got.forEach((r, i) => { if (!seen.has(r.bvid)) seen.set(r.bvid, Object.assign({}, r, { _rank: 200 + i, _q: queries[0] + '（按播放）' })); });
    } catch { /* 补不到就算了 */ }
  }
  return { queries, rows: [...seen.values()] };
}

function rankPool(rows, meta, upPrior) {
  const scored = [];
  for (const r of rows) {
    const prior = (upPrior && upPrior[String(r.author || '').trim()]) || 0;
    const f = features(r, meta, prior);
    if (f.veto.length) continue;
    if (!passesGate(f)) continue;
    scored.push(Object.assign({ r, f }, { s: f.s }));
  }
  scored.sort((a, b) => b.s - a.s);
  return scored;
}

/* ---------- 输出 ---------- */

const fmtDur = sec => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '--:--');
const fmtPlay = n => {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + ' 亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + ' 万';
  return String(n);
};
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

function currentBv(meta) {
  return (String(meta.lead || '').match(/bilibili\.com\/video\/([A-Za-z0-9]+)/) || [])[1] || null;
}

function setLead(song, bvid) {
  const anchor = `<a href="https://www.bilibili.com/video/${bvid}/" target="_blank" rel="noopener noreferrer">B站 MV ↗</a>`;
  let lead = String(song.meta.lead || '');
  const re = /<a\b[^>]*bilibili\.com\/video\/[^>]*>[\s\S]*?<\/a>/i;
  if (re.test(lead)) lead = lead.replace(re, anchor);
  else lead = (lead.trim() ? lead.trim() + ' ' : '') + anchor;
  song.meta.lead = lead;
}

function printRow(i, x, mark) {
  console.log(`  ${mark} ${String(i).padStart(2)}. ${x.s.toFixed(2).padStart(5)}  ${x.r.bvid}  ${fmtDur(toSec(x.r.duration)).padStart(5)}  ${fmtPlay(x.r.play).padStart(8)}  ${clip(x.r.author, 14)}`);
  console.log(`         ${clip(x.f.title, 58)}`);
  if (x.f.tags.length) console.log(`         ${x.f.tags.join(' · ')}`);
}

/* ---------- 单曲模式 ---------- */

async function oneSong(jsonPath) {
  const song = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const meta = song.meta || {};
  const existing = currentBv(meta);

  if (pick) {
    const v = await view(pick);
    console.log(`指定：${pick}｜${v.title}`);
    console.log(`      UP ${v.owner.name}｜${fmtDur(v.duration)}｜${fmtPlay(v.stat && v.stat.view)} 播放`);
    if (!WRITE) { console.log('（未加 --write，不写盘）'); return; }
    if (existing && existing !== pick && !FORCE) {
      console.log(`⚠ 现有链接是 ${existing}，不是 ${pick}；确认要用 --force`);
      process.exitCode = 2;
      return;
    }
    setLead(song, pick);
    fs.writeFileSync(jsonPath, JSON.stringify(song, null, 2) + '\n');
    console.log(`✓ meta.lead 已指向 ${pick}，重新 build 即可`);
    return;
  }

  const upPrior = await buildUpPrior(meta, jsonPath);
  const { queries, rows } = await buildPool(meta);
  console.log(`检索 ${queries.map(q => `「${q}」`).join(' / ')}`);
  console.log(`候选池 ${rows.length} 条（去重后），排序 ${order}\n`);

  const ranked = rankPool(rows, meta, upPrior);
  if (!ranked.length) {
    console.error('✗ 没有一条同时对得上歌名。用 --query "歌名 作者" 换检索词，或 --pick BVxxx 手工指定');
    process.exit(1);
  }

  if (existing) {
    const idx = ranked.findIndex(x => x.r.bvid === existing);
   console.log(`你现在的链接：${existing}${idx >= 0 ? `（在本池排第 ${idx + 1}）` : '（不在本池前段，可能来自另一条检索词）'}`);
    try {
      const v = await view(existing);
      console.log(`  ${clip(v.title, 56)}`);
      console.log(`  UP ${v.owner.name}｜${fmtDur(v.duration)}｜${fmtPlay(v.stat && v.stat.view)} 播放`);
    } catch (e) {
      console.log(`  ⚠ ${e.message}（链接可能已失效）`);
    }
    console.log('');
  }

  console.log(`前 ${topN} 条候选：`);
  ranked.slice(0, topN).forEach((x, i) => printRow(i + 1, x, existing && x.r.bvid === existing ? '★' : ' '));

  const best = ranked[0];
  const agree = existing && best.r.bvid === existing;
  console.log('');
  if (existing) {
    console.log(agree ? '✓ 首选与你现有链接一致' : `· 首选与现有链接不同（现有 ${existing}），未改动`);
  }

  if (!WRITE) {
    console.log('（未写盘。新歌用 --write --only-missing；确认要换掉现有链接再加 --write --force）');
    return;
  }
  if (existing && agree) { console.log('✓ 一致，无需改动'); return; }
  if (existing && !FORCE) {
    if (ONLY_MISSING) { console.log('· 已有链接，--only-missing 不动它'); return; }
    console.log('⚠ 已有链接，默认不覆盖。确认要换成首选请加 --force');
    process.exitCode = 2;
    return;
  }
  setLead(song, best.r.bvid);
  fs.writeFileSync(jsonPath, JSON.stringify(song, null, 2) + '\n');
  console.log(`✓ meta.lead 已指向 ${best.r.bvid}，重新 build 即可`);
}

/* ---------- 批量：找 song.json ---------- */

function findSongs(root) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'preview' || e.name === 'covers') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 2) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.song.json')) out.push(p);
    }
  };
  if (fs.statSync(root).isFile()) return [root];
  walk(root, 0);
  return out.sort();
}

/* ---------- 校验现有链接 ---------- */

async function audit(root) {
  const files = findSongs(root);
  console.log(`校验 ${files.length} 首的现有链接\n`);
  let bad = 0, off = 0;
  for (const p of files) {
    const slug = path.basename(p).replace(/\.song\.json$/, '');
    const meta = (JSON.parse(fs.readFileSync(p, 'utf8')).meta) || {};
    const bv = currentBv(meta);
    if (!bv) { console.log(`✗ ${slug.padEnd(20)} 没有链接`); bad++; continue; }
    try {
      const v = await view(bv);
      const title = String(v.title || '');
      const t = N(title);
      const strong = strongForms(meta);
      const weak = titleForms(meta);
      const veto = VETO.filter(k => hits(title, k));
      const sec = toSec(v.duration);

      /* 只报「结构上更像错的东西」。作者名没进标题太常见（官方稿、MAD、译名稿都这样），不作判据 */
      const nameOk = weak.some(n => t.includes(n)) || Math.max(0, ...strong.map(n => lcsRatio(n, t))) >= 0.62;
      const flags = [];
      if (!nameOk) flags.push('标题对不上歌名');
      if (veto.length) flags.push('含「' + veto.join('/') + '」');
      if (sec && sec < 150) flags.push('短于 2:30');
      if (sec > 480) flags.push('长于 8:00');

      if (flags.length) {
        off++;
        console.log(`⚠ ${slug.padEnd(20)} ${bv}  ${fmtDur(sec).padStart(5)}  ${fmtPlay(v.stat && v.stat.view).padStart(8)}  ${clip(title, 40)}  ← ${flags.join('；')}`);
      } else {
        console.log(`✓ ${slug.padEnd(20)} ${bv}  ${fmtDur(sec).padStart(5)}  ${fmtPlay(v.stat && v.stat.view).padStart(8)}  ${clip(title, 40)}`);
      }
    } catch (e) {
      bad++; console.log(`✗ ${slug.padEnd(20)} ${bv}  ${e.message}`);
    }
  }
  console.log(`\n失效 ${bad}，可疑 ${off}，共 ${files.length}`);
}

/* ---------- 回测：现有链接就是标准答案 ---------- */

async function backtest(root) {
  const files = findSongs(root);
  console.log(`回测 ${files.length} 首（现有链接当标准答案，只读，不写盘）\n`);
  let hit1 = 0, hit3 = 0, inPool = 0, tot = 0;
  const fails = [];
  const dump = [];
  for (const p of files) {
    const slug = path.basename(p).replace(/\.song\.json$/, '');
    const meta = (JSON.parse(fs.readFileSync(p, 'utf8')).meta) || {};
    const answer = currentBv(meta);
    if (!answer) continue;
    let upPrior = {};
    try { upPrior = await buildUpPrior(meta, p); } catch { /* 没先验也照跑 */ }
    const { rows } = await buildPool(meta);
    const found = rows.some(r => r.bvid === answer);
    const ranked = rankPool(rows, meta, upPrior);
    const pos = ranked.findIndex(x => x.r.bvid === answer) + 1;
    tot++;
    if (found) inPool++;
    if (pos === 1) hit1++;
    if (pos > 0 && pos <= 3) hit3++;
    if (pos !== 1) fails.push(slug + (pos ? `#${pos}` : '#-'));
    console.log(`${pos === 1 ? '✓' : '✗'} ${slug.padEnd(20)} ${pos ? '第' + String(pos).padStart(2) + '名' : found ? '被过滤' : '不在池'}  ${pos ? clip(ranked[0].f.title, 40) : ''}`);
    if (dumpFile) {
      dump.push({
        slug, answer,
        cands: ranked.map(x => ({
          bvid: x.r.bvid, title: x.f.title, author: x.r.author, play: x.r.play, duration: x.r.duration,
          y: x.r.bvid === answer ? 1 : 0,
          f: {
            artistInTitle: +x.f.artistInTitle, ownChannel: +x.f.ownChannel, labelChannel: +x.f.labelChannel,
            workHit: +x.f.workHit, nameWeak: +x.f.nameWeak, fuzzyName: +x.f.fuzzyName, mv: +TRAIT.mv.test(x.f.title),
            sub: +TRAIT.sub.test(x.f.title), hq: +TRAIT.hq.test(x.f.title), live: +TRAIT.live.test(x.f.title),
            upPrior: (upPrior && upPrior[String(x.r.author || '').trim()]) || 0,
            sec: toSec(x.r.duration), logPlay: Math.log10(Math.max(1, Number(x.r.play) || 1)),
          },
        })),
      });
    }
  }
  const pct = n => (n / tot * 100).toFixed(0) + '%';
  console.log(`\n候选池覆盖 ${inPool}/${tot} = ${pct(inPool)}`);
  console.log(`top-1 命中 ${hit1}/${tot} = ${pct(hit1)}`);
  console.log(`top-3 覆盖 ${hit3}/${tot} = ${pct(hit3)}`);
  if (fails.length) console.log(`没排第一：${fails.join(', ')}`);
  if (dumpFile) { fs.writeFileSync(dumpFile, JSON.stringify(dump, null, 1)); console.log(`候选特征已导出：${dumpFile}`); }
}

/* ---------- 主流程 ---------- */

(async () => {
  if (AUDIT) return audit(target);
  if (BACKTEST) return backtest(target);
  return oneSong(path.resolve(target));
})().catch(err => {
  console.error('✗ ' + err.message);
  process.exit(1);
});
