# Pistachio mascot

`pistachio-transparent.png` is the README mascot: a grinning pistachio with legs
and oversized shoes, on a transparent background. `pistachio.png` retains the
original white-background image.

Generated with Pi's built-in image-model API (`models.generateImages`), using
`google/gemini-3.1-flash-image` through OpenRouter. No reference images were used.
The selected output was saved as a 768 × 768 PNG. The image is included with
this MIT-licensed project.

## Transparency edit

The transparent version is a 768 × 768 RGBA PNG with a real alpha channel.
A deterministic pixel edit removed edge-connected near-white background pixels
and white contamination from the antialiased outline. The enclosed white eyes
and shoe soles remain opaque. The character was preserved; no image model or
generation CLI was used for this edit.

Edit instruction: remove only the white background; keep the mascot unchanged.

## Original generation prompt

```text
Use case: illustration-story.
Asset type: a small mascot illustration for an open-source project's README.
Primary request: one silly, cute pistachio with legs.
Subject: an unmistakable pistachio, its natural cream-tan shell split open around a green kernel. Give the green kernel a goofy friendly face, with two eyes and a cheerful lopsided grin. Two comically gangly cartoon legs emerge below the shell, ending in oversized simple shoes; one foot is lifted in an awkward little strut.
Style/medium: playful hand-drawn cartoon, bold slightly imperfect ink outlines, simple flat colors with a little grain. Charming and funny, readable at a small size.
Composition/framing: one full-body character, centered on a square canvas, generous clean margin around all sides, both feet fully visible.
Scene/backdrop: plain white background, no scene.
Constraints: original character; no text, letters, logos, watermark, border, props, additional characters, or photorealism.
```
