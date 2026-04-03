const { SystemSettings } = require("../models/systemSettings");

function utilEndpoints(app) {
  if (!app) return;

  /**
   * POST /utils/extract-doc-template
   * Accepts a .doc or .docx file upload and returns its plain-text content.
   * Used by the frontend DocxTemplateButton — no workspace, no embedding.
   */
  app.post(
    "/utils/extract-doc-template",
    async function (request, response, next) {
      // Lazy-require to avoid circular dependency issues at module load time
      const { validatedRequest } = require("../utils/middleware/validatedRequest");
      const { handleFileUpload } = require("../utils/files/multer");
      validatedRequest(request, response, () => handleFileUpload(request, response, next));
    },
    async function (request, response) {
      try {
        const fs = require("fs");
        const { CollectorApi } = require("../utils/collectorApi");
        const { extractDocxStyles } = require("../utils/docxStyleExtractor");
        const { extractDocxContent } = require("../utils/docxContentExtractor");
        const { originalname, path: filePath } = request.file;

        const isDocx = originalname.toLowerCase().endsWith(".docx");

        // ── .docx: extract content + styles directly from ZIP ────────────────
        // The collector only produces flat plain text (loses table/heading
        // structure), so we read word/document.xml ourselves instead.
        if (isDocx && filePath) {
          const styles = extractDocxStyles(filePath);
          const content = extractDocxContent(filePath);

          // Clean up the file from hotdir ourselves (collector not involved)
          try { fs.unlinkSync(filePath); } catch { /* non-fatal */ }

          if (!content) {
            return response.status(422).json({
              success: false,
              error: "Could not extract structured content from .docx file.",
            });
          }

          return response.status(200).json({ success: true, content, styles });
        }

        // ── .doc (and fallback): use collector for text extraction ────────────
        const Collector = new CollectorApi();

        const processingOnline = await Collector.online();
        if (!processingOnline) {
          return response.status(503).json({
            success: false,
            error: "Document processing service is offline.",
          });
        }

        const { success, reason, documents } =
          await Collector.parseDocument(originalname);

        if (!success || !documents?.[0]?.pageContent) {
          return response.status(422).json({
            success: false,
            error: reason || "Could not extract text from document.",
          });
        }

        return response.status(200).json({
          success: true,
          content: documents[0].pageContent,
          styles: null,
        });
      } catch (e) {
        console.error("[extract-doc-template]", e.message);
        return response.sendStatus(500).end();
      }
    }
  );

  /**
   * POST /utils/docx-find-replace
   * Multipart: file (.docx), find, replace, optional matchCase, wholeWord.
   * Applies find/replace paragraph-wise (merged w:t) so text split across runs still matches.
   * Returns the modified .docx as binary; X-Replace-Count header when successful.
   */
  app.post(
    "/utils/docx-find-replace",
    async function (request, response, next) {
      const { validatedRequest } = require("../utils/middleware/validatedRequest");
      const { handleFileUpload } = require("../utils/files/multer");
      validatedRequest(request, response, () =>
        handleFileUpload(request, response, next)
      );
    },
    async function (request, response) {
      const fs = require("fs");
      try {
        const { findReplaceInDocxBuffer } = require("../utils/docxFindReplace");
        const file = request.file;
        const findRaw = String(request.body?.find ?? "");
        const replace = String(request.body?.replace ?? "");
        const matchCase =
          request.body?.matchCase === "true" || request.body?.matchCase === true;
        const wholeWord =
          request.body?.wholeWord === "true" || request.body?.wholeWord === true;

        if (!file?.path) {
          return response.status(400).json({
            success: false,
            error: "file is required.",
          });
        }

        if (!findRaw.trim()) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* non-fatal */
          }
          return response.status(400).json({
            success: false,
            error: "find is required.",
          });
        }

        if (!file.originalname.toLowerCase().endsWith(".docx")) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* non-fatal */
          }
          return response.status(400).json({
            success: false,
            error: "Only .docx files are supported.",
          });
        }

        const buf = fs.readFileSync(file.path);
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* non-fatal */
        }

        const { buffer: outBuf, count } = findReplaceInDocxBuffer(buf, findRaw, replace, {
          matchCase,
          wholeWord,
        });

        if (count === 0) {
          return response.status(422).json({
            success: false,
            error: "No matches found for the search text.",
            count: 0,
          });
        }

        const base = file.originalname.replace(/\.docx$/i, "");
        const outName = `${base}_replaced.docx`;
        response.set(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        response.set(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(outName)}`
        );
        response.set("X-Replace-Count", String(count));
        return response.send(outBuf);
      } catch (e) {
        console.error("[docx-find-replace]", e.message);
        return response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  /**
   * POST /utils/auto-inject-noi-dung
   * Accepts a .docx binary (base64) + extracted content.
   * Uses the configured LLM to detect where the fixed header ends and injects
   * a {noi_dung} paragraph at that position.
   *
   * If the template already has {noi_dung}, returns { alreadyHasMarker: true }.
   * On success, returns { injectedBase64: "<base64 of modified .docx>" }.
   * On failure (LLM unavailable, boundary not found), returns { success: false }.
   */
  app.post(
    "/utils/auto-inject-noi-dung",
    async function (request, response, next) {
      const { validatedRequest } = require("../utils/middleware/validatedRequest");
      validatedRequest(request, response, next);
    },
    async function (request, response) {
      try {
        const { hasNoiDungMarker, autoInjectNoiDung } = require("../utils/docxNoiDungInjector");
        const { templateBase64, content } = request.body;

        if (!templateBase64 || !content) {
          return response.status(400).json({
            success: false,
            error: "templateBase64 and content are required.",
          });
        }

        const buf = Buffer.from(templateBase64, "base64");

        // If the marker is already present, nothing to do
        if (hasNoiDungMarker(buf)) {
          return response.status(200).json({ success: true, alreadyHasMarker: true });
        }

        const injectedBuf = await autoInjectNoiDung(buf, content);
        if (!injectedBuf) {
          return response.status(422).json({
            success: false,
            error: "Could not detect header boundary. Template not modified.",
          });
        }

        return response.status(200).json({
          success: true,
          alreadyHasMarker: false,
          injectedBase64: injectedBuf.toString("base64"),
        });
      } catch (e) {
        console.error("[auto-inject-noi-dung]", e.message);
        return response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  /**
   * POST /utils/doc-template-tags
   * Accepts a .docx binary (base64) and returns the list of {placeholder} tags
   * found in the document, so the frontend can build the AI prompt.
   */
  app.post(
    "/utils/doc-template-tags",
    async function (request, response, next) {
      const { validatedRequest } = require("../utils/middleware/validatedRequest");
      validatedRequest(request, response, next);
    },
    async function (request, response) {
      try {
        const { extractTemplateTags } = require("../utils/docxTemplateFiller");
        const { templateBase64 } = request.body;
        if (!templateBase64) {
          return response.status(400).json({ success: false, error: "templateBase64 required" });
        }
        const buf = Buffer.from(templateBase64, "base64");
        const tags = extractTemplateTags(buf);
        return response.status(200).json({ success: true, tags });
      } catch (e) {
        console.error("[doc-template-tags]", e.message);
        return response.sendStatus(500).end();
      }
    }
  );

  /**
   * POST /utils/auto-tag-template
   * Accepts a raw (untagged) document binary (base64) and uses the configured
   * LLM to identify variable fields, then returns a tagged .docx template.
   *
   * For .docx: patches the original XML in-place (preserves formatting).
   * For .doc:  caller must also supply `content` (pre-extracted plain text);
   *            a fresh minimal .docx is built from that text with tags injected.
   */
  app.post(
    "/utils/auto-tag-template",
    async function (request, response, next) {
      const { validatedRequest } = require("../utils/middleware/validatedRequest");
      validatedRequest(request, response, next);
    },
    async function (request, response) {
      try {
        const { templateBase64, content: providedContent, isDoc } = request.body;
        if (!templateBase64) {
          return response
            .status(400)
            .json({ success: false, error: "templateBase64 required" });
        }

        const {
          analyzeTemplateFields,
          buildTaggedDocx,
          buildTaggedDocxFromText,
          getFieldList,
        } = require("../utils/docxAutoTagger");

        let content;

        if (isDoc) {
          // .doc path: use the pre-extracted plain text supplied by the caller
          content = providedContent?.trim();
          if (!content) {
            return response.status(422).json({
              success: false,
              error: "content is required for .doc auto-tagging.",
            });
          }
        } else {
          // .docx path: extract structured markdown directly from the ZIP XML
          const os = require("os");
          const path = require("path");
          const fs = require("fs");
          const { extractDocxContent } = require("../utils/docxContentExtractor");

          const buf = Buffer.from(templateBase64, "base64");
          const tmpPath = path.join(os.tmpdir(), `auto_tag_${Date.now()}.docx`);
          fs.writeFileSync(tmpPath, buf);
          content = extractDocxContent(tmpPath);
          try { fs.unlinkSync(tmpPath); } catch { /* non-fatal */ }

          if (!content) {
            return response.status(422).json({
              success: false,
              error: "Could not extract content from .docx file.",
            });
          }
        }

        // Ask the LLM to identify variable fields
        const analysis = await analyzeTemplateFields(content);
        if (!analysis) {
          return response.status(422).json({
            success: false,
            error: "LLM could not analyze the template fields.",
          });
        }

        // Build the tagged .docx
        let taggedBuf;
        if (isDoc) {
          // Build a fresh .docx from the plain text with tags embedded
          taggedBuf = buildTaggedDocxFromText(content, analysis);
        } else {
          // Patch the original .docx XML in-place
          const buf = Buffer.from(templateBase64, "base64");
          taggedBuf = buildTaggedDocx(buf, analysis);
        }

        if (!taggedBuf) {
          return response.status(500).json({
            success: false,
            error: "Failed to build tagged template.",
          });
        }

        const fields = getFieldList(analysis);
        return response.status(200).json({
          success: true,
          taggedBase64: taggedBuf.toString("base64"),
          fields,
        });
      } catch (e) {
        console.error("[auto-tag-template]", e.message);
        return response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  /**
   * POST /utils/fill-doc-template
   * Accepts a .docx template (base64) + a JSON data object.
   * Returns the filled .docx binary so the browser can download it.
   */
  app.post(
    "/utils/fill-doc-template",
    async function (request, response, next) {
      const { validatedRequest } = require("../utils/middleware/validatedRequest");
      validatedRequest(request, response, next);
    },
    async function (request, response) {
      try {
        const { fillDocxTemplate } = require("../utils/docxTemplateFiller");
        const { templateBase64, data } = request.body;

        if (!templateBase64 || !data) {
          return response.status(400).json({
            success: false,
            error: "templateBase64 and data are required.",
          });
        }

        const templateBuf = Buffer.from(templateBase64, "base64");
        const filledBuf = fillDocxTemplate(templateBuf, data);

        response.set(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        response.set("Content-Disposition", 'attachment; filename="report_filled.docx"');
        return response.send(filledBuf);
      } catch (e) {
        console.error("[fill-doc-template]", e.message);
        return response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  // ─── Report Format Library ─────────────────────────────────────────────────

  /**
   * GET /utils/report-formats
   * List all saved report format templates (metadata only, no binary).
   */
  app.get(
    "/utils/report-formats",
    async function (request, response, next) {
      const { validatedRequest } = require("../utils/middleware/validatedRequest");
      validatedRequest(request, response, next);
    },
    async function (_request, response) {
      try {
        const { listFormats } = require("../utils/reportFormatStorage");
        return response.status(200).json({ success: true, formats: listFormats() });
      } catch (e) {
        console.error("[report-formats/list]", e.message);
        return response.sendStatus(500).end();
      }
    }
  );

  /**
   * POST /utils/report-formats
   * Upload a new .docx template into the library (multipart file + optional name field).
   */
  app.post(
    "/utils/report-formats",
    async function (request, response, next) {
      const { validatedRequest } = require("../utils/middleware/validatedRequest");
      const { handleFileUpload } = require("../utils/files/multer");
      validatedRequest(request, response, () =>
        handleFileUpload(request, response, next)
      );
    },
    async function (request, response) {
      try {
        const fs = require("fs");
        const { saveFormat } = require("../utils/reportFormatStorage");

        const { originalname, path: filePath } = request.file;
        if (!originalname.toLowerCase().endsWith(".docx")) {
          try { fs.unlinkSync(filePath); } catch { /* non-fatal */ }
          return response.status(422).json({
            success: false,
            error: "Only .docx files are supported for the report format library.",
          });
        }

        const buffer = fs.readFileSync(filePath);
        try { fs.unlinkSync(filePath); } catch { /* non-fatal */ }

        // Save the raw template — {noi_dung} injection is done client-side
        // in the NoiDungEditor when the user selects the template.
        const name =
          request.body?.name ||
          originalname.replace(/\.docx$/i, "");
        const entry = saveFormat(name, buffer);
        return response.status(200).json({ success: true, format: entry });
      } catch (e) {
        console.error("[report-formats/save]", e.message);
        return response.sendStatus(500).end();
      }
    }
  );

  /**
   * DELETE /utils/report-formats/:id
   * Remove a template from the library.
   */
  app.delete(
    "/utils/report-formats/:id",
    async function (request, response, next) {
      const { validatedRequest } = require("../utils/middleware/validatedRequest");
      validatedRequest(request, response, next);
    },
    async function (request, response) {
      try {
        const { deleteFormat } = require("../utils/reportFormatStorage");
        const { id } = request.params;
        const deleted = deleteFormat(id);
        if (!deleted)
          return response
            .status(404)
            .json({ success: false, error: "Format not found." });
        return response.status(200).json({ success: true });
      } catch (e) {
        console.error("[report-formats/delete]", e.message);
        return response.sendStatus(500).end();
      }
    }
  );

  /**
   * PATCH /utils/report-formats/:id/file
   * Overwrite the stored .docx for a template with a new (processed) version.
   * Used by the client to persist processed templates (with {noi_dung}/{ket_thuc} markers
   * or {field} tags baked in) so that subsequent selections skip LLM analysis.
   *
   * Body: { base64: "<raw base64 of .docx>" }
   */
  app.patch(
    "/utils/report-formats/:id/file",
    async function (request, response, next) {
      const { validatedRequest } = require("../utils/middleware/validatedRequest");
      validatedRequest(request, response, next);
    },
    async function (request, response) {
      try {
        const { updateFormatFile } = require("../utils/reportFormatStorage");
        const { id } = request.params;
        const { base64 } = request.body;
        if (!base64 || typeof base64 !== "string") {
          return response
            .status(400)
            .json({ success: false, error: "base64 field required." });
        }
        const buffer = Buffer.from(base64, "base64");
        const ok = updateFormatFile(id, buffer);
        if (!ok)
          return response
            .status(404)
            .json({ success: false, error: "Format not found." });
        return response.status(200).json({ success: true });
      } catch (e) {
        console.error("[report-formats/update-file]", e.message);
        return response.sendStatus(500).end();
      }
    }
  );

  /**
   * GET /utils/report-formats/:id/preview-html
   * Convert the stored .docx template to HTML for in-browser preview.
   * Returns Content-Type: text/html so it can be loaded directly in an <iframe>.
   */
  app.get(
    "/utils/report-formats/:id/preview-html",
    async function (request, response, next) {
      const { validatedRequest } = require("../utils/middleware/validatedRequest");
      validatedRequest(request, response, next);
    },
    async function (request, response) {
      try {
        const { getFormat } = require("../utils/reportFormatStorage");
        const { docxToHtml } = require("../utils/docxToHtml");

        const { id } = request.params;
        const format = getFormat(id);
        if (!format)
          return response.status(404).json({ success: false, error: "Format not found." });

        const html = docxToHtml(format.filePath);
        if (!html)
          return response.status(422).json({ success: false, error: "Could not render preview." });

        response.set("Content-Type", "text/html; charset=utf-8");
        response.set("X-Frame-Options", "SAMEORIGIN");
        return response.send(html);
      } catch (e) {
        console.error("[report-formats/preview-html]", e.message);
        return response.sendStatus(500).end();
      }
    }
  );

  /**
   * GET /utils/report-formats/:id/data
   * Return metadata + full extracted markdown content + raw base64 binary for a template.
   */
  app.get(
    "/utils/report-formats/:id/data",
    async function (request, response, next) {
      const { validatedRequest } = require("../utils/middleware/validatedRequest");
      validatedRequest(request, response, next);
    },
    async function (request, response) {
      try {
        const fs = require("fs");
        const { getFormat } = require("../utils/reportFormatStorage");
        const { extractDocxContent } = require("../utils/docxContentExtractor");

        const { id } = request.params;
        const format = getFormat(id);
        if (!format)
          return response
            .status(404)
            .json({ success: false, error: "Format not found." });

        const content = extractDocxContent(format.filePath) ?? "";
        const base64 = fs.readFileSync(format.filePath).toString("base64");

        return response.status(200).json({
          success: true,
          id: format.id,
          name: format.name,
          uploadedAt: format.uploadedAt,
          content,
          base64,
        });
      } catch (e) {
        console.error("[report-formats/data]", e.message);
        return response.sendStatus(500).end();
      }
    }
  );

  app.get("/utils/metrics", async (_, response) => {
    try {
      const metrics = {
        online: true,
        version: getGitVersion(),
        mode: (await SystemSettings.isMultiUserMode())
          ? "multi-user"
          : "single-user",
        vectorDB: process.env.VECTOR_DB || "lancedb",
        storage: await getDiskStorage(),
        appVersion: getDeploymentVersion(),
      };
      response.status(200).json(metrics);
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  const {
    dockerModelRunnerUtilsEndpoints,
  } = require("./utils/dockerModelRunnerUtils");
  dockerModelRunnerUtilsEndpoints(app);

  const { lemonadeUtilsEndpoints } = require("./utils/lemonadeUtilsEndpoints");
  lemonadeUtilsEndpoints(app);
}

function getGitVersion() {
  if (process.env.ANYTHING_LLM_RUNTIME === "docker") return "--";
  try {
    return require("child_process")
      .execSync("git rev-parse HEAD")
      .toString()
      .trim();
  } catch (e) {
    console.error("getGitVersion", e.message);
    return "--";
  }
}

function byteToGigaByte(n) {
  return n / Math.pow(10, 9);
}

async function getDiskStorage() {
  try {
    const checkDiskSpace = require("check-disk-space").default;
    const { free, size } = await checkDiskSpace("/");
    return {
      current: Math.floor(byteToGigaByte(free)),
      capacity: Math.floor(byteToGigaByte(size)),
    };
  } catch {
    return {
      current: null,
      capacity: null,
    };
  }
}

/**
 * Returns the model tag based on the provider set in the environment.
 * This information is used to identify the parent model for the system
 * so that we can prioritize the correct model and types for future updates
 * as well as build features in AnythingLLM directly for a specific model or capabilities.
 *
 * Disable with  {@link https://github.com/Mintplex-Labs/anything-llm?tab=readme-ov-file#telemetry--privacy|Disable Telemetry}
 * @returns {string} The model tag.
 */
function getModelTag() {
  let model = null;
  const provider = process.env.LLM_PROVIDER;

  switch (provider) {
    case "openai":
      model = process.env.OPEN_MODEL_PREF;
      break;
    case "anthropic":
      model = process.env.ANTHROPIC_MODEL_PREF;
      break;
    case "lmstudio":
      model = process.env.LMSTUDIO_MODEL_PREF;
      break;
    case "ollama":
      model = process.env.OLLAMA_MODEL_PREF;
      break;
    case "groq":
      model = process.env.GROQ_MODEL_PREF;
      break;
    case "togetherai":
      model = process.env.TOGETHER_AI_MODEL_PREF;
      break;
    case "azure":
      model = process.env.OPEN_MODEL_PREF;
      break;
    case "koboldcpp":
      model = process.env.KOBOLD_CPP_MODEL_PREF;
      break;
    case "localai":
      model = process.env.LOCAL_AI_MODEL_PREF;
      break;
    case "openrouter":
      model = process.env.OPENROUTER_MODEL_PREF;
      break;
    case "mistral":
      model = process.env.MISTRAL_MODEL_PREF;
      break;
    case "generic-openai":
      model = process.env.GENERIC_OPEN_AI_MODEL_PREF;
      break;
    case "perplexity":
      model = process.env.PERPLEXITY_MODEL_PREF;
      break;
    case "textgenwebui":
      model = "textgenwebui-default";
      break;
    case "bedrock":
      model = process.env.AWS_BEDROCK_LLM_MODEL_PREFERENCE;
      break;
    case "fireworksai":
      model = process.env.FIREWORKS_AI_LLM_MODEL_PREF;
      break;
    case "deepseek":
      model = process.env.DEEPSEEK_MODEL_PREF;
      break;
    case "litellm":
      model = process.env.LITE_LLM_MODEL_PREF;
      break;
    case "apipie":
      model = process.env.APIPIE_LLM_MODEL_PREF;
      break;
    case "xai":
      model = process.env.XAI_LLM_MODEL_PREF;
      break;
    case "novita":
      model = process.env.NOVITA_LLM_MODEL_PREF;
      break;
    case "nvidia-nim":
      model = process.env.NVIDIA_NIM_LLM_MODEL_PREF;
      break;
    case "ppio":
      model = process.env.PPIO_MODEL_PREF;
      break;
    case "gemini":
      model = process.env.GEMINI_LLM_MODEL_PREF;
      break;
    case "moonshotai":
      model = process.env.MOONSHOT_AI_MODEL_PREF;
      break;
    case "zai":
      model = process.env.ZAI_MODEL_PREF;
      break;
    case "giteeai":
      model = process.env.GITEE_AI_MODEL_PREF;
      break;
    case "cohere":
      model = process.env.COHERE_MODEL_PREF;
      break;
    case "docker-model-runner":
      model = process.env.DOCKER_MODEL_RUNNER_LLM_MODEL_PREF;
      break;
    case "privatemode":
      model = process.env.PRIVATEMODE_LLM_MODEL_PREF;
      break;
    case "sambanova":
      model = process.env.SAMBANOVA_LLM_MODEL_PREF;
      break;
    case "lemonade":
      model = process.env.LEMONADE_LLM_MODEL_PREF;
      break;
    default:
      model = "--";
      break;
  }
  return model;
}

/**
 * Returns the deployment version.
 * - Dev: reads from package.json
 * - Prod: reads from ENV
 * expected format: major.minor.patch
 * @returns {string|null} The deployment version.
 */
function getDeploymentVersion() {
  if (process.env.NODE_ENV === "development")
    return require("../../package.json").version;
  if (process.env.DEPLOYMENT_VERSION) return process.env.DEPLOYMENT_VERSION;
  return null;
}

/**
 * Returns the user agent for the AnythingLLM deployment.
 * @returns {string} The user agent.
 */
function getAnythingLLMUserAgent() {
  const version = getDeploymentVersion() || "unknown";
  return `AnythingLLM/${version}`;
}

module.exports = {
  utilEndpoints,
  getGitVersion,
  getModelTag,
  getAnythingLLMUserAgent,
};
