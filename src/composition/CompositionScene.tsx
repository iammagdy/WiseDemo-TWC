import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  Video,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { frameHeight, getFrameDefinition, screenRectForPlacement } from "./frames";
import type { CompositionDesign, CompositionRenderProps } from "./model";
import {
  correctedSourceViewport,
  pagePointToCroppedSource,
  sourcePlacement,
  type SourceCropCorrections,
  type SourceViewport,
} from "./source-viewport";

const fontFamily = {
  inter: "Inter, ui-sans-serif, system-ui, sans-serif",
  serif: '"Instrument Serif", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;

export function CompositionScene(props: CompositionRenderProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { composition, rawDurationSeconds } = props;
  const introFrames = composition.intro.enabled ? Math.round(composition.intro.duration * fps) : 0;
  const rawFrames = Math.round(rawDurationSeconds * fps);
  const outroFrames = composition.outro.enabled ? Math.round(composition.outro.duration * fps) : 0;
  const contentFrame = Math.max(0, Math.min(rawFrames, frame - introFrames));

  return (
    <AbsoluteFill style={{ overflow: "hidden", color: "white" }}>
      <Background composition={composition} frame={frame} fps={fps} />
      {composition.audio.musicUrl ? (
        <Audio src={composition.audio.musicUrl} volume={composition.audio.volume} />
      ) : null}
      {introFrames > 0 ? (
        <Sequence durationInFrames={introFrames} premountFor={fps}>
          <TitleCard
            title={composition.intro.title}
            subtitle={composition.intro.subtitle}
            durationInFrames={introFrames}
            mode="intro"
          />
        </Sequence>
      ) : null}
      <Sequence from={introFrames} durationInFrames={rawFrames} premountFor={fps}>
        <RecordingFrame {...props} contentFrame={contentFrame} />
        <CaptionLayer composition={composition} contentFrame={contentFrame} fps={fps} />
        <BrandingLayer composition={composition} />
      </Sequence>
      {outroFrames > 0 ? (
        <Sequence from={introFrames + rawFrames} durationInFrames={outroFrames} premountFor={fps}>
          <TitleCard
            title={composition.outro.title}
            subtitle={composition.outro.subtitle}
            durationInFrames={outroFrames}
            mode="outro"
          />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
}

function Background({
  composition,
  frame,
  fps,
}: {
  composition: CompositionDesign;
  frame: number;
  fps: number;
}) {
  const background = composition.background;
  const colors = background.colors;
  const drift = Math.sin((frame / fps) * 0.24) * 4;
  let backgroundImage: string | undefined;
  if (background.type === "linear-gradient") {
    backgroundImage = `linear-gradient(${background.angle + drift}deg, ${colors.join(", ")})`;
  } else if (background.type === "radial-gradient") {
    backgroundImage = `radial-gradient(circle at ${50 + drift}% 42%, ${colors.join(", ")})`;
  } else if (["mesh-gradient", "brand-blur"].includes(background.type)) {
    backgroundImage = [
      `radial-gradient(circle at ${18 + drift}% 24%, ${colors[1] ?? colors[0]} 0%, transparent 42%)`,
      `radial-gradient(circle at 82% ${72 - drift}%, ${colors[2] ?? colors[0]} 0%, transparent 44%)`,
      `linear-gradient(${background.angle}deg, ${colors[0]}, ${colors.at(-1) ?? colors[0]})`,
    ].join(",");
  } else if (background.type === "texture") {
    backgroundImage = `radial-gradient(circle at 1px 1px, rgba(255,255,255,${background.textureOpacity}) 1px, transparent 0)`;
  }

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors[0],
        backgroundImage,
        backgroundSize: background.type === "texture" ? "18px 18px" : "cover",
      }}
    >
      {background.type === "image" && background.imageUrl ? (
        <Img
          src={background.imageUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: `blur(${background.blur}px)`,
            transform: "scale(1.08)",
          }}
        />
      ) : null}
      {background.type === "video" && background.videoUrl ? (
        <OffthreadVideo
          src={background.videoUrl}
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: `blur(${background.blur}px)`,
            transform: "scale(1.08)",
          }}
        />
      ) : null}
      {background.textureOpacity > 0 && background.type !== "texture" ? (
        <AbsoluteFill
          style={{
            opacity: background.textureOpacity,
            backgroundImage: "radial-gradient(circle at 1px 1px, white 0.7px, transparent 0)",
            backgroundSize: "16px 16px",
            mixBlendMode: "soft-light",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
}

function RecordingFrame(
  props: CompositionRenderProps & {
    contentFrame: number;
  },
) {
  const { composition, rawVideoIsStatic, rawVideoUrl, contentFrame } = props;
  const { fps } = useVideoConfig();
  const definition = getFrameDefinition(composition.frame.id);
  const height = frameHeight(definition.id, composition.frame.width);
  const screen = screenRectForPlacement(definition.id, 0, 0, composition.frame.width);
  const crop = composition.recording;
  const corrections: SourceCropCorrections = {
    top: crop.sourceCropTop + Math.round(crop.cropTop * crop.sourceViewport.contentHeight),
    right: crop.sourceCropRight + Math.round(crop.cropRight * crop.sourceViewport.contentWidth),
    bottom: crop.sourceCropBottom + Math.round(crop.cropBottom * crop.sourceViewport.contentHeight),
    left: crop.sourceCropLeft + Math.round(crop.cropLeft * crop.sourceViewport.contentWidth),
  };
  const sourceViewport = correctedSourceViewport(crop.sourceViewport, corrections);
  const placement = sourcePlacement(
    sourceViewport,
    { width: screen.width, height: screen.height },
    crop.fit,
  );
  const motion = frameMotion(composition, contentFrame, fps, sourceViewport, corrections, {
    width: screen.width,
    height: screen.height,
  });
  const entrance = entranceMotion(composition, contentFrame, fps);
  const frameAsset = definition.variants[composition.frame.variant].assetFile;
  const frameAssetUrl = staticFile(frameAsset.replace(/^\/+/, ""));
  const source = rawVideoIsStatic ? staticFile(rawVideoUrl) : rawVideoUrl;

  return (
    <div
      style={{
        position: "absolute",
        left: composition.frame.x,
        top: composition.frame.y + entrance.translateY + motion.floatY,
        width: composition.frame.width,
        height,
        opacity: entrance.opacity,
        transform: `translateX(${entrance.translateX}px) scale(${entrance.scale}) rotate(${composition.frame.rotation}deg)`,
        transformOrigin: "center center",
        filter: `drop-shadow(${composition.frame.shadowOffsetX}px ${composition.frame.shadowOffsetY}px ${composition.frame.shadowBlur}px rgba(0,0,0,${composition.frame.shadowOpacity}))`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: screen.x,
          top: screen.y,
          width: screen.width,
          height: screen.height,
          overflow: "hidden",
          borderRadius: Math.max(composition.frame.radius, screen.cornerRadius),
          border: `${composition.frame.borderWidth}px solid ${composition.frame.borderColor}`,
          background: "#050505",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: placement.left,
            top: placement.top,
            width: placement.width,
            height: placement.height,
            overflow: "hidden",
            transform: `translate(${crop.offsetX + motion.panX}px, ${crop.offsetY + motion.panY}px) scale(${crop.zoom * motion.zoom})`,
            transformOrigin: "center center",
          }}
        >
          {rawVideoIsStatic ? (
            <OffthreadVideo src={source} style={sourceVideoStyle(placement)} />
          ) : (
            <Video src={source} style={sourceVideoStyle(placement)} />
          )}
        </div>
        {composition.animation.spotlights.map((spotlight) => {
          const localSeconds = contentFrame / fps;
          if (localSeconds < spotlight.start || localSeconds > spotlight.start + spotlight.duration)
            return null;
          const pulse = 0.75 + Math.sin((localSeconds - spotlight.start) * Math.PI * 3) * 0.12;
          return (
            <div
              key={spotlight.id}
              style={{
                position: "absolute",
                left: `${spotlight.x * 100}%`,
                top: `${spotlight.y * 100}%`,
                width: 96,
                height: 96,
                borderRadius: "50%",
                transform: `translate(-50%, -50%) scale(${pulse})`,
                border: "3px solid rgba(255,255,255,0.82)",
                boxShadow: "0 0 0 12px rgba(255,110,45,0.18), 0 0 36px rgba(255,110,45,0.5)",
              }}
            />
          );
        })}
      </div>
      {definition.type !== "raw" ? (
        <Img
          src={frameAssetUrl}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      ) : null}
      {composition.frame.chromeVisible && definition.browserChrome === "address" ? (
        <div
          style={{
            position: "absolute",
            top: composition.frame.width * 0.047,
            left: composition.frame.width * 0.15,
            width: composition.frame.width * 0.7,
            color:
              composition.frame.variant === "dark"
                ? "rgba(255,255,255,0.66)"
                : "rgba(17,24,39,0.62)",
            textAlign: "center",
            font: `${Math.max(10, composition.frame.width * 0.014)}px ${fontFamily.inter}`,
          }}
        >
          {composition.frame.addressText}
        </div>
      ) : null}
    </div>
  );
}

function sourceVideoStyle(placement: ReturnType<typeof sourcePlacement>): CSSProperties {
  return {
    position: "absolute",
    left: placement.videoLeft,
    top: placement.videoTop,
    width: placement.videoWidth,
    height: placement.videoHeight,
    objectFit: "fill",
    maxWidth: "none",
  };
}

function frameMotion(
  composition: CompositionDesign,
  currentFrame: number,
  fps: number,
  sourceViewport: SourceViewport,
  corrections: SourceCropCorrections,
  screen: { width: number; height: number },
) {
  const seconds = currentFrame / fps;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  for (const event of composition.animation.zoomEvents) {
    const attackEnd = event.start + Math.min(0.45, event.duration * 0.22);
    const releaseStart = event.start + Math.max(event.duration - 0.55, event.duration * 0.64);
    if (seconds < event.start || seconds > event.start + event.duration) continue;
    const focus =
      event.focusX !== undefined && event.focusY !== undefined
        ? pagePointToCroppedSource(
            sourceViewport,
            { x: event.focusX, y: event.focusY },
            corrections,
          )
        : null;
    const eventPanX = event.panX + (focus ? (0.5 - focus.x) * screen.width * (event.zoom - 1) : 0);
    const eventPanY = event.panY + (focus ? (0.5 - focus.y) * screen.height * (event.zoom - 1) : 0);
    const weight =
      seconds <= attackEnd
        ? interpolate(seconds, [event.start, attackEnd], [0, 1], {
            easing: Easing.out(Easing.cubic),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        : seconds >= releaseStart
          ? interpolate(seconds, [releaseStart, event.start + event.duration], [1, 0], {
              easing: Easing.inOut(Easing.cubic),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          : 1;
    zoom += (event.zoom - 1) * weight;
    panX += eventPanX * weight;
    panY += eventPanY * weight;
  }
  const floatY = composition.animation.floatingMotion
    ? Math.sin(seconds * Math.PI * 0.46) * 8 * composition.animation.floatingMotion
    : 0;
  return { zoom, panX, panY, floatY };
}

function entranceMotion(composition: CompositionDesign, currentFrame: number, fps: number) {
  if (composition.animation.entrance === "none")
    return { opacity: 1, scale: 1, translateX: 0, translateY: 0 };
  const progress = spring({
    frame: currentFrame,
    fps,
    config: { damping: 18, stiffness: 110, mass: 0.9 },
    durationInFrames: Math.round(fps * 1.1),
  });
  return {
    opacity:
      composition.animation.entrance === "fade"
        ? progress
        : interpolate(progress, [0, 0.22], [0, 1], { extrapolateRight: "clamp" }),
    scale: composition.animation.entrance === "scale" ? interpolate(progress, [0, 1], [0.9, 1]) : 1,
    translateX:
      composition.animation.entrance === "slide-left" ? interpolate(progress, [0, 1], [120, 0]) : 0,
    translateY:
      composition.animation.entrance === "slide-up" ? interpolate(progress, [0, 1], [100, 0]) : 0,
  };
}

function CaptionLayer({
  composition,
  contentFrame,
  fps,
}: {
  composition: CompositionDesign;
  contentFrame: number;
  fps: number;
}) {
  if (!composition.captions.enabled) return null;
  const seconds = contentFrame / fps;
  const item = composition.captions.items.find(
    (caption) => seconds >= caption.start && seconds <= caption.start + caption.duration,
  );
  if (!item) return null;
  const progress = interpolate(seconds, [item.start, item.start + 0.25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const positionStyle: CSSProperties =
    composition.captions.position === "top"
      ? { top: "7%" }
      : composition.captions.position === "lower-third"
        ? { bottom: "18%" }
        : { bottom: "6%" };
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        transform: `translateY(${(1 - progress) * 24}px)`,
        opacity: progress,
        ...positionStyle,
      }}
    >
      <div
        style={{
          maxWidth: composition.captions.maxWidth,
          padding: "0.34em 0.62em",
          borderRadius: "0.42em",
          background: composition.captions.backgroundColor,
          color: composition.captions.color,
          fontFamily: fontFamily[composition.captions.fontFamily],
          fontSize: composition.captions.fontSize,
          fontWeight: 650,
          lineHeight: 1.16,
          textAlign: "center",
          boxShadow: "0 14px 50px rgba(0,0,0,0.22)",
        }}
      >
        {item.text}
      </div>
    </div>
  );
}

function BrandingLayer({ composition }: { composition: CompositionDesign }) {
  const position: CSSProperties = {
    position: "absolute",
    ...(composition.branding.logoPosition.includes("top") ? { top: "4%" } : { bottom: "4%" }),
    ...(composition.branding.logoPosition.includes("left") ? { left: "4%" } : { right: "4%" }),
  };
  return (
    <div style={{ ...position, opacity: composition.branding.opacity }}>
      {composition.branding.logoUrl ? (
        <Img
          src={composition.branding.logoUrl}
          style={{ width: composition.branding.logoWidth, height: "auto", objectFit: "contain" }}
        />
      ) : composition.branding.watermarkText ? (
        <div
          style={{
            fontFamily: fontFamily.inter,
            fontSize: Math.max(18, composition.canvas.width * 0.012),
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "rgba(255,255,255,0.76)",
          }}
        >
          {composition.branding.watermarkText}
        </div>
      ) : null}
    </div>
  );
}

function TitleCard({
  title,
  subtitle,
  durationInFrames,
  mode,
}: {
  title: string;
  subtitle: string;
  durationInFrames: number;
  mode: "intro" | "outro";
}) {
  const frame = useCurrentFrame();
  const fade = interpolate(
    frame,
    [
      0,
      Math.min(12, durationInFrames * 0.18),
      durationInFrames - Math.min(12, durationInFrames * 0.18),
      durationInFrames,
    ],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) },
  );
  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "8%",
        textAlign: "center",
        opacity: fade,
      }}
    >
      <div style={{ transform: `translateY(${(1 - fade) * 24}px)` }}>
        <div
          style={{
            font: `700 clamp(42px, 5.5vw, 104px)/0.98 ${fontFamily.inter}`,
            letterSpacing: "-0.055em",
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: 24,
              font: `500 clamp(20px, 2vw, 38px)/1.3 ${fontFamily.inter}`,
              color: "rgba(255,255,255,0.66)",
            }}
          >
            {subtitle}
          </div>
        ) : null}
        <div
          style={{
            width: mode === "intro" ? 96 : 132,
            height: 5,
            borderRadius: 5,
            margin: "30px auto 0",
            background: "#ff5a1f",
          }}
        />
      </div>
    </AbsoluteFill>
  );
}
