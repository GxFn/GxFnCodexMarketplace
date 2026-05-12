/**
 * AppModule — 应用层杂项服务注册
 *
 * 负责注册:
 *   - recipeParser, recipeCandidateValidator
 *   - qualityScorer, feedbackCollector, tokenUsageStore, recipeExtractor
 *   - moduleService, cursorDeliveryPipeline
 *   - primeSearchPipeline (for prime multi-query search — no DB dependency)
 */
import { resolveDataRoot, resolveProjectRoot } from '#shared/resolveProjectRoot.js';
import { unwrapRawDb } from '../../repository/search/SearchRepoAdapter.js';
import { TokenUsageStore } from '../../repository/token/TokenUsageStore.js';
import { CursorDeliveryPipeline } from '../../service/delivery/CursorDeliveryPipeline.js';
import { RecipeExtractor } from '../../service/knowledge/RecipeExtractor.js';
import { ModuleService } from '../../service/module/ModuleService.js';
import { FeedbackCollector } from '../../service/quality/FeedbackCollector.js';
import { QualityScorer } from '../../service/quality/QualityScorer.js';
import { RecipeCandidateValidator } from '../../service/recipe/RecipeCandidateValidator.js';
import { RecipeParser } from '../../service/recipe/RecipeParser.js';
import { PrimeSearchPipeline } from '../../service/task/PrimeSearchPipeline.js';
export function register(c) {
    // ═══ Quality + Recipe ═══
    c.singleton('qualityScorer', () => new QualityScorer());
    c.singleton('recipeParser', () => new RecipeParser());
    c.singleton('recipeCandidateValidator', () => new RecipeCandidateValidator());
    c.register('recipeExtractor', () => c.singletons._recipeExtractor || null);
    c.singleton('feedbackCollector', (ct) => {
        const dataRoot = resolveDataRoot(ct);
        const wz = ct.singletons.writeZone;
        return new FeedbackCollector(dataRoot, {
            wz,
        });
    });
    c.singleton('tokenUsageStore', (ct) => {
        const db = ct.get('database');
        return new TokenUsageStore(unwrapRawDb(db), db.getDrizzle());
    });
    // ═══ Module ═══
    c.singleton('moduleService', (ct) => {
        const projectRoot = resolveProjectRoot(ct);
        return new ModuleService(projectRoot, {
            agentService: ct.get('agentService'),
            systemRunContextFactory: ct.get('systemRunContextFactory'),
            container: ct,
            qualityScorer: ct.get('qualityScorer'),
            recipeExtractor: ct.singletons._recipeExtractor || null,
            guardCheckEngine: ct.get('guardCheckEngine'),
            violationsStore: ct.get('violationsStore'),
        });
    });
    c.singleton('cursorDeliveryPipeline', (ct) => new CursorDeliveryPipeline({
        knowledgeService: ct.get('knowledgeService'),
        projectRoot: resolveProjectRoot(ct),
        dataRoot: resolveDataRoot(ct),
        database: ct.get('database'),
        logger: ct.logger,
        wz: ct.singletons.writeZone,
    }));
    // ═══ PrimeSearchPipeline (for prime multi-query search) ═══
    c.singleton('primeSearchPipeline', (ct) => new PrimeSearchPipeline(ct.get('searchEngine')));
}
/** 初始化 RecipeExtractor 实例 (在 initialize 期间调用) */
export function initRecipeExtractor(c) {
    c.singletons._recipeExtractor = new RecipeExtractor();
}
