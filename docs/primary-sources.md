# 一次情報 hub（Tier 別 URL リスト + 引用規律）

本リポジトリのパターン解説・ベンチマーク・カテゴリ章で参照する外部 URL を Tier (信頼度階層) 別に集約する hub。

- 各カテゴリ解説 (`docs/bottleneck-types.md`)・各 pattern README の「参考」節・README.md の「参考リソース」節は本 hub を参照する形に統一する
- URL の更新・撤回が必要になったときは本 hub の 1 箇所を更新する (各所への個別反映は不要)
- 数値の引用は engine / V8 version / workload / n を併記する (詳細は §引用規律)

---

## 引用規律

1. **主題一致確認**: 引用元の主題 (記事の subject) と claim の主題が一致しているか起票・追記前にチェックする
2. **engine / version / workload 明示**: 数値を引用する場合は engine / V8 version / workload / n / warmup を併記する。単一値の断言は避ける
3. **Tier 表記**: Tier 1 (公式 / spec) > Tier 2 (公式 team member) > Tier 3 (信頼性ある二次) > Tier 4 (理論) の階層で扱う
4. **engine 横断挙動は「実装収束」と表現**: 「JIT 仕様」「全 engine で同じ」は overclaim。SpiderMonkey / JavaScriptCore も類似機構を持つが閾値・命名は engine 別
5. **誤帰属の撤回**: 後から誤帰属が発覚した場合は「撤回 / 慎重扱い」セクションに明記する (削除ではなく)

---

## Tier 1: V8 公式 (primary)

| URL | 主題 |
|---|---|
| [v8.dev/blog/elements-kinds](https://v8.dev/blog/elements-kinds) | Elements Kinds の 2D lattice (packedness × 型特化) と一方向遷移、PACKED → HOLEY 退化、`Array.prototype.fill` の 2025-02-28 限定例外 |
| [v8.dev/blog/fast-properties](https://v8.dev/blog/fast-properties) | hidden class / dictionary mode 退化、IC fast-path が dictionary mode で機能しない理由 |
| [v8.dev/docs/hidden-classes](https://v8.dev/docs/hidden-classes) | hidden class の独立 documentation |
| [v8.dev/blog/spread-elements](https://v8.dev/blog/spread-elements) | spread element の position-sensitive 最適化 (元記事の microbenchmark で約 3× 改善報告、条件は元記事参照) |
| [v8.dev/blog/react-cliff](https://v8.dev/blog/react-cliff) | shape-cliff、「don't optimize for a specific version」警告 |
| [v8.dev/blog/jitless](https://v8.dev/blog/jitless) | `--jitless` モード (Ignition のみ動作) |
| [v8.dev/blog/maglev](https://v8.dev/blog/maglev) | Maglev mid-tier JIT (**escape analysis を持たない**設計、TurboFan より軽量、Sparkplug より積極的) |
| [v8.dev/blog/v8-release-65](https://v8.dev/blog/v8-release-65) | V8 6.5: JSCallReducer による `forEach` inlining |
| [v8.dev/blog/ignition-interpreter](https://v8.dev/blog/ignition-interpreter) | Ignition bytecode、`FunctionKind` 分岐 |

## Tier 1: ECMA-262 (spec)

| URL | 主題 |
|---|---|
| [tc39.es §23.1.3.23](https://tc39.es/ecma262/#sec-array.prototype.push) | `Array.prototype.push` (current draft §23.1.3.23) |
| [tc39.es §23.1.3.37](https://tc39.es/ecma262/#sec-array.prototype.unshift) | `Array.prototype.unshift` (current draft §23.1.3.37 / ES2022 §23.1.3.32) |

注: section 番号は仕様改訂で再番号化される。引用時は draft / edition 年を併記する。

## Tier 2: V8 team member / 著名 perf エンジニア

| URL | 主題 |
|---|---|
| [mathiasbynens.be — shapes-ics](https://mathiasbynens.be/notes/shapes-ics) | shapes / IC の包括解説 (Mathias Bynens, V8 team) |
| [mathiasbynens.be — array-fill-undefined](https://mathiasbynens.be/notes/javascript-array-fill-undefined) | array holes と HOLEY kind 退化 |
| [mrale.ph — monomorphism](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html) | monomorphism / IC (V8 team, 2015 時点。Crankshaft → TurboFan 移行前の解説) |
| [benediktmeurer.de — v8-tup-2-0](https://benediktmeurer.de/2018/03/23/v8-tup-2-0/) | 4-way polymorphic ≈ 1.4× の根拠 (TurboFan, 2018) |

## Tier 3: 信頼性ある二次情報

| URL | 主題 |
|---|---|
| [builder.io — monomorphic-javascript](https://www.builder.io/blog/monomorphic-javascript) | IC monomorphic / polymorphic / megamorphic 数値報告例 (Hevery 2022。元記事の条件・microbenchmark 形式を併読) |
| [leanylabs.com — foreach-map-reduce](https://leanylabs.com/blog/js-foreach-map-reduce-vs-for-for_of/) | `forEach` / `map` / `reduce` 計測 (1M objects、Node v16 系。元記事の version 表記参照) |
| [stackinsight.dev — 40-repository scan](https://stackinsight.dev/blog/loop-performance-empirical-study) | 実コードベース 40 リポジトリでの出現頻度調査 |
| [richsnapp.com — reduce-spread](https://www.richsnapp.com/article/2019/06-09-reduce-spread-anti-pattern) | reduce + spread が V8 バイトコードレベルで O(n²) になる理由 |
| [romgrk.com — optimizing-javascript](https://romgrk.com/posts/optimizing-javascript) | V8 内部最適化の俯瞰 (補助参照、一次断定には使わない) |
| [MDN: Promise.all()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) | 並列実行のセマンティクスと注意点 (rejection / iterable / 結果順序) |
| [github.com/davidmarkclements/v8-perf](https://github.com/davidmarkclements/v8-perf) | V8 6.0 / 6.1 fast path、Node コミュニティ参照 (旧バージョン情報) |
| [Tomoharu Tsutsumi — How to Avoid O(N²)](https://tomoharutsutsumi.medium.com/how-to-avoid-o-n%C2%B2-60eaa61f523a) | ループ内線形探索の解説 (Medium、日本語コミュニティ参照) |

## Tier 4: アルゴリズム理論

| 出典 | 主題 |
|---|---|
| CLRS "Introduction to Algorithms" §17.4 Aggregate method | dynamic table 解析 — `push` amortized O(1) の理論根拠 |
| [Bugzilla #1348772](https://bugzilla.mozilla.org/show_bug.cgi?id=1348772) | SpiderMonkey `shift` O(1) 化議論 — 「O(n) は仕様要件ではない (実装収束)」根拠 |
| [Big-O Cheat Sheet](https://www.bigocheatsheet.com/) | 各データ構造・操作の計算量リファレンス |

---

## 撤回 / 慎重扱い

| 出典 | 理由 |
|---|---|
| ~~puzpuzpuz gist `d7b3e6c…`~~ | 主題が Fastify Web throughput 計測 (約 2.8× 差) で **Array Elements Kinds 劣化測定ではない**。本リポジトリ過去議論 ([Issue #10](https://github.com/824ysuk/benchmark-antipatterns/issues/10)) で誤帰属が発覚したため撤回 |
| Medium / dev.to の単発記事 (generator 1.45×、`filter().map()` 1.55× 等) | engine / V8 version / workload / n が開示されておらず portable な数値として引用不可。条件を補える場合のみ Tier 3 扱いで個別引用 |

---

## 主題 → 根拠 URL 早見表

レビュー時にどの URL を引くべきかの逆引き索引。

| 主題 | 主に参照する Tier / URL |
|---|---|
| ループ内線形探索 / O(n²) | T3 [stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) / T3 [Tomoharu Tsutsumi](https://tomoharutsutsumi.medium.com/how-to-avoid-o-n%C2%B2-60eaa61f523a) / T4 [Big-O Cheat Sheet](https://www.bigocheatsheet.com/) |
| `reduce` + spread が O(n²) | T3 [richsnapp.com](https://www.richsnapp.com/article/2019/06-09-reduce-spread-anti-pattern) |
| 非同期の直列化 / `Promise.all` | T3 [MDN: Promise.all()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) / T3 [stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) |
| 重複処理 / ループ不変式 | T3 [stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) / T3 [romgrk.com](https://romgrk.com/posts/optimizing-javascript) |
| Elements Kinds 退化 | T1 [elements-kinds](https://v8.dev/blog/elements-kinds) / T2 [array-fill-undefined](https://mathiasbynens.be/notes/javascript-array-fill-undefined) |
| hidden class / IC | T1 [fast-properties](https://v8.dev/blog/fast-properties) / T1 [hidden-classes (docs)](https://v8.dev/docs/hidden-classes) / T2 [shapes-ics](https://mathiasbynens.be/notes/shapes-ics) / T2 [monomorphism](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html) |
| IC monomorphic vs poly vs mega の数値 | T3 [builder.io](https://www.builder.io/blog/monomorphic-javascript) (Hevery 2022、条件込み) / T2 [v8-tup-2-0](https://benediktmeurer.de/2018/03/23/v8-tup-2-0/) (4-way ≈ 1.4×) |
| `push` / `unshift` 仕様 | T1 ECMA-262 [§23.1.3.23](https://tc39.es/ecma262/#sec-array.prototype.push) / [§23.1.3.37](https://tc39.es/ecma262/#sec-array.prototype.unshift) / T4 CLRS §17.4 (amortized) |
| `shift` O(1) 化の妥当性 | T4 [Bugzilla #1348772](https://bugzilla.mozilla.org/show_bug.cgi?id=1348772) |
| Maglev mid-tier の制約 | T1 [maglev](https://v8.dev/blog/maglev) (escape analysis なし) |
| `--jitless` / Lite mode | T1 [jitless](https://v8.dev/blog/jitless) |
| `forEach` inlining | T1 [v8-release-65](https://v8.dev/blog/v8-release-65) |
| spread element 最適化 | T1 [spread-elements](https://v8.dev/blog/spread-elements) |

---

## 参照規約 (各 docs / pattern README からの参照)

- `docs/bottleneck-types.md` の各カテゴリ末尾「### 一次情報」節は、本 hub の主題 → 根拠 URL 早見表で該当主題行へ誘導する形に統一
- `README.md` 末尾「## 参考リソース」節は、Tier 1-4 を要約 + 本 hub への導線
- `patterns/<slug>/README.md` の「## 参考」節は、カテゴリ解説 (`docs/bottleneck-types.md`) + 本 hub への導線とし、URL を pattern README に再掲しない (重複・更新漏れ防止)
- 例外: pattern 固有の numerical claim (例「N=10,000 で X× の改善が観測された」) の根拠 URL は pattern 自身の「## 参考」節 or 「## 実測値」表 cell に inline で残す
