# Line-Based Reasoning Skill

## Overview
Extracts linear structures from images and performs geometric reasoning on them.

## Core Concept: The Null Line
The **null line** is the atomic unit of geometry—a connection between two points. All complex shapes and spatial reasoning emerge from these simple connections.

## Pipeline
1. **Capture**: Screenshot or load image
2. **Edge Detection**: Canny edge detector
3. **Line Extraction**: Probabilistic Hough Transform
4. **Vectorization**: Convert to JSON with `start`, `end`, `length`, `angle`
5. **Reasoning**: Detect parallel, perpendicular, and intersecting relationships

## Tools Used
- `cv2.Canny` — Edge detection
- `cv2.HoughLinesP` — Line segment extraction
- `numpy` — Vector math

## Example Output
```json
{
  "lines": [
    {"id": 0, "start": [50, 50], "end": [550, 50], "length": 500.0, "angle_deg": 0.0},
    {"id": 1, "start": [300, 50], "end": [300, 350], "length": 300.0, "angle_deg": 90.0}
  ]
}
```

## Reasoning Rules
- **Parallel**: Angle difference < 5 degrees
- **Perpendicular**: Angle difference ~ 90 degrees (85-95)
- **Intersection**: Lines share a common endpoint or cross (requires extension)

## Future Enhancements
- Circle/arc detection
- Shape recognition (triangles, rectangles)
- Object-level reasoning from line graphs
