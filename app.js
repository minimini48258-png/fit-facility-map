const CATEGORY_COLORS = {
  "太陽光": "#eda100",
  "風力": "#2a78d6",
  "水力": "#1baf7a",
  "水力（既設導水路活用型リプレース）": "#1baf7a",
  "バイオマス": "#008300",
};

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
    ["調達期間終了", p.procurement_period_end || "-"],
  ];
  const rowsHtml = rows.map(([k, v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join("");
  const approxNote = p.location_approx
    ? '<div class="approx-note">※住所を一部簡略化してジオコーディングしたため、位置は概算です</div>'
    : "";
  return `<div class="fit-popup"><h3>設備ID: ${p.id}</h3><table>${rowsHtml}</table>${approxNote}</div>`;
}

const categoryLayers = {};
for (const cat of Object.keys(CATEGORY_COLORS)) {
  categoryLayers[cat] = L.layerGroup().addTo(map);
}

fetch("data/facilities.geojson")
  .then((res) => res.json())
  .then((geojson) => {
    for (const feature of geojson.features) {
      const p = feature.properties;
      const [lon, lat] = feature.geometry.coordinates;
      const color = CATEGORY_COLORS[p.category] || "#52514e";
      const marker = L.circleMarker([lat, lon], {
        renderer: canvasRenderer,
        radius: radiusForCapacity(p.capacity_kw),
        color: "#ffffff",
        weight: 1,
        fillColor: color,
        fillOpacity: 0.65,
        opacity: 0.9,
      });
      marker.bindPopup(popupHtml(p));
      const group = categoryLayers[p.category];
      if (group) group.addLayer(marker);
    }
    document.querySelectorAll("#panel input[type=checkbox]").forEach((el) => {
      el.addEventListener("change", () => {
        const cat = el.dataset.category;
        const group = categoryLayers[cat];
        if (!group) return;
        if (el.checked) map.addLayer(group);
        else map.removeLayer(group);
      });
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
  })
  .catch(() => {
    document.getElementById("meta").textContent = "";
  });
