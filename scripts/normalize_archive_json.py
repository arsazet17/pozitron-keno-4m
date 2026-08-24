#!/usr/bin/env python3
import json
from pathlib import Path

ARCHIVE = Path("data/archive.json")

def main():
    data = json.loads(ARCHIVE.read_text(encoding="utf-8"))

    if isinstance(data, list):
        if len(data) < 2:
            raise RuntimeError("data/archive.json: legacy array слишком короткий")
        data = {"rows": data, "format": "rows-object-v1"}
        ARCHIVE.write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        print("archive.json: legacy array -> rows object")
        return

    if isinstance(data, dict) and isinstance(data.get("rows"), list) and len(data["rows"]) >= 2:
        print("archive.json: rows object OK")
        return

    raise RuntimeError("data/archive.json имеет неизвестный формат")

if __name__ == "__main__":
    main()
