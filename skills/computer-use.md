# Computer Use Skill

## Overview

ShapeAgent can control the host computer: take screenshots, move the mouse, type on the keyboard, and open URLs. Uses `pyautogui` under the hood (auto-installed on first use via `.agent_venv`).

## Screenshot + Vision Pattern

```
screenshot()                          # saves to OS temp, returns path
analyze_image("/tmp/screenshot.png", "What do you see?")
describe_screen("Is the browser open?")   # screenshot + analyze in one call
find_on_screen("Submit button")           # locate a UI element
ocr_image("/tmp/screenshot.png")          # extract all text
```

## Mouse Control

```
get_screen_size()               # → "Screen size: 1920x1080"
get_mouse_pos()                 # → "Mouse position: (950, 540)"
mouse_move(x, y)                # move without clicking
mouse_click(x, y)               # left click
mouse_click(x, y, "right")      # right click
mouse_double_click(x, y)        # double click
mouse_drag(x1, y1, x2, y2)     # drag
mouse_scroll(x, y, -3)          # scroll down 3 clicks
```

## Keyboard

```
keyboard_type("Hello world")        # types text character by character
keyboard_press("enter")             # single key: enter/tab/escape/backspace/space/etc.
keyboard_hotkey("ctrl", "c")        # copy
keyboard_hotkey("ctrl", "v")        # paste
keyboard_hotkey("alt", "f4")        # close window
keyboard_hotkey("win", "d")         # show desktop
```

## Automation Loop Pattern

```
1. screenshot() → get current screen state
2. describe_screen("What app is focused?") → understand context
3. find_on_screen("Search box") → locate target
4. mouse_click(x, y) → click it
5. keyboard_type("search query")
6. keyboard_press("enter")
7. wait_ms(2000) → wait for page to load
8. screenshot() → verify result
```

## Testing Own Code

```
1. run_terminal_command("npm run dev &") — start dev server
2. wait_ms(3000)
3. open_url("http://localhost:3000")
4. wait_ms(1500)
5. describe_screen("Is the ShapeAgent UI loaded? Describe what you see.")
6. find_on_screen("Send button")
7. mouse_click(x, y)
8. keyboard_type("test message")
9. keyboard_press("enter")
10. wait_ms(1000)
11. screenshot() → verify response appeared
```

## Common Keys (pyautogui names)

| Action | Key string |
|--------|-----------|
| Enter | `enter` |
| Tab | `tab` |
| Escape | `escape` |
| Backspace | `backspace` |
| Delete | `delete` |
| Arrow keys | `up`, `down`, `left`, `right` |
| Page Up/Down | `pageup`, `pagedown` |
| Home/End | `home`, `end` |
| F1–F12 | `f1`...`f12` |
| Print Screen | `printscreen` |
| Ctrl/Alt/Shift | `ctrl`, `alt`, `shift` |
| Win/Cmd | `win`, `command` |
