---
name: video
description: Create and render programmatic videos with Remotion (React/TypeScript). Use to build show-and-tell clips, explainer/demo videos, animated terminal walkthroughs, title cards, and MP4/GIF renders. Handles scaffolding a Remotion project, writing compositions with animations (spring, interpolate, Sequence), and rendering headlessly via the Remotion CLI.
---

# Video (Remotion)

Build videos as code. Remotion renders React components frame-by-frame into an MP4
using a headless Chromium it downloads on first render. No GUI, no timeline editor.

## When to use

- Show-and-tell / launch clips, feature demos, explainer videos
- Animated terminal walkthroughs, code reveals, data tables, title cards
- Turning screenshots or short screen-captures into a composited, narrated montage

## Setup (once per project)

Scaffold into a `video/` subdirectory (keep it isolated from the host project):

```bash
mkdir -p video && cd video
```

Create `package.json`:

```json
{
  "name": "video",
  "private": true,
  "scripts": {
    "start": "remotion studio",
    "render": "remotion render"
  },
  "dependencies": {
    "@remotion/cli": "4.0.290",
    "remotion": "4.0.290",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@types/react": "19.0.0",
    "typescript": "5.5.4"
  }
}
```

Then `cd video && npm install`. (Pin Remotion versions together; all `remotion` +
`@remotion/*` packages must share one version.)

Minimal file layout:

```
video/
├── package.json
├── tsconfig.json          # "jsx": "react-jsx", target es2018+, strict
├── remotion.config.ts     # Config.setVideoImageFormat('jpeg') etc.
└── src/
    ├── index.ts           # registerRoot(RemotionRoot)
    ├── Root.tsx           # <Composition/> registrations
    └── <Video>.tsx        # the actual composition(s)
```

`src/index.ts`:

```ts
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";
registerRoot(RemotionRoot);
```

`src/Root.tsx` registers each `<Composition id durationInFrames fps width height>`.

## Authoring rules

- Drive ALL motion from `useCurrentFrame()` — never `Date.now()`, `setTimeout`,
  or CSS transitions/animations. Renders must be deterministic per frame.
- Use `interpolate(frame, [inFrames], [outValues], {extrapolateLeft:'clamp', extrapolateRight:'clamp'})`
  for fades/moves, and `spring({frame, fps, config})` for natural motion.
- Segment scenes with `<Sequence from={f} durationInFrames={n}>`; `useCurrentFrame()`
  inside a Sequence is local (starts at 0).
- Layout with `<AbsoluteFill>`; get dims/fps from `useVideoConfig()`.
- Prefer system font stacks (monospace + sans) to avoid network font fetches.
  If Google Fonts are needed, use `@remotion/google-fonts`.
- Load media with `staticFile()` from `video/public/`. Use `<Img>`, `<Video>`,
  `<Audio>`, `<OffthreadVideo>` (preferred for video sources) — never raw tags.

## Render

```bash
# From video/. Entry defaults to src/index.ts.
npx remotion render <CompositionId> out/<name>.mp4

# Common flags
npx remotion render Main out/demo.mp4 --concurrency=4
npx remotion render Main out/demo.mp4 --frames=0-120      # preview a slice
npx remotion render Main out/still.png --frame=60          # single still
npx remotion render Main out/demo.gif --codec=gif          # GIF
npx remotion render Main out/demo.mp4 --scale=0.5          # faster/smaller
```

Preview interactively (opens a local studio, optional): `npx remotion studio`.

## Verify

- List compositions: `npx remotion compositions src/index.ts`
- Render a 1-frame still first to catch layout/compile errors fast, then the full clip.
- Confirm the output: `ls -la out/ && ffprobe out/<name>.mp4` (duration/resolution).

## Tips

- Node is fine on current LTS/latest; if the bundler complains, it still renders.
- Keep durations explicit and consistent (fps × seconds = frames).
- For screen-capture montages, drop clips in `video/public/` and stitch with
  `<Sequence>` + `<OffthreadVideo src={staticFile('clip.mp4')} />`.
- helper: `~/.pi/agent/scripts/render.sh <CompId> <outName>` wraps the render
  command (source lives in `pi/scripts/render.sh` in the dotfiles repo).
