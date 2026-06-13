# 部署說明

純前端靜態網站,上傳以下檔案即可:

```
index.html  styles.css  app.js
manifest.webmanifest  sw.js  favicon.svg
icon-180.png  icon-192.png  icon-512.png
```

## 1) Google Maps API Key

必須啟用(同一個 Google Cloud Project,並開啟 Billing):

| API | 用途 | 必要性 |
|---|---|---|
| Maps JavaScript API | 地圖顯示 | 必要 |
| Geocoding API | 地點搜尋、反查地址、placeId 轉座標 | 必要 |
| Directions API | 路線與時間計算 | 必要 |
| Places API (New) | 輸入時的即時搜尋建議 | 建議(未啟用會自動退回 Geocoding 搜尋) |

> 即時建議優先使用新版 Places API(AutocompleteSuggestion);舊專案若只啟用了舊版 Places API 也能自動相容。兩者都沒有時,輸入後按「搜尋」仍可正常運作(走 Geocoding)。

### Key 安全(重要)

前端網頁的 key 一定會曝光,務必設限:

1. Google Cloud Console → APIs & Services → Credentials → 你的 key
2. **Application restrictions** → HTTP referrers,加入:
   - `https://你的網域/*`(GitHub Pages 例:`https://<帳號>.github.io/<repo>/*`)
   - 本機測試另加:`http://localhost:8080/*`
3. **API restrictions** → Restrict key → 勾選上表四個 API
4. 建議在 Console 設定**每日配額上限**,避免被盜刷

> Key 由使用者在頁面貼上,只存 localStorage,**不要**寫進程式碼或 commit 到 GitHub。

## 2) 本機測試

```bash
python -m http.server 8080
# 開 http://localhost:8080/
```

部署前可跑檢查:

```bash
python scripts/smoke_test.py
```

## 3) 部署平台

### GitHub Pages
1. repo → Add file → Upload files → 上傳上述檔案 → Commit
2. Settings → Pages → Deploy from branch
3. referrer 限制加 `https://<帳號>.github.io/<repo>/*`
4. 更新後若沒生效,Ctrl+F5 強制重新整理(service worker 為 network-first,一般重新整理即可拿到新版)

### Netlify / Cloudflare Pages
- 直接拖拉資料夾上傳,或連 GitHub repo
- Build command 留空,輸出目錄選根目錄
- referrer 限制加上平台給的網址 `/*`

## 4) 已知限制

- Google Directions 單次最多 25 個 waypoints → 本站會自動分批,但**每批都計費**
- 大眾運輸(TRANSIT)逐段查詢 → N 個景點 = N-1 次 Directions 請求
- Places 即時建議按 session 計費,已使用 session token 降低費用
- 分享連結把行程編碼進網址,過大(>7500 字元)時請改用匯出 JSON
