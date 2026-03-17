process.env.STORAGE_DIR = "test-storage";

// ---------------------------------------------------------------------------
// Filesystem mock — prevents actual disk access during constructor and method
// guards, which all call fs.existsSync / fs.statSync / fs.mkdirSync.
// ---------------------------------------------------------------------------
jest.mock("fs", () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue(Buffer.from("")),
  statSync: jest.fn().mockReturnValue({ isFile: () => true }),
}));

// ---------------------------------------------------------------------------
// Tesseract mock — avoids model downloads and real OCR during unit tests.
// The worker object is kept accessible so individual tests can customise it.
// ---------------------------------------------------------------------------
const mockWorker = {
  recognize: jest.fn().mockResolvedValue({ data: { text: "mocked OCR text" } }),
  terminate: jest.fn().mockResolvedValue(undefined),
};

jest.mock("tesseract.js", () => ({
  createWorker: jest.fn().mockResolvedValue(mockWorker),
  OEM: { LSTM_ONLY: 1 },
}));

const OCRLoader = require("../../../utils/OCRLoader");
const fs = require("fs");
const { createWorker } = require("tesseract.js");

// ---------------------------------------------------------------------------
// Helper: reset all mocks to their default behaviour before each test so
// that per-test overrides do not leak across test cases.
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  fs.existsSync.mockReturnValue(true);
  fs.statSync.mockReturnValue({ isFile: () => true });
  mockWorker.recognize.mockResolvedValue({ data: { text: "mocked OCR text" } });
  mockWorker.terminate.mockResolvedValue(undefined);
  createWorker.mockResolvedValue(mockWorker);
});

// ===========================================================================
describe("OCRLoader — parseLanguages", () => {
  // parseLanguages is called inside the constructor and stored as this.language.
  // We test it by inspecting the instance property for each input variant.

  it("defaults to ['eng'] when no option is provided", () => {
    const loader = new OCRLoader();
    expect(loader.language).toEqual(["eng"]);
  });

  it("defaults to ['eng'] for a null targetLanguages", () => {
    const loader = new OCRLoader({ targetLanguages: null });
    expect(loader.language).toEqual(["eng"]);
  });

  it("defaults to ['eng'] for an empty string", () => {
    const loader = new OCRLoader({ targetLanguages: "" });
    expect(loader.language).toEqual(["eng"]);
  });

  it("defaults to ['eng'] for a non-string value", () => {
    const loader = new OCRLoader({ targetLanguages: 42 });
    expect(loader.language).toEqual(["eng"]);
  });

  it("returns a single valid language code", () => {
    const loader = new OCRLoader({ targetLanguages: "deu" });
    expect(loader.language).toEqual(["deu"]);
  });

  it("returns multiple valid language codes from a comma-separated string", () => {
    const loader = new OCRLoader({ targetLanguages: "eng,deu,fra" });
    expect(loader.language).toEqual(["eng", "deu", "fra"]);
  });

  it("strips surrounding whitespace from each language code", () => {
    const loader = new OCRLoader({ targetLanguages: " eng , deu " });
    expect(loader.language).toEqual(["eng", "deu"]);
  });

  it("drops whitespace-only entries between commas", () => {
    const loader = new OCRLoader({ targetLanguages: "eng,  ,deu" });
    expect(loader.language).toEqual(["eng", "deu"]);
  });

  it("filters out codes that are not in the valid-language list", () => {
    const loader = new OCRLoader({ targetLanguages: "eng,not_a_lang,deu" });
    expect(loader.language).toEqual(["eng", "deu"]);
  });

  it("defaults to ['eng'] when every supplied code is invalid", () => {
    const loader = new OCRLoader({ targetLanguages: "badcode1,badcode2" });
    expect(loader.language).toEqual(["eng"]);
  });

  it("accepts non-Latin script language codes (chi_sim, jpn, ara)", () => {
    const loader = new OCRLoader({ targetLanguages: "chi_sim,jpn,ara" });
    expect(loader.language).toEqual(["chi_sim", "jpn", "ara"]);
  });
});

// ===========================================================================
describe("OCRLoader — constructor", () => {
  it("sets cacheDir to a path under STORAGE_DIR", () => {
    const loader = new OCRLoader();
    expect(loader.cacheDir).toContain("test-storage");
    expect(loader.cacheDir).toContain("tesseract");
  });

  it("calls mkdirSync when the cache directory does not yet exist", () => {
    // First call is the cacheDir check; return false to simulate missing dir.
    fs.existsSync.mockReturnValueOnce(false);
    const loader = new OCRLoader();
    expect(fs.mkdirSync).toHaveBeenCalledWith(loader.cacheDir, {
      recursive: true,
    });
  });

  it("does not call mkdirSync when the cache directory already exists", () => {
    fs.existsSync.mockReturnValue(true);
    new OCRLoader();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe("OCRLoader — ocrImage", () => {
  it("returns null for an empty filePath string", async () => {
    const loader = new OCRLoader();
    expect(await loader.ocrImage("")).toBeNull();
  });

  it("returns null for a null filePath", async () => {
    const loader = new OCRLoader();
    expect(await loader.ocrImage(null)).toBeNull();
  });

  it("returns null when the file does not exist on disk", async () => {
    // Allow the cacheDir check to pass, but fail the file existence check.
    fs.existsSync.mockImplementation((p) =>
      p.includes("tesseract") ? true : false
    );
    const loader = new OCRLoader();
    expect(await loader.ocrImage("/nonexistent/image.png")).toBeNull();
  });

  it("returns null when the path points to a directory, not a file", async () => {
    fs.statSync.mockReturnValue({ isFile: () => false });
    const loader = new OCRLoader();
    expect(await loader.ocrImage("/some/directory")).toBeNull();
  });

  it("returns the recognised text string on success", async () => {
    const loader = new OCRLoader();
    const result = await loader.ocrImage("/fake/image.png");
    expect(result).toBe("mocked OCR text");
  });

  it("creates a tesseract worker with the loader's language and cache path", async () => {
    const loader = new OCRLoader({ targetLanguages: "deu" });
    await loader.ocrImage("/fake/image.png");
    expect(createWorker).toHaveBeenCalledWith(
      ["deu"],
      1, // OEM.LSTM_ONLY
      expect.objectContaining({ cachePath: loader.cacheDir })
    );
  });

  it("terminates the worker after a successful recognition", async () => {
    const loader = new OCRLoader();
    await loader.ocrImage("/fake/image.png");
    expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it("returns null and still terminates the worker when recognition throws", async () => {
    mockWorker.recognize.mockRejectedValue(new Error("recognition failed"));
    const loader = new OCRLoader();
    const result = await loader.ocrImage("/fake/image.png");
    expect(result).toBeNull();
    expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it("returns null when the OCR job exceeds maxExecutionTime", async () => {
    jest.useFakeTimers();

    // Keep a handle to the resolve so we can drain the promise after the test
    // and avoid "worker failed to exit gracefully" warnings.
    let resolveRecognize;
    mockWorker.recognize.mockImplementation(
      () => new Promise((resolve) => { resolveRecognize = resolve; })
    );

    const loader = new OCRLoader();
    const resultPromise = loader.ocrImage("/fake/image.png", {
      maxExecutionTime: 100,
    });

    // advanceTimersByTimeAsync interleaves fake-timer advancement with
    // microtask processing, so createWorker resolves first (registering
    // the real setTimeout) and then the timeout fires at t=100ms.
    await jest.advanceTimersByTimeAsync(200);
    const result = await resultPromise;

    // Drain the hanging recognize promise so the event loop can exit cleanly.
    resolveRecognize({ data: { text: "" } });

    expect(result).toBeNull();
    jest.useRealTimers();
  }, 10000);
});

// ===========================================================================
describe("OCRLoader — ocrPDF", () => {
  it("returns an empty array for an empty filePath string", async () => {
    const loader = new OCRLoader();
    expect(await loader.ocrPDF("")).toEqual([]);
  });

  it("returns an empty array for a null filePath", async () => {
    const loader = new OCRLoader();
    expect(await loader.ocrPDF(null)).toEqual([]);
  });

  it("returns an empty array when the file does not exist on disk", async () => {
    fs.existsSync.mockImplementation((p) =>
      p.includes("tesseract") ? true : false
    );
    const loader = new OCRLoader();
    expect(await loader.ocrPDF("/nonexistent/scan.pdf")).toEqual([]);
  });

  it("returns an empty array when the path points to a directory", async () => {
    fs.statSync.mockReturnValue({ isFile: () => false });
    const loader = new OCRLoader();
    expect(await loader.ocrPDF("/some/directory")).toEqual([]);
  });
});
