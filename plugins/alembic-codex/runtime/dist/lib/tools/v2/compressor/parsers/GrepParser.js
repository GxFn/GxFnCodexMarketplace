/**
 * @module tools/v2/compressor/parsers/GrepParser
 * 解析 rg/grep 输出为紧凑结构化格式。
 */
const MAX_MATCHES = 30;
const GREP_LINE_RE = /^(.+?):(\d+):(.+)$/;
function tryJsonFormat(raw) {
    const lines = raw.split('\n').filter((l) => l.trim().startsWith('{'));
    if (lines.length === 0) {
        return null;
    }
    const matches = [];
    let parsed = 0;
    for (const line of lines) {
        try {
            const obj = JSON.parse(line);
            if (obj.type === 'match' && obj.data) {
                parsed++;
                const d = obj.data;
                const file = d.path?.text ?? d.path?.bytes ?? '';
                const lineNum = d.line_number?.toString() ?? '0';
                const text = d.lines?.text?.trim() ?? d.lines?.bytes?.trim() ?? '';
                matches.push({ file, line: lineNum, content: text });
            }
            else if (obj.type === 'summary' ||
                obj.type === 'begin' ||
                obj.type === 'end' ||
                obj.type === 'context') {
                parsed++;
            }
        }
        catch { }
    }
    return parsed > 0 ? matches : null;
}
function tryPlainFormat(raw) {
    const matches = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === '--') {
            continue;
        }
        const m = GREP_LINE_RE.exec(trimmed);
        if (m) {
            matches.push({
                file: m[1],
                line: m[2],
                content: m[3].trim(),
            });
        }
    }
    return matches;
}
function dedup(matches) {
    const seen = new Set();
    const result = [];
    for (const m of matches) {
        const key = `${m.file}:${m.line}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(m);
    }
    return result;
}
/** 尝试解析 raw 输出，失败返回 null */
export function parse(raw) {
    try {
        if (!raw || raw.trim().length === 0) {
            return null;
        }
        let matches = tryJsonFormat(raw);
        if (!matches) {
            const plain = tryPlainFormat(raw);
            if (plain.length === 0) {
                return null;
            }
            matches = plain;
        }
        matches = dedup(matches);
        const totalCount = matches.length;
        const files = new Set(matches.map((m) => m.file));
        const shown = Math.min(totalCount, MAX_MATCHES);
        const displayed = matches.slice(0, MAX_MATCHES);
        const parts = [`${totalCount} matches in ${files.size} files (showing ${shown})`, ''];
        for (const m of displayed) {
            parts.push(`${m.file}:${m.line}: ${m.content}`);
        }
        return parts.join('\n');
    }
    catch {
        return null;
    }
}
