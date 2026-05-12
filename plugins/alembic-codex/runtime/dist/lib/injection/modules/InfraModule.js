/**
 * InfraModule — 基础设施 + 仓储注册
 *
 * 负责注册:
 *   - database, logger, auditStore, auditLogger
 *   - gateway, eventBus, bootstrapTaskManager
 *   - knowledgeRepository, knowledgeFileWriter, knowledgeSyncService
 */
import path from 'node:path';
import { resolveDataRoot, resolveProjectRoot } from '#shared/resolveProjectRoot.js';
import { KnowledgeSyncService } from '../../cli/KnowledgeSyncService.js';
import Gateway from '../../core/gateway/Gateway.js';
import { JobStore } from '../../daemon/JobStore.js';
import AuditLogger from '../../infrastructure/audit/AuditLogger.js';
import AuditStore from '../../infrastructure/audit/AuditStore.js';
import { EventBus } from '../../infrastructure/event/EventBus.js';
import { WriteZone } from '../../infrastructure/io/WriteZone.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { getRealtimeService as _getRealtimeService } from '../../infrastructure/realtime/RealtimeService.js';
import { ReportStore } from '../../infrastructure/report/ReportStore.js';
import { AuditRepositoryImpl } from '../../repository/audit/AuditRepository.js';
import { BootstrapRepositoryImpl } from '../../repository/bootstrap/BootstrapRepository.js';
import { CodeEntityRepositoryImpl } from '../../repository/code/CodeEntityRepository.js';
import { ProposalRepository } from '../../repository/evolution/ProposalRepository.js';
import { GuardViolationRepositoryImpl } from '../../repository/guard/GuardViolationRepository.js';
import { KnowledgeEdgeRepositoryImpl } from '../../repository/knowledge/KnowledgeEdgeRepository.js';
import { KnowledgeRepositoryImpl } from '../../repository/knowledge/KnowledgeRepository.impl.js';
import { MemoryRepositoryImpl } from '../../repository/memory/MemoryRepository.js';
import { RemoteCommandRepository } from '../../repository/remote/RemoteCommandRepository.js';
import { unwrapRawDb } from '../../repository/search/SearchRepoAdapter.js';
import { SessionRepositoryImpl } from '../../repository/session/SessionRepository.js';
import { RecipeSourceRefRepositoryImpl } from '../../repository/sourceref/RecipeSourceRefRepository.js';
import { BootstrapTaskManager } from '../../service/bootstrap/BootstrapTaskManager.js';
import { KnowledgeFileWriter } from '../../service/knowledge/KnowledgeFileWriter.js';
export function register(c) {
    // ═══ Infrastructure ═══
    c.register('database', () => {
        if (!c.singletons.database) {
            throw new Error('Database not initialized. Ensure Bootstrap.initialize() is called before using ServiceContainer.');
        }
        return c.singletons.database;
    });
    c.register('logger', () => Logger.getInstance());
    c.singleton('auditStore', (ct) => {
        const db = ct.get('database');
        const drizzle = db.getDrizzle();
        return new AuditStore(db, drizzle);
    });
    c.singleton('auditLogger', (ct) => new AuditLogger(ct.get('auditStore'), ct.services.eventBus
        ? ct.get('eventBus')
        : null));
    c.singleton('gateway', () => new Gateway());
    c.singleton('eventBus', () => new EventBus({ maxListeners: 30 }));
    c.singleton('bootstrapTaskManager', (ct) => {
        const eventBus = ct.get('eventBus');
        const getRS = () => {
            try {
                return _getRealtimeService();
            }
            catch {
                return null;
            }
        };
        return new BootstrapTaskManager({
            eventBus,
            getRealtimeService: getRS,
        });
    });
    c.singleton('jobStore', (ct) => {
        return new JobStore({ projectRoot: resolveProjectRoot(ct) });
    });
    // ═══ WriteZone ═══
    c.singleton('writeZone', (ct) => {
        const resolver = ct.singletons._workspaceResolver;
        if (!resolver) {
            return null;
        }
        return new WriteZone(resolver);
    });
    // ═══ Repositories ═══
    c.singleton('knowledgeRepository', (ct) => {
        const db = ct.get('database');
        const drizzle = db.getDrizzle();
        return new KnowledgeRepositoryImpl(db, drizzle);
    });
    c.singleton('knowledgeEdgeRepository', (ct) => {
        const db = ct.get('database');
        const drizzle = db.getDrizzle();
        return new KnowledgeEdgeRepositoryImpl(drizzle);
    });
    c.singleton('codeEntityRepository', (ct) => {
        const db = ct.get('database');
        const drizzle = db.getDrizzle();
        return new CodeEntityRepositoryImpl(drizzle);
    });
    c.singleton('bootstrapRepository', (ct) => {
        const db = ct.get('database');
        const drizzle = db.getDrizzle();
        return new BootstrapRepositoryImpl(drizzle);
    });
    c.singleton('guardViolationRepository', (ct) => {
        const db = ct.get('database');
        const drizzle = db.getDrizzle();
        return new GuardViolationRepositoryImpl(drizzle);
    });
    c.singleton('auditRepository', (ct) => {
        const db = ct.get('database');
        const drizzle = db.getDrizzle();
        return new AuditRepositoryImpl(drizzle);
    });
    c.singleton('memoryRepository', (ct) => {
        const db = ct.get('database');
        const drizzle = db.getDrizzle();
        return new MemoryRepositoryImpl(drizzle);
    });
    c.singleton('sessionRepository', (ct) => {
        const db = ct.get('database');
        const drizzle = db.getDrizzle();
        return new SessionRepositoryImpl(drizzle);
    });
    c.singleton('proposalRepository', (ct) => {
        const db = ct.get('database');
        const drizzle = db.getDrizzle();
        return new ProposalRepository(drizzle);
    });
    c.singleton('remoteCommandRepository', (ct) => {
        const db = ct.get('database');
        return new RemoteCommandRepository(unwrapRawDb(db), db.getDrizzle());
    });
    c.singleton('recipeSourceRefRepository', (ct) => {
        const db = ct.get('database');
        const drizzle = db.getDrizzle();
        return new RecipeSourceRefRepositoryImpl(drizzle);
    });
    c.singleton('knowledgeFileWriter', (ct) => {
        const dataRoot = resolveDataRoot(ct);
        const wz = ct.singletons.writeZone;
        return new KnowledgeFileWriter(dataRoot, wz);
    });
    c.singleton('knowledgeSyncService', (ct) => {
        const dataRoot = resolveDataRoot(ct);
        const sourceRefReconciler = ct.singletons.sourceRefReconciler;
        return new KnowledgeSyncService(dataRoot, {
            sourceRefReconciler: sourceRefReconciler || undefined,
        });
    });
    // ═══ ReportStore ═══
    c.singleton('reportStore', (ct) => {
        const dataRoot = resolveDataRoot(ct);
        const wz = ct.get('writeZone');
        return new ReportStore(path.join(dataRoot, '.asd', 'logs', 'reports'), wz ?? undefined);
    });
}
