# FLUX.2 Prompt Builder

A single-file, browser-based tool for assembling well-structured prompts for [Black Forest Labs' FLUX.2](https://bfl.ai) image models. It orders your prompt the way the model weighs it, checks it for common mistakes, and produces a matching API request body.

No build step, no server, no dependencies. Open the HTML file and go.

## Why

FLUX.2 responds best to prompts that put the main subject first, describe each reference image explicitly, and avoid negatives and vague quality words. It is easy to forget those rules mid-prompt. This tool turns them into a form, so the output is right by construction.

## Features

- **Ordered sections** for subject, reference images, style, setting and light, camera and lens, text in the image, exact colours, and finishing details. The generated prompt follows that order.
- **Reference image roles.** Attach up to the model's limit of images (drag and drop, paste, or file picker) and give each one a role: main subject, product, clothing, background, base image to edit, style, material, logo, pose, layout, palette, lighting, or a custom sentence. Role lines are written into the prompt for you, and images can be reordered.
- **Model-aware limits.** Choose FLUX.2 [pro], [max], [flex], [klein] 4B, [klein] 9B, or [dev]. Reference limits, endpoint, and megapixel budgets adjust per model.
- **Live checks.** The prompt is linted as you type: missing lead subject, too many references, references never mentioned, negatives such as "no" or "without", vague terms such as "masterpiece" or "8k", invalid hex codes, and colours not tied to an object.
- **Camera presets.** Quick picks for lenses, apertures, angles, film stocks, and camera bodies, plus style presets such as analog film, 2000s digicam, and studio product.
- **Exact colours and text.** Hex-coded colours attached to specific objects, and text elements with font, placement, and colour.
- **Two output formats.** Copy the prompt as natural language or as JSON.
- **Request settings.** Aspect ratio, output megapixels, seed, guidance, steps, and prompt upsampling. The tool shows the computed width and height and a ready-to-copy request body for the BFL API, or the equivalent order of inputs for ComfyUI.
- **Worked examples.** Two built-in examples show a full multi-reference prompt end to end.
- **Autosave.** Your work is kept in the browser's local storage, so a refresh does not lose it.
- **Light and dark themes**, responsive down to phone width.

## Usage

1. Download or clone this repository.
2. Open `flux2-prompt-builder.html` in a modern browser (Chrome, Edge, Firefox, or Safari).
3. Pick a model and output size, then fill in the sections from top to bottom.
4. Read the **Checks** panel and fix any warnings.
5. Click **Copy prompt**, or copy the request body from **Request settings**.

The page loads three Google Fonts for its own typography. Everything else is inline, so it also works offline with system fonts as fallback.

Reference images stay in your browser. Nothing is uploaded anywhere.

## Prompting rules the tool encodes

- Lead with the main subject and what it is doing. FLUX.2 weights the first words most.
- Say how each reference image is used, by number, in the order it is attached.
- FLUX.2 has no negative prompt. Describe what you want instead of what you do not want.
- Replace vague quality words with specific, concrete detail.
- Attach hex colours to a named object rather than listing them on their own.
- For edits, end with "Change nothing else." when you want everything else preserved.

## Project layout

```
flux2-prompt-builder.html   The whole app: markup, styles, and script
LICENSE                     Apache License 2.0
README.md                   This file
```

## Contributing

Issues and pull requests are welcome. Keep the project to a single self-contained HTML file with no build step.

## License

Apache License 2.0. See [LICENSE](LICENSE).
