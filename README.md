# 自助旅行路線規劃（靜態網頁）

功能：

1. 輸入地點（中英文都可），用 Google Geocoding 搜尋並列出多個可能位置（含座標）→ 下拉選單
2. 從下拉選單選一個確定位置，按「確定加入」
3. 可重複加入多個景點，網頁會記錄並顯示清單（localStorage）
4. 計算相對位置並規劃合理路線與順序
   - Google：Directions `optimizeWaypoints`（道路距離/時間）
   - 本地：最近鄰 + 2-opt（直線距離，無需額外 API）

## 使用

1. 開啟網頁後，在最上方貼上 Google Maps API Key（存在瀏覽器 localStorage，不會寫進 repo）
2. 輸入景點 → 搜尋 → 下拉選單選結果 → 加入
3. 加入 2 個以上景點後，選起點/終點（或勾選環狀）→ 規劃路線

## 本機測試

```bash
python -m http.server 8080
```

開啟 http://localhost:8080/

## 部署

請看 `DEPLOY.md`。

## 檔案

- `index.html`
- `styles.css`
- `app.js`
- `DEPLOY.md`
- `scripts/smoke_test.py`
