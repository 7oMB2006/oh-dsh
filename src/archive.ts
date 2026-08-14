/** Build Info-ZIP arguments that preserve the portable runtime symlinks. */
export function portableZipArguments(
  archive: string,
  directory: string,
): string[] {
  return ['-qry', '-y', archive, directory]
}
