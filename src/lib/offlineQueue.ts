export type QueueItem = {
  patientId: string;
  bundle: any;
  createdAt: number;
  author?: string;
  key: string;
  tries: number;
  hash?: string;
};

let memoryQueue: QueueItem[] = [];

export async function enqueueBundle(patientId: string, partial: any, author?: string) {
  memoryQueue.push({ patientId, bundle: partial, createdAt: Date.now(), author, key: `${patientId}-${Date.now()}`, tries: 0 });
}

export function __clear() {
  memoryQueue = [];
}

type EnqueueTxInput = {
  patientId?: string;
  bundle?: any;
  payload?: { bundle?: any; meta?: { hash?: string }; patientId?: string };
  author?: string;
};

export async function enqueueTx(input: EnqueueTxInput) {
  const patientId = input.patientId ?? input.payload?.patientId ?? 'unknown';
  const bundle = input.bundle ?? input.payload?.bundle ?? input.payload ?? {};
  const item: QueueItem = {
    patientId,
    bundle,
    createdAt: Date.now(),
    author: input.author,
    key: `${patientId}-${Date.now()}`,
    tries: 0,
    hash: input.payload?.meta?.hash,
  };
  memoryQueue.push(item);
  return item;
}

export async function readQueue() {
  return [...memoryQueue];
}

export async function flushQueue(post: (bundle: any) => Promise<any>) {
  const grouped = new Map<string, any[]>();
  for (const item of memoryQueue) {
    const current = grouped.get(item.patientId) ?? [];
    current.push(item.bundle);
    grouped.set(item.patientId, current);
  }

  for (const [, parts] of grouped) {
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: parts.flat(),
    };
    await post(bundle);
  }

  memoryQueue = [];
}
