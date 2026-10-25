# FusenKokuban（付箋黒板）

黒板のようなウィンドウに付箋を貼れる、クロスプラットフォーム（Windows / macOS / Linux）のデスクトップアプリです。Electron 製。

![screenshot](docs/screenshot.png)

## 機能

- 背景色を自由に変更（右上の「背景色」。初期値は見やすい緑、「緑に戻す」で初期値へ）
- 背景をダブルクリックすると付箋を作成
- 付箋の上下左右・四隅をドラッグしてサイズ変更
- 付箋にキーボードで文字入力（日本語入力対応）
- 付箋上部のバーをドラッグして移動
- 「×」で付箋を削除
- 付箋と背景色は自動保存され、次回起動時に復元

## 使い方

```sh
npm install
npm start
```

## パッケージ作成

```sh
npm run dist
```

`dist/` に各OS向けのインストーラ（Windows: NSIS / macOS: dmg / Linux: AppImage）が出力されます。各OSのパッケージはそのOS上でビルドしてください（GitHub Actions の `Build` ワークフローで3OS分をまとめて作成できます）。

## テスト

```sh
npm test   # Linux のヘッドレス環境では xvfb-run -a npm test
```
