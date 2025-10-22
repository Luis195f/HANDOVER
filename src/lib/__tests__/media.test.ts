import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectMimeFromUri,
  uploadAudio,
  isSupportedAudioMime,
  ensureFileName,
} from "../media";

const ORIGINAL_FETCH = globalThis.fetch;

describe("media utils (PRO)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH as any;
  });

  it("detectMimeFromUri mapea extensiones comunes y menos comunes", () => {
    expect(detectMimeFromUri("note.m4a")).toBe("audio/mp4");
    expect(detectMimeFromUri("note.mp3")).toBe("audio/mpeg");
    expect(detectMimeFromUri("note.wav")).toBe("audio/wav");
    expect(detectMimeFromUri("note.AAC")).toBe("audio/aac");

    expect(detectMimeFromUri("note.ogg")).toBe("audio/ogg");
    expect(detectMimeFromUri("note.opus")).toBe("audio/opus");
    expect(detectMimeFromUri("note.flac")).toBe("audio/flac");
    expect(detectMimeFromUri("note.amr")).toBe("audio/amr");
    expect(detectMimeFromUri("note.3gp")).toBe("audio/3gpp");

    expect(detectMimeFromUri("note.bin")).toBe("application/octet-stream");
  });

  it("isSupportedAudioMime y ensureFileName funcionan", () => {
    expect(isSupportedAudioMime("audio/mpeg")).toBe(true);
    expect(isSupportedAudioMime("audio/opus")).toBe(true);
    expect(isSupportedAudioMime("application/octet-stream")).toBe(false);

    expect(ensureFileName("grabacion", "audio/mpeg")).toBe("grabacion.mp3");
    expect(ensureFileName("grabacion.mp3", "audio/mpeg")).toBe("grabacion.mp3");
  });

  it("uploadAudio devuelve URL pública simulada para file:// y respeta http(s)", async () => {
    const up1 = await uploadAudio("file:///data/user/0/app/cache/voice.m4a");
    expect(up1.url).toMatch(/^https:\/\/example\.invalid\/media\/voice\.m4a$/);
    expect(up1.mime).toBe("audio/mp4");
    expect(up1.name).toBe("voice.m4a");

    const up2 = await uploadAudio("https://cdn.example.com/audios/track.mp3");
    expect(up2.url).toBe("https://cdn.example.com/audios/track.mp3");
    expect(up2.mime).toBe("audio/mpeg");
    expect(up2.name).toBe("track.mp3");
  });

  it("uploadAudio hace POST multipart cuando hay directUploadUrl y usa la URL devuelta", async () => {
    const mocked = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: "https://cdn.real/upload/voice.m4a" }),
    })) as any;
    globalThis.fetch = mocked;

    const res = await uploadAudio("file:///tmp/voice.m4a", {
      directUploadUrl: "https://uploader.example.com/api/upload",
      headers: { Authorization: "Bearer t" },
      extraFields: { scope: "public" },
    });

    expect(mocked).toHaveBeenCalledOnce();
    expect(res.url).toBe("https://cdn.real/upload/voice.m4a");
    expect(res.mime).toBe("audio/mp4");
    expect(res.name).toBe("voice.m4a");
  });

  it("uploadAudio fallback: si falla la subida, vuelve al stub (no rompe flujo)", async () => {
    const mocked = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as any;
    globalThis.fetch = mocked;

    const res = await uploadAudio("file:///tmp/fallo.opus", {
      directUploadUrl: "https://uploader.example.com/api/upload",
    });

    expect(res.url).toMatch(/^https:\/\/example\.invalid\/media\/fallo\.opus$/);
    expect(res.mime).toBe("audio/opus");
  });
});
