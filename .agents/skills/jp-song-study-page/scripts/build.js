#!/usr/bin/env node
/**
 * build.js — 把一份 song.json 编译成单文件学习页
 *
 *   node build.js <song.json> [out.html]
 *   node build.js --check <song.json>     # 只校验，不产出
 *   node build.js --check --strict-lines <song.json>  # 逐句卡必须是完整来源行
 *
 * 依赖：Node 18+，零第三方依赖。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const TEMPLATE = path.join(ASSETS, 'template.html');
const CSS = path.join(ASSETS, 'base.css');
const RENDER = path.join(ASSETS, 'render.js');

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const checkOnly = flags.has('--check');
const strictLines = flags.has('--strict-lines');
const args = argv.filter(a => !a.startsWith('--'));

for (const flag of flags) {
  if (!['--check', '--strict-lines'].includes(flag)) {
    console.error(`未知参数: ${flag}`);
    process.exit(1);
  }
}

if (!args.length) {
  console.error('用法: node build.js <song.json> [out.html]');
  console.error('      node build.js --check <song.json>');
  console.error('      node build.js --check --strict-lines <song.json>');
  process.exit(1);
}

const songPath = path.resolve(args[0]);
const outPath = path.resolve(args[1] || path.join(path.dirname(songPath), 'index.html'));

/* ---------- 读取 ---------- */
function read(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`✗ 找不到 ${label}: ${p}`);
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8');
}

/* ---------- 读取（支持 extends 继承，lite 版只写差异） ---------- */
function deepMerge(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return b === undefined ? a : b;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return b === undefined ? a : b;
  }
  const out = Object.assign({}, a);
  Object.keys(b).forEach(k => { out[k] = deepMerge(a[k], b[k]); });
  return out;
}

/* meta.cover 的保留关键字：不是文件路径，不要参与路径解析 */
const COVER_KEYWORDS = new Set(['disc', 'type']);

function loadSong(p, depth = 0) {
  if (depth > 5) throw new Error('extends 层级过深（可能有循环引用）');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  // 封面相对路径按「当前这份 json 所在目录」解析，继承后依然是绝对路径
  if (raw.meta && typeof raw.meta.cover === 'string' && raw.meta.cover
      && !COVER_KEYWORDS.has(raw.meta.cover)
      && !/^(https?:|data:)/.test(raw.meta.cover) && !path.isAbsolute(raw.meta.cover)) {
    raw.meta.cover = path.resolve(path.dirname(p), raw.meta.cover);
  }
  if (typeof raw.extends === 'string' && raw.extends) {
    const basePath = path.resolve(path.dirname(p), raw.extends);
    if (!fs.existsSync(basePath)) throw new Error(`extends 指向的文件不存在: ${raw.extends}`);
    const base = loadSong(basePath, depth + 1);
    const merged = deepMerge(base, raw);
    delete merged.extends;
    return merged;
  }
  return raw;
}

let song;
try {
  song = loadSong(songPath);
} catch (e) {
  console.error('✗ song.json 读取失败：' + e.message);
  process.exit(1);
}

/* ---------- 校验 ---------- */
const errors = [];
const warns = [];
const need = (cond, msg) => { if (!cond) errors.push(msg); };

const meta = song.meta || {};
need(meta.slug, 'meta.slug 缺失（用于 localStorage 命名空间，换歌必须换掉）');
need(meta.pageTitle, 'meta.pageTitle 缺失');
need(meta.titleLine1, 'meta.titleLine1 缺失');
need(meta.artist, 'meta.artist 缺失');
need(meta.lead, 'meta.lead 缺失');
need(Array.isArray(meta.badges) && meta.badges.length, 'meta.badges 至少给 1 个');

/* 默认五块，只有明确配置 lyrics:false 才省略全文；语法图谱是最后一节 */
const SECTION_IDS = ['map', 'lyrics', 'lines', 'vocab', 'grammar'];
const MODULES = Object.assign({ map: true, lyrics: true, lines: true, vocab: true, grammar: true }, song.modules || {});
const on = k => MODULES[k] !== false;
['map', 'lines', 'vocab', 'grammar'].forEach(k => {
  if (MODULES[k] === false) errors.push(`核心板块 "${k}" 不能关闭（关掉就没有内容了）`);
});
Object.keys(song.modules || {}).forEach(k => {
  if (!SECTION_IDS.includes(k)) {
    errors.push(`modules 里有未知板块 "${k}"`);
  }
});

/* 未支持的字段不能被重新带入页面。 */
const DATA_KEYS = new Set(['extends', 'modules', 'meta', 'stats', 'cta', 'nav', 'map', 'steps', 'sec', 'lyrics', 'lines', 'vocab', 'vocabTip', 'grammar', 'footer']);
Object.keys(song).forEach(k => {
  if (!DATA_KEYS.has(k)) errors.push(`song.json 里有不支持的字段 "${k}"`);
});
Object.keys(song.sec || {}).forEach(k => {
  if (!SECTION_IDS.includes(k)) errors.push(`sec 里有不支持的章节 "${k}"`);
});
(song.nav || []).forEach((n, i) => {
  if (!SECTION_IDS.includes(n.id)) errors.push(`nav[${i}] 指向不支持的章节 "${n.id}"`);
});
if (song.cta?.secondaryHref?.startsWith('#') && !SECTION_IDS.includes(song.cta.secondaryHref.slice(1))) {
  errors.push('cta.secondaryHref 必须指向现有章节');
}

const lines = song.lines || [];
const vocab = song.vocab || [];
const grammar = song.grammar || [];

function plainLyricText(text) {
  return String(text || '').replace(/\[[^\]]*\]/g, '').replace(/[\s\u3000]+/g, '');
}

need(lines.length >= 6, `lines 至少 6 张卡（当前 ${lines.length}）`);
need(vocab.length >= 20, `vocab 至少 20 词（当前 ${vocab.length}）`);
need(grammar.length >= 6, `grammar 至少 6 条（当前 ${grammar.length}）`);

lines.forEach((l, i) => {
  if (!l.jp) errors.push(`lines[${i}] 缺 jp`);
  if (!l.tr) errors.push(`lines[${i}] 缺 tr`);
  if (!Array.isArray(l.words) || !l.words.length) warns.push(`lines[${i}] 没有 words`);
  if (!l.g) warns.push(`lines[${i}] 没有语法说明 g`);
  // 注音语法：只允许 漢字[かな]，不应出现未闭合的 [
  const open = (l.jp.match(/\[/g) || []).length;
  const close = (l.jp.match(/\]/g) || []).length;
  if (open !== close) errors.push(`lines[${i}].jp 的 [ ] 不配对`);
  if (/\]\[/.test(l.jp)) warns.push(`lines[${i}].jp 出现 ][ 相邻，检查注音写法`);
});

/* 完整歌词 */
if (on('lyrics')) {
  const L = song.lyrics;
  const lyricTexts = [];
  if (!L || !Array.isArray(L.blocks) || !L.blocks.length) {
    errors.push('默认需要完整歌词：请填写非空的 lyrics.blocks；仅在明确不收录全文时设置 modules.lyrics=false');
  } else {
    let total = 0;
    L.blocks.forEach((b, i) => {
      if (!Array.isArray(b.lines) || !b.lines.length) {
        errors.push(`lyrics.blocks[${i}] 没有歌词行`);
        return;
      }
      total += b.lines.length;
      b.lines.forEach((l, j) => {
        if (typeof l !== 'string' || !l.trim()) {
          errors.push(`lyrics.blocks[${i}].lines[${j}] 必须是非空歌词文本`);
          return;
        }
        const open = (l.match(/\[/g) || []).length;
        const close = (l.match(/\]/g) || []).length;
        if (open !== close) errors.push(`lyrics.blocks[${i}].lines[${j}] 注音 [ ] 不配对：${l}`);
      });
    });
    if (total < 8) warns.push(`lyrics 只有 ${total} 行，确认是不是漏了段落`);
    L.blocks.forEach(b => {
      if (!Array.isArray(b.lines)) return;
      b.lines.forEach(l => {
        const text = plainLyricText(l);
        if (text) lyricTexts.push({ original: l, text });
      });
    });

    const lyricSet = new Set(lyricTexts.map(l => l.text));
    const partial = [];
    const seenCards = new Map();
    lines.forEach((line, i) => {
      const text = plainLyricText(line.jp);
      if (!lyricSet.has(text)) partial.push(i);
      if (seenCards.has(text)) {
        errors.push(`lines[${i}] 与 lines[${seenCards.get(text)}] 指向同一句歌词；完全重复的歌词只保留一张卡`);
      } else {
        seenCards.set(text, i);
      }
    });

    if (strictLines) {
      partial.forEach(i => {
        errors.push(`lines[${i}] 不是完整歌词行：${lines[i].jp}。逐句卡必须保留来源行的整句，不能缩小成词组或半句`);
      });
      if (song.nav?.find?.(n => n.id === 'lines')?.label !== '逐句精读') {
        errors.push('--strict-lines 要求 nav 中的 lines 板块显示为「逐句精读」');
      }
      if (!String(song.sec?.lines?.title || '').includes('逐句精读')) {
        errors.push('--strict-lines 要求 sec.lines.title 明确包含「逐句精读」');
      }
      if (!String(song.cta?.primary || '').includes('逐句精读')) {
        errors.push('--strict-lines 要求 cta.primary 明确包含「逐句精读」');
      }
    } else if (partial.length) {
      warns.push(`lines 中有 ${partial.length} 张卡不是完整歌词行；新建或重建逐句页时请运行 --strict-lines`);
    }

    const distinctLyrics = new Set(lyricTexts.map(l => l.text));
    const uncovered = [...distinctLyrics].filter(text => !seenCards.has(text));
    if (uncovered.length) {
      warns.push(`还有 ${uncovered.length} 个不同歌词行没有对应卡片；重复句可以复用讲解`);
    }
  }
}

const seenK = new Set();
vocab.forEach((v, i) => {
  if (!v.k || !v.r || !v.cn) errors.push(`vocab[${i}] 缺 k / r / cn`);
  if (!/^N[1-5]$/.test(v.lv || '')) errors.push(`vocab[${i}](${v.k}) 的 lv 必须是 N1–N5`);
  if (seenK.has(v.k + '|' + v.r)) warns.push(`vocab 重复：${v.k}`);
  seenK.add(v.k + '|' + v.r);
});

grammar.forEach((g, i) => {
  ['p', 'sub', 'form', 'mean', 'eg', 'warn'].forEach(f => {
    if (!g[f]) errors.push(`grammar[${i}] 缺 ${f}`);
  });
  if (!Array.isArray(g.examples) || g.examples.length < 2 || g.examples.length > 3) {
    errors.push(`grammar[${i}].examples 必须有 2–3 个例句`);
    return;
  }
  const seen = new Set();
  g.examples.forEach((e, j) => {
    if (!e || typeof e.jp !== 'string' || !e.jp.trim() || typeof e.tr !== 'string' || !e.tr.trim()) {
      errors.push(`grammar[${i}].examples[${j}] 缺日文 jp 或中文 tr`);
      return;
    }
    const text = e.jp.replace(/\[[^\]]*\]/g, '').replace(/\s/g, '');
    if (seen.has(text)) errors.push(`grammar[${i}].examples[${j}] 例句重复`);
    seen.add(text);
    if ((e.jp.match(/\[/g) || []).length !== (e.jp.match(/\]/g) || []).length) {
      errors.push(`grammar[${i}].examples[${j}] 注音 [ ] 不配对`);
    }
  });
});

/* 数据条：key 必须是已知指标，否则会显示 0 */
(song.stats || []).forEach((s, i) => {
  if (!s.label) errors.push(`stats[${i}] 缺 label`);
  if (s.key && !['lines', 'vocab', 'grammar'].includes(s.key)) {
    errors.push(`stats[${i}].key="${s.key}" 不认识（只能是 lines/vocab/grammar）`);
  }
});

/* 读图片像素尺寸（只认 PNG / JPEG / WebP），读不出就返回 null */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      if (buf.readUInt16BE(i + 2) < 2) break;
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF'
      && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = buf.toString('ascii', 12, 16);
    if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3FFF, h: buf.readUInt16LE(28) & 0x3FFF };
    if (fmt === 'VP8L') {
      const [b0, b1, b2, b3] = [buf[21], buf[22], buf[23], buf[24]];
      return {
        w: 1 + (((b1 & 0x3F) << 8) | b0),
        h: 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6))
      };
    }
    if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  }
  return null;
}

/* 封面：本地图片内联成 data URI，保证产物仍是单文件 */
if (song.meta && song.meta.cover && !COVER_KEYWORDS.has(song.meta.cover)
    && !/^(https?:|data:)/.test(song.meta.cover)) {
  const coverPath = song.meta.cover;
  if (!fs.existsSync(coverPath)) {
    errors.push(`meta.cover 图片不存在：${coverPath}`);
  } else {
    const ext = path.extname(coverPath).toLowerCase();
    const mime = {
      '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
      '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'
    }[ext] || 'image/jpeg';
    const buf = fs.readFileSync(coverPath);
    if (buf.length > 600 * 1024) {
      warns.push(`封面图 ${Math.round(buf.length / 1024)}KB，内联后页面会明显变大，建议压到 300KB 以内`);
    }
    const size = imageSize(buf);
    if (size && size.w && size.h) {
      if (Math.abs(size.w / size.h - 1) > 0.06) {
        const short = size.w < size.h ? '上下' : '左右';
        warns.push(`封面 ${size.w}×${size.h} 不是正方形，页面按方形裁切，会切掉${short}两侧，主体请居中`);
      }
      if (Math.min(size.w, size.h) < 600) {
        warns.push(`封面 ${size.w}×${size.h} 偏小，页面上会放大到约 378px 显示，600×600 以上才够清晰`);
      }
    }
    song.meta.cover = 'data:' + mime + ';base64,' + buf.toString('base64');
  }
}

if (errors.length) {
  console.error('✗ 校验未通过：');
  errors.forEach(e => console.error('  · ' + e));
  process.exit(1);
}

const stats = { lines: lines.length, vocab: vocab.length, grammar: grammar.length };
console.log(`✓ 校验通过  ${stats.lines} 句 / ${stats.vocab} 词 / ${stats.grammar} 语法`);
if (warns.length) {
  console.log('  提醒：');
  warns.slice(0, 20).forEach(w => console.log('  · ' + w));
}
if (checkOnly) process.exit(0);

/* ---------- 占位符替换 ---------- */
const getPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function fill(tpl, data) {
  const missing = new Set();
  const out = tpl.replace(/\{\{([\w.]+)\}\}/g, (m, key) => {
    const v = getPath(data, key);
    if (v === undefined) { missing.add(key); return ''; }
    if (Array.isArray(v)) return v.map(String).join('<br>');
    if (v === null) return '';
    return String(v);
  });
  return { out, missing };
}

let html = read(TEMPLATE, 'template.html');

/* 只有显式关闭全文时才裁剪；默认缺少全文由校验报错。 */
const OPTIONAL = ['lyrics'];
const dropSections = new Set(OPTIONAL.filter(k => MODULES[k] === false));
dropSections.forEach(k => {
  const before = html;
  html = html.replace(
    new RegExp('\\s*<!--[^>]*?-->\\s*<section[^>]*?id="' + k + '">[\\s\\S]*?</section>', 'g'), '');
  if (html === before) {
    html = html.replace(
      new RegExp('\\s*<section[^>]*?id="' + k + '">[\\s\\S]*?</section>', 'g'), '');
  }
});

/* 关闭的板块连数据一起剔除，避免无用的 JSON 占体积、源码里露出来 */
delete song.steps;
OPTIONAL.forEach(k => {
  if (dropSections.has(k)) {
    delete song[k];
    if (song.sec) delete song.sec[k];
  }
});
if (Array.isArray(song.nav)) {
  song.nav = song.nav.filter(n => !dropSections.has(n.id));
}

const filled = fill(html, song);
if (filled.missing.size) {
  console.error('✗ 模板里有数据没提供的占位符：');
  [...filled.missing].forEach(k => console.error('  · {{' + k + '}}'));
  process.exit(1);
}
html = filled.out;

/* meta.catalog 只供仓库根站点构建器使用，不写进单曲页面的运行数据。 */
if (song.meta) delete song.meta.catalog;

/* 注入资源（在占位符替换之后做，避免资源内容被二次替换） */
const safeJson = JSON.stringify(song).replace(/</g, '\\u003c');
html = html.replace('/*__CSS__*/', () => read(CSS, 'base.css'));
html = html.replace('/*__RENDER_JS__*/', () => read(RENDER, 'render.js'));
html = html.replace('__SONG_JSON__', () => safeJson);

/* ---------- 写出 ---------- */
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`✓ 已生成  ${outPath}  (${kb} KB)`);
