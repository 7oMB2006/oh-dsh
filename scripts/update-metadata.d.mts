export interface UpdateMetadataFile {
  url: string
  sha512: string
  size?: number
  blockMapSize?: number
}

export interface UpdateMetadata {
  version: string
  files: UpdateMetadataFile[]
  [key: string]: unknown
}

export function mergeMetadata(documents: UpdateMetadata[]): UpdateMetadata
export function verifyMetadata(input: {
  dir: string
  version: string
  platform: 'mac-arm64' | 'mac-x64' | 'win-x64' | 'linux-x64'
}): { metadataPath: string; selected: string; version: string }
