import { describe, expect, it } from "vitest";
import { activeStt, audioExt, cleanTranscript, DEFAULT_STT, micConstraints, parseSttConfig, pickRecorderMime, STT_PRESETS, sttFreeId } from "./stt";

describe("parseSttConfig", () => {
  it("brak pliku = domyślna konfiguracja bez błędów", () => {
    expect(parseSttConfig(null)).toEqual({ config: DEFAULT_STT, errors: [] });
  });

  it("zepsuty JSON nie wywraca aplikacji", () => {
    const r = parseSttConfig("{ nie json");
    expect(r.config).toEqual(DEFAULT_STT);
    expect(r.errors).toHaveLength(1);
  });

  it("wczytuje silniki, obcina końcowe ukośniki i pilnuje aktywnego", () => {
    const text = JSON.stringify({
      active: "cortecs",
      language: "PL",
      providers: [
        { ...STT_PRESETS[1], baseUrl: "https://api.cortecs.ai/v1///" },
        { id: "local", baseUrl: "http://127.0.0.1:8080/v1", model: "whisper", key: false },
      ],
    });
    const { config, errors } = parseSttConfig(text);
    expect(errors).toEqual([]);
    expect(config.language).toBe("pl");
    expect(activeStt(config)?.baseUrl).toBe("https://api.cortecs.ai/v1");
    expect(config.providers[1]).toMatchObject({ name: "local", key: false });
  });

  it("pomija złe wpisy z opisem, a aktywny spoza listy staje się null", () => {
    const text = JSON.stringify({
      active: "znikniety",
      providers: [
        { id: "a", baseUrl: "ftp://x", model: "m" },
        { id: "b", baseUrl: "http://x/v1", model: " " },
        { id: "zły id", baseUrl: "http://x/v1", model: "m" },
        { id: "ok", baseUrl: "http://x/v1", model: "m" },
        { id: "ok", baseUrl: "http://y/v1", model: "m" },
      ],
    });
    const { config, errors } = parseSttConfig(text);
    expect(config.providers.map((p) => p.id)).toEqual(["ok"]);
    expect(config.active).toBeNull();
    expect(errors).toHaveLength(4);
  });

  it("nieznany język wraca do auto", () => {
    expect(parseSttConfig(JSON.stringify({ language: "po polsku", providers: [] })).config.language).toBe("auto");
  });
});

describe("mikrofon", () => {
  it("wczytuje deviceId, a brak albo zły typ to domyślny mikrofon", () => {
    expect(parseSttConfig(JSON.stringify({ mic: "abc123", providers: [] })).config.mic).toBe("abc123");
    expect(parseSttConfig(JSON.stringify({ mic: 5, providers: [] })).config.mic).toBe("");
    expect(parseSttConfig(null).config.mic).toBe("");
  });

  it("micConstraints: wybrany jako ideal, domyślny jako true", () => {
    expect(micConstraints("")).toBe(true);
    expect(micConstraints("abc")).toEqual({ deviceId: { ideal: "abc" } });
  });
});

describe("pomocnicze", () => {
  it("cleanTranscript robi jedną linię bez znaków sterujących", () => {
    expect(cleanTranscript("  Cześć\n\nświecie \x1b[31m tekst\t")).toBe("Cześć świecie [31m tekst");
    expect(cleanTranscript("\n\n")).toBe("");
  });

  it("audioExt zna formaty MediaRecordera", () => {
    expect(audioExt("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExt("audio/ogg")).toBe("ogg");
    expect(audioExt("audio/mpeg")).toBe("mp3");
    expect(audioExt("")).toBe("webm");
  });

  it("pickRecorderMime bierze pierwszy obsługiwany", () => {
    expect(pickRecorderMime((m) => m === "audio/webm")).toBe("audio/webm");
    expect(pickRecorderMime(() => false)).toBeUndefined();
  });

  it("sttFreeId numeruje zajęte id", () => {
    expect(sttFreeId("local", ["local", "local-2"])).toBe("local-3");
    expect(sttFreeId("local", [])).toBe("local");
  });
});
