export const landlockLauncherPackageName: '@deepseek-ai/node-addon-landlock-run-linux-x64'

export interface RestoreLandlockLauncherOptions {
  readonly runtimeRoot: string
  readonly sourcePackageRoot: string
}

export function restoreLandlockLauncher(options: RestoreLandlockLauncherOptions): string
