process.env.STORAGE_DIR = "test-storage";

// ---------------------------------------------------------------------------
// Declare shared mock instances BEFORE the jest.mock() calls so the factory
// functions can close over them.  (jest.mock is hoisted to the top of the
// file by Babel/Jest, so normal `let` declarations would be undefined at that
// point — but jest.fn() at module scope is safe because it runs during the
// initial evaluation pass, before any test code.)
// ---------------------------------------------------------------------------
const mockPDFLoaderInstance = { load: jest.fn(), numPages: 0 };
const mockOCRLoaderInstance = { ocrPDF: jest.fn() };

jest.mock("../../../processSingleFile/convert/asPDF/PDFLoader", () =>
  jest.fn(() => mockPDFLoaderInstance)
);
jest.mock("../../../utils/OCRLoader", () =>
  jest.fn(() => mockOCRLoaderInstance)
);
jest.mock("../../../utils/files", () => ({
  createdDate: jest.fn().mockReturnValue("2024-01-01"),
  trashFile: jest.fn(),
  writeToServerDocuments: jest.fn().mockImplementation(({ data }) => ({
    ...data,
    location: `custom-documents/${data.id}.json`,
  })),
}));
jest.mock("../../../utils/tokenizer", () => ({
  tokenizeString: jest.fn().mockReturnValue(42),
}));

const asPdf = require("../../../processSingleFile/convert/asPDF/index");
const PDFLoader = require("../../../processSingleFile/convert/asPDF/PDFLoader");
const OCRLoader = require("../../../utils/OCRLoader");
const { trashFile, writeToServerDocuments } = require("../../../utils/files");

// ---------------------------------------------------------------------------
// Helper: build a document object that matches what PDFLoader / OCRLoader
// return, so tests are readable without boilerplate.
// ---------------------------------------------------------------------------
function makeDoc(pageNumber, text) {
  return {
    pageContent: text,
    metadata: {
      source: "/fake/document.pdf",
      pdf: { version: "v1.10.100", totalPages: 3 },
      loc: { pageNumber },
    },
  };
}

// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  // Reset instance state so each test starts from a known baseline.
  mockPDFLoaderInstance.numPages = 0;
  mockPDFLoaderInstance.load.mockResolvedValue([]);
  mockOCRLoaderInstance.ocrPDF.mockResolvedValue([]);
});

// ===========================================================================
describe("asPdf — digital PDF (all pages have a text layer)", () => {
  it("returns success with content from all pages", async () => {
    mockPDFLoaderInstance.numPages = 3;
    mockPDFLoaderInstance.load.mockResolvedValue([
      makeDoc(1, "Page one text."),
      makeDoc(2, "Page two text."),
      makeDoc(3, "Page three text."),
    ]);

    const result = await asPdf({
      fullFilePath: "/fake/digital.pdf",
      filename: "digital.pdf",
    });

    expect(result.success).toBe(true);
    expect(result.documents).toHaveLength(1);
    const content = result.documents[0].pageContent;
    expect(content).toContain("Page one text.");
    expect(content).toContain("Page two text.");
    expect(content).toContain("Page three text.");
  });

  it("does not instantiate OCRLoader when every page has text", async () => {
    mockPDFLoaderInstance.numPages = 2;
    mockPDFLoaderInstance.load.mockResolvedValue([
      makeDoc(1, "Hello."),
      makeDoc(2, "World."),
    ]);

    await asPdf({ fullFilePath: "/fake/digital.pdf", filename: "digital.pdf" });

    expect(OCRLoader).not.toHaveBeenCalled();
  });

  it("deletes the source file after successful processing", async () => {
    mockPDFLoaderInstance.numPages = 1;
    mockPDFLoaderInstance.load.mockResolvedValue([makeDoc(1, "Content.")]);

    await asPdf({ fullFilePath: "/fake/digital.pdf", filename: "digital.pdf" });

    expect(trashFile).toHaveBeenCalledWith("/fake/digital.pdf");
  });

  it("passes custom metadata title to the output document", async () => {
    mockPDFLoaderInstance.numPages = 1;
    mockPDFLoaderInstance.load.mockResolvedValue([makeDoc(1, "Content.")]);

    await asPdf({
      fullFilePath: "/fake/digital.pdf",
      filename: "digital.pdf",
      metadata: { title: "My Custom Title" },
    });

    expect(writeToServerDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "My Custom Title" }),
      })
    );
  });

  it("falls back to filename when metadata title is absent", async () => {
    mockPDFLoaderInstance.numPages = 1;
    mockPDFLoaderInstance.load.mockResolvedValue([makeDoc(1, "Content.")]);

    await asPdf({
      fullFilePath: "/fake/digital.pdf",
      filename: "digital.pdf",
    });

    expect(writeToServerDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "digital.pdf" }),
      })
    );
  });
});

// ===========================================================================
describe("asPdf — scanned PDF (no text layer at all)", () => {
  it("falls back to OCR and returns success with the OCR'd content", async () => {
    mockPDFLoaderInstance.numPages = 2;
    mockPDFLoaderInstance.load.mockResolvedValue([]); // no text anywhere
    mockOCRLoaderInstance.ocrPDF.mockResolvedValue([
      makeDoc(1, "OCR page 1."),
      makeDoc(2, "OCR page 2."),
    ]);

    const result = await asPdf({
      fullFilePath: "/fake/scanned.pdf",
      filename: "scanned.pdf",
    });

    expect(result.success).toBe(true);
    expect(OCRLoader).toHaveBeenCalledTimes(1);
    const content = result.documents[0].pageContent;
    expect(content).toContain("OCR page 1.");
    expect(content).toContain("OCR page 2.");
  });

  it("passes the targetLanguages option to OCRLoader", async () => {
    mockPDFLoaderInstance.numPages = 1;
    mockPDFLoaderInstance.load.mockResolvedValue([]);
    mockOCRLoaderInstance.ocrPDF.mockResolvedValue([makeDoc(1, "Text.")]);

    await asPdf({
      fullFilePath: "/fake/scanned.pdf",
      filename: "scanned.pdf",
      options: { ocr: { langList: "deu,fra" } },
    });

    expect(OCRLoader).toHaveBeenCalledWith({ targetLanguages: "deu,fra" });
  });

  it("returns failure when OCR also yields no content", async () => {
    mockPDFLoaderInstance.numPages = 1;
    mockPDFLoaderInstance.load.mockResolvedValue([]);
    mockOCRLoaderInstance.ocrPDF.mockResolvedValue([]);

    const result = await asPdf({
      fullFilePath: "/fake/empty.pdf",
      filename: "empty.pdf",
    });

    expect(result.success).toBe(false);
    expect(result.documents).toHaveLength(0);
    expect(result.reason).toMatch(/No text content found/i);
  });

  it("deletes the source file even when processing fails", async () => {
    mockPDFLoaderInstance.numPages = 1;
    mockPDFLoaderInstance.load.mockResolvedValue([]);
    mockOCRLoaderInstance.ocrPDF.mockResolvedValue([]);

    await asPdf({ fullFilePath: "/fake/empty.pdf", filename: "empty.pdf" });

    expect(trashFile).toHaveBeenCalledWith("/fake/empty.pdf");
  });
});

// ===========================================================================
describe("asPdf — mixed PDF (text pages + image-only pages)", () => {
  it("runs OCR when docs.length < totalPages", async () => {
    // Pages 1 and 3 have text; page 2 is image-only (skipped by PDFLoader).
    mockPDFLoaderInstance.numPages = 3;
    mockPDFLoaderInstance.load.mockResolvedValue([
      makeDoc(1, "Text p1."),
      makeDoc(3, "Text p3."),
    ]);
    mockOCRLoaderInstance.ocrPDF.mockResolvedValue([makeDoc(2, "OCR p2.")]);

    const result = await asPdf({
      fullFilePath: "/fake/mixed.pdf",
      filename: "mixed.pdf",
    });

    expect(result.success).toBe(true);
    expect(OCRLoader).toHaveBeenCalledTimes(1);
  });

  it("merges text and OCR pages in ascending page-number order", async () => {
    mockPDFLoaderInstance.numPages = 3;
    mockPDFLoaderInstance.load.mockResolvedValue([
      makeDoc(1, "Text p1."),
      makeDoc(3, "Text p3."),
    ]);
    mockOCRLoaderInstance.ocrPDF.mockResolvedValue([makeDoc(2, "OCR p2.")]);

    const result = await asPdf({
      fullFilePath: "/fake/mixed.pdf",
      filename: "mixed.pdf",
    });

    const content = result.documents[0].pageContent;
    const pos1 = content.indexOf("Text p1.");
    const pos2 = content.indexOf("OCR p2.");
    const pos3 = content.indexOf("Text p3.");
    expect(pos1).toBeLessThan(pos2);
    expect(pos2).toBeLessThan(pos3);
  });

  it("includes all three sources — first text page, OCR page, last text page", async () => {
    mockPDFLoaderInstance.numPages = 3;
    mockPDFLoaderInstance.load.mockResolvedValue([
      makeDoc(1, "Text p1."),
      makeDoc(3, "Text p3."),
    ]);
    mockOCRLoaderInstance.ocrPDF.mockResolvedValue([makeDoc(2, "OCR p2.")]);

    const result = await asPdf({
      fullFilePath: "/fake/mixed.pdf",
      filename: "mixed.pdf",
    });

    const content = result.documents[0].pageContent;
    expect(content).toContain("Text p1.");
    expect(content).toContain("OCR p2.");
    expect(content).toContain("Text p3.");
  });

  it("does not duplicate content for a page already covered by PDFLoader", async () => {
    // OCR unexpectedly returns page 1 as well as page 3 (the real missing page).
    mockPDFLoaderInstance.numPages = 3;
    mockPDFLoaderInstance.load.mockResolvedValue([
      makeDoc(1, "Text p1."),
      makeDoc(2, "Text p2."),
    ]);
    mockOCRLoaderInstance.ocrPDF.mockResolvedValue([
      makeDoc(1, "OCR duplicate p1."),
      makeDoc(3, "OCR p3."),
    ]);

    const result = await asPdf({
      fullFilePath: "/fake/mixed.pdf",
      filename: "mixed.pdf",
    });

    const content = result.documents[0].pageContent;
    expect(content).toContain("Text p1.");
    expect(content).not.toContain("OCR duplicate p1.");
    expect(content).toContain("OCR p3.");
  });

  it("succeeds with only the PDFLoader text when OCR returns nothing", async () => {
    mockPDFLoaderInstance.numPages = 3;
    mockPDFLoaderInstance.load.mockResolvedValue([
      makeDoc(1, "Text p1."),
      makeDoc(3, "Text p3."),
    ]);
    mockOCRLoaderInstance.ocrPDF.mockResolvedValue([]); // OCR found nothing

    const result = await asPdf({
      fullFilePath: "/fake/mixed.pdf",
      filename: "mixed.pdf",
    });

    expect(result.success).toBe(true);
    const content = result.documents[0].pageContent;
    expect(content).toContain("Text p1.");
    expect(content).toContain("Text p3.");
  });

  it("handles a PDF where only the first page is image-only", async () => {
    mockPDFLoaderInstance.numPages = 3;
    // PDFLoader only returned pages 2 and 3 (page 1 is image-only).
    mockPDFLoaderInstance.load.mockResolvedValue([
      makeDoc(2, "Text p2."),
      makeDoc(3, "Text p3."),
    ]);
    mockOCRLoaderInstance.ocrPDF.mockResolvedValue([makeDoc(1, "OCR p1.")]);

    const result = await asPdf({
      fullFilePath: "/fake/mixed.pdf",
      filename: "mixed.pdf",
    });

    const content = result.documents[0].pageContent;
    // After merge and sort, page 1 should appear first.
    expect(content.indexOf("OCR p1.")).toBeLessThan(content.indexOf("Text p2."));
  });

  it("handles a PDF where only the last page is image-only", async () => {
    mockPDFLoaderInstance.numPages = 3;
    mockPDFLoaderInstance.load.mockResolvedValue([
      makeDoc(1, "Text p1."),
      makeDoc(2, "Text p2."),
    ]);
    mockOCRLoaderInstance.ocrPDF.mockResolvedValue([makeDoc(3, "OCR p3.")]);

    const result = await asPdf({
      fullFilePath: "/fake/mixed.pdf",
      filename: "mixed.pdf",
    });

    const content = result.documents[0].pageContent;
    expect(content.indexOf("Text p2.")).toBeLessThan(content.indexOf("OCR p3."));
  });
});

// ===========================================================================
describe("asPdf — output document structure", () => {
  beforeEach(() => {
    mockPDFLoaderInstance.numPages = 1;
    mockPDFLoaderInstance.load.mockResolvedValue([makeDoc(1, "Some content.")]);
  });

  it("includes a non-empty uuid as document id", async () => {
    const result = await asPdf({
      fullFilePath: "/fake/doc.pdf",
      filename: "doc.pdf",
    });
    expect(result.documents[0].id).toBeDefined();
    expect(typeof result.documents[0].id).toBe("string");
    expect(result.documents[0].id.length).toBeGreaterThan(0);
  });

  it("sets url to 'file://' + fullFilePath", async () => {
    const result = await asPdf({
      fullFilePath: "/fake/doc.pdf",
      filename: "doc.pdf",
    });
    expect(result.documents[0].url).toBe("file:///fake/doc.pdf");
  });

  it("sets docSource to the default PDF description when not overridden", async () => {
    const result = await asPdf({
      fullFilePath: "/fake/doc.pdf",
      filename: "doc.pdf",
    });
    expect(result.documents[0].docSource).toMatch(/pdf file uploaded/i);
  });

  it("uses metadata.docSource when provided", async () => {
    const result = await asPdf({
      fullFilePath: "/fake/doc.pdf",
      filename: "doc.pdf",
      metadata: { docSource: "custom source" },
    });
    expect(result.documents[0].docSource).toBe("custom source");
  });

  it("calculates wordCount from the joined page content", async () => {
    const result = await asPdf({
      fullFilePath: "/fake/doc.pdf",
      filename: "doc.pdf",
    });
    // "Some content." → 2 words split by space
    expect(result.documents[0].wordCount).toBe(2);
  });
});
