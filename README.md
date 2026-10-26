# FusenKokuban（付箋黒板）

黒板のようなウィンドウに付箋を貼れる、クロスプラットフォーム（Windows / macOS / Linux）のデスクトップアプリです。Electron 製。

![screenshot](docs/screenshot.png)

## 機能

- 左上のタブで複数の黒板を切り替え（「+」で追加、ダブルクリックで名前変更、「×」で削除。Ctrl+Tab / Ctrl+Shift+Tab でも切り替え）。付箋・背景色・元に戻す履歴は黒板ごと
- 背景色を自由に変更（右上の「背景色」。初期値は見やすい緑、「緑に戻す」で初期値へ）
- 背景をダブルクリックすると付箋を作成
- 付箋をクリックすると選択され、周囲8か所のハンドル（四隅＋各辺の中央）をドラッグして拡大・縮小
- 付箋にキーボードで文字入力（日本語入力対応）
- 選択中の付箋は左上のグリップ（⠿）または枠線をドラッグして移動
- 選択中に右上に出る「×」、または Delete キー（Mac は Backspace も可）で付箋を削除（確認なし。元に戻せます。文字入力中は文字の削除になります）
- Ctrl/Cmd+Z で元に戻す、Ctrl/Cmd+Y または Ctrl/Cmd+Shift+Z でやり直し（付箋の作成・削除・移動・サイズ・色・文字入力・背景色・ファイル読み込み）
- 選択中に付箋の上に出るバーで、付箋の色（6色のプリセット＋自由色）・文字色・文字の大きさを付箋ごとに変更
  - 本文の一部を選択した状態で文字色・文字の大きさを選ぶと、選択した部分だけが変わる
- 画像ファイルをウィンドウにドロップ、またはクリップボードの画像を Ctrl/Cmd+V で貼り付けると画像の付箋を作成（四隅のハンドルは縦横比を保って拡大・縮小、画像をドラッグで移動）
- 付箋を右クリックするとメニューを表示：色を変える／端に寄せる（左・右・上・下）／付箋を閉じる
- 背景をクリックすると選択解除
- すべての黒板（付箋・色・文字スタイル・画像含む）と背景色、表示中のタブは自動保存され、次回起動時に復元
- 右上の「保存」「読み込み」（Ctrl/Cmd+S・Ctrl/Cmd+O）で表示中の黒板を `.fusen` ファイルに保存・読み込み
- 右上の「画像で保存」（Ctrl/Cmd+E）で表示中の黒板を PNG 画像として保存（範囲はウィンドウに表示中の黒板。ツールバー・選択枠・ハンドルなどは写らない）

## ダウンロード

[Releases ページ](https://github.com/nagoring/FusenKokuban/releases/latest) から各OS版をダウンロードできます。

| OS | ファイル |
| --- | --- |
| Windows | `FusenKokuban-<版>-win-x64.zip`（インストール不要） |
| macOS | `FusenKokuban-<版>-mac-universal.dmg`（Intel / Apple Silicon 両対応） |
| Linux | `FusenKokuban-<版>-linux-x86_64.AppImage` |

Windows 版はインストーラーではなく zip 配布です。レジストリには書き込まず、アンインストールは展開したフォルダを削除するだけです（付箋データは `%APPDATA%\FusenKokuban\board.json` に保存されます）。

コード署名をしていないため、初回起動時に警告が出ます。

- **Windows**: zip を「プロパティ」→「許可する」にチェックしてから好きな場所に展開し、`FusenKokuban.exe` を実行。警告が出たら「WindowsによってPCが保護されました」→「詳細情報」→「実行」
- **macOS**: アプリを「アプリケーション」へコピー後、ターミナルで `xattr -cr /Applications/FusenKokuban.app` を実行してから起動
- **Linux**: `chmod +x FusenKokuban-*.AppImage` してから実行

## 開発用の起動方法

```sh
npm install
npm start
```

## パッケージ作成

```sh
npm run dist
```

`dist/` に各OS向けのパッケージ（Windows: zip / macOS: dmg / Linux: AppImage）が出力されます。各OSのパッケージはそのOS上でビルドしてください（GitHub Actions の `Build` ワークフローで3OS分をまとめて作成できます）。

### リリース手順

`package.json` の `version` を上げてコミットし、`v<版>` のタグを push すると、3OS分をビルドして Releases に公開します。

```sh
git tag v0.2.0
git push origin v0.2.0
```

リリースノートの変更点は `docs/releases/v<版>.md` に書いておくと自動で載ります。

タグを push する代わりに、Actions 画面の「Build」→「Run workflow」で `release_tag` に `v0.2.0` のようなタグ名を入れて実行しても公開できます。

## テスト

```sh
npm test   # Linux のヘッドレス環境では xvfb-run -a npm test
```
