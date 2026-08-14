"""Collect the transitive npm dependency closure of a package from a pnpm
virtual store, dereferencing symlinks.

Usage: collect-deps.py <pnpmStoreDir> <packageJsonPath> <outDir>
  pnpmStoreDir    — node_modules/.pnpm
  packageJsonPath — the plugin's package.json (its `dependencies` are seeds)
  outDir          — flat output directory, one subdirectory per package
"""

import json
import os
import shutil
import sys

def find_package(store_dir, name):
    """Find the newest directory matching name@* in the pnpm store."""
    prefix = name.replace("/", "+") + "@"
    candidates = sorted(
        d for d in os.listdir(store_dir)
        if d.startswith(prefix) and os.path.isdir(os.path.join(store_dir, d))
    )
    if not candidates:
        return None
    return os.path.join(store_dir, candidates[-1], "node_modules", name)

def main():
    store_dir, package_json, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]

    with open(package_json) as f:
        manifest = json.load(f)

    os.makedirs(out_dir, exist_ok=True)
    visited = set()
    queue = list(manifest.get("dependencies", {}).keys())

    while queue:
        dep = queue.pop()
        if dep in visited:
            continue
        visited.add(dep)

        src = find_package(store_dir, dep)
        if src is None or not os.path.isdir(src):
            continue

        dst = os.path.join(out_dir, dep)
        if os.path.exists(dst):
            shutil.rmtree(dst)
        shutil.copytree(src, dst, symlinks=False)

        # Enqueue transitive deps.
        dep_manifest_path = os.path.join(dst, "package.json")
        if os.path.exists(dep_manifest_path):
            with open(dep_manifest_path) as f:
                dep_manifest = json.load(f)
            for transitive in dep_manifest.get("dependencies", {}):
                if transitive not in visited:
                    queue.append(transitive)

        print(f"collected {dep}")

if __name__ == "__main__":
    main()
