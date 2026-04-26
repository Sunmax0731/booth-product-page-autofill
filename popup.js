const boothEditUrl = /^https:\/\/manage\.booth\.pm\/items\/\d+\/edit(?:[?#].*)?$/;

const dropZone = document.getElementById("dropZone");
const markdownInput = document.getElementById("markdownFile");
const imageInput = document.getElementById("imageFiles");
const fillButton = document.getElementById("fillButton");
const autoSaveInput = document.getElementById("autoSave");
const previewTitle = document.getElementById("previewTitle");
const previewImages = document.getElementById("previewImages");
const previewBlocks = document.getElementById("previewBlocks");
const statusOutput = document.getElementById("status");

const titleSectionNames = ["商品名", "商品名案", "タイトル", "Title"];
const overviewSectionNames = ["概要", "商品概要", "Summary"];
const updateHistorySectionNames = ["アップデート履歴", "更新履歴", "バージョン履歴", "Release Notes", "Changelog", "CHANGELOG"];
const excludedDescriptionSectionNames = new Set([
  "根拠",
  "出典",
  "Source",
  "Sources",
  "商品名",
  "商品名案",
  "タイトル",
  "Title",
  "タグ案",
  "タグ",
  "Tags",
  "商品画像構成案",
  "商品画像生成プロンプト",
  "Chrome 拡張入力フォーマット",
  "BOOTH入力設定",
  "BOOTH 入力設定"
]);

let parsedProduct = null;
let selectedImages = [];
let dragDepth = 0;

markdownInput.addEventListener("change", async () => {
  clearStatus();
  const file = markdownInput.files?.[0];
  if (!file) {
    parsedProduct = null;
    updatePreview();
    return;
  }

  try {
    await loadMarkdownFile(file);
  } catch (error) {
    parsedProduct = null;
    showError(`Markdown の読み込みに失敗しました: ${error.message}`);
    updatePreview();
  }
});

imageInput.addEventListener("change", async () => {
  clearStatus();
  try {
    await loadImageFiles(Array.from(imageInput.files || []));
  } catch (error) {
    selectedImages = [];
    showError(`画像の読み込みに失敗しました: ${error.message}`);
    updatePreview();
  }
});

setupDropZone();

fillButton.addEventListener("click", async () => {
  clearStatus();
  if (!parsedProduct) {
    showError("Markdown を選択してください。");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !boothEditUrl.test(tab.url || "")) {
    showError("BOOTH の商品編集ページ https://manage.booth.pm/items/nnnnnnn/edit を開いてから実行してください。");
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"]
  });

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "BOOTH_AUTOFILL",
    payload: {
      product: parsedProduct,
      images: selectedImages,
      autoSave: autoSaveInput.checked
    }
  });

  if (!response?.ok) {
    showError(response?.message || "入力に失敗しました。");
    return;
  }

  showStatus(response.message);
});

async function loadMarkdownFile(file) {
  if (!isMarkdownFile(file)) {
    throw new Error(`${file.name} は Markdown ファイルではありません。`);
  }

  const markdown = await file.text();
  parsedProduct = parseProductMarkdown(markdown);
  setInputFiles(markdownInput, [file]);
  updatePreview();
}

async function loadImageFiles(files) {
  const imageFiles = files.filter(isImageFile);
  if (files.length && !imageFiles.length) {
    throw new Error("画像ファイルが見つかりません。");
  }

  selectedImages = await Promise.all(imageFiles.map(readImageFile));
  setInputFiles(imageInput, imageFiles);
  updatePreview();
}

function setupDropZone() {
  if (!dropZone) {
    return;
  }

  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (eventName === "dragenter") {
        dragDepth += 1;
      }
      dropZone.classList.add("drag-over");
    });
  }

  dropZone.addEventListener("dragleave", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      dropZone.classList.remove("drag-over");
    }
  });

  dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    dropZone.classList.remove("drag-over");
    clearStatus();

    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) {
      showError("ドロップされたファイルを読み取れませんでした。");
      return;
    }

    const markdownFile = files.find(isMarkdownFile);
    const imageFiles = files.filter(isImageFile);

    if (!markdownFile && !imageFiles.length) {
      showError("Markdown または画像ファイルをドロップしてください。");
      return;
    }

    try {
      if (markdownFile) {
        await loadMarkdownFile(markdownFile);
      }
      if (imageFiles.length) {
        await loadImageFiles(imageFiles);
      }
      const loaded = [
        markdownFile ? `Markdown: ${markdownFile.name}` : "",
        imageFiles.length ? `画像: ${imageFiles.length} 件` : ""
      ].filter(Boolean).join(" / ");
      showStatus(`読み込み完了: ${loaded}`);
    } catch (error) {
      showError(`ドロップファイルの読み込みに失敗しました: ${error.message}`);
    }
  });
}

function updatePreview() {
  previewTitle.textContent = parsedProduct?.title || "未選択";
  previewImages.textContent = `${selectedImages.length} 件`;
  previewBlocks.textContent = parsedProduct ? `${parsedProduct.descriptionBlocks.length} ブロック` : "0 ブロック";
  fillButton.disabled = !parsedProduct;
}

function isMarkdownFile(file) {
  const name = (file?.name || "").toLowerCase();
  const type = (file?.type || "").toLowerCase();
  return name.endsWith(".md")
    || name.endsWith(".markdown")
    || name.endsWith(".txt")
    || type === "text/markdown"
    || type === "text/plain";
}

function isImageFile(file) {
  return (file?.type || "").startsWith("image/");
}

function setInputFiles(input, files) {
  try {
    const transfer = new DataTransfer();
    for (const file of files) {
      transfer.items.add(file);
    }
    input.files = transfer.files;
  } catch (_error) {
    // Some browsers do not allow programmatic FileList assignment in extension popups.
  }
}

function clearStatus() {
  statusOutput.classList.remove("error");
  statusOutput.value = "";
  statusOutput.textContent = "";
}

function showStatus(message) {
  statusOutput.classList.remove("error");
  statusOutput.value = message;
  statusOutput.textContent = message;
}

function showError(message) {
  statusOutput.classList.add("error");
  statusOutput.value = message;
  statusOutput.textContent = message;
}

function parseProductMarkdown(markdown) {
  const sections = splitSections(markdown);
  const title = firstContentLine(firstSection(sections, titleSectionNames)) || firstHeading(markdown) || "";
  const summary = cleanSection(firstSection(sections, overviewSectionNames) || "");
  const descriptionBlocks = buildDescriptionBlocks(sections);
  const description = renderDescription(descriptionBlocks);

  if (!title.trim()) {
    throw new Error("商品名セクションまたは H1 見出しが見つかりません。");
  }

  if (!description.trim()) {
    throw new Error("商品紹介として入力する本文が見つかりません。");
  }

  return {
    title: title.trim(),
    summary,
    descriptionBlocks,
    description
  };
}

function splitSections(markdown) {
  const sections = new Map();
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let current = null;
  let buffer = [];

  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) {
        sections.set(current, buffer.join("\n").trim());
      }
      current = match[1].trim();
      buffer = [];
      continue;
    }

    if (current) {
      buffer.push(line);
    }
  }

  if (current) {
    sections.set(current, buffer.join("\n").trim());
  }

  return sections;
}

function buildDescriptionBlocks(sections) {
  const blocks = [];
  const overview = cleanSection(firstSection(sections, overviewSectionNames) || "");
  if (overview) {
    blocks.push({ heading: "", body: overview });
  }

  for (const [name] of sections) {
    if (isExcludedSection(name) || isOverviewSection(name)) {
      continue;
    }

    const section = cleanSection(sections.get(name) || "");
    if (!section) {
      continue;
    }

    if (isUpdateHistorySection(name)) {
      blocks.push({ heading: name, body: formatUpdateHistory(section) });
      continue;
    }

    const subBlocks = splitSubsections(section, name);
    if (subBlocks.length) {
      blocks.push(...subBlocks);
    } else {
      blocks.push({ heading: name, body: section });
    }
  }

  return blocks;
}

function firstSection(sections, names) {
  const normalizedNames = names.map(normalizeSectionName);
  for (const [name, value] of sections) {
    if (normalizedNames.includes(normalizeSectionName(name))) {
      return value;
    }
  }
  return "";
}

function isOverviewSection(name) {
  return overviewSectionNames.map(normalizeSectionName).includes(normalizeSectionName(name));
}

function isUpdateHistorySection(name) {
  return updateHistorySectionNames.map(normalizeSectionName).includes(normalizeSectionName(name));
}

function isExcludedSection(name) {
  return excludedDescriptionSectionNames.has(name)
    || excludedDescriptionSectionNames.has(name.trim())
    || Array.from(excludedDescriptionSectionNames).map(normalizeSectionName).includes(normalizeSectionName(name));
}

function normalizeSectionName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function formatUpdateHistory(section) {
  return cleanSection(section).replace(/^###\s+/gm, "");
}

function splitSubsections(section, fallbackHeading) {
  const blocks = [];
  const lines = section.replace(/\r\n/g, "\n").split("\n");
  let currentHeading = "";
  let buffer = [];
  let preamble = [];

  for (const line of lines) {
    const match = /^###\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (!currentHeading && preamble.join("\n").trim()) {
        blocks.push({ heading: fallbackHeading, body: cleanSection(preamble.join("\n")) });
        preamble = [];
      }
      if (currentHeading && buffer.join("\n").trim()) {
        blocks.push({ heading: currentHeading, body: cleanSection(buffer.join("\n")) });
      }
      currentHeading = match[1].trim();
      buffer = [];
      continue;
    }

    if (currentHeading) {
      buffer.push(line);
    } else {
      preamble.push(line);
    }
  }

  if (!currentHeading && preamble.join("\n").trim()) {
    blocks.push({ heading: fallbackHeading, body: cleanSection(preamble.join("\n")) });
  }

  if (currentHeading && buffer.join("\n").trim()) {
    blocks.push({ heading: currentHeading, body: cleanSection(buffer.join("\n")) });
  }

  return blocks;
}

function renderDescription(blocks) {
  return blocks
    .map((block) => {
      if (!block.heading) {
        return block.body;
      }
      return `### ${block.heading}\n\n${block.body}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function cleanSection(section) {
  return section
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstContentLine(section = "") {
  return section
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("-"));
}

function firstHeading(markdown) {
  const match = /^#\s+(.+?)\s*$/m.exec(markdown);
  return match?.[1]?.replace(/\s+BOOTH\s+(出品文|商品ページ)\s*$/i, "");
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error(`${file.name} は画像ファイルではありません。`));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} を読み込めませんでした。`));
    reader.onload = () => resolve({
      name: file.name,
      type: file.type,
      dataUrl: reader.result
    });
    reader.readAsDataURL(file);
  });
}
