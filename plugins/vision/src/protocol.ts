/** Browser/Host protocol shared by the built-in vision attachment bridge. */

export const VISION_ATTACHMENT_API_PATH = '/oh-dsh/vision/attachment'
export const VISION_REFERENCE_SOURCE = 'oh-dsh-vision-image'
export const VISION_ATTACHMENT_SCHEME = 'oh-dsh-attachment:'

export const VISION_IMAGE_MEDIA_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const)

export type VisionImageMediaType = typeof VISION_IMAGE_MEDIA_TYPES[number]

/** Serializable subset of DSH's immutable image attachment reference. */
export interface VisionAttachmentRef {
  attachmentId: string
  bytes: number
  height: number
  mediaType: VisionImageMediaType
  name?: string
  width: number
}

export interface VisionAttachmentUpload {
  data: string
  mediaType: VisionImageMediaType
  name?: string
  sessionId: string
}

export interface VisionAttachmentUploadResult {
  source: string
}

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isVisionImageMediaType(value: string): value is VisionImageMediaType {
  return (VISION_IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
}

export function visionAttachmentSource(token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error('invalid vision attachment token')
  return `${VISION_ATTACHMENT_SCHEME}${token}`
}

export function visionAttachmentToken(source: string): string | undefined {
  if (!source.startsWith(VISION_ATTACHMENT_SCHEME)) return undefined
  const token = source.slice(VISION_ATTACHMENT_SCHEME.length)
  return TOKEN_PATTERN.test(token) ? token : undefined
}

/** Plain model text emitted for one browser-pasted image reference. */
export function visionModelReference(source: string): string {
  if (visionAttachmentToken(source) === undefined) {
    throw new Error('pasted image upload returned an invalid attachment reference')
  }
  return [
    '[Pasted image]',
    'Inspect this image with the view_image tool before answering.',
    `Use this exact source: ${JSON.stringify(source)}`,
  ].join('\n')
}
