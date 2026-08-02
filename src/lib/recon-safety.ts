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

export function isSafeReconAction(label: string, selector = ""): boolean {
  const value = `${label} ${selector}`.toLowerCase();
  return !/logout|sign\s*out|delete|remove|destroy|cancel subscription|billing|payment|purchase|upgrade|downgrade|close account|revoke|invite|send|submit application/i.test(
    value,
  );
}
