// Server-only module.
/**
 * Completion proof screenshots (decision 2026-11-16).
 *
 * Stored in the PRIVATE Supabase Storage bucket "order-proofs" with the
 * service-role key; never public, never a direct Supabase URL in the page.
 * Images are served by GET /api/orders/[orderId]/proofs/[proofId] after the
 * workspace access check. The bucket is created on first use.
 *
 * Files are checked by their first bytes (PNG / JPEG / WebP), not by the
 * name or the browser's type, and limited in size and number.
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const PROOF_BUCKET = "order-proofs";
export const PROOF_MAX_FILES = 3;
/** Per file. The page shrinks screenshots before upload (~300 KB each). */
export const PROOF_MAX_BYTES = 4 * 1024 * 1024;
/** All files of one upload: Vercel refuses request bodies over 4.5 MB. */
export const PROOF_MAX_TOTAL_BYTES = 4.4 * 1024 * 1024;

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export type ProofContentType = keyof typeof EXT;

export class ProofError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ProofError";
  }
}

/** Image type from the file's first bytes, or null. */
export function sniffImageType(b: Uint8Array): ProofContentType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  )
    return "image/webp";
  return null;
}

export interface ValidProof {
  bytes: Uint8Array;
  contentType: ProofContentType;
  ext: string;
}

/** 1..PROOF_MAX_FILES images, each at most PROOF_MAX_BYTES. */
export async function validateProofFiles(files: Blob[]): Promise<ValidProof[]> {
  if (files.length === 0) throw new ProofError("Add at least one screenshot of the final rank.");
  if (files.length > PROOF_MAX_FILES) throw new ProofError(`Add at most ${PROOF_MAX_FILES} screenshots.`);
  if (files.reduce((n, f) => n + f.size, 0) > PROOF_MAX_TOTAL_BYTES) throw new ProofError("The screenshots are too large together (4 MB at most).");
  const out: ValidProof[] = [];
  for (const f of files) {
    if (f.size === 0) throw new ProofError("One of the files is empty.");
    if (f.size > PROOF_MAX_BYTES) throw new ProofError("Each screenshot must be 4 MB or smaller.");
    const bytes = new Uint8Array(await f.arrayBuffer());
    const contentType = sniffImageType(bytes);
    if (!contentType) throw new ProofError("Screenshots must be PNG, JPG or WebP images.");
    out.push({ bytes, contentType, ext: EXT[contentType] });
  }
  return out;
}

export function proofPath(orderId: string, ext: string): string {
  return `${orderId}/${randomUUID()}.${ext}`;
}

export interface ProofStore {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  remove(paths: string[]): Promise<void>;
}

let bucketReady = false;

function supabaseStore(): ProofStore {
  const admin = () => {
    const c = getSupabaseAdmin();
    if (!c) throw new ProofError("Screenshot uploads are not configured on the server.", 503);
    return c;
  };
  async function ensureBucket() {
    if (bucketReady) return;
    const c = admin();
    const { data } = await c.storage.getBucket(PROOF_BUCKET);
    if (!data) {
      const { error } = await c.storage.createBucket(PROOF_BUCKET, {
        public: false,
        fileSizeLimit: PROOF_MAX_BYTES,
        allowedMimeTypes: Object.keys(EXT),
      });
      if (error && !/already exists/i.test(error.message)) throw new ProofError("Could not prepare screenshot storage.", 503);
    }
    bucketReady = true;
  }
  return {
    async put(path, bytes, contentType) {
      await ensureBucket();
      const { error } = await admin().storage.from(PROOF_BUCKET).upload(path, bytes, { contentType, upsert: false });
      if (error) throw new ProofError("Could not upload the screenshot. Try again.", 502);
    },
    async get(path) {
      const { data, error } = await admin().storage.from(PROOF_BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(paths) {
      if (paths.length === 0) return;
      await admin().storage.from(PROOF_BUCKET).remove(paths);
    },
  };
}

let store: ProofStore | null = null;

export function proofStore(): ProofStore {
  store ??= supabaseStore();
  return store;
}

/** Tests: swap the store for an in-memory one. */
export function setProofStoreForTest(s: ProofStore | null): void {
  store = s;
}
