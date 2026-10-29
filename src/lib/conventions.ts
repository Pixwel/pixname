// House styles some studios (or single projects) want in their file names, set by admins on the
// Pixname service. A project's own setting wins over its studio's; unset means the general behaviour.
import { studioIdOf, type Project } from "./types";

export interface Conventions {
  /** Zip files are collects: "…_ENG_COLLECT.zip", with no text or codec tokens (Focus Features). */
  zipCollect?: boolean;
}

export type ConventionKey = keyof Conventions;

/** Every convention with how it's described in Settings; new ones only need a line here. */
export const CONVENTIONS: { key: ConventionKey; label: string; hint: string }[] = [
  { key: "zipCollect", label: "Zip files are collects", hint: "…_ENG_COLLECT.zip, with no text or codec tokens" },
];

export interface ConventionRow {
  scope: "studio" | "project";
  targetId: string;
  values: Conventions;
  updatedBy: string;
  at: number;
}

/** What applies to a project: its studio's conventions, overridden by its own. */
export function conventionsFor(project: Project | undefined, rows: ConventionRow[]): Conventions {
  if (!project) return {};
  const studioId = studioIdOf(project);
  const studio = rows.find((r) => r.scope === "studio" && r.targetId === studioId)?.values ?? {};
  const own = rows.find((r) => r.scope === "project" && r.targetId === project._id)?.values ?? {};
  return { ...studio, ...own };
}
