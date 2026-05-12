/**
 * GuardModule — Guard 服务注册
 *
 * 负责注册:
 *   - guardService, guardCheckEngine
 *   - exclusionManager, ruleLearner, violationsStore
 *   - complianceReporter, guardFeedbackLoop
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveDataRoot } from '#shared/resolveProjectRoot.js';
import { unwrapRawDb } from '../../repository/search/SearchRepoAdapter.js';
import { ComplianceReporter } from '../../service/guard/ComplianceReporter.js';
import { CoverageAnalyzer } from '../../service/guard/CoverageAnalyzer.js';
import { ExclusionManager } from '../../service/guard/ExclusionManager.js';
import { GuardCheckEngine } from '../../service/guard/GuardCheckEngine.js';
import { GuardFeedbackLoop } from '../../service/guard/GuardFeedbackLoop.js';
import { GuardService } from '../../service/guard/GuardService.js';
import { ReverseGuard } from '../../service/guard/ReverseGuard.js';
import { RuleLearner } from '../../service/guard/RuleLearner.js';
import { ViolationsStore } from '../../service/guard/ViolationsStore.js';
export function register(c) {
    c.singleton('guardService', (ct) => {
        let guardCheckEngine = null;
        try {
            guardCheckEngine = ct.get('guardCheckEngine');
        }
        catch {
            /* not yet available */
        }
        return new GuardService(ct.get('knowledgeRepository'), ct.get('auditLogger'), ct.get('gateway'), {
            guardCheckEngine,
        });
    });
    c.singleton('guardCheckEngine', (ct) => {
        const config = ct.singletons._config || {};
        // 基础配置（Alembic 自身 config/default.json）
        const baseGuard = config.guard || {};
        // 项目级覆盖（.asd/config.json 的 guard 段）
        let projectGuard = {};
        try {
            const dataRoot = resolveDataRoot(ct);
            const projConfigPath = path.join(dataRoot, '.asd', 'config.json');
            if (fs.existsSync(projConfigPath)) {
                const raw = JSON.parse(fs.readFileSync(projConfigPath, 'utf-8'));
                if (raw.guard && typeof raw.guard === 'object') {
                    projectGuard = raw.guard;
                }
            }
        }
        catch {
            /* 项目配置读取失败不阻塞 */
        }
        // 合并：项目级覆盖基础配置
        const merged = { ...baseGuard, ...projectGuard };
        if (baseGuard.codeLevelThresholds || projectGuard.codeLevelThresholds) {
            merged.codeLevelThresholds = {
                ...(baseGuard.codeLevelThresholds || {}),
                ...(projectGuard.codeLevelThresholds || {}),
            };
        }
        if (baseGuard.disabledRules || projectGuard.disabledRules) {
            const base = Array.isArray(baseGuard.disabledRules) ? baseGuard.disabledRules : [];
            const proj = Array.isArray(projectGuard.disabledRules) ? projectGuard.disabledRules : [];
            merged.disabledRules = [...new Set([...base, ...proj])];
        }
        return new GuardCheckEngine(ct.get('database'), {
            guardConfig: merged,
            signalBus: ct.singletons.signalBus || undefined,
            knowledgeRepo: ct.get('knowledgeRepository'),
        });
    });
    c.singleton('exclusionManager', (ct) => {
        const dataRoot = resolveDataRoot(ct);
        const wz = ct.singletons.writeZone;
        return new ExclusionManager(dataRoot, { wz });
    });
    c.singleton('ruleLearner', (ct) => {
        const dataRoot = resolveDataRoot(ct);
        const wz = ct.singletons.writeZone;
        return new RuleLearner(dataRoot, {
            signalBus: ct.singletons.signalBus || undefined,
            wz,
        });
    });
    c.singleton('violationsStore', (ct) => {
        const db = ct.get('database');
        return new ViolationsStore(unwrapRawDb(db), db.getDrizzle());
    });
    c.singleton('complianceReporter', (ct) => {
        const config = ct.singletons._config || {};
        return new ComplianceReporter(ct.get('guardCheckEngine'), ct.get('violationsStore'), ct.get('ruleLearner'), ct.get('exclusionManager'), config.qualityGate || {});
    });
    c.singleton('guardFeedbackLoop', (ct) => new GuardFeedbackLoop(ct.get('violationsStore'), ct.get('feedbackCollector'), {
        guardCheckEngine: ct.get('guardCheckEngine'),
        signalBus: ct.singletons.signalBus || undefined,
    }));
    c.singleton('reverseGuard', (ct) => {
        return new ReverseGuard(ct.get('knowledgeRepository'), ct.get('codeEntityRepository'), ct.get('recipeSourceRefRepository'), {
            signalBus: ct.singletons.signalBus || undefined,
        });
    });
    c.singleton('coverageAnalyzer', (ct) => {
        let ruleLearner;
        try {
            ruleLearner = { ruleLearner: ct.get('ruleLearner') };
        }
        catch {
            /* ruleLearner not yet available */
        }
        return new CoverageAnalyzer(ct.get('knowledgeRepository'), ct.get('guardViolationRepository'), ruleLearner);
    });
}
