/**
 * Execution queue abstraction (ADR-007). The engine and UI never see the
 * implementation. MVP ships an in-process sequential queue; a Redis/BullMQ
 * adapter can implement the same interface later.
 */
import type { ExecutionStatus } from "@traceforge/domain";

export interface StartExecutionCommand {
  executionId: string;
  run: (signal: AbortSignal) => Promise<void>;
}

export interface ExecutionQueue {
  enqueue(command: StartExecutionCommand): Promise<string>;
  cancel(executionId: string): Promise<void>;
  getStatus(executionId: string): Promise<ExecutionStatus | undefined>;
}

interface Job {
  command: StartExecutionCommand;
  status: ExecutionStatus;
  controller: AbortController;
}

export class LocalExecutionQueue implements ExecutionQueue {
  private jobs = new Map<string, Job>();
  private queue: string[] = [];
  private running = false;

  async enqueue(command: StartExecutionCommand): Promise<string> {
    const job: Job = { command, status: "queued", controller: new AbortController() };
    this.jobs.set(command.executionId, job);
    this.queue.push(command.executionId);
    void this.drain();
    return command.executionId;
  }

  async cancel(executionId: string): Promise<void> {
    const job = this.jobs.get(executionId);
    if (!job) return;
    if (job.status === "queued") {
      job.status = "cancelled";
      this.queue = this.queue.filter((id) => id !== executionId);
    } else if (job.status === "running") {
      job.controller.abort();
    }
  }

  async getStatus(executionId: string): Promise<ExecutionStatus | undefined> {
    return this.jobs.get(executionId)?.status;
  }

  /** Resolves when the given execution reaches a terminal state. */
  async waitFor(executionId: string, timeoutMs = 120000): Promise<ExecutionStatus | undefined> {
    const start = Date.now();
    for (;;) {
      const status = await this.getStatus(executionId);
      if (!status || ["succeeded", "failed", "cancelled", "suspended"].includes(status)) return status;
      if (Date.now() - start > timeoutMs) return status;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        const job = this.jobs.get(id);
        if (!job || job.status !== "queued") continue;
        job.status = "running";
        try {
          await job.command.run(job.controller.signal);
          job.status = job.controller.signal.aborted ? "cancelled" : "succeeded";
        } catch {
          job.status = job.controller.signal.aborted ? "cancelled" : "failed";
        }
      }
    } finally {
      this.running = false;
    }
  }
}
