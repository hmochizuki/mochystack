# 出典

[catalog.md](catalog.md) の根拠に挙げた出典を並べる。どれも 2026-11-26 に開けることを確かめた。

## 作者の指摘

【指摘】は、このスキルの作者がエージェントの作った画面を直させた記録である。作者の Claude Code の会話の記録 197 セッションから、UI を直させた発話を読んで型に分けた。指摘の大半は1つの業務 Web アプリから出ている。記録は公開しない。カタログの例は同じ型を架空の画面に置き換えたものである。

## AI の出力の癖

- Anthropic「Improving frontend design through Skills」（2025-11）: https://claude.com/blog/improving-frontend-design-through-skills
- Anthropic cookbook（フロントエンドの見た目のプロンプト）: https://platform.claude.com/cookbook/coding-prompting-for-frontend-aesthetics
- Anthropic frontend-design スキル（2026-09 の版）: https://github.com/anthropics/claude-plugins-official/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md 。固定した版: https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/frontend-design/SKILL.md
- Adrian Krebs の計測（2026-04、約1,400〜1,590ページの DOM と computed style を判定）: https://www.adriankrebs.ch/blog/design-slop/
- GIGAZINE による Krebs の旧版の集計（癖ごとの割合）: https://www.gigazine.net/gsc_news/en/20260423-design-slop
- JCarterJohnson の Reddit の集計: https://github.com/JCarterJohnson/vibecoded-design-tells
- The Fountain Institute: https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui
- NN/g「AI prototyping」: https://www.nngroup.com/articles/ai-prototyping/
- NN/g「The AI sparkles icon problem」（2024）: https://www.nngroup.com/articles/ai-sparkles-icon-problem/
- Impeccable: https://github.com/pbakaus/impeccable
- Tremoloo: https://www.tremoloo.com/blog/how-to-make-ui-look-less-like-ai-slop
- heydamir/unslop: https://github.com/heydamir/unslop
- Kosta Canatselis: https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c

## デザインシステムとガイドライン

SmartHR Design System

- ライティングスタイル: https://smarthr.design/products/contents/writing-style/
- その他の UI テキスト: https://smarthr.design/products/contents/ui-text/app-writing/
- エラーメッセージ: https://smarthr.design/products/contents/error-messages/overview/
- 視覚的なグループ: https://smarthr.design/products/design-patterns/visual-grouping/
- フィードバック: https://smarthr.design/products/design-patterns/feedback/
- 削除ダイアログ: https://smarthr.design/products/design-patterns/delete-dialog/
- ワンクッションが必要な操作: https://smarthr.design/products/design-patterns/confirmation-step/
- FormControl: https://smarthr.design/products/components/form-control/
- Input: https://smarthr.design/products/components/input/
- 操作を表す語: https://smarthr.design/products/contents/idiomatic-usage/action/

デジタル庁デザインシステム（DADS）

- インプットテキスト: https://design.digital.go.jp/dads/components/input-text/usage/
- モーダルダイアログ: https://design.digital.go.jp/dads/components/modal-dialog/

GOV.UK

- Text input: https://design-system.service.gov.uk/components/text-input/
- Error message: https://design-system.service.gov.uk/components/error-message/
- A to Z style guide: https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/

NN/g

- Placeholders in form fields: https://www.nngroup.com/articles/form-design-placeholders/
- Confirmation dialogs: https://www.nngroup.com/articles/confirmation-dialog/
- Progress indicators: https://www.nngroup.com/articles/progress-indicators/
- Empty states: https://www.nngroup.com/articles/empty-state-interface-design/
- Indicators, validations, and notifications: https://www.nngroup.com/articles/indicators-validations-notifications/

そのほか

- Apple HIG Writing: https://developer.apple.com/design/human-interface-guidelines/writing
- Apple HIG Alerts: https://developer.apple.com/design/human-interface-guidelines/alerts
- Material 3 Text fields: https://m3.material.io/components/text-fields/guidelines
- Material 3 Dialogs: https://m3.material.io/components/dialogs/guidelines
- Material 3 Snackbar: https://m3.material.io/components/snackbar/guidelines
- Atlassian Empty state: https://atlassian.design/foundations/content/designing-messages/empty-state
- Atlassian Success messages: https://atlassian.design/foundations/content/designing-messages/success-messages
- Microsoft Style Guide Exclamation points: https://learn.microsoft.com/en-us/style-guide/punctuation/exclamation-points
- Mailchimp Content Style Guide: https://styleguide.mailchimp.com/grammar-and-mechanics/
- Google developer documentation style guide Word list: https://developers.google.com/style/word-list
- Ameba Spindle UI ラベリング: https://spindle.ameba.design/principles/contents/ui-labeling/
- WCAG 2.2 Use of Color（1.4.1）: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- WCAG 2.2 Link Purpose (In Context)（2.4.4）: https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html

## 仕組みを参考にしたスキル

文章とコードは写していない。仕組みの考え方だけを借りた。

- 癖が無ければ何も変えない判定と、直した後にテンプレートに戻る型: heydamir/unslop（CC BY 4.0）https://github.com/heydamir/unslop
- 規則そのものが生む癖（引きすぎ）の一覧: Leonxlnx/taste-skill https://github.com/Leonxlnx/taste-skill
- 引くのは情報で作りの厚みではない、という線と、日本語の文言を行で照合する検査: minorun365/unslop-ai-app https://github.com/minorun365/unslop-ai-app
- 差分が持ち込んだものだけを見る範囲: cursor/plugins の deslop https://github.com/cursor/plugins
- 候補を出すだけの検査と、決まった報告の形: yomiyasu https://github.com/nanaism/yomiyasu
