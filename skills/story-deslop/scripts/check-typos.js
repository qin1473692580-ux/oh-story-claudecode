#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const USAGE = `Usage: node check-typos.js [--check] [--json] [--fail-on=blocking|all] <file...>

Detect common Chinese typos (错别字/形近字/音近字误用) via a curated fixed-string
dictionary of idioms and word pairs that are essentially always wrong regardless
of context. Grammar-dependent particles (的/地/得、了/着/过 等) need POS tagging
to judge reliably and are deliberately excluded — a fixed-string match on those
would mostly produce false positives, not real findings.

This is the FIRST script to run after a chapter is written, before
check-ai-patterns.js / check-degeneration.js / normalize-punctuation.js —
a typo is wrong regardless of style, so it should surface before any
style-level rewrite discussion starts.

Every finding is severity 'advisory': the script only reports a suspected
typo and its likely correct form, it never rewrites the file. Some hits can
be intentional stylization (e.g. a bare character used as a noun to echo a
running motif) rather than an actual typo — whoever applies this report must
confirm before changing anything, same policy as check-ai-patterns.js.

--fail-on=blocking never fails (this script has no blocking tier, only
advisory); --fail-on=all (default) exits 1 when any suspected typo is found,
so it can still gate a pipeline that wants a clean pass before continuing.`;

// 词典只收「几乎在任何语境下都是错的」固定搭配（成语/习惯词组的误写），
// 不收依赖词性判断才能确定对错的虚词（的/地/得 等），保持高精度、低误报。
// 格式：[错误写法, 正确写法, 可选备注]
const TYPO_DICTIONARY = [
  ['迫不急待', '迫不及待'],
  ['再接再励', '再接再厉'],
  ['一愁莫展', '一筹莫展'],
  ['世外桃园', '世外桃源'],
  ['美仑美奂', '美轮美奂'],
  ['不径而走', '不胫而走'],
  ['针贬时弊', '针砭时弊'],
  ['变本加利', '变本加厉'],
  ['床第之私', '床笫之私'],
  ['凤毛鳞角', '凤毛麟角'],
  ['山青水秀', '山清水秀'],
  ['既往不究', '既往不咎'],
  ['沉缅', '沉湎'],
  ['穿流不息', '川流不息'],
  ['一诺千斤', '一诺千金'],
  ['语无仑次', '语无伦次'],
  ['提钢挈领', '提纲挈领'],
  ['珊珊来迟', '姗姗来迟'],
  ['声名雀起', '声名鹊起'],
  ['出奇不意', '出其不意'],
  ['名符其实', '名副其实'],
  ['一如继往', '一如既往'],
  ['莫明其妙', '莫名其妙'],
  ['融汇贯通', '融会贯通'],
  ['言简意骇', '言简意赅'],
  ['察颜观色', '察言观色'],
  ['委屈求全', '委曲求全'],
  ['直接了当', '直截了当'],
  ['渡假', '度假', '"度假"才对；"渡"只用于渡河/渡人等跨越义'],
  ['即然', '既然'],
  ['既使', '即使'],
  ['姿式', '姿势'],
];

const EFFECTIVE_TYPO_PAIRS = TYPO_DICTIONARY.filter(([, correct]) => typeof correct === 'string');

const options = {
  json: false,
  files: [],
  failOn: 'all',
};

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === '--check') {
    // Accepted for symmetry with the other scripts; detection is always check-only.
  } else if (arg === '--json') {
    options.json = true;
  } else if (arg.startsWith('--fail-on=')) {
    const v = arg.slice('--fail-on='.length);
    if (v !== 'blocking' && v !== 'all') die(`--fail-on must be 'blocking' or 'all'`);
    options.failOn = v;
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

let failed = false;
const allFindings = [];

for (const file of options.files) {
  const fullPath = path.resolve(file);
  let input;
  try {
    input = fs.readFileSync(fullPath, 'utf8');
  } catch (error) {
    failed = true;
    if (!options.json) console.error(`${file}: unable to read (${error.message})`);
    continue;
  }

  const findings = scanDocument(input).map((finding) => ({ file, ...finding }));
  allFindings.push(...findings);
}

if (options.json) {
  process.stdout.write(`${JSON.stringify({ findings: allFindings }, null, 2)}\n`);
} else if (allFindings.length === 0) {
  console.log('未发现词典收录的常见错别字（词典仅覆盖高置信度固定搭配，不代表全文无错字，建议仍配合人工通读）。');
} else {
  for (const finding of allFindings) {
    console.log(`${finding.file}:${finding.line}:${finding.column}: [${finding.severity}] ${finding.type}: ${finding.message} (${finding.excerpt})`);
  }
}

if (failed) process.exit(2);
// 本脚本所有 finding 都是 advisory（没有 blocking 分级），--fail-on=blocking 因此
// 永远不触发失败退出码，只有默认的 --fail-on=all 会在发现疑似错别字时退出 1。
if (options.failOn === 'all' && allFindings.length > 0) process.exit(1);

function die(message) {
  console.error(message);
  console.error(USAGE.trimEnd());
  process.exit(2);
}

function scanDocument(input) {
  const lines = input.split(/\r?\n/);
  const findings = [];

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    for (const [wrong, correct, note] of EFFECTIVE_TYPO_PAIRS) {
      let searchFrom = 0;
      let hitIndex;
      while ((hitIndex = line.indexOf(wrong, searchFrom)) !== -1) {
        findings.push({
          line: lineNo,
          column: hitIndex + 1,
          type: 'known-typo',
          severity: 'advisory',
          message: `疑似错别字"${wrong}"，常见正确写法是"${correct}"${note ? '（' + note + '）' : ''}；请确认是否为有意为之的风格化写法后再决定要不要改，脚本不自动修改。`,
          excerpt: compact(line.slice(Math.max(0, hitIndex - 10), hitIndex + wrong.length + 10)),
        });
        searchFrom = hitIndex + wrong.length;
      }
    }
  });

  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}

function compact(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}
