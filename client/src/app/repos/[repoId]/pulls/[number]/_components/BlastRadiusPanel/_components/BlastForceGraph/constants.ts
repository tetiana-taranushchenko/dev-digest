export const MAX_GRAPH_NODES = 120;
export const MAX_LABEL_CHARS = 28;
export const SIMULATION_TICKS = 300;
export const DENSE_LABEL_THRESHOLD = 16;

export const VIEWBOX = { width: 880, height: 460 } as const;

export const NODE_RADIUS = {
  symbol: 7.5,
  caller: 4.5,
  endpoint: 5.5,
  cron: 5.5,
} as const;

export const LINK_DISTANCE = 105;
export const CHARGE_STRENGTH = -220;
export const DRAG_ALPHA_TARGET = 0.3;
