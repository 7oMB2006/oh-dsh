# Oh-DSH package builder.
#
# dshSource selects where the pinned DeepSeek Harness runtime comes from:
#   "llm-agents"  (default) — numtide/llm-agents.nix, pre-built npm package
#   "pinned"                — this repo's dsh-source.json npm release, with its
#                             committed pnpm dependency lock
#   "nixpkgs"               — pkgs.deepseek-harness (kept as a placeholder; the
#                             nixpkgs PR is not yet merged, so this throws)

{ pkgs, system, llm-agents, dshSourceSpec }:

{ surface # "full" | "web" | "tui"
, dshSource ? "llm-agents"
}:

let
  lib = pkgs.lib;

  isFull = surface == "full";
  includesWeb = surface != "tui";
  includesTui = surface != "web";

  # ---------------------------------------------------------------------------
  # DSH runtime selection
  # ---------------------------------------------------------------------------

  dshRuntime =
    if dshSource == "llm-agents" then
      llm-agents.packages.${system}.dsh
    else if dshSource == "pinned" then
      pkgs.callPackage ./dsh-runtime-pinned.nix { inherit dshSourceSpec; }
    else if dshSource == "nixpkgs" then
      # Reserved: the nixpkgs deepseek-harness PR has not landed yet.
      pkgs.deepseek-harness or (throw ''
        dshSource = "nixpkgs" requires pkgs.deepseek-harness, which is not yet
        in nixpkgs (see NixOS/nixpkgs#552467). Use "llm-agents" (default) or
        "pinned" for now.
      '')
    else
      throw "unknown dshSource: ${dshSource}";

  dshRuntimeRoot =
    if dshSource == "llm-agents" then
      "${dshRuntime}/lib/node_modules/@deepseek-ai/dsh"
    else
      "${dshRuntime}/lib/dsh";

  # ---------------------------------------------------------------------------
  # Oh-DSH front-end bundle. The same build produces all surface adapters;
  # the outer derivation controls which launchers and renderers are exposed.
  cleanSource = lib.cleanSourceWith {
    src = ../.;
    filter = path: type:
      let base = baseNameOf path;
      in !(lib.hasSuffix ".nix" base)
      && base != "flake.lock"
      && base != "release"
      && base != ".stage"
      && base != ".cache"
      && base != "node_modules"
      && base != "dist";
  };

  betterSidebarSrc = pkgs.fetchFromGitHub {
    owner = "omdsh-dev";
    repo = "DSH-better-sidebar";
    rev = "f0965e1d6157a3e06ed2f5c7775a64428d5d3c29";
    hash = "sha256-4uu1StNBZTuM6BJV1498FReUWIKoTFla1OjBgIEJsnM=";
  };
  tuiSrc = pkgs.fetchFromGitHub {
    owner = "ccch1mneyyy";
    repo = "dsh-TUI";
    rev = "bdff0afb028d50c304e4474fd40f83b0721d50fd";
    hash = "sha256-N5jjAoHeABAM+rQMGuPtQasLEk9wmU/bSw2X2ilGg0U=";
  };
  tuiRelease = pkgs.fetchurl {
    url = "https://registry.npmjs.org/@deepseek-harness-tui/dsh-tui/-/dsh-tui-0.8.8.tgz";
    hash = "sha512-clebbC1YnN7kU8nqRPr7U6KBopJLmQovGEO0Qu+7rHX4fN44UGPaBbVW8gLqpZrM73c8+R7kUQm0Aq4oWtmq0g==";
  };
  tuiEcosystemSpecSrc = pkgs.fetchFromGitHub {
    owner = "T-Auto";
    repo = "dsh-ecosystem-spec";
    rev = "e1b902b0f95f4280a8e68d414ec7a4d25d6ce106";
    hash = "sha256-LVc7bMUJMI4GYW3IyBWYwFzkibayu6BgZxlO67FPtGk=";
  };
  tuiStdSrc = pkgs.fetchFromGitHub {
    owner = "Yan-Zero";
    repo = "dsh-std";
    rev = "614dfa1ac168db79fcf4577cf0ebb34e2e3b944b";
    hash = "sha256-aJEykWAXEKTUsNte51+ZEhFAgLT6QNNplNZTNPhgb00=";
  };

  # fetchPnpmDeps and the real build MUST see the same workspace graph.
  source = pkgs.runCommand "oh-dsh-source" { } ''
    cp -r ${cleanSource} $out
    chmod -R u+w $out
    mkdir -p $out/upstream
    rm -rf $out/upstream/DSH-better-sidebar $out/upstream/dsh-TUI
    cp -r ${betterSidebarSrc} $out/upstream/DSH-better-sidebar
    cp -r ${tuiSrc} $out/upstream/dsh-TUI
    chmod -R u+w $out/upstream/dsh-TUI
    rm -rf $out/upstream/dsh-TUI/dsh-ecosystem-spec \
      $out/upstream/dsh-TUI/vendor/dsh-std
    mkdir -p $out/upstream/dsh-TUI/vendor
    cp -r ${tuiEcosystemSpecSrc} \
      $out/upstream/dsh-TUI/dsh-ecosystem-spec
    cp -r ${tuiStdSrc} $out/upstream/dsh-TUI/vendor/dsh-std
    mkdir -p $out/upstream/dsh-TUI-release
    tar -xzf ${tuiRelease} --strip-components=1 \
      -C $out/upstream/dsh-TUI-release
  '';

  ohDshBundle = pkgs.stdenv.mkDerivation rec {
    pname = "oh-dsh-${surface}-bundle";
    version = (builtins.fromJSON (builtins.readFile ../package.json)).version;

    src = source;

    pnpmDeps = pkgs.fetchPnpmDeps {
      inherit pname version src;
      fetcherVersion = 4;
      hash = "sha256-dlysGu1HP7WSjURqeDFttqyeDk0igfu8Qr3b0IVE0Rs=";
    };

    nativeBuildInputs = [
      pkgs.nodejs_24
      pkgs.pnpm
      pkgs.pnpmConfigHook
    ];

    # The upstream build scripts (esbuild) are what produce dist/.
    buildPhase = ''
      runHook preBuild

      # The full release pipeline (build:dsh + stage:dsh) is skipped on purpose:
      # the DSH runtime is provided by ${dshSource} instead of the staged copy.
      node scripts/build.mjs

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out/lib/oh-dsh
      cp -r dist $out/lib/oh-dsh/
      cp -r bin $out/lib/oh-dsh/
      cp package.json $out/lib/oh-dsh/

      # Carry package manifests so the final package can register the selected
      # surfaces into dsh-runtime/node_modules (mirrors stage-dsh.mjs).
      mkdir -p $out/lib/oh-dsh/manifests
      cp package.json $out/lib/oh-dsh/manifests/desktop.json
      for p in plugins/*/package.json; do
        name=$(basename $(dirname "$p"))
        cp "$p" "$out/lib/oh-dsh/manifests/$name.json"
      done
      cp web/package.json $out/lib/oh-dsh/manifests/web.json
      cp upstream/dsh-TUI-release/package.json \
        $out/lib/oh-dsh/manifests/tui-renderer.json

      # Copy the pinned renderer and apply the guarded Oh-DSH adaptation.
      mkdir -p $out/lib/oh-dsh/tui-renderer
      cp -r upstream/dsh-TUI-release/lib \
        upstream/dsh-TUI-release/skills \
        upstream/dsh-TUI-release/dsh-ecosystem-spec \
        upstream/dsh-TUI-release/presets \
        upstream/dsh-TUI-release/cordis.patch.yml \
        upstream/dsh-TUI-release/cordis.yml \
        upstream/dsh-TUI-release/LICENSE \
        $out/lib/oh-dsh/tui-renderer/
      node -e "import('./scripts/tui-upstream-adapter.mjs').then(({ adaptTuiRendererPackage }) => adaptTuiRendererPackage('$out/lib/oh-dsh/tui-renderer'))"

      # Collect runtime dependency closures that the DSH runtime may not ship.
      mkdir -p $out/lib/oh-dsh/extra-deps
      ${pkgs.python3}/bin/python3 ${./collect-deps.py} \
        node_modules/.pnpm \
        plugins/better-sidebar-runtime/package.json \
        $out/lib/oh-dsh/extra-deps
      ${pkgs.python3}/bin/python3 ${./collect-deps.py} \
        node_modules/.pnpm \
        upstream/dsh-TUI-release/package.json \
        $out/lib/oh-dsh/extra-deps

      # The published TUI release carries its dsh-std packages as compiled
      # bundled dependencies. Prefer those artifacts over unbuilt workspace
      # sources when assembling the offline Nix runtime.
      rm -rf $out/lib/oh-dsh/extra-deps/@dsh-std
      cp -r upstream/dsh-TUI-release/node_modules/@dsh-std \
        $out/lib/oh-dsh/extra-deps/@dsh-std
      for dep in $out/lib/oh-dsh/extra-deps/@dsh-std/*; do
        ln -s ../.. "$dep/node_modules"
      done

      runHook postInstall
    '';

    # Electron is supplied by nixpkgs only in the full outer package.
    env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  };

in
pkgs.stdenv.mkDerivation {
  pname = "oh-dsh-${if isFull then "desktop" else surface}${lib.optionalString (dshSource != "llm-agents") "-${dshSource}"}";
  version = ohDshBundle.version;

  dontUnpack = true;

  nativeBuildInputs = [ pkgs.makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/oh-dsh $out/bin

    # Oh-DSH built assets
    cp -r ${ohDshBundle}/lib/oh-dsh/dist $out/lib/oh-dsh/dist
    cp ${ohDshBundle}/lib/oh-dsh/package.json $out/lib/oh-dsh/package.json

    # DSH runtime
    mkdir -p $out/dsh-runtime
    cp -r ${dshRuntimeRoot}/. $out/dsh-runtime/
    chmod -R u+w $out/dsh-runtime
    chmod +x $out/dsh-runtime/lib/bin.js || true

    # Keep Nix assembly behind the same configuration-client boundary as the
    # regular staged runtime. The shared patch fails closed when upstream
    # anchors change.
    ${pkgs.nodejs_24}/bin/node ${../scripts/settings-boundary.mjs} \
      $out/dsh-runtime

    # Node runtime: reuse the same nodejs that built the bundle. The DSH
    # runtime's HMR service requires --expose-internals (upstream releases
    # ship the flag baked into their launcher; we wrap node itself).
    mkdir -p $out/node-runtime/bin
    makeWrapper ${pkgs.nodejs_24}/bin/node $out/node-runtime/bin/node \
      --add-flags "--expose-internals"

    # Register Oh-DSH packages into dsh-runtime/node_modules so the DSH
    # profile loader can resolve them (mirrors installDesktopPackages in
    # scripts/stage-dsh.mjs).
    ${pkgs.python3}/bin/python3 ${./register-plugins.py} \
      ${ohDshBundle}/lib/oh-dsh \
      $out/lib/oh-dsh/dist \
      $out/dsh-runtime \
      ${surface}

    # Copy plugin runtime dependencies that the DSH runtime does not ship
    # (e.g. schemastery for better-sidebar-runtime).
    if [ -d "${ohDshBundle}/lib/oh-dsh/extra-deps" ]; then
      for dep in ${ohDshBundle}/lib/oh-dsh/extra-deps/*/; do
        name=$(basename "$dep")
        if [ ! -d "$out/dsh-runtime/node_modules/$name" ]; then
          cp -r "$dep" "$out/dsh-runtime/node_modules/$name"
          chmod -R u+w "$out/dsh-runtime/node_modules/$name"
        fi
      done
    fi

    # HMR is a development-time feature that requires --expose-internals;
    # the packaged runtime keeps it enabled (matching upstream releases).

    # ohdsh launcher
    makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/ohdsh \
      --add-flags "$out/lib/oh-dsh/dist/ohdsh.js" \
      --set DSH_OH_WEB_ROOT "$out" \
      --set DSH_OH_TUI_ROOT "$out" \
      --set OH_DSH_SURFACES "${if isFull then "desktop,web,tui" else surface}" \
      ${lib.optionalString isFull ''
        --set OH_DSH_DESKTOP_APP "$out/bin/oh-dsh-desktop" \
      ''}

    ${lib.optionalString isFull ''
      # Electron wrapper. OH_DSH_RESOURCES_ROOT is required because loading
      # dist/main.js directly keeps app.isPackaged false under Nix.
      makeWrapper ${pkgs.electron_42}/bin/electron $out/bin/oh-dsh-desktop \
        --add-flags "$out/lib/oh-dsh/dist/main.js" \
        --set OH_DSH_RESOURCES_ROOT "$out" \
        --set DSH_OH_WEB_ROOT "$out"

      mkdir -p $out/share/applications
      cat > $out/share/applications/oh-dsh-desktop.desktop <<EOF
      [Desktop Entry]
      Name=Oh-DSH Desktop
      Exec=$out/bin/oh-dsh-desktop
      Type=Application
      Categories=Development;
      EOF
    ''}

    runHook postInstall
  '';

  meta = with lib; {
    description = "Oh-DSH ${if isFull then "full Desktop/Web/TUI" else if includesWeb then "Web" else "TUI"} distribution";
    homepage = "https://github.com/hust-open-atom-club/oh-dsh";
    license = licenses.mit;
    platforms = platforms.linux;
    mainProgram = "ohdsh";
  };
}
