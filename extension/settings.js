export const DEFAULTS = Object.freeze({ enabled: true, threshold: 0.7, mode: 'remove', animation: true, toast: true });

export function normalizeSettings(value = {}) {
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULTS.enabled,
    threshold: typeof value.threshold === 'number' && Number.isFinite(value.threshold)
      ? Math.min(0.95, Math.max(0.3, value.threshold)) : DEFAULTS.threshold,
    mode: value.mode === 'highlight' ? 'highlight' : 'remove',
    animation: typeof value.animation === 'boolean' ? value.animation : DEFAULTS.animation,
    toast: typeof value.toast === 'boolean' ? value.toast : DEFAULTS.toast,
  };
}
