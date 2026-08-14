# Build the pinned deepseek-harness runtime from source, matching the
# revision recorded in this repository's dsh-source.json.

{ lib
, buildNpmPackage
, fetchFromGitHub
, nodejs_22
, dshSourceSpec
}:

buildNpmPackage rec {
  pname = "dsh-runtime-pinned";
  version = dshSourceSpec.version;

  src = fetchFromGitHub {
    owner = "deepseek-ai";
    repo = "deepseek-harness";
    rev = dshSourceSpec.revision;
    hash = lib.fakeHash; # filled in below after first build
  };

  nodejs = nodejs_22;

  npmDepsHash = lib.fakeHash; # filled in below after first build

  # The deepseek-harness release tarball ships compiled lib/ output; building
  # from git requires the full monorepo build. Keep this as a source build
  # so the pinned variant tracks the exact revision in dsh-source.json.
  buildPhase = ''
    runHook preBuild
    npm run build --if-present
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/dsh
    cp -r lib config package.json node_modules $out/lib/dsh/ 2>/dev/null || true
    # Fallback: if no lib/ was produced, copy the whole tree.
    if [ ! -d $out/lib/dsh/lib ]; then
      cp -r . $out/lib/dsh/
    fi
    runHook postInstall
  '';

  meta = with lib; {
    description = "Pinned DeepSeek Harness runtime (${dshSourceSpec.version})";
    license = licenses.mit;
    platforms = platforms.unix;
  };
}
