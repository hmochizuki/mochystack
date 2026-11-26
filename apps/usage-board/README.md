# usage-board

Mac で動かしておき、iPad などのブラウザから Claude Code の使用状況を見るためのダッシュボードです。手元のファイルを読むだけで、外部にはデータを送りません。

## 起動

Node 22.18 以上が必要です。TypeScript のファイルは、Node の型除去機能でビルドせずに直接動かします。

```sh
cd apps/usage-board
node src/main.ts
```

`pnpm install` は、型検査（`pnpm typecheck`）とテスト（`pnpm test`）を動かすときだけ必要です。

| 環境変数 | 既定値 | 用途 |
| --- | --- | --- |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | セッションの記録と状態を読む場所 |
| `USAGE_BOARD_RATE_LIMITS_FILE` | `~/claude-queue/usage.json` | プランの残りを読むファイル |
| `USAGE_BOARD_HOST` | `127.0.0.1` | 待ち受けるアドレス。iPad から見るときは Tailscale の IP か `0.0.0.0` にする |
| `USAGE_BOARD_PORT` | `4317` | 待ち受けるポート |

`0.0.0.0` で待ち受けると、同じネットワークにいる誰でもセッション名とプロジェクト名を見られます。

## プランの残りの出どころ

Claude Code は、5時間枠と週の枠の使用率とリセット時刻を、statusline のコマンドの標準入力（`rate_limits`）にだけ渡します。ファイルには書き出しません。そのため、statusline のスクリプトで `rate_limits` に取得時刻を足して書き出しておき、このダッシュボードはそのファイルを読みます。

```sh
input=$(cat)
file="$HOME/claude-queue/usage.json"
rate_limits=$(printf '%s' "$input" | jq -c --argjson t "$(date +%s)" 'if .rate_limits then .rate_limits + {captured_at: $t} else empty end')
[ -n "$rate_limits" ] && printf '%s\n' "$rate_limits" > "$file.tmp" && mv "$file.tmp" "$file"
```

ファイルが無いとき、読めないときは、パネルに取得できない理由を出します。リセット時刻を過ぎた枠は、古い使用率を出さずに「リセット済み」と出します。

## 金額

金額は、トークン数に API の定価を掛けた推定額です。サブスクリプションの請求額ではありません。単価を登録していないモデルは金額に含めず、モデル名を表示します。単価は `src/pricing.ts` にあります。
