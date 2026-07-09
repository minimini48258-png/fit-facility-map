const CATEGORY_COLORS = {
  "太陽光": "#eda100",
  "風力": "#ffffff",
  "水力": "#4fc3f7",
  "水力（既設導水路活用型リプレース）": "#4fc3f7",
  "バイオマス": "#008300",
};

// 白塗りの風力マーカーは白い縁取りだと地図に溶け込むため、濃い縁取りに切り替える
const LIGHT_FILL_CATEGORIES = new Set(["風力"]);

const NAGANO_CENTER = [36.2, 138.05];

const map = L.map("map", { preferCanvas: true }).setView(NAGANO_CENTER, 9);

const standardLayer = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
  attribution: '地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
  maxZoom: 18,
}).addTo(map);

const satelliteLayer = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", {
  attribution: '航空写真: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
  maxZoom: 18,
});

L.control.layers({ "地図": standardLayer, "航空写真": satelliteLayer }, null, { position: "topright" }).addTo(map);

const canvasRenderer = L.canvas({ padding: 0.5 });
const visibleLayer = L.layerGroup().addTo(map);

function radiusForCapacity(kw) {
  if (!kw || kw <= 0) return 3;
  return Math.min(30, Math.max(3, 2 + Math.sqrt(kw) * 0.62));
}

function formatKw(kw) {
  if (kw === null || kw === undefined) return "不明";
  return `${kw.toLocaleString("ja-JP")} kW`;
}

function popupHtml(p) {
  const rows = [
    ["事業者", p.operator_name || "不明"],
    ["区分", p.category],
    ["認定出力", formatKw(p.capacity_kw)],
    ["所在地", p.address_geocoded || "不明"],
    ["新規認定日", p.approved_date || "-"],
    ["運転開始（予定）", p.operation_start_planned || "-"],
    ["運転開始（報告）", p.operation_start_reported || "-"],
    ["調達期間終了（卒FIT）", p.procurement_period_end || "-"],
  ];
  const rowsHtml = rows.map(([k, v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join("");
  const approxNote = p.location_approx
    ? '<div class="approx-note">※地番までは特定できず、大字・字レベルの代表地点です（実際の場所とずれる場合があります。破線の丸で表示）</div>'
    : "";
  return `<div class="fit-popup"><h3>設備ID: ${p.id}</h3><table>${rowsHtml}</table>${approxNote}</div>`;
}

// 卒FITフィルターのしきい値（今日からの年数）。null は「済みのみ」を表す上限なし条件。
const FIT_FILTER_THRESHOLDS = { expired: 0, within1y: 1, within3y: 3, within5y: 5 };

function passesFitFilter(endIso, filterValue) {
  if (filterValue === "all") return true;
  if (!endIso) return false; // 卒FIT時期不明の設備は「すべて表示」以外では対象外
  const endDate = new Date(endIso);
  const today = new Date();
  if (filterValue === "expired") return endDate <= today;
  const years = FIT_FILTER_THRESHOLDS[filterValue];
  const threshold = new Date(today);
  threshold.setFullYear(threshold.getFullYear() + years);
  return endDate <= threshold;
}

const state = {
  activeCategories: new Set(Object.keys(CATEGORY_COLORS)),
  fitFilter: "all",
};

let allEntries = []; // [{ props, marker }]

function applyFilters() {
  visibleLayer.clearLayers();
  let shown = 0;
  for (const entry of allEntries) {
    const p = entry.props;
    if (!state.activeCategories.has(p.category)) continue;
    if (!passesFitFilter(p.procurement_period_end_iso, state.fitFilter)) continue;
    visibleLayer.addLayer(entry.marker);
    shown++;
  }
  const countEl = document.getElementById("fit-status-count");
  if (countEl) {
    countEl.textContent = state.fitFilter === "all" ? "" : `該当: ${shown.toLocaleString("ja-JP")}件`;
  }
}

fetch("data/facilities.geojson")
  .then((res) => res.json())
  .then((geojson) => {
    for (const feature of geojson.features) {
      const p = feature.properties;
      const [lon, lat] = feature.geometry.coordinates;
      const color = CATEGORY_COLORS[p.category] || "#52514e";
      const isLightFill = LIGHT_FILL_CATEGORIES.has(p.category);
      const marker = L.circleMarker([lat, lon], {
        renderer: canvasRenderer,
        radius: radiusForCapacity(p.capacity_kw),
        color: isLightFill ? "#333333" : "#ffffff",
        weight: 1,
        fillColor: color,
        fillOpacity: isLightFill ? 0.85 : 0.65,
        opacity: 0.9,
        // 位置が大字・字レベルの概算（location_approx）の場合は破線にして区別する
        dashArray: p.location_approx ? "3,3" : null,
      });
      marker.bindPopup(popupHtml(p));
      allEntries.push({ props: p, marker });
    }
    applyFilters();

    document.querySelectorAll("#panel input[type=checkbox]").forEach((el) => {
      el.addEventListener("change", () => {
        const cat = el.dataset.category;
        if (el.checked) state.activeCategories.add(cat);
        else state.activeCategories.delete(cat);
        applyFilters();
      });
    });
    document.getElementById("fit-status-filter").addEventListener("change", (e) => {
      state.fitFilter = e.target.value;
      applyFilters();
    });
  })
  .catch((err) => {
    document.getElementById("meta").textContent = "データの読み込みに失敗しました";
    console.error(err);
  });

fetch("data/meta.json")
  .then((res) => res.json())
  .then((meta) => {
    const updated = new Date(meta.updated_at).toLocaleDateString("ja-JP");
    document.getElementById("meta").textContent =
      `更新日: ${updated} / 表示中: ${meta.geocoded_facilities.toLocaleString("ja-JP")}件（全${meta.total_facilities.toLocaleString("ja-JP")}件中）`;
    const statEl = document.getElementById("precision-stat");
    if (statEl && meta.location_precise !== undefined) {
      const total = meta.location_precise + meta.location_approx;
      const precisePct = total ? Math.round((meta.location_precise / total) * 100) : 0;
      statEl.textContent = `地番一致 ${precisePct}%（${meta.location_precise.toLocaleString("ja-JP")}件）/ 概算 ${meta.location_approx.toLocaleString("ja-JP")}件`;
    }
  })
  .catch(() => {
    document.getElementById("meta").textContent = "";
  });
