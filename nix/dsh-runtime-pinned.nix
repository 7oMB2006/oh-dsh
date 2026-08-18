# Build the pinned deepseek-harness runtime from the npm release recorded in
# this repository's dsh-source.json. The npm package ships compiled `lib/`
# and `config/`, so only the dependency graph needs installation.

{ lib
, buildNpmPackage
, fetchurl
, nodejs_24
, pnpm
, pnpmConfigHook
, runCommand
, dshSourceSpec
}:

assert dshSourceSpec.source == "npm";

let
  tarball = fetchurl {
    url = dshSourceSpec.tarball;
    hash = lib.fakeHash; # filled in below after first build
  };

  # pnpm install needs the lockfile beside package.json; the npm tarball
  # carries the package but not the lockfile.
  src = runCommand "dsh-runtime-pinned-src" { } ''
    mkdir -p $out
    tar -xzf ${tarball} -C $out --strip-components=1
    cp ${../scripts}/dsh-runtime-${dshSourceSpec.version}-lock.yaml $out/pnpm-lock.yaml
  '';
in

buildNpmPackage rec {
  pname = "dsh-runtime-pinned";
  version = dshSourceSpec.version;

  inherit src;

  nodejs = nodejs_24;

  nativeBuildInputs = [ pnpm pnpmConfigHook ];

  npmDepsHash = lib.fakeHash; # filled in below after first build

  buildPhase = ''
    runHook preBuild
    pnpm install --frozen-lockfile --ignore-scripts
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/dsh
    cp -r lib config package.json node_modules $out/lib/dsh/
    runHook postInstall
  '';

  meta = with lib; {
    description = "Pinned DeepSeek Harness npm runtime (${dshSourceSpec.version})";
    license = licenses.mit;
    platforms = platforms.unix;
  };
}
