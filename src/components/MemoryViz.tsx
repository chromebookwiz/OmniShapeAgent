"use client";

import { useEffect, useState, useRef } from 'react';

interface Entity {
  id: string;
  label: string;
  type: string;
  importance: number;
}

interface Relation {
  id: string;
  from: string;
  to: string;
  relation: string;
}

interface Node extends Entity {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const TYPE_COLORS: Record<string, string> = {
  person: '#60a5fa', // blue-400
  place: '#34d399',  // emerald-400
  concept: '#a78bfa', // violet-400
  fact: '#fbbf24',    // amber-400
  preference: '#f87171', // red-400
  goal: '#22d3ee',    // cyan-400
  tool: '#94a3b8',    // slate-400
  other: '#e2e8f0',   // slate-200
};

export default function MemoryViz() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Relation[]>([]);
  const requestRef = useRef<number | null>(null);
  const nodesRef = useRef<Node[]>([]);

  // ── Data Fetching ────────────────────────────────────────────────────────

  useEffect(() => {
    const fetchMemory = async () => {
      try {
        const res = await fetch('/api/memory');
        const data = await res.json();
        
        if (data.entities) {
          // Initialize new nodes with random positions if they don't exist
          const newNodes = data.entities.map((e: Entity) => {
            const existing = nodesRef.current.find(n => n.id === e.id);
            if (existing) return { ...existing, ...e };
            return {
              ...e,
              x: (Math.random() - 0.5) * 400,
              y: (Math.random() - 0.5) * 400,
              vx: 0,
              vy: 0,
            };
          });
          nodesRef.current = newNodes;
          setNodes(newNodes);
        }
        if (data.relations) setLinks(data.relations);
      } catch (err) {
        console.error("Failed to fetch memory graph", err);
      }
    };

    fetchMemory();
    const interval = setInterval(fetchMemory, 10000);
    return () => clearInterval(interval);
  }, []);

  // ── Physics Simulation ───────────────────────────────────────────────────

  const [center, setCenter] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const updateCenter = () => {
      setCenter({
        x: window.innerWidth * 0.25,
        y: window.innerHeight * 0.5,
      });
    };

    updateCenter();
    window.addEventListener('resize', updateCenter);
    return () => window.removeEventListener('resize', updateCenter);
  }, []);

  const animate = () => {
    const ns = nodesRef.current;
    if (ns.length === 0) {
      requestRef.current = requestAnimationFrame(animate);
      return;
    }

    const friction = 0.95;
    const repulsion = 1500;
    const attraction = 0.05;
    const centerAttraction = 0.01;

    // 1. Repulsion between all nodes
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const dx = ns[i].x - ns[j].x;
        const dy = ns[i].y - ns[j].y;
        const distSq = dx * dx + dy * dy + 0.1;
        const force = repulsion / distSq;
        const fx = (dx / Math.sqrt(distSq)) * force;
        const fy = (dy / Math.sqrt(distSq)) * force;
        ns[i].vx += fx;
        ns[i].vy += fy;
        ns[j].vx -= fx;
        ns[j].vy -= fy;
      }
    }

    // 2. Attraction between linked nodes
    for (const link of links) {
      const source = ns.find(n => n.id === link.from);
      const target = ns.find(n => n.id === link.to);
      if (source && target) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        source.vx += dx * attraction;
        source.vy += dy * attraction;
        target.vx -= dx * attraction;
        target.vy -= dy * attraction;
      }
    }

    // 3. Attraction to center
    for (const n of ns) {
      n.vx -= n.x * centerAttraction;
      n.vy -= n.y * centerAttraction;
      
      // Update position
      n.x += n.vx;
      n.y += n.vy;
      
      // Apply friction
      n.vx *= friction;
      n.vy *= friction;
    }

    setNodes([...ns]);
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [links]);

  return (
    <div className="absolute inset-0 overflow-hidden flex items-center justify-center p-8">
      <div className="relative w-full h-full flex items-center justify-center">
        {/* Background Atmosphere */}
        <div className="absolute w-[600px] h-[600px] rounded-full bg-blue-500/5 blur-[120px]" />
        
        {/* Connection Lines (SVG) */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
          <g transform={`translate(${center.x}, ${center.y})`}>
            {links.map((link) => {
              const source = nodes.find(n => n.id === link.from);
              const target = nodes.find(n => n.id === link.to);
              if (!source || !target) return null;
              return (
                <line
                  key={link.id}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="white"
                  strokeOpacity="0.1"
                  strokeWidth="1"
                />
              );
            })}
          </g>
        </svg>

        {/* Nodes */}
        <div className="relative w-full h-full">
          {nodes.map((node) => {
            const color = TYPE_COLORS[node.type] || TYPE_COLORS.other;
            const size = 6 + (node.importance * 4);
            
            return (
              <div
                key={node.id}
                className="absolute transition-transform duration-0 ease-linear group"
                style={{
                  left: '50%',
                  top: '50%',
                  transform: `translate(calc(-50% + ${node.x}px), calc(-50% + ${node.y}px))`,
                }}
              >
                {/* Glow */}
                <div 
                  className="absolute inset-0 rounded-full blur-[6px] opacity-40 group-hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: color, margin: '-2px' }}
                />
                
                {/* Core Node */}
                <div 
                  className="relative rounded-full border border-white/20 shadow-lg"
                  style={{ 
                    backgroundColor: color,
                    width: `${size}px`,
                    height: `${size}px`
                  }}
                />

                {/* Label */}
                <div className="absolute top-[120%] left-1/2 -translate-x-1/2 text-[10px] font-mono text-zinc-400 opacity-60 group-hover:opacity-100 whitespace-nowrap transition-opacity pointer-events-none">
                  {node.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Legend / Stats overlay */}
      <div className="absolute bottom-6 right-6 p-4 glass-chat rounded-lg text-[10px] font-mono text-zinc-500 flex flex-col gap-1">
        <div className="text-zinc-300 mb-1 border-b border-white/10 pb-1 uppercase tracking-widest font-bold">Knowledge Graph</div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400" /> <span>Person</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> <span>Place</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-violet-400" /> <span>Concept</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" /> <span>Fact</span>
        </div>
      </div>
    </div>
  );
}
