# 一次情報 hub

各 pattern / docs が参照する V8 公式 / ECMA-262 / 著名 perf 文書を Tier 別に集約します。読者が「この主題はどの信頼度で裏付けられているか」を即座に判断できるよう、各 URL に Tier ラベル（T1〜T4）を付けています。

各 pattern README の「参考」節と `docs/bottleneck-types.md` の「一次情報」節はこの hub への参照に統一し、URL を pattern 側に再掲しません（重複削減・更新点の単一化）。

---

## 引用規律

本 repo で一次情報を引用するときの 4 原則。**起票・PR 起案前にチェックする**。

1. **主題一致確認**: 引用元の subject（記事の主題）と claim の subject が一致しているかを確認する。記事タイトルや見出しを読まずに URL を貼らない。
2. **数値は条件付きで引用**: engine / engine version / workload / n / warmup を併記する。「X× 速い」の単一値断言は避け、「Node v22 / V8 12.x / n=10,000 / 10 warmup で X× 報告例」の形にする。
3. **engine 横断は「実装収束」と表現**: 「JIT 仕様」「全 engine で同じ」と書かない。「現行の主要 engine 実装で収束している」「V8 / SpiderMonkey で同様の挙動が報告されている」のように、仕様要件と実装慣行を区別する。
4. **撤回は削除でなく明記**: 後から誤帰属が判明した出典は **削除せず**「[撤回 / 慎重扱い](#撤回--慎重扱い)」節に残し、撤回理由を書く（同じ誤りの再発を防ぐため）。

---

## Tier 1: V8 公式 (primary)

V8 team が直接執筆・公開している blog / docs。本 repo での最高信頼度。

| URL | 主題 |
|---|---|
| [v8.dev/blog/elements-kinds](https://v8.dev/blog/elements-kinds) | Elements Kinds の一方向遷移、PACKED → HOLEY の退化、`Array.prototype.fill` の例外（2025-02-28 時点で `new Array(n).fill(0)` は PACKED_SMI_ELEMENTS を維持） |
| [v8.dev/blog/fast-properties](https://v8.dev/blog/fast-properties) | hidden class、dictionary mode への退化条件、IC が dictionary mode を吸収しない理由 |
| [v8.dev/docs/hidden-classes](https://v8.dev/docs/hidden-classes) | hidden class の独立 documentation（blog より短く要点をまとめた reference） |
| [v8.dev/blog/spread-elements](https://v8.dev/blog/spread-elements) | spread element の position-sensitive 最適化（元記事の microbenchmark で約 3× 改善報告。条件は元記事参照） |
| [v8.dev/blog/react-cliff](https://v8.dev/blog/react-cliff) | shape-cliff、"don't optimize for a specific version" 警告（version 固有最適化への依存禁止） |
| [v8.dev/blog/jitless](https://v8.dev/blog/jitless) | `--jitless` モード（Ignition のみ動作、TurboFan / Maglev / Sparkplug 無効） |
| [v8.dev/blog/maglev](https://v8.dev/blog/maglev) | Maglev mid-tier JIT。**escape analysis を持たない**設計、TurboFan より軽量。「Maglev は EA する」は誤り |
| [v8.dev/blog/v8-release-65](https://v8.dev/blog/v8-release-65) | V8 6.5 で `JSCallReducer` が `forEach` を inlining 可能になった経緯 |
| [v8.dev/blog/ignition-interpreter](https://v8.dev/blog/ignition-interpreter) | Ignition bytecode、`FunctionKind` 分岐 |

## Tier 1: ECMA-262 (spec)

TC39 が公開する JavaScript 仕様。本 repo での「仕様要件」の唯一の根拠。

| URL | 主題 |
|---|---|
| [tc39.es §23.1.3.37](https://tc39.es/ecma262/#sec-array.prototype.unshift) | `Array.prototype.unshift`（current draft §23.1.3.37 / ES2022 §23.1.3.32） |
| [tc39.es §23.1.3.23](https://tc39.es/ecma262/#sec-array.prototype.push) | `Array.prototype.push`（current draft §23.1.3.23） |

注: ECMA-262 section 番号は draft 改訂で再番号化される。引用時は **current draft の番号と edition 年を両方併記**する（例: `§23.1.3.37 (current draft) / §23.1.3.32 (ES2022)`）。引用日も併記すると将来の差分追跡が楽になる。

---

## Tier 2: V8 team member / 著名 perf エンジニア (primary 相当)

V8 team の現職・元職メンバーが個人 blog で発表した記事。Tier 1 に準じて信頼するが、執筆時点の V8 バージョン（Crankshaft → TurboFan → Maglev の世代差）を確認すること。

| URL | 主題 |
|---|---|
| [mathiasbynens.be — shapes-ics](https://mathiasbynens.be/notes/shapes-ics) | shapes / IC の包括解説（Mathias Bynens, V8 team） |
| [mathiasbynens.be — array-fill-undefined](https://mathiasbynens.be/notes/javascript-array-fill-undefined) | array holes と HOLEY kind 退化 |
| [mrale.ph — monomorphism](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html) | monomorphism / IC（V8 team, 2015 時点。**Crankshaft → TurboFan 移行前**の文脈に注意） |
| [benediktmeurer.de — v8-tup-2-0](https://benediktmeurer.de/2018/03/23/v8-tup-2-0/) | 4-way polymorphic ≈ 1.4× の根拠（TurboFan, 2018 時点。Maglev 登場前） |

---

## Tier 3: 信頼性ある二次情報

公式 team 外の執筆者だが、計測条件・コード・engine version を開示している記事。**条件を必ず併読して引用する**。

| URL | 主題 |
|---|---|
| [builder.io — monomorphic-javascript](https://www.builder.io/blog/monomorphic-javascript) | IC monomorphic / polymorphic / megamorphic 数値報告例（Hevery 2022。元記事の microbenchmark 形式・engine version を必ず併読） |
| [leanylabs.com — foreach-map-reduce](https://leanylabs.com/blog/js-foreach-map-reduce-vs-for-for_of/) | `forEach` / `map` / `reduce` 計測（1M objects、Node v16 系。元記事の version 表記参照） |
| [stackinsight.dev — 40-repository scan](https://stackinsight.dev/blog/loop-performance-empirical-study) | 実コードベース 40 リポジトリでの出現頻度調査 |
| [richsnapp.com — reduce-spread](https://www.richsnapp.com/article/2019/06-09-reduce-spread-anti-pattern) | reduce + spread が V8 バイトコードレベルで O(n²) になる理由 |
| [romgrk.com — optimizing-javascript](https://romgrk.com/posts/optimizing-javascript) | V8 内部最適化の俯瞰（補助参照。一次断定には使わない） |
| [github.com/davidmarkclements/v8-perf](https://github.com/davidmarkclements/v8-perf) | V8 6.0 / 6.1 fast path、Node コミュニティ参照（旧バージョン情報。current V8 と差異あり） |

---

## Tier 4: アルゴリズム理論

engine 実装に依存しない理論的根拠。URL がない書籍（CLRS 等）はそのまま書名を引用する。

| 出典 | 主題 |
|---|---|
| CLRS *Introduction to Algorithms* §17.4 Aggregate method（書籍。URL なし） | dynamic table 解析 — `push` amortized O(1) の理論根拠 |
| [Bugzilla #1348772](https://bugzilla.mozilla.org/show_bug.cgi?id=1348772) | SpiderMonkey `shift` O(1) 化議論 — 「O(n) は仕様要件ではない（実装収束）」根拠 |
| [Big-O Cheat Sheet](https://www.bigocheatsheet.com/) | 各データ構造・操作の計算量リファレンス |
| [MDN: Promise.all()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) | 並列実行のセマンティクスと注意点（仕様補助。Tier 1 の ECMA-262 §27.2.4.3 を補う） |

---

## 撤回 / 慎重扱い

過去に本 repo で引用していたが、誤帰属・条件不足が判明した出典。**削除せず明記**する（同じ誤りの再発防止）。

| 出典 | 撤回 / 慎重扱いの理由 |
|---|---|
| ~~puzpuzpuz gist `d7b3e6c…`~~ (https://gist.github.com/puzpuzpuz/d7b3e6ca17baa241848ff1d15bce87aa) | 主題が **Fastify Web throughput 計測（約 2.8× 差）** で、**Array Elements Kinds 劣化の測定ではない**。本 repo の Issue #10 草稿で Elements Kinds 劣化の根拠として誤帰属していたため撤回。今後同 gist を Array Elements Kinds の根拠としては引用しない |
| Medium / dev.to の単発記事（generator 1.45×、`filter().map()` 1.55× 等の引用例） | engine / V8 version / workload / n / warmup が開示されておらず portable な数値として引用不可。条件を補えば Tier 3 として扱う余地はあるが、補えない限り引用しない |

---

## 主題 → 根拠 URL 早見表

pattern や docs で「この主題の根拠は？」と聞かれたときに参照する一覧。各行の Tier 表記が信頼度を示します。

| 主題 | 主に参照する Tier / URL |
|---|---|
| Elements Kinds 退化 | T1 [elements-kinds](https://v8.dev/blog/elements-kinds) / T2 [array-fill-undefined](https://mathiasbynens.be/notes/javascript-array-fill-undefined) |
| `Array.prototype.fill` の例外（2025-02-28 時点） | T1 [elements-kinds](https://v8.dev/blog/elements-kinds)（`new Array(n).fill(0)` が PACKED_SMI を維持する条件は元記事参照） |
| hidden class / IC | T1 [fast-properties](https://v8.dev/blog/fast-properties) / T1 [hidden-classes](https://v8.dev/docs/hidden-classes) / T2 [shapes-ics](https://mathiasbynens.be/notes/shapes-ics) / T2 [monomorphism](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html) |
| IC monomorphic vs polymorphic vs megamorphic の数値 | T3 [builder.io](https://www.builder.io/blog/monomorphic-javascript)（Hevery 2022、条件込み） / T2 [v8-tup-2-0](https://benediktmeurer.de/2018/03/23/v8-tup-2-0/)（4-way ≈ 1.4×、TurboFan 2018） |
| `push` / `unshift` 仕様 | T1 ECMA-262 [§23.1.3.23 push](https://tc39.es/ecma262/#sec-array.prototype.push) / [§23.1.3.37 unshift](https://tc39.es/ecma262/#sec-array.prototype.unshift) / T4 CLRS §17.4（amortized） |
| `shift` O(1) 化の妥当性 | T4 [Bugzilla #1348772](https://bugzilla.mozilla.org/show_bug.cgi?id=1348772)（実装収束、仕様要件ではない） |
| reduce + spread が O(n²) | T3 [richsnapp.com](https://www.richsnapp.com/article/2019/06-09-reduce-spread-anti-pattern) |
| Maglev mid-tier の制約 | T1 [maglev](https://v8.dev/blog/maglev)（**escape analysis を持たない**、TurboFan より軽量） |
| `--jitless` / Lite mode | T1 [jitless](https://v8.dev/blog/jitless)（Ignition のみ動作） |
| `forEach` inlining | T1 [v8-release-65](https://v8.dev/blog/v8-release-65)（V8 6.5 で `JSCallReducer` 経由） |
| ループ性能の実証スキャン | T3 [stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) |
| 非同期並列化（`Promise.all`） | T4 [MDN: Promise.all](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all)（補助。仕様は ECMA-262 §27.2.4.3） |
| reduce + spread / loop-invariant の解説 | T3 [richsnapp.com](https://www.richsnapp.com/article/2019/06-09-reduce-spread-anti-pattern) / T3 [romgrk.com](https://romgrk.com/posts/optimizing-javascript)（V8 がループ不変式を自動で外に出さないケース） |

---

## 規律補足

本 hub を更新するときの運用ルール。

- 全 URL は Issue [#14](https://github.com/824ysuk/benchmark-antipatterns/issues/14) の整理表と整合させる（追加・撤回時は Issue 側にも反映）。
- Tier 4 の CLRS は **書籍として明記**し URL を書かない（オンライン版に確定的な permalink がないため）。
- 撤回情報は削除しない（再発防止のため履歴を残す）。
- ECMA-262 の section 番号は **current draft の番号** を使う（`§23.1.3.37 unshift` / `§23.1.3.23 push`）。`section 番号 + edition 年` 併記が望ましい。
- `Array.prototype.fill` 例外の引用日は **2025-02-28**（v8.dev/blog/elements-kinds の挙動が確認された日付）として記載する。挙動が変わった場合は日付を更新する。
- Maglev は **escape analysis を持たない**。「Maglev が EA する」は誤りなので採用しない。
- ワークフロー Run ID（`wf_…`）は出典として書かない。検討経緯のメタ情報は Issue #14 の「検討経緯」節に閉じる。

---

## カテゴリ別の引用付き解説

カテゴリ別の解説と検出シグナルは [docs/bottleneck-types.md](bottleneck-types.md) を参照してください。同 docs の「一次情報」節は本 hub への参照に統一されています（URL は本 hub 側で管理）。

各 pattern README の「参考」節は本 hub の Tier X / 主題 → 根拠 URL 早見表を参照する形に統一し、URL を pattern README に再掲しません（重複削減・更新漏れ防止）。pattern 固有の実測値は pattern 内の §実測値表に inline で残します。
