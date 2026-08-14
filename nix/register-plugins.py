"""Register Oh-DSH plugin packages into dsh-runtime/node_modules.

Mirrors installDesktopPackages() from scripts/stage-dsh.mjs: each plugin
manifest is copied into node_modules/<name>/package.json with build/scripts/
devDependencies stripped, and the compiled dist files are placed beside it.
Runtime dependencies are resolved via a symlink to dsh-runtime/node_modules.

Usage: register-plugins.py <bundleRoot> <distRoot> <dshRuntimeRoot>
  bundleRoot     — oh-dsh bundle output (contains manifests/)
  distRoot       — final package dist root ($out/lib/oh-dsh/dist)
  dshRuntimeRoot — $out/dsh-runtime
"""

import json
import os
import shutil
import sys

def main():
    bundle_root, dist_root, dsh_runtime = sys.argv[1], sys.argv[2], sys.argv[3]
    manifests_dir = os.path.join(bundle_root, "manifests")
    node_modules = os.path.join(dsh_runtime, "node_modules")

    # manifest file key -> subdirectory under distRoot that holds the
    # compiled output. None means the root package (dist/ itself).
    plugin_dirs = {
        "desktop": None,
        "web": "web",
        "skins": os.path.join("plugins", "skins"),
        "sidebar": os.path.join("plugins", "sidebar"),
        "panel-controls": os.path.join("plugins", "panel-controls"),
        "pinned-summary": os.path.join("plugins", "pinned-summary"),
        "plugin-marketplace": os.path.join("plugins", "plugin-marketplace"),
        "better-sidebar-runtime": os.path.join("plugins", "better-sidebar-runtime"),
    }

    for manifest_file in sorted(os.listdir(manifests_dir)):
        plugin_key = manifest_file.removesuffix(".json")
        with open(os.path.join(manifests_dir, manifest_file)) as f:
            manifest = json.load(f)

        for key in ("build", "devDependencies", "scripts"):
            manifest.pop(key, None)

        name = manifest.get("name")
        if not name:
            print(f"skipping {manifest_file}: no name", file=sys.stderr)
            continue

        package_dir = os.path.join(node_modules, *name.split("/"))
        os.makedirs(package_dir, exist_ok=True)

        with open(os.path.join(package_dir, "package.json"), "w") as f:
            json.dump(manifest, f, indent=2)
            f.write("\n")

        # Symlink the plugin's dependency resolution to the shared
        # dsh-runtime node_modules (satisfies require() for runtime deps).
        deps_link = os.path.join(package_dir, "node_modules")
        if not os.path.exists(deps_link):
            os.symlink(node_modules, deps_link)

        # Copy the compiled dist files.
        dist_subdir = plugin_dirs.get(plugin_key)
        if dist_subdir is None:
            # Root package (@oh-dsh/desktop): dist/plugin.js, dist/client.js,
            # cordis.patch.yml live directly under distRoot.
            dst_dir = os.path.join(package_dir, "dist")
            os.makedirs(dst_dir, exist_ok=True)
            for fname in ("plugin.js", "client.js", "client.js.map", "cordis.patch.yml"):
                src = os.path.join(dist_root, fname)
                if os.path.exists(src):
                    shutil.copy2(src, os.path.join(dst_dir, fname))
        else:
            src_base = os.path.join(dist_root, dist_subdir)
            if not os.path.isdir(src_base):
                print(f"warning: no dist dir for {name}: {src_base}", file=sys.stderr)
                continue
            dst_dir = os.path.join(package_dir, "dist")
            os.makedirs(dst_dir, exist_ok=True)
            for fname in os.listdir(src_base):
                shutil.copy2(os.path.join(src_base, fname), os.path.join(dst_dir, fname))

        print(f"registered {name}")

    # Merge registered oh-dsh package names into the dsh runtime's
    # package.json dependencies so healProfilesModuleFallback links them
    # into the profile's module fallback (mirrors stage-dsh.mjs:616-621).
    cli_manifest_path = os.path.join(dsh_runtime, "package.json")
    with open(cli_manifest_path) as f:
        cli_manifest = json.load(f)
    deps = cli_manifest.setdefault("dependencies", {})
    for manifest_file in sorted(os.listdir(manifests_dir)):
        with open(os.path.join(manifests_dir, manifest_file)) as f:
            m = json.load(f)
        if m.get("name") and m.get("version"):
            deps[m["name"]] = m["version"]
    with open(cli_manifest_path, "w") as f:
        json.dump(cli_manifest, f, indent=2)
        f.write("\n")

if __name__ == "__main__":
    main()
