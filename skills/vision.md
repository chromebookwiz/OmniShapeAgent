# Vision Skill

## Models

- **Ollama**: `llava`, `llava:13b`, `llava:34b`, `bakllava`, `moondream`
  Install: `run_terminal_command("ollama pull llava")`

- **vLLM**: Any OpenAI-compatible multimodal model (LLaVA, InternVL, Qwen-VL, etc.)
  Configure: `VISION_MODEL=vllm:Qwen/Qwen2-VL-72B@http://host:port/v1/chat/completions`

## Quick Usage

```
# Analyze a saved file
analyze_image("screenshot.png", "What is shown in this image?")

# Current screen
describe_screen()
describe_screen("Are there any error messages?")

# Find an element
find_on_screen("blue button in the top right")

# OCR
ocr_image("scan.png")
```

## Model Selection

```
# Explicit model override
analyze_image("img.png", "describe this", "ollama:llava")
analyze_image("img.png", "describe this", "vllm:model@http://host:8080/v1/chat/completions")

# Default: uses VISION_MODEL env var, falls back to 'llava'
set_env_key("VISION_MODEL", "llava:13b")
```

## ARC-AGI Grid Reading Pattern

```
1. screenshot() → capture grid
2. analyze_image(path, "This is an ARC-AGI puzzle grid. Describe every cell by (row, col, color). Colors: 0=black, 1=blue, 2=red, 3=green, 4=yellow, 5=grey, 6=magenta, 7=orange, 8=azure, 9=maroon. List all cells.")
3. Parse the description to build a 2D array
4. Identify the transformation pattern
5. Apply pattern to test input
```

## Prompting Tips

- Be explicit: "List every object and its (x, y) position on screen"
- For UI testing: "What is the current state of the form? List all visible fields and their values"
- For debugging: "Is there an error message or warning visible? Quote it exactly"
- For ARC grids: "Read this grid left-to-right, top-to-bottom, giving each cell's color number"
