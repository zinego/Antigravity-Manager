import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Workflow,
  Cpu,
  RefreshCw,
  Layers,
  Coins,
  Hash,
} from 'lucide-react';

export interface AccountDistributionSlice {
  account_email: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  request_share_pct: number;
  token_share_pct: number;
}

export interface ModelAccountDistributionItem {
  model: string;
  total_requests: number;
  total_tokens: number;
  accounts: AccountDistributionSlice[];
}

export interface ModelAccountDistributionResponse {
  total_requests: number;
  total_tokens: number;
  models: ModelAccountDistributionItem[];
}

export interface ModelAccountFlowCardProps {
  data: ModelAccountDistributionResponse | null;
  loading?: boolean;
  theme?: 'light' | 'dark' | 'cockpit';
}

const ACCOUNT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#6366f1', // indigo
  '#14b8a6', // teal
];
const OTHERS_COLOR = '#64748b'; // slate

const formatTokens = (n: number): string => {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
};

const formatReqs = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
};

const truncateEmail = (email: string, maxLen = 22): string => {
  if (!email) return 'unknown';
  if (email.length <= maxLen) return email;
  const atIdx = email.indexOf('@');
  if (atIdx > 0) {
    const user = email.slice(0, atIdx);
    const domain = email.slice(atIdx + 1);
    if (user.length > 10) {
      return `${user.slice(0, 8)}...@${domain}`;
    }
  }
  return `${email.slice(0, maxLen - 3)}...`;
};

export const ModelAccountFlowCard: React.FC<ModelAccountFlowCardProps> = ({
  data,
  loading = false,
  theme,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(880);

  const [selectedModel, setSelectedModel] = useState<string>('all');
  const [metric, setMetric] = useState<'tokens' | 'requests'>('tokens');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const isCockpit = theme === 'cockpit';
  const isDark = theme === 'dark' || isCockpit;
  const isCompact = containerWidth < 680;
  const emailMaxLen = isCompact ? 14 : 20;

  // Available models sorted by tokens
  const availableModels = useMemo(() => {
    if (!data?.models) return [];
    return data.models;
  }, [data]);

  // Aggregate or select account data
  const {
    sourceTitle,
    sourceTotalRequests,
    sourceTotalTokens,
    displayAccounts,
  } = useMemo(() => {
    if (!data || data.models.length === 0) {
      return {
        sourceTitle: t('token_stats.flow_all_models', '全部汇总 (All)'),
        sourceTotalRequests: 0,
        sourceTotalTokens: 0,
        displayAccounts: [],
      };
    }

    let sourceTitle = t('token_stats.flow_all_models', '全部汇总 (All)');
    let sourceTotalRequests = data.total_requests;
    let sourceTotalTokens = data.total_tokens;
    let rawAccounts: AccountDistributionSlice[] = [];

    if (selectedModel === 'all') {
      const emailMap = new Map<string, {
        account_email: string;
        request_count: number;
        input_tokens: number;
        output_tokens: number;
        cached_tokens: number;
        total_tokens: number;
      }>();

      for (const m of data.models) {
        for (const a of m.accounts) {
          const existing = emailMap.get(a.account_email);
          if (existing) {
            existing.request_count += a.request_count;
            existing.input_tokens += a.input_tokens;
            existing.output_tokens += a.output_tokens;
            existing.cached_tokens += a.cached_tokens;
            existing.total_tokens += a.total_tokens;
          } else {
            emailMap.set(a.account_email, { ...a });
          }
        }
      }

      rawAccounts = Array.from(emailMap.values()).map((acc) => {
        const reqPct = data.total_requests > 0
          ? (acc.request_count / data.total_requests) * 100
          : 0;
        const tokPct = data.total_tokens > 0
          ? (acc.total_tokens / data.total_tokens) * 100
          : 0;
        return {
          ...acc,
          request_share_pct: Number(reqPct.toFixed(2)),
          token_share_pct: Number(tokPct.toFixed(2)),
        };
      });
    } else {
      const found = data.models.find((m) => m.model === selectedModel);
      if (found) {
        sourceTitle = found.model;
        sourceTotalRequests = found.total_requests;
        sourceTotalTokens = found.total_tokens;
        rawAccounts = found.accounts.map((a) => ({ ...a }));
      } else {
        sourceTitle = selectedModel;
      }
    }

    // Sort accounts according to active metric
    if (metric === 'tokens') {
      rawAccounts.sort((a, b) => b.total_tokens - a.total_tokens || b.request_count - a.request_count);
    } else {
      rawAccounts.sort((a, b) => b.request_count - a.request_count || b.total_tokens - a.total_tokens);
    }

    // Top 5 accounts + "其他 (Others)" if > 5
    let displayAccounts: (AccountDistributionSlice & { color: string; isOthers?: boolean })[] = [];
    if (rawAccounts.length <= 5) {
      displayAccounts = rawAccounts.map((a, idx) => ({
        ...a,
        color: ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length],
        isOthers: false,
      }));
    } else {
      const top5 = rawAccounts.slice(0, 5).map((a, idx) => ({
        ...a,
        color: ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length],
        isOthers: false,
      }));
      const others = rawAccounts.slice(5);
      const othersAgg = others.reduce(
        (acc, cur) => {
          acc.request_count += cur.request_count;
          acc.input_tokens += cur.input_tokens;
          acc.output_tokens += cur.output_tokens;
          acc.cached_tokens += cur.cached_tokens;
          acc.total_tokens += cur.total_tokens;
          acc.request_share_pct += cur.request_share_pct;
          acc.token_share_pct += cur.token_share_pct;
          return acc;
        },
        {
          account_email: t('token_stats.flow_others', '其他 (Others)'),
          request_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          cached_tokens: 0,
          total_tokens: 0,
          request_share_pct: 0,
          token_share_pct: 0,
        }
      );
      othersAgg.request_share_pct = Number(Math.min(100, othersAgg.request_share_pct).toFixed(2));
      othersAgg.token_share_pct = Number(Math.min(100, othersAgg.token_share_pct).toFixed(2));
      displayAccounts = [
        ...top5,
        {
          ...othersAgg,
          color: OTHERS_COLOR,
          isOthers: true,
        },
      ];
    }

    return {
      sourceTitle,
      sourceTotalRequests,
      sourceTotalTokens,
      displayAccounts,
    };
  }, [data, selectedModel, metric, t]);

  // Compute layout coordinates for ribbons and cards
  // ViewBox: 920 x 340
  const layout = useMemo(() => {
    const N = displayAccounts.length;
    if (N === 0) return { slices: [] };

    // Metric total for relative slice heights
    const totalMetricVal = displayAccounts.reduce((sum, item) => {
      const val = metric === 'tokens' ? item.total_tokens : item.request_count;
      return sum + val;
    }, 0);

    const leftBarY = 24;
    const leftBarHeight = 292;
    const leftBarRightX = 206;
    const rightCardsLeftX = 474;

    // Right rows height and centering
    const cardHeight = 44;
    const gap = 8;
    const totalRightHeight = N * cardHeight + (N - 1) * gap;
    const rightStartY = leftBarY + Math.max(0, (leftBarHeight - totalRightHeight) / 2);

    let curLeftY = leftBarY;

    const slices = displayAccounts.map((item, idx) => {
      const metricVal = metric === 'tokens' ? item.total_tokens : item.request_count;
      const share = totalMetricVal > 0 ? metricVal / totalMetricVal : 1 / N;
      const sliceH = Math.max(6, share * leftBarHeight);

      const yL_start = curLeftY;
      const yL_end = Math.min(leftBarY + leftBarHeight, curLeftY + sliceH);
      curLeftY = yL_end;

      const cardY = rightStartY + idx * (cardHeight + gap);
      const cardMidY = cardY + cardHeight / 2;

      // Ribbon connector thickness on the right
      const rThickness = Math.max(6, Math.min(30, sliceH * 0.85));
      const yR_start = cardMidY - rThickness / 2;
      const yR_end = cardMidY + rThickness / 2;

      // Cubic bezier control points
      const spanX = rightCardsLeftX - leftBarRightX;
      const cp1x = leftBarRightX + spanX * 0.46;
      const cp2x = rightCardsLeftX - spanX * 0.46;

      const ribbonPath = `M ${leftBarRightX} ${yL_start.toFixed(1)} ` +
        `C ${cp1x.toFixed(1)} ${yL_start.toFixed(1)}, ${cp2x.toFixed(1)} ${yR_start.toFixed(1)}, ${rightCardsLeftX} ${yR_start.toFixed(1)} ` +
        `L ${rightCardsLeftX} ${yR_end.toFixed(1)} ` +
        `C ${cp2x.toFixed(1)} ${yR_end.toFixed(1)}, ${cp1x.toFixed(1)} ${yL_end.toFixed(1)}, ${leftBarRightX} ${yL_end.toFixed(1)} ` +
        `Z`;

      const pct = metric === 'tokens' ? item.token_share_pct : item.request_share_pct;

      return {
        item,
        idx,
        color: item.color,
        pct,
        yL_start,
        yL_end,
        cardY,
        cardMidY,
        ribbonPath,
      };
    });

    return { slices };
  }, [displayAccounts, metric]);

  // Card theme classes
  const cardContainerClass = useMemo(() => {
    if (isCockpit) {
      return 'bg-[#0c121e] border-[#1e2a3f] text-gray-100 font-mono shadow-xl';
    }
    if (theme === 'dark') {
      return 'bg-[#121316] border-white/[0.08] text-white shadow-sm';
    }
    return 'bg-white dark:bg-[#121316] border-gray-200/80 dark:border-white/[0.08] text-gray-900 dark:text-white shadow-sm';
  }, [theme, isCockpit]);

  return (
    <div
      ref={containerRef}
      className={`rounded-2xl p-4 sm:p-5 border flex flex-col gap-4 select-none transition-colors ${cardContainerClass}`}
    >
      {/* 顶部标题栏与指标切换 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 dark:border-white/[0.06] pb-3">
        <div className="flex items-center gap-2.5">
          <Workflow className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-wide text-gray-900 dark:text-white/95">
                {t('token_stats.flow_card_title', '模型与账号流向')}
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-300 border border-purple-500/20">
                {t('token_stats.flow_badge', '流量调度')}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-white/40">
              {t('token_stats.flow_card_subtitle', '直观透视模型请求在各上游账号间的分配比例与流量聚合')}
            </p>
          </div>
        </div>

        {/* 指标 Toggle: Tokens vs Requests */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/[0.06] p-1 rounded-xl text-xs font-mono">
          <button
            type="button"
            onClick={() => setMetric('tokens')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition-all ${
              metric === 'tokens'
                ? isCockpit
                  ? 'bg-emerald-500/20 text-emerald-300 font-bold shadow-sm border border-emerald-500/30'
                  : 'bg-white dark:bg-[#1f2024] text-purple-600 dark:text-purple-400 font-medium shadow-sm'
                : 'text-gray-500 dark:text-white/50 hover:text-gray-800 dark:hover:text-white'
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            <span>Tokens</span>
          </button>
          <button
            type="button"
            onClick={() => setMetric('requests')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition-all ${
              metric === 'requests'
                ? isCockpit
                  ? 'bg-emerald-500/20 text-emerald-300 font-bold shadow-sm border border-emerald-500/30'
                  : 'bg-white dark:bg-[#1f2024] text-purple-600 dark:text-purple-400 font-medium shadow-sm'
                : 'text-gray-500 dark:text-white/50 hover:text-gray-800 dark:hover:text-white'
            }`}
          >
            <Hash className="w-3.5 h-3.5" />
            <span>{t('token_stats.requests', '请求数')}</span>
          </button>
        </div>
      </div>

      {/* 模型 Filter Bar: 全部汇总 (All) + 单模型 Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-mono scrollbar-none">
        <button
          type="button"
          onClick={() => setSelectedModel('all')}
          className={`px-3 py-1.5 rounded-full flex-shrink-0 transition-all ${
            selectedModel === 'all'
              ? isCockpit
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold'
                : 'bg-purple-600 text-white shadow-sm font-semibold'
              : 'bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/[0.1]'
          }`}
        >
          {t('token_stats.flow_all_pill', '全部汇总 (All)')}
        </button>

        {availableModels.map((m) => {
          const isSelected = selectedModel === m.model;
          return (
            <button
              key={m.model}
              type="button"
              onClick={() => setSelectedModel(m.model)}
              className={`px-3 py-1.5 rounded-full flex-shrink-0 flex items-center gap-1.5 transition-all ${
                isSelected
                  ? isCockpit
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold'
                    : 'bg-purple-600 text-white shadow-sm font-semibold'
                  : 'bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/[0.1]'
              }`}
            >
              <Cpu className="w-3 h-3 opacity-70" />
              <span>{m.model}</span>
              <span className="text-[10px] opacity-60">
                ({metric === 'tokens' ? formatTokens(m.total_tokens) : formatReqs(m.total_requests)})
              </span>
            </button>
          );
        })}
      </div>

      {/* 主体可视化区域 */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <RefreshCw className="w-7 h-7 text-purple-500 animate-spin mb-3" />
          <span className="text-xs font-mono text-gray-400 dark:text-white/50">
            {t('token_stats.loading_flow', '加载模型流向数据中...')}
          </span>
        </div>
      ) : !data || data.models.length === 0 || displayAccounts.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center text-center">
          <Layers className="w-8 h-8 text-gray-300 dark:text-white/20 mb-2.5" />
          <div className="text-sm font-medium text-gray-500 dark:text-white/60">
            {t('token_stats.no_flow_data', '暂无模型账号流向数据')}
          </div>
          <div className="text-xs text-gray-400 dark:text-white/40 mt-1 max-w-sm">
            {t('token_stats.no_flow_data_desc', '在选定时间跨度内尚未捕获到此模型的路由调度调用')}
          </div>
        </div>
      ) : (
        <div className="w-full relative overflow-hidden rounded-xl border border-gray-100 dark:border-white/[0.04]">
          {/* 纯 SVG + 三次贝塞尔曲线 Flow Ribbons */}
          <svg
            viewBox="0 0 920 340"
            className="w-full h-auto select-none block"
            style={{ minHeight: '260px' }}
          >
            <defs>
              {layout.slices.map((s) => {
                const isHovered = hoveredIdx === s.idx;
                const isAnyHovered = hoveredIdx !== null;
                const baseOpacity = isAnyHovered ? (isHovered ? 0.9 : 0.12) : (isCockpit ? 0.65 : 0.5);
                return (
                  <linearGradient
                    key={`grad-${s.idx}`}
                    id={`ribbon-grad-${s.idx}`}
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="0%"
                  >
                    <stop offset="0%" stopColor={s.color} stopOpacity={baseOpacity * 0.8} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={baseOpacity} />
                  </linearGradient>
                );
              })}
            </defs>

            {/* 左侧 Source 卡片整体容器 */}
            <g>
              <rect
                x="20"
                y="24"
                width="186"
                height="292"
                rx="14"
                fill={isCockpit ? '#0f172a' : isDark ? '#16171b' : '#f8fafc'}
                stroke={isCockpit ? '#1e293b' : isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0'}
                strokeWidth="1.2"
              />

              {/* 顶部标签 */}
              <rect
                x="34"
                y="38"
                width="64"
                height="20"
                rx="5"
                fill={isCockpit ? '#1e293b' : isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0'}
              />
              <text
                x="66"
                y="52"
                textAnchor="middle"
                fontSize="10"
                fontWeight="700"
                fontFamily="ui-monospace, monospace"
                fill={isCockpit ? '#38bdf8' : isDark ? '#c084fc' : '#7c3aed'}
              >
                100% 源流
              </text>

              {/* 模型标题 */}
              <text
                x="34"
                y="84"
                fontSize="13"
                fontWeight="700"
                fontFamily="system-ui, -apple-system, sans-serif"
                fill={isCockpit ? '#f1f5f9' : isDark ? '#ffffff' : '#0f172a'}
              >
                <title>{sourceTitle}</title>
                {truncateEmail(sourceTitle, isCompact ? 12 : 16)}
              </text>

              {/* 统计指标 */}
              <text
                x="34"
                y="118"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
                fill={isCockpit ? '#94a3b8' : isDark ? '#9ca3af' : '#64748b'}
              >
                总消耗 Tokens
              </text>
              <text
                x="34"
                y="138"
                fontSize="16"
                fontWeight="800"
                fontFamily="ui-monospace, monospace"
                fill={isCockpit ? '#38bdf8' : isDark ? '#c084fc' : '#7c3aed'}
              >
                {formatTokens(sourceTotalTokens)}
              </text>

              <text
                x="34"
                y="172"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
                fill={isCockpit ? '#94a3b8' : isDark ? '#9ca3af' : '#64748b'}
              >
                总请求次数
              </text>
              <text
                x="34"
                y="192"
                fontSize="14"
                fontWeight="700"
                fontFamily="ui-monospace, monospace"
                fill={isCockpit ? '#e2e8f0' : isDark ? '#f3f4f6' : '#1e293b'}
              >
                {formatReqs(sourceTotalRequests)} 次
              </text>

              <text
                x="34"
                y="280"
                fontSize="9.5"
                fontFamily="system-ui, sans-serif"
                fill={isCockpit ? '#64748b' : isDark ? '#6b7280' : '#94a3b8'}
              >
                {displayAccounts.length} 个账号承接流量
              </text>

              {/* 左侧垂直彩条 (Segmented Bar) */}
              <g>
                {layout.slices.map((s) => {
                  const isHovered = hoveredIdx === s.idx;
                  return (
                    <rect
                      key={`left-seg-${s.idx}`}
                      x="198"
                      y={s.yL_start}
                      width="8"
                      height={Math.max(2, s.yL_end - s.yL_start)}
                      fill={s.color}
                      opacity={hoveredIdx !== null && !isHovered ? 0.35 : 1}
                      className="transition-all duration-200 cursor-pointer"
                      onMouseEnter={() => setHoveredIdx(s.idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    >
                      <title>{`${s.item.account_email}: ${s.pct.toFixed(1)}%`}</title>
                    </rect>
                  );
                })}
              </g>
            </g>

            {/* 中间平滑三次贝塞尔曲线 Ribbons */}
            <g>
              {layout.slices.map((s) => {
                const isHovered = hoveredIdx === s.idx;
                return (
                  <path
                    key={`ribbon-${s.idx}`}
                    d={s.ribbonPath}
                    fill={`url(#ribbon-grad-${s.idx})`}
                    stroke={s.color}
                    strokeWidth={isHovered ? '1.5' : '0.5'}
                    strokeOpacity={isHovered ? 0.9 : 0.25}
                    className="transition-all duration-200 cursor-pointer"
                    onMouseEnter={() => setHoveredIdx(s.idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  >
                    <title>
                      {`${s.item.account_email}: ${s.pct.toFixed(1)}% (${formatTokens(s.item.total_tokens)} Tokens / ${formatReqs(s.item.request_count)} reqs)`}
                    </title>
                  </path>
                );
              })}
            </g>

            {/* 右侧 Account Rows */}
            <g>
              {layout.slices.map((s) => {
                const isHovered = hoveredIdx === s.idx;
                const cardFill = isHovered
                  ? isCockpit
                    ? '#162033'
                    : isDark
                    ? '#202227'
                    : '#f1f5f9'
                  : isCockpit
                  ? '#0f172a'
                  : isDark
                  ? '#16171b'
                  : '#f8fafc';
                const strokeColor = isHovered
                  ? s.color
                  : isCockpit
                  ? '#1e293b'
                  : isDark
                  ? 'rgba(255, 255, 255, 0.08)'
                  : '#e2e8f0';

                return (
                  <g
                    key={`row-${s.idx}`}
                    className="cursor-pointer transition-all duration-200"
                    onMouseEnter={() => setHoveredIdx(s.idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  >
                    {/* 背景卡片 */}
                    <rect
                      x="474"
                      y={s.cardY}
                      width="426"
                      height="44"
                      rx="10"
                      fill={cardFill}
                      stroke={strokeColor}
                      strokeWidth={isHovered ? '1.4' : '1'}
                      className="transition-colors duration-200"
                    />

                    {/* 彩色指示圆点 */}
                    <circle
                      cx="494"
                      cy={s.cardMidY}
                      r={isHovered ? 6 : 5}
                      fill={s.color}
                      className="transition-all duration-200"
                    />

                    {/* 账号名称 */}
                    <text
                      x="508"
                      y={s.cardMidY + 4}
                      fontSize="11.5"
                      fontFamily="ui-monospace, monospace"
                      fontWeight={isHovered ? '700' : '500'}
                      fill={isCockpit ? '#e2e8f0' : isDark ? '#f3f4f6' : '#1e293b'}
                    >
                      <title>{s.item.account_email}</title>
                      {truncateEmail(s.item.account_email, emailMaxLen)}
                    </text>

                    {/* 粗体占比 */}
                    <text
                      x="712"
                      y={s.cardMidY + 4}
                      textAnchor="end"
                      fontSize="12.5"
                      fontWeight="800"
                      fontFamily="ui-monospace, monospace"
                      fill={s.color}
                    >
                      {s.pct.toFixed(1)}%
                    </text>

                    {/* Tokens Badge */}
                    <rect
                      x="724"
                      y={s.cardMidY - 10}
                      width="88"
                      height="20"
                      rx="5"
                      fill={isCockpit ? '#1e293b' : isDark ? 'rgba(255, 255, 255, 0.06)' : '#e2e8f0'}
                    />
                    <text
                      x="768"
                      y={s.cardMidY + 4}
                      textAnchor="middle"
                      fontSize="10"
                      fontFamily="ui-monospace, monospace"
                      fontWeight="600"
                      fill={isCockpit ? '#38bdf8' : isDark ? '#c084fc' : '#6b21a8'}
                    >
                      {formatTokens(s.item.total_tokens)} Tok
                    </text>

                    {/* Requests Badge */}
                    <rect
                      x="818"
                      y={s.cardMidY - 10}
                      width="74"
                      height="20"
                      rx="5"
                      fill={isCockpit ? '#1e293b' : isDark ? 'rgba(255, 255, 255, 0.06)' : '#e2e8f0'}
                    />
                    <text
                      x="855"
                      y={s.cardMidY + 4}
                      textAnchor="middle"
                      fontSize="10"
                      fontFamily="ui-monospace, monospace"
                      fontWeight="600"
                      fill={isCockpit ? '#94a3b8' : isDark ? '#9ca3af' : '#475569'}
                    >
                      {formatReqs(s.item.request_count)} 次
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}
    </div>
  );
};
