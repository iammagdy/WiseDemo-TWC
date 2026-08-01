export type RuntimeBrowserMetrics = {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenX: number;
  screenY: number;
  devicePixelRatio: number;
  visualViewportWidth: number;
  visualViewportHeight: number;
  visualViewportOffsetLeft: number;
  visualViewportOffsetTop: number;
};

export type SourceViewport = {
  videoWidth: number;
  videoHeight: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
};

export type SourceViewportMetadata = {
  version: 1;
  detection: "runtime-metrics" | "manual" | "full-frame";
  sourceViewport: SourceViewport;
  browserMetrics?: RuntimeBrowserMetrics;
};

export type SourceCropCorrections = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function fullFrameSourceViewport(videoWidth = 1280, videoHeight = 720): SourceViewport {
  return {
    videoWidth,
    videoHeight,
    contentX: 0,
    contentY: 0,
    contentWidth: videoWidth,
    contentHeight: videoHeight,
  };
}

export function detectSourceViewport(
  metrics: RuntimeBrowserMetrics,
  video: { width: number; height: number },
): SourceViewportMetadata {
  const videoWidth = Math.max(1, Math.round(video.width));
  const videoHeight = Math.max(1, Math.round(video.height));
  const outerWidth = finitePositive(metrics.outerWidth, metrics.innerWidth);
  const outerHeight = finitePositive(metrics.outerHeight, metrics.innerHeight);
  const viewportWidth = Math.min(
    outerWidth,
    finitePositive(metrics.visualViewportWidth, metrics.innerWidth),
  );
  const viewportHeight = Math.min(
    outerHeight,
    finitePositive(metrics.visualViewportHeight, metrics.innerHeight),
  );
  const scaleX = videoWidth / outerWidth;
  const scaleY = videoHeight / outerHeight;
  const contentWidth = Math.min(videoWidth, Math.max(1, Math.round(viewportWidth * scaleX)));
  const contentHeight = Math.min(videoHeight, Math.max(1, Math.round(viewportHeight * scaleY)));
  const horizontalInset = Math.max(
    0,
    (outerWidth - viewportWidth) / 2 + metrics.visualViewportOffsetLeft,
  );
  const contentX = Math.min(
    videoWidth - contentWidth,
    Math.max(0, Math.round(horizontalInset * scaleX)),
  );
  // Chromium's tab/address chrome is above the page viewport. Any small visual
  // viewport top offset is additive (for example an in-page browser overlay).
  const contentY = Math.min(
    videoHeight - contentHeight,
    Math.max(
      0,
      Math.round((outerHeight - viewportHeight + metrics.visualViewportOffsetTop) * scaleY),
    ),
  );
  return {
    version: 1,
    detection: "runtime-metrics",
    sourceViewport: { videoWidth, videoHeight, contentX, contentY, contentWidth, contentHeight },
    browserMetrics: metrics,
  };
}

export function rescaleSourceViewport(
  metadata: SourceViewportMetadata,
  video: { width: number; height: number },
): SourceViewportMetadata {
  if (metadata.browserMetrics) return detectSourceViewport(metadata.browserMetrics, video);
  const source = metadata.sourceViewport;
  const scaleX = video.width / source.videoWidth;
  const scaleY = video.height / source.videoHeight;
  return {
    ...metadata,
    sourceViewport: {
      videoWidth: video.width,
      videoHeight: video.height,
      contentX: Math.round(source.contentX * scaleX),
      contentY: Math.round(source.contentY * scaleY),
      contentWidth: Math.round(source.contentWidth * scaleX),
      contentHeight: Math.round(source.contentHeight * scaleY),
    },
  };
}

export function correctedSourceViewport(
  source: SourceViewport,
  corrections: SourceCropCorrections,
): SourceViewport {
  const left = Math.max(0, Math.round(corrections.left));
  const right = Math.max(0, Math.round(corrections.right));
  const top = Math.max(0, Math.round(corrections.top));
  const bottom = Math.max(0, Math.round(corrections.bottom));
  return {
    ...source,
    contentX: source.contentX + left,
    contentY: source.contentY + top,
    contentWidth: Math.max(1, source.contentWidth - left - right),
    contentHeight: Math.max(1, source.contentHeight - top - bottom),
  };
}

export function sourcePlacement(
  source: SourceViewport,
  target: { width: number; height: number },
  fit: "contain" | "cover" | "fill",
) {
  const uniformScale =
    fit === "cover"
      ? Math.max(target.width / source.contentWidth, target.height / source.contentHeight)
      : Math.min(target.width / source.contentWidth, target.height / source.contentHeight);
  const scaleX = fit === "fill" ? target.width / source.contentWidth : uniformScale;
  const scaleY = fit === "fill" ? target.height / source.contentHeight : uniformScale;
  const width = source.contentWidth * scaleX;
  const height = source.contentHeight * scaleY;
  return {
    left: (target.width - width) / 2,
    top: (target.height - height) / 2,
    width,
    height,
    videoLeft: -source.contentX * scaleX,
    videoTop: -source.contentY * scaleY,
    videoWidth: source.videoWidth * scaleX,
    videoHeight: source.videoHeight * scaleY,
  };
}

export function pagePointToCroppedSource(
  source: SourceViewport,
  point: { x: number; y: number },
  corrections: Pick<SourceCropCorrections, "left" | "top"> = { left: 0, top: 0 },
) {
  return {
    x: Math.min(1, Math.max(0, (point.x - corrections.left) / source.contentWidth)),
    y: Math.min(1, Math.max(0, (point.y - corrections.top) / source.contentHeight)),
  };
}

export function readMp4Dimensions(bytes: Uint8Array): { width: number; height: number } | null {
  for (let index = 4; index + 96 < bytes.byteLength; index += 1) {
    if (
      bytes[index] !== 0x74 ||
      bytes[index + 1] !== 0x6b ||
      bytes[index + 2] !== 0x68 ||
      bytes[index + 3] !== 0x64
    )
      continue;
    const boxStart = index - 4;
    const size = new DataView(bytes.buffer, bytes.byteOffset + boxStart, 4).getUint32(0);
    if (size < 92 || boxStart + size > bytes.byteLength) continue;
    const version = bytes[index + 4];
    const dimensionOffset = boxStart + (version === 1 ? 96 : 84);
    if (dimensionOffset + 8 > boxStart + size) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset + dimensionOffset, 8);
    const width = Math.round(view.getUint32(0) / 65_536);
    const height = Math.round(view.getUint32(4) / 65_536);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}
