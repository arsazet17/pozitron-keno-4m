#!/usr/bin/env python3
from pathlib import Path
import hashlib
import re

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"

SCRIPT_RE = re.compile(
    r'(<script\b[^>]*\bsrc=["\'])(?!https?://|//)([^"\']+?\.js)(?:\?v=[^"\']*)?(["\'][^>]*></script>)',
    re.IGNORECASE,
)

def short_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]

def main():
    html = INDEX.read_text(encoding="utf-8")
    changed = []
    missing = []

    def repl(m):
        prefix, rel, suffix = m.groups()
        path = ROOT / rel
        if not path.is_file():
            missing.append(rel)
            return m.group(0)
        version = short_hash(path)
        new_tag = f"{prefix}{rel}?v={version}{suffix}"
        if new_tag != m.group(0):
            changed.append((rel, version))
        return new_tag

    new_html = SCRIPT_RE.sub(repl, html)

    if missing:
        print("WARN missing:", ", ".join(sorted(set(missing))))
    if new_html != html:
        INDEX.write_text(new_html, encoding="utf-8")
        print("index.html updated:")
        for rel, version in changed:
            print(f"  {rel} -> ?v={version}")
    else:
        print("index.html unchanged: JS hashes are the same")

if __name__ == "__main__":
    main()
