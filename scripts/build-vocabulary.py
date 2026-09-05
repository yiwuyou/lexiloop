import csv
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tmp" / "pdfs" / "vocab_analysis" / "vocabulary.csv"
TARGET = Path(__file__).resolve().parents[1] / "data" / "vocabulary.js"


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def main() -> None:
    rows = []
    with SOURCE.open("r", encoding="utf-8-sig", newline="") as source_file:
        for record in csv.DictReader(source_file):
            category = "c" if record["category"] == "core" else "h"
            word = clean(record["word"])
            meaning = clean(record["meaning"])
            if not word or not meaning:
                raise ValueError(f"blank vocabulary record: {record}")
            rows.append([
                category,
                int(record["day"]),
                int(record["index"]),
                word,
                meaning,
            ])

    if len(rows) != 2522:
        raise ValueError(f"expected 2522 records, got {len(rows)}")

    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    TARGET.write_text(
        "// Generated from the 51 institution PDFs. Preserve source order and numbering.\n"
        f"module.exports={payload};\n",
        encoding="utf-8",
    )
    print(f"wrote {len(rows)} records to {TARGET} ({TARGET.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
