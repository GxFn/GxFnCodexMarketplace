/**
 * roleResolver 中间件 — 双路径角色解析
 *
 * 根据运行模式决定当前请求的 actor（角色）：
 *
 *   AUTH_ENABLED=true  → 从 Authorization Bearer token 中解析角色
 *   AUTH_ENABLED=false → 从子仓库探针结果决定角色，交给 Constitution
 *
 * 中间件注入 req.resolvedRole 供 gatewayMiddleware 使用。
 */
import Logger from '../../infrastructure/logging/Logger.js';
const logger = Logger.getInstance();
const AUTH_ENABLED = process.env.VITE_AUTH_ENABLED === 'true' || process.env.ALEMBIC_AUTH_ENABLED === 'true';
const TRUST_X_USER_ID = process.env.ALEMBIC_TRUST_X_USER_ID === 'true';
let _verifyToken = null;
async function getVerifyToken() {
    if (!_verifyToken) {
        try {
            const authModule = await import('../routes/auth.js');
            _verifyToken = authModule.verifyToken;
        }
        catch {
            // auth 模块不可用时，返回 always-null 的 stub
            _verifyToken = () => null;
        }
    }
    return _verifyToken;
}
function getHeaderValue(value) {
    if (Array.isArray(value)) {
        return value[0] || '';
    }
    return value || '';
}
function hasTrustedInternalToken(req) {
    const expected = process.env.ALEMBIC_INTERNAL_TOKEN;
    if (!expected) {
        return false;
    }
    return getHeaderValue(req.headers['x-alembic-internal-token']) === expected;
}
function getTrustedHeaderRole(req) {
    const role = getHeaderValue(req.headers['x-user-id']);
    if (!role || role === 'anonymous' || role === 'dashboard') {
        return null;
    }
    if (!TRUST_X_USER_ID && !hasTrustedInternalToken(req)) {
        logger.warn('roleResolver: ignored untrusted x-user-id header', { role });
        return null;
    }
    return role;
}
/** 创建双路径角色解析中间件 */
export function roleResolverMiddleware(options = {}) {
    const { capabilityProbe } = options;
    // 预加载 verifyToken（异步但不阻塞中间件注册）
    const verifyTokenPromise = getVerifyToken();
    return (req, _res, next) => {
        // x-user-id 仅在显式可信内部通道中生效，避免外部 HTTP 客户端自报身份。
        const trustedHeaderRole = getTrustedHeaderRole(req);
        if (trustedHeaderRole) {
            req.resolvedRole = trustedHeaderRole;
            req.resolvedUser = `header:${trustedHeaderRole}`;
            next();
            return;
        }
        if (AUTH_ENABLED) {
            // ── Path A: Token-based ────────────────────
            const authHeader = req.headers.authorization || '';
            const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
            verifyTokenPromise
                .then((verifyToken) => {
                const payload = verifyToken(token);
                if (payload?.role) {
                    req.resolvedRole = payload.role;
                    req.resolvedUser = payload.sub;
                    logger.debug('roleResolver: token-based', { role: payload.role, user: payload.sub });
                }
                else {
                    // Token 无效/缺失 → visitor（只读）
                    req.resolvedRole = 'visitor';
                    req.resolvedUser = 'anonymous';
                }
                logger.debug('roleResolver: resolved', {
                    mode: 'token',
                    role: req.resolvedRole,
                    user: req.resolvedUser,
                });
                next();
            })
                .catch(() => {
                req.resolvedRole = 'visitor';
                req.resolvedUser = 'anonymous';
                next();
            });
        }
        else {
            // ── Path B: Probe-based ────────────────────
            if (capabilityProbe) {
                try {
                    req.resolvedRole = capabilityProbe.probeRole();
                    req.resolvedUser = `probe:${capabilityProbe.probe()}`;
                }
                catch (err) {
                    logger.warn('roleResolver: probe failed, defaulting to visitor', {
                        error: err.message,
                    });
                    req.resolvedRole = 'visitor';
                    req.resolvedUser = 'anonymous';
                }
            }
            else {
                // 无探针实例 → 本地开发默认 admin（向后兼容）
                req.resolvedRole = 'developer';
                req.resolvedUser = 'local';
            }
            logger.debug('roleResolver: resolved', {
                mode: 'probe',
                role: req.resolvedRole,
                user: req.resolvedUser,
            });
            next();
        }
    };
}
export default roleResolverMiddleware;
