import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
    PromptRewriteConfig,
    PromptRewriteRule,
    PromptRewriteScope,
} from "../../types/config";

interface PromptRewriteProps {
    config: PromptRewriteConfig;
    onChange: (config: PromptRewriteConfig) => void;
}

const DEFAULT_CONFIG: PromptRewriteConfig = {
    enabled: false,
    scope: "system_instruction",
    rules: [],
};

export default function PromptRewrite({
    config = DEFAULT_CONFIG,
    onChange,
}: PromptRewriteProps) {
    const { t } = useTranslation();

    const [newMatch, setNewMatch] = useState("");
    const [newReplace, setNewReplace] = useState("");

    const rules = config.rules || [];

    const handleToggleEnabled = (enabled: boolean) => {
        onChange({
            ...config,
            enabled,
        });
    };

    const handleScopeChange = (scope: PromptRewriteScope) => {
        onChange({
            ...config,
            scope,
        });
    };

    const handleRuleToggle = (index: number) => {
        const updatedRules = rules.map((r, i) =>
            i === index ? { ...r, enabled: !r.enabled } : r
        );
        onChange({
            ...config,
            rules: updatedRules,
        });
    };

    const handleRuleChange = (
        index: number,
        field: "match" | "replace",
        value: string
    ) => {
        const updatedRules = rules.map((r, i) =>
            i === index ? { ...r, [field]: value } : r
        );
        onChange({
            ...config,
            rules: updatedRules,
        });
    };

    const handleRuleDelete = (index: number) => {
        const updatedRules = rules.filter((_, i) => i !== index);
        onChange({
            ...config,
            rules: updatedRules,
        });
    };

    const handleRuleMove = (index: number, direction: "up" | "down") => {
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= rules.length) return;

        const updatedRules = [...rules];
        const temp = updatedRules[index];
        updatedRules[index] = updatedRules[targetIndex];
        updatedRules[targetIndex] = temp;

        onChange({
            ...config,
            rules: updatedRules,
        });
    };

    const handleAddRule = () => {
        if (!newMatch) return;

        const newRule: PromptRewriteRule = {
            enabled: true,
            match: newMatch,
            replace: newReplace,
        };

        onChange({
            ...config,
            rules: [...rules, newRule],
        });

        setNewMatch("");
        setNewReplace("");
    };

    const activeRulesCount = rules.filter(
        (r) => r.enabled && r.match.length > 0
    ).length;

    return (
        <div className="space-y-3">
            {/* 标题与主开关区域 */}
            <div className="flex items-center justify-between gap-3 bg-blue-50/30 dark:bg-blue-900/5 border border-blue-100/50 dark:border-blue-800/20 rounded-lg px-4 py-3">
                <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-gray-900 dark:text-gray-100">
                            {t("settings.prompt_rewrite.title", {
                                defaultValue: "提示词改写 (Prompt Rewrite)",
                            })}
                        </h4>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100/70 dark:bg-blue-800/30 text-blue-700 dark:text-blue-300 font-mono">
                            {t("settings.prompt_rewrite.badge_exact", {
                                defaultValue: "严格匹配",
                            })}
                        </span>
                        {config.enabled && rules.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100/70 dark:bg-emerald-800/30 text-emerald-700 dark:text-emerald-300 font-mono">
                                {t("settings.prompt_rewrite.rule_count", {
                                    count: activeRulesCount,
                                    total: rules.length,
                                    defaultValue: `已生效 ${activeRulesCount} / ${rules.length} 条规则`,
                                })}
                            </span>
                        )}
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        {t("settings.prompt_rewrite.hint", {
                            defaultValue:
                                "严格字面匹配并按顺序替换提示词中的特定词句，支持清空删除或重定向模型指令",
                        })}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <span
                        className={`text-[10px] font-medium ${
                            config.enabled
                                ? "text-blue-600 dark:text-blue-400"
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
                            onChange={(e) => handleToggleEnabled(e.target.checked)}
                            className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:after:border-gray-600 peer-checked:bg-blue-600"></div>
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
                                {t("settings.prompt_rewrite.scope_label", {
                                    defaultValue: "生效作用域 (Scope)",
                                })}
                            </label>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                {config.scope === "system_and_messages"
                                    ? t(
                                          "settings.prompt_rewrite.scope_messages_desc",
                                          {
                                              defaultValue:
                                                  "改写系统提示词与对话上下文（自动保护围栏代码块中的代码不变）",
                                          }
                                      )
                                    : t(
                                          "settings.prompt_rewrite.scope_system_desc",
                                          {
                                              defaultValue:
                                                  "仅改写系统提示词 (systemInstruction)，对话消息与代码完全不受影响",
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
                                        ? "bg-blue-600 text-white font-medium shadow-sm"
                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                                }`}
                            >
                                {t("settings.prompt_rewrite.scope_system_only", {
                                    defaultValue: "仅系统提示词 (推荐)",
                                })}
                            </button>
                            <button
                                type="button"
                                onClick={() => handleScopeChange("system_and_messages")}
                                className={`px-2.5 py-1 text-xs rounded transition-all ${
                                    config.scope === "system_and_messages"
                                        ? "bg-blue-600 text-white font-medium shadow-sm"
                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                                }`}
                            >
                                {t(
                                    "settings.prompt_rewrite.scope_system_and_messages",
                                    {
                                        defaultValue: "系统提示词 + 消息正文",
                                    }
                                )}
                            </button>
                        </div>
                    </div>

                    {/* 规则列表区域 */}
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                            {t("settings.prompt_rewrite.rules_label", {
                                defaultValue: "改写规则列表（按顺序逐条执行）",
                            })}
                        </label>

                        {rules.length === 0 ? (
                            <div className="p-4 text-center rounded-lg border border-dashed border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 text-xs">
                                {t("settings.prompt_rewrite.empty_rules", {
                                    defaultValue: "暂无改写规则，请在下方添加第一条规则",
                                })}
                            </div>
                        ) : (
                            <div className="space-y-2.5">
                                {rules.map((rule, idx) => (
                                    <div
                                        key={idx}
                                        className={`p-3 rounded-lg border transition-all ${
                                            rule.enabled
                                                ? "bg-white dark:bg-base-100 border-gray-200 dark:border-gray-700 shadow-xs"
                                                : "bg-gray-100/50 dark:bg-base-200/50 border-gray-200/60 dark:border-gray-800 opacity-60"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-base-300 text-gray-600 dark:text-gray-300">
                                                    #{idx + 1}
                                                </span>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={rule.enabled}
                                                        onChange={() => handleRuleToggle(idx)}
                                                        className="sr-only peer"
                                                    />
                                                    <div className="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all dark:after:border-gray-600 peer-checked:bg-blue-600"></div>
                                                </label>
                                                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                                    {rule.enabled
                                                        ? t("common.enabled", { defaultValue: "已启用" })
                                                        : t("common.disabled", { defaultValue: "已禁用" })}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    disabled={idx === 0}
                                                    onClick={() => handleRuleMove(idx, "up")}
                                                    title={t("settings.prompt_rewrite.move_up", { defaultValue: "上移" })}
                                                    className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-base-300 disabled:opacity-30 disabled:cursor-not-allowed"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={idx === rules.length - 1}
                                                    onClick={() => handleRuleMove(idx, "down")}
                                                    title={t("settings.prompt_rewrite.move_down", { defaultValue: "下移" })}
                                                    className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-base-300 disabled:opacity-30 disabled:cursor-not-allowed"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRuleDelete(idx)}
                                                    title={t("settings.prompt_rewrite.delete_rule", { defaultValue: "删除规则" })}
                                                    className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                            <div className="space-y-1">
                                                <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                                                    {t("settings.prompt_rewrite.match_label", {
                                                        defaultValue: "严格匹配内容 (Match)",
                                                    })}
                                                </span>
                                                <textarea
                                                    rows={2}
                                                    value={rule.match}
                                                    onChange={(e) =>
                                                        handleRuleChange(idx, "match", e.target.value)
                                                    }
                                                    placeholder={t(
                                                        "settings.prompt_rewrite.match_placeholder",
                                                        { defaultValue: "输入原匹配词..." }
                                                    )}
                                                    className="w-full font-mono text-xs p-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-base-200/50 focus:bg-white dark:focus:bg-base-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                />
                                            </div>

                                            <div className="space-y-1">
                                                <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                                                    {t("settings.prompt_rewrite.replace_label", {
                                                        defaultValue: "替换为 (Replace With)",
                                                    })}
                                                </span>
                                                <textarea
                                                    rows={2}
                                                    value={rule.replace}
                                                    onChange={(e) =>
                                                        handleRuleChange(idx, "replace", e.target.value)
                                                    }
                                                    placeholder={t(
                                                        "settings.prompt_rewrite.replace_placeholder",
                                                        { defaultValue: "输入替换内容（留空删除）..." }
                                                    )}
                                                    className="w-full font-mono text-xs p-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-base-200/50 focus:bg-white dark:focus:bg-base-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 添加新规则面板 */}
                    <div className="pt-2 border-t border-gray-200/60 dark:border-base-300 space-y-2">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                            {t("settings.prompt_rewrite.add_rule_title", {
                                defaultValue: "新建改写规则",
                            })}
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <textarea
                                rows={2}
                                value={newMatch}
                                onChange={(e) => setNewMatch(e.target.value)}
                                placeholder={t(
                                    "settings.prompt_rewrite.match_placeholder",
                                    {
                                        defaultValue:
                                            "输入要精确匹配的词句（区分大小写，非正则字面匹配）...",
                                    }
                                )}
                                className="w-full font-mono text-xs p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-base-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <textarea
                                rows={2}
                                value={newReplace}
                                onChange={(e) => setNewReplace(e.target.value)}
                                placeholder={t(
                                    "settings.prompt_rewrite.replace_placeholder",
                                    {
                                        defaultValue:
                                            "输入替换后的内容（留空表示完全删除匹配项）...",
                                    }
                                )}
                                className="w-full font-mono text-xs p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-base-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex justify-end">
                            <button
                                type="button"
                                disabled={!newMatch}
                                onClick={handleAddRule}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded shadow-xs transition-all flex items-center gap-1.5"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
                                {t("settings.prompt_rewrite.add_rule", {
                                    defaultValue: "添加改写规则",
                                })}
                            </button>
                        </div>
                    </div>

                    {/* 底部合规/安全提示 */}
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1 pt-1">
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
                            className="text-gray-400"
                        >
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" x2="12" y1="8" y2="12" />
                            <line x1="12" x2="12.01" y1="16" y2="16" />
                        </svg>
                        <span>
                            {t("settings.prompt_rewrite.safe_notice", {
                                defaultValue:
                                    "思考块（thought）严格受保护，围栏代码块内容在消息模式下自动保留",
                            })}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
