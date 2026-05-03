export function inferImageAspectRatio(text: string): string {
  const normalized = text.toLowerCase();
  if (/\b(portrait|vertical|phone wallpaper|9:16|tall)\b/iu.test(normalized)) {
    return "portrait";
  }
  if (/\b(landscape|wide|widescreen|16:9|banner|cinematic)\b/iu.test(normalized)) {
    return "landscape";
  }
  return "square";
}
