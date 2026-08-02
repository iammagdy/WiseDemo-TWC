import type { CompositionDesign } from "./model.ts";
import { COMPOSITION_VERSION, cloneComposition } from "./model.ts";

export type CompositionTemplate = {
  id: string;
  name: string;
  description: string;
  design: CompositionDesign;
};

const baseDesign: CompositionDesign = {
  version: COMPOSITION_VERSION,
  templateId: "minimal-browser",
  canvas: { width: 1920, height: 1080, fps: 30, format: "landscape" },
  background: {
    type: "linear-gradient",
    colors: ["#12131a", "#2d1734", "#0e1729"],
    angle: 135,
    imageUrl: null,
    videoUrl: null,
    blur: 44,
    textureOpacity: 0.08,
  },
  frame: {
    id: "minimal-browser",
    variant: "dark",
    x: 174,
    y: 164,
    width: 1572,
    rotation: 0,
    radius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    shadowBlur: 72,
    shadowOpacity: 0.34,
    shadowOffsetX: 0,
    shadowOffsetY: 28,
    chromeVisible: true,
    addressText: "app.example.com",
  },
  recording: {
    locale: "english",
    fit: "cover",
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    cropTop: 0,
    cropRight: 0,
    cropBottom: 0,
    cropLeft: 0,
    sourceViewport: {
      videoWidth: 1280,
      videoHeight: 720,
      contentX: 0,
      contentY: 0,
      contentWidth: 1280,
      contentHeight: 720,
    },
    sourceCropTop: 0,
    sourceCropRight: 0,
    sourceCropBottom: 0,
    sourceCropLeft: 0,
    editorialCuts: [],
  },
  animation: {
    preset: "minimal-premium",
    entrance: "scale",
    floatingMotion: 0.14,
    zoomEvents: [],
    spotlights: [],
  },
  captions: {
    enabled: true,
    position: "bottom",
    fontFamily: "inter",
    fontSize: 42,
    color: "#ffffff",
    backgroundColor: "rgba(8,10,16,0.78)",
    maxWidth: 1160,
    items: [],
  },
  branding: {
    logoUrl: null,
    logoPosition: "top-right",
    logoWidth: 132,
    opacity: 0.9,
    watermarkText: "WiseDemo",
  },
  intro: {
    enabled: true,
    duration: 1.4,
    title: "Product walkthrough",
    subtitle: "Built from one real recording",
  },
  outro: {
    enabled: true,
    duration: 1.3,
    title: "Ready to move faster?",
    subtitle: "Create, style, and share your product story.",
  },
  audio: { musicUrl: null, volume: 0.18, fadeIn: 1, fadeOut: 1.2 },
  export: { quality: "high", codec: "h264" },
};

function template(
  id: string,
  name: string,
  description: string,
  transform: (design: CompositionDesign) => void,
): CompositionTemplate {
  const design = cloneComposition(baseDesign);
  design.templateId = id;
  transform(design);
  return { id, name, description, design };
}

export const COMPOSITION_TEMPLATES = [
  template(
    "minimal-browser",
    "Minimal Browser",
    "Quiet chrome, strong product focus.",
    () => undefined,
  ),
  template(
    "premium-laptop",
    "Premium Laptop",
    "Cinematic device framing with intentional margin.",
    (design) => {
      design.frame = {
        ...design.frame,
        id: "premium-laptop",
        x: 230,
        y: 118,
        width: 1460,
        shadowBlur: 58,
        shadowOpacity: 0.3,
        shadowOffsetY: 24,
        chromeVisible: false,
      };
      design.background = {
        ...design.background,
        type: "mesh-gradient",
        colors: ["#05070d", "#15213c", "#3a173f", "#10182d"],
      };
      design.animation.preset = "cinematic";
      design.animation.entrance = "slide-up";
    },
  ),
  template(
    "founder-launch",
    "Founder Launch",
    "Editorial launch energy for announcements.",
    (design) => {
      design.canvas = { width: 1080, height: 1350, fps: 30, format: "portrait-feed" };
      design.frame = {
        ...design.frame,
        id: "floating-browser",
        x: 82,
        y: 300,
        width: 916,
        rotation: -1.5,
        shadowBlur: 88,
        shadowOpacity: 0.44,
      };
      design.background = {
        ...design.background,
        type: "radial-gradient",
        colors: ["#ff5a1f", "#451c45", "#090a10"],
      };
      design.animation.preset = "founder-launch";
      design.captions.position = "top";
      design.captions.fontSize = 48;
    },
  ),
  template("mobile-showcase", "Mobile Showcase", "Vertical-first phone presentation.", (design) => {
    design.canvas = { width: 1080, height: 1920, fps: 30, format: "vertical" };
    design.frame = {
      ...design.frame,
      id: "mobile-phone",
      x: 286,
      y: 250,
      width: 508,
      shadowBlur: 64,
      shadowOpacity: 0.4,
      chromeVisible: false,
    };
    design.background = {
      ...design.background,
      type: "mesh-gradient",
      colors: ["#071426", "#0f4160", "#452356", "#0a0b13"],
    };
    design.animation.preset = "fast-social";
    design.captions.position = "bottom";
    design.captions.fontSize = 52;
    design.captions.maxWidth = 860;
  }),
  template(
    "clean-saas",
    "Clean SaaS",
    "Bright, precise framing for product education.",
    (design) => {
      design.canvas = { width: 1080, height: 1080, fps: 30, format: "square" };
      design.frame = {
        ...design.frame,
        id: "browser-address-bar",
        variant: "light",
        x: 82,
        y: 205,
        width: 916,
        borderColor: "rgba(0,0,0,0.08)",
        shadowOpacity: 0.16,
      };
      design.background = {
        ...design.background,
        type: "linear-gradient",
        colors: ["#f7f8fb", "#dce7ff"],
        angle: 145,
      };
      design.captions.color = "#101828";
      design.captions.backgroundColor = "rgba(255,255,255,0.9)";
      design.animation.preset = "subtle";
    },
  ),
] as const satisfies readonly CompositionTemplate[];

export function getCompositionTemplate(templateId: string): CompositionTemplate {
  return COMPOSITION_TEMPLATES.find((entry) => entry.id === templateId) ?? COMPOSITION_TEMPLATES[0];
}

export function compositionFromTemplate(templateId: string): CompositionDesign {
  return cloneComposition(getCompositionTemplate(templateId).design);
}
