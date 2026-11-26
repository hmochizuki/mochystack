# mochystack

[pstack](https://github.com/cursor/plugins/tree/main/pstack) を自分用に手直しした fork です。Claude Code のプラグインとして入れて使います。

## 導入

```bash
/plugin marketplace add hmochizuki/mochystack
/plugin install mochystack@mochystack
```

コマンドには `mochystack:` が付きます（`/mochystack:poteto-mode` など）。使い方は [core/README.md](./core/README.md) と [core/docs/guide/](./core/docs/guide/README.md) にあります。

## 構成

| 場所 | 中身 |
|---|---|
| `core/` | 手で直す元のファイル。上流の pstack をそのまま取り込み、そこに手を入れる |
| `dist/` | `core/` から生成するエージェント別の写し。手で直さない |
| `scripts/generate-harness-trees.mjs` | `dist/` を生成する。`--check` で `core/` と食い違っていないかを確かめる |
| `UPSTREAM.md` | 取り込んだ上流のコミットとバージョン |

`core/` を直したら `node scripts/generate-harness-trees.mjs` を実行し、`dist/` も一緒にコミットします。

## 上流との差

上流の更新を取り込みやすいように、`core/` への変更は小さく保ちます。

- スキルの本文は訳さず、Cursor の語彙のまま使う。エージェントごとの違いは `core/docs/harness/` の対応表で吸収する。
- 日本語の文章を推敲するときだけ、`unslop` から `yomiyasu` に、`technical-writing` から `japanese-tech-writing` と `yomiyasu` に回す。
- プラグイン名は `mochystack` にしている。

## ライセンス

MIT。上流の著作権表示は [core/LICENSE](./core/LICENSE) にあります。
