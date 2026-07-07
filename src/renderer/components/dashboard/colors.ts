/**
 * A stable, readable palette for per-agent series in the dashboard (chart bands,
 * table swatches). Colors are assigned by the agent's index in a sorted id list
 * so the same agent keeps its color across a render pass.
 */
const AGENT_PALETTE = [
  '#22d3ee', // accent cyan
  '#818cf8', // violet
  '#f59e0b', // amber
  '#22c55e', // green
  '#f472b6', // pink
  '#38bdf8', // sky
  '#a78bfa', // purple
  '#fb7185', // rose
  '#34d399', // emerald
  '#facc15' // yellow
]

export function agentColor(index: number): string {
  return AGENT_PALETTE[index % AGENT_PALETTE.length] ?? '#22d3ee'
}
