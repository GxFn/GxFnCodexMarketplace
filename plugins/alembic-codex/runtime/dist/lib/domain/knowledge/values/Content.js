export class Content {
    codeChanges;
    markdown;
    pattern;
    rationale;
    steps;
    verification;
    constructor(props = {}) {
        /** 代码片段 */
        this.pattern = props.pattern ?? '';
        /** Markdown 全文（与 pattern 二选一） */
        this.markdown = props.markdown ?? '';
        /** 设计原理 */
        this.rationale = props.rationale ?? '';
        /** >} 实施步骤 */
        this.steps = props.steps ?? [];
        /** >} 代码变更 */
        this.codeChanges = props.codeChanges ?? [];
        /** } 验证方式 */
        this.verification = props.verification ?? null;
    }
    /** 从任意输入构造 Content */
    static from(input) {
        if (input instanceof Content) {
            return input;
        }
        if (!input) {
            return new Content();
        }
        if (typeof input === 'string') {
            try {
                input = JSON.parse(input);
            }
            catch {
                return new Content();
            }
        }
        return new Content(input);
    }
    /** 是否包含有效内容 */
    hasContent() {
        return !!(this.pattern || this.markdown || this.rationale || this.steps.length > 0);
    }
    /** 转换为 wire format JSON */
    toJSON() {
        return {
            pattern: this.pattern,
            markdown: this.markdown,
            rationale: this.rationale,
            steps: this.steps,
            codeChanges: this.codeChanges,
            verification: this.verification,
        };
    }
    /** 从 wire format 创建 */
    static fromJSON(data) {
        return new Content(data);
    }
}
export default Content;
