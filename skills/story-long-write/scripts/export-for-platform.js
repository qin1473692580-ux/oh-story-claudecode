#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const USAGE = `Usage: node export-for-platform.js [--out=<dir>] [--join-blank-line] <file...>

把 正文/第XXX章_*.md 批量转成"标题+正文"分离的纯文本，方便复制粘贴进平台的章节编辑器
（番茄小说、晋江等创作后台通常没有对外开放的自动发布 API，这一步只做格式转换，
不做登录、不做提交、不碰任何账号凭证——发布仍需作者本人在平台后台手动操作）。

参数：
  <file...>           正文 md 文件路径，支持多个；也可以直接把 正文/*.md 的 glob 结果传进来
  --out=<dir>          输出目录，默认 ./导出/
  --join-blank-line    段落间插入空行输出（默认不插入，保持源文件的单换行紧凑排版；
                        部分平台编辑器粘贴单换行文本会挤成一段，此时开这个开关更稳）

行为：
  - 每个输入文件生成一个同名 .txt，标题行（"###第X章 章名" 或 "## 第X章 章名"）单独取出
    作为文件首行（去掉 markdown 前缀），空一行后是正文
  - 不修改、不校验正文内容本身；发布前的质量检查仍走 check-ai-patterns.js /
    check-degeneration.js 这两个脚本，本脚本只管格式搬运
  - 同时生成一个 汇总.txt，把所有章节按文件名顺序拼在一起，方便一次性通读检查`;

const options = {
  out: './导出',
  joinBlankLine: false,
  files: [],
};

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--out=')) {
    options.out = arg.slice('--out='.length);
  } else if (arg === '--join-blank-line') {
    options.joinBlankLine = true;
  } else if (arg === '-h' || arg === '--help') {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  } else if (arg.startsWith('-')) {
    die(`Unknown option: ${arg}`);
  } else {
    options.files.push(arg);
  }
}

if (options.files.length === 0) {
  die('No files provided');
}

fs.mkdirSync(options.out, { recursive: true });

const summaryParts = [];
let converted = 0;

for (const file of options.files) {
  const fullPath = path.resolve(file);
  let input;
  try {
    input = fs.readFileSync(fullPath, 'utf8');
  } catch (error) {
    console.error(`${file}: unable to read (${error.message})`);
    continue;
  }

  const { title, paragraphs } = parseChapter(input);
  if (!title) {
    console.error(`${file}: 未找到章节标题行（形如 "###第X章 章名" 或 "## 第X章 章名"），跳过`);
    continue;
  }

  const sep = options.joinBlankLine ? '\n\n' : '\n';
  const body = paragraphs.join(sep);
  const output = `${title}\n\n${body}\n`;

  const baseName = path.basename(file, path.extname(file));
  const outPath = path.join(options.out, `${baseName}.txt`);
  fs.writeFileSync(outPath, output, 'utf8');
  console.log(`${file} -> ${outPath}（标题：${title}，${paragraphs.length} 段）`);

  summaryParts.push(output);
  converted += 1;
}

if (converted > 0) {
  const summaryPath = path.join(options.out, '汇总.txt');
  fs.writeFileSync(summaryPath, summaryParts.join('\n\n---\n\n'), 'utf8');
  console.log(`\n共导出 ${converted} 章，汇总文件：${summaryPath}`);
}

function parseChapter(input) {
  const lines = input.split(/\r?\n/);
  let title = null;
  const paragraphs = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (title === null && /^#{1,6}\s*第[零一二三四五六七八九十百千万\d]+章/.test(trimmed)) {
      title = trimmed.replace(/^#{1,6}\s*/, '');
      continue;
    }

    paragraphs.push(trimmed);
  }

  return { title, paragraphs };
}

function die(message) {
  console.error(message);
  console.error(USAGE.trimEnd());
  process.exit(2);
}
