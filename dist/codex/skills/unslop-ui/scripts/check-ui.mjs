#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MARKUP = new Set([".tsx", ".jsx", ".vue", ".html", ".htm"]);
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage"]);
const CONFIG_JSON = /^(?:package(?:-lock)?|tsconfig.*|jsconfig|composer|turbo|vercel|renovate)\.json$/;
const USAGE = "使い方: node check-ui.mjs [--base <基点>] [ファイルかフォルダ ...]";

const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff\uff01-\uff60]/;
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;
const NON_TEXT_ATTRS =
  /^(?:class|className|style|href|src|id|key|name|type|to|as|variant|size|role|for|htmlFor|rel|target|lang|charset|method|action|inputMode|autoComplete|ref|model|v-model|v-if|v-else-if|v-for|v-show|data-[\w-]+)$/;

const PLACEHOLDER_INSTRUCTION =
  /してください|して下さい|Enter\s*(?:キー)?で|Shift|⌘|Ctrl\b|Cmd\b|クリック|タップ|押して|押すと|で改行|で送信|半角|全角|文字以内|文字以上|以内で|必須/;
const EXCLAMATION = /！|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]!|(?:^|\s)[A-Za-z]+!(?![\w=])/u;
const SPARKLE = /<(?:Sparkles?|SparklesIcon|IconSparkles|AutoAwesome(?:Icon)?)\b|✨|\bauto_awesome\b|[-_]sparkles?\b/;
const PURPLE_GRADIENT =
  /\b(?:from|via|to)-(?:purple|violet|indigo|fuchsia)-\d{2,3}\b|gradient\([^)]*(?:purple|violet|indigo|#(?:6366f1|4f46e5|8b5cf6|7c3aed|a855f7|9333ea|d946ef))/i;

const FIELD =
  /<(?:input(?![^>]*type=["'](?:hidden|submit|button|checkbox|radio|reset|image)["'])|textarea|select|Input|Textarea|TextArea|Select|TextField|TextInput|NumberInput|PasswordInput|DatePicker|Combobox|Autocomplete)\b/;
const HELPER_ELEMENT =
  /<(?:FormDescription|FormHelperText|HelperText|FieldDescription|Hint|small)\b|class(?:Name)?=["'`][^"'`]*\b(?:help|hint|helper|form-text|description)\b/;
const HELPER_PROP = /\b(?:helperText|description|hint|helpMessage|supplementaryMessage|caption)=/;
const MUTED_NOTE = /<(?:p|span|div)\b[^>]*class(?:Name)?=["'`][^"'`]*\btext-(?:xs|sm|muted|gray|slate|zinc|neutral|stone)\b/;
const ERROR_CONTEXT = /error|invalid|destructive|danger|FormMessage|text-red/i;
const SUCCESS_TOAST =
  /\$toast\b|(?<![\w$.])toast(?:\.(?:success|info|message|show))?\s*\(|\b(?:enqueueSnackbar|showToast|showSnackbar)\s*\(|\b(?:message|notification)\.(?:success|info)\s*\(/;
const NOT_SUCCESS_TOAST =
  /toast\.(?:error|warn|warning|dismiss|promise|loading)\b|error|warn|fail|失敗|できません|function\s+\w*[Tt]oast|(?:const|let|var)\s+\w*[Tt]oast\s*=/i;

const HEADING_ATTR = /title|heading|label|legend|header/i;
const HEADING_CODE = /<(?:h[1-6]|legend|label|th|caption|title)\b|(?:Title|Label)\b|class(?:Name)?=["'`][^"'`]*\b(?:title|heading)\b/;
const DESCRIPTION_ATTR = /description|subtitle|lead|caption|hint|help|summary|note|body/i;
const DESCRIPTION_CODE =
  /<(?:p|small)\b|Description\b|class(?:Name)?=["'`][^"'`]*\b(?:description|subtitle|lead|caption|hint|help|text-xs|text-sm|text-muted[\w-]*)\b/;
const HEADING_SUFFIX = /(?:一覧|リスト|管理|設定|画面|ページ|編集|追加|作成|詳細)$/;
const FILLER = [
  "しています", "できます", "ください", "します", "ました", "でき", "され", "ます", "です", "する", "して",
  "確認", "管理", "変更", "編集", "表示", "閲覧", "設定", "作成", "追加", "登録", "削除", "検索", "一覧", "選択", "入力", "参照",
  "見る", "こと", "ここ", "画面", "ページ", "を", "が", "は", "に", "へ", "と", "も", "で", "や",
];

const rule = (id, message, check) => ({ id, message, ...check });

export const RULES = [
  rule("copy-placeholder-instruction", "プレースホルダーに操作の説明か入力の条件がある", {
    segment: (s) => /placeholder$/i.test(s.attr ?? "") && PLACEHOLDER_INSTRUCTION.test(s.text),
  }),
  rule("copy-helper-every-field", "フォームのすべての欄に補足文が付いている", { file: helperEveryField }),
  rule("copy-restates-heading", "見出しやラベルを言い直すだけの説明文がある", { file: restatesHeading }),
  rule("copy-emoji", "画面の文字列に絵文字がある", { segment: (s) => EMOJI.test(s.text.replaceAll("✨", "")) }),
  rule("copy-exclamation", "画面の文言に感嘆符がある", { segment: (s) => EXCLAMATION.test(s.text) }),
  rule("copy-cheer", "呼びかけや挨拶の文言がある", {
    segment: (s) => /ましょう|ようこそ|さあ[、,]|Welcome back|Let['’]?s get started/i.test(s.text),
  }),
  rule("copy-kochira-link", "リンクの文字が「こちら」になっている", {
    segment: (s) => /^こちら$|はこちら|こちらから|こちらを(?:クリック|タップ|押|ご覧)/.test(s.text.trim()),
  }),
  rule("copy-error-apology", "エラーの文言で謝っている", {
    segment: (s) => /申し訳(?:ありません|ございません)|すみません|ごめんなさい|おっと|\b(?:Oops|Whoops|Sorry)\b/i.test(s.text),
  }),
  rule("copy-error-vague", "エラーの文言に、何が起きたかが書かれていない", {
    segment: (s) =>
      /^(?:エラーが発生しました|問題が発生しました|予期しないエラー|不明なエラー|Something went wrong|An error (?:has )?occurred)/i.test(
        s.text.trim(),
      ),
  }),
  rule("copy-are-you-sure", "確認の文言に、対象と結果が書かれていない", {
    segment: (s) => /本当に.{0,30}(?:ですか|ますか)|よろしいですか|Are you sure/i.test(s.text),
  }),
  rule("copy-verbose-honorific", "回りくどい敬語がある", { segment: (s) => /させていただ|することができ|することが可能/.test(s.text) }),
  rule("copy-empty-filler", "空の状態に、何が表示されるかの決まり文句がある", {
    segment: (s) => /ここに.{0,20}(?:表示され|表示します|並びます)/.test(s.text),
  }),
  rule("contrast-sparkle", "機能をきらめきのアイコンで示している", {
    line: (code) => !/^\s*import\b/.test(code) && SPARKLE.test(code),
  }),
  rule("contrast-gradient-text", "文字にグラデーションをかけている", {
    line: (code) => /\bbg-clip-text\b|background-clip\s*:\s*text/.test(code),
  }),
  rule("contrast-purple-gradient", "紫系のグラデーションを使っている", { line: (code) => PURPLE_GRADIENT.test(code) }),
  rule("interact-toast-every-action", "操作のたびに成功の通知を出している", { file: toastEveryAction }),
];

function stripComments(text) {
  let out = "";
  let state = "code";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === "line" || state === "block" || state === "html") {
      const end = state === "block" ? "*/" : state === "html" ? "-->" : "\n";
      if (text.startsWith(end, i)) {
        out += end === "\n" ? "\n" : " ".repeat(end.length);
        i += end.length - 1;
        state = "code";
      } else {
        out += c === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "string") {
      out += c;
      if (c === "\\" && text[i + 1] !== "\n") {
        out += text[i + 1] ?? "";
        i++;
      } else if (c === quote || (c === "\n" && quote !== "`")) {
        state = "code";
      }
      continue;
    }
    // https://… の `//` はコメントではないので、コロンの直後の `//` は文字のまま残す。
    if (text.startsWith("//", i) && text[i - 1] !== ":") state = "line";
    else if (text.startsWith("/*", i)) state = "block";
    else if (text.startsWith("<!--", i)) state = "html";
    if (state !== "code") {
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      state = "string";
      quote = c;
    }
    out += c;
  }
  return out;
}

function markupSegments(code, line) {
  const segments = [];
  const blanked = code.replace(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g, (literal, _quote, text, index) => {
    const before = code.slice(0, index);
    const after = code.slice(index + literal.length);
    const isImport = /\b(?:import|from|require)\s*\(?\s*$/.test(before);
    const isKey = /(?:^|[{,])\s*$/.test(before) && /^\s*:/.test(after);
    const attr = before.match(/([\w$@.:-]+)\s*[:=]\s*\{?\s*$/)?.[1]?.replace(/^(?:v-bind:|:|@)/, "");
    if (!isImport && !isKey && !(attr && NON_TEXT_ATTRS.test(attr))) segments.push({ line, text, attr, code });
    return " ".repeat(literal.length);
  });
  for (const match of blanked.matchAll(/(?:^|>)([^<>]*)(?=<|$)/g)) {
    const text = match[1].trim();
    const bounded = match[0].startsWith(">") && match.index + match[0].length < blanked.length;
    const readable = JAPANESE.test(text) || (bounded && /[A-Za-z]|\p{Extended_Pictographic}/u.test(text) && !/[;=(){}]/.test(text));
    if (text && readable) segments.push({ line, text, attr: undefined, code });
  }
  return segments;
}

function jsonSegments(code, line) {
  const segments = [];
  let key;
  for (const match of code.matchAll(/"((?:\\.|[^"\\])*)"(\s*:)?/g)) {
    let text = match[1];
    try {
      text = JSON.parse(`"${match[1]}"`);
    } catch {}
    if (match[2]) key = text;
    else segments.push({ line, text, attr: key, code });
  }
  return segments;
}

function parse(path, text) {
  const markup = MARKUP.has(extname(path).toLowerCase());
  const lines = (markup ? stripComments(text) : text).split("\n");
  const segments = lines.flatMap((code, i) => (markup ? markupSegments(code, i + 1) : jsonSegments(code, i + 1)));
  return { markup, lines, segments };
}

function helperEveryField({ markup, lines }) {
  if (!markup) return [];
  let fields = 0;
  let lastField = -Infinity;
  const helpers = [];
  lines.forEach((code, i) => {
    if (FIELD.test(code)) {
      fields++;
      lastField = i;
    }
    if (ERROR_CONTEXT.test(code)) return;
    const prop = HELPER_PROP.test(code) && i - lastField <= 6;
    const note = MUTED_NOTE.test(code) && i - lastField <= 4;
    if (HELPER_ELEMENT.test(code) || prop || note) helpers.push(i + 1);
  });
  return fields >= 3 && helpers.length >= fields ? helpers : [];
}

function toastEveryAction({ markup, lines }) {
  if (!markup) return [];
  const calls = lines.flatMap((code, i) => (SUCCESS_TOAST.test(code) && !NOT_SUCCESS_TOAST.test(code) ? [i + 1] : []));
  return calls.length >= 2 ? calls : [];
}

function normalize(text) {
  return text.replace(/[\s\p{P}\p{S}]/gu, "").replaceAll("の", "");
}

function restatesHeading({ lines, segments }) {
  const context = (s) => {
    const code = lines[s.line - 1];
    return code.includes("<") ? code : `${lines[s.line - 2] ?? ""}\n${code}`;
  };
  const isHeading = (s) => {
    const text = normalize(s.text);
    const short = text.length >= 2 && text.length <= 20 && !/[。！？!?]/.test(s.text);
    return short && (HEADING_ATTR.test(s.attr ?? "") || HEADING_CODE.test(`${lines[s.line - 2] ?? ""}\n${lines[s.line - 1]}`));
  };
  const isDescription = (s) => DESCRIPTION_ATTR.test(s.attr ?? "") || DESCRIPTION_CODE.test(context(s));
  const hits = [];
  segments.forEach((heading, i) => {
    if (!isHeading(heading)) return;
    const description = segments.slice(i + 1).find((s) => s.line - heading.line <= 4 && isDescription(s));
    if (!description || !/(?:。|ます|です|ください)$/.test(description.text.trim())) return;
    const whole = normalize(heading.text);
    const core = whole.replace(HEADING_SUFFIX, "").length >= 2 ? whole.replace(HEADING_SUFFIX, "") : whole;
    const body = normalize(description.text);
    if (!body.includes(core)) return;
    const rest = FILLER.reduce((left, word) => left.replaceAll(word, ""), body.replace(core, ""));
    if (rest.length <= 1) hits.push(description.line);
  });
  return hits;
}

export function scan(path, text) {
  const parsed = parse(path, text);
  const hits = new Map();
  const add = (line, { id }, excerpt) => {
    const key = `${line} ${id}`;
    if (!hits.has(key)) hits.set(key, { line, rule: id, excerpt });
  };
  for (const r of RULES) {
    if (r.segment) for (const s of parsed.segments) if (r.segment(s)) add(s.line, r, s.text);
    if (r.line) parsed.lines.forEach((code, i) => r.line(code) && add(i + 1, r, code));
    if (r.file) for (const line of r.file(parsed)) add(line, r, parsed.lines[line - 1]);
  }
  return [...hits.values()].sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

function scannable(path) {
  const ext = extname(path).toLowerCase();
  return MARKUP.has(ext) || (ext === ".json" && !CONFIG_JSON.test(basename(path)));
}

function walk(path) {
  if (!statSync(path).isDirectory()) return scannable(path) ? [path] : [];
  return readdirSync(path)
    .filter((name) => !name.startsWith(".") && !SKIPPED_DIRS.has(name))
    .flatMap((name) => walk(join(path, name)));
}

function git(args, cwd) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function changedLines(base, paths, cwd) {
  const top = git(["rev-parse", "--show-toplevel"], cwd).trim();
  const specs = paths.map((path) => relative(top, resolve(cwd, path)) || ".");
  // 基点のブランチの先端と比べると、分岐した後に基点の側だけが変えた行まで拾ってしまう。
  const fork = git(["merge-base", base, "HEAD"], top).trim();
  const changed = new Map();
  let current;
  const diff = ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", fork, "--", ...specs];
  for (const row of git(diff, top).split("\n")) {
    if (row.startsWith("+++ ")) {
      current = row === "+++ /dev/null" ? undefined : join(top, row.slice(6));
      if (current) changed.set(current, new Set());
      continue;
    }
    const hunk = row.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (hunk && current) {
      const [start, count] = [Number(hunk[1]), hunk[2] === undefined ? 1 : Number(hunk[2])];
      for (let line = start; line < start + count; line++) changed.get(current).add(line);
    }
  }
  for (const row of git(["ls-files", "--others", "--exclude-standard", "--", ...specs], top).split("\n")) {
    if (row) changed.set(join(top, row), "all");
  }
  return changed;
}

export function main(args, cwd) {
  const paths = [];
  let base;
  let unknown = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) base = args[++i];
    else if (args[i].startsWith("-")) unknown = true;
    else paths.push(args[i]);
  }
  if (unknown || (!base && paths.length === 0)) {
    console.error(USAGE);
    return 2;
  }

  let targets;
  if (base) {
    try {
      targets = [...changedLines(base, paths, cwd)].filter(([path]) => scannable(path) && existsSync(path));
    } catch (error) {
      console.error(`git で差分を取れませんでした: ${String(error.stderr ?? error.message).trim()}`);
      return 2;
    }
  } else {
    const missing = paths.filter((path) => !existsSync(resolve(cwd, path)));
    if (missing.length > 0) {
      console.error(`見つかりません: ${missing.join(", ")}`);
      return 2;
    }
    targets = paths.flatMap((path) => walk(resolve(cwd, path))).map((path) => [path, "all"]);
  }

  const shown = targets.map(([path, lines]) => [relative(cwd, path), path, lines]).sort(([a], [b]) => a.localeCompare(b));
  let count = 0;
  for (const [display, path, lines] of shown) {
    for (const hit of scan(path, readFileSync(path, "utf8"))) {
      if (lines !== "all" && !lines.has(hit.line)) continue;
      const { message } = RULES.find(({ id }) => id === hit.rule);
      const excerpt = hit.excerpt.trim().replace(/\s+/g, " ").slice(0, 60);
      console.log(`${display}:${hit.line}  ${hit.rule}  ${message}  「${excerpt}」`);
      count++;
    }
  }
  console.log(`\n${shown.length} ファイル、${count} 件の候補。候補は直す合図ではない。references/catalog.md のルールごとに判断する。`);
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2), process.cwd());
}
