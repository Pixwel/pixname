import { useMemo } from "react";
import { useStore } from "./store";
import { distinguishingExtras } from "./lib/collisions";
import { propose, type Proposal, type ProposeContext } from "./lib/propose";
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
    const contexts = new Map<Row, ProposeContext>();
    const rows = items.map((item) => {
      const project = projectList.find((p) => p._id === item.project?.id);
      const assetList = item.project ? assets[item.project.id] : undefined;
      const asset = assetList?.status === "ready" ? assetList.data.find((a) => a._id === item.asset?.id) : undefined;
      const wrList = item.project ? workRequests[item.project.id] : undefined;
      const workRequest =
        item.overrides.workRequestId && wrList?.status === "ready"
          ? wrList.data.find((w) => w._id === item.overrides.workRequestId)
          : undefined;
      const ctx = { catalog, projects: projectList, project, asset, workRequest };
      const proposal = propose(item, ctx);
      if (!proposal.error && item.asset && !asset && assetList?.status !== "ready") {
        proposal.error = "Loading assets…";
      }
      const row = { item, proposal, status: statusOf(item, proposal) };
      contexts.set(row, ctx);
      return row;
    });

    // Files that would share a name usually differ in their original names ("Green Box" /
    // "White Box"): suggest those words as an Extra token, unless the user already set one.
    for (const group of collisions(rows)) {
      const open = group.filter((row) => row.item.overrides.extra === undefined);
      const extras = distinguishingExtras(
        open.map((row) => {
          const { project, asset } = contexts.get(row)!;
          return { name: row.item.file.name, known: [row.proposal.name!, project?.name ?? "", asset?.name ?? ""] };
        }),
      );
      open.forEach((row, i) => {
        const extra = extras[i];
        if (!extra) return;
        const item = { ...row.item, overrides: { ...row.item.overrides, extra: [...row.proposal.tags.Extra, extra] } };
        const proposal = propose(item, contexts.get(row)!);
        proposal.warnings.push(`Added Extra "${extra}" from the original name to tell ${group.length} same-named files apart`);
        row.proposal = proposal;
        row.status = statusOf(row.item, proposal);
      });
    }

    for (const group of collisions(rows)) {
      for (const row of group) {
        row.proposal = { ...row.proposal, error: `Same name as ${group.length - 1} other file(s) — set an Extra token or version to tell them apart` };
        row.status = "error";
      }
    }
    return rows;
  }, [items, catalog, projects, assets, workRequests]);
}

/** Groups of rows whose proposed names clash in one folder (case-insensitively, for macOS/Windows). */
function collisions(rows: Row[]): Row[][] {
  const seen = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.proposal.name || row.proposal.error) continue;
    const key = `${row.item.file.dir}/${row.proposal.name}`.toLowerCase();
    seen.set(key, [...(seen.get(key) ?? []), row]);
  }
  return [...seen.values()].filter((group) => group.length > 1);
}
