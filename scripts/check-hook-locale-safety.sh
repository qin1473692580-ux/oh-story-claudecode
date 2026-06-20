#!/bin/bash
# check-hook-locale-safety.sh — 守卫部署 hook 在 Windows 中文 GBK 区域下的字节安全。
#
# 背景（issue #164 同类）：部署 hook 跑在用户 Windows Git Bash。若用户导出 GBK/GB2312
# 区域设置，gawk/GNU sed/GNU grep 和 bash 通配会把 UTF-8 中文内容/路径按多字节错误解码，
# 让守卫静默失效（误拦或漏检）。治法是在 hook 里 `export LC_ALL=C` 走字节匹配。
#
# 本守卫是 locale 无关的静态检查（任何 CI 环境都能跑），与行为级回归
# scripts/test-hook-encoding-portable.sh（在真实 GBK 区域下端到端跑 hook）互补。
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "Error: not in a git repository"
  exit 1
fi
HOOKS_DIR="$REPO_ROOT/skills/story-setup/references/templates/hooks"

echo "Hook locale-safety Guard"
echo "========================"

fail=0

# Check 1：所有处理中文内容/路径的部署 hook 必须 export LC_ALL=C，在 GBK 区域下走字节匹配。
# 含内嵌 python 的 hook（guard-outline/validate-story-commit）export 位置另有讲究（见各文件注释），
# 但都必须出现该 export。新增 hook 一并加入清单。
LOCALE_SENSITIVE_HOOKS="detect-story-gaps guard-outline-before-prose validate-story-commit session-start session-end pre-compact post-compact"
for h in $LOCALE_SENSITIVE_HOOKS; do
  f="$HOOKS_DIR/$h.sh"
  if [ ! -f "$f" ]; then
    echo "FAIL: 预期的 locale 敏感 hook 不存在：$h.sh"
    fail=1
    continue
  fi
  if ! grep -qE '^[[:space:]]*export[[:space:]]+LC_(ALL|CTYPE)=C\b' "$f"; then
    echo "FAIL: $h.sh 缺少 export LC_ALL=C（GBK 区域下中文匹配会乱，issue #164 同类）"
    fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "OK: locale 敏感 hook 均已 export LC_ALL=C"

# Check 2：禁止在部署 hook 的正则里用含全角字符的方括号字符组（如 [：:]）。含全角字符的
# 字符组只有 UTF-8 区域才正确，在 C/GBK 区域会被拆成单字节、漏匹配；必须改用交替 (：|:)。
# 用字节匹配检测 `[` 紧跟全角冒号/分号/逗号/句号等常见全角标点；跳过整行注释。
BRACKET_HITS="$(LC_ALL=C grep -rnE '\[[^]]*(：|；|，|。|！|？|、)' "$HOOKS_DIR"/*.sh 2>/dev/null \
  | grep -vE ':[0-9]+:[[:space:]]*#' || true)"
if [ -n "$BRACKET_HITS" ]; then
  echo "FAIL: 部署 hook 正则里出现含全角字符的方括号字符组（C/GBK 区域会漏匹配，改用交替 (A|B)）："
  echo "$BRACKET_HITS"
  fail=1
else
  echo "OK: 未发现含全角字符的方括号字符组"
fi

# Check 3：lib/common.sh 被多个未 export LC_ALL=C 的 hook（session-*/pre-compact/post-compact）
# 复用，其处理中文书名/路径的 sed/grep 必须 per-command 加 LC_ALL=C，否则 GBK 下 trim 会报
# illegal byte sequence、.active-book 被吞空、误解析到 find 的第一本书。
COMMON="$HOOKS_DIR/lib/common.sh"
if [ -f "$COMMON" ]; then
  # 单文件 grep -n 输出是 LINENO:content（无文件名前缀），注释行用 ^[0-9]+:[[:space:]]*# 剔除。
  BARE_TEXT_TOOL="$(grep -nE '(^|[^=[:alnum:]_])(sed|grep)[[:space:]]' "$COMMON" 2>/dev/null \
    | grep -vE 'LC_ALL=C' | grep -vE '^[0-9]+:[[:space:]]*#' || true)"
  if [ -n "$BARE_TEXT_TOOL" ]; then
    echo "FAIL: lib/common.sh 有未加 LC_ALL=C 的 sed/grep（GBK 下处理中文书名会乱）："
    echo "$BARE_TEXT_TOOL"
    fail=1
  else
    echo "OK: lib/common.sh 的 sed/grep 均已 LC_ALL=C"
  fi
fi

exit "$fail"
