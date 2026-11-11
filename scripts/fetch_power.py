#!/usr/bin/env python3
"""Refresh a small, factual CAISO snapshot using only the Python standard library.

The top-level series is a verified complete day for replay. ``latest`` is a
separately dated, usually partial current-day series. A failure to obtain a
complete replay leaves the existing output untouched. An unavailable current
feed does not make the complete replay unusable and is reported in warnings.

CAISO's active chart script documents these CSV paths:
https://www.caiso.com/theme/js/outlook/outlook.js
"""

import argparse
import csv
from datetime import date, datetime, time, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
import io
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo


PACIFIC = ZoneInfo("America/Los_Angeles")
BASE_URL = "https://www.caiso.com/outlook"
PAGE_URL = "https://www.caiso.com/todays-outlook/supply"
STATS_URL = BASE_URL + "/current/stats.txt"
CURRENT_URL = BASE_URL + "/current/fuelsource.csv"
MAX_DOWNLOAD_BYTES = 2_000_000
SOURCE_COLUMNS = (
    "Solar", "Wind", "Geothermal", "Biomass", "Biogas", "Small hydro",
    "Coal", "Nuclear", "Natural Gas", "Large Hydro", "Batteries", "Imports",
    "Other",
)
FIELD_MAPPING = {
    "solar": ["Solar"],
    "wind": ["Wind"],
    "natural_gas": ["Natural Gas"],
    "imports": ["Imports"],
    "hydro": ["Small hydro", "Large Hydro"],
    "nuclear": ["Nuclear"],
    "batteries": ["Batteries"],
    "other": ["Geothermal", "Biomass", "Biogas", "Coal", "Other"],
}
COMPONENT_MAPPING = {
    "geothermal": "Geothermal", "biomass": "Biomass", "biogas": "Biogas",
    "small_hydro": "Small hydro", "large_hydro": "Large Hydro",
    "coal": "Coal", "other_source": "Other",
}
METHODOLOGY = [
    "CAISO Today's Outlook fuel-source observations are five-minute average "
    "megawatts for the CAISO balancing authority, not all California electricity use.",
    "The main series is the most recent verified complete prior day found within "
    "the configured lookback. latest is a separately dated current-feed snapshot, "
    "not a prediction or a continuous live connection.",
    "Every number comes from the source CSV. Missing values remain null; no "
    "interpolation, clipping, smoothing, or estimated observations are added.",
    "All signed source values are preserved, including negative solar, imports, "
    "and battery values. Negative batteries indicate net charging; positive "
    "batteries indicate net discharging. Negative imports indicate net exports.",
    "hydro combines Small hydro and Large Hydro. other combines Geothermal, "
    "Biomass, Biogas, Coal, and CAISO's Other column. These original components "
    "remain available in each row. Any missing component makes its aggregate null.",
    "total_mw is the algebraic sum of all eight displayed buckets, including "
    "signed imports and storage. It is not a separate demand measurement.",
    "Hybrid-resource components are already included by CAISO in their "
    "respective fuel types and are not added again. Renewable and carbon-free "
    "are different concepts; neither share is inferred by this dataset.",
    "Times use America/Los_Angeles. Expected intervals account for daylight "
    "saving transitions. Future slots in a partial day are reported separately "
    "from gaps within its observed period.",
    "CAISO describes Today's Outlook data as informational, subject to change, "
    "and unsuitable for billing or operational planning. It identifies OASIS "
    "as its official market-data source.",
]


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def fetch(url, timeout):
    request = urllib.request.Request(
        url, headers={"User-Agent": "LiveDataLab/1.0 (public-data portfolio)"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read(MAX_DOWNLOAD_BYTES + 1)
        if len(payload) > MAX_DOWNLOAD_BYTES:
            raise ValueError("CAISO response exceeds the download size limit")
        metadata = {
            "download_url": url,
            "fetched_at": utc_now(),
            "http_last_modified": response.headers.get("Last-Modified"),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
    return payload.decode("utf-8-sig"), metadata


def day_slots(day):
    """Use real five-minute intervals, including repeated/skipped DST hours."""
    cursor = datetime.combine(day, time.min, PACIFIC).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, PACIFIC).astimezone(timezone.utc)
    slots = []
    while cursor < end:
        slots.append(cursor.astimezone(PACIFIC))
        cursor += timedelta(minutes=5)
    return slots


def numeric_value(raw, field, row_number):
    if raw is None or raw.strip() == "":
        return None
    try:
        number = float(raw)
    except ValueError as error:
        raise ValueError("Invalid %s at CSV row %d" % (field, row_number)) from error
    if not math.isfinite(number):
        raise ValueError("Non-finite %s at CSV row %d" % (field, row_number))
    return int(number) if number.is_integer() else number


def parse_series(csv_text, day):
    reader = csv.DictReader(io.StringIO(csv_text))
    required_columns = {"Time", *SOURCE_COLUMNS}
    if not reader.fieldnames or not required_columns.issubset(reader.fieldnames):
        raise ValueError("CAISO fuel-source CSV is missing expected columns")
    slots = day_slots(day)
    labels = [slot.strftime("%H:%M") for slot in slots]
    series, observed_indices, missing_fields = [], [], []
    cursor = 0
    for row_number, row in enumerate(reader, start=2):
        if not any(value and str(value).strip() for value in row.values()):
            continue
        if None in row:
            raise ValueError("Unexpected extra CSV values at row %d" % row_number)
        label = (row.get("Time") or "").strip()
        try:
            slot_index = labels.index(label, cursor)
        except ValueError as error:
            raise ValueError("Unexpected, repeated, or out-of-order time %r" % label) from error
        cursor = slot_index + 1
        observed_indices.append(slot_index)
        source_values = {
            field: numeric_value(row.get(field), field, row_number)
            for field in SOURCE_COLUMNS
        }
        missing = [field for field, value in source_values.items() if value is None]
        if missing:
            missing_fields.append({"time": label, "fields": missing})
        record = {"time": label, "timestamp": slots[slot_index].isoformat()}
        for field, source_fields in FIELD_MAPPING.items():
            values = [source_values[source_field] for source_field in source_fields]
            record[field] = None if None in values else sum(values)
        record["components"] = {
            name: source_values[source_field]
            for name, source_field in COMPONENT_MAPPING.items()
        }
        buckets = [record[field] for field in FIELD_MAPPING]
        record["total_mw"] = None if None in buckets else sum(buckets)
        series.append(record)
    if not series:
        raise ValueError("CAISO fuel-source CSV contains no observations")
    observed = set(observed_indices)
    last_index = observed_indices[-1]
    missing_times = [labels[index] for index in range(last_index + 1) if index not in observed]
    future_intervals = len(slots) - last_index - 1
    coverage = {
        "rows": len(series),
        "expected_intervals": len(slots),
        "first_time": series[0]["time"],
        "last_time": series[-1]["time"],
        "missing_times": missing_times,
        "missing_fields": missing_fields,
        "future_intervals": future_intervals,
        "complete_through_last_observation": not missing_times and not missing_fields,
        "complete": len(series) == len(slots) and not missing_times and not missing_fields,
    }
    return series, coverage


def read_current_date(timeout):
    text, metadata = fetch(STATS_URL, timeout)
    stats = json.loads(text)
    if not isinstance(stats, dict) or not isinstance(stats.get("slotDate"), str):
        raise ValueError("CAISO stats response has no usable slotDate")
    slot = datetime.strptime(stats["slotDate"], "%m/%d/%Y %H:%M")
    return slot, metadata


def fetch_latest(timeout):
    """Check both sides of the CSV read so a date rollover cannot mislabel it."""
    before, _ = read_current_date(timeout)
    csv_text, metadata = fetch(CURRENT_URL, timeout)
    after, stats_metadata = read_current_date(timeout)
    if before.date() != after.date():
        raise ValueError("CAISO current date changed while fetching; retry next refresh")
    day = before.date()
    if metadata["http_last_modified"]:
        modified_date = parsedate_to_datetime(metadata["http_last_modified"]).astimezone(PACIFIC).date()
        if modified_date != day:
            raise ValueError("CAISO CSV modification date disagrees with the current stats date")
    series, coverage = parse_series(csv_text, day)
    if series[-1]["time"] > after.strftime("%H:%M"):
        raise ValueError("CAISO current CSV extends beyond its timestamp; date may be rolling over")
    return {
        "data_date": day.isoformat(),
        "timezone": PACIFIC.key,
        "interval_minutes": 5,
        "unit": "MW",
        "source": {"name": "CAISO Today's Outlook", "page_url": PAGE_URL, **metadata},
        "download_url": CURRENT_URL,
        "source_slot_date": after.strftime("%Y-%m-%d %H:%M"),
        "source_timestamp_url": STATS_URL,
        "source_timestamp_fetched_at": stats_metadata["fetched_at"],
        "series": series,
        "coverage": coverage,
    }


def build_snapshot(as_of, timeout=20, lookback=7, include_latest=True):
    warnings = []
    complete = None
    for days_ago in range(1, lookback + 1):
        day = as_of - timedelta(days=days_ago)
        url = BASE_URL + "/history/" + day.strftime("%Y%m%d") + "/fuelsource.csv"
        try:
            csv_text, metadata = fetch(url, timeout)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                warnings.append("No historical source file for " + day.isoformat())
                continue
            raise
        series, coverage = parse_series(csv_text, day)
        if coverage["complete"]:
            complete = (day, metadata, series, coverage)
            break
        warnings.append("Historical source is incomplete for " + day.isoformat())
    if complete is None:
        raise ValueError("No complete CAISO replay day found; retaining the previous output")
    day, metadata, series, coverage = complete
    result = {
        "schema_version": 1,
        "title": "California power: CAISO supply observations",
        "source": {"name": "CAISO Today's Outlook", "page_url": PAGE_URL, **metadata},
        "data_date": day.isoformat(),
        "generated_at": utc_now(),
        "timezone": PACIFIC.key,
        "interval_minutes": 5,
        "unit": "MW",
        "geography": "CAISO balancing authority",
        "replay_as_of": as_of.isoformat(),
        "series": series,
        "coverage": coverage,
        "field_mapping": FIELD_MAPPING,
        "methodology": METHODOLOGY,
        "warnings": warnings,
    }
    if include_latest:
        try:
            result["latest"] = fetch_latest(timeout)
            result["latest_status"] = "available"
        except (OSError, ValueError, KeyError) as error:
            result["latest_status"] = "unavailable"
            warnings.append("Current feed unavailable: " + str(error))
    else:
        result["latest_status"] = "not_requested"
    result["generated_at"] = utc_now()
    return result


def atomic_write(destination, data):
    payload = json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent,
                                         prefix=".power-", suffix=".tmp", delete=False) as temporary:
            temporary_name = temporary.name
            temporary.write(payload)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_name, destination)
        temporary_name = None
    finally:
        if temporary_name:
            os.unlink(temporary_name)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parents[1] / "site/data/power.json")
    parser.add_argument("--as-of", type=date.fromisoformat,
                        default=datetime.now(PACIFIC).date(),
                        help="Find a complete replay strictly before this Pacific date (YYYY-MM-DD)")
    parser.add_argument("--timeout", type=float, default=20, help="Per-request timeout in seconds")
    parser.add_argument("--lookback", type=int, default=7, help="Maximum prior dates to inspect")
    parser.add_argument("--skip-latest", action="store_true")
    args = parser.parse_args(argv)
    if not 1 <= args.lookback <= 14 or not 0 < args.timeout <= 60:
        parser.error("lookback must be 1–14 and timeout must be greater than 0 and at most 60")
    try:
        snapshot = build_snapshot(args.as_of, args.timeout, args.lookback, not args.skip_latest)
        atomic_write(args.output, snapshot)
    except (OSError, ValueError, KeyError) as error:
        print("Power refresh failed; previous output preserved: " + str(error), file=sys.stderr)
        return 1
    print(json.dumps({
        "output": str(args.output), "replay_date": snapshot["data_date"],
        "replay_rows": snapshot["coverage"]["rows"],
        "latest_date": snapshot.get("latest", {}).get("data_date"),
        "latest_rows": snapshot.get("latest", {}).get("coverage", {}).get("rows"),
        "warnings": snapshot["warnings"],
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

