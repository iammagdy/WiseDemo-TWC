export const WISEDEMO_PRIVACY_SHIELD_ID = "wisedemo-privacy-shield";
export const WISEDEMO_FIXTURE_VIEWPORT_MASK_ID = "wisedemo-fixture-viewport-mask";

export type PrivacyShieldRegistration = {
  shieldScriptId: string;
  fixtureMaskScriptId: string;
};

export type PrivacyShieldCheckpointResult = {
  checkpoint: string;
  active: boolean;
  repaired: boolean;
  timestampMs: number;
};

export type PrivacyShieldRemovalInput = {
  fixtureActive: boolean;
  unrelatedResumeTitlesVisible: boolean;
  accountEmailVisible: boolean;
  personalDataVisible: boolean;
};

export function canRemovePrivacyShield(input: PrivacyShieldRemovalInput): boolean {
  return (
    input.fixtureActive &&
    !input.unrelatedResumeTitlesVisible &&
    !input.accountEmailVisible &&
    !input.personalDataVisible
  );
}

export function privacyShieldDocumentScript(): string {
  return `(() => {
    const id = ${JSON.stringify(WISEDEMO_PRIVACY_SHIELD_ID)};
    const install = () => {
      if (document.getElementById(id)) return;
      const shield = document.createElement("div");
      shield.id = id;
      shield.setAttribute("aria-live", "polite");
      shield.textContent = "WiseDemo is preparing your product demo";
      Object.assign(shield.style, {
        position: "fixed", inset: "0", zIndex: "2147483647", display: "grid",
        placeItems: "center", background: "#10221d", color: "#f5f1e8",
        fontFamily: "Georgia, serif", fontSize: "24px", fontWeight: "600",
        letterSpacing: "0.02em", textAlign: "center", pointerEvents: "all",
      });
      const root = document.documentElement || document.body;
      if (!root) {
        window.setTimeout(install, 0);
        return;
      }
      root.appendChild(shield);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
    else install();
  })();`;
}

export function fixtureViewportMaskDocumentScript(): string {
  return `(() => {
    const id = ${JSON.stringify(WISEDEMO_FIXTURE_VIEWPORT_MASK_ID)};
    const install = () => {
      if (document.getElementById(id)) return;
      const style = document.createElement("style");
      style.id = id;
      style.textContent = "aside, nav, [role=navigation], [data-testid*=sidebar], [class*=sidebar], [class*=recent] { visibility: hidden !important; pointer-events: none !important; }";
      (document.head || document.documentElement).appendChild(style);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
    else install();
  })();`;
}

// Product adapters may reveal one already-validated control underneath the
// full-screen shield for protected setup. The selector is never user supplied;
// it is a narrowly scoped adapter contract and the shield itself remains active.
export function fixtureViewportMaskAllowControlExpression(selector: string): string {
  return `(() => {
    const mask = document.getElementById(${JSON.stringify(WISEDEMO_FIXTURE_VIEWPORT_MASK_ID)});
    if (!mask || !mask.isConnected) return false;
    const selector = ${JSON.stringify(selector)};
    if (!selector || selector.length > 256) return false;
    mask.textContent += "\\n" + selector + " { visibility: visible !important; pointer-events: auto !important; }";
    return true;
  })()`;
}

export function privacyShieldInstallExpression(): string {
  return privacyShieldDocumentScript();
}

export function privacyShieldIsActiveExpression(): string {
  return `(() => {
    const shield = document.getElementById(${JSON.stringify(WISEDEMO_PRIVACY_SHIELD_ID)});
    if (!shield || !shield.isConnected) return false;
    const style = getComputedStyle(shield);
    const rect = shield.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" &&
      style.pointerEvents !== "none" && rect.width > 0 && rect.height > 0;
  })()`;
}

export function privacyShieldRemoveExpression(): string {
  return `(() => { document.getElementById(${JSON.stringify(WISEDEMO_PRIVACY_SHIELD_ID)})?.remove(); return !document.getElementById(${JSON.stringify(WISEDEMO_PRIVACY_SHIELD_ID)}); })()`;
}
