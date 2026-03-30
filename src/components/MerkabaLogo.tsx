"use client";

import React, { useEffect, useRef, useCallback } from "react";

const EDGES: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
];

const S2 = Math.sqrt(2);
const S6 = Math.sqrt(6);

const UP_VERTS: [number, number, number][] = [
  [0, 1, 0],
  [(2 * S2) / 3, -1 / 3, 0],
  [-S2 / 3, -1 / 3, S6 / 3],
  [-S2 / 3, -1 / 3, -S6 / 3],
];

const DOWN_VERTS: [number, number, number][] = UP_VERTS.map(
  ([x, y, z]) => [-x, -y, -z]
);

function rotateY(
  v: [number, number, number],
  angle: number
): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

function rotateX(
  v: [number, number, number],
  angle: number
): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
}

function project(
  v: [number, number, number],
  fov: number,
  r: number
): [number, number, number] {
  const scale = (fov / (v[2] + fov)) * r * 0.76;
  return [v[0] * scale + r, -v[1] * scale + r, v[2]]; // negate Y so +Y is up in SVG
}

interface EdgeEntry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  z: number;
  color: string;
}

export default function MerkabaLogo({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const r = size / 2;
  const fov = size * 2.8;

  const yawRef = useRef(0);
  const pitchRef = useRef(0.3);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const edgesGroupRef = useRef<SVGGElement | null>(null);

  const dragRef = useRef<{
    active: boolean;
    lastX: number;
    lastY: number;
  }>({ active: false, lastX: 0, lastY: 0 });

  const buildEdges = useCallback(
    (yaw: number, pitch: number): EdgeEntry[] => {
      const entries: EdgeEntry[] = [];

      const transform = (v: [number, number, number]) =>
        rotateX(rotateY(v, yaw), pitch);

      const upT = UP_VERTS.map(transform);
      const downT = DOWN_VERTS.map(transform);

      const upProj = upT.map((v) => project(v, fov, r));
      const downProj = downT.map((v) => project(v, fov, r));

      for (const [a, b] of EDGES) {
        const p1 = upProj[a];
        const p2 = upProj[b];
        const z = (upT[a][2] + upT[b][2]) / 2;
        entries.push({
          x1: p1[0],
          y1: p1[1],
          x2: p2[0],
          y2: p2[1],
          z,
          color: "rgba(178,18,18,0.94)",
        });
      }

      for (const [a, b] of EDGES) {
        const p1 = downProj[a];
        const p2 = downProj[b];
        const z = (downT[a][2] + downT[b][2]) / 2;
        entries.push({
          x1: p1[0],
          y1: p1[1],
          x2: p2[0],
          y2: p2[1],
          z,
          color: "rgba(22,73,196,0.94)",
        });
      }

      entries.sort((a, b) => a.z - b.z);
      return entries;
    },
    [fov, r]
  );

  const renderEdges = useCallback(
    (yaw: number, pitch: number) => {
      const g = edgesGroupRef.current;
      if (!g) return;

      const edges = buildEdges(yaw, pitch);
      const minZ = Math.min(...edges.map((e) => e.z));
      const maxZ = Math.max(...edges.map((e) => e.z));
      const zRange = maxZ - minZ || 1;

      while (g.firstChild) g.removeChild(g.firstChild);

      for (const edge of edges) {
        const t = (edge.z - minZ) / zRange;
        const opacity = 0.35 + 0.65 * t;
        const line = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "line"
        );
        line.setAttribute("x1", String(edge.x1));
        line.setAttribute("y1", String(edge.y1));
        line.setAttribute("x2", String(edge.x2));
        line.setAttribute("y2", String(edge.y2));
        line.setAttribute("stroke", edge.color);
        line.setAttribute("stroke-width", String(size * 0.05));
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("opacity", String(opacity));
        g.appendChild(line);
      }
    },
    [buildEdges, size]
  );

  useEffect(() => {
    let running = true;

    const loop = (now: number) => {
      if (!running) return;
      const dt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0;
      lastTimeRef.current = now;

      if (!dragRef.current.active) {
        yawRef.current += 0.4 * dt;
      }

      renderEdges(yawRef.current, pitchRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      running = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [renderEdges]);

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    yawRef.current += dx * 0.02;
    pitchRef.current += dy * 0.02;
    pitchRef.current = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitchRef.current));
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  const strokeW = size * 0.038;

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      style={{ cursor: "grab", userSelect: "none", flexShrink: 0 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <defs>
        <radialGradient id="orbGrad" cx="35%" cy="30%" r="60%">
          <stop offset="0%" stopColor="white" stopOpacity="0.95" />
          <stop offset="45%" stopColor="white" stopOpacity="0.6" />
          <stop offset="100%" stopColor="black" stopOpacity="0.07" />
        </radialGradient>
        <clipPath id="orbClip">
          <circle cx={r} cy={r} r={r} />
        </clipPath>
      </defs>

      {/* Orb base */}
      <circle cx={r} cy={r} r={r} fill="url(#orbGrad)" />

      {/* Guide lines */}
      <ellipse
        cx={r}
        cy={r}
        rx={r * 0.76}
        ry={r * 0.22}
        fill="none"
        stroke="rgba(8,8,8,0.1)"
        strokeWidth={strokeW}
      />
      <ellipse
        cx={r}
        cy={r}
        rx={r * 0.22}
        ry={r * 0.76}
        fill="none"
        stroke="rgba(8,8,8,0.1)"
        strokeWidth={strokeW}
      />

      {/* Edges group (populated by renderEdges) */}
      <g ref={edgesGroupRef} clipPath="url(#orbClip)" />
    </svg>
  );
}
