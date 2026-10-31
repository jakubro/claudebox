"""Merge the Python and JS jscpd runs' SARIF reports, and with --baseline their baselines, into one each.

The runs differ in threshold, so each writes its own; clone_reasons.py reads a single report and baseline.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


RUNS = [Path("/tmp/claudebox--jscpd-python"), Path("/tmp/claudebox--jscpd-js")]
OUT = Path("/tmp/claudebox--jscpd")

if missing := [str(run) for run in RUNS if not (run / "jscpd-report.sarif").is_file()]:
    sys.exit(f"no jscpd report in {', '.join(missing)}: run `just lint` or `just dupes` first")

sarifs = [json.loads((run / "jscpd-report.sarif").read_text(encoding="utf-8")) for run in RUNS]
merged = sarifs[0]

for other in sarifs[1:]:
    artifacts = merged["runs"][0].setdefault("artifacts", [])
    offset = len(artifacts)

    for result in other["runs"][0]["results"]:
        for location in (*result["locations"], *result.get("relatedLocations", ())):
            location["physicalLocation"]["artifactLocation"]["index"] += offset

    artifacts.extend(other["runs"][0].get("artifacts", []))
    merged["runs"][0]["results"].extend(other["runs"][0]["results"])
    merged["runs"][0].setdefault("originalUriBaseIds", {}).update(
        other["runs"][0].get("originalUriBaseIds", {}),
    )

OUT.mkdir(exist_ok=True)
(OUT / "jscpd-report.sarif").write_text(json.dumps(merged), encoding="utf-8")

if "--baseline" in sys.argv[1:]:
    fingerprints: dict[str, int] = {}

    for run in RUNS:
        baseline = json.loads((run / "baseline.json").read_text(encoding="utf-8"))
        fingerprints |= baseline["fingerprints"]

    merged_baseline = {"version": 1, "fingerprints": dict(sorted(fingerprints.items()))}
    Path(".jscpd-baseline.json").write_text(
        json.dumps(merged_baseline, indent=2) + "\n",
        encoding="utf-8",
    )
