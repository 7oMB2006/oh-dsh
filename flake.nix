{
  description = "Oh-DSH: an installable DeepSeek Harness desktop and web distribution";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    llm-agents = {
      url = "github:numtide/llm-agents.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, llm-agents }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;

      # The version of deepseek-harness pinned by this repository.
      dshSourceSpec = builtins.fromJSON (builtins.readFile ./dsh-source.json);
    in
    {
      devShells = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system}; in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.pnpm
              pkgs.git
              pkgs.curl
              pkgs.python3 # node-gyp
              pkgs.pkg-config
            ];

            # pnpm install fetches its own electron; no nixpkgs electron here.
            shellHook = ''
              export OH_DSH_SOURCE_ROOT="$PWD"
            '';
          };
        });

      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          mkOhDsh = import ./nix/oh-dsh.nix {
            inherit pkgs system llm-agents dshSourceSpec;
          };
        in
        rec {
          # Default dsh source: numtide/llm-agents.nix.
          oh-dsh-web = mkOhDsh { surface = "web"; dshSource = "llm-agents"; };
          oh-dsh-desktop = mkOhDsh { surface = "desktop"; dshSource = "llm-agents"; };

          # Variant pinning the DSH runtime to this repo's dsh-source.json.
          oh-dsh-web-pinned = mkOhDsh { surface = "web"; dshSource = "pinned"; };
          oh-dsh-desktop-pinned = mkOhDsh { surface = "desktop"; dshSource = "pinned"; };

          # "nixpkgs" variant is available via mkOhDsh but not exposed as a
          # package until pkgs.deepseek-harness lands (NixOS/nixpkgs#552467).

          default = oh-dsh-web;
        });
    };
}
