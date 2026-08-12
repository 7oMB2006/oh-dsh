export interface ReplaceMacBundleOptions {
  source: string
  destination: string
  backupDirectory: string
  copyBundle(from: string, pending: string): Promise<void>
  validateBundle?(path: string): Promise<void>
}

export interface ReplaceMacBundleResult {
  backup: string | undefined
  destination: string
}

export function validateMacBundle(
  path: string,
  options?: { verifySignature?: boolean },
): Promise<void>

export function replaceMacBundle(
  options: ReplaceMacBundleOptions,
): Promise<ReplaceMacBundleResult>
