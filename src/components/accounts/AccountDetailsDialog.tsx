import { useEffect, useMemo, useState } from 'react';
import { X, Clock, AlertCircle, Bot, Coins, ExternalLink, RotateCcw } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Account, getAccountTier, getTierLabel, isVertexAccount, VertexAccountInfo, VertexCreditConfig } from '../../types/account';
import { updateVertexCredit } from '../../services/accountService';
import { useAccountStore } from '../../stores/useAccountStore';
import { formatCurrencyAmount } from '../../utils/quotaDisplay';
import { formatDate, formatTimeRemaining } from '../../utils/format';
import { useTranslation } from 'react-i18next';
import { MODEL_CONFIG, sortModels } from '../../config/modelConfig';
import { showToast } from '../common/ToastContainer';

interface AccountDetailsDialogProps {
    account: Account | null;
    onClose: () => void;
    onUpdatePriority: (accountId: string, priority: number) => Promise<void>;
    onUpdateProjectId?: (accountId: string, projectId: string) => Promise<void>;
    onAutoFetchProjectId?: (accountId: string) => Promise<string>;
}

export default function AccountDetailsDialog({
    account,
    onClose,
    onUpdatePriority,
    onUpdateProjectId,
    onAutoFetchProjectId,
}: AccountDetailsDialogProps) {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<'basic' | 'detailed'>('basic');
    const [priorityInput, setPriorityInput] = useState('50');
    const [savingPriority, setSavingPriority] = useState(false);
    const [projectIdInput, setProjectIdInput] = useState('');
    const [savingProjectId, setSavingProjectId] = useState(false);
    const [fetchingProjectId, setFetchingProjectId] = useState(false);

    // Vertex credit tracking state
    const isVertex = useMemo(() => isVertexAccount(account), [account]);
    const vertexInfo: VertexAccountInfo | undefined = useMemo(() => {
        if (!account || !isVertex) return undefined;
        if (account.vertex_info) return account.vertex_info;
        const sa = account.token?.service_account;
        const cred = account.token?.vertex_credit;
        const initial = cred?.initial_credit ?? 300.0;
        const spent = cred?.external_spent ?? 0.0;
        return {
            project_id: account.token?.project_id || sa?.project_id || "",
            location: account.token?.vertex_location || "global",
            client_email: sa?.client_email || account.email,
            billing_account_id: cred?.billing_account_id,
            credit_configured: Boolean(cred),
            initial_credit: initial,
            currency: cred?.currency || "USD",
            external_spent: spent,
            exchange_rate: cred?.exchange_rate ?? 1.0,
            local_estimated_spent_usd: 0.0,
            total_spent: spent,
            remaining_credit: Math.max(0, initial - spent),
            baseline_timestamp: cred?.baseline_timestamp,
            expires_at: cred?.expires_at,
            total_requests: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cached_tokens: 0,
        };
    }, [account, isVertex]);

    const [creditCurrency, setCreditCurrency] = useState('USD');
    const [initialCreditInput, setInitialCreditInput] = useState('300');
    const [exchangeRateInput, setExchangeRateInput] = useState('1');
    const [externalSpentInput, setExternalSpentInput] = useState('0');
    const [billingAccountIdInput, setBillingAccountIdInput] = useState('');
    const [expiresAtInput, setExpiresAtInput] = useState('');
    const [baselineTs, setBaselineTs] = useState<number | null>(null);
    const [savingCredit, setSavingCredit] = useState(false);

    const displayGroups = useMemo(() => {
        return account?.quota?.quota_groups || [];
    }, [account?.quota?.quota_groups]);

    const displayModels = useMemo(() => {
        const models = account?.quota?.models || [];
        return models.filter(m => {
            const name = (m.name || '').trim().toLowerCase();
            if (
                name.startsWith('chat_') ||
                name.startsWith('tab_') ||
                name.includes('internal') ||
                name.includes('-exp') ||
                name.endsWith('-agent') ||
                name === 'gemini-3-flash' ||
                name.includes('2.5') ||
                name.includes('2-5') ||
                name.includes('3.5-flash-low') ||
                name.includes('3.5-flash-extra-low') ||
                name.includes('3.6-flash') ||
                name.includes('3.7-flash')
            ) {
                return false;
            }
            return true;
        });
    }, [account?.quota?.models]);

    useEffect(() => {
        setPriorityInput(String(account?.priority ?? 50));
        setProjectIdInput(account?.token?.project_id || '');
        if (account?.token?.vertex_credit) {
            const vc = account.token.vertex_credit;
            setCreditCurrency(vc.currency || 'USD');
            setInitialCreditInput(String(vc.initial_credit ?? 300));
            setExchangeRateInput(String(vc.exchange_rate ?? 1.0));
            setExternalSpentInput(String(vc.external_spent ?? 0));
            setBillingAccountIdInput(vc.billing_account_id || '');
            setExpiresAtInput(vc.expires_at || '');
            setBaselineTs(vc.baseline_timestamp ?? null);
        } else if (account?.vertex_info) {
            const vi = account.vertex_info;
            setCreditCurrency(vi.currency || 'USD');
            setInitialCreditInput(String(vi.initial_credit ?? 300));
            setExchangeRateInput(String(vi.exchange_rate ?? 1.0));
            setExternalSpentInput(String(vi.external_spent ?? 0));
            setBillingAccountIdInput(vi.billing_account_id || '');
            setExpiresAtInput(vi.expires_at || '');
            setBaselineTs(vi.baseline_timestamp ?? null);
        } else {
            setCreditCurrency('USD');
            setInitialCreditInput('300');
            setExchangeRateInput('1');
            setExternalSpentInput('0');
            setBillingAccountIdInput('');
            setExpiresAtInput('');
            setBaselineTs(null);
        }
    }, [account?.id, account?.priority, account?.token?.project_id]);

    if (!account) return null;

    const savePriority = async () => {
        const priority = Number(priorityInput);
        if (!Number.isInteger(priority) || priority < 1 || priority > 100) {
            showToast(t('accounts.priority_invalid'), 'error');
            return;
        }
        setSavingPriority(true);
        try {
            await onUpdatePriority(account.id, priority);
            showToast(t('accounts.priority_updated'), 'success');
        } catch (error) {
            showToast(`${t('common.error')}: ${error}`, 'error');
        } finally {
            setSavingPriority(false);
        }
    };

    const saveProjectId = async () => {
        if (!onUpdateProjectId) return;
        setSavingProjectId(true);
        try {
            await onUpdateProjectId(account.id, projectIdInput.trim());
            showToast(t('accounts.project_id_updated', 'GCP Project ID 已更新'), 'success');
        } catch (error) {
            showToast(`${t('common.error')}: ${error}`, 'error');
        } finally {
            setSavingProjectId(false);
        }
    };

    const autoFetchProjectId = async () => {
        if (!onAutoFetchProjectId) return;
        setFetchingProjectId(true);
        try {
            const fetched = await onAutoFetchProjectId(account.id);
            setProjectIdInput(fetched);
            showToast(
                t('accounts.auto_fetch_success', {
                    defaultValue: '成功自动获取 Project ID: {{projectId}}',
                    projectId: fetched,
                }),
                'success'
            );
        } catch (error) {
            showToast(
                `${t('accounts.auto_fetch_failed', '未能在上游找到关联的 Project ID')}: ${error}`,
                'error'
            );
        } finally {
            setFetchingProjectId(false);
        }
    };

    const handleCurrencyChange = (newCurr: string) => {
        setCreditCurrency(newCurr);
        if (newCurr === 'JPY') {
            if (exchangeRateInput === '1' || exchangeRateInput === '1.0' || exchangeRateInput === '') {
                setExchangeRateInput('155.0');
            }
            if (initialCreditInput === '300' || initialCreditInput === '300.0') {
                setInitialCreditInput('45000');
            }
        } else if (newCurr === 'USD') {
            if (exchangeRateInput === '155' || exchangeRateInput === '155.0') {
                setExchangeRateInput('1.0');
            }
            if (initialCreditInput === '45000') {
                setInitialCreditInput('300');
            }
        }
    };

    const handleResetBaseline = () => {
        const now = Math.floor(Date.now() / 1000);
        setBaselineTs(now);
        showToast(t('accounts.vertex.baseline_reset', { defaultValue: '已设置校准基线为当前时间，将只统计此后的本地 Token 消耗' }), 'info');
    };

    const handleClearBaseline = () => {
        setBaselineTs(null);
        showToast(t('accounts.vertex.baseline_cleared', { defaultValue: '已清除基线时间戳，将统计全部历史消耗' }), 'info');
    };

    const saveVertexCredit = async () => {
        if (!account) return;
        setSavingCredit(true);
        try {
            const config: VertexCreditConfig = {
                initial_credit: Number(initialCreditInput) || 0,
                currency: creditCurrency.trim() || 'USD',
                external_spent: Number(externalSpentInput) || 0,
                exchange_rate: Number(exchangeRateInput) || 1.0,
                baseline_timestamp: baselineTs,
                billing_account_id: billingAccountIdInput.trim() || null,
                expires_at: expiresAtInput.trim() || null,
            };
            await updateVertexCredit(account.id, config);
            showToast(t('accounts.vertex.credit_updated', { defaultValue: 'Vertex 赠金配置已保存' }), 'success');
            await useAccountStore.getState().fetchAccounts();
        } catch (error) {
            showToast(`${t('common.error')}: ${error}`, 'error');
        } finally {
            setSavingCredit(false);
        }
    };


    return createPortal(
        <div className="modal modal-open z-[100]">
            {/* Draggable Top Region */}
            <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-8 z-[110]" />

            <div className="modal-box relative max-w-3xl bg-white dark:bg-base-100 shadow-2xl rounded-2xl p-0 overflow-hidden">
                {/* Header */}
                <div className="px-6 py-5 border-b border-gray-100 dark:border-base-200 bg-gray-50/50 dark:bg-base-200/50 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <h3 className="font-bold text-lg text-gray-900 dark:text-base-content">{t('accounts.details.title')}</h3>
                        <div className="px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-base-200 border border-gray-200 dark:border-base-300 text-xs font-mono text-gray-500 dark:text-gray-400">
                            {account.email}
                        </div>
                        {(() => {
                            const tier = getAccountTier(account);
                            const label = getTierLabel(tier);
                            return (
                                <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                    tier === 'ultra' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                                    tier === 'pro' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                    'bg-gray-100 text-gray-600 dark:bg-base-300 dark:text-gray-400'
                                }`}>
                                    {label}
                                </div>
                            );
                        })()}
                    </div>
                    <button
                        onClick={onClose}
                        className="btn btn-sm btn-circle btn-ghost text-gray-400 hover:bg-gray-100 dark:hover:bg-base-200 hover:text-gray-600 dark:hover:text-base-content transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Status Alerts */}
                {(account.disabled || account.proxy_disabled) && (
                    <div className="px-6 py-3 bg-red-50 dark:bg-red-950/20 border-b border-red-100 dark:border-red-900/30 flex flex-col gap-1">
                        {account.disabled && (
                            <div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400">
                                <AlertCircle size={14} />
                                <span className="font-semibold">{t('accounts.status.disabled')}:</span>
                                <span>{account.disabled_reason || t('common.unknown')}</span>
                            </div>
                        )}
                        {account.proxy_disabled && (
                            <div className="flex items-center gap-2 text-xs text-orange-700 dark:text-orange-400">
                                <AlertCircle size={14} />
                                <span className="font-semibold">{t('accounts.status.proxy_disabled')}:</span>
                                <span>{account.proxy_disabled_reason || t('common.unknown')}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Content */}
                <div className="p-6 max-h-[68vh] overflow-y-auto space-y-6">
                    {/* 优先级设置 */}
                    <div className="p-4 rounded-xl border border-gray-100 dark:border-base-200 bg-gray-50/50 dark:bg-base-200/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                                <span>{t('accounts.priority')}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-mono font-bold">
                                    {account.priority ?? 50}
                                </span>
                            </div>
                            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 leading-relaxed max-w-md">
                                {t('accounts.priority_hint')}
                            </p>
                        </div>
                        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                            <input
                                id="account-priority"
                                type="number"
                                min={1}
                                max={100}
                                step={1}
                                className="input input-bordered input-sm w-20 text-center font-mono font-bold"
                                value={priorityInput}
                                disabled={savingPriority}
                                onChange={event => setPriorityInput(event.target.value)}
                            />
                            <button
                                className="btn btn-primary btn-sm px-4"
                                onClick={savePriority}
                                disabled={savingPriority || priorityInput === String(account.priority ?? 50)}
                            >
                                {savingPriority ? t('common.saving') : t('common.save')}
                            </button>
                        </div>
                    </div>

                    {/* GCP Project ID 设置 */}
                    <div className="p-4 rounded-xl border border-gray-100 dark:border-base-200 bg-gray-50/50 dark:bg-base-200/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                                <span>{t('accounts.project_id', 'GCP Project ID')}</span>
                                {account.token?.project_id ? (
                                    <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-mono font-semibold">
                                        {account.token.project_id}
                                    </span>
                                ) : (
                                    <span className="text-xs px-2 py-0.5 rounded-md bg-gray-200 dark:bg-base-300 text-gray-600 dark:text-gray-400 font-mono">
                                        {t('common.none', 'None')}
                                    </span>
                                )}
                            </div>
                            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 leading-relaxed max-w-md">
                                {t('accounts.project_id_hint', 'Google Cloud Project ID associated with the enterprise/GCP account. Native Antigravity associates or defaults this upon sign-in.')}
                            </p>
                        </div>
                        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 flex-wrap">
                            <input
                                id="account-project-id"
                                type="text"
                                placeholder={t('accounts.project_id_placeholder', 'e.g. my-project-id')}
                                className="input input-bordered input-sm w-36 sm:w-44 font-mono text-xs"
                                value={projectIdInput}
                                disabled={savingProjectId || fetchingProjectId}
                                onChange={event => setProjectIdInput(event.target.value)}
                            />
                            {onAutoFetchProjectId && (
                                <button
                                    className="btn btn-outline btn-sm px-2.5 text-xs"
                                    onClick={autoFetchProjectId}
                                    disabled={savingProjectId || fetchingProjectId}
                                    title={t('accounts.auto_fetch_project_id', '自动获取')}
                                >
                                    {fetchingProjectId ? (
                                        <span className="loading loading-spinner loading-xs" />
                                    ) : (
                                        t('accounts.auto_fetch_project_id', '自动获取')
                                    )}
                                </button>
                            )}
                            <button
                                className="btn btn-primary btn-sm px-3 text-xs"
                                onClick={saveProjectId}
                                disabled={savingProjectId || fetchingProjectId || projectIdInput.trim() === (account.token?.project_id || '')}
                            >
                                {savingProjectId ? t('common.saving') : t('common.save')}
                            </button>
                        </div>
                    </div>

                    {/* Vertex AI & Google Cloud 赠金余额跟踪板块 */}
                    {isVertex && (
                        <div className="p-4 rounded-xl border border-emerald-200/80 dark:border-emerald-800/60 bg-gradient-to-br from-emerald-50/50 via-teal-50/20 to-sky-50/20 dark:from-emerald-950/20 dark:via-base-200/50 dark:to-teal-950/20 flex flex-col gap-4 shadow-sm">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-100 dark:border-emerald-900/40 pb-3">
                                <div>
                                    <div className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                        <Coins className="w-4 h-4 text-emerald-500" />
                                        <span>{t('accounts.vertex.section_title', { defaultValue: 'Vertex AI · Google Cloud 赠金与账户管理' })}</span>
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 font-mono text-[10px] font-bold">
                                            {vertexInfo?.location || 'global'}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
                                        <span>{t('accounts.vertex.sa_email', { defaultValue: '服务账号' })}:</span>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300 truncate max-w-xs" title={vertexInfo?.client_email}>
                                            {vertexInfo?.client_email}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <a
                                        href={billingAccountIdInput.trim() ? `https://console.cloud.google.com/billing/${billingAccountIdInput.trim()}` : 'https://console.cloud.google.com/billing'}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="btn btn-outline btn-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-600 hover:text-white dark:border-emerald-700 dark:text-emerald-300"
                                        title={t('accounts.vertex.open_billing_hint', { defaultValue: '在浏览器打开 Google Cloud Console 结算台核对最新官方账单与赠金余额' })}
                                    >
                                        <ExternalLink className="w-3 h-3" />
                                        <span>{t('accounts.vertex.open_billing_console', { defaultValue: '打开 GCP 结算台核对余额' })}</span>
                                    </a>
                                </div>
                            </div>

                            {/* 运行消费实时统计摘要卡片 */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <div className="p-2.5 rounded-lg bg-white/80 dark:bg-base-200/60 border border-emerald-100 dark:border-white/5 flex flex-col">
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono uppercase tracking-wider">{t('accounts.vertex.stat_remaining', { defaultValue: '剩余赠金余额' })}</span>
                                    <span className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                                        {formatCurrencyAmount(vertexInfo?.remaining_credit ?? 300, creditCurrency)}
                                    </span>
                                </div>
                                <div className="p-2.5 rounded-lg bg-white/80 dark:bg-base-200/60 border border-emerald-100 dark:border-white/5 flex flex-col">
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono uppercase tracking-wider">{t('accounts.vertex.stat_total_spent', { defaultValue: '累计已消耗' })}</span>
                                    <span className="text-sm font-bold font-mono text-gray-800 dark:text-gray-200 mt-0.5">
                                        {formatCurrencyAmount(vertexInfo?.total_spent ?? 0, creditCurrency)}
                                    </span>
                                </div>
                                <div className="p-2.5 rounded-lg bg-white/80 dark:bg-base-200/60 border border-emerald-100 dark:border-white/5 flex flex-col">
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono uppercase tracking-wider">{t('accounts.vertex.stat_local_est', { defaultValue: '本地调用估算 (USD)' })}</span>
                                    <span className="text-sm font-bold font-mono text-blue-600 dark:text-blue-400 mt-0.5">
                                        ${(vertexInfo?.local_estimated_spent_usd ?? 0).toFixed(4)}
                                    </span>
                                </div>
                                <div className="p-2.5 rounded-lg bg-white/80 dark:bg-base-200/60 border border-emerald-100 dark:border-white/5 flex flex-col">
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono uppercase tracking-wider">{t('accounts.vertex.stat_requests', { defaultValue: '请求 / Token 统计' })}</span>
                                    <span className="text-xs font-mono font-medium text-gray-700 dark:text-gray-300 mt-1 truncate" title={`In: ${vertexInfo?.total_input_tokens || 0}, Out: ${vertexInfo?.total_output_tokens || 0}, Cache: ${vertexInfo?.total_cached_tokens || 0}`}>
                                        {vertexInfo?.total_requests || 0} req / {(((vertexInfo?.total_input_tokens || 0) + (vertexInfo?.total_output_tokens || 0)) / 1000).toFixed(1)}k tok
                                    </span>
                                </div>
                            </div>

                            {/* 赠金余额与基线校准表单 */}
                            <div className="p-3 rounded-lg bg-white/90 dark:bg-base-200/80 border border-gray-100 dark:border-base-300/60 flex flex-col gap-3">
                                <div className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center justify-between">
                                    <span>{t('accounts.vertex.config_form_title', { defaultValue: 'Google Cloud 赠金参数校准' })}</span>
                                    <span className="text-[10px] font-normal text-gray-400">
                                        {t('accounts.vertex.config_form_hint', { defaultValue: '可依据 GCP 结算台控制台对账单进行校准' })}
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                                            {t('accounts.vertex.currency', { defaultValue: '结算货币 (Currency)' })}
                                        </label>
                                        <select
                                            className="select select-bordered select-sm text-xs font-mono"
                                            value={creditCurrency}
                                            onChange={(e) => handleCurrencyChange(e.target.value)}
                                            disabled={savingCredit}
                                        >
                                            <option value="USD">USD ($)</option>
                                            <option value="JPY">JPY (¥)</option>
                                            <option value="EUR">EUR (€)</option>
                                            <option value="CNY">CNY (¥)</option>
                                        </select>
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                                            {t('accounts.vertex.initial_credit', { defaultValue: '初始赠金总额' })}
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            className="input input-bordered input-sm text-xs font-mono"
                                            value={initialCreditInput}
                                            onChange={(e) => setInitialCreditInput(e.target.value)}
                                            disabled={savingCredit}
                                            placeholder="300"
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                                            {t('accounts.vertex.exchange_rate', { defaultValue: 'USD 汇率 (Exchange Rate)' })}
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            className="input input-bordered input-sm text-xs font-mono"
                                            value={exchangeRateInput}
                                            onChange={(e) => setExchangeRateInput(e.target.value)}
                                            disabled={savingCredit}
                                            placeholder="1.0"
                                            title="1 USD 对应多少当前货币 (USD填1，JPY通常为150~155)"
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                                            {t('accounts.vertex.external_spent', { defaultValue: '历史/外部已消耗金额' })}
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            className="input input-bordered input-sm text-xs font-mono"
                                            value={externalSpentInput}
                                            onChange={(e) => setExternalSpentInput(e.target.value)}
                                            disabled={savingCredit}
                                            placeholder="0.00"
                                            title="在控制台已发生的历史费用，或重新校准时的底线偏移"
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                                            {t('accounts.vertex.billing_account_id', { defaultValue: '结算账号 ID (可选)' })}
                                        </label>
                                        <input
                                            type="text"
                                            className="input input-bordered input-sm text-xs font-mono"
                                            value={billingAccountIdInput}
                                            onChange={(e) => setBillingAccountIdInput(e.target.value)}
                                            disabled={savingCredit}
                                            placeholder="012FA9-D7D39F-27BD53"
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                                            {t('accounts.vertex.expires_at', { defaultValue: '赠金截止日期 (可选)' })}
                                        </label>
                                        <input
                                            type="text"
                                            className="input input-bordered input-sm text-xs font-mono"
                                            value={expiresAtInput}
                                            onChange={(e) => setExpiresAtInput(e.target.value)}
                                            disabled={savingCredit}
                                            placeholder="YYYY-MM-DD"
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-gray-100 dark:border-base-300">
                                    <div className="flex items-center gap-2 text-[11px] text-gray-500 font-mono">
                                        <span>{t('accounts.vertex.baseline_label', { defaultValue: '基线时间' })}:</span>
                                        {baselineTs ? (
                                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                                {new Date(baselineTs * 1000).toLocaleString()}
                                            </span>
                                        ) : (
                                            <span className="text-gray-400">{t('accounts.vertex.baseline_all', { defaultValue: '统计全部历史记录' })}</span>
                                        )}
                                        {baselineTs ? (
                                            <button
                                                type="button"
                                                onClick={handleClearBaseline}
                                                className="text-xs text-red-500 hover:underline ml-1"
                                                disabled={savingCredit}
                                            >
                                                {t('common.clear', { defaultValue: '清除' })}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={handleResetBaseline}
                                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline ml-1 flex items-center gap-0.5"
                                                disabled={savingCredit}
                                            >
                                                <RotateCcw className="w-2.5 h-2.5" />
                                                <span>{t('accounts.vertex.set_baseline_now', { defaultValue: '从当前时间重新校准' })}</span>
                                            </button>
                                        )}
                                    </div>

                                    <button
                                        type="button"
                                        className="btn btn-primary btn-sm px-4"
                                        onClick={saveVertexCredit}
                                        disabled={savingCredit}
                                    >
                                        {savingCredit ? t('common.saving') : t('common.save')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Protected Models Section */}
                    {account.protected_models && account.protected_models.length > 0 && (
                        <div className="p-4 rounded-xl border border-amber-100 dark:border-amber-900/30 bg-amber-50/40 dark:bg-amber-950/20">
                            <h4 className="text-xs font-bold text-amber-800 dark:text-amber-400 uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
                                <AlertCircle size={13} className="text-amber-500" />
                                {t('accounts.details.protected_models')}
                            </h4>
                            <div className="flex flex-wrap gap-1.5">
                                {account.protected_models.map(model => (
                                    <span key={model} className="px-2 py-0.5 bg-amber-100/70 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-[11px] font-mono border border-amber-200/60 dark:border-amber-800/50 rounded-md">
                                        {model}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div>
                        <div className="flex gap-6 border-b border-gray-100 dark:border-base-200 mb-4">
                            <button
                                onClick={() => setActiveTab('basic')}
                                className={`pb-2.5 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 ${activeTab === 'basic' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                            >
                                {t('accounts.details.model_quota')}
                            </button>
                            {displayGroups.length > 0 && (
                                <button
                                    onClick={() => setActiveTab('detailed')}
                                    className={`pb-2.5 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 flex items-center gap-1.5 ${activeTab === 'detailed' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                                >
                                    <Bot size={13} className={activeTab === 'detailed' ? 'text-blue-500' : ''} />
                                    {t('accounts.details.quota_groups', '配额分组窗口')}
                                </button>
                            )}
                        </div>

                        {activeTab === 'basic' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                {(() => {
                                    const uniqueLabels = new Set<string>();
                                    return sortModels(
                                        displayModels.map(model => {
                                            const config = MODEL_CONFIG[model.name.toLowerCase()];
                                            const label = model.display_name || (config?.i18nKey ? t(config.i18nKey) : (config?.label || model.name));
                                            return {
                                                id: model.name.toLowerCase(),
                                                label: label,
                                                model
                                            };
                                        })
                                    ).filter(m => {
                                        if (uniqueLabels.has(m.label)) return false;
                                        uniqueLabels.add(m.label);
                                        return true;
                                    }).map(({ model, label }) => {
                                        const p = model.percentage;
                                        const progressColor = p >= 50 ? 'bg-emerald-500' : p >= 20 ? 'bg-amber-500' : 'bg-rose-500';
                                        const badgeColor = p >= 50
                                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/40'
                                            : p >= 20
                                                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/40'
                                                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200/50 dark:border-rose-800/40';

                                        return (
                                            <div key={model.name} className="p-3.5 rounded-xl border border-gray-100 dark:border-base-200 bg-white dark:bg-base-100/70 hover:border-blue-200 dark:hover:border-blue-900/60 hover:shadow-sm transition-all group">
                                                <div className="flex justify-between items-start gap-2 mb-2.5">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-1.5">
                                                            {(() => {
                                                                const Icon = MODEL_CONFIG[model.name.toLowerCase()]?.Icon || Bot;
                                                                return <Icon size={15} className="shrink-0 text-gray-500 group-hover:text-blue-500 transition-colors" />;
                                                            })()}
                                                            <span className="text-xs font-semibold font-mono text-gray-800 dark:text-gray-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                                {label}
                                                            </span>
                                                        </div>
                                                        <div className="mt-1 flex flex-wrap items-center gap-1">
                                                            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-mono bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-200/50 dark:border-blue-800/40">
                                                                {model.name}
                                                            </span>
                                                            {model.thinking_budget !== undefined && (
                                                                <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono bg-gray-100 dark:bg-base-200 px-1.5 py-0.5 rounded border border-gray-200/50 dark:border-base-300">
                                                                    {t('accounts.details.thinking_budget', '思考预算')}: <span className="font-bold text-gray-700 dark:text-gray-300">{model.thinking_budget}</span>
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-md shrink-0 ${badgeColor}`}>
                                                        {model.percentage}%
                                                    </span>
                                                </div>

                                                {/* Progress Bar */}
                                                <div className="h-1.5 w-full bg-gray-100 dark:bg-base-200 rounded-full overflow-hidden mb-2">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                                                        style={{ width: `${Math.min(100, Math.max(0, model.percentage))}%` }}
                                                    />
                                                </div>

                                                <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                                                    <div className="flex items-center gap-1 truncate">
                                                        <Clock size={11} className="shrink-0" />
                                                        <span className="truncate">{formatDate(model.reset_time) || t('common.unknown')}</span>
                                                    </div>
                                                    {model.reset_time && (
                                                        <span className="shrink-0 font-medium text-gray-500 dark:text-gray-400 ml-1">
                                                            {formatTimeRemaining(model.reset_time)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    });
                                })() || (
                                    <div className="col-span-2 py-10 text-center text-gray-400 flex flex-col items-center">
                                        <AlertCircle className="w-8 h-8 mb-2 opacity-20" />
                                        <span>{t('accounts.no_data')}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Quota Groups Section */}
                        {activeTab === 'detailed' && displayGroups.length > 0 && (
                            <div className="flex flex-col gap-4">
                                {displayGroups.map((group, idx) => (
                                    <div key={idx} className="p-4 rounded-xl border border-blue-100/70 dark:border-blue-900/30 bg-blue-50/20 dark:bg-blue-900/10">
                                        <div className="font-semibold text-xs text-blue-900 dark:text-blue-300 mb-3 font-mono flex justify-between items-center">
                                            <span>{group.display_name}</span>
                                            {group.description && <span className="text-[10px] font-normal opacity-70 truncate max-w-xs">{group.description}</span>}
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {(group.buckets || []).map((bucket, bIdx) => {
                                                const percentage = Math.round(bucket.remaining_fraction * 100);
                                                const bColor = percentage >= 50
                                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/50'
                                                    : percentage >= 20
                                                        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/50'
                                                        : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200/50';

                                                return (
                                                    <div key={bIdx} className="bg-white dark:bg-base-200 p-3 rounded-lg border border-gray-100 dark:border-white/5 shadow-sm">
                                                        <div className="flex justify-between items-center mb-2">
                                                            <span className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider font-mono">
                                                                {bucket.window}
                                                            </span>
                                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${bColor}`}>
                                                                {percentage}%
                                                            </span>
                                                        </div>
                                                        {/* Progress bar */}
                                                        <div className="h-1.5 w-full bg-gray-100 dark:bg-base-300 rounded-full overflow-hidden mb-2">
                                                            <div
                                                                className={`h-full rounded-full transition-all duration-500 ${percentage >= 50 ? 'bg-emerald-500' : percentage >= 20 ? 'bg-amber-400' : 'bg-rose-500'}`}
                                                                style={{ width: `${percentage}%` }}
                                                            />
                                                        </div>
                                                        <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono">
                                                            <div className="flex items-center gap-1 truncate">
                                                                <Clock size={10} className="shrink-0" />
                                                                <span className="truncate">{formatDate(bucket.reset_time) || t('common.unknown')}</span>
                                                            </div>
                                                            {bucket.reset_time && (
                                                                <span className="shrink-0 font-medium text-gray-600 dark:text-gray-400 ml-1">
                                                                    {formatTimeRemaining(bucket.reset_time)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <div className="modal-backdrop bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
        </div>,
        document.body
    );
}
