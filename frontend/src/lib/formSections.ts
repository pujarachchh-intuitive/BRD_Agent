export function sectionAnchorId(title: string): string {
  return `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}
