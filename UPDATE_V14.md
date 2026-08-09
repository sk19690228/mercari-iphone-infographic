# v14 修正内容

- v13で削除した旧Amazon URL登録機能 `suggestAmazonAffiliateFromRegistry()` の残存呼び出しを削除。
- 「新着通知メールを検索・おすすめ決定」実行後の `ReferenceError: suggestAmazonAffiliateFromRegistry is not defined` を修正。
- Gmail通知取得 → 候補比較 → 商品採用 → Amazon整備済み品URL入力 → GAS経由のAmazon価格取得 → ⑤投稿文への価格反映、の流れを維持。
- 「Amazon整備済み品URL登録（iPhone 16シリーズ）」は削除済み。
- Amazon URL登録用 `amazon-urls.json` は不要になったため、Service Workerのキャッシュ対象からも削除。
- 中古平均価格のGAS保存機能は維持。
- JavaScript / Code.gs の構文チェック済み。
