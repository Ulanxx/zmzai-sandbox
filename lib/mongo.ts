import mongoose from "mongoose";

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalCache = globalThis as typeof globalThis & { __zmzaiSandboxMongo?: Cache };
const cache = globalCache.__zmzaiSandboxMongo ?? { conn: null, promise: null };
globalCache.__zmzaiSandboxMongo = cache;

export async function connectMongo() {
  if (cache.conn) return cache.conn;
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI 未配置");
  cache.promise ??= mongoose.connect(uri, { bufferCommands: false, serverSelectionTimeoutMS: 5_000 }).catch((error) => { cache.promise = null; throw error; });
  cache.conn = await cache.promise;
  return cache.conn;
}
