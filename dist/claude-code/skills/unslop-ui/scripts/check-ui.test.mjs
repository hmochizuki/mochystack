import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES, scan } from "./check-ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "check-ui.mjs");
const FIXTURES = join(HERE, "fixtures");

function found(path, text) {
  return scan(path, text).map(({ line, rule }) => `${line} ${rule}`);
}

function fixture(name) {
  return found(name, readFileSync(join(FIXTURES, name), "utf8"));
}

test("プレースホルダーの操作説明と書式の条件を拾い、入力例と欄の名前は拾わない", () => {
  assert.deepEqual(found("a.tsx", `<input placeholder="メールアドレスを入力してください" />`), ["1 copy-placeholder-instruction"]);
  assert.deepEqual(found("a.tsx", `<Textarea placeholder="Shift+Enter で改行" />`), ["1 copy-placeholder-instruction"]);
  assert.deepEqual(found("ja.json", `{\n  "namePlaceholder": "全角で入力"\n}`), ["2 copy-placeholder-instruction"]);
  assert.deepEqual(found("a.tsx", `<input placeholder="例：山田 太郎" />`), []);
  assert.deepEqual(found("a.tsx", `<input placeholder="キーワードで検索" />`), []);
  assert.deepEqual(found("a.tsx", `<input placeholder="Enter your name" />`), []);
  assert.deepEqual(found("a.tsx", `<p>Enter で送信します</p>`), []);
});

test("3つ以上の欄のすべてに補足文が付いたフォームだけを拾う", () => {
  const shadcn = ["件名", "金額", "メモ"]
    .map((label) => `<FormLabel>${label}</FormLabel>\n<Input />\n<FormDescription>${label}の説明です。</FormDescription>`)
    .join("\n");
  assert.deepEqual(found("a.tsx", shadcn), [
    "3 copy-helper-every-field",
    "6 copy-helper-every-field",
    "9 copy-helper-every-field",
  ]);

  const mui = [1, 2, 3].map((n) => `<TextField label="項目${n}" helperText="項目${n}の補足" />`).join("\n");
  assert.deepEqual(found("a.tsx", mui), ["1 copy-helper-every-field", "2 copy-helper-every-field", "3 copy-helper-every-field"]);

  const plain = [1, 2, 3].map((n) => `<input name="f${n}" />\n<p className="text-sm text-gray-500">補足${n}</p>`).join("\n");
  assert.deepEqual(found("a.html", plain.replaceAll("className", "class")), [
    "2 copy-helper-every-field",
    "4 copy-helper-every-field",
    "6 copy-helper-every-field",
  ]);

  const oneHelper = `<Input />\n<FormDescription>補足</FormDescription>\n<Input />\n<Input />`;
  assert.deepEqual(found("a.tsx", oneHelper), []);

  const errors = [1, 2, 3].map((n) => `<TextField label="項目${n}" helperText={errors.f${n}?.message} />`).join("\n");
  assert.deepEqual(found("a.tsx", errors), []);

  const twoFields = `<Input />\n<FormDescription>補足</FormDescription>\n<Input />\n<FormDescription>補足</FormDescription>`;
  assert.deepEqual(found("a.tsx", twoFields), []);
});

test("画面の文字列の絵文字を拾い、記号とコメントは拾わない", () => {
  assert.deepEqual(found("a.tsx", `<h2>🎉 完了</h2>`), ["1 copy-emoji"]);
  assert.deepEqual(found("ja.json", `{\n  "saved": "保存しました ✅"\n}`), ["2 copy-emoji"]);
  assert.deepEqual(found("a.tsx", `<p>⚠️ 期限切れ</p>`), ["1 copy-emoji"]);
  assert.deepEqual(found("a.tsx", `<span>✓ 保存済み</span>`), []);
  assert.deepEqual(found("a.tsx", `// 🚀 あとで直す\nconst a = 1;`), []);
});

test("きらめきのアイコンを拾い、import の行は拾わない", () => {
  assert.deepEqual(found("a.tsx", `<Sparkles className="h-4 w-4" />`), ["1 contrast-sparkle"]);
  assert.deepEqual(found("a.tsx", `<SparklesIcon />`), ["1 contrast-sparkle"]);
  assert.deepEqual(found("a.vue", `<span class="material-symbols-outlined">auto_awesome</span>`), ["1 contrast-sparkle"]);
  assert.deepEqual(found("a.tsx", `<p>✨ 新機能</p>`), ["1 contrast-sparkle"]);
  assert.deepEqual(found("a.tsx", `import { Sparkles } from "lucide-react";`), []);
});

test("グラデーションの文字と紫系のグラデーションを別のルールで拾う", () => {
  assert.deepEqual(found("a.tsx", `<h1 className="bg-clip-text text-transparent bg-gradient-to-r from-sky-500 to-blue-600">`), [
    "1 contrast-gradient-text",
  ]);
  assert.deepEqual(found("a.html", `<style>h1 { -webkit-background-clip: text; }</style>`), ["1 contrast-gradient-text"]);
  assert.deepEqual(found("a.tsx", `<div className="bg-gradient-to-br from-violet-600 to-sky-400">`), ["1 contrast-purple-gradient"]);
  assert.deepEqual(found("a.vue", `.hero { background: linear-gradient(90deg, #6366f1, #a855f7); }`), ["1 contrast-purple-gradient"]);
  assert.deepEqual(found("a.tsx", `<div className="bg-clip-padding bg-indigo-500">`), []);
});

test("画面の文言の感嘆符を拾い、コードの ! は拾わない", () => {
  assert.deepEqual(found("a.tsx", `<p>保存しました！</p>`), ["1 copy-exclamation"]);
  assert.deepEqual(found("a.tsx", `toast("Saved!");`), ["1 copy-exclamation"]);
  assert.deepEqual(found("a.tsx", `<div className="!mt-0 p-4!">`), []);
  assert.deepEqual(found("a.tsx", `{!open && <p>閉じています</p>}`), []);
  assert.deepEqual(found("a.tsx", `if (a !== b) return user!.name;`), []);
  assert.deepEqual(found("a.tsx", `// 注意！\nconst a = 1;`), []);
  assert.deepEqual(found("a.tsx", `{/* <p>保存しました！</p> */}`), []);
});

test("呼びかけと挨拶を拾う", () => {
  assert.deepEqual(found("a.tsx", `<h1>さあ、始めましょう</h1>`), ["1 copy-cheer"]);
  assert.deepEqual(found("a.tsx", `<h1>ようこそ</h1>`), ["1 copy-cheer"]);
  assert.deepEqual(found("a.tsx", `<p>予約を始めます</p>`), []);
});

test("「こちら」のリンクを拾い、指示語の「こちらの」は拾わない", () => {
  assert.deepEqual(found("a.tsx", `<a href="/x">こちら</a>`), ["1 copy-kochira-link"]);
  assert.deepEqual(found("a.tsx", `<p>詳しくは<Link href="/x">こちら</Link></p>`), ["1 copy-kochira-link"]);
  assert.deepEqual(found("ja.json", `{\n  "guide": "手順はこちら"\n}`), ["2 copy-kochira-link"]);
  assert.deepEqual(found("a.tsx", `<p>こちらの会議室は禁煙です</p>`), []);
});

test("謝るエラーと、何が起きたかを書かないエラーを拾う", () => {
  assert.deepEqual(found("a.tsx", `<p>申し訳ございません。保存できませんでした。</p>`), ["1 copy-error-apology"]);
  assert.deepEqual(found("a.tsx", `<p>Oops, the upload failed</p>`), ["1 copy-error-apology"]);
  assert.deepEqual(found("a.tsx", `<p>保存できませんでした。通信を確認してください。</p>`), []);
  assert.deepEqual(found("a.tsx", `<p>エラーが発生しました</p>`), ["1 copy-error-vague"]);
  assert.deepEqual(found("a.tsx", `<p>Something went wrong</p>`), ["1 copy-error-vague"]);
  assert.deepEqual(found("a.tsx", `<p>ファイルの読み込みでエラーが発生しました。CSV の形式を確認してください。</p>`), []);
});

test("対象を書かない確認の文言を拾う", () => {
  assert.deepEqual(found("a.tsx", `<p>本当に削除しますか？</p>`), ["1 copy-are-you-sure"]);
  assert.deepEqual(found("a.tsx", `<p>よろしいですか？</p>`), ["1 copy-are-you-sure"]);
  assert.deepEqual(found("a.tsx", `<p>Are you sure?</p>`), ["1 copy-are-you-sure"]);
  assert.deepEqual(found("a.tsx", `<p>3件の予約を削除しますか？この操作は元に戻せません。</p>`), []);
});

test("回りくどい敬語と、空の状態の決まり文句を拾う", () => {
  assert.deepEqual(found("a.tsx", `<p>送信させていただきます</p>`), ["1 copy-verbose-honorific"]);
  assert.deepEqual(found("a.tsx", `<p>変更することができます</p>`), ["1 copy-verbose-honorific"]);
  assert.deepEqual(found("a.tsx", `<p>変更できます</p>`), []);
  assert.deepEqual(found("a.tsx", `<p>ここに予約が表示されます</p>`), ["1 copy-empty-filler"]);
  assert.deepEqual(found("a.tsx", `<p>検索結果がここに表示されます</p>`), ["1 copy-empty-filler"]);
  assert.deepEqual(found("a.tsx", `<p>予約はまだありません</p>`), []);
});

test("見出しやラベルを言い直すだけの説明文を拾い、新しい情報のある説明文は拾わない", () => {
  assert.deepEqual(found("a.tsx", `<h2>通知設定</h2>\n<p>通知の設定を変更できます。</p>`), ["2 copy-restates-heading"]);
  assert.deepEqual(found("ja.json", `{\n  "title": "メンバー一覧",\n  "description": "メンバーを一覧で確認できます。"\n}`), [
    "3 copy-restates-heading",
  ]);
  assert.deepEqual(found("a.tsx", `<label>メールアドレス</label>\n<input />\n<small>メールアドレスを入力してください。</small>`), [
    "3 copy-restates-heading",
  ]);
  assert.deepEqual(found("a.tsx", `<h2>請求書</h2>\n<p>毎月25日に締め、翌月10日に発行します。</p>`), []);
  assert.deepEqual(found("a.tsx", `<h2>メンバー</h2>\n<p>メンバーの権限を変更できます。</p>`), []);
  assert.deepEqual(found("a.tsx", `<label>パスワード</label>\n<input />\n<small>パスワードは8文字以上で入力してください。</small>`), []);
});

test("操作のたびに出す成功の通知を、ファイルに2つ以上あるときだけ拾う", () => {
  assert.deepEqual(found("a.tsx", `toast.success("保存しました");\nfoo();\ntoast.success("削除しました");`), [
    "1 interact-toast-every-action",
    "3 interact-toast-every-action",
  ]);
  assert.deepEqual(found("a.tsx", `enqueueSnackbar("保存しました");\nenqueueSnackbar("複製しました");`), [
    "1 interact-toast-every-action",
    "2 interact-toast-every-action",
  ]);
  assert.deepEqual(found("a.tsx", `const { toast } = useToast();\ntoast({ title: "コピーしました" });`), []);
  assert.deepEqual(found("a.tsx", `toast.error("保存できませんでした");\ntoast.error("削除できませんでした");`), []);
  assert.deepEqual(found("a.html", `<button onclick="showToast('error')">\n<button onclick="showToast('warning')">`), []);
  assert.deepEqual(found("a.tsx", `showToast("保存できませんでした");\nshowToast("通信に失敗しました");`), []);
  assert.deepEqual(found("a.tsx", `function showToast(message) {}\nshowToast("コピーしました");`), []);
  assert.deepEqual(found("a.tsx", `const showToast = (message) => {};\nshowToast("コピーしました");`), []);
});

test("AI っぽい見本の画面から、決まった候補を拾う", () => {
  assert.deepEqual(fixture("expense-form.tsx"), [
    "11 copy-exclamation",
    "11 interact-toast-every-action",
    "15 copy-are-you-sure",
    "17 interact-toast-every-action",
    "23 contrast-gradient-text",
    "23 contrast-purple-gradient",
    "26 copy-restates-heading",
    "29 contrast-sparkle",
    "41 copy-placeholder-instruction",
    "43 copy-helper-every-field",
    "57 copy-helper-every-field",
    "69 copy-placeholder-instruction",
    "71 copy-helper-every-field",
    "76 copy-cheer",
    "76 copy-emoji",
    "76 copy-exclamation",
    "80 copy-kochira-link",
    "82 copy-error-apology",
    "83 copy-error-vague",
  ]);
  assert.deepEqual(fixture("ja.json"), [
    "3 copy-cheer",
    "3 copy-exclamation",
    "8 copy-restates-heading",
    "9 copy-placeholder-instruction",
    "10 copy-empty-filler",
    "11 copy-kochira-link",
    "12 copy-are-you-sure",
    "13 copy-verbose-honorific",
    "21 copy-error-vague",
    "22 copy-error-apology",
    "22 copy-exclamation",
  ]);
  assert.deepEqual(fixture("room-booking.vue"), [
    "5 copy-restates-heading",
    "7 contrast-sparkle",
    "10 copy-placeholder-instruction",
    "14 copy-empty-filler",
    "16 copy-are-you-sure",
    "24 contrast-purple-gradient",
    "25 contrast-gradient-text",
  ]);
  assert.deepEqual(fixture("reports.html"), [
    "9 contrast-sparkle",
    "10 copy-restates-heading",
    "19 copy-kochira-link",
    "20 copy-emoji",
    "20 copy-exclamation",
  ]);
});

test("直した後の見本の画面からは、何も拾わない", () => {
  assert.deepEqual(fixture("expense-form.clean.tsx"), []);
});

test("スクリプトが出すルールは、カタログにスクリプトの検出として載っているものと一致する", () => {
  const catalog = readFileSync(join(HERE, "..", "references", "catalog.md"), "utf8");
  const scripted = [...catalog.matchAll(/^### ([a-z-]+)\n(?:(?!### )[\s\S])*?- 検出: check-ui\.mjs/gm)].map((m) => m[1]);
  assert.deepEqual([...RULES.map(({ id }) => id)].sort(), [...scripted].sort());
});

function run(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
}

test("引数がなければ使い方を出して終了コード2で終わる", () => {
  const result = run([], HERE);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /使い方/);
});

test("候補があっても終了コード0で終わり、1件を1行で出す", () => {
  const result = run(["fixtures"], HERE);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^fixtures\/ja\.json:12 {2}copy-are-you-sure {2}/m);
  assert.match(result.stdout, /^fixtures\/room-booking\.vue:25 {2}contrast-gradient-text {2}/m);
  assert.match(result.stdout, /5 ファイル、42 件の候補/);
});

function repo() {
  const root = mkdtempSync(join(tmpdir(), "unslop-ui-"));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root });
  git("init", "-q");
  writeFileSync(join(root, "a.tsx"), `<p>保存しました！</p>\n`);
  writeFileSync(join(root, "c.tsx"), `<p>コピーしました！</p>\n`);
  git("add", ".");
  git("commit", "-q", "-m", "base");
  writeFileSync(join(root, "a.tsx"), `<p>保存しました！</p>\n<p>削除しました！</p>\n`);
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "sub", "b.tsx"), `<h1>🎉 完了</h1>\n`);
  return root;
}

test("--base を付けると、基点から足した行と、追跡していないファイルだけを見る", () => {
  const root = repo();
  try {
    const fromRoot = run(["--base", "HEAD"], root);
    assert.equal(fromRoot.status, 0);
    assert.deepEqual(fromRoot.stdout.match(/^\S+:\d+ {2}[a-z-]+/gm), ["a.tsx:2  copy-exclamation", "sub/b.tsx:1  copy-emoji"]);

    const fromSub = run(["--base", "HEAD"], join(root, "sub"));
    assert.deepEqual(fromSub.stdout.match(/^\S+:\d+ {2}[a-z-]+/gm), ["../a.tsx:2  copy-exclamation", "b.tsx:1  copy-emoji"]);

    const onlySub = run(["--base", "HEAD", "sub"], root);
    assert.deepEqual(onlySub.stdout.match(/^\S+:\d+ {2}[a-z-]+/gm), ["sub/b.tsx:1  copy-emoji"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--base の基点が無ければ終了コード2で終わる", () => {
  const root = repo();
  try {
    const result = run(["--base", "no-such-ref"], root);
    assert.equal(result.status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
