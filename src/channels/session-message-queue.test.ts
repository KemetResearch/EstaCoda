import { describe, expect, it } from "vitest";
import { SessionMessageQueue } from "./session-message-queue.js";
import type { ChannelMessage } from "../contracts/channel.js";

function makeMessage(id: string): ChannelMessage {
  return {
    id,
    channel: "telegram",
    sessionKey: { platform: "telegram", chatId: "123", userId: "u1" },
    text: "hello",
    sender: { id: "u1" },
    receivedAt: new Date().toISOString(),
  };
}

describe("SessionMessageQueue", () => {
  it("enqueue accepts message and reports position", () => {
    const q = new SessionMessageQueue();
    const result = q.enqueue("key1", makeMessage("m1"), "queue", 3);
    expect(result.accepted).toBe(true);
    expect(result.position).toBe(1);
  });

  it("enqueue rejects when queue is full", () => {
    const q = new SessionMessageQueue();
    q.enqueue("key1", makeMessage("m1"), "queue", 2);
    q.enqueue("key1", makeMessage("m2"), "queue", 2);
    const result = q.enqueue("key1", makeMessage("m3"), "queue", 2);
    expect(result.accepted).toBe(false);
    expect(result.rejectedBecauseFull).toBe(true);
  });

  it("dequeue returns FIFO order", () => {
    const q = new SessionMessageQueue();
    q.enqueue("key1", makeMessage("m1"), "queue", 3);
    q.enqueue("key1", makeMessage("m2"), "queue", 3);
    const first = q.dequeue("key1");
    expect(first?.message.id).toBe("m1");
    const second = q.dequeue("key1");
    expect(second?.message.id).toBe("m2");
  });

  it("dequeue returns undefined for empty queue", () => {
    const q = new SessionMessageQueue();
    expect(q.dequeue("key1")).toBeUndefined();
  });

  it("peek returns next item without removing", () => {
    const q = new SessionMessageQueue();
    q.enqueue("key1", makeMessage("m1"), "queue", 3);
    expect(q.peek("key1")?.message.id).toBe("m1");
    expect(q.peek("key1")?.message.id).toBe("m1");
    expect(q.size("key1")).toBe(1);
  });

  it("size returns count per key", () => {
    const q = new SessionMessageQueue();
    q.enqueue("key1", makeMessage("m1"), "queue", 3);
    q.enqueue("key1", makeMessage("m2"), "queue", 3);
    q.enqueue("key2", makeMessage("m3"), "queue", 3);
    expect(q.size("key1")).toBe(2);
    expect(q.size("key2")).toBe(1);
    expect(q.size("key3")).toBe(0);
  });

  it("totalSize counts across all keys", () => {
    const q = new SessionMessageQueue();
    q.enqueue("key1", makeMessage("m1"), "queue", 3);
    q.enqueue("key1", makeMessage("m2"), "queue", 3);
    q.enqueue("key2", makeMessage("m3"), "queue", 3);
    expect(q.totalSize()).toBe(3);
    q.dequeue("key1");
    expect(q.totalSize()).toBe(2);
    q.dequeue("key1");
    q.dequeue("key2");
    expect(q.totalSize()).toBe(0);
  });

  it("clear removes all messages for a key", () => {
    const q = new SessionMessageQueue();
    q.enqueue("key1", makeMessage("m1"), "queue", 3);
    q.enqueue("key1", makeMessage("m2"), "queue", 3);
    q.clear("key1");
    expect(q.size("key1")).toBe(0);
    expect(q.totalSize()).toBe(0);
  });

  it("unshift inserts at front of queue", () => {
    const q = new SessionMessageQueue();
    q.enqueue("key1", makeMessage("m1"), "queue", 3);
    q.enqueue("key1", makeMessage("m2"), "queue", 3);
    q.unshift("key1", makeMessage("m0"), "interrupt", 3);
    const first = q.dequeue("key1");
    expect(first?.message.id).toBe("m0");
    expect(first?.policyAtArrival).toBe("interrupt");
  });

  it("stores channelKind from message", () => {
    const q = new SessionMessageQueue();
    const msg = makeMessage("m1");
    q.enqueue("key1", msg, "queue", 3);
    const item = q.peek("key1");
    expect(item?.channelKind).toBe("telegram");
  });

  it("stores enqueuedAt timestamp", () => {
    const q = new SessionMessageQueue();
    const before = Date.now();
    q.enqueue("key1", makeMessage("m1"), "queue", 3);
    const after = Date.now();
    const item = q.peek("key1");
    expect(item?.enqueuedAt).toBeGreaterThanOrEqual(before);
    expect(item?.enqueuedAt).toBeLessThanOrEqual(after);
  });
});
