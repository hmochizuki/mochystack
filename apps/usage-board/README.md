# usage-board

Mac で動かしておき、iPhone や iPad のブラウザから Claude Code の使用状況を見るためのダッシュボードです。手元のファイルを読むだけで、外部にはデータを送りません。

画面は、iPhone SE の横向き（667×375）で1画面に収まるように作っています。出すのは、時計、プランの残り、Mac のメモリと CPU の使用率、今日の金額と14日間の推移、入力待ちのセッションと実行中のセッションの数です。日ごとの金額とリセットの時刻は、触れたときだけ出します。

メモリは `memory_pressure -Q` の空きの割合から、CPU は前の取得からの `os.cpus()` の時間の差から出します。Safari でホーム画面に追加すると、アドレスバーの無い全画面で開けます。

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
| `USAGE_BOARD_ALLOWED_HOSTS` | なし | ほかに受け付ける Host の名前（カンマ区切り）。Tailscale の MagicDNS の名前で開くときなどに足す |

Host ヘッダーの名前が次のどれでもないリクエストには 403 を返します。DNS リバインディングで、ほかのサイトのページからこのダッシュボードを読まれないようにするためです。

- `localhost`、`127.0.0.1`、`::1`
- 待ち受けるアドレス。`0.0.0.0` か `::` で待ち受けるときは、Mac のネットワークのアドレスすべて
- `USAGE_BOARD_ALLOWED_HOSTS` の名前

`0.0.0.0` か Tailscale の IP で待ち受けると、そのネットワークから届く人は誰でも、`/` と `/api/board` で次の情報を読めます。Host ヘッダーの確認はほかのサイトのページから読まれるのを防ぐだけで、ネットワークの中の人は止めません。

- セッションの名前、AI が付けた題名、プロジェクトのフォルダ名
- 入力待ちのセッションが待っている内容の文（`waitingFor`）
- サブエージェントの名前か説明、種類、モデル
- セッション ID、プロセス ID、サブエージェントの ID
- 日ごと・セッションごとのトークン数と推定金額、プランの残り
- Mac のメモリと CPU の使用率
- プランの残りのファイルが読めないときの理由に入る、そのファイルの絶対パス（既定の場所ではユーザー名を含む）
- 集計に失敗したときに 500 の応答で返すエラーの文

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
