import type { ChannelKind } from "../contracts/channel.js";
import type { ChannelMessage } from "../contracts/channel.js";

export type ChannelBusyPolicy = "reject" | "queue" | "interrupt";

export type QueuedMessage = {
  /** The original inbound message */
  message: ChannelMessage;
  /** Channel kind at enqueue time (derived from message.channel) */
  channelKind: ChannelKind;
  /** When this message was enqueued */
  enqueuedAt: number;
  /** The policy that was in effect when this message arrived */
  policyAtArrival: ChannelBusyPolicy;
  /** The queue depth limit that was in effect when this message arrived */
  queueDepthAtArrival: number;
};

export class SessionMessageQueue {
  #queues = new Map<string, QueuedMessage[]>();

  enqueue(
    key: string,
    message: ChannelMessage,
    policyAtArrival: ChannelBusyPolicy,
    queueDepthAtArrival: number
  ): { accepted: boolean; position?: number; rejectedBecauseFull?: boolean } {
    const queue = this.#queues.get(key) ?? [];
    if (queue.length >= queueDepthAtArrival) {
      return { accepted: false, rejectedBecauseFull: true };
    }
    const queuedMessage: QueuedMessage = {
      message,
      channelKind: message.channel,
      enqueuedAt: Date.now(),
      policyAtArrival,
      queueDepthAtArrival,
    };
    queue.push(queuedMessage);
    this.#queues.set(key, queue);
    return { accepted: true, position: queue.length };
  }

  dequeue(key: string): QueuedMessage | undefined {
    const queue = this.#queues.get(key);
    if (queue === undefined || queue.length === 0) {
      return undefined;
    }
    const item = queue.shift();
    if (queue.length === 0) {
      this.#queues.delete(key);
    }
    return item;
  }

  peek(key: string): QueuedMessage | undefined {
    const queue = this.#queues.get(key);
    return queue?.[0];
  }

  size(key: string): number {
    return this.#queues.get(key)?.length ?? 0;
  }

  totalSize(): number {
    let total = 0;
    for (const queue of this.#queues.values()) {
      total += queue.length;
    }
    return total;
  }

  clear(key: string): void {
    this.#queues.delete(key);
  }

  unshift(
    key: string,
    message: ChannelMessage,
    policyAtArrival: ChannelBusyPolicy,
    queueDepthAtArrival: number
  ): void {
    const queue = this.#queues.get(key) ?? [];
    const queuedMessage: QueuedMessage = {
      message,
      channelKind: message.channel,
      enqueuedAt: Date.now(),
      policyAtArrival,
      queueDepthAtArrival,
    };
    queue.unshift(queuedMessage);
    this.#queues.set(key, queue);
  }
}
