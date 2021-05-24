//const part
require("dotenv").config();
const express = require("express");
const multer = require("multer");
const uuid = require("uuid").v4;
const unzipper = require("unzipper");
const fs = require("fs-extra");
const PORT = 5000;
const LIMIT = 2 * 1000 * 1000000;
const puppeteer = require("puppeteer");
const path = require("path");
const { performance } = require("perf_hooks");
//Memory usage

const formatMemoryUsage = (data) =>
  `${Math.round((data / 1024 / 1024) * 100) / 100} MB`;
const memoryData = process.memoryUsage();
const memoryUsage = {
  rss: `${formatMemoryUsage(
    memoryData.rss
  )} -> Resident Set Size - total memory allocated for the process execution`,
  heapTotal: `${formatMemoryUsage(
    memoryData.heapTotal
  )} -> total size of the allocated heap`,
  heapUsed: `${formatMemoryUsage(
    memoryData.heapUsed
  )} -> actual memory used during the execution`,
  external: `${formatMemoryUsage(memoryData.external)} -> V8 external memory`,
};

//Log file logic
const log4js = require("log4js");

log4js.configure({
  appenders: {
    file: {
      type: "file",
      filename: "convert.log",
      maxLogSize: 10 * 1024 * 1024,
      backups: 0,
      compress: true,
      encoding: "utf-8",
      mode: 0o0640,
      flags: "w+",
    },
    dateFile: {
      type: "dateFile",
      filename: "convert-history.log",
      pattern: "yyyy-MM-dd-hh",
      compress: true,
    },
    out: {
      type: "stdout",
    },
  },
  categories: {
    default: { appenders: ["file", "dateFile", "out"], level: "trace" },
  },
});
const logger = log4js.getLogger("convert-log");

//Export to PDF function

async function exportToPDF(input, output) {
  const html = path.resolve(input);
  const browser = await puppeteer.launch({
    args: [
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-first-run',
        '--no-sandbox',
        '--no-zygote',
        '--single-process',
    ]
});
  const page = await browser.newPage();
  await page.goto("file://" + html);
  await page.emulateMediaType("screen");
  await page.pdf({
    path: output,
    format: "A4",
    landscape: true,
    displayHeaderFooter: true,
    printBackground: true,
  });
  await browser.close();
}

//Upload file function

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads");
  },
  filename: (req, file, cb) => {
    const { originalname, mimetype } = file;
    const fileName = `${uuid()}-${originalname}`;
    cb(null, fileName);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype !== "application/x-zip-compressed") {
    console.log(
      "expecting - application/x-zip-compressed, but get - ",
      file.mimetype
    );
    cb("bad file type", false);
  } else cb(null, true);
};

const upload = multer({ storage, limits: { fileSize: LIMIT }, fileFilter });

//APP define
const app = express();
app.use(express.static("public"));

//POST ROUTE uploading zip - decompress - save - export pdf - save - redirect - download pdf

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const start = performance.now(); //logging time start
    const fileName = req.file.filename;

    //upload and unzip in stream
    const file = fs
      .createReadStream(req.file.path)
      .pipe(unzipper.Extract({ path: `output/originals/${fileName}` }));
    //exporting to pdf
    
    await exportToPDF(
      `output/originals/${fileName}/index.html`,
      `output/pdf/${fileName}.pdf`
    );
    const end = performance.now(); //logging time to end
    //get info in logs
console.log('all log information can be found in convert-history.log')
    logger.info({
      fileName: `${fileName}`,
      timeToConvert: `${end - start}ms`,
      usedMemory: `${memoryUsage.rss}`,
    });

    //empty output originals
    fs.emptyDir(path.resolve(__dirname, "./output/originals/"));

   // res.status(200).send({message: 'succes'})

   //redirect to download
    res.redirect(`/convert/${fileName}`);

    
  } catch (e) {
    //empty zip and output originals
    const fileName = req.file.filename;
    fs.emptyDir(path.resolve(__dirname, `./output/originals/`));
    fs.remove(path.resolve(__dirname, `./uploads/${fileName}`));

    //log error
    console.log('all log information can be found in convert-history.log')
    logger.error(e);
    res
      .status(415)
      .send({ error: 'no index.html in root directory' });
  }
});

//error handler file size and others
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    console.log("file larger than ", LIMIT / 1000000 / 1000, "Gb");
    logger.error("file size error");
    res.status(415).send({ error: "file to large" });
    return;
  }
  if (err) {
    logger.error(err);
    res.status(415).send({ error: err });
    return;
  }
});
//download file
app.get("/convert/:file", async (req, res) => {
  try {
    const fileName = req.params.file;
    res.download(path.resolve(__dirname, `./output/pdf/${fileName}.pdf`));
  } catch (e) {
    console.log(e);
  }
});

app.listen(PORT, () => console.log(`app currently running on ${PORT}`));
