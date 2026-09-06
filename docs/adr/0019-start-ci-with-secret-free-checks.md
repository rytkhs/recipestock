# 初期CIはSecrets不要の4チェックで開始する

GitHub Actionsの初期CIはlint・型チェック・ビルド・通常テストを対象とする。公開リポジトリのforkからのPRにも同じチェックを適用できるよう、Secretsや外部サービスの認証を必要としない構成にする。

単一の`checks` jobで`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`を順に実行する。ビルドにはPWA生成物の検証を含み、APIテストが参照するWebの静的アセットを事前に生成する。通常テストではCloudflareのリモートbindingsを明示的に無効化し、ローカルとCIで同じテスト設定を使う。

[ADR 0005](0005-use-neon-ephemeral-branches-for-database-tests.md)の「CI導入時は`pnpm test:all`を必須にする」という決定を更新し、DB統合テストは当面ローカルで実行する。Neonの認証情報とephemeral branchの管理を初期CIに持ち込まず、forkのPRでも基本チェックを実行できることを優先する。

この結果、CIだけではSQL、PostgreSQL制約、migrationの実行を保証しない。Databaseやrepositoryを変更した場合は、従来どおりテスト専用Neon projectを使ってローカルで`pnpm test:all`を実行する。DB統合テストの方式と既存コマンドは変更しない。

DB統合テストのCI化は、実行頻度や手動検証の負担を踏まえて改めて判断する。E2E、カバレッジ閾値、自動デプロイは今回導入しない。
