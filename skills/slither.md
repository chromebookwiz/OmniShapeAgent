# Slither.io Autonomous Bot Strategies

## Core Mechanics

**Objective**: Maximize snake length by consuming food orbs and eliminating rivals.

### Vision Recognition (Pixel Grid)

| Color Code | Meaning | Action |
|------------|---------|--------|
| **3 (Green)** | Food orb | Move toward |
| **D (Pink)** | Your snake head | Center of attention |
| **2 (Red)** | Enemy snake / Danger | Avoid / Circle around |
| **5 (Yellow)** | Boost trail / Dead snake | Can consume for bonus |
| **1 (White)** | UI elements / Score | Ignore |

## Navigation Strategy

### 1. Food Acquisition
- **Direct approach**: Move toward nearest green (3) cells
- **Spiral pattern**: If food is sparse, spiral outward to scan wider area
- **Boost usage**: Hold boost when food is < 5 cells away (saves time)

### 2. Enemy Avoidance
- **Head detection**: Track enemy head positions via color pattern
- **Safe distance**: Maintain 10+ cell buffer from larger snakes
- **Cut-off tactic**: Circle around enemy to trap them against wall

### 3. Combat Tactics
- **When larger**: Circle enemy, wait for them to boost past you
- **When smaller**: Avoid confrontation, use speed to escape
- **Wall trick**: Use map boundaries to force enemies into collisions

## Advanced Patterns

### Spiral Defense
```
When surrounded or low on food:
1. Move in tight spiral pattern
2. Creates safe zone around your body
3. Confuses enemies about your head position
```

### Boost Management
- **Boost only when**: 
  - Food is within 5 cells
  - Escaping imminent collision
  - Chasing a fleeing enemy
- **Recovery**: Always turn off boost after 2-3 seconds to regain speed

## Memory Integration

Store successful patterns:
- `memory_store("food location pattern: spiral scan effective", 0.85, ["strategy", "slither"])
- `memory_store("enemy behavior: larger snakes avoid walls", 0.9, ["slither", "combat"])

## Training Loop

After collecting 100+ gameplay iterations:
```python
train_bot("slither-new-1", episodes=50, config={
    "state_dim": 64,
    "action_dim": 8,
    "lr": 0.001
})
```

## Key Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| **Length** | Maximize | Primary objective |
| **Survival Time** | > 5 min | Indicates good defense |
| **Food Efficiency** | > 80% | Food consumed / food visible |
| **Boost Usage** | < 20% of time | Conserve speed |

## Common Pitfalls

❌ **Don't**: Boost continuously (slows you down)
❌ **Don't**: Chase enemies when smaller (high collision risk)
❌ **Don't**: Ignore walls (use them defensively)

✅ **Do**: Scan for multiple food sources before committing
✅ **Do**: Circle enemies larger than you
✅ **Do**: Store successful strategies in memory

---

**Skill Version**: 1.0  
**Last Updated**: 2026-03-29  
**Author**: OmniShapeAgent
