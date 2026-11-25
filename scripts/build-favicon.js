#!/usr/bin/env node
/**
 * favicon.svg → favicon.ico（16 / 32 / 48 三档，PNG-in-ICO）。
 *
 *   node scripts/build-favicon.js
 *
 * 图标只有 favicon.svg 一份源文件：浏览器标签页走页面里内联的 SVG
 * （见 scripts/build-site.js 与技能里的 build.js），这里的 .ico 只是给
 * 老浏览器、抓取器和直接请求 /favicon.ico 的客户端兜底。
 *
 * 依赖系统的 rsvg-convert（brew install librsvg）。没装就跳过、不报错，
 * 免得把「生成图标」变成跑不通的构建前置条件。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'favicon.svg');
const OUT = path.join(ROOT, 'favicon.ico');
const SIZES = [16, 32, 48];

/** ICO 容器：6 字节头 + 每张图 16 字节目录项 + PNG 原始数据 */
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;

  images.forEach(({ size, png }, index) => {
    const at = index * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, at);
    dir.writeUInt8(size >= 256 ? 0 : size, at + 1);
    dir.writeUInt8(0, at + 2); // 调色板颜色数
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // color planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, dir, ...images.map(image => image.png)]);
}

function hasRsvg() {
  try {
    execFileSync('rsvg-convert', ['--version'], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

if (!fs.existsSync(SRC)) {
  console.error('✗ 找不到 favicon.svg');
  process.exit(1);
}

if (!hasRsvg()) {
  console.warn('  跳过 favicon.ico：本机没有 rsvg-convert（brew install librsvg）');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'favicon-'));
const images = [];
try {
  for (const size of SIZES) {
    const file = path.join(tmp, `favicon-${size}.png`);
    execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), SRC, '-o', file], { stdio: 'ignore' });
    images.push({ size, png: fs.readFileSync(file) });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const ico = packIco(images);
fs.writeFileSync(OUT, ico);

const kb = (ico.length / 1024).toFixed(1);
console.log(`✓ favicon.ico 已生成：${SIZES.join('/')} px，${kb} KB`);
