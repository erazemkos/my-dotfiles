---
description: Create/render a video with Remotion (loads the video skill)
argument-hint: "[what the video should show]"
---
Load the video skill by reading `~/.pi/agent/skills/video/SKILL.md` and follow its
workflow to create and render a Remotion video.

Video request: ${@:-Ask me what the video should show, its dimensions, and length, then build it.}

Steps:
1. Read the skill file in full and follow its setup/authoring/render rules.
2. Scaffold (or reuse) a `video/` Remotion project, write the composition(s) with
   deterministic frame-driven animation.
3. Render a 1-frame still first to catch errors, then render the full MP4 into `video/out/`.
4. Report the output path and verify it with ffprobe.
