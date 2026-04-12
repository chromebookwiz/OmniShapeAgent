# Physics Studio

Use this skill only when the physics window is open.

## Purpose

Physics Studio is the in-window workbench for designing bots, storing named blueprints, deploying bot bodies, training or loading neural controllers, tuning terrain, and running user-vs-LLM duels without bloating the default prompt.

There is no manual piloting mode here. Bots should move only through learned neural-network controllers.

## Window Layout

- Builder: drag components onto the board, reposition them, select two parts, attach them with a hinge, and save named blueprints into the bot library.
- Arena: deploy the current user design, switch between flat ground and hills, inspect live duel health bars, and launch user-vs-LLM fights once neural controllers are ready.
- Torch Lab: train, evaluate, save, load, and clear learned neural controllers for a selected combatant.
- Guide: mirrors this skill for the human user.

## Builder Workflow

1. Load a starter assembly or drag prebuilt components onto the board.
2. Reposition parts until the silhouette makes sense.
3. Select exactly two parts and attach a hinge.
4. Repeat until the body graph is connected.
5. Deploy the current design as a creature body.
6. Train or load a neural controller for it in Torch Lab.
7. Call physics_get_state() to verify combatant, hinge, and controller state.

## Bot Library Workflow

1. Save the current design as a named blueprint when the body plan is worth keeping.
2. Reload stored blueprints to continue editing the layout.
3. Deploy stored blueprints directly when you want a quick arena test.
4. For agent-side reuse, use physics_list_blueprints(), physics_get_blueprint(), physics_save_blueprint(), and physics_deploy_blueprint().

## Prebuilt Components

- Torso Core: stable chassis block for walkers and duelists.
- Brawler Leg: heavy capsule limb for impact locomotion.
- Striker Arm: swinging weapon arm with higher contact damage.
- Shield Plate: wide slab for defense and balance.
- Wheel Drive: torus wheel for rover or spinner builds.
- Sensor Orb: lightweight head or sensor node.
- Blade Fin: offensive blade element.
- Tail Link: flexible balance or whip segment.

## Component Language

The Builder tab accepts a compact DSL for creating templates and full assemblies.

### Create a reusable component

component ShockHammer shape=box size=1.0,0.2,0.35 mass=0.5 color=#ff6b57 role=weapon contactDamage=2.3

### Place a part on the board

part Hammer component=ShockHammer x=250 y=120

### Attach a hinge

hinge Hammer parent=Torso axis=0,0,1 anchorA=0.5,0,0 anchorB=-0.2,0,0

## Duel Workflow

1. Deploy the current bot as the user bot body.
2. Train or load a learned neural controller for the user bot.
3. Set or inspect arena rules with physics_set_rules() or the Arena tab.
4. If an LLM rival is needed, read this skill, inspect physics_get_state(), then spawn the rival and train or load its controller.
5. Verify combatants, health, and controllers with physics_get_state().

## Torch Lab Workflow

1. Select the target combatant.
2. Set controller id, reward function, generations, population size, sim steps, and mutation rate.
3. Train with physics_run_training_loop(combatantId, controllerId, rewardFn, ...).
4. Save with physics_save_controller().
5. Load saved controllers onto a combatant with physics_load_controller().
6. Evaluate with physics_evaluate_controller().

## Recommended Duel Reward Shape

Use reward functions that balance aggression, survival, and distance closure.

Example:

(c) => 2.5 * ((c.ownMaxHealth ?? 100) - (c.opponentHealth ?? 100)) + (c.enemy ? -Math.hypot(c.enemy.pos[0] - c.pos[0], c.enemy.pos[2] - c.pos[2]) : 0) - (c.fallen ? 10 : 0)

## Rules Guidance

- arenaHalfExtent: widen the ring for larger bots.
- groundProfile: use hills when you want locomotion policies to learn terrain adaptation.
- groundAmplitude and groundFrequency: control how steep and frequent hills are.
- impactDamageThreshold: lower it for more chaotic duels.
- contactDamageScale: raise it for weapon-heavy arenas.
- hazardRingRadius and hazardRingDamagePerSecond: use for shrinking-ring pressure.
- allowSleep: keep false during fights.

## Agent Behavior In This Mode

- Prefer the explicit duel and controller tools over raw physics_run_script().
- Never introduce keyboard, gamepad, or manual movement controls for physics bots.
- Treat the user's deployed bot as the stable reference design unless asked to replace it.
- When asked to make an LLM rival, inspect current combatants first, then add only the missing opponent and ensure both sides have learned controllers.
- Verify every major action with physics_get_state().