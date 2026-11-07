// Owns every Blob URL made in this session. Only owned URLs may be linked.

export interface BlobUrlApi {
  create(blob: Blob): string;
  revoke(url: string): void;
}

export interface BlobUrlManager {
  create(blob: Blob): string;
  isOwned(url: string): boolean;
  /** Revokes one owned URL once. Unknown URLs are ignored. */
  revoke(url: string): void;
  revokeAll(): void;
  liveCount(): number;
}

const defaultApi: BlobUrlApi = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

/** Methods are closures, so `manager.isOwned` can be passed around unbound. */
export function createBlobUrlManager(api: BlobUrlApi = defaultApi): BlobUrlManager {
  const live = new Set<string>();
  return {
    create(blob: Blob): string {
      const url = api.create(blob);
      live.add(url);
      return url;
    },
    isOwned(url: string): boolean {
      return live.has(url);
    },
    revoke(url: string): void {
      if (!live.delete(url)) return;
      api.revoke(url);
    },
    revokeAll(): void {
      const urls = Array.from(live);
      live.clear();
      for (const url of urls) api.revoke(url);
    },
    liveCount(): number {
      return live.size;
    },
  };
}
