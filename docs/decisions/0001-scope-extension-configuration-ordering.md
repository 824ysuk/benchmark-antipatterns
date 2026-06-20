# 0001: scope を「構成順序」カテゴリに拡張する

- **Status**: Accepted
- **Date**: 2026-06-20
- **関連 Issue**: [#16](https://github.com/824ysuk/benchmark-antipatterns/issues/16), [#8](https://github.com/824ysuk/benchmark-antipatterns/issues/8)

## Context

本リポジトリの README は scope を「アルゴリズム・レベルのパターン」に限定し、「フレームワーク固有の最適化・ネットワーク・メモリ管理・React 最適化」を明示的に対象外と書いてきた。

一方で 2 つの追加提案 issue が、scope 境界の見直しを要求している:

- [#16](https://github.com/824ysuk/benchmark-antipatterns/issues/16): Express の `compression()` middleware を route handler より後ろに `app.use()` で登録すると silent に egress 圧縮が無効化される。実測 25.76× の wire-size 差。
- [#8](https://github.com/824ysuk/benchmark-antipatterns/issues/8): Prisma のネスト `include` でカルテシアン爆発が起きる。実測 41×〜79×。

どちらも以下を満たす:

1. 実測 9× 以上の改善
2. 根本原因は「フレームワーク API の構造的 footgun」 (Express の linear chain / Prisma の eager loading)
3. 再現に外部ランタイム (Express + compression / Prisma + DB) を要する
4. 既存 3 カテゴリ (計算量の無駄 / 非同期の直列化 / 重複処理) の判別フローで全て No

scope を維持したまま却下する選択肢もあったが、silent failure の実害規模 (egress 課金・帯域消費・query timeout) が大きく、「アルゴリズム改善はないが構造的に重要な問題」を取りこぼすことになる。

## Decision

scope を以下のように拡張する:

1. **新カテゴリ「構成順序」を追加**: middleware / plugin / 登録順依存の構造で、登録順序を間違えると silent に機能が無効化されるパターンを対象に含める。
2. **改善指標を拡張**: 既存の elapsed time に加えて、**wire-size (egress bytes)** と **RPS (requests/sec)** も「9× 改善」基準の対象指標とする。
3. **採用判断は個別**: 「フレームワーク固有」「ネットワーク」を一律対象外とする扱いを止め、各 issue ごとに「構成順序起源 + silent failure + 9× 以上の実害」が揃うかで判定する。

本 PR では #16 (Express compression ordering) を最初の構成順序パターンとして採用。#8 (Prisma カルテシアン) は本 decision を precedent として後続 PR で個別判断する。

## Rationale

- **silent failure の実害**: Express の compression ordering miss は 25.76× の egress 増 → CDN/LB の egress 課金・モバイル/WAN 帯域の体感劣化に直結する。production で観測されない (loopback では bad の方が速いため CI でも気付けない) 構造のため、知識として明文化しないと再発する。
- **構造的 footgun の射程**: Express の `app.use()` linear chain は「ひとつの順序付きリストで parse・auth・log・compress・route・error を全部表現する」設計のため、本パターン以外にも同型 (helmet を CSP 上書き route より下に置く / express.static を compression より上に置く 等) が将来発生する。1 つカテゴリとして常設しておく方が、その都度の scope 議論を避けられる。
- **指標拡張の根拠**: 「9× 改善」基準は payload の I/O / 計算 / 帯域 のいずれを潰した結果でも意味がある。指標を elapsed time に限定すると loopback bench で測れる対象しか掲載できず、ネットワーク帯域 / DB IO bound の問題が排除される。
- **scope 拡張のリスク管理**: 構成順序カテゴリは「silent failure + 9×」という二条件を併せて課す。「フレームワーク固有」を一般化したわけではなく、観測可能なエラー / 警告が出るタイプのフレームワーク設定ミスは引き続き対象外。

## Consequences

### 採用するもの

- `docs/bottleneck-types.md` の判別フローを 3 問 → 4 問に拡張、「## 構成順序」節を新設
- `CONTRIBUTING.md` の掲載基準で改善指標を「elapsed time / wire-size / RPS のいずれか」に明文化、テンプレに `**指標**:` 行を追加
- `README.md` の scope 節に構成順序起源パターン採用の注記、パターン一覧テーブルに行追加
- `patterns/express-compression-ordering/` を最初の構成順序パターンとして追加

### 棄却するもの

- 「フレームワーク固有」「ネットワーク」を全面解禁する案 — silent failure や 9× の制約を外すと、レビューが収束しなくなる
- React / メモリ管理を同時に scope 内化する案 — 別 issue が立ったときに改めて判断する

### 後続の対応

- [#8](https://github.com/824ysuk/benchmark-antipatterns/issues/8) (Prisma カルテシアン) を構成順序とは別軸の「eager loading explosion」として、本 decision の precedent で再評価する
- 構成順序の他例 (helmet ordering / express.static ordering 等) が議論される際は、本 decision の二条件 (silent failure + 9× 改善) を判定基準にする

## 懐疑論点への応答

採用前に以下の論点を fact-based に検討した。応答を ADR に残す:

| 論点 | 応答 |
|---|---|
| production の reverse proxy (Nginx/Cloudflare) gzip で改善比が薄れる | proxy が前段 gzip する構成では Express→proxy 区間の wire-size のみ影響。proxy→client 区間は独立。Express を直接 public 公開する構成 (small app / serverless) では full 25.76× が効く。パターン README の「注意・例外」で明記する |
| 既存パターンは elapsed time、本件は wire-size で指標不整合 | 本 decision で指標を 3 種に拡張。パターン一覧テーブルの「改善比」列を「指標」付きで表示する (例: `25.76× wire-size`) |
| loopback TTLB は bad の方が速い | これは loopback の帯域無制限 + gzip CPU コストによる loopback 特有の現象。実回線では逆転する。README の「注意・例外」で明記する |
| HTTP/2 環境は unverified | issue 本文の通り unverified のまま明記。今後の追検証で更新する |
| silent failure 主張は `curl -D -` で observable | パターン README に「検出方法」セクションを新設し、`curl` / integration test での Content-Encoding header 検証手順を提示。「silent だが知っていれば検出可」を明確化する |
