import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { sha256Canonical, stableStringify } from "./canonical.ts";
import { InMemoryDatasetEventStore } from "./store.ts";
import type { DatasetCaseHead } from "./store.ts";
import type { DatasetEvent } from "./types.ts";

const FORMAT = "flo-dataset-batch-v1";
const JOURNAL_NAME = /^([0-9]{12})-([0-9a-f]{64})\.json$/;
const ZERO_HASH = "0".repeat(64);

export type DurableStoreErrorCode =
  | "invalid_directory"
  | "locked"
  | "corrupt_journal"
  | "io_failure"
  | "closed";

export class DurableStoreError extends Error {
  readonly code: DurableStoreErrorCode;

  constructor(code: DurableStoreErrorCode, message: string) {
    super(message);
    this.name = "DurableStoreError";
    this.code = code;
  }
}

interface BatchRecord {
  readonly format: typeof FORMAT;
  readonly sequence: number;
  readonly previousBatchHash: string;
  readonly events: readonly DatasetEvent[];
  readonly batchHash: string;
}

function fail(code: DurableStoreErrorCode, message: string): never {
  throw new DurableStoreError(code, message);
}

function batchHash(record: Omit<BatchRecord, "batchHash">): string {
  return sha256Canonical(record);
}

function directorySync(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function ensureDirectory(dir: string): void {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { mode: 0o700 });
      directorySync(resolve(dir, ".."));
    }
    const info = lstatSync(dir);
    if (!info.isDirectory()) {
      fail("invalid_directory", "dataset journal path must be a real directory");
    }
    if ((info.mode & 0o077) !== 0) {
      fail("invalid_directory", "dataset journal directory must restrict group and other access");
    }
  } catch (error) {
    if (error instanceof DurableStoreError) throw error;
    fail("invalid_directory", "could not open dataset journal directory");
  }
}

/**
 * Local, single-writer durable journal. The caller must close it when done.
 * A leftover lock after a crash requires deliberate operator recovery.
 */
export class DurableDatasetEventStore {
  private memory = new InMemoryDatasetEventStore();
  private readonly dir: string;
  private readonly lockPath: string;
  private sequence = 0;
  private headHash = ZERO_HASH;
  private closed = false;

  private constructor(dir: string) {
    this.dir = dir;
    this.lockPath = join(dir, ".writer-lock");
  }

  static open(
    directory: string,
    expectedHead?: Readonly<{ sequence: number; batchHash: string }>,
  ): DurableDatasetEventStore {
    if (typeof directory !== "string" || !isAbsolute(directory)) {
      fail("invalid_directory", "dataset journal directory must be an absolute path");
    }
    const dir = resolve(directory);
    ensureDirectory(dir);
    const store = new DurableDatasetEventStore(dir);
    try {
      mkdirSync(store.lockPath, { mode: 0o700 });
    } catch {
      fail("locked", "dataset journal is locked or cannot be opened for writing");
    }
    try {
      store.replay();
      if (expectedHead !== undefined && (
        !Number.isSafeInteger(expectedHead.sequence) ||
        expectedHead.sequence !== store.sequence ||
        expectedHead.batchHash !== store.headHash
      )) {
        fail("corrupt_journal", "dataset journal differs from external checkpoint");
      }
      return store;
    } catch (error) {
      store.releaseLock();
      throw error;
    }
  }

  private releaseLock(): boolean {
    try {
      rmdirSync(this.lockPath);
      return true;
    } catch {
      return false;
    }
  }

  private assertOpen(): void {
    if (this.closed) fail("closed", "dataset journal is closed; reopen and verify before use");
  }

  private replay(): void {
    let entries: string[];
    try {
      entries = readdirSync(this.dir);
    } catch {
      fail("io_failure", "cannot list dataset journal");
    }
    const names: string[] = [];
    for (const name of entries) {
      if (name === ".writer-lock" || /^\.pending-[0-9a-f]+$/.test(name)) continue;
      if (!JOURNAL_NAME.test(name)) {
        fail("corrupt_journal", "unexpected entry in dataset journal");
      }
      names.push(name);
    }
    names.sort();
    for (const name of names) {
      const expectedSequence = this.sequence + 1;
      const match = JOURNAL_NAME.exec(name)!;
      if (Number(match[1]) !== expectedSequence) {
        fail("corrupt_journal", "dataset journal sequence gap or duplicate");
      }
      let bytes: string;
      try {
        const path = join(this.dir, name);
        if (!lstatSync(path).isFile()) fail("corrupt_journal", "journal entry is not a regular file");
        bytes = readFileSync(path, "utf8");
      } catch (error) {
        if (error instanceof DurableStoreError) throw error;
        fail("io_failure", "cannot read dataset journal entry");
      }
      let record: BatchRecord;
      try {
        record = JSON.parse(bytes) as BatchRecord;
        if (
          record === null || Array.isArray(record) || typeof record !== "object" ||
          Object.keys(record).sort().join(",") !==
            "batchHash,events,format,previousBatchHash,sequence" ||
          record.format !== FORMAT || record.sequence !== expectedSequence ||
          record.previousBatchHash !== this.headHash ||
          typeof record.batchHash !== "string" ||
          !Array.isArray(record.events) || record.events.length === 0 ||
          stableStringify(record) !== bytes
        ) {
          throw new Error("invalid frame");
        }
        const { batchHash: declared, ...body } = record;
        if (declared !== match[2] || declared !== batchHash(body)) {
          throw new Error("batch hash mismatch");
        }
        this.memory.appendBatch(record.events);
      } catch {
        fail("corrupt_journal", "dataset journal validation failed");
      }
      this.sequence = expectedSequence;
      this.headHash = record.batchHash;
    }
  }

  get size(): number {
    this.assertOpen();
    return this.memory.size;
  }

  append(value: unknown): DatasetEvent {
    return this.appendBatch([value])[0];
  }

  /** One atomic, fsynced journal entry per nonempty batch. */
  appendBatch(values: readonly unknown[]): readonly DatasetEvent[] {
    this.assertOpen();
    // Preflight through exactly the same validation and chain logic as the
    // in-memory store. No disk change is made if validation fails.
    const candidate = new InMemoryDatasetEventStore();
    candidate.appendBatch(this.memory.listAll());
    const staged = candidate.appendBatch(values);
    if (staged.length === 0) return Object.freeze([]);

    const sequence = this.sequence + 1;
    if (sequence > 999999999999) fail("io_failure", "dataset journal sequence exhausted");
    const body = {
      format: FORMAT,
      sequence,
      previousBatchHash: this.headHash,
      events: staged,
    } as const;
    const hash = batchHash(body);
    const name = `${String(sequence).padStart(12, "0")}-${hash}.json`;
    const pending = join(this.dir, `.pending-${randomBytes(16).toString("hex")}`);
    let pendingExists = false;
    try {
      // A preexisting entry for this sequence means the journal changed
      // behind this writer or a previous write had an uncertain outcome.
      if (readdirSync(this.dir).some((entry) => JOURNAL_NAME.exec(entry)?.[1] === String(sequence).padStart(12, "0"))) {
        throw new Error("sequence already exists");
      }
      const fd = openSync(pending, "wx", 0o600);
      pendingExists = true;
      try {
        writeFileSync(fd, stableStringify({ ...body, batchHash: hash }), "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      // The lock is our single-writer boundary. Rename makes the entire
      // batch visible at once; directory fsync makes that name durable.
      renameSync(pending, join(this.dir, name));
      pendingExists = false;
      directorySync(this.dir);
    } catch {
      if (pendingExists) {
        try { unlinkSync(pending); } catch { /* operator will inspect orphan */ }
      }
      // A rename may have succeeded before a later fsync error. Do not
      // accept another write until reopen has resolved disk truth.
      this.closed = true;
      this.releaseLock();
      fail("io_failure", "dataset journal write outcome uncertain; reopen and verify");
    }
    this.memory = candidate;
    this.sequence = sequence;
    this.headHash = hash;
    return staged;
  }

  getByEventId(id: string): DatasetEvent | undefined {
    this.assertOpen();
    return this.memory.getByEventId(id);
  }

  listAll(): readonly DatasetEvent[] {
    this.assertOpen();
    return this.memory.listAll();
  }

  listByCaseId(id: string): readonly DatasetEvent[] {
    this.assertOpen();
    return this.memory.listByCaseId(id);
  }

  getCaseHead(id: string): DatasetCaseHead | undefined {
    this.assertOpen();
    return this.memory.getCaseHead(id);
  }

  /** External checkpoints can record this head hash to detect whole-log replacement. */
  getJournalHead(): Readonly<{ sequence: number; batchHash: string }> {
    this.assertOpen();
    return Object.freeze({ sequence: this.sequence, batchHash: this.headHash });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.releaseLock()) {
      fail("io_failure", "could not release dataset journal lock; inspect before reopening");
    }
  }
}
