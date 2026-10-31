"""Parses database/remaining_schema.sql so tests can check that the code only
reads/writes real columns and always supplies required ones."""
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

SCHEMA_FILE = Path(__file__).resolve().parents[2] / "database" / "remaining_schema.sql"
COLUMN_LINE = re.compile(r"^    (\w+)\s+[A-Z]")
NOT_COLUMNS = {"CONSTRAINT", "CHECK", "UNIQUE", "PRIMARY", "FOREIGN"}


@dataclass
class Table:
    columns: set
    required_on_insert: set     # NOT NULL, no DEFAULT, not generated
    generated: set


@lru_cache
def load_schema() -> dict:
    sql = SCHEMA_FILE.read_text(encoding="utf-8")
    tables = {}
    for name, body in re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\n\);", sql, re.S):
        defs, current = {}, None
        for raw in body.splitlines():
            line = raw.split("--", 1)[0].rstrip()
            match = COLUMN_LINE.match(line)
            if match and match.group(1) not in NOT_COLUMNS:
                current = match.group(1)
                defs[current] = line
            elif current and line.startswith("      "):
                defs[current] += " " + line.strip()
            else:
                current = None
        generated = {c for c, d in defs.items() if "GENERATED" in d}
        required = {c for c, d in defs.items()
                    if "NOT NULL" in d and "DEFAULT" not in d and c not in generated}
        tables[name] = Table(set(defs), required, generated)
    return tables


def assert_writes_match_schema(writes):
    schema = load_schema()
    assert writes, "no writes were recorded"
    for table, op, keys in writes:
        cols = schema[table]
        assert keys <= cols.columns, f"{table}.{op} writes unknown columns {keys - cols.columns}"
        assert not keys & cols.generated, f"{table}.{op} writes generated columns"
        if op == "insert":
            missing = cols.required_on_insert - keys
            assert not missing, f"{table} insert is missing required columns {missing}"
