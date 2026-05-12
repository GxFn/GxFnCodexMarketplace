export function summarizePanorama(panoramaResult) {
    if (!panoramaResult || typeof panoramaResult !== 'object') {
        return null;
    }
    const result = panoramaResult;
    const moduleMap = result.modules;
    const layers = result.layers;
    const gaps = result.gaps ?? [];
    const cycles = result.cycles ?? [];
    const couplingHotspots = [];
    if (moduleMap) {
        const entries = moduleMap instanceof Map
            ? [...moduleMap.values()]
            : Object.values(moduleMap);
        for (const mod of entries) {
            if ((mod.fanIn || 0) >= 10 || (mod.fanOut || 0) >= 10) {
                couplingHotspots.push({
                    name: mod.name || '',
                    fanIn: mod.fanIn || 0,
                    fanOut: mod.fanOut || 0,
                });
            }
        }
    }
    return {
        layers: layers?.levels?.slice(0, 10) ?? [],
        couplingHotspots: couplingHotspots.slice(0, 10),
        cyclicDependencies: cycles.slice(0, 10).map((cycle) => cycle.modules),
        knowledgeGaps: gaps.slice(0, 20).map((gap) => ({
            module: gap.module,
            suggestedFocus: gap.suggestedFocus,
        })),
    };
}
