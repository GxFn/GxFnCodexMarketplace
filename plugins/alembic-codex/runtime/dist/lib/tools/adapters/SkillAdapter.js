import fs from 'node:fs';
import path from 'node:path';
import { getProjectSkillsPath } from '../../infrastructure/config/Paths.js';
import { INJECTABLE_SKILLS_DIR } from '../../shared/package-root.js';
export class SkillAdapter {
    kind = 'skill';
    #builtinSkillsDir;
    constructor(options = {}) {
        this.#builtinSkillsDir = options.builtinSkillsDir ?? INJECTABLE_SKILLS_DIR;
    }
    async execute(request) {
        const startedAt = new Date();
        const startedMs = Date.now();
        try {
            const result = this.#execute(request);
            return envelopeForSkillResult(request, startedAt, startedMs, result.status, result.content);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return envelopeForSkillResult(request, startedAt, startedMs, 'error', {
                success: false,
                error: { code: 'SKILL_ADAPTER_ERROR', message },
            });
        }
    }
    #execute(request) {
        switch (request.manifest.id) {
            case 'skill_search':
                return { status: 'success', content: this.#search(request) };
            case 'skill_load':
                return this.#load(request);
            case 'skill_load_resource':
                return this.#loadResource(request);
            case 'skill_validate':
                return { status: 'success', content: this.#validate(request) };
            default:
                return {
                    status: 'blocked',
                    content: {
                        success: false,
                        error: {
                            code: 'UNKNOWN_SKILL_CAPABILITY',
                            message: `Unknown skill capability "${request.manifest.id}"`,
                        },
                    },
                };
        }
    }
    #search(request) {
        const query = normalizeOptionalString(request.args.query).toLowerCase();
        const source = normalizeSourceFilter(request.args.source);
        const skills = this.#listSkills(request, source)
            .map((skill) => summarizeSkill(skill))
            .filter((skill) => {
            if (!query) {
                return true;
            }
            return [skill.name, skill.description, ...(skill.triggers || [])]
                .join('\n')
                .toLowerCase()
                .includes(query);
        })
            .sort((a, b) => a.name.localeCompare(b.name));
        return {
            success: true,
            data: {
                skills,
                total: skills.length,
            },
        };
    }
    #load(request) {
        const name = normalizeRequiredSkillName(request.args.name);
        if (!name.ok) {
            return skillBlocked(name.error);
        }
        const skill = this.#resolveSkill(request, name.value);
        if (!skill) {
            return skillBlocked(`Skill "${name.value}" not found`, 'SKILL_NOT_FOUND');
        }
        const section = normalizeOptionalString(request.args.section);
        const content = section ? extractSection(skill.body, section) || '' : skill.content;
        return {
            status: 'success',
            content: {
                success: true,
                data: {
                    ...summarizeSkill(skill),
                    content,
                    charCount: content.length,
                    section: section || null,
                },
            },
        };
    }
    #loadResource(request) {
        const name = normalizeRequiredSkillName(request.args.name);
        if (!name.ok) {
            return skillBlocked(name.error);
        }
        const resource = normalizeResourcePath(request.args.resourcePath);
        if (!resource.ok) {
            return skillBlocked(resource.error);
        }
        const skill = this.#resolveSkill(request, name.value);
        if (!skill) {
            return skillBlocked(`Skill "${name.value}" not found`, 'SKILL_NOT_FOUND');
        }
        const absolute = path.resolve(skill.dir, resource.path);
        const relative = path.relative(skill.dir, absolute);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return skillBlocked('Skill resource path escapes the skill directory', 'SKILL_RESOURCE_OUTSIDE');
        }
        if (path.basename(absolute) === 'hooks.js') {
            return skillBlocked('Skill executable hook resources are not loadable', 'SKILL_RESOURCE_EXECUTABLE');
        }
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
            return skillBlocked(`Skill resource "${resource.path}" not found`, 'SKILL_RESOURCE_NOT_FOUND');
        }
        const content = fs.readFileSync(absolute, 'utf8');
        return {
            status: 'success',
            content: {
                success: true,
                data: {
                    skillName: skill.name,
                    source: skill.source,
                    resourcePath: relative,
                    content,
                    charCount: content.length,
                },
            },
        };
    }
    #validate(request) {
        const source = normalizeSourceFilter(request.args.source);
        const requestedName = normalizeOptionalString(request.args.name);
        const requestedSkill = requestedName ? this.#resolveSkill(request, requestedName) : null;
        const skills = requestedName
            ? requestedSkill
                ? [requestedSkill]
                : []
            : this.#listSkills(request, source);
        const results = skills.map((skill) => validateSkill(skill));
        const missing = requestedName && results.length === 0;
        return {
            success: !missing,
            data: {
                valid: !missing && results.every((result) => result.valid),
                results,
                total: results.length,
            },
            ...(missing
                ? {
                    error: {
                        code: 'SKILL_NOT_FOUND',
                        message: `Skill "${requestedName}" not found`,
                    },
                }
                : {}),
        };
    }
    #listSkills(request, source) {
        const skills = new Map();
        if (source === 'all' || source === 'builtin') {
            for (const skill of readSkillsFromDir(this.#builtinSkillsDir, 'builtin')) {
                skills.set(skill.name, skill);
            }
        }
        if (source === 'all' || source === 'project') {
            for (const skill of readSkillsFromDir(projectSkillsDir(request), 'project')) {
                skills.set(skill.name, skill);
            }
        }
        return [...skills.values()];
    }
    #resolveSkill(request, name) {
        return this.#listSkills(request, 'all').find((skill) => skill.name === name) || null;
    }
}
function readSkillsFromDir(baseDir, source) {
    if (!fs.existsSync(baseDir)) {
        return [];
    }
    return fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
        const dir = path.join(baseDir, entry.name);
        const skillPath = path.join(dir, 'SKILL.md');
        if (!fs.existsSync(skillPath)) {
            return [];
        }
        const content = fs.readFileSync(skillPath, 'utf8');
        const parsed = parseSkillDocument(content);
        return [
            {
                name: String(parsed.frontmatter.name || entry.name),
                source,
                dir,
                skillPath,
                content,
                frontmatter: parsed.frontmatter,
                body: parsed.body,
            },
        ];
    });
}
function parseSkillDocument(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) {
        return { frontmatter: {}, body: content };
    }
    return {
        frontmatter: parseFrontmatter(match[1]),
        body: match[2],
    };
}
function parseFrontmatter(raw) {
    const result = {};
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const separator = trimmed.indexOf(':');
        if (separator === -1) {
            continue;
        }
        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim();
        result[key] = parseFrontmatterValue(value);
    }
    return result;
}
function parseFrontmatterValue(value) {
    const unquoted = value.replace(/^["']|["']$/g, '');
    if (unquoted.startsWith('[') && unquoted.endsWith(']')) {
        return unquoted
            .slice(1, -1)
            .split(',')
            .map((item) => item.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean);
    }
    return unquoted;
}
function summarizeSkill(skill) {
    return {
        name: skill.name,
        source: skill.source,
        description: stringField(skill.frontmatter.description) || skill.name,
        version: stringField(skill.frontmatter.version) || null,
        status: stringField(skill.frontmatter.status) || 'active',
        triggers: stringArrayField(skill.frontmatter.triggers),
        requiresTools: stringArrayField(skill.frontmatter.requiresTools),
        permissions: stringArrayField(skill.frontmatter.permissions),
    };
}
function validateSkill(skill) {
    const errors = [];
    const summary = summarizeSkill(skill);
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(summary.name)) {
        errors.push('name must match /^[A-Za-z0-9._-]{1,80}$/');
    }
    if (!summary.description) {
        errors.push('description is required');
    }
    if (summary.status && !['active', 'draft', 'deprecated'].includes(summary.status)) {
        errors.push('status must be active, draft, or deprecated');
    }
    for (const field of ['triggers', 'requiresTools', 'permissions']) {
        if (!Array.isArray(summary[field])) {
            errors.push(`${field} must be an array when provided`);
        }
    }
    return {
        ...summary,
        valid: errors.length === 0,
        errors,
    };
}
function extractSection(content, section) {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = content.match(new RegExp(`^##\\s+.*${escaped}.*$\\n([\\s\\S]*?)(?=^##\\s|$)`, 'mi'));
    return match?.[0] ?? null;
}
function projectSkillsDir(request) {
    return getProjectSkillsPath(request.context.dataRoot || request.context.runtime?.dataRoot || request.context.projectRoot);
}
function normalizeOptionalString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeRequiredSkillName(value) {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
        return { ok: false, error: 'Skill name is required' };
    }
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(normalized)) {
        return { ok: false, error: 'Skill name contains unsupported characters' };
    }
    return { ok: true, value: normalized };
}
function normalizeResourcePath(value) {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
        return { ok: false, error: 'resourcePath is required' };
    }
    if (path.isAbsolute(normalized) || normalized.split(/[\\/]/).includes('..')) {
        return { ok: false, error: 'resourcePath must be relative to the Skill directory' };
    }
    return { ok: true, path: normalized };
}
function normalizeSourceFilter(value) {
    return value === 'builtin' || value === 'project' ? value : 'all';
}
function stringField(value) {
    return typeof value === 'string' ? value : '';
}
function stringArrayField(value) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string')
        : [];
}
function skillBlocked(message, code = 'SKILL_REQUEST_INVALID') {
    return {
        status: 'blocked',
        content: {
            success: false,
            error: { code, message },
        },
    };
}
function envelopeForSkillResult(request, startedAt, startedMs, status, structuredContent) {
    const success = structuredContent.success !== false && status === 'success';
    const message = extractMessage(structuredContent) ||
        (success ? 'Skill capability completed.' : 'Skill capability failed.');
    return {
        ok: success,
        toolId: request.manifest.id,
        callId: request.context.callId,
        parentCallId: request.context.parentCallId,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedMs,
        status,
        text: message,
        structuredContent,
        diagnostics: {
            degraded: false,
            fallbackUsed: false,
            warnings: success
                ? []
                : [{ code: 'skill_adapter_error', message, tool: request.manifest.id }],
            timedOutStages: [],
            blockedTools: status === 'blocked' ? [{ tool: request.manifest.id, reason: message }] : [],
            truncatedToolCalls: 0,
            emptyResponses: 0,
            aiErrorCount: 0,
            gateFailures: status === 'blocked' ? [{ stage: 'execute', action: 'skill-policy', reason: message }] : [],
        },
        trust: {
            source: 'skill',
            sanitized: true,
            containsUntrustedText: request.manifest.externalTrust?.outputContainsUntrustedText ?? true,
            containsSecrets: false,
        },
    };
}
function extractMessage(content) {
    const error = content.error;
    if (typeof error?.message === 'string') {
        return error.message;
    }
    if (typeof content.message === 'string') {
        return content.message;
    }
    return null;
}
