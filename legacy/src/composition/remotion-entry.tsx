import { Composition, registerRoot } from "remotion";

import { CompositionScene } from "./CompositionScene";
import { compositionFromTemplate } from "./templates";
import { totalCompositionDuration, type CompositionRenderProps } from "./model";

const defaultComposition = compositionFromTemplate("premium-laptop");
const defaultProps: CompositionRenderProps = {
  composition: defaultComposition,
  rawVideoUrl: "source.mp4",
  rawVideoIsStatic: true,
  rawDurationSeconds: 30,
};

export function WiseDemoRemotionRoot() {
  return (
    <Composition
      id="WiseDemoComposition"
      component={CompositionScene}
      defaultProps={defaultProps}
      durationInFrames={Math.round(
        totalCompositionDuration(defaultComposition, 30) * defaultComposition.canvas.fps,
      )}
      fps={defaultComposition.canvas.fps}
      width={defaultComposition.canvas.width}
      height={defaultComposition.canvas.height}
      calculateMetadata={({ props }) => ({
        width: props.composition.canvas.width,
        height: props.composition.canvas.height,
        fps: props.composition.canvas.fps,
        durationInFrames: Math.round(
          totalCompositionDuration(props.composition, props.rawDurationSeconds) *
            props.composition.canvas.fps,
        ),
      })}
    />
  );
}

registerRoot(WiseDemoRemotionRoot);
