// ── CONFIG ──────────────────────────────────────────────────
const SUPABASE_URL = 'https://plafcxbkwycmluxxxim.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KsuhKoQKFa8fQAdgWez4lw_JO_dgq5i';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const CACHE_KEY = 'ima_mapa_places';

// ── CONSTANTS ───────────────────────────────────────────────
const CATEGORIES = [
  { value: 'restaurant',  label: 'מסעדה',                emoji: '🍽️', css: 'cat-restaurant' },
  { value: 'cafe',        label: 'בית קפה',               emoji: '☕',  css: 'cat-cafe' },
  { value: 'museum',      label: 'מוזיאון',                emoji: '🏛️', css: 'cat-museum' },
  { value: 'historic',    label: 'אתר היסטורי',            emoji: '🏰', css: 'cat-historic' },
  { value: 'nature',      label: 'אטרקציה טבעית',          emoji: '🏞️', css: 'cat-nature' },
  { value: 'park',        label: 'פארק לאומי / שמורה',     emoji: '🌳', css: 'cat-park' },
  { value: 'market',      label: 'שוק',                   emoji: '🛍️', css: 'cat-market' },
  { value: 'beach',       label: 'חוף ים / אגם',           emoji: '🏖️', css: 'cat-beach' },
  { value: 'viewpoint',   label: 'מצפה / תצפית',           emoji: '🔭', css: 'cat-viewpoint' },
  { value: 'village',     label: 'כפר / יישוב מיוחד',     emoji: '🏘️', css: 'cat-village' },
  { value: 'sculpture',   label: 'גן פסלים',               emoji: '🗿', css: 'cat-sculpture' },
  { value: 'street_art',  label: 'אומנות רחוב',            emoji: '🎨', css: 'cat-street_art' },
  { value: 'other',       label: 'אחר',                   emoji: '📍', css: 'cat-other' },
];

const REGIONS = [
  'גליל עליון','גליל תחתון','גולן','עמק יזרעאל','עמק המעיינות',
  'כרמל וחיפה','עמק החולה','חוף הצפון','בקעת הירדן','שרון',
  'תל אביב והמרכז','שפלה','ירושלים והסביבה','יהודה ושומרון',
  'ים המלח','מכתשים / מצפה רמון','נגב צפוני','נגב דרומי','ערבה','אילת'
];

// ── STATE ───────────────────────────────────────────────────
let allPlaces = [];
let filteredPlaces = [];
let currentPlace = null;
let mainMap, routeMap;
let markers = {};
let regionLayer = null;
let drawingManager = null;
let drawnShape = null;
let isDrawing = false;
let routePolyline = null;
let routeMarkers = [];
let pinAction = null;
let editingId = null;
let gpsWatchId = null;
let gpsMarker = null;
let gpsAccuracyCircle = null;
let gpsCenteredOnce = false;

// ── INIT (called by Google Maps API as callback) ─────────────
async function initApp() {
  initMaps();
  populateSelects();
  buildForm();
  await loadPlaces();
}

function initMaps() {
  const israelBounds = { north: 34.5, south: 28.0, west: 33.5, east: 37.2 };

  mainMap = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 31.5, lng: 35.0 },
    zoom: 8,
    restriction: { latLngBounds: israelBounds, strictBounds: false },
    minZoom: 7,
    mapTypeControl: false,
    fullscreenControl: false,
    streetViewControl: false,
  });

  routeMap = new google.maps.Map(document.getElementById('route-map'), {
    center: { lat: 31.5, lng: 35.0 },
    zoom: 8,
    mapTypeControl: false,
    fullscreenControl: false,
    streetViewControl: false,
    zoomControl: false,
  });

  mainMap.addListener('click', e => {
    if (!document.getElementById('form-panel').classList.contains('hidden')) {
      document.getElementById('f-lat').value = e.latLng.lat().toFixed(6);
      document.getElementById('f-lng').value = e.latLng.lng().toFixed(6);
    }
  });
}

function populateSelects() {
  const addOpts = (el, items) => items.forEach(v => {
    el.innerHTML += `<option value="${v}">${v}</option>`;
  });
  addOpts(document.getElementById('filter-region'), REGIONS);
  addOpts(document.getElementById('region-highlight-select'), REGIONS);
  CATEGORIES.forEach(c => {
    document.getElementById('filter-category').innerHTML +=
      `<option value="${c.value}">${c.emoji} ${c.label}</option>`;
  });
}

// ── DATA ────────────────────────────────────────────────────
async function loadPlaces() {
  const { data, error } = await db.from('places').select('*').order('name');
  if (!error && data) {
    allPlaces = data;
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } else {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      allPlaces = JSON.parse(cached);
      showOfflineBanner();
    } else {
      allPlaces = [];
    }
  }
  filteredPlaces = [...allPlaces];
  renderMarkers();
  renderList();
  renderRoutePlaces();
}

function showOfflineBanner() {
  if (document.getElementById('offline-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'offline-banner';
  banner.style.cssText =
    'position:fixed;top:54px;right:0;left:0;background:#ef4444;color:white;' +
    'text-align:center;padding:7px;font-size:13px;z-index:999;';
  banner.textContent = '⚠️ מוצג מגיבוי מקומי — ייתכן שהנתונים אינם עדכניים';
  document.body.appendChild(banner);
  repositionGPSBanner();
}

function getCat(value) {
  return CATEGORIES.find(c => c.value === value) || CATEGORIES[CATEGORIES.length - 1];
}

// ── GPS ─────────────────────────────────────────────────────
function toggleGPS() {
  if (gpsWatchId !== null) {
    stopGPS();
  } else {
    startGPS();
  }
}

function startGPS() {
  if (!navigator.geolocation) {
    alert('הדפדפן שלך אינו תומך ב-GPS');
    return;
  }
  const btn = document.getElementById('btn-gps');
  btn.textContent = '📍 מעקב פעיל';
  btn.classList.add('active');
  gpsCenteredOnce = false;
  showGPSBanner();

  gpsWatchId = navigator.geolocation.watchPosition(
    pos => updateGPSMarker(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
    () => {
      alert('לא ניתן לקבל מיקום. בדקי שהרשאות המיקום מאופשרות.');
      stopGPS();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

function stopGPS() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  if (gpsMarker) { gpsMarker.setMap(null); gpsMarker = null; }
  if (gpsAccuracyCircle) { gpsAccuracyCircle.setMap(null); gpsAccuracyCircle = null; }
  const btn = document.getElementById('btn-gps');
  btn.textContent = '📍 המיקום שלי';
  btn.classList.remove('active');
  hideGPSBanner();
}

function updateGPSMarker(lat, lng, accuracy) {
  if (gpsMarker) gpsMarker.setMap(null);
  if (gpsAccuracyCircle) { gpsAccuracyCircle.setMap(null); gpsAccuracyCircle = null; }

  if (accuracy > 30) {
    gpsAccuracyCircle = new google.maps.Circle({
      center: { lat, lng },
      radius: accuracy,
      fillColor: '#2196F3',
      fillOpacity: 0.1,
      strokeColor: '#2196F3',
      strokeWeight: 1,
      map: mainMap,
    });
  }

  const gpsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
    <circle cx="12" cy="12" r="7" fill="#2196F3" stroke="white" stroke-width="2.5"/>
    <circle cx="12" cy="12" r="11" fill="rgba(33,150,243,0.25)" stroke="none"/>
  </svg>`;

  gpsMarker = new google.maps.Marker({
    position: { lat, lng },
    map: mainMap,
    icon: {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(gpsSvg),
      scaledSize: new google.maps.Size(24, 24),
      anchor: new google.maps.Point(12, 12),
    },
    zIndex: 1000,
  });

  if (!gpsCenteredOnce) {
    mainMap.setCenter({ lat, lng });
    mainMap.setZoom(14);
    gpsCenteredOnce = true;
  }
}

function showGPSBanner() {
  let banner = document.getElementById('gps-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'gps-banner';
    document.body.appendChild(banner);
  }
  const offlineBanner = document.getElementById('offline-banner');
  const top = (offlineBanner && offlineBanner.style.display !== 'none') ? 88 : 54;
  banner.style.cssText =
    `position:fixed;top:${top}px;right:0;left:0;background:#f59e0b;color:white;` +
    'text-align:center;padding:7px;font-size:13px;z-index:999;';
  banner.textContent = '📍 מעקב GPS פעיל — צורך יותר סוללה';
}

function hideGPSBanner() {
  const banner = document.getElementById('gps-banner');
  if (banner) banner.remove();
}

function repositionGPSBanner() {
  const gpsBanner = document.getElementById('gps-banner');
  if (gpsBanner) gpsBanner.style.top = '88px';
}

// ── MARKERS ─────────────────────────────────────────────────
function createMarkerIcon(emoji, bgColor, opacity) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38">
    <circle cx="19" cy="19" r="17" fill="${bgColor}" stroke="white" stroke-width="2.5" opacity="${opacity}"/>
    <text x="19" y="25" text-anchor="middle" font-size="20"
      font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${emoji}</text>
  </svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(38, 38),
    anchor: new google.maps.Point(19, 19),
  };
}

function renderMarkers() {
  Object.values(markers).forEach(m => m.setMap(null));
  markers = {};
  filteredPlaces.forEach(place => {
    if (!place.lat || !place.lng) return;
    const cat = getCat(place.category);
    const icon = createMarkerIcon(cat.emoji, catColor(cat.css), place.visited ? 0.55 : 1);
    const m = new google.maps.Marker({
      position: { lat: place.lat, lng: place.lng },
      map: mainMap,
      icon,
    });
    m.addListener('click', () => showDetail(place));
    markers[place.id] = m;
  });
}

function catColor(css) {
  const map = {
    'cat-restaurant':'#fff3cd','cat-cafe':'#ede0d4','cat-museum':'#d6e4ff',
    'cat-historic':'#fff0b3','cat-nature':'#d4edda','cat-park':'#b8f0d0',
    'cat-market':'#ffd6a5','cat-beach':'#b8e8ff','cat-viewpoint':'#e8d5ff',
    'cat-village':'#ffe4c4','cat-sculpture':'#fce4ec','cat-street_art':'#f3e5f5',
    'cat-other':'#f0f0f0'
  };
  return map[css] || '#f0f0f0';
}

// ── DETAIL ──────────────────────────────────────────────────
function showDetail(place) {
  currentPlace = place;
  const cat = getCat(place.category);

  const rows = [
    ['קטגוריה', cat.label],
    ['אזור', place.region],
    ['שעות פתיחה', place.hours],
    ['עלות כניסה', place.entrance_fee],
    ['מינימום קבוצה', place.min_group ? `${place.min_group} אנשים` : null],
    ['משך ביקור', place.visit_duration ? `${place.visit_duration} דקות` : null],
    ['עמוד באטלס', place.atlas_page],
    ['טלפון', place.phone ? `<a href="tel:${place.phone}">${place.phone}</a>` : null],
    ['אתר', place.website ? `<a href="${place.website}" target="_blank">לחצי כאן</a>` : null],
    ['מזג אוויר', place.bad_weather ? '✅ מתאים גם בגשם' : null],
    ['הזמנה מראש', place.reservation_needed ? '⚠️ נדרשת הזמנה' : null],
    ['חניה', {yes:'יש', paid:'בתשלום', no:'אין'}[place.parking] || null],
    ['נגישות', {yes:'נגיש', partial:'חלקית', no:'לא נגיש'}[place.accessibility] || null],
    ['ביקרנו', place.visited ? '✓ כן' : null],
    ['עונתיות', {year_round:'כל השנה', summer:'קיץ בלבד', winter:'חורף בלבד'}[place.seasonality] || null],
    ['רמת מאמץ', {easy:'קל', medium:'בינוני', hard:'מאתגר'}[place.difficulty] || null],
    ['כשר', place.kosher === true ? 'כן' : place.kosher === false ? 'לא' : null],
    ['סוג אוכל', place.food_type],
    ['רמת מחיר', {cheap:'זול 💚', average:'ממוצע 💛', expensive:'יקר 🔴'}[place.price_level] || null],
    ['הערות', place.notes],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');

  document.getElementById('detail-content').innerHTML = `
    <div style="padding:4px 0 12px">
      ${place.visited ? '<span class="visited-tag">✓ ביקרנו</span>' : ''}
      <div class="detail-title">${cat.emoji} ${place.name}</div>
      <div class="detail-subtitle">${cat.label}${place.region ? ' · ' + place.region : ''}</div>
    </div>
    ${rows.map(([l,v]) => `
      <div class="detail-row">
        <span class="detail-label">${l}</span>
        <span class="detail-value">${v}</span>
      </div>`).join('')}
    ${place.lat && place.lng ? `
      <button onclick="navigate(${place.lat},${place.lng})" class="btn-primary" style="margin-top:14px">
        🧭 נווט למקום
      </button>` : ''}
    <button onclick="requestPin('edit')" class="btn-secondary" style="margin-top:6px">✏️ עריכה</button>
    <button onclick="requestPin('delete')" class="btn-danger" style="margin-top:6px">🗑️ מחיקה</button>
  `;
  document.getElementById('detail-panel').classList.remove('hidden');
}

function closeDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
}

function navigate(lat, lng) {
  window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes&zoom=17`, '_blank');
}

// ── LIST ────────────────────────────────────────────────────
function renderList() {
  renderListItems(filteredPlaces);
}

function renderListItems(places) {
  const list = document.getElementById('places-list');
  if (!places.length) {
    list.innerHTML = '<div style="padding:36px;text-align:center;color:#aaa">אין מקומות להצגה</div>';
    return;
  }
  list.innerHTML = places.map(p => {
    const cat = getCat(p.category);
    return `<div class="place-item" onclick='openFromList(${JSON.stringify(p).replace(/'/g,"&#39;")})'>
      <div class="place-icon ${cat.css}">${cat.emoji}</div>
      <div style="flex:1">
        <div class="place-name">${p.name}${p.visited ? ' <span class="visited-tag">✓</span>' : ''}</div>
        <div class="place-meta">${[p.region, cat.label].filter(Boolean).join(' · ')}</div>
      </div>
      ${p.bad_weather ? '<span title="מתאים למזג אוויר גרוע">🌧️</span>' : ''}
    </div>`;
  }).join('');
}

function openFromList(place) {
  showView('map');
  setTimeout(() => showDetail(place), 200);
  if (place.lat && place.lng) {
    mainMap.setCenter({ lat: place.lat, lng: place.lng });
    mainMap.setZoom(14);
  }
}

function filterList() {
  const q = document.getElementById('search-input').value.toLowerCase();
  renderListItems(allPlaces.filter(p =>
    p.name.toLowerCase().includes(q) ||
    (p.region || '').toLowerCase().includes(q) ||
    (p.notes || '').toLowerCase().includes(q)
  ));
}

// ── FILTERS ─────────────────────────────────────────────────
function toggleFilter() {
  document.getElementById('filter-panel').classList.toggle('hidden');
}

function applyFilters() {
  const region   = document.getElementById('filter-region').value;
  const category = document.getElementById('filter-category').value;
  const bw       = document.getElementById('filter-bad-weather').checked;
  const nv       = document.getElementById('filter-not-visited').checked;

  filteredPlaces = allPlaces.filter(p => {
    if (region   && p.region    !== region)   return false;
    if (category && p.category  !== category) return false;
    if (bw       && !p.bad_weather)           return false;
    if (nv       && p.visited)                return false;
    return true;
  });
  renderMarkers();
  renderList();
  toggleFilter();
}

function clearFilters() {
  ['filter-region','filter-category'].forEach(id => document.getElementById(id).value = '');
  ['filter-bad-weather','filter-not-visited'].forEach(id =>
    document.getElementById(id).checked = false);
  filteredPlaces = [...allPlaces];
  renderMarkers();
  renderList();
  toggleFilter();
}

// ── REGION HIGHLIGHT ────────────────────────────────────────
function highlightRegion(name) {
  if (regionLayer) {
    regionLayer.forEach(f => mainMap.data.remove(f));
    regionLayer = null;
  }
  mainMap.data.setStyle({ visible: false });
  if (!name) return;

  const feat = REGIONS_DATA.features.find(f => f.properties.name === name);
  if (!feat) return;

  regionLayer = mainMap.data.addGeoJson({ type: 'FeatureCollection', features: [feat] });
  mainMap.data.setStyle({
    fillColor: '#0038B8',
    strokeColor: '#0038B8',
    fillOpacity: 0.12,
    strokeWeight: 2,
    visible: true,
  });

  const bounds = new google.maps.LatLngBounds();
  const extendBounds = coords => {
    if (Array.isArray(coords[0])) {
      coords.forEach(extendBounds);
    } else {
      bounds.extend({ lat: coords[1], lng: coords[0] });
    }
  };
  if (feat.geometry.type === 'Polygon') {
    extendBounds(feat.geometry.coordinates[0]);
  } else if (feat.geometry.type === 'MultiPolygon') {
    feat.geometry.coordinates.forEach(poly => extendBounds(poly[0]));
  }
  mainMap.fitBounds(bounds);
}

// ── DRAW AREA ───────────────────────────────────────────────
function toggleDraw() {
  const btn = document.getElementById('btn-draw');
  if (isDrawing) {
    if (drawingManager) { drawingManager.setMap(null); drawingManager = null; }
    if (drawnShape) { drawnShape.setMap(null); drawnShape = null; }
    isDrawing = false;
    btn.classList.remove('active');
    btn.textContent = '✏️ סמן אזור';
    filteredPlaces = [...allPlaces];
    renderMarkers();
    return;
  }
  isDrawing = true;
  btn.classList.add('active');
  btn.textContent = '✕ בטל סימון';

  drawingManager = new google.maps.drawing.DrawingManager({
    drawingMode: google.maps.drawing.OverlayType.CIRCLE,
    drawingControl: true,
    drawingControlOptions: {
      position: google.maps.ControlPosition.TOP_CENTER,
      drawingModes: [
        google.maps.drawing.OverlayType.CIRCLE,
        google.maps.drawing.OverlayType.POLYGON,
      ],
    },
    circleOptions: {
      fillColor: '#0038B8', fillOpacity: 0.1,
      strokeColor: '#0038B8', strokeWeight: 2,
    },
    polygonOptions: {
      fillColor: '#0038B8', fillOpacity: 0.1,
      strokeColor: '#0038B8', strokeWeight: 2,
    },
  });
  drawingManager.setMap(mainMap);

  google.maps.event.addListenerOnce(drawingManager, 'overlaycomplete', e => {
    if (drawnShape) drawnShape.setMap(null);
    drawnShape = e.overlay;
    drawingManager.setDrawingMode(null);

    filteredPlaces = allPlaces.filter(p => {
      if (!p.lat || !p.lng) return false;
      const pos = new google.maps.LatLng(p.lat, p.lng);
      if (e.type === google.maps.drawing.OverlayType.CIRCLE) {
        return google.maps.geometry.spherical.computeDistanceBetween(
          e.overlay.getCenter(), pos) <= e.overlay.getRadius();
      }
      return google.maps.geometry.poly.containsLocation(pos, e.overlay);
    });
    renderMarkers();
    renderList();
  });
}

// ── PIN ─────────────────────────────────────────────────────
function requestPin(action) {
  pinAction = action;
  document.getElementById('pin-input').value = '';
  document.getElementById('pin-error').classList.add('hidden');
  document.getElementById('pin-dialog').classList.remove('hidden');
  setTimeout(() => document.getElementById('pin-input').focus(), 100);
}

async function submitPin() {
  const pin = document.getElementById('pin-input').value;
  const { data } = await db.from('settings').select('value').eq('key','pin').single();
  if (data && data.value === pin) {
    document.getElementById('pin-dialog').classList.add('hidden');
    if (pinAction === 'add')           openAddForm();
    else if (pinAction === 'edit')     openEditForm(currentPlace);
    else if (pinAction === 'delete')   confirmDelete();
    else if (pinAction === 'settings') openSettings();
  } else {
    document.getElementById('pin-error').classList.remove('hidden');
  }
}

function cancelPin() { document.getElementById('pin-dialog').classList.add('hidden'); }

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !document.getElementById('pin-dialog').classList.contains('hidden'))
    submitPin();
});

// ── FORM BUILD ──────────────────────────────────────────────
function buildForm() {
  const radio = (name, opts) =>
    `<div class="radio-row">${opts.map(([v,l]) =>
      `<label><input type="radio" name="${name}" value="${v}"> ${l}</label>`).join('')}</div>`;

  const sel = (id, opts) =>
    `<select id="${id}"><option value="">לא ידוע</option>${opts.map(([v,l]) =>
      `<option value="${v}">${l}</option>`).join('')}</select>`;

  document.getElementById('place-form').innerHTML = `
    <div class="form-group"><label>שם המקום *</label><input type="text" id="f-name"></div>
    <div class="form-group"><label>קטגוריה</label>
      <select id="f-category"><option value="">בחרי קטגוריה</option>
        ${CATEGORIES.map(c=>`<option value="${c.value}">${c.emoji} ${c.label}</option>`).join('')}
      </select></div>
    <div class="form-group"><label>אזור</label>
      <select id="f-region"><option value="">בחרי אזור</option>
        ${REGIONS.map(r=>`<option value="${r}">${r}</option>`).join('')}
      </select></div>
    <div class="form-group"><label>שעות פתיחה</label>
      <input type="text" id="f-hours" placeholder="לדוגמה: א׳-ה׳ 9:00-17:00"></div>
    <div class="form-group"><label>עלות כניסה</label>
      <input type="text" id="f-entrance-fee" placeholder="לדוגמה: 30 ₪ למבוגר"></div>
    <div class="form-group"><label>מינימום קבוצה (אנשים)</label>
      <input type="number" id="f-min-group" min="1"></div>
    <div class="form-group"><label>משך ביקור מוערך (דקות)</label>
      <input type="number" id="f-visit-duration" min="15" step="15" placeholder="90"></div>
    <div class="form-group"><label>עמוד באטלס כבישים</label>
      <input type="number" id="f-atlas-page"></div>
    <div class="form-group"><label>טלפון</label>
      <input type="tel" id="f-phone" dir="ltr"></div>
    <div class="form-group"><label>אתר אינטרנט</label>
      <input type="url" id="f-website" dir="ltr" placeholder="https://..."></div>
    <div class="form-group"><label>מידע כללי / הערות</label>
      <textarea id="f-notes"></textarea></div>
    <div class="form-group"><label>מתאים למזג אוויר בעייתי?</label>
      ${radio('bad_weather',[['false','לא'],['true','כן']])}</div>
    <div class="form-group"><label>צריך הזמנה מראש?</label>
      ${radio('reservation',[['false','לא'],['true','כן']])}</div>
    <div class="form-group"><label>חניה</label>
      ${sel('f-parking',[['yes','יש'],['paid','בתשלום'],['no','אין']])}</div>
    <div class="form-group"><label>נגישות לנכים</label>
      ${sel('f-accessibility',[['yes','נגיש'],['partial','חלקית'],['no','לא נגיש']])}</div>
    <div class="form-group"><label>ביקרנו כבר?</label>
      ${radio('visited',[['false','לא'],['true','כן']])}</div>
    <div class="form-group"><label>עונתיות</label>
      ${sel('f-seasonality',[['year_round','כל השנה'],['summer','קיץ בלבד'],['winter','חורף בלבד']])}</div>
    <div class="form-group"><label>רמת מאמץ פיזי</label>
      ${sel('f-difficulty',[['easy','קל'],['medium','בינוני'],['hard','מאתגר']])}</div>
    <div class="form-group"><label>כשר?</label>
      ${radio('kosher',[['','לא ידוע'],['true','כן'],['false','לא']])}</div>
    <div class="form-group"><label>סוג אוכל</label>
      <input type="text" id="f-food-type" placeholder="שיפודים, דגים, איטלקי..."></div>
    <div class="form-group"><label>רמת מחיר</label>
      ${sel('f-price-level',[['cheap','זול'],['average','ממוצע'],['expensive','יקר']])}</div>
    <div class="form-group"><label>מיקום על המפה</label>
      <p style="font-size:13px;color:#888;margin-bottom:8px">לחצי על המפה לסימון מיקום, או הזיני ידנית:</p>
      <div style="display:flex;gap:8px">
        <input type="number" id="f-lat" placeholder="רוחב (lat)" step="0.0001" dir="ltr">
        <input type="number" id="f-lng" placeholder="אורך (lng)" step="0.0001" dir="ltr">
      </div></div>
    <div style="height:20px"></div>
  `;

  document.querySelector('input[name="bad_weather"][value="false"]').checked = true;
  document.querySelector('input[name="reservation"][value="false"]').checked = true;
  document.querySelector('input[name="visited"][value="false"]').checked = true;
  document.querySelector('input[name="kosher"][value=""]').checked = true;
}

function openAddForm() {
  editingId = null;
  document.getElementById('form-title').textContent = 'הוספת מקום';
  document.getElementById('place-form').reset();
  document.querySelector('input[name="bad_weather"][value="false"]').checked = true;
  document.querySelector('input[name="reservation"][value="false"]').checked = true;
  document.querySelector('input[name="visited"][value="false"]').checked = true;
  document.querySelector('input[name="kosher"][value=""]').checked = true;
  document.getElementById('form-panel').classList.remove('hidden');
  document.getElementById('detail-panel').classList.add('hidden');
}

function openEditForm(place) {
  editingId = place.id;
  document.getElementById('form-title').textContent = 'עריכת מקום';
  const f = id => document.getElementById(id);
  f('f-name').value          = place.name || '';
  f('f-category').value      = place.category || '';
  f('f-region').value        = place.region || '';
  f('f-hours').value         = place.hours || '';
  f('f-entrance-fee').value  = place.entrance_fee || '';
  f('f-min-group').value     = place.min_group || '';
  f('f-visit-duration').value= place.visit_duration || '';
  f('f-atlas-page').value    = place.atlas_page || '';
  f('f-phone').value         = place.phone || '';
  f('f-website').value       = place.website || '';
  f('f-notes').value         = place.notes || '';
  f('f-parking').value       = place.parking || '';
  f('f-accessibility').value = place.accessibility || '';
  f('f-seasonality').value   = place.seasonality || '';
  f('f-difficulty').value    = place.difficulty || '';
  f('f-food-type').value     = place.food_type || '';
  f('f-price-level').value   = place.price_level || '';
  f('f-lat').value           = place.lat || '';
  f('f-lng').value           = place.lng || '';

  const setR = (name, val) => {
    const r = document.querySelector(`input[name="${name}"][value="${val}"]`);
    if (r) r.checked = true;
  };
  setR('bad_weather', String(place.bad_weather));
  setR('reservation', String(place.reservation_needed));
  setR('visited',     String(place.visited));
  setR('kosher', place.kosher === null || place.kosher === undefined ? '' : String(place.kosher));

  document.getElementById('detail-panel').classList.add('hidden');
  document.getElementById('form-panel').classList.remove('hidden');
}

function closeForm() {
  document.getElementById('form-panel').classList.add('hidden');
  editingId = null;
}

async function savePlace() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { alert('שם המקום הוא שדה חובה'); return; }

  const gr = name => {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
  };

  const data = {
    name,
    category:          document.getElementById('f-category').value      || null,
    region:            document.getElementById('f-region').value        || null,
    hours:             document.getElementById('f-hours').value         || null,
    entrance_fee:      document.getElementById('f-entrance-fee').value  || null,
    min_group:         parseInt(document.getElementById('f-min-group').value)     || null,
    visit_duration:    parseInt(document.getElementById('f-visit-duration').value)|| null,
    atlas_page:        parseInt(document.getElementById('f-atlas-page').value)    || null,
    phone:             document.getElementById('f-phone').value         || null,
    website:           document.getElementById('f-website').value       || null,
    notes:             document.getElementById('f-notes').value         || null,
    bad_weather:       gr('bad_weather') === 'true',
    reservation_needed:gr('reservation') === 'true',
    parking:           document.getElementById('f-parking').value       || null,
    accessibility:     document.getElementById('f-accessibility').value || null,
    visited:           gr('visited') === 'true',
    seasonality:       document.getElementById('f-seasonality').value   || null,
    difficulty:        document.getElementById('f-difficulty').value    || null,
    kosher:            gr('kosher') === '' ? null : gr('kosher') === 'true',
    food_type:         document.getElementById('f-food-type').value     || null,
    price_level:       document.getElementById('f-price-level').value   || null,
    lat:               parseFloat(document.getElementById('f-lat').value) || null,
    lng:               parseFloat(document.getElementById('f-lng').value) || null,
  };

  const { error } = editingId
    ? await db.from('places').update(data).eq('id', editingId)
    : await db.from('places').insert(data);

  if (error) { alert('שגיאה בשמירה. נסי שוב.'); console.error(error); return; }
  closeForm();
  await loadPlaces();
}

// ── DELETE ──────────────────────────────────────────────────
async function confirmDelete() {
  if (!currentPlace) return;
  if (!confirm(`למחוק את "${currentPlace.name}"?`)) return;
  const { error } = await db.from('places').delete().eq('id', currentPlace.id);
  if (error) { alert('שגיאה במחיקה'); return; }
  closeDetail();
  currentPlace = null;
  await loadPlaces();
}

// ── ROUTE ───────────────────────────────────────────────────
function renderRoutePlaces() {
  document.getElementById('route-places-selector').innerHTML =
    allPlaces.map(p => {
      const cat = getCat(p.category);
      return `<label class="place-checkbox">
        <input type="checkbox" value="${p.id}"
          data-lat="${p.lat||''}" data-lng="${p.lng||''}"
          data-name="${p.name.replace(/"/g,'&quot;')}"
          data-duration="${p.visit_duration || 60}">
        <span>${cat.emoji} ${p.name}${p.region?' · '+p.region:''}${p.visit_duration?' · '+p.visit_duration+' דק׳':''}</span>
      </label>`;
    }).join('');
}

async function buildRoute() {
  const selected = [...document.querySelectorAll('#route-places-selector input:checked')]
    .map(cb => ({
      id: cb.value, name: cb.dataset.name,
      lat: parseFloat(cb.dataset.lat), lng: parseFloat(cb.dataset.lng),
      duration: parseInt(cb.dataset.duration)
    })).filter(p => p.lat && p.lng);

  if (selected.length < 2) { alert('בחרי לפחות 2 מקומות עם מיקום מוגדר'); return; }

  if (routePolyline) { routePolyline.setMap(null); routePolyline = null; }
  routeMarkers.forEach(m => m.setMap(null));
  routeMarkers = [];

  const coords = selected.map(p => `${p.lng},${p.lat}`).join(';');
  try {
    const res  = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    const data = await res.json();
    if (data.code !== 'Ok') { alert('לא ניתן לחשב מסלול'); return; }

    const route = data.routes[0];
    const path = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    routePolyline = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: '#0038B8',
      strokeOpacity: 0.85,
      strokeWeight: 4,
      map: routeMap,
    });

    const bounds = new google.maps.LatLngBounds();
    selected.forEach((p, i) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">
        <circle cx="15" cy="15" r="13" fill="#0038B8" stroke="white" stroke-width="2"/>
        <text x="15" y="20" text-anchor="middle" fill="white" font-size="13"
          font-weight="bold" font-family="Arial">${i + 1}</text>
      </svg>`;
      const m = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: routeMap,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
          scaledSize: new google.maps.Size(30, 30),
          anchor: new google.maps.Point(15, 15),
        },
      });
      routeMarkers.push(m);
      bounds.extend({ lat: p.lat, lng: p.lng });
    });
    routeMap.fitBounds(bounds);

    const legs = route.legs;
    let [h, m] = (document.getElementById('departure-time').value || '09:00').split(':').map(Number);
    const add = (h, m, mins) => { const t = h * 60 + m + mins; return [Math.floor(t / 60) % 24, t % 60]; };
    const fmt = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

    let html = '<div class="timeline">';
    for (let i = 0; i < selected.length; i++) {
      const arrStr = fmt(h, m);
      [h, m] = add(h, m, selected[i].duration);
      const depStr = fmt(h, m);
      const travelMins = i < legs.length ? Math.round(legs[i].duration / 60) : 0;
      html += `<div class="tl-item">
        <div class="tl-time">${arrStr}</div>
        <div><div class="tl-place">${i+1}. ${selected[i].name}</div>
          <div class="tl-sub">יציאה ב-${depStr} · ${selected[i].duration} דקות</div>
        </div></div>`;
      if (i < selected.length - 1) {
        [h, m] = add(h, m, travelMins);
        html += `<div class="tl-travel">🚗 נסיעה: ${travelMins} דקות</div>`;
      }
    }
    const totalMin = legs.reduce((s, l) => s + Math.round(l.duration / 60), 0) +
                     selected.reduce((s, p) => s + p.duration, 0);
    html += `<div class="tl-total">סה"כ: ${Math.floor(totalMin / 60)} שעות ${totalMin % 60} דקות</div></div>`;
    document.getElementById('route-timeline').innerHTML = html;

  } catch (err) {
    alert('שגיאה בחיבור לשירות הניווט. נסי שוב.');
    console.error(err);
  }
}

// ── SETTINGS ────────────────────────────────────────────────
function openSettings() { document.getElementById('settings-panel').classList.remove('hidden'); }
function closeSettings() { document.getElementById('settings-panel').classList.add('hidden'); }

async function changePin() {
  const oldPin  = document.getElementById('old-pin').value;
  const newPin  = document.getElementById('new-pin').value;
  const confPin = document.getElementById('confirm-pin').value;
  if (!/^\d{4}$/.test(newPin)) { alert('הקוד החדש חייב להיות 4 ספרות'); return; }
  if (newPin !== confPin)       { alert('הקודים החדשים אינם תואמים'); return; }
  const { data } = await db.from('settings').select('value').eq('key','pin').single();
  if (!data || data.value !== oldPin) { alert('הקוד הנוכחי שגוי'); return; }
  const { error } = await db.from('settings').update({ value: newPin }).eq('key','pin');
  if (error) { alert('שגיאה בשמירה'); return; }
  alert('✅ הקוד שונה בהצלחה!');
  closeSettings();
  ['old-pin','new-pin','confirm-pin'].forEach(id => document.getElementById(id).value = '');
}

// ── NAVIGATION ──────────────────────────────────────────────
function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-btn:not(.nav-fab)').forEach(b => b.classList.remove('active'));
  document.getElementById(`${view}-view`).classList.remove('hidden');
  const navBtn = document.getElementById(`nav-${view}`);
  if (navBtn) navBtn.classList.add('active');
  if (view === 'map')   setTimeout(() => google.maps.event.trigger(mainMap, 'resize'), 120);
  if (view === 'route') setTimeout(() => google.maps.event.trigger(routeMap, 'resize'), 120);
}
