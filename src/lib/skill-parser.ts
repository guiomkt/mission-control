import fs from 'fs';
import path from 'path';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  location: string;
  source: 'workspace' | 'system';
  homepage?: string;
  emoji?: string;
  fileCount: number;
  fullContent: string;
  files: string[];
  agents: string[]; // which agents/workspaces have this skill
}

interface FrontMatter {
  name?: string;
  description?: string;
  homepage?: string;
  metadata?: {
    openclaw?: {
      emoji?: string;
    };
  };
}

interface ConfiguredSkill {
  name: string;
  location: string;
}

interface SkillsConfig {
  systemSkillsPath?: string;
  workspaceSkillsPath?: string;
  skills: ConfiguredSkill[];
}

const CONFIG_PATH = path.join(process.cwd(), 'data', 'configured-skills.json');
const DEFAULT_SYSTEM_PATH = '/usr/lib/node_modules/openclaw/skills';
const DEFAULT_WORKSPACE_PATH = (process.env.OPENCLAW_DIR || '/workspace') + '/workspace-infra/skills';

/** Where the OpenClaw container ships installed skills (mounted in our container). */
const OPENCLAW_SKILLS_DIR =
  process.env.OPENCLAW_SKILLS_DIR ||
  path.join(process.env.OPENCLAW_DIR || '/workspace', 'skills');

/**
 * Parse SKILL.md front matter (YAML between --- delimiters)
 */
function parseFrontMatter(content: string): { frontMatter: FrontMatter; body: string } {
  const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  
  if (!frontMatterMatch) {
    return { frontMatter: {}, body: content };
  }

  const yamlContent = frontMatterMatch[1];
  const body = frontMatterMatch[2];
  
  const frontMatter: FrontMatter = {};
  
  const nameMatch = yamlContent.match(/^name:\s*(.+)$/m);
  if (nameMatch) frontMatter.name = nameMatch[1].trim();
  
  const descMatch = yamlContent.match(/^description:\s*(.+)$/m);
  if (descMatch) frontMatter.description = descMatch[1].trim();
  
  const homepageMatch = yamlContent.match(/^homepage:\s*(.+)$/m);
  if (homepageMatch) frontMatter.homepage = homepageMatch[1].trim();
  
  const emojiMatch = yamlContent.match(/"emoji":\s*"([^"]+)"/);
  if (emojiMatch) {
    frontMatter.metadata = { openclaw: { emoji: emojiMatch[1] } };
  }
  
  return { frontMatter, body };
}

/**
 * Extract first paragraph as description if no front matter description
 */
function extractFirstParagraph(body: string): string {
  const lines = body.split('\n');
  let inParagraph = false;
  let paragraph = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('#')) {
      if (inParagraph) break;
      continue;
    }
    
    if (!trimmed && !inParagraph) continue;
    
    if (trimmed && !inParagraph) {
      inParagraph = true;
      paragraph = trimmed;
      continue;
    }
    
    if (trimmed && inParagraph) {
      paragraph += ' ' + trimmed;
      continue;
    }
    
    if (!trimmed && inParagraph) break;
  }
  
  return paragraph || 'No description available';
}

/**
 * Count files in a skill folder (excluding hidden files)
 */
function countFiles(skillPath: string): { count: number; files: string[] } {
  try {
    const files: string[] = [];
    
    function scanDir(dir: string, prefix: string = '') {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          scanDir(path.join(dir, entry.name), relativePath);
        } else {
          files.push(relativePath);
        }
      }
    }
    
    scanDir(skillPath);
    return { count: files.length, files };
  } catch {
    return { count: 0, files: [] };
  }
}

/**
 * Parse a single skill from its directory
 */
export function parseSkill(skillPath: string, skillName: string, agents: string[] = []): SkillInfo | null {
  const skillMdPath = path.join(skillPath, 'SKILL.md');
  
  if (!fs.existsSync(skillMdPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const { frontMatter, body } = parseFrontMatter(content);
    const { count, files } = countFiles(skillPath);
    
    const source = skillPath.includes('/workspace') ? 'workspace' : 'system';
    
    return {
      id: skillName,
      name: frontMatter.name || skillName,
      description: frontMatter.description || extractFirstParagraph(body),
      location: skillPath,
      source,
      homepage: frontMatter.homepage,
      emoji: frontMatter.metadata?.openclaw?.emoji,
      fileCount: count,
      fullContent: content,
      files,
      agents,
    };
  } catch {
    return null;
  }
}

/**
 * Build a map of skill-name -> [agentId] by scanning all workspace skill dirs
 */
function buildAgentSkillMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const openclawDir = process.env.OPENCLAW_DIR || '/workspace';

  // Agent workspaces: workspace, workspace-infra, workspace-social, etc.
  // Read from openclaw.json if possible
  let agentList: Array<{ id: string; workspace: string }> = [];
  try {
    const openclawConfig: { agents?: { list?: Array<{ id: string; workspace?: string }> } } = JSON.parse(
      fs.readFileSync(path.join(openclawDir, 'openclaw.json'), 'utf-8'),
    );
    agentList = (openclawConfig?.agents?.list || []).map((a) => ({
      id: a.id,
      workspace: a.workspace || path.join(openclawDir, 'workspace'),
    }));
  } catch {
    // Fallback: scan directories
    try {
      const dirs = fs.readdirSync(openclawDir, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.startsWith('workspace')) {
          const agentId = d.name === 'workspace' ? 'main' : d.name.replace('workspace-', '');
          agentList.push({ id: agentId, workspace: path.join(openclawDir, d.name) });
        }
      }
    } catch {}
  }

  for (const { id, workspace } of agentList) {
    const skillsDir = path.join(workspace, 'skills');
    try {
      if (!fs.existsSync(skillsDir)) continue;
      const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const d of skillDirs) {
        if (d.isDirectory()) {
          const existing = map.get(d.name) || [];
          existing.push(id);
          map.set(d.name, existing);
        }
      }
    } catch {}
  }

  return map;
}

/**
 * Load configured skills from config file
 */
function loadConfiguredSkills(): ConfiguredSkill[] {
  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const config: SkillsConfig = JSON.parse(content);
    return config.skills || [];
  } catch {
    return [];
  }
}

/**
 * Scan all skills in the OpenClaw workspace.
 *
 * Hardened fork no longer depends on `data/configured-skills.json` (which
 * the upstream tenacitOS generated). Instead we enumerate every skill
 * directory under `OPENCLAW_SKILLS_DIR` (the host's `/data/.openclaw/skills/`,
 * mounted at `/workspace/skills` here), plus the per-agent skill dirs that
 * may exist under `<workspace>/workspace-infra/skills/`.
 *
 * If `data/configured-skills.json` is present, we still honour it as an
 * allowlist — useful for narrowing the visible set in the UI without
 * changing the volume.
 */
export function scanAllSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const seen = new Set<string>();

  const agentSkillMap = buildAgentSkillMap();

  const sources: Array<{ baseDir: string; source: 'system' | 'workspace' }> = [
    { baseDir: OPENCLAW_SKILLS_DIR, source: 'workspace' },
    { baseDir: DEFAULT_WORKSPACE_PATH, source: 'workspace' },
    { baseDir: DEFAULT_SYSTEM_PATH, source: 'system' },
  ];

  // Optional allowlist via configured-skills.json (kept for backwards compat).
  let allowlist: Set<string> | null = null;
  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const config: SkillsConfig = JSON.parse(content);
    if (Array.isArray(config?.skills) && config.skills.length > 0) {
      allowlist = new Set(config.skills.map((s) => s.name));
    }
  } catch {
    // No config — show everything.
  }

  for (const { baseDir } of sources) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(baseDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (seen.has(entry.name)) continue;
      if (allowlist && !allowlist.has(entry.name)) continue;

      const skillPath = path.join(baseDir, entry.name);
      const agents = agentSkillMap.get(entry.name) || [];
      const skill = parseSkill(skillPath, entry.name, agents);
      if (skill) {
        skills.push(skill);
        seen.add(entry.name);
      }
    }
  }

  skills.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'workspace' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return skills;
}
