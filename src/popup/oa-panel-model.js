/**
 * Resolve OA panel counters/labels from blocked + observed + grouped data.
 * This module is DOM-free to allow deterministic unit tests.
 */

function toInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function normalizeBlockedCounts(blockedByCategory) {
  return {
    ads: toInt(blockedByCategory?.ads),
    trackers: toInt(blockedByCategory?.trackers),
    popups: toInt(blockedByCategory?.popups),
    other: toInt(blockedByCategory?.other),
  };
}

function normalizeObservedCounts(observedByCategory) {
  return {
    ads: toInt(observedByCategory?.ads),
    trackers: toInt(observedByCategory?.trackers),
    popups: 0,
    other: toInt(observedByCategory?.other),
  };
}

function buildDomainFallbackCounts(groups) {
  return {
    ads: toInt(groups?.ads?.length),
    trackers: toInt(groups?.trackers?.length),
    popups: 0,
    other: toInt(groups?.other?.length),
  };
}

function totalCounts(counts) {
  return toInt(counts.ads) + toInt(counts.trackers) + toInt(counts.popups) + toInt(counts.other);
}

export function resolveOAPanelModel({ groups, blocked, blockedByCategory, observedByCategory } = {}) {
  const blockedCount = toInt(blocked);
  const blockedCounts = normalizeBlockedCounts(blockedByCategory);
  const observedCounts = normalizeObservedCounts(observedByCategory);
  const domainFallbackCounts = buildDomainFallbackCounts(groups);

  const blockedTotal = totalCounts(blockedCounts);
  const observedTotal = totalCounts(observedCounts);

  const counts = blockedTotal > 0
    ? blockedCounts
    : observedTotal > 0
      ? observedCounts
      : domainFallbackCounts;

  const total = totalCounts(counts);
  const badgeCount = blockedCount > 0 ? blockedCount : total;
  const badgeLabel = blockedCount > 0
    ? 'Trackers blocked'
    : (total > 0 ? 'Trackers observed' : 'Trackers blocked');

  return {
    counts,
    total,
    badgeCount,
    badgeLabel,
  };
}
