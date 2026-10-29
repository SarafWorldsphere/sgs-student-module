"""Central relation names for the staging student timetable reader."""
import json
from pathlib import Path
import re
from types import SimpleNamespace

from psycopg.sql import Identifier


def load_tables(path=Path(__file__).with_name("timetable_tables.json")):
    with Path(path).open(encoding="utf-8") as source:
        names = json.load(source)
    if not isinstance(names, dict) or set(names) != {"classes", "periods", "timetable", "teachers"}:
        raise ValueError("Timetable configuration must define classes, periods, timetable and teachers.")
    quoted = {}
    for key, name in names.items():
        if not isinstance(name, str):
            raise ValueError(f"Invalid table name for {key}.")
        parts = name.split(".")
        if len(parts) not in (1, 2) or any(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", part) is None for part in parts):
            raise ValueError(f"Invalid table name for {key}.")
        quoted[key] = Identifier(*parts).as_string()
    return SimpleNamespace(**quoted)


tables = load_tables()
