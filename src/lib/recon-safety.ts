export function isSafeReconNavigation(href: string, origin: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.origin === origin &&
      !/logout|signout|privacy|terms|blog|\.pdf$/i.test(`${url.pathname}${url.search}`)
    );
  } catch {
    return false;
  }
}
