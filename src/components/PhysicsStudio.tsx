"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PhysicsCmd } from '@/lib/physics-types';

import PhysicsSimulator from './PhysicsSimulator';
import { useWindowManager } from './WindowManager';

type StudioTab = 'builder' | 'arena' | 'torch' | 'guide';

type ComponentTemplate = {
  id: string;
  name: string;
  description: string;
  shape: NonNullable<PhysicsCmd['shape']>;
  size?: [number, number, number];
  radius?: number;
  mass: number;
  color: string;
  role?: string;
  contactDamage?: number;
};

type PlacedPart = {
  id: string;
  templateId: string;
  label: string;
  x: number;
  y: number;
};

type HingeLink = {
  id: string;
  parentId: string;
  childId: string;
  axis: [number, number, number];
  anchorA: [number, number, number];
  anchorB: [number, number, number];
};

type SavedControllerEntry = {
  id: string;
  name: string;
  performanceScore?: number;
  iterations?: number;
  metadata?: Record<string, unknown>;
};

type SavedBlueprintEntry = {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  partCount: number;
  hasBodyPlan: boolean;
  hasLayout: boolean;
  settings?: Record<string, unknown>;
};

const BOARD_WIDTH = 360;
const BOARD_HEIGHT = 360;
const STUDIO_STORAGE_KEY = 'physics-studio-layout-v1';

const PREBUILT_COMPONENTS: ComponentTemplate[] = [
  { id: 'torso-core', name: 'Torso Core', description: 'Stable chassis block for walkers and duelists.', shape: 'box', size: [1.4, 0.5, 0.75], mass: 2.2, color: '#8ec5ff', role: 'core', contactDamage: 0.7 },
  { id: 'brawler-leg', name: 'Brawler Leg', description: 'Heavy capsule limb tuned for close-range bots.', shape: 'capsule', size: [0.36, 1.1, 0.36], radius: 0.16, mass: 0.95, color: '#f3722c', role: 'leg', contactDamage: 0.9 },
  { id: 'striker-arm', name: 'Striker Arm', description: 'Fast swinging arm for impact damage.', shape: 'capsule', size: [0.24, 0.95, 0.24], radius: 0.12, mass: 0.6, color: '#f94144', role: 'weapon', contactDamage: 1.6 },
  { id: 'shield-plate', name: 'Shield Plate', description: 'Wide defensive slab to absorb hits.', shape: 'box', size: [0.9, 0.18, 0.75], mass: 0.9, color: '#577590', role: 'shield', contactDamage: 0.4 },
  { id: 'wheel-drive', name: 'Wheel Drive', description: 'Torus wheel for rovers and spinning attacks.', shape: 'torus', radius: 0.32, mass: 0.6, color: '#43aa8b', role: 'wheel', contactDamage: 1.2 },
  { id: 'sensor-orb', name: 'Sensor Orb', description: 'Lightweight sphere for heads, sensors, and scouts.', shape: 'sphere', radius: 0.28, mass: 0.28, color: '#ffd166', role: 'sensor', contactDamage: 0.25 },
  { id: 'blade-fin', name: 'Blade Fin', description: 'Sharp box fin for slash-focused bots.', shape: 'box', size: [1.15, 0.16, 0.3], mass: 0.45, color: '#ef476f', role: 'blade', contactDamage: 2.1 },
  { id: 'tail-link', name: 'Tail Link', description: 'Flexible rear link for balance and whip attacks.', shape: 'capsule', size: [0.2, 0.72, 0.2], radius: 0.1, mass: 0.35, color: '#06d6a0', role: 'tail', contactDamage: 0.75 },
];

const STARTER_ASSEMBLIES: Record<string, { parts: PlacedPart[]; hinges: HingeLink[] }> = {
  bruiser: {
    parts: [
      { id: 'torso', templateId: 'torso-core', label: 'Torso', x: 164, y: 122 },
      { id: 'left-leg', templateId: 'brawler-leg', label: 'Left Leg', x: 122, y: 216 },
      { id: 'right-leg', templateId: 'brawler-leg', label: 'Right Leg', x: 214, y: 216 },
      { id: 'arm', templateId: 'striker-arm', label: 'Hammer Arm', x: 272, y: 142 },
      { id: 'sensor', templateId: 'sensor-orb', label: 'Head', x: 176, y: 58 },
    ],
    hinges: [
      { id: 'h-left-leg', parentId: 'torso', childId: 'left-leg', axis: [0, 0, 1], anchorA: [-0.28, -0.22, 0], anchorB: [0, 0.44, 0] },
      { id: 'h-right-leg', parentId: 'torso', childId: 'right-leg', axis: [0, 0, 1], anchorA: [0.28, -0.22, 0], anchorB: [0, 0.44, 0] },
      { id: 'h-arm', parentId: 'torso', childId: 'arm', axis: [0, 0, 1], anchorA: [0.55, -0.02, 0], anchorB: [-0.08, 0.3, 0] },
      { id: 'h-head', parentId: 'torso', childId: 'sensor', axis: [0, 0, 1], anchorA: [0, 0.28, 0], anchorB: [0, -0.08, 0] },
    ],
  },
  rover: {
    parts: [
      { id: 'chassis', templateId: 'torso-core', label: 'Chassis', x: 164, y: 138 },
      { id: 'front-wheel', templateId: 'wheel-drive', label: 'Front Wheel', x: 120, y: 236 },
      { id: 'rear-wheel', templateId: 'wheel-drive', label: 'Rear Wheel', x: 218, y: 236 },
      { id: 'blade', templateId: 'blade-fin', label: 'Ram Blade', x: 162, y: 54 },
    ],
    hinges: [
      { id: 'h-front', parentId: 'chassis', childId: 'front-wheel', axis: [0, 0, 1], anchorA: [-0.36, -0.18, 0], anchorB: [0, 0, 0] },
      { id: 'h-rear', parentId: 'chassis', childId: 'rear-wheel', axis: [0, 0, 1], anchorA: [0.36, -0.18, 0], anchorB: [0, 0, 0] },
      { id: 'h-blade', parentId: 'chassis', childId: 'blade', axis: [0, 0, 1], anchorA: [0, 0.22, 0], anchorB: [0, -0.08, 0] },
    ],
  },
  scorpion: {
    parts: [
      { id: 'body', templateId: 'torso-core', label: 'Body', x: 158, y: 146 },
      { id: 'left-pincer', templateId: 'striker-arm', label: 'Left Pincer', x: 86, y: 138 },
      { id: 'right-pincer', templateId: 'striker-arm', label: 'Right Pincer', x: 274, y: 138 },
      { id: 'tail-1', templateId: 'tail-link', label: 'Tail 1', x: 158, y: 72 },
      { id: 'tail-2', templateId: 'blade-fin', label: 'Stinger', x: 202, y: 24 },
      { id: 'sensor', templateId: 'sensor-orb', label: 'Sensor', x: 158, y: 214 },
    ],
    hinges: [
      { id: 'h-pincer-l', parentId: 'body', childId: 'left-pincer', axis: [0, 0, 1], anchorA: [-0.58, 0, 0], anchorB: [0.12, 0.14, 0] },
      { id: 'h-pincer-r', parentId: 'body', childId: 'right-pincer', axis: [0, 0, 1], anchorA: [0.58, 0, 0], anchorB: [-0.12, 0.14, 0] },
      { id: 'h-tail-1', parentId: 'body', childId: 'tail-1', axis: [0, 0, 1], anchorA: [0, -0.24, 0], anchorB: [0, 0.24, 0] },
      { id: 'h-tail-2', parentId: 'tail-1', childId: 'tail-2', axis: [0, 0, 1], anchorA: [0, -0.22, 0], anchorB: [-0.18, 0.04, 0] },
      { id: 'h-sensor', parentId: 'body', childId: 'sensor', axis: [0, 0, 1], anchorA: [0, 0.2, 0], anchorB: [0, -0.08, 0] },
    ],
  },
};

function cmdId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseVec(value: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!value) return fallback;
  const parts = value.split(',').map((entry) => Number(entry.trim()));
  return parts.length === 3 && parts.every((entry) => Number.isFinite(entry))
    ? [parts[0], parts[1], parts[2]]
    : fallback;
}

function parseSize(value: string | undefined, fallback?: [number, number, number]) {
  if (!value) return fallback;
  const parsed = parseVec(value, fallback ?? [0.6, 0.6, 0.6]);
  return parsed;
}

function parseKvPairs(line: string) {
  const matches = line.match(/([a-zA-Z_][a-zA-Z0-9_-]*)=([^\s]+)/g) ?? [];
  const out: Record<string, string> = {};
  for (const entry of matches) {
    const idx = entry.indexOf('=');
    out[entry.slice(0, idx)] = entry.slice(idx + 1);
  }
  return out;
}

function inferHalfExtents(template: ComponentTemplate): [number, number, number] {
  if (template.size) return [template.size[0] * 0.5, template.size[1] * 0.5, template.size[2] * 0.5];
  const r = template.radius ?? 0.3;
  return [r, r, r];
}

export default function PhysicsStudio({
  windowId,
  commands,
  width,
  height,
}: {
  windowId: string;
  commands: PhysicsCmd[];
  width: number;
  height: number;
}) {
  const windowManager = useWindowManager();
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<StudioTab>('builder');
  const [customTemplates, setCustomTemplates] = useState<ComponentTemplate[]>([]);
  const [parts, setParts] = useState<PlacedPart[]>([]);
  const [hinges, setHinges] = useState<HingeLink[]>([]);
  const [selectedParts, setSelectedParts] = useState<string[]>([]);
  const [draggingPartId, setDraggingPartId] = useState<string | null>(null);
  const [dsl, setDsl] = useState('');
  const [builderName, setBuilderName] = useState('user-bot');
  const [deployTeam, setDeployTeam] = useState('user');
  const [deployHealth, setDeployHealth] = useState(130);
  const [deployDamage, setDeployDamage] = useState(1.2);
  const [deployAggression, setDeployAggression] = useState(1.1);
  const [arenaState, setArenaState] = useState<any>(null);
  const [savedControllers, setSavedControllers] = useState<SavedControllerEntry[]>([]);
  const [savedBlueprints, setSavedBlueprints] = useState<SavedBlueprintEntry[]>([]);
  const [rewardFn, setRewardFn] = useState('(c) => 2 * ((c.ownMaxHealth ?? 100) - (c.opponentHealth ?? 100)) + (c.enemy ? -Math.hypot(c.enemy.pos[0]-c.pos[0], c.enemy.pos[2]-c.pos[2]) : 0) - (c.fallen ? 10 : 0)');
  const [generations, setGenerations] = useState(18);
  const [populationSize, setPopulationSize] = useState(14);
  const [simSteps, setSimSteps] = useState(220);
  const [mutationRate, setMutationRate] = useState(0.15);
  const [controllerId, setControllerId] = useState('user-bot-v1');
  const [selectedCombatant, setSelectedCombatant] = useState('');
  const [selectedController, setSelectedController] = useState('');
  const [groundProfile, setGroundProfile] = useState<'flat' | 'hills'>('flat');
  const [groundAmplitude, setGroundAmplitude] = useState(0);
  const [groundFrequency, setGroundFrequency] = useState(0.18);
  const [guideText, setGuideText] = useState('Loading physics studio guide...');
  const [status, setStatus] = useState('Ready: build a body, train a neural controller, then duel.');

  const templates = useMemo(() => [...PREBUILT_COMPONENTS, ...customTemplates], [customTemplates]);
  const templateMap = useMemo(() => new Map(templates.map((template) => [template.id, template])), [templates]);
  const selectedCombatantState = selectedCombatant ? arenaState?.combatants?.[selectedCombatant] : null;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STUDIO_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { customTemplates?: ComponentTemplate[]; parts?: PlacedPart[]; hinges?: HingeLink[]; builderName?: string };
      if (Array.isArray(parsed.customTemplates)) setCustomTemplates(parsed.customTemplates);
      if (Array.isArray(parsed.parts)) setParts(parsed.parts);
      if (Array.isArray(parsed.hinges)) setHinges(parsed.hinges);
      if (typeof parsed.builderName === 'string') setBuilderName(parsed.builderName);
    } catch {
      // ignore persisted layout errors
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify({ customTemplates, parts, hinges, builderName }));
    } catch {
      // ignore persistence failures
    }
  }, [builderName, customTemplates, hinges, parts]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/file?path=skills/physics-studio.md')
      .then((response) => response.text())
      .then((text) => {
        if (!cancelled) setGuideText(text);
      })
      .catch(() => {
        if (!cancelled) setGuideText('Physics Studio guide unavailable.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch('/api/physics-state')
        .then((response) => response.json())
        .then((data) => {
          if (!cancelled) setArenaState(data?.state ?? data);
        })
        .catch(() => {});
      fetch('/api/physics-controller')
        .then((response) => response.json())
        .then((data) => {
          if (!cancelled) setSavedControllers(Array.isArray(data?.controllers) ? data.controllers : []);
        })
        .catch(() => {});
      fetch('/api/physics-blueprint')
        .then((response) => response.json())
        .then((data) => {
          if (!cancelled) setSavedBlueprints(Array.isArray(data?.blueprints) ? data.blueprints : []);
        })
        .catch(() => {});
    };
    refresh();
    const id = window.setInterval(refresh, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const combatants = arenaState?.combatants ? Object.keys(arenaState.combatants) : [];
    if (!selectedCombatant && combatants.length > 0) setSelectedCombatant(combatants[0]);
  }, [arenaState, selectedCombatant]);

  useEffect(() => {
    const rules = arenaState?.rules;
    if (!rules) return;
    setGroundProfile(rules.groundProfile === 'hills' ? 'hills' : 'flat');
    setGroundAmplitude(typeof rules.groundAmplitude === 'number' ? rules.groundAmplitude : 0);
    setGroundFrequency(typeof rules.groundFrequency === 'number' ? rules.groundFrequency : 0.18);
  }, [arenaState?.rules]);

  const queuePhysicsCmd = useCallback((type: PhysicsCmd['type'], payload: Partial<PhysicsCmd> = {}) => {
    windowManager.dispatch({
      op: 'physics_cmd',
      id: windowId,
      cmd: {
        id: cmdId(type),
        type,
        ...payload,
      },
    });
  }, [windowId, windowManager]);

  const refreshArenaState = useCallback(() => {
    queuePhysicsCmd('get_state');
    setStatus('Requested fresh arena state.');
  }, [queuePhysicsCmd]);

  const refreshBlueprints = useCallback(() => {
    fetch('/api/physics-blueprint')
      .then((response) => response.json())
      .then((data) => setSavedBlueprints(Array.isArray(data?.blueprints) ? data.blueprints : []))
      .catch(() => {});
  }, []);

  const addPartFromTemplate = useCallback((templateId: string, x = BOARD_WIDTH / 2, y = BOARD_HEIGHT / 2) => {
    const template = templateMap.get(templateId);
    if (!template) return;
    const nextPart: PlacedPart = {
      id: cmdId('part'),
      templateId,
      label: template.name,
      x: clamp(x, 24, BOARD_WIDTH - 24),
      y: clamp(y, 24, BOARD_HEIGHT - 24),
    };
    setParts((prev) => [...prev, nextPart]);
    setSelectedParts([nextPart.id]);
    setStatus(`Added ${template.name}.`);
  }, [templateMap]);

  const onDropTemplate = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const templateId = event.dataTransfer.getData('text/plain');
    if (!templateId || !boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    addPartFromTemplate(templateId, event.clientX - rect.left, event.clientY - rect.top);
  }, [addPartFromTemplate]);

  const beginPartDrag = useCallback((partId: string, startX: number, startY: number) => {
    setDraggingPartId(partId);
    const part = parts.find((entry) => entry.id === partId);
    const boardRect = boardRef.current?.getBoundingClientRect();
    if (!part || !boardRect) return;
    const offsetX = startX - boardRect.left - part.x;
    const offsetY = startY - boardRect.top - part.y;
    const onMove = (event: PointerEvent) => {
      setParts((prev) => prev.map((entry) => entry.id === partId
        ? {
            ...entry,
            x: clamp(event.clientX - boardRect.left - offsetX, 24, BOARD_WIDTH - 24),
            y: clamp(event.clientY - boardRect.top - offsetY, 24, BOARD_HEIGHT - 24),
          }
        : entry));
    };
    const onUp = () => {
      setDraggingPartId(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [parts]);

  const removeSelected = useCallback(() => {
    if (selectedParts.length === 0) return;
    setParts((prev) => prev.filter((part) => !selectedParts.includes(part.id)));
    setHinges((prev) => prev.filter((hinge) => !selectedParts.includes(hinge.parentId) && !selectedParts.includes(hinge.childId)));
    setSelectedParts([]);
    setStatus('Removed selected components.');
  }, [selectedParts]);

  const clearBuilder = useCallback(() => {
    setParts([]);
    setHinges([]);
    setSelectedParts([]);
    setStatus('Cleared builder layout.');
  }, []);

  const attachSelectedWithHinge = useCallback(() => {
    if (selectedParts.length !== 2) {
      setStatus('Select exactly two parts to attach a hinge.');
      return;
    }
    const [parentId, childId] = selectedParts;
    const parent = parts.find((entry) => entry.id === parentId);
    const child = parts.find((entry) => entry.id === childId);
    if (!parent || !child) return;
    const dx = (child.x - parent.x) / 70;
    const dy = (child.y - parent.y) / 70;
    setHinges((prev) => [...prev, {
      id: cmdId('hinge'),
      parentId,
      childId,
      axis: [0, 0, 1],
      anchorA: [clamp(dx, -0.5, 0.5), clamp(dy, -0.5, 0.5), 0],
      anchorB: [clamp(-dx, -0.5, 0.5), clamp(-dy, -0.5, 0.5), 0],
    }]);
    setStatus(`Attached ${child.label} to ${parent.label}.`);
  }, [parts, selectedParts]);

  const loadAssembly = useCallback((assemblyId: string) => {
    const assembly = STARTER_ASSEMBLIES[assemblyId];
    if (!assembly) return;
    const aliasMap = new Map<string, string>();
    const nextParts = assembly.parts.map((part) => {
      const nextId = cmdId(part.id);
      aliasMap.set(part.id, nextId);
      return { ...part, id: nextId };
    });
    const nextHinges = assembly.hinges.map((hinge) => ({
      ...hinge,
      id: cmdId(hinge.id),
      parentId: aliasMap.get(hinge.parentId) ?? hinge.parentId,
      childId: aliasMap.get(hinge.childId) ?? hinge.childId,
    }));
    setParts(nextParts);
    setHinges(nextHinges);
    setSelectedParts([]);
    setStatus(`Loaded ${assemblyId} starter assembly.`);
  }, []);

  const buildBodyPlan = useCallback(() => {
    const partMap = new Map(parts.map((part) => [part.id, part]));
    return parts.map((part) => {
      const template = templateMap.get(part.templateId)!;
      const position: [number, number, number] = [
        Number((((part.x / BOARD_WIDTH) - 0.5) * 8).toFixed(3)),
        Number(((BOARD_HEIGHT - part.y) / BOARD_HEIGHT * 4.4 + 0.8).toFixed(3)),
        0,
      ];
      return {
        id: part.id,
        shape: template.shape,
        position,
        size: template.size,
        radius: template.radius,
        color: template.color,
        mass: template.mass,
        role: template.role,
        contactDamage: template.contactDamage,
        hinges: hinges.filter((hinge) => hinge.childId === part.id).map((hinge) => {
          const parent = partMap.get(hinge.parentId)!;
          const child = partMap.get(hinge.childId)!;
          const parentTemplate = templateMap.get(parent.templateId)!;
          const childTemplate = templateMap.get(child.templateId)!;
          const parentHalf = inferHalfExtents(parentTemplate);
          const childHalf = inferHalfExtents(childTemplate);
          const dx = ((child.x - parent.x) / BOARD_WIDTH) * 8;
          const dy = ((parent.y - child.y) / BOARD_HEIGHT) * 4.4;
          return {
            parentId: hinge.parentId,
            axis: hinge.axis,
            anchorA: [clamp(dx * 0.5, -parentHalf[0], parentHalf[0]), clamp(dy * 0.5, -parentHalf[1], parentHalf[1]), 0] as [number, number, number],
            anchorB: [clamp(-dx * 0.5, -childHalf[0], childHalf[0]), clamp(-dy * 0.5, -childHalf[1], childHalf[1]), 0] as [number, number, number],
          };
        }),
      };
    });
  }, [hinges, parts, templateMap]);

  const deployCurrentDesign = useCallback((team = deployTeam, creatureId = builderName) => {
    if (parts.length === 0) {
      setStatus('Add components before deploying a bot.');
      return;
    }
    queuePhysicsCmd('spawn_creature', {
      creatureId,
      bodyPlan: buildBodyPlan(),
      team,
      health: deployHealth,
      contactDamage: deployDamage,
      aggression: deployAggression,
    });
    queuePhysicsCmd('get_state');
    setSelectedCombatant(creatureId);
    setControllerId(`${creatureId}-v1`);
    setStatus(`Deployed ${creatureId} for team ${team}.`);
  }, [buildBodyPlan, builderName, deployAggression, deployDamage, deployHealth, deployTeam, parts.length, queuePhysicsCmd]);

  const saveBlueprint = useCallback(async () => {
    if (parts.length === 0) {
      setStatus('Add components before saving a bot blueprint.');
      return;
    }
    const bodyPlan = buildBodyPlan();
    const response = await fetch('/api/physics-blueprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: builderName,
        name: builderName,
        templates: customTemplates,
        parts,
        hinges,
        bodyPlan,
        settings: {
          team: deployTeam,
          health: deployHealth,
          contactDamage: deployDamage,
          aggression: deployAggression,
          rewardFn,
          generations,
          populationSize,
          simSteps,
          mutationRate,
          controllerId,
        },
      }),
    });
    if (!response.ok) {
      setStatus('Failed to save bot blueprint.');
      return;
    }
    refreshBlueprints();
    setStatus(`Saved ${builderName} to the bot library.`);
  }, [buildBodyPlan, builderName, controllerId, customTemplates, deployAggression, deployDamage, deployHealth, deployTeam, generations, hinges, mutationRate, parts, populationSize, refreshBlueprints, rewardFn, simSteps]);

  const loadBlueprintIntoStudio = useCallback(async (blueprintId: string) => {
    const response = await fetch(`/api/physics-blueprint?id=${encodeURIComponent(blueprintId)}`);
    if (!response.ok) {
      setStatus(`Failed to load ${blueprintId}.`);
      return null;
    }
    const data = await response.json();
    const blueprint = data?.blueprint;
    if (!blueprint) {
      setStatus(`Blueprint ${blueprintId} is unavailable.`);
      return null;
    }
    setBuilderName(blueprint.name ?? blueprint.id ?? blueprintId);
    setCustomTemplates(Array.isArray(blueprint.templates) ? blueprint.templates : []);
    setParts(Array.isArray(blueprint.parts) ? blueprint.parts : []);
    setHinges(Array.isArray(blueprint.hinges) ? blueprint.hinges : []);
    const settings = blueprint.settings ?? {};
    if (typeof settings.team === 'string') setDeployTeam(settings.team);
    if (typeof settings.health === 'number') setDeployHealth(settings.health);
    if (typeof settings.contactDamage === 'number') setDeployDamage(settings.contactDamage);
    if (typeof settings.aggression === 'number') setDeployAggression(settings.aggression);
    if (typeof settings.rewardFn === 'string') setRewardFn(settings.rewardFn);
    if (typeof settings.generations === 'number') setGenerations(settings.generations);
    if (typeof settings.populationSize === 'number') setPopulationSize(settings.populationSize);
    if (typeof settings.simSteps === 'number') setSimSteps(settings.simSteps);
    if (typeof settings.mutationRate === 'number') setMutationRate(settings.mutationRate);
    if (typeof settings.controllerId === 'string') setControllerId(settings.controllerId);
    setStatus(`Loaded ${blueprint.name ?? blueprintId} from the bot library.`);
    return blueprint;
  }, []);

  const deployBlueprint = useCallback(async (blueprintId: string) => {
    const blueprint = await loadBlueprintIntoStudio(blueprintId);
    if (!blueprint) return;
    if (Array.isArray(blueprint.bodyPlan) && blueprint.bodyPlan.length > 0) {
      const settings = blueprint.settings ?? {};
      const creatureId = String(blueprint.name ?? blueprint.id ?? blueprintId);
      queuePhysicsCmd('spawn_creature', {
        creatureId,
        bodyPlan: blueprint.bodyPlan,
        team: typeof settings.team === 'string' ? settings.team : deployTeam,
        health: typeof settings.health === 'number' ? settings.health : deployHealth,
        contactDamage: typeof settings.contactDamage === 'number' ? settings.contactDamage : deployDamage,
        aggression: typeof settings.aggression === 'number' ? settings.aggression : deployAggression,
      });
      queuePhysicsCmd('get_state');
      setSelectedCombatant(creatureId);
      setStatus(`Deployed stored bot ${creatureId}.`);
    }
  }, [deployAggression, deployDamage, deployHealth, deployTeam, loadBlueprintIntoStudio, queuePhysicsCmd]);

  const deleteBlueprint = useCallback(async (blueprintId: string) => {
    await fetch('/api/physics-blueprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: blueprintId }),
    });
    refreshBlueprints();
    setStatus(`Removed ${blueprintId} from the bot library.`);
  }, [refreshBlueprints]);

  const applyGroundProfile = useCallback(() => {
    queuePhysicsCmd('set_rules', {
      groundProfile,
      groundAmplitude,
      groundFrequency,
    });
    queuePhysicsCmd('get_state');
    setStatus(groundProfile === 'hills'
      ? `Applied rolling hills (amp ${groundAmplitude.toFixed(2)}, freq ${groundFrequency.toFixed(2)}).`
      : 'Applied flat ground.');
  }, [groundAmplitude, groundFrequency, groundProfile, queuePhysicsCmd]);

  const applyDsl = useCallback(() => {
    const nextTemplates = [...customTemplates];
    const nextParts = [...parts];
    const nextHinges = [...hinges];
    const partAliases = new Map(nextParts.map((part) => [part.label.toLowerCase(), part.id]));

    for (const rawLine of dsl.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const [kind, name] = line.split(/\s+/, 2);
      const pairs = parseKvPairs(line);
      if (kind === 'component' && name) {
        nextTemplates.push({
          id: pairs.id || name.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
          name,
          description: pairs.description?.replace(/_/g, ' ') || 'User-defined component.',
          shape: (pairs.shape as NonNullable<PhysicsCmd['shape']>) || 'box',
          size: parseSize(pairs.size, [0.7, 0.7, 0.7]),
          radius: pairs.radius ? Number(pairs.radius) : undefined,
          mass: Number(pairs.mass ?? 0.8),
          color: pairs.color ?? '#c9d6ea',
          role: pairs.role,
          contactDamage: Number(pairs.contactDamage ?? 1),
        });
      } else if (kind === 'part' && name) {
        const templateId = pairs.component || pairs.template;
        if (!templateId) continue;
        const part: PlacedPart = {
          id: cmdId(name),
          templateId,
          label: name,
          x: Number(pairs.x ?? BOARD_WIDTH / 2),
          y: Number(pairs.y ?? BOARD_HEIGHT / 2),
        };
        nextParts.push(part);
        partAliases.set(name.toLowerCase(), part.id);
      } else if (kind === 'hinge' && name) {
        const childId = partAliases.get(name.toLowerCase()) ?? name;
        const parentRef = pairs.parent ?? pairs.parentId;
        if (!parentRef) continue;
        const parentId = partAliases.get(parentRef.toLowerCase()) ?? parentRef;
        nextHinges.push({
          id: cmdId('hinge'),
          parentId,
          childId,
          axis: parseVec(pairs.axis, [0, 0, 1]),
          anchorA: parseVec(pairs.anchorA, [0, 0, 0]),
          anchorB: parseVec(pairs.anchorB, [0, 0, 0]),
        });
      }
    }

    setCustomTemplates(nextTemplates);
    setParts(nextParts);
    setHinges(nextHinges);
    setStatus('Applied component language to the current builder.');
  }, [customTemplates, dsl, hinges, parts]);

  const trainSelected = useCallback(() => {
    const combatantId = selectedCombatant || builderName;
    queuePhysicsCmd('run_training_loop', {
      combatantId,
      rewardFn,
      generations,
      populationSize,
      simSteps,
      mutationRate,
      controllerId,
    });
    setStatus(`Training ${combatantId} with controller ${controllerId}.`);
  }, [builderName, controllerId, generations, mutationRate, populationSize, queuePhysicsCmd, rewardFn, selectedCombatant, simSteps]);

  const saveSelectedController = useCallback(() => {
    queuePhysicsCmd('save_controller', { combatantId: selectedCombatant || builderName, controllerId });
    setStatus(`Requested save for ${controllerId}.`);
  }, [builderName, controllerId, queuePhysicsCmd, selectedCombatant]);

  const loadSelectedController = useCallback(() => {
    if (!selectedController) {
      setStatus('Choose a saved controller first.');
      return;
    }
    queuePhysicsCmd('load_controller', { combatantId: selectedCombatant || builderName, controllerId: selectedController });
    setStatus(`Loading ${selectedController}.`);
  }, [builderName, queuePhysicsCmd, selectedCombatant, selectedController]);

  const evaluateSelectedController = useCallback(() => {
    queuePhysicsCmd('evaluate_controller', { combatantId: selectedCombatant || builderName, rewardFn, simSteps });
    setStatus(`Evaluating ${(selectedCombatant || builderName)}.`);
  }, [builderName, queuePhysicsCmd, rewardFn, selectedCombatant, simSteps]);

  const dispatchAgentPrompt = useCallback((prompt: string, statusMessage: string) => {
    window.dispatchEvent(new CustomEvent('sa:physics-studio-agent', { detail: { prompt, source: 'physics-studio' } }));
    setStatus(statusMessage);
  }, []);

  const challengeLlmWithUserBot = useCallback(() => {
    const combatantId = selectedCombatant || builderName;
    if (!arenaState?.combatants?.[combatantId] && parts.length > 0) {
      deployCurrentDesign('user', combatantId);
    }
    dispatchAgentPrompt(
      `The physics window is open. Read read_skill("physics-studio") before acting. Use physics_get_state() to inspect the current user combatant "${combatantId}" and the live arena rules. Ensure the user bot is driven by a learned neural controller; if it does not have one, train or load one first. Then create, train, or load a rival LLM-controlled bot in the same arena so the user bot fights the LLM bot. Both bots must be controlled by learned neural-network controllers, not manual inputs. Keep the user bot intact, prefer the duel tooling over raw scripts, and verify the result with physics_get_state().`,
      `Queued an LLM rival for ${combatantId}.`,
    );
  }, [arenaState?.combatants, builderName, deployCurrentDesign, dispatchAgentPrompt, parts.length, selectedCombatant]);

  const askLlmToRefineBot = useCallback(() => {
    dispatchAgentPrompt(
      `The physics window is open. Read read_skill("physics-studio") before acting. Review the current builder state and arena via physics_get_state(), then improve the active bot design or learned neural controller for combat. Do not introduce manual control paths. Use the advanced duel tools and verify the resulting state.`,
      'Queued an LLM build refinement request.',
    );
  }, [dispatchAgentPrompt]);

  const liveCombatants = arenaState?.combatants ? Object.entries(arenaState.combatants) as Array<[string, any]> : [];

  return (
    <div style={{ width: '100%', height: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', background: '#0b1017', color: '#f4f7fb' }}>
      <div style={{ position: 'relative', borderRight: '1px solid rgba(255,255,255,0.08)', minWidth: 0 }}>
        <PhysicsSimulator commands={commands} width={Math.max(320, width - 380)} height={height} />
        <div style={{ position: 'absolute', left: 16, bottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <QuickButton label="Refresh State" onClick={refreshArenaState} />
          <QuickButton label="Deploy User Bot" onClick={() => deployCurrentDesign('user', builderName)} />
          <QuickButton label="Fight LLM Bot" onClick={challengeLlmWithUserBot} />
          <QuickButton label="LLM Coach" onClick={askLlmToRefineBot} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, background: 'linear-gradient(180deg, #0f1722 0%, #101723 100%)' }}>
        <div style={{ display: 'flex', gap: 6, padding: 10, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {(['builder', 'arena', 'torch', 'guide'] as StudioTab[]).map((entry) => (
            <button
              key={entry}
              onClick={() => setTab(entry)}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                background: tab === entry ? '#f4f7fb' : 'rgba(255,255,255,0.06)',
                color: tab === entry ? '#0f1722' : 'rgba(244,247,251,0.82)',
                borderRadius: 999,
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {entry}
            </button>
          ))}
        </div>

        <div style={{ padding: 12, fontSize: 12, color: 'rgba(244,247,251,0.9)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Physics Studio</div>
          <div style={{ color: 'rgba(244,247,251,0.62)', lineHeight: 1.5 }}>{status}</div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {tab === 'builder' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <Section title="Starter Assemblies">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {Object.keys(STARTER_ASSEMBLIES).map((assemblyId) => (
                    <QuickButton key={assemblyId} label={assemblyId} onClick={() => loadAssembly(assemblyId)} />
                  ))}
                </div>
              </Section>

              <Section title="Component Palette">
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      draggable
                      onDragStart={(event) => event.dataTransfer.setData('text/plain', template.id)}
                      onDoubleClick={() => addPartFromTemplate(template.id)}
                      style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 10, background: 'rgba(255,255,255,0.04)', cursor: 'grab' }}
                    >
                      <div style={{ fontWeight: 800 }}>{template.name}</div>
                      <div style={{ marginTop: 4, fontSize: 11, color: 'rgba(244,247,251,0.62)' }}>{template.description}</div>
                      <div style={{ marginTop: 6, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(244,247,251,0.42)' }}>{template.shape} {template.role ? `· ${template.role}` : ''}</div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Builder Board">
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <QuickButton label="Attach Hinge" onClick={attachSelectedWithHinge} />
                  <QuickButton label="Save Bot" onClick={saveBlueprint} />
                  <QuickButton label="Remove Selected" onClick={removeSelected} />
                  <QuickButton label="Clear" onClick={clearBuilder} />
                </div>
                <div
                  ref={boardRef}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={onDropTemplate}
                  style={{
                    position: 'relative',
                    width: BOARD_WIDTH,
                    height: BOARD_HEIGHT,
                    borderRadius: 18,
                    border: '1px dashed rgba(255,255,255,0.18)',
                    background: 'radial-gradient(circle at top, rgba(100,150,255,0.18), rgba(8,12,18,0.72))',
                    overflow: 'hidden',
                  }}
                >
                  <svg width={BOARD_WIDTH} height={BOARD_HEIGHT} style={{ position: 'absolute', inset: 0 }}>
                    {hinges.map((hinge) => {
                      const parent = parts.find((entry) => entry.id === hinge.parentId);
                      const child = parts.find((entry) => entry.id === hinge.childId);
                      if (!parent || !child) return null;
                      return (
                        <line
                          key={hinge.id}
                          x1={parent.x}
                          y1={parent.y}
                          x2={child.x}
                          y2={child.y}
                          stroke="rgba(255,214,102,0.95)"
                          strokeWidth="3"
                          strokeDasharray="8 6"
                        />
                      );
                    })}
                  </svg>
                  {parts.map((part) => {
                    const template = templateMap.get(part.templateId);
                    const selected = selectedParts.includes(part.id);
                    return (
                      <button
                        key={part.id}
                        onPointerDown={(event) => beginPartDrag(part.id, event.clientX, event.clientY)}
                        onClick={() => setSelectedParts((prev) => prev.includes(part.id) ? prev.filter((entry) => entry !== part.id) : [...prev.slice(-1), part.id])}
                        style={{
                          position: 'absolute',
                          left: part.x - 32,
                          top: part.y - 22,
                          width: 64,
                          minHeight: 44,
                          borderRadius: 14,
                          border: selected ? '2px solid #ffd166' : '1px solid rgba(255,255,255,0.16)',
                          background: selected ? 'rgba(255,209,102,0.2)' : 'rgba(255,255,255,0.08)',
                          color: '#f4f7fb',
                          cursor: draggingPartId === part.id ? 'grabbing' : 'grab',
                          padding: 6,
                          fontSize: 10,
                          fontWeight: 800,
                        }}
                      >
                        <div>{part.label}</div>
                        <div style={{ marginTop: 2, fontSize: 9, color: 'rgba(244,247,251,0.58)' }}>{template?.role ?? template?.shape}</div>
                      </button>
                    );
                  })}
                </div>
              </Section>

              <Section title="Component Language">
                <div style={{ fontSize: 11, color: 'rgba(244,247,251,0.62)', marginBottom: 8 }}>
                  Define reusable components, place parts, and attach hinges with a small DSL. Movement comes from learned controllers later in Torch Lab; there is no manual piloting path.
                </div>
                <textarea
                  value={dsl}
                  onChange={(event) => setDsl(event.target.value)}
                  placeholder={[
                    'component ShockHammer shape=box size=1.0,0.2,0.35 mass=0.5 color=#ff6b57 role=weapon contactDamage=2.3',
                    'part hammer component=ShockHammer x=250 y=120',
                    'hinge hammer parent=Torso axis=0,0,1 anchorA=0.5,0,0 anchorB=-0.2,0,0',
                  ].join('\n')}
                  style={{ width: '100%', minHeight: 120, borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.24)', color: '#f4f7fb', padding: 10, fontFamily: 'monospace', fontSize: 11 }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <QuickButton label="Apply DSL" onClick={applyDsl} />
                  <QuickButton label="Deploy Current Bot" onClick={() => deployCurrentDesign('user', builderName)} />
                </div>
              </Section>

              <Section title="Bot Library">
                <div style={{ fontSize: 11, color: 'rgba(244,247,251,0.62)', marginBottom: 8 }}>
                  Store named bots with their builder layout, generated body plan, and training defaults so they are easy to reload, deploy, and iterate on.
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <QuickButton label="Save Current Bot" onClick={saveBlueprint} />
                  <QuickButton label="Refresh Library" onClick={refreshBlueprints} />
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {savedBlueprints.length === 0 && <div style={{ color: 'rgba(244,247,251,0.62)' }}>No stored bots yet. Save the current design to create a reusable bot library.</div>}
                  {savedBlueprints.map((entry) => (
                    <div key={entry.id} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 10, background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                        <strong>{entry.name}</strong>
                        <span style={{ fontSize: 10, color: 'rgba(244,247,251,0.5)' }}>{entry.partCount} parts</span>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 10, color: 'rgba(244,247,251,0.56)' }}>{entry.hasLayout ? 'reloadable layout' : 'body plan only'} · {entry.hasBodyPlan ? 'deployable' : 'layout draft'}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        <QuickButton label="Load" onClick={() => { void loadBlueprintIntoStudio(entry.id); }} />
                        <QuickButton label="Deploy" onClick={() => { void deployBlueprint(entry.id); }} />
                        <QuickButton label="Delete" onClick={() => { void deleteBlueprint(entry.id); }} />
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          )}

          {tab === 'arena' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <Section title="User vs LLM Arena">
                <div style={{ fontSize: 11, color: 'rgba(244,247,251,0.62)', marginBottom: 8 }}>
                  Arena actions deploy bodies into the sim. Actual movement should come from trained or loaded neural controllers, not direct input.
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <LabeledField label="Bot Id">
                    <input value={builderName} onChange={(event) => setBuilderName(event.target.value)} style={inputStyle} />
                  </LabeledField>
                  <LabeledField label="Team">
                    <select value={deployTeam} onChange={(event) => setDeployTeam(event.target.value)} style={inputStyle}>
                      <option value="user">user</option>
                      <option value="red">red</option>
                      <option value="blue">blue</option>
                      <option value="neutral">neutral</option>
                    </select>
                  </LabeledField>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <LabeledField label="Health"><input type="number" value={deployHealth} onChange={(event) => setDeployHealth(Number(event.target.value))} style={inputStyle} /></LabeledField>
                    <LabeledField label="Contact Damage"><input type="number" step="0.1" value={deployDamage} onChange={(event) => setDeployDamage(Number(event.target.value))} style={inputStyle} /></LabeledField>
                  </div>
                  <LabeledField label="Aggression"><input type="number" step="0.1" value={deployAggression} onChange={(event) => setDeployAggression(Number(event.target.value))} style={inputStyle} /></LabeledField>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <QuickButton label="Deploy User Bot" onClick={() => deployCurrentDesign('user', builderName)} />
                  <QuickButton label="Spawn Duel Arena" onClick={() => queuePhysicsCmd('set_rules', { arenaHalfExtent: 18, contactDamageScale: 5, impactDamageThreshold: 2.4, allowSleep: false })} />
                  <QuickButton label="Fight LLM Bot" onClick={challengeLlmWithUserBot} />
                </div>
              </Section>

              <Section title="Duel HUD">
                <div style={{ display: 'grid', gap: 8 }}>
                  {liveCombatants.length === 0 && <div style={{ color: 'rgba(244,247,251,0.62)' }}>No live combatants yet. Deploy a bot body, then train or load a neural controller before dueling.</div>}
                  {liveCombatants.map(([id, combatant]) => (
                    <div key={id} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: 10, background: 'rgba(255,255,255,0.04)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <strong>{id}</strong>
                        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: combatant.team === 'user' ? '#7ad8ff' : combatant.team === 'red' ? '#ff8a7a' : '#b6c2d9' }}>{combatant.team}</span>
                      </div>
                      <div style={{ marginTop: 6, height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(0, Math.min(100, (combatant.health / Math.max(1, combatant.maxHealth)) * 100))}%`, height: '100%', background: combatant.eliminated ? '#5c677d' : '#6ee7b7' }} />
                      </div>
                      <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(244,247,251,0.66)' }}>Health {combatant.health}/{combatant.maxHealth} · Aggro {combatant.aggression} · Damage {combatant.contactDamage}</div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Arena Rules">
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11, color: 'rgba(244,247,251,0.7)' }}>
                    <div>Arena Radius: {arenaState?.rules?.arenaHalfExtent ?? 'n/a'}</div>
                    <div>Ground Friction: {arenaState?.rules?.groundFriction ?? 'n/a'}</div>
                    <div>Impact Threshold: {arenaState?.rules?.impactDamageThreshold ?? 'n/a'}</div>
                    <div>Damage Scale: {arenaState?.rules?.contactDamageScale ?? 'n/a'}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <LabeledField label="Ground">
                      <select value={groundProfile} onChange={(event) => setGroundProfile(event.target.value as 'flat' | 'hills')} style={inputStyle}>
                        <option value="flat">flat</option>
                        <option value="hills">hills</option>
                      </select>
                    </LabeledField>
                    <LabeledField label="Hill Amplitude">
                      <input type="number" step="0.1" value={groundAmplitude} onChange={(event) => setGroundAmplitude(Number(event.target.value))} style={inputStyle} />
                    </LabeledField>
                  </div>
                  <LabeledField label="Hill Frequency">
                    <input type="number" step="0.01" value={groundFrequency} onChange={(event) => setGroundFrequency(Number(event.target.value))} style={inputStyle} />
                  </LabeledField>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <QuickButton label="Apply Ground" onClick={applyGroundProfile} />
                    <QuickButton label="Flat Arena" onClick={() => { setGroundProfile('flat'); setGroundAmplitude(0); setGroundFrequency(0.18); }} />
                    <QuickButton label="Rolling Hills" onClick={() => { setGroundProfile('hills'); setGroundAmplitude(1.1); setGroundFrequency(0.2); }} />
                  </div>
                </div>
              </Section>
            </div>
          )}

          {tab === 'torch' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <Section title="Torch Lab">
                <div style={{ fontSize: 11, color: 'rgba(244,247,251,0.62)', marginBottom: 8 }}>
                  Train, evaluate, save, and deploy learned neural controllers for the selected combatant. This is the only movement path for user bots and LLM rivals.
                </div>
                {selectedCombatantState && (
                  <div style={{ marginBottom: 10, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 10, background: 'rgba(255,255,255,0.03)', fontSize: 11, color: 'rgba(244,247,251,0.7)' }}>
                    Training target: <strong>{selectedCombatant}</strong> · health {selectedCombatantState.health}/{selectedCombatantState.maxHealth} · damage {selectedCombatantState.contactDamage} · aggression {selectedCombatantState.aggression}
                  </div>
                )}
                <LabeledField label="Combatant">
                  <select value={selectedCombatant} onChange={(event) => setSelectedCombatant(event.target.value)} style={inputStyle}>
                    <option value="">select combatant</option>
                    {liveCombatants.map(([id]) => <option key={id} value={id}>{id}</option>)}
                  </select>
                </LabeledField>
                <LabeledField label="Controller Id">
                  <input value={controllerId} onChange={(event) => setControllerId(event.target.value)} style={inputStyle} />
                </LabeledField>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <LabeledField label="Generations"><input type="number" value={generations} onChange={(event) => setGenerations(Number(event.target.value))} style={inputStyle} /></LabeledField>
                  <LabeledField label="Population"><input type="number" value={populationSize} onChange={(event) => setPopulationSize(Number(event.target.value))} style={inputStyle} /></LabeledField>
                  <LabeledField label="Sim Steps"><input type="number" value={simSteps} onChange={(event) => setSimSteps(Number(event.target.value))} style={inputStyle} /></LabeledField>
                  <LabeledField label="Mutation"><input type="number" step="0.01" value={mutationRate} onChange={(event) => setMutationRate(Number(event.target.value))} style={inputStyle} /></LabeledField>
                </div>
                <LabeledField label="Reward Function">
                  <textarea value={rewardFn} onChange={(event) => setRewardFn(event.target.value)} style={{ ...inputStyle, minHeight: 96, resize: 'vertical', fontFamily: 'monospace' }} />
                </LabeledField>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <QuickButton label="Train" onClick={trainSelected} />
                  <QuickButton label="Evaluate" onClick={evaluateSelectedController} />
                  <QuickButton label="Save" onClick={saveSelectedController} />
                  <QuickButton label="Refresh" onClick={refreshArenaState} />
                </div>
              </Section>

              <Section title="Deploy Saved Controllers">
                <LabeledField label="Saved Controller">
                  <select value={selectedController} onChange={(event) => setSelectedController(event.target.value)} style={inputStyle}>
                    <option value="">select saved controller</option>
                    {savedControllers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name ?? entry.id}</option>)}
                  </select>
                </LabeledField>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <QuickButton label="Load to Selected" onClick={loadSelectedController} />
                  <QuickButton label="Clear Controllers" onClick={() => queuePhysicsCmd('clear_controller', { combatantId: selectedCombatant || builderName })} />
                  <QuickButton label="Spawn Duelists" onClick={() => queuePhysicsCmd('set_rules', { arenaHalfExtent: 18, contactDamageScale: 5.2, impactDamageThreshold: 2.4, allowSleep: false })} />
                </div>
                <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                  {savedControllers.slice(0, 8).map((entry) => (
                    <div key={entry.id} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 8, background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ fontWeight: 700 }}>{entry.name ?? entry.id}</div>
                      <div style={{ fontSize: 10, color: 'rgba(244,247,251,0.58)' }}>score {entry.performanceScore ?? 0} · iters {entry.iterations ?? 0}</div>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          )}

          {tab === 'guide' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <Section title="Physics Studio Guide">
                <div style={{ fontSize: 11, color: 'rgba(244,247,251,0.62)', marginBottom: 8 }}>
                  This mirrors the hidden model skill. It only matters when the physics window is open.
                </div>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6, color: 'rgba(244,247,251,0.88)' }}>{guideText}</pre>
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 12, background: 'rgba(255,255,255,0.03)' }}>
      <div style={{ marginBottom: 10, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(244,247,251,0.66)' }}>{title}</div>
      {children}
    </section>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 6, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(244,247,251,0.58)' }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function QuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.08)',
        color: '#f4f7fb',
        borderRadius: 999,
        padding: '8px 12px',
        fontSize: 10,
        fontWeight: 900,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(0,0,0,0.22)',
  color: '#f4f7fb',
  padding: '10px 12px',
  fontSize: 12,
  outline: 'none',
};