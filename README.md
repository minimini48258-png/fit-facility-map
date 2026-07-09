# 長野県 FIT認定設備マップ

[資源エネルギー庁 FIT情報公表用ウェブサイト](https://www.fit-portal.go.jp/publicinfo)が公開する長野県のFIT（固定価格買取制度）認定設備データを地図上に可視化するツール。

- 対象カテゴリ: 太陽光 / 風力 / 水力（既設導水路活用型リプレース含む） / バイオマス（地熱は件数僅少のため対象外）
- 地図: [国土地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)（標準地図・航空写真を切替可能）
- 各設備を円で表示し、認定出力（kW）に応じて円の大きさを変化
- クリックで設備の詳細情報（事業者名・出力・所在地・認定日等）を表示
- 毎月自動更新（GitHub Actions）

## 仕組み

1. `scripts/fetch_and_process.py` が FITポータルから長野県のExcelファイルをダウンロード
2. 対象カテゴリの設備を抽出し、住所を[国土地理院 住所検索API](https://msearch.gsi.go.jp/address-search/AddressSearch)でジオコーディング（`data/geocode_cache.json` にキャッシュし、次回以降は新規・変更住所のみ問い合わせる）
3. `data/facilities.geojson` を生成し、フロントエンド（`index.html` / `app.js`）が読み込んで地図に描画
4. `.github/workflows/update-data.yml` が毎月1日に自動実行し、データを更新してコミット

## ローカルでの実行

```bash
pip install -r scripts/requirements.txt
python scripts/fetch_and_process.py   # data/facilities.geojson 等を生成

python -m http.server 8000            # ルートディレクトリで実行し http://localhost:8000 を開く
```

## 制約・注意事項

- 住所は「地番」表記のため、ジオコーディング精度は住所の書式に依存する（一部は番地を省略した概算位置になる場合があり、その設備のポップアップに注記が表示される）
- ジオコーディングに失敗した住所は `data/geocode_failures.json` に記録され、地図には表示されない
- 事業者名等は資源エネルギー庁が公表する情報をそのまま利用している（電話番号・代表者個人名は表示していない）
