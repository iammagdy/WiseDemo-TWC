export type FrameType = "raw" | "browser" | "laptop" | "desktop" | "tablet" | "mobile";

export type FrameRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number;
};

export type FrameDefinition = {
  id: string;
  label: string;
  type: FrameType;
  assetFile: string;
  nativeWidth: number;
  nativeHeight: number;
  screenRegion: FrameRegion;
  safeCropRegion: FrameRegion;
  browserChrome: "none" | "minimal" | "address";
  variants: Record<"dark" | "light", { assetFile: string; thumbnail: string }>;
  thumbnail: string;
  defaultCanvasPlacement: { x: number; y: number; width: number };
};

const frame = (definition: FrameDefinition): FrameDefinition => definition;

export const FRAME_REGISTRY = [
  frame({
    id: "raw-fullscreen",
    label: "Raw fullscreen",
    type: "raw",
    assetFile: "/frames/raw.svg",
    nativeWidth: 1600,
    nativeHeight: 900,
    screenRegion: { x: 0, y: 0, width: 1600, height: 900, cornerRadius: 0 },
    safeCropRegion: { x: 0, y: 0, width: 1600, height: 900, cornerRadius: 0 },
    browserChrome: "none",
    variants: {
      dark: { assetFile: "/frames/raw.svg", thumbnail: "/frames/raw.svg" },
      light: { assetFile: "/frames/raw.svg", thumbnail: "/frames/raw.svg" },
    },
    thumbnail: "/frames/raw.svg",
    defaultCanvasPlacement: { x: 0, y: 0, width: 1 },
  }),
  frame({
    id: "minimal-browser",
    label: "Minimal browser",
    type: "browser",
    assetFile: "/frames/minimal-browser-dark.svg",
    nativeWidth: 1600,
    nativeHeight: 1000,
    screenRegion: { x: 24, y: 72, width: 1552, height: 904, cornerRadius: 18 },
    safeCropRegion: { x: 46, y: 92, width: 1508, height: 864, cornerRadius: 14 },
    browserChrome: "minimal",
    variants: {
      dark: {
        assetFile: "/frames/minimal-browser-dark.svg",
        thumbnail: "/frames/minimal-browser-dark.svg",
      },
      light: {
        assetFile: "/frames/minimal-browser-light.svg",
        thumbnail: "/frames/minimal-browser-light.svg",
      },
    },
    thumbnail: "/frames/minimal-browser-dark.svg",
    defaultCanvasPlacement: { x: 0.09, y: 0.15, width: 0.82 },
  }),
  frame({
    id: "browser-address-bar",
    label: "Browser with address bar",
    type: "browser",
    assetFile: "/frames/browser-address-dark.svg",
    nativeWidth: 1600,
    nativeHeight: 1000,
    screenRegion: { x: 24, y: 126, width: 1552, height: 850, cornerRadius: 16 },
    safeCropRegion: { x: 46, y: 146, width: 1508, height: 810, cornerRadius: 12 },
    browserChrome: "address",
    variants: {
      dark: {
        assetFile: "/frames/browser-address-dark.svg",
        thumbnail: "/frames/browser-address-dark.svg",
      },
      light: {
        assetFile: "/frames/browser-address-light.svg",
        thumbnail: "/frames/browser-address-light.svg",
      },
    },
    thumbnail: "/frames/browser-address-dark.svg",
    defaultCanvasPlacement: { x: 0.08, y: 0.13, width: 0.84 },
  }),
  frame({
    id: "floating-browser",
    label: "Floating browser",
    type: "browser",
    assetFile: "/frames/floating-browser-dark.svg",
    nativeWidth: 1600,
    nativeHeight: 1000,
    screenRegion: { x: 34, y: 88, width: 1532, height: 878, cornerRadius: 28 },
    safeCropRegion: { x: 58, y: 110, width: 1484, height: 832, cornerRadius: 22 },
    browserChrome: "minimal",
    variants: {
      dark: {
        assetFile: "/frames/floating-browser-dark.svg",
        thumbnail: "/frames/floating-browser-dark.svg",
      },
      light: {
        assetFile: "/frames/floating-browser-light.svg",
        thumbnail: "/frames/floating-browser-light.svg",
      },
    },
    thumbnail: "/frames/floating-browser-dark.svg",
    defaultCanvasPlacement: { x: 0.11, y: 0.14, width: 0.78 },
  }),
  frame({
    id: "premium-laptop",
    label: "Generic premium laptop",
    type: "laptop",
    assetFile: "/frames/premium-laptop-dark.svg",
    nativeWidth: 1920,
    nativeHeight: 1200,
    screenRegion: { x: 214, y: 95, width: 1492, height: 932, cornerRadius: 14 },
    safeCropRegion: { x: 232, y: 113, width: 1456, height: 896, cornerRadius: 10 },
    browserChrome: "none",
    variants: {
      dark: {
        assetFile: "/frames/premium-laptop-dark.svg",
        thumbnail: "/frames/premium-laptop-dark.svg",
      },
      light: {
        assetFile: "/frames/premium-laptop-light.svg",
        thumbnail: "/frames/premium-laptop-light.svg",
      },
    },
    thumbnail: "/frames/premium-laptop-dark.svg",
    defaultCanvasPlacement: { x: 0.12, y: 0.15, width: 0.76 },
  }),
  frame({
    id: "desktop-monitor",
    label: "Desktop monitor",
    type: "desktop",
    assetFile: "/frames/desktop-monitor-dark.svg",
    nativeWidth: 1600,
    nativeHeight: 1200,
    screenRegion: { x: 170, y: 80, width: 1260, height: 790, cornerRadius: 12 },
    safeCropRegion: { x: 188, y: 98, width: 1224, height: 754, cornerRadius: 8 },
    browserChrome: "none",
    variants: {
      dark: {
        assetFile: "/frames/desktop-monitor-dark.svg",
        thumbnail: "/frames/desktop-monitor-dark.svg",
      },
      light: {
        assetFile: "/frames/desktop-monitor-light.svg",
        thumbnail: "/frames/desktop-monitor-light.svg",
      },
    },
    thumbnail: "/frames/desktop-monitor-dark.svg",
    defaultCanvasPlacement: { x: 0.18, y: 0.1, width: 0.64 },
  }),
  frame({
    id: "tablet",
    label: "Tablet",
    type: "tablet",
    assetFile: "/frames/tablet-dark.svg",
    nativeWidth: 1200,
    nativeHeight: 1600,
    screenRegion: { x: 92, y: 105, width: 1016, height: 1390, cornerRadius: 36 },
    safeCropRegion: { x: 114, y: 127, width: 972, height: 1346, cornerRadius: 28 },
    browserChrome: "none",
    variants: {
      dark: { assetFile: "/frames/tablet-dark.svg", thumbnail: "/frames/tablet-dark.svg" },
      light: { assetFile: "/frames/tablet-light.svg", thumbnail: "/frames/tablet-light.svg" },
    },
    thumbnail: "/frames/tablet-dark.svg",
    defaultCanvasPlacement: { x: 0.27, y: 0.08, width: 0.46 },
  }),
  frame({
    id: "mobile-phone",
    label: "Mobile phone",
    type: "mobile",
    assetFile: "/frames/mobile-phone-dark.svg",
    nativeWidth: 1000,
    nativeHeight: 2000,
    screenRegion: { x: 78, y: 96, width: 844, height: 1808, cornerRadius: 92 },
    safeCropRegion: { x: 104, y: 128, width: 792, height: 1744, cornerRadius: 72 },
    browserChrome: "none",
    variants: {
      dark: {
        assetFile: "/frames/mobile-phone-dark.svg",
        thumbnail: "/frames/mobile-phone-dark.svg",
      },
      light: {
        assetFile: "/frames/mobile-phone-light.svg",
        thumbnail: "/frames/mobile-phone-light.svg",
      },
    },
    thumbnail: "/frames/mobile-phone-dark.svg",
    defaultCanvasPlacement: { x: 0.3, y: 0.07, width: 0.4 },
  }),
] as const satisfies readonly FrameDefinition[];

export type FrameId = (typeof FRAME_REGISTRY)[number]["id"];

export function getFrameDefinition(frameId: string): FrameDefinition {
  return FRAME_REGISTRY.find((entry) => entry.id === frameId) ?? FRAME_REGISTRY[0];
}

export function frameHeight(frameId: string, width: number): number {
  const definition = getFrameDefinition(frameId);
  return width * (definition.nativeHeight / definition.nativeWidth);
}

export function screenRectForPlacement(frameId: string, x: number, y: number, width: number) {
  const definition = getFrameDefinition(frameId);
  const scale = width / definition.nativeWidth;
  return {
    x: x + definition.screenRegion.x * scale,
    y: y + definition.screenRegion.y * scale,
    width: definition.screenRegion.width * scale,
    height: definition.screenRegion.height * scale,
    cornerRadius: definition.screenRegion.cornerRadius * scale,
  };
}
