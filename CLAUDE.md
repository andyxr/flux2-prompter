# Boarder

A local web app for creating FLux 2 image generation prompts.

## Rules
During prompt sessions, be extremely concise. Sacrifice grammar for the sake of concision.
The source code is the souce of truth. Markdown and HTML files that are stored in ./notes and/or ./docs folders are for the user's benefit only, not the coding agent's. Note that the code only wins over the plan once code exists
All markdown files and html files must not have hard lengths set on their sentences. Let the browser/reader/markdown renderer decide the length of the sentences.

## Environment

- **OS:** Windows. Use Git Bash or PowerShell.
- **ComfyUI** runs at `http://127.0.0.1:8188`, on an RTX 5090 (32 GB). It already has the FLUX.2 klein and dev models and the MiniMax H3 R2V models.
- **herdr panes:** ComfyUI runs in the herdr pane called `comfy`. If you need to run `npm run dev`, do so in the herdr pane called `run`.
## Working conventions

- **Git:**
  - Branch before committing.
  - The user decides when to merge to `main` and when to push. Ask; don't assume.
  - No Co-Authored-By or other Claude attribution in commits, merges or PRs.
- **Secrets:** never commit `.env` or `.env.local`; both are git-ignored.
- **Docs:** when a decision changes, update the plan and the findings together.
