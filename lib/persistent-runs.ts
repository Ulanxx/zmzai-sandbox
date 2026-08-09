import { model, models, Schema, type Model } from "mongoose";

import { connectMongo } from "@/lib/mongo";
import type { SandboxRun } from "@/lib/sandbox-types";

type StoredRun = { runId: string; userId: string; ownerSandboxKeyId?: string; payload: SandboxRun; expiresAt: Date };
type Submission = { ownerSandboxKeyId: string; idempotencyKey: string; requestHash: string; runId: string; expiresAt: Date };

const runSchema = new Schema<StoredRun>({ runId: { type: String, unique: true, index: true, required: true }, userId: { type: String, index: true, required: true }, ownerSandboxKeyId: { type: String, index: true }, payload: { type: Schema.Types.Mixed, required: true }, expiresAt: { type: Date, required: true } }, { strict: "throw", timestamps: true });
runSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const submissionSchema = new Schema<Submission>({ ownerSandboxKeyId: { type: String, required: true }, idempotencyKey: { type: String, required: true }, requestHash: { type: String, required: true }, runId: { type: String, required: true }, expiresAt: { type: Date, required: true } }, { strict: "throw", timestamps: true });
submissionSchema.index({ ownerSandboxKeyId: 1, idempotencyKey: 1 }, { unique: true });
submissionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const SandboxRunModel = (models.ZmzaiSandboxRun as Model<StoredRun> | undefined) ?? model<StoredRun>("ZmzaiSandboxRun", runSchema);
const SandboxSubmissionModel = (models.ZmzaiSandboxSubmission as Model<Submission> | undefined) ?? model<Submission>("ZmzaiSandboxSubmission", submissionSchema);
const expiry = () => new Date(Date.now() + 60 * 60 * 1000);

export async function persistRun(run: SandboxRun) {
  await connectMongo();
  await SandboxRunModel.updateOne({ runId: run.id }, { $set: { userId: run.userId, ownerSandboxKeyId: run.ownerSandboxKeyId, payload: run, expiresAt: expiry() } }, { upsert: true });
}

export async function persistedRun(runId: string, ownerSandboxKeyId?: string) {
  await connectMongo();
  const doc = await SandboxRunModel.findOne({ runId, ...(ownerSandboxKeyId ? { ownerSandboxKeyId } : {}) }).lean();
  return doc?.payload;
}

export async function persistedRuns(userId: string, ownerSandboxKeyId?: string) {
  await connectMongo();
  const docs = await SandboxRunModel.find({ userId, ...(ownerSandboxKeyId ? { ownerSandboxKeyId } : {}) }).sort({ createdAt: -1 }).lean();
  return docs.map((doc) => doc.payload);
}

export async function requestPersistedCancellation(runId: string, ownerSandboxKeyId: string) {
  await connectMongo();
  const doc = await SandboxRunModel.findOne({ runId, ownerSandboxKeyId });
  if (!doc) return undefined;
  const run = doc.payload;
  if (["succeeded", "failed", "cancelled"].includes(run.status)) return run;
  if (run.status !== "cancellation_requested") {
    const sequence = (run.events.at(-1)?.sequence ?? 0) + 1;
    run.status = "cancellation_requested";
    run.events.push({ id: crypto.randomUUID(), sequence, at: new Date().toISOString(), kind: "status", message: "正在取消并清理沙箱" });
    doc.markModified("payload");
    await doc.save();
  }
  return run;
}

export async function activeRunCount(ownerSandboxKeyId?: string) {
  await connectMongo();
  return SandboxRunModel.countDocuments({ ...(ownerSandboxKeyId ? { ownerSandboxKeyId } : {}), "payload.status": { $in: ["queued", "running", "waiting_approval"] } });
}

export async function claimSubmission(ownerSandboxKeyId: string, idempotencyKey: string, requestHash: string, runId: string) {
  await connectMongo();
  try {
    const record = await SandboxSubmissionModel.create({ ownerSandboxKeyId, idempotencyKey, requestHash, runId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    return { created: true as const, runId: record.runId };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate key")) throw error;
    const current = await SandboxSubmissionModel.findOne({ ownerSandboxKeyId, idempotencyKey }).lean();
    if (!current) throw error;
    return current.requestHash === requestHash ? { created: false as const, runId: current.runId } : { conflict: true as const };
  }
}

export async function existingSubmission(ownerSandboxKeyId: string, idempotencyKey: string) {
  await connectMongo();
  return SandboxSubmissionModel.findOne({ ownerSandboxKeyId, idempotencyKey }).lean();
}
