export interface DshSourceSpec {
  readonly repository: string
  readonly ref: string
  readonly revision: string
  readonly version: string
}

export const DSH_SOURCE_SPEC: DshSourceSpec

export function resolveDshSource(): string
