process.env.STORAGE_DIR = "test-storage";

// ---------------------------------------------------------------------------
// PDFSharp.init() uses `await import("sharp")` (a dynamic ESM import).
// In CJS-mode Jest, jest.mock() does not intercept dynamic imports without
// --experimental-vm-modules.  Instead we directly inject the Sharp mock into
// pdfSharp.sharp before calling pageToBuffer — this is safe because
// pageToBuffer only calls init() when this.sharp is null.
// ---------------------------------------------------------------------------
const mockSharpInstance = {
  resize: jest.fn().mockReturnThis(),
  withMetadata: jest.fn().mockReturnThis(),
  png: jest.fn().mockReturnThis(),
  toBuffer: jest.fn().mockResolvedValue(Buffer.from("fake-png")),
};

const mockSharpFn = jest.fn(() => mockSharpInstance);

const { PDFSharp } = require("../../../utils/OCRLoader");

// paintImageXObject opcode value used by pdf.js (matches OPS.paintImageXObject)
const PAINT_OP = 85;

/**
 * Build a minimal pdf.js page proxy whose operator list contains a single
 * paint entry pointing to the XObject returned by getObjResult.
 */
function makeFakePage(getObjResult, opcode = PAINT_OP) {
  return {
    pageNumber: 1,
    getOperatorList: jest.fn().mockResolvedValue({
      fnArray: [opcode],
      argsArray: [["FakeXObj"]],
    }),
    objs: {
      get: jest.fn().mockResolvedValue(getObjResult),
    },
  };
}

/**
 * Create a PDFSharp instance with the Sharp mock pre-injected so that
 * pageToBuffer() skips the dynamic import inside init().
 */
function createPDFSharp(opts = {}) {
  const instance = new PDFSharp({ validOps: [PAINT_OP], ...opts });
  instance.sharp = mockSharpFn; // bypass dynamic import("sharp")
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSharpInstance.resize.mockReturnThis();
  mockSharpInstance.withMetadata.mockReturnThis();
  mockSharpInstance.png.mockReturnThis();
  mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from("fake-png"));
  mockSharpFn.mockReturnValue(mockSharpInstance);
});

// ===========================================================================
// PDFSharp.pageToBuffer — XObject validation guards
//
// These tests exercise the guard clauses that prevent crashes when pdf.js
// returns non-raster objects (e.g. digital-signature widgets) for paint
// opcodes that normally carry image data.
// ===========================================================================
describe("PDFSharp — pageToBuffer XObject validation", () => {
  it("returns null when the XObject itself is null", async () => {
    const pdfSharp = createPDFSharp();
    const page = makeFakePage(null);
    expect(await pdfSharp.pageToBuffer({ page })).toBeNull();
    expect(mockSharpFn).not.toHaveBeenCalled();
  });

  it("returns null when the XObject has no data property (e.g. a signature widget)", async () => {
    const pdfSharp = createPDFSharp();
    // Simulate a Sig field XObject: has width/height but no .data
    const sigWidget = { width: 200, height: 50 };
    const page = makeFakePage(sigWidget);
    expect(await pdfSharp.pageToBuffer({ page })).toBeNull();
    expect(mockSharpFn).not.toHaveBeenCalled();
  });

  it("returns null when the XObject data buffer has zero length", async () => {
    const pdfSharp = createPDFSharp();
    const emptyDataObj = { width: 100, height: 100, data: new Uint8Array(0) };
    const page = makeFakePage(emptyDataObj);
    expect(await pdfSharp.pageToBuffer({ page })).toBeNull();
    expect(mockSharpFn).not.toHaveBeenCalled();
  });

  it("returns null when width is zero (invalid dimensions)", async () => {
    const pdfSharp = createPDFSharp();
    const zeroDim = { width: 0, height: 100, data: new Uint8Array(300) };
    const page = makeFakePage(zeroDim);
    expect(await pdfSharp.pageToBuffer({ page })).toBeNull();
    expect(mockSharpFn).not.toHaveBeenCalled();
  });

  it("returns null when height is zero (invalid dimensions)", async () => {
    const pdfSharp = createPDFSharp();
    const zeroDim = { width: 100, height: 0, data: new Uint8Array(300) };
    const page = makeFakePage(zeroDim);
    expect(await pdfSharp.pageToBuffer({ page })).toBeNull();
    expect(mockSharpFn).not.toHaveBeenCalled();
  });

  it("unpacks a 1-bpp row-aligned bitmap and passes it to Sharp as grayscale", async () => {
    const pdfSharp = createPDFSharp();
    const w = 100,
      h = 100;
    // 1-bpp row-aligned: rowBytes = ceil(w/8) = 13, total = 13 * 100 = 1300 bytes
    const rowBytes = Math.ceil(w / 8);
    const monochrome = {
      width: w,
      height: h,
      data: new Uint8Array(rowBytes * h), // row-padded bit-packed data
    };
    const page = makeFakePage(monochrome);
    const result = await pdfSharp.pageToBuffer({ page });
    expect(result).toBeInstanceOf(Buffer);
    // Sharp must be called with unpacked 1-channel (grayscale) data
    expect(mockSharpFn).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ raw: expect.objectContaining({ channels: 1 }) })
    );
    // The unpacked buffer must have exactly w*h pixels
    const [calledData] = mockSharpFn.mock.calls[0];
    expect(calledData.length).toBe(w * h);
  });

  it("skips a non-integer-channel XObject that is NOT a valid 1-bpp bitmap", async () => {
    const pdfSharp = createPDFSharp();
    const w = 100,
      h = 100;
    // Arbitrary non-integer channels that doesn't match 1-bpp layout
    const oddData = {
      width: w,
      height: h,
      data: new Uint8Array(Math.ceil((w * h) / 8) + 7), // wrong byte count
    };
    const page = makeFakePage(oddData);
    expect(await pdfSharp.pageToBuffer({ page })).toBeNull();
    expect(mockSharpFn).not.toHaveBeenCalled();
  });

  it("returns null when channel count exceeds 4 (unsupported colour space)", async () => {
    const pdfSharp = createPDFSharp();
    // 5 channels: data.length = width * height * 5
    const fiveChannel = {
      width: 10,
      height: 10,
      data: new Uint8Array(10 * 10 * 5),
    };
    const page = makeFakePage(fiveChannel);
    expect(await pdfSharp.pageToBuffer({ page })).toBeNull();
    expect(mockSharpFn).not.toHaveBeenCalled();
  });

  it("returns null when the opcode is not in validOps", async () => {
    const pdfSharp = createPDFSharp();
    const OTHER_OP = 999;
    const validImg = {
      width: 10,
      height: 10,
      data: new Uint8Array(10 * 10 * 4), // valid RGBA — but wrong opcode
    };
    const page = makeFakePage(validImg, OTHER_OP);
    expect(await pdfSharp.pageToBuffer({ page })).toBeNull();
    expect(mockSharpFn).not.toHaveBeenCalled();
  });

  it("returns a Buffer and calls Sharp for a valid RGBA (4-channel) image", async () => {
    const pdfSharp = createPDFSharp();
    const width = 10,
      height = 10,
      channels = 4;
    const validImg = {
      width,
      height,
      data: new Uint8Array(width * height * channels),
    };
    const page = makeFakePage(validImg);
    const result = await pdfSharp.pageToBuffer({ page });
    expect(result).toBeInstanceOf(Buffer);
    expect(mockSharpFn).toHaveBeenCalledWith(
      validImg.data,
      expect.objectContaining({ raw: { width, height, channels } })
    );
  });

  it("returns a Buffer and calls Sharp for a valid grayscale (1-channel) image", async () => {
    const pdfSharp = createPDFSharp();
    const width = 8,
      height = 8,
      channels = 1;
    const validImg = {
      width,
      height,
      data: new Uint8Array(width * height * channels),
    };
    const page = makeFakePage(validImg);
    const result = await pdfSharp.pageToBuffer({ page });
    expect(result).toBeInstanceOf(Buffer);
    expect(mockSharpFn).toHaveBeenCalledWith(
      validImg.data,
      expect.objectContaining({ raw: { width, height, channels } })
    );
  });

  it("returns a Buffer and calls Sharp for a valid RGB (3-channel) image", async () => {
    const pdfSharp = createPDFSharp();
    const width = 6,
      height = 6,
      channels = 3;
    const validImg = {
      width,
      height,
      data: new Uint8Array(width * height * channels),
    };
    const page = makeFakePage(validImg);
    const result = await pdfSharp.pageToBuffer({ page });
    expect(result).toBeInstanceOf(Buffer);
    expect(mockSharpFn).toHaveBeenCalledWith(
      validImg.data,
      expect.objectContaining({ raw: { width, height, channels } })
    );
  });
});
