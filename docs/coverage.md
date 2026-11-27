# 掲載候補の調査表

掲載済みのパターンは [README の一覧](../README.md#パターン一覧) を参照。ここでは実測の有無と、候補を再現するときに比較する条件を記録します。掲載基準は [CONTRIBUTING](../CONTRIBUTING.md#掲載基準) にあります。

| 調査で見つかった候補 | 原因 | 比較条件と掲載判断 |
|---|---|---|
| 深い OFFSET ページング | 計算量の無駄 | 同一ページ、同じ主キー索引で比較し、深いページで約 1,888× を確認。[パターン掲載済み](../patterns/postgres-offset-pagination/) |
| ORM の N+1 | 非同期の直列化・余分なアクセス | 同じ親子データを 1+N 回で取得する場合と、バッチで取得する場合の発行 SQL 数と全体時間を比較。関連集約の比較とは別に測る。[Prisma Query Insights](https://docs.prisma.io/docs/query-insights) |
| 検索条件の関数適用で通常の索引を使えない | 計算量の無駄 | 同じ `lower(email)` の比較条件で、通常索引と式インデックスを比較。まず [PostgreSQL seq scan](../patterns/postgres-seq-scan/) の派生として扱う。[PostgreSQL 16 式インデックス](https://www.postgresql.org/docs/16/indexes-expressional.html) |
| 無索引の絞り込みとソート | 計算量の無駄 | `WHERE` と `ORDER BY` を満たす複合索引の有無を比較。読み取った行数、ソート方式、書き込み時のコストを記録。[SQLite Query Planning](https://sqlite.org/queryplanner.html)、[PostgreSQL 16 複合インデックス](https://www.postgresql.org/docs/16/indexes-multicolumn.html) |
| 大量 INSERT の行ごとのコミット | 非同期の直列化・重複処理 | 同じデータ・永続化条件で、行ごとのコミット、一括トランザクション、COPY を別々に測る。障害時の原子性が異なるため適用条件を明記。[PostgreSQL 16 Populating a Database](https://www.postgresql.org/docs/16/populate.html) |
| 独立リクエストのウォーターフォール | 非同期の直列化 | 同時に開始できる仕事と前の結果が必要な仕事を分ける。基本形は [sequential await](../patterns/sequential-await/) の応用。[TanStack Request Waterfalls](https://tanstack.com/query/latest/docs/framework/react/guides/request-waterfalls) |
| 同一キーの同時キャッシュミス | 重複処理 | 同時リクエストが全て再計算する場合と、1 件の処理を共有する場合を比較。キーが安定していても発生する。バックエンド呼び出し数と待ち時間、失敗の共有を計測対象にする。[Go singleflight](https://pkg.go.dev/golang.org/x/sync/singleflight) |
| ループ内の正規表現の再構築 | 重複処理 | [固定入力の再処理](../patterns/json-parse-in-loop/) の派生。入力分布と実装による再利用を考慮し、同じマッチ結果を維持する条件で計測する。[ECMA-262 RegExp](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexp-regular-expression-objects) |

## リポジトリ構成

現在はパターンのフォルダを平坦に置き、ルート README と [原因別ガイド](bottleneck-types.md) の両方から探せます。閲覧・実行に必要なファイルをパターンと同じ場所に置けば、Node と DB の違いを各パターンの手順に閉じ込められます。

| 構成案 | 利点 | 採用条件 |
|---|---|---|
| 平坦な `patterns/<slug>/` と原因別ガイド | 既存 URL を保ち、複数の原因にまたがる例にも別の入口を作れる | 現状の推奨。数値はパターン README に置き、上位の一覧からリンクする |
| `patterns/<カテゴリ>/<slug>/` | Git 上でカテゴリが可視化される | 分類が安定し、一覧だけではナビゲーションしにくい規模になったときに検討。既存 URL の移行が必要 |
| メタデータから一覧を生成する | カテゴリ、実行条件、リンクの重複更新を減らせる | パターン数や更新頻度が増え、手動同期の漏れが続くときに検討。DB と Node で同じランナーを強制する必要はない |
