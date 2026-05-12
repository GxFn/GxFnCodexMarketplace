/**
 * SandboxRunner — 工具锻造沙箱验证
 *
 * 在受限环境中执行锻造的工具代码 + 测试用例，验证安全性和正确性。
 * 使用 Node.js vm 模块提供隔离执行环境。
 *
 * 安全约束：
 *   - 5s 执行超时
 *   - 禁止 require/import (无文件系统 / 网络 / 子进程)
 *   - 内存限制 via vm 上下文隔离
 *   - 只暴露 console.log, JSON, Math, Date, Array, Object, String 等纯函数
 */
import { createContext, runInContext } from 'node:vm';
import Logger from '#infra/logging/Logger.js';
/* ────────────────────── Constants ────────────────────── */
const EXECUTION_TIMEOUT_MS = 5000;
/** 禁止使用的模式 */
const FORBIDDEN_PATTERNS = [
    /\brequire\s*\(/,
    /\bimport\s*\(/,
    /\bprocess\b/,
    /\b__dirname\b/,
    /\b__filename\b/,
    /\bglobal\b/,
    /\bglobalThis\b/,
    /\beval\s*\(/,
    /\bFunction\s*\(/,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bchild_process\b/,
    /\bfs\b\./,
    /\bnet\b\./,
    /\bhttp\b\./,
    /\bhttps\b\./,
];
/* ────────────────────── Class ────────────────────── */
export class SandboxRunner {
    #logger = Logger.getInstance();
    /**
     * 对工具代码进行安全检查
     */
    checkSafety(code) {
        const violations = [];
        for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.test(code)) {
                violations.push(`Forbidden pattern detected: ${pattern.source}`);
            }
        }
        return { passed: violations.length === 0, violations };
    }
    /**
     * 在沙箱中执行工具代码 + 测试用例
     *
     * @param code 工具函数代码（应 export default 或赋给 __toolHandler__）
     * @param testCases 测试用例
     */
    run(code, testCases) {
        const start = Date.now();
        // 1. 安全检查
        const safetyCheck = this.checkSafety(code);
        if (!safetyCheck.passed) {
            return {
                success: false,
                testResults: [],
                executionTime: Date.now() - start,
                safetyCheck,
            };
        }
        // 2. 构建沙箱上下文 — 只暴露安全的全局对象
        const logs = [];
        const sandbox = createContext({
            console: {
                log: (...args) => logs.push(args.map(String).join(' ')),
                warn: (...args) => logs.push(`[warn] ${args.map(String).join(' ')}`),
                error: (...args) => logs.push(`[error] ${args.map(String).join(' ')}`),
            },
            JSON,
            Math,
            Date,
            Array,
            Object,
            String,
            Number,
            Boolean,
            RegExp,
            Map,
            Set,
            Error,
            TypeError,
            RangeError,
            parseInt,
            parseFloat,
            isNaN,
            isFinite,
            encodeURIComponent,
            decodeURIComponent,
            // 工具函数占位，由代码赋值
            __toolHandler__: null,
        });
        // 3. 加载工具代码
        try {
            const wrappedCode = `${code}\n;(typeof toolHandler !== 'undefined') && (__toolHandler__ = toolHandler);`;
            runInContext(wrappedCode, sandbox, {
                timeout: EXECUTION_TIMEOUT_MS,
                filename: 'forged-tool.js',
            });
        }
        catch (err) {
            return {
                success: false,
                testResults: [
                    {
                        description: 'Code loading',
                        passed: false,
                        error: `Failed to load tool code: ${err.message}`,
                    },
                ],
                executionTime: Date.now() - start,
                safetyCheck,
            };
        }
        const handler = sandbox.__toolHandler__;
        if (typeof handler !== 'function') {
            return {
                success: false,
                testResults: [
                    {
                        description: 'Handler check',
                        passed: false,
                        error: 'Tool code must define a `toolHandler` function',
                    },
                ],
                executionTime: Date.now() - start,
                safetyCheck,
            };
        }
        // 4. 执行测试用例
        const testResults = [];
        let allPassed = true;
        for (const tc of testCases) {
            try {
                const testCode = `__toolHandler__(${JSON.stringify(tc.input)})`;
                const actual = runInContext(testCode, sandbox, {
                    timeout: EXECUTION_TIMEOUT_MS,
                    filename: 'forged-tool-test.js',
                });
                const passed = SandboxRunner.#deepEqual(actual, tc.expectedOutput);
                if (!passed) {
                    allPassed = false;
                }
                testResults.push({
                    description: tc.description,
                    passed,
                    actualOutput: actual,
                    error: passed
                        ? undefined
                        : `Expected ${JSON.stringify(tc.expectedOutput)}, got ${JSON.stringify(actual)}`,
                });
            }
            catch (err) {
                allPassed = false;
                testResults.push({
                    description: tc.description,
                    passed: false,
                    error: err.message,
                });
            }
        }
        this.#logger.debug(`SandboxRunner: ${testResults.filter((t) => t.passed).length}/${testResults.length} tests passed`);
        return {
            success: allPassed,
            testResults,
            executionTime: Date.now() - start,
            safetyCheck,
        };
    }
    /**
     * 从验证通过的代码创建可调用 handler
     * 返回的 handler 每次调用都在新沙箱中执行（隔离）
     */
    createHandler(code) {
        return async (params) => {
            const sandbox = createContext({
                console: { log: () => { }, warn: () => { }, error: () => { } },
                JSON,
                Math,
                Date,
                Array,
                Object,
                String,
                Number,
                Boolean,
                RegExp,
                Map,
                Set,
                Error,
                TypeError,
                RangeError,
                parseInt,
                parseFloat,
                isNaN,
                isFinite,
                encodeURIComponent,
                decodeURIComponent,
                __toolHandler__: null,
            });
            const wrappedCode = `${code}\n;(typeof toolHandler !== 'undefined') && (__toolHandler__ = toolHandler);`;
            runInContext(wrappedCode, sandbox, {
                timeout: EXECUTION_TIMEOUT_MS,
                filename: 'forged-tool.js',
            });
            const handler = sandbox.__toolHandler__;
            if (typeof handler !== 'function') {
                throw new Error('Forged tool code does not define a toolHandler function');
            }
            const execCode = `__toolHandler__(${JSON.stringify(params)})`;
            const result = runInContext(execCode, sandbox, {
                timeout: EXECUTION_TIMEOUT_MS,
                filename: 'forged-tool-exec.js',
            });
            // 如果返回 Promise-like，需特殊处理（vm 里一般不会有真正的 Promise）
            return result;
        };
    }
    /** 简单深度比较 */
    static #deepEqual(a, b) {
        if (a === b) {
            return true;
        }
        if (a === null || b === null || typeof a !== typeof b) {
            return false;
        }
        if (typeof a !== 'object') {
            return false;
        }
        const aObj = a;
        const bObj = b;
        const keysA = Object.keys(aObj);
        const keysB = Object.keys(bObj);
        if (keysA.length !== keysB.length) {
            return false;
        }
        for (const key of keysA) {
            if (!SandboxRunner.#deepEqual(aObj[key], bObj[key])) {
                return false;
            }
        }
        return true;
    }
}
