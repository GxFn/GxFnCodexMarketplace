export class Constraints {
    boundaries;
    guards;
    preconditions;
    sideEffects;
    constructor(props = {}) {
        /** Guard 规则列表 */
        this.guards = (props.guards || []).map(Constraints._normalizeGuard);
        /** 边界约束 */
        this.boundaries = props.boundaries || [];
        /** 前置条件 */
        this.preconditions = props.preconditions || [];
        /** 副作用 */
        this.sideEffects = props.sideEffects ?? [];
    }
    /** 从任意输入构造 Constraints */
    static from(input) {
        if (input instanceof Constraints) {
            return input;
        }
        if (!input) {
            return new Constraints();
        }
        if (typeof input === 'string') {
            try {
                input = JSON.parse(input);
            }
            catch {
                return new Constraints();
            }
        }
        return new Constraints(input);
    }
    /** 标准化 Guard 对象 */
    static _normalizeGuard(g) {
        return {
            id: g.id || null,
            type: (g.type || (g.ast_query ? 'ast' : 'regex')),
            pattern: g.pattern || null,
            ast_query: g.ast_query || null,
            message: g.message || '',
            severity: (g.severity || 'warning'),
            fix_suggestion: g.fix_suggestion || null,
        };
    }
    /** 获取 regex 类型的 Guard 规则 */
    getRegexGuards() {
        return this.guards.filter((g) => g.type === 'regex' && g.pattern);
    }
    /** 获取 ast 类型的 Guard 规则 */
    getAstGuards() {
        return this.guards.filter((g) => g.type === 'ast' && g.ast_query);
    }
    /** 添加 Guard 规则 */
    addGuard(guard) {
        this.guards.push(Constraints._normalizeGuard(guard));
        return this;
    }
    /** 是否有 Guard 规则 */
    hasGuards() {
        return this.guards.length > 0;
    }
    /** 是否为空 */
    isEmpty() {
        return (this.guards.length === 0 &&
            this.boundaries.length === 0 &&
            this.preconditions.length === 0 &&
            this.sideEffects.length === 0);
    }
    /** 转换为 wire format JSON */
    toJSON() {
        return {
            guards: this.guards,
            boundaries: this.boundaries,
            preconditions: this.preconditions,
            sideEffects: this.sideEffects,
        };
    }
    /** 从 wire format 创建 */
    static fromJSON(data) {
        return Constraints.from(data);
    }
}
export default Constraints;
