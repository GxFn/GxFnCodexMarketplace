/**
 * PanoramaModule — DI 注册
 *
 * 注册全景服务到 ServiceContainer:
 *   - moduleDiscoverer
 *   - roleRefiner
 *   - couplingAnalyzer
 *   - layerInferrer
 *   - panoramaAggregator
 *   - panoramaScanner
 *   - panoramaService
 *
 * @module PanoramaModule
 */
import { CouplingAnalyzer } from '../../service/panorama/CouplingAnalyzer.js';
import { DimensionAnalyzer } from '../../service/panorama/DimensionAnalyzer.js';
import { LayerInferrer } from '../../service/panorama/LayerInferrer.js';
import { ModuleDiscoverer } from '../../service/panorama/ModuleDiscoverer.js';
import { PanoramaAggregator } from '../../service/panorama/PanoramaAggregator.js';
import { PanoramaScanner } from '../../service/panorama/PanoramaScanner.js';
import { PanoramaService } from '../../service/panorama/PanoramaService.js';
import { RoleRefiner } from '../../service/panorama/RoleRefiner.js';
export const PanoramaModule = {
    register(container) {
        const ct = container;
        const getProjectRoot = () => ct.config?.projectRoot ?? process.cwd();
        const getBootstrapRepo = () => container.get('bootstrapRepository');
        const getEntityRepo = () => container.get('codeEntityRepository');
        const getEdgeRepo = () => container.get('knowledgeEdgeRepository');
        const getKnowledgeRepo = () => container.get('knowledgeRepository');
        ct.singleton('moduleDiscoverer', () => new ModuleDiscoverer(getEntityRepo(), getEdgeRepo(), getProjectRoot()));
        ct.singleton('roleRefiner', () => new RoleRefiner(getBootstrapRepo(), getEntityRepo(), getEdgeRepo(), getProjectRoot()));
        ct.singleton('couplingAnalyzer', () => new CouplingAnalyzer(getEdgeRepo(), getEntityRepo(), getProjectRoot()));
        ct.singleton('layerInferrer', () => new LayerInferrer());
        ct.singleton('dimensionAnalyzer', () => new DimensionAnalyzer(getBootstrapRepo(), getEntityRepo(), getKnowledgeRepo(), getProjectRoot()));
        ct.singleton('panoramaAggregator', (c) => {
            const sc = c;
            const roleRefiner = sc.get('roleRefiner');
            const couplingAnalyzer = sc.get('couplingAnalyzer');
            const layerInferrer = sc.get('layerInferrer');
            const dimensionAnalyzer = sc.get('dimensionAnalyzer');
            return new PanoramaAggregator({
                roleRefiner,
                couplingAnalyzer,
                layerInferrer,
                bootstrapRepo: getBootstrapRepo(),
                entityRepo: getEntityRepo(),
                edgeRepo: getEdgeRepo(),
                knowledgeRepo: getKnowledgeRepo(),
                projectRoot: getProjectRoot(),
                dimensionAnalyzer,
            });
        });
        ct.singleton('panoramaScanner', () => {
            const logger = (ct.singletons.logger ?? {
                info() { },
                warn() { },
            });
            return new PanoramaScanner({
                projectRoot: getProjectRoot(),
                container: container,
                entityRepo: getEntityRepo(),
                edgeRepo: getEdgeRepo(),
                logger,
            });
        });
        ct.singleton('panoramaService', (c) => {
            const sc = c;
            const aggregator = sc.get('panoramaAggregator');
            const scanner = sc.get('panoramaScanner');
            const moduleDiscoverer = sc.get('moduleDiscoverer');
            return new PanoramaService({
                aggregator,
                edgeRepo: getEdgeRepo(),
                knowledgeRepo: getKnowledgeRepo(),
                projectRoot: getProjectRoot(),
                scanner,
                moduleDiscoverer,
            });
        });
    },
};
