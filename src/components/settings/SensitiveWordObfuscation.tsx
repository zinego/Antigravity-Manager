import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
    SensitiveWordObfuscationConfig,
    SensitiveWordObfuscationScope,
} from "../../types/config";

interface SensitiveWordObfuscationProps {
    config: SensitiveWordObfuscationConfig;
    onChange: (config: SensitiveWordObfuscationConfig) => void;
}

const DEFAULT_CONFIG: SensitiveWordObfuscationConfig = {
    enabled: false,
    scope: "system_instruction",
    sensitive_words: [],
};

// 预置常见易触发风控/审查的敏感词（与 CPA 生产规范对齐）
const CPA_PRESET_WORDS = [
    "proxy",
    "codex",
    "omp",
    "Claude",
    "Claude Code",
    "Claude Agent SDK",
    "Anthropic",
    "OpenAI",
    "Cursor",
    "Hermes Agent",
    "Nous Research",
    "system-conventions",
    "system_conventions",
    "system-directive",
    "system_directive",
    "RFC 2119",
    "Antigravity",
    "gemini",
    "jailbreak",
];

export default function SensitiveWordObfuscation({
    config = DEFAULT_CONFIG,
    onChange,
}: SensitiveWordObfuscationProps) {
    const { t } = useTranslation();

    // 本地草稿文本，保证用户在输入换行或空格时不会发生光标跳动或换行被吞
    const [rawText, setRawText] = useState<string>(() =>
        (config.sensitive_words || []).join("\n")
    );

    // 当外部传入的敏感词列表发生显著变更且未处于编辑焦点同步时同步
    useEffect(() => {
        const joined = (config.sensitive_words || []).join("\n");
        const parsedCurrent = rawText
            .split("\n")
            .map((w) => w.trim())
            .filter((w) => w.length > 0);
        const parsedJoined = (config.sensitive_words || []).map((w) => w.trim()).filter((w) => w.length > 0);

        if (JSON.stringify(parsedCurrent) !== JSON.stringify(parsedJoined)) {
            setRawText(joined);
        }
    }, [config.sensitive_words]);

    const handleTextChange = (text: string) => {
        setRawText(text);
        const parsed = text
            .split("\n")
            .map((w) => w.trim())
            .filter((w) => w.length > 0);
        onChange({
            ...config,
            sensitive_words: parsed,
        });
    };

    const handleBlur = () => {
        // 失焦时整理多余的空白行与空格，保证整洁
        const parsed = rawText
            .split("\n")
            .map((w) => w.trim())
            .filter((w) => w.length > 0);
        const normalized = parsed.join("\n");
        if (normalized !== rawText) {
            setRawText(normalized);
        }
    };

    const handleScopeChange = (scope: SensitiveWordObfuscationScope) => {
        onChange({
            ...config,
            scope,
        });
    };

    const handleLoadPresets = () => {
        const currentSet = new Set(
            rawText
                .split("\n")
                .map((w) => w.trim())
                .filter((w) => w.length > 0)
        );
        for (const word of CPA_PRESET_WORDS) {
            currentSet.add(word);
        }
        const merged = Array.from(currentSet);
        const newText = merged.join("\n");
        setRawText(newText);
        onChange({
            ...config,
            sensitive_words: merged,
        });
    };

    const activeWordsCount = (config.sensitive_words || []).filter(
        (w) => w.trim().length >= 2
    ).length;

    return (
        <div className="space-y-3">
            {/* 标题与主开关区域 */}
            <div className="flex items-center justify-between gap-3 bg-purple-50/30 dark:bg-purple-900/5 border border-purple-100/50 dark:border-purple-800/20 rounded-lg px-4 py-3">
                <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-gray-900 dark:text-gray-100">
                            {t("settings.sensitive_word_obfuscation.title", {
                                defaultValue: "零宽字符敏感词脱敏 (Zero-Width Cloak)",
                            })}
                        </h4>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100/70 dark:bg-purple-800/30 text-purple-700 dark:text-purple-300 font-mono">
                            \u200B
                        </span>
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        {t("settings.sensitive_word_obfuscation.hint", {
                            defaultValue:
                                "在匹配的敏感词第 1 个字符后插入不可见零宽空格 (U+200B)，规避关键词风控与审查误杀",
                        })}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <span
                        className={`text-[10px] font-medium ${
                            config.enabled
                                ? "text-purple-600 dark:text-purple-400"
                                : "text-gray-400"
                        }`}
                    >
                        {config.enabled
                            ? t("common.enabled", { defaultValue: "已启用" })
                            : t("common.disabled", { defaultValue: "已禁用" })}
                    </span>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                            type="checkbox"
                            checked={config.enabled}
                            onChange={(e) =>
                                onChange({ ...config, enabled: e.target.checked })
                            }
                            className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:after:border-gray-600 peer-checked:bg-purple-600"></div>
                    </label>
                </div>
            </div>

            {/* 配置展开区域 (仅在启用时可见) */}
            {config.enabled && (
                <div className="space-y-3 bg-gray-50/50 dark:bg-base-200/40 p-3 rounded-lg border border-gray-100 dark:border-base-300">
                    {/* 作用范围选择 */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-gray-200/60 dark:border-base-300">
                        <div className="space-y-0.5">
                            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                {t("settings.sensitive_word_obfuscation.scope_label", {
                                    defaultValue: "生效作用域 (Scope)",
                                })}
                            </label>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                {config.scope === "system_and_messages"
                                    ? t(
                                          "settings.sensitive_word_obfuscation.scope_messages_desc",
                                          {
                                              defaultValue:
                                                  "脱敏系统提示词与对话上下文（自动保护围栏代码块中的代码不变）",
                                          }
                                      )
                                    : t(
                                          "settings.sensitive_word_obfuscation.scope_system_desc",
                                          {
                                              defaultValue:
                                                  "仅脱敏系统提示词 (systemInstruction)，对话消息与代码完全不受影响",
                                          }
                                      )}
                            </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 bg-white dark:bg-base-100 p-1 rounded-md border border-gray-200 dark:border-gray-700">
                            <button
                                type="button"
                                onClick={() => handleScopeChange("system_instruction")}
                                className={`px-2.5 py-1 text-xs rounded transition-all ${
                                    config.scope === "system_instruction"
                                        ? "bg-purple-600 text-white font-medium shadow-sm"
                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                                }`}
                            >
                                {t(
                                    "settings.sensitive_word_obfuscation.scope_system_only",
                                    {
                                        defaultValue: "仅系统提示词 (推荐)",
                                    }
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => handleScopeChange("system_and_messages")}
                                className={`px-2.5 py-1 text-xs rounded transition-all ${
                                    config.scope === "system_and_messages"
                                        ? "bg-purple-600 text-white font-medium shadow-sm"
                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                                }`}
                            >
                                {t(
                                    "settings.sensitive_word_obfuscation.scope_system_and_messages",
                                    {
                                        defaultValue: "系统提示词 + 消息正文",
                                    }
                                )}
                            </button>
                        </div>
                    </div>

                    {/* 敏感词输入与预置按钮 */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                {t("settings.sensitive_word_obfuscation.words_label", {
                                    defaultValue: "敏感词列表（每行一个，不区分大小写）",
                                })}
                            </label>
                            <button
                                type="button"
                                onClick={handleLoadPresets}
                                className="text-xs text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                {t("settings.sensitive_word_obfuscation.load_presets", {
                                    defaultValue: "导入常用词 (CPA 预设)",
                                })}
                            </button>
                        </div>

                        <textarea
                            value={rawText}
                            onChange={(e) => handleTextChange(e.target.value)}
                            onBlur={handleBlur}
                            placeholder={t(
                                "settings.sensitive_word_obfuscation.placeholder",
                                {
                                    defaultValue:
                                        "输入需脱敏的词汇或短语，每行一个...\n例如：\nproxy\nClaude Code\nAnthropic\nOpenAI",
                                }
                            )}
                            rows={5}
                            className="w-full bg-white dark:bg-base-100 border border-gray-200 dark:border-gray-700 rounded-lg px-3.5 py-2.5 text-xs font-mono focus:ring-2 focus:ring-purple-500/20 outline-none transition-all resize-y min-h-[100px]"
                        />

                        <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500">
                            <span>
                                {t("settings.sensitive_word_obfuscation.word_count", {
                                    defaultValue: "已生效 {{count}} 个敏感词（≥2 字符）",
                                    count: activeWordsCount,
                                })}
                            </span>
                            <span>
                                {t("settings.sensitive_word_obfuscation.safe_notice", {
                                    defaultValue: "思考块（thought）与签名严格保持原样",
                                })}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
