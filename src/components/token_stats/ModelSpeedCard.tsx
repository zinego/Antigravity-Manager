import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ResponsiveContainer,
    ComposedChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
} from 'recharts';
import {
    Gauge,
    TrendingUp,
    ArrowRightLeft,
    Zap,
    Clock,
    Hash,
    Sparkles,
    Check,
    RotateCcw,
} from 'lucide-react';
import type { ModelSpeedResponse, ModelSpeedItem } from '../../pages/TokenStats';

const STORAGE_KEY = 'antigravity_token_speed_selected_models';
const VIEW_MODE_KEY = 'antigravity_token_speed_card_mode';

const MODEL_COLORS = [
    '#3b82f6', // blue
    '#10b981', // emerald
    '#8b5cf6', // purple
    '#f59e0b', // amber
    '#06b6d4', // cyan
    '#ec4899', // pink
    '#6366f1', // indigo
    '#14b8a6', // teal
];

interface ModelSpeedCardProps {
    speedData: ModelSpeedResponse | null;
    loading?: boolean;
    className?: string;
}

export const ModelSpeedCard: React.FC<ModelSpeedCardProps> = ({
    speedData,
    loading = false,
    className = '',
}) => {
    const { t } = useTranslation();

    // Mode: 'trend' (lollipop/line) or 'dumbbell' (half-window comparison)
    const [viewMode, setViewMode] = useState<'trend' | 'dumbbell'>(() => {
        try {
            const saved = localStorage.getItem(VIEW_MODE_KEY);
            if (saved === 'trend' || saved === 'dumbbell') return saved;
        } catch { }
        return 'trend';
    });

    const handleSwitchMode = (mode: 'trend' | 'dumbbell') => {
        setViewMode(mode);
        try {
            localStorage.setItem(VIEW_MODE_KEY, mode);
        } catch { }
    };

    // All available models in dataset
    const availableModels = useMemo(() => {
        if (!speedData?.models) return [];
        return speedData.models.map(m => m.model);
    }, [speedData]);

    // Selected models (up to 5)
    const [selectedModels, setSelectedModels] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed.slice(0, 5);
                }
            }
        } catch { }
        return [];
    });

    // Sync selected models with available models
    useEffect(() => {
        if (availableModels.length === 0) return;
        setSelectedModels(prev => {
            const valid = prev.filter(m => availableModels.includes(m));
            if (valid.length > 0) return valid.slice(0, 5);
            // Default select top 5 models
            const next = availableModels.slice(0, 5);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch { }
            return next;
        });
    }, [availableModels]);

    const toggleModel = (model: string) => {
        setSelectedModels(prev => {
            let next: string[];
            if (prev.includes(model)) {
                if (prev.length <= 1) return prev; // keep at least 1
                next = prev.filter(m => m !== model);
            } else {
                if (prev.length >= 5) {
                    next = [...prev.slice(1), model];
                } else {
                    next = [...prev, model];
                }
            }
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch { }
            return next;
        });
    };

    const selectTopFive = () => {
        const next = availableModels.slice(0, 5);
        setSelectedModels(next);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch { }
    };

    // Color map for selected models
    const modelColorMap = useMemo(() => {
        const map: Record<string, string> = {};
        selectedModels.forEach((m, idx) => {
            map[m] = MODEL_COLORS[idx % MODEL_COLORS.length];
        });
        return map;
    }, [selectedModels]);

    // Trend chart data transformation
    const chartData = useMemo(() => {
        if (!speedData?.buckets) return [];
        return speedData.buckets.map(b => {
            const row: Record<string, any> = {
                label: b.label,
                start_ts: b.start_ts,
                end_ts: b.end_ts,
            };
            selectedModels.forEach(m => {
                const pt = b.models[m];
                if (pt && pt.sample_count > 0) {
                    row[m] = pt.avg_tps;
                    row[`${m}_samples`] = pt.sample_count;
                    row[`${m}_tokens`] = pt.total_output_tokens;
                } else {
                    row[m] = null;
                }
            });
            return row;
        });
    }, [speedData, selectedModels]);

    // Selected model details for dumbbell view
    const selectedModelDetails = useMemo(() => {
        if (!speedData?.models) return [];
        const modelMap = new Map<string, ModelSpeedItem>();
        speedData.models.forEach(m => modelMap.set(m.model, m));
        return selectedModels
            .map(m => modelMap.get(m))
            .filter((m): m is ModelSpeedItem => m != null);
    }, [speedData, selectedModels]);

    const summary = speedData?.summary;
    const hasData = summary != null && summary.total_samples > 0;

    return (
        <div className={`bg-white/95 dark:bg-base-100 backdrop-blur-xl rounded-2xl p-4 sm:p-5 border border-black/[0.05] dark:border-base-200 shadow-sm flex flex-col gap-4 ${className}`}>
            {/* Header: Title + Mode Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-black/[0.04] dark:border-base-200">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/10 to-indigo-500/20 dark:from-blue-500/20 dark:to-indigo-500/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                        <Gauge className="w-4 h-4" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-[14px] font-bold text-gray-900 dark:text-base-content tracking-tight">
                                {t('token_stats.speed.title', 'Token 输出速度看板')}
                            </h2>
                            <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200/50 dark:border-blue-800/40">
                                TPS & TTFT
                            </span>
                        </div>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 font-sans">
                            {t('token_stats.speed.subtitle', '基于单次请求纯净耗时与输出 Token 计算生成速率与首字响应')}
                        </p>
                    </div>
                </div>

                {/* View Switcher (Trend vs Dumbbell) */}
                <div className="flex items-center bg-gray-100 dark:bg-base-200 p-0.5 rounded-xl border border-black/[0.03] dark:border-base-300">
                    <button
                        onClick={() => handleSwitchMode('trend')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            viewMode === 'trend'
                                ? 'bg-white dark:bg-base-100 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-base-content'
                        }`}
                        title={t('token_stats.speed.mode_trend_tip', '分时分桶趋势图 (Lollipop / Curve)')}
                    >
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span>{t('token_stats.speed.mode_trend', '分时趋势')}</span>
                    </button>
                    <button
                        onClick={() => handleSwitchMode('dumbbell')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            viewMode === 'dumbbell'
                                ? 'bg-white dark:bg-base-100 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-base-content'
                        }`}
                        title={t('token_stats.speed.mode_dumbbell_tip', '时间窗口前后半段测速对比 (Dumbbell)')}
                    >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>{t('token_stats.speed.mode_dumbbell', '半窗对比')}</span>
                    </button>
                </div>
            </div>

            {/* KPI Badges Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-gray-50/80 dark:bg-base-200/60 rounded-xl p-2.5 flex flex-col justify-between border border-black/[0.02] dark:border-base-300/40">
                    <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-[11px]">
                        <Zap className="w-3 h-3 text-blue-500" />
                        <span>{t('token_stats.speed.kpi_weighted_tps', '加权生成速度')}</span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-lg font-bold font-mono tracking-tight text-gray-900 dark:text-base-content">
                            {summary?.weighted_tps != null ? summary.weighted_tps.toFixed(1) : '-'}
                        </span>
                        <span className="text-[11px] text-gray-400 font-mono">t/s</span>
                    </div>
                </div>

                <div className="bg-gray-50/80 dark:bg-base-200/60 rounded-xl p-2.5 flex flex-col justify-between border border-black/[0.02] dark:border-base-300/40">
                    <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-[11px]">
                        <Sparkles className="w-3 h-3 text-emerald-500" />
                        <span>{t('token_stats.speed.kpi_sample_mean_tps', '样本平均速度')}</span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-lg font-bold font-mono tracking-tight text-gray-900 dark:text-base-content">
                            {summary?.avg_tps != null ? summary.avg_tps.toFixed(1) : '-'}
                        </span>
                        <span className="text-[11px] text-gray-400 font-mono">t/s</span>
                    </div>
                </div>

                <div className="bg-gray-50/80 dark:bg-base-200/60 rounded-xl p-2.5 flex flex-col justify-between border border-black/[0.02] dark:border-base-300/40">
                    <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-[11px]">
                        <Clock className="w-3 h-3 text-amber-500" />
                        <span>{t('token_stats.speed.kpi_p95_ttft', 'P95 首字延迟')}</span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-lg font-bold font-mono tracking-tight text-amber-600 dark:text-amber-400">
                            {summary?.p95_ttft_ms != null
                                ? (summary.p95_ttft_ms < 1000
                                    ? `${Math.round(summary.p95_ttft_ms)}`
                                    : (summary.p95_ttft_ms / 1000).toFixed(2))
                                : '-'}
                        </span>
                        <span className="text-[11px] text-gray-400 font-mono">
                            {summary?.p95_ttft_ms != null && summary.p95_ttft_ms >= 1000 ? 's' : 'ms'}
                        </span>
                    </div>
                </div>

                <div className="bg-gray-50/80 dark:bg-base-200/60 rounded-xl p-2.5 flex flex-col justify-between border border-black/[0.02] dark:border-base-300/40">
                    <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-[11px]">
                        <Hash className="w-3 h-3 text-purple-500" />
                        <span>{t('token_stats.speed.kpi_samples', '测速样本总量')}</span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-lg font-bold font-mono tracking-tight text-gray-900 dark:text-base-content">
                            {summary?.total_samples != null ? summary.total_samples.toLocaleString() : '0'}
                        </span>
                        <span className="text-[11px] text-gray-400 font-mono">次</span>
                    </div>
                </div>
            </div>

            {/* Model Selector Chips */}
            {availableModels.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 py-1">
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium mr-1">
                        {t('token_stats.speed.models_selected', '对比模型 (最多5个):')}
                    </span>
                    {availableModels.slice(0, 10).map(m => {
                        const isSelected = selectedModels.includes(m);
                        const color = modelColorMap[m] || '#888888';
                        const item = speedData?.models.find(x => x.model === m);
                        const speedText = item ? `${item.avg_tps.toFixed(0)} t/s` : '';

                        return (
                            <button
                                key={m}
                                onClick={() => toggleModel(m)}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono transition-all border ${
                                    isSelected
                                        ? 'bg-white dark:bg-base-200 text-gray-900 dark:text-base-content font-medium shadow-xs border-black/[0.08] dark:border-base-300'
                                        : 'bg-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border-transparent hover:bg-black/[0.03] dark:hover:bg-base-200/50'
                                }`}
                            >
                                <span
                                    className="w-2 h-2 rounded-full shrink-0 transition-opacity"
                                    style={{
                                        backgroundColor: color,
                                        opacity: isSelected ? 1 : 0.4,
                                    }}
                                />
                                <span className="truncate max-w-[140px]">{m}</span>
                                {speedText && (
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                        ({speedText})
                                    </span>
                                )}
                                {isSelected && <Check className="w-3 h-3 text-blue-500 ml-0.5" />}
                            </button>
                        );
                    })}

                    {availableModels.length > 5 && (
                        <button
                            onClick={selectTopFive}
                            className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline ml-auto font-sans"
                            title={t('token_stats.speed.reset_top5_tip', '恢复选择采样最多的前 5 个模型')}
                        >
                            <RotateCcw className="w-3 h-3" />
                            <span>{t('token_stats.speed.reset_top5', 'Top 5')}</span>
                        </button>
                    )}
                </div>
            )}

            {/* Main Content Area */}
            {!hasData ? (
                <div className="h-56 flex flex-col items-center justify-center text-center p-6 bg-gray-50/50 dark:bg-base-200/30 rounded-xl border border-dashed border-gray-200 dark:border-base-300">
                    <div className="p-3 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-500 dark:text-blue-400 mb-2">
                        <Gauge className="w-6 h-6 opacity-70" />
                    </div>
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
                        {loading
                            ? t('common.loading', '加载中...')
                            : t('token_stats.speed.empty_title', '暂无耗时测速样本')}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 max-w-sm">
                        {t('token_stats.speed.empty_hint', '代理网关在处理新请求时将自动抓取 duration_ms 并计算实时 Token 输出速度。')}
                    </p>
                </div>
            ) : viewMode === 'trend' ? (
                /* Mode 1: Lollipop / Trend Chart */
                <div className="h-64 sm:h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(150, 150, 150, 0.15)" />
                            <XAxis
                                dataKey="label"
                                tick={{ fontSize: 10, fill: '#888888', fontFamily: 'monospace' }}
                                axisLine={false}
                                tickLine={false}
                                dy={5}
                            />
                            <YAxis
                                tick={{ fontSize: 10, fill: '#888888', fontFamily: 'monospace' }}
                                tickFormatter={(val) => `${val} t/s`}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip
                                content={({ active, payload, label }) => {
                                    if (!active || !payload || payload.length === 0) return null;
                                    return (
                                        <div className="bg-white dark:bg-base-100 p-3 rounded-xl shadow-lg border border-gray-200 dark:border-base-300 text-xs font-mono space-y-1.5 min-w-[200px]">
                                            <div className="font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-base-200 pb-1 flex items-center justify-between">
                                                <span>{label}</span>
                                                <span className="text-[10px] text-gray-400 font-sans">Token Speed</span>
                                            </div>
                                            {payload.map((entry: any) => {
                                                const modelName = entry.dataKey;
                                                const tps = entry.value;
                                                if (tps == null) return null;
                                                const samples = entry.payload[`${modelName}_samples`] || 0;
                                                return (
                                                    <div key={modelName} className="flex items-center justify-between gap-3">
                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                            <span
                                                                className="w-2 h-2 rounded-full shrink-0"
                                                                style={{ backgroundColor: entry.color }}
                                                            />
                                                            <span className="text-gray-600 dark:text-gray-300 truncate max-w-[120px]">
                                                                {modelName}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            <span className="font-bold text-gray-900 dark:text-white">
                                                                {tps.toFixed(1)} t/s
                                                            </span>
                                                            <span className="text-[10px] text-gray-400">
                                                                ({samples} 样本)
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                }}
                            />
                            {selectedModels.map((m) => (
                                <Line
                                    key={m}
                                    type="monotone"
                                    dataKey={m}
                                    stroke={modelColorMap[m] || '#3b82f6'}
                                    strokeWidth={2}
                                    dot={{ r: 4, strokeWidth: 1.5, fill: '#fff', stroke: modelColorMap[m] || '#3b82f6' }}
                                    activeDot={{ r: 6, stroke: modelColorMap[m] || '#3b82f6', strokeWidth: 2 }}
                                    connectNulls={true}
                                />
                            ))}
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                /* Mode 2: Half-Window Comparison (Dumbbell Chart) */
                <div className="space-y-3 py-1">
                    <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500 font-mono px-1 pb-1 border-b border-black/[0.04] dark:border-base-200">
                        <span>{t('token_stats.speed.col_model', '模型与分布')}</span>
                        <div className="flex items-center gap-8">
                            <span className="hidden sm:inline">{t('token_stats.speed.col_comparison', '前半段 (○) ➔ 后半段 (●)')}</span>
                            <span>{t('token_stats.speed.col_metrics', 'P95 首字 / 样本数')}</span>
                        </div>
                    </div>

                    <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                        {selectedModelDetails.map((m) => {
                            const color = modelColorMap[m.model] || '#3b82f6';
                            const firstTps = m.first_half_tps;
                            const secondTps = m.second_half_tps;
                            const delta = m.tps_delta;
                            const hasBoth = firstTps != null && secondTps != null;

                            // Calculate dumbbell relative bar coordinates
                            const maxVal = Math.max(firstTps || 0, secondTps || 0, m.max_tps, 1);
                            const leftPos = firstTps != null ? Math.min(100, Math.max(0, (firstTps / maxVal) * 100)) : 0;
                            const rightPos = secondTps != null ? Math.min(100, Math.max(0, (secondTps / maxVal) * 100)) : 0;
                            const minPos = Math.min(leftPos, rightPos);
                            const barWidth = Math.abs(rightPos - leftPos);

                            return (
                                <div
                                    key={m.model}
                                    className="bg-gray-50/80 dark:bg-base-200/50 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-black/[0.02] dark:border-base-300/30 hover:border-black/[0.06] dark:hover:border-base-300 transition-all"
                                >
                                    {/* Left: Model Name & Overall TPS */}
                                    <div className="flex items-center gap-2.5 min-w-0 sm:w-1/3">
                                        <div
                                            className="w-2.5 h-2.5 rounded-full shrink-0"
                                            style={{ backgroundColor: color }}
                                        />
                                        <div className="min-w-0">
                                            <div className="font-mono text-xs font-semibold text-gray-800 dark:text-gray-200 truncate" title={m.model}>
                                                {m.model}
                                            </div>
                                            <div className="flex items-center gap-2 text-[10px] font-mono text-gray-400 mt-0.5">
                                                <span>均速: <strong className="text-gray-700 dark:text-gray-300">{m.avg_tps.toFixed(1)}</strong> t/s</span>
                                                <span>·</span>
                                                <span>加权: {m.weighted_tps.toFixed(1)} t/s</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Middle: Horizontal Dumbbell track */}
                                    <div className="flex-1 flex flex-col justify-center px-2 min-w-[160px]">
                                        {hasBoth ? (
                                            <div className="space-y-1">
                                                <div className="relative h-4 flex items-center">
                                                    {/* Background track */}
                                                    <div className="w-full h-1 bg-gray-200 dark:bg-base-300 rounded-full" />
                                                    {/* Connecting Dumbbell Bar */}
                                                    <div
                                                        className="absolute h-1 rounded-full transition-all"
                                                        style={{
                                                            left: `${minPos}%`,
                                                            width: `${Math.max(barWidth, 2)}%`,
                                                            backgroundColor: delta != null && delta >= 0 ? '#10b981' : '#f43f5e',
                                                        }}
                                                    />
                                                    {/* Left Dot (First Half - Hollow) */}
                                                    <div
                                                        className="absolute w-3 h-3 rounded-full bg-white dark:bg-base-100 border-2 transition-all -ml-1.5 shadow-xs"
                                                        style={{
                                                            left: `${leftPos}%`,
                                                            borderColor: color,
                                                        }}
                                                        title={`前半段平均速度: ${firstTps?.toFixed(1)} t/s`}
                                                    />
                                                    {/* Right Dot (Second Half - Solid) */}
                                                    <div
                                                        className="absolute w-3 h-3 rounded-full transition-all -ml-1.5 shadow-xs"
                                                        style={{
                                                            left: `${rightPos}%`,
                                                            backgroundColor: color,
                                                        }}
                                                        title={`后半段平均速度: ${secondTps?.toFixed(1)} t/s`}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between text-[10px] font-mono text-gray-400">
                                                    <span>{firstTps?.toFixed(1)} t/s</span>
                                                    {delta != null && (
                                                        <span className={`font-semibold ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                            {delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)} t/s
                                                        </span>
                                                    )}
                                                    <span>{secondTps?.toFixed(1)} t/s</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-[11px] font-mono text-gray-400 dark:text-gray-500 text-center">
                                                {t('token_stats.speed.insufficient_samples', '样本集中在单侧，暂无半窗对比')}
                                            </div>
                                        )}
                                    </div>

                                    {/* Right: TTFT & Sample Count */}
                                    <div className="flex sm:flex-col items-end justify-between sm:justify-center shrink-0 text-right font-mono text-xs border-t sm:border-t-0 pt-2 sm:pt-0 border-black/[0.03] dark:border-base-200">
                                        <div className="flex items-center gap-1 text-gray-700 dark:text-gray-300">
                                            <span className="text-[10px] text-gray-400 font-sans">P95首字:</span>
                                            <span className="font-semibold text-amber-600 dark:text-amber-400">
                                                {m.p95_ttft_ms != null ? (m.p95_ttft_ms < 1000 ? `${Math.round(m.p95_ttft_ms)}ms` : `${(m.p95_ttft_ms / 1000).toFixed(2)}s`) : '-'}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-gray-400 mt-0.5">
                                            {m.sample_count} {t('token_stats.speed.requests_unit', '请求')} · {Math.round(m.total_output_tokens / 1000)}k 输出
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
