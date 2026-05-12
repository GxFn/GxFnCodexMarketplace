export function extractCodeEntities(astProjectSummary) {
    const entities = [];
    if (!astProjectSummary) {
        return entities;
    }
    for (const cls of astProjectSummary.classes || []) {
        entities.push({ name: cls.name, kind: 'class', file: cls.relativePath || cls.file });
    }
    for (const proto of astProjectSummary.protocols || []) {
        entities.push({ name: proto.name, kind: 'protocol', file: proto.relativePath || proto.file });
    }
    if (astProjectSummary.categories) {
        for (const cat of astProjectSummary.categories) {
            entities.push({ name: cat.name || '', kind: 'category', file: cat.relativePath || cat.file });
        }
    }
    return entities;
}
export function extractDependencyEdges(depGraphData) {
    const edges = [];
    if (!depGraphData?.edges) {
        return edges;
    }
    for (const edge of depGraphData.edges) {
        if (edge.from && edge.to) {
            edges.push({ from: edge.from, to: edge.to });
        }
    }
    return edges;
}
