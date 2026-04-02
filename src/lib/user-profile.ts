// src/lib/user-profile.ts
// Persistent user profile — learns facts about the user from every conversation.
// Injected into every system prompt so the agent always "knows" who it's talking to.

import fs from 'fs';

import { PATHS } from './paths';
const PROFILE_PATH = PATHS.userProfile;

export interface LearnedFact {
  fact: string;
  category: 'name' | 'occupation' | 'location' | 'preference' | 'skill' | 'goal' | 'habit' | 'relationship' | 'other';
  confidence: number;   // 0.0–1.0
  learnedAt: number;
  mentionCount: number;
  source: string;        // snippet that produced this fact
}

export interface InteractionStats {
  totalMessages: number;
  totalSessions: number;
  avgMessageLength: number;
  longestSession: number;   // message count
  firstSeen: number;
  lastSeen: number;
  topicFrequency: Record<string, number>;
}

export interface UserProfile {
  // Core identity (extracted from conversation)
  name?: string;
  preferredName?: string;
  occupation?: string;
  location?: string;
  timezone?: string;

  // Communication preferences (inferred)
  communicationStyle: 'terse' | 'detailed' | 'technical' | 'casual' | 'unknown';
  preferredLanguage: string;
  codeLanguages: string[];

  // Interests and goals
  topicsOfInterest: string[];
  activeGoals: string[];
  completedGoals: string[];

  // Learned facts
  facts: LearnedFact[];

  // Interaction history
  stats: InteractionStats;

  // Agent's notes about the user
  agentNotes: string[];

  updatedAt: number;
}

const DEFAULT_PROFILE: UserProfile = {
  communicationStyle: 'unknown',
  preferredLanguage: 'English',
  codeLanguages: [],
  topicsOfInterest: [],
  activeGoals: [],
  completedGoals: [],
  facts: [],
  stats: {
    totalMessages: 0,
    totalSessions: 0,
    avgMessageLength: 0,
    longestSession: 0,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    topicFrequency: {},
  },
  agentNotes: [],
  updatedAt: Date.now(),
};

class UserProfileManager {
  private profile: UserProfile;
  private sessionMessageCount = 0;

  constructor() {
    this.profile = this.load();
  }

  private load(): UserProfile {
    try {
      if (fs.existsSync(PROFILE_PATH)) {
        const raw = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'));
        return { ...DEFAULT_PROFILE, ...raw };
      }
    } catch (e) {
      console.error('[UserProfile] Load failed:', e);
    }
    return { ...DEFAULT_PROFILE };
  }

  save() {
    try {
      this.profile.updatedAt = Date.now();
      fs.writeFileSync(PROFILE_PATH, JSON.stringify(this.profile, null, 2));
    } catch (e) {
      console.error('[UserProfile] Save failed:', e);
    }
  }

  get(): UserProfile {
    return this.profile;
  }

  update(patch: Partial<UserProfile>) {
    Object.assign(this.profile, patch);
    this.save();
  }

  // Record a message exchange — update stats and infer facts
  recordExchange(userMessage: string, assistantReply: string) {
    void assistantReply; // reserved for future assistant-response analysis
    const p = this.profile;
    const now = Date.now();

    // Stats
    p.stats.totalMessages++;
    p.stats.lastSeen = now;
    this.sessionMessageCount++;
    if (this.sessionMessageCount > p.stats.longestSession) {
      p.stats.longestSession = this.sessionMessageCount;
    }

    // Rolling average message length
    const prevAvg = p.stats.avgMessageLength;
    p.stats.avgMessageLength = Math.round(
      (prevAvg * (p.stats.totalMessages - 1) + userMessage.length) / p.stats.totalMessages
    );

    // Infer communication style from message length trend
    if (p.stats.totalMessages > 10) {
      if (p.stats.avgMessageLength < 60) {
        p.communicationStyle = 'terse';
      } else if (p.stats.avgMessageLength > 300) {
        p.communicationStyle = 'detailed';
      }
    }

    // Detect code languages mentioned
    const langPatterns: Record<string, RegExp> = {
      TypeScript: /typescript|\.tsx?/i,
      Python: /python|\.py\b/i,
      Rust: /\brust\b|\.rs\b/i,
      Go: /\bgolang\b|\bgo lang\b/i,
      JavaScript: /javascript|\.jsx?/i,
      Java: /\bjava\b(?! *script)/i,
      'C++': /c\+\+|cpp/i,
    };
    for (const [lang, re] of Object.entries(langPatterns)) {
      if (re.test(userMessage) && !p.codeLanguages.includes(lang)) {
        p.codeLanguages.push(lang);
      }
    }

    // Extract name if introduced
    const nameMatch = userMessage.match(/(?:my name is|i(?:'m| am|'m called)) ([A-Z][a-z]+)/i);
    if (nameMatch && !p.name) {
      p.name = nameMatch[1];
    }

    // Extract location
    const locationMatch = userMessage.match(/(?:i(?:'m| am) (?:in|from|based in)) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/);
    if (locationMatch && !p.location) {
      p.location = locationMatch[1];
    }

    this.save();
  }

  addFact(fact: string, category: LearnedFact['category'], confidence: number, source: string) {
    const existing = this.profile.facts.find(f =>
      f.fact.toLowerCase() === fact.toLowerCase()
    );
    if (existing) {
      existing.confidence = Math.min(1.0, existing.confidence + 0.1);
      existing.mentionCount++;
    } else {
      this.profile.facts.push({
        fact,
        category,
        confidence,
        learnedAt: Date.now(),
        mentionCount: 1,
        source: source.substring(0, 100),
      });
      // Keep only top 100 facts
      if (this.profile.facts.length > 100) {
        this.profile.facts.sort((a, b) => b.confidence * b.mentionCount - a.confidence * a.mentionCount);
        this.profile.facts = this.profile.facts.slice(0, 100);
      }
    }
    this.save();
  }

  addNote(note: string) {
    this.profile.agentNotes.unshift(`[${new Date().toISOString().split('T')[0]}] ${note}`);
    if (this.profile.agentNotes.length > 50) {
      this.profile.agentNotes = this.profile.agentNotes.slice(0, 50);
    }
    this.save();
  }

  addGoal(goal: string) {
    if (!this.profile.activeGoals.includes(goal)) {
      this.profile.activeGoals.unshift(goal);
      if (this.profile.activeGoals.length > 20) {
        this.profile.activeGoals = this.profile.activeGoals.slice(0, 20);
      }
      this.save();
    }
  }

  completeGoal(goal: string) {
    this.profile.activeGoals = this.profile.activeGoals.filter(g => g !== goal);
    if (!this.profile.completedGoals.includes(goal)) {
      this.profile.completedGoals.unshift(goal);
    }
    this.save();
  }

  newSession() {
    this.sessionMessageCount = 0;
    this.profile.stats.totalSessions++;
    this.save();
  }

  /**
   * Returns a compact block to inject into the system prompt.
   * Only includes facts with confidence >= 0.5.
   */
  getProfileBlock(): string {
    const p = this.profile;
    const lines: string[] = ['### Known User Profile'];

    if (p.name) lines.push(`Name: ${p.name}${p.preferredName ? ` (prefers: ${p.preferredName})` : ''}`);
    if (p.occupation) lines.push(`Occupation: ${p.occupation}`);
    if (p.location) lines.push(`Location: ${p.location}`);
    if (p.timezone) lines.push(`Timezone: ${p.timezone}`);

    if (p.codeLanguages.length > 0) {
      lines.push(`Languages: ${p.codeLanguages.join(', ')}`);
    }

    if (p.communicationStyle !== 'unknown') {
      lines.push(`Communication style: ${p.communicationStyle}`);
    }

    const highConfidenceFacts = p.facts
      .filter(f => f.confidence >= 0.5)
      .sort((a, b) => b.confidence * b.mentionCount - a.confidence * a.mentionCount)
      .slice(0, 10);

    if (highConfidenceFacts.length > 0) {
      lines.push('Known facts:');
      highConfidenceFacts.forEach(f => {
        lines.push(`  • [${f.category}] ${f.fact} (confidence: ${f.confidence.toFixed(1)})`);
      });
    }

    if (p.activeGoals.length > 0) {
      lines.push(`Active goals: ${p.activeGoals.slice(0, 5).join(' | ')}`);
    }

    if (p.agentNotes.length > 0) {
      lines.push('Agent notes:');
      p.agentNotes.slice(0, 3).forEach(n => lines.push(`  ${n}`));
    }

    lines.push(`Interaction history: ${p.stats.totalMessages} messages across ${p.stats.totalSessions} sessions`);
    lines.push(`First seen: ${new Date(p.stats.firstSeen).toLocaleDateString()}`);

    return lines.join('\n');
  }

  toJSON(): UserProfile {
    return { ...this.profile };
  }
}

export const userProfile = new UserProfileManager();
