"""Collect a package's transitive npm dependency closure from a pnpm store.

Each copied package receives a node_modules symlink to the flat closure root,
so nested ESM imports resolve exactly as they do in the pnpm workspace.

Usage: collect-deps.py <pnpmStoreDir> <packageJsonPath> <outDir>
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
    queue = list({
        *manifest.get("dependencies", {}),
        *manifest.get("optionalDependencies", {}),
        *manifest.get("peerDependencies", {}),
    })

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

        # Recreate dependency lookup against the flat collected closure.
        # Relative links keep the bundle relocatable into the final runtime.
        package_node_modules = os.path.join(dst, "node_modules")
        if os.path.lexists(package_node_modules):
            if os.path.isdir(package_node_modules) and not os.path.islink(package_node_modules):
                shutil.rmtree(package_node_modules)
            else:
                os.unlink(package_node_modules)
        os.symlink(os.path.relpath(out_dir, dst), package_node_modules)

        # Enqueue every dependency class that can participate in runtime ESM
        # resolution. Missing optional peers are intentionally ignored above.
        dep_manifest_path = os.path.join(dst, "package.json")
        if os.path.exists(dep_manifest_path):
            with open(dep_manifest_path) as f:
                dep_manifest = json.load(f)
            transitives = {
                *dep_manifest.get("dependencies", {}),
                *dep_manifest.get("optionalDependencies", {}),
                *dep_manifest.get("peerDependencies", {}),
            }
            queue.extend(transitives - visited)

        print(f"collected {dep}")

if __name__ == "__main__":
    main()
