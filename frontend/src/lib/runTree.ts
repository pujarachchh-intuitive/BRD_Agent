import { BackendRunSummary } from "./types";

export interface RunTreeNode {
  run: BackendRunSummary;
  children: RunTreeNode[];
}

/** Groups a flat run list into a forest: a run with a recognized parent_run_id nests under that
 * parent's node; everything else (an original request, or a revision whose parent predates that
 * link being persisted) is its own root. Roots keep the API's newest-first order; each node's
 * children are sorted oldest-first (the order the revisions were actually made in). */
export function buildRunTree(runs: BackendRunSummary[]): RunTreeNode[] {
  const byId = new Map(runs.map((r) => [r.run_id, r]));
  const childrenOf = new Map<string, BackendRunSummary[]>();
  const roots: BackendRunSummary[] = [];

  for (const run of runs) {
    if (run.parent_run_id && byId.has(run.parent_run_id)) {
      const siblings = childrenOf.get(run.parent_run_id) ?? [];
      siblings.push(run);
      childrenOf.set(run.parent_run_id, siblings);
    } else {
      roots.push(run);
    }
  }

  function buildNode(run: BackendRunSummary): RunTreeNode {
    const children = (childrenOf.get(run.run_id) ?? []).sort((a, b) => a.run_id.localeCompare(b.run_id));
    return { run, children: children.map(buildNode) };
  }

  return roots.map(buildNode);
}

/** Total node count in a tree (run + every nested revision), for a flat "X results" count that
 * still reflects search/filtering applied before buildRunTree. */
export function countTreeNodes(nodes: RunTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countTreeNodes(node.children), 0);
}
