import { useMemo } from "react";
import { useStore } from "./store";
import { propose, type Proposal } from "./lib/propose";
import type { QueueItem } from "./lib/types";

export type RowStatus = "probing" | "ready" | "unchanged" | "warning" | "error";

export interface Row {
  item: QueueItem;
  proposal: Proposal;
  status: RowStatus;
}

export function statusOf(item: QueueItem, proposal: Proposal): RowStatus {
  if (item.probing) return "probing";
  if (proposal.error) return "error";
  if (proposal.unchanged) return "unchanged";
  if (proposal.warnings.length || item.asset?.source === "fuzzy" || item.project?.source === "fuzzy") return "warning";
  return "ready";
}

export function useProposals(): Row[] {
  const items = useStore((s) => s.items);
  const catalog = useStore((s) => s.catalog);
  const projects = useStore((s) => s.projects);
  const assets = useStore((s) => s.assets);
  const workRequests = useStore((s) => s.workRequests);

  return useMemo(() => {
    const projectList = projects.status === "ready" ? projects.data : [];
    const rows = items.map((item) => {
      const project = projectList.find((p) => p._id === item.project?.id);
      const assetList = item.project ? assets[item.project.id] : undefined;
      const asset = assetList?.status === "ready" ? assetList.data.find((a) => a._id === item.asset?.id) : undefined;
      const wrList = item.project ? workRequests[item.project.id] : undefined;
      const workRequest =
        item.overrides.workRequestId && wrList?.status === "ready"
          ? wrList.data.find((w) => w._id === item.overrides.workRequestId)
          : undefined;
      const proposal = propose(item, { catalog, projects: projectList, project, asset, workRequest });
      if (!proposal.error && item.asset && !asset && assetList?.status !== "ready") {
        proposal.error = "Loading assets…";
      }
      return { item, proposal, status: statusOf(item, proposal) };
    });

    // Two files in one folder can't end up with the same name (case-insensitively, for macOS/Windows).
    const seen = new Map<string, Row[]>();
    for (const row of rows) {
      if (!row.proposal.name) continue;
      const key = `${row.item.file.dir}/${row.proposal.name}`.toLowerCase();
      seen.set(key, [...(seen.get(key) ?? []), row]);
    }
    for (const group of seen.values()) {
      if (group.length < 2) continue;
      for (const row of group) {
        row.proposal = { ...row.proposal, error: `Same name as ${group.length - 1} other file(s) — set an Extra token or version to tell them apart` };
        row.status = "error";
      }
    }
    return rows;
  }, [items, catalog, projects, assets, workRequests]);
}
