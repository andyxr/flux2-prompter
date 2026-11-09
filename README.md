# FLUX.2 Prompt Builder

A single-file, browser-based tool for assembling well-structured prompts for [Black Forest Labs' FLUX.2](https://bfl.ai) image models. It orders your prompt the way the model weighs it, checks it for common mistakes, and produces a matching API request body.

Prompt building needs nothing: open the HTML file and go. To generate images locally with ComfyUI, run it through the small Vite dev server (see below).

You can launch it [here](./flux2-prompt-builder.html).

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
- **Request settings.** Aspect ratio, output megapixels, guidance, steps, and prompt upsampling. The tool shows the computed width and height and a ready-to-copy request body for the BFL API, or the equivalent order of inputs for ComfyUI.
- **Worked examples.** Two built-in examples show a full multi-reference prompt end to end.
- **Autosave.** Your work is kept in the browser's local storage, so a refresh does not lose it.
- **Generate locally with ComfyUI.** Run the prompt on FLUX.2 [klein] 9B or [dev] (optionally with the Turbo LoRA) at the chosen size, 1 to 5 images per click (each image in a batch gets its own random seed, and each shows in the gallery as soon as it is ready). The seed lives in the Generate panel: leave it blank for a new random seed each run, roll a fixed one with 🎲, or reuse the seed of any earlier image from the gallery or viewer. The same seed goes into the BFL request body. Attached reference images are uploaded and wired in order, so "image 1" means the first one. Progress is shown live and jobs can be cancelled. A status bar along the bottom shows whether ComfyUI is connected, its GPU and version, and whether the klein, dev and Turbo LoRA model files are present.
- **Generations gallery.** Results are kept in the browser (IndexedDB). Open any image in a viewer, step through with the arrow keys, go full screen, download, or delete it.
- **Light and dark themes**, responsive down to phone width.

## Usage

1. Download or clone this repository.
2. Open `flux2-prompt-builder.html` in a modern browser (Chrome, Edge, Firefox, or Safari).
3. Pick a model and output size, then fill in the sections from top to bottom.
4. Read the **Checks** panel and fix any warnings.
5. Click **Copy prompt**, or copy the request body from **Request settings**.

The page loads three Google Fonts for its own typography. Everything else is inline, so it also works offline with system fonts as fallback.

Reference images stay in your browser unless you click Generate, which uploads them to your own ComfyUI's input folder.

## Generating with ComfyUI

1. Install Node 24 or later, then run `npm install`.
2. Make sure ComfyUI is running and has the FLUX.2 [klein] 9B and/or [dev] model files. The Generate panel lists any that are missing.
3. Run `npm run dev`, which serves the app at http://127.0.0.1:5174/flux2-prompt-builder.html.
4. Build a prompt, pick a model under **Generate with**, and click **Generate**.

ComfyUI is expected at `http://127.0.0.1:8188`. To use a different address, copy `.env.example` to `.env.local`, set `COMFY_URL`, and restart `npm run dev`. The dev server proxies `/comfy` to that address, so the browser never talks to ComfyUI directly.

Generated images are stored in this browser. ComfyUI also keeps its own copies under `output/flux2-prompter/`; deleting an image in the app doesn't remove those.

## Prompting rules the tool encodes

- Lead with the main subject and what it is doing. FLUX.2 weights the first words most.
- Say how each reference image is used, by number, in the order it is attached.
- FLUX.2 has no negative prompt. Describe what you want instead of what you do not want.
- Replace vague quality words with specific, concrete detail.
- Attach hex colours to a named object rather than listing them on their own.
- For edits, end with "Change nothing else." when you want everything else preserved.

## Project layout

```
flux2-prompt-builder.html   The prompt builder: markup, styles, and script
src/generate.js             Generate panel, gallery and viewer
src/comfy/                  ComfyUI client, job runner, workflow patching, health check
src/workflows/              FLUX.2 klein and dev API-format workflows
src/gallery/store.js        IndexedDB store for generated images
vite.config.js              Dev server and the /comfy proxy (COMFY_URL)
LICENSE                     Apache License 2.0
README.md                   This file
```

Run the tests with `npm test`.

## Contributing

Issues and pull requests are welcome. Keep prompt building working from the plain HTML file; only generation needs the dev server.

## License

Apache License 2.0. See [LICENSE](LICENSE).
