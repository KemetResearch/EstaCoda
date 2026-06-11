import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import test from "node:test";
import { createBridgeServer, normalizeInboundMessage } from "./bridge.js";

test("image messages download into the inbound media directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "estacoda-wa-bridge-media-"));
  try {
    const normalized = await normalizeInboundMessage(messageWith({ imageMessage: { mimetype: "image/jpeg", caption: "caption" } }), {
      inboundMediaDir: root,
      mediaDownloader: async () => Buffer.from("image-bytes"),
    });

    assert.equal(normalized.body, "caption");
    assert.equal(normalized.attachments[0].kind, "image");
    assert.equal(normalized.attachments[0].status, "ready");
    assert.equal(normalized.attachments[0].mimeType, "image/jpeg");
    assert.equal(normalized.attachments[0].bytes, 11);
    assert.equal(await readFile(normalized.attachments[0].localPath, "utf8"), "image-bytes");
    assertPathInside(normalized.attachments[0].localPath, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PTT audio maps to voice and normal audio maps to audio", async () => {
  const root = await mkdtemp(join(tmpdir(), "estacoda-wa-bridge-audio-"));
  try {
    const voice = await normalizeInboundMessage(messageWith({ audioMessage: { mimetype: "audio/ogg", ptt: true } }), {
      inboundMediaDir: root,
      mediaDownloader: async () => Buffer.from("voice"),
    });
    const audio = await normalizeInboundMessage(messageWith({ audioMessage: { mimetype: "audio/mp4" } }), {
      inboundMediaDir: root,
      mediaDownloader: async () => Buffer.from("audio"),
    });

    assert.equal(voice.attachments[0].kind, "voice");
    assert.equal(audio.attachments[0].kind, "audio");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("document messages preserve safe filenames and cannot escape the inbound directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "estacoda-wa-bridge-doc-"));
  try {
    const normalized = await normalizeInboundMessage(messageWith({
      documentMessage: {
        mimetype: "application/pdf",
        fileName: "../../secret/report.pdf",
        caption: "doc caption",
      },
    }), {
      inboundMediaDir: root,
      mediaDownloader: async () => Buffer.from("pdf"),
    });

    assert.equal(normalized.body, "doc caption");
    assert.equal(normalized.attachments[0].kind, "document");
    assert.equal(normalized.attachments[0].originalName, "report.pdf");
    assertPathInside(normalized.attachments[0].localPath, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("oversized media and download failures emit failed attachments", async () => {
  const root = await mkdtemp(join(tmpdir(), "estacoda-wa-bridge-failed-"));
  try {
    const oversized = await normalizeInboundMessage(messageWith({
      imageMessage: { mimetype: "image/png", fileLength: 12 },
    }), {
      inboundMediaDir: root,
      maxInboundMediaBytes: 10,
      mediaDownloader: async () => {
        throw new Error("should not download");
      },
    });
    const failed = await normalizeInboundMessage(messageWith({ videoMessage: { mimetype: "video/mp4" } }), {
      inboundMediaDir: root,
      mediaDownloader: async () => {
        throw new Error("network");
      },
    });

    assert.equal(oversized.attachments[0].status, "failed");
    assert.equal(oversized.attachments[0].failureCode, "media_too_large");
    assert.equal(failed.attachments[0].status, "failed");
    assert.equal(failed.attachments[0].failureCode, "download_failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Long-like declared sizes are handled conservatively", async () => {
  const root = await mkdtemp(join(tmpdir(), "estacoda-wa-bridge-long-"));
  try {
    let downloads = 0;
    const huge = await normalizeInboundMessage(messageWith({
      imageMessage: { mimetype: "image/png", fileLength: { high: 1, low: 0 } },
    }), {
      inboundMediaDir: root,
      maxInboundMediaBytes: 25 * 1024 * 1024,
      mediaDownloader: async () => {
        downloads += 1;
        return Buffer.from("too late");
      },
    });
    const small = await normalizeInboundMessage(messageWith({
      imageMessage: { mimetype: "image/png", fileLength: { high: 0, low: 4 } },
    }), {
      inboundMediaDir: root,
      maxInboundMediaBytes: 25 * 1024 * 1024,
      mediaDownloader: async () => {
        downloads += 1;
        return Buffer.from("tiny");
      },
    });

    assert.equal(huge.attachments[0].status, "failed");
    assert.equal(huge.attachments[0].failureCode, "media_too_large");
    assert.equal(small.attachments[0].status, "ready");
    assert.equal(downloads, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bridge start rejects inbound media directories outside the authorized parent", async () => {
  const root = await mkdtemp(join(tmpdir(), "estacoda-wa-bridge-parent-"));
  try {
    const bridge = createBridgeServer({
      authDir: join(root, "auth"),
      token: "secret",
      inboundMediaDir: join(root, "outside", "inbound"),
      inboundMediaParentDir: join(root, "profile", "channel-media"),
      mediaDownloader: async () => Buffer.from("unused"),
    });

    await assert.rejects(() => bridge.startSocket(), /profile-local/u);
    bridge.server.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsupported stickers emit failed metadata instead of pretending to be a normal image", async () => {
  const normalized = await normalizeInboundMessage(messageWith({ stickerMessage: { mimetype: "image/webp" } }), {
    inboundMediaDir: "/unused",
    mediaDownloader: async () => Buffer.from("sticker"),
  });

  assert.equal(normalized.attachments[0].kind, "image");
  assert.equal(normalized.attachments[0].status, "failed");
  assert.equal(normalized.attachments[0].failureCode, "unsupported_media");
});

function messageWith(content, options = {}) {
  return {
    key: {
      id: options.messageId ?? "msg-1",
      remoteJid: "971501234567@s.whatsapp.net",
      fromMe: false,
    },
    pushName: "Sender",
    messageTimestamp: 123,
    message: content,
  };
}

function assertPathInside(candidate, root) {
  const relativePath = relative(root, candidate);
  assert.equal(isAbsolute(candidate), true);
  assert.equal(relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath)), true);
}
