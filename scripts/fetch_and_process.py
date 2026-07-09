#!/usr/bin/env python3
"""
FITポータル（https://www.fit-portal.go.jp/publicinfo）から長野県のFIT認定設備データを
ダウンロードし、地図表示用のGeoJSONを生成する。

対象カテゴリ: 太陽光, 風力, 水力（既設導水路活用型リプレースを含む）, バイオマス
地熱は対象外（長野県内の認定件数がごく少数のため今回はスコープ外）。

住所の緯度経度は国土地理院 address-search API で取得し、data/geocode_cache.json に
キャッシュする（次回実行時は新規・変更住所のみ問い合わせる）。
"""
import json
import re
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

import openpyxl
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CACHE_PATH = DATA_DIR / "geocode_cache.json"
FAILURES_PATH = DATA_DIR / "geocode_failures.json"
OUTPUT_PATH = DATA_DIR / "facilities.geojson"
META_PATH = DATA_DIR / "meta.json"

# FITポータル 長野県ファイルのダウンロードURL（都道府県別ファイルID）
NAGANO_FILE_URL = (
    "https://www.fit-portal.go.jp/servlet/servlet.FileDownload"
    "?retURL=%2Fapex%2Fpublicinfo&file=00PJ200000MSqTcMAL"
)

INCLUDED_CATEGORIES = {"太陽光", "風力", "水力", "水力（既設導水路活用型リプレース）", "バイオマス"}

GSI_GEOCODE_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch"
GEOCODE_DELAY_SEC = 0.2
USER_AGENT = "fit-facility-map/1.0 (internal tool; contact via GitHub repo)"

EXCEL_EPOCH = datetime(1899, 12, 30)


def download_excel() -> Path:
    dest = DATA_DIR / "_source_nagano.xlsx"
    resp = requests.get(NAGANO_FILE_URL, headers={"User-Agent": USER_AGENT}, timeout=60)
    resp.raise_for_status()
    dest.write_bytes(resp.content)
    return dest


def excel_serial_to_date(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, (int, float)) and value > 0:
        return (EXCEL_EPOCH + timedelta(days=int(value))).date().isoformat()
    return None


def normalize_text(value):
    if value is None:
        return None
    s = str(value).strip()
    return s if s and s != "-" else None


def parse_records(xlsx_path: Path):
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["認定設備"]
    records = []
    for row in ws.iter_rows(min_row=4, values_only=True):
        facility_id = row[1]
        if not facility_id:
            continue
        category = row[6]
        if category not in INCLUDED_CATEGORIES:
            continue
        records.append(
            {
                "id": str(facility_id),
                "operator_name": normalize_text(row[2]),
                "category": category,
                "capacity_kw": row[7] if isinstance(row[7], (int, float)) else None,
                "address": normalize_text(row[8]),
                "approved_date": excel_serial_to_date(row[11]),
                "operation_start_planned": excel_serial_to_date(row[12]) or normalize_text(row[12]),
                "operation_start_reported": normalize_text(row[13]),
                "procurement_period_end": normalize_text(row[18]) if len(row) > 18 else None,
            }
        )
    return records


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return default
    return default


def geocode_address(address: str):
    """国土地理院 address-search API で住所→緯度経度。失敗時は段階的に住所を短くして再試行。"""
    candidates = [address]
    # 「字」「大字」等より後ろの詳細地番を段階的に切り詰めて再試行するフォールバック
    for sep in ["番地", "－", "-"]:
        idx = address.find(sep)
        if idx > 0:
            candidates.append(address[:idx])

    for candidate in candidates:
        try:
            resp = requests.get(
                GSI_GEOCODE_URL,
                params={"q": candidate},
                headers={"User-Agent": USER_AGENT},
                timeout=15,
            )
            resp.raise_for_status()
            results = resp.json()
        except (requests.RequestException, ValueError):
            continue
        if results:
            lon, lat = results[0]["geometry"]["coordinates"]
            approx = candidate != address
            return {"lat": lat, "lon": lon, "approx": approx, "matched_query": candidate}
    return None


def build_geocode_index(records, cache: dict, failures: dict):
    unique_addresses = sorted({r["address"] for r in records if r["address"]})
    new_count = 0
    for address in unique_addresses:
        if address in cache or address in failures:
            continue
        result = geocode_address(address)
        if result:
            cache[address] = result
        else:
            failures[address] = {"last_attempt": datetime.now(timezone.utc).date().isoformat()}
        new_count += 1
        time.sleep(GEOCODE_DELAY_SEC)
    return new_count


def build_geojson(records, cache: dict):
    features = []
    skipped = 0
    for r in records:
        geo = cache.get(r["address"]) if r["address"] else None
        if not geo:
            skipped += 1
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [geo["lon"], geo["lat"]]},
                "properties": {
                    **{k: v for k, v in r.items() if k != "address"},
                    "address_geocoded": r["address"],
                    "location_approx": geo.get("approx", False),
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}, skipped


def main():
    DATA_DIR.mkdir(exist_ok=True)
    print("1/4 長野県FITデータをダウンロード中...", file=sys.stderr)
    xlsx_path = download_excel()

    print("2/4 Excelを解析中...", file=sys.stderr)
    records = parse_records(xlsx_path)
    print(f"  対象設備: {len(records)}件", file=sys.stderr)

    cache = load_json(CACHE_PATH, {})
    failures = load_json(FAILURES_PATH, {})

    print("3/4 住所をジオコーディング中（新規住所のみ問い合わせ）...", file=sys.stderr)
    new_count = build_geocode_index(records, cache, failures)
    print(f"  新規ジオコーディング: {new_count}件 / 失敗キャッシュ: {len(failures)}件", file=sys.stderr)
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    FAILURES_PATH.write_text(json.dumps(failures, ensure_ascii=False, indent=1), encoding="utf-8")

    print("4/4 GeoJSONを生成中...", file=sys.stderr)
    geojson, skipped = build_geojson(records, cache)
    OUTPUT_PATH.write_text(json.dumps(geojson, ensure_ascii=False), encoding="utf-8")
    print(f"  出力: {len(geojson['features'])}件（位置未特定でスキップ: {skipped}件）", file=sys.stderr)

    META_PATH.write_text(
        json.dumps(
            {
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "source": "https://www.fit-portal.go.jp/publicinfo",
                "prefecture": "長野県",
                "total_facilities": len(records),
                "geocoded_facilities": len(geojson["features"]),
                "geocode_failed": skipped,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    xlsx_path.unlink(missing_ok=True)
    print("完了", file=sys.stderr)


if __name__ == "__main__":
    main()
