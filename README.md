# Original-Tools / OpenSpec Workspace

このリポジトリは、OpenSpec 形式で「区間タイマー（作業/休憩のインターバル実行）」を設計するためのワークスペースです。

## 現在の状態

- 実装コードはまだありません（仕様・設計・タスク定義の段階）。
- 進行中の変更は `add-interval-timer` です。
- 要件は 2 つの capability に分割されています。
  - `interval-schedule`
  - `countdown-timer`

## ディレクトリ構成

```text
openspec/
  config.yaml
  changes/
    add-interval-timer/
      proposal.md
      design.md
      tasks.md
      specs/
        countdown-timer/
          spec.md
        interval-schedule/
          spec.md
```

## 変更サマリー: add-interval-timer

### 目的

固定ポモドーロではなく、ユーザーが自由に区間を設計できるカウントダウンタイマーを実現します。

### 主要要件

1. 区間タイプは「作業」「休憩」の 2 種のみ。
2. 各区間は 1 以上の整数分で指定。
3. 区間は任意順・任意回数で登録可能。
4. 並べ替えと削除が可能。
5. 空リストでは開始不可。
6. 先頭から順にカウントダウン実行。
7. 0 到達で次区間へ自動遷移。
8. 最終区間完了時に全体完了として終了。
9. 操作は開始・一時停止・再開・リセット。
10. 区間切り替え/完了時に通知。

### 設計上の決定事項

- 依存ゼロのバニラ Web（HTML/CSS/JavaScript）を採用。
- 計時は終了時刻ベース（drift 対策）で実装。
- 状態は `idle` / `running` / `paused` / `completed` の FSM で管理。
- 区間リストは `localStorage` へ保存・復元（保存失敗時はメモリ動作へフォールバック）。

## タスク進捗

`openspec/changes/add-interval-timer/tasks.md` に定義された全タスクは、現時点で未着手です。

- 1. プロジェクト土台
- 2. 区間スケジュール管理
- 3. カウントダウン実行エンジン
- 4. 通知
- 5. 検証

## OpenSpec ファイルの役割

- `proposal.md`: 変更の背景・目的・影響範囲
- `design.md`: 技術設計と意思決定
- `tasks.md`: 実装タスク一覧
- `specs/*/spec.md`: capability ごとの要求仕様（Requirements / Scenarios）

## 次にやること

1. `tasks.md` の 1.1 から順に実装を開始する。
2. 実装と並行して、各 scenario を手動またはテストで検証する。
3. 変更完了後、OpenSpec ワークフローに沿って spec の同期・アーカイブを行う。
