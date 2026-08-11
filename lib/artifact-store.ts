import type { SandboxArtifactData } from "@/lib/sandbox-types";

/**
 * In-memory cache of deliverable bytes produced by sandbox runs. Bytes are
 * read back from OpenSandbox before the temp environment is deleted, then
 * served to the Agent via the internal artifacts endpoints.
 *
 * Bytes are intentionally NOT persisted to Mongo (the persisted run payload
 * must stay small); the manifest metadata lives on the run record. After a
 * service restart the bytes are gone and the manifest endpoints return 404
 * for the missing payloads, which the Agent treats as unavailable artifacts.
 */
type ArtifactMap = Map<string, Map<string, SandboxArtifactData>>;

const globalStore = globalThis as typeof globalThis & { __zmzaiSandboxArtifacts?: ArtifactMap };
const store: ArtifactMap = globalStore.__zmzaiSandboxArtifacts ?? new Map();
globalStore.__zmzaiSandboxArtifacts = store;

export function setRunArtifacts(runId: string, artifacts: SandboxArtifactData[]): void {
  store.set(runId, new Map(artifacts.map((artifact) => [artifact.path, artifact])));
}

export function getRunArtifacts(runId: string): SandboxArtifactData[] {
  return [...(store.get(runId)?.values() ?? [])];
}

export function getRunArtifact(runId: string, path: string): SandboxArtifactData | undefined {
  return store.get(runId)?.get(path);
}

export function clearRunArtifacts(runId: string): void {
  store.delete(runId);
}
