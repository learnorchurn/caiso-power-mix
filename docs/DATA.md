# Data and interpretation

## Provenance

Provider: [CAISO Today's Outlook](https://www.caiso.com/todays-outlook/supply).

The bundled `site/data/power.json` records the source page, exact download URL, UTC retrieval timestamp, HTTP last-modified value, and SHA-256 of the downloaded CSV. It preserves each observation's local ISO timestamp, source components, aggregated display buckets, and coverage findings.

| Included series | Observation period | Retrieved | Source CSV SHA-256 |
| --- | --- | --- | --- |
| Complete replay | 2026-11-09, 00:00–23:55 Pacific; 288/288 intervals | 2026-11-10T23:23:28Z | `6cd9a73e5652d2a4612794124f70ddbbc439a1c161254e9dd7ac5ce456632be5` |
| Saved current feed | 2026-11-10, 00:00–15:15 Pacific; 184/288 intervals | 2026-11-10T23:23:28Z | `e4a327fc2613aa5cf5fcab0226c2a1dc17d19c4fbde62bd1f7d4ac5ed3b3b161` |

The current-feed URL changes over time. Downloading it again will not reproduce the historical file or its hash. The bundled JSON preserves the transformed readings and their original retrieval metadata; it is not a byte-for-byte copy of the raw CSV. Historical source files may also be revised or removed by the provider.

## Field mapping

| Display bucket | Source columns |
| --- | --- |
| Solar | Solar |
| Wind | Wind |
| Natural gas | Natural Gas |
| Imports | Imports |
| Hydro | Small hydro + Large Hydro |
| Nuclear | Nuclear |
| Batteries | Batteries |
| Other | Geothermal + Biomass + Biogas + Coal + Other |

Original component values used in Hydro and Other remain in each row's `components` field. An aggregate becomes `null` if any of its components is missing. `total_mw` is the signed sum of all eight display buckets.

## What the signs mean

All source signs are retained. Negative battery values represent net charging; positive values represent net discharging. Negative imports indicate net exports. Small negative readings in other categories are also retained as reported. The interface does not clamp them to zero.

The chart stacks positive and negative contributions separately around zero. Its numeric total is the algebraic sum of the buckets. These are MW readings, converted to GW in the display by dividing by 1,000. They are not MWh energy totals.

## Completeness

The refresh script uses real five-minute intervals in `America/Los_Angeles`, including skipped or repeated hours at daylight-saving transitions. It rejects missing required CSV columns, extra row values, unexpected or out-of-order timestamps, and non-finite numbers.

A replay is accepted as complete only when all expected intervals and fields are present. Missing slots inside the observed period are reported separately from future slots in an incomplete current day. Current-feed date checks occur before and after retrieval to avoid silently labeling a midnight rollover with the wrong day.

When complete historical data cannot be obtained, the existing snapshot remains in place. The UI exposes dates and marks old snapshots. A network request or an update to this repository is not itself evidence of current observations.

## Interpretation limits

Today's Outlook covers the CAISO balancing authority. It is not a measure of all California generation or demand. The chart shows supply observations, not resource dispatch instructions. Changes occurring together do not establish which resource caused another to change.

Hybrid-resource components are already represented in CAISO's fuel categories and are not added again. Renewable and carbon-free are distinct concepts, and this display infers neither share. CAISO describes Today's Outlook as informational and subject to change; it points to [OASIS](https://oasis.caiso.com/) for official market data. This portfolio demonstration is not suitable for billing or operational planning.
