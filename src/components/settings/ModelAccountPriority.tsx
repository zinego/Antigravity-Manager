import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Layers,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  HelpCircle,
  User,
  Sparkles,
  X,
  AlertCircle,
} from "lucide-react";

export interface ModelAccountPriorityProps {
  config: Record<string, string[]>;
  accounts: Array<{
    id: string;
    email: string;
    name?: string | null;
    disabled?: boolean;
    proxy_disabled?: boolean;
    quota?: { subscription_tier?: string | null } | null;
  }>;
  availableModels: string[];
  onChange: (next: Record<string, string[]>) => void;
}

export function ModelAccountPriority({
  config = {},
  accounts = [],
  availableModels = [],
  onChange,
}: ModelAccountPriorityProps) {
  const { t } = useTranslation();

  const [inputModel, setInputModel] = useState("");
  const [selectedModelToPick, setSelectedModelToPick] = useState("");
  // Selected account to append per model rule: modelKey -> accountId
  const [pendingAccountSelection, setPendingAccountSelection] = useState<Record<string, string>>({});

  const configuredModels = Object.keys(config);

  // Remaining models from availableModels that don't yet have a configured rule
  const unconfiguredAvailableModels = availableModels.filter(
    (m) => !config[m.trim().toLowerCase()]
  );

  const handleAddModelRule = () => {
    const raw = (inputModel || selectedModelToPick).trim().toLowerCase();
    if (!raw) return;

    if (config[raw]) {
      // Rule already exists
      setInputModel("");
      setSelectedModelToPick("");
      return;
    }

    const next = {
      ...config,
      [raw]: [],
    };
    onChange(next);
    setInputModel("");
    setSelectedModelToPick("");
  };

  const handleDeleteModelRule = (modelKey: string) => {
    const next = { ...config };
    delete next[modelKey];
    onChange(next);
  };

  const handleAddAccountToQueue = (modelKey: string) => {
    const accountId = pendingAccountSelection[modelKey];
    if (!accountId) return;

    const currentList = config[modelKey] || [];
    if (currentList.includes(accountId)) return;

    const next = {
      ...config,
      [modelKey]: [...currentList, accountId],
    };
    onChange(next);

    setPendingAccountSelection((prev) => ({
      ...prev,
      [modelKey]: "",
    }));
  };

  const handleRemoveAccountFromQueue = (modelKey: string, accountId: string) => {
    const currentList = config[modelKey] || [];
    const next = {
      ...config,
      [modelKey]: currentList.filter((id) => id !== accountId),
    };
    onChange(next);
  };

  const handleMoveAccount = (
    modelKey: string,
    index: number,
    direction: "up" | "down"
  ) => {
    const currentList = [...(config[modelKey] || [])];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentList.length) return;

    const temp = currentList[index];
    currentList[index] = currentList[targetIndex];
    currentList[targetIndex] = temp;

    const next = {
      ...config,
      [modelKey]: currentList,
    };
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {/* 顶部标题与说明卡片 */}
      <div className="bg-base-100 dark:bg-base-200/50 border border-base-300 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg">
              <Layers size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100 flex items-center gap-2">
                {t("settings.model_priority.title", {
                  defaultValue: "按模型账号优先级 (Model Account Priority)",
                })}
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-normal">
                  {configuredModels.length} 个模型规则
                </span>
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {t("settings.model_priority.subtitle", {
                  defaultValue:
                    "针对指定模型定义账号调度的绝对优先次序 (1 → 2 → 3...)，耗尽或限流时自动无缝切换与回退",
                })}
              </p>
            </div>
          </div>
        </div>

        {/* 添加新模型规则控制台 */}
        <div className="mt-3 pt-3 border-t border-base-200 dark:border-base-300/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {/* 下拉推荐模型选择 */}
          {unconfiguredAvailableModels.length > 0 && (
            <select
              className="select select-bordered select-sm text-xs bg-base-100 dark:bg-base-200 sm:w-56"
              value={selectedModelToPick}
              onChange={(e) => {
                setSelectedModelToPick(e.target.value);
                if (e.target.value) {
                  setInputModel(e.target.value);
                }
              }}
            >
              <option value="">-- 选择已有可用模型 --</option>
              {unconfiguredAvailableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}

          {/* 手动输入模型标识 */}
          <div className="relative flex-1">
            <input
              type="text"
              className="input input-bordered input-sm w-full text-xs font-mono"
              placeholder="输入或选择模型名 (如 gemini-4-hydrogen 或 claude-opus-5-5-high)"
              value={inputModel}
              onChange={(e) => setInputModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddModelRule();
                }
              }}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary btn-sm text-xs gap-1.5 shrink-0"
            onClick={handleAddModelRule}
            disabled={!inputModel.trim()}
          >
            <Plus size={14} />
            + 添加模型规则
          </button>
        </div>
      </div>

      {/* 已配置模型规则列表 */}
      {configuredModels.length === 0 ? (
        <div className="text-center py-8 px-4 border-2 border-dashed border-base-300 rounded-xl bg-base-50/50 dark:bg-base-200/20">
          <Sparkles className="mx-auto h-8 w-8 text-gray-400 mb-2 opacity-60" />
          <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
            暂未配置任何模型的账号优先级规则
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 max-w-md mx-auto">
            在上方选择或输入模型名称添加专属队列。未配置规则的模型将继续使用粘性会话与 P2C 动态负载均衡。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {configuredModels.map((modelKey) => {
            const queueAccountIds = config[modelKey] || [];
            const remainingAccounts = accounts.filter(
              (a) => !queueAccountIds.includes(a.id)
            );
            const currentSelection = pendingAccountSelection[modelKey] || "";

            return (
              <div
                key={modelKey}
                className="bg-base-100 dark:bg-base-200/40 border border-base-300 rounded-xl overflow-hidden shadow-sm transition-all"
              >
                {/* 规则条目头部 */}
                <div className="bg-base-200/60 dark:bg-base-300/40 px-4 py-2.5 flex items-center justify-between border-b border-base-300">
                  <div className="flex items-center gap-2">
                    <span className="badge badge-primary badge-sm font-mono text-xs font-bold px-2.5 py-2">
                      {modelKey}
                    </span>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                      {queueAccountIds.length > 0
                        ? `已配置 ${queueAccountIds.length} 个优先级账号`
                        : "尚未配置队列账号"}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-ghost btn-xs text-error hover:bg-error/10 gap-1"
                    title="删除此模型优先级规则"
                    onClick={() => handleDeleteModelRule(modelKey)}
                  >
                    <Trash2 size={13} />
                    删除规则
                  </button>
                </div>

                {/* 账号队列展示 */}
                <div className="p-3 space-y-2">
                  {queueAccountIds.length === 0 ? (
                    <div className="text-center py-4 bg-base-50/50 dark:bg-base-300/20 rounded-lg border border-dashed border-base-300">
                      <p className="text-xs text-gray-400">
                        当前队列为空，请在下方选择账号添加到优先调度序列
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {queueAccountIds.map((accId, idx) => {
                        const acc = accounts.find((a) => a.id === accId);
                        const isDisabled = acc?.disabled || acc?.proxy_disabled;
                        const tier = acc?.quota?.subscription_tier;

                        return (
                          <div
                            key={accId}
                            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                              isDisabled
                                ? "bg-red-50/40 dark:bg-red-950/20 border-red-200 dark:border-red-900/40 text-gray-400"
                                : "bg-white dark:bg-base-100 border-base-200 dark:border-base-300 text-gray-800 dark:text-gray-200"
                            }`}
                          >
                            {/* 顺序标号 + 账号详细信息 */}
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <span className="badge badge-neutral badge-sm font-mono font-bold w-5 h-5 p-0 flex items-center justify-center shrink-0">
                                {idx + 1}
                              </span>

                              <User size={14} className="text-gray-400 shrink-0" />

                              <div className="flex items-center gap-2 truncate">
                                <span className="font-medium truncate" title={acc?.email || accId}>
                                  {acc?.email || accId}
                                </span>

                                {acc?.name && (
                                  <span className="text-[10px] text-gray-400 truncate">
                                    ({acc.name})
                                  </span>
                                )}

                                {tier && (
                                  <span className="badge badge-outline badge-xs uppercase font-bold text-[9px] tracking-wide shrink-0">
                                    {tier}
                                  </span>
                                )}

                                {isDisabled && (
                                  <span className="badge badge-warning badge-xs shrink-0 flex items-center gap-1">
                                    <AlertCircle size={10} />
                                    已禁用
                                  </span>
                                )}

                                {!acc && (
                                  <span className="badge badge-error badge-xs shrink-0">
                                    已移除账号
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* 操作按钮组 (上移 / 下移 / 移除) */}
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs p-1 h-7 w-7 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-20"
                                title="上移一位"
                                disabled={idx === 0}
                                onClick={() => handleMoveAccount(modelKey, idx, "up")}
                              >
                                <ArrowUp size={13} />
                              </button>

                              <button
                                type="button"
                                className="btn btn-ghost btn-xs p-1 h-7 w-7 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-20"
                                title="下移一位"
                                disabled={idx === queueAccountIds.length - 1}
                                onClick={() => handleMoveAccount(modelKey, idx, "down")}
                              >
                                <ArrowDown size={13} />
                              </button>

                              <button
                                type="button"
                                className="btn btn-ghost btn-xs p-1 h-7 w-7 text-gray-400 hover:text-error"
                                title="从队列移除"
                                onClick={() => handleRemoveAccountFromQueue(modelKey, accId)}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 尾部添加账号控制器 */}
                  <div className="mt-2 pt-2 border-t border-base-200 dark:border-base-300 flex items-center gap-2">
                    <select
                      className="select select-bordered select-xs text-xs flex-1 bg-white dark:bg-base-100"
                      value={currentSelection}
                      onChange={(e) =>
                        setPendingAccountSelection((prev) => ({
                          ...prev,
                          [modelKey]: e.target.value,
                        }))
                      }
                      disabled={remainingAccounts.length === 0}
                    >
                      <option value="">
                        {remainingAccounts.length === 0
                          ? "-- 所有账号已加入该队列 --"
                          : "-- 选择要加入优先队列的账号 --"}
                      </option>
                      {remainingAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.email} {a.name ? `(${a.name})` : ""} {a.quota?.subscription_tier ? `[${a.quota.subscription_tier}]` : ""}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="btn btn-secondary btn-xs text-xs gap-1 shrink-0"
                      onClick={() => handleAddAccountToQueue(modelKey)}
                      disabled={!currentSelection}
                    >
                      <Plus size={12} />
                      + 添加账号到队列
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 底部详细调度说明卡片 */}
      <div className="flex items-start gap-3 p-3.5 bg-blue-50/40 dark:bg-base-200/50 rounded-xl border border-blue-100/60 dark:border-base-300">
        <HelpCircle size={17} className="text-blue-500 mt-0.5 shrink-0" />
        <div className="space-y-1 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
          <p className="font-semibold text-blue-900 dark:text-blue-300">
            调度规则与自动故障转移说明：
          </p>
          <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            <li>
              <strong>严格顺序优先</strong>：请求匹配模型时，按队列配置顺序 (1 → 2 → 3...) 选取首个健康、未限流且配额大于 0% 的可用账号。
            </li>
            <li>
              <strong>自动无缝回退</strong>：当队列内所有账号均遭遇 429 限流、0% 配额或处于 QoS 隔离时，请求将自动顺延回退至通用账号池（粘性会话与 P2C 负载均衡），保障可用性。
            </li>
            <li>
              <strong>基底与变体兼容</strong>：支持输入具体档位模型（如 <code className="font-mono text-primary">gemini-4-hydrogen-high</code>），也支持通用基底（如配置 <code className="font-mono text-primary">gemini-4-hydrogen</code> 会自动覆盖其 <code className="font-mono">-high</code> / <code className="font-mono">-low</code> 等所有衍生变体）。
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default ModelAccountPriority;
