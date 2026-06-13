/* TripRoute Pro — 自助旅行多天路線規劃
 * 純前端,無建置步驟。資料存於 localStorage,API key 由使用者自備。
 */
(function () {
'use strict';

// ===================== 常數 =====================
const LS_STATE = 'tripplanner_v2';
const LS_KEY = 'gmaps_api_key_v1';
const LS_THEME = 'tripplanner_theme';
const LS_PLACES_V1 = 'trip_places_v1'; // 舊版資料(自動遷移)

const DAY_COLORS = ['#7ab7ff', '#48d7b2', '#ffb86b', '#ff7ab7', '#b89bff', '#6be3ff', '#ffd76b', '#9bff7a'];
const MODE_LABEL = { DRIVING: '🚗 開車', WALKING: '🚶 步行', BICYCLING: '🚲 自行車', TRANSIT: '🚇 大眾運輸' };
const MODE_URL = { DRIVING: 'driving', WALKING: 'walking', BICYCLING: 'bicycling', TRANSIT: 'transit' };
// 直線估算:速度 km/h 與繞路係數
const MODE_SPEED = { DRIVING: 40, WALKING: 4.5, BICYCLING: 14, TRANSIT: 22 };
const DETOUR = 1.35;
const MAX_WP = 25;                 // Google Directions 單次 waypoints 上限
const NAV_CHUNK = 10;              // Google Maps 導航網址每段最多 10 個點

const $ = (id) => document.getElementById(id);
const el = {
  tripSelect: $('tripSelect'), tripMenuBtn: $('tripMenuBtn'), tripMenu: $('tripMenu'), themeToggle: $('themeToggle'),
  keyCard: $('keyCard'), apiKey: $('apiKey'), saveKey: $('saveKey'), clearKey: $('clearKey'), keyStatus: $('keyStatus'), originHint: $('originHint'),
  q: $('q'), acList: $('acList'), search: $('search'), locate: $('locate'),
  candRow: $('candRow'), cand: $('cand'), confirm: $('confirm'), searchStatus: $('searchStatus'),
  addDay: $('addDay'), dayTabs: $('dayTabs'), depart: $('depart'), mode: $('mode'),
  start: $('start'), end: $('end'), round: $('round'), opt: $('opt'), planAsIs: $('planAsIs'),
  useGoogle: $('useGoogle'), routeStatus: $('routeStatus'),
  dayCount: $('dayCount'), clearDay: $('clearDay'), list: $('list'),
  itCard: $('itCard'), itDayLabel: $('itDayLabel'), itSummary: $('itSummary'), it: $('it'),
  openNav: $('openNav'), copyText: $('copyText'), exportCsv: $('exportCsv'), printBtn: $('printBtn'), navLinks: $('navLinks'),
  map: $('map'), mapEmpty: $('mapEmpty'), showAllDays: $('showAllDays'),
  toasts: $('toasts'), undoBar: $('undoBar'), undoMsg: $('undoMsg'), undoBtn: $('undoBtn'),
  printArea: $('printArea'), importFile: $('importFile'),
};

// ===================== 工具 =====================
function uid(prefix) {
  return (prefix || 'p') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}
function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  if (!isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
function debounce(fn, ms) {
  let t = null;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function setStatus(node, msg, cls) {
  if (!node) return;
  node.textContent = msg || '';
  node.classList.remove('err', 'ok');
  if (cls) node.classList.add(cls);
}
function toast(msg, type) {
  const d = document.createElement('div');
  d.className = 'toast' + (type ? ' ' + type : '');
  d.textContent = msg;
  el.toasts.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => d.remove(), 3600);
}

function fmtClock(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return h + ':' + m;
}
function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (h <= 0) return m + ' 分';
  if (m <= 0) return h + ' 小時';
  return h + ' 小時 ' + m + ' 分';
}
function fmtKm(meters) {
  if (meters < 1000) return Math.round(meters) + ' m';
  return (meters / 1000).toFixed(meters < 10000 ? 2 : 1) + ' km';
}
function havMeters(a, b) {
  const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function textColorFor(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 150 ? '#081022' : '#ffffff';
}
// UTF-8 安全的 base64url
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
}
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) { return false; }
  }
}
function mapsPlaceUrl(p) {
  const q = encodeURIComponent(p.lat.toFixed(6) + ',' + p.lng.toFixed(6));
  return 'https://www.google.com/maps/search/?api=1&query=' + q +
    (p.placeId ? '&query_place_id=' + encodeURIComponent(p.placeId) : '');
}
function mapsDirUrl(points, mode) {
  // points: [{lat,lng}], 第一個為起點、最後一個為終點
  const f = (p) => p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
  const origin = encodeURIComponent(f(points[0]));
  const dest = encodeURIComponent(f(points[points.length - 1]));
  const mid = points.slice(1, -1).map(f).join('|');
  let url = 'https://www.google.com/maps/dir/?api=1&origin=' + origin + '&destination=' + dest +
    '&travelmode=' + (MODE_URL[mode] || 'driving');
  if (mid) url += '&waypoints=' + encodeURIComponent(mid);
  return url;
}

// ===================== 狀態 =====================
let state = null;           // { v, activeTripId, trips: [] }
const routes = new Map();   // dayId -> { orderIds, legs:[{fromId,toId,m,s,est}], mode, round, via, gResults:[] }
let activeDayId = null;

let map = null, geocoder = null, ds = null, infoWin = null;
let acService = null, acSessionToken = null, placesAvailable = false;
let AcSuggestion = null, AcTokenClass = null; // 新版 Places Autocomplete(優先)
let initMapCalled = false;
let markers = [];           // {marker, placeId}
let dirRenderers = [];      // DirectionsRenderer[]
let localLines = [];        // Polyline[]
let candidates = [];        // geocoder 搜尋候選
let acItems = [];           // autocomplete 預測
let acSel = -1;
let undoSnapshot = null, undoTimer = null, undoTripId = null;
let planning = false;

function defaultDay() {
  return { id: uid('d'), depart: '09:00', mode: 'DRIVING', round: false, startId: null, endId: null };
}
function defaultTrip(name) {
  const d = defaultDay();
  return { id: uid('t'), name: name || '我的行程', createdAt: Date.now(), updatedAt: Date.now(), days: [d], places: [] };
}
function sanitizePlace(p, dayIds, firstDayId) {
  if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number' || !isFinite(p.lat) || !isFinite(p.lng)) return null;
  return {
    id: typeof p.id === 'string' ? p.id : uid('p'),
    name: String(p.name || '未命名地點').slice(0, 120),
    address: String(p.address || '').slice(0, 250),
    lat: Number(p.lat), lng: Number(p.lng),
    placeId: p.placeId ? String(p.placeId) : null,
    dayId: dayIds.has(p.dayId) ? p.dayId : firstDayId,
    stayMin: clampInt(p.stayMin, 0, 1440, 60),
    note: String(p.note || '').slice(0, 500),
  };
}
function sanitizeTrip(t) {
  if (!t || typeof t !== 'object') return null;
  const trip = defaultTrip(String(t.name || '匯入的行程').slice(0, 60));
  if (Array.isArray(t.days) && t.days.length) {
    trip.days = t.days.slice(0, 30).map((d) => ({
      id: typeof d.id === 'string' ? d.id : uid('d'),
      depart: /^\d{2}:\d{2}$/.test(d.depart) ? d.depart : '09:00',
      mode: MODE_LABEL[d.mode] ? d.mode : 'DRIVING',
      round: !!d.round,
      startId: typeof d.startId === 'string' ? d.startId : null,
      endId: typeof d.endId === 'string' ? d.endId : null,
    }));
  }
  // id 必須唯一(分享連結/匯入檔是不可信輸入,重複 id 會破壞刪除與查找)
  const seenDay = new Set();
  trip.days.forEach((d) => { if (seenDay.has(d.id)) d.id = uid('d'); seenDay.add(d.id); });
  const dayIds = new Set(trip.days.map((d) => d.id));
  const first = trip.days[0].id;
  if (Array.isArray(t.places)) {
    trip.places = t.places.slice(0, 500).map((p) => sanitizePlace(p, dayIds, first)).filter(Boolean);
    const seenPlace = new Set();
    trip.places.forEach((p) => { if (seenPlace.has(p.id)) p.id = uid('p'); seenPlace.add(p.id); });
  }
  return trip;
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.trips) && s.trips.length) {
        s.trips = s.trips.map(sanitizeTripKeepIds).filter(Boolean);
        if (s.trips.length) {
          state = { v: 2, activeTripId: s.trips.some((t) => t.id === s.activeTripId) ? s.activeTripId : s.trips[0].id, trips: s.trips };
          return;
        }
      }
    }
  } catch (e) { /* 壞資料 → 重建 */ }
  state = { v: 2, activeTripId: null, trips: [] };
  migrateV1();
  if (!state.trips.length) state.trips.push(defaultTrip());
  state.activeTripId = state.trips[0].id;
}
// 載入既有 v2 資料時保留原 id(分享/匯入才重生 id)
function sanitizeTripKeepIds(t) {
  const s = sanitizeTrip(t);
  if (!s) return null;
  if (typeof t.id === 'string') s.id = t.id;
  if (typeof t.createdAt === 'number') s.createdAt = t.createdAt;
  return s;
}
function migrateV1() {
  try {
    const raw = localStorage.getItem(LS_PLACES_V1);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return;
    const trip = defaultTrip('我的行程');
    const first = trip.days[0].id;
    trip.places = arr.map((p) => sanitizePlace({ ...p, dayId: first }, new Set([first]), first)).filter(Boolean);
    if (trip.places.length) {
      state.trips.push(trip);
      toastLater('已自動匯入舊版景點資料(' + trip.places.length + ' 筆)。');
    }
  } catch (e) { /* ignore */ }
}
let pendingToasts = [];
function toastLater(msg) { pendingToasts.push(msg); }

const saveStateNow = () => {
  try {
    const t = activeTrip(); if (t) t.updatedAt = Date.now();
    localStorage.setItem(LS_STATE, JSON.stringify(state));
  } catch (e) {
    toast('儲存失敗:瀏覽器儲存空間不足。', 'err');
  }
};
const saveState = debounce(saveStateNow, 250);

function activeTrip() { return state.trips.find((t) => t.id === state.activeTripId) || null; }
function activeDay() {
  const t = activeTrip(); if (!t) return null;
  let d = t.days.find((x) => x.id === activeDayId);
  if (!d) { d = t.days[0]; activeDayId = d.id; }
  return d;
}
function dayIndex(dayId) {
  const t = activeTrip(); if (!t) return 0;
  const i = t.days.findIndex((d) => d.id === dayId);
  return i < 0 ? 0 : i;
}
function dayColor(dayId) { return DAY_COLORS[dayIndex(dayId) % DAY_COLORS.length]; }
function dayPlaces(dayId) {
  const t = activeTrip(); if (!t) return [];
  return t.places.filter((p) => p.dayId === dayId);
}
function placeById(id) {
  const t = activeTrip(); if (!t) return null;
  return t.places.find((p) => p.id === id) || null;
}
function displayOrder(dayId) {
  // 顯示順序:已計算路線用計算結果,否則用清單順序
  const r = routes.get(dayId);
  const list = dayPlaces(dayId);
  if (r && r.orderIds && r.orderIds.length) {
    const valid = new Set(list.map((p) => p.id));
    if (r.orderIds.every((id) => valid.has(id)) && r.orderIds.length === list.length) {
      return r.orderIds.map((id) => placeById(id)).filter(Boolean);
    }
  }
  return list;
}
function invalidateDay(dayId) {
  routes.delete(dayId);
  if (dayId === activeDayId) {
    clearRouteOverlays();
    el.itCard.hidden = true;
    setStatus(el.routeStatus, '');
  }
}

// ===================== 主題 =====================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1020' : '#f7f9fc');
  try { localStorage.setItem(LS_THEME, theme); } catch (e) {}
  if (map) map.setOptions({ styles: theme === 'dark' ? DARK_MAP_STYLE : null });
}
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#334e87' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#023e58' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6f9ba5' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#023e58' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c6675' }] },
  { featureType: 'transit', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4e6d70' }] },
];

// ===================== Google Maps 載入 =====================
let authFailed = false;
window.gm_authFailure = function () {
  authFailed = true;
  setStatus(el.keyStatus, 'API Key 驗證失敗:請確認 key 正確、已啟用計費,且 HTTP referrer 限制包含此網域。修正後重新按「儲存並載入地圖」即可。', 'err');
  el.keyCard.open = true;
};
function loadKey() { try { return (localStorage.getItem(LS_KEY) || '').trim(); } catch (e) { return ''; } }
function saveKey(k) { try { localStorage.setItem(LS_KEY, (k || '').trim()); } catch (e) {} }
function clearKeyStore() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }

let loadedKey = null, scriptLoading = false;
function loadGoogleMaps(keyOverride) {
  const key = (keyOverride || '').trim() || loadKey();
  if (!key) { setStatus(el.keyStatus, '尚未設定 API key。'); return; }
  if (window.google && window.google.maps) {
    // Maps JS 同一頁面無法換 key 重新初始化 → 自動重新整理套用
    if ((loadedKey && key !== loadedKey) || authFailed) {
      saveKey(key);
      setStatus(el.keyStatus, '已儲存新 key,重新載入頁面套用…');
      setTimeout(() => location.reload(), 400);
      return;
    }
    if (!initMapCalled) window.initMap();
    return;
  }
  if (scriptLoading) { setStatus(el.keyStatus, 'Google Maps 載入中,請稍候…'); return; }
  scriptLoading = true;
  loadedKey = key;
  setStatus(el.keyStatus, '載入 Google Maps 中…');
  const s = document.createElement('script');
  s.id = 'gmaps-js';
  s.async = true;
  s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&loading=async&callback=initMap&v=weekly';
  s.onerror = () => {
    scriptLoading = false;
    setStatus(el.keyStatus, 'Google Maps 載入失敗:請確認網路、key、網域限制與 Maps JavaScript API 是否啟用。', 'err');
  };
  document.head.appendChild(s);
  setTimeout(() => {
    if (!initMapCalled && !(window.google && window.google.maps)) {
      setStatus(el.keyStatus, '載入逾時:請檢查 key 的 HTTP referrer 限制是否包含此網域,並啟用 Maps JavaScript API。', 'err');
    }
  }, 12000);
}

window.initMap = async function () {
  initMapCalled = true;
  scriptLoading = false;
  el.mapEmpty.style.display = 'none';
  const theme = document.documentElement.getAttribute('data-theme');
  map = new google.maps.Map(el.map, {
    center: { lat: 25.033968, lng: 121.564468 }, zoom: 12,
    mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
    disableDoubleClickZoom: true, clickableIcons: false,
    styles: theme === 'dark' ? DARK_MAP_STYLE : null,
  });
  geocoder = new google.maps.Geocoder();
  ds = new google.maps.DirectionsService();
  infoWin = new google.maps.InfoWindow();
  setStatus(el.keyStatus, 'Google Maps 已就緒 ✓', 'ok');
  el.keyCard.open = false;

  // Places(選用):有啟用就提供即時建議,沒有則退回 Geocoding 搜尋。
  // 優先用新版 AutocompleteSuggestion(Places API New);失敗再退舊版 AutocompleteService。
  try {
    const lib = await google.maps.importLibrary('places');
    AcSuggestion = lib.AutocompleteSuggestion || null;
    const SvcClass = lib.AutocompleteService || (google.maps.places && google.maps.places.AutocompleteService) || null;
    acService = SvcClass ? new SvcClass() : null;
    AcTokenClass = lib.AutocompleteSessionToken || (google.maps.places && google.maps.places.AutocompleteSessionToken) || null;
    acSessionToken = AcTokenClass ? new AcTokenClass() : null;
    placesAvailable = !!(AcSuggestion || acService);
  } catch (e) {
    placesAvailable = false;
  }

  map.addListener('dblclick', (ev) => {
    if (!ev.latLng) return;
    addPointFromMap(ev.latLng.lat(), ev.latLng.lng());
  });

  // 偵測地圖容器內的錯誤畫面(例如 ApiNotActivatedMapError)
  setTimeout(() => {
    try {
      const err = el.map.querySelector('.gm-err-container, .gm-err-title');
      if (err) {
        setStatus(el.keyStatus, '地圖載入失敗:請查看瀏覽器 Console 的 Google Maps 錯誤(常見:未啟用 Maps JavaScript API、referrer 不符)。', 'err');
        el.keyCard.open = true;
      }
    } catch (e) {}
  }, 1200);

  syncAll();
  fitAllVisible();
};

// ===================== 搜尋/加點 =====================
function hideAc() {
  el.acList.hidden = true;
  el.q.setAttribute('aria-expanded', 'false');
  el.q.removeAttribute('aria-activedescendant');
  acItems = []; acSel = -1;
}
function renderAc() {
  el.acList.innerHTML = '';
  if (!acItems.length) { hideAc(); return; }
  acItems.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'acItem' + (i === acSel ? ' sel' : '');
    d.id = 'acOpt-' + i;
    d.setAttribute('role', 'option');
    d.setAttribute('aria-selected', i === acSel ? 'true' : 'false');
    const main = document.createElement('div');
    main.textContent = it.main;
    const sub = document.createElement('div');
    sub.className = 'acSub';
    sub.textContent = it.sub || '';
    d.appendChild(main);
    if (it.sub) d.appendChild(sub);
    d.addEventListener('mousedown', (ev) => { ev.preventDefault(); pickAc(i); });
    el.acList.appendChild(d);
  });
  el.acList.hidden = false;
  el.q.setAttribute('aria-expanded', 'true');
  if (acSel >= 0) el.q.setAttribute('aria-activedescendant', 'acOpt-' + acSel);
  else el.q.removeAttribute('aria-activedescendant');
}
async function fetchSuggestions(q) {
  // 新版 Places API
  if (AcSuggestion) {
    try {
      const res = await AcSuggestion.fetchAutocompleteSuggestions({ input: q, sessionToken: acSessionToken });
      return (res.suggestions || [])
        .map((s) => s.placePrediction)
        .filter(Boolean)
        .slice(0, 6)
        .map((p) => ({
          placeId: p.placeId,
          main: (p.mainText && p.mainText.text) || (p.text && p.text.text) || '',
          sub: (p.secondaryText && p.secondaryText.text) || '',
        }));
    } catch (e) {
      AcSuggestion = null; // 新版未授權 → 之後改試舊版
    }
  }
  // 舊版 Places API
  if (acService) {
    return new Promise((resolve) => {
      acService.getPlacePredictions({ input: q, sessionToken: acSessionToken }, (preds, status) => {
        if (status === 'OK' && preds && preds.length) {
          resolve(preds.slice(0, 6).map((p) => ({
            placeId: p.place_id,
            main: (p.structured_formatting && p.structured_formatting.main_text) || p.description,
            sub: (p.structured_formatting && p.structured_formatting.secondary_text) || '',
          })));
          return;
        }
        // 未授權/額度問題 → 停用即時建議,避免每個按鍵都打一次失敗請求
        if (status === 'REQUEST_DENIED' || status === 'NOT_AVAILABLE' || status === 'OVER_QUERY_LIMIT') {
          placesAvailable = false;
        }
        resolve([]);
      });
    });
  }
  placesAvailable = false;
  return [];
}
const onQueryInput = debounce(async () => {
  const q = el.q.value.trim();
  if (!q || !placesAvailable) { hideAc(); return; }
  const items = await fetchSuggestions(q);
  if (el.q.value.trim() !== q) return; // 輸入已變,丟棄過時結果
  acItems = items;
  acSel = -1;
  if (!items.length) { hideAc(); return; }
  renderAc();
}, 280);

function pickAc(i) {
  const it = acItems[i];
  if (!it) return;
  hideAc();
  el.q.value = it.main;
  setStatus(el.searchStatus, '取得位置中…');
  geocoder.geocode({ placeId: it.placeId }, (results, status) => {
    if (status !== 'OK' || !results || !results[0]) {
      setStatus(el.searchStatus, '無法取得該地點座標(' + status + ')。', 'err');
      return;
    }
    const r = results[0];
    const loc = r.geometry.location;
    addPlace({
      name: it.main, address: r.formatted_address || it.sub || '',
      lat: loc.lat(), lng: loc.lng(), placeId: it.placeId,
    });
    el.q.value = '';
    // Places 計費:選取後重啟 session
    try { if (AcTokenClass) acSessionToken = new AcTokenClass(); } catch (e) {}
  });
}

function doSearch() {
  const q = el.q.value.trim();
  hideAc();
  if (!q) { setStatus(el.searchStatus, '請先輸入地點或地址。'); return; }
  if (!geocoder) { setStatus(el.searchStatus, '地圖尚未載入,請先設定 API key。', 'err'); return; }
  setStatus(el.searchStatus, '搜尋中…');
  el.search.disabled = true;
  geocoder.geocode({ address: q }, (results, status) => {
    el.search.disabled = false;
    if (status !== 'OK' || !results || !results.length) {
      candidates = [];
      renderCandidates();
      setStatus(el.searchStatus, '查無結果(' + status + ')。可嘗試更完整的地址或英文名稱。', 'err');
      return;
    }
    candidates = results.slice(0, 12).map((r) => {
      const loc = r.geometry && r.geometry.location;
      return {
        name: q,
        address: r.formatted_address || '',
        lat: loc ? loc.lat() : 0, lng: loc ? loc.lng() : 0,
        placeId: r.place_id || null,
      };
    });
    renderCandidates();
    setStatus(el.searchStatus, '找到 ' + candidates.length + ' 個可能位置,請確認後加入。', 'ok');
    previewCandidate();
  });
}
function renderCandidates() {
  el.cand.innerHTML = '';
  if (!candidates.length) { el.candRow.hidden = true; return; }
  candidates.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = (c.address || c.name) + ' (' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) + ')';
    el.cand.appendChild(o);
  });
  el.cand.value = '0';
  el.candRow.hidden = false;
}
let previewMarker = null;
function previewCandidate() {
  if (!map || !candidates.length) return;
  const c = candidates[Number(el.cand.value)];
  if (!c) return;
  if (previewMarker) previewMarker.setMap(null);
  previewMarker = new google.maps.Marker({
    map, position: { lat: c.lat, lng: c.lng },
    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#ffce6b', fillOpacity: 0.95, strokeColor: '#ffffff', strokeWeight: 2 },
    zIndex: 999,
  });
  map.panTo({ lat: c.lat, lng: c.lng });
  if (map.getZoom() < 14) map.setZoom(14);
}
function confirmCandidate() {
  const c = candidates[Number(el.cand.value)];
  if (!c) return;
  addPlace(c);
  candidates = [];
  renderCandidates();
  el.q.value = '';
  if (previewMarker) { previewMarker.setMap(null); previewMarker = null; }
}

function addPointFromMap(lat, lng) {
  if (!geocoder) return;
  geocoder.geocode({ location: { lat, lng } }, (results, status) => {
    const addr = (status === 'OK' && results && results[0]) ? results[0].formatted_address : '';
    const name = addr ? addr.split(/[,，]/)[0].trim() || '地圖標記點' : '地圖標記點';
    if (!window.confirm('將此點加入第 ' + (dayIndex(activeDayId) + 1) + ' 天?\n' + (addr || lat.toFixed(5) + ', ' + lng.toFixed(5)))) return;
    addPlace({
      name, address: addr, lat, lng,
      placeId: (status === 'OK' && results && results[0] && results[0].place_id) || null,
    });
  });
}

function useMyLocation() {
  if (!navigator.geolocation) { toast('此瀏覽器不支援定位。', 'err'); return; }
  setStatus(el.searchStatus, '取得目前位置中…');
  navigator.geolocation.getCurrentPosition((pos) => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    const add = (addr, pid) => addPlace({ name: '我的位置', address: addr || '', lat, lng, placeId: pid || null });
    if (geocoder) {
      geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        add((status === 'OK' && results && results[0] && results[0].formatted_address) || '', null);
      });
    } else add('', null);
    setStatus(el.searchStatus, '');
  }, (err) => {
    setStatus(el.searchStatus, '無法取得位置:' + (err && err.message ? err.message : '已拒絕授權'), 'err');
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function addPlace(data) {
  const t = activeTrip(); if (!t) return;
  const d = activeDay(); if (!d) return;
  // 清掉殘留的搜尋候選與預覽標記,避免「加入此地點」誤加舊結果
  if (candidates.length) { candidates = []; renderCandidates(); }
  if (previewMarker) { previewMarker.setMap(null); previewMarker = null; }
  const p = {
    id: uid('p'),
    name: String(data.name || '未命名地點').slice(0, 120),
    address: String(data.address || '').slice(0, 250),
    lat: Number(data.lat), lng: Number(data.lng),
    placeId: data.placeId || null,
    dayId: d.id, stayMin: 60, note: '',
  };
  t.places.push(p);
  invalidateDay(d.id);
  saveState();
  syncAll();
  toast('已加入:' + p.name, 'ok');
  if (map) { map.panTo({ lat: p.lat, lng: p.lng }); }
  setStatus(el.searchStatus, '');
}

// ===================== 天數/設定 =====================
function renderDayTabs() {
  const t = activeTrip(); if (!t) return;
  el.dayTabs.innerHTML = '';
  t.days.forEach((d, i) => {
    const wrap = document.createElement('span');
    wrap.className = 'dayTabWrap';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dayTab' + (d.id === activeDayId ? ' active' : '');
    b.setAttribute('aria-pressed', d.id === activeDayId ? 'true' : 'false');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = DAY_COLORS[i % DAY_COLORS.length];
    b.appendChild(dot);
    const label = document.createElement('span');
    const cnt = dayPlaces(d.id).length;
    label.textContent = '第 ' + (i + 1) + ' 天' + (cnt ? '(' + cnt + ')' : '');
    b.appendChild(label);
    b.addEventListener('click', () => { activeDayId = d.id; syncAll(); });
    wrap.appendChild(b);
    if (t.days.length > 1) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'dayTabX';
      x.textContent = '✕';
      x.title = '刪除第 ' + (i + 1) + ' 天';
      x.setAttribute('aria-label', '刪除第 ' + (i + 1) + ' 天');
      x.addEventListener('click', () => removeDay(d.id));
      wrap.appendChild(x);
    }
    el.dayTabs.appendChild(wrap);
  });
}
function addDay() {
  const t = activeTrip(); if (!t) return;
  if (t.days.length >= 30) { toast('最多 30 天。', 'err'); return; }
  const last = t.days[t.days.length - 1];
  const d = { ...defaultDay(), depart: last.depart, mode: last.mode, round: last.round, id: uid('d'), startId: null, endId: null };
  t.days.push(d);
  activeDayId = d.id;
  saveState();
  syncAll();
}
function removeDay(dayId) {
  const t = activeTrip(); if (!t || t.days.length <= 1) return;
  const idx = dayIndex(dayId);
  const cnt = dayPlaces(dayId).length;
  if (cnt && !window.confirm('第 ' + (idx + 1) + ' 天有 ' + cnt + ' 個景點,刪除後將移到第 1 天。確定刪除?')) return;
  t.days = t.days.filter((d) => d.id !== dayId);
  if (!t.days.length) t.days.push(defaultDay());
  const firstId = t.days[0].id;
  t.places.forEach((p) => { if (p.dayId === dayId) p.dayId = firstId; });
  routes.delete(dayId);
  if (activeDayId === dayId) activeDayId = firstId;
  invalidateDay(firstId);
  saveState();
  syncAll();
}
function renderDaySettings() {
  const d = activeDay(); if (!d) return;
  el.depart.value = d.depart;
  el.mode.value = d.mode;
  el.round.checked = !!d.round;
  const list = displayOrder(d.id); // 與清單顯示同一套編號
  const fill = (sel, selectedId, dflt) => {
    sel.innerHTML = '';
    list.forEach((p, i) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = (i + 1) + '. ' + p.name;
      sel.appendChild(o);
    });
    sel.value = list.some((p) => p.id === selectedId) ? selectedId : (dflt ? dflt.id : '');
  };
  fill(el.start, d.startId, list[0]);
  fill(el.end, d.endId, list[list.length - 1]);
  el.start.disabled = list.length < 2;
  el.end.disabled = list.length < 2 || d.round;
  el.dayCount.textContent = String(list.length);
  const can = list.length >= 2 && !planning;
  el.opt.disabled = !can;
  el.planAsIs.disabled = !can;
}

// ===================== 景點清單(拖曳排序) =====================
let dragId = null;
function renderList() {
  const d = activeDay(); if (!d) return;
  const listEl = el.list;
  listEl.innerHTML = '';
  const ordered = displayOrder(d.id);
  if (!ordered.length) {
    const e = document.createElement('div');
    e.className = 'emptyHint';
    e.textContent = '本日尚無景點 — 從上方搜尋,或在地圖上點兩下新增。';
    listEl.appendChild(e);
    return;
  }
  const t = activeTrip();
  const color = dayColor(d.id);
  ordered.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'item';
    item.dataset.pid = p.id;

    const handle = document.createElement('div');
    handle.className = 'dragHandle';
    handle.textContent = '⠿';
    handle.title = '拖曳調整順序';
    // 只有從把手按下才可拖曳,避免劫持備註/停留欄位的文字選取
    handle.addEventListener('pointerdown', () => { item.draggable = true; });
    handle.addEventListener('pointerup', () => { item.draggable = false; });
    item.appendChild(handle);

    const n = document.createElement('div');
    n.className = 'n';
    n.textContent = String(i + 1);
    n.style.background = color;
    n.style.color = textColorFor(color);
    item.appendChild(n);

    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 't';
    title.textContent = p.name;
    body.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 's';
    if (p.address) { sub.appendChild(document.createTextNode(p.address)); sub.appendChild(document.createElement('br')); }
    const link = document.createElement('a');
    link.href = mapsPlaceUrl(p);
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
    sub.appendChild(link);
    body.appendChild(sub);

    const meta = document.createElement('div');
    meta.className = 'itemMeta';
    const stayLab = document.createElement('label');
    stayLab.className = 'small muted';
    stayLab.appendChild(document.createTextNode('停留 '));
    const stay = document.createElement('input');
    stay.type = 'number'; stay.min = '0'; stay.max = '1440'; stay.step = '5';
    stay.value = String(p.stayMin);
    stay.className = 'stayIn';
    stay.addEventListener('change', () => {
      p.stayMin = clampInt(stay.value, 0, 1440, 60);
      stay.value = String(p.stayMin);
      saveState();
      rerenderTimesOnly(d.id);
    });
    stayLab.appendChild(stay);
    stayLab.appendChild(document.createTextNode(' 分'));
    meta.appendChild(stayLab);

    if (t.days.length > 1) {
      const daySel = document.createElement('select');
      daySel.className = 'daySel';
      t.days.forEach((dd, di) => {
        const o = document.createElement('option');
        o.value = dd.id;
        o.textContent = '第 ' + (di + 1) + ' 天';
        daySel.appendChild(o);
      });
      daySel.value = p.dayId;
      daySel.addEventListener('change', () => {
        const from = p.dayId;
        p.dayId = daySel.value;
        invalidateDay(from); invalidateDay(p.dayId);
        saveState(); syncAll();
      });
      meta.appendChild(daySel);
    }

    const noteBtn = document.createElement('button');
    noteBtn.type = 'button';
    noteBtn.className = 'btn mini';
    noteBtn.textContent = p.note ? '📝 備註' : '＋備註';
    meta.appendChild(noteBtn);
    body.appendChild(meta);

    const note = document.createElement('textarea');
    note.className = 'noteIn';
    note.placeholder = '備註(門票、訂位、提醒…)';
    note.value = p.note || '';
    note.style.display = p.note ? '' : 'none';
    note.addEventListener('change', () => { p.note = note.value.slice(0, 500); saveState(); });
    noteBtn.addEventListener('click', () => {
      note.style.display = note.style.display === 'none' ? '' : 'none';
      if (note.style.display === '') note.focus();
    });
    body.appendChild(note);
    item.appendChild(body);

    const acts = document.createElement('div');
    acts.className = 'itemActs';
    const rowMini = document.createElement('div');
    rowMini.className = 'rowMini';
    const up = document.createElement('button');
    up.type = 'button'; up.className = 'btn mini btnUp'; up.textContent = '↑'; up.title = '上移'; up.disabled = i === 0;
    up.setAttribute('aria-label', '上移 ' + p.name);
    up.addEventListener('click', () => movePlace(p.id, -1));
    const down = document.createElement('button');
    down.type = 'button'; down.className = 'btn mini btnDown'; down.textContent = '↓'; down.title = '下移'; down.disabled = i === ordered.length - 1;
    down.setAttribute('aria-label', '下移 ' + p.name);
    down.addEventListener('click', () => movePlace(p.id, 1));
    rowMini.appendChild(up); rowMini.appendChild(down);
    acts.appendChild(rowMini);
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'btn mini danger'; rm.textContent = '移除';
    rm.addEventListener('click', () => removePlace(p.id));
    acts.appendChild(rm);
    item.appendChild(acts);

    // 拖曳
    item.addEventListener('dragstart', (ev) => {
      dragId = p.id;
      item.classList.add('dragging');
      try { ev.dataTransfer.setData('text/plain', p.id); ev.dataTransfer.effectAllowed = 'move'; } catch (e) {}
    });
    item.addEventListener('dragend', () => { dragId = null; item.draggable = false; item.classList.remove('dragging'); listEl.querySelectorAll('.dragOver').forEach((x) => x.classList.remove('dragOver')); });
    item.addEventListener('dragover', (ev) => { ev.preventDefault(); if (dragId && dragId !== p.id) item.classList.add('dragOver'); });
    item.addEventListener('dragleave', () => item.classList.remove('dragOver'));
    item.addEventListener('drop', (ev) => {
      ev.preventDefault();
      item.classList.remove('dragOver');
      if (dragId && dragId !== p.id) reorderPlace(dragId, p.id);
    });

    listEl.appendChild(item);
  });
}
function currentDayOrderIds(dayId) { return displayOrder(dayId).map((p) => p.id); }
function applyDayOrder(dayId, orderedIds) {
  // 依 orderedIds 重排 trip.places 中屬於該日的元素(其他天保持原位)
  const t = activeTrip(); if (!t) return;
  const queue = orderedIds.map((id) => placeById(id)).filter(Boolean);
  let k = 0;
  t.places = t.places.map((p) => (p.dayId === dayId ? queue[k++] : p));
  invalidateDay(dayId);
  saveState();
  syncAll();
}
function movePlace(pid, dir) {
  const d = activeDay(); if (!d) return;
  const ids = currentDayOrderIds(d.id);
  const i = ids.indexOf(pid), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  applyDayOrder(d.id, ids);
  // 清單重建會摧毀焦點:把焦點放回同一顆按鈕,鍵盤連續排序才可行
  const item = el.list.querySelector('[data-pid="' + pid + '"]');
  if (item) {
    const btn = item.querySelector(dir < 0 ? '.btnUp' : '.btnDown');
    const alt = item.querySelector(dir < 0 ? '.btnDown' : '.btnUp');
    if (btn && !btn.disabled) btn.focus();
    else if (alt && !alt.disabled) alt.focus();
  }
}
function reorderPlace(fromId, toId) {
  const d = activeDay(); if (!d) return;
  const ids = currentDayOrderIds(d.id);
  const fi = ids.indexOf(fromId), ti = ids.indexOf(toId);
  if (fi < 0 || ti < 0) return;
  ids.splice(fi, 1);
  ids.splice(ti, 0, fromId);
  applyDayOrder(d.id, ids);
}
function removePlace(pid) {
  const t = activeTrip(); if (!t) return;
  const p = placeById(pid); if (!p) return;
  snapshotForUndo('已移除「' + p.name + '」');
  const dId = p.dayId;
  t.places = t.places.filter((x) => x.id !== pid);
  invalidateDay(dId);
  saveState();
  syncAll();
}
function clearDay() {
  const d = activeDay(); if (!d) return;
  const list = dayPlaces(d.id);
  if (!list.length) return;
  if (!window.confirm('清空第 ' + (dayIndex(d.id) + 1) + ' 天的全部 ' + list.length + ' 個景點?')) return;
  snapshotForUndo('已清空第 ' + (dayIndex(d.id) + 1) + ' 天');
  const t = activeTrip();
  t.places = t.places.filter((p) => p.dayId !== d.id);
  invalidateDay(d.id);
  saveState();
  syncAll();
}
function snapshotForUndo(msg) {
  const t = activeTrip(); if (!t) return;
  undoSnapshot = JSON.stringify(t.places);
  undoTripId = t.id;
  el.undoMsg.textContent = msg;
  el.undoBar.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { el.undoBar.hidden = true; undoSnapshot = null; undoTripId = null; }, 6000);
}
function doUndo() {
  // 還原到快照所屬的行程,而非當前行程(期間可能已切換)
  const t = state.trips.find((x) => x.id === undoTripId);
  if (!t || !undoSnapshot) { el.undoBar.hidden = true; return; }
  try {
    const arr = JSON.parse(undoSnapshot);
    const dayIds = new Set(t.days.map((d) => d.id));
    t.places = arr.map((p) => sanitizePlace(p, dayIds, t.days[0].id)).filter(Boolean);
    routes.clear();
    clearRouteOverlays();
    saveState();
    syncAll();
    toast('已復原。', 'ok');
  } catch (e) {}
  el.undoBar.hidden = true;
  undoSnapshot = null;
  undoTripId = null;
}

// ===================== 地圖標記 =====================
function clearMarkers() { markers.forEach((m) => m.marker.setMap(null)); markers = []; }
function clearRouteOverlays() {
  dirRenderers.forEach((r) => r.setMap(null));
  dirRenderers = [];
  localLines.forEach((l) => l.setMap(null));
  localLines = [];
}
function renderMarkers() {
  if (!map) return;
  clearMarkers();
  const t = activeTrip(); if (!t) return;
  const showAll = el.showAllDays.checked;
  const daysToShow = showAll ? t.days : t.days.filter((d) => d.id === activeDayId);
  daysToShow.forEach((d) => {
    const color = dayColor(d.id);
    const ordered = displayOrder(d.id);
    ordered.forEach((p, i) => {
      const mk = new google.maps.Marker({
        map,
        position: { lat: p.lat, lng: p.lng },
        label: { text: String(i + 1), color: textColorFor(color), fontWeight: '900', fontSize: '12px' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE, scale: 13,
          fillColor: color, fillOpacity: d.id === activeDayId ? 1 : 0.55,
          strokeColor: '#ffffff', strokeWeight: 2,
        },
        title: p.name,
        zIndex: d.id === activeDayId ? 100 : 10,
      });
      mk.addListener('click', () => openInfo(p, mk));
      markers.push({ marker: mk, placeId: p.id });
    });
  });
}
function openInfo(p, marker) {
  if (!infoWin) return;
  const div = document.createElement('div');
  div.style.cssText = 'font-family:system-ui;font-size:13px;color:#16233c;max-width:240px';
  const t1 = document.createElement('div');
  t1.style.cssText = 'font-weight:800;margin-bottom:4px';
  t1.textContent = p.name;
  div.appendChild(t1);
  if (p.address) {
    const a1 = document.createElement('div');
    a1.style.cssText = 'color:#5a6b85;font-size:12px;margin-bottom:4px';
    a1.textContent = p.address;
    div.appendChild(a1);
  }
  const meta = document.createElement('div');
  meta.style.cssText = 'font-size:12px;color:#5a6b85';
  meta.textContent = '第 ' + (dayIndex(p.dayId) + 1) + ' 天 · 停留 ' + p.stayMin + ' 分';
  div.appendChild(meta);
  const a = document.createElement('a');
  a.href = mapsPlaceUrl(p);
  a.target = '_blank';
  a.rel = 'noreferrer noopener';
  a.textContent = '在 Google Maps 開啟';
  a.style.cssText = 'font-size:12px';
  div.appendChild(a);
  infoWin.setContent(div);
  infoWin.open({ map, anchor: marker });
}
function fitAllVisible() {
  if (!map) return;
  const t = activeTrip(); if (!t) return;
  const showAll = el.showAllDays.checked;
  const pts = t.places.filter((p) => showAll || p.dayId === activeDayId);
  if (!pts.length) return;
  const b = new google.maps.LatLngBounds();
  pts.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }));
  map.fitBounds(b, 64);
}

// ===================== 路線計算 =====================
function routePromise(req) {
  return new Promise((resolve, reject) => {
    ds.route(req, (res, status) => {
      if (status === 'OK' && res && res.routes && res.routes[0]) resolve(res);
      else reject(new Error(status));
    });
  });
}
async function routeWithRetry(req) {
  try {
    return await routePromise(req);
  } catch (e) {
    if (String(e.message) === 'OVER_QUERY_LIMIT') {
      await sleep(1400);
      return routePromise(req);
    }
    throw e;
  }
}
function departDate(d) {
  const m = /^(\d{2}):(\d{2})$/.exec(d.depart || '09:00');
  const dt = new Date();
  dt.setHours(m ? Number(m[1]) : 9, m ? Number(m[2]) : 0, 0, 0);
  return dt;
}
function futureDate(dt) {
  // API 需要未來時間:已過則取明天同一時刻
  const now = new Date();
  if (dt.getTime() <= now.getTime()) { const t2 = new Date(dt); t2.setDate(t2.getDate() + 1); return t2; }
  return dt;
}
function estimateLeg(a, b, mode) {
  const m = havMeters(a, b) * DETOUR;
  const speed = (MODE_SPEED[mode] || 40) * 1000 / 3600; // m/s
  return { m, s: m / speed, est: true };
}

// 本地最佳化:最近鄰 + 2-opt(固定起點/終點)
function localOptimizeOrder(pts, startIdx, endIdx, isRound) {
  const n = pts.length;
  const dm = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = havMeters(pts[i], pts[j]);
    dm[i][j] = d; dm[j][i] = d;
  }
  const un = [];
  for (let i = 0; i < n; i++) { if (i === startIdx) continue; if (!isRound && i === endIdx) continue; un.push(i); }
  const ord = [startIdx];
  let cur = startIdx;
  while (un.length) {
    let bk = 0, bd = Infinity;
    for (let k = 0; k < un.length; k++) { const dd = dm[cur][un[k]]; if (dd < bd) { bd = dd; bk = k; } }
    cur = un.splice(bk, 1)[0];
    ord.push(cur);
  }
  if (!isRound && endIdx !== startIdx) ord.push(endIdx);
  // 2-opt(環狀時把回程也納入成本)
  const cost = (o) => {
    let c = 0;
    for (let i = 0; i < o.length - 1; i++) c += dm[o[i]][o[i + 1]];
    if (isRound) c += dm[o[o.length - 1]][o[0]];
    return c;
  };
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 60) {
    improved = false;
    const lastFixed = isRound ? 0 : 1; // 非環狀時終點固定
    for (let a = 1; a < ord.length - 1 - lastFixed + 1; a++) {
      for (let b = a + 1; b < ord.length - lastFixed; b++) {
        const cand = ord.slice(0, a).concat(ord.slice(a, b + 1).reverse(), ord.slice(b + 1));
        if (cost(cand) + 1e-9 < cost(ord)) { ord.splice(0, ord.length, ...cand); improved = true; }
      }
    }
  }
  return ord;
}

async function planRoute(optimizeOrder) {
  const d = activeDay(); if (!d) return;
  const list = dayPlaces(d.id);
  if (list.length < 2) { setStatus(el.routeStatus, '至少需要 2 個景點。'); return; }
  if (planning) return;
  const useGoogle = el.useGoogle.checked;
  if (useGoogle && !ds) {
    setStatus(el.routeStatus, '地圖尚未載入:請先設定 API key,或取消勾選 Google 路線改用直線估算。', 'err');
    return;
  }
  planning = true;
  renderDaySettings();
  setStatus(el.routeStatus, '計算路線中…');
  try {
    const mode = d.mode;
    let orderedIds;

    if (optimizeOrder) {
      const start = placeById(el.start.value) || list[0];
      const end = d.round ? start : (placeById(el.end.value) || list[list.length - 1]);
      if (!d.round && start.id === end.id) {
        setStatus(el.routeStatus, '起點與終點相同:請改用環狀,或選不同終點。', 'err');
        planning = false; renderDaySettings(); return;
      }
      d.startId = start.id; d.endId = end.id;
      const middle = list.filter((p) => p.id !== start.id && p.id !== end.id);

      if (useGoogle && mode !== 'TRANSIT' && middle.length <= MAX_WP) {
        // Google 伺服器端最佳化(一次請求)
        const res = await routeWithRetry({
          origin: { lat: start.lat, lng: start.lng },
          destination: { lat: end.lat, lng: end.lng },
          waypoints: middle.map((p) => ({ location: { lat: p.lat, lng: p.lng }, stopover: true })),
          optimizeWaypoints: true,
          travelMode: mode,
        });
        const route = res.routes[0];
        const order = route.waypoint_order || [];
        orderedIds = [start.id, ...order.map((i) => middle[i].id)];
        if (!d.round && end.id !== start.id) orderedIds.push(end.id);
        const legs = buildLegsFromGoogle(route.legs, orderedIds, d.round, start.id);
        finishRoute(d, orderedIds, legs, 'google', [res]);
        return;
      }
      // 本地排序(TRANSIT / 超量 / 不用 Google)
      const idx = (id) => list.findIndex((p) => p.id === id);
      const ordIdx = localOptimizeOrder(list, idx(start.id), idx(end.id), d.round || start.id === end.id);
      orderedIds = ordIdx.map((i) => list[i].id);
    } else {
      orderedIds = currentDayOrderIds(d.id);
      const start = placeById(orderedIds[0]);
      d.startId = start ? start.id : null;
      d.endId = orderedIds[orderedIds.length - 1];
    }

    // 依固定順序取得路線
    const stops = orderedIds.map((id) => placeById(id)).filter(Boolean);
    const pathStops = d.round ? [...stops, stops[0]] : stops;
    if (!useGoogle) {
      const legs = [];
      for (let i = 0; i < pathStops.length - 1; i++) {
        const e2 = estimateLeg(pathStops[i], pathStops[i + 1], mode);
        legs.push({ fromId: pathStops[i].id, toId: pathStops[i + 1].id, m: e2.m, s: e2.s, est: true });
      }
      finishRoute(d, orderedIds, legs, 'local', null);
      return;
    }
    if (mode === 'TRANSIT') {
      const legs = await fetchTransitLegs(d, pathStops);
      finishRoute(d, orderedIds, legs, 'google', legs._gResults);
      return;
    }
    const { legs, gResults } = await fetchChunkedRoute(pathStops, mode);
    finishRoute(d, orderedIds, legs, 'google', gResults);
  } catch (e) {
    const code = e && e.message ? String(e.message) : 'UNKNOWN';
    const hint = {
      ZERO_RESULTS: '找不到可行路線(交通方式可能不適用於這些地點)。',
      NOT_FOUND: '部分地點無法定位。',
      OVER_QUERY_LIMIT: '請求過於頻繁,請稍後再試。',
      REQUEST_DENIED: '請求被拒:請確認已啟用 Directions API 且 key 未受限。',
      MAX_ROUTE_LENGTH_EXCEEDED: '路線過長,請拆成多天。',
    }[code] || '計算失敗(' + code + ')。可改用直線估算。';
    setStatus(el.routeStatus, hint, 'err');
  } finally {
    planning = false;
    renderDaySettings();
  }
}

function buildLegsFromGoogle(gLegs, orderedIds, isRound, startId) {
  const seq = isRound ? [...orderedIds, startId] : orderedIds;
  const legs = [];
  for (let i = 0; i < gLegs.length && i < seq.length - 1; i++) {
    const L = gLegs[i];
    legs.push({
      fromId: seq[i], toId: seq[i + 1],
      m: (L.distance && L.distance.value) || 0,
      s: (L.duration && L.duration.value) || 0,
      est: false,
    });
  }
  return legs;
}

// 連續多段(>25 waypoints)分批請求
async function fetchChunkedRoute(pathStops, mode) {
  const MAX_POINTS = MAX_WP + 2; // 每次請求最多 27 個點
  const legs = [];
  const gResults = [];
  let i = 0;
  while (i < pathStops.length - 1) {
    const chunk = pathStops.slice(i, Math.min(i + MAX_POINTS, pathStops.length));
    setStatus(el.routeStatus, '計算路線中…(' + Math.min(i + chunk.length, pathStops.length) + '/' + pathStops.length + ' 點)');
    const res = await routeWithRetry({
      origin: { lat: chunk[0].lat, lng: chunk[0].lng },
      destination: { lat: chunk[chunk.length - 1].lat, lng: chunk[chunk.length - 1].lng },
      waypoints: chunk.slice(1, -1).map((p) => ({ location: { lat: p.lat, lng: p.lng }, stopover: true })),
      optimizeWaypoints: false,
      travelMode: mode,
    });
    gResults.push(res);
    const gLegs = res.routes[0].legs || [];
    for (let k = 0; k < gLegs.length; k++) {
      legs.push({
        fromId: chunk[k].id, toId: chunk[k + 1].id,
        m: (gLegs[k].distance && gLegs[k].distance.value) || 0,
        s: (gLegs[k].duration && gLegs[k].duration.value) || 0,
        est: false,
      });
    }
    i += chunk.length - 1;
    if (i < pathStops.length - 1) await sleep(300);
  }
  return { legs, gResults };
}

// 大眾運輸:逐段查詢並串接出發時間
async function fetchTransitLegs(d, pathStops) {
  const legs = [];
  const gResults = [];
  let t = futureDate(departDate(d));
  for (let i = 0; i < pathStops.length - 1; i++) {
    const from = pathStops[i], to = pathStops[i + 1];
    setStatus(el.routeStatus, '查詢大眾運輸路線…(' + (i + 1) + '/' + (pathStops.length - 1) + ' 段)');
    let leg, arriveAt;
    try {
      const res = await routeWithRetry({
        origin: { lat: from.lat, lng: from.lng },
        destination: { lat: to.lat, lng: to.lng },
        travelMode: 'TRANSIT',
        transitOptions: { departureTime: t },
      });
      gResults.push(res);
      const L = res.routes[0].legs[0];
      // 大眾運輸的 duration 不含「等下一班車」的時間:用真實發車/抵達時刻計算等候並串接
      const depReal = (L.departure_time && L.departure_time.value) ? L.departure_time.value : t;
      arriveAt = (L.arrival_time && L.arrival_time.value)
        ? L.arrival_time.value
        : new Date(depReal.getTime() + (((L.duration && L.duration.value) || 0) * 1000));
      leg = {
        fromId: from.id, toId: to.id,
        m: (L.distance && L.distance.value) || 0,
        s: (L.duration && L.duration.value) || 0,
        wait: Math.max(0, Math.round((depReal.getTime() - t.getTime()) / 1000)),
        est: false,
      };
    } catch (e) {
      // 該段無大眾運輸 → 以估算補
      const e2 = estimateLeg(from, to, 'TRANSIT');
      leg = { fromId: from.id, toId: to.id, m: e2.m, s: e2.s, est: true };
      arriveAt = new Date(t.getTime() + e2.s * 1000);
    }
    legs.push(leg);
    const stay = (placeById(to.id) || { stayMin: 0 }).stayMin * 60;
    t = new Date(arriveAt.getTime() + stay * 1000);
    if (i < pathStops.length - 2) await sleep(300);
  }
  legs._gResults = gResults;
  return legs;
}

function finishRoute(d, orderedIds, legs, via, gResults) {
  routes.set(d.id, { orderIds: orderedIds.slice(), legs, mode: d.mode, round: !!d.round, via, gResults: gResults || null });
  saveState();
  // 規劃期間使用者可能已切到別天:只在仍是當前天時更新畫面(結果已存,切回分頁即顯示)
  if (d.id === activeDayId) {
    renderRouteOverlays(d, gResults, orderedIds);
    renderList();
    renderMarkers();
    renderDaySettings();
    renderDayTabs();
    renderItinerary(d.id);
  }
  const est = legs.some((l) => l.est);
  const dayNo = dayIndex(d.id) + 1;
  setStatus(el.routeStatus,
    '第 ' + dayNo + ' 天路線完成 ✓' + (via === 'google'
      ? '(Google 道路資料' + (est ? ',部分路段為估算' : '') + ')'
      : '(直線距離估算,實際交通時間會更長)'), 'ok');
}

function renderRouteOverlays(d, gResults, orderedIds) {
  clearRouteOverlays();
  if (!map) return;
  const color = dayColor(d.id);
  const bounds = new google.maps.LatLngBounds();
  const dashedIcon = [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 3 }, offset: '0', repeat: '14px' }];
  let hasBounds = false;
  if (gResults && gResults.length) {
    gResults.forEach((res) => {
      const r = new google.maps.DirectionsRenderer({
        map, directions: res, suppressMarkers: true, preserveViewport: true,
        polylineOptions: { strokeColor: color, strokeOpacity: 0.85, strokeWeight: 5 },
      });
      dirRenderers.push(r);
      const b = res.routes[0] && res.routes[0].bounds;
      if (b) { bounds.union(b); hasBounds = true; }
    });
    // 估算補上的路段(例如某段查不到大眾運輸)以虛線呈現,避免地圖出現無聲缺口
    const stored = routes.get(d.id);
    if (stored) {
      stored.legs.filter((l) => l.est).forEach((l) => {
        const A = placeById(l.fromId), B = placeById(l.toId);
        if (!A || !B) return;
        const path = [{ lat: A.lat, lng: A.lng }, { lat: B.lat, lng: B.lng }];
        localLines.push(new google.maps.Polyline({
          map, path, geodesic: true, strokeColor: color, strokeOpacity: 0, strokeWeight: 3, icons: dashedIcon,
        }));
        path.forEach((p) => { bounds.extend(p); hasBounds = true; });
      });
    }
  } else {
    const stops = orderedIds.map((id) => placeById(id)).filter(Boolean);
    const path = (d.round ? [...stops, stops[0]] : stops).map((p) => ({ lat: p.lat, lng: p.lng }));
    const line = new google.maps.Polyline({
      map, path, geodesic: true,
      strokeColor: color, strokeOpacity: 0, strokeWeight: 4, icons: dashedIcon,
    });
    localLines.push(line);
    path.forEach((p) => { bounds.extend(p); hasBounds = true; });
  }
  if (hasBounds) map.fitBounds(bounds, 64);
}

// ===================== 行程表 =====================
function computeSchedule(dayId) {
  const r = routes.get(dayId);
  if (!r) return null;
  const t = activeTrip();
  const d = t.days.find((x) => x.id === dayId);
  if (!d) return null;
  const dep = departDate(d);
  const stops = r.orderIds.map((id) => placeById(id)).filter(Boolean);
  if (stops.length < 2 || !r.legs.length) return null;

  const rows = [];
  let clock = new Date(dep);
  stops.forEach((p, i) => {
    const row = { place: p, idx: i };
    if (i === 0) {
      row.leave = new Date(clock);
    } else {
      row.arrive = new Date(clock);
      const stayS = p.stayMin * 60;
      const isLast = i === stops.length - 1;
      if (!isLast || r.round) {
        row.leave = new Date(clock.getTime() + stayS * 1000);
        clock = row.leave;
      } else if (stayS > 0) {
        row.leave = new Date(clock.getTime() + stayS * 1000);
      }
    }
    const leg = r.legs[i];
    if (leg) {
      row.leg = leg;
      // wait = 等候下一班大眾運輸的時間(其他模式為 0)
      clock = new Date((row.leave || row.arrive || clock).getTime() + ((leg.wait || 0) + leg.s) * 1000);
    }
    rows.push(row);
  });
  let backArrive = null;
  if (r.round && r.legs.length === stops.length) backArrive = new Date(clock);
  const totalM = r.legs.reduce((a, l) => a + l.m, 0);
  const totalS = r.legs.reduce((a, l) => a + l.s, 0);
  // 起點的停留不計入(行程從起點「出發」開始;環狀回到起點也不再停留)
  const stayS = stops.reduce((a, p, i) => (i === 0 ? a : a + p.stayMin * 60), 0);
  const endTime = r.round ? backArrive : (rows[rows.length - 1].leave || rows[rows.length - 1].arrive);
  return { rows, totalM, totalS, stayS, endTime, backArrive, r, d, stops };
}

function rerenderTimesOnly(dayId) {
  if (routes.get(dayId)) renderItinerary(dayId);
}

function renderItinerary(dayId) {
  const sch = computeSchedule(dayId);
  if (!sch) { el.itCard.hidden = true; return; }
  const { rows, totalM, totalS, stayS, endTime, backArrive, r } = sch;
  el.itCard.hidden = false;
  el.itDayLabel.textContent = '第 ' + (dayIndex(dayId) + 1) + ' 天';

  el.itSummary.innerHTML = '';
  const mkStat = (label, value) => {
    const s = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = value;
    s.appendChild(document.createTextNode(label + ' '));
    s.appendChild(b);
    return s;
  };
  el.itSummary.appendChild(mkStat('總距離', fmtKm(totalM)));
  el.itSummary.appendChild(mkStat('交通', fmtDur(totalS)));
  el.itSummary.appendChild(mkStat('停留', fmtDur(stayS)));
  if (endTime) el.itSummary.appendChild(mkStat(r.round ? '回到起點' : '行程結束', fmtClock(endTime)));
  if (r.legs.some((l) => l.est)) el.itSummary.appendChild(mkStat('', '⚠ 含估算路段'));

  el.it.innerHTML = '';
  rows.forEach((row, i) => {
    const div = document.createElement('div');
    div.className = 'leg';
    const head = document.createElement('div');
    const time = document.createElement('span');
    time.className = 'stopTime';
    if (i === 0) time.textContent = fmtClock(row.leave) + ' 出發 ';
    else {
      let s2 = fmtClock(row.arrive) + ' 抵達';
      if (row.leave) s2 += ' → ' + fmtClock(row.leave) + ' 離開';
      time.textContent = s2 + ' ';
    }
    head.appendChild(time);
    const name = document.createElement('strong');
    name.textContent = (i + 1) + '. ' + row.place.name;
    head.appendChild(name);
    div.appendChild(head);
    if (row.place.note) {
      const nt = document.createElement('div');
      nt.className = 'small muted';
      nt.textContent = '📝 ' + row.place.note;
      div.appendChild(nt);
    }
    if (row.leg) {
      const tr = document.createElement('div');
      tr.className = 'legTravel';
      const toPlace = placeById(row.leg.toId);
      const modeIcon = (MODE_LABEL[r.mode] || '').split(' ')[0];
      const waitStr = (row.leg.wait && row.leg.wait > 60) ? '等候 ' + fmtDur(row.leg.wait) + ' · ' : '';
      tr.appendChild(document.createTextNode(
        '↓ ' + modeIcon + ' ' + waitStr + fmtKm(row.leg.m) + ' · ' + fmtDur(row.leg.s) + (row.leg.est ? '(估)' : '')
      ));
      const a = document.createElement('a');
      a.href = mapsDirUrl([row.place, toPlace || row.place], r.mode);
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.textContent = '導航此段';
      tr.appendChild(a);
      div.appendChild(tr);
    }
    el.it.appendChild(div);
  });
  if (backArrive) {
    const div = document.createElement('div');
    div.className = 'leg';
    const time = document.createElement('span');
    time.className = 'stopTime';
    time.textContent = fmtClock(backArrive) + ' ';
    div.appendChild(time);
    const name = document.createElement('strong');
    name.textContent = '回到起點:' + (rows[0] ? rows[0].place.name : '');
    div.appendChild(name);
    el.it.appendChild(div);
  }
  renderNavLinks(dayId);
}

function navChunks(r) {
  // Google Maps 導航網址:一般模式一次最多約 10 個點;大眾運輸不支援中途點 → 逐段
  const stops = r.orderIds.map((id) => placeById(id)).filter(Boolean);
  const pathStops = r.round ? [...stops, stops[0]] : stops;
  const size = r.mode === 'TRANSIT' ? 2 : NAV_CHUNK;
  const chunks = [];
  let i = 0;
  while (i < pathStops.length - 1) {
    const c = pathStops.slice(i, Math.min(i + size, pathStops.length));
    chunks.push(c);
    i += c.length - 1;
  }
  return chunks;
}
function renderNavLinks(dayId) {
  el.navLinks.innerHTML = '';
  const r = routes.get(dayId);
  if (!r) return;
  const chunks = navChunks(r);
  if (chunks.length > 1) {
    const info = document.createElement('div');
    info.className = 'small muted';
    info.textContent = r.mode === 'TRANSIT'
      ? 'Google Maps 大眾運輸導航不支援中途點,已自動逐段拆分:'
      : 'Google Maps 導航一次最多約 10 個點,已自動分成 ' + chunks.length + ' 段:';
    el.navLinks.appendChild(info);
    chunks.forEach((c, k) => {
      const a = document.createElement('a');
      a.href = mapsDirUrl(c, r.mode);
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.textContent = '第 ' + (k + 1) + ' 段:' + c[0].name + ' → ' + c[c.length - 1].name;
      el.navLinks.appendChild(a);
    });
  }
}
function openNav() {
  const d = activeDay(); if (!d) return;
  const r = routes.get(d.id);
  if (!r) { toast('請先規劃路線。', 'err'); return; }
  const chunks = navChunks(r);
  if (!chunks.length) return;
  window.open(mapsDirUrl(chunks[0], r.mode), '_blank', 'noopener');
  if (chunks.length > 1) toast('此路線分成 ' + chunks.length + ' 段:其餘連結列在行程表下方。');
}

// ===================== 匯出 =====================
function itineraryText(tripWide) {
  const t = activeTrip(); if (!t) return '';
  const days = tripWide ? t.days : [activeDay()];
  const lines = ['【' + t.name + '】行程表', ''];
  days.forEach((d, di) => {
    const idx = tripWide ? di : dayIndex(d.id);
    lines.push('── 第 ' + (idx + 1) + ' 天 ──(' + (MODE_LABEL[d.mode] || d.mode) + ',' + d.depart + ' 出發)');
    const sch = computeSchedule(d.id);
    if (sch) {
      sch.rows.forEach((row, i) => {
        let tStr = i === 0 ? (fmtClock(row.leave) + ' 出發') : (fmtClock(row.arrive) + ' 抵達' + (row.leave ? '~' + fmtClock(row.leave) : ''));
        lines.push((i + 1) + '. ' + row.place.name + '(' + tStr + ')');
        if (row.place.note) lines.push('   📝 ' + row.place.note);
        if (row.leg) lines.push('   ↓ ' + fmtKm(row.leg.m) + ' · ' + fmtDur(row.leg.s) + (row.leg.est ? '(估)' : ''));
      });
      if (sch.backArrive) lines.push('回到起點:' + fmtClock(sch.backArrive));
      lines.push('合計:' + fmtKm(sch.totalM) + ' · 交通 ' + fmtDur(sch.totalS) + ' · 停留 ' + fmtDur(sch.stayS));
    } else {
      const list = displayOrder(d.id);
      if (!list.length) lines.push('(本日無景點)');
      list.forEach((p, i) => {
        lines.push((i + 1) + '. ' + p.name + (p.stayMin ? '(停留 ' + p.stayMin + ' 分)' : ''));
        if (p.note) lines.push('   📝 ' + p.note);
      });
    }
    lines.push('');
  });
  lines.push('— 由 TripRoute Pro 產生');
  return lines.join('\n');
}
async function copyItinerary() {
  const ok = await copyToClipboard(itineraryText(false));
  toast(ok ? '已複製行程文字。' : '複製失敗,請手動選取。', ok ? 'ok' : 'err');
}
function csvEscape(v) {
  v = String(v == null ? '' : v);
  if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function exportCsv() {
  const t = activeTrip(); if (!t) return;
  const rows = [['天', '順序', '名稱', '地址', '緯度', '經度', '停留(分)', '抵達', '離開', '備註']];
  t.days.forEach((d, di) => {
    const sch = computeSchedule(d.id);
    const list = displayOrder(d.id);
    list.forEach((p, i) => {
      let arrive = '', leave = '';
      if (sch) {
        const row = sch.rows.find((r2) => r2.place.id === p.id);
        if (row) {
          arrive = row.arrive ? fmtClock(row.arrive) : '';
          leave = row.leave ? fmtClock(row.leave) : '';
        }
      }
      rows.push([di + 1, i + 1, p.name, p.address, p.lat.toFixed(6), p.lng.toFixed(6), p.stayMin, arrive, leave, p.note]);
    });
  });
  const csv = '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  download((t.name || 'trip') + '.csv', csv, 'text/csv;charset=utf-8');
  toast('已匯出 CSV。', 'ok');
}
function printItinerary() {
  buildPrintArea();
  window.print();
}
function buildPrintArea() {
  const t = activeTrip(); if (!t) return;
  const area = el.printArea;
  area.innerHTML = '';
  const h1 = document.createElement('h1');
  h1.textContent = t.name + ' — 行程表';
  area.appendChild(h1);
  const meta = document.createElement('div');
  meta.className = 'pMeta';
  meta.textContent = '共 ' + t.days.length + ' 天 · ' + t.places.length + ' 個景點 · 產生於 ' + new Date().toLocaleString('zh-TW');
  area.appendChild(meta);
  t.days.forEach((d, di) => {
    const list = displayOrder(d.id);
    if (!list.length) return;
    const h2 = document.createElement('h2');
    h2.textContent = '第 ' + (di + 1) + ' 天(' + (MODE_LABEL[d.mode] || d.mode) + ' · ' + d.depart + ' 出發' + (d.round ? ' · 環狀' : '') + ')';
    area.appendChild(h2);
    const sch = computeSchedule(d.id);
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    ['#', '時間', '景點', '地址', '停留', '備註'].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    list.forEach((p, i) => {
      const tr = document.createElement('tr');
      let timeStr = '';
      if (sch) {
        const row = sch.rows.find((r2) => r2.place.id === p.id);
        if (row) {
          if (i === 0 && row.leave) timeStr = fmtClock(row.leave) + ' 出發';
          else if (row.arrive) timeStr = fmtClock(row.arrive) + (row.leave ? '–' + fmtClock(row.leave) : '');
        }
      }
      [String(i + 1), timeStr, p.name, p.address, p.stayMin + ' 分', p.note || ''].forEach((v) => {
        const td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    area.appendChild(table);
    if (sch) {
      const sum = document.createElement('div');
      sum.className = 'pMeta';
      sum.textContent = '合計:' + fmtKm(sch.totalM) + ' · 交通 ' + fmtDur(sch.totalS) + ' · 停留 ' + fmtDur(sch.stayS) +
        (sch.endTime ? ' · ' + (sch.r.round ? '回到起點 ' : '結束 ') + fmtClock(sch.endTime) : '');
      area.appendChild(sum);
    }
  });
}

// ===================== 行程管理 =====================
function renderTripSelect() {
  el.tripSelect.innerHTML = '';
  state.trips.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name;
    el.tripSelect.appendChild(o);
  });
  el.tripSelect.value = state.activeTripId;
}
function switchTrip(id) {
  if (!state.trips.some((t) => t.id === id)) return;
  state.activeTripId = id;
  activeDayId = null;
  routes.clear();
  clearRouteOverlays();
  el.itCard.hidden = true;
  saveState();
  syncAll();
  fitAllVisible();
}
function tripAction(act) {
  const t = activeTrip();
  switch (act) {
    case 'new': {
      const name = window.prompt('新行程名稱:', '行程 ' + (state.trips.length + 1));
      if (name == null) return;
      const nt = defaultTrip(name.trim() || '未命名行程');
      state.trips.push(nt);
      switchTrip(nt.id);
      toast('已建立行程。', 'ok');
      break;
    }
    case 'rename': {
      if (!t) return;
      const name = window.prompt('行程名稱:', t.name);
      if (name == null) return;
      t.name = name.trim().slice(0, 60) || t.name;
      saveState();
      renderTripSelect();
      break;
    }
    case 'duplicate': {
      if (!t) return;
      const copy = sanitizeTrip(JSON.parse(JSON.stringify(t)));
      copy.name = t.name + '(複本)';
      state.trips.push(copy);
      switchTrip(copy.id);
      toast('已複製行程。', 'ok');
      break;
    }
    case 'delete': {
      if (!t) return;
      if (!window.confirm('刪除行程「' + t.name + '」?此動作無法復原。')) return;
      state.trips = state.trips.filter((x) => x.id !== t.id);
      if (!state.trips.length) state.trips.push(defaultTrip());
      switchTrip(state.trips[0].id);
      toast('已刪除行程。');
      break;
    }
    case 'export': {
      if (!t) return;
      download((t.name || 'trip') + '.json', JSON.stringify({ app: 'TripRoutePro', v: 2, trip: t }, null, 2), 'application/json');
      toast('已匯出 JSON。', 'ok');
      break;
    }
    case 'import':
      el.importFile.click();
      break;
    case 'share': {
      if (!t) return;
      const payload = b64urlEncode(JSON.stringify({ v: 2, trip: t }));
      const url = location.origin + location.pathname + '#trip=' + payload;
      if (url.length > 7500) {
        toast('行程太大無法用網址分享,請改用「匯出 JSON」。', 'err');
        return;
      }
      copyToClipboard(url).then((ok) => {
        toast(ok ? '分享連結已複製!開啟連結即可匯入此行程。' : '複製失敗。', ok ? 'ok' : 'err');
      });
      break;
    }
  }
}
function handleImportFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const trip = sanitizeTrip(data.trip || data);
      if (!trip || !trip.places) throw new Error('bad');
      state.trips.push(trip);
      switchTrip(trip.id);
      toast('已匯入行程「' + trip.name + '」(' + trip.places.length + ' 個景點)。', 'ok');
    } catch (e) {
      toast('匯入失敗:檔案格式不正確。', 'err');
    }
  };
  reader.readAsText(file);
}
function checkShareHash() {
  if (!location.hash.startsWith('#trip=')) return;
  try {
    const json = b64urlDecode(location.hash.slice(6));
    const data = JSON.parse(json);
    const trip = sanitizeTrip(data.trip || data);
    if (!trip) throw new Error('bad');
    history.replaceState(null, '', location.pathname + location.search);
    if (!window.confirm('偵測到分享的行程「' + trip.name + '」(' + trip.places.length + ' 個景點)。要匯入嗎?')) return;
    state.trips.push(trip);
    state.activeTripId = trip.id;
    saveStateNow();
    toastLater('已匯入分享行程。');
  } catch (e) {
    history.replaceState(null, '', location.pathname + location.search);
    toastLater('分享連結無效或已損毀。');
  }
}

// ===================== 總同步 =====================
function syncAll() {
  renderTripSelect();
  renderDayTabs();
  renderDaySettings();
  renderList();
  renderMarkers();
  const d = activeDay();
  const r = d ? routes.get(d.id) : null;
  clearRouteOverlays();
  if (r) {
    renderRouteOverlays(d, r.gResults, r.orderIds);
    renderItinerary(d.id);
  } else {
    el.itCard.hidden = true;
  }
}

// ===================== 事件繫結 =====================
function bind() {
  // 主題
  el.themeToggle.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  // API key
  el.saveKey.addEventListener('click', () => {
    const k = el.apiKey.value.trim();
    if (!k) { setStatus(el.keyStatus, '請貼上 API key。'); return; }
    saveKey(k);
    setStatus(el.keyStatus, '已儲存,載入地圖中…');
    loadGoogleMaps(k);
  });
  el.clearKey.addEventListener('click', () => {
    clearKeyStore();
    el.apiKey.value = '';
    setStatus(el.keyStatus, '已清除 key(重新整理後地圖將不再載入)。');
  });

  // 搜尋
  el.q.addEventListener('input', onQueryInput);
  el.q.addEventListener('keydown', (ev) => {
    if (!el.acList.hidden && acItems.length) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); acSel = (acSel + 1) % acItems.length; renderAc(); return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); acSel = (acSel - 1 + acItems.length) % acItems.length; renderAc(); return; }
      if (ev.key === 'Enter' && acSel >= 0) { ev.preventDefault(); pickAc(acSel); return; }
      if (ev.key === 'Escape') { hideAc(); return; }
    }
    if (ev.key === 'Enter') { ev.preventDefault(); doSearch(); }
  });
  el.q.addEventListener('blur', () => setTimeout(hideAc, 150));
  el.search.addEventListener('click', doSearch);
  el.locate.addEventListener('click', useMyLocation);
  el.cand.addEventListener('change', previewCandidate);
  el.confirm.addEventListener('click', confirmCandidate);

  // 天數與設定
  el.addDay.addEventListener('click', addDay);
  el.depart.addEventListener('change', () => {
    const d = activeDay(); if (!d) return;
    d.depart = el.depart.value || '09:00';
    saveState();
    rerenderTimesOnly(d.id);
  });
  el.mode.addEventListener('change', () => {
    const d = activeDay(); if (!d) return;
    d.mode = el.mode.value;
    invalidateDay(d.id);
    saveState();
    syncAll();
  });
  el.round.addEventListener('change', () => {
    const d = activeDay(); if (!d) return;
    d.round = el.round.checked;
    invalidateDay(d.id);
    saveState();
    syncAll();
  });
  el.start.addEventListener('change', () => { const d = activeDay(); if (d) { d.startId = el.start.value; saveState(); } });
  el.end.addEventListener('change', () => { const d = activeDay(); if (d) { d.endId = el.end.value; saveState(); } });
  el.opt.addEventListener('click', () => planRoute(true));
  el.planAsIs.addEventListener('click', () => planRoute(false));

  // 清單
  el.clearDay.addEventListener('click', clearDay);
  el.undoBtn.addEventListener('click', doUndo);

  // 行程表動作
  el.openNav.addEventListener('click', openNav);
  el.copyText.addEventListener('click', copyItinerary);
  el.exportCsv.addEventListener('click', exportCsv);
  el.printBtn.addEventListener('click', printItinerary);
  // 瀏覽器選單 / Ctrl+P 列印也要有內容
  window.addEventListener('beforeprint', buildPrintArea);

  // 地圖
  el.showAllDays.addEventListener('change', () => { renderMarkers(); fitAllVisible(); });

  // 行程選單
  el.tripSelect.addEventListener('change', () => switchTrip(el.tripSelect.value));
  el.tripMenuBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = el.tripMenu.hidden;
    el.tripMenu.hidden = !open;
    el.tripMenuBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (ev) => {
    if (!el.tripMenu.hidden && !el.tripMenu.contains(ev.target) && ev.target !== el.tripMenuBtn) {
      el.tripMenu.hidden = true;
      el.tripMenuBtn.setAttribute('aria-expanded', 'false');
    }
  });
  el.tripMenu.querySelectorAll('button[data-act]').forEach((b) => {
    b.addEventListener('click', () => {
      el.tripMenu.hidden = true;
      tripAction(b.dataset.act);
    });
  });
  el.importFile.addEventListener('change', () => {
    handleImportFile(el.importFile.files && el.importFile.files[0]);
    el.importFile.value = '';
  });
}

// ===================== 啟動 =====================
function boot() {
  // 主題
  let theme = 'dark';
  try { theme = localStorage.getItem(LS_THEME) || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch (e) {}
  applyTheme(theme);

  loadState();
  saveStateNow(); // 立即持久化(含 v1 遷移結果),避免重新整理時重跑遷移
  checkShareHash();
  bind();
  syncAll();

  // referrer 提示
  try {
    let base = location.pathname.replace(/[^/]*$/, '');
    if (!base.endsWith('/')) base += '/';
    el.originHint.textContent = 'Referrer 建議設定:' + location.origin + base + '*';
  } catch (e) {}

  const saved = loadKey();
  if (saved) {
    el.apiKey.value = saved;
    loadGoogleMaps(saved);
  } else {
    setStatus(el.keyStatus, '請貼上 Google Maps API key 以啟用地圖與路線功能。');
  }

  pendingToasts.forEach((m) => toast(m));
  pendingToasts = [];

  // PWA
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
})();
