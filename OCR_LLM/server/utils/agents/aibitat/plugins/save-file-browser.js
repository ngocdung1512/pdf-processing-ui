const { Deduplicator } = require("../utils/dedupe");

const saveFileInBrowser = {
  name: "save-file-to-browser",
  startupConfig: {
    params: {},
  },
  plugin: function () {
    return {
      name: this.name,
      setup(aibitat) {
        // List and summarize the contents of files that are embedded in the workspace
        aibitat.function({
          super: aibitat,
          tracker: new Deduplicator(),
          name: this.name,
          description:
            "Save content to a file when the user explicitly asks for a download of the file. Supports .txt, .csv, and .xlsx (Excel) file formats. For CSV or Excel files, format file_content as comma-separated values with a header row.",
          examples: [
            {
              prompt: "Save me that to a file named 'output'",
              call: JSON.stringify({
                file_content:
                  "<content of the file we will write previous conversation>",
                filename: "output.txt",
              }),
            },
            {
              prompt: "Export that table as a CSV file",
              call: JSON.stringify({
                file_content: "Column1,Column2,Column3\nvalue1,value2,value3",
                filename: "results.csv",
              }),
            },
            {
              prompt: "Download that as an Excel file",
              call: JSON.stringify({
                file_content: "Column1,Column2,Column3\nvalue1,value2,value3",
                filename: "results.xlsx",
              }),
            },
            {
              prompt: "Save me that to a file",
              call: JSON.stringify({
                file_content:
                  "<content of the file we will write from previous conversation>",
                filename: "<descriptive filename>.txt",
              }),
            },
          ],
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              file_content: {
                type: "string",
                description:
                  "The content of the file that will be saved. For .csv or .xlsx files, provide data in CSV format (comma-separated values with a header row on the first line).",
              },
              filename: {
                type: "string",
                description:
                  "Filename to save the file as with extension. Use .txt for plain text, .csv for CSV spreadsheets, or .xlsx for Excel workbooks.",
              },
            },
            additionalProperties: false,
          },
          handler: async function ({ file_content = "", filename }) {
            try {
              const { isDuplicate, reason } = this.tracker.isDuplicate(
                this.name,
                { file_content, filename }
              );
              if (isDuplicate) {
                this.super.handlerProps.log(
                  `${this.name} was called, but exited early because ${reason}.`
                );
                return `${filename} file has been saved successfully!`;
              }

              const ext = (filename.split(".").pop() || "").toLowerCase();
              let b64Content;

              if (ext === "csv") {
                b64Content =
                  "data:text/csv;base64," +
                  Buffer.from(file_content, "utf8").toString("base64");
              } else if (ext === "xlsx") {
                const XLSX = require("xlsx");
                const rows = file_content
                  .trim()
                  .split(/\r?\n/)
                  .map((row) => {
                    // Handle quoted CSV fields
                    const result = [];
                    let cur = "";
                    let inQuote = false;
                    for (let i = 0; i < row.length; i++) {
                      const ch = row[i];
                      if (ch === '"') {
                        inQuote = !inQuote;
                      } else if (ch === "," && !inQuote) {
                        result.push(cur.trim());
                        cur = "";
                      } else {
                        cur += ch;
                      }
                    }
                    result.push(cur.trim());
                    return result;
                  });
                const ws = XLSX.utils.aoa_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
                const xlsxBuffer = XLSX.write(wb, {
                  type: "buffer",
                  bookType: "xlsx",
                });
                b64Content =
                  "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," +
                  xlsxBuffer.toString("base64");
              } else {
                b64Content =
                  "data:text/plain;base64," +
                  Buffer.from(file_content, "utf8").toString("base64");
              }

              this.super.socket.send("fileDownload", {
                filename,
                b64Content,
              });
              this.super.introspect(`${this.caller}: Saving file ${filename}.`);
              this.tracker.trackRun(this.name, { file_content, filename });
              return `${filename} file has been saved successfully and will be downloaded automatically to the users browser.`;
            } catch (error) {
              this.super.handlerProps.log(
                `save-file-to-browser raised an error. ${error.message}`
              );
              return `Let the user know this action was not successful. An error was raised while saving a file to the browser. ${error.message}`;
            }
          },
        });
      },
    };
  },
};

module.exports = {
  saveFileInBrowser,
};
